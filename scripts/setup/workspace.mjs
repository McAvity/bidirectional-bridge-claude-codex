// Per-worktree setup: plan and apply init, update and rollback. A plan is computed from what is
// on disk, shown, and applied only as a whole; conflicts and refusals write nothing.

import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  LOCAL_DIR,
  SetupError,
  canonical,
  newTag,
  readJson,
  readOptional,
  run,
  sha256,
  tempSibling,
  writeAtomic,
} from "./common.mjs";
import { findActiveUse } from "./processes.mjs";
import {
  LAUNCHER,
  STARTUP_TIMEOUT_SEC,
  TOOL_TIMEOUT_SEC,
  knownInstructionHashes,
  listRuntimes,
  loadRuntimeAt,
  verifyRuntime,
} from "./runtime.mjs";

export const RECORD_FORMAT = "claude-codex-bridge.workspace-install/v1";
const PENDING_FORMAT = "claude-codex-bridge.workspace-pending/v1";
export const BLOCK_BEGIN = "# >>> claude-codex-bridge managed block >>>";
export const BLOCK_END = "# <<< claude-codex-bridge managed block <<<";
export const CODEX_CONFIG = ".codex/config.toml";
const GITIGNORE = ".gitignore";
/** Test-only fault injection: SIGKILL this process after N writes of an apply. */
const CRASH_HOOK = "CLAUDE_CODEX_BRIDGE_TEST_CRASH_AFTER";

export function localPaths(root) {
  const dir = join(root, LOCAL_DIR);
  return {
    dir,
    record: join(dir, "install.json"),
    pending: join(dir, "pending.json"),
    selection: join(dir, "current"),
    backup: join(dir, "backup"),
  };
}

/** The MCP server Codex starts from the managed block; the doctor handshake replays it. */
export function mcpDefinition(manifest) {
  return {
    command: "node",
    args: [
      `${LOCAL_DIR}/current/${manifest?.mcp?.launcher ?? LAUNCHER}`,
      "--caller",
      "codex",
      "--delegation",
      "allow",
      "--workspace",
      ".",
    ],
    cwd: ".",
    required: true,
    startup_timeout_sec: manifest?.mcp?.startup_timeout_sec ?? STARTUP_TIMEOUT_SEC,
    tool_timeout_sec: manifest?.mcp?.tool_timeout_sec ?? TOOL_TIMEOUT_SEC,
  };
}

export function renderCodexBlock(manifest) {
  const definition = mcpDefinition(manifest);
  const toml = (value) => JSON.stringify(value);
  return [
    BLOCK_BEGIN,
    "# Written by the bridge setup CLI (scripts/bridge.mjs). This worktree selects its runtime with",
    "# .bridge-runtime/current; start `codex` in the worktree root. tool_timeout_sec is the client",
    "# wait for one MCP call and never stops a running round.",
    "[mcp_servers.bridge]",
    `command = ${toml(definition.command)}`,
    `args = [${definition.args.map(toml).join(", ")}]`,
    `cwd = ${toml(definition.cwd)}`,
    `required = ${definition.required}`,
    `startup_timeout_sec = ${definition.startup_timeout_sec}`,
    `tool_timeout_sec = ${definition.tool_timeout_sec}`,
    BLOCK_END,
    "",
  ].join("\n");
}

const GITIGNORE_BLOCK = [BLOCK_BEGIN, "/.bridge/", `/${LOCAL_DIR}/`, BLOCK_END, ""].join("\n");

export function findBlock(text) {
  const lines = text.split("\n");
  const begins = [];
  const ends = [];
  lines.forEach((line, index) => {
    if (line.trim() === BLOCK_BEGIN) begins.push(index);
    if (line.trim() === BLOCK_END) ends.push(index);
  });
  if (begins.length === 0 && ends.length === 0) return { kind: "none" };
  if (begins.length !== 1 || ends.length !== 1 || ends[0] < begins[0]) return { kind: "malformed" };
  const [begin] = begins;
  const [end] = ends;
  return {
    kind: "found",
    before: begin > 0 ? `${lines.slice(0, begin).join("\n")}\n` : "",
    block: `${lines.slice(begin, end + 1).join("\n")}\n`,
    after: lines.slice(end + 1).join("\n"),
  };
}

