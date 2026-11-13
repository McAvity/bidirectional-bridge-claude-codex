// Workflow release, bundle, store and lock primitives of the feature-workflow plugin.
// Canonical source; the generator copies it verbatim to `<variant>/scripts/workflow-lib.mjs`.
// Contract: docs/features/F-W19-workflow-versioning/contracts/01-workflow-binding.md (§ n below).
// Reference semantics and shared fixtures: tools/pilot/workflow-versioning/contract_model.py.
//
// Node standard library only. Nothing here opens a network connection, starts an MCP server, reads
// a bridge database or writes outside the paths it is given. The generator, the standalone helper
// (`workflow.mjs`) and later the runtime (W19-03/04) all use these functions, so a bundle has one
// identity and one verdict wherever it is checked.

import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, rmSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, parse as parsePath, posix, resolve, sep } from "node:path";

export const RELEASE_FORMAT = "feature-workflow.release/v1";
export const RELEASES_FORMAT = "feature-workflow.releases/v1";
export const BUNDLE_FORMAT = "feature-workflow.bundle/v1";
export const LOCK_FORMAT = "feature-workflow.lock/v1";
export const HELPER_FORMAT = "feature-workflow.helper/v1";
export const COMPONENT = "feature-workflow";
export const CLIENTS = ["claude", "codex"];
export const BUNDLE_MANIFEST = "bundle.json";
export const BUNDLE_DIR = "bundle";
export const LOCK_NAME = "workflow.lock.json";
export const DRAFT_PREFIX = ".draft-";
export const QUARANTINE_PREFIX = ".quarantine-";
export const STAGING_PREFIX = ".staging-";
export const HOME_ENV = "CLAUDE_CODEX_BRIDGE_HOME";
/** Runtime-owned skill directories a workflow bundle may never contain (§ 3.1). */
export const RUNTIME_OWNED = ["skills/using-bridge/", "skills/bridge-upgrade/", "skills/bridge/"];
/** Formats this helper reads and writes (§ 5.1 `workflow_formats`). */
export const SUPPORTED_FORMATS = { bundle: 1, lock: 1 };
const WORKFLOW_ID = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}-[0-9a-f]{12}$/u;
const IDENTITY = /^sha256:[0-9a-f]{64}$/u;
const FORBIDDEN_LOCK_KEYS = new Set(["session_id", "native_thread_id", "thread_id", "path", "home", "approval", "consent", "state", "status", "phase", "user"]);

/** A refusal with a stable code (§ 9). */
export class WorkflowError extends Error {
  constructor(code, detail = "", data = {}) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.detail = detail;
    this.data = data;
  }
}

// ---------------------------------------------------------------------------
// § 2 canonical JSON and identities
// ---------------------------------------------------------------------------

/** Canonical serialization for identities: sorted keys, no whitespace, integers only (§ 2.1). */
export function canonicalJson(value) {
  const encode = (item) => {
    if (item === null || typeof item === "boolean" || typeof item === "string") return JSON.stringify(item);
    if (typeof item === "number") {
      if (!Number.isSafeInteger(item)) throw new WorkflowError("FORMAT_INVALID", "only safe integers are allowed in identity-bearing JSON");
      return String(item);
    }
    if (Array.isArray(item)) return `[${item.map(encode).join(",")}]`;
    if (typeof item === "object") {
      const keys = Object.keys(item);
      for (const key of keys) if (!/^[\x20-\x7e]*$/u.test(key)) throw new WorkflowError("FORMAT_INVALID", "object keys must be printable ASCII");
      keys.sort();
      return `{${keys.filter((k) => item[k] !== undefined).map((k) => `${JSON.stringify(k)}:${encode(item[k])}`).join(",")}}`;
    }
    throw new WorkflowError("FORMAT_INVALID", `unsupported value of type ${typeof item}`);
  };
  return Buffer.from(encode(value), "utf8");
}

export function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

/** Readable on-disk JSON: two-space indent, sorted keys, trailing newline. */
export function jsonBytes(value) {
  const sort = (item) => {
    if (Array.isArray(item)) return item.map(sort);
    if (item && typeof item === "object") return Object.fromEntries(Object.keys(item).sort().map((k) => [k, sort(item[k])]));
    return item;
  };
  return Buffer.from(`${JSON.stringify(sort(value), null, 2)}\n`, "utf8");
}

const IDENTITY_FIELDS = ["format", "component", "kind", "version", "requires", "variants", "files", "legacy"];

/** `sha256:<hex>` over the identity-bearing fields; `source` and `identity` are not part of it (§ 2.2). */
export function bundleIdentity(manifest) {
  const body = {};
  for (const key of IDENTITY_FIELDS) if (manifest[key] !== undefined) body[key] = manifest[key];
  return `sha256:${sha256(canonicalJson(body))}`;
}

/** Store directory name `<version>-<12 hex>` (§ 2.3). */
export function workflowId(version, identity) {
  return `${version}-${String(identity).split(":", 2)[1]?.slice(0, 12) ?? ""}`;
}

export function safeRelpath(path) {
  if (typeof path !== "string" || path === "" || path.includes("\\") || path.includes("\0")) return false;
  if (posix.isAbsolute(path) || posix.normalize(path) !== path) return false;
  return !path.split("/").some((part) => part === ".." || part === "." || part === "");
}

const byBytes = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));

