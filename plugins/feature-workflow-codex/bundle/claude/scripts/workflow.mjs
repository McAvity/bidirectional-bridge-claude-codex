#!/usr/bin/env node
// Standalone workflow helper of the feature-workflow plugin. Canonical source; the generator copies
// it verbatim to `<variant>/scripts/workflow.mjs`. Contract:
// docs/features/F-W19-workflow-versioning/contracts/01-workflow-binding.md § 4.1.
//
//   node workflow.mjs <operation> [options] [--package-root DIR] [--cwd DIR]
//
//   verify          --identity ID | --bundle DIR          full verification, read-only
//   verify-plugin   [--root DIR]                           package root == bundle/<client>, read-only
//   resolve         --feature DIR|ID | --new [--entry SKILL] [--standalone]   read-only (§ 4.2)
//   begin           [--feature-id ID] [--standalone]       publish own bundle, create draft/feature lock
//   finalize        --draft TOKEN --feature-id ID          draft path → final id (§ 4.4)
//   adopt           --feature DIR|ID --explicit            explicit choice for a lock-less standalone feature
//   switch          --feature DIR|ID --to IDENTITY --expected-generation N [--from DIR]   standalone only
//   restore         --identity ID (--from DIR | --source REPO --commit SHA)   exact identity only
//   sweep-staging                                          remove interrupted publications
//
// Output: one JSON object (`feature-workflow.helper/v1`). Exit 0 result, 3 refusal with `code`,
// 1 helper error. Node standard library; child processes only `git` (worktree root, restore
// --source) and `tar` (restore --source). No network, no MCP, no bridge database.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as W from "./workflow-lib.mjs";

export const RESOLVE_FORMAT = "feature-workflow.instruction-source/v2";
const HERE = dirname(fileURLToPath(import.meta.url));

function worktreeOf(cwd) {
  const top = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  return top.status === 0 && top.stdout.trim() ? W.canonicalAnchor(top.stdout.trim()) : null;
}

/**
 * An existing feature directory: `<id>` or a path to `docs/features/<id|.draft-x>` inside this
 * worktree. Names are bounded and no component below the worktree may be a symbolic link
 * (R19-I01), so a feature argument can never redirect a write outside the project.
 */
function featureDirOf(worktree, value) {
  if (!value) throw new W.WorkflowError("FORMAT_INVALID", "--feature is required");
  const anchor = W.canonicalAnchor(worktree);
  let name = value;
  if (value.includes("/") || value.includes("\\") || isAbsolute(value)) {
    const parts = W.relativeToAnchor(anchor, isAbsolute(value) ? value : resolve(worktree, value));
    if (!parts || parts.length !== 3 || parts[0] !== "docs" || parts[1] !== "features") {
      throw new W.WorkflowError("FEATURE_PATH_OUTSIDE", value, { rule: "a feature is docs/features/<id> inside this worktree" });
    }
    name = parts[2];
  }
  const dir = W.featurePath(anchor, name);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new W.WorkflowError("FEATURE_MISSING", value, { next_step: "for a new feature use `begin` (or `resolve --new`)" });
  }
  return dir;
}

function rel(worktree, path) {
  return relative(worktree, path).split("\\").join("/");
}

/**
 * The project's runtime position, read through the plugin's own select-source (the pinned
 * runtime's reader classifies the pin; no second algorithm). Never writes.
 */
async function projectState({ cwd, env, packageRoot, standalone }) {
  const reader = await import(pathToFileURL(join(HERE, "select-source.mjs")).href);
  const answer = await reader.selectSource({ cwd, env, packageRoot, standalone });
  if (answer.source === "plugin") {
    return { pin: answer.code === "EXPLICIT_STANDALONE" ? "standalone" : "none", v1: answer, runtime: null };
  }
  if (answer.source === "runtime") {
    const advert = W.runtimeAdvertisement(answer.runtime.path);
    return { pin: advert?.workflow_binding ? "binding-runtime" : "old-runtime", v1: answer, runtime: { id: answer.runtime.id, path: answer.runtime.path, advertisement: advert } };
  }
  if (answer.code === "RUNTIME_MISSING") return { pin: "missing-runtime", v1: answer, runtime: null };
  return { pin: "refused", v1: answer, runtime: null };
}