const TOML_KEY = String.raw`(?:mcp_servers|"mcp_servers"|'mcp_servers')`;
const TOML_BRIDGE = String.raw`(?:bridge|"bridge"|'bridge')`;

/** Conservative scan: true when text defines, or may define, mcp_servers.bridge. */
export function definesBridge(text) {
  const header = new RegExp(String.raw`^\s*\[\[?\s*${TOML_KEY}\s*\.\s*${TOML_BRIDGE}\s*[.\]]`, "u");
  const dotted = new RegExp(String.raw`^\s*${TOML_KEY}\s*\.\s*${TOML_BRIDGE}\s*[.=]`, "u");
  const inline = new RegExp(String.raw`^\s*${TOML_KEY}\s*=`, "u");
  const parent = new RegExp(String.raw`^\s*\[\s*${TOML_KEY}\s*\]`, "u");
  const key = new RegExp(String.raw`^\s*${TOML_BRIDGE}\s*[.=]`, "u");
  let inParent = false;
  for (const line of text.split("\n")) {
    if (/^\s*#/u.test(line)) continue;
    if (header.test(line) || dotted.test(line) || inline.test(line)) return true;
    if (/^\s*\[/u.test(line)) {
      inParent = parent.test(line);
      continue;
    }
    if (inParent && key.test(line)) return true;
  }
  return false;
}

/** Parse TOML with python3 tomllib and return the effective mcp_servers.bridge table. */
export function inspectCodexToml(text, env = process.env) {
  const script =
    "import json, sys\n" +
    "try:\n    import tomllib\nexcept ModuleNotFoundError:\n    sys.exit(3)\n" +
    "try:\n    data = tomllib.loads(sys.stdin.read())\n" +
    "except tomllib.TOMLDecodeError as error:\n    print(str(error))\n    sys.exit(4)\n" +
    "print(json.dumps((data.get('mcp_servers') or {}).get('bridge')))\n";
  const result = run("python3", ["-c", script], { input: text, env });
  if (result.status === 0) return { status: "parsed", bridge: JSON.parse(result.stdout) };
  if (result.status === 4) return { status: "invalid", detail: result.stdout.trim() };
  return { status: "unverified", detail: "python3 with tomllib (3.11+) is not available" };
}

export function bridgeTableMatches(bridge, manifest) {
  const expected = mcpDefinition(manifest);
  return (
    bridge !== null &&
    typeof bridge === "object" &&
    JSON.stringify(Object.keys(bridge).sort()) === JSON.stringify(Object.keys(expected).sort()) &&
    Object.entries(expected).every(([key, value]) => JSON.stringify(bridge[key]) === JSON.stringify(value))
  );
}

export async function resolveIdentity(runtimePath, workspacePath) {
  let controlPlane;
  try {
    controlPlane = await import(pathToFileURL(join(runtimePath, "shared/control-plane/dist/index.js")).href);
  } catch (error) {
    throw new SetupError("RUNTIME_INCOMPLETE", `runtime ${runtimePath} cannot resolve worktrees: ${error.message}`, {
      nextStep: "install the commit again under a clean runtimes directory",
    });
  }
  try {
    const identity = controlPlane.resolveWorkspaceIdentity(resolve(workspacePath));
    return { kind: identity.kind, root: identity.root, git_dir: identity.git_dir };
  } catch (error) {
    const reason = error?.details?.reason ?? null;
    const code = reason === "not_worktree_root"
      ? "WORKSPACE_NOT_ROOT"
      : reason === "workspace_missing"
        ? "WORKSPACE_MISSING"
        : "WORKSPACE_UNRESOLVED";
    throw new SetupError(code, error.message, {
      details: { reason },
      nextStep: "pass the worktree root directory (the directory `git rev-parse --show-toplevel` prints)",
    });
  }
}

export function readRecord(root, identity) {
  const parsed = readJson(localPaths(root).record);
  if (parsed.kind !== "valid") return parsed;
  const value = parsed.value;
  if (value.format !== RECORD_FORMAT || typeof value.runtime?.id !== "string" || typeof value.workspace?.root !== "string") {
    return { kind: "invalid", detail: "unexpected format" };
  }
  if (identity && (value.workspace.root !== identity.root || (value.workspace.git_dir ?? null) !== identity.git_dir)) {
    return { kind: "foreign", value };
  }
  return { kind: "valid", value };
}

export function readSelection(root) {
  const path = localPaths(root).selection;
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return { kind: "absent" };
  }
  if (!stat.isSymbolicLink()) return { kind: "not-symlink" };
  const target = readlinkSync(path);
  try {
    return { kind: "ok", target, runtime: loadRuntimeAt(resolve(dirname(path), target)) };
  } catch (error) {
    return { kind: "broken", target, error };
  }
}

export function readPending(root) {
  const parsed = readJson(localPaths(root).pending);
  return parsed.kind === "absent" ? null : parsed.kind === "valid" ? parsed.value : { invalid: parsed.detail };
}

/** Schema version of this worktree's database, read-only; never migrates or creates anything. */
export function readStateSchema(root) {
  let database = join(root, ".bridge", "bridge.db");
  const marker = readJson(join(root, ".bridge", "workspace.json"));
  if (marker.kind === "valid" && typeof marker.value.database === "string") database = marker.value.database;
  if (!existsSync(database)) return { exists: false, database, version: 0 };
  try {
    const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
    const db = new DatabaseSync(database, { readOnly: true });
    try {
      const row = db.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get();
      return { exists: true, database, version: row ? Number(row.value) : 0 };
    } catch (error) {
      if (/no such table/u.test(String(error.message))) return { exists: true, database, version: 0 };
      throw error;
    } finally {
      db.close();
    }
  } catch (error) {
    return { exists: true, database, version: null, error: error.message };
  }
}

export function codexHostVersion(env = process.env) {
  const result = run("codex", ["--version"], { env, timeoutMs: 20_000 });
  if (result.error?.code === "ENOENT") return { installed: false, version: null };
  const match = /(\d+\.\d+\.\d+)/u.exec(result.stdout);
  return { installed: true, version: result.status === 0 && match ? match[1] : null, raw: result.stdout.trim() };
}

/** Reasons the target runtime cannot take over this worktree's state and host. */
export function compatibilityRefusals(target, root, env = process.env) {
  const refusals = [];
  const state = readStateSchema(root);
  const supported = target.manifest.compatibility.state_schema_version;
  if (state.exists && state.version === null) {
    refusals.push({
      code: "STATE_UNREADABLE",
      message: `cannot read the schema version of ${state.database}: ${state.error}`,
      nextStep: "run doctor and resolve the database problem before changing the runtime",
    });
  } else if (state.exists && supported === null) {
    refusals.push({
      code: "RUNTIME_COMPATIBILITY_UNKNOWN",
      message: `runtime ${target.id} does not declare which database schema it supports`,
      nextStep: "select a runtime that declares compatibility.state_schema_version",
    });
  } else if (state.exists && state.version > supported) {
    refusals.push({
      code: "STATE_SCHEMA_NEWER",
      message: `database schema ${state.version} is newer than runtime ${target.id} supports (${supported}); switching would not preserve state`,
      nextStep: "keep the current runtime or select one that supports this schema; the database is never restored from a copy",
    });
  }
  const adapters = target.manifest.compatibility.codex_identity_adapters;
  const host = codexHostVersion(env);
  if (host.version && Array.isArray(adapters) && !adapters.includes(host.version)) {
    refusals.push({
      code: "CODEX_VERSION_UNSUPPORTED",
      message: `Codex ${host.version} has no verified identity adapter in runtime ${target.id} (verified: ${adapters.join(", ")})`,
      nextStep: "use a verified Codex version; the adapter check is not bypassed",
    });
  }
  return refusals;
}

function knownCodexBlocks(home) {
  return new Set(listRuntimes(home).filter((runtime) => runtime.manifest).map((runtime) => sha256(renderCodexBlock(runtime.manifest))));
}

function fileMode(path, fallback) {
  try {
    return statSync(path).mode & 0o777;
  } catch {
    return fallback;
  }
}

function planInstructions(plan, home, target, keepLocal) {
  const known = knownInstructionHashes(home);
  const recorded = plan.record?.managed?.files ?? {};
  const files = {};
  for (const file of target.manifest.instructions.files) {
    const absolute = join(plan.root, file.path);
    let current;
    try {
      current = readOptional(absolute);
    } catch (error) {
      plan.conflicts.push({ code: "INSTRUCTION_CONFLICT", path: file.path, message: `cannot read: ${error.message}` });
      continue;
    }
    const source = join(target.path, file.path);
    const mode = (statSync(source).mode & 0o111) !== 0 ? 0o755 : 0o644;
    if (current === null) {
      plan.ops.push({ kind: "file", path: file.path, action: "create", after: file.sha256, source, mode });
      files[file.path] = file.sha256;
      continue;
    }
    const currentSha = sha256(current);
    if (currentSha === file.sha256) {
      files[file.path] = file.sha256;
    } else if (recorded[file.path] === currentSha || known.get(file.path)?.has(currentSha)) {
      plan.ops.push({
        kind: "file",
        path: file.path,
        action: "update",
        before: currentSha,
        after: file.sha256,
        source,
        previous: current,
        mode: fileMode(absolute, mode),
      });
      files[file.path] = file.sha256;
    } else if (keepLocal) {
      plan.kept.push({ path: file.path, sha256: currentSha });
    } else {
      plan.conflicts.push({
        code: "INSTRUCTION_MODIFIED",
        path: file.path,
        message: "differs from every installed runtime's copy (local modification or foreign file)",
        nextStep: "merge it by hand, move it aside, or re-run with --keep-local to keep this file unchanged",
      });
    }
  }
  const targetPaths = new Set(target.manifest.instructions.files.map((file) => file.path));
  for (const path of Object.keys(recorded)) {
    if (!targetPaths.has(path)) plan.notes.push(`${path} is not shipped by ${target.id}; left in place`);
  }
  return files;
}

function planCodexConfig(plan, home, target, env) {
  const absolute = join(plan.root, CODEX_CONFIG);
  const existing = readOptional(absolute);
  const rendered = renderCodexBlock(target.manifest);
  const conflict = (code, message) =>
    plan.conflicts.push({
      code,
      path: CODEX_CONFIG,
      message,
      nextStep: "remove or rename the other bridge definition, or fix the managed block, then run again",
    });
  let next = null;
  let action = null;
  if (existing === null) {
    next = rendered;
    action = "create";
  } else {
    const text = existing.toString("utf8");
    const found = findBlock(text);
    if (found.kind === "malformed") {
      conflict("CODEX_CONFIG_CONFLICT", "managed block markers are incomplete or repeated");
      return null;
    }
    if (found.kind === "found") {
      if (definesBridge(found.before + found.after)) {
        conflict("CODEX_CONFIG_CONFLICT", "mcp_servers.bridge is also defined outside the managed block");
        return null;
      }
      const blockSha = sha256(found.block);
      if (found.block === rendered) {
        next = text;
      } else if (plan.record?.managed?.codex_config_block === blockSha || knownCodexBlocks(home).has(blockSha)) {
        next = found.before + rendered + found.after;
        action = "update";
      } else {
        conflict("CODEX_CONFIG_MODIFIED", "the managed bridge block was edited locally");
        return null;
      }
    } else if (definesBridge(text)) {
      conflict("CODEX_CONFIG_CONFLICT", "defines mcp_servers.bridge (or an inline mcp_servers table) without the managed block");
      return null;
    } else {
      const separator = text.length === 0 ? "" : text.endsWith("\n") ? "\n" : "\n\n";
      next = text + separator + rendered;
      action = "append";
    }
  }
  const inspected = inspectCodexToml(next, env);
  if (inspected.status === "invalid") {
    conflict("CODEX_CONFIG_INVALID", `resulting TOML does not parse: ${inspected.detail}`);
    return null;
  }
  if (inspected.status === "parsed" && !bridgeTableMatches(inspected.bridge, target.manifest)) {
    conflict("CODEX_CONFIG_CONFLICT", "keys outside the managed block change the effective mcp_servers.bridge table");
    return null;
  }
  if (inspected.status === "unverified") plan.notes.push(`${CODEX_CONFIG} was not parsed: ${inspected.detail}`);
  if (action !== null) {
    plan.ops.push({
      kind: "file",
      path: CODEX_CONFIG,
      action,
      userFile: existing !== null,
      before: existing === null ? null : sha256(existing),
      after: sha256(next),
      content: Buffer.from(next),
      previous: existing,
      mode: fileMode(absolute, 0o644),
    });
  }
  return sha256(rendered);
}

function planGitignore(plan, env) {
  if (plan.identity.kind !== "git") return;
  const probes = [".bridge/bridge.db", `${LOCAL_DIR}/install.json`];
  const ignored = probes.every(
    (path) => run("git", ["-C", plan.root, "check-ignore", "-q", "--no-index", path], { env }).status === 0,
  );
  if (ignored) return;
  const absolute = join(plan.root, GITIGNORE);
  const existing = readOptional(absolute);
  const text = existing === null ? "" : existing.toString("utf8");
  if (findBlock(text).kind !== "none") {
    plan.conflicts.push({
      code: "GITIGNORE_CONFLICT",
      path: GITIGNORE,
      message: "the managed block exists, but .bridge/ or .bridge-runtime/ is still not ignored",
      nextStep: "remove the rule that re-includes those directories",
    });
    return;
  }
  const separator = text.length === 0 ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  const next = text + separator + GITIGNORE_BLOCK;
  plan.ops.push({
    kind: "file",
    path: GITIGNORE,
    action: existing === null ? "create" : "append",
    userFile: existing !== null,
    before: existing === null ? null : sha256(existing),
    after: sha256(next),
    content: Buffer.from(next),
    previous: existing,
    mode: fileMode(absolute, 0o644),
  });
}

/**
 * The first existing component of `rel` below `root` that is a symlink, or a non-directory where
 * a directory is needed. Setup never writes through a symlink: a linked directory can lead out of
 * the worktree, for example to instructions shared with another worktree.
 */
export function redirectedComponent(root, rel, { finalMayBeSymlink = false } = {}) {
  const parts = rel.split("/");
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    current = join(current, parts[index]);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    const last = index === parts.length - 1;
    const path = parts.slice(0, index + 1).join("/");
    if (stat.isSymbolicLink()) return last && finalMayBeSymlink ? null : { path, target: readlinkSync(current) };
    if (!last && !stat.isDirectory()) return { path, target: null };
  }
  return null;
}

