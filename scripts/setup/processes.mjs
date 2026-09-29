// Active use of a worktree, from Linux /proc or macOS ps/lsof. Evidence is a live process, never the presence or
// absence of SQLite -wal/-shm files: a crash can leave them behind and a clean close removes them.

import { readFileSync, readdirSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { run } from "./common.mjs";
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
function describe(argv) {
  return basename(argv[0]);
}

/**
 * Processes of this user that use `root` now:
 *  - `bridge-mcp`: a bridge launcher whose workspace resolves to the root;
 *  - `client`: a Codex or Claude process whose working directory is the root;
 *  - `state-open`: any process holding a file below `<root>/.bridge/` open.
 *
 * `supported: false` means observation is unsupported, restricted or incomplete.
 */
export function findActiveUse(root, { env = process.env, proc = "/proc", selfPid = process.pid, platform = process.platform, execute = run } = {}) {
  if (env.CODEX_SANDBOX) {
    return { supported: false, reason: "running inside a Codex sandbox, which hides other processes", nextStep: "run the command outside the restricting sandbox on this host", entries: [] };
  }
  if (platform === "darwin") {
    // Background processes can start/exit between ps and lsof. Retry the entire
    // observation, never turn a partial snapshot into evidence of an idle workspace.
    let result;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      result = findMacActiveUse(root, { env, selfPid, execute });
      if (!result.transient) break;
    }
    const { transient, ...report } = result;
    return report;
  }
  if (platform !== "linux") return unknown(`active-use detection is not supported on ${platform}`, "use a supported Linux or macOS host");
  let names;
  try {
    names = readdirSync(proc).filter((name) => /^\d+$/u.test(name));
  } catch {
    return unknown(`Linux process information at ${proc} is unavailable`, "run outside the restricting sandbox with a readable procfs mount");
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
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ESRCH") unreadable += 1;
      continue;
    }
    let argv;
    try {
      argv = readFileSync(`${base}/cmdline`, "utf8").split("\0").filter((arg) => arg.length > 0);
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ESRCH") unreadable += 1;
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
        } catch (error) {
          if (error.code !== "ENOENT" && error.code !== "ESRCH") unreadable += 1;
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
    if (kinds.length > 0) entries.push({ pid, kinds, command: describe(argv) });
  }
  return unreadable > 0
    ? { ...unknown("some same-user process information could not be read"), entries, unreadable }
    : { supported: true, entries, unreadable };
}


function unknown(reason, nextStep = "run outside the restricting sandbox; ensure process inspection is permitted, then retry") {
  return { supported: false, reason, nextStep, entries: [] };
}

