// Installed runtimes: one immutable directory per source commit, described by its manifest.
// See docs/setup-layout.md for the layout and manifest fields.

import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  SetupError,
  byString,
  childNpmEnv,
  newTag,
  readJson,
  run,
  sha256,
  treeDigest,
  walkFiles,
} from "./common.mjs";

export const RUNTIME_FORMAT = "claude-codex-bridge.runtime/v1";
export const MANIFEST_NAME = "runtime-manifest.json";
export const INSTALL_LOG = "install.log";
export const INSTALL_FORMAT = "git-archive+npm-ci+build";
export const LAUNCHER = "scripts/native-bridge-mcp.mjs";
export const STARTUP_TIMEOUT_SEC = 30;
/** Client wait for one MCP call; never bounds a round. 5400 s carries a 75-minute round. */
export const TOOL_TIMEOUT_SEC = 5400;

/** Instructions installed into a worktree: workflow skills, both role skills, the workflow guide. */
export const INSTRUCTION_PATHS = [
  ".agents/skills",
  ".codex/skills/using-bridge",
  ".claude/skills/using-bridge",
  "docs/features/README.md",
];

const REQUIRED_FILES = [
  LAUNCHER,
  "shared/control-plane/dist/index.js",
  "shared/mcp-server-core/dist/index.js",
  "claude/claude-side/dist/index.js",
  "codex/codex-side/dist/index.js",
  "node_modules/@modelcontextprotocol/sdk/package.json",
  "node_modules/@openai/codex/package.json",
];

const RUNTIME_ID = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}-[0-9a-f]{12}$/u;

export const runtimesDir = (home) => join(home, "runtimes");
export const runtimeId = (version, commit) => `${version}-${commit.slice(0, 12)}`;

const skipGenerated = (_rel, entry) =>
  entry.name === "node_modules" || entry.name === "__pycache__" || entry.name.endsWith(".pyc");

export function instructionFiles(root) {
  const files = [];
  for (const top of INSTRUCTION_PATHS) {
    let stat;
    try {
      stat = statSync(join(root, top));
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      for (const rel of walkFiles(join(root, top), skipGenerated)) files.push(`${top}/${rel}`);
    } else {
      files.push(top);
    }
  }
  return files.sort(byString).map((path) => ({ path, sha256: sha256(readFileSync(join(root, path))) }));
}

function treeFiles(root) {
  return walkFiles(
    root,
    (rel, entry) => entry.name === "node_modules" || rel === MANIFEST_NAME || rel === INSTALL_LOG,
  );
}

function validManifest(value) {
  return (
    value.format === RUNTIME_FORMAT &&
    typeof value.runtime_id === "string" &&
    typeof value.source?.commit === "string" &&
    /^[0-9a-f]{40}([0-9a-f]{24})?$/u.test(value.source.commit) &&
    typeof value.compatibility === "object" &&
    value.compatibility !== null &&
    Array.isArray(value.instructions?.files) &&
    typeof value.tree_sha256 === "string"
  );
}

export function loadRuntimeAt(path, expectedId) {
  const parsed = readJson(join(path, MANIFEST_NAME));
  if (parsed.kind === "absent") {
    throw new SetupError("RUNTIME_NOT_INSTALLED", `no runtime manifest in ${path}`, {
      nextStep: "install the runtime with `node scripts/bridge.mjs install` from a bridge clone",
    });
  }
  if (parsed.kind === "invalid" || !validManifest(parsed.value) ||
      (expectedId !== undefined && parsed.value.runtime_id !== expectedId)) {
    throw new SetupError("RUNTIME_MANIFEST_INVALID", `runtime manifest in ${path} is invalid`, {
      details: { detail: parsed.detail ?? "unexpected fields or runtime id" },
      nextStep: "inspect the directory; reinstall the commit under a clean <home>/runtimes",
    });
  }
  return { id: parsed.value.runtime_id, path, manifest: parsed.value };
}

export function loadRuntime(home, id) {
  if (typeof id !== "string" || !RUNTIME_ID.test(id)) {
    throw new SetupError("RUNTIME_NOT_INSTALLED", `not a runtime id: ${String(id)}`, {
      nextStep: "list installed runtimes with `node scripts/bridge.mjs runtimes`",
    });
  }
  const path = join(runtimesDir(home), id);
  if (!existsSync(path)) {
    throw new SetupError("RUNTIME_NOT_INSTALLED", `runtime ${id} is not installed in ${runtimesDir(home)}`, {
      nextStep: "install it with `node scripts/bridge.mjs install --ref <commit>` from a bridge clone",
    });
  }
  return loadRuntimeAt(path, id);
}

