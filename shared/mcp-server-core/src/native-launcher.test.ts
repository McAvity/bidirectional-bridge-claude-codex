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
    } finally {
      await first.shutdown();
      const exit = second ? await second.shutdown() : 0;
      rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      expect(exit, `second launcher stderr: ${second?.stderr.join("").slice(-1000) ?? ""}`).toBe(0);
    }
  }, 60_000);
});
