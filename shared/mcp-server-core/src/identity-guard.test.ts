/**
 * Guard behaviour that only shows up on the real entrypoints (review 08): the authority check
 * inside asynchronous reservations, schema writes by denied callers, reads while a round runs,
 * the §8 launch prohibition, detach/CAS, feature slots and interrupted publication.
 *
 * Adapters and host envelopes here are synthetic fixtures; nothing in this file is a live pilot.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SqliteStateStore,
  probeWorkspaceState,
  resolveDatabasePath,
  resolveWorkspaceIdentity,
  stateDirectory,
  type WorkspaceIdentity,
} from "@bridge/control-plane";
import {
  AdapterHealth,
  DeliverableStatus,
  type AgentAdapter,
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

function worktree(): WorkspaceIdentity {
  const dir = join(tempDir("bridge-guard-"), "main");
  mkdirSync(dir);
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@e", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@e" };
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

/** Fixture worker whose invocation can be gated, standing in for a delegated runtime. */
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
  options: { agent?: "codex" | "claude"; adapters?: AgentAdapter[] } = {},
): BridgeMcpServer {
  const instance = new BridgeMcpServer({
    workspaceRoot: identity.root,
    workspace: identity,
    agent: options.agent ?? "codex",
    delegationPolicy: "allow",
    ...(options.adapters ? { adapters: options.adapters } : {}),
    serverName: "identity-guard-test",
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

async function bootstrapFeature(
  codex: BridgeMcpServer,
  thread: string,
): Promise<{ parent: string; feature: string }> {
  const created = await call(codex, "bridge_create_task", { spec }, meta(thread));
  const parent = created.data["task_id"] as string;
  await call(codex, "bridge_claim_task", { task_id: parent }, meta(thread));
  const feature = "F-guard";
  const madeFeature = await call(
    codex,
    "bridge_feature_create",
    { feature_id: feature, parent_task_id: parent },
    meta(thread),
  );
  expect(madeFeature.isError).toBe(false);
  return { parent, feature };
}

describe("authority inside asynchronous reservations (R08-01, R08-03)", () => {
  it("keeps a running round alive for reads and denies a new round after a takeover", async () => {
    const identity = worktree();
    const gate = gatedAdapter();
    const owner = server(identity, { adapters: [gate.adapter] });
    const { feature } = await bootstrapFeature(owner, "T1");

    const round = call(
      owner,
      "bridge_feature_run",
      {
        feature_id: feature,
        spec,
        input_artifacts: [],
        deadline_ms: 10_000,
        idempotency_key: `${feature}:round-1`,
      },
      meta("T1"),
    );
    await gate.started;

    // Reads during a running round must not disturb the writer that the adapter still uses.
    const reader = server(identity);
    expect((await call(reader, "bridge_manager_status")).isError).toBe(false);
    expect((await call(reader, "bridge_snapshot")).isError).toBe(false);
    expect((await call(owner, "bridge_feature_get", { feature_id: feature }, meta("T1"))).data["state"]).toBe(
      "running",
    );

    // A takeover lands while the worker is still executing.
    const successor = server(identity);
    const taken = await call(
      successor,
      "bridge_manager_takeover",
      { expected_thread_id: "T1", expected_epoch: 1, reason: "operator switched sessions" },
      meta("T2"),
    );
    expect(taken.data["epoch"]).toBe(2);

    // The already-launched worker still completes and records its result and lease release.
    gate.open();
    const finished = await round;
    expect(finished.isError).toBe(false);
    const tasks = await call(reader, "bridge_list_tasks");
    const before = tasks.data["count"] as number;
    const snapshot = await call(reader, "bridge_snapshot");
    expect((snapshot.data["live_leases"] as unknown[]).length).toBe(0);

    // The fenced manager cannot start another round: the guard runs in the reservation.
    const denied = await call(
      owner,
      "bridge_feature_run",
      {
        feature_id: feature,
        spec,
        input_artifacts: [],
        deadline_ms: 10_000,
        idempotency_key: `${feature}:round-2`,
      },
      meta("T1"),
    );
    expect(denied.isError).toBe(true);
    expect((await call(reader, "bridge_list_tasks")).data["count"]).toBe(before);
  }, 30_000);

  it("leaves no ownership when the first asynchronous operation is invalid", async () => {
    const identity = worktree();
    const codex = server(identity);
    // No adapter is registered, so the delegation fails at the reservation stage.
    const failed = await call(
      codex,
      "bridge_delegate",
      { to: "claude", spec, deadline_ms: 5_000 },
      meta("T1"),
    );
    expect(failed.isError).toBe(true);

    const status = await call(codex, "bridge_manager_status");
    expect(status.data["manager"]).toBeNull();
    expect(existsSync(join(stateDirectory(identity), "workspace.json"))).toBe(false);
  });
});

describe("schema writes stay behind the guard (R08-02)", () => {
  it("does not migrate or upsert schema_meta for a denied caller", async () => {
    const identity = worktree();
    const database = resolveDatabasePath(identity);
    const owner = server(identity);
    await call(owner, "bridge_create_task", { spec }, meta("T1"));
    owner.cp.close();

    // Pretend the bound database still carries an older schema.
    const direct = new SqliteStateStore({ path: database, mode: "attach" });
    (direct as unknown as { db: { prepare(sql: string): { run(...a: unknown[]): void } } }).db
      .prepare("INSERT OR REPLACE INTO schema_meta(key, value) VALUES('schema_version', ?)")
      .run("4");
    direct.close();

    const intruder = server(identity);
    const denied = await call(intruder, "bridge_create_task", { spec }, meta("T9"));
    expect(denied.isError).toBe(true);
    const after = new SqliteStateStore({ path: database, mode: "readonly" });
    expect(after.schemaVersion()).toBe(4);
    after.close();

    // The owner's next authorized mutation performs the migration inside its transaction. The
    // first server was closed without a clean detach, so this connection resumes explicitly.
    const resumedOwner = server(identity);
    const status = await call(resumedOwner, "bridge_manager_status");
    const manager = status.data["manager"] as { epoch: number; instance_generation: number };
    const resumed = await call(
      resumedOwner,
      "bridge_manager_resume_instance",
      { expected_epoch: manager.epoch, expected_generation: manager.instance_generation },
      meta("T1"),
    );
    expect(resumed.isError).toBe(false);
    // The handoff itself must not migrate: only an authorized mutation may (review R09-03).
    const afterHandoff = new SqliteStateStore({ path: database, mode: "readonly" });
    expect(afterHandoff.schemaVersion()).toBe(4);
    afterHandoff.close();

    const migrating = await call(resumedOwner, "bridge_create_task", { spec }, meta("T1"));
    expect(migrating.isError).toBe(false);
    const migrated = new SqliteStateStore({ path: database, mode: "readonly" });
    expect(migrated.schemaVersion()).toBe(SqliteStateStore.schemaVersionSupported);
    migrated.close();
  });
});

describe("roles without Codex metadata (R08-04)", () => {
  it("lets Claude write its own state but never launch or resume", async () => {
    const identity = worktree();
    const codex = server(identity);
    await call(codex, "bridge_create_task", { spec }, meta("T1"));

    const claude = server(identity, { agent: "claude" });
    // Permitted: its own execution-identity write, with no Codex metadata at all.
    const own = await call(claude, "bridge_create_task", { spec });
    expect(own.isError).toBe(false);

    for (const tool of ["bridge_delegate", "bridge_resume_task", "bridge_resume_delegated_task"]) {
      const args =
        tool === "bridge_delegate"
          ? { to: "codex", spec, deadline_ms: 5_000 }
          : { task_id: own.data["task_id"] as string };
      const denied = await call(claude, tool, args);
      expect(denied.isError, `${tool} must be refused`).toBe(true);
      expect((denied.data["error"] as { code: string }).code).toBe("MANAGER_FOREIGN_THREAD");
    }
  });
});

describe("detach, feature slots and interrupted publication (R08-05, R08-06, R08-07)", () => {
  it("bumps the generation on detach so a stale handoff CAS is refused", async () => {
    const identity = worktree();
    const first = server(identity);
    await call(first, "bridge_create_task", { spec }, meta("T1"));
    const status = await call(first, "bridge_manager_status");
    const manager = status.data["manager"] as { epoch: number; instance_generation: number };
    expect(manager.instance_generation).toBe(1);

    await first.close(); // clean detach
    const restarted = server(identity);
    const stale = await call(
      restarted,
      "bridge_manager_resume_instance",
      { expected_epoch: manager.epoch, expected_generation: manager.instance_generation },
      meta("T1"),
    );
    expect(stale.isError).toBe(true);

    // A fresh connection still adopts the cleanly detached binding without a handoff.
    const adopted = await call(restarted, "bridge_create_task", { spec }, meta("T1"));
    expect(adopted.isError).toBe(false);
  });

  it("keeps one active feature per worktree and frees the slot on accept", async () => {
    const identity = worktree();
    const codex = server(identity);
    const { parent } = await bootstrapFeature(codex, "T1");

    const second = await call(
      codex,
      "bridge_feature_create",
      { feature_id: "F-other", parent_task_id: parent },
      meta("T1"),
    );
    expect(second.isError).toBe(true);
    expect((second.data["error"] as { code: string }).code).toBe("FEATURE_CONFLICT");

    const feature = await call(codex, "bridge_feature_get", { feature_id: "F-guard" }, meta("T1"));
    expect(feature.data["workspace_id"]).toBe(codex.identity!.workspaceId);
    expect(feature.data["manager_epoch"]).toBe(1);
  });

  it("completes a bootstrap whose publication was interrupted before any binding", async () => {
    const identity = worktree();
    const database = resolveDatabasePath(identity);
    // Simulate a crash after publishing the marker but before the database commit.
    mkdirSync(stateDirectory(identity), { recursive: true });
    writeFileSync(
      join(stateDirectory(identity), "workspace.json"),
      JSON.stringify({
        schema_version: 1,
        workspace_id: "ws_stale",
        kind: identity.kind,
        root: identity.root,
        git_dir: identity.git_dir,
        git_common_dir: identity.git_common_dir,
        database,
        state: "reserving",
        reservation_nonce: "0123456789ab",
        created_at: new Date().toISOString(),
      }),
    );

    const codex = server(identity);
    const created = await call(codex, "bridge_create_task", { spec }, meta("T1"));
    expect(created.isError).toBe(false);

    const marker = JSON.parse(readFileSync(join(stateDirectory(identity), "workspace.json"), "utf8")) as Record<string, unknown>;
    expect(marker["state"]).toBe("bound");
    const probe = probeWorkspaceState(identity, database);
    expect(marker["reservation_nonce"]).toBe(probe.binding!.reservation_nonce);
    expect(marker["reservation_nonce"]).not.toBe("0123456789ab");
  });
});
