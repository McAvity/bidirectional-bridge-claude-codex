import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AdapterHealth, AttemptTerminationKind, BridgeError, DeliverableStatus, ErrorCode, EventType, TaskState,
  type AgentAdapter, type Deliverable, type TaskInvocation, type TaskSpec } from "@bridge/protocol";
import { ControlPlane } from "./control-plane.js";
import { ManualClock } from "./clock.js";
import { FeatureWorkflow } from "./feature-workflow.js";
import { Orchestrator } from "./orchestrator.js";

const spec: TaskSpec = { objective: "write a bounded fixture", scope: { paths: ["docs/fixture/**"] },
  dependencies: [], expected_deliverable: "local evidence", verification_criteria: ["fixture check"] };
const HANDLE = "synthetic-report-session";
const FEATURE = "F-report-fixture";
const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "delivery-recovery-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const clock = new ManualClock(1_900_000_000_000);
  const seen: TaskInvocation[] = [];
  const behavior = { handle: HANDLE as string | null, exit: 0 as number | null,
    termination: AttemptTerminationKind.COMPLETED as AttemptTerminationKind, malformed: true,
    reason: "Deliverable failed validation: changed_scope expected array, got object", report: true,
    corruptReport: false, resumedHandle: HANDLE, gate: undefined as Promise<void> | undefined };
  function open() {
    const cp = ControlPlane.open({ workspaceRoot: dir, databasePath: join(dir, ".bridge/bridge.db"), clock });
    let closed = false;
    const close = () => { if (!closed) cp.close(); closed = true; };
    cleanup.push(close);
    const adapter: AgentAdapter = {
      info: { agent: "claude", implementation: "historical-report-fixture", version: "1", capabilities: ["resume"], max_concurrency: 1 },
      async health() { return { status: AdapterHealth.READY, checked_at: clock.now() }; }, async cancel() {},
      async invoke(invocation, ctx) {
        seen.push(invocation);
        const handle = invocation.resume_required ? behavior.resumedHandle : behavior.handle;
        if (handle) await ctx.saveExecutionHandle(handle);
        await ctx.reportTelemetry?.({ runtime: "claude-code", process_exit_code: behavior.exit, termination_kind: behavior.termination });
        await behavior.gate;
        const check = { kind: "test" as const, command: "fixture check", passed: true, exit_code: 0, summary: "ok" };
        const d: Deliverable = { task_id: invocation.task_id, agent: "claude", status: DeliverableStatus.COMPLETE,
          summary: "fixture implemented", changed_scope: [], artifacts: [], commit_or_diff: null,
          verification_results: [check], verification_performed: [check.command], remaining_risks: [],
          dependencies_unblocked: [], recommended_next_action: "review", at: clock.now() };
        if (behavior.malformed) {
          if (behavior.report) {
            const text = '```json\n{"changed_scope":{"source":["docs/fixture/a.md"]}}\n```';
            await ctx.publishArtifact({ kind: "report", name: "claude-report.md", media_type: "text/markdown", inline: text,
              metadata: { source: "claude-final-output", sequence: 1, total_chunks: 1,
                complete_report_sha256: behavior.corruptReport ? "0".repeat(64) : createHash("sha256").update(text).digest("hex") } });
          }
          await ctx.raiseBlocker("fixture report evidence requires correction");
          if (!behavior.reason.startsWith("Deliverable failed validation:")) {
            throw new BridgeError(ErrorCode.INVALID_ARGUMENT, behavior.reason);
          }
          return { ...d, changed_scope: { source: ["docs/fixture/a.md"] } } as unknown as Deliverable;
        }
        return d;
      },
    };
    cp.adapters.register(adapter);
    const orchestrator = new Orchestrator(cp);
    const flow = new FeatureWorkflow(cp, orchestrator);
    return { cp, orchestrator, flow, close };
  }
  const first = open();
  const root = first.cp.tasks.create({ spec, created_by: "codex" });
  first.cp.tasks.claim(root.task_id, "codex");
  first.cp.tasks.transition({ task_id: root.task_id, agent: "codex", to: TaskState.WORKING });
  first.flow.create(FEATURE, "codex", root.task_id);
  async function fail() {
    const result = await first.flow.run({ feature_id: FEATURE, manager: "codex", spec,
      input_artifacts: [], deadline_ms: 10_000, idempotency_key: "fixture-round" });
    expect(result.task.state).toBe(TaskState.FAILED);
    return result.task;
  }
  return { dir, first, open, clock, behavior, seen, root, fail };
}
function request(task_id: string, extra: Record<string, unknown> = {}) {
  return { task_id, requested_by: "codex", recover_invalid_delivery: true, deadline_ms: 10_000,
    idempotency_key: "fixture-report-recovery", message: "Correct only the report from preserved evidence; keep existing work.", ...extra
  } as Parameters<Orchestrator["resumeDelegatedTask"]>[0];
}
function snapshot(cp: ControlPlane, task_id: string) {
  return { task: cp.tasks.get(task_id), attempts: cp.attempts.list(task_id), events: cp.events({ task_id }),
    leases: cp.store.listHeldLeases(), artifacts: cp.artifacts.list(task_id), deliverable: cp.deliverables.get(task_id) };
}

