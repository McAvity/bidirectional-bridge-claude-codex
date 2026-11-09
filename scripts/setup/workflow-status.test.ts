/**
 * F-W19 W19-05: doctor's workflow layers. Synthetic client profiles in a temporary directory
 * (never the personal ones), a real SQLite database and the real store/helper of this checkout.
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteStateStore, WORKFLOW_BINDING_ADVERTISEMENT } from "@bridge/control-plane";
// @ts-expect-error JS source
import { workflowStatus } from "./workflow-status.mjs";
// @ts-expect-error JS source
import { workflowCheck } from "./doctor.mjs";
// @ts-expect-error JS source
import { distributionMetadata } from "./distribution.mjs";
// @ts-expect-error JS source
import { projectDistribution, createAliases } from "../diagnostics/project.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const bundle = join(repoRoot, "plugins/feature-workflow-claude/bundle");
const cleanup: string[] = [];
afterEach(() => {
  for (const path of cleanup.splice(0)) {
    // the store is read-only by design
    try { (globalThis as any).__chmod?.(path); } catch { /* */ }
    rmSync(path, { recursive: true, force: true });
  }
});

function tree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, name.name);
      // SQLite creates its WAL sidecars on a readonly open of a WAL database (doctor's existing
      // state probe does the same); the database file itself must stay byte-identical.
      if (/\.db-(shm|wal)$/u.test(name.name)) continue;
      if (name.isDirectory()) walk(path);
      else out[path] = createHash("sha256").update(readFileSync(path)).digest("hex");
    }
  };
  walk(root);
  return out;
}

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "w19-05-status-"));
  cleanup.push(root);
  const lib = await import(pathToFileURL(join(repoRoot, "scripts/workflow-source/workflow-lib.mjs")).href);
  (globalThis as any).__chmod = (path: string) => lib.makeWritable(path);
  const env = { ...process.env, CLAUDE_CONFIG_DIR: join(root, "claude"), CODEX_HOME: join(root, "codex"), CLAUDE_CODEX_BRIDGE_HOME: join(root, "home") };
  // Claude: an old bridge-claude with its own feature-* copies, and the current feature-workflow.
  const oldBridge = join(root, "claude/plugins/cache/m/bridge-claude/0.6.2");
  mkdirSync(join(oldBridge, "skills/feature-plan"), { recursive: true });
  writeFileSync(join(oldBridge, "skills/feature-plan/SKILL.md"), "---\nname: feature-plan\n---\nold rules, no bootstrap\n");
  const current = join(root, "claude/plugins/cache/m/feature-workflow/1.0.0");
  cpSync(join(repoRoot, "plugins/feature-workflow-claude"), current, { recursive: true });
  writeFileSync(join(root, "claude/plugins/installed_plugins.json"), JSON.stringify({ version: 2, plugins: {
    "bridge-claude@m": [{ installPath: oldBridge, version: "0.6.2" }],
    "feature-workflow@m": [{ installPath: current, version: "1.0.0" }],
  } }));
  // Codex: an older feature-workflow without a bundle (pre-W19 select-source preamble).
  const codexOld = join(root, "codex/plugins/cache/m/feature-workflow/0.7.0");
  mkdirSync(join(codexOld, "skills/feature-plan"), { recursive: true });
  writeFileSync(join(codexOld, "skills/feature-plan/SKILL.md"), "---\nname: feature-plan\n---\n> **Instruction source — check first.**\n");
  // Store, lock and database: F-1 bound and admitted, F-2 unbound.
  const manifest = lib.verifyBundle(bundle);
  lib.storePublish(join(root, "home/workflows"), bundle);
  const ws = join(root, "ws");
  mkdirSync(join(ws, "docs/features/F-1"), { recursive: true });
  lib.writeLock(join(ws, "docs/features/F-1"), lib.newLock(manifest, { origin: { kind: "active-plugin", client: "codex", plugin_version: "1.0.0" }, at: "2026-11-06T00:00:00Z", featureId: "F-1" }));
  const db = join(root, "bridge.db");
  const store = new SqliteStateStore({ path: db });
  const base = { manager: "codex", parent_task_id: "task_p", latest_task_id: "task_r", active_task_id: null, task_ids: ["task_r"], state: "awaiting_review" as const, question: null, updated_at: 1 };
  store.putFeature({ ...base, feature_id: "F-1", workflow: { format: "bridge.workflow-binding/v1", identity: manifest.identity, version: manifest.version, workflow_id: manifest.workflow_id,
    kind: "release", generation: 1, lock_path: "docs/features/F-1/workflow.lock.json", lock_sha256_at_bind: null, history: [], pending_projection: null } });
  store.putFeature({ ...base, feature_id: "F-2", latest_task_id: null, task_ids: [], state: "ready" });
  store.putAttemptWorkflow({ task_id: "task_r", attempt: 0, feature_id: "F-1", identity: manifest.identity, workflow_id: manifest.workflow_id, generation: 1, kind: "release", admitted_at: 2 });
  store.close();
  const runtime = { path: repoRoot, manifest: { compatibility: { state_schema_version: 7, workflow_binding: { ...WORKFLOW_BINDING_ADVERTISEMENT } } } };
  return { root, env, ws, db, runtime, manifest, lib };
}

