/**
 * Explicit recovery of a round that the bridge itself stopped at its deadline.
 *
 * The adapter here is a stand-in that behaves like the Claude adapter on a deadline: it
 * persists its session handle, waits until the orchestrator aborts it, raises a blocker
 * and returns PARTIAL. Deadlines are a few milliseconds and the control-plane clock is
 * manual, so nothing here depends on a model, a network, or wall-clock minutes.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AdapterHealth,
  AttemptTerminationKind,
  BridgeError,
  DeliverableStatus,
  ErrorCode,
  EventType,
  TaskState,
  type AgentAdapter,
  type Deliverable,
  type TaskInvocation,
  type TaskSpec,
} from "@bridge/protocol";
import { normalizeAttemptTelemetry } from "./attempt-service.js";
import { ManualClock } from "./clock.js";
import { ControlPlane } from "./control-plane.js";
import { FeatureWorkflow } from "./feature-workflow.js";
import { Orchestrator } from "./orchestrator.js";

const HANDLE = "session-timeout-original";
const LONG_DEADLINE_MS = 4_500_000;
const LEASE_GRACE_MS = 30_000;
const FEATURE = "F-timeout";

const roundSpec: TaskSpec = {
  objective: "write the identity contract",
  scope: { paths: ["docs/contract/**"] },
  dependencies: [],
  expected_deliverable: "contract package",
  verification_criteria: ["package verifies"],
  max_turns: 32,
};

type Mode = "hang" | "ok" | "fail";

interface Behavior {
  mode: Mode;
  /** Handle a fresh session reports; `null` means the runtime never exposed one. */
  handle: string | null;
  /** Handle a resumed session reports; `undefined` echoes the persisted one. */
  resumedHandle?: string | null;
  gate?: Promise<void>;
  onStart?: () => void;
}

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const step of cleanup.splice(0).reverse()) step();
});

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

function deliverable(invocation: TaskInvocation, status: DeliverableStatus, at: number): Deliverable {
  const check = { kind: "test" as const, command: "fixture check", passed: true, exit_code: 0, summary: "ok" };
  return {
    task_id: invocation.task_id,
    agent: "claude",
    status,
    summary: status === DeliverableStatus.COMPLETE ? "contract written" : "stopped at deadline",
    changed_scope: [],
    artifacts: [],
    commit_or_diff: null,
    verification_performed: status === DeliverableStatus.COMPLETE ? [check.command] : [],
    verification_results: status === DeliverableStatus.COMPLETE ? [check] : [],
    remaining_risks: [],
    dependencies_unblocked: [],
    recommended_next_action: "review",
    at,
  };
}

function workerAdapter(clock: ManualClock, behavior: Behavior, seen: TaskInvocation[]): AgentAdapter {
  return {
    info: { agent: "claude", implementation: "timeout-fixture", version: "1", capabilities: ["resume"], max_concurrency: 1 },
    async health() {
      return { status: AdapterHealth.READY, checked_at: clock.now() };
    },
    async cancel() {},
    async invoke(invocation, ctx) {
      seen.push(invocation);
      behavior.onStart?.();
      const reported = invocation.previous_execution_handle
        ? behavior.resumedHandle === undefined ? invocation.previous_execution_handle : behavior.resumedHandle
        : behavior.handle;
      if (reported) await ctx.saveExecutionHandle(reported);
      if (behavior.gate) await behavior.gate;
      await ctx.reportTelemetry?.({ runtime: "timeout-fixture", runtime_version: "1" });
      if (behavior.mode === "hang") {
        await waitForAbort(ctx.signal);
        await ctx.raiseBlocker("run cancelled by the coordination bridge");
        return deliverable(invocation, DeliverableStatus.PARTIAL, clock.now());
      }
      if (behavior.mode === "fail") {
        throw new BridgeError(ErrorCode.ADAPTER_FAILURE, "fixture runtime crashed");
      }
      await ctx.recordVerification(deliverable(invocation, DeliverableStatus.COMPLETE, clock.now()).verification_results[0]!);
      return deliverable(invocation, DeliverableStatus.COMPLETE, clock.now());
    },
  };
}

