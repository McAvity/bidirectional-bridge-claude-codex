/**
 * Deterministic regressions for the guard defects found in review 09.
 *
 * Each test pins one reproduced behaviour: no reconcile before authority (R09-01), authorized
 * replay without reservation (R09-02), no filesystem repair before a handoff CAS (R09-03), the
 * feature slot on every mutating touch (R09-04), no schema migration left by a failed first
 * operation on a historical database (R09-05), the critical section released at the reservation
 * boundary (R09-06), and a two-worktree `waiting_user` restart resuming the exact worker session
 * (R09-07).
 *
 * Adapters and host envelopes are synthetic fixtures; nothing here is a live pilot.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SqliteStateStore,
  WorktreeCriticalSection,
  resolveDatabasePath,
  resolveWorkspaceIdentity,
  stateDirectory,
  type WorkspaceIdentity,
} from "@bridge/control-plane";
import {
  AdapterHealth,
  DeliverableStatus,
  type AgentAdapter,
  type TaskInvocation,
  type TaskSpec,
} from "@bridge/protocol";
import { BridgeMcpServer } from "./server.js";
import { TOOLS, runTool } from "./tools.js";

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.splice(0).reverse()) fn();
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
}

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@e",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@e",
};

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore", env: GIT_ENV });
}

function repo(): { a: WorkspaceIdentity; b: WorkspaceIdentity } {
  const base = tempDir("bridge-rec-");
  const main = join(base, "main");
  mkdirSync(main);
  git(main, "init", "-q", "-b", "main");
  writeFileSync(join(main, "f.txt"), "x\n");
  git(main, "add", ".");
  git(main, "commit", "-qm", "init");
  const second = join(base, "second");
  git(main, "worktree", "add", "-q", "-b", "feature", second);
  return { a: resolveWorkspaceIdentity(main), b: resolveWorkspaceIdentity(second) };
}

function meta(thread: string): Record<string, unknown> {
  return {
    threadId: thread,
    "x-codex-turn-metadata": { session_id: thread, thread_id: thread, codex_version: "0.154.0" },
  };
}

const spec: TaskSpec = {
  objective: "work",
  scope: { paths: ["src/**"] },
  dependencies: [],
  expected_deliverable: "result",
  verification_criteria: ["npm test"],
};

/** Fixture worker; records every invocation so resume behaviour can be asserted. */
function recordingAdapter(handle = "fixture-session"): {
  adapter: AgentAdapter;
  seen: TaskInvocation[];
  gate: { open: () => void; started: Promise<void>; hold: boolean };
} {
  const seen: TaskInvocation[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let announce!: () => void;
  const started = new Promise<void>((resolve) => (announce = resolve));
  const control = { open: release, started, hold: false };
  const adapter: AgentAdapter = {
    info: { agent: "claude", implementation: "fixture", version: "1", capabilities: ["resume"], max_concurrency: 1 },
    async health() {
      return { status: AdapterHealth.READY, checked_at: Date.now() };
    },
    async cancel() {},
    async invoke(invocation, ctx) {
      seen.push(invocation);
      await ctx.saveExecutionHandle(handle);
      announce();
      if (control.hold) await gate;
      const check = { kind: "test" as const, command: "fixture", passed: true, exit_code: 0, summary: "ok" };
      return {
        task_id: invocation.task_id,
        agent: "claude",
        status: DeliverableStatus.COMPLETE,
        summary: "done",
        changed_scope: [],
        artifacts: [],
        commit_or_diff: null,
        verification_performed: [check.command],
        verification_results: [check],
        remaining_risks: [],
        dependencies_unblocked: [],
        recommended_next_action: "review",
        at: Date.now(),
      };
    },
  };
  return { adapter, seen, gate: control };
}

function server(identity: WorkspaceIdentity, adapters: AgentAdapter[] = []): BridgeMcpServer {
  const instance = new BridgeMcpServer({
    workspaceRoot: identity.root,
    workspace: identity,
    agent: "codex",
    delegationPolicy: "allow",
    adapters,
    serverName: "identity-recovery-test",
  });
  cleanup.push(() => void instance.close());
  return instance;
}

async function call(
  instance: BridgeMcpServer,
  name: string,
  args: Record<string, unknown> = {},
  nativeMeta?: unknown,
): Promise<{ isError: boolean; data: Record<string, unknown> }> {
  const tool = TOOLS.find((candidate) => candidate.name === name)!;
  const ctx = (instance as unknown as { ctx: Parameters<typeof runTool>[2] }).ctx;
  const result = await runTool(tool, args, ctx, nativeMeta);
  return { isError: result.isError === true, data: JSON.parse(result.content[0]!.text) as Record<string, unknown> };
}

async function feature(
  codex: BridgeMcpServer,
  thread: string,
  id = "F-rec",
): Promise<string> {
  const parent = (await call(codex, "bridge_create_task", { spec }, meta(thread))).data["task_id"] as string;
  await call(codex, "bridge_claim_task", { task_id: parent }, meta(thread));
  const made = await call(codex, "bridge_feature_create", { feature_id: id, parent_task_id: parent }, meta(thread));
  expect(made.isError).toBe(false);
  return id;
}

function readState(database: string): { events: number; featureJson: string } {
  const store = new SqliteStateStore({ path: database, mode: "readonly" });
  const events = store.lastEventId();
  const featureJson = JSON.stringify(store.listFeatures());
  store.close();
  return { events, featureJson };
}

describe("no state change before the authority decision (R09-01)", () => {
  it("does not reconcile a feature for a foreign caller's round attempt", async () => {
    const { a } = repo();
    const database = resolveDatabasePath(a);
    const fixture = recordingAdapter();
    const owner = server(a, [fixture.adapter]);
    const id = await feature(owner, "T1");
    await call(
      owner,
      "bridge_feature_run",
      { feature_id: id, spec, input_artifacts: [], deadline_ms: 10_000, idempotency_key: `${id}:round-1` },
      meta("T1"),
    );

    // The round finished, but nothing has reconciled the feature record yet.
    const before = readState(database);
    const intruder = server(a, [fixture.adapter]);
    const denied = await call(
      intruder,
      "bridge_feature_run",
      { feature_id: id, spec, input_artifacts: [], deadline_ms: 10_000, idempotency_key: `${id}:round-2` },
      meta("T9"),
    );
    expect(denied.isError).toBe(true);
    expect(readState(database)).toEqual(before);
    expect(fixture.seen).toHaveLength(1);
  }, 20_000);
});

describe("authorized replay without reservation (R09-02)", () => {
  it("replays a completed round for the owner and refuses it for a foreign caller", async () => {
    const { a } = repo();
    const fixture = recordingAdapter();
    const owner = server(a, [fixture.adapter]);
    const id = await feature(owner, "T1");
    const key = `${id}:round-1`;
    const first = await call(
      owner,
      "bridge_feature_run",
      { feature_id: id, spec, input_artifacts: [], deadline_ms: 10_000, idempotency_key: key },
      meta("T1"),
    );
    expect(first.isError).toBe(false);

    const replay = await call(
      owner,
      "bridge_feature_run",
      { feature_id: id, spec, input_artifacts: [], deadline_ms: 10_000, idempotency_key: key },
      meta("T1"),
    );
    expect(replay.isError).toBe(false);
    expect(replay.data["replayed"]).toBe(true);
    expect((replay.data["task"] as { task_id: string }).task_id).toBe(
      (first.data["task"] as { task_id: string }).task_id,
    );
    // The replay launched nothing.
    expect(fixture.seen).toHaveLength(1);

    const intruder = server(a, [fixture.adapter]);
    const foreign = await call(
      intruder,
      "bridge_feature_run",
      { feature_id: id, spec, input_artifacts: [], deadline_ms: 10_000, idempotency_key: key },
      meta("T9"),
    );
    expect(foreign.isError).toBe(true);
    expect((foreign.data["error"] as { code: string }).code).toBe("MANAGER_FOREIGN_THREAD");
    expect(fixture.seen).toHaveLength(1);
  }, 20_000);
});

describe("handoff and takeover never repair before their CAS (R09-03)", () => {
  it("refuses a foreign handoff without recreating the owner file", async () => {
    const { a } = repo();
    const database = resolveDatabasePath(a);
    const owner = server(a);
    await call(owner, "bridge_create_task", { spec }, meta("T1"));

    // Interrupted publication: the owner record is missing.
    unlinkSync(`${database}.owner`);
    const intruder = server(a);
    const denied = await call(
      intruder,
      "bridge_manager_resume_instance",
      { expected_epoch: 1, expected_generation: 1 },
      meta("FOREIGN"),
    );
    expect(denied.isError).toBe(true);
    expect(existsSync(`${database}.owner`)).toBe(false);

    // A stale takeover is refused the same way.
    const staleTakeover = await call(
      intruder,
      "bridge_manager_takeover",
      { expected_thread_id: "T1", expected_epoch: 99, reason: "stale" },
      meta("T2"),
    );
    expect(staleTakeover.isError).toBe(true);
    expect(existsSync(`${database}.owner`)).toBe(false);

    // The owning manager's authorized mutation repairs it.
    await call(owner, "bridge_create_task", { spec }, meta("T1"));
    expect(existsSync(`${database}.owner`)).toBe(true);
  });
});

describe("feature slot on every mutating touch (R09-04)", () => {
  it("refuses a second feature's question, answer and accept while another is active", async () => {
    const { a } = repo();
    const database = resolveDatabasePath(a);
    const codex = server(a);
    await feature(codex, "T1", "F-one");
    const parent = (await call(codex, "bridge_create_task", { spec }, meta("T1"))).data["task_id"] as string;
    await call(codex, "bridge_claim_task", { task_id: parent }, meta("T1"));

    const before = readState(database);
    for (const [tool, args] of [
      ["bridge_feature_create", { feature_id: "F-two", parent_task_id: parent }],
      ["bridge_feature_wait_user", { feature_id: "F-two", question_id: "q1", question: "why?" }],
      ["bridge_feature_answer_user", { feature_id: "F-two", question_id: "q1", answer: "because" }],
      ["bridge_feature_accept", { feature_id: "F-two" }],
    ] as const) {
      const denied = await call(codex, tool, args as Record<string, unknown>, meta("T1"));
      expect(denied.isError, `${tool} must be refused`).toBe(true);
      expect((denied.data["error"] as { code: string }).code).toBe("FEATURE_CONFLICT");
    }
    expect(readState(database)).toEqual(before);
  });
});

describe("historical schema and failed first operation (R09-05)", () => {
  it("leaves no migration behind when the first authorized operation fails", async () => {
    const { a } = repo();
    const database = resolveDatabasePath(a);
    mkdirSync(stateDirectory(a), { recursive: true });

    // A historical database: pre-isolation tables only, with history and schema_version 4.
    const legacy = new SqliteStateStore({ path: database });
    legacy.appendEvent({ type: "task.created" as never, task_id: null, agent: "codex", payload: {} }, 1);
    const raw = legacy as unknown as { db: { exec(sql: string): void } };
    for (const table of ["workspace_binding", "manager_binding", "manager_epochs", "manager_instances"]) {
      raw.db.exec(`DROP TABLE ${table}`);
    }
    raw.db.exec("INSERT OR REPLACE INTO schema_meta(key, value) VALUES('schema_version', '4')");
    legacy.close();
    const beforeBytes = readFileSync(database).length;

    const adopting = new BridgeMcpServer({
      workspaceRoot: a.root,
      workspace: a,
      agent: "codex",
      delegationPolicy: "allow",
      adoptLegacy: { reason: "recovered from an older checkout" },
      serverName: "identity-recovery-test",
    });
    cleanup.push(() => void adopting.close());

    // The first authorized operation fails on its own arguments.
    const failed = await call(adopting, "bridge_claim_task", { task_id: "task_missing" }, meta("T1"));
    expect(failed.isError).toBe(true);

    const after = new SqliteStateStore({ path: database, mode: "readonly" });
    expect(after.schemaVersion()).toBe(4);
    expect(after.getWorkspaceBinding()).toBeUndefined();
    after.close();
    expect(readFileSync(database).length).toBe(beforeBytes);
    expect(existsSync(join(stateDirectory(a), "workspace.json"))).toBe(false);

    // A valid operation then adopts the database, recording provenance including row counts.
    const adopted = await call(adopting, "bridge_create_task", { spec }, meta("T1"));
    expect(adopted.isError).toBe(false);
    const status = await call(adopting, "bridge_manager_status");
    expect(status.data["legacy_adopted"]).toBe(true);
    const provenance = status.data["adoption"] as { reason: string; row_counts: Record<string, number> };
    expect(provenance.reason).toBe("recovered from an older checkout");
    expect(provenance.row_counts["events"]).toBeGreaterThan(0);
  });
});

describe("critical section lifecycle (R09-06)", () => {
  it("publishes and unlocks at the reservation boundary, not after the worker finishes", async () => {
    const { a } = repo();
    const database = resolveDatabasePath(a);
    const fixture = recordingAdapter();
    fixture.gate.hold = true;
    const owner = server(a, [fixture.adapter]);

    // First ownership is taken by an asynchronous operation.
    const delegation = call(
      owner,
      "bridge_delegate",
      { to: "claude", spec, deadline_ms: 10_000 },
      meta("T1"),
    );
    await fixture.gate.started;

    // While the worker runs: markers are already published and the lock is free.
    expect(JSON.parse(readFileSync(join(stateDirectory(a), "workspace.json"), "utf8"))["state"]).toBe("bound");
    expect(JSON.parse(readFileSync(`${database}.owner`, "utf8"))["state"]).toBe("bound");
    const section = WorktreeCriticalSection.acquire(a, 500);
    section.release();

    fixture.gate.open();
    const finished = await delegation;
    expect(finished.isError).toBe(false);
    expect((finished.data["deliverable"] as { status: string }).status).toBe("COMPLETE");
  }, 20_000);
});

describe("two worktrees, waiting_user restart, exact worker session (R09-07)", () => {
  it("resumes the same fixture session after a restart while the other pair keeps working", async () => {
    const { a, b } = repo();
    const fixtureA = recordingAdapter("session-A");
    const fixtureB = recordingAdapter("session-B");
    const pairA = server(a, [fixtureA.adapter]);
    const pairB = server(b, [fixtureB.adapter]);

    const idA = await feature(pairA, "T-A", "F-a");
    const idB = await feature(pairB, "T-B", "F-b");
    await call(
      pairA,
      "bridge_feature_run",
      { feature_id: idA, spec, input_artifacts: [], deadline_ms: 10_000, idempotency_key: `${idA}:r1` },
      meta("T-A"),
    );

    // Pair A asks the user something and its manager process restarts.
    expect(
      (await call(pairA, "bridge_feature_wait_user", { feature_id: idA, question_id: "q1", question: "which?" }, meta("T-A")))
        .isError,
    ).toBe(false);
    await pairA.close(); // clean detach

    // Meanwhile pair B runs its own round in its own worktree.
    const roundB = await call(
      pairB,
      "bridge_feature_run",
      { feature_id: idB, spec, input_artifacts: [], deadline_ms: 10_000, idempotency_key: `${idB}:r1` },
      meta("T-B"),
    );
    expect(roundB.isError).toBe(false);

    // Pair A restarts, adopts the detached binding, keeps the question and resumes the exact
    // worker session recorded for its own worktree.
    const restartedA = server(a, [fixtureA.adapter]);
    const state = await call(restartedA, "bridge_feature_get", { feature_id: idA }, meta("T-A"));
    expect(state.data["state"]).toBe("waiting_user");
    expect((state.data["question"] as { id: string }).id).toBe("q1");

    expect(
      (await call(restartedA, "bridge_feature_answer_user", { feature_id: idA, question_id: "q1", answer: "this one" }, meta("T-A")))
        .isError,
    ).toBe(false);
    const next = await call(
      restartedA,
      "bridge_feature_run",
      { feature_id: idA, spec, input_artifacts: [], deadline_ms: 10_000, idempotency_key: `${idA}:r2` },
      meta("T-A"),
    );
    expect(next.isError).toBe(false);
    expect(fixtureA.seen).toHaveLength(2);
    expect(fixtureA.seen[1]?.resume_required).toBe(true);
    expect(fixtureA.seen[1]?.previous_execution_handle).toBe("session-A");
    // The other worktree's session was never touched.
    expect(fixtureB.seen.every((invocation) => invocation.workspace_root === b.root)).toBe(true);
    expect(fixtureA.seen.every((invocation) => invocation.workspace_root === a.root)).toBe(true);
  }, 30_000);
});

// Wave10: exercise the published timeout path through the native identity dispatcher.
// The worker and host metadata are synthetic; this is not a real-model pilot.
describe("wave10 identity with FAILED/TIMEOUT recovery", () => {
  it("fences foreign timeout recovery and replay, survives restart and explicit takeover", async () => {
    const { a } = repo();
    const fixture = recordingAdapter("timeout-session-A");
    const successfulInvoke = fixture.adapter.invoke.bind(fixture.adapter);
    let first = true;
    fixture.adapter.invoke = async (invocation, ctx) => {
      if (!first) return successfulInvoke(invocation, ctx);
      first = false;
      await ctx.saveExecutionHandle("timeout-session-A");
      await new Promise<void>((resolve) => {
        if (ctx.signal.aborted) resolve();
        else ctx.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      return { ...await successfulInvoke(invocation, ctx), status: DeliverableStatus.PARTIAL,
        verification_performed: [], verification_results: [] };
    };
    const original = server(a, [fixture.adapter]);
    const id = await feature(original, "T-A");
    const round = await call(original, "bridge_feature_run", {
      feature_id: id, spec, input_artifacts: [], deadline_ms: 1000, idempotency_key: "r1",
    }, meta("T-A"));
    const task = round.data["task"] as { task_id: string; state: string };
    expect(task.state).toBe("FAILED");
    const request = { task_id: task.task_id, recover_timeout: true, deadline_ms: 10_000,
      max_turns: 7, idempotency_key: "recover-1", message: "Continue the existing scope" };
    const snapshot = () => {
      const store = new SqliteStateStore({ path: resolveDatabasePath(a), mode: "readonly" });
      try { return JSON.stringify({ events: store.readEvents(), tasks: store.listTasks(),
        attempts: store.listAttempts(task.task_id), features: store.listFeatures(),
        marker: readFileSync(join(stateDirectory(a), "workspace.json"), "utf8"),
        owner: readFileSync(`${resolveDatabasePath(a)}.owner`, "utf8") }); }
      finally { store.close(); }
    };
    const foreign = server(a, [fixture.adapter]);
    const before = snapshot();
    for (const envelope of [meta("T-B"), { ...meta("T-A"), "x-codex-turn-metadata": {
      session_id: "T-A", thread_id: "T-A", codex_version: "0.0.0" } }]) {
      expect((await call(foreign, "bridge_resume_delegated_task", request, envelope)).isError).toBe(true);
      expect(snapshot()).toBe(before);
    }
    expect(fixture.seen).toHaveLength(1);
    await original.close();
    const restarted = server(a, [fixture.adapter]);
    expect((await call(restarted, "bridge_manager_status", {}, meta("T-A"))).isError).toBe(false);
    const takeover = await call(foreign, "bridge_manager_takeover", {
      expected_thread_id: "T-A", expected_epoch: 1, reason: "synthetic authorized handoff",
    }, meta("T-B"));
    expect(takeover.isError).toBe(false);
    const transferred = snapshot();
    expect((await call(restarted, "bridge_resume_delegated_task", request, meta("T-A"))).isError).toBe(true);
    expect(snapshot()).toBe(transferred);
    const recovered = await call(foreign, "bridge_resume_delegated_task", request, meta("T-B"));
    expect(recovered.isError, JSON.stringify(recovered.data)).toBe(false);
    expect(fixture.seen).toHaveLength(2);
    expect(fixture.seen[1]).toMatchObject({ task_id: task.task_id,
      previous_execution_handle: "timeout-session-A", resume_required: true, spec: { max_turns: 7 } });
    const done = snapshot();
    expect((await call(restarted, "bridge_resume_delegated_task", request, meta("T-A"))).isError).toBe(true);
    expect(snapshot()).toBe(done);
    expect((await call(foreign, "bridge_resume_delegated_task", request, meta("T-B"))).isError).toBe(false);
    expect(snapshot()).toBe(done);
    expect(fixture.seen).toHaveLength(2);
  }, 30_000);
});
