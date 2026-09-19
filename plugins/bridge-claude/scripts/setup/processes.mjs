// Active use of a worktree, from Linux /proc. Evidence is a live process, never the presence or
// absence of SQLite -wal/-shm files: a crash can leave them behind and a clean close removes them.

import { readFileSync, readdirSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { basename, resolve, sep } from "node:path";

function realOrNull(path) {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function isClient(base, argv) {
  let comm = "";
  try {
    comm = readFileSync(`${base}/comm`, "utf8").trim();
  } catch {
    /* process ended */
  }
  if (comm === "codex" || comm === "claude") return true;
  return argv.length > 1 && basename(argv[0]) === "node" && /(^|\/)codex(\.js)?$/u.test(argv[1]);
}

/** A short, content-free description: prompts in a worker's argv must never be printed. */
function describe(argv, kinds) {
  const program = basename(argv[0]);
  if (!kinds.includes("bridge-mcp")) return program;
  const launcher = argv.findIndex((arg) => basename(arg) === "native-bridge-mcp.mjs");
  return [program, ...argv.slice(launcher, launcher + 7)].join(" ");
}

/**
 * Processes of this user that use `root` now:
 *  - `bridge-mcp`: a bridge launcher whose workspace resolves to the root;
 *  - `client`: a Codex or Claude process whose working directory is the root;
 *  - `state-open`: any process holding a file below `<root>/.bridge/` open.
 *
 * `supported: false` means the answer is unknown (no /proc, or a sandbox hides processes).
 */
export function findActiveUse(root, { env = process.env, proc = "/proc", selfPid = process.pid } = {}) {
  if (env.CODEX_SANDBOX) {
    return { supported: false, reason: "running inside a Codex sandbox, which hides other processes", entries: [] };
  }
  let names;
  try {
    names = readdirSync(proc).filter((name) => /^\d+$/u.test(name));
  } catch {
    return { supported: false, reason: `${proc} is not available on this host`, entries: [] };
  }
  const canonicalRoot = realOrNull(root) ?? resolve(root);
  const stateDirectory = `${canonicalRoot}${sep}.bridge${sep}`;
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  const entries = [];
  let unreadable = 0;
  for (const name of names) {
    const pid = Number(name);
    if (pid === selfPid) continue;
    const base = `${proc}/${name}`;
    try {
      if (uid !== undefined && statSync(base).uid !== uid) continue;
    } catch {
      continue;
    }
    let argv;
    try {
      argv = readFileSync(`${base}/cmdline`, "utf8").split("\0").filter((arg) => arg.length > 0);
    } catch {
      continue;
    }
    if (argv.length === 0) continue;
    let cwd = null;
    try {
      cwd = realpathSync(`${base}/cwd`);
    } catch (error) {
      if (error.code === "EACCES" || error.code === "EPERM") unreadable += 1;
    }
    const kinds = [];
    const launcher = argv.findIndex((arg) => basename(arg) === "native-bridge-mcp.mjs");
    if (launcher >= 0 && cwd !== null) {
      const flag = argv.indexOf("--workspace", launcher);
      const workspace = flag > 0 && argv[flag + 1] !== undefined ? resolve(cwd, argv[flag + 1]) : cwd;
      if ((realOrNull(workspace) ?? workspace) === canonicalRoot) kinds.push("bridge-mcp");
    }
    if (cwd === canonicalRoot && isClient(base, argv)) kinds.push("client");
    try {
      for (const fd of readdirSync(`${base}/fd`)) {
        let target;
        try {
          target = readlinkSync(`${base}/fd/${fd}`);
        } catch {
          continue;
        }
        if (target.startsWith(stateDirectory)) {
          kinds.push("state-open");
          break;
        }
      }
    } catch (error) {
      if (error.code === "EACCES" || error.code === "EPERM") unreadable += 1;
    }
    if (kinds.length > 0) entries.push({ pid, kinds, command: describe(argv, kinds) });
  }
  return { supported: true, entries, unreadable };
}
