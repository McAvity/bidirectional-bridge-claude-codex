/**
 * F-W19 W19-03: workflow binding, schema 7, admission, switch, crash recovery, legacy and
 * recovery acknowledgment (R19-C02). Real files: the committed W19-02 bundle is published into a
 * disposable bridge home; locks live in a disposable worktree; SQLite is a real file reopened to
 * prove restart behaviour. No model, no network.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { AdapterHealth, DeliverableStatus, TaskState, type AgentAdapter, type TaskInvocation, type TaskSpec } from "@bridge/protocol";
import { ControlPlane } from "./control-plane.js";
import { FeatureWorkflow } from "./feature-workflow.js";
import { Orchestrator } from "./orchestrator.js";
import { SqliteStateStore } from "./store/sqlite-store.js";
import { LEGACY_PROFILES, loadWorkflowStore, type WorkflowStorePort } from "./workflow-binding.js";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SOURCE_BUNDLE = join(REPO, "plugins/feature-workflow-claude/bundle");
const OLD_COMMIT = "6ed9a4537e376165aa72bbd5a52cb0c41988a90a";
const OLD_ID = "0.7.0-6ed9a4537e37";
const spec: TaskSpec = { objective: "deliver", scope: { paths: ["feature/**"] }, dependencies: [], expected_deliverable: "package", verification_criteria: ["test passes"] };

let port: WorkflowStorePort;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lib: any;
beforeAll(async () => {
  port = await loadWorkflowStore();
  lib = port.lib;
});

const cleanup: (() => void)[] = [];
afterEach(() => { for (const f of cleanup.splice(0).reverse()) f(); });

function bundleFrom(dir: string, version: string, mutate: (variants: Record<string, Record<string, { data: Buffer; mode: string }>>) => void, requires?: unknown) {
  const source = lib.verifyBundle(SOURCE_BUNDLE);
  const variants = { claude: lib.readVariant(join(SOURCE_BUNDLE, "claude")), codex: lib.readVariant(join(SOURCE_BUNDLE, "codex")) };
  mutate(variants);
  const manifest = lib.bundleManifest({ version, requires: requires ?? source.requires, variants, source: { repository: null, commit: null } });
  lib.writeBundle(dir, manifest, variants);
  return manifest;
}

function fixture(name = "ws") {
  const dir = mkdtempSync(join(tmpdir(), "w19-03-"));
  cleanup.push(() => { lib.makeWritable(dir); rmSync(dir, { recursive: true, force: true }); });
  const home = join(dir, "home");
  const env = { ...process.env, CLAUDE_CODEX_BRIDGE_HOME: home };
  const store = join(home, "workflows");
  const A = lib.verifyBundle(SOURCE_BUNDLE);
  lib.storePublish(store, SOURCE_BUNDLE);
  const B = bundleFrom(join(dir, "B"), "1.0.1", (v) => {
    v.claude!["skills/feature-plan/SKILL.md"] = { data: Buffer.from("---\nname: feature-plan\ndescription: B\n---\nworkflow B\n"), mode: "644" };
  });
  lib.storePublish(store, join(dir, "B"));
  const C = bundleFrom(join(dir, "C"), "9.0.0", () => {}, { ...A.requires, bridge: { ...A.requires.bridge, capabilities: [...A.requires.bridge.capabilities, "workflow.future/v9"] } });
  lib.storePublish(store, join(dir, "C"));
  return { dir, home, env, store, A, B, C, ...worktree(dir, name, env) };
}

function worktree(dir: string, name: string, env: NodeJS.ProcessEnv) {
  const ws = join(dir, name);
  mkdirSync(join(ws, "docs/features"), { recursive: true });
  const seen: TaskInvocation[] = [];
  const behavior = { gate: undefined as Promise<void> | undefined, partial: false, sleepMs: 0 };
  const adapter: AgentAdapter = {
    info: { agent: "claude", implementation: "fixture", version: "1", capabilities: ["resume"], max_concurrency: 1 },
    async health() { return { status: AdapterHealth.READY, checked_at: Date.now() }; },
    async cancel() {},
    async invoke(i, ctx) {
      seen.push(i);
      await ctx.saveExecutionHandle(i.previous_execution_handle ?? `session-${name}`);
      if (behavior.gate) await behavior.gate;
      if (behavior.sleepMs) await new Promise((r) => setTimeout(r, behavior.sleepMs));
      const v = { kind: "test" as const, command: "fixture", passed: true, exit_code: 0, summary: "pass" };
      return { task_id: i.task_id, agent: "claude", status: behavior.partial ? DeliverableStatus.PARTIAL : DeliverableStatus.COMPLETE,
        summary: "package", changed_scope: [], artifacts: [], commit_or_diff: null, verification_performed: [v.command],
        verification_results: [v], remaining_risks: behavior.partial ? ["blocked"] : [], dependencies_unblocked: [], recommended_next_action: "review", at: Date.now() };
    },
  };
  function open({ binding = true, profiles }: { binding?: boolean; profiles?: typeof LEGACY_PROFILES } = {}) {
    const cp = ControlPlane.open({ databasePath: join(dir, `${name}.db`), workspaceRoot: ws });
    cp.adapters.register(adapter);
    cleanup.push(() => cp.close());
    if (binding) cp.enableWorkflowBinding(port, { env, ...(profiles ? { legacyProfiles: profiles } : {}) });
    const orchestrator = new Orchestrator(cp);
    return { cp, orchestrator, flow: new FeatureWorkflow(cp, orchestrator) };
  }
  const first = open();
  const parent = first.cp.tasks.create({ spec: { ...spec, scope: { paths: ["manager/**"] } }, created_by: "codex" });
  first.cp.tasks.claim(parent.task_id, "codex");
  return { ws, seen, behavior, open, parent, ...first };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lockFor(ws: string, feature: string, manifest: any) {
  const dir = join(ws, "docs/features", feature);
  mkdirSync(dir, { recursive: true });
  lib.writeLock(dir, lib.newLock(manifest, { origin: { kind: "active-plugin", client: "codex", plugin_version: manifest.version }, at: "2026-11-06T00:00:00Z", featureId: feature }));
  return `docs/features/${feature}/workflow.lock.json`;
}

const round = (feature: string, key: string, ack?: string | null) =>
  ({ feature_id: feature, manager: "codex", spec, input_artifacts: [], deadline_ms: 5000, idempotency_key: key, ...(ack !== undefined && ack !== null ? { workflow_identity: ack } : {}) });

async function refusal(promise: Promise<unknown> | (() => unknown)): Promise<string> {
  try {
    await (typeof promise === "function" ? promise() : promise);
  } catch (error) {
    const e = error as { code?: string; details?: { code?: string } };
    return e.code === "WORKFLOW_REFUSED" ? String(e.details?.code) : String(e.code);
  }
  return "NO_REFUSAL";
}

function bound(f: ReturnType<typeof fixture>, feature = "F-1", manifest = f.A) {
  f.flow.create(feature, "codex", f.parent.task_id);
  const lock_path = lockFor(f.ws, feature, manifest);
  f.cp.workflows!.bind({ feature_id: feature, manager: "codex", lock_path, expected_identity: manifest.identity, idempotency_key: `bind-${feature}` });
  return lock_path;
}

describe("schema 7", () => {
  it("migrates a schema-6 database without rewriting history; readonly opening never migrates", () => {
    const dir = mkdtempSync(join(tmpdir(), "w19-03-schema-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, "bridge.db");
    new SqliteStateStore({ path }).close();
    const raw = new DatabaseSync(path);
    raw.exec("DROP TABLE attempt_workflow; UPDATE schema_meta SET value='6' WHERE key='schema_version'");
    raw.exec("INSERT INTO features(feature_id, json) VALUES('F-old', '{\"feature_id\":\"F-old\",\"manager\":\"codex\",\"state\":\"ready\"}')");
    raw.close();
    const ro = new SqliteStateStore({ path, mode: "readonly" });
    expect(ro.schemaVersion()).toBe(6);
    ro.close();
    const rw = new SqliteStateStore({ path });
    expect(rw.schemaVersion()).toBe(7);
    expect(rw.getFeature("F-old")?.workflow).toBeUndefined(); // no workflow is assigned by migration
    expect(rw.listAttemptWorkflows("task_x")).toEqual([]);
    rw.close();
    expect(SqliteStateStore.schemaVersionSupported).toBe(7);
  });
});

describe("binding and round admission", () => {
  it("refuses an unbound feature before any task or worker; not-configured servers keep pre-binding behaviour", async () => {
    const f = fixture();
    f.flow.create("F-1", "codex", f.parent.task_id);
    expect(await refusal(f.flow.run(round("F-1", "r1")))).toBe("WORKFLOW_UNBOUND");
    expect(f.cp.tasks.list().map((t) => t.task_id)).toEqual([f.parent.task_id]);
    expect(f.seen).toHaveLength(0);
    const plain = f.open({ binding: false });
    expect(await refusal(plain.flow.run(round("F-1", "r2", f.A.identity)))).toBe("UNIMPLEMENTED");
  });

  it("binds a verified lock, requires the exact ack, records per-attempt identity and replays without re-admission", async () => {
    const f = fixture();
    const lock_path = bound(f);
    expect(f.cp.workflows!.bind({ feature_id: "F-1", manager: "codex", lock_path, expected_identity: f.A.identity, idempotency_key: "bind-F-1" }).replayed).toBe(true);
    expect(await refusal(f.flow.run(round("F-1", "r1")))).toBe("WORKFLOW_ACK_REQUIRED");
    expect(await refusal(f.flow.run(round("F-1", "r1", f.B.identity)))).toBe("WORKFLOW_ACK_MISMATCH");
    expect(f.seen).toHaveLength(0);
    const first = await f.flow.run(round("F-1", "r1", f.A.identity));
    expect(first.task.state).toBe(TaskState.DONE);
    expect(f.cp.store.listAttemptWorkflows(first.task.task_id)).toEqual([expect.objectContaining({ attempt: 0, identity: f.A.identity, generation: 1, feature_id: "F-1" })]);
    expect(f.seen[0]!.workflow).toMatchObject({ identity: f.A.identity, generation: 1, client_root: join(lib.canonicalAnchor(f.store), f.A.workflow_id, "claude") });
    expect(existsSync(join(f.seen[0]!.workflow!.client_root, "skills/feature-execute/SKILL.md"))).toBe(true);
    const replay = await f.flow.run(round("F-1", "r1", f.A.identity));
    expect(replay.replayed).toBe(true);
    expect(f.seen).toHaveLength(1);
  });

  it("refuses wrong, corrupt, incompatible or redirected bind inputs without changing the feature", async () => {
    const f = fixture();
    f.flow.create("F-1", "codex", f.parent.task_id);
    const bindIt = (lock_path: string, expected_identity: string, key: string) => () =>
      f.cp.workflows!.bind({ feature_id: "F-1", manager: "codex", lock_path, expected_identity, idempotency_key: key });
    const lockA = lockFor(f.ws, "F-1", f.A);
    expect(await refusal(bindIt(lockA, f.B.identity, "k1"))).toBe("WORKFLOW_LOCK_MISMATCH");
    expect(await refusal(bindIt("../outside/workflow.lock.json", f.A.identity, "k2"))).toBe("FEATURE_PATH_OUTSIDE");
    lockFor(f.ws, "F-C", f.C);
    expect(await refusal(bindIt("docs/features/F-C/workflow.lock.json", f.C.identity, "k3"))).toBe("WORKFLOW_INCOMPATIBLE");
    mkdirSync(join(f.dir, "elsewhere"));
    const { symlinkSync } = await import("node:fs");
    symlinkSync(join(f.dir, "elsewhere"), join(f.ws, "docs/features/F-link"));
    expect(await refusal(bindIt("docs/features/F-link/workflow.lock.json", f.A.identity, "k4"))).toBe("PATH_REDIRECTED");
    const damaged = join(f.store, f.A.workflow_id, "claude/workflow/README.md");
    chmodSync(dirname(damaged), 0o755); chmodSync(damaged, 0o644); writeFileSync(damaged, "tampered\n");
    expect(await refusal(bindIt(lockA, f.A.identity, "k5"))).toBe("BUNDLE_CORRUPT");
    expect(f.cp.store.getFeature("F-1")?.workflow).toBeUndefined();
  });

  it("refuses a round whose bundle disappeared after binding, before any task or worker", async () => {
    const f = fixture();
    bound(f);
    lib.makeWritable(join(f.store, f.A.workflow_id));
    rmSync(join(f.store, f.A.workflow_id), { recursive: true });
    expect(await refusal(f.flow.run(round("F-1", "r1", f.A.identity)))).toBe("BUNDLE_MISSING");
    expect(f.cp.tasks.list()).toHaveLength(1);
    expect(f.seen).toHaveLength(0);
    expect(f.cp.workflows!.status("F-1")).toMatchObject({ bundle: "missing:BUNDLE_MISSING" });
  });
});

describe("switch", () => {
  it("refuses a busy, blocked, waiting or stale feature; switches between rounds and requires the new ack", async () => {
    const f = fixture();
    const lock_path = bound(f);
    const sw = (key: string, gen = 1, target = f.B.identity) => () =>
      f.cp.workflows!.switch({ feature_id: "F-1", manager: "codex", target_identity: target, expected_generation: gen, idempotency_key: key });
    let release!: () => void;
    f.behavior.gate = new Promise((r) => { release = r; });
    const running = f.flow.run(round("F-1", "r1", f.A.identity));
    await new Promise((r) => setTimeout(r, 20));
    expect(await refusal(sw("s-active"))).toBe("WORKFLOW_SWITCH_ACTIVE_ATTEMPT");
    release(); f.behavior.gate = undefined;
    const first = await running;
    expect(f.seen[0]!.workflow?.identity).toBe(f.A.identity); // the active worker kept its instructions
    expect(await refusal(sw("s-stale", 0))).toBe("WORKFLOW_GENERATION_CONFLICT");
    expect(await refusal(sw("s-incompatible", 1, f.C.identity))).toBe("WORKFLOW_INCOMPATIBLE");
    f.flow.waitUser("F-1", "codex", "q1", "Which?");
    expect(await refusal(sw("s-wait"))).toBe("WORKFLOW_SWITCH_WAITING_USER");
    f.flow.answerUser("F-1", "codex", "q1", "B");
    const result = await sw("s-1")() as Record<string, unknown>;
    expect(result).toMatchObject({ result: "SWITCHED", generation: 2, identity: f.B.identity, from_identity: f.A.identity });
    expect((await sw("s-1")() as { replayed: boolean }).replayed).toBe(true);
    const lock = lib.readLock(join(f.ws, dirname(lock_path)));
    expect(lock).toMatchObject({ generation: 2, workflow: { identity: f.B.identity }, origin: { kind: "switch", from_identity: f.A.identity } });
    expect(lock.history.map((h: { op: string }) => h.op)).toEqual(["begin", "switch"]);
    expect(f.cp.workflows!.status("F-1")).toMatchObject({ lock_state: "in-sync", binding: { generation: 2 } });
    expect(await refusal(f.flow.run(round("F-1", "r2", f.A.identity)))).toBe("WORKFLOW_ACK_MISMATCH");
    const second = await f.flow.run(round("F-1", "r2", f.B.identity));
    expect(f.cp.store.listAttemptWorkflows(second.task.task_id)[0]).toMatchObject({ identity: f.B.identity, generation: 2 });
    expect(f.cp.store.listAttemptWorkflows(first.task.task_id)[0]).toMatchObject({ identity: f.A.identity, generation: 1 }); // history kept
    // A BLOCKED round must be settled under its own workflow before another switch.
    f.behavior.partial = true;
    await f.flow.run(round("F-1", "r3", f.B.identity));
    expect(await refusal(() => f.cp.workflows!.switch({ feature_id: "F-1", manager: "codex", target_identity: f.A.identity, expected_generation: 2, idempotency_key: "s-blocked" })))
      .toBe("WORKFLOW_SWITCH_ACTIVE_ATTEMPT");
  });

  it("survives a crash between commit and projection: rounds blocked, status pending, restart and retry finish exactly once", async () => {
    const f = fixture();
    const lock_path = bound(f);
    await f.flow.run(round("F-1", "r1", f.A.identity));
    let crash = true;
    const crashing = f.open({ binding: false });
    crashing.cp.enableWorkflowBinding(port, { env: f.env, beforeProjection: () => { if (crash) throw new Error("simulated crash before projection"); } });
    await expect(async () => crashing.cp.workflows!.switch({ feature_id: "F-1", manager: "codex", target_identity: f.B.identity, expected_generation: 1, idempotency_key: "s-crash" }))
      .rejects.toThrow("simulated crash");
    expect(lib.readLock(join(f.ws, dirname(lock_path))).generation).toBe(1); // projection not written
    const restarted = f.open();
    expect(restarted.cp.workflows!.status("F-1")).toMatchObject({ lock_state: "switch-pending:switch", binding: { generation: 2 } });
    expect(await refusal(restarted.flow.run(round("F-1", "r2", f.B.identity)))).toBe("WORKFLOW_SWITCH_PENDING");
    expect(await refusal(() => restarted.cp.workflows!.switch({ feature_id: "F-1", manager: "codex", target_identity: f.A.identity, expected_generation: 2, idempotency_key: "other" })))
      .toBe("WORKFLOW_SWITCH_PENDING");
    crash = false;
    const done = restarted.cp.workflows!.switch({ feature_id: "F-1", manager: "codex", target_identity: f.B.identity, expected_generation: 1, idempotency_key: "s-crash" });
    expect(done).toMatchObject({ result: "SWITCHED", generation: 2 });
    const binding = restarted.cp.store.getFeature("F-1")!.workflow!;
    expect(binding.history.filter((h) => h.op === "switch")).toHaveLength(1);
    expect(binding.pending_projection).toBeNull();
    expect(lib.readLock(join(f.ws, dirname(lock_path)))).toMatchObject({ generation: 2, workflow: { identity: f.B.identity } });
    expect((await restarted.flow.run(round("F-1", "r2", f.B.identity))).task.state).toBe(TaskState.DONE);
  });

  it("finishes a projection whose file was written before the crash, and refuses a diverged lock", async () => {
    const f = fixture();
    const lock_path = bound(f);
    const dir = join(f.ws, dirname(lock_path));
    const crashing = f.open({ binding: false });
    crashing.cp.enableWorkflowBinding(port, { env: f.env, beforeProjection: () => { throw new Error("crash"); } });
    await expect(async () => crashing.cp.workflows!.switch({ feature_id: "F-1", manager: "codex", target_identity: f.B.identity, expected_generation: 1, idempotency_key: "s" })).rejects.toThrow();
    // Simulate: the lock file write had completed, only clearing the marker was lost.
    const lock = lib.readLock(dir);
    lib.writeLock(dir, { ...lock, workflow: { version: f.B.version, identity: f.B.identity, workflow_id: f.B.workflow_id, kind: "release" }, generation: 2,
      origin: { kind: "switch", from_identity: f.A.identity }, history: [...lock.history, { generation: 2, op: "switch", version: f.B.version, identity: f.B.identity, origin: "switch", at: "2026-11-06T00:00:01Z" }] });
    expect(f.cp.workflows!.project({ feature_id: "F-1", manager: "codex" })).toMatchObject({ result: "SWITCHED", generation: 2 });
    expect(f.cp.workflows!.status("F-1")).toMatchObject({ lock_state: "in-sync" });
    // A hand-edited lock that disagrees is reported and never overwritten.
    const before = readFileSync(join(dir, "workflow.lock.json"));
    lib.writeLock(dir, lib.newLock(f.C, { origin: { kind: "active-plugin", client: "codex", plugin_version: f.C.version }, at: "2026-11-06T00:00:02Z", featureId: "F-1" }));
    expect(f.cp.workflows!.status("F-1")).toMatchObject({ lock_state: "projection-behind" });
    expect(await refusal(() => f.cp.workflows!.project({ feature_id: "F-1", manager: "codex" }))).toBe("LOCK_DIVERGED");
    expect(readFileSync(join(dir, "workflow.lock.json"))).not.toEqual(before);
  });
});

describe("recovery acknowledgment (R19-C02)", () => {
  it("requires the task's own workflow for BLOCKED recovery and never adopts a newer selection on replay", async () => {
    const f = fixture();
    bound(f);
    f.behavior.partial = true;
    const first = await f.flow.run(round("F-1", "r1", f.A.identity));
    expect(first.task.state).toBe(TaskState.BLOCKED);
    f.behavior.partial = false;
    const resume = (ack?: string, key = "rec-1") => f.orchestrator.resumeDelegatedTask({ task_id: first.task.task_id, requested_by: "codex", idempotency_key: key, message: "continue", ...(ack ? { workflow_identity: ack } : {}) });
    expect(await refusal(resume())).toBe("WORKFLOW_ACK_REQUIRED");
    expect(await refusal(resume(f.B.identity))).toBe("WORKFLOW_ACK_MISMATCH");
    expect(f.cp.attempts.list(first.task.task_id)).toHaveLength(1);
    const recovered = await resume(f.A.identity);
    expect(recovered.state).toBe(TaskState.DONE);
    expect(f.cp.store.listAttemptWorkflows(first.task.task_id).map((r) => [r.attempt, r.identity, r.generation])).toEqual([[0, f.A.identity, 1], [1, f.A.identity, 1]]);
    expect(f.seen.at(-1)!.workflow?.identity).toBe(f.A.identity);
    const calls = f.seen.length;
    const replay = await resume(f.A.identity);
    expect(replay.recovered_attempt).toBe(1);
    expect(f.seen).toHaveLength(calls); // replay launches nothing and re-admits nothing
  });

  it("acknowledges explicit terminal TIMEOUT recovery and refuses it without the ack", async () => {
    const f = fixture();
    bound(f);
    f.behavior.sleepMs = 300;
    const first = await f.flow.run({ ...round("F-1", "r1", f.A.identity), deadline_ms: 50 });
    expect(f.cp.tasks.get(first.task.task_id).state).toBe(TaskState.FAILED);
    f.behavior.sleepMs = 0;
    await new Promise((r) => setTimeout(r, 400));
    const timeout = (ack?: string) => f.orchestrator.resumeDelegatedTask({ task_id: first.task.task_id, requested_by: "codex", recover_timeout: true, deadline_ms: 5000, idempotency_key: "t-1", ...(ack ? { workflow_identity: ack } : {}) });
    expect(await refusal(timeout())).toBe("WORKFLOW_ACK_REQUIRED");
    const recovered = await timeout(f.A.identity);
    expect(recovered.recovery_mode).toBe("timeout");
    expect(f.cp.store.getAttemptWorkflow(first.task.task_id, recovered.recovered_attempt)).toMatchObject({ identity: f.A.identity });
  });
});

describe("two worktrees, one store", () => {
  it("admits each feature with its own release from the shared store", async () => {
    const f = fixture("ws-a");
    bound(f, "F-1", f.A);
    const other = worktree(f.dir, "ws-b", f.env);
    other.flow.create("F-2", "codex", other.parent.task_id);
    const lock_path = lockFor(other.ws, "F-2", f.B);
    other.cp.workflows!.bind({ feature_id: "F-2", manager: "codex", lock_path, expected_identity: f.B.identity, idempotency_key: "b" });
    await f.flow.run(round("F-1", "r", f.A.identity));
    await other.flow.run(round("F-2", "r", f.B.identity));
    expect(f.seen[0]!.workflow!.identity).toBe(f.A.identity);
    expect(other.seen[0]!.workflow!.identity).toBe(f.B.identity);
    expect(await refusal(other.flow.run(round("F-2", "r2", f.A.identity)))).toBe("WORKFLOW_ACK_MISMATCH");
  });
});

describe("legacy binding", () => {
  function oldRuntime(home: string): string {
    const dir = join(home, "runtimes", OLD_ID);
    mkdirSync(dir, { recursive: true });
    const tar = execFileSync("git", ["-C", REPO, "archive", "--format=tar", OLD_COMMIT, ".agents/skills", ".codex/skills/using-bridge", ".claude/skills/using-bridge", "docs/features/README.md"], { maxBuffer: 1 << 28 });
    execFileSync("tar", ["-x", "-C", dir], { input: tar });
    const files = execFileSync("git", ["-C", REPO, "ls-tree", "-r", "--name-only", OLD_COMMIT, "--", ".agents/skills", ".codex/skills/using-bridge", ".claude/skills/using-bridge", "docs/features/README.md"], { encoding: "utf8" })
      .trim().split("\n").sort().map((path) => ({ path, sha256: lib.sha256(readFileSync(join(dir, path))) }));
    const set = lib.sha256(files.map((x: { path: string; sha256: string }) => `${x.path}\0${x.sha256}\n`).join(""));
    writeFileSync(join(dir, "runtime-manifest.json"), JSON.stringify({ format: "claude-codex-bridge.runtime/v1", runtime_id: OLD_ID, package_version: "0.7.0", source: { commit: OLD_COMMIT }, instructions: { set_sha256: set, files } }));
    return set;
  }

  it("reproduces the profiled 0.7.0 set from Git, binds only workflow-owned files and recovers a pre-binding task under it", async () => {
    const f = fixture();
    const set = oldRuntime(f.home);
    expect(LEGACY_PROFILES[set]?.runtime_id).toBe(OLD_ID); // the profile key is the real 0.7.0 set
    // A pre-binding feature: rounds ran before this runtime had binding enabled.
    const legacyEra = f.open({ binding: false });
    legacyEra.flow.create("F-L", "codex", f.parent.task_id);
    f.behavior.partial = true;
    const blocked = await legacyEra.flow.run(round("F-L", "old-1"));
    f.behavior.partial = false;
    mkdirSync(join(f.ws, "docs/features/F-L/execution/W-1"), { recursive: true });
    writeFileSync(join(f.ws, "docs/features/F-L/execution/W-1/01.md"), `Record: \`INSTRUCTIONS=runtime:${OLD_ID} SET=${set}\`\n`);
    const w = f.cp.workflows!;
    const legacy = (extra: Record<string, unknown> = {}) => w.bindLegacy({ feature_id: "F-L", manager: "codex", feature_dir: "docs/features/F-L", runtime_id: OLD_ID, expected_set_sha256: set, idempotency_key: "L", ...extra });
    expect(await refusal(w.bindLegacy({ feature_id: "F-L", manager: "codex", feature_dir: "docs/features/F-L", runtime_id: OLD_ID, expected_set_sha256: "0".repeat(64), idempotency_key: "L0" }))).toBe("LEGACY_EVIDENCE_MISMATCH");
    const noProfile = f.open({ binding: false });
    noProfile.cp.enableWorkflowBinding(port, { env: f.env, legacyProfiles: {} });
    expect(await refusal(noProfile.cp.workflows!.bindLegacy({ feature_id: "F-L", manager: "codex", feature_dir: "docs/features/F-L", runtime_id: OLD_ID, expected_set_sha256: set, idempotency_key: "L1" }))).toBe("LEGACY_UNPROVEN");
    expect(noProfile.cp.store.getFeature("F-L")!.workflow).toBeUndefined();
    const result = await legacy();
    expect(result).toMatchObject({ result: "BOUND_LEGACY", generation: 1 });
    const binding = f.cp.store.getFeature("F-L")!.workflow!;
    expect(binding).toMatchObject({ kind: "legacy", legacy: { runtime_id: OLD_ID, instructions_set_sha256: set, basis: "ledger INSTRUCTIONS record" } });
    const manifest = lib.verifyBundle(join(f.store, binding.workflow_id), binding.identity);
    expect(manifest.files.some((x: { path: string }) => /using-bridge|bridge-upgrade/u.test(x.path))).toBe(false);
    expect(manifest.files.some((x: { path: string }) => x.path === "claude/skills/feature-execute/references/multi-repo.md")).toBe(true);
    expect(lib.readLock(join(f.ws, "docs/features/F-L"))).toMatchObject({ origin: { kind: "legacy-bind" }, workflow: { identity: binding.identity } });
    expect(w.status("F-L")).toMatchObject({ lock_state: "in-sync" });
    expect((await legacy()).replayed).toBe(true);
    // The BLOCKED pre-binding task is recovered under its proven legacy set, never the latest.
    expect(await refusal(f.orchestrator.resumeDelegatedTask({ task_id: blocked.task.task_id, requested_by: "codex", idempotency_key: "lr", message: "go", workflow_identity: f.A.identity }))).toBe("WORKFLOW_ACK_MISMATCH");
    const rec = await f.orchestrator.resumeDelegatedTask({ task_id: blocked.task.task_id, requested_by: "codex", idempotency_key: "lr", message: "go", workflow_identity: binding.identity });
    expect(f.cp.store.getAttemptWorkflow(blocked.task.task_id, rec.recovered_attempt)).toMatchObject({ identity: binding.identity, kind: "legacy" });
  });

  it("refuses ambiguous, unproven, missing or mismatched legacy sources unless the user explicitly chooses an installed set", async () => {
    const f = fixture();
    const set = oldRuntime(f.home);
    for (const name of ["F-amb", "F-unp", "F-miss"]) f.flow.create(name, "codex", f.parent.task_id);
    const ledger = (name: string, text: string) => { mkdirSync(join(f.ws, "docs/features", name, "execution/W"), { recursive: true }); writeFileSync(join(f.ws, "docs/features", name, "execution/W/01.md"), text); };
    ledger("F-amb", `\`INSTRUCTIONS=runtime:${OLD_ID} SET=${set}\` and \`INSTRUCTIONS=runtime:0.6.2-771e797a73d3 SET=${"5".repeat(64)}\``);
    mkdirSync(join(f.ws, "docs/features/F-unp"), { recursive: true });
    ledger("F-miss", "`INSTRUCTIONS=runtime:0.6.2-771e797a73d3 SET=5961e6804bdde8fba699388c2206a90e7e6ecf880919650946812c2cf784bb74`");
    const w = f.cp.workflows!;
    const bind = (feature: string, extra: Record<string, unknown> = {}) => w.bindLegacy({ feature_id: feature, manager: "codex", feature_dir: `docs/features/${feature}`, runtime_id: OLD_ID, expected_set_sha256: set, idempotency_key: `k-${feature}-${JSON.stringify(extra)}`, ...extra });
    expect(await refusal(bind("F-amb"))).toBe("LEGACY_AMBIGUOUS");
    expect(await refusal(bind("F-unp"))).toBe("LEGACY_UNPROVEN");
    expect(await refusal(bind("F-miss"))).toBe("LEGACY_SOURCE_MISSING");
    expect(f.cp.store.getFeature("F-amb")!.workflow).toBeUndefined();
    expect((await bind("F-amb", { explicit_choice: true }))).toMatchObject({ result: "BOUND_LEGACY", basis: "explicit user choice (ambiguous history)" });
    expect((await bind("F-unp", { explicit_choice: true }))).toMatchObject({ result: "BOUND_LEGACY" });
    // A tampered old runtime file is refused; nothing is substituted.
    const g = fixture("ws-tamper");
    const set2 = oldRuntime(g.home);
    g.flow.create("F-t", "codex", g.parent.task_id);
    mkdirSync(join(g.ws, "docs/features/F-t"), { recursive: true });
    writeFileSync(join(g.home, "runtimes", OLD_ID, ".agents/skills/feature-plan/SKILL.md"), "tampered\n");
    expect(await refusal(g.cp.workflows!.bindLegacy({ feature_id: "F-t", manager: "codex", feature_dir: "docs/features/F-t", runtime_id: OLD_ID, expected_set_sha256: set2, explicit_choice: true, idempotency_key: "t" })))
      .toBe("LEGACY_SOURCE_CORRUPT");
  });
});

describe("status is a pure read", () => {
  it("changes no database row, event, lock or store entry", async () => {
    const f = fixture();
    const lock_path = bound(f);
    await f.flow.run(round("F-1", "r1", f.A.identity));
    const db = join(f.dir, "ws.db");
    const snapshot = () => {
      const raw = new DatabaseSync(db, { readOnly: true });
      try {
        return JSON.stringify([raw.prepare("SELECT COUNT(*) AS n FROM events").get(), raw.prepare("SELECT json FROM features ORDER BY feature_id").all(),
          raw.prepare("SELECT * FROM attempt_workflow").all(), readFileSync(join(f.ws, lock_path), "utf8")]);
      } finally { raw.close(); }
    };
    const before = snapshot();
    const status = f.cp.workflows!.status("F-1");
    expect(status).toMatchObject({ lock_state: "in-sync", bundle: "verified", binding: { identity: f.A.identity }, runtime: { schema_version: 7 } });
    f.cp.workflows!.status();
    expect(snapshot()).toBe(before);
  });
});
