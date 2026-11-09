import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error installer JS
import { mcpDefinition, renderCodexBlock } from "./workspace.mjs";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

it("leaves the workspace to the client for both portable and legacy configurations", () => {
  for (const profile of ["legacy", "dispatcher"]) {
    expect(mcpDefinition(null, profile)).not.toHaveProperty("cwd");
    expect(renderCodexBlock(null, profile)).not.toMatch(/^cwd\s*=/m);
    expect(renderCodexBlock(null, profile, { historicalCwd: true })).toContain('cwd = "."');
  }
});

// Explicit opt-in: this is a real Codex app-server probe, not a simulated client.
// Isolated home, local unreachable provider, no login, no turn/start and no paid model.
// Both projects have an entry: detecting a silent wrong-project start is essential.
const binary = process.env.BRIDGE_TEST_CODEX_BINARY;
describe.runIf(Boolean(binary))("native Codex conversation cwd", () => {
  it("starts MCP in the requested and inherited worktrees while the server cwd stays elsewhere", async () => {
    expect(isAbsolute(binary!)).toBe(true);
    const root = realpathSync(mkdtempSync(join(tmpdir(), "bridge native startup ")));
    roots.push(root);
    const project = join(root, "project A"), foreign = join(root, "project B"), inherited = join(root, "inherited C");
    const home = join(root, "codex-home");
    mkdirSync(home);
    const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_AUTHOR_NAME: "fixture", GIT_COMMITTER_NAME: "fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
    const git = (cwd: string, ...args: string[]) => {
      const r = spawnSync("git", ["-C", cwd, ...args], { env: gitEnv, encoding: "utf8" });
      expect(r.status, r.stderr).toBe(0);
    };
    const entry = `import {createInterface} from 'node:readline';
import {writeFileSync} from 'node:fs';
writeFileSync('observed.json',JSON.stringify({cwd:process.cwd()}));
for await (const line of createInterface({input:process.stdin})) {
 const m=JSON.parse(line); if(m.id===undefined) continue;
 let result={};
 if(m.method==='initialize') result={protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'synthetic',version:'1'}};
 if(m.method==='tools/list') result={tools:[{name:'synthetic_probe',description:'probe',inputSchema:{type:'object',properties:{}}}]};
 console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));
}`;
    for (const path of [project, foreign]) {
      mkdirSync(join(path, ".bridge-project"), { recursive: true });
      mkdirSync(join(path, ".codex"));
      writeFileSync(join(path, ".bridge-project/entry.mjs"), entry);
      writeFileSync(join(path, ".codex/config.toml"), renderCodexBlock(null, "dispatcher"));
      git(path, "init", "-q"); git(path, "add", "."); git(path, "commit", "-qm", "synthetic fixture");
    }
    git(project, "worktree", "add", "-b", "inherited", inherited);
    writeFileSync(join(home, "config.toml"), 'model="synthetic"\nmodel_provider="fixture"\n' +
      '[model_providers.fixture]\nname="Fixture"\nbase_url="http://127.0.0.1:9/v1"\nwire_api="responses"\n' +
      [project, foreign, inherited].map(path => `[projects.${JSON.stringify(path)}]\ntrust_level="trusted"\n`).join(""));
    const proc = spawn(binary!, ["app-server", "--stdio"], { cwd: foreign,
      env: { PATH: process.env.PATH!, CODEX_HOME: home, TMPDIR: root }, stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "", stderr = "", nextId = 0;
    const pending = new Map<number, { resolve: (r: any) => void; reject: (e: Error) => void }>();
    proc.stderr.on("data", b => { stderr = (stderr + b.toString()).slice(-4000); });
    proc.stdout.on("data", b => {
      buffer += b.toString();
      while (buffer.includes("\n")) {
        const at = buffer.indexOf("\n"), line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
        let r; try { r = JSON.parse(line); } catch { continue; }
        const waiter = pending.get(r.id);
        if (waiter) { pending.delete(r.id); waiter.resolve(r); }
      }
    });
    const fail = (e: Error) => { for (const w of pending.values()) w.reject(e); pending.clear(); };
    proc.on("error", fail); proc.on("exit", code => fail(new Error(`app-server exit ${code}: ${stderr}`)));
    async function request(method: string, params: unknown): Promise<any> {
      const id = ++nextId;
      let timer: ReturnType<typeof setTimeout>;
      try {
        const r: any = await new Promise((resolve, reject) => {
          timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timeout: ${stderr}`)); }, 30000);
          pending.set(id, { resolve, reject });
          proc.stdin.write(JSON.stringify({ id, method, params }) + "\n");
        });
        expect(r.error, `${method}: ${JSON.stringify(r.error)}`).toBeUndefined();
        return r.result;
      } finally { clearTimeout(timer!); }
    }
    try {
      await request("initialize", { clientInfo: { name: "bridge_startup_regression", version: "1" }, capabilities: { experimentalApi: true } });
      proc.stdin.write('{"method":"initialized"}\n');
      for (const cwd of [project, inherited]) {
        const result = await request("thread/start", { cwd, model: "synthetic", modelProvider: "fixture", ephemeral: true,
          approvalPolicy: "never", sandbox: "read-only" });
        const status = await request("mcpServerStatus/list", { threadId: result.thread.id, serverName: "bridge" });
        expect(status.data[0]?.tools).toHaveProperty("synthetic_probe");
        expect(JSON.parse(readFileSync(join(cwd, "observed.json"), "utf8")).cwd).toBe(cwd);
        expect(existsSync(join(foreign, "observed.json"))).toBe(false);

      }
    } finally {
      await new Promise<void>(resolve => {
        if (proc.exitCode !== null || proc.signalCode !== null) return resolve();
        const timer = setTimeout(() => proc.kill("SIGTERM"), 3000);
        proc.once("exit", () => { clearTimeout(timer); resolve(); });
        proc.stdin.end();
      });
    }
  }, 90000);
});