function bridgeFixture() {
  const dir = mkdtempSync(join(tmpdir(), "bridge-timeout-recovery-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const clock = new ManualClock(1_800_000_000_000);
  const behavior: Behavior = { mode: "hang", handle: HANDLE };
  const seen: TaskInvocation[] = [];

  /** One bridge process: its own SQLite connection, orchestrator and adapter instance. */
  function open() {
    const cp = ControlPlane.open({ workspaceRoot: dir, databasePath: join(dir, ".bridge", "bridge.db"), clock });
    cp.adapters.register(workerAdapter(clock, behavior, seen));
    let closed = false;
    const close = () => {
      if (!closed) cp.close();
      closed = true;
    };
    cleanup.push(close);
    const orchestrator = new Orchestrator(cp);
    return { cp, orchestrator, flow: new FeatureWorkflow(cp, orchestrator), close };
  }

  const first = open();
  const root = first.cp.tasks.create({
    spec: { ...roundSpec, objective: `Coordinate ${FEATURE}`, scope: { paths: ["docs/features/**"] } },
    created_by: "codex",
  });
  first.cp.tasks.claim(root.task_id, "codex");
  first.cp.tasks.transition({ task_id: root.task_id, agent: "codex", to: TaskState.WORKING });
  first.flow.create(FEATURE, "codex", root.task_id);
  return { dir, clock, behavior, seen, open, first, root };
}

/** Run one round that the bridge stops at a 20 ms deadline. */
async function timedOutRound(f: ReturnType<typeof bridgeFixture>, env = f.first) {
  const result = await env.flow.run({
    feature_id: FEATURE,
    manager: "codex",
    idempotency_key: `${FEATURE}:round-1`,
    spec: roundSpec,
    input_artifacts: [],
    deadline_ms: 20,
  });
  expect(result.task.state).toBe(TaskState.FAILED);
  return result.task;
}

function timeoutRequest(task_id: string, overrides: Record<string, unknown> = {}) {
  return {
    task_id,
    requested_by: "codex",
    idempotency_key: `${task_id}:timeout-recovery-1`,
    recover_timeout: true,
    deadline_ms: LONG_DEADLINE_MS,
    ...overrides,
  } as Parameters<Orchestrator["resumeDelegatedTask"]>[0];
}

/** State that a rejected recovery must leave untouched. */
function snapshot(cp: ControlPlane, task_id: string) {
  return {
    task: cp.tasks.get(task_id),
    attempts: cp.attempts.list(task_id),
    live: cp.leases.listLive().length,
    tasks: cp.tasks.list().length,
  };
}

describe("explicit recovery of a timed-out FAILED round", () => {
  it("keeps the session handle through a bridge restart and resumes the same task and session", async () => {
    const f = bridgeFixture();
    const task = await timedOutRound(f);

    // The timeout left exactly the evidence recovery depends on.
    const timedOut = f.first.cp.attempts.get(task.task_id, 0)!;
    expect(timedOut).toMatchObject({ outcome: ErrorCode.TIMEOUT, execution_handle: HANDLE });
    expect(f.first.cp.attempts.queryTelemetry({ task_id: task.task_id })[0]?.termination_kind)
      .toBe(AttemptTerminationKind.TIMEOUT);
    expect(f.first.flow.get(FEATURE, "codex").state).toBe("blocked");
    expect(f.first.cp.leases.listLive()).toHaveLength(0);
    const telemetryBefore = f.first.cp.attempts.queryTelemetry({ task_id: task.task_id, attempt: 0 });
    f.first.close();

    // A new bridge process: nothing survives except SQLite.
    f.behavior.mode = "ok";
    const restarted = f.open();
    const outcome = await restarted.orchestrator.resumeDelegatedTask(timeoutRequest(task.task_id));

    expect(outcome).toMatchObject({
      task_id: task.task_id,
      owner: "claude",
      previous_attempt: 0,
      recovered_attempt: 1,
      resumed_from_attempt: 0,
      same_execution_handle: true,
      state: TaskState.DONE,
      error: null,
      recovery_mode: "timeout",
      deadline_ms: LONG_DEADLINE_MS,
    });
    expect(f.seen).toHaveLength(2);
    expect(f.seen[1]).toMatchObject({
      task_id: task.task_id,
      attempt: 1,
      previous_execution_handle: HANDLE,
      resume_required: true,
      deadline_at: f.clock.now() + LONG_DEADLINE_MS,
    });

    // History: attempt 0 is exactly as the timeout left it; attempt 1 is new and adjacent.
    expect(restarted.cp.attempts.get(task.task_id, 0)).toEqual(timedOut);
    expect(restarted.cp.attempts.queryTelemetry({ task_id: task.task_id, attempt: 0 })).toEqual(telemetryBefore);
    expect(restarted.cp.attempts.get(task.task_id, 1)).toMatchObject({
      resumed_from_attempt: 0,
      execution_handle: HANDLE,
      outcome: DeliverableStatus.COMPLETE,
    });

    // The fresh lease is sized from the explicit deadline, not the timed-out one.
    const lease = restarted.cp.store.getLease(outcome.fresh_lease_id)!;
    expect(lease.expires_at - lease.acquired_at).toBe(LONG_DEADLINE_MS + LEASE_GRACE_MS);

    const events = restarted.cp.events({ task_id: task.task_id });
    expect(events).toContainEqual(expect.objectContaining({
      type: EventType.TASK_STATE_CHANGED,
      payload: expect.objectContaining({ from: TaskState.FAILED, to: TaskState.WORKING, reason: "timeout_recovery", attempt: 1 }),
    }));
    expect(events.find((event) => event.type === EventType.RECOVERY_REQUESTED)?.payload).toMatchObject({
      mode: "timeout",
      previous_state: TaskState.FAILED,
      deadline_ms: LONG_DEADLINE_MS,
      previous_deadline_ms: 20,
    });
    expect(JSON.stringify(events)).not.toContain(HANDLE);

    const feature = restarted.flow.get(FEATURE, "codex");
    expect(feature).toMatchObject({ state: "awaiting_review", latest_task_id: task.task_id, task_ids: [task.task_id] });
    expect(restarted.cp.tasks.list()).toHaveLength(2);
  });

  it("recovers a timed-out record written before this change, after the user answer is recorded", async () => {
    const f = bridgeFixture();
    const { cp, flow } = f.first;
    // The exact sequence the unchanged pre-fix orchestrator wrote for the wave7 round.
    const child = cp.tasks.create({ spec: { ...roundSpec, preferred_agent: "claude" }, created_by: "codex", parent_task_id: f.root.task_id });
    cp.store.appendEvent({ type: EventType.DELEGATION_REQUESTED, task_id: child.task_id, agent: "codex",
      payload: { to: "claude", deadline_ms: 900_000, input_artifacts: [], max_attempts: 1 } }, f.clock.now());
    cp.tasks.claim(child.task_id, "claude");
    const lease = cp.leases.acquire({ task_id: child.task_id, holder: "claude", scope: child.spec.scope, ttl_ms: 930_000 });
    cp.tasks.transition({ task_id: child.task_id, agent: "claude", to: TaskState.WORKING });
    cp.attempts.start(child.task_id, 0, "claude");
    cp.attempts.saveHandle(child.task_id, 0, "claude", HANDLE);
    cp.tasks.block(child.task_id, "claude", "run cancelled by the coordination bridge");
    cp.attempts.end(child.task_id, 0, "claude", ErrorCode.TIMEOUT);
    cp.tasks.transition({ task_id: child.task_id, agent: "claude", to: TaskState.FAILED,
      reason: "TIMEOUT: adapter 'claude' exceeded its 900000ms deadline" });
    cp.attempts.recordTelemetry(normalizeAttemptTelemetry({
      task_id: child.task_id, run_id: child.run_id, parent_task_id: child.parent_task_id,
      delegation_depth: child.delegation_depth, attempt: 0, agent: "claude",
      orchestration_started_at: f.clock.now(), observed_runtime_started_at: f.clock.now(),
      observed_runtime_ended_at: f.clock.now(), completed_at: f.clock.now(),
      input_artifact_count: 0, input_artifact_bytes: 0,
      termination_kind: AttemptTerminationKind.TIMEOUT, update: { process_exit_code: 143 },
    }));
    cp.leases.release(lease.lease_id, "claude");
    cp.store.putFeature({ ...flow.get(FEATURE, "codex"), state: "blocked", latest_task_id: child.task_id,
      active_task_id: null, task_ids: [child.task_id] });
    flow.waitUser(FEATURE, "codex", "q-01", "Change roles?");
    f.first.close();

    f.behavior.mode = "ok";
    const next = f.open();
    await expect(next.orchestrator.resumeDelegatedTask(timeoutRequest(child.task_id)))
      .rejects.toMatchObject({ code: ErrorCode.INVALID_ARGUMENT });
    expect(next.flow.answerUser(FEATURE, "codex", "q-01", "No role change.").state).toBe("blocked");
    expect(f.seen).toHaveLength(0);

    const outcome = await next.orchestrator.resumeDelegatedTask(timeoutRequest(child.task_id));
    expect(outcome).toMatchObject({ task_id: child.task_id, recovered_attempt: 1, same_execution_handle: true, state: TaskState.DONE });
    expect(f.seen).toHaveLength(1);
    expect(next.cp.attempts.get(child.task_id, 0)).toMatchObject({ outcome: ErrorCode.TIMEOUT });
    expect(next.flow.get(FEATURE, "codex").state).toBe("awaiting_review");
  });

  it("never launches a second execution for a repeated request", async () => {
    const f = bridgeFixture();
    const task = await timedOutRound(f);
    f.behavior.mode = "ok";
    let release!: () => void;
    let started!: () => void;
    f.behavior.gate = new Promise<void>((resolve) => (release = resolve));
    const invoked = new Promise<void>((resolve) => (started = resolve));
    f.behavior.onStart = started;

    const request = timeoutRequest(task.task_id);
    const first = f.first.orchestrator.resumeDelegatedTask(request);
    await Promise.race([invoked, first.then(() => { throw new Error("recovery ended before invoking"); })]);
    const joined = f.first.orchestrator.resumeDelegatedTask(request);
    await expect(f.first.orchestrator.resumeDelegatedTask({ ...request, idempotency_key: "another-key" }))
      .rejects.toBeInstanceOf(BridgeError);
    // A second bridge process sees the active reservation and does not execute.
    const other = f.open();
    await expect(other.orchestrator.resumeDelegatedTask(request))
      .rejects.toMatchObject({ code: ErrorCode.ILLEGAL_TRANSITION });
    await expect(other.orchestrator.resumeDelegatedTask({ ...request, idempotency_key: "third-key" }))
      .rejects.toBeInstanceOf(BridgeError);
    release();
    const [one, two] = await Promise.all([first, joined]);
    expect(two.recovered_attempt).toBe(one.recovered_attempt);

    // After completion, the same key replays from SQLite (also after a restart).
    const replayed = await f.open().orchestrator.resumeDelegatedTask(request);
    expect(replayed).toMatchObject({ recovered_attempt: 1, state: TaskState.DONE, recovery_mode: "timeout", deadline_ms: LONG_DEADLINE_MS });
    await expect(f.first.orchestrator.resumeDelegatedTask({ ...request, deadline_ms: LONG_DEADLINE_MS + 1 }))
      .rejects.toMatchObject({ code: ErrorCode.IDEMPOTENCY_MISMATCH });
    await expect(f.first.orchestrator.resumeDelegatedTask({ ...request, idempotency_key: "late-key" }))
      .rejects.toBeInstanceOf(BridgeError);

    expect(f.seen).toHaveLength(2);
    expect(f.first.cp.attempts.list(task.task_id)).toHaveLength(2);
  });

  it("rejects a timed-out attempt that never persisted a session handle", async () => {
    const f = bridgeFixture();
    f.behavior.handle = null;
    const task = await timedOutRound(f);
    const before = snapshot(f.first.cp, task.task_id);
    f.behavior.mode = "ok";
    await expect(f.first.orchestrator.resumeDelegatedTask(timeoutRequest(task.task_id)))
      .rejects.toMatchObject({ code: ErrorCode.INVALID_ARGUMENT });
    expect(snapshot(f.first.cp, task.task_id)).toEqual(before);
    expect(f.seen).toHaveLength(1);
  });

  it("keeps FAILED terminal when the failure was not the bridge deadline", async () => {
    const crashed = bridgeFixture();
    crashed.behavior.mode = "fail";
    const failed = await crashed.first.flow.run({ feature_id: FEATURE, manager: "codex", idempotency_key: "r1",
      spec: roundSpec, input_artifacts: [], deadline_ms: 5_000 });
    expect(failed.task.state).toBe(TaskState.FAILED);
    expect(crashed.first.cp.attempts.get(failed.task.task_id, 0)?.execution_handle).toBe(HANDLE);
    const before = snapshot(crashed.first.cp, failed.task.task_id);
    crashed.behavior.mode = "ok";
    await expect(crashed.first.orchestrator.resumeDelegatedTask(timeoutRequest(failed.task.task_id)))
      .rejects.toMatchObject({ code: ErrorCode.ILLEGAL_TRANSITION });
    expect(snapshot(crashed.first.cp, failed.task.task_id)).toEqual(before);
    expect(crashed.seen).toHaveLength(1);

    // A later recovery timed out (task BLOCKED, outcome TIMEOUT) and the owner then chose
    // FAILED itself. The last attempt says TIMEOUT, but the terminal decision was not it.
    const manual = bridgeFixture();
    const task = await timedOutRound(manual);
    const recovery = await manual.first.orchestrator.resumeDelegatedTask(timeoutRequest(task.task_id, { deadline_ms: 1_000 }));
    expect(recovery.error).toMatchObject({ code: ErrorCode.TIMEOUT });
    expect(recovery.state).toBe(TaskState.BLOCKED);
    manual.first.cp.tasks.transition({ task_id: task.task_id, agent: "claude", to: TaskState.FAILED, reason: "owner gave up" });
    const manualBefore = snapshot(manual.first.cp, task.task_id);
    expect(manualBefore.attempts.at(-1)?.outcome).toBe(ErrorCode.TIMEOUT);
    expect(manualBefore.task.state).toBe(TaskState.FAILED);
    await expect(manual.first.orchestrator.resumeDelegatedTask(timeoutRequest(task.task_id, { idempotency_key: "second" })))
      .rejects.toMatchObject({ code: ErrorCode.ILLEGAL_TRANSITION });
    expect(snapshot(manual.first.cp, task.task_id)).toEqual(manualBefore);
  });

  it("rejects callers that are not the feature's direct manager", async () => {
    const f = bridgeFixture();
    const task = await timedOutRound(f);
    const before = snapshot(f.first.cp, task.task_id);
    f.behavior.mode = "ok";
    for (const requested_by of ["supervisor", "claude"]) {
      await expect(f.first.orchestrator.resumeDelegatedTask(timeoutRequest(task.task_id, { requested_by })))
        .rejects.toMatchObject({ code: ErrorCode.NOT_OWNER });
    }
    // Direct owner recovery can never reopen a terminal timeout.
    await expect(f.first.orchestrator.resumeTask({ ...timeoutRequest(task.task_id), requested_by: "claude" } as never))
      .rejects.toMatchObject({ code: ErrorCode.INVALID_ARGUMENT });
    // Feature binding is checked in addition to parent lineage.
    const feature = f.first.flow.get(FEATURE, "codex");
    f.first.cp.store.putFeature({ ...feature, manager: "codex-other" });
    await expect(f.first.orchestrator.resumeDelegatedTask(timeoutRequest(task.task_id)))
      .rejects.toMatchObject({ code: ErrorCode.NOT_OWNER });
    expect(snapshot(f.first.cp, task.task_id)).toEqual(before);
    expect(f.seen).toHaveLength(1);
  });

  it("rejects a FAILED task whose timed-out attempt is still open", async () => {
    const f = bridgeFixture();
    const { cp } = f.first;
    const child = cp.tasks.create({ spec: roundSpec, created_by: "codex", parent_task_id: f.root.task_id });
    cp.tasks.claim(child.task_id, "claude");
    cp.tasks.transition({ task_id: child.task_id, agent: "claude", to: TaskState.WORKING });
    cp.attempts.start(child.task_id, 0, "claude");
    cp.attempts.saveHandle(child.task_id, 0, "claude", HANDLE);
    cp.tasks.transition({ task_id: child.task_id, agent: "claude", to: TaskState.FAILED,
      reason: "TIMEOUT: adapter 'claude' exceeded its 20ms deadline" });
    const before = snapshot(cp, child.task_id);
    await expect(f.first.orchestrator.resumeDelegatedTask(timeoutRequest(child.task_id)))
      .rejects.toMatchObject({ code: ErrorCode.ILLEGAL_TRANSITION });
    expect(snapshot(cp, child.task_id)).toEqual(before);
    expect(cp.attempts.get(child.task_id, 0)?.ended_at).toBeUndefined();
    expect(f.seen).toHaveLength(0);
  });

  it.each([
    ["no deadline", { deadline_ms: undefined }],
    ["no idempotency key", { idempotency_key: undefined }],
    ["a deadline below one second", { deadline_ms: 999 }],
    ["a deadline above one day", { deadline_ms: 86_400_001 }],
    ["a fractional deadline", { deadline_ms: 1_500.5 }],
    ["a zero turn ceiling", { max_turns: 0 }],
    ["an unbounded turn ceiling", { max_turns: 100_000 }],
    ["a non-boolean opt-in", { recover_timeout: "yes" }],
  ])("validates the request before reserving anything: %s", async (_label, overrides) => {
    const f = bridgeFixture();
    const task = await timedOutRound(f);
    const before = snapshot(f.first.cp, task.task_id);
    await expect(f.first.orchestrator.resumeDelegatedTask(timeoutRequest(task.task_id, overrides)))
      .rejects.toMatchObject({ code: ErrorCode.INVALID_ARGUMENT });
    expect(snapshot(f.first.cp, task.task_id)).toEqual(before);
    expect(f.seen).toHaveLength(1);
  });

  it("does not use the timeout path for a BLOCKED task", async () => {
    const f = bridgeFixture();
    f.behavior.mode = "ok";
    const blocked = f.first.cp.tasks.create({ spec: roundSpec, created_by: "codex", parent_task_id: f.root.task_id });
    f.first.cp.tasks.claim(blocked.task_id, "claude");
    f.first.cp.tasks.transition({ task_id: blocked.task_id, agent: "claude", to: TaskState.WORKING });
    f.first.cp.attempts.start(blocked.task_id, 0, "claude");
    f.first.cp.attempts.saveHandle(blocked.task_id, 0, "claude", HANDLE);
    f.first.cp.tasks.block(blocked.task_id, "claude", "needs a decision");
    await expect(f.first.orchestrator.resumeDelegatedTask(timeoutRequest(blocked.task_id)))
      .rejects.toMatchObject({ code: ErrorCode.ILLEGAL_TRANSITION });
    expect(f.seen).toHaveLength(0);

    // Ordinary BLOCKED recovery may still extend its deadline explicitly.
    const outcome = await f.first.orchestrator.resumeDelegatedTask({
      task_id: blocked.task_id, requested_by: "codex", idempotency_key: "blocked-1", deadline_ms: 120_000,
    });
    expect(outcome).toMatchObject({ state: TaskState.DONE, recovery_mode: "stranded", deadline_ms: 120_000 });
    expect(f.seen[0]?.deadline_at).toBe(f.clock.now() + 120_000);
  });

  it.each([
    ["a different session", "session-replacement"],
    ["no session confirmation", null],
  ])("fails closed without a fresh session when strict resume reports %s", async (_label, resumedHandle) => {
    const f = bridgeFixture();
    const task = await timedOutRound(f);
    f.behavior.mode = "ok";
    f.behavior.resumedHandle = resumedHandle;
    const outcome = await f.first.orchestrator.resumeDelegatedTask(timeoutRequest(task.task_id));
    expect(outcome.error).toMatchObject({ code: ErrorCode.ADAPTER_FAILURE });
    expect(outcome.same_execution_handle).toBe(false);
    expect(outcome.state).toBe(TaskState.BLOCKED);
    expect(f.seen).toHaveLength(2);
    expect(f.seen[1]).toMatchObject({ resume_required: true, previous_execution_handle: HANDLE });
    expect(f.first.cp.attempts.get(task.task_id, 1)?.execution_handle).toBe(HANDLE);
    expect(f.first.cp.tasks.list()).toHaveLength(2);
    expect(f.first.cp.leases.listLive()).toHaveLength(0);
    expect(f.first.flow.get(FEATURE, "codex")).toMatchObject({ state: "blocked", task_ids: [task.task_id] });
  });

  it("keeps waiting_user authoritative: recording the answer launches nothing", async () => {
    const f = bridgeFixture();
    const task = await timedOutRound(f);
    f.behavior.mode = "ok";
    f.first.flow.waitUser(FEATURE, "codex", "q-01", "Extend the round to 75 minutes?");
    await expect(f.first.orchestrator.resumeDelegatedTask(timeoutRequest(task.task_id)))
      .rejects.toMatchObject({ code: ErrorCode.INVALID_ARGUMENT });
    expect(f.first.flow.answerUser(FEATURE, "codex", "q-01", "Yes, 75 minutes.").state).toBe("blocked");
    expect(f.seen).toHaveLength(1);
    expect(f.first.cp.tasks.get(task.task_id).state).toBe(TaskState.FAILED);
    const outcome = await f.first.orchestrator.resumeDelegatedTask(timeoutRequest(task.task_id));
    expect(outcome.state).toBe(TaskState.DONE);
    expect(f.seen).toHaveLength(2);
  });

  it("applies an explicit turn ceiling to the recovery attempt without rewriting the contract", async () => {
    const f = bridgeFixture();
    const task = await timedOutRound(f);
    f.behavior.mode = "ok";
    await f.first.orchestrator.resumeDelegatedTask(timeoutRequest(task.task_id, { max_turns: 160 }));
    expect(f.seen[1]?.spec.max_turns).toBe(160);
    expect(f.first.cp.tasks.get(task.task_id).spec).toEqual(task.spec);
    expect(f.first.cp.events({ task_id: task.task_id }).find((event) => event.type === EventType.RESUME_ATTEMPTED)?.payload)
      .toMatchObject({ deadline_ms: LONG_DEADLINE_MS, max_turns: 160 });
  });
});