function redirectionRefusal(found) {
  return found.target === null
    ? ["LOCAL_SETUP_CONFLICT", `${found.path} exists and is not a directory`, "move it aside and run again"]
    : [
        "PATH_REDIRECTED",
        `${found.path} is a symlink to ${found.target}; setup never writes through symlinks, which could change files outside this worktree`,
        "replace the symlink with a real directory or file, or keep those files unmanaged, then run again",
      ];
}

/** Every path init, update and rollback may write: instructions, configuration and local setup state. */
function managedDestinations(identity, target) {
  return [
    ...target.manifest.instructions.files.map((file) => ({ rel: file.path })),
    { rel: CODEX_CONFIG },
    ...(identity.kind === "git" ? [{ rel: GITIGNORE }] : []),
    ...["install.json", "pending.json", "backup"].map((name) => ({ rel: `${LOCAL_DIR}/${name}` })),
    { rel: `${LOCAL_DIR}/current`, finalMayBeSymlink: true },
  ];
}

/** Re-check a destination immediately before writing it, in case it changed after planning. */
function guardDestination(root, rel, options) {
  const found = redirectedComponent(root, rel, options);
  if (!found) return;
  const [code, message, nextStep] = redirectionRefusal(found);
  throw new SetupError(code, `${message} (changed after planning; stopped before writing it)`, { nextStep });
}