// ---------------------------------------------------------------------------
// filesystem helpers (never follow a symlink)
// ---------------------------------------------------------------------------

/** Every entry below `root` as `{rel, kind}`; symbolic links are reported, never followed.
 * Optional root directories are pruned before traversal (never files or symlinks).
 */
export function walkEntries(root, { skipRootDirectories = [] } = {}) {
  const out = [];
  const visit = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!prefix && entry.isDirectory() && skipRootDirectories.includes(entry.name)) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) out.push({ rel, kind: "symlink" });
      else if (entry.isDirectory()) {
        out.push({ rel, kind: "dir" });
        visit(join(dir, entry.name), rel);
      } else if (entry.isFile()) out.push({ rel, kind: "file" });
      else out.push({ rel, kind: "other" });
    }
  };
  visit(root, "");
  return out.sort((a, b) => byBytes(a.rel, b.rel));
}

function lkind(path) {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return "symlink";
    if (stat.isDirectory()) return "dir";
    if (stat.isFile()) return "file";
    return "other";
  } catch {
    return "missing";
  }
}

function fileMode(path) {
  return (lstatSync(path).mode & 0o100) !== 0 ? "755" : "644";
}

/** Write via a temporary sibling and rename, so a reader sees the old or the new bytes. */
export function writeAtomic(path, data) {
  const temp = join(dirname(path), `.${posix.basename(path)}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`);
  writeFileSync(temp, data);
  renameSync(temp, path);
}

/** chmod a-w below `root`, children before their directory (same rule as the runtime installer). */
export function makeReadOnly(root) {
  for (const entry of walkEntries(root).reverse()) {
    if (entry.kind === "symlink") continue;
    const path = join(root, entry.rel);
    chmodSync(path, lstatSync(path).mode & 0o555);
  }
  chmodSync(root, lstatSync(root).mode & 0o555);
}

/** Restore owner write permission below `root` (tests and explicit cleanup only). */
export function makeWritable(root) {
  if (lkind(root) !== "dir") return;
  chmodSync(root, lstatSync(root).mode | 0o200);
  for (const entry of walkEntries(root)) {
    if (entry.kind === "symlink") continue;
    const path = join(root, entry.rel);
    chmodSync(path, lstatSync(path).mode | 0o200);
  }
}

// ---------------------------------------------------------------------------
// managed write paths (R19-I01): bounded names, no redirection below a trust anchor
// ---------------------------------------------------------------------------

/**
 * A trust anchor (worktree root, bridge home) in canonical form. Symbolic links *above* the anchor
 * are resolved (macOS `/tmp` → `/private/tmp`, an explicitly external bridge home); everything the
 * helper creates or replaces *below* it is checked with lstat and never followed.
 */
