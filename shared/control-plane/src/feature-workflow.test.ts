import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AdapterHealth, DeliverableStatus, TaskState, type AgentAdapter, type TaskInvocation, type TaskSpec } from "@bridge/protocol";
import { ControlPlane } from "./control-plane.js";
import { Orchestrator } from "./orchestrator.js";
import { FeatureWorkflow } from "./feature-workflow.js";

const spec: TaskSpec = { objective: "deliver a package", scope: { paths: ["feature/**"] }, dependencies: [], expected_deliverable: "package", verification_criteria: ["test passes"] };
const cleanup: (() => void)[] = [];
afterEach(() => { for (const f of cleanup.splice(0).reverse()) f(); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "bridge-feature-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const seen: TaskInvocation[] = [];
  const behavior = { gate: undefined as Promise<void> | undefined, handle: "session-original" as string | null, partial: false };
  const adapter: AgentAdapter = {
    info: { agent: "claude", implementation: "fixture", version: "1", capabilities: ["resume"], max_concurrency: 1 },
    async health() { return { status: AdapterHealth.READY, checked_at: Date.now() }; },
    async cancel() {},
    async invoke(i, ctx) {
      seen.push(i);
      if (behavior.handle) await ctx.saveExecutionHandle(behavior.handle);
      if (behavior.gate) await behavior.gate;
      const v = { kind: "test" as const, command: "fixture test", passed: true, exit_code: 0, summary: "pass" };
      return { task_id: i.task_id, agent: "claude", status: behavior.partial ? DeliverableStatus.PARTIAL : DeliverableStatus.COMPLETE,
        summary: "package", changed_scope: [], artifacts: [], commit_or_diff: null, verification_performed: [v.command],
        verification_results: [v], remaining_risks: behavior.partial ? ["need user input"] : [], dependencies_unblocked: [], recommended_next_action: "review", at: Date.now() };
    },
  };
  function open() {
    const cp = ControlPlane.open({ databasePath: join(dir, "bridge.db"), workspaceRoot: dir });
    cp.adapters.register(adapter);
    cleanup.push(() => cp.close());
    const orchestrator = new Orchestrator(cp);
    return { cp, orchestrator, flow: new FeatureWorkflow(cp, orchestrator) };
  }
  const env = open();
  const parent = env.cp.tasks.create({ spec: { ...spec, scope: { paths: ["manager/**"] } }, created_by: "codex" });
  env.cp.tasks.claim(parent.task_id, "codex");
  env.flow.create("feature", "codex", parent.task_id);
  const request = { feature_id: "feature", manager: "codex", spec, input_artifacts: [], deadline_ms: 5000, idempotency_key: "round1" };
  return { ...env, open, seen, behavior, request, parent };
}

describe("feature workflows", () => {
  it("creates a new task after DONE, resumes the session after reopening SQLite, and replays without a worker", async () => {
    const f = fixture();
    const first = await f.flow.run(f.request);
    expect(first.task.state).toBe(TaskState.DONE);
    const next = f.open();
    const second = await next.flow.run({ ...f.request, idempotency_key: "round2" });
    expect(second.task.task_id).not.toBe(first.task.task_id);
    expect(second.task.parent_task_id).toBe(first.task.parent_task_id);
    expect(f.seen[1]?.resume_required).toBe(true);
    expect(f.seen[1]?.previous_execution_handle).toBe("session-original");
    expect(next.cp.tasks.get(first.task.task_id).state).toBe(TaskState.DONE);
    expect((await next.flow.run(f.request)).replayed).toBe(true);
    expect(f.seen).toHaveLength(2);
    await expect(next.flow.run({ ...f.request, deadline_ms: 6000 })).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
  });

  it("persists a user question, blocks launch and recovery, and records an answer without invoking Claude", async () => {
    const f = fixture(); f.behavior.partial = true;
    const first = await f.flow.run(f.request);
    expect(first.task.state).toBe(TaskState.BLOCKED);
    f.flow.waitUser("feature", "codex", "q1", "Which option?");
    const next = f.open();
    expect(next.flow.get("feature", "codex").state).toBe("waiting_user");
    await expect(next.flow.run({ ...f.request, idempotency_key: "round2" })).rejects.toThrow();
    await expect(next.orchestrator.resumeDelegatedTask({ task_id: first.task.task_id, requested_by: "codex", idempotency_key: "resume1", message: "B" })).rejects.toThrow();
    expect(() => next.flow.answerUser("feature", "codex", "stale", "B")).toThrow();
    next.flow.answerUser("feature", "codex", "q1", "B");
    next.flow.answerUser("feature", "codex", "q1", "B");
    expect(() => next.flow.answerUser("feature", "codex", "q1", "A")).toThrow();
    expect(f.seen).toHaveLength(1);
    f.behavior.partial = false;
    await next.orchestrator.resumeDelegatedTask({ task_id: first.task.task_id, requested_by: "codex", idempotency_key: "resume1", message: "User chose B" });
    expect(next.flow.get("feature", "codex").state).toBe("awaiting_review");
    expect(f.seen).toHaveLength(2);
  });

  it("never forwards user questions or answers to Claude and requires explicit acceptance", async () => {
    const f = fixture(); await f.flow.run(f.request);
    f.flow.waitUser("feature", "codex", "q", "A or B? (addressed to the user)");
    f.flow.answerUser("feature", "codex", "q", "B");
    expect(f.seen).toHaveLength(1);
    await f.flow.run({ ...f.request, idempotency_key: "round2" });
    const contract = { ...spec, objective: `${spec.objective}\nManager decision from q: use B.` };
    await f.flow.run({ ...f.request, idempotency_key: "round3", spec: contract });
    for (const invocation of f.seen) {
      expect(invocation.spec.objective).not.toContain("addressed to the user");
      expect(invocation.spec.objective).not.toContain("Answer:");
    }
    expect(f.seen[1]?.spec.objective).toBe(spec.objective);
    expect(f.seen[2]?.spec.objective).toBe(contract.objective);
    expect(f.flow.get("feature", "codex").question?.answer).toBe("B");
    expect(f.flow.get("feature", "codex").state).toBe("awaiting_review");
    expect(f.flow.accept("feature", "codex").state).toBe("accepted");
    await expect(f.flow.run({ ...f.request, idempotency_key: "round4" })).rejects.toThrow();
  });

  it("reports a BLOCKED round as running while its recovery attempt executes", async () => {
    const f = fixture(); f.behavior.partial = true;
    const first = await f.flow.run(f.request);
    expect(f.flow.get("feature", "codex").state).toBe("blocked");
    f.behavior.partial = false;
    let release!: () => void;
    f.behavior.gate = new Promise<void>(resolve => { release = resolve; });
    const recovery = f.orchestrator.resumeDelegatedTask({ task_id: first.task.task_id, requested_by: "codex", idempotency_key: "resume1", message: "Use B" });
    try {
      await new Promise(resolve => setTimeout(resolve, 20));
      const during = f.open().flow.get("feature", "codex");
      expect(during.state).toBe("running");
      expect(during.active_task_id).toBe(first.task.task_id);
      expect(() => f.flow.waitUser("feature", "codex", "q", "Choice?")).toThrow();
    } finally { release(); await recovery; }
    const after = f.flow.get("feature", "codex");
    expect(after.state).toBe("awaiting_review");
    expect(after.active_task_id).toBeNull();
  });

  it("serializes one session across disjoint scopes and two database connections", async () => {
    const f = fixture(); let release!: () => void;
    f.behavior.gate = new Promise<void>(resolve => { release = resolve; });
    const running = f.flow.run(f.request);
    const other = f.open();
    try {
      expect((await other.flow.run(f.request)).replayed).toBe(true);
      await expect(other.flow.run({ ...f.request, idempotency_key: "round2", spec: { ...spec, scope: { paths: ["elsewhere/**"] } } })).rejects.toThrow();
      expect(() => other.flow.waitUser("feature", "codex", "q", "Choice?")).toThrow();
      expect(other.cp.tasks.list()).toHaveLength(2);
      expect(f.seen).toHaveLength(1);
    } finally { release(); await running; }
  });

  it.each(["different-session", null])("fails closed when strict resume reports %s", async handle => {
    const f = fixture(); await f.flow.run(f.request); f.behavior.handle = handle;
    const second = await f.flow.run({ ...f.request, idempotency_key: "round2" });
    expect(second.task.state).toBe(TaskState.FAILED);
    expect(second.feature.state).toBe("blocked");
    expect(f.cp.attempts.list(second.task.task_id)[0]?.execution_handle).toBe("session-original");
    expect(f.seen).toHaveLength(2);
  });

  it("rolls back task and reservation when inputs cannot be resolved", async () => {
    const f = fixture();
    await expect(f.flow.run({ ...f.request, input_artifacts: ["artifact_missing"] })).rejects.toThrow();
    expect(f.cp.tasks.list()).toHaveLength(1);
    expect(f.flow.get("feature", "codex").state).toBe("ready");
    expect(f.seen).toHaveLength(0);
    expect((await f.flow.run(f.request)).task.state).toBe(TaskState.DONE);
  });

  it("does not clear a stranded reservation just because time passes", async () => {
    const f = fixture();
    const task = f.cp.tasks.create({ spec, created_by: "codex", parent_task_id: f.parent.task_id });
    const record = f.flow.get("feature", "codex");
    f.cp.store.putFeature({ ...record, state: "running", latest_task_id: task.task_id,
      active_task_id: task.task_id, task_ids: [task.task_id], updated_at: 1 });
    const next = f.open();
    expect(next.flow.get("feature", "codex").state).toBe("running");
    await expect(next.flow.run(f.request)).rejects.toThrow();
    expect(f.seen).toHaveLength(0);
  });

  it("replaying an old question never replaces a newer question", () => {
    const f = fixture();
    f.flow.waitUser("feature", "codex", "q1", "First?");
    f.flow.answerUser("feature", "codex", "q1", "Yes");
    f.flow.waitUser("feature", "codex", "q2", "Second?");
    expect(f.flow.waitUser("feature", "codex", "q1", "First?").question?.id).toBe("q2");
    expect(() => f.flow.waitUser("feature", "codex", "q1", "Changed?")).toThrow();
  });

  it("rejects foreign managers and missing handles without creating another task", async () => {
    const f = fixture();
    expect(() => f.flow.get("feature", "claude")).toThrow();
    f.behavior.handle = null; await f.flow.run(f.request);
    await expect(f.flow.run({ ...f.request, idempotency_key: "round2" })).rejects.toThrow(/persisted session/);
    expect(f.cp.tasks.list()).toHaveLength(2);
  });
});
