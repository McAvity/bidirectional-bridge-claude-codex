// doctor: explain why a worktree is not ready, without models and without changing feature state.
// The only write is a temporary lock probe inside the worktree's own .bridge-runtime/ directory.

import { spawn } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { LOCAL_DIR, SetupError, canonical, newTag, run, sha256 } from "./common.mjs";
import { findActiveUse } from "./processes.mjs";
import { TOOL_TIMEOUT_SEC, knownInstructionHashes, listRuntimes, verifyRuntime } from "./runtime.mjs";
import {
  BLOCK_BEGIN,
  CODEX_CONFIG,
  definesBridge,
  findBlock,
  inspectCodexToml,
  localPaths,
  mcpDefinition,
  readPending,
  readRecord,
  readSelection,
  redirectedComponent,
  renderCodexBlock,
  resolveIdentity,
} from "./workspace.mjs";

export const DOCTOR_FORMAT = "claude-codex-bridge.doctor/v1";
const DEFAULT_NODE_MINIMUM = "22.13.0";
const FEATURE_TOOLS = 6;
const LOCAL_FILESYSTEMS = new Set(["ext2", "ext3", "ext4", "xfs", "btrfs", "tmpfs", "zfs", "f2fs", "overlay", "jfs", "bcachefs", "reiserfs"]);
const NETWORK_FILESYSTEMS = /^(nfs|cifs|smb|9p|sshfs|fuse|ceph|glusterfs|afs|virtiofs|davfs)/u;

function versionAtLeast(actual, minimum) {
  const parse = (value) => (/(\d+)\.(\d+)\.(\d+)/u.exec(value) ?? []).slice(1, 4).map(Number);
  const a = parse(actual);
  const m = parse(minimum);
  if (a.length !== 3 || m.length !== 3) return false;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== m[index]) return a[index] > m[index];
  }
  return true;
}

function tail(text, bytes = 1200) {
  return text.length > bytes ? text.slice(-bytes) : text;
}

function filesystemOf(path) {
  let text;
  try {
    text = readFileSync("/proc/self/mountinfo", "utf8");
  } catch {
    return null;
  }
  let best = null;
  for (const line of text.split("\n")) {
    const [left, right] = line.split(" - ");
    if (!right) continue;
    const mountPoint = left.split(" ")[4].replace(/\\([0-7]{3})/gu, (_, octal) => String.fromCharCode(Number.parseInt(octal, 8)));
    const prefix = mountPoint.endsWith("/") ? mountPoint : `${mountPoint}/`;
    if ((path === mountPoint || path.startsWith(prefix)) && (!best || mountPoint.length >= best.mountPoint.length)) {
      best = { mountPoint, fstype: right.split(" ")[0] };
    }
  }
  return best;
}

/** Hold a SQLite write lock and ask a separate process to take it: proves locking on this filesystem. */
function lockProbe(directory, env) {
  const path = join(directory, `.doctor-${newTag()}.db`);
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
  let holder;
  try {
    holder = new DatabaseSync(path);
    holder.exec("PRAGMA busy_timeout = 0");
    holder.exec("BEGIN IMMEDIATE");
    const contender = run(
      process.execPath,
      [
        "--no-warnings",
        "-e",
        "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(process.argv[1]);" +
          "db.exec('PRAGMA busy_timeout = 0'); try { db.exec('BEGIN IMMEDIATE'); console.log('acquired'); } catch { console.log('busy'); }",
        path,
      ],
      { env, timeoutMs: 15_000 },
    );
    const outcome = contender.stdout.trim();
    return outcome === "busy" ? { ok: true } : { ok: false, detail: outcome || tail(contender.stderr) };
  } catch (error) {
    return { ok: false, error };
  } finally {
    try {
      holder?.exec("ROLLBACK");
    } catch {
      /* not in a transaction */
    }
    try {
      holder?.close();
    } catch {
      /* not open */
    }
    for (const suffix of ["", "-journal", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
  }
}

/** Minimal MCP stdio client: start the server exactly as Codex would and read without claiming. */
function handshake(root, definition, env, timeoutMs = 25_000) {
  return new Promise((resolveHandshake) => {
    const child = spawn(definition.command, definition.args, {
      cwd: resolve(root, definition.cwd),
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let nextId = 1;
    let settled = false;
    const pending = new Map();
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const waiter of pending.values()) waiter.reject(new Error("server closed"));
      if (!child.stdin.destroyed) child.stdin.end();
      const kill = setTimeout(() => child.kill("SIGTERM"), 5_000);
      child.once("exit", () => clearTimeout(kill));
      resolveHandshake({ ...result, stderr_tail: tail(stderr) });
    };
    const timer = setTimeout(() => finish({ ok: false, error: `no complete handshake within ${timeoutMs} ms` }), timeoutMs);
    child.on("error", (error) => finish({ ok: false, error: error.message }));
    child.on("exit", (code, signal) => finish({ ok: false, error: `server exited (${code ?? signal}) before the handshake finished` }));
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      let newline;
      while ((newline = stdout.indexOf("\n")) >= 0) {
        const line = stdout.slice(0, newline).trim();
        stdout = stdout.slice(newline + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          finish({ ok: false, error: "server wrote non-JSON output to stdout" });
          return;
        }
        const waiter = pending.get(message.id);
        if (waiter) {
          pending.delete(message.id);
          waiter.resolve(message);
        }
      }
    });
    const request = (method, params) =>
      new Promise((resolveRequest, reject) => {
        const id = nextId++;
        pending.set(id, { resolve: resolveRequest, reject });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });
    const toolText = (message) => {
      const text = message.result?.content?.[0]?.text;
      try {
        return { isError: Boolean(message.result?.isError), data: JSON.parse(text) };
      } catch {
        return { isError: true, data: message.error ?? text ?? null };
      }
    };
    (async () => {
      const initialized = await request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "bridge-doctor", version: "1" },
      });
      if (initialized.error) throw new Error(`initialize failed: ${JSON.stringify(initialized.error)}`);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
      const listed = await request("tools/list", {});
      const tools = (listed.result?.tools ?? []).map((tool) => tool.name).sort();
      const serverInfo = toolText(await request("tools/call", { name: "bridge_server_info", arguments: {} }));
      const managerStatus = toolText(await request("tools/call", { name: "bridge_manager_status", arguments: {} }));
      finish({ ok: true, tools, serverInfo, managerStatus });
    })().catch((error) => finish({ ok: false, error: error.message }));
  });
}