export function canonicalAnchor(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/**
 * `anchor/<parts…>` after checking that every existing component below the anchor is a real
 * directory (the last one: real directory or absent). Nothing is created here; call it before any
 * side effect. Throws PATH_REDIRECTED (a symbolic link) or PATH_NOT_DIRECTORY.
 */
export function managedPath(anchor, parts) {
  let current = anchor;
  for (const [index, part] of parts.entries()) {
    if (!part || part === "." || part === ".." || part.includes("/") || part.includes("\\") || part.includes("\0")) {
      throw new WorkflowError("PATH_UNSAFE", parts.join("/"));
    }
    current = join(current, part);
    const kind = lkind(current);
    if (kind === "symlink") throw new WorkflowError("PATH_REDIRECTED", current, { reason: "symbolic link below a managed root; nothing was written", anchor });
    if (kind === "missing") {
      // Every deeper component is missing too, so it is created fresh by the caller.
      return join(anchor, ...parts);
    }
    if (kind !== "dir") throw new WorkflowError("PATH_NOT_DIRECTORY", current, { index });
  }
  return current;
}

/**
 * Components of `path` below `anchor`, or null when `path` is not inside it. Ancestors of `path`
 * are compared through realpath only until one equals the anchor, so a link above the anchor is
 * tolerated and nothing below it is followed.
 */
export function relativeToAnchor(anchor, path) {
  const absolute = resolve(path);
  const { root } = parsePath(absolute);
  const parts = absolute.slice(root.length).split(sep).filter(Boolean);
  let current = root;
  if (canonicalAnchor(current) === anchor) return parts;
  for (let index = 0; index < parts.length; index += 1) {
    current = join(current, parts[index]);
    if (lkind(current) === "missing") return null;
    if (canonicalAnchor(current) === anchor) return parts.slice(index + 1);
  }
  return null;
}

const FEATURE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const DRAFT_NAME = /^\.draft-[0-9a-f]{8}$/u;

/** Bounded feature directory names: an id (`F-001-x`) or a draft (`.draft-<8 hex>`). */
export function checkFeatureName(name, { allowDraft = true } = {}) {
  const ok = (FEATURE_ID.test(String(name)) && !String(name).includes("..")) || (allowDraft && DRAFT_NAME.test(String(name)));
  if (!ok) throw new WorkflowError("FEATURE_ID_INVALID", String(name), { rule: "[A-Za-z0-9][A-Za-z0-9._-]{0,127} without '..', or .draft-<8 hex>" });
  return name;
}

/** `<worktree>/docs/features`, guarded. */
export function featuresRoot(worktree) {
  return managedPath(canonicalAnchor(worktree), ["docs", "features"]);
}

/** `<worktree>/docs/features/<name>`, guarded; `name` is validated first. */
export function featurePath(worktree, name, options) {
  checkFeatureName(name, options);
  return managedPath(canonicalAnchor(worktree), ["docs", "features", name]);
}

/** The store directory itself must not be a link or a non-directory (the home may be external). */
function assertStore(store) {
  const kind = lkind(store);
  if (kind === "symlink") throw new WorkflowError("PATH_REDIRECTED", store, { reason: "the workflow store is a symbolic link; nothing was written" });
  if (kind !== "missing" && kind !== "dir") throw new WorkflowError("PATH_NOT_DIRECTORY", store);
}

// ---------------------------------------------------------------------------
// § 3 bundle build and verification
// ---------------------------------------------------------------------------

/** Files of one client variant directory as `{rel: {data, mode}}`; refuses links and nested bundles. */
export function readVariant(dir) {
  const files = {};
  for (const entry of walkEntries(dir)) {
    if (entry.kind === "symlink" || entry.kind === "other") throw new WorkflowError("BUNDLE_SYMLINK", entry.rel);
    if (entry.kind !== "file") continue;
    files[entry.rel] = { data: readFileSync(join(dir, entry.rel)), mode: fileMode(join(dir, entry.rel)) };
  }
  return files;
}

function checkVariantPath(client, rel) {
  if (!safeRelpath(rel)) throw new WorkflowError("BUNDLE_PATH_UNSAFE", `${client}/${rel}`);
  if (rel === BUNDLE_DIR || rel.startsWith(`${BUNDLE_DIR}/`) || rel === "GENERATED.json") throw new WorkflowError("BUNDLE_RECURSIVE", `${client}/${rel}`);
  if (RUNTIME_OWNED.some((prefix) => rel.startsWith(prefix))) throw new WorkflowError("BUNDLE_RUNTIME_OWNED", `${client}/${rel}`);
}

/**
 * The bundle manifest for two variants (§ 3.1). `variants` is `{claude: {rel: {data, mode}}, codex: …}`.
 * `source` is provenance only; it never contains the commit that holds the source (no self-reference).
 */
export function bundleManifest({ version, requires, variants, source, kind = "release", legacy }) {
  const files = [];
  for (const client of CLIENTS) {
    const variant = variants[client];
    if (!variant) throw new WorkflowError("BUNDLE_INCOMPLETE", `variant ${client}`);
    if (!variant[`.${client}-plugin/plugin.json`]) throw new WorkflowError("BUNDLE_INCOMPLETE", `${client}/.${client}-plugin/plugin.json`);
    for (const rel of Object.keys(variant)) {
      checkVariantPath(client, rel);
      files.push({ path: `${client}/${rel}`, sha256: sha256(variant[rel].data), mode: variant[rel].mode });
    }
  }
  files.sort((a, b) => byBytes(a.path, b.path));
  const manifest = {
    format: BUNDLE_FORMAT,
    component: COMPONENT,
    kind,
    version,
    requires,
    variants: Object.fromEntries(CLIENTS.map((client) => [client, { root: client, plugin_manifest: `.${client}-plugin/plugin.json` }])),
    files,
    ...(legacy ? { legacy } : {}),
    source,
  };
  manifest.identity = bundleIdentity(manifest);
  manifest.workflow_id = workflowId(version, manifest.identity);
  return manifest;
}

/** Write a bundle directory (`bundle.json` + `<client>/…`) into a directory that must not exist. */
export function writeBundle(directory, manifest, variants) {
  if (lkind(directory) !== "missing") throw new WorkflowError("BUNDLE_TARGET_EXISTS", directory);
  mkdirSync(directory, { recursive: true });
  for (const client of CLIENTS) {
    for (const [rel, file] of Object.entries(variants[client])) {
      const target = join(directory, client, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.data, { mode: file.mode === "755" ? 0o755 : 0o644 });
      chmodSync(target, file.mode === "755" ? 0o755 : 0o644);
    }
  }
  writeFileSync(join(directory, BUNDLE_MANIFEST), jsonBytes(manifest));
}

/** Parse `bundle.json` without trusting it. */
export function readManifest(directory) {
  const path = join(directory, BUNDLE_MANIFEST);
  const kind = lkind(path);
  if (kind === "missing") throw new WorkflowError("BUNDLE_MISSING", BUNDLE_MANIFEST);
  if (kind !== "file") throw new WorkflowError("BUNDLE_SYMLINK", BUNDLE_MANIFEST);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new WorkflowError("BUNDLE_CORRUPT", `${BUNDLE_MANIFEST}: ${error.message}`);
  }
}

/**
 * Full verification of a bundle directory (§ 3.3). Returns the manifest or throws WorkflowError.
 * The order of checks is part of the contract: the first failing check names the code.
 */
