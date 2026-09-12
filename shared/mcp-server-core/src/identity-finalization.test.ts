/**
 * Regressions for review 10: asynchronous finalization and authoritative database identity.
 *
 * - R10-01: an asynchronous operation must repair incomplete markers after its reservation and
 *   before the worktree lock is released, without inventing a new epoch.
 * - R10-02: the dispatch-time authorization of an asynchronous request must be pure, so an
 *   invalid request cannot leave an adopted instance or a migrated schema behind.
 * - R10-03: a binding whose `database_path` points elsewhere is refused, even for a copy inside
 *   the same worktree with the marker removed.
 *
 * Adapters and host envelopes are synthetic fixtures; nothing here is a live pilot.
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
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
  const dir = join(tempDir("bridge-fin-"), "main");
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

function gatedAdapter(): { adapter: AgentAdapter; open: () => void; started: Promise<void> } {
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
      await ctx.saveExecutionHandle("fixture-session");
      announce();
      await gate;
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
  return { adapter, open: release, started };
}

function server(
  identity: WorkspaceIdentity,
  options: { adapters?: AgentAdapter[]; databasePath?: string } = {},
): BridgeMcpServer {
  const instance = new BridgeMcpServer({
    workspaceRoot: identity.root,
    workspace: identity,
    agent: "codex",
    delegationPolicy: "allow",
    ...(options.adapters ? { adapters: options.adapters } : {}),
    ...(options.databasePath ? { databasePath: options.databasePath } : {}),
    serverName: "identity-finalization-test",
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

function managerRow(database: string): Record<string, unknown> {
  const store = new SqliteStateStore({ path: database, mode: "readonly" });
  const binding = store.getManagerBinding();
  const instances = store.listManagerInstances(binding?.epoch ?? 1);
  const epochs = store.listManagerEpochs();
  const schema = store.schemaVersion();
  store.close();
  return { binding, instanceCount: instances.length, epochCount: epochs.length, schema };
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("asynchronous finalization repairs markers before releasing the lock (R10-01)", () => {
  it("publishes markers at the reservation boundary of an async round without a new epoch", async () => {
    const identity = worktree();
    const database = resolveDatabasePath(identity);
    const gate = gatedAdapter();
    const owner = server(identity, { adapters: [gate.adapter] });
    await call(owner, "bridge_create_task", { spec }, meta("T1"));

    // A crash between the database commit and the rename leaves the markers incomplete.
    const markerFile = join(stateDirectory(identity), "workspace.json");
    const marker = JSON.parse(readFileSync(markerFile, "utf8")) as Record<string, unknown>;
    writeFileSync(markerFile, JSON.stringify({ ...marker, state: "reserving" }));
    unlinkSync(`${database}.owner`);
    const beforeManager = managerRow(database);

    const delegation = call(owner, "bridge_delegate", { to: "claude", spec, deadline_ms: 10_000 }, meta("T1"));
    await gate.started;

    // At worker start: the markers are repaired and the critical section is free.
    expect(JSON.parse(readFileSync(markerFile, "utf8"))["state"]).toBe("bound");
    expect(existsSync(`${database}.owner`)).toBe(true);
    expect(JSON.parse(readFileSync(`${database}.owner`, "utf8"))["state"]).toBe("bound");
    const section = WorktreeCriticalSection.acquire(identity, 500);
    section.release();

    gate.open();
    const finished = await delegation;
    expect(finished.isError).toBe(false);

    // Repair is bookkeeping: it must not mint an epoch or an activation.
    const afterManager = managerRow(database);
    expect(afterManager["binding"]).toEqual(beforeManager["binding"]);
    expect(afterManager["epochCount"]).toBe(beforeManager["epochCount"]);
    expect(afterManager["instanceCount"]).toBe(beforeManager["instanceCount"]);
  }, 20_000);
});

describe("dispatch-time authorization of an async request is pure (R10-02)", () => {
  it("leaves the binding untouched when an invalid async request is refused", async () => {
    const identity = worktree();
    const database = resolveDatabasePath(identity);
    const first = server(identity);
    await call(first, "bridge_create_task", { spec }, meta("T1"));
    await first.close(); // clean detach: active instance becomes null

    const before = managerRow(database);
    expect((before["binding"] as { active_instance_id: string | null }).active_instance_id).toBeNull();

    // A fresh connection of the owning thread issues an *invalid* asynchronous request.
    const restarted = server(identity);
    const denied = await call(restarted, "bridge_resume_task", { task_id: "task_missing" }, meta("T1"));
    expect(denied.isError).toBe(true);

    // The refusal must not have adopted the instance or written history on the way.
    const after = managerRow(database);
    expect(after["binding"]).toEqual(before["binding"]);
    expect(after["instanceCount"]).toBe(before["instanceCount"]);
  });

  it("leaves an older schema unmigrated when an invalid async request is refused", async () => {
    const identity = worktree();
    const database = resolveDatabasePath(identity);
    const owner = server(identity);
    await call(owner, "bridge_create_task", { spec }, meta("T1"));
    owner.cp.close();

    const direct = new SqliteStateStore({ path: database, mode: "attach" });
    (direct as unknown as { db: { prepare(sql: string): { run(...a: unknown[]): void } } }).db
      .prepare("INSERT OR REPLACE INTO schema_meta(key, value) VALUES('schema_version', ?)")
      .run("4");
    direct.close();

    const resumed = server(identity);
    const status = await call(resumed, "bridge_manager_status");
    const manager = status.data["manager"] as { epoch: number; instance_generation: number };
    await call(
      resumed,
      "bridge_manager_resume_instance",
      { expected_epoch: manager.epoch, expected_generation: manager.instance_generation },
      meta("T1"),
    );

    const denied = await call(resumed, "bridge_resume_task", { task_id: "task_missing" }, meta("T1"));
    expect(denied.isError).toBe(true);
    expect(managerRow(database)["schema"]).toBe(4);
  });

  it("still serves an authorized replay and a valid operation after a clean detach", async () => {
    const identity = worktree();
    const database = resolveDatabasePath(identity);
    const gate = gatedAdapter();
    gate.open();
    const first = server(identity, { adapters: [gate.adapter] });
    await call(first, "bridge_create_task", { spec }, meta("T1"));
    await first.close();

    const restarted = server(identity, { adapters: [gate.adapter] });
    const valid = await call(restarted, "bridge_delegate", { to: "claude", spec, deadline_ms: 10_000 }, meta("T1"));
    expect(valid.isError).toBe(false);
    // The valid operation itself adopted the detached connection.
    const binding = managerRow(database)["binding"] as { active_instance_id: string | null };
    expect(binding.active_instance_id).not.toBeNull();
  }, 20_000);
});

describe("authoritative database identity (R10-03)", () => {
  it("refuses a copy of the database inside the same worktree when the marker is gone", async () => {
    const identity = worktree();
    const database = resolveDatabasePath(identity);
    const owner = server(identity);
    await call(owner, "bridge_create_task", { spec }, meta("T1"));
    await owner.close();

    const copy = join(identity.root, "copy.db");
    copyFileSync(database, copy);
    unlinkSync(join(stateDirectory(identity), "workspace.json"));
    const copyDigest = sha256(copy);

    const onCopy = server(identity, { databasePath: copy });
    const denied = await call(onCopy, "bridge_create_task", { spec }, meta("T1"));
    expect(denied.isError).toBe(true);
    expect((denied.data["error"] as { details: { reason: string } }).details.reason).toBe(
      "database_bound_elsewhere",
    );
    // Neither database was written and no owner record was invented for the copy.
    expect(sha256(copy)).toBe(copyDigest);
    expect(existsSync(`${copy}.owner`)).toBe(false);
    expect(existsSync(join(stateDirectory(identity), "workspace.json"))).toBe(false);

    // The ordinary recovery — marker missing, binding matching the requested database — works.
    const recovered = server(identity);
    const ok = await call(recovered, "bridge_create_task", { spec }, meta("T1"));
    expect(ok.isError).toBe(false);
    expect(JSON.parse(readFileSync(join(stateDirectory(identity), "workspace.json"), "utf8"))["state"]).toBe(
      "bound",
    );
  });
});
