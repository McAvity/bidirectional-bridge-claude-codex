/**
 * W17-03 / F-W19 W19-04: the real launcher hands a delegated Claude its executor packages.
 *
 * `executorPackages` still lists the runtime's packages (the pre-binding set). Since W19-04 the
 * launcher enforces workflow binding: a feature round runs only with an admitted workflow, and the
 * executor then receives `plugins/bridge-claude` (current roles) plus the admitted store variant,
 * never the runtime's own `feature-workflow-claude`, whatever the runtime layout. Asserted on the
 * argv a stand-in `claude` on PATH records — no model runs, no personal plugin is involved.
 */

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const fakeCli = join(repoRoot, "claude", "claude-side", "test", "fixtures", "fake-claude-cli.mjs");

interface Message {
  readonly id?: number;
  readonly result?: { readonly isError?: boolean; readonly content: ReadonlyArray<{ readonly text: string }> };
  readonly error?: unknown;
}

/** Minimal stdio MCP client for one launcher process. */
class Launcher {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, (message: Message) => void>();
  private nextId = 1;
  private buffer = "";
  readonly stderr: string[] = [];
  readonly exited: Promise<number | null>;

  constructor(launcher: string, workspace: string, env: NodeJS.ProcessEnv) {
    this.child = spawn(
      process.execPath,
      [launcher, "--caller", "codex", "--delegation", "allow", "--workspace", workspace],
      { cwd: workspace, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    ) as ChildProcessWithoutNullStreams;
    this.exited = new Promise((done) => this.child.once("exit", done));
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      let newline: number;
      while ((newline = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (!line) continue;
        const message = JSON.parse(line) as Message;
        if (message.id !== undefined) this.pending.get(message.id)?.(message);
      }
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => this.stderr.push(chunk));
  }

  request(method: string, params: unknown): Promise<Message> {
    const id = this.nextId++;
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => rejectRequest(new Error(`timeout on ${method}: ${this.stderr.join("").slice(-1500)}`)), 20_000);
      this.pending.set(id, (message) => {
        clearTimeout(timer);
        this.pending.delete(id);
        resolveRequest(message);
      });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  async initialize(): Promise<void> {
    const response = await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "plugin-dirs-test", version: "1.0.0" },
    });
    expect(response.error).toBeUndefined();
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
  }

  async call(name: string, args: Record<string, unknown>, meta: unknown): Promise<Record<string, any>> {
    const response = await this.request("tools/call", { name, arguments: args, _meta: meta });
    return JSON.parse(response.result!.content[0]!.text) as Record<string, any>;
  }

  async stop(): Promise<void> {
    if (!this.child.stdin.destroyed) this.child.stdin.end();
    const timer = setTimeout(() => this.child.kill("SIGKILL"), 5_000);
    await this.exited;
    clearTimeout(timer);
  }
}

/** Synthetic Codex per-call metadata (a fixture envelope, not a live Codex session). */
function meta(threadId: string): Record<string, unknown> {
  return {
    threadId,
    "x-codex-turn-metadata": { session_id: threadId, thread_id: threadId, codex_version: "0.154.0" },
  };
}