export function verifyBundle(directory, expectedIdentity = null) {
  const top = lkind(directory);
  if (top === "missing") throw new WorkflowError("BUNDLE_MISSING", directory);
  if (top !== "dir") throw new WorkflowError("BUNDLE_SYMLINK", directory);
  const manifest = readManifest(directory);
  if (manifest?.format !== BUNDLE_FORMAT) throw new WorkflowError("FORMAT_UNSUPPORTED", String(manifest?.format));
  if (!Array.isArray(manifest.files) || typeof manifest.version !== "string") throw new WorkflowError("BUNDLE_CORRUPT", "manifest shape");
  let identity;
  try {
    identity = bundleIdentity(manifest);
  } catch (error) {
    throw new WorkflowError("BUNDLE_CORRUPT", error.message);
  }
  if (identity !== manifest.identity) throw new WorkflowError("BUNDLE_CORRUPT", "identity does not match manifest content");
  if (manifest.workflow_id !== workflowId(manifest.version, manifest.identity)) throw new WorkflowError("BUNDLE_CORRUPT", "workflow_id does not derive from version and identity");
  if (expectedIdentity !== null && manifest.identity !== expectedIdentity) {
    throw new WorkflowError("BUNDLE_IDENTITY_MISMATCH", manifest.identity, { expected: expectedIdentity });
  }
  const listed = new Map();
  for (const entry of manifest.files) {
    const path = entry?.path;
    const [client, ...rest] = typeof path === "string" ? path.split("/") : [];
    if (!safeRelpath(path) || !CLIENTS.includes(client) || rest.length === 0) throw new WorkflowError("BUNDLE_PATH_UNSAFE", String(path));
    checkVariantPath(client, rest.join("/"));
    listed.set(path, entry);
  }
  const actual = new Set();
  for (const entry of walkEntries(directory)) {
    if (entry.kind === "symlink" || entry.kind === "other") throw new WorkflowError("BUNDLE_SYMLINK", entry.rel);
    if (entry.kind === "file" && entry.rel !== BUNDLE_MANIFEST) actual.add(entry.rel);
  }
  const missing = [...listed.keys()].filter((p) => !actual.has(p)).sort(byBytes);
  const extra = [...actual].filter((p) => !listed.has(p)).sort(byBytes);
  if (missing.length) throw new WorkflowError("BUNDLE_INCOMPLETE", missing[0], { missing });
  if (extra.length) throw new WorkflowError("BUNDLE_EXTRA_FILES", extra[0], { extra });
  for (const [path, entry] of listed) {
    if (sha256(readFileSync(join(directory, path))) !== entry.sha256) throw new WorkflowError("BUNDLE_CORRUPT", path);
    if (entry.mode === "755" && fileMode(join(directory, path)) !== "755") throw new WorkflowError("BUNDLE_CORRUPT", `${path}: mode`);
  }
  return manifest;
}

/**
 * A generated plugin package: its root files must equal `bundle/<client>/` byte for byte (§ 3.5).
 * Returns `{client, manifest}`.
 */
export function verifyPlugin(packageRoot) {
  const bundleDir = join(packageRoot, BUNDLE_DIR);
  const manifest = verifyBundle(bundleDir);
  const client = CLIENTS.find((c) => lkind(join(packageRoot, `.${c}-plugin`, "plugin.json")) === "file");
  if (!client) throw new WorkflowError("ENTRY_WITHOUT_BUNDLE", "no client plugin manifest at the package root");
  const expected = new Map(manifest.files.filter((f) => f.path.startsWith(`${client}/`)).map((f) => [f.path.slice(client.length + 1), f]));
  const problems = [];
  // Claude owns these transient cache liveness markers, not the instruction bundle.
  // Prune before traversal: a session may change markers while verification runs.
  // Keep bundle verification strict and reject root files/symlinks with this name.
  for (const entry of walkEntries(packageRoot, { skipRootDirectories: client === "claude" ? [".in_use"] : [] })) {
    if (entry.rel === BUNDLE_DIR || entry.rel.startsWith(`${BUNDLE_DIR}/`) || entry.rel === "GENERATED.json") continue;
    if (entry.kind === "symlink" || entry.kind === "other") problems.push({ path: entry.rel, problem: "link" });
    if (entry.kind !== "file") continue;
    const want = expected.get(entry.rel);
    if (!want) problems.push({ path: entry.rel, problem: "not in bundle" });
    else if (sha256(readFileSync(join(packageRoot, entry.rel))) !== want.sha256) problems.push({ path: entry.rel, problem: "differs from bundle" });
    expected.delete(entry.rel);
  }
  for (const rel of expected.keys()) problems.push({ path: rel, problem: "missing at package root" });
  if (problems.length) throw new WorkflowError("ENTRY_BUNDLE_CORRUPT", problems[0].path, { problems });
  return { client, manifest };
}

/**
 * The bundle of the entry this helper runs from: the plugin layout (`<root>/bundle/bundle.json`)
 * or the store layout (`<store>/<id>/<client>/`, bundle.json one level up). Never a cache scan.
 */
export function ownBundle(variantRoot) {
  if (lkind(join(variantRoot, BUNDLE_DIR, BUNDLE_MANIFEST)) === "file") {
    const { client, manifest } = verifyPlugin(variantRoot);
    return { layout: "plugin", client, manifest, bundleDir: join(variantRoot, BUNDLE_DIR) };
  }
  const parent = dirname(variantRoot);
  const client = posix.basename(variantRoot.replaceAll("\\", "/"));
  if (CLIENTS.includes(client) && lkind(join(parent, BUNDLE_MANIFEST)) === "file") {
    const manifest = verifyBundle(parent);
    return { layout: "store", client, manifest, bundleDir: parent };
  }
  throw new WorkflowError("ENTRY_WITHOUT_BUNDLE", "this entry ships no bundle; update the feature-workflow plugin");
}

