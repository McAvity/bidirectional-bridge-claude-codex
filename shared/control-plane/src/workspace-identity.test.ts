/**
 * Worktree identity, state records and the critical section (contract §3, §4, §7.1).
 *
 * These use real Git worktrees, real SQLite files and a real child process, because the
 * mechanisms under test are filesystem and kernel behaviour, not helper logic.
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ManagerRegistry } from "./manager-registry.js";
import { SqliteStateStore } from "./store/sqlite-store.js";
import { resolveDatabasePath, resolveWorkspaceIdentity, stateDirectory } from "./workspace-identity.js";
import {
  WorktreeCriticalSection,
  assertProbeUsable,
  assertStateDirectoryExplained,
  newNonce,
  probeWorkspaceState,
  publishReservation,
  readMarker,
} from "./workspace-state.js";

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.splice(0).reverse()) fn();
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@e", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@e" },
  });
}

/** A real repository with a real second worktree. */
function repoWithWorktree(): { main: string; second: string } {
  const base = tempDir("bridge-wt-");
  const main = join(base, "main");
  mkdirSync(main);
  git(main, "init", "-q", "-b", "main");
  writeFileSync(join(main, "file.txt"), "x\n");
  git(main, "add", ".");
  git(main, "commit", "-qm", "init");
  const second = join(base, "second");
  git(main, "worktree", "add", "-q", "-b", "feature", second);
  return { main, second };
}

describe("workspace identity", () => {
  it("gives two worktrees of one project distinct ids and a shared project key", () => {
    const { main, second } = repoWithWorktree();
    const a = resolveWorkspaceIdentity(main);
    const b = resolveWorkspaceIdentity(second);
    expect(a.kind).toBe("git");
    expect(a.root).not.toBe(b.root);
    expect(a.git_dir).not.toBe(b.git_dir);
    expect(a.project_key).toBe(b.project_key);
    expect(resolveDatabasePath(a, undefined)).toBe(join(a.root, ".bridge", "bridge.db"));
    // Resolving a fresh default path must not create the state directory.
    expect(existsSync(stateDirectory(a))).toBe(false);
  });

  it("is stable across a branch switch and unaffected by a symlinked path", () => {
    const { main } = repoWithWorktree();
    const before = resolveWorkspaceIdentity(main);
    git(main, "checkout", "-q", "-b", "other");
    const after = resolveWorkspaceIdentity(main);
    expect(after.root).toBe(before.root);
    expect(after.git_dir).toBe(before.git_dir);

    const link = join(tempDir("bridge-link-"), "alias");
    symlinkSync(main, link);
    expect(resolveWorkspaceIdentity(link).root).toBe(before.root);
  });

  it("refuses a subdirectory and ignores an inherited git environment", () => {
    const { main } = repoWithWorktree();
    const sub = join(main, "nested");
    mkdirSync(sub);
    expect(() => resolveWorkspaceIdentity(sub)).toThrowError(/worktree root/u);

    const other = repoWithWorktree();
    const identity = resolveWorkspaceIdentity(main, {
      env: { ...process.env, GIT_DIR: join(other.main, ".git"), GIT_WORK_TREE: other.main },
    });
    expect(identity.root).toBe(resolveWorkspaceIdentity(main).root);
  });

  it("treats a plain directory as its own project", () => {
    const dir = tempDir("bridge-plain-");
    const identity = resolveWorkspaceIdentity(dir);
    expect(identity.kind).toBe("directory");
    expect(identity.project_key).toBe(identity.root);
    expect(identity.git_dir).toBeNull();
  });
});