/** Full instruction-set digest of the proven runtime, confirmed by its installed manifest. */
function provenSet(env, evidence) {
  try {
    const manifest = JSON.parse(readFileSync(join(W.bridgeHome(env), "runtimes", evidence.runtime_id, "runtime-manifest.json"), "utf8"));
    const set = manifest?.instructions?.set_sha256;
    if (typeof set !== "string" || !/^[0-9a-f]{64}$/u.test(set)) return null;
    return !evidence.set_sha256 || set.startsWith(evidence.set_sha256) ? set : null;
  } catch {
    return null;
  }
}

function installedRuntimes(env) {
  const dir = join(W.bridgeHome(env), "runtimes");
  try {
    return new Set(readdirSync(dir).filter((name) => existsSync(join(dir, name, "runtime-manifest.json"))));
  } catch {
    return new Set();
  }
}

function bundleSummary(manifest, store, client) {
  const root = join(store, manifest.workflow_id);
  return {
    version: manifest.version, identity: manifest.identity, workflow_id: manifest.workflow_id, kind: manifest.kind,
    root, client_root: join(root, client), verified: "full",
  };
}

function instructionsOf(clientRoot) {
  const skills = join(clientRoot, "skills");
  return {
    workflow_skills: skills,
    guide: join(clientRoot, "workflow", "README.md"),
    exchange_helper: join(skills, "feature-exchange", "scripts", "feature_exchange.py"),
    local_delivery: join(skills, "feature-execute", "references", "local-delivery.md"),
  };
}