// ---------------------------------------------------------------------------
// § 3.4 store: publish, inspect, restore
// ---------------------------------------------------------------------------

/** Same rule as select-source/locate: explicit env, then XDG data home, then ~/.local/share. */
export function bridgeHome(env = process.env) {
  if (env[HOME_ENV]) return resolve(env[HOME_ENV]);
  const data = env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : join(homedir(), ".local", "share");
  return join(data, "claude-codex-bridge");
}

/** `<bridge-home>/workflows`, guarded: the home may be anywhere, `workflows` may not be redirected. */
export function storeRoot(env = process.env) {
  return managedPath(canonicalAnchor(bridgeHome(env)), ["workflows"]);
}

function checkWorkflowId(id) {
  if (!WORKFLOW_ID.test(String(id))) throw new WorkflowError("FORMAT_INVALID", `workflow_id ${id}`);
}

/** State of one store entry, read-only: `{state: verified|missing|corrupt, code?, manifest?}`. */
export function storeEntry(store, identity) {
  if (!IDENTITY.test(String(identity))) throw new WorkflowError("FORMAT_INVALID", `identity ${identity}`);
  const candidates = lkind(store) === "dir"
    ? readdirSync(store).filter((name) => !name.startsWith(".") && name.endsWith(`-${identity.slice(7, 19)}`)).sort(byBytes)
    : [];
  if (candidates.length === 0) return { state: "missing", code: "BUNDLE_MISSING", path: null };
  if (candidates.length > 1) return { state: "corrupt", code: "STORE_ID_COLLISION", path: join(store, candidates[0]), candidates };
  const path = join(store, candidates[0]);
  try {
    const manifest = verifyBundle(path, identity);
    if (manifest.workflow_id !== candidates[0]) return { state: "corrupt", code: "STORE_ENTRY_MISPLACED", path };
    return { state: "verified", path, manifest };
  } catch (error) {
    if (!(error instanceof WorkflowError)) throw error;
    return { state: "corrupt", code: error.code, detail: error.detail, path };
  }
}

/**
 * Publish a bundle into `<store>/<workflow_id>/` (§ 3.4): copy to a staging sibling, verify the
 * copy, rename, make read-only. An existing entry is verified and never overwritten.
 * `failAfter` is a test hook naming a crash point ("copy").
 */