describe("workspace state records", () => {
  it("classifies a copied marker, a foreign owner and a second database", () => {
    const { main, second } = repoWithWorktree();
    const a = resolveWorkspaceIdentity(main);
    const b = resolveWorkspaceIdentity(second);
    const dbA = resolveDatabasePath(a);
    mkdirSync(stateDirectory(a), { recursive: true }); // the authorized path does this first
    publishReservation(a, "ws_a", dbA, probeWorkspaceState(a, dbA));

    // The same marker inside another worktree names a foreign root.
    mkdirSync(stateDirectory(b), { recursive: true });
    writeFileSync(join(stateDirectory(b), "workspace.json"), readFileSync(join(stateDirectory(a), "workspace.json")));
    expect(() => assertProbeUsable(b, probeWorkspaceState(b, resolveDatabasePath(b)))).toThrowError(
      /belongs to/u,
    );

    // A second database for one worktree is refused by the marker.
    expect(() => assertProbeUsable(a, probeWorkspaceState(a, join(stateDirectory(a), "other.db")))).toThrowError(
      /second database/iu,
    );
  });

  it("accepts its own interrupted temp file but fails closed on unexplained state", () => {
    const { main } = repoWithWorktree();
    const identity = resolveWorkspaceIdentity(main);
    const db = resolveDatabasePath(identity);
    const dir = stateDirectory(identity);
    mkdirSync(dir, { recursive: true });
    const nonce = "a1b2c3d4e5f6";
    // Death after the temp write, before the link: a *complete* protocol record naming this
    // worktree, with the nonce from its own filename, is explained state.
    writeFileSync(
      join(dir, `workspace.json.${nonce}.tmp`),
      JSON.stringify({
        schema_version: 1,
        workspace_id: "ws_test",
        kind: identity.kind,
        root: identity.root,
        git_dir: identity.git_dir,
        git_common_dir: identity.git_common_dir,
        database: db,
        state: "reserving",
        reservation_nonce: nonce,
        created_at: new Date().toISOString(),
      }),
    );
    const probe = probeWorkspaceState(identity, db);
    expect(() => assertStateDirectoryExplained(identity, db, probe)).not.toThrow();

    // A file that merely matches the pattern is not evidence, and neither is a partial record
    // or one that names a different worktree.
    writeFileSync(join(dir, "workspace.json.deadbeef00.tmp"), "not json");
    expect(() => assertStateDirectoryExplained(identity, db, probe)).toThrowError(/unexplained/u);
    rmSync(join(dir, "workspace.json.deadbeef00.tmp"));

    const partialNonce = "bbbbccccdddd";
    writeFileSync(
      join(dir, `workspace.json.${partialNonce}.tmp`),
      JSON.stringify({ schema_version: 1, root: identity.root, reservation_nonce: partialNonce, state: "reserving" }),
    );
    expect(() => assertStateDirectoryExplained(identity, db, probe)).toThrowError(/unexplained/u);
  });

  it("refuses a legacy database that has history and no binding", () => {
    const { main } = repoWithWorktree();
    const identity = resolveWorkspaceIdentity(main);
    const db = resolveDatabasePath(identity);
    mkdirSync(stateDirectory(identity), { recursive: true });
    const store = new SqliteStateStore({ path: db });
    store.appendEvent({ type: "task.created" as never, task_id: null, agent: "codex", payload: {} }, 1);
    // Simulate a pre-isolation database: drop the binding table entirely.
    (store as unknown as { db: { exec(sql: string): void } }).db.exec("DROP TABLE workspace_binding");
    store.close();
    expect(() => assertProbeUsable(identity, probeWorkspaceState(identity, db))).toThrowError(
      /adopt it explicitly/u,
    );
  });
});

describe("worktree critical section", () => {
  it("excludes a second holder and is released when the holder dies", async () => {
    const { main } = repoWithWorktree();
    const identity = resolveWorkspaceIdentity(main);
    const script = join(tempDir("bridge-hold-"), "hold.mjs");
    writeFileSync(
      script,
      `import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(${JSON.stringify(join(stateDirectory(identity), "state.lockdb"))});
db.exec("PRAGMA busy_timeout = 200");
db.exec("BEGIN IMMEDIATE");
process.stdout.write("HELD\\n");
setInterval(() => {}, 1000);
`,
    );
    mkdirSync(stateDirectory(identity), { recursive: true });
    const holder = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "pipe"] });
    await new Promise<void>((done, fail) => {
      holder.stdout.on("data", (chunk: Buffer) => chunk.toString().includes("HELD") && done());
      holder.once("exit", () => fail(new Error("holder exited early")));
    });

    expect(() => WorktreeCriticalSection.acquire(identity, 200)).toThrowError(/holds this worktree/u);

    holder.kill("SIGKILL");
    await new Promise((done) => holder.once("exit", done));
    // The kernel released the lock: no cleanup step, no PID inspection.
    const section = WorktreeCriticalSection.acquire(identity, 200);
    section.release();
  });
});

