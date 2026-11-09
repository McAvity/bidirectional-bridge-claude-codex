/**
 * F-W19 W19-04: the real launcher (`scripts/native-bridge-mcp.mjs`) with binding enabled and a
 * stand-in `claude` on PATH that records its argv. Asserts what the delegated executor actually
 * receives: the runtime role package plus the admitted store variant, never the runtime's own
 * workflow package; the explicit ROOT/identity/generation block; the same session on the next
 * round after a switch; and refusals before any worker. No model, no personal profile.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadWorkflowStore, type WorkflowStorePort } from "@bridge/control-plane";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const launcher = join(repoRoot, "scripts", "native-bridge-mcp.mjs");
const fakeCli = join(repoRoot, "claude", "claude-side", "test", "fixtures", "fake-claude-cli.mjs");
const SOURCE_BUNDLE = join(repoRoot, "plugins/feature-workflow-claude/bundle");

let port: WorkflowStorePort;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lib: any;
beforeAll(async () => { port = await loadWorkflowStore(); lib = port.lib; });
const cleanup: (() => void)[] = [];
afterEach(() => { for (const f of cleanup.splice(0).reverse()) f(); });

interface Message { readonly id?: number; readonly result?: { readonly content: ReadonlyArray<{ readonly text: string }> }; readonly error?: unknown }

class Launcher {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, (message: Message) => void>();
  private nextId = 1;
  private buffer = "";
  readonly stderr: string[] = [];
  readonly exited: Promise<number | null>;
  constructor(workspace: string, env: NodeJS.ProcessEnv) {
    this.child = spawn(process.execPath, [launcher, "--caller", "codex", "--delegation", "allow", "--workspace", workspace],
      { cwd: workspace, env, stdio: ["pipe", "pipe", "pipe"] }) as ChildProcessWithoutNullStreams;
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
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => fail(new Error(`timeout on ${method}: ${this.stderr.join("").slice(-1500)}`)), 30_000);
      this.pending.set(id, (message) => { clearTimeout(timer); this.pending.delete(id); ok(message); });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }
  async initialize(): Promise<void> {
    const response = await this.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "w19-04", version: "1" } });
    expect(response.error).toBeUndefined();
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async call(name: string, args: Record<string, unknown>): Promise<Record<string, any>> {
    const meta = { threadId: "thread-w19-04", "x-codex-turn-metadata": { session_id: "thread-w19-04", thread_id: "thread-w19-04", codex_version: "0.154.0" } };
    const response = await this.request("tools/call", { name, arguments: args, _meta: meta });
    return JSON.parse(response.result!.content[0]!.text);
  }
  async stop(): Promise<void> {
    if (!this.child.stdin.destroyed) this.child.stdin.end();
    const timer = setTimeout(() => this.child.kill("SIGKILL"), 5_000);
    await this.exited;
    clearTimeout(timer);
  }
}

function pluginDirs(args: readonly string[]): string[] {
  return args.flatMap((arg, i) => (arg === "--plugin-dir" ? [args[i + 1]!] : []));
}

describe("real launcher with workflow binding", () => {
  it("passes the admitted store variant with the role package, states ROOT, resumes the same session after a switch, and refuses before any worker", async () => {
    const root = mkdtempSync(join(tmpdir(), "w19-04-launcher-"));
    cleanup.push(() => { lib.makeWritable(root); rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
    const workspace = join(root, "ws");
    const home = join(root, "home");
    const store = join(home, "workflows");
    mkdirSync(join(workspace, "docs/features/F-1"), { recursive: true });
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "claude"), `#!/bin/sh\nexec "${process.execPath}" "${fakeCli}" "$@"\n`, { mode: 0o755 });
    const argvFile = join(root, "argv.json");
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}${delimiter}${process.env["PATH"] ?? ""}`, FAKE_CLAUDE_MODE: "ok",
      FAKE_CLAUDE_ARGV_FILE: argvFile, CLAUDE_CODEX_BRIDGE_HOME: home };
    delete env["CLAUDE_CONFIG_DIR"];

    const A = lib.verifyBundle(SOURCE_BUNDLE);
    lib.storePublish(store, SOURCE_BUNDLE);
    const variants = { claude: lib.readVariant(join(SOURCE_BUNDLE, "claude")), codex: lib.readVariant(join(SOURCE_BUNDLE, "codex")) };
    variants.claude["skills/feature-plan/SKILL.md"] = { data: Buffer.from("---\nname: feature-plan\ndescription: B\n---\nworkflow B\n"), mode: "644" };
    const B = lib.bundleManifest({ version: "1.0.1", requires: A.requires, variants, source: { repository: null, commit: null } });
    lib.writeBundle(join(root, "B"), B, variants);
    lib.storePublish(store, join(root, "B"));
    lib.writeLock(join(workspace, "docs/features/F-1"), lib.newLock(A, { origin: { kind: "active-plugin", client: "codex", plugin_version: A.version }, at: "2026-11-06T00:00:00Z", featureId: "F-1" }));
    const storeReal = lib.canonicalAnchor(store);

    const server = new Launcher(workspace, env);
    try {
      await server.initialize();
      const spec = { objective: "deliver", scope: { paths: ["docs/contract/**"] }, dependencies: [], expected_deliverable: "x", verification_criteria: ["node --version runs"] };
      const parent = await server.call("bridge_create_task", { spec });
      await server.call("bridge_claim_task", { task_id: parent["task_id"] });
      await server.call("bridge_set_state", { task_id: parent["task_id"], to: "WORKING" });
      await server.call("bridge_feature_create", { feature_id: "F-1", parent_task_id: parent["task_id"] });
      expect((await server.call("bridge_workflow_status", {}))["runtime"]).toMatchObject({ binding: "configured" });

      const run = (key: string, ack?: string) => server.call("bridge_feature_run", { feature_id: "F-1", spec, deadline_ms: 20_000, idempotency_key: key, ...(ack ? { workflow_identity: ack } : {}) });
      const unbound = await run("r0", A.identity);
      expect(unbound["error"]).toMatchObject({ code: "WORKFLOW_REFUSED", details: { code: "WORKFLOW_UNBOUND" } });
      expect(existsSync(argvFile)).toBe(false); // no worker

      expect(await server.call("bridge_workflow_bind", { feature_id: "F-1", lock_path: "docs/features/F-1/workflow.lock.json", expected_identity: A.identity, idempotency_key: "b" }))
        .toMatchObject({ result: "BOUND", generation: 1 });
      expect((await run("r1", B.identity))["error"]).toMatchObject({ details: { code: "WORKFLOW_ACK_MISMATCH" } });
      expect(existsSync(argvFile)).toBe(false);

      const first = await run("r1", A.identity);
      expect(first["task"]?.["state"], server.stderr.join("").slice(-1500)).toBe("DONE");
      const argv1 = (JSON.parse(readFileSync(argvFile, "utf8")) as { args: string[] }).args;
      expect(pluginDirs(argv1)).toEqual([join(repoRoot, "plugins/bridge-claude"), join(storeReal, A.workflow_id, "claude")]);
      expect(argv1.join("\n")).not.toContain("plugins/feature-workflow-claude");
      const prompt1 = argv1[argv1.indexOf("-p") + 1]!;
      expect(prompt1).toContain(`WORKFLOW=${A.version} IDENTITY=${A.identity} GENERATION=1 ROOT=${join(storeReal, A.workflow_id, "claude")}`);
      expect(prompt1).toContain(`INSTRUCTIONS=bundle:${A.workflow_id}`);

      const switched = await server.call("bridge_workflow_switch", { feature_id: "F-1", target_identity: B.identity, expected_generation: 1, idempotency_key: "s" });
      expect(switched, JSON.stringify(switched)).toMatchObject({ result: "SWITCHED", generation: 2 });
      expect((await run("r2", A.identity))["error"]).toMatchObject({ details: { code: "WORKFLOW_ACK_MISMATCH" } });
      const second = await run("r2", B.identity);
      expect(second["task"]?.["state"]).toBe("DONE");
      const argv2 = (JSON.parse(readFileSync(argvFile, "utf8")) as { args: string[] }).args;
      expect(argv2[argv2.indexOf("--resume") + 1]).toBe(argv1.includes("--session-id") ? argv1[argv1.indexOf("--session-id") + 1] : "11111111-2222-4333-8444-555555555555");
      expect(pluginDirs(argv2)).toEqual([join(repoRoot, "plugins/bridge-claude"), join(storeReal, B.workflow_id, "claude")]);
      const prompt2 = argv2[argv2.indexOf("-p") + 1]!;
      expect(prompt2).toContain(`IDENTITY=${B.identity} GENERATION=2`);
      expect(prompt2).toContain("supersede every earlier workflow instruction visible in this session");

      // The admitted bundle disappears: the next round is refused before any worker starts.
      unlinkSync(argvFile);
      lib.makeWritable(join(store, B.workflow_id));
      rmSync(join(store, B.workflow_id), { recursive: true });
      const missing = await run("r3", B.identity);
      expect(missing["error"]).toMatchObject({ code: "WORKFLOW_REFUSED", details: { code: "BUNDLE_MISSING" } });
      expect(existsSync(argvFile)).toBe(false);
      expect((await server.call("bridge_workflow_status", { feature_id: "F-1" }))).toMatchObject({ bundle: "missing:BUNDLE_MISSING", binding: { generation: 2 } });
    } finally {
      await server.stop();
    }
  }, 120_000);
});