export function storePublish(store, bundleDir, { failAfter = null } = {}) {
  assertStore(store);
  const manifest = verifyBundle(bundleDir);
  checkWorkflowId(manifest.workflow_id);
  const target = join(store, manifest.workflow_id);
  const existing = lkind(target);
  if (existing !== "missing") {
    if (existing !== "dir") throw new WorkflowError("BUNDLE_SYMLINK", target);
    let present;
    try {
      present = verifyBundle(target);
    } catch (error) {
      if (!(error instanceof WorkflowError)) throw error;
      throw new WorkflowError("STORE_ENTRY_CORRUPT", error.code, { path: target, reason: error.code, next_step: "workflow restore (quarantines the damaged entry)" });
    }
    if (present.identity !== manifest.identity) throw new WorkflowError("STORE_ID_COLLISION", manifest.workflow_id, { path: target });
    return { result: "ALREADY_PRESENT", workflow_id: manifest.workflow_id, identity: manifest.identity, path: target };
  }
  mkdirSync(store, { recursive: true });
  const staging = join(store, `${STAGING_PREFIX}${manifest.workflow_id}-${process.pid}-${randomBytes(4).toString("hex")}`);
  cpSync(bundleDir, staging, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
  verifyBundle(staging, manifest.identity);
  if (failAfter === "copy") return { result: "CRASHED", after: "copy", staging };
  renameSync(staging, target);
  makeReadOnly(target);
  return { result: "PUBLISHED", workflow_id: manifest.workflow_id, identity: manifest.identity, path: target };
}

/** Interrupted publications are invisible (`.staging-*`); this removes them on explicit request. */
export function sweepStaging(store) {
  assertStore(store);
  if (lkind(store) !== "dir") return { removed: [], skipped: [] };
  const removed = [];
  const skipped = [];
  for (const name of readdirSync(store).filter((n) => n.startsWith(STAGING_PREFIX)).sort(byBytes)) {
    // Only directories this helper could have staged; a link or file with that name is reported.
    if (lkind(join(store, name)) !== "dir") {
      skipped.push(name);
      continue;
    }
    makeWritable(join(store, name));
    rmSync(join(store, name), { recursive: true, force: true });
    removed.push(name);
  }
  return { removed, skipped };
}

/**
 * Restore exactly `identity` into the store from a source bundle of that identity (§ 3.4, R19-C04).
 *
 * A verified entry is left alone. A damaged entry is never repaired in place: it is renamed to a
 * `.quarantine-<workflow_id>-<stamp>` sibling with its bytes and permissions intact, a sidecar
 * `<quarantine>.json` records why, and only then is the source published. A source of any other
 * identity is refused before anything moves.
 */
export function storeRestore(store, identity, sourceBundleDir, { now = new Date() } = {}) {
  assertStore(store);
  const source = verifyBundle(sourceBundleDir, identity);
  const before = storeEntry(store, identity);
  if (before.state === "verified") return { result: "ALREADY_PRESENT", workflow_id: source.workflow_id, identity, path: before.path, quarantined: null };
  // A *valid* bundle of another identity under this name is a collision, not damage: never moved.
  if (before.code === "BUNDLE_IDENTITY_MISMATCH" || before.code === "STORE_ID_COLLISION") {
    throw new WorkflowError("STORE_ID_COLLISION", source.workflow_id, { path: before.path, next_step: "inspect the store manually; nothing was changed" });
  }
  let quarantined = null;
  const target = join(store, source.workflow_id);
  const damaged = lkind(target) !== "missing" ? target : before.path;
  if (damaged) {
    // A link under the entry's name is not damage this helper may move: refuse, change nothing.
    if (lkind(damaged) === "symlink") throw new WorkflowError("PATH_REDIRECTED", damaged, { reason: "store entry is a symbolic link; nothing was moved" });
    const stamp = now.toISOString().replace(/[-:]/gu, "").replace(/\.\d+Z$/u, "Z");
    const name = `${QUARANTINE_PREFIX}${posix.basename(damaged)}-${stamp}-${randomBytes(3).toString("hex")}`;
    const record = {
      format: "feature-workflow.quarantine/v1",
      identity,
      entry: posix.basename(damaged),
      reason: before.code ?? "STORE_ENTRY_CORRUPT",
      detail: before.detail ?? null,
      bundle_json_sha256: lkind(join(damaged, BUNDLE_MANIFEST)) === "file" ? sha256(readFileSync(join(damaged, BUNDLE_MANIFEST))) : null,
      at: now.toISOString(),
    };
    // Same parent directory: a read-only entry can be renamed without touching its contents.
    renameSync(damaged, join(store, name));
    writeAtomic(join(store, `${name}.json`), jsonBytes(record));
    quarantined = { name, ...record };
  }
  const published = storePublish(store, sourceBundleDir);
  const after = storeEntry(store, identity);
  if (after.state !== "verified") throw new WorkflowError(after.code ?? "BUNDLE_CORRUPT", "restored entry does not verify");
  return { result: "RESTORED", workflow_id: published.workflow_id, identity, path: published.path, quarantined };
}

// ---------------------------------------------------------------------------
// § 5 compatibility
// ---------------------------------------------------------------------------

/**
 * Problems that block dependent work (§ 5.3), first one decisive. `runtime` is the runtime's
 * advertisement (`{package_version, workflow_binding}`) or null for no/unknown runtime.
 * mode "standalone" checks formats and nothing bridge-specific (§ 5.4).
 */
export function checkCompatibility(requires, runtime, { mode }) {
  const problems = [];
  const formats = requires?.workflow_formats ?? {};
  for (const [name, supported] of Object.entries(SUPPORTED_FORMATS)) {
    const wanted = formats[name] ?? supported;
    if (wanted !== supported) problems.push({ code: "FORMAT_UNSUPPORTED", what: name, required: wanted, supported });
  }
  if (mode === "standalone") return problems;
  const bridge = requires?.bridge ?? {};
  if (!runtime || !runtime.workflow_binding) {
    problems.push({ code: "RUNTIME_WITHOUT_BINDING", next_step: "one-time runtime upgrade to a runtime advertising workflow_binding" });
    return problems;
  }
  const advert = runtime.workflow_binding;
  const contracts = Array.isArray(advert.contracts) ? advert.contracts : [];
  if (!contracts.includes(bridge.binding_contract)) problems.push({ code: "BINDING_CONTRACT_UNSUPPORTED", required: bridge.binding_contract ?? null, supported: contracts });
  const have = new Set(Array.isArray(advert.capabilities) ? advert.capabilities : []);
  const missing = (bridge.capabilities ?? []).filter((c) => !have.has(c)).sort(byBytes);
  if (missing.length) problems.push({ code: "CAPABILITY_MISSING", missing });
  for (const rule of bridge.known_incompatible ?? []) {
    if ((rule.versions ?? []).includes(runtime.package_version)) problems.push({ code: "RUNTIME_KNOWN_INCOMPATIBLE", runtime: runtime.package_version, reason: rule.reason ?? null });
  }
  return problems;
}

/** The workflow-binding advertisement of an installed runtime, or null (pre-binding runtime). */
export function runtimeAdvertisement(runtimePath) {
  try {
    const manifest = JSON.parse(readFileSync(join(runtimePath, "runtime-manifest.json"), "utf8"));
    return { package_version: manifest.package_version ?? null, workflow_binding: manifest.compatibility?.workflow_binding ?? null };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// § 2.3 release source and registry
// ---------------------------------------------------------------------------

export function readRelease(path) {
  const release = JSON.parse(readFileSync(path, "utf8"));
  if (release.format !== RELEASE_FORMAT || release.component !== COMPONENT || typeof release.version !== "string") {
    throw new WorkflowError("FORMAT_INVALID", `${path} is not a ${RELEASE_FORMAT} source`);
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/u.test(release.version)) throw new WorkflowError("FORMAT_INVALID", `version ${release.version}`);
  return release;
}

/**
 * The append-only registry of published releases. A version already registered with another
 * identity is `VERSION_REUSED`. The registry is outside every bundle (R19-C01): it names bundle
 * identities, so including it would make a bundle depend on its own hash.
 */
export function checkRegistry(registry, manifest) {
  if (registry.format !== RELEASES_FORMAT || !Array.isArray(registry.releases)) throw new WorkflowError("FORMAT_INVALID", "releases registry");
  const seen = new Set();
  for (const entry of registry.releases) {
    if (seen.has(entry.version)) throw new WorkflowError("FORMAT_INVALID", `version ${entry.version} registered twice`);
    seen.add(entry.version);
    if (!IDENTITY.test(String(entry.identity))) throw new WorkflowError("FORMAT_INVALID", `identity of ${entry.version}`);
  }
  const hit = registry.releases.find((entry) => entry.version === manifest.version);
  if (hit && hit.identity !== manifest.identity) {
    throw new WorkflowError("VERSION_REUSED", manifest.version, { registered: hit.identity, generated: manifest.identity });
  }
  return { registered: Boolean(hit), state: hit ? "released" : "candidate" };
}

// ---------------------------------------------------------------------------
// § 4.3 lock and § 4.4 draft → final id
// ---------------------------------------------------------------------------

export function newLock(manifest, { origin, at, draftToken = null, featureId = null }) {
  return {
    format: LOCK_FORMAT,
    feature: { feature_id: featureId, draft_token: draftToken },
    workflow: { version: manifest.version, identity: manifest.identity, workflow_id: manifest.workflow_id, kind: manifest.kind },
    generation: 1,
    origin,
    history: [{ generation: 1, op: origin.kind === "adopt" ? "adopt" : "begin", version: manifest.version, identity: manifest.identity, origin: origin.kind, at }],
  };
}

export function validateLock(lock) {
  if (lock?.format !== LOCK_FORMAT) throw new WorkflowError("LOCK_FORMAT_UNSUPPORTED", String(lock?.format));
  const walk = (value, where) => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, where);
    } else if (value && typeof value === "object") {
      for (const [key, inner] of Object.entries(value)) {
        if (FORBIDDEN_LOCK_KEYS.has(key)) throw new WorkflowError("LOCK_INVALID", `forbidden key ${where}${key}`);
        walk(inner, `${where}${key}.`);
      }
    } else if (typeof value === "string" && (value.startsWith("/") || value.startsWith("~") || /^[A-Za-z]:[\\/]/u.test(value))) {
      throw new WorkflowError("LOCK_INVALID", `absolute path in ${where.replace(/\.$/u, "")}`);
    }
  };
  walk(lock, "");
  const history = Array.isArray(lock.history) ? lock.history : [];
  const head = history.at(-1);
  if (!head || head.generation !== lock.generation || head.identity !== lock.workflow?.identity) throw new WorkflowError("LOCK_INVALID", "history head does not match the current selection");
  if (history.some((entry, index) => entry.generation !== index + 1)) throw new WorkflowError("LOCK_INVALID", "generations must be 1..n without gaps");
  if (!IDENTITY.test(String(lock.workflow.identity)) || workflowId(lock.workflow.version, lock.workflow.identity) !== lock.workflow.workflow_id) {
    throw new WorkflowError("LOCK_INVALID", "workflow_id does not derive from identity");
  }
  return lock;
}

