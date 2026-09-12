/**
 * End-to-end protocol behaviour of the isolation contract (§4, §5, §6, §7), driven through the
 * real tool surface with real Git worktrees and real SQLite files.
 *
 * The native envelopes here are synthetic fixtures standing in for what a Codex host attaches
 * to `params._meta`; they are not live Codex sessions and prove nothing about a live pilot.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveDatabasePath,
  resolveWorkspaceIdentity,
  stateDirectory,
  type WorkspaceIdentity,
} from "@bridge/control-plane";
import type { TaskSpec } from "@bridge/protocol";
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

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, {
    cwd,
    stdio: "ignore",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@e", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@e" },
  });
}

function worktrees(): { a: WorkspaceIdentity; b: WorkspaceIdentity } {
  const base = tempDir("bridge-proto-");
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

/** Synthetic host envelope (fixture, not a live Codex session). */
function meta(thread: string, version = "0.154.0"): Record<string, unknown> {
  return {
    threadId: thread,
    "x-codex-turn-metadata": { session_id: thread, thread_id: thread, codex_version: version },
  };
}

const spec: TaskSpec = {
  objective: "do the thing",
  scope: { paths: ["src/**"] },
  dependencies: [],
  expected_deliverable: "a result",
  verification_criteria: ["npm test"],
};

