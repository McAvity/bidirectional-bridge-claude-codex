// Pure resolution for the project dispatcher. No writes, no state, no claims.
//
// Dependency-free and self-contained on purpose: a copy of this file is committed into every
// enabled project, where nothing of the bridge is installed yet. It must never import from the
// repository it was generated in, and it must never read `PWD` — W14-01 measured that `PWD` is
// whatever the parent process exported and can name a different repository entirely.

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export const PROJECT_DIR = ".bridge-project";
export const PROJECT_FILE = `${PROJECT_DIR}/bridge.json`;
export const PROJECT_FORMAT = "claude-codex-bridge.project/v1";
export const DISPATCHER = `${PROJECT_DIR}/dispatch.mjs`;
export const LOCAL_DIR = ".bridge-runtime";
export const STATE_DIR = ".bridge";
export const HOME_ENV = "CLAUDE_CODEX_BRIDGE_HOME";

/** `<home>` of the installed runtimes, from the environment or the XDG default. */
export function bridgeHome(env = process.env) {
  if (env[HOME_ENV]) return resolve(env[HOME_ENV]);
  const data = env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : join(homedir(), ".local", "share");
  return join(data, "claude-codex-bridge");
}

function git(cwd, args) {
  const out = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: 30_000 });
  return out.status === 0 ? out.stdout.trim() : null;
}

/**
 * The real worktree this process was started in.
 *
 * The host gives the dispatcher the project directory as its working directory; the git
 * top-level is derived from that directory, so an external Herdr-style worktree, a path with
 * spaces and a launch from a subdirectory all resolve to the same answer.
 */
export function resolveWorkspace(cwd = process.cwd()) {
  let start;
  try {
    start = realpathSync(cwd);
  } catch {
    start = resolve(cwd);
  }
  const root = git(start, ["rev-parse", "--show-toplevel"]);
  if (!root) return { root: start, gitDir: null, inGitRepository: false, startedIn: start };
  const gitDir = git(start, ["rev-parse", "--absolute-git-dir"]);
  let canonicalRoot = root;
  try {
    canonicalRoot = realpathSync(root);
  } catch {
    /* keep the reported path */
  }
  return { root: canonicalRoot, gitDir, inGitRepository: true, startedIn: start };
}

function readJson(path) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) return { kind: "invalid", detail: "not a JSON object" };
    return { kind: "valid", value };
  } catch (error) {
    if (error.code === "ENOENT") return { kind: "absent" };
    return { kind: "invalid", detail: error.message };
  }
}

/** The portable, committed project declaration: enablement and the authoritative pin. */
export function readDeclaration(root) {
  const parsed = readJson(join(root, PROJECT_FILE));
  if (parsed.kind !== "valid") return parsed;
  const value = parsed.value;
  if (value.format !== PROJECT_FORMAT) return { kind: "invalid", detail: `unknown format ${value.format}` };
  if (typeof value.pinned?.runtime_id !== "string") return { kind: "invalid", detail: "pinned.runtime_id is missing" };
  return { kind: "valid", value };
}

/** This worktree's own selection record. A record naming another worktree is a copy. */
export function readLocalRecord(root) {
  const parsed = readJson(join(root, LOCAL_DIR, "install.json"));
  if (parsed.kind !== "valid") return parsed;
  const recorded = parsed.value.root ?? parsed.value.workspace?.root;
  if (typeof recorded === "string" && resolve(recorded) !== resolve(root)) {
    return { kind: "foreign", detail: `record names ${recorded}`, value: parsed.value };
  }
  return parsed;
}

export function runtimePath(home, runtimeId) {
  return join(home, "runtimes", runtimeId);
}

/** Is the pinned runtime installed and complete enough to serve? Never installs anything. */
export function resolveRuntime(home, runtimeId) {
  if (!runtimeId) return { state: "no-pin", path: null };
  const path = runtimePath(home, runtimeId);
  const manifest = readJson(join(path, "runtime-manifest.json"));
  if (manifest.kind === "absent") return { state: "runtime-missing", path, runtimeId };
  if (manifest.kind !== "valid") return { state: "runtime-unreadable", path, runtimeId, detail: manifest.detail };
  const launcher = join(path, manifest.value.mcp?.launcher ?? "scripts/native-bridge-mcp.mjs");
  if (!existsSync(launcher)) return { state: "runtime-incomplete", path, runtimeId, detail: "launcher is missing" };
  return { state: "ok", path, runtimeId, launcher, manifest: manifest.value };
}

/** True when `relative` inside `root` is, or passes through, a symlink. */
export function pathIsRedirected(root, relative) {
  const parts = relative.split("/");
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * The whole read-only picture: workspace, declaration, pin, selected runtime, instruction root.
 *
 * `instructions.root` is the installed runtime directory. Instructions are never copied into the
 * project, so a manager reading them always reads the set of the runtime it is driving.
 */
export function status(cwd = process.cwd(), env = process.env) {
  const workspace = resolveWorkspace(cwd);
  const home = bridgeHome(env);
  const declaration = readDeclaration(workspace.root);
  const local = readLocalRecord(workspace.root);
  const pin = declaration.kind === "valid" ? declaration.value.pinned : null;
  const runtime = resolveRuntime(home, pin?.runtime_id ?? null);

  let state;
  if (declaration.kind === "absent") state = "not-enabled";
  else if (declaration.kind !== "valid") state = "declaration-invalid";
  else if (local.kind === "foreign") state = "foreign-record";
  else if (runtime.state !== "ok") state = runtime.state;
  else if (local.kind !== "valid") state = "needs-preparation";
  else if (local.value.runtime?.id && local.value.runtime.id !== pin.runtime_id) state = "pin-diverged";
  else state = "ready";

  return {
    format: "claude-codex-bridge.project-status/v1",
    state,
    workspace: { root: workspace.root, git_dir: workspace.gitDir, in_git_repository: workspace.inGitRepository, started_in: workspace.startedIn },
    home,
    declaration: declaration.kind === "valid" ? { enabled: declaration.value.enabled !== false, pinned: declaration.value.pinned } : { kind: declaration.kind, detail: declaration.detail ?? null },
    runtime: { state: runtime.state, runtime_id: runtime.runtimeId ?? null, path: runtime.path, detail: runtime.detail ?? null },
    selection: local.kind === "valid" ? { runtime_id: local.value.runtime?.id ?? null } : { kind: local.kind, detail: local.detail ?? null },
    instructions:
      runtime.state === "ok"
        ? {
            root: runtime.path,
            workflow_skills: join(runtime.path, ".agents/skills"),
            codex_role_skill: join(runtime.path, ".codex/skills/using-bridge/SKILL.md"),
            claude_executor_package: join(runtime.path, "plugins/bridge-claude"),
            set_sha256: runtime.manifest.instructions?.set_sha256 ?? null,
          }
        : null,
    reads_only: true,
  };
}
