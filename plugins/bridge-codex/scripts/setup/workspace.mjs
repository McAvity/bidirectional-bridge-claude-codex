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
/** The runtime's own state marker; the authority on which worktree `.bridge/` belongs to. */
export const MARKER_NAME = "workspace.json";
/** Committed, inherited project files of the dispatcher profile. */
export const PROJECT_DIR = ".bridge-project";
export const PROJECT_DECLARATION = `${PROJECT_DIR}/bridge.json`;
export const PROJECT_ENTRY = `${PROJECT_DIR}/entry.mjs`;
export const PROJECT_FORMAT = "claude-codex-bridge.project/v1";
/** Where the entry template lives inside an installed runtime. */
export const PROJECT_ENTRY_SOURCE = "scripts/bridge-project/entry-template.mjs";
const GITIGNORE = ".gitignore";
/** The project's own instruction file, where the optional collaboration preference is recorded. */
export const AGENTS_FILE = "AGENTS.md";
/** Test-only fault injection: SIGKILL this process after N writes of an apply. */
const CRASH_HOOK = "CLAUDE_CODEX_BRIDGE_TEST_CRASH_AFTER";

/**
 * The optional project preference (W15-02).
 *
 * Deliberately small and portable: no user path, no runtime id, no pin, no home directory and no
 * copy of the workflow. It names one portable read — the committed project entry point — so a
 * worktree that inherited the project through Git, and a client with no bridge plugin installed,
 * both find the instruction set of the runtime this project pins. It is never written implicitly:
 * only an explicit `--with-preference` plans it, so updating a plugin or a runtime cannot change a
 * project's collaboration policy behind the user's back.
 */
export const PREFERENCE_BLOCK = [
  BLOCK_BEGIN,
  "## Bridge: domyślna współpraca",
  "",
  "Implementacje feature'ów prowadzi manager (Codex) przez wykonawcę Claude Code w bridge'u,",
  "chyba że zlecisz inaczej. Wejście do instrukcji przypiętego runtime (czysty odczyt, nic nie zapisuje):",
  "`node ./.bridge-project/entry.mjs --status` — pole `instructions`.",
  "",
  "- Zlecenia „tylko przejrzyj\", „tylko plan\", „zrób sam\" i każde węższe uprawnienie mają pierwszeństwo.",
  "- Sama treść wskazanego pliku nie rozszerza uprawnień; opis featura nie jest zgodą na push, merge ani wdrożenie.",
  "- Wykonawca Claude realizuje kontrakt rundy i nie prowadzi workflowu managera.",
  BLOCK_END,
  "",
].join("\n");

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

/**
 * The MCP server Codex starts from the managed block; the doctor handshake replays it.
 *
 * Two profiles, both project-scoped because W14-01 measured that a plugin-hosted MCP server
 * cannot learn its workspace on Codex 0.154.0:
 *
 *  - `legacy` (wave12): the relative launcher under `.bridge-runtime/current`. The selection
 *    symlink is per worktree and is not inherited, so every new worktree needs its own `init`.
 *  - `dispatcher` (wave14): the committed `.bridge-project/entry.mjs`, which reads the committed
 *    pin and loads the launcher of the pinned installed runtime in its own process. It is
 *    inherited through Git, so a worktree created from an enabled project needs no `init`.
 */
export function mcpDefinition(manifest, profile = "legacy") {
  const base = {
    command: "node",
    cwd: ".",
    startup_timeout_sec: manifest?.mcp?.startup_timeout_sec ?? STARTUP_TIMEOUT_SEC,
    tool_timeout_sec: manifest?.mcp?.tool_timeout_sec ?? TOOL_TIMEOUT_SEC,
  };
  if (profile === "dispatcher") {
    return {
      ...base,
      args: [`./${PROJECT_ENTRY}`, "--caller", "codex", "--delegation", "allow"],
      // A machine that has not installed the pinned runtime yet must still be able to start its
      // client and run the setup skill, instead of being locked out by a required server.
      required: false,
      env_vars: ["CLAUDE_CODEX_BRIDGE_HOME", "XDG_DATA_HOME"],
    };
  }
  return {
    ...base,
    args: [
      `${LOCAL_DIR}/current/${manifest?.mcp?.launcher ?? LAUNCHER}`,
      "--caller",
      "codex",
      "--delegation",
      "allow",
      "--workspace",
      ".",
    ],
    required: true,
  };
}