const comparableRecord = (record) =>
  record ? JSON.stringify({ workspace: record.workspace, runtime: record.runtime, managed: record.managed }) : null;

/**
 * Compute what `action` would change. `target` is a loaded runtime. Nothing is written.
 * `plan.ok` is false when anything conflicts or is refused; such a plan is never applied.
 */
export function planChange({ action, home, identity, target, keepLocal = false, env = process.env }) {
  const root = identity.root;
  const paths = localPaths(root);
  const recordRead = readRecord(root, identity);
  const selection = readSelection(root);
  const plan = {
    action,
    root,
    identity,
    target: { id: target.id, path: target.path, commit: target.manifest.source.commit },
    from: null,
    record: recordRead.kind === "valid" ? recordRead.value : null,
    pending: readPending(root),
    ops: [],
    kept: [],
    conflicts: [],
    refusals: [],
    notes: [],
  };
  const refuse = (code, message, nextStep) => plan.refusals.push({ code, message, nextStep });

  // Every destination is checked before anything is planned or written (review W12-R1).
  const redirected = new Map();
  for (const destination of managedDestinations(identity, target)) {
    const found = redirectedComponent(root, destination.rel, destination);
    if (found) redirected.set(found.path, found);
  }
  if (redirected.size > 0) {
    for (const found of redirected.values()) refuse(...redirectionRefusal(found));
    return finish(plan);
  }

  if (existsSync(paths.dir) && !lstatSync(paths.dir).isDirectory()) {
    refuse("LOCAL_SETUP_CONFLICT", `${LOCAL_DIR} exists and is not a directory`, "move it aside and run again");
    return finish(plan);
  }
  if (recordRead.kind === "foreign") {
    refuse(
      "SETUP_RECORD_FOREIGN",
      `${paths.record} belongs to ${recordRead.value.workspace.root}; this is a copy, not this worktree's setup`,
      `remove ${LOCAL_DIR}/ from this worktree after checking it, then run init; a copy is never adopted`,
    );
    return finish(plan);
  }
  if (recordRead.kind === "invalid") {
    refuse("SETUP_RECORD_INVALID", `${paths.record} cannot be used: ${recordRead.detail}`, "inspect the file; it is never rewritten automatically");
    return finish(plan);
  }
  if (selection.kind === "not-symlink") {
    refuse("LOCAL_SETUP_CONFLICT", `${paths.selection} exists and is not a symlink`, "move it aside and run again");
    return finish(plan);
  }
  const currentId = plan.record?.runtime.id ?? (selection.kind === "ok" ? selection.runtime.id : null);
  plan.from = currentId;
  if (action === "init" && currentId !== null && currentId !== target.id) {
    refuse("SETUP_ALREADY_INITIALIZED", `this worktree already selects runtime ${currentId}`, "use update or rollback to change the runtime");
    return finish(plan);
  }
  if ((action === "update" || action === "rollback") && plan.record === null) {
    refuse("SETUP_NOT_INITIALIZED", `this worktree has no ${LOCAL_DIR}/install.json`, "run init first");
    return finish(plan);
  }
  if (action === "rollback" && currentId === target.id) {
    refuse("ROLLBACK_SAME_RUNTIME", `runtime ${target.id} is already selected`, "pass --to <runtime id> of the version to return to");
    return finish(plan);
  }
  const problems = verifyRuntime(target);
  if (problems.length > 0) {
    refuse("RUNTIME_INCOMPLETE", `runtime ${target.id} is incomplete: ${problems.join("; ")}`, "install the commit again under a clean runtimes directory");
    return finish(plan);
  }

  const managedFiles = planInstructions(plan, home, target, keepLocal);
  const codexBlock = planCodexConfig(plan, home, target, env);
  planGitignore(plan, env);

  const selects = selection.kind !== "ok" || canonical(resolve(dirname(paths.selection), selection.target)) !== canonical(target.path);
  if (selects) {
    plan.ops.push({ kind: "select", action: selection.kind === "absent" ? "create" : "update", path: `${LOCAL_DIR}/current`, from: currentId, to: target.id, toPath: target.path });
  }
  if (selection.kind === "broken") plan.notes.push(`${LOCAL_DIR}/current pointed to a missing runtime (${selection.target})`);
  if (plan.pending) plan.notes.push("a previous apply was interrupted; this run completes it");

  const history = [...(plan.record?.history ?? [])];
  if (selects || plan.record === null) {
    history.push({ action, runtime_id: target.id, from: currentId, at: new Date().toISOString() });
  }
  plan.nextRecord = {
    format: RECORD_FORMAT,
    workspace: { kind: identity.kind, root, git_dir: identity.git_dir },
    runtime: {
      id: target.id,
      commit: target.manifest.source.commit,
      path: target.path,
      instructions_sha256: target.manifest.instructions.set_sha256,
    },
    managed: {
      files: managedFiles,
      kept_local: Object.fromEntries(plan.kept.map((file) => [file.path, file.sha256])),
      codex_config_block: codexBlock ?? plan.record?.managed?.codex_config_block ?? null,
    },
    history,
    updated_at: new Date().toISOString(),
  };
  plan.changed =
    plan.ops.length > 0 || plan.pending !== null || comparableRecord(plan.record) !== comparableRecord(plan.nextRecord);

  if (plan.changed && plan.conflicts.length === 0) {
    plan.refusals.push(...compatibilityRefusals(target, root, env));
    const use = findActiveUse(root, { env });
    // A worktree that never selected a runtime cannot run one; only its state files matter then.
    const blocking = currentId === null ? ["bridge-mcp", "state-open"] : ["bridge-mcp", "state-open", "client"];
    if (!use.supported) {
      refuse("ACTIVE_USE_UNKNOWN", `cannot tell whether this worktree is in use: ${use.reason}`, "run the command outside a sandbox on Linux");
    } else {
      const active = use.entries.filter((entry) => entry.kinds.some((kind) => blocking.includes(kind)));
      if (active.length > 0) {
        refuse(
          "ACTIVE_SESSION",
          `this worktree is in use: ${active.map((entry) => `pid ${entry.pid} (${entry.kinds.join("+")}: ${entry.command})`).join("; ")}`,
          "finish or pause the work and close these sessions normally, then run again; nothing is killed",
        );
      }
    }
  }
  return finish(plan);
}