export function readLock(featureDir) {
  const path = join(featureDir, LOCK_NAME);
  const kind = lkind(path);
  if (kind === "missing") return null;
  if (kind !== "file") throw new WorkflowError("LOCK_INVALID", `${LOCK_NAME} is not a regular file`);
  let lock;
  try {
    lock = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new WorkflowError("LOCK_INVALID", error.message);
  }
  return validateLock(lock);
}

export function writeLock(featureDir, lock) {
  validateLock(lock);
  for (const path of [featureDir, join(featureDir, LOCK_NAME)]) {
    if (lkind(path) === "symlink") throw new WorkflowError("PATH_REDIRECTED", path, { reason: "symbolic link in a managed feature path; nothing was written" });
  }
  writeAtomic(join(featureDir, LOCK_NAME), jsonBytes(lock));
}

export function newDraftToken() {
  return randomBytes(4).toString("hex");
}

function checkFeatureId(id) {
  checkFeatureName(id, { allowDraft: false });
}

/** Draft path → final feature id (§ 4.4). Idempotent and resumable; `failAfter` = "mark"|"move". */
export function finalizeDraft(featuresRoot, draftToken, featureId, { failAfter = null } = {}) {
  checkFeatureId(featureId);
  if (!/^[0-9a-f]{8}$/u.test(String(draftToken))) throw new WorkflowError("FORMAT_INVALID", `draft token ${draftToken}`);
  const root = lkind(featuresRoot);
  if (root === "symlink") throw new WorkflowError("PATH_REDIRECTED", featuresRoot, { reason: "docs/features is a symbolic link; nothing was written" });
  const draft = join(featuresRoot, `${DRAFT_PREFIX}${draftToken}`);
  const target = join(featuresRoot, featureId);
  for (const path of [draft, target, join(draft, LOCK_NAME), join(target, LOCK_NAME)]) {
    if (lkind(path) === "symlink") throw new WorkflowError("PATH_REDIRECTED", path, { reason: "symbolic link in a managed feature path; nothing was written" });
  }
  const targetKind = lkind(target);
  if (targetKind !== "missing" && targetKind !== "dir") throw new WorkflowError("FEATURE_DIR_COLLISION", featureId, { reason: "target is not a directory" });
  const targetLock = targetKind === "dir" ? readLock(target) : null;
  if (targetLock) {
    if (targetLock.feature.draft_token === draftToken && targetLock.feature.feature_id === featureId) {
      if (lkind(draft) === "dir" && readdirSync(draft).length === 0) rmdirSync(draft);
      return { result: "ALREADY_FINAL", feature_dir: featureId };
    }
    throw new WorkflowError("FEATURE_DIR_COLLISION", featureId, { reason: "target already holds a different workflow lock" });
  }
  if (lkind(draft) !== "dir") throw new WorkflowError("DRAFT_MISSING", posix.basename(draft));
  const lock = readLock(draft);
  if (!lock) throw new WorkflowError("DRAFT_MISSING", `${posix.basename(draft)}/${LOCK_NAME}`);
  if (lock.feature.feature_id !== null && lock.feature.feature_id !== featureId) throw new WorkflowError("DRAFT_ALREADY_ASSIGNED", lock.feature.feature_id);
  if (lock.feature.feature_id === null) {
    lock.feature.feature_id = featureId;
    writeLock(draft, lock);
  }
  if (failAfter === "mark") return { result: "CRASHED", after: "mark" };
  if (targetKind === "dir") {
    const others = readdirSync(draft).filter((name) => name !== LOCK_NAME).sort(byBytes);
    if (others.length) throw new WorkflowError("FEATURE_DIR_COLLISION", featureId, { reason: "both directories hold documents", draft_files: others });
    renameSync(join(draft, LOCK_NAME), join(target, LOCK_NAME));
    if (failAfter === "move") return { result: "CRASHED", after: "move" };
    rmdirSync(draft);
  } else {
    renameSync(draft, target);
  }
  return { result: "FINALIZED", feature_dir: featureId };
}

