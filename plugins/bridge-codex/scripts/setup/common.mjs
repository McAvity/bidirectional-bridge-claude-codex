// Small shared helpers of the setup CLI (scripts/bridge.mjs). Dependency-free on purpose: the CLI
// must run from a fresh clone before anything is installed or built.

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export const HOME_ENV = "CLAUDE_CODEX_BRIDGE_HOME";
/** Per-worktree local setup directory: runtime selection and its record. Never versioned. */
export const LOCAL_DIR = ".bridge-runtime";

/** An expected, actionable refusal: printed as code + message + next step, never as a stack. */
export class SetupError extends Error {
  constructor(code, message, { details, nextStep } = {}) {
    super(message);
    this.code = code;
    this.details = details;
    this.nextStep = nextStep;
  }
}

export function bridgeHome(env = process.env) {
  if (env[HOME_ENV]) return resolve(env[HOME_ENV]);
  const data = env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME)
    ? env.XDG_DATA_HOME
    : join(homedir(), ".local", "share");
  return join(data, "claude-codex-bridge");
}

export const sha256 = (data) => createHash("sha256").update(data).digest("hex");
export const newTag = () => randomBytes(6).toString("hex");
export const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function readJson(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { kind: "absent" };
    return { kind: "invalid", detail: error.message };
  }
  try {
    const value = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { kind: "invalid", detail: "not a JSON object" };
    }
    return { kind: "valid", value };
  } catch (error) {
    return { kind: "invalid", detail: error.message };
  }
}

export function readOptional(path) {
  try {
    return readFileSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export function tempSibling(path, tag) {
  return join(dirname(path), `.${basename(path)}.bridge-tmp-${tag}`);
}

/** Replace `path` atomically: write a flushed sibling temp file, then rename it over the target. */
export function writeAtomic(path, content, { mode = 0o644, tag = newTag() } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = tempSibling(path, tag);
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

export function run(command, args, { cwd, env, input, timeoutMs = 60_000 } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    input,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

/** Sorted POSIX-relative paths of files and symlinks below `root`; `skip(rel, dirent)` prunes. */
export function walkFiles(root, skip = () => false) {
  const out = [];
  const visit = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (skip(rel, entry)) continue;
      if (entry.isDirectory()) visit(join(directory, entry.name), rel);
      else out.push(rel);
    }
  };
  visit(root, "");
  return out.sort(byString);
}

/** Content digest of `files` below `root`; symlinks contribute their target, not the pointee. */
export function treeDigest(root, files) {
  const hash = createHash("sha256");
  for (const rel of [...files].sort(byString)) {
    const absolute = join(root, rel);
    const stat = lstatSync(absolute);
    const value = stat.isSymbolicLink()
      ? `L:${readlinkSync(absolute)}`
      : `F:${(stat.mode & 0o111) !== 0 ? "x" : "-"}:${sha256(readFileSync(absolute))}`;
    hash.update(`${rel}\0${value}\0`);
  }
  return hash.digest("hex");
}

export function canonical(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** Environment for child npm commands: drop the lifecycle context of an npm script that called us. */
export function childNpmEnv(env = process.env) {
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (/^npm_(lifecycle_|package_)/u.test(key)) continue;
    if (["npm_command", "npm_execpath", "npm_node_execpath", "INIT_CWD"].includes(key)) continue;
    out[key] = value;
  }
  return out;
}