function stateCheck(add, controlPlane, root, supported) {
  let identity;
  let probe;
  try {
    identity = controlPlane.resolveWorkspaceIdentity(root);
    const database = controlPlane.resolveDatabasePath(identity);
    probe = controlPlane.probeWorkspaceState(identity, database);
    controlPlane.assertProbeUsable(identity, probe, {});
  } catch (error) {
    const reason = error?.details?.reason ?? null;
    const message = error?.message ?? String(error);
    if (["copied_state", "database_bound_elsewhere", "database_owned_elsewhere", "second_database"].includes(reason)) {
      add("state", "error", "STATE_OWNED_ELSEWHERE", message, {
        details: { reason },
        nextStep: "never copy .bridge/ between worktrees; start in the worktree that owns this state, or give this worktree its own",
      });
    } else if (reason === "unbound_legacy_state") {
      add("state", "error", "STATE_LEGACY_UNBOUND", message, {
        details: { reason },
        nextStep: "adopt it deliberately (docs/manager-identity.md, Legacy databases) or use a fresh database",
      });
    } else if (/newer than this build/u.test(message)) {
      add("state", "error", "STATE_SCHEMA_NEWER", message, { details: { reason }, nextStep: "select a runtime that supports this database schema" });
    } else if (reason === "database_unreadable") {
      add("state", "error", "STATE_UNREADABLE", message, { details: { reason }, nextStep: "check permissions and integrity of the database file" });
    } else {
      add("state", "error", "STATE_UNRESOLVED", message, { details: { reason }, nextStep: "inspect .bridge/ manually; the bridge never guesses which state belongs here" });
    }
    return;
  }
  if (!probe.databaseExists) {
    add("state", "ok", "OK", "no bridge state yet; the first authorized manager call creates it");
  } else if (probe.recoveryNeeded) {
    add("state", "warn", "STATE_RECOVERY_NEEDED", "state is bound but its markers are incomplete; the next authorized call repairs them", {
      details: { schema_version: probe.schemaVersion },
    });
  } else {
    add("state", "ok", "OK", `${probe.binding ? "bound to this worktree" : "database present, not bound yet"} (schema ${probe.schemaVersion}${supported === null ? "" : `, runtime supports ${supported}`})`, {
      details: { bound: Boolean(probe.binding), manager_bound: Boolean(probe.managerBinding), schema_version: probe.schemaVersion },
    });
  }
}

/** Trust levels recorded for the worktree root or its main repository in the Codex config files. */
function codexTrust(root, identity, env, profile) {
  const codexHome = env.CODEX_HOME ? resolve(env.CODEX_HOME) : join(homedir(), ".codex");
  const files = [join(codexHome, "config.toml"), ...(profile ? [join(codexHome, `${profile}.config.toml`)] : [])];
  const candidates = [root];
  if (identity?.git_common_dir?.endsWith("/.git")) candidates.push(dirname(identity.git_common_dir));
  const script =
    "import json, sys, tomllib\nout = {}\n" +
    "for path in sys.argv[1:]:\n" +
    "    try:\n        with open(path, 'rb') as handle:\n            data = tomllib.load(handle)\n" +
    "    except FileNotFoundError:\n        continue\n" +
    "    projects = data.get('projects') or {}\n" +
    "    out[path] = {key: (value or {}).get('trust_level') for key, value in projects.items() if isinstance(value, dict)}\n" +
    "print(json.dumps(out))\n";
  const result = run("python3", ["-c", script, ...files], { env });
  if (result.status !== 0) return { known: false, files };
  const levels = Object.values(JSON.parse(result.stdout)).flatMap((projects) => candidates.map((path) => projects[path]));
  return { known: true, trusted: levels.includes("trusted"), files };
}