export function listRuntimes(home) {
  let names;
  try {
    names = readdirSync(runtimesDir(home));
  } catch {
    return [];
  }
  return names
    .filter((name) => !name.startsWith("."))
    .sort(byString)
    .map((name) => {
      try {
        return loadRuntimeAt(join(runtimesDir(home), name), name);
      } catch (error) {
        return { id: name, path: join(runtimesDir(home), name), manifest: null, error };
      }
    });
}

/** Problems that make a runtime unusable; empty when the installed files match the manifest. */
export function verifyRuntime(runtime) {
  const problems = [];
  for (const rel of REQUIRED_FILES) {
    if (!existsSync(join(runtime.path, rel))) problems.push(`missing ${rel}`);
  }
  if (problems.length === 0 && treeDigest(runtime.path, treeFiles(runtime.path)) !== runtime.manifest.tree_sha256) {
    problems.push("installed files differ from the manifest (tree_sha256)");
  }
  return problems;
}

/** path -> set of instruction file hashes shipped by any installed runtime. */
export function knownInstructionHashes(home) {
  const known = new Map();
  for (const runtime of listRuntimes(home)) {
    for (const file of runtime.manifest?.instructions.files ?? []) {
      if (!known.has(file.path)) known.set(file.path, new Set());
      known.get(file.path).add(file.sha256);
    }
  }
  return known;
}

function npmCommand() {
  const beside = join(dirname(process.execPath), "npm");
  return existsSync(beside) ? beside : "npm";
}

function readCompatibility(root) {
  const controlPlane = pathToFileURL(join(root, "shared/control-plane/dist/index.js")).href;
  const runtimeVersion = pathToFileURL(join(root, "shared/control-plane/dist/runtime-version.js")).href;
  // Older commits may lack an export: record null ("unknown"), never a guess.
  const script = `
    const out = { state_schema_version: null, codex_identity_adapters: null, node_minimum: null };
    try {
      const cp = await import(${JSON.stringify(controlPlane)});
      const schema = cp.SqliteStateStore?.schemaVersionSupported;
      if (Number.isInteger(schema)) out.state_schema_version = schema;
      if (cp.VERIFIED_ADAPTERS instanceof Map) out.codex_identity_adapters = [...cp.VERIFIED_ADAPTERS.keys()].sort();
    } catch {}
    try {
      const rv = await import(${JSON.stringify(runtimeVersion)});
      if (typeof rv.MINIMUM_NODE_VERSION === "string") out.node_minimum = rv.MINIMUM_NODE_VERSION;
    } catch {}
    process.stdout.write(JSON.stringify(out));`;
  const result = run(process.execPath, ["--no-warnings", "--input-type=module", "-e", script], { cwd: root });
  if (result.status !== 0) throw new Error(`cannot read runtime compatibility: ${result.stderr.trim()}`);
  return JSON.parse(result.stdout);
}

/** chmod a-w below root, children before their directory; symlinks are left alone. */
function makeReadOnly(root) {
  const visit = (path) => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) for (const name of readdirSync(path)) visit(join(path, name));
    chmodSync(path, stat.mode & 0o7555);
  };
  visit(root);
}

/** Remove a tree this CLI created, including a read-only one. */
export function removeOwnTree(root) {
  const visit = (path) => {
    let stat;
    try {
      stat = lstatSync(path);
    } catch {
      return;
    }
    if (!stat.isDirectory()) return;
    chmodSync(path, stat.mode | 0o700);
    for (const name of readdirSync(path)) visit(join(path, name));
  };
  visit(root);
  rmSync(root, { recursive: true, force: true });
}

/**
 * Install the runtime of one commit of a local bridge clone. Idempotent: an existing runtime of
 * the same commit is returned unchanged; nothing ever overwrites an installed runtime.
 */