/** ps supplies the completeness baseline; lsof uses NUL fields so spaces are data. */
function findMacActiveUse(root, { env, selfPid, execute }) {
  const uid = process.getuid();
  const probe = (command, args) => execute(command, args, { env, timeoutMs: 15_000 });
  const snapshot = () => {
    const result = probe("/bin/ps", ["-ww", "-axo", "uid=,pid=,comm="]);
    if (result.error || result.status !== 0 || result.stderr.trim()) return null;
    const rows = new Map();
    for (const line of result.stdout.split("\n").filter((line) => line.trim())) {
      const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/u.exec(line);
      if (!match) return null;
      if (Number(match[1]) === uid && Number(match[2]) !== result.pid) rows.set(Number(match[2]), match[3]);
    }
    // An empty or filtered process list is not evidence of an idle worktree.
    return rows.has(selfPid) ? rows : null;
  };
  const before = snapshot();
  if (!before) return unknown("macOS ps could not enumerate processes (permission, sandbox or incomplete output)");
  const files = probe("/usr/sbin/lsof", ["-nP", "-a", "-u", String(uid), "-F0pcfn"]);
  if (files.error || files.status !== 0 || files.stderr.trim()) {
    return unknown("macOS lsof could not inspect process files completely", "run outside the restricting sandbox and ensure /usr/sbin/lsof can inspect this user's processes");
  }
  const parsed = parseMacFiles(files.stdout);
  if (!parsed.records) return parsed;
  const records = parsed.records;
  const after = snapshot();
  if (!after) return unknown("macOS ps could not verify the process snapshot");
  const canonicalRoot = realOrNull(root) ?? resolve(root);
  const stateDirectory = `${canonicalRoot}${sep}.bridge${sep}`;
  const entries = [];
  for (const [pid, command] of after) {
    if (pid === selfPid) continue;
    let info = records.get(pid);
    if (!before.has(pid) || before.get(pid) !== command || !info?.cwd) {
      // Observe late arrivals individually: unrelated background activity need not
      // stop setup, but every surviving PID still needs a complete observation.
      const detail = probe("/usr/sbin/lsof", ["-nP", "-a", "-u", String(uid), "-p", String(pid), "-F0pcfn"]);
      const identity = probe("/bin/ps", ["-ww", "-p", String(pid), "-o", "uid=,pid=,comm="]);
      if (!identity.error && !identity.signal && identity.status === 1 && !identity.stdout.trim() && !identity.stderr.trim()) continue;
      const match = /^\s*(\d+)\s+(\d+)\s+([^\n]+)\n?$/u.exec(identity.stdout);
      if (identity.error || identity.signal || identity.status !== 0 || identity.stderr.trim() ||
          !match || Number(match[1]) !== uid || Number(match[2]) !== pid || match[3] !== command) {
        return { ...unknown(`macOS process ${pid} changed identity during inspection; retry the command`), transient: true };
      }
      if (detail.error || detail.signal || detail.status !== 0 || detail.stderr.trim()) {
        return unknown(`macOS lsof could not inspect surviving process ${pid}`);
      }
      const fresh = parseMacFiles(detail.stdout);
      if (!fresh.records) return fresh;
      info = fresh.records.get(pid);
      if (!info?.cwd) return unknown(`macOS process ${pid} has no readable working directory`);
    }
    const cwd = realOrNull(info.cwd);
    if (!cwd) return unknown("macOS reported a working directory that cannot be resolved");
    const kinds = [];
    const program = basename(command);
    if (cwd === canonicalRoot && /^(codex|claude)(?:$|-)/u.test(program)) kinds.push("client");
    if (info.paths.some((path) => path.startsWith(stateDirectory))) kinds.push("state-open");
    if (/^node(?:$|-)/u.test(program)) {
      const args = probe("/bin/ps", ["-ww", "-p", String(pid), "-o", "args="]);
      if (args.error || args.status !== 0 || args.stderr.trim() || !args.stdout.trim()) {
        return { ...unknown("macOS could not read a live Node process's arguments; retry the command"), transient: true };
      }
      const line = args.stdout.replace(/\n$/u, "");
      if (cwd === canonicalRoot && /(?:^|[\s/])codex(?:\.js)?(?:\s|$)/u.test(line)) kinds.push("client");
      if (cwd === canonicalRoot && /(?:^|[\s/])\.bridge-project\/entry\.mjs(?:\s|$)/u.test(line)) kinds.push("bridge-mcp");
      if (/(?:^|[\s/])native-bridge-mcp\.mjs(?:\s|$)/u.test(line)) {
        if (cwd === canonicalRoot) {
          kinds.push("bridge-mcp");
        } else {
          // ps flattens argv. Consider every possible end of each workspace
          // argument. If none resolves here, this bridge cannot use this root.
          // If a whitespace-containing value could point here, refuse to guess.
          for (const workspace of line.matchAll(/(?:^|\s)--workspace (?=([\s\S]+))/gu)) {
            const value = workspace[1];
            const boundaries = [...value.matchAll(/\s/gu)].map((match) => match.index);
            if (boundaries.length > 256) return unknown("macOS bridge arguments are too ambiguous to inspect safely");
            const possible = [...boundaries, value.length].some((end) => {
              const path = resolve(cwd, value.slice(0, end));
              return (realOrNull(path) ?? path) === canonicalRoot;
            });
            if (!possible) continue;
            if (boundaries.length) return unknown("macOS ps cannot unambiguously resolve a bridge workspace argument containing whitespace");
            kinds.push("bridge-mcp");
            break;
          }
        }
      }
    }
    if (kinds.length) entries.push({ pid, kinds, command: program });
  }
  return { supported: true, entries, unreadable: 0 };
}

/** Strict lsof -F0pcfn reader, shared by full and per-PID observations. */
function parseMacFiles(output) {
  if (!output.endsWith("\0\n")) return unknown("macOS lsof returned truncated output");
  const records = new Map();
  let record = null;
  let fd = null;
  for (const raw of output.split("\0")) {
    const field = raw.replace(/^\n/u, "");
    if (!field) continue;
    if (field[0] === "p") {
      if (!/^p\d+$/u.test(field)) return unknown("macOS lsof returned an invalid process record");
      record = { cwd: null, paths: [] };
      records.set(Number(field.slice(1)), record);
      fd = null;
    } else if (field[0] === "f") {
      fd = field.slice(1);
      if (fd === "NOFD") return unknown("macOS lsof could not read a process file descriptor table");
    } else if (field[0] === "n" && record) {
      const path = field.slice(1);
      if (fd === "cwd") record.cwd = path;
      record.paths.push(path);
    } else if (field[0] !== "c") {
      return unknown("macOS lsof returned incomplete or unexpected fields");
    }
  }
  return { records };
}