export function renderCodexBlock(manifest, profile = "legacy") {
  const definition = mcpDefinition(manifest, profile);
  const toml = (value) => JSON.stringify(value);
  const header =
    profile === "dispatcher"
      ? [
          "# Written by the bridge. Portable on purpose: no home directory, no runtime id and no",
          `# machine path. \`${PROJECT_ENTRY}\` reads \`${PROJECT_DECLARATION}\` and loads the pinned`,
          "# installed runtime in its own process, so a worktree created from this project later",
          "# needs no setup step. Codex starts an MCP server with a stripped environment, so the two",
          "# variables that can move the installation are forwarded by name, never by value.",
        ]
      : [
          "# Written by the bridge setup CLI (scripts/bridge.mjs). This worktree selects its runtime with",
          "# .bridge-runtime/current; start `codex` in the worktree root. tool_timeout_sec is the client",
          "# wait for one MCP call and never stops a running round.",
        ];
  return [
    BLOCK_BEGIN,
    ...header,
    "[mcp_servers.bridge]",
    `command = ${toml(definition.command)}`,
    `args = [${definition.args.map(toml).join(", ")}]`,
    `cwd = ${toml(definition.cwd)}`,
    ...(definition.env_vars ? [`env_vars = [${definition.env_vars.map(toml).join(", ")}]`] : []),
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

export function bridgeTableMatches(bridge, manifest, profile = "legacy") {
  const expected = mcpDefinition(manifest, profile);
  return (
    bridge !== null &&
    typeof bridge === "object" &&
    JSON.stringify(Object.keys(bridge).sort()) === JSON.stringify(Object.keys(expected).sort()) &&
    Object.entries(expected).every(([key, value]) => JSON.stringify(bridge[key]) === JSON.stringify(value))
  );
}

/**
 * Import the control plane of a **trusted** local build.
 *
 * `candidates` are tried in order and the first complete one wins. Callers that must not execute
 * code the diagnosed worktree selected — the incident export and doctor's safe subset — pass only
 * their own CLI root and the runtime this CLI was installed in, never `.bridge-runtime/current`
 * of the worktree being inspected (review R2-04).
 */
export async function loadControlPlane(...candidates) {
  const tried = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const entry = join(candidate, "shared/control-plane/dist/index.js");
    tried.push(candidate);
    if (!existsSync(entry)) continue;
    try {
      return await import(pathToFileURL(entry).href);
    } catch (error) {
      throw new SetupError("RUNTIME_INCOMPLETE", `build ${candidate} cannot resolve worktrees: ${error.message}`, {
        nextStep: "run `npm run build` in this checkout, or run the command from an installed runtime",
      });
    }
  }
  throw new SetupError("RUNTIME_INCOMPLETE", `no built control plane in ${tried.join(", ") || "any candidate"}`, {
    nextStep: "run `npm run build` in this checkout, or run the command from an installed runtime",
  });
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

/**
 * Classify an interrupted apply's journal.
 *
 * `own` means it provably belongs to this worktree and this runtime, so completing it is a resume
 * of work this worktree itself started. Anything else — a journal naming another worktree, another
 * runtime, an unreadable one, or one written before the journal recorded its workspace — is
 * `unexplained` and is never resumed automatically.
 */
export function classifyPending(root, identity, runtimeId) {
  const pending = readPending(root);
  if (pending === null) return { kind: "absent" };
  if (pending.invalid) return { kind: "unexplained", detail: pending.invalid };
  if (pending.format !== PENDING_FORMAT) return { kind: "unexplained", detail: `unknown format ${pending.format}` };
  const workspace = pending.workspace;
  if (!workspace || typeof workspace.root !== "string") {
    return { kind: "unexplained", detail: "the journal does not record which worktree it belongs to" };
  }
  if (workspace.root !== identity.root || (workspace.git_dir ?? null) !== identity.git_dir) {
    return { kind: "foreign", detail: `the journal belongs to ${workspace.root}` };
  }
  if (runtimeId && pending.runtime_id !== runtimeId) {
    return { kind: "unexplained", detail: `the journal selects runtime ${pending.runtime_id}, not ${runtimeId}` };
  }
  return { kind: "own", value: pending };
}

/**
 * Classify `<root>/.bridge/` using the native marker only — read-only, no database is opened.
 *
 * The marker `<root>/.bridge/workspace.json` is the runtime's own record of which worktree that
 * state belongs to. It is therefore the existing authority for "is this reservation explained and
 * mine?", and this function adds no second opinion and no new protocol.
 *
 *  - `absent`      — no state directory at all;
 *  - `own`         — the marker names exactly this worktree;
 *  - `foreign`     — the marker names another worktree: copied state, never adopted;
 *  - `unexplained` — a state directory with no readable marker; refused, never repaired.
 */
export function classifyNativeState(root, identity) {
  const stateDir = join(root, ".bridge");
  if (!existsSync(stateDir)) return { kind: "absent" };
  const marker = readJson(join(stateDir, MARKER_NAME));
  if (marker.kind !== "valid" || typeof marker.value.root !== "string") {
    return { kind: "unexplained", detail: marker.kind === "absent" ? `${MARKER_NAME} is missing` : `${MARKER_NAME} is unreadable` };
  }
  if (canonical(marker.value.root) !== canonical(identity.root)) {
    return { kind: "foreign", detail: `the state marker belongs to ${marker.value.root}` };
  }
  return { kind: "own", value: marker.value };
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

/**
 * The runtime a `rollback` returns to: the explicit `--to`, otherwise the previous distinct entry
 * of this worktree's own selection history.
 *
 * Extracted from the wave12 setup CLI so the plugin resolves it identically (review W14-R2-09);
 * both callers pass the same `loadRuntime`, so compatibility and active-use guards are unchanged.
 */
export function rollbackTarget(home, workspace, options, loadRuntime) {
  if (options.to) return loadRuntime(home, options.to);
  const record = readRecord(canonical(workspace));
  if (record.kind !== "valid") {
    throw new SetupError("SETUP_NOT_INITIALIZED", "this worktree has no usable setup record to roll back", {
      nextStep: "run doctor --workspace <worktree>",
    });
  }
  const current = record.value.runtime.id;
  const previous = [...record.value.history].reverse().find((entry) => entry.runtime_id !== current);
  if (!previous) {
    throw new SetupError("ROLLBACK_NO_PREVIOUS", `runtime ${current} is the only one this worktree has selected`, {
      nextStep: "pass --to <runtime id> explicitly",
    });
  }
  return loadRuntime(home, previous.runtime_id);
}

/** The committed pin and entry point of the dispatcher profile. */
export function declarationContent(target) {
  return `${JSON.stringify(
    {
      format: PROJECT_FORMAT,
      enabled: true,
      pinned: { runtime_id: target.id, commit: target.manifest.source.commit },
    },
    null,
    2,
  )}\n`;
}

/**
 * Plan `.bridge-project/`, reusing the same ownership rules as the instruction files.
 *
 * A file whose bytes match the recorded hash, or the content any installed runtime would write,
 * is ours to update. Anything else is a local modification and becomes a conflict, so a hand
 * edited entry point or declaration is never silently overwritten.
 */
function planProjectFiles(plan, home, target, keepLocal) {
  const entrySource = join(target.path, PROJECT_ENTRY_SOURCE);
  if (!existsSync(entrySource)) {
    // An older runtime predates the dispatcher profile. Refusing keeps the project on a shape
    // that runtime can actually serve, instead of writing an entry point it cannot load.
    plan.refusals.push({
      code: "RUNTIME_WITHOUT_PROJECT_ENTRY",
      message: `runtime ${target.id} does not ship ${PROJECT_ENTRY_SOURCE}, so it cannot be selected by a project entry point`,
      nextStep: "pin a runtime built from a commit that contains the dispatcher profile, or use the setup CLI's init",
    });
    return {};
  }
  const wanted = new Map([
    [PROJECT_DECLARATION, Buffer.from(declarationContent(target), "utf8")],
    [PROJECT_ENTRY, readFileSync(entrySource)],
  ]);
  const owned = knownProjectFileHashes(home);
  const recorded = plan.record?.managed?.files ?? {};
  const files = {};
  for (const [rel, content] of wanted) {
    const after = sha256(content);
    let current;
    try {
      current = readOptional(join(plan.root, rel));
    } catch (error) {
      plan.conflicts.push({ code: "PROJECT_FILE_CONFLICT", path: rel, message: `cannot read: ${error.message}` });
      continue;
    }
    if (current === null) {
      plan.ops.push({ kind: "file", path: rel, action: "create", after, content, mode: 0o644 });
      files[rel] = after;
      continue;
    }
    const currentSha = sha256(current);
    if (currentSha === after) {
      files[rel] = after;
    } else if (recorded[rel] === currentSha || owned.get(rel)?.has(currentSha)) {
      plan.ops.push({ kind: "file", path: rel, action: "update", before: currentSha, after, content, previous: current, mode: 0o644 });
      files[rel] = after;
    } else if (keepLocal) {
      plan.kept.push({ path: rel, sha256: currentSha });
    } else {
      plan.conflicts.push({
        code: "PROJECT_FILE_MODIFIED",
        path: rel,
        message: "differs from every installed runtime's content (local modification or foreign file)",
        nextStep: "merge it by hand, move it aside, or re-run with --keep-local to keep this file unchanged",
      });
    }
  }
  return files;
}

/** Every declaration/entry byte sequence an installed runtime would write. */
function knownProjectFileHashes(home) {
  const known = new Map([
    [PROJECT_DECLARATION, new Set()],
    [PROJECT_ENTRY, new Set()],
  ]);
  for (const runtime of listRuntimes(home)) {
    if (!runtime.manifest) continue;
    known.get(PROJECT_DECLARATION).add(sha256(declarationContent(runtime)));
    try {
      known.get(PROJECT_ENTRY).add(sha256(readFileSync(join(runtime.path, PROJECT_ENTRY_SOURCE))));
    } catch {
      /* an older runtime has no entry template */
    }
  }
  return known;
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

function planCodexConfig(plan, home, target, env, profile = "legacy") {
  const absolute = join(plan.root, CODEX_CONFIG);
  const existing = readOptional(absolute);
  const rendered = renderCodexBlock(target.manifest, profile);
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
  if (inspected.status === "parsed" && !bridgeTableMatches(inspected.bridge, target.manifest, profile)) {
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

/**
 * Plan the optional preference block in the project's own `AGENTS.md`.
 *
 * `AGENTS.md` belongs to the user, so this follows the `.codex/config.toml` rules rather than the
 * whole-file ownership of a managed file: content outside the markers is preserved byte for byte,
 * an identical block is a no-op, a block this worktree recorded is updated, and a locally edited
 * or duplicated block is a named conflict that writes nothing. The symlink refusal and the backup
 * of a user file come from the shared plan/apply machinery.
 *
 * Returns the SHA-256 of the block now in effect, or `null` when nothing is planned.
 */
function planPreference(plan) {
  const absolute = join(plan.root, AGENTS_FILE);
  const rendered = PREFERENCE_BLOCK;
  const conflict = (code, message, nextStep) => {
    plan.conflicts.push({ code, path: AGENTS_FILE, message, nextStep });
    return null;
  };
  let existing;
  try {
    existing = readOptional(absolute);
  } catch (error) {
    return conflict("PREFERENCE_CONFLICT", `cannot read ${AGENTS_FILE}: ${error.message}`, "inspect the file; it is never rewritten automatically");
  }
  const blockSha = sha256(rendered);
  if (existing === null) {
    // `previous` is what both CLIs diff against. An empty buffer — not a missing field — is what
    // makes a project without AGENTS.md show the proposed text instead of only a file name
    // (review W15-I2). It is not `userFile`: there are no bytes of the user's to back up yet.
    plan.ops.push({
      kind: "file",
      path: AGENTS_FILE,
      action: "create",
      before: null,
      after: sha256(rendered),
      content: Buffer.from(rendered),
      previous: Buffer.alloc(0),
      mode: 0o644,
    });
    return blockSha;
  }
  const text = existing.toString("utf8");
  const found = findBlock(text);
  if (found.kind === "malformed") {
    return conflict("PREFERENCE_CONFLICT", "managed block markers in AGENTS.md are incomplete or repeated", "fix the markers, then run again");
  }
  let next;
  if (found.kind === "found") {
    if (found.block === rendered) return blockSha; // already in effect: nothing to write
    const currentSha = sha256(found.block);
    if (plan.record?.managed?.preference_block !== currentSha) {
      return conflict("PREFERENCE_MODIFIED", "the managed block in AGENTS.md was edited locally", "keep your version, or remove the managed block and run again");
    }
    next = found.before + rendered + found.after;
  } else {
    const separator = text.length === 0 ? "" : text.endsWith("\n") ? "\n" : "\n\n";
    next = text + separator + rendered;
  }
  plan.ops.push({
    kind: "file",
    path: AGENTS_FILE,
    action: found.kind === "found" ? "update" : "append",
    userFile: true,
    before: sha256(existing),
    after: sha256(next),
    content: Buffer.from(next),
    previous: existing,
    mode: fileMode(absolute, 0o644),
  });
  return blockSha;
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
function managedDestinations(identity, target, profile = "legacy", preference = false) {
  return [
    ...(profile === "dispatcher"
      ? [{ rel: PROJECT_DECLARATION }, { rel: PROJECT_ENTRY }]
      : target.manifest.instructions.files.map((file) => ({ rel: file.path }))),
    { rel: CODEX_CONFIG },
    ...(preference ? [{ rel: AGENTS_FILE }] : []),
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
export function planChange({
  action,
  home,
  identity,
  target,
  keepLocal = false,
  profile = "legacy",
  /**
   * True when this plan runs inside the bridge's own authorised native mutation for this worktree.
   *
   * The native identity guard is the authoritative critical section there: exactly one caller is
   * inside it, and a second one is refused as a foreign manager. The process scan must therefore
   * not veto that caller because *another* bridge process of the same worktree holds the database
   * open — which is precisely what two simultaneous first uses produce (review W14-R2-06). Every
   * other refusal, and every ordinary `init`/`update`/`rollback` from the CLI, is unchanged.
   */
  insideGuardedMutation = false,
  /** Explicit opt-in to the project collaboration preference in `AGENTS.md` (W15-02). */
  preference = false,
  env = process.env,
}) {
  const root = identity.root;
  const paths = localPaths(root);
  const recordRead = readRecord(root, identity);
  const selection = readSelection(root);
  const plan = {
    action,
    profile,
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
  for (const destination of managedDestinations(identity, target, profile, preference)) {
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

  const managedFiles =
    profile === "dispatcher"
      ? planProjectFiles(plan, home, target, keepLocal)
      : planInstructions(plan, home, target, keepLocal);
  const codexBlock = planCodexConfig(plan, home, target, env, profile);
  planGitignore(plan, env);
  // Explicit only: without `--with-preference` the project's AGENTS.md is never read or written,
  // so no plugin or runtime update can introduce a collaboration policy on its own.
  //
  // The block names `.bridge-project/entry.mjs`, which only the dispatcher profile installs, so a
  // legacy worktree would be told to read an entry point that does not exist there (review
  // W15-I1). That is refused by name before anything is planned, rather than repaired by
  // installing the dispatcher or re-pinning the project behind the user's back.
  if (preference && profile !== "dispatcher") {
    refuse(
      "PREFERENCE_REQUIRES_DISPATCHER",
      `the collaboration preference names ${PROJECT_ENTRY}, which the ${profile} profile does not install`,
      "prepare this project with the bridge setup skill (dispatcher profile), then record the preference there",
    );
    return finish(plan);
  }
  const preferenceBlock = preference ? planPreference(plan) : null;

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
      // Carried forward when this run did not ask for the preference, so a later
      // `--with-preference` still recognises the block this worktree wrote earlier.
      preference_block: preferenceBlock ?? plan.record?.managed?.preference_block ?? null,
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
    const blocking = insideGuardedMutation
      ? []
      : currentId === null
        ? ["bridge-mcp", "state-open"]
        : ["bridge-mcp", "state-open", "client"];
    if (blocking.length === 0) {
      // The guard already serialised this call; there is nothing for the scan to decide.
    } else if (!use.supported) {
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
    AGENTS_FILE,
  ]);
  const fileOps = plan.ops.filter((op) => op.kind === "file");
  writeAtomic(
    paths.pending,
    `${JSON.stringify({
      format: PENDING_FORMAT,
      action: plan.action,
      // Whose journal this is. `.bridge-runtime/` is never inherited, but it can be *copied*, and
      // a resume must be able to tell its own interrupted apply from someone else's leftovers.
      workspace: { kind: plan.identity.kind, root: plan.root, git_dir: plan.identity.git_dir },
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