/** § 4.2: which instruction set an entry follows. Pure read. */
export async function resolveSource({ cwd, env, packageRoot, feature = null, isNew = false, entry = null, standalone = false }) {
  const worktree = worktreeOf(cwd) ?? resolve(cwd);
  const store = W.storeRoot(env);
  const base = { format: RESOLVE_FORMAT, reads_only: true, worktree, home: W.bridgeHome(env), explicit_standalone: standalone, feature: null, bundle: null, entry: null, project: null, instructions: null, next_step: null };
  const finish = (fields) => {
    const result = { ...base, ...fields };
    result.record = result.source === "bundle"
      ? `INSTRUCTIONS=bundle:${result.bundle.workflow_id} IDENTITY=${result.bundle.identity} GENERATION=${result.feature.generation}`
      : result.source === "runtime" ? result.v1_record : `INSTRUCTIONS=none CODE=${result.code}`;
    delete result.v1_record;
    return result;
  };
  const none = (code, nextStep = null, extra = {}) => finish({ source: "none", code, next_step: nextStep, ...extra });

  let own = null;
  try {
    own = W.ownBundle(packageRoot);
    base.entry = { plugin: W.COMPONENT, version: own.manifest.version, identity: own.manifest.identity, client: own.client, layout: own.layout };
  } catch (error) {
    if (!(error instanceof W.WorkflowError)) throw error;
    if (error.code !== "ENTRY_WITHOUT_BUNDLE") return none("ENTRY_BUNDLE_CORRUPT", "the active entry's own bundle does not verify; reinstall the plugin", { problem: error.code });
  }
  const client = own?.client ?? (existsSync(join(packageRoot, ".codex-plugin")) ? "codex" : "claude");
  const project = await projectState({ cwd, env, packageRoot, standalone });
  base.project = { pin: project.pin, runtime_id: project.runtime?.id ?? project.v1.declaration?.runtime_id ?? null, v1_code: project.v1.code, workflow_binding: Boolean(project.runtime?.advertisement?.workflow_binding) };
  const bridgeMode = project.pin === "binding-runtime";
  const compat = (requires) => W.checkCompatibility(requires, project.runtime?.advertisement ?? null, { mode: bridgeMode ? "bridge" : "standalone" });

  if (!isNew) {
    const dir = featureDirOf(worktree, feature);
    const lock = W.readLock(dir);
    if (lock) {
      base.feature = { feature_id: lock.feature.feature_id, dir: rel(worktree, dir), lock: rel(worktree, join(dir, W.LOCK_NAME)), generation: lock.generation, identity: lock.workflow.identity };
      const found = W.storeEntry(store, lock.workflow.identity);
      if (found.state !== "verified") {
        return none(found.state === "missing" ? "BUNDLE_MISSING" : "BUNDLE_CORRUPT",
          `restore exactly ${lock.workflow.identity}: \`workflow.mjs restore --identity ${lock.workflow.identity} --from <plugin or bundle of that identity>\``,
          { store_problem: found.code ?? null });
      }
      if (project.pin === "old-runtime" || project.pin === "missing-runtime") {
        return none(project.pin === "old-runtime" ? "RUNTIME_WITHOUT_BINDING" : "RUNTIME_MISSING", "one-time runtime upgrade; nothing is changed automatically");
      }
      if (project.pin === "refused") return none(project.v1.code, project.v1.next_step);
      const problems = compat(found.manifest.requires);
      if (problems.length) return none("WORKFLOW_INCOMPATIBLE", "see problems", { problems });
      const summary = bundleSummary(found.manifest, store, client);
      if (entry && !existsSync(join(summary.client_root, "skills", entry, "SKILL.md"))) return none("ENTRY_NOT_IN_BUNDLE", `the bound workflow has no ${entry}; do not fall back to the plugin copy`, { bundle: summary });
      if (base.entry) base.entry.same_as_bound = base.entry.identity === found.manifest.identity;
      return finish({ source: "bundle", code: "BOUND_BUNDLE", bundle: summary, instructions: instructionsOf(summary.client_root) });
    }
    base.feature = { feature_id: null, dir: rel(worktree, dir), lock: null, generation: null, identity: null };
    if (project.pin === "old-runtime") {
      return finish({ source: "runtime", code: "LEGACY_PINNED_RUNTIME", runtime: project.v1.runtime, instructions: project.v1.instructions, v1_record: project.v1.record,
        note: "unchanged pre-binding path; no lock is created" });
    }
    if (project.pin === "binding-runtime") {
      const evidence = W.legacyEvidence(W.featureRecords(dir), null, installedRuntimes(env));
      const code = { PROVEN: "LEGACY_BIND_REQUIRED", AMBIGUOUS: "LEGACY_AMBIGUOUS", UNPROVEN: "LEGACY_UNPROVEN", SOURCE_MISSING: "LEGACY_SOURCE_MISSING" }[evidence.verdict];
      const featureDir = rel(worktree, dir);
      if (evidence.verdict === "PROVEN") {
        // R19-I04: a proven old set is an actionable route, not a stop. The exact arguments are
        // derived from the evidence and the installed runtime's own manifest — never guessed.
        const set = provenSet(env, evidence);
        if (!set) {
          return none("LEGACY_SOURCE_MISSING", `the recorded set of runtime ${evidence.runtime_id} cannot be confirmed from its installed manifest; reinstall exactly that runtime`, { legacy: evidence });
        }
        const bind = { feature_dir: featureDir, runtime_id: evidence.runtime_id, expected_set_sha256: set };
        return none(code, `the manager binds this feature to its proven old workflow with bridge_workflow_bind_legacy(${JSON.stringify({ feature_id: "<bridge feature id>", ...bind, idempotency_key: `bind-legacy:${featureDir.split("/").at(-1)}` })}), then runs resolve again; the feature keeps its phase and gates`, { legacy: evidence, bind_legacy: bind });
      }
      const choice = evidence.verdict === "SOURCE_MISSING" ? evidence.next_step
        : `ask the user which recorded/installed runtime this feature followed (${(evidence.candidates ?? []).join(", ") || "no record"}); only then bridge_workflow_bind_legacy with explicit_choice: true`;
      return none(code, choice, { legacy: evidence });
    }
    if (project.pin === "missing-runtime") return none("RUNTIME_MISSING", project.v1.next_step);
    if (project.pin === "refused") return none(project.v1.code, project.v1.next_step);
    return none("SELECTION_REQUIRED", "explicit `adopt --explicit` for this existing feature; the latest workflow is never assigned silently");
  }

  if (!own) return none("ENTRY_WITHOUT_BUNDLE", "update the feature-workflow plugin");
  // A serving pin is never waived by --standalone (W17 rule): the project chose the bridge.
  if (project.pin === "old-runtime") return none("RUNTIME_WITHOUT_BINDING", "one-time runtime upgrade of this project; nothing is changed automatically and --standalone does not waive a serving pin");
  if (project.pin === "missing-runtime") return none("RUNTIME_MISSING", project.v1.next_step);
  if (project.pin === "refused") return none(project.v1.code, project.v1.next_step);
  const problems = compat(own.manifest.requires);
  if (problems.length) return none("WORKFLOW_INCOMPATIBLE", "see problems", { problems });
  return none("SELECTION_REQUIRED", "run `begin` from this entry; it records the active entry's bundle");
}

