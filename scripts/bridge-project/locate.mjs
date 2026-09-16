// Read-only picture of one worktree: the declaration, the pin, the selected runtime and where
// the instruction set lives. Reused by the setup entry point and by the launch gate.
//
// Every reader here comes from the wave12 setup code, so a copied record, a broken selection and
// an unusable runtime are classified by exactly the same rules the setup CLI uses. This module
// adds no second opinion, and it writes nothing.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { LOCAL_DIR, canonical, readJson, readOptional, run } from "../setup/common.mjs";
import { loadRuntime, verifyRuntime } from "../setup/runtime.mjs";
import { AGENTS_FILE, PROJECT_DECLARATION, PROJECT_ENTRY, PROJECT_FORMAT, findBlock, readRecord, readSelection } from "../setup/workspace.mjs";

export const HOME_ENV = "CLAUDE_CODEX_BRIDGE_HOME";

export function bridgeHome(env = process.env) {
  if (env[HOME_ENV]) return resolve(env[HOME_ENV]);
  const data = env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : join(homedir(), ".local", "share");
  return join(data, "claude-codex-bridge");
}

/** The real worktree of `cwd`. Derived from the directory itself, never from `PWD`. */
export function resolveWorkspace(cwd = process.cwd()) {
  const start = canonical(cwd);
  const top = run("git", ["-C", start, "rev-parse", "--show-toplevel"]);
  if (top.status !== 0 || !top.stdout.trim()) {
    return { root: start, gitDir: null, inGitRepository: false, startedIn: start };
  }
  const gitDir = run("git", ["-C", start, "rev-parse", "--absolute-git-dir"]);
  return {
    root: canonical(top.stdout.trim()),
    gitDir: gitDir.status === 0 ? gitDir.stdout.trim() : null,
    inGitRepository: true,
    startedIn: start,
  };
}

export function readDeclaration(root) {
  const parsed = readJson(join(root, PROJECT_DECLARATION));
  if (parsed.kind !== "valid") return parsed;
  const value = parsed.value;
  if (value.format !== PROJECT_FORMAT) return { kind: "invalid", detail: `unknown format ${value.format}` };
  if (typeof value.pinned?.runtime_id !== "string") return { kind: "invalid", detail: "pinned.runtime_id is missing" };
  return { kind: "valid", value };
}

/**
 * One classification of this worktree.
 *
 * `state` is what the setup entry point and the launch gate both act on:
 *   not-enabled | declaration-invalid | project-disabled | runtime-missing | runtime-incomplete
 *   | foreign-record | record-invalid | inherited-pristine | state-partial | needs-selection
 *   | pin-diverged | entry-missing | ready
 */
export function status(cwd = process.cwd(), env = process.env) {
  const workspace = resolveWorkspace(cwd);
  const home = bridgeHome(env);
  const declaration = readDeclaration(workspace.root);
  const pin = declaration.kind === "valid" ? declaration.value.pinned : null;

  let runtime = null;
  let runtimeState = "no-pin";
  if (pin?.runtime_id) {
    try {
      runtime = loadRuntime(home, pin.runtime_id);
      const problems = verifyRuntime(runtime);
      runtimeState = problems.length === 0 ? "ok" : "runtime-incomplete";
    } catch (error) {
      runtimeState = error.code === "RUNTIME_NOT_INSTALLED" ? "runtime-missing" : "runtime-unusable";
    }
  }

  // A cheap identity, enough for `readRecord` to recognise a copied record. The authoritative
  // check runs in the launch gate, which resolves identity with the runtime's own code.
  const record = readRecord(workspace.root, { root: workspace.root, git_dir: workspace.gitDir });
  const selection = readSelection(workspace.root);

  let state;
  if (!workspace.inGitRepository) state = "not-a-worktree";
  else if (declaration.kind === "absent") state = "not-enabled";
  else if (declaration.kind !== "valid") state = "declaration-invalid";
  else if (declaration.value.enabled === false) state = "project-disabled";
  else if (record.kind === "foreign") state = "foreign-record";
  else if (record.kind === "invalid") state = "record-invalid";
  else if (runtimeState !== "ok") state = runtimeState;
  else if (record.kind === "absent")
    // Pristine: inherited through Git with none of its own local state. It serves reads now and
    // takes its own selection on the first mutating call. Anything else is partial state.
    state = !existsSync(join(workspace.root, LOCAL_DIR)) && !existsSync(join(workspace.root, ".bridge"))
      ? "inherited-pristine"
      : "state-partial";
  else if (selection.kind !== "ok") state = "needs-selection";
  else if (record.value.runtime.id !== pin.runtime_id) state = "pin-diverged";
  else if (!existsSync(join(workspace.root, PROJECT_ENTRY))) state = "entry-missing";
  else state = "ready";

  return {
    format: "claude-codex-bridge.project-status/v1",
    state,
    workspace: { root: workspace.root, git_dir: workspace.gitDir, in_git_repository: workspace.inGitRepository, started_in: workspace.startedIn },
    home,
    declaration:
      declaration.kind === "valid"
        ? { enabled: declaration.value.enabled !== false, pinned: declaration.value.pinned }
        : { kind: declaration.kind, detail: declaration.detail ?? null },
    runtime: {
      state: runtimeState,
      runtime_id: pin?.runtime_id ?? null,
      commit: runtime?.manifest?.source.commit ?? null,
      path: runtime?.path ?? null,
    },
    selection: {
      kind: record.kind,
      runtime_id: record.kind === "valid" ? record.value.runtime.id : null,
      current: selection.kind,
    },
    instructions: runtimeState === "ok" ? instructionPaths(runtime) : null,
    // Whether this project states a default collaboration preference. A project without one is
    // never treated as consent to delegate: at most it earns a single proposal to record one.
    preference: { declared: hasPreference(workspace.root), path: AGENTS_FILE },
    reads_only: true,
  };
}

/**
 * Absolute paths of the instruction set inside one installed runtime.
 *
 * The single place that maps a runtime to the files a manager must read, so the plugin's `status`
 * and the project entry point's own read-only mode can never disagree about which version of the
 * workflow belongs to a pin. It derives everything from the runtime directory: it never consults
 * `.bridge-runtime/current`, which a worktree inherited through Git does not have.
 */
export function instructionPaths(runtime) {
  return {
    root: runtime.path,
    workflow_skills: join(runtime.path, ".agents/skills"),
    codex_role_skill: join(runtime.path, ".codex/skills/using-bridge/SKILL.md"),
    manager_entry: join(runtime.path, ".codex/skills/using-bridge/SKILL.md"),
    exchange_helper: join(runtime.path, ".agents/skills/feature-exchange/scripts/feature_exchange.py"),
    claude_executor_package: join(runtime.path, "plugins/bridge-claude"),
    set_sha256: runtime.manifest?.instructions?.set_sha256 ?? null,
  };
}

/** True when the project's AGENTS.md carries the bridge's managed preference block. A pure read. */
function hasPreference(root) {
  let existing;
  try {
    existing = readOptional(join(root, AGENTS_FILE));
  } catch {
    return false;
  }
  return existing !== null && findBlock(existing.toString("utf8")).kind === "found";
}

export { readFileSync };
