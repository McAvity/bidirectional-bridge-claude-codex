// Workflow layers for doctor and the diagnostics export (F-W19 W19-05, contract § 8).
//
// Four layers are kept apart and never substituted for each other:
//   configured — what is installed or recorded: the runtime's advertisement, the client entry
//                plugins on this machine, a feature's lock and binding;
//   verified   — whether the bound release is present and intact in the local store;
//   admitted   — which release the bridge admitted for each attempt (attempt_workflow);
//   observed   — whether a model actually applied it. Only a real run can tell; this module
//                never fills it in (always null).
//
// Strictly read-only: no lock, store entry, database row, migration or selection is created. The
// database is opened readonly; locks and store entries are read through the selected runtime's own
// helper library (the bridge package does not ship workflow code). Output carries versions, flags,
// counts, identities and location classes; never skill text, prompts, paths or native ids.

import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { sha256 } from "./common.mjs";

export const WORKFLOW_STATUS_FORMAT = "claude-codex-bridge.workflow-status/v1";
const NEW_PREAMBLE = "Workflow selection — check first";
const OLD_PREAMBLE = "Instruction source — check first";
const ENTRY = /^feature-(flow|design|plan|execute|review|decide|exchange)$/u;

function readJsonFile(path) {
  try {
    if (!lstatSync(path).isFile()) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function listDir(path) {
  try {
    return readdirSync(path, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.isSymbolicLink()).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

/** What one installed plugin directory offers as a workflow entry (read-only, no verification). */
export function inspectEntryPackage(dir) {
  const skills = listDir(join(dir, "skills")).filter((name) => ENTRY.test(name));
  const bundle = readJsonFile(join(dir, "bundle", "bundle.json"));
  let bootstrap = "none";
  const sample = skills.includes("feature-plan") ? "feature-plan" : skills[0];
  if (sample) {
    try {
      const text = readFileSync(join(dir, "skills", sample, "SKILL.md"), "utf8").slice(0, 4096);
      bootstrap = text.includes(NEW_PREAMBLE) ? "resolve" : text.includes(OLD_PREAMBLE) ? "select-source-v1" : "none";
    } catch {
      bootstrap = "unreadable";
    }
  }
  const identity = typeof bundle?.identity === "string" && /^sha256:[0-9a-f]{64}$/u.test(bundle.identity) ? bundle.identity : null;
  return { feature_entries: skills.length, bootstrap, bundle_identity: identity, bundle_version: typeof bundle?.version === "string" ? bundle.version : null };
}

/**
 * Workflow entries installed in the user's clients (configured, not loaded). Reads only the
 * clients' own metadata: Claude `installed_plugins.json`, Codex `plugins/cache`. Nothing is
 * written, enabled, disabled or removed.
 */
export function detectEntries({ env = process.env, userHome = homedir() } = {}) {
  const out = { claude: [], codex: [] };
  const claudeConfig = env.CLAUDE_CONFIG_DIR || join(userHome, ".claude");
  const installed = readJsonFile(join(claudeConfig, "plugins", "installed_plugins.json"));
  const plugins = installed?.plugins && typeof installed.plugins === "object" ? installed.plugins : {};
  for (const [id, records] of Object.entries(plugins)) {
    const [plugin, marketplace] = id.split("@");
    if (plugin !== "feature-workflow" && plugin !== "bridge-claude") continue;
    for (const record of Array.isArray(records) ? records : [records]) {
      const dir = typeof record?.installPath === "string" ? record.installPath : null;
      if (!dir || !existsSync(dir)) continue;
      const info = inspectEntryPackage(dir);
      out.claude.push({
        plugin, marketplace: marketplace ?? null, version: typeof record.version === "string" ? record.version : null, ...info,
        // An old bridge-claude carried its own feature-* copies without any bootstrap: they would
        // run whatever rules they contain, never the feature's selected workflow.
        stale_feature_copies: plugin === "bridge-claude" && info.feature_entries > 0,
        location_sha256: sha256(dir),
      });
    }
  }
  const codexHome = env.CODEX_HOME || join(userHome, ".codex");
  const cache = join(codexHome, "plugins", "cache");
  for (const marketplace of listDir(cache)) {
    for (const plugin of listDir(join(cache, marketplace))) {
      if (plugin !== "feature-workflow" && plugin !== "bridge-codex") continue;
      for (const version of listDir(join(cache, marketplace, plugin))) {
        const dir = join(cache, marketplace, plugin, version);
        const info = inspectEntryPackage(dir);
        out.codex.push({ plugin, marketplace, version, ...info, stale_feature_copies: plugin === "bridge-codex" && info.feature_entries > 0, location_sha256: sha256(dir) });
      }
    }
  }
  return out;
}

/** Feature bindings and admitted attempts, from a readonly database handle. */
export function readBindings(databasePath) {
  if (!databasePath || !existsSync(databasePath)) return { available: false, features: [], admitted: [] };
  let db;
  try {
    const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
    db = new DatabaseSync(databasePath, { readOnly: true });
  } catch (error) {
    return { available: false, error: error?.code ?? "SQLITE_CANTOPEN", features: [], admitted: [] };
  }
  try {
    const features = [];
    for (const row of db.prepare("SELECT feature_id, json FROM features ORDER BY feature_id").all()) {
      let record;
      try {
        record = JSON.parse(row.json);
      } catch {
        features.push({ feature_id: row.feature_id, unparsable: true });
        continue;
      }
      const w = record.workflow ?? null;
      features.push({
        feature_id: row.feature_id,
        state: record.state ?? null,
        binding: w ? {
          identity: w.identity ?? null, version: w.version ?? null, workflow_id: w.workflow_id ?? null, kind: w.kind ?? null,
          generation: w.generation ?? null, lock_path: w.lock_path ?? null, history_length: Array.isArray(w.history) ? w.history.length : null,
          pending: w.pending_projection?.op ?? null, legacy_runtime_id: w.legacy?.runtime_id ?? null,
        } : null,
      });
    }
    const hasAttempts = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'attempt_workflow'").get();
    const admitted = hasAttempts
      ? db.prepare("SELECT feature_id, identity, generation, kind, COUNT(*) AS attempts FROM attempt_workflow GROUP BY feature_id, identity, generation, kind ORDER BY feature_id, generation").all()
        .map((r) => ({ feature_id: r.feature_id, identity: r.identity, generation: Number(r.generation), kind: r.kind, attempts: Number(r.attempts) }))
      : [];
    return { available: true, attempt_table: Boolean(hasAttempts), features, admitted };
  } catch (error) {
    return { available: false, error: error?.code ?? "SQLITE_ERROR", features: [], admitted: [] };
  } finally {
    db.close();
  }
}

/** The selected runtime's own helper library, or null for a runtime without workflow binding. */
export async function runtimeWorkflowLib(runtimePath) {
  const path = runtimePath ? join(runtimePath, "scripts", "workflow-source", "workflow-lib.mjs") : null;
  if (!path || !existsSync(path)) return null;
  try {
    return await import(pathToFileURL(path).href);
  } catch {
    return null;
  }
}

function lockState(lib, worktree, binding) {
  const match = /^docs\/features\/([^/]+)\/workflow\.lock\.json$/u.exec(binding.lock_path ?? "");
  if (!match) return { state: "lock-path-invalid" };
  let lock;
  try {
    lock = lib.readLock(lib.featurePath(worktree, match[1]));
  } catch (error) {
    return { state: `lock-invalid:${error?.code ?? "ERROR"}` };
  }
  if (binding.pending) return { state: `switch-pending:${binding.pending}` };
  if (!lock) return { state: "lock-missing" };
  if (lock.generation === binding.generation && lock.workflow?.identity === binding.identity) return { state: "in-sync" };
  return { state: (lock.generation ?? 0) < binding.generation ? "projection-behind" : "diverged" };
}

/**
 * The workflow status of one worktree. Pure read; `observed` is always null here.
 */
export async function workflowStatus({ runtime = null, worktree = null, databasePath = null, env = process.env, userHome = homedir() } = {}) {
  const advert = runtime?.manifest?.compatibility?.workflow_binding ?? null;
  const lib = advert ? await runtimeWorkflowLib(runtime?.path) : null;
  const entries = detectEntries({ env, userHome });
  const db = readBindings(databasePath);
  const features = [];
  for (const feature of db.features) {
    const out = { feature_id: feature.feature_id, state: feature.state ?? null, binding: feature.binding, lock: null, bundle: null };
    if (feature.binding && lib && worktree) {
      out.lock = lockState(lib, worktree, feature.binding);
      try {
        const entry = lib.storeEntry(lib.storeRoot(env), feature.binding.identity);
        out.bundle = entry.state === "verified" ? "verified" : `${entry.state}:${entry.code ?? ""}`;
      } catch (error) {
        out.bundle = `unavailable:${error?.code ?? "ERROR"}`;
      }
    }
    features.push(out);
  }
  const warnings = [];
  for (const entry of [...entries.claude, ...entries.codex]) {
    if (entry.stale_feature_copies) warnings.push({ code: "STALE_PERSONAL_FEATURE_ENTRIES", plugin: entry.plugin, marketplace: entry.marketplace, version: entry.version });
    if (entry.plugin === "feature-workflow" && (entry.bootstrap !== "resolve" || !entry.bundle_identity)) {
      warnings.push({ code: "ENTRY_WITHOUT_BOOTSTRAP", plugin: entry.plugin, marketplace: entry.marketplace, version: entry.version, bootstrap: entry.bootstrap });
    }
  }
  for (const feature of features) {
    if (!feature.binding && advert && !["accepted", "rejected", "cancelled"].includes(feature.state)) warnings.push({ code: "FEATURE_UNBOUND", feature_id: feature.feature_id });
    if (feature.bundle && feature.bundle !== "verified") warnings.push({ code: "BUNDLE_UNAVAILABLE", feature_id: feature.feature_id, bundle: feature.bundle });
    if (feature.lock && feature.lock.state !== "in-sync") warnings.push({ code: "LOCK_NOT_IN_SYNC", feature_id: feature.feature_id, lock: feature.lock.state });
  }
  return {
    format: WORKFLOW_STATUS_FORMAT,
    runtime: { advertises_binding: Boolean(advert), contracts: advert?.contracts ?? null, capabilities: advert?.capabilities ?? null, helper_available: Boolean(lib) },
    entries,
    database: { available: db.available, attempt_table: db.attempt_table ?? false },
    features,
    admitted: db.admitted,
    observed: null,
    warnings,
    layers: {
      configured: "runtime advertisement, installed client entries, feature lock and binding",
      verified: "features[].bundle: the bound release in the local store",
      admitted: "admitted[]: releases the bridge admitted per attempt",
      observed: "null: only a real run with a model can show that the instructions were applied",
    },
  };
}
