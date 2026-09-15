import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const cli = join(repoRoot, "scripts", "bridge.mjs");
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (path: string) => { exec(sql: string): void; close(): void };
};

/** Stand-in Codex CLI: version, login and the effective project MCP entry. Not a live Codex. */
const FAKE_CODEX = `#!/usr/bin/env python3
import json, os, sys, tomllib
args = sys.argv[1:]
while args and args[0] in ("--profile", "-c"):
    args = args[2:]
if args[:1] == ["--version"]:
    print("codex-cli " + os.environ.get("FAKE_CODEX_VERSION", "0.154.0"))
    sys.exit(0)
if args[:2] == ["login", "status"]:
    print("Logged in")
    sys.exit(0)
if args[:3] == ["mcp", "get", "bridge"]:
    server = None
    if not os.environ.get("FAKE_CODEX_HIDE_PROJECT"):
        try:
            with open(".codex/config.toml", "rb") as handle:
                server = (tomllib.load(handle).get("mcp_servers") or {}).get("bridge")
        except FileNotFoundError:
            pass
    if server is None:
        print("Error: No MCP server named 'bridge' found.", file=sys.stderr)
        sys.exit(1)
    print(json.dumps({"name": "bridge", "enabled": server.get("enabled", True),
        "transport": {"type": "stdio", "command": server.get("command"), "args": server.get("args"), "cwd": server.get("cwd")},
        "startup_timeout_sec": server.get("startup_timeout_sec"), "tool_timeout_sec": server.get("tool_timeout_sec")}))
    sys.exit(0)
print("fake codex: unsupported " + " ".join(sys.argv[1:]), file=sys.stderr)
sys.exit(2)
`;

const FAKE_CLAUDE = `#!/usr/bin/env python3
import json, sys
if sys.argv[1:2] == ["--version"]:
    print("2.1.272 (Claude Code)")
    sys.exit(0)
if sys.argv[1:3] == ["auth", "status"]:
    print(json.dumps({"loggedIn": True}))
    sys.exit(0)
sys.exit(2)
`;

const GIT_ENV = {
  GIT_AUTHOR_NAME: "setup-test",
  GIT_AUTHOR_EMAIL: "setup-test@example.invalid",
  GIT_COMMITTER_NAME: "setup-test",
  GIT_COMMITTER_EMAIL: "setup-test@example.invalid",
};

const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const sidecar = (rel: string) => rel.endsWith("-shm") || rel.endsWith("-wal");

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...GIT_ENV },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

/** Content, inode and mtime of every file: a rename-replace with equal bytes still shows up. */
function snapshot(root: string, skip: (rel: string) => boolean = () => false): Record<string, string> {
  const out: Record<string, string> = {};
  const visit = (directory: string, prefix: string) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (rel === ".git" || entry.name === "node_modules" || skip(rel)) continue;
      const absolute = join(directory, entry.name);
      if (entry.isSymbolicLink()) out[rel] = `link:${readlinkSync(absolute)}`;
      else if (entry.isDirectory()) visit(absolute, rel);
      else {
        const stat = statSync(absolute);
        out[rel] = `${sha(readFileSync(absolute))}:${stat.ino}:${stat.mtimeMs}`;
      }
    }
  };
  visit(root, "");
  return out;
}

let tmp = "";
let home = "";
let env: NodeJS.ProcessEnv = {};
let runtimeA = { id: "", path: "", commit: "" };
let runtimeB = { id: "", path: "", commit: "" };
let runtimeAUnchangedByB = false;

interface CliResult {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

function bridge(args: string[], extraEnv: NodeJS.ProcessEnv = {}, script = cli): CliResult {
  const result = spawnSync(process.execPath, [script, ...args, "--home", home], {
    encoding: "utf8",
    env: { ...env, ...extraEnv },
    timeout: 240_000,
  });
  return { status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr };
}

function bridgeJson(args: string[], extraEnv: NodeJS.ProcessEnv = {}, script = cli) {
  const result = bridge([...args, "--json"], extraEnv, script);
  try {
    return { ...result, json: JSON.parse(result.stdout) };
  } catch {
    throw new Error(`no JSON (exit ${result.status}): ${result.stdout}\n${result.stderr}`);
  }
}

function check(report: { checks: Array<{ id: string; status: string; code: string }> }, id: string) {
  const found = report.checks.find((entry) => entry.id === id);
  if (!found) throw new Error(`doctor has no ${id} check`);
  return found;
}

function makeProject(name: string, files: Record<string, string> = {}): string {
  const root = join(tmp, name);
  const defaults: Record<string, string> = {
    ".codex/config.toml": 'model_reasoning_effort = "high"\n\n[mcp_servers.other]\ncommand = "other-mcp"\nargs = ["--flag"]\n',
    ".gitignore": "node_modules/\n",
    "AGENTS.md": "# Project rules\n",
    "CLAUDE.md": "# Claude rules\n",
    ".agents/skills/my-skill/SKILL.md": "---\nname: my-skill\ndescription: the user's own skill\n---\n",
  };
  for (const [rel, content] of Object.entries({ ...defaults, ...files })) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "existing project");
  return root;
}

