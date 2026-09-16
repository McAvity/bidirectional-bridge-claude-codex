// Preparing a worktree: the one operation of the project dispatcher that writes.
//
// Dependency-free and committed into every enabled project, like `locate.mjs`. Everything here
// is a consequence of an instructed use: detection, a handshake and `status` never reach it.
//
// Safety properties this module owns:
//   - exclusive ownership: an `O_EXCL` lock file serialises two simultaneous first uses, and the
//     state is revalidated *after* the lock is held, so the loser writes nothing;
//   - no redirected writes: a managed path that is or passes through a symlink is refused;
//   - no adoption: a local record naming another worktree is refused, never rewritten;
//   - no clobbering: custom files and unmanaged parts of shared files are preserved.

import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync, writeSync, fsyncSync, unlinkSync, renameSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { DISPATCHER, LOCAL_DIR, PROJECT_DIR, PROJECT_FILE, PROJECT_FORMAT, STATE_DIR, pathIsRedirected, readDeclaration, readLocalRecord, resolveRuntime, status } from "./locate.mjs";

export const BLOCK_BEGIN = "# >>> claude-codex-bridge managed block >>>";
export const BLOCK_END = "# <<< claude-codex-bridge managed block <<<";
export const CODEX_CONFIG = ".codex/config.toml";
export const GITIGNORE = ".gitignore";
export const LOCK = `${STATE_DIR}/bootstrap.lock`;
export const STARTUP_TIMEOUT_SEC = 30;
export const TOOL_TIMEOUT_SEC = 5400;

/** Managed paths this operation may write. Anything else in the worktree is untouched. */
export const MANAGED = [PROJECT_FILE, DISPATCHER, `${PROJECT_DIR}/locate.mjs`, `${PROJECT_DIR}/bootstrap.mjs`, `${PROJECT_DIR}/facade.mjs`, CODEX_CONFIG, GITIGNORE];

export class BootstrapRefusal extends Error {
  constructor(code, message, nextStep) {
    super(message);
    this.code = code;
    this.nextStep = nextStep ?? null;
  }
}

function writeAtomic(path, content, mode = 0o644) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${path.split("/").pop()}.bridge-tmp-${randomBytes(6).toString("hex")}`);
  const fd = openSync(tmp, "w", mode);
  try {
    writeSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(tmp, mode);
  renameSync(tmp, path);
}

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** Replace only the managed block, preserving everything the user wrote around it. */
export function spliceBlock(existing, body) {
  const block = `${BLOCK_BEGIN}\n${body.trimEnd()}\n${BLOCK_END}\n`;
  if (existing === null || existing.trim() === "") return block;
  const begin = existing.indexOf(BLOCK_BEGIN);
  const end = existing.indexOf(BLOCK_END);
  if (begin >= 0 && end > begin) {
    const after = existing.slice(end + BLOCK_END.length).replace(/^\n/u, "");
    return `${existing.slice(0, begin)}${block}${after}`;
  }
  return `${existing.replace(/\n*$/u, "\n")}\n${block}`;
}

export function codexBlockBody(manifest) {
  const startup = manifest?.mcp?.startup_timeout_sec ?? STARTUP_TIMEOUT_SEC;
  const tool = manifest?.mcp?.tool_timeout_sec ?? TOOL_TIMEOUT_SEC;
  return [
    "# Written by the bridge. Portable on purpose: no home directory, no runtime id and no",
    `# machine path. \`${DISPATCHER}\` resolves the real worktree and the pinned runtime at`,
    "# startup, so a worktree created later from this project needs no preparation step.",
    "[mcp_servers.bridge]",
    'command = "node"',
    `args = ["./${DISPATCHER}", "--caller", "codex", "--delegation", "allow"]`,
    'cwd = "."',
    "# Codex starts an MCP server with a stripped environment (measured in W14-01), so the two",
    "# variables that can move the installation away from its default location are forwarded",
    "# explicitly. Neither is a machine path: this line is the same for every user.",
    'env_vars = ["CLAUDE_CODEX_BRIDGE_HOME", "XDG_DATA_HOME"]',
    "# false on purpose: a machine without the pinned runtime must still be able to start the",
    "# client and install it, instead of being locked out by a required server that cannot run.",
    "required = false",
    `startup_timeout_sec = ${startup}`,
    `tool_timeout_sec = ${tool}`,
  ].join("\n");
}

export function gitignoreBody() {
  return [`/${STATE_DIR}/`, `/${LOCAL_DIR}/`].join("\n");
}

export function declarationBody(pin) {
  return `${JSON.stringify(
    {
      format: PROJECT_FORMAT,
      enabled: true,
      pinned: { runtime_id: pin.runtime_id, commit: pin.commit ?? null },
    },
    null,
    2,
  )}\n`;
}