const cleanup: string[] = [];
afterEach(() => {
  for (const path of cleanup.splice(0)) {
    spawnSync("chmod", ["-R", "u+w", path]); // the workflow store is read-only by design
    rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

/** Start one bound round through the launcher; return the argv and the admitted store variant. */
async function roundArgv(launcher: string): Promise<{ args: string[]; clientRoot: string }> {
  const workspace = mkdtempSync(join(tmpdir(), "bridge-plugin-dirs-"));
  cleanup.push(workspace);
  const bin = join(workspace, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "claude"), `#!/bin/sh\nexec "${process.execPath}" "${fakeCli}" "$@"\n`, { mode: 0o755 });
  const argvFile = join(workspace, "argv.json");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env["PATH"] ?? ""}`,
    FAKE_CLAUDE_MODE: "hang",
    FAKE_CLAUDE_ARGV_FILE: argvFile,
    CLAUDE_CODEX_BRIDGE_HOME: join(workspace, "bridge-home"),
  };
  const lib = await import(pathToFileURL(join(repoRoot, "scripts/workflow-source/workflow-lib.mjs")).href);
  const bundle = join(repoRoot, "plugins/feature-workflow-claude/bundle");
  const manifest = lib.verifyBundle(bundle);
  lib.storePublish(join(workspace, "bridge-home", "workflows"), bundle);
  mkdirSync(join(workspace, "docs/features/F-dirs"), { recursive: true });
  lib.writeLock(join(workspace, "docs/features/F-dirs"), lib.newLock(manifest, { origin: { kind: "active-plugin", client: "codex", plugin_version: manifest.version }, at: "2026-11-06T00:00:00Z", featureId: "F-dirs" }));
  const clientRoot = join(lib.canonicalAnchor(join(workspace, "bridge-home", "workflows")), manifest.workflow_id, "claude");
  const server = new Launcher(launcher, workspace, env);
  const m = meta("thread-plugin-dirs");
  try {
    await server.initialize();
    const spec = {
      objective: "record the executor argv",
      scope: { paths: ["docs/contract/**"] },
      dependencies: [],
      expected_deliverable: "nothing",
      verification_criteria: ["node --version runs"],
    };
    const root = await server.call("bridge_create_task", { spec }, m);
    await server.call("bridge_claim_task", { task_id: root["task_id"] }, m);
    await server.call("bridge_set_state", { task_id: root["task_id"], to: "WORKING" }, m);
    await server.call("bridge_feature_create", { feature_id: "F-dirs", parent_task_id: root["task_id"] }, m);
    const unbound = await server.call("bridge_feature_run", { feature_id: "F-dirs", spec, deadline_ms: 2_000, idempotency_key: "F-dirs:unbound" }, m);
    expect(unbound["error"]?.["details"]?.["code"]).toBe("WORKFLOW_UNBOUND");
    expect(existsSync(argvFile)).toBe(false); // refused before any worker
    const bound = await server.call("bridge_workflow_bind", { feature_id: "F-dirs", lock_path: "docs/features/F-dirs/workflow.lock.json", expected_identity: manifest.identity, idempotency_key: "bind" }, m);
    expect(bound["result"], JSON.stringify(bound)).toBe("BOUND");
    const round = await server.call(
      "bridge_feature_run",
      { feature_id: "F-dirs", spec, deadline_ms: 2_000, idempotency_key: "F-dirs:round-1", workflow_identity: manifest.identity },
      m,
    );
    expect(round["error"]?.["code"], server.stderr.join("").slice(-1500)).toBe("TIMEOUT");
    expect(existsSync(argvFile)).toBe(true);
    return { args: (JSON.parse(readFileSync(argvFile, "utf8")) as { args: string[] }).args, clientRoot };
  } finally {
    await server.stop();
  }
}

function pluginDirArgs(args: readonly string[]): string[] {
  return args.flatMap((arg, index) => (arg === "--plugin-dir" ? [args[index + 1]!] : []));
}

describe("executor packages passed by the real launcher", () => {
  it("lists the runtime's packages in order and skips an absent one", async () => {
    const module = await import("./native-bridge-mcp.mjs");
    expect(module.executorPackages(repoRoot)).toEqual([
      join(repoRoot, "plugins", "bridge-claude"),
      join(repoRoot, "plugins", "feature-workflow-claude"),
    ]);
    const old = mkdtempSync(join(tmpdir(), "bridge-old-runtime-"));
    cleanup.push(old);
    mkdirSync(join(old, "plugins", "bridge-claude", ".claude-plugin"), { recursive: true });
    writeFileSync(join(old, "plugins", "bridge-claude", ".claude-plugin", "plugin.json"), "{}\n");
    // A directory without a manifest is not a package.
    mkdirSync(join(old, "plugins", "feature-workflow-claude"), { recursive: true });
    expect(module.executorPackages(old)).toEqual([join(old, "plugins", "bridge-claude")]);
  });

  it("passes bridge-claude then the admitted store variant, never the runtime workflow package", async () => {
    const { args, clientRoot } = await roundArgv(join(repoRoot, "scripts", "native-bridge-mcp.mjs"));
    expect(pluginDirArgs(args)).toEqual([join(repoRoot, "plugins", "bridge-claude"), clientRoot]);
    expect(args).not.toContain(join(repoRoot, "plugins", "feature-workflow-claude"));
  }, 60_000);

  it("passes bridge-claude and the store variant from a runtime layout without the workflow package", async () => {
    // An older runtime layout: its own launcher and bridge-claude, no feature-workflow-claude.
    const runtime = mkdtempSync(join(tmpdir(), "bridge-runtime-layout-"));
    cleanup.push(runtime);
    cpSync(join(repoRoot, "scripts"), join(runtime, "scripts"), { recursive: true });
    for (const shared of ["shared", "claude", "codex", "node_modules", "package.json"]) {
      symlinkSync(join(repoRoot, shared), join(runtime, shared));
    }
    mkdirSync(join(runtime, "plugins"));
    cpSync(join(repoRoot, "plugins", "bridge-claude"), join(runtime, "plugins", "bridge-claude"), { recursive: true });
    const { args, clientRoot } = await roundArgv(join(runtime, "scripts", "native-bridge-mcp.mjs"));
    expect(pluginDirArgs(args)).toEqual([join(runtime, "plugins", "bridge-claude"), clientRoot]);
  }, 60_000);
});