describe("workflow status layers", () => {
  it("separates configured entries, verified store, admitted attempts and an always-null observation, without writing anything", async () => {
    const f = await fixture();
    const before = tree(f.root);
    const status = await workflowStatus({ runtime: f.runtime, worktree: f.ws, databasePath: f.db, env: f.env });
    expect(tree(f.root)).toEqual(before); // read-only: no lock, store entry, migration or row
    expect(status.runtime).toMatchObject({ advertises_binding: true, helper_available: true });
    expect(status.observed).toBeNull();
    const byFeature = Object.fromEntries(status.features.map((x: any) => [x.feature_id, x]));
    expect(byFeature["F-1"]).toMatchObject({ bundle: "verified", lock: { state: "in-sync" }, binding: { identity: f.manifest.identity, generation: 1 } });
    expect(byFeature["F-2"].binding).toBeNull();
    expect(status.admitted).toEqual([{ feature_id: "F-1", identity: f.manifest.identity, generation: 1, kind: "release", attempts: 1 }]);
    const claude = status.entries.claude;
    expect(claude.find((e: any) => e.plugin === "bridge-claude")).toMatchObject({ stale_feature_copies: true, bootstrap: "none", version: "0.6.2" });
    expect(claude.find((e: any) => e.plugin === "feature-workflow")).toMatchObject({ bootstrap: "resolve", bundle_identity: f.manifest.identity, stale_feature_copies: false });
    expect(status.entries.codex).toEqual([expect.objectContaining({ plugin: "feature-workflow", version: "0.7.0", bootstrap: "select-source-v1", bundle_identity: null })]);
    expect(status.warnings.map((w: any) => w.code).sort()).toEqual(["ENTRY_WITHOUT_BOOTSTRAP", "FEATURE_UNBOUND", "STALE_PERSONAL_FEATURE_ENTRIES"]);
    expect(JSON.stringify(status)).not.toContain("old rules, no bootstrap"); // never skill text
    const checks: any[] = [];
    workflowCheck((id: string, s: string, code: string, summary: string, extra: any) => checks.push({ id, s, code, summary, ...extra }), status);
    expect(checks[0]).toMatchObject({ id: "workflow", s: "warn", code: "STALE_PERSONAL_FEATURE_ENTRIES" });
    expect(checks[0].nextStep).toContain("disable");
    expect(checks[0].nextStep).toContain("doctor changes nothing");
  });

  it("reports a missing store copy as an error with the exact restore step, still without writing", async () => {
    const f = await fixture();
    f.lib.makeWritable(join(f.root, "home/workflows"));
    rmSync(join(f.root, "home/workflows", f.manifest.workflow_id), { recursive: true });
    const before = tree(f.root);
    const status = await workflowStatus({ runtime: f.runtime, worktree: f.ws, databasePath: f.db, env: f.env });
    expect(tree(f.root)).toEqual(before);
    expect(status.features.find((x: any) => x.feature_id === "F-1").bundle).toBe("missing:BUNDLE_MISSING");
    const checks: any[] = [];
    workflowCheck((id: string, s: string, code: string, summary: string, extra: any) => checks.push({ id, s, code, ...extra }), status);
    expect(checks[0]).toMatchObject({ s: "error", code: "WORKFLOW_BUNDLE_UNAVAILABLE" });
    expect(checks[0].nextStep).toContain("restore --identity");
  });

  it("does not open a pre-binding runtime's library or claim binding for it", async () => {
    const f = await fixture();
    const status = await workflowStatus({ runtime: { path: f.root, manifest: { compatibility: { state_schema_version: 6 } } }, worktree: f.ws, databasePath: f.db, env: f.env });
    expect(status.runtime).toMatchObject({ advertises_binding: false, helper_available: false });
    expect(status.features.find((x: any) => x.feature_id === "F-1")).toMatchObject({ bundle: null, lock: null });
  });

  it("R19-I06: an unreadable database or a missing advertised helper is unknown, never 0/0 OK, and nothing is written", async () => {
    const f = await fixture();
    const notSqlite = join(f.root, "not-a-db.db");
    writeFileSync(notSqlite, "PRIVATE parser input that must never be echoed\n".repeat(200));
    const before = tree(f.root);
    const status = await workflowStatus({ runtime: f.runtime, worktree: f.ws, databasePath: notSqlite, env: f.env });
    expect(tree(f.root)).toEqual(before);
    expect(status.database).toMatchObject({ state: "unreadable", available: false });
    expect(status.database.error_code).toMatch(/^[A-Z0-9_]{1,40}$/u);
    expect(JSON.stringify(status)).not.toContain("PRIVATE parser input");
    expect(status.warnings.map((w: any) => w.code)).toContain("DATABASE_UNREADABLE");
    const checks: any[] = [];
    workflowCheck((id: string, s: string, code: string, summary: string, extra: any) => checks.push({ id, s, code, summary, ...extra }), status);
    expect(checks[0]).toMatchObject({ id: "workflow", s: "unknown", code: "WORKFLOW_DATABASE_UNREADABLE" });
    expect(checks[0].summary).not.toContain("0/0");
    const meta = distributionMetadata({ home: join(f.root, "home"), worktree: f.ws, workflow: status });
    expect(meta.workflow).toMatchObject({ database: "unreadable", features_total: null, features_bound: null });
    expect(projectDistribution(meta, createAliases()).workflow).toMatchObject({ database: "unreadable", features_total: null, features_bound: null });

    // A missing database file is not a failure: no feature exists yet.
    const absent = await workflowStatus({ runtime: f.runtime, worktree: f.ws, databasePath: join(f.root, "missing.db"), env: f.env });
    expect(absent.database).toMatchObject({ state: "absent" });
    expect(absent.warnings.map((w: any) => w.code)).not.toContain("DATABASE_UNREADABLE");

    // A runtime that advertises binding but whose helper cannot be loaded verifies nothing.
    const broken = mkdtempSync(join(tmpdir(), "w19-06-nohelper-"));
    cleanup.push(broken);
    const helperless = await workflowStatus({ runtime: { path: broken, manifest: f.runtime.manifest }, worktree: f.ws, databasePath: f.db, env: f.env });
    expect(helperless.runtime).toMatchObject({ advertises_binding: true, helper_available: false });
    expect(helperless.features.find((x: any) => x.feature_id === "F-1")).toMatchObject({ bundle: "unverified", lock: { state: "unverified" } });
    expect(helperless.warnings.map((w: any) => w.code)).toContain("HELPER_UNAVAILABLE");
    const more: any[] = [];
    workflowCheck((id: string, s: string, code: string, summary: string, extra: any) => more.push({ id, s, code, ...extra }), helperless);
    expect(more[0]).toMatchObject({ s: "unknown", code: "WORKFLOW_HELPER_UNAVAILABLE" });
  });

  it("projects the distribution summary through the export allowlist with observation null", async () => {
    const f = await fixture();
    const status = await workflowStatus({ runtime: f.runtime, worktree: f.ws, databasePath: f.db, env: f.env });
    const meta = distributionMetadata({ home: join(f.root, "home"), worktree: f.ws, workflow: status });
    expect(meta.workflow).toMatchObject({ runtime_advertises_binding: true, features_total: 2, features_bound: 1, admitted_attempts: 1, observed: null });
    meta.workflow.entries.push({ client: "claude", plugin: "secret-plugin", version: "sk-ant-api03PRIVATEPRIVATEPRIVATE", bootstrap: "x", bundle_identity: "nothex", stale_feature_copies: "yes" });
    const projected = projectDistribution(meta, createAliases());
    expect(projected.workflow.observed).toBeNull();
    expect(projected.workflow.entries.at(-1)).toMatchObject({ plugin: "invalid", version: "invalid", bootstrap: "invalid", bundle_identity: "invalid", stale_feature_copies: "invalid" });
    const text = JSON.stringify(projected);
    expect(text).not.toContain(f.root);
    expect(text).not.toContain("sk-ant-api03PRIVATE");
  });
});