/**
 * Take exclusive ownership of the bootstrap of one worktree.
 *
 * `O_EXCL` creation is the claim. A stale lock older than `staleMs` is broken deliberately and
 * reported, never silently reused, so an interrupted setup cannot wedge a worktree forever.
 */
export function acquireLock(root, { staleMs = 10 * 60_000, now = Date.now } = {}) {
  const path = join(root, LOCK);
  mkdirSync(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(path, "wx", 0o644);
      writeSync(fd, `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() })}\n`);
      closeSync(fd);
      return {
        broke_stale: attempt > 0,
        release() {
          try {
            unlinkSync(path);
          } catch {
            /* already gone */
          }
        },
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let age = 0;
      try {
        age = now() - statSync(path).mtimeMs;
      } catch {
        continue;
      }
      if (age < staleMs) {
        throw new BootstrapRefusal(
          "BOOTSTRAP_IN_PROGRESS",
          "another bootstrap of this worktree is in progress",
          "wait for it to finish, then run status again",
        );
      }
      rmSync(path, { force: true });
    }
  }
  throw new BootstrapRefusal("BOOTSTRAP_LOCK_FAILED", "could not take the bootstrap lock", "retry once");
}

function refuseRedirected(root) {
  for (const rel of MANAGED) {
    if (pathIsRedirected(root, rel)) {
      throw new BootstrapRefusal(
        "MANAGED_PATH_IS_SYMLINK",
        `${rel} is or passes through a symlink; the bridge never writes through one`,
        "replace the symlink with a real file or directory, then run prepare again",
      );
    }
  }
}

function refuseForeignRecord(root) {
  const local = readLocalRecord(root);
  if (local.kind === "foreign") {
    throw new BootstrapRefusal(
      "FOREIGN_WORKSPACE_RECORD",
      `${LOCAL_DIR}/install.json was copied from another worktree (${local.detail})`,
      `remove ${LOCAL_DIR}/ in this worktree and run prepare again; it is never adopted`,
    );
  }
}

/**
 * Prepare this worktree.
 *
 * `dryRun` computes and reports the same plan without writing, so a caller can show it first.
 * The plan is recomputed under the lock; a concurrent winner makes the loser a no-op, not a
 * conflicting write.
 */
export function prepare({ cwd = process.cwd(), env = process.env, pin, dryRun = false, sources, lockOptions }) {
  const before = status(cwd, env);
  if (!before.workspace.in_git_repository) {
    throw new BootstrapRefusal("NOT_A_WORKTREE", `${before.workspace.root} is not inside a git worktree`, "run this from a git worktree");
  }
  const root = before.workspace.root;
  refuseForeignRecord(root);
  refuseRedirected(root);

  const declared = before.declaration.pinned ?? null;
  const selected = pin ?? declared;
  if (!selected?.runtime_id) {
    throw new BootstrapRefusal(
      "NO_PIN",
      "this project declares no pinned runtime and none was given",
      "pass the runtime id to pin, or enable the project from a bridge clone",
    );
  }

  const runtime = resolveRuntime(before.home, selected.runtime_id);
  const planned = [];
  const files = new Map();

  files.set(PROJECT_FILE, declarationBody(selected));
  for (const [rel, body] of Object.entries(sources ?? {})) files.set(`${PROJECT_DIR}/${rel}`, body);
  files.set(CODEX_CONFIG, spliceBlock(readText(join(root, CODEX_CONFIG)), codexBlockBody(runtime.manifest)));
  files.set(GITIGNORE, spliceBlock(readText(join(root, GITIGNORE)), gitignoreBody()));

  for (const [rel, content] of files) {
    const current = readText(join(root, rel));
    if (current === content) continue;
    planned.push({ path: rel, action: current === null ? "create" : "update" });
  }

  if (dryRun) {
    return { ok: true, applied: false, root, pin: selected, runtime: runtime.state, changes: planned, lock: null };
  }

  const lock = acquireLock(root, lockOptions);
  try {
    // Revalidate under the lock: another first use may have finished while we were waiting.
    refuseForeignRecord(root);
    refuseRedirected(root);
    const applied = [];
    for (const [rel, content] of files) {
      const current = readText(join(root, rel));
      if (current === content) continue;
      writeAtomic(join(root, rel), content, rel.endsWith(".mjs") ? 0o644 : 0o644);
      applied.push({ path: rel, action: current === null ? "create" : "update" });
    }
    return { ok: true, applied: true, root, pin: selected, runtime: runtime.state, changes: applied, lock: { broke_stale: lock.broke_stale } };
  } finally {
    lock.release();
  }
}

export { readDeclaration };