function codexProjectCheck(add, root, identity, manifest, env, profile) {
  const expected = mcpDefinition(manifest);
  const query = (extra) =>
    run("codex", [...(profile ? ["--profile", profile] : []), ...extra, "mcp", "get", "bridge", "--json"], {
      cwd: root,
      env,
      timeoutMs: 30_000,
    });
  const first = query([]);
  if (first.status === 0) {
    let server;
    try {
      server = JSON.parse(first.stdout);
    } catch {
      add("codex_project", "unknown", "CODEX_OUTPUT_UNRECOGNIZED", "`codex mcp get bridge --json` printed unrecognized output", { details: { stdout: tail(first.stdout, 400) } });
      return;
    }
    const transport = server.transport ?? {};
    const same =
      transport.command === expected.command &&
      JSON.stringify(transport.args) === JSON.stringify(expected.args) &&
      transport.cwd === expected.cwd;
    if (!same) {
      add("codex_project", "error", "CODEX_CONFIG_MISMATCH", "Codex resolves a different bridge server than the managed block defines", {
        details: { command: transport.command, args: transport.args, cwd: transport.cwd },
        nextStep: "remove the other mcp_servers.bridge definition (global config, profile or -c override)",
      });
    } else if (server.enabled === false) {
      add("codex_project", "error", "CODEX_BRIDGE_DISABLED", "Codex has the bridge server disabled", { nextStep: "remove enabled = false for mcp_servers.bridge" });
    } else if (Number(server.tool_timeout_sec) < TOOL_TIMEOUT_SEC) {
      add("codex_project", "warn", "CODEX_TIMEOUT_TOO_LOW", `tool_timeout_sec is ${server.tool_timeout_sec}; long rounds need ${TOOL_TIMEOUT_SEC}`);
    } else {
      add("codex_project", "ok", "OK", "Codex loads the managed bridge server from this worktree");
    }
    return;
  }
  if (/error parsing project config|failed to load/iu.test(first.stderr)) {
    add("codex_project", "error", "CODEX_CONFIG_INVALID", "Codex cannot load this project's configuration", {
      details: { stderr: tail(first.stderr, 600) },
      nextStep: `fix ${CODEX_CONFIG}; Codex refuses to start with it`,
    });
    return;
  }
  // Codex loads project configuration only for trusted projects, and a `-c` trust override does
  // not change that. Read the trust entries of the user's Codex files; never write them.
  const trust = codexTrust(root, identity, env, profile);
  if (trust.known && !trust.trusted) {
    add("codex_project", "error", "CODEX_PROJECT_UNTRUSTED", "Codex ignores this project's configuration because neither the worktree nor its main repository is trusted", {
      details: { checked_files: trust.files },
      nextStep: "start `codex` in the worktree root and approve the project trust prompt (pass --codex-profile if trust is kept in a profile file)",
    });
  } else {
    add("codex_project", "error", "CODEX_CONFIG_NOT_LOADED", "Codex does not report the bridge server for this worktree", {
      details: { stderr: tail(first.stderr, 600), checked_profile: profile ?? null },
      nextStep: "check the Codex configuration layers with `codex mcp list` in the worktree root",
    });
  }
}

/**
 * Diagnostics-log status (wave13 §1, deferred from W13-01).
 *
 * The logger reports its own trouble on stderr, which nobody keeps, and in its own records. This
 * reads what is on disk — no log at all is normal, a redirected directory is not — and surfaces
 * the counters the logger wrote itself, so a degraded log is visible before an incident needs it.
 */
