/**
 * Regressions for review 11, driven through the public tool surface.
 *
 * - R11-01: building a feature-round response must not reconcile state. A replay, or a response
 *   returned after a long-running worker (possibly after a takeover), may derive the current
 *   state but must not write the feature row, append events or activate an instance.
 * - R11-02: a marker or owner record whose reservation nonce contradicts the binding is refused
 *   in the `reserving` state too; only a *matching* nonce is a recoverable interrupted
 *   publication.
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
  resolveDatabasePath,
  resolveWorkspaceIdentity,
  stateDirectory,
  type WorkspaceIdentity,
} from "@bridge/control-plane";
import { AdapterHealth, DeliverableStatus, type AgentAdapter, type TaskSpec } from "@bridge/protocol";
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

function worktree(): WorkspaceIdentity {
  const dir = join(tempDir("bridge-resp-"), "main");
  mkdirSync(dir);
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@e",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@e",
  };
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir, stdio: "ignore", env });
  writeFileSync(join(dir, "f.txt"), "x\n");
  execFileSync("git", ["add", "."], { cwd: dir, stdio: "ignore", env });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: dir, stdio: "ignore", env });
  return resolveWorkspaceIdentity(dir);
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

function fixtureAdapter(gated = false): {
  adapter: AgentAdapter;
  starts: number[];
  open: () => void;
  started: Promise<void>;
} {
  const starts: number[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let announce!: () => void;
  const started = new Promise<void>((resolve) => (announce = resolve));
  const adapter: AgentAdapter = {
    info: { agent: "claude", implementation: "fixture", version: "1", capabilities: ["resume"], max_concurrency: 1 },
    async health() {
      return { status: AdapterHealth.READY, checked_at: Date.now() };
    },
    async cancel() {},
    async invoke(invocation, ctx) {
      starts.push(Date.now());
      await ctx.saveExecutionHandle("fixture-session");
      announce();
      if (gated) await gate;
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
  return { adapter, starts, open: release, started };
}

function server(identity: WorkspaceIdentity, adapters: AgentAdapter[] = []): BridgeMcpServer {
  const instance = new BridgeMcpServer({
    workspaceRoot: identity.root,
    workspace: identity,
    agent: "codex",
    delegationPolicy: "allow",
    adapters,
    serverName: "identity-response-test",
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

/** Durable snapshot: stored feature rows, event count and activation history. */
function durable(database: string): { features: string; events: number; instances: number } {
  const store = new SqliteStateStore({ path: database, mode: "readonly" });
  const features = JSON.stringify(store.listFeatures());
  const events = store.lastEventId();
  const binding = store.getManagerBinding();
  const instances = store.listManagerInstances(binding?.epoch ?? 1).length;
  store.close();
  return { features, events, instances };
}

async function startedFeature(
  codex: BridgeMcpServer,
  thread: string,
  id = "F-resp",
): Promise<string> {
  const parent = (await call(codex, "bridge_create_task", { spec }, meta(thread))).data["task_id"] as string;
  await call(codex, "bridge_claim_task", { task_id: parent }, meta(thread));
  expect((await call(codex, "bridge_feature_create", { feature_id: id, parent_task_id: parent }, meta(thread))).isError).toBe(
    false,
  );
  return id;
}