describe("explicit recovery of historical delivery-schema rejection", () => {
  it("survives restart, preserves the failed attempt/report, and resumes the exact task/session", async () => {
    const f = fixture(); const t = await f.fail();
    const old = snapshot(f.first.cp, t.task_id);
    await expect(f.first.orchestrator.resumeDelegatedTask({ task_id: t.task_id, requested_by: "codex" }))
      .rejects.toMatchObject({ code: ErrorCode.ILLEGAL_TRANSITION });
    expect(snapshot(f.first.cp, t.task_id)).toEqual(old);
    f.first.close(); f.behavior.malformed = false;
    const next = f.open();
    const result = await next.orchestrator.resumeDelegatedTask(request(t.task_id));
    expect(result).toMatchObject({ task_id: t.task_id, previous_attempt: 0, recovered_attempt: 1,
      recovery_mode: "invalid_delivery", state: TaskState.DONE, same_execution_handle: true, error: null, lease_state: "RELEASED" });
    expect(f.seen).toHaveLength(2);
    expect(f.seen[1]).toMatchObject({ task_id: t.task_id, previous_execution_handle: HANDLE, resume_required: true });
    expect(next.cp.attempts.get(t.task_id, 0)).toEqual(old.attempts[0]);
    expect(next.cp.artifacts.list(t.task_id)).toEqual(old.artifacts);
    expect(next.cp.tasks.get(t.task_id).parent_task_id).toBe(f.root.task_id);
    expect(next.flow.get(FEATURE, "codex").task_ids).toEqual([t.task_id]);
    expect(next.cp.events({ task_id: t.task_id })).toContainEqual(expect.objectContaining({
      type: EventType.TASK_STATE_CHANGED, payload: expect.objectContaining({ from: "FAILED", to: "WORKING", reason: "invalid_delivery_recovery" }) }));
  });

  it("joins identical in-flight calls and replays after restart without another invocation", async () => {
    const f = fixture(); const t = await f.fail(); f.behavior.malformed = false;
    let release!: () => void;
    f.behavior.gate = new Promise<void>(resolve => { release = resolve; });
    const a = f.first.orchestrator.resumeDelegatedTask(request(t.task_id));
    const b = f.first.orchestrator.resumeDelegatedTask(request(t.task_id));
    release(); expect(await a).toEqual(await b); expect(f.seen).toHaveLength(2);
    f.first.close(); const next = f.open();
    expect((await next.orchestrator.resumeDelegatedTask(request(t.task_id))).recovered_attempt).toBe(1);
    expect(f.seen).toHaveLength(2);
    await expect(next.orchestrator.resumeDelegatedTask(request(t.task_id, { message: "different" })))
      .rejects.toMatchObject({ code: ErrorCode.IDEMPOTENCY_MISMATCH });
  });

  it.each([
    ["unrelated INVALID_ARGUMENT", { reason: "invalid input scope" }],
    ["missing handle", { handle: null }], ["missing report", { report: false }],
    ["crashed runtime", { termination: AttemptTerminationKind.CRASH }],
    ["nonzero exit", { exit: 1 }], ["unknown exit", { exit: null }],
  ])("refuses %s without a write", async (_label, overrides) => {
    const f = fixture(); Object.assign(f.behavior, overrides); const t = await f.fail();
    if (f.behavior.termination !== AttemptTerminationKind.COMPLETED) {
      const telemetry = f.first.cp.attempts.queryTelemetry({ task_id: t.task_id, attempt: 0 })[0]!;
      // Historical contradictory telemetry in this disposable fixture DB only.
      const db = new DatabaseSync(join(f.dir, ".bridge/bridge.db"));
      db.prepare("UPDATE attempt_telemetry SET json=? WHERE task_id=? AND attempt=0")
        .run(JSON.stringify({ ...telemetry, termination_kind: f.behavior.termination }), t.task_id);
      db.close();
    }
    const before = snapshot(f.first.cp, t.task_id);
    await expect(f.first.orchestrator.resumeDelegatedTask(request(t.task_id))).rejects.toBeInstanceOf(BridgeError);
    expect(snapshot(f.first.cp, t.task_id)).toEqual(before); expect(f.seen).toHaveLength(1);
  });

  it.each([
    ["no deadline", { deadline_ms: undefined }], ["no key", { idempotency_key: undefined }],
    ["no message", { message: undefined }], ["two modes", { recover_timeout: true }],
    ["invalid flag", { recover_invalid_delivery: "yes" }], ["foreign manager", { requested_by: "other" }],
  ])("rejects %s before reservation", async (_label, overrides) => {
    const f = fixture(); const t = await f.fail(); const before = snapshot(f.first.cp, t.task_id);
    await expect(f.first.orchestrator.resumeDelegatedTask(request(t.task_id, overrides))).rejects.toBeInstanceOf(BridgeError);
    expect(snapshot(f.first.cp, t.task_id)).toEqual(before);
  });

  it("preserves waiting_user and closure gates", async () => {
    const f = fixture(); const t = await f.fail();
    f.first.flow.waitUser(FEATURE, "codex", "fixture-question", "Choose a limit");
    const before = snapshot(f.first.cp, t.task_id);
    await expect(f.first.orchestrator.resumeDelegatedTask(request(t.task_id))).rejects.toMatchObject({ code: ErrorCode.INVALID_ARGUMENT });
    expect(snapshot(f.first.cp, t.task_id)).toEqual(before);
  });

  it("refuses an active lease", async () => {
    const f = fixture(); const t = await f.fail();
    const lease = f.first.cp.leases.acquire({ task_id: t.task_id, holder: "claude", scope: spec.scope, ttl_ms: 10_000 });
    const before = snapshot(f.first.cp, t.task_id);
    await expect(f.first.orchestrator.resumeDelegatedTask(request(t.task_id))).rejects.toMatchObject({ code: ErrorCode.SCOPE_CONFLICT });
    expect(snapshot(f.first.cp, t.task_id)).toEqual(before);
    f.first.cp.leases.release(lease.lease_id, "claude");

  });

  it("refuses missing runtime telemetry without writes", async () => {
    const f = fixture(); const t = await f.fail();
    const db = new DatabaseSync(join(f.dir, ".bridge/bridge.db"));
    db.prepare("DELETE FROM attempt_telemetry WHERE task_id=?").run(t.task_id); db.close();
    const before = snapshot(f.first.cp, t.task_id);
    await expect(f.first.orchestrator.resumeDelegatedTask(request(t.task_id))).rejects.toBeInstanceOf(BridgeError);
    expect(snapshot(f.first.cp, t.task_id)).toEqual(before);
  });

  it("refuses a corrupt complete report digest without writes", async () => {
    const f = fixture(); f.behavior.corruptReport = true; const t = await f.fail();
    const before = snapshot(f.first.cp, t.task_id);
    await expect(f.first.orchestrator.resumeDelegatedTask(request(t.task_id))).rejects.toBeInstanceOf(BridgeError);
    expect(snapshot(f.first.cp, t.task_id)).toEqual(before);
  });

  it("refuses recovery of a cancelled feature", async () => {
    const f = fixture(); const t = await f.fail();
    f.first.flow.close({ feature_id: FEATURE, manager: "codex", outcome: "cancelled", reason: "synthetic cancellation",
      decision_ref: "docs/fixture/decision.md", idempotency_key: "fixture-close" });
    const before = snapshot(f.first.cp, t.task_id);
    await expect(f.first.orchestrator.resumeDelegatedTask(request(t.task_id))).rejects.toMatchObject({ code: ErrorCode.FEATURE_CLOSED });
    expect(snapshot(f.first.cp, t.task_id)).toEqual(before);
  });

  it("does not replace a session when strict resume reports another handle", async () => {
    const f = fixture(); const t = await f.fail(); f.behavior.malformed = false; f.behavior.resumedHandle = "synthetic-other-session";
    const out = await f.first.orchestrator.resumeDelegatedTask(request(t.task_id));
    expect(out).toMatchObject({ state: TaskState.BLOCKED, same_execution_handle: false, error: { code: ErrorCode.ADAPTER_FAILURE } });
    expect(f.first.cp.attempts.get(t.task_id, 1)?.execution_handle).toBe(HANDLE);
    expect(f.seen).toHaveLength(2);
  });
});
