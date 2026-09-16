/**
 * Canonical worktree and database identity (contract §3).
 *
 * Identity is resolved from the filesystem and Git, never from a branch name, and never by
 * comparing two paths that could both be redirected through the same symlink: exclusivity is
 * decided later by recorded identity (marker/owner/binding), not here.
 *
 * Nothing in this module writes: resolving a database path for a worktree that has never been
 * bootstrapped must not create `.bridge/`.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { BridgeError, ErrorCode } from "@bridge/protocol";

export type WorkspaceKind = "git" | "directory";

export interface WorkspaceIdentity {
  readonly kind: WorkspaceKind;
  /** realpath of the worktree root. */
  readonly root: string;
  /** realpath of the per-worktree git dir (`…/.git` or `…/.git/worktrees/<name>`). */
  readonly git_dir: string | null;
  /** realpath of the git dir shared by every worktree of the project. */
  readonly git_common_dir: string | null;
  /** Project identity: the common dir for git, the root otherwise. */
  readonly project_key: string;
}

export interface ResolveWorkspaceOptions {
  readonly git?: string;
  readonly env?: NodeJS.ProcessEnv;
}

/** Git environment that would redirect `rev-parse` away from the requested directory. */
const GIT_ENV_OVERRIDES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
] as const;

function mismatch(message: string, reason: string, details: Record<string, unknown> = {}): never {
  throw new BridgeError(ErrorCode.WORKSPACE_MISMATCH, message, { reason, ...details });
}

function canonicalDirectory(path: string): string {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    mismatch(`workspace does not exist: ${path}`, "workspace_missing", { path });
  }
  if (!stat.isDirectory()) mismatch(`workspace is not a directory: ${path}`, "workspace_missing", { path });
  return realpathSync(path);
}

/**
 * Resolve the canonical identity of `workspace`.
 *
 * A workspace that is inside a Git work tree must BE its root: a subdirectory would give two
 * different processes two different state directories for one worktree.
 */
export function resolveWorkspaceIdentity(
  workspace: string,
  options: ResolveWorkspaceOptions = {},
): WorkspaceIdentity {
  const abs = canonicalDirectory(resolve(workspace));
  const env = { ...(options.env ?? process.env) };
  for (const key of GIT_ENV_OVERRIDES) delete env[key];

  let raw: string;
  try {
    raw = execFileSync(
      options.git ?? "git",
      [
        "-C",
        abs,
        "rev-parse",
        "--path-format=absolute",
        "--is-inside-work-tree",
        "--show-toplevel",
        "--git-dir",
        "--git-common-dir",
      ],
      { encoding: "utf8", timeout: 5_000, env, stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? "");
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || /not a git repository/iu.test(stderr)) {
      return { kind: "directory", root: abs, git_dir: null, git_common_dir: null, project_key: abs };
    }
    mismatch(`git could not describe the workspace: ${stderr.trim() || String(error)}`, "git_failed", {
      workspace: abs,
    });
  }

  const [insideWorkTree, toplevel, gitDir, commonDir] = raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (insideWorkTree !== "true") {
    mismatch(`workspace is not inside a Git work tree: ${abs}`, "not_worktree_root", { workspace: abs });
  }
  if (!toplevel || !gitDir || !commonDir) {
    mismatch(`git did not report a complete worktree identity for ${abs}`, "git_failed", { workspace: abs });
  }

  const root = realpathSync(resolve(abs, toplevel));
  if (root !== abs) {
    mismatch(
      `workspace must be the worktree root ${root}, not ${abs}; start the client at the root`,
      "not_worktree_root",
      { workspace: abs, root },
    );
  }
  const resolvedGitDir = realpathSync(resolve(abs, gitDir));
  const resolvedCommonDir = realpathSync(resolve(abs, commonDir));
  return {
    kind: "git",
    root,
    git_dir: resolvedGitDir,
    git_common_dir: resolvedCommonDir,
    project_key: resolvedCommonDir,
  };
}

/** `<root>/.bridge` — the worktree's own state directory. Not created by resolution. */
export function stateDirectory(identity: WorkspaceIdentity): string {
  return join(identity.root, ".bridge");
}

/** Exchange namespace directories of one worktree. */
export interface ExchangeNamespace {
  readonly workspace_key: string;
  readonly namespace: string;
  readonly packages: string;
  readonly incoming: string;
  readonly staging: string;
}

/**
 * Deterministic exchange namespace of a worktree: `~/tmp/bridge-exchange/ws_<16 hex>/`, the key
 * being the first 16 hex of SHA-256(canonical root + NUL + canonical per-worktree git dir).
 *
 * This is the one implementation of that identity for JavaScript callers, matching
 * `feature_exchange.py namespace` byte for byte, so the exporter and the exchange tooling never
 * drift apart. Resolving it reads nothing and creates nothing, and it grants no authority.
 */
export function exchangeNamespace(
  identity: WorkspaceIdentity,
  env: NodeJS.ProcessEnv = process.env,
): ExchangeNamespace {
  const key = `ws_${createHash("sha256")
    .update(`${identity.root}\0${identity.git_dir ?? ""}`, "utf8")
    .digest("hex")
    .slice(0, 16)}`;
  const home = env["HOME"] && isAbsolute(env["HOME"]) ? env["HOME"] : homedir();
  const base = join(home, "tmp", "bridge-exchange", key);
  return {
    workspace_key: key,
    namespace: base,
    packages: join(base, "packages"),
    incoming: join(base, "incoming"),
    staging: join(base, "staging"),
  };
}

/**
 * Canonical absolute database path, resolved through existing symlinks without creating
 * anything. A path whose parent does not exist yet resolves against its nearest existing
 * ancestor, so a fresh default path is answerable during a read.
 */
export function resolveDatabasePath(identity: WorkspaceIdentity, raw?: string): string {
  const requested = raw
    ? isAbsolute(raw)
      ? raw
      : resolve(identity.root, raw)
    : join(stateDirectory(identity), "bridge.db");
  return canonicalizeWithoutCreating(requested);
}

export function canonicalizeWithoutCreating(target: string): string {
  const absolute = resolve(target);
  const segments: string[] = [];
  let cursor = absolute;
  for (;;) {
    try {
      return join(realpathSync(cursor), ...segments.reverse());
    } catch {
      const parent = dirname(cursor);
      if (parent === cursor) return absolute;
      segments.push(cursor.slice(parent.length + 1));
      cursor = parent;
    }
  }
}