export function installRuntime({ source, ref = "HEAD", home, env = process.env }) {
  const sourceRoot = resolve(source);
  const verified = run("git", ["-C", sourceRoot, "rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]);
  if (verified.status !== 0) {
    throw new SetupError("INSTALL_SOURCE_INVALID", `cannot resolve ${ref} in ${sourceRoot}`, {
      details: { stderr: verified.stderr.trim() || String(verified.error ?? "") },
      nextStep: "pass --source <local bridge clone> and --ref <commit> that exists in it",
    });
  }
  const commit = verified.stdout.trim();
  const packageText = run("git", ["-C", sourceRoot, "show", `${commit}:package.json`]);
  let version;
  try {
    version = JSON.parse(packageText.stdout).version;
  } catch {
    version = undefined;
  }
  if (typeof version !== "string" || !/^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/u.test(version)) {
    throw new SetupError("INSTALL_SOURCE_INVALID", `commit ${commit} has no usable package.json version`);
  }
  const id = runtimeId(version, commit);
  const directory = runtimesDir(home);
  const target = join(directory, id);
  if (existsSync(target)) {
    const existing = loadRuntimeAt(target, id);
    if (existing.manifest.source.commit !== commit) {
      throw new SetupError("RUNTIME_ID_COLLISION", `${target} belongs to commit ${existing.manifest.source.commit}`);
    }
    return { runtime: existing, created: false };
  }

  mkdirSync(directory, { recursive: true });
  const tag = newTag();
  const staging = join(directory, `.staging-${id}-${tag}`);
  const archive = join(directory, `.archive-${id}-${tag}.tar`);
  mkdirSync(staging);
  const logPath = join(staging, INSTALL_LOG);
  const logFd = openSync(logPath, "a");
  const npmEnv = childNpmEnv(env);
  const step = (label, command, args, cwd) => {
    writeSync(logFd, `\n$ ${label}\n`);
    const result = spawnSync(command, args, { cwd, env: npmEnv, stdio: ["ignore", logFd, logFd] });
    if (result.status !== 0) {
      throw new SetupError(
        "INSTALL_STEP_FAILED",
        `${label} failed (${result.error?.message ?? `exit ${result.status ?? result.signal}`}); see ${logPath}`,
        {
          details: { staging, log: logPath },
          nextStep: "fix the cause, delete the .staging directory and run install again",
        },
      );
    }
  };
  let manifest;
  try {
    step("git archive", "git", ["-C", sourceRoot, "archive", "--format=tar", `--output=${archive}`, commit]);
    step("tar -x", "tar", ["-xf", archive, "-C", staging]);
    unlinkSync(archive);
    step("npm ci --ignore-scripts", npmCommand(), ["ci", "--ignore-scripts"], staging);
    step("npm run build", npmCommand(), ["run", "build"], staging);
    step("launcher --help", process.execPath, [join(staging, LAUNCHER), "--help"], staging);
    const lockfile = readFileSync(join(staging, "package-lock.json"));
    const npmVersion = run(npmCommand(), ["--version"], { env: npmEnv }).stdout.trim() || null;
    manifest = {
      format: RUNTIME_FORMAT,
      runtime_id: id,
      package_version: version,
      install_format: INSTALL_FORMAT,
      created_at: new Date().toISOString(),
      source: { repository: sourceRoot, commit },
      built_with: { node: process.versions.node, npm: npmVersion },
      lockfile_sha256: sha256(lockfile),
      compatibility: readCompatibility(staging),
      instructions: (() => {
        const files = instructionFiles(staging);
        return {
          set_sha256: sha256(files.map((file) => `${file.path}\0${file.sha256}\n`).join("")),
          files,
        };
      })(),
      mcp: { launcher: LAUNCHER, startup_timeout_sec: STARTUP_TIMEOUT_SEC, tool_timeout_sec: TOOL_TIMEOUT_SEC },
      tree_sha256: treeDigest(staging, treeFiles(staging)),
    };
    writeFileSync(join(staging, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (error) {
    rmSync(archive, { force: true });
    throw error;
  } finally {
    closeSync(logFd);
  }
  makeReadOnly(staging);
  try {
    renameSync(staging, target);
  } catch (error) {
    if (existsSync(target)) {
      // A concurrent install of the same commit finished first; keep that one.
      removeOwnTree(staging);
      return { runtime: loadRuntimeAt(target, id), created: false };
    }
    throw error;
  }
  return { runtime: loadRuntimeAt(target, id), created: true };
}