function logsCheck(add, root) {
  const directory = join(root, ".bridge", "logs");
  const redirected = redirectedComponent(root, ".bridge/logs");
  if (redirected?.target) {
    return add("logs", "error", "LOGS_PATH_REDIRECTED", `${redirected.path} is a symlink to ${redirected.target}; the runtime refuses to log through it`, {
      nextStep: "remove the link; diagnostics logs must be a real directory inside .bridge/",
    });
  }
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return add("logs", "ok", "OK", "no diagnostics log yet; the runtime writes one after its first authorized call");
    }
    return add("logs", "unknown", "LOGS_UNREADABLE", `cannot read ${directory}: ${error.message}`);
  }
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"));
  if (files.length === 0) {
    return add("logs", "ok", "OK", "diagnostics log directory is present and empty");
  }
  let bytes = 0;
  let newest = 0;
  let newestPath = null;
  for (const file of files) {
    try {
      const stat = statSync(join(directory, file.name));
      bytes += stat.size;
      if (stat.mtimeMs > newest) {
        newest = stat.mtimeMs;
        newestPath = join(directory, file.name);
      }
    } catch {
      /* rotated away between readdir and stat */
    }
  }
  // The logger's own bookkeeping: failures, deferred records and deletions it reported in-band.
  let degraded = null;
  let retention = 0;
  try {
    const text = readFileSync(newestPath, "utf8");
    const lines = text.split("\n").filter((line) => line.length > 0).slice(-400);
    for (const line of lines) {
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (record.event === "retention") retention += Number(record.details?.deleted_files ?? 0);
      if (record.event === "close" && Number(record.details?.failures ?? 0) > 0) {
        degraded = `${record.details.failures} write failure(s) in the last closed log`;
      }
    }
  } catch {
    /* the newest file may rotate away while we read it */
  }
  const summary = `${files.length} log file(s), ${bytes} bytes, newest ${new Date(newest).toISOString()}`;
  if (degraded) {
    return add("logs", "warn", "LOGS_DEGRADED", `${summary}; ${degraded}`, {
      nextStep: "check free space and permissions of .bridge/logs/; records of that process are incomplete",
    });
  }
  add("logs", "ok", "OK", `${summary}${retention > 0 ? `, ${retention} file(s) deleted by retention` : ""}`);
}

/**
 * Run all checks. `cliRuntime` is the runtime this CLI runs from, used to resolve the worktree
 * when no runtime is selected yet. Returns the versioned report object.
 */