// ---------------------------------------------------------------------------
// mutating operations
// ---------------------------------------------------------------------------

async function begin({ cwd, env, packageRoot, featureId = null, standalone = false, now }) {
  const answer = await resolveSource({ cwd, env, packageRoot, isNew: true, standalone });
  if (answer.code !== "SELECTION_REQUIRED") return { refused: true, code: answer.code, next_step: answer.next_step, resolve: answer };
  // Every managed path is validated before the first side effect (R19-I01).
  const own = W.ownBundle(packageRoot);
  const store = W.storeRoot(env);
  const features = W.featuresRoot(answer.worktree);
  if (featureId !== null) W.checkFeatureName(featureId, { allowDraft: false }); // "" is refused, never a draft
  const token = featureId !== null ? null : W.newDraftToken();
  const dir = featureId !== null ? W.featurePath(answer.worktree, featureId, { allowDraft: false }) : W.featurePath(answer.worktree, `${W.DRAFT_PREFIX}${token}`);
  if (featureId && existsSync(dir) && W.readLock(dir)) throw new W.WorkflowError("LOCK_EXISTS", featureId, { next_step: "resolve the existing lock; begin never replaces it" });
  const published = W.storePublish(store, own.bundleDir);
  mkdirSync(features, { recursive: true });
  W.featuresRoot(answer.worktree); // re-check after creation: still not redirected
  mkdirSync(dir, { recursive: featureId !== null });
  W.featurePath(answer.worktree, featureId ?? `${W.DRAFT_PREFIX}${token}`);
  const lock = W.newLock(own.manifest, { origin: { kind: "active-plugin", client: own.client, plugin_version: own.manifest.version }, at: now, draftToken: token, featureId });
  W.writeLock(dir, lock);
  return { code: "BEGUN", feature_dir: rel(answer.worktree, dir), draft_token: token, store: published.result, lock };
}

async function adopt({ cwd, env, packageRoot, feature, explicit, now }) {
  if (!explicit) throw new W.WorkflowError("EXPLICIT_CHOICE_REQUIRED", "adopt records a user decision; pass --explicit only when the user chose this workflow");
  const answer = await resolveSource({ cwd, env, packageRoot, feature });
  if (answer.code !== "SELECTION_REQUIRED") return { refused: true, code: answer.code === "BOUND_BUNDLE" ? "LOCK_EXISTS" : answer.code, next_step: answer.next_step, resolve: answer };
  const own = W.ownBundle(packageRoot);
  const dir = featureDirOf(answer.worktree, feature);
  const published = W.storePublish(W.storeRoot(env), own.bundleDir);
  const lock = W.newLock(own.manifest, { origin: { kind: "adopt", client: own.client, plugin_version: own.manifest.version }, at: now, featureId: dir.split(/[\\/]/u).at(-1) });
  W.writeLock(dir, lock);
  return { code: "ADOPTED", feature_dir: rel(answer.worktree, dir), store: published.result, lock };
}

async function switchStandalone({ cwd, env, packageRoot, feature, to, expectedGeneration, from = null, now }) {
  const worktree = worktreeOf(cwd) ?? resolve(cwd);
  const project = await projectState({ cwd, env, packageRoot, standalone: false });
  if (project.pin !== "none") {
    throw new W.WorkflowError("SWITCH_REQUIRES_BRIDGE", project.v1.declaration?.runtime_id ?? project.v1.code, { next_step: "a project with a bridge pin switches through the bridge (bridge_workflow_switch)" });
  }
  const dir = featureDirOf(worktree, feature);
  const store = W.storeRoot(env);
  if (from) W.storePublish(store, existsSync(join(from, W.BUNDLE_DIR, W.BUNDLE_MANIFEST)) ? join(from, W.BUNDLE_DIR) : from);
  const target = W.storeEntry(store, to);
  if (target.state !== "verified") throw new W.WorkflowError(target.state === "missing" ? "BUNDLE_MISSING" : "BUNDLE_CORRUPT", to, { next_step: "publish or restore the target identity first (--from)" });
  const problems = W.checkCompatibility(target.manifest.requires, null, { mode: "standalone" });
  if (problems.length) return { refused: true, code: "WORKFLOW_INCOMPATIBLE", problems };
  const current = W.readLock(dir);
  const result = W.standaloneSwitch(dir, target.manifest, { expectedGeneration, at: now });
  return { code: result.result, feature_dir: rel(worktree, dir), from: current ? { version: current.workflow.version, identity: current.workflow.identity } : null,
    to: { version: target.manifest.version, identity: target.manifest.identity }, generation: result.generation, lock: result.lock };
}

