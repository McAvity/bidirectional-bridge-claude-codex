/**
 * Termination evidence: what survives when a runtime is stopped without a normal result.
 *
 * The control plane owns the file: location, size bound, permissions, redaction, and the
 * metadata-only event. Runtime adapters only hand over what they observed.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AdapterHealth,
  AttemptTerminationKind,
  DeliverableStatus,
  ErrorCode,
  EventType,
  TaskState,
  type AgentAdapter,
  type TerminationEvidence,
} from "@bridge/protocol";
import { ManualClock } from "./clock.js";
import { ControlPlane } from "./control-plane.js";
import { TERMINATION_EVIDENCE_STDERR_MAX_BYTES } from "./evidence-store.js";
import { Orchestrator } from "./orchestrator.js";

const HANDLE = "session-evidence-0001";
const SECRET = `sk-ant-${"a".repeat(24)}`;

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const step of cleanup.splice(0).reverse()) step();
});

function evidence(overrides: Partial<TerminationEvidence> = {}): TerminationEvidence {
  return {
    runtime: "claude-code",
    runtime_version: "2.1.269",
    termination_kind: AttemptTerminationKind.TIMEOUT,
    reason: "deadline",
    deadline_at: 1_000,
    process: { exit_code: null, signal: "SIGTERM", started_at: 1, ended_at: 2, sigterm_sent: true, sigkill_sent: false },
    stream: {
      stdout_bytes: 120,
      frames: 3,
      frame_types: { system: 1, assistant: 2 },
      first_output_at: 1,
      last_frame_at: 2,
      result_frame: false,
    },
    stderr: { total_bytes: 5, tail: "warn\n" },
    ...overrides,
  };
}

function setup(options: { memory?: boolean; evidenceDir?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bridge-evidence-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const clock = new ManualClock(2_000_000_000_000);
  const cp = ControlPlane.open({
    workspaceRoot: dir,
    databasePath: options.memory ? ":memory:" : join(dir, ".bridge", "bridge.db"),
    clock,
    ...(options.evidenceDir ? { evidenceDir: options.evidenceDir } : {}),
  });
  cleanup.push(() => cp.close());
  const task = cp.tasks.create({
    spec: {
      objective: "inspect without writing",
      scope: { paths: ["docs/**"] },
      dependencies: [],
      expected_deliverable: "report",
      verification_criteria: ["report exists"],
    },
    created_by: "codex",
  });
  cp.tasks.claim(task.task_id, "claude");
  cp.tasks.transition({ task_id: task.task_id, agent: "claude", to: TaskState.WORKING });
  cp.attempts.start(task.task_id, 0, "claude");
  cp.attempts.saveHandle(task.task_id, 0, "claude", HANDLE);
  return { dir, clock, cp, task };
}

describe("termination evidence", () => {
  it("writes one bounded, redacted, owner-only file per attempt and logs only metadata", () => {
    const { dir, cp, task } = setup();
    const tail = `${"x".repeat(40_000)}\nauth failed for ${SECRET} in session ${HANDLE}\nEND`;
    const record = cp.evidence.record({
      task_id: task.task_id,
      attempt: 0,
      agent: "claude",
      evidence: evidence({ stderr: { total_bytes: 250_000, tail } }),
    })!;

    const path = join(dir, ".bridge", "evidence", task.task_id, "attempt-0.json");
    expect(record).toMatchObject({ attempt: 0, file: `${task.task_id}/attempt-0.json`, path });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, ".bridge", "evidence", task.task_id)).mode & 0o777).toBe(0o700);

    const raw = readFileSync(path, "utf8");
    const stored = JSON.parse(raw);
    expect(stored).toMatchObject({
      schema: "bridge.termination-evidence.v1",
      task_id: task.task_id,
      attempt: 0,
      agent: "claude",
      termination_kind: AttemptTerminationKind.TIMEOUT,
      reason: "deadline",
      stderr: { total_bytes: 250_000, truncated: true },
    });
    expect(stored.stderr.tail.endsWith("END")).toBe(true);
    expect(Buffer.byteLength(stored.stderr.tail, "utf8")).toBeLessThanOrEqual(TERMINATION_EVIDENCE_STDERR_MAX_BYTES);
    expect(stored.stderr.redactions).toBeGreaterThanOrEqual(2);
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain(HANDLE);
    expect(record.sha256).toBe(createHash("sha256").update(raw).digest("hex"));
    expect(record.bytes).toBe(Buffer.byteLength(raw));

    const events = cp.events({ task_id: task.task_id, types: [EventType.ATTEMPT_EVIDENCE_RECORDED] });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      attempt: 0,
      file: `${task.task_id}/attempt-0.json`,
      sha256: record.sha256,
      termination_kind: AttemptTerminationKind.TIMEOUT,
      stderr_truncated: true,
    });
    expect(JSON.stringify(events)).not.toContain("auth failed");
    expect(cp.evidence.list(task.task_id)).toEqual([record]);
  });

  it("never overwrites the evidence already recorded for an attempt", () => {
    const { cp, task } = setup();
    const first = cp.evidence.record({ task_id: task.task_id, attempt: 0, agent: "claude",
      evidence: evidence({ stderr: { total_bytes: 6, tail: "first\n" } }) })!;
    const second = cp.evidence.record({ task_id: task.task_id, attempt: 0, agent: "claude",
      evidence: evidence({ stderr: { total_bytes: 7, tail: "second\n" } }) })!;
    expect(second).toEqual(first);
    expect(readFileSync(first.path!, "utf8")).toContain("first");
    expect(cp.events({ task_id: task.task_id, types: [EventType.ATTEMPT_EVIDENCE_RECORDED] })).toHaveLength(1);
  });

  it("refuses evidence for an attempt the agent does not own or that does not exist", () => {
    const { dir, cp, task } = setup();
    expect(() => cp.evidence.record({ task_id: task.task_id, attempt: 0, agent: "codex", evidence: evidence() }))
      .toThrow(expect.objectContaining({ code: ErrorCode.INVALID_ARGUMENT }));
    expect(() => cp.evidence.record({ task_id: task.task_id, attempt: 7, agent: "claude", evidence: evidence() }))
      .toThrow(expect.objectContaining({ code: ErrorCode.NOT_FOUND }));
    expect(existsSync(join(dir, ".bridge", "evidence", task.task_id))).toBe(false);
  });

  it("stores nothing when the control plane has no evidence directory", () => {
    const { cp, task } = setup({ memory: true });
    expect(cp.evidence.record({ task_id: task.task_id, attempt: 0, agent: "claude", evidence: evidence() })).toBeNull();
    expect(cp.evidence.list(task.task_id)).toEqual([]);
  });

  it("keeps runtime-controlled labels from carrying free text or secrets", () => {
    const { cp, task } = setup();
    const record = cp.evidence.record({
      task_id: task.task_id,
      attempt: 0,
      agent: "claude",
      evidence: evidence({
        reason: "user said: continue with option B",
        runtime_version: `2.1 ${SECRET}`,
        stream: { ...evidence().stream, frame_types: { assistant: 3, "Please delete the repo": 1 } },
      }),
    })!;
    const stored = JSON.parse(readFileSync(record.path!, "utf8"));
    expect(stored.reason).toBe("unknown");
    expect(stored.runtime_version).toBeNull();
    expect(stored.stream.frame_types).toEqual({ assistant: 3 });
  });

  it("is recorded through the invocation context when the bridge deadline stops a runtime", async () => {
    const { dir, cp, clock } = setup({ memory: true, evidenceDir: join(mkdtempSync(join(tmpdir(), "bridge-ev-")), "evidence") });
    void dir;
    const adapter: AgentAdapter = {
      info: { agent: "claude", implementation: "evidence-fixture", version: "1", capabilities: ["resume"], max_concurrency: 1 },
      async health() {
        return { status: AdapterHealth.READY, checked_at: clock.now() };
      },
      async cancel() {},
      async invoke(invocation, ctx) {
        await ctx.saveExecutionHandle(HANDLE);
        await new Promise<void>((resolve) => ctx.signal.addEventListener("abort", () => resolve(), { once: true }));
        await ctx.recordTerminationEvidence?.(evidence({
          termination_kind: ctx.signal.reason === "bridge-deadline"
            ? AttemptTerminationKind.TIMEOUT : AttemptTerminationKind.CANCELLED,
          stderr: { total_bytes: 12, tail: "slow upstream" },
        }));
        await ctx.raiseBlocker("stopped");
        return {
          task_id: invocation.task_id, agent: "claude", status: DeliverableStatus.PARTIAL, summary: "stopped",
          changed_scope: [], artifacts: [], commit_or_diff: null, verification_performed: [],
          verification_results: [], remaining_risks: [], dependencies_unblocked: [], recommended_next_action: "resume",
          at: clock.now(),
        };
      },
    };
    cp.adapters.register(adapter);
    const outcome = await new Orchestrator(cp).delegate({
      from: "codex",
      to: "claude",
      spec: { objective: "hang", scope: { paths: ["hang/**"] }, dependencies: [], expected_deliverable: "x", verification_criteria: ["y"] },
      input_artifacts: [],
      deadline_ms: 20,
    });
    expect(outcome.error?.code).toBe(ErrorCode.TIMEOUT);
    const [record] = cp.evidence.list(outcome.task_id);
    expect(record).toMatchObject({ attempt: 0, termination_kind: AttemptTerminationKind.TIMEOUT });
    expect(readFileSync(record!.path!, "utf8")).toContain("slow upstream");
  });
});
