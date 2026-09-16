import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const launcher = join(repoRoot, "scripts", "native-bridge-mcp.mjs");

interface JsonRpcMessage {
  readonly jsonrpc?: string;
  readonly id?: number;
  readonly result?: unknown;
  readonly error?: unknown;
}

class NativeHarness {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<
    number,
    { readonly resolve: (message: JsonRpcMessage) => void; readonly reject: (error: Error) => void }
  >();
  private nextId = 1;
  private buffer = "";
  readonly stdoutLines: string[] = [];
  readonly stderr: string[] = [];
  readonly exited: Promise<number | null>;

  constructor(
    caller: "codex" | "claude",
    policy: "allow" | "deny",
    workspace?: string,
    db?: string,
    cwd = repoRoot,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    const args = [launcher, "--caller", caller, "--delegation", policy];
    if (workspace !== undefined) args.push("--workspace", workspace);
    if (db !== undefined) args.push("--db", db);
    this.child = spawn(
      process.execPath,
      args,
      { cwd, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    ) as ChildProcessWithoutNullStreams;
    this.exited = new Promise((done) => this.child.once("exit", done));
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => this.stderr.push(chunk));
    this.child.once("exit", (code) => {
      const error = new Error(`native launcher exited with ${code ?? "null"}`);
      for (const waiter of this.pending.values()) waiter.reject(error);
      this.pending.clear();
    });
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      this.stdoutLines.push(line);
      let message: JsonRpcMessage;
      try {
        message = JSON.parse(line) as JsonRpcMessage;
      } catch {
        continue;
      }
      if (message.id === undefined) continue;
      const waiter = this.pending.get(message.id);
      if (waiter) {
        this.pending.delete(message.id);
        waiter.resolve(message);
      }
    }
  }

  request(method: string, params: unknown = {}): Promise<JsonRpcMessage> {
    const id = this.nextId++;
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectRequest(new Error(`timeout waiting for ${method}: ${this.stderr.join("").slice(-1000)}`));
      }, 15_000);
      this.pending.set(id, {
        resolve: (message) => {
          clearTimeout(timer);
          resolveRequest(message);
        },
        reject: (error) => {
          clearTimeout(timer);
          rejectRequest(error);
        },
      });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  notify(method: string, params: unknown = {}): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async initialize(): Promise<void> {
    const response = await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "native-launcher-test", version: "1.0.0" },
    });
    expect(response.error).toBeUndefined();
    this.notify("notifications/initialized");
  }

  async callTool(name: string, args: Record<string, unknown> = {}, meta?: unknown) {
    const response = await this.request("tools/call", {
      name,
      arguments: args,
      ...(meta !== undefined ? { _meta: meta } : {}),
    });
    const result = response.result as {
      readonly isError?: boolean;
      readonly content: ReadonlyArray<{ readonly text: string }>;
    };
    return {
      isError: result.isError ?? false,
      data: JSON.parse(result.content[0]!.text) as Record<string, any>,
    };
  }

  /** Close the way a client that ends its session does: SIGTERM, the path that detaches. */
  async terminate(): Promise<number | null> {
    this.child.kill("SIGTERM");
    const timeout = Symbol("timeout");
    const result = await Promise.race([
      this.exited,
      new Promise<typeof timeout>((resolveTimeout) => setTimeout(() => resolveTimeout(timeout), 5_000)),
    ]);
    if (result !== timeout) return result;
    this.child.kill("SIGKILL");
    return this.exited;
  }

  async shutdown(): Promise<number | null> {
    if (!this.child.stdin.destroyed) this.child.stdin.end();
    const timeout = Symbol("timeout");
    const result = await Promise.race([
      this.exited,
      new Promise<typeof timeout>((resolveTimeout) => setTimeout(() => resolveTimeout(timeout), 5_000)),
    ]);
    if (result !== timeout) return result;
    this.child.kill("SIGTERM");
    const terminated = await Promise.race([
      this.exited,
      new Promise<typeof timeout>((resolveTimeout) => setTimeout(() => resolveTimeout(timeout), 5_000)),
    ]);
    if (terminated !== timeout) return terminated;
    this.child.kill("SIGKILL");
    return this.exited;
  }
}

function recursiveFileHashes(root: string): Array<{ readonly path: string; readonly sha256: string }> {
  const files: string[] = [];
  const visit = (directory: string, prefix = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute, relative);
      else if (entry.isFile()) files.push(relative);
      else throw new Error(`unexpected non-file skill entry: ${relative}`);
    }
  };
  visit(root);
  return files.sort().map((path) => ({
    path,
    sha256: createHash("sha256").update(readFileSync(join(root, ...path.split("/")))).digest("hex"),
  }));
}