describe("round responses are derived, never reconciled (R11-01)", () => {
  it("replays from a fresh instance after a clean detach without writing anything", async () => {
    const identity = worktree();
    const database = resolveDatabasePath(identity);
    const fixture = fixtureAdapter();
    const owner = server(identity, [fixture.adapter]);
    const id = await startedFeature(owner, "T1");
    const key = `${id}:round-1`;
    const first = await call(
      owner,
      "bridge_feature_run",
      { feature_id: id, spec, input_artifacts: [], deadline_ms: 10_000, idempotency_key: key },
      meta("T1"),
    );
    expect(first.isError).toBe(false);
    const taskId = (first.data["task"] as { task_id: string }).task_id;

    // The stored record is stale: the round's task is DONE while the feature still reads
    // `running`. This is exactly the state a crash between the worker's completion and the next
    // guarded call leaves behind.
    const writable = new SqliteStateStore({ path: database, mode: "attach" });
    const stale = writable.getFeature(id)!;
    writable.putFeature({ ...stale, state: "running", active_task_id: taskId });
    writable.close();

    await owner.close(); // clean detach: the next fresh instance is eligible to adopt
    const before = durable(database);

    const restarted = server(identity, [fixture.adapter]);
    const replay = await call(
      restarted,
      "bridge_feature_run",
      { feature_id: id, spec, input_artifacts: [], deadline_ms: 10_000, idempotency_key: key },
      meta("T1"),
    );

    // The response is derived correctly…
    expect(replay.isError).toBe(false);
    expect(replay.data["replayed"]).toBe(true);
    expect((replay.data["feature"] as { state: string }).state).toBe("awaiting_review");
    expect((replay.data["task"] as { task_id: string }).task_id).toBe(taskId);
    // …while nothing was written: no reconcile, no event, no activation, no second worker.
    expect(durable(database)).toEqual(before);
    expect(fixture.starts).toHaveLength(1);
  }, 20_000);

  it("persists the reconciled state after its own worker completes", async () => {
    // The trusted worker-completion path is what downstream consumers read: the operator dry run
    // inspects the stored feature state after a round, so it must be reconciled there.
    const identity = worktree();
    const database = resolveDatabasePath(identity);
    const fixture = fixtureAdapter();
    const owner = server(identity, [fixture.adapter]);
    const id = await startedFeature(owner, "T1");
    const round = await call(
      owner,
      "bridge_feature_run",
      { feature_id: id, spec, input_artifacts: [], deadline_ms: 10_000, idempotency_key: `${id}:round-1` },
      meta("T1"),
    );
    expect(round.isError).toBe(false);

    const store = new SqliteStateStore({ path: database, mode: "readonly" });
    const stored = store.getFeature(id)!;
    store.close();
    expect(stored.state).toBe("awaiting_review");
    expect(stored.active_task_id).toBeNull();
  }, 20_000);

  it("does not reconcile when the response is produced after a takeover", async () => {
    const identity = worktree();
    const database = resolveDatabasePath(identity);
    const fixture = fixtureAdapter(true);
    const owner = server(identity, [fixture.adapter]);
    const id = await startedFeature(owner, "T1");

    const round = call(
      owner,
      "bridge_feature_run",
      { feature_id: id, spec, input_artifacts: [], deadline_ms: 10_000, idempotency_key: `${id}:round-1` },
      meta("T1"),
    );
    await fixture.started;

    const successor = server(identity, [fixture.adapter]);
    expect(
      (
        await call(
          successor,
          "bridge_manager_takeover",
          { expected_thread_id: "T1", expected_epoch: 1, reason: "operator switched sessions" },
          meta("T2"),
        )
      ).isError,
    ).toBe(false);

    fixture.open();
    const finished = await round;
    expect(finished.isError).toBe(false);

    // The response derives the completed state, but the fenced session's request path wrote no
    // reconciliation into the stored record.
    expect((finished.data["feature"] as { state: string }).state).toBe("awaiting_review");
    const store = new SqliteStateStore({ path: database, mode: "readonly" });
    const stored = store.getFeature(id)!;
    store.close();
    expect(stored.state).toBe("running");

    // A pure read agrees with the derived response.
    expect((await call(successor, "bridge_feature_get", { feature_id: id }, meta("T2"))).data["state"]).toBe(
      "awaiting_review",
    );
  }, 20_000);
});

describe("contradictory reservation nonces are refused in every state (R11-02)", () => {
  async function boundWorktree(): Promise<{ identity: WorkspaceIdentity; database: string; codex: BridgeMcpServer }> {
    const identity = worktree();
    const database = resolveDatabasePath(identity);
    const codex = server(identity);
    await call(codex, "bridge_create_task", { spec }, meta("T1"));
    return { identity, database, codex };
  }

  it("refuses a reserving marker whose nonce contradicts the binding", async () => {
    const { identity, database, codex } = await boundWorktree();
    const markerFile = join(stateDirectory(identity), "workspace.json");
    const marker = JSON.parse(readFileSync(markerFile, "utf8")) as Record<string, unknown>;
    writeFileSync(
      markerFile,
      JSON.stringify({ ...marker, state: "reserving", reservation_nonce: "ffffffffffffffffffffffff" }),
    );
    const before = readFileSync(markerFile, "utf8");

    const denied = await call(codex, "bridge_create_task", { spec }, meta("T1"));
    expect(denied.isError).toBe(true);
    expect((denied.data["error"] as { details: { reason: string } }).details.reason).toBe(
      "unresolved_workspace_state",
    );
    // Contradictory state is never "repaired" into agreement.
    expect(readFileSync(markerFile, "utf8")).toBe(before);
  });

  it("refuses a reserving owner record whose nonce contradicts the binding", async () => {
    const { database, codex } = await boundWorktree();
    const ownerFile = `${database}.owner`;
    const owner = JSON.parse(readFileSync(ownerFile, "utf8")) as Record<string, unknown>;
    writeFileSync(
      ownerFile,
      JSON.stringify({ ...owner, state: "reserving", reservation_nonce: "eeeeeeeeeeeeeeeeeeeeeeee" }),
    );
    const before = readFileSync(ownerFile, "utf8");

    const denied = await call(codex, "bridge_create_task", { spec }, meta("T1"));
    expect(denied.isError).toBe(true);
    expect(readFileSync(ownerFile, "utf8")).toBe(before);
  });

  it("still repairs a matching-nonce interrupted publication and a missing record", async () => {
    const { identity, database, codex } = await boundWorktree();
    const markerFile = join(stateDirectory(identity), "workspace.json");
    const marker = JSON.parse(readFileSync(markerFile, "utf8")) as Record<string, unknown>;

    // Crash after commit, before the rename: same nonce, state still `reserving`.
    writeFileSync(markerFile, JSON.stringify({ ...marker, state: "reserving" }));
    expect((await call(codex, "bridge_create_task", { spec }, meta("T1"))).isError).toBe(false);
    expect(JSON.parse(readFileSync(markerFile, "utf8"))["state"]).toBe("bound");

    // A missing owner record is reconstructed from the binding.
    unlinkSync(`${database}.owner`);
    expect((await call(codex, "bridge_create_task", { spec }, meta("T1"))).isError).toBe(false);
    expect(existsSync(`${database}.owner`)).toBe(true);
    expect(JSON.parse(readFileSync(`${database}.owner`, "utf8"))["reservation_nonce"]).toBe(
      marker["reservation_nonce"],
    );
  });
});