function server(identity: WorkspaceIdentity, databasePath?: string): BridgeMcpServer {
  const instance = new BridgeMcpServer({
    workspaceRoot: identity.root,
    workspace: identity,
    ...(databasePath ? { databasePath } : {}),
    agent: "codex",
    delegationPolicy: "allow",
    serverName: "identity-protocol-test",
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
  const tool = TOOLS.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`unknown tool ${name}`);
  const ctx = (instance as unknown as { ctx: Parameters<typeof runTool>[2] }).ctx;
  const result = await runTool(tool, args, ctx, nativeMeta);
  return {
    isError: result.isError === true,
    data: JSON.parse(result.content[0]!.text) as Record<string, unknown>,
  };
}

describe("identity protocol: bootstrap and reads", () => {
  it("claims nothing at startup or on reads, then binds on the first authorized call", async () => {
    const { a } = worktrees();
    const database = resolveDatabasePath(a);
    const codex = server(a);

    const before = await call(codex, "bridge_manager_status");
    expect(before.data["workspace"]).toMatchObject({ bound: false, database_exists: false });
    expect(before.data["manager"]).toBeNull();
    // Startup and a read created no state directory at all.
    expect(existsSync(stateDirectory(a))).toBe(false);

    const created = await call(codex, "bridge_create_task", { spec }, meta("T1"));
    expect(created.isError).toBe(false);
    expect(existsSync(database)).toBe(true);

    const after = await call(codex, "bridge_manager_status");
    expect(after.data["manager"]).toMatchObject({ native_thread_id: "T1", epoch: 1, instance_generation: 1 });
    const marker = JSON.parse(readFileSync(join(stateDirectory(a), "workspace.json"), "utf8")) as Record<string, unknown>;
    expect(marker["state"]).toBe("bound");
    expect(JSON.parse(readFileSync(`${database}.owner`, "utf8"))["state"]).toBe("bound");
  });

  it("refuses missing, subagent and unsupported envelopes before creating any state", async () => {
    const { a } = worktrees();
    const codex = server(a);

    const noMeta = await call(codex, "bridge_create_task", { spec });
    expect(noMeta.data["error"]).toMatchObject({ code: "NATIVE_CONTEXT_INVALID" });

    const subagent = await call(codex, "bridge_create_task", { spec }, {
      threadId: "G1",
      "x-codex-turn-metadata": {
        session_id: "G1",
        thread_id: "G1",
        codex_version: "0.154.0",
        subagent_kind: "review",
        parent_thread_id: "T1",
      },
    });
    expect((subagent.data["error"] as { details: { reason: string } }).details.reason).toBe(
      "native_subagent_rejected",
    );

    const badVersion = await call(codex, "bridge_create_task", { spec }, meta("T1", "0.154.1"));
    expect((badVersion.data["error"] as { details: { reason: string } }).details.reason).toBe(
      "native_adapter_unsupported",
    );

    const inconsistent = await call(codex, "bridge_create_task", { spec }, {
      threadId: "T1",
      "x-codex-turn-metadata": { session_id: "OTHER", thread_id: "T1", codex_version: "0.154.0" },
    });
    expect((inconsistent.data["error"] as { details: { reason: string } }).details.reason).toBe(
      "native_context_inconsistent",
    );

    // Nothing was created by any refused call.
    expect(existsSync(stateDirectory(a))).toBe(false);
  });

  it("keeps durable state and ownership untouched for a foreign session's reads and mutations", async () => {
    const { a } = worktrees();
    const database = resolveDatabasePath(a);
    const owner = server(a);
    await call(owner, "bridge_create_task", { spec }, meta("T1"));

    const intruder = server(a);
    // Durable state, not file bytes: SQLite may checkpoint WAL sidecars for a reader, which the
    // contract explicitly distinguishes from a durable state or ownership write.
    const beforeMarker = readFileSync(join(stateDirectory(a), "workspace.json"), "utf8");
    const beforeOwner = readFileSync(`${database}.owner`, "utf8");
    const beforeEvents = (await call(owner, "bridge_read_events")).data["last_event_id"];
    const beforeTasks = (await call(owner, "bridge_list_tasks")).data["count"];
    const beforeManager = JSON.stringify((await call(owner, "bridge_manager_status")).data["manager"]);

    // Class R from a process that owns nothing: allowed, and writes nothing.
    for (const tool of ["bridge_snapshot", "bridge_list_tasks", "bridge_read_events", "bridge_recover"]) {
      const result = await call(intruder, tool);
      expect(result.isError, `${tool} should be readable`).toBe(false);
    }
    // Class M from the foreign thread: refused.
    const denied = await call(intruder, "bridge_create_task", { spec }, meta("T2"));
    expect(denied.data["error"]).toMatchObject({ code: "MANAGER_FOREIGN_THREAD" });

    expect((await call(owner, "bridge_read_events")).data["last_event_id"]).toBe(beforeEvents);
    expect((await call(owner, "bridge_list_tasks")).data["count"]).toBe(beforeTasks);
    expect(JSON.stringify((await call(owner, "bridge_manager_status")).data["manager"])).toBe(beforeManager);
    expect(readFileSync(join(stateDirectory(a), "workspace.json"), "utf8")).toBe(beforeMarker);
    expect(readFileSync(`${database}.owner`, "utf8")).toBe(beforeOwner);
  });
});

describe("identity protocol: database exclusivity and recovery", () => {
  it("refuses a second worktree using the same database and a second database for one worktree", async () => {
    const { a, b } = worktrees();
    const shared = resolveDatabasePath(a);
    const first = server(a);
    await call(first, "bridge_create_task", { spec }, meta("T1"));

    const intruder = server(b, shared);
    const denied = await call(intruder, "bridge_create_task", { spec }, meta("T2"));
    expect((denied.data["error"] as { details: { reason: string } }).details.reason).toBe(
      "database_owned_elsewhere",
    );

    const secondDb = server(a, join(stateDirectory(a), "other.db"));
    const refused = await call(secondDb, "bridge_create_task", { spec }, meta("T1"));
    expect((refused.data["error"] as { details: { reason: string } }).details.reason).toBe("second_database");
    expect(existsSync(join(stateDirectory(a), "other.db"))).toBe(false);
  });

  it("repairs an interrupted marker only for an authorized caller", async () => {
    const { a } = worktrees();
    const database = resolveDatabasePath(a);
    const codex = server(a);
    await call(codex, "bridge_create_task", { spec }, meta("T1"));

    // Simulate a crash after the database commit but before the rename.
    const markerFile = join(stateDirectory(a), "workspace.json");
    const marker = JSON.parse(readFileSync(markerFile, "utf8")) as Record<string, unknown>;
    writeFileSync(markerFile, JSON.stringify({ ...marker, state: "reserving" }));

    const status = await call(codex, "bridge_manager_status");
    expect((status.data["recovery"] as { recovery_needed: boolean }).recovery_needed).toBe(true);

    // A foreign session repairs nothing.
    const intruder = server(a);
    await call(intruder, "bridge_create_task", { spec }, meta("T9"));
    expect(JSON.parse(readFileSync(markerFile, "utf8"))["state"]).toBe("reserving");

    // The owning manager's next authorized mutation completes the publication.
    await call(codex, "bridge_create_task", { spec }, meta("T1"));
    expect(JSON.parse(readFileSync(markerFile, "utf8"))["state"]).toBe("bound");
    expect(JSON.parse(readFileSync(`${database}.owner`, "utf8"))["state"]).toBe("bound");
  });

  it("leaves no binding and no reservation when the first operation fails", async () => {
    const { a } = worktrees();
    const codex = server(a);
    const failed = await call(
      codex,
      "bridge_claim_task",
      { task_id: "task_does_not_exist" },
      meta("T1"),
    );
    expect(failed.isError).toBe(true);

    const status = await call(codex, "bridge_manager_status");
    expect(status.data["manager"]).toBeNull();
    expect(existsSync(join(stateDirectory(a), "workspace.json"))).toBe(false);

    // A later call still bootstraps normally.
    const ok = await call(codex, "bridge_create_task", { spec }, meta("T1"));
    expect(ok.isError).toBe(false);
  });
});

describe("identity protocol: instances and takeover through the tool surface", () => {
  it("fences another connection of the same thread until it resumes explicitly", async () => {
    const { a } = worktrees();
    const first = server(a);
    await call(first, "bridge_create_task", { spec }, meta("T1"));

    const restarted = server(a); // a new MCP process of the same native session
    const fenced = await call(restarted, "bridge_create_task", { spec }, meta("T1"));
    expect(fenced.data["error"]).toMatchObject({ code: "MANAGER_INSTANCE_FENCED" });

    const stale = await call(
      restarted,
      "bridge_manager_resume_instance",
      { expected_epoch: 1, expected_generation: 99 },
      meta("T1"),
    );
    expect(stale.isError).toBe(true);

    const resumed = await call(
      restarted,
      "bridge_manager_resume_instance",
      { expected_epoch: 1, expected_generation: 1 },
      meta("T1"),
    );
    expect(resumed.data).toMatchObject({ epoch: 1, instance_generation: 2, changed: true });
    expect((await call(restarted, "bridge_create_task", { spec }, meta("T1"))).isError).toBe(false);
    // The previous connection is now the fenced one.
    expect((await call(first, "bridge_create_task", { spec }, meta("T1"))).data["error"]).toMatchObject({
      code: "MANAGER_INSTANCE_FENCED",
    });
  });

  it("moves ownership only through an explicit takeover and fences the old thread", async () => {
    const { a } = worktrees();
    const first = server(a);
    await call(first, "bridge_create_task", { spec }, meta("T1"));
    const second = server(a);

    const wrongCas = await call(
      second,
      "bridge_manager_takeover",
      { expected_thread_id: "T1", expected_epoch: 7, reason: "wrong epoch" },
      meta("T2"),
    );
    expect(wrongCas.isError).toBe(true);

    const taken = await call(
      second,
      "bridge_manager_takeover",
      { expected_thread_id: "T1", expected_epoch: 1, reason: "operator switched sessions" },
      meta("T2"),
    );
    expect(taken.data).toMatchObject({ epoch: 2, instance_generation: 1 });
    expect((await call(second, "bridge_create_task", { spec }, meta("T2"))).isError).toBe(false);

    const old = await call(first, "bridge_create_task", { spec }, meta("T1"));
    expect(old.data["error"]).toMatchObject({ code: "MANAGER_FENCED" });
    // Reads are never fenced.
    expect((await call(first, "bridge_snapshot")).isError).toBe(false);
  });
});