function addWorktree(project: string, name: string): string {
  const path = join(tmp, "herdr worktrees", "project", name);
  mkdirSync(dirname(path), { recursive: true });
  git(project, "worktree", "add", "-q", "-b", name.replace(/\s/gu, "-"), path);
  return path;
}

function init(workspace: string, runtimeId = runtimeA.id) {
  const result = bridgeJson(["init", "--workspace", workspace, "--runtime", runtimeId, "--yes"]);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.json.applied).toBe(true);
  return result;
}

class McpClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, (message: any) => void>();
  private buffer = "";
  private nextId = 1;
  readonly exited: Promise<number | null>;
  stderr = "";

  constructor(worktree: string) {
    this.child = spawn(
      process.execPath,
      [".bridge-runtime/current/scripts/native-bridge-mcp.mjs", "--caller", "codex", "--delegation", "allow", "--workspace", "."],
      { cwd: worktree, env, stdio: ["pipe", "pipe", "pipe"] },
    ) as ChildProcessWithoutNullStreams;
    this.exited = new Promise((done) => this.child.once("exit", done));
    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });
    this.child.stdout.on("data", (chunk) => {
      this.buffer += chunk;
      let newline;
      while ((newline = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        this.pending.get(message.id)?.(message);
        this.pending.delete(message.id);
      }
    });
  }

  get pid(): number {
    return this.child.pid!;
  }

  request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolveRequest, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout ${method}: ${this.stderr.slice(-800)}`)), 20_000);
      this.pending.set(id, (message) => {
        clearTimeout(timer);
        resolveRequest(message);
      });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  async initialize(): Promise<void> {
    await this.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "setup-test", version: "1" } });
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
  }

  async callTool(name: string, args: Record<string, unknown>, meta?: unknown) {
    const response = await this.request("tools/call", { name, arguments: args, ...(meta ? { _meta: meta } : {}) });
    return { isError: Boolean(response.result?.isError), data: JSON.parse(response.result.content[0].text) };
  }

  async close(): Promise<void> {
    this.child.stdin.end();
    await this.exited;
  }
}

/** Synthetic native envelope of a Codex tool call (a fixture, not a live Codex session). */
function nativeMeta(thread: string) {
  return { threadId: thread, "x-codex-turn-metadata": { session_id: thread, thread_id: thread, codex_version: "0.154.0" } };
}

async function createBoundState(worktree: string, thread: string): Promise<void> {
  const client = new McpClient(worktree);
  try {
    await client.initialize();
    const created = await client.callTool(
      "bridge_create_task",
      {
        spec: {
          objective: "setup test state",
          scope: { paths: ["docs/**"] },
          dependencies: [],
          expected_deliverable: "a durable root task",
          verification_criteria: ["the state exists"],
        },
      },
      nativeMeta(thread),
    );
    expect(created.isError, JSON.stringify(created.data)).toBe(false);
  } finally {
    await client.close();
  }
  expect(existsSync(join(worktree, ".bridge", "bridge.db"))).toBe(true);
}

describe("bridge setup CLI", () => {
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "bridge setup "));
    home = join(tmp, "bridge home");
    const fakeBin = join(tmp, "fake bin");
    mkdirSync(fakeBin);
    writeFileSync(join(fakeBin, "codex"), FAKE_CODEX, { mode: 0o755 });
    writeFileSync(join(fakeBin, "claude"), FAKE_CLAUDE, { mode: 0o755 });
    mkdirSync(join(tmp, "codex home"));
    env = {
      ...process.env,
      PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
      CODEX_HOME: join(tmp, "codex home"),
      npm_config_prefer_offline: "true",
    };
    for (const key of ["CODEX_SANDBOX", "CODEX_SANDBOX_NETWORK_DISABLED", "CLAUDE_CODEX_BRIDGE_HOME", "CLAUDE_CODEX_BRIDGE_TEST_CRASH_AFTER"]) {
      delete env[key];
    }

    // A bridge repository made from this checkout's current files, then cloned fresh (AC-01).
    const origin = join(tmp, "bridge origin");
    const listed = spawnSync("git", ["-C", repoRoot, "ls-files", "-co", "--exclude-standard", "-z"], { encoding: "utf8" });
    for (const rel of listed.stdout.split("\0").filter(Boolean)) {
      const source = join(repoRoot, rel);
      if (!existsSync(source) || !lstatSync(source).isFile()) continue;
      mkdirSync(dirname(join(origin, rel)), { recursive: true });
      copyFileSync(source, join(origin, rel));
      chmodSync(join(origin, rel), statSync(source).mode & 0o777);
    }
    git(origin, "init", "-q", "-b", "main");
    git(origin, "add", "-A");
    git(origin, "commit", "-qm", "synthetic runtime A");
    const commitA = git(origin, "rev-parse", "HEAD");
    appendFileSync(join(origin, ".agents/skills/feature-plan/SKILL.md"), "\nSynthetic change of runtime B.\n");
    git(origin, "commit", "-qam", "synthetic runtime B");
    const commitB = git(origin, "rev-parse", "HEAD");
    const clone = join(tmp, "fresh clone");
    git(tmp, "clone", "-q", "--no-local", origin, clone);

    const install = (commit: string) => {
      const result = bridgeJson(["install", "--source", clone, "--ref", commit]);
      if (result.status !== 0) throw new Error(`install failed: ${result.stdout}${result.stderr}`);
      return { id: result.json.runtime_id as string, path: result.json.path as string, commit, created: result.json.created as boolean };
    };
    const a = install(commitA);
    const beforeB = snapshot(a.path);
    const b = install(commitB);
    runtimeAUnchangedByB = JSON.stringify(snapshot(a.path)) === JSON.stringify(beforeB);
    runtimeA = a;
    runtimeB = b;
  }, 600_000);

  afterAll(() => {
    if (!tmp) return;
    spawnSync("chmod", ["-R", "u+w", tmp]);
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("installs immutable pinned runtimes beside each other from a fresh clone", () => {
    expect(runtimeA.id).not.toBe(runtimeB.id);
    expect(runtimeAUnchangedByB).toBe(true);
    for (const runtime of [runtimeA, runtimeB]) {
      const manifest = JSON.parse(readFileSync(join(runtime.path, "runtime-manifest.json"), "utf8"));
      expect(manifest).toMatchObject({
        format: "claude-codex-bridge.runtime/v1",
        runtime_id: runtime.id,
        install_format: "git-archive+npm-ci+build",
        source: { commit: runtime.commit },
        mcp: { launcher: "scripts/native-bridge-mcp.mjs", tool_timeout_sec: 5400 },
      });
      expect(Number.isInteger(manifest.compatibility.state_schema_version)).toBe(true);
      expect(manifest.compatibility.codex_identity_adapters).toContain("0.154.0");
      expect(manifest.instructions.files.map((file: { path: string }) => file.path)).toEqual(
        expect.arrayContaining([
          ".agents/skills/feature-execute/SKILL.md",
          ".codex/skills/using-bridge/SKILL.md",
          ".claude/skills/using-bridge/SKILL.md",
          "docs/features/README.md",
        ]),
      );
      expect(statSync(runtime.path).mode & 0o222).toBe(0);
      expect(statSync(join(runtime.path, "scripts", "native-bridge-mcp.mjs")).mode & 0o222).toBe(0);
    }
    const again = bridgeJson(["install", "--source", join(tmp, "fresh clone"), "--ref", runtimeA.commit]);
    expect(again.json).toMatchObject({ created: false, runtime_id: runtimeA.id });
    const missing = bridge(["install", "--source", join(tmp, "fresh clone"), "--ref", "no-such-ref"]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("INSTALL_SOURCE_INVALID");
    const listed = bridgeJson(["runtimes"]);
    expect(listed.json.runtimes.map((runtime: { id: string }) => runtime.id).sort()).toEqual([runtimeA.id, runtimeB.id].sort());
  });

  it("initializes an existing project, preserves user files, is idempotent and passes doctor", () => {
    const project = makeProject("existing project");
    const original = readFileSync(join(project, ".codex/config.toml"), "utf8");
    const before = snapshot(project);

    const dry = bridgeJson(["init", "--workspace", project, "--runtime", runtimeA.id]);
    expect(dry.status).toBe(0);
    expect(dry.json).toMatchObject({ ok: true, changed: true, applied: false });
    const changes = Object.fromEntries(dry.json.changes.map((change: { path: string; action: string }) => [change.path, change.action]));
    expect(changes).toMatchObject({
      ".agents/skills/feature-plan/SKILL.md": "create",
      ".codex/skills/using-bridge/SKILL.md": "create",
      ".claude/skills/using-bridge/SKILL.md": "create",
      "docs/features/README.md": "create",
      ".codex/config.toml": "append",
      ".gitignore": "append",
      ".bridge-runtime/current": "create",
    });
    const configChange = dry.json.changes.find((change: { path: string }) => change.path === ".codex/config.toml");
    expect(configChange.diff).toContain("+[mcp_servers.bridge]");
    expect(snapshot(project)).toEqual(before);

    init(project);
    const config = readFileSync(join(project, ".codex/config.toml"), "utf8");
    expect(config.startsWith(original)).toBe(true);
    expect(config).toContain('args = [".bridge-runtime/current/scripts/native-bridge-mcp.mjs", "--caller", "codex", "--delegation", "allow", "--workspace", "."]');
    expect(config).not.toContain(tmp);
    for (const rel of ["AGENTS.md", "CLAUDE.md", ".agents/skills/my-skill/SKILL.md"]) {
      expect(snapshot(project)[rel]).toBe(before[rel]);
    }
    expect(readlinkSync(join(project, ".bridge-runtime/current"))).toBe(runtimeA.path);
    for (const path of [".bridge/bridge.db", ".bridge-runtime/install.json"]) {
      expect(spawnSync("git", ["-C", project, "check-ignore", "-q", path]).status).toBe(0);
    }
    const record = JSON.parse(readFileSync(join(project, ".bridge-runtime/install.json"), "utf8"));
    expect(record).toMatchObject({ format: "claude-codex-bridge.workspace-install/v1", runtime: { id: runtimeA.id } });

    const applied = snapshot(project);
    const again = bridgeJson(["init", "--workspace", project, "--yes"]);
    expect(again.status).toBe(0);
    expect(again.json).toMatchObject({ ok: true, changed: false, applied: false, changes: [] });
    expect(snapshot(project)).toEqual(applied);

    const doctor = bridgeJson(["doctor", "--workspace", project]);
    expect(doctor.json.format).toBe("claude-codex-bridge.doctor/v1");
    const notOk = doctor.json.checks.filter((entry: { id: string; status: string }) => entry.status !== "ok" && entry.id !== "filesystem");
    expect(notOk).toEqual([]);
    expect(check(doctor.json, "handshake").status).toBe("ok");
    if (check(doctor.json, "filesystem").status === "ok") {
      expect(doctor.json.status).toBe("ok");
      expect(doctor.status).toBe(0);
    }
    const text = bridge(["doctor", "--workspace", project]);
    expect(text.stdout).toContain("handshake");
    expect(snapshot(project)).toEqual(applied);
    expect(existsSync(join(project, ".bridge"))).toBe(false);
  });

  it("reports conflicts, keeps local modifications only on request and refuses copies", () => {
    const modified = makeProject("modified project", { ".agents/skills/feature-plan/SKILL.md": "local plan skill\n" });
    const before = snapshot(modified);
    const refused = bridgeJson(["init", "--workspace", modified, "--runtime", runtimeA.id, "--yes"]);
    expect(refused.status).toBe(1);
    expect(refused.json).toMatchObject({ ok: false, applied: false });
    expect(refused.json.conflicts).toEqual([
      expect.objectContaining({ code: "INSTRUCTION_MODIFIED", path: ".agents/skills/feature-plan/SKILL.md" }),
    ]);
    expect(snapshot(modified)).toEqual(before);

    const kept = bridgeJson(["init", "--workspace", modified, "--runtime", runtimeA.id, "--yes", "--keep-local"]);
    expect(kept.json).toMatchObject({ ok: true, applied: true });
    expect(readFileSync(join(modified, ".agents/skills/feature-plan/SKILL.md"), "utf8")).toBe("local plan skill\n");
    const record = JSON.parse(readFileSync(join(modified, ".bridge-runtime/install.json"), "utf8"));
    expect(Object.keys(record.managed.kept_local)).toEqual([".agents/skills/feature-plan/SKILL.md"]);
    expect(check(bridgeJson(["doctor", "--workspace", modified, "--no-handshake"]).json, "instructions").code).toBe("INSTRUCTIONS_MODIFIED");

    for (const [name, config] of [
      ["foreign table", '[mcp_servers.bridge]\ncommand = "claude-codex-bridge"\n'],
      ["inline table", 'mcp_servers = { other = { command = "x" } }\n'],
    ]) {
      const foreign = makeProject(name, { ".codex/config.toml": config });
      const snap = snapshot(foreign);
      const result = bridgeJson(["init", "--workspace", foreign, "--runtime", runtimeA.id, "--yes"]);
      expect(result.status).toBe(1);
      expect(result.json.conflicts.map((conflict: { code: string }) => conflict.code)).toContain("CODEX_CONFIG_CONFLICT");
      expect(snapshot(foreign)).toEqual(snap);
    }

    const copy = makeProject("copied setup");
    mkdirSync(join(copy, ".bridge-runtime"));
    copyFileSync(join(modified, ".bridge-runtime/install.json"), join(copy, ".bridge-runtime/install.json"));
    const copied = bridgeJson(["init", "--workspace", copy, "--runtime", runtimeA.id, "--yes"]);
    expect(copied.json.refusals.map((refusal: { code: string }) => refusal.code)).toEqual(["SETUP_RECORD_FOREIGN"]);
    expect(check(bridgeJson(["doctor", "--workspace", copy, "--no-handshake"], {}, join(runtimeA.path, "scripts", "bridge.mjs")).json, "setup").code).toBe("SETUP_RECORD_FOREIGN");
  });

  it("refuses init, update and rollback through symlinks and leaves external directories unchanged", () => {
    // W12-R1: an ordinary directory symlink must not let init write into a shared directory.
    const shared = join(tmp, "shared agents");
    mkdirSync(join(shared, "skills", "shared-skill"), { recursive: true });
    writeFileSync(join(shared, "skills", "shared-skill", "SKILL.md"), "shared with other worktrees\n");
    const linked = makeProject("linked agents project");
    rmSync(join(linked, ".agents"), { recursive: true });
    symlinkSync(shared, join(linked, ".agents"));
    const sharedBefore = snapshot(shared);
    const linkedBefore = snapshot(linked);
    const initRefused = bridgeJson(["init", "--workspace", linked, "--runtime", runtimeA.id, "--yes"]);
    expect(initRefused.status).toBe(1);
    expect(initRefused.json).toMatchObject({ ok: false, applied: false, changes: [] });
    expect(initRefused.json.refusals).toEqual([expect.objectContaining({ code: "PATH_REDIRECTED" })]);
    expect(initRefused.json.refusals[0].message).toContain(".agents is a symlink");
    expect(snapshot(shared)).toEqual(sharedBefore);
    expect(snapshot(linked)).toEqual(linkedBefore);
    expect(existsSync(join(linked, ".bridge-runtime"))).toBe(false);

    // Local setup state: a symlinked backup directory would receive copies of user files.
    const backups = join(tmp, "outside backups");
    mkdirSync(backups);
    const backupProject = makeProject("linked backup project");
    mkdirSync(join(backupProject, ".bridge-runtime"));
    symlinkSync(backups, join(backupProject, ".bridge-runtime", "backup"));
    const backupsBefore = snapshot(backups);
    const backupRefused = bridgeJson(["init", "--workspace", backupProject, "--runtime", runtimeA.id, "--yes"]);
    expect(backupRefused.json.refusals.map((refusal: { code: string }) => refusal.code)).toEqual(["PATH_REDIRECTED"]);
    expect(snapshot(backups)).toEqual(backupsBefore);
    expect(readFileSync(join(backupProject, ".codex/config.toml"), "utf8")).not.toContain("mcp_servers.bridge");

    // update: an instruction directory shared through a symlink after init.
    const updated = makeProject("linked update project");
    init(updated);
    const sharedPlan = join(tmp, "shared feature-plan");
    cpSync(join(updated, ".agents/skills/feature-plan"), sharedPlan, { recursive: true });
    rmSync(join(updated, ".agents/skills/feature-plan"), { recursive: true });
    symlinkSync(sharedPlan, join(updated, ".agents/skills/feature-plan"));
    const planBefore = snapshot(sharedPlan);
    const updateRefused = bridgeJson(["update", "--workspace", updated, "--runtime", runtimeB.id, "--yes"]);
    expect(updateRefused.status).toBe(1);
    expect(updateRefused.json.refusals.map((refusal: { code: string }) => refusal.code)).toEqual(["PATH_REDIRECTED"]);
    expect(snapshot(sharedPlan)).toEqual(planBefore);
    expect(readlinkSync(join(updated, ".bridge-runtime/current"))).toBe(runtimeA.path);

    // rollback: the setup record itself redirected outside the worktree.
    const rolled = makeProject("linked rollback project");
    init(rolled);
    expect(bridgeJson(["update", "--workspace", rolled, "--runtime", runtimeB.id, "--yes"]).json.applied).toBe(true);
    const records = join(tmp, "outside record");
    mkdirSync(records);
    copyFileSync(join(rolled, ".bridge-runtime/install.json"), join(records, "install.json"));
    rmSync(join(rolled, ".bridge-runtime/install.json"));
    symlinkSync(join(records, "install.json"), join(rolled, ".bridge-runtime/install.json"));
    const recordsBefore = snapshot(records);
    const rollbackRefused = bridgeJson(["rollback", "--workspace", rolled, "--yes"]);
    expect(rollbackRefused.status).toBe(1);
    expect(rollbackRefused.json.refusals.map((refusal: { code: string }) => refusal.code)).toEqual(["PATH_REDIRECTED"]);
    expect(snapshot(records)).toEqual(recordsBefore);
    expect(readlinkSync(join(rolled, ".bridge-runtime/current"))).toBe(runtimeB.path);

    // doctor: a symlinked setup directory is reported and its lock probe does not run there.
    const probes = join(tmp, "outside setup");
    mkdirSync(probes);
    const doctored = makeProject("linked setup project");
    symlinkSync(probes, join(doctored, ".bridge-runtime"));
    const probesBefore = snapshot(probes);
    const report = bridgeJson(["doctor", "--workspace", doctored, "--no-handshake"]).json;
    expect(check(report, "setup").code).toBe("PATH_REDIRECTED");
    expect(check(report, "access").status).not.toBe("ok");
    expect(snapshot(probes)).toEqual(probesBefore);
  });

  it("completes an interrupted apply on the next run without deleting user files", () => {
    const project = makeProject("interrupted project");
    const agents = readFileSync(join(project, "AGENTS.md"));
    const crashed = bridge(["init", "--workspace", project, "--runtime", runtimeA.id, "--yes"], {
      CLAUDE_CODEX_BRIDGE_TEST_CRASH_AFTER: "3",
    });
    expect(crashed.signal).toBe("SIGKILL");
    expect(existsSync(join(project, ".bridge-runtime/pending.json"))).toBe(true);
    const doctor = bridgeJson(["doctor", "--workspace", project, "--no-handshake"], {}, join(runtimeA.path, "scripts", "bridge.mjs"));
    expect(check(doctor.json, "setup").code).toBe("SETUP_INTERRUPTED");
    expect(doctor.json.status).toBe("problems");

    const resumed = bridgeJson(["init", "--workspace", project, "--runtime", runtimeA.id, "--yes"]);
    expect(resumed.json).toMatchObject({ ok: true, applied: true });
    expect(existsSync(join(project, ".bridge-runtime/pending.json"))).toBe(false);
    expect(existsSync(join(project, ".bridge-runtime/backup"))).toBe(false);
    expect(Object.keys(snapshot(project)).filter((rel) => rel.includes(".bridge-tmp-"))).toEqual([]);
    expect(readFileSync(join(project, "AGENTS.md"))).toEqual(agents);
    expect(readFileSync(join(project, ".codex/config.toml"), "utf8")).toContain("[mcp_servers.other]");
    expect(check(bridgeJson(["doctor", "--workspace", project, "--no-handshake"]).json, "setup").status).toBe("ok");
  });

  it("keeps two external worktrees independent through init and update", async () => {
    const project = makeProject("worktree project");
    const a = addWorktree(project, "wt a");
    const b = addWorktree(project, "wt b");
    init(a);
    init(b);
    await createBoundState(a, "thread-worktree-a");
    await createBoundState(b, "thread-worktree-b");
    const beforeB = snapshot(b, sidecar);

    const planned = bridgeJson(["update", "--workspace", a, "--runtime", runtimeB.id]);
    expect(planned.json).toMatchObject({ ok: true, changed: true, applied: false });
    expect(planned.json.changes.find((change: { path: string }) => change.path === ".agents/skills/feature-plan/SKILL.md").diff)
      .toContain("+Synthetic change of runtime B.");
    const updated = bridgeJson(["update", "--workspace", a, "--runtime", runtimeB.id, "--yes"]);
    expect(updated.json).toMatchObject({ ok: true, applied: true });

    expect(snapshot(b, sidecar)).toEqual(beforeB);
    expect(readlinkSync(join(a, ".bridge-runtime/current"))).toBe(runtimeB.path);
    expect(readlinkSync(join(b, ".bridge-runtime/current"))).toBe(runtimeA.path);
    expect(readFileSync(join(a, ".agents/skills/feature-plan/SKILL.md"), "utf8")).toContain("Synthetic change of runtime B.");
    expect(readFileSync(join(b, ".agents/skills/feature-plan/SKILL.md"), "utf8")).not.toContain("Synthetic change of runtime B.");
    const namespace = (worktree: string) =>
      JSON.parse(spawnSync("python3", [join(worktree, ".agents/skills/feature-exchange/scripts/feature_exchange.py"), "namespace", "--repo", worktree], { encoding: "utf8" }).stdout).workspace_key;
    expect(namespace(a)).not.toBe(namespace(b));
    for (const worktree of [a, b]) {
      const state = snapshot(join(worktree, ".bridge"), sidecar);
      const report = bridgeJson(["doctor", "--workspace", worktree]).json;
      expect(report.checks.filter((entry: { status: string }) => entry.status === "error")).toEqual([]);
      expect(check(report, "state").summary).toContain("bound to this worktree");
      expect(check(report, "handshake").details.manager_status).toMatchObject({ bound: true, epoch: 1 });
      // The handshake reads a bound worktree without claiming, detaching or migrating anything.
      expect(snapshot(join(worktree, ".bridge"), sidecar)).toEqual(state);
    }
  });

  it("refuses to switch a worktree that is in use and proceeds after a normal close", async () => {
    const project = makeProject("busy project");
    init(project);
    const server = new McpClient(project);
    try {
      await server.initialize();
      const refused = bridgeJson(["update", "--workspace", project, "--runtime", runtimeB.id, "--yes"]);
      expect(refused.status).toBe(1);
      expect(refused.json.refusals).toEqual([expect.objectContaining({ code: "ACTIVE_SESSION" })]);
      expect(refused.json.refusals[0].message).toContain(`pid ${server.pid}`);
      expect(readlinkSync(join(project, ".bridge-runtime/current"))).toBe(runtimeA.path);
      const doctor = bridgeJson(["doctor", "--workspace", project, "--no-handshake"]);
      expect(check(doctor.json, "active_use").code).toBe("ACTIVE_SESSION");
    } finally {
      await server.close();
    }
    const updated = bridgeJson(["update", "--workspace", project, "--runtime", runtimeB.id, "--yes"]);
    expect(updated.json).toMatchObject({ ok: true, applied: true });
  });

  it("rolls back a compatible update without touching state and refuses an incompatible one", async () => {
    const project = makeProject("rollback project");
    init(project);
    await createBoundState(project, "thread-rollback");
    const state = snapshot(join(project, ".bridge"), sidecar);
    const planA = readFileSync(join(runtimeA.path, ".agents/skills/feature-plan/SKILL.md"));

    expect(bridgeJson(["update", "--workspace", project, "--runtime", runtimeB.id, "--yes"]).json.applied).toBe(true);
    const rolledBack = bridgeJson(["rollback", "--workspace", project, "--yes"]);
    expect(rolledBack.json).toMatchObject({ ok: true, applied: true, runtime: { from: runtimeB.id, to: runtimeA.id } });
    expect(readlinkSync(join(project, ".bridge-runtime/current"))).toBe(runtimeA.path);
    expect(readFileSync(join(project, ".agents/skills/feature-plan/SKILL.md"))).toEqual(planA);
    const record = JSON.parse(readFileSync(join(project, ".bridge-runtime/install.json"), "utf8"));
    expect(record.history.map((entry: { action: string; runtime_id: string }) => [entry.action, entry.runtime_id])).toEqual([
      ["init", runtimeA.id],
      ["update", runtimeB.id],
      ["rollback", runtimeA.id],
    ]);
    expect(snapshot(join(project, ".bridge"), sidecar)).toEqual(state);

    // A newer runtime migrated the database: no runtime that supports only the older schema may take over.
    const db = new DatabaseSync(join(project, ".bridge", "bridge.db"));
    db.exec("UPDATE schema_meta SET value = '99' WHERE key = 'schema_version'");
    db.close();
    const migrated = snapshot(project, sidecar);
    for (const args of [
      ["update", "--workspace", project, "--runtime", runtimeB.id, "--yes"],
      ["rollback", "--workspace", project, "--yes"],
    ]) {
      const refused = bridgeJson(args);
      expect(refused.status).toBe(1);
      expect(refused.json.refusals.map((refusal: { code: string }) => refusal.code)).toContain("STATE_SCHEMA_NEWER");
    }
    expect(snapshot(project, sidecar)).toEqual(migrated);
    expect(check(bridgeJson(["doctor", "--workspace", project, "--no-handshake"]).json, "state").code).toBe("STATE_SCHEMA_NEWER");
  });

  it("diagnoses missing runtimes, unsupported hosts, trust, foreign state and access problems", () => {
    const notInstalled = bridge(["init", "--workspace", tmp, "--runtime", "9.9.9-000000000000"]);
    expect(notInstalled.status).toBe(1);
    expect(notInstalled.stderr).toContain("RUNTIME_NOT_INSTALLED");

    const incompleteId = `${runtimeA.id.split("-")[0]}-0000000000ab`;
    const incomplete = join(home, "runtimes", incompleteId);
    mkdirSync(incomplete);
    const manifest = JSON.parse(readFileSync(join(runtimeA.path, "runtime-manifest.json"), "utf8"));
    writeFileSync(join(incomplete, "runtime-manifest.json"), JSON.stringify({ ...manifest, runtime_id: incompleteId }));

    const project = makeProject("diagnosed project");
    init(project);
    try {
      const plan = bridgeJson(["update", "--workspace", project, "--runtime", incompleteId, "--yes"]);
      expect(plan.json.refusals.map((refusal: { code: string }) => refusal.code)).toContain("RUNTIME_INCOMPLETE");
    } finally {
      rmSync(incomplete, { recursive: true, force: true });
    }

    const unsupported = { FAKE_CODEX_VERSION: "0.155.0" };
    expect(check(bridgeJson(["doctor", "--workspace", project, "--no-handshake"], unsupported).json, "codex").code).toBe("CODEX_VERSION_UNSUPPORTED");
    const hostRefused = bridgeJson(["update", "--workspace", project, "--runtime", runtimeB.id, "--yes"], unsupported);
    expect(hostRefused.json.refusals.map((refusal: { code: string }) => refusal.code)).toContain("CODEX_VERSION_UNSUPPORTED");

    const hidden = { FAKE_CODEX_HIDE_PROJECT: "1" };
    expect(check(bridgeJson(["doctor", "--workspace", project, "--no-handshake"], hidden).json, "codex_project").code).toBe("CODEX_PROJECT_UNTRUSTED");
    writeFileSync(join(tmp, "codex home", "config.toml"), `[projects."${project}"]\ntrust_level = "trusted"\n`);
    try {
      expect(check(bridgeJson(["doctor", "--workspace", project, "--no-handshake"], hidden).json, "codex_project").code).toBe("CODEX_CONFIG_NOT_LOADED");
    } finally {
      rmSync(join(tmp, "codex home", "config.toml"));
    }

    const selection = join(project, ".bridge-runtime/current");
    rmSync(selection);
    symlinkSync(join(home, "runtimes", `${runtimeA.id.split("-")[0]}-0000000000cd`), selection);
    expect(check(bridgeJson(["doctor", "--workspace", project, "--no-handshake"]).json, "setup").code).toBe("RUNTIME_SELECTION_BROKEN");
    const repaired = bridgeJson(["init", "--workspace", project, "--runtime", runtimeA.id, "--yes"]);
    expect(repaired.json).toMatchObject({ ok: true, applied: true });

    mkdirSync(join(project, ".bridge"));
    writeFileSync(
      join(project, ".bridge", "workspace.json"),
      JSON.stringify({
        schema_version: 1,
        workspace_id: "ws_other",
        kind: "git",
        root: join(tmp, "another worktree"),
        git_dir: join(tmp, "another worktree", ".git"),
        git_common_dir: join(tmp, "another worktree", ".git"),
        database: join(project, ".bridge", "bridge.db"),
        state: "bound",
        reservation_nonce: "0123456789abcdef",
        created_at: new Date().toISOString(),
      }),
    );
    const foreign = bridgeJson(["doctor", "--workspace", project, "--no-handshake"]);
    expect(check(foreign.json, "state").code).toBe("STATE_OWNED_ELSEWHERE");
    rmSync(join(project, ".bridge"), { recursive: true });

    const plain = makeProject("plain project");
    const uninitialized = bridgeJson(["doctor", "--workspace", plain], {}, join(runtimeA.path, "scripts", "bridge.mjs"));
    expect(uninitialized.status).toBe(1);
    expect(check(uninitialized.json, "workspace").status).toBe("ok");
    expect(check(uninitialized.json, "setup").code).toBe("SETUP_NOT_INITIALIZED");
    expect(check(uninitialized.json, "codex_config").code).toBe("CODEX_CONFIG_MISSING");
    expect(check(uninitialized.json, "handshake").code).toBe("HANDSHAKE_NOT_POSSIBLE");
    expect(existsSync(join(plain, ".bridge-runtime"))).toBe(false);
    const subdirectory = bridgeJson(["doctor", "--workspace", join(project, ".codex")]);
    expect(check(subdirectory.json, "workspace").code).toBe("WORKSPACE_NOT_ROOT");

    if (process.getuid?.() !== 0) {
      chmodSync(join(project, ".bridge-runtime"), 0o500);
      try {
        expect(check(bridgeJson(["doctor", "--workspace", project, "--no-handshake"]).json, "access").code).toBe("ACCESS_DENIED");
        const sandboxed = bridgeJson(["doctor", "--workspace", project, "--no-handshake"], { CODEX_SANDBOX: "seccomp" }).json;
        expect(check(sandboxed, "access").code).toBe("SANDBOX_RESTRICTED");
        expect(check(sandboxed, "active_use").code).toBe("ACTIVE_USE_UNKNOWN");
      } finally {
        chmodSync(join(project, ".bridge-runtime"), 0o700);
      }
    }
  });
});