/** Every diagnostics record of a worktree, in file and line order. */
function logRecords(workspace: string): Array<Record<string, any>> {
  const directory = join(workspace, ".bridge", "logs");
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .flatMap((name) =>
      readFileSync(join(directory, name), "utf8")
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, any>),
    );
}

/**
 * Content hash of the worktree state directory.
 *
 * SQLite's own `-wal`/`-shm` sidecars are excluded: a read-only open of a WAL database creates
 * them and the isolation protocol already classifies them as technical files, not state
 * (docs/manager-identity.md). Everything else — the database, the marker, the owner record,
 * evidence and every log file — must be byte-identical after a refused foreign call.
 */
function stateFingerprint(workspace: string): Record<string, string> {
  const root = join(workspace, ".bridge");
  const out: Record<string, string> = {};
  const visit = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        visit(join(directory, entry.name), relative);
        continue;
      }
      if (/-(wal|shm|journal)$/u.test(entry.name)) continue;
      out[relative] = createHash("sha256").update(readFileSync(join(directory, entry.name))).digest("hex");
    }
  };
  if (existsSync(root)) visit(root, "");
  return out;
}

function taskSpec() {
  return {
    objective: "prove shared native MCP state",
    scope: { paths: ["BENCHMARK/native-mcp/**"] },
    dependencies: [],
    expected_deliverable: "a durable root task",
    verification_criteria: ["the other stdio process can read it"],
  };
}

/**
 * Synthetic stand-in for the per-request metadata a Codex host attaches to a tool call
 * (`params._meta`). It is a fixture envelope, not a live Codex session.
 */
function nativeMeta(threadId: string, version = "0.154.0"): Record<string, unknown> {
  return {
    threadId,
    "x-codex-turn-metadata": {
      session_id: threadId,
      thread_id: threadId,
      codex_version: version,
    },
  };
}

