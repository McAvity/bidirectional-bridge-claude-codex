import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdapterHealth, DeliverableStatus, TaskState, type AgentAdapter, type TaskInvocation, type TaskSpec } from "@bridge/protocol";
import { ControlPlane } from "./control-plane.js";
import { Orchestrator } from "./orchestrator.js";
import { SqliteStateStore } from "./store/sqlite-store.js";
import { DatabaseSync } from "node:sqlite";
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
  return { ...env, dir, open, seen, behavior, request, parent };
}

const decision = {feature_id: "feature", manager: "codex", outcome: "rejected" as const,
  reason: "synthetic reason", decision_ref: "synthetic decision", idempotency_key: "close1"};

describe("feature closure", () => {
  it.each(["ready", "waiting_user", "awaiting_review", "blocked"])("closes %s and preserves all delivery history", async state => {
    const f = fixture();
    if (state === "awaiting_review" || state === "blocked") { f.behavior.partial = state === "blocked"; await f.flow.run(f.request); }
    if (state === "waiting_user") f.flow.waitUser("feature", "codex", "q1", "synthetic question");
    const before = f.flow.get("feature", "codex");
    const history = before.task_ids.map(id => ({task: f.cp.tasks.get(id), attempts: f.cp.attempts.list(id), delivery: f.cp.deliverables.get(id)}));
    const result = f.flow.close({...decision, outcome: "cancelled"});
    expect(result.feature.state).toBe("cancelled");
    expect(result.feature.question).toEqual(before.question);
    expect(result.feature.task_ids.map(id => ({task: f.cp.tasks.get(id), attempts: f.cp.attempts.list(id), delivery: f.cp.deliverables.get(id)}))).toEqual(history);
    expect(f.cp.tasks.get(f.parent.task_id).state).toBe(TaskState.CANCELLED);
    expect(f.open().flow.get("feature", "codex")).toEqual(result.feature);
  });

  it.each([TaskState.CLAIMED, TaskState.WORKING, TaskState.BLOCKED, TaskState.VERIFYING, TaskState.DONE, TaskState.FAILED, TaskState.CANCELLED])("truthful parent effect for %s", state => {
    const f = fixture(); const parent = f.cp.tasks.get(f.parent.task_id);
    f.cp.store.updateTask({...parent, state, version: parent.version + 1});
    const before = f.cp.tasks.get(parent.task_id);
    const terminal = [TaskState.DONE, TaskState.FAILED, TaskState.CANCELLED].includes(state as never);
    expect(f.flow.close(decision).feature.closure?.coordinator_effect).toBe(terminal ? "terminal_preserved" : "cancelled");
    if (terminal) expect(f.cp.tasks.get(parent.task_id)).toEqual(before);
    else expect(f.cp.tasks.get(parent.task_id).state).toBe(TaskState.CANCELLED);
  });

  it("preserves a shared parent while closing only one feature", () => {
    const f = fixture(); f.flow.create("shared", "codex", f.parent.task_id);
    const before = f.cp.tasks.get(f.parent.task_id);
    expect(f.flow.close(decision).feature.closure?.coordinator_effect).toBe("shared_preserved");
    expect(f.cp.tasks.get(f.parent.task_id)).toEqual(before);
    expect(f.cp.tasks.create({spec, created_by: "codex", parent_task_id: f.parent.task_id}).task_id).toBeTruthy();
  });

  it("replay after restart and new slot never reacquires or releases that slot", async () => {
    const f = fixture(); await f.flow.run(f.request);
    f.cp.store.putManagerBinding!({epoch: 1, native_thread_id: "synthetic", active_instance_id: "instance", instance_generation: 1, active_feature_id: "feature", updated_at: 1});
    const first = f.flow.close(decision);
    expect(f.cp.store.getManagerBinding!()?.active_feature_id).toBeNull();
    const parent = f.cp.tasks.create({spec, created_by: "codex"}); f.cp.tasks.claim(parent.task_id, "codex");
    f.flow.create("next", "codex", parent.task_id);
    f.cp.store.putManagerBinding!({...f.cp.store.getManagerBinding!()!, active_feature_id: "next"});
    await f.flow.run({...f.request, feature_id: "next", idempotency_key: "next1"});
    const restarted = f.open();
    for (const key of ["close1", "close2"]) expect(restarted.flow.close({...decision, idempotency_key: key})).toEqual({...first, replayed: true});
    expect(f.cp.store.getManagerBinding!()?.active_feature_id).toBe("next");
    expect(f.flow.create("feature", "codex", f.parent.task_id).state).toBe("rejected");
    expect(f.seen).toHaveLength(2);
    expect(() => f.flow.close({...decision, reason: "changed"})).toThrowError(expect.objectContaining({code: "IDEMPOTENCY_MISMATCH"}));
    expect(() => f.flow.close({...decision, idempotency_key: "other", outcome: "cancelled"})).toThrowError(expect.objectContaining({code: "FEATURE_CLOSED"}));
  });

  it.each(["putFeature", "putIdempotency", "putManagerBinding"] as const)("rolls back all effects when %s fails", method => {
    const f = fixture(); f.cp.store.putManagerBinding!({epoch: 1, native_thread_id: "synthetic", active_instance_id: "instance", instance_generation: 1, active_feature_id: "feature", updated_at: 1});
    const before = {feature: f.cp.store.getFeature("feature"), task: f.cp.tasks.get(f.parent.task_id), binding: f.cp.store.getManagerBinding!(), events: f.cp.store.readEvents()};
    const spy = vi.spyOn(f.cp.store, method).mockImplementationOnce(() => {throw Error("fault");});
    expect(() => f.flow.close(decision)).toThrow("fault"); spy.mockRestore();
    expect({feature: f.cp.store.getFeature("feature"), task: f.cp.tasks.get(f.parent.task_id), binding: f.cp.store.getManagerBinding!(), events: f.cp.store.readEvents()}).toEqual(before);
    expect(f.flow.close(decision).replayed).toBe(false);
  });

  it("refuses active run and recovery, then closes after both settle", async () => {
    const f = fixture(); let release!: () => void;
    f.behavior.gate = new Promise<void>(r => { release = r; }); f.behavior.partial = true;
    const running = f.flow.run(f.request);
    expect(() => f.open().flow.close(decision)).toThrowError(expect.objectContaining({code: "FEATURE_BUSY"}));
    release(); const first = await running;
    f.behavior.gate = new Promise<void>(r => { release = r; }); f.behavior.partial = false;
    const recovery = f.orchestrator.resumeDelegatedTask({task_id: first.task.task_id, requested_by: "codex", idempotency_key: "resume", message: "synthetic clarification"});
    expect(() => f.open().flow.close(decision)).toThrowError(expect.objectContaining({code: "FEATURE_BUSY"}));
    release(); await recovery;
    f.flow.close(decision);
    await expect(f.orchestrator.resumeDelegatedTask({task_id: first.task.task_id, requested_by: "codex", idempotency_key: "resume", message: "synthetic clarification"})).rejects.toMatchObject({code: "FEATURE_CLOSED"});
  });

  it("close winning reservation prevents run/delegation/recovery before adapter", async () => {
    const f = fixture(); const round = await f.flow.run(f.request); f.flow.close(decision);
    await expect(f.flow.run(f.request)).rejects.toMatchObject({code: "FEATURE_CLOSED"});
    await expect(f.orchestrator.delegate({from: "codex", to: "claude", spec, input_artifacts: [], parent_task_id: f.parent.task_id, deadline_ms: 1000})).rejects.toMatchObject({code: "FEATURE_CLOSED"});
    await expect(f.orchestrator.resumeTask({task_id: round.task.task_id, requested_by: "claude", idempotency_key: "x"})).rejects.toMatchObject({code: "FEATURE_CLOSED"});
    expect(f.seen).toHaveLength(1);
  });

  it("expired HELD lease, unstarted reservation and open attempt refuse without effects", () => {
    const f = fixture(); const before = f.cp.store.getFeature("feature");
    const lease = f.cp.leases.acquire({task_id: f.parent.task_id, holder: "codex", scope: {paths:["manager/**"]}, ttl_ms: 1});
    f.cp.store.updateLease({...lease, expires_at: 0});
    expect(() => f.flow.close(decision)).toThrowError(expect.objectContaining({code:"FEATURE_BUSY"}));
    f.cp.leases.release(lease.lease_id, "codex");
    const child = f.cp.tasks.create({spec, created_by: "codex", parent_task_id: f.parent.task_id});
    expect(() => f.flow.close(decision)).toThrowError(expect.objectContaining({code:"FEATURE_BUSY"}));
    expect(f.cp.store.getFeature("feature")).toEqual(before);
    expect(f.cp.tasks.get(child.task_id).state).toBe(TaskState.PENDING);
  });

  it("freezes every task mutation and historical question, preserves reads", async () => {
    const f = fixture(); const first = await f.flow.run(f.request); const id = first.task.task_id;
    f.flow.waitUser("feature", "codex", "q", "synthetic");
    const lease = f.cp.leases.acquire({task_id:id, holder:"claude", scope: spec.scope, ttl_ms:1000}); f.cp.leases.release(lease.lease_id,"claude");
    f.flow.close(decision);
    const calls = [
      () => f.flow.answerUser("feature","codex","q","answer"), () => f.flow.accept("feature","codex"),
      () => f.flow.waitUser("feature","codex","q","synthetic"),
      () => f.cp.tasks.claim(id,"claude"), () => f.cp.tasks.release(id,"claude","reason"),
      () => f.cp.tasks.transition({task_id:id,agent:"claude",to:TaskState.DONE}),
      () => f.cp.tasks.block(id,"claude","reason"), () => f.cp.tasks.unblock(id,"claude","reason"),
      () => f.cp.tasks.retry(id,"codex",3), () => f.cp.tasks.addDependency(id,f.parent.task_id,"claude"),
      () => f.cp.tasks.reportStatus({task_id:id,agent:"claude",summary:"late",progress:1,at:Date.now()} as never),
      () => f.cp.leases.acquire({task_id:id,holder:"claude",scope:spec.scope,ttl_ms:1000}),
      () => f.cp.leases.renew(lease.lease_id,"claude",1000), () => f.cp.leases.assertWritable(lease.lease_id,"claude","feature/a"),
      () => f.cp.attempts.saveHandle(id,0,"claude","late-session"), () => f.cp.attempts.end(id,0,"claude","late"),
      () => f.cp.artifacts.publish({task_id:id,produced_by:"claude",kind:"file",name:"late",path:"missing-file"} as never),
      () => f.cp.deliverables.recordVerification(id,"claude",first.deliverable!.verification_results[0]!),
      () => f.cp.deliverables.submit(first.deliverable!),
    ];
    const before = {feature:f.cp.store.getFeature("feature"),task:f.cp.tasks.get(id),attempts:f.cp.attempts.list(id),events:f.cp.store.readEvents()};
    for (const call of calls) expect(call).toThrowError(expect.objectContaining({code:"FEATURE_CLOSED"}));
    expect({feature:f.cp.store.getFeature("feature"),task:f.cp.tasks.get(id),attempts:f.cp.attempts.list(id),events:f.cp.store.readEvents()}).toEqual(before);
    expect(f.flow.get("feature","codex").state).toBe("rejected");
  });
});


