/**
 * Termination evidence from the real runner, driven through the stream-json stand-in.
 *
 * The runner keeps a bounded stderr tail and process/stream metadata and hands them to the
 * control plane whenever the runtime did not complete normally, including the deadline and
 * cancel paths that return no stderr in their result. It never passes the prompt, argv,
 * frame content or the session id.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AttemptTerminationKind,
  DEADLINE_ABORT_REASON,
  ErrorCode,
  type TaskInvocation,
  type TaskSpec,
  type TerminationEvidence,
} from "@bridge/protocol";
import { ClaudeAdapter } from "./claude-adapter.js";
import { ClaudeCodeRunner } from "./claude-code-runner.js";

const here = dirname(fileURLToPath(import.meta.url));
const fakeCli = join(here, "..", "..", "test", "fixtures", "fake-claude-cli.mjs");
const SESSION = "11111111-2222-4333-8444-555555555555";
const OBJECTIVE = "inspect the repository without writing anything";

class FixtureRunner extends ClaudeCodeRunner {
  override buildArgs(invocation: Parameters<ClaudeCodeRunner["buildArgs"]>[0], prompt: string): string[] {
    return [fakeCli, ...super.buildArgs(invocation, prompt)];
  }
}

const spec: TaskSpec = {
  objective: OBJECTIVE,
  scope: { paths: ["docs/**"] },
  dependencies: [],
  expected_deliverable: "a report",
  verification_criteria: ["node --version runs"],
};

let workspace: string;
beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "claude-evidence-"));
});
afterEach(() => {
  rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function run(
  mode: string,
  options: { stderr?: string; deadlineMs?: number; abortAfterMs?: number; abortReason?: unknown } = {},
) {
  const runner = new FixtureRunner({
    command: process.execPath,
    env: {
      ...process.env,
      FAKE_CLAUDE_MODE: mode,
      ...(options.stderr !== undefined ? { FAKE_CLAUDE_STDERR: options.stderr } : {}),
    },
    maxTurns: 4,
    permissionMode: "plan",
    killGraceMs: 500,
  });
  const adapter = new ClaudeAdapter({ runner, agent: "claude" });
  const controller = new AbortController();
  const recorded: TerminationEvidence[] = [];
  const invocation = {
    task_id: "task_aaaaaaaaaa",
    spec,
    inputs: [],
    workspace_root: workspace,
    lease_id: "lease_aaaaaaaaaa",
    deadline_at: Date.now() + (options.deadlineMs ?? 20_000),
    attempt: 0,
    idempotency_key: "k",
    previous_execution_handle: null,
  } as TaskInvocation;
  if (options.abortAfterMs !== undefined) {
    setTimeout(() => controller.abort(options.abortReason), options.abortAfterMs);
  }
  let error: unknown;
  try {
    await adapter.invoke(invocation, {
      report: async () => {},
      publishArtifact: async () => "art_0000000000",
      recordVerification: async () => {},
      raiseBlocker: async () => {},
      saveExecutionHandle: async () => {},
      reportTelemetry: async () => {},
      recordTerminationEvidence: async (evidence) => {
        recorded.push(evidence);
      },
      signal: controller.signal,
    });
  } catch (caught) {
    error = caught;
  }
  return { recorded, error, invocation };
}

function assertNoPrivateContent(evidence: TerminationEvidence): void {
  const serialized = JSON.stringify(evidence);
  expect(serialized).not.toContain(OBJECTIVE);
  expect(serialized).not.toContain(SESSION);
  expect(serialized).not.toContain("--permission-mode");
  expect(serialized).not.toContain("Collected runtime information");
}

describe("runner termination evidence", () => {
  it("keeps stderr and process metadata when its own deadline kills the runtime", async () => {
    const { recorded, invocation } = await run("hang", { stderr: "runtime warning: slow api\n", deadlineMs: 1_000 });
    expect(recorded).toHaveLength(1);
    const [evidence] = recorded;
    expect(evidence).toMatchObject({
      runtime: "claude-code",
      termination_kind: AttemptTerminationKind.TIMEOUT,
      reason: "deadline",
      deadline_at: invocation.deadline_at,
      process: { sigterm_sent: true },
      stream: { result_frame: false, frame_types: { system: 1 } },
      stderr: { total_bytes: Buffer.byteLength("runtime warning: slow api\n") },
    });
    expect(evidence!.stderr.tail).toContain("runtime warning: slow api");
    expect(evidence!.process.ended_at).toBeGreaterThanOrEqual(evidence!.process.started_at);
    assertNoPrivateContent(evidence!);
  }, 30_000);

  it("reports the bridge deadline, not a cancellation, when the orchestrator aborts at its deadline", async () => {
    const { recorded } = await run("hang", { stderr: "waiting on api\n", abortAfterMs: 500, abortReason: DEADLINE_ABORT_REASON });
    expect(recorded[0]).toMatchObject({ termination_kind: AttemptTerminationKind.TIMEOUT, reason: "deadline" });
    expect(recorded[0]!.stderr.tail).toContain("waiting on api");
  }, 30_000);

  it("keeps stderr when the invocation is cancelled", async () => {
    const { recorded } = await run("hang", { stderr: "cancel me\n", abortAfterMs: 500 });
    expect(recorded[0]).toMatchObject({ termination_kind: AttemptTerminationKind.CANCELLED, reason: "cancelled" });
    expect(recorded[0]!.stderr.tail).toContain("cancel me");
    assertNoPrivateContent(recorded[0]!);
  }, 30_000);

  it("keeps stderr when the runtime exits without a result frame", async () => {
    const { recorded, error } = await run("noresult", { stderr: "fatal: bad flag\n" });
    expect(error).toMatchObject({ code: ErrorCode.ADAPTER_FAILURE });
    expect(recorded[0]).toMatchObject({ reason: "no_result_frame", process: { exit_code: 3 } });
    expect(recorded[0]!.stderr.tail).toContain("fatal: bad flag");
  });

  it.each([
    ["error", "runtime_error"],
    ["maxturns", "max_turns"],
  ])("records evidence for the %s result", async (mode, reason) => {
    const { recorded } = await run(mode);
    expect(recorded[0]).toMatchObject({ termination_kind: AttemptTerminationKind.FAILED, reason, stream: { result_frame: true } });
  });

  it("bounds the in-memory stderr tail but counts every byte", async () => {
    // Above the runner's 64 000-character buffer, below Linux's 128 KiB per-variable limit.
    const big = `${"e".repeat(99_990)}\nTAIL-MARK\n`;
    const { recorded } = await run("noresult", { stderr: big });
    expect(recorded[0]!.stderr.total_bytes).toBe(Buffer.byteLength(big));
    expect(recorded[0]!.stderr.tail.length).toBeLessThanOrEqual(64_000);
    expect(recorded[0]!.stderr.tail).toContain("TAIL-MARK");
  });

  it("records nothing for a normally completed run", async () => {
    const { recorded, error } = await run("ok", { stderr: "harmless notice\n" });
    expect(error).toBeUndefined();
    expect(recorded).toHaveLength(0);
  });
});