describe("manager instance history", () => {
  function registry(): { store: SqliteStateStore; registry: ManagerRegistry } {
    const dir = tempDir("bridge-mgr-");
    const store = new SqliteStateStore({ path: join(dir, "state.db") });
    cleanup.push(() => store.close());
    let now = 1;
    return { store, registry: new ManagerRegistry(store, { now: () => now++ }) };
  }
  const native = (thread: string) => ({
    thread_id: thread,
    session_id: thread,
    meta_thread_id: thread,
    codex_version: "0.154.0",
    adapter_id: "codex-0.154.0",
    thread_source: null,
    forked_from_thread_id: null,
  });

  it("allows explicit reactivation I1 -> I2 -> I1 and keeps every activation row", () => {
    const { store, registry: reg } = registry();
    reg.bindFirstCall({ native: native("T1"), role: "codex", instanceId: "I1", workspaceId: "ws" });
    reg.resumeInstance({ native: native("T1"), instanceId: "I2", expectedEpoch: 1, expectedGeneration: 1 });
    const back = reg.resumeInstance({
      native: native("T1"),
      instanceId: "I1",
      expectedEpoch: 1,
      expectedGeneration: 2,
    });
    expect(back.binding.active_instance_id).toBe("I1");
    expect(store.listManagerInstances(1).map((row) => row.instance_id)).toEqual(["I1", "I2", "I1"]);
  });

  it("fences a non-active instance, adopts only a fresh one after a clean detach", () => {
    const { registry: reg } = registry();
    reg.bindFirstCall({ native: native("T1"), role: "codex", instanceId: "I1", workspaceId: "ws" });
    expect(() => reg.authorizeMutation(native("T1"), "I2")).toThrowError(/active instance/u);

    reg.resumeInstance({ native: native("T1"), instanceId: "I2", expectedEpoch: 1, expectedGeneration: 1 });
    reg.detach("I2");
    // I1 already appears in this epoch: automatic adoption must not resurrect it.
    expect(() => reg.authorizeMutation(native("T1"), "I1")).toThrowError(/active instance/u);
    // A fresh connection of the same thread adopts tokenlessly.
    expect(reg.authorizeMutation(native("T1"), "I3").adopted).toBe(true);
  });

  it("rejects a stale handoff across an epoch change (ABA) and no-ops a same-instance handoff", () => {
    const { registry: reg } = registry();
    reg.bindFirstCall({ native: native("T1"), role: "codex", instanceId: "I1", workspaceId: "ws" });
    reg.takeover({
      native: native("T2"),
      role: "codex",
      instanceId: "I9",
      workspaceId: "ws",
      expectedThreadId: "T1",
      expectedEpoch: 1,
      reason: "operator switched sessions",
    });
    const back = reg.takeover({
      native: native("T1"),
      role: "codex",
      instanceId: "I1",
      workspaceId: "ws",
      expectedThreadId: "T2",
      expectedEpoch: 2,
      reason: "returning",
    });
    expect(back.epoch).toBe(3);
    // A delayed handoff from the first epoch carries (epoch 1, generation 1) and must fail even
    // though the current generation is also 1.
    expect(() =>
      reg.resumeInstance({ native: native("T1"), instanceId: "I5", expectedEpoch: 1, expectedGeneration: 1 }),
    ).toThrowError(/stale/u);

    const noop = reg.resumeInstance({
      native: native("T1"),
      instanceId: "I1",
      expectedEpoch: 3,
      expectedGeneration: 1,
    });
    expect(noop.changed).toBe(false);
    expect(noop.binding.instance_generation).toBe(1);
  });

  it("fences the superseded thread and refuses a foreign one", () => {
    const { registry: reg } = registry();
    reg.bindFirstCall({ native: native("T1"), role: "codex", instanceId: "I1", workspaceId: "ws" });
    expect(() => reg.authorizeMutation(native("T9"), "I9")).toThrowError(/another native session/u);
    reg.takeover({
      native: native("T2"),
      role: "codex",
      instanceId: "I2",
      workspaceId: "ws",
      expectedThreadId: "T1",
      expectedEpoch: 1,
      reason: "switch",
    });
    expect(() => reg.authorizeMutation(native("T1"), "I1")).toThrowError(/superseded/u);
  });
});