describe("schema6 forward guard", () => {
  it.each(["initialize", "attach", "readonly"] as const)("%s refuses future schema before mutation", mode => {
    const f = fixture();
    const db = new DatabaseSync(join(f.dir, "bridge.db"));
    db.exec("UPDATE schema_meta SET value='7' WHERE key='schema_version'");
    const before = db.prepare("SELECT * FROM schema_meta").all();
    expect(() => new SqliteStateStore({path:join(f.dir,"bridge.db"),mode})).toThrowError(expect.objectContaining({code:"WORKSPACE_MISMATCH"}));
    expect(db.prepare("SELECT * FROM schema_meta").all()).toEqual(before);
    expect(() => (f.cp.store as SqliteStateStore).initializeSchema()).toThrowError(expect.objectContaining({code:"WORKSPACE_MISMATCH"}));
    db.close();
  });
});

describe("closure refusals and historical failed work", () => {
  it("closes an ended TIMEOUT without recovering or rewriting the failed task", async () => {
    const f=fixture(); const round=await f.flow.run(f.request);
    const task=f.cp.tasks.get(round.task.task_id);
    f.cp.store.updateTask({...task,state:TaskState.FAILED,version:task.version+1});
    const attempt=f.cp.attempts.list(task.task_id)[0]!;
    f.cp.store.upsertAttempt({...attempt,outcome:"TIMEOUT"});
    const before=f.cp.tasks.get(task.task_id);
    expect(f.flow.close({...decision,outcome:"cancelled"}).feature.state).toBe("cancelled");
    expect(f.cp.tasks.get(task.task_id)).toEqual(before); expect(f.seen).toHaveLength(1);
  });
  it("refuses another slot, wrong owner, accepted and inconsistent task references", async () => {
    const f=fixture();
    expect(()=>f.flow.close({...decision,manager:"claude"})).toThrow();
    f.cp.store.putManagerBinding!({epoch:1,native_thread_id:"synthetic",active_instance_id:"instance",instance_generation:1,active_feature_id:"another",updated_at:1});
    expect(()=>f.flow.close(decision)).toThrowError(expect.objectContaining({code:"FEATURE_CONFLICT"}));
    f.cp.store.putManagerBinding!({...f.cp.store.getManagerBinding!()!,active_feature_id:null});
    const feature=f.cp.store.getFeature("feature")!;
    f.cp.store.putFeature({...feature,task_ids:["missing"],latest_task_id:"missing"});
    expect(()=>f.flow.close(decision)).toThrowError(expect.objectContaining({code:"FEATURE_UNSETTLED"}));
    f.cp.store.putFeature(feature);
    await f.flow.run(f.request); f.flow.accept("feature","codex");
    expect(()=>f.flow.close(decision)).toThrowError(expect.objectContaining({code:"FEATURE_CLOSED"}));
  });
  it("validates required decision fields without touching domain records", () => {
    const f=fixture(); const before=f.cp.store.getFeature("feature");
    for(const invalid of [{reason:" "},{reason:"x".repeat(4001)},{decision_ref:""},{idempotency_key:""},{outcome:"accepted"}])
      expect(()=>f.flow.close({...decision,...invalid} as typeof decision)).toThrowError(expect.objectContaining({code:"INVALID_ARGUMENT"}));
    expect(f.cp.store.getFeature("feature")).toEqual(before);
  });
});