function finish(plan) {
  plan.ok = plan.conflicts.length === 0 && plan.refusals.length === 0;
  plan.changed = plan.ok ? Boolean(plan.changed) : false;
  return plan;
}

/** Apply an ok plan: journal, files, selection, record — each step atomic, the set resumable. */
export function applyPlan(plan, { env = process.env } = {}) {
  if (!plan.ok) throw new Error("a plan with conflicts or refusals is never applied");
  if (!plan.changed) return { applied: false };
  const paths = localPaths(plan.root);
  guardDestination(plan.root, `${LOCAL_DIR}/pending.json`);
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  const tag = newTag();
  const crashAfter = Number.parseInt(env[CRASH_HOOK] ?? "", 10);
  let writes = 0;
  const wrote = () => {
    writes += 1;
    if (writes === crashAfter) process.kill(process.pid, "SIGKILL");
  };
  // A journal is only trusted for its own temp names and for paths this plan manages.
  const previous = plan.pending && /^[0-9a-f]{12}$/u.test(String(plan.pending.tag)) ? plan.pending : null;
  const managedPaths = new Set([
    ...Object.keys(plan.nextRecord.managed.files),
    ...Object.keys(plan.nextRecord.managed.kept_local),
    CODEX_CONFIG,
    GITIGNORE,
  ]);
  const fileOps = plan.ops.filter((op) => op.kind === "file");
  writeAtomic(
    paths.pending,
    `${JSON.stringify({
      format: PENDING_FORMAT,
      action: plan.action,
      runtime_id: plan.target.id,
      tag,
      started_at: new Date().toISOString(),
      paths: fileOps.map((op) => op.path),
    }, null, 2)}\n`,
    { mode: 0o600, tag },
  );
  for (const op of fileOps) {
    const absolute = join(plan.root, op.path);
    guardDestination(plan.root, op.path);
    if (op.userFile) {
      guardDestination(plan.root, `${LOCAL_DIR}/backup`);
      const backup = join(paths.backup, tag, op.path);
      mkdirSync(dirname(backup), { recursive: true });
      copyFileSync(absolute, backup);
    }
    writeAtomic(absolute, op.content ?? readFileSync(op.source), { mode: op.mode, tag });
    wrote();
  }
  for (const op of plan.ops.filter((entry) => entry.kind === "select")) {
    guardDestination(plan.root, `${LOCAL_DIR}/current`, { finalMayBeSymlink: true });
    const link = join(paths.dir, `.current-${tag}`);
    rmSync(link, { force: true });
    symlinkSync(op.toPath, link);
    renameSync(link, paths.selection);
    wrote();
  }
  guardDestination(plan.root, `${LOCAL_DIR}/install.json`);
  writeAtomic(paths.record, `${JSON.stringify(plan.nextRecord, null, 2)}\n`, { mode: 0o600, tag });
  wrote();
  if (previous) {
    for (const path of previous.paths ?? []) {
      if (managedPaths.has(path)) rmSync(tempSibling(join(plan.root, path), previous.tag), { force: true });
    }
    rmSync(tempSibling(paths.record, previous.tag), { force: true });
    rmSync(tempSibling(paths.pending, previous.tag), { force: true });
    rmSync(join(paths.dir, `.current-${previous.tag}`), { force: true });
    rmSync(join(paths.backup, String(previous.tag)), { recursive: true, force: true });
  }
  rmSync(join(paths.backup, tag), { recursive: true, force: true });
  try {
    if (readdirSync(paths.backup).length === 0) rmSync(paths.backup, { recursive: true });
  } catch {
    /* no backups */
  }
  unlinkSync(paths.pending);
  return { applied: true };
}