/** Standalone switch (§ 7.4): one atomic lock replacement with appended history. */
export function standaloneSwitch(featureDir, target, { expectedGeneration, at }) {
  const lock = readLock(featureDir);
  if (!lock) throw new WorkflowError("WORKFLOW_UNBOUND", "feature has no workflow lock");
  if (lock.generation !== expectedGeneration) throw new WorkflowError("WORKFLOW_GENERATION_CONFLICT", String(lock.generation), { expected: expectedGeneration });
  if (lock.workflow.identity === target.identity) return { result: "ALREADY_SELECTED", generation: lock.generation, lock };
  const from = lock.workflow.identity;
  const generation = lock.generation + 1;
  const next = {
    ...lock,
    workflow: { version: target.version, identity: target.identity, workflow_id: target.workflow_id, kind: target.kind },
    generation,
    origin: { kind: "switch", from_identity: from },
    history: [...lock.history, { generation, op: "switch", version: target.version, identity: target.identity, origin: "switch", at }],
  };
  writeLock(featureDir, next);
  return { result: "SWITCHED", generation, from_identity: from, lock: next };
}

// ---------------------------------------------------------------------------
// § 10.3 legacy evidence (consumed by W19-03 bind_legacy)
// ---------------------------------------------------------------------------

/** Which old instruction set a lock-less feature followed, from `record` lines. Never guesses. */
export function legacyEvidence(records, pinRuntimeId, installedRuntimeIds) {
  const runtimeLines = records.filter((line) => line.startsWith("INSTRUCTIONS=runtime:"));
  const runtimes = [...new Set(runtimeLines.map((line) => line.slice("INSTRUCTIONS=runtime:".length).split(/\s/u)[0]))].sort(byBytes);
  const sets = [...new Set(runtimeLines.filter((l) => l.includes("SET=")).map((l) => l.split("SET=")[1].split(/\s/u)[0]))].sort(byBytes);
  if (runtimes.length > 1 || sets.length > 1) {
    return { verdict: "AMBIGUOUS", candidates: runtimes, sets, next_step: "explicit user choice of one recorded runtime (bind_legacy with runtime_id)" };
  }
  let runtimeId = runtimes[0];
  let basis = "ledger INSTRUCTIONS record";
  if (!runtimeId) {
    if (!pinRuntimeId) return { verdict: "UNPROVEN", next_step: "no recorded instruction set and no pin; explicit user choice required" };
    runtimeId = pinRuntimeId;
    basis = "project pin before upgrade (no ledger record)";
  }
  if (!installedRuntimeIds.has(runtimeId)) {
    return { verdict: "SOURCE_MISSING", runtime_id: runtimeId, basis, next_step: `reinstall exactly runtime ${runtimeId} (setup install by pin); no newer set is substituted` };
  }
  return { verdict: "PROVEN", runtime_id: runtimeId, set_sha256: sets[0] ?? null, basis };
}

/** `record` lines found in a feature's ledgers (execution/**.md), for legacyEvidence. */
export function featureRecords(featureDir) {
  const out = [];
  const execution = join(featureDir, "execution");
  if (lkind(execution) !== "dir") return out;
  for (const entry of walkEntries(execution)) {
    if (entry.kind !== "file" || !entry.rel.endsWith(".md")) continue;
    for (const match of readFileSync(join(execution, entry.rel), "utf8").matchAll(/INSTRUCTIONS=(?:runtime|plugin|bundle):[^\s`]+(?: [A-Z_]+=[^\s`]+)*/gu)) out.push(match[0]);
  }
  return out;
}

export { existsSync };