describe("native project MCP launcher", () => {
  it("strictly parses startup-bound identity and delegation policy", async () => {
    const module = await import("../../../scripts/native-bridge-mcp.mjs");
    const suppliedCwd = resolve(repoRoot, "external-default-workspace-fixture");
    expect(module.parseNativeBridgeArgs(
      ["--caller", "codex", "--delegation", "allow"],
      suppliedCwd,
    )).toMatchObject({
      caller: "codex",
      delegation: "allow",
      workspace: suppliedCwd,
      databasePath: join(suppliedCwd, ".bridge", "bridge.db"),
    });
    expect(module.parseNativeBridgeArgs(
      ["--caller", "codex", "--delegation", "allow", "--workspace", "managed", "--db", "state/custom.db"],
      suppliedCwd,
    )).toMatchObject({
      workspace: join(suppliedCwd, "managed"),
      databasePath: join(suppliedCwd, "managed", "state", "custom.db"),
    });
    expect(() => module.parseNativeBridgeArgs(["--caller", "claude"]))
      .toThrow("--delegation must be allow or deny");
    expect(() => module.parseNativeBridgeArgs(["--caller", "supervisor", "--delegation", "allow"]))
      .toThrow("--caller must be codex or claude");
  });

  it("exposes a portable linked command with a Unix shebang", () => {
    const rootPackage = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      readonly private?: boolean;
      readonly bin?: Record<string, string>;
    };
    expect(rootPackage.private).toBe(true);
    expect(rootPackage.bin).toEqual({
      "claude-codex-bridge": "./scripts/native-bridge-mcp.mjs",
    });
    expect(readFileSync(launcher, "utf8").split(/\r?\n/u)[0]).toBe("#!/usr/bin/env node");
    if (process.platform !== "win32") expect(statSync(launcher).mode & 0o111).not.toBe(0);
  });

  it("runs when npm-style linking reaches the launcher through a symlinked checkout", () => {
    const temp = mkdtempSync(join(tmpdir(), "bridge-linked-launcher-"));
    const linkedRoot = join(temp, "bidirectional-bridge");
    try {
      symlinkSync(repoRoot, linkedRoot, process.platform === "win32" ? "junction" : "dir");
      const result = spawnSync(
        process.execPath,
        [join(linkedRoot, "scripts", "native-bridge-mcp.mjs"), "--help"],
        { cwd: temp, encoding: "utf8", windowsHide: true },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toContain("default: current working directory");
    } finally {
      rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it("uses portable project configurations that select the worktree's pinned runtime", async () => {
    const setup = await import("../../../scripts/setup/workspace.mjs");
    const codexText = readFileSync(join(repoRoot, ".codex", "config.toml"), "utf8");
    // The repository's own Codex configuration is exactly the block `scripts/bridge.mjs init` writes,
    // so a bridge worktree never starts the build it is editing.
    expect(codexText).toBe(setup.renderCodexBlock(null));
    const claudePath = join(repoRoot, ".mcp.json");
    expect(existsSync(claudePath), ".mcp.json must be produced by the delegated Claude task").toBe(true);
    const claudeText = readFileSync(claudePath, "utf8");
    const claudeConfig = JSON.parse(claudeText) as {
      readonly mcpServers?: Record<string, { readonly command?: string; readonly args?: readonly string[] }>;
    };

    expect(codexText).toContain("[mcp_servers.bridge]");
    expect(codexText).toMatch(/command\s*=\s*"node"/u);
    const codexArgsMatch = codexText.match(/args\s*=\s*\[([^\]]+)\]/u);
    expect(codexArgsMatch).not.toBeNull();
    const codexArgs = JSON.parse(`[${codexArgsMatch![1]}]`) as string[];
    const claudeEntry = claudeConfig.mcpServers?.["bridge"];
    expect(claudeEntry?.command).toBe("node");
    expect(claudeEntry?.args?.[0]).toBe("${CLAUDE_PROJECT_DIR:-.}/.bridge-runtime/current/scripts/native-bridge-mcp.mjs");
    expect(codexArgs).toEqual([
      ".bridge-runtime/current/scripts/native-bridge-mcp.mjs",
      "--caller",
      "codex",
      "--delegation",
      "allow",
      "--workspace",
      ".",
    ]);
    expect(claudeEntry?.args).toEqual(
      expect.arrayContaining(["--caller", "claude", "--delegation", "allow"]),
    );

    const combined = `${codexText}\n${claudeText}`;
    expect(combined).not.toMatch(/[A-Za-z]:[\\/]/u);
    expect(combined).not.toMatch(/api[_-]?key|credential|password|secret|token/iu);

    const externalCodex = readFileSync(
      join(repoRoot, "codex", "codex-side", "examples", "codex-project-config.toml"),
      "utf8",
    );
    const externalClaudePath = join(
      repoRoot,
      "claude",
      "claude-side",
      "examples",
      "claude-project-mcp.json",
    );
    expect(existsSync(externalClaudePath)).toBe(true);
    const externalClaude = readFileSync(externalClaudePath, "utf8");
    const externalClaudeConfig = JSON.parse(externalClaude) as {
      readonly mcpServers?: Record<string, { readonly command?: string; readonly args?: string[] }>;
    };
    expect(externalCodex).toContain('[mcp_servers.bridge]');
    expect(externalCodex).toMatch(/command\s*=\s*"claude-codex-bridge"/u);
    expect(externalCodex).toContain('cwd = "."');
    expect(externalCodex).toContain('tool_timeout_sec = 5400');
    expect(externalCodex).toContain('"--workspace", "."');
    expect(externalClaudeConfig.mcpServers?.["bridge"]?.command).toBe("claude-codex-bridge");
    expect(externalClaudeConfig.mcpServers?.["bridge"]?.args).toEqual(
      expect.arrayContaining(["--caller", "claude", "--delegation", "allow", "--workspace", "${CLAUDE_PROJECT_DIR:-.}"]),
    );
    const externalCombined = `${externalCodex}\n${externalClaude}`;
    expect(externalCombined).not.toMatch(/[A-Za-z]:[\\/]/u);
    expect(externalCombined).not.toMatch(/api[_-]?key|credential|password|secret|token/iu);
    expect(externalCombined).not.toContain("scripts/native-bridge-mcp.mjs");
  });

  it("keeps the Claude and Codex using-bridge skill mirrors byte-identical", () => {
    const codexSkill = join(repoRoot, ".codex", "skills", "using-bridge");
    const claudeSkill = join(repoRoot, ".claude", "skills", "using-bridge");
    const codexFiles = recursiveFileHashes(codexSkill);
    const claudeFiles = recursiveFileHashes(claudeSkill);
    expect(codexFiles).toEqual(claudeFiles);
    expect(codexFiles.map((entry) => entry.path)).toEqual(
      expect.arrayContaining(["SKILL.md", "agents/openai.yaml", "references/routing-policy.md"]),
    );
  });

  it("starts from an external workspace without a local scripts tree and stores state there", async () => {
    const externalWorkspace = mkdtempSync(join(tmpdir(), "bridge-external-workspace-"));
    expect(existsSync(join(externalWorkspace, "scripts"))).toBe(false);
    const harness = new NativeHarness("codex", "allow", undefined, undefined, externalWorkspace);
    try {
      await harness.initialize();
      expect((await harness.callTool("bridge_server_info")).data).toEqual({
        caller: "codex",
        delegation: "allow",
      });
      // Startup and reads claim nothing and write nothing (contract 4.2/4.3).
      expect(existsSync(join(externalWorkspace, ".bridge", "bridge.db"))).toBe(false);
      const status = await harness.callTool("bridge_manager_status");
      expect(status.data.workspace).toMatchObject({ bound: false, database_exists: false });
      expect(status.data.manager).toBeNull();

      // The first authorized ownership call creates and binds the state.
      const created = await harness.callTool(
        "bridge_create_task",
        { spec: taskSpec() },
        nativeMeta("thread-external-1"),
      );
      expect(created.isError).toBeFalsy();
      expect(existsSync(join(externalWorkspace, ".bridge", "bridge.db"))).toBe(true);
      const bound = await harness.callTool("bridge_manager_status");
      expect(bound.data.manager).toMatchObject({
        native_thread_id: "thread-external-1",
        epoch: 1,
        instance_generation: 1,
        is_calling_instance: true,
      });

      // A second native session is refused before it can mutate anything.
      const foreign = await harness.callTool(
        "bridge_create_task",
        { spec: taskSpec() },
        nativeMeta("thread-external-2"),
      );
      expect(foreign.isError).toBe(true);
      expect(foreign.data.error.code).toBe("MANAGER_FOREIGN_THREAD");

      // Missing and unsupported envelopes are refused as well.
      const noMeta = await harness.callTool("bridge_create_task", { spec: taskSpec() });
      expect(noMeta.data.error.code).toBe("NATIVE_CONTEXT_INVALID");
      const badVersion = await harness.callTool(
        "bridge_create_task",
        { spec: taskSpec() },
        nativeMeta("thread-external-1", "0.154.1"),
      );
      expect(badVersion.data.error.details.reason).toBe("native_adapter_unsupported");
      expect(existsSync(join(externalWorkspace, "scripts", "native-bridge-mcp.mjs"))).toBe(false);
    } finally {
      const exit = await harness.shutdown();
      rmSync(externalWorkspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      expect(exit, `external launcher stderr: ${harness.stderr.join("").slice(-1000)}`).toBe(0);
    }
  }, 30_000);

  it("shares state across separate stdio processes with pure JSON-RPC stdout", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "bridge-native-launcher-"));
    const db = join(workspace, ".bridge", "shared.db");
    const codex = new NativeHarness("codex", "allow", workspace, db);
    const claude = new NativeHarness("claude", "deny", workspace, db);
    const codexDenied = new NativeHarness("codex", "deny", workspace, db);
    try {
      await codex.initialize();
      await claude.initialize();
      await codexDenied.initialize();
      expect((await codex.callTool("bridge_server_info")).data)
        .toEqual({ caller: "codex", delegation: "allow" });
      expect((await claude.callTool("bridge_server_info")).data)
        .toEqual({ caller: "claude", delegation: "deny" });
      expect((await codexDenied.callTool("bridge_server_info")).data)
        .toEqual({ caller: "codex", delegation: "deny" });

      const root = await codex.callTool(
        "bridge_create_task",
        { spec: taskSpec(), run_id: "run_0000000001" },
        nativeMeta("thread-shared-1"),
      );
      expect(root.data).toMatchObject({
        run_id: "run_0000000001",
        parent_task_id: null,
        delegation_depth: 0,
      });
      const observed = await claude.callTool("bridge_get_task", { task_id: root.data.task_id });
      expect(observed.data.task).toMatchObject({
        task_id: root.data.task_id,
        created_by: "codex",
      });

      const spoof = await codex.callTool(
        "bridge_claim_task",
        { task_id: root.data.task_id, agent: "claude" },
        nativeMeta("thread-shared-1"),
      );
      expect(spoof.isError).toBe(true);
      expect(spoof.data.error.code).toBe("INVALID_ARGUMENT");

      const denied = await claude.callTool("bridge_delegate", {
        to: "codex",
        spec: taskSpec(),
        deadline_ms: 5_000,
      });
      expect(denied.isError).toBe(true);
      expect(denied.data.error.details).toMatchObject({ policy: "deny", caller: "claude" });

      const deniedByCodex = await codexDenied.callTool(
        "bridge_delegate",
        { to: "claude", spec: taskSpec(), deadline_ms: 5_000 },
        nativeMeta("thread-shared-1"),
      );
      expect(deniedByCodex.isError).toBe(true);
      expect(deniedByCodex.data.error.details).toMatchObject({
        policy: "deny",
        caller: "codex",
      });

      for (const line of [...codex.stdoutLines, ...claude.stdoutLines, ...codexDenied.stdoutLines]) {
        expect(() => JSON.parse(line)).not.toThrow();
        expect(JSON.parse(line)).toMatchObject({ jsonrpc: "2.0" });
      }
    } finally {
      const exits = await Promise.all([
        codex.shutdown(),
        claude.shutdown(),
        codexDenied.shutdown(),
      ]);
      rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      expect(
        exits,
        [
          `codex stderr: ${codex.stderr.join("").slice(-1000)}`,
          `claude stderr: ${claude.stderr.join("").slice(-1000)}`,
          `codex-deny stderr: ${codexDenied.stderr.join("").slice(-1000)}`,
        ].join("\n"),
      ).toEqual([0, 0, 0]);
    }
  }, 30_000);

  it("logs an authorized session automatically, and nothing before the guard authorizes it", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "bridge-log-launcher-"));
    const logDirectory = join(workspace, ".bridge", "logs");
    const harness = new NativeHarness("codex", "allow", workspace);
    try {
      await harness.initialize();
      // Handshake and reads: no state directory, so no log directory either.
      expect((await harness.callTool("bridge_server_info")).isError).toBe(false);
      expect((await harness.callTool("bridge_manager_status")).data.workspace).toMatchObject({ bound: false });
      expect(existsSync(join(workspace, ".bridge"))).toBe(false);

      // A refusal before any binding is bounded to stderr; it creates nothing.
      const refusedEarly = await harness.callTool("bridge_create_task", { spec: taskSpec() });
      expect(refusedEarly.data.error.code).toBe("NATIVE_CONTEXT_INVALID");
      expect(existsSync(join(workspace, ".bridge"))).toBe(false);

      // The first authorized operation binds the worktree and arms the log.
      const created = await harness.callTool(
        "bridge_create_task",
        { spec: taskSpec(), idempotency_key: "round-1-create" },
        nativeMeta("thread-log-1"),
      );
      expect(created.isError).toBe(false);
      expect(existsSync(logDirectory)).toBe(true);

      // A foreign session is refused by the guard of the owning process and recorded as such.
      const foreign = await harness.callTool(
        "bridge_create_task",
        { spec: taskSpec() },
        nativeMeta("thread-log-2"),
      );
      expect(foreign.data.error.code).toBe("MANAGER_FOREIGN_THREAD");
      expect(await harness.terminate()).toBe(0);

      const records = logRecords(workspace);
      expect(records.every((record) => record["schema"] === "claude-codex-bridge.log/v1")).toBe(true);
      // Sequence numbers count every record the process produced, so the written ones are
      // contiguous and start after the records that were deferred to stderr before arming.
      const sequence = records.map((record) => record["seq"] as number);
      expect(sequence).toEqual(sequence.map((_, index) => sequence[0]! + index));

      const start = records.find((record) => record["event"] === "start")!;
      expect(start).toMatchObject({ op: "process", role: "codex", source: "0.2.0" });
      expect(start["workspace"]).toMatch(/^ws_[0-9a-f]{16}$/u);
      expect(start["pid"]).toBeGreaterThan(0);
      expect(start["details"]["deferred_records"]).toBeGreaterThan(0);
      expect(sequence[0]).toBe((start["details"]["deferred_records"] as number) + 1);

      const authorized = records.find((record) => record["event"] === "authorized")!;
      expect(authorized).toMatchObject({ op: "manager", tool: "bridge_create_task", phase: "guard" });
      expect(authorized["details"]).toMatchObject({ epoch: 1, instance_generation: 1 });
      // The native thread id is a session handle: only a digest of it is recorded.
      expect(JSON.stringify(records)).not.toContain("thread-log-1");
      expect(authorized["details"]["thread_ref"]).toMatch(/^[0-9a-f]{12}$/u);

      const accepted = records.find(
        (record) => record["event"] === "call.finished" && record["outcome"] === "ok",
      )!;
      expect(accepted).toMatchObject({
        op: "tool",
        tool: "bridge_create_task",
        phase: "handler",
        instance: start["instance"],
      });
      expect(accepted["task_id"]).toBe(created.data.task_id);
      expect(accepted["request_id"]).not.toBeNull();
      expect(accepted["duration_ms"]).toBeGreaterThanOrEqual(0);
      // The idempotency key correlates by digest, never by value.
      expect(accepted["details"]["idempotency_ref"]).toMatch(/^[0-9a-f]{12}$/u);
      expect(JSON.stringify(records)).not.toContain("round-1-create");

      const refused = records.find(
        (record) => record["code"] === "MANAGER_FOREIGN_THREAD",
      )!;
      expect(refused).toMatchObject({ op: "tool", outcome: "error", phase: "guard" });

      // Shutdown is recorded, and the active marker is released.
      expect(records.map((record) => record["event"])).toEqual(
        expect.arrayContaining(["stop", "instance.detached", "close"]),
      );
      expect(readdirSync(logDirectory).filter((name) => name.endsWith(".active"))).toEqual([]);

      // Privacy: no task content, no argument values, no environment.
      const text = JSON.stringify(records);
      for (const forbidden of [
        "prove shared native MCP state",
        "BENCHMARK/native-mcp/**",
        "the other stdio process can read it",
        workspace,
      ]) {
        expect(text, `diagnostics log must not contain ${forbidden}`).not.toContain(forbidden);
      }

      for (const line of harness.stdoutLines) {
        expect(JSON.parse(line)).toMatchObject({ jsonrpc: "2.0" });
      }
    } finally {
      await harness.shutdown();
      rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }, 30_000);

  it("records the worker runtime's own authorized calls beside the manager's, in its own file", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "bridge-log-worker-"));
    const manager = new NativeHarness("codex", "allow", workspace);
    const worker = new NativeHarness("claude", "deny", workspace);
    try {
      await manager.initialize();
      await worker.initialize();
      const root = await manager.callTool("bridge_create_task", { spec: taskSpec() }, nativeMeta("thread-worker"));
      // The worker role carries no native session; its authority comes from the bound worktree.
      const claimed = await worker.callTool("bridge_claim_task", { task_id: root.data.task_id });
      expect(claimed.isError, JSON.stringify(claimed.data)).toBe(false);
      expect(await manager.terminate()).toBe(0);
      expect(await worker.terminate()).toBe(0);

      const records = logRecords(workspace);
      const byRole = new Map(records.map((record) => [record["role"], record["instance"]]));
      expect([...byRole.keys()].sort()).toEqual(["claude", "codex"]);
      expect(byRole.get("claude")).not.toBe(byRole.get("codex"));
      // Two processes write two files; neither truncates or interleaves with the other.
      expect(
        readdirSync(join(workspace, ".bridge", "logs")).filter((name) => name.endsWith(".jsonl")),
      ).toHaveLength(2);
      const workerCall = records.find(
        (record) => record["role"] === "claude" && record["event"] === "call.finished",
      )!;
      expect(workerCall).toMatchObject({ tool: "bridge_claim_task", outcome: "ok", phase: "handler" });
      expect(workerCall["task_id"]).toBe(root.data.task_id);
    } finally {
      await manager.shutdown();
      await worker.shutdown();
      rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }, 30_000);

  it("leaves a visible gap when a process ends without shutting down, and cleans it up later", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "bridge-log-eof-"));
    const logDirectory = join(workspace, ".bridge", "logs");
    const first = new NativeHarness("codex", "allow", workspace);
    let second: NativeHarness | undefined;
    try {
      await first.initialize();
      const created = await first.callTool(
        "bridge_create_task",
        { spec: taskSpec() },
        nativeMeta("thread-eof"),
      );
      expect(created.isError).toBe(false);
      // Closing stdin is the wave12-observed path that does not run the shutdown sequence: the
      // log records the facts and simply stops. The missing `stop`/`close` records are the
      // evidence of that gap; nothing here claims a clean close that did not happen.
      expect(await first.shutdown()).toBe(0);

      const afterEof = logRecords(workspace);
      expect(afterEof.some((record) => record["event"] === "call.finished")).toBe(true);
      expect(afterEof.some((record) => ["stop", "close"].includes(String(record["event"])))).toBe(false);
      const staleMarker = readdirSync(logDirectory).filter((name) => name.endsWith(".active"));
      expect(staleMarker).toHaveLength(1);

      // The next authorized process recognises the dead instance's marker and removes it,
      // so a crashed run cannot protect its file from retention forever.
      second = new NativeHarness("codex", "allow", workspace);
      await second.initialize();
      const manager = (await second.callTool("bridge_manager_status")).data.manager;
      await second.callTool(
        "bridge_manager_resume_instance",
        { expected_epoch: manager.epoch, expected_generation: manager.instance_generation },
        nativeMeta("thread-eof"),
      );
      const again = await second.callTool("bridge_create_task", { spec: taskSpec() }, nativeMeta("thread-eof"));
      expect(again.isError, JSON.stringify(again.data)).toBe(false);
      expect(await second.terminate()).toBe(0);

      const markers = readdirSync(logDirectory).filter((name) => name.endsWith(".active"));
      expect(markers).toEqual([]);
      expect(readdirSync(logDirectory).filter((name) => name.endsWith(".jsonl")).length).toBe(2);
    } finally {
      await first.shutdown();
      if (second) await second.shutdown();
      rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }, 30_000);

  it("adds no state through the logger when a foreign session or a read is refused", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "bridge-log-foreign-"));
    const owner = new NativeHarness("codex", "allow", workspace);
    let stranger: NativeHarness | undefined;
    try {
      await owner.initialize();
      const created = await owner.callTool(
        "bridge_create_task",
        { spec: taskSpec() },
        nativeMeta("thread-owner"),
      );
      expect(created.isError).toBe(false);
      expect(await owner.shutdown()).toBe(0);
      const before = stateFingerprint(workspace);
      expect(Object.keys(before).some((path) => path.startsWith("logs/"))).toBe(true);

      // A different native session in a different process: handshake, read and refused mutation.
      stranger = new NativeHarness("codex", "allow", workspace);
      await stranger.initialize();
      expect((await stranger.callTool("bridge_server_info")).isError).toBe(false);
      const status = await stranger.callTool("bridge_manager_status");
      expect(status.data.manager).toMatchObject({ is_calling_instance: false });
      const refused = await stranger.callTool(
        "bridge_create_task",
        { spec: taskSpec() },
        nativeMeta("thread-stranger"),
      );
      expect(refused.data.error.code).toBe("MANAGER_FOREIGN_THREAD");
      const alsoRefused = await stranger.callTool("bridge_feature_get", { feature_id: "F-none" });
      expect(alsoRefused.isError).toBe(true);
      expect(await stranger.shutdown()).toBe(0);

      expect(stateFingerprint(workspace)).toEqual(before);
    } finally {
      await owner.shutdown();
      if (stranger) await stranger.shutdown();
      rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }, 30_000);

  it("keeps the logs of two worktrees apart even when their features and tasks share names", async () => {
    const workspaces = [
      mkdtempSync(join(tmpdir(), "bridge-log-ws-a-")),
      mkdtempSync(join(tmpdir(), "bridge-log-ws-b-")),
    ];
    const harnesses = workspaces.map((workspace) => new NativeHarness("codex", "allow", workspace));
    try {
      const taskIds: string[] = [];
      for (const [index, harness] of harnesses.entries()) {
        await harness.initialize();
        const meta = nativeMeta(`thread-parallel-${index}`);
        const root = await harness.callTool("bridge_create_task", { spec: taskSpec() }, meta);
        await harness.callTool("bridge_claim_task", { task_id: root.data.task_id }, meta);
        await harness.callTool("bridge_set_state", { task_id: root.data.task_id, to: "WORKING" }, meta);
        const feature = await harness.callTool(
          "bridge_feature_create",
          { feature_id: "F-same-name", parent_task_id: root.data.task_id },
          meta,
        );
        expect(feature.isError, JSON.stringify(feature.data)).toBe(false);
        taskIds.push(root.data.task_id as string);
        expect(await harness.shutdown()).toBe(0);
      }
      expect(taskIds[0]).not.toBe(taskIds[1]);

      const [first, second] = workspaces.map(logRecords);
      for (const [index, records] of [first!, second!].entries()) {
        const text = JSON.stringify(records);
        expect(records.some((record) => record["feature_id"] === "F-same-name")).toBe(true);
        expect(text).toContain(taskIds[index]!);
        expect(text, "one worktree's log must not mention the other's task").not.toContain(
          taskIds[1 - index]!,
        );
        expect(new Set(records.map((record) => record["workspace"])).size).toBe(1);
      }
      expect(first![0]!["workspace"]).not.toBe(second![0]!["workspace"]);
    } finally {
      for (const harness of harnesses) await harness.shutdown();
      for (const workspace of workspaces) {
        rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    }
  }, 45_000);

  it("recovers a timed-out feature round after a bridge restart in the same runtime session", async () => {
    // A stand-in `claude` on PATH speaks the real stream-json protocol; no model is called.
    const workspace = mkdtempSync(join(tmpdir(), "bridge-timeout-e2e-"));
    const bin = join(workspace, "bin");
    mkdirSync(bin);
    const fakeCli = join(repoRoot, "claude", "claude-side", "test", "fixtures", "fake-claude-cli.mjs");
    const argvFile = join(workspace, "claude-argv.json");
    writeFileSync(join(bin, "claude"), `#!/bin/sh\nexec "${process.execPath}" "${fakeCli}" "$@"\n`, { mode: 0o755 });
    const env = (mode: string): NodeJS.ProcessEnv => ({
      ...process.env,
      PATH: `${bin}${delimiter}${process.env["PATH"] ?? ""}`,
      FAKE_CLAUDE_MODE: mode,
      FAKE_CLAUDE_ARGV_FILE: argvFile,
      FAKE_CLAUDE_STDERR: "fake runtime warning: upstream slow\n",
    });
    const db = join(workspace, ".bridge", "bridge.db");
    const first = new NativeHarness("codex", "allow", workspace, db, repoRoot, env("hang"));
    let second: NativeHarness | undefined;
    // Wave10: the published recovery scenario must carry the accepted call-time identity.
    const call = (client: NativeHarness, name: string, args: Record<string, unknown> = {}) =>
      client.callTool(name, args, nativeMeta("thread-timeout-e2e"));
    try {
      await first.initialize();
      const root = await call(first, "bridge_create_task", { spec: taskSpec() });
      await call(first, "bridge_claim_task", { task_id: root.data.task_id });
      await call(first, "bridge_set_state", { task_id: root.data.task_id, to: "WORKING" });
      await call(first, "bridge_feature_create", { feature_id: "F-e2e", parent_task_id: root.data.task_id });
      const round = await call(first, "bridge_feature_run", {
        feature_id: "F-e2e",
        spec: {
          objective: "write the contract",
          scope: { paths: ["docs/contract/**"] },
          dependencies: [],
          expected_deliverable: "contract",
          verification_criteria: ["node --version runs"],
          max_turns: 32,
        },
        deadline_ms: 1_000,
        idempotency_key: "F-e2e:round-1",
      });
      expect(round.isError, JSON.stringify(round.data)).toBe(false);
      expect(round.data.task.state).toBe("FAILED");
      expect(round.data.error.code).toBe("TIMEOUT");
      const taskId = round.data.task.task_id as string;

      const failed = await call(first, "bridge_get_task", { task_id: taskId });
      expect(failed.data.attempts[0]).toMatchObject({ outcome: "TIMEOUT" });
      const [evidence] = failed.data.termination_evidence;
      expect(evidence).toMatchObject({ attempt: 0, termination_kind: "timeout", reason: "deadline" });
      expect(readFileSync(evidence.path, "utf8")).toContain("fake runtime warning");
      expect(JSON.stringify(failed.data)).not.toContain("fake runtime warning");
      expect(await first.shutdown()).toBe(0);

      second = new NativeHarness("codex", "allow", workspace, db, repoRoot, env("ok"));
      await second.initialize();
      // EOF may leave the durable instance active: follow the explicit restart protocol.
      const manager = (await call(second, "bridge_manager_status")).data.manager;
      const rebound = await call(second, "bridge_manager_resume_instance", {
        expected_epoch: manager.epoch, expected_generation: manager.instance_generation,
      });
      expect(rebound.isError, JSON.stringify(rebound.data)).toBe(false);
      expect((await call(second, "bridge_feature_get", { feature_id: "F-e2e" })).data.state).toBe("blocked");
      const request = {
        task_id: taskId,
        recover_timeout: true,
        deadline_ms: 4_500_000,
        max_turns: 120,
        idempotency_key: "F-e2e:timeout-1",
      };
      const resumed = await call(second, "bridge_resume_delegated_task", request);
      expect(resumed.isError, JSON.stringify(resumed.data)).toBe(false);
      expect(resumed.data).toMatchObject({
        task_id: taskId,
        recovered_attempt: 1,
        resumed_from_attempt: 0,
        same_execution_handle: true,
        recovery_mode: "timeout",
        deadline_ms: 4_500_000,
        state: "DONE",
      });
      const argv = (JSON.parse(readFileSync(argvFile, "utf8")) as { args: string[] }).args;
      expect(argv[argv.indexOf("--resume") + 1]).toBe("11111111-2222-4333-8444-555555555555");
      expect(argv[argv.indexOf("--max-turns") + 1]).toBe("120");

      const replay = await call(second, "bridge_resume_delegated_task", request);
      expect(replay.data.recovered_attempt).toBe(1);
      expect((await call(second, "bridge_feature_get", { feature_id: "F-e2e" })).data)
        .toMatchObject({ state: "awaiting_review", task_ids: [taskId] });
      expect((await call(second, "bridge_get_task", { task_id: taskId })).data.attempts).toHaveLength(2);

      for (const line of [...first.stdoutLines, ...second.stdoutLines]) {
        expect(JSON.parse(line)).toMatchObject({ jsonrpc: "2.0" });
      }

      // The diagnostics log of the same run separates the executor's deadline from the client
      // timeout and names the attempt that was recovered, without any transcript or payload.
      const records = logRecords(workspace);
      const timedOut = records.find(
        (record) => record["tool"] === "bridge_feature_run" && record["event"] === "call.finished",
      )!;
      expect(timedOut).toMatchObject({ outcome: "ok", code: "TIMEOUT", task_id: taskId });
      expect(timedOut["details"]).toMatchObject({ deadline_ms: 1_000, state: "FAILED" });
      const recovered = records.filter(
        (record) => record["tool"] === "bridge_resume_delegated_task" && record["event"] === "call.finished",
      );
      expect(recovered).toHaveLength(2); // the recovery and its idempotent replay
      expect(recovered[0]).toMatchObject({ task_id: taskId, attempt: 1 });
      expect(recovered[0]!["details"]).toMatchObject({
        deadline_ms: 4_500_000,
        max_turns: 120,
        recovery_mode: "timeout",
        resumed_from_attempt: 0,
        state: "DONE",
      });
      expect(JSON.stringify(records)).not.toContain("fake runtime warning");
      expect(JSON.stringify(records)).not.toContain("write the contract");
    } finally {
      await first.shutdown();
      const exit = second ? await second.shutdown() : 0;
      rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      expect(exit, `second launcher stderr: ${second?.stderr.join("").slice(-1000) ?? ""}`).toBe(0);
    }
  }, 60_000);
});