export async function runDoctor({
  home,
  workspace,
  codexProfile,
  handshake: doHandshake = true,
  cliRuntime = null,
  env = process.env,
  /**
   * Safe subset (wave13 §3): skip every check that would start a client or load the project's
   * own configuration, so an incident export can reuse doctor without executing anything the
   * project controls. The skipped checks are reported as such, never silently dropped.
   */
  safeSubset = false,
}) {
  const checks = [];
  const add = (id, status, code, summary, { details, nextStep } = {}) =>
    checks.push({ id, status, code: status === "ok" ? "OK" : code, summary, ...(details ? { details } : {}), ...(nextStep ? { next_step: nextStep } : {}) });
  const requested = canonical(resolve(workspace));
  const sandboxed = Boolean(env.CODEX_SANDBOX || env.CODEX_SANDBOX_NETWORK_DISABLED);

  if (process.platform === "linux") add("platform", "ok", "OK", "Linux");
  else add("platform", "error", "HOST_UNSUPPORTED_PLATFORM", `${process.platform} is not supported by setup v1`, { nextStep: "use Linux with a local filesystem" });

  const git = run("git", ["--version"], { env });
  if (git.status === 0) add("git", "ok", "OK", git.stdout.trim());
  else add("git", "error", "GIT_MISSING", "git is not available", { nextStep: "install git" });

  // Selection first: the selected runtime resolves identity and state with its own code.
  const selection = readSelection(requested);
  const runtime = selection.kind === "ok" ? selection.runtime : null;
  // Identity resolution is the same in every runtime and read-only; any complete one will do.
  const resolver = runtime ?? cliRuntime ??
    listRuntimes(home).find((candidate) => candidate.manifest && existsSync(join(candidate.path, "shared/control-plane/dist/index.js"))) ??
    null;
  let identity = null;
  let controlPlane = null;
  if (!existsSync(requested)) {
    add("workspace", "error", "WORKSPACE_MISSING", `${requested} does not exist`, { nextStep: "pass an existing worktree root" });
  } else if (!resolver) {
    add("workspace", "unknown", "WORKSPACE_UNVERIFIED", "no installed runtime is available to resolve the worktree identity", {
      nextStep: "run doctor from an installed runtime (node <home>/runtimes/<id>/scripts/bridge.mjs), or init the worktree",
    });
  } else {
    try {
      identity = await resolveIdentity(resolver.path, requested);
      controlPlane = await import(pathToFileURL(join(resolver.path, "shared/control-plane/dist/index.js")).href);
      const full = controlPlane.resolveWorkspaceIdentity(identity.root);
      identity.git_common_dir = full.git_common_dir;
      add("workspace", "ok", "OK", `${identity.kind} worktree ${identity.root}`, { details: { git_dir: identity.git_dir } });
    } catch (error) {
      if (!(error instanceof SetupError)) throw error;
      add("workspace", "error", error.code, error.message, { nextStep: error.nextStep });
    }
  }
  const root = identity?.root ?? requested;
  const manifest = runtime?.manifest ?? null;

  // Setup record and selection.
  const paths = localPaths(root);
  const record = identity ? readRecord(root, identity) : { kind: "absent" };
  const pending = readPending(root);
  const redirectedLocal = redirectedComponent(root, `${LOCAL_DIR}/install.json`);
  if (redirectedLocal?.target) {
    add("setup", "error", "PATH_REDIRECTED", `${redirectedLocal.path} is a symlink to ${redirectedLocal.target}; setup state must be a real directory in the worktree`, {
      nextStep: `remove the symlink and run init; setup never writes through symlinks`,
    });
  } else if (!existsSync(paths.dir)) {
    add("setup", "error", "SETUP_NOT_INITIALIZED", `this worktree has no ${LOCAL_DIR}/`, { nextStep: "run init --workspace <worktree> --yes" });
  } else if (record.kind === "foreign") {
    add("setup", "error", "SETUP_RECORD_FOREIGN", `${paths.record} belongs to ${record.value.workspace.root}`, {
      nextStep: `this is a copied setup: check it, remove ${LOCAL_DIR}/ here and run init`,
    });
  } else if (record.kind === "invalid") {
    add("setup", "error", "SETUP_RECORD_INVALID", `${paths.record} cannot be used: ${record.detail}`, { nextStep: "inspect the file" });
  } else if (pending) {
    add("setup", "error", "SETUP_INTERRUPTED", "a previous init, update or rollback did not finish", {
      details: { pending },
      nextStep: "run the same command again with --yes; it completes the interrupted change",
    });
  } else if (selection.kind === "broken") {
    add("setup", "error", "RUNTIME_SELECTION_BROKEN", `${LOCAL_DIR}/current points to a missing or invalid runtime: ${selection.target}`, {
      details: { reason: selection.error?.code ?? null },
      nextStep: "reinstall that runtime, or run update/rollback with an installed runtime",
    });
  } else if (selection.kind !== "ok") {
    add("setup", "error", selection.kind === "not-symlink" ? "LOCAL_SETUP_CONFLICT" : "SETUP_NOT_INITIALIZED", `no runtime selected in ${LOCAL_DIR}/current`, {
      nextStep: "run init --workspace <worktree> --yes",
    });
  } else if (record.kind !== "valid" || record.value.runtime.id !== runtime.id) {
    add("setup", "error", "SETUP_RECORD_MISMATCH", `${LOCAL_DIR}/install.json does not describe the selected runtime ${runtime.id}`, {
      nextStep: "run init --workspace <worktree> --yes to rewrite the record",
    });
  } else {
    add("setup", "ok", "OK", `runtime ${runtime.id} selected (commit ${manifest.source.commit.slice(0, 12)})`);
  }

  if (runtime) {
    const problems = verifyRuntime(runtime);
    if (problems.length === 0) add("runtime", "ok", "OK", `runtime files match ${runtime.id}`);
    else add("runtime", "error", "RUNTIME_INCOMPLETE", problems.join("; "), { nextStep: "reinstall the runtime of this commit" });
  } else {
    add("runtime", "skipped", "RUNTIME_NOT_SELECTED", "no selected runtime to verify");
  }

  const nodeMinimum = manifest?.compatibility.node_minimum ?? DEFAULT_NODE_MINIMUM;
  const node = run("node", ["--version"], { env });
  if (node.error?.code === "ENOENT") add("node", "error", "NODE_MISSING", "`node` is not on PATH; Codex starts the bridge with it", { nextStep: "put Node on PATH for Codex" });
  else if (!versionAtLeast(node.stdout, nodeMinimum)) add("node", "error", "NODE_UNSUPPORTED", `node ${node.stdout.trim()} is older than ${nodeMinimum}`, { nextStep: `use Node ${nodeMinimum} or newer` });
  else add("node", "ok", "OK", `node ${node.stdout.trim()}`);

  const codex = run("codex", ["--version"], { env, timeoutMs: 20_000 });
  const codexVersion = /(\d+\.\d+\.\d+)/u.exec(codex.stdout)?.[1] ?? null;
  const adapters = manifest?.compatibility.codex_identity_adapters ?? null;
  if (codex.error?.code === "ENOENT") {
    add("codex", "error", "CODEX_MISSING", "Codex CLI is not on PATH", { nextStep: "install Codex; the manager (Astra) runs in it" });
  } else if (codex.status !== 0 || codexVersion === null) {
    add("codex", "unknown", "CODEX_VERSION_UNKNOWN", "cannot read the Codex version", { details: { stderr: tail(codex.stderr, 400) } });
  } else if (!Array.isArray(adapters)) {
    add("codex", "unknown", "CODEX_ADAPTERS_UNKNOWN", `Codex ${codexVersion}; the selected runtime does not declare verified host versions`);
  } else if (!adapters.includes(codexVersion)) {
    add("codex", "error", "CODEX_VERSION_UNSUPPORTED", `Codex ${codexVersion} has no verified identity adapter (verified: ${adapters.join(", ")})`, {
      nextStep: "use a verified Codex version; the adapter check is not bypassed",
    });
  } else {
    add("codex", "ok", "OK", `Codex ${codexVersion} (verified identity adapter)`);
  }
  if (codex.status === 0) {
    const login = run("codex", ["login", "status"], { env, timeoutMs: 20_000 });
    if (login.status === 0) add("codex_login", "ok", "OK", "Codex is logged in");
    else add("codex_login", "warn", "CODEX_LOGIN_MISSING", "Codex reports no login", { nextStep: "run `codex login`" });
  }

  const claude = run("claude", ["--version"], { env, timeoutMs: 20_000 });
  if (claude.error?.code === "ENOENT" || claude.status !== 0) {
    add("claude", "error", "CLAUDE_MISSING", "Claude Code is not available on PATH", { nextStep: "install Claude Code; the bridge starts the worker with `claude`" });
  } else {
    add("claude", "ok", "OK", `Claude Code ${claude.stdout.trim()}`);
    const auth = run("claude", ["auth", "status", "--json"], { env, timeoutMs: 20_000 });
    let loggedIn = null;
    try {
      loggedIn = JSON.parse(auth.stdout).loggedIn;
    } catch {
      loggedIn = null;
    }
    if (loggedIn === true) add("claude_login", "ok", "OK", "Claude Code is logged in");
    else if (loggedIn === false) add("claude_login", "warn", "CLAUDE_LOGIN_MISSING", "Claude Code reports no login", { nextStep: "run `claude auth login`" });
    else add("claude_login", "warn", "CLAUDE_LOGIN_UNKNOWN", "cannot read the Claude Code login status");
  }

  const python = run("python3", ["-c", "import sys; print('%d.%d.%d' % sys.version_info[:3])"], { env });
  if (python.status !== 0) add("python", "warn", "PYTHON_MISSING", "python3 is not available; feature-exchange needs it", { nextStep: "install Python 3.11+" });
  else if (!versionAtLeast(python.stdout, "3.11.0")) add("python", "warn", "PYTHON_UNSUPPORTED", `python3 ${python.stdout.trim()} is older than 3.11`);
  else add("python", "ok", "OK", `python3 ${python.stdout.trim()}`);

  if (runtime && identity) {
    const known = knownInstructionHashes(home);
    const kept = record.kind === "valid" ? record.value.managed?.kept_local ?? {} : {};
    const missing = [];
    const outdated = [];
    const modified = [];
    for (const file of manifest.instructions.files) {
      let content;
      try {
        content = readFileSync(join(root, file.path));
      } catch {
        missing.push(file.path);
        continue;
      }
      const hash = sha256(content);
      if (hash === file.sha256) continue;
      if (known.get(file.path)?.has(hash)) outdated.push(file.path);
      else modified.push(file.path);
    }
    const list = (paths) => paths.slice(0, 20);
    if (missing.length > 0) {
      add("instructions", "error", "INSTRUCTIONS_MISSING", `${missing.length} instruction file(s) of ${runtime.id} are missing`, {
        details: { paths: list(missing) },
        nextStep: "run init --workspace <worktree> --yes",
      });
    } else if (outdated.length > 0) {
      add("instructions", "warn", "INSTRUCTIONS_OUTDATED", `${outdated.length} instruction file(s) come from another runtime version`, {
        details: { paths: list(outdated) },
        nextStep: "run init (or update) with --yes to install the selected runtime's instructions",
      });
    } else if (modified.length > 0) {
      add("instructions", "warn", "INSTRUCTIONS_MODIFIED", `${modified.length} instruction file(s) differ from every shipped copy`, {
        details: { paths: list(modified), kept_local: list(Object.keys(kept)) },
      });
    } else {
      add("instructions", "ok", "OK", `instructions match ${runtime.id} (${manifest.instructions.files.length} files)`);
    }
  } else {
    add("instructions", "skipped", "RUNTIME_NOT_SELECTED", "no selected runtime to compare instructions with");
  }

  const configPath = join(root, CODEX_CONFIG);
  let configText = null;
  try {
    configText = readFileSync(configPath, "utf8");
  } catch {
    configText = null;
  }
  const configStatic = () => {
    if (configText === null) return add("codex_config", "error", "CODEX_CONFIG_MISSING", `${CODEX_CONFIG} does not exist`, { nextStep: "run init --workspace <worktree> --yes" });
    const found = findBlock(configText);
    if (found.kind === "malformed") return add("codex_config", "error", "CODEX_CONFIG_CONFLICT", "managed block markers are incomplete or repeated");
    if (found.kind === "none") {
      return definesBridge(configText)
        ? add("codex_config", "error", "CODEX_CONFIG_CONFLICT", `${CODEX_CONFIG} defines mcp_servers.bridge without the managed block`, { nextStep: "remove that definition, then run init" })
        : add("codex_config", "error", "CODEX_CONFIG_MISSING", `${CODEX_CONFIG} has no managed bridge block (${BLOCK_BEGIN})`, { nextStep: "run init --workspace <worktree> --yes" });
    }
    if (definesBridge(found.before + found.after)) return add("codex_config", "error", "CODEX_CONFIG_CONFLICT", "mcp_servers.bridge is also defined outside the managed block");
    const parsed = inspectCodexToml(configText, env);
    if (parsed.status === "invalid") return add("codex_config", "error", "CODEX_CONFIG_INVALID", `TOML does not parse: ${parsed.detail}`, { nextStep: `fix ${CODEX_CONFIG}` });
    if (manifest && found.block !== renderCodexBlock(manifest)) {
      return add("codex_config", "warn", "CODEX_CONFIG_MODIFIED", "the managed block differs from the selected runtime's block", { nextStep: "run init --yes to restore it, or keep the local change deliberately" });
    }
    const effective = parsed.status === "parsed" ? parsed.bridge : null;
    if (effective && manifest && (effective.command !== "node" || JSON.stringify(effective.args) !== JSON.stringify(mcpDefinition(manifest).args))) {
      return add("codex_config", "error", "CODEX_CONFIG_MISMATCH", "the effective mcp_servers.bridge table differs from the managed block");
    }
    return add("codex_config", "ok", "OK", `${CODEX_CONFIG} has the managed bridge block${parsed.status === "unverified" ? " (TOML not parsed: python3 3.11+ missing)" : ""}`);
  };
  configStatic();
  if (safeSubset) {
    add("codex_project", "skipped", "CODEX_PROJECT_UNCHECKED", "the safe subset does not start Codex against this project's configuration");
  } else if (codex.status === 0 && identity && manifest) codexProjectCheck(add, root, identity, manifest, env, codexProfile);
  else add("codex_project", "skipped", "CODEX_PROJECT_UNCHECKED", "Codex, the worktree identity or the selected runtime is unavailable");

  if (identity?.kind === "git") {
    const unignored = [".bridge/bridge.db", `${LOCAL_DIR}/install.json`].filter(
      (path) => run("git", ["-C", root, "check-ignore", "-q", "--no-index", path], { env }).status !== 0,
    );
    if (unignored.length === 0) add("git_ignore", "ok", "OK", ".bridge/ and .bridge-runtime/ are ignored by Git");
    else add("git_ignore", "error", "GIT_IGNORE_MISSING", `not ignored by Git: ${unignored.map((path) => path.split("/")[0]).join(", ")}`, { nextStep: "run init --yes, which adds the managed .gitignore block" });
  }

  if (controlPlane && identity) stateCheck(add, controlPlane, root, manifest?.compatibility.state_schema_version ?? null);
  else add("state", "skipped", "STATE_UNCHECKED", "the worktree identity could not be resolved");

  const filesystem = filesystemOf(root);
  if (!filesystem) add("filesystem", "unknown", "FILESYSTEM_UNKNOWN", "cannot read the mount table");
  else if (NETWORK_FILESYSTEMS.test(filesystem.fstype)) add("filesystem", "error", "FILESYSTEM_UNSUPPORTED", `${filesystem.fstype} at ${filesystem.mountPoint}: network and FUSE filesystems are unsupported for bridge state`, { nextStep: "use a worktree on a local filesystem" });
  else if (LOCAL_FILESYSTEMS.has(filesystem.fstype)) add("filesystem", "ok", "OK", `${filesystem.fstype} at ${filesystem.mountPoint}`);
  else add("filesystem", "unknown", "FILESYSTEM_UNKNOWN", `${filesystem.fstype} at ${filesystem.mountPoint} is not a known local filesystem`);

  if (existsSync(requested)) {
    const denied = [];
    const writable = (path) => {
      try {
        accessSync(path, constants.W_OK);
        return true;
      } catch {
        return false;
      }
    };
    if (!writable(existsSync(join(root, ".bridge")) ? join(root, ".bridge") : root)) denied.push(existsSync(join(root, ".bridge")) ? ".bridge/" : "worktree root");
    let lock = null;
    // The probe writes only into a real .bridge-runtime directory, never through a symlink.
    if (existsSync(paths.dir) && !redirectedComponent(root, `${LOCAL_DIR}/probe`)) {
      lock = lockProbe(paths.dir, env);
      if (!lock.ok && lock.error) denied.push(`${LOCAL_DIR}/ (${lock.error.code ?? lock.error.message})`);
    }
    if (runtime) {
      const namespace = run("python3", [join(runtime.path, ".agents/skills/feature-exchange/scripts/feature_exchange.py"), "namespace", "--repo", root], { env });
      if (namespace.status === 0) {
        let cursor = JSON.parse(namespace.stdout).namespace;
        while (!existsSync(cursor) && dirname(cursor) !== cursor) cursor = dirname(cursor);
        if (!writable(cursor)) denied.push(`exchange namespace (${cursor})`);
      }
    }
    if (denied.length > 0) {
      add("access", "error", sandboxed ? "SANDBOX_RESTRICTED" : "ACCESS_DENIED", `cannot write: ${denied.join(", ")}`, {
        nextStep: sandboxed ? "run doctor and the manager outside the restricting sandbox, or allow these paths" : "fix the permissions of these directories",
      });
    } else if (lock && !lock.ok) {
      add("access", "error", "STATE_LOCKING_UNSUPPORTED", `SQLite locking does not exclude a second process here: ${lock.detail}`, { nextStep: "use a local filesystem with working POSIX locks" });
    } else if (!lock) {
      add("access", "skipped", "ACCESS_PROBE_SKIPPED", `no ${LOCAL_DIR}/ to run the write and lock probe in`);
    } else {
      add("access", "ok", "OK", "worktree state, setup and exchange directories are writable; SQLite locking works");
    }
  }

  const use = findActiveUse(root, { env });
  if (!use.supported) add("active_use", "unknown", "ACTIVE_USE_UNKNOWN", `cannot tell whether the worktree is in use: ${use.reason}`);
  else if (use.entries.length > 0) {
    add("active_use", "warn", "ACTIVE_SESSION", `in use by ${use.entries.map((entry) => `pid ${entry.pid} (${entry.kinds.join("+")}: ${entry.command})`).join("; ")}`, {
      details: { entries: use.entries },
      nextStep: "update and rollback refuse while these run; close them normally first",
    });
  } else add("active_use", "ok", "OK", "no running bridge server, client or open state file for this worktree");

  logsCheck(add, root);

  const ready = runtime && identity && checks.find((check) => check.id === "runtime")?.status === "ok";
  if (safeSubset) {
    add("handshake", "skipped", "HANDSHAKE_SKIPPED", "the safe subset starts no MCP server");
  } else if (!doHandshake) {
    add("handshake", "skipped", "HANDSHAKE_SKIPPED", "handshake disabled with --no-handshake");
  } else if (!ready) {
    add("handshake", "skipped", "HANDSHAKE_NOT_POSSIBLE", "needs a resolved worktree and a complete selected runtime");
  } else {
    const result = await handshake(root, mcpDefinition(manifest), env);
    const featureTools = result.tools?.filter((name) => name.startsWith("bridge_feature_")).length ?? 0;
    if (!result.ok) {
      add("handshake", "error", "HANDSHAKE_FAILED", `MCP handshake failed: ${result.error}`, {
        details: { stderr_tail: result.stderr_tail },
        nextStep: "run the launcher from the managed block by hand in the worktree root and read its stderr",
      });
    } else if (result.serverInfo.data?.caller !== "codex" || result.serverInfo.data?.delegation !== "allow") {
      add("handshake", "error", "HANDSHAKE_IDENTITY_MISMATCH", "server did not bind caller=codex delegation=allow", { details: { server_info: result.serverInfo.data } });
    } else if (featureTools !== FEATURE_TOOLS) {
      add("handshake", "error", "HANDSHAKE_TOOLS_MISSING", `server exposes ${featureTools} feature tools, expected ${FEATURE_TOOLS}`, { details: { tools: result.tools } });
    } else {
      // Session identifiers stay out of the report; only the shape of the binding is shown.
      const status = result.managerStatus.data ?? {};
      add("handshake", "ok", "OK", `MCP server started, ${result.tools.length} tools, caller=codex delegation=allow; no manager claimed`, {
        details: {
          manager_status: result.managerStatus.isError
            ? { error: status.code ?? status.error ?? "unreadable" }
            : {
                bound: status.workspace?.bound ?? null,
                epoch: status.manager?.epoch ?? null,
                active_instance: status.manager?.active_instance ?? null,
                schema_version: status.schema_version ?? null,
              },
        },
      });
    }
  }

  const errors = checks.filter((check) => check.status === "error");
  const open = checks.filter((check) => check.status === "unknown" || check.status === "skipped");
  const status = errors.length > 0 ? "problems" : open.length > 0 ? "incomplete" : "ok";
  const first = errors[0] ?? open[0] ?? null;
  return {
    format: DOCTOR_FORMAT,
    generated_at: new Date().toISOString(),
    workspace: root,
    status,
    next_step: first ? first.next_step ?? `resolve ${first.code}` : null,
    checks,
  };
}

export function formatDoctor(report) {
  const lines = [`bridge doctor: ${report.workspace}`, `status: ${report.status}`];
  for (const check of report.checks) {
    lines.push(`  ${check.status.padEnd(7)} ${check.id.padEnd(14)} ${check.code === "OK" ? "" : `${check.code}  `}${check.summary}`);
    if (check.next_step && check.status !== "ok") lines.push(`  ${"".padEnd(7)} ${"".padEnd(14)} next: ${check.next_step}`);
  }
  if (report.next_step) lines.push(`next step: ${report.next_step}`);
  return `${lines.join("\n")}\n`;
}