function restoreSourceBundle({ from, source, commit }) {
  if (from) {
    const dir = existsSync(join(from, W.BUNDLE_DIR, W.BUNDLE_MANIFEST)) ? join(from, W.BUNDLE_DIR) : from;
    return { dir, cleanup: () => {} };
  }
  if (!source || !commit) throw new W.WorkflowError("FORMAT_INVALID", "restore needs --from DIR or --source REPO --commit SHA");
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(source) || /^[^/]+@[^:]+:/u.test(source)) {
    throw new W.WorkflowError("RESTORE_SOURCE_UNSUPPORTED", "only a local repository path; the helper never fetches");
  }
  if (!/^[0-9a-f]{40}$/u.test(commit)) throw new W.WorkflowError("FORMAT_INVALID", "--commit must be a full 40-hex commit");
  const exists = spawnSync("git", ["-C", source, "cat-file", "-e", `${commit}^{commit}`], { encoding: "utf8" });
  if (exists.status !== 0) throw new W.WorkflowError("RESTORE_SOURCE_UNSUPPORTED", `commit ${commit} is not in ${source}`);
  const tmp = mkdtempSync(join(tmpdir(), "workflow-restore-"));
  const cleanup = () => rmSync(tmp, { recursive: true, force: true });
  try {
    const archive = spawnSync("git", ["-C", source, "archive", "--format=tar", commit], { maxBuffer: 1 << 30 });
    if (archive.status !== 0) throw new W.WorkflowError("RESTORE_SOURCE_UNSUPPORTED", "git archive failed");
    const untar = spawnSync("tar", ["-x", "-C", tmp], { input: archive.stdout });
    if (untar.status !== 0) throw new W.WorkflowError("RESTORE_SOURCE_UNSUPPORTED", "tar failed");
    const gen = spawnSync(process.execPath, [join(tmp, "scripts/plugin-packages/generate.mjs"), "--component", "workflow"], { cwd: tmp, encoding: "utf8" });
    const dir = join(tmp, "plugins", "feature-workflow-claude", W.BUNDLE_DIR);
    if (gen.status !== 0 || !existsSync(join(dir, W.BUNDLE_MANIFEST))) {
      throw new W.WorkflowError("RESTORE_SOURCE_UNSUPPORTED", `commit ${commit} cannot regenerate a workflow bundle`, { stderr: (gen.stderr ?? "").slice(-400) });
    }
    return { dir, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

function restore({ env, identity, from, source, commit }) {
  const store = W.storeRoot(env); // refused before the source is even prepared
  const { dir, cleanup } = restoreSourceBundle({ from, source, commit });
  try {
    return { code: "RESTORE", ...W.storeRestore(store, identity, dir) };
  } finally {
    cleanup();
  }
}

// ---------------------------------------------------------------------------
// command line
// ---------------------------------------------------------------------------

function parse(argv) {
  const [operation, ...rest] = argv;
  const options = { operation, cwd: process.cwd(), packageRoot: resolve(HERE, "..") };
  const value = (index) => {
    if (index >= rest.length) throw new W.WorkflowError("FORMAT_INVALID", `missing value for ${rest[index - 1]}`);
    return rest[index];
  };
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    switch (flag) {
      case "--cwd": options.cwd = resolve(value(++i)); break;
      case "--package-root": options.packageRoot = resolve(value(++i)); break;
      case "--root": options.root = resolve(value(++i)); break;
      case "--identity": options.identity = value(++i); break;
      case "--bundle": options.bundle = resolve(value(++i)); break;
      case "--feature": options.feature = value(++i); break;
      case "--feature-id": options.featureId = value(++i); break;
      case "--draft": options.draft = value(++i); break;
      case "--entry": options.entry = value(++i); break;
      case "--to": options.to = value(++i); break;
      case "--expected-generation": options.expectedGeneration = Number.parseInt(value(++i), 10); break;
      case "--from": options.from = resolve(value(++i)); break;
      case "--source": options.source = value(++i); break;
      case "--commit": options.commit = value(++i); break;
      case "--new": options.isNew = true; break;
      case "--standalone": options.standalone = true; break;
      case "--explicit": options.explicit = true; break;
      case "--json": break;
      default: throw new W.WorkflowError("FORMAT_INVALID", `unknown argument ${flag}`);
    }
  }
  return options;
}

export async function run(argv, env = process.env, now = new Date().toISOString()) {
  const o = parse(argv);
  const store = () => W.storeRoot(env); // guarded lazily: only operations that use the store
  switch (o.operation) {
    case "verify": {
      if (o.bundle) return { code: "VERIFIED", manifest_identity: W.verifyBundle(o.bundle, o.identity ?? null).identity };
      const entry = W.storeEntry(store(), o.identity);
      if (entry.state !== "verified") return { refused: true, code: entry.code, path: entry.path };
      return { code: "VERIFIED", identity: entry.manifest.identity, workflow_id: entry.manifest.workflow_id, path: entry.path };
    }
    case "verify-plugin": {
      const { client, manifest } = W.verifyPlugin(o.root ?? o.packageRoot);
      return { code: "VERIFIED", client, version: manifest.version, identity: manifest.identity, workflow_id: manifest.workflow_id };
    }
    case "resolve": {
      if (!o.isNew && !o.feature) throw new W.WorkflowError("FORMAT_INVALID", "resolve needs --feature or --new");
      const answer = await resolveSource({ cwd: o.cwd, env, packageRoot: o.packageRoot, feature: o.feature, isNew: Boolean(o.isNew), entry: o.entry ?? null, standalone: Boolean(o.standalone) });
      return answer.source === "none" ? { ...answer, refused: true } : answer;
    }
    case "begin":
      return begin({ cwd: o.cwd, env, packageRoot: o.packageRoot, featureId: o.featureId ?? null, standalone: Boolean(o.standalone), now });
    case "finalize": {
      const worktree = worktreeOf(o.cwd) ?? resolve(o.cwd);
      W.checkFeatureName(o.featureId, { allowDraft: false });
      return { code: "FINALIZE", ...W.finalizeDraft(W.featuresRoot(worktree), o.draft, o.featureId) };
    }
    case "adopt":
      return adopt({ cwd: o.cwd, env, packageRoot: o.packageRoot, feature: o.feature, explicit: Boolean(o.explicit), now });
    case "switch":
      if (!Number.isSafeInteger(o.expectedGeneration)) throw new W.WorkflowError("FORMAT_INVALID", "--expected-generation N is required");
      return switchStandalone({ cwd: o.cwd, env, packageRoot: o.packageRoot, feature: o.feature, to: o.to, expectedGeneration: o.expectedGeneration, from: o.from ?? null, now });
    case "restore":
      return restore({ env, identity: o.identity, from: o.from, source: o.source, commit: o.commit });
    case "sweep-staging":
      return { code: "SWEPT", ...W.sweepStaging(store()) };
    default:
      throw new W.WorkflowError("FORMAT_INVALID", `unknown operation ${o.operation ?? "(none)"}`);
  }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const operation = argv[0] ?? null;
  try {
    const result = await run(argv, env);
    const refused = result.refused === true;
    delete result.refused;
    process.stdout.write(`${JSON.stringify({ format: W.HELPER_FORMAT, operation, ok: !refused, ...result }, null, 2)}\n`);
    return refused ? 3 : 0;
  } catch (error) {
    if (error instanceof W.WorkflowError) {
      process.stdout.write(`${JSON.stringify({ format: W.HELPER_FORMAT, operation, ok: false, code: error.code, detail: error.detail, ...error.data }, null, 2)}\n`);
      return 3;
    }
    process.stderr.write(`${error?.stack ?? String(error)}\n`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
