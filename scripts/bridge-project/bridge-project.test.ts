// Behaviour of the distribution: installing a pinned runtime, preparing a worktree, and the
// launch gate of the committed entry point.
//
// Nothing here is a fixture stand-in. One real runtime is built once for the whole file with the
// product's own installer, from this repository's HEAD commit, into a temporary home; every case
// then runs against that runtime, real git worktrees and the real launch gate. No model is
// involved and no client is required.

import { createHash } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const PLUGIN_ENTRY = join(REPO, "plugins", "bridge-codex", "scripts", "plugin-packages", "bridge-plugin.mjs");

const { status } = await import(join(HERE, "locate.mjs"));
const { resolveWorkspaceRoot } = await import(join(HERE, "dispatch.mjs"));
const { PROJECT_DECLARATION, PROJECT_ENTRY, declarationContent, mcpDefinition, renderCodexBlock } = await import(
  join(REPO, "scripts", "setup", "workspace.mjs")
);
const { installRuntime, loadRuntime, verifyRuntime } = await import(join(REPO, "scripts", "setup", "runtime.mjs"));

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.invalid",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.invalid",
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", env: GIT_ENV }).trim();
}

function makeRepo(path: string): string {
  mkdirSync(path, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", path], { env: GIT_ENV });
  writeFileSync(join(path, "README.md"), "project\n");
  git(path, "add", "-A");
  git(path, "commit", "-qm", "init");
  return real(path);
}

function real(path: string): string {
  return execFileSync("realpath", [path], { encoding: "utf8" }).trim();
}

function listing(dir: string): string[] {
  return spawnSync("find", [dir, "-mindepth", "1"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean).sort();
}

function digestOf(dir: string): string {
  return spawnSync("sh", ["-c", `find ${JSON.stringify(dir)} -type f -exec sha256sum {} + | sort | sha256sum`], {
    encoding: "utf8",
  }).stdout.trim();
}

// Read-only SQLite may create/update technical WAL/SHM sidecars. Compare domain files
// and logs individually so a failure identifies the changed source, as in diagnose.test.ts.
function stateFingerprint(dir: string): Record<string, string> {
  const result: Record<string, string> = {};
  const visit = (base: string, prefix: string) => {
    for (const item of readdirSync(base, { withFileTypes: true })) {
      if (/-(wal|shm|journal)$/u.test(item.name)) continue;
      const name = `${prefix}${item.name}`;
      if (item.isDirectory()) visit(join(base, item.name), `${name}/`);
      else if (item.isFile()) result[name] = createHash("sha256").update(readFileSync(join(base, item.name))).digest("hex");
    }
  };
  visit(dir, "");
  return result;
}

function removeTree(path: string): void {
  // Installed runtimes are read-only on purpose; make them writable before deleting the sandbox.
  spawnSync("chmod", ["-R", "u+w", path]);
  rmSync(path, { recursive: true, force: true });
}

/** The environment a client would give the entry point, without the test runner's own injections. */
function childEnv(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === "NODE_OPTIONS" || key === "NODE_V8_COVERAGE" || key.startsWith("VITEST")) continue;
    out[key] = value;
  }
  // The test runner puts `node_modules/.bin` first, which shadows the host `codex` with the
  // pinned development dependency. A client's environment does not, and the compatibility guard
  // legitimately refuses the shadowed version, so the runner's own entries are removed here.
  out.PATH = (process.env.PATH ?? "")
    .split(":")
    .filter((entry) => !entry.includes("node_modules/.bin"))
    .join(":");
  return { ...out, ...extra };
}

/** `bridge-plugin.mjs` exactly as the generated Codex package ships it. */
function plugin(cwd: string, args: string[], env: NodeJS.ProcessEnv) {
  const out = spawnSync(process.execPath, [PLUGIN_ENTRY, ...args], { cwd, encoding: "utf8", env: childEnv(env) });
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(out.stdout);
  } catch {
    json = null;
  }
  return { code: out.status, stdout: out.stdout, stderr: out.stderr, json };
}

// ---------------------------------------------------------------------------
// one real runtime for the whole file
// ---------------------------------------------------------------------------

let sharedHome: string;
let runtimeId: string;
let runtimeCommit: string;
let runtimePath: string;

beforeAll(() => {
  sharedHome = mkdtempSync(join(tmpdir(), "bridge-home-"));
  runtimeCommit = git(REPO, "rev-parse", "HEAD");
  // Built with a client-like environment: the runner's NODE_OPTIONS and `node_modules/.bin`
  // would otherwise reach `npm ci` and `npm run build` inside the immutable install.
  const { runtime } = installRuntime({ source: REPO, ref: runtimeCommit, home: sharedHome, env: childEnv({}) });
  runtimeId = runtime.id;
  runtimePath = runtime.path;
  expect(existsSync(join(runtimePath, PROJECT_ENTRY_SOURCE()))).toBe(true);
  expect(verifyRuntime(loadRuntime(sharedHome, runtimeId))).toEqual([]);
  const built = join(runtimePath, "shared/control-plane/dist/index.js");
  if (!existsSync(built)) {
    throw new Error(`the installed runtime was not built: ${built} is missing\n${readFileSync(join(runtimePath, "install.log"), "utf8").slice(-3000)}`);
  }
}, 600_000);

function PROJECT_ENTRY_SOURCE(): string {
  return "scripts/bridge-project/entry-template.mjs";
}

afterAll(() => {
  if (sharedHome) removeTree(sharedHome);
});

let root: string;
let project: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bridge-project-"));
  project = makeRepo(join(root, "a project with spaces"));
  env = { CLAUDE_CODEX_BRIDGE_HOME: sharedHome };
});

/** Exchange namespaces live outside the sandbox, so anything created there is removed by hand. */
const cleanupIntents: string[] = [];

afterEach(() => {
  for (const path of cleanupIntents.splice(0)) rmSync(path, { recursive: true, force: true });
  if (root) removeTree(root);
});

const setup = (cwd = project, extra: string[] = []) =>
  plugin(cwd, ["setup", "--yes", "--json", "--source", REPO, "--commit", runtimeCommit, ...extra], env);

// ---------------------------------------------------------------------------

describe("installation from the distribution", () => {
  it("installs the pinned runtime and prepares a clean project with no runtime id from the caller", () => {
    const result = setup();
    expect(result.code, JSON.stringify({ refusals: (result.json as any)?.refusals, conflicts: (result.json as any)?.conflicts })).toBe(0);
    expect(result.json?.applied).toBe(true);
    expect((result.json as any).runtime.id).toBe(runtimeId);
    expect((result.json as any).runtime_installed_now).toBe(false); // the shared runtime is already there
    const paths = ((result.json as any).changes as { path: string }[]).map((c) => c.path).sort();
    expect(paths).toEqual([PROJECT_DECLARATION, PROJECT_ENTRY, ".bridge-runtime/current", ".codex/config.toml", ".gitignore"].sort());
    expect(status(project, env).state).toBe("ready");
  });

  it("writes a local selection record and a selection symlink, not just a declaration", () => {
    setup();
    const record = JSON.parse(readFileSync(join(project, ".bridge-runtime/install.json"), "utf8"));
    expect(record.runtime.id).toBe(runtimeId);
    expect(record.workspace.root).toBe(project);
    expect(real(join(project, ".bridge-runtime/current"))).toBe(real(runtimePath));
  });

  it("copies no instruction file into the project and keeps the entry point minimal", () => {
    setup();
    expect(existsSync(join(project, ".agents/skills"))).toBe(false);
    expect(existsSync(join(project, ".claude/skills"))).toBe(false);
    expect(existsSync(join(project, ".codex/skills"))).toBe(false);
    const committed = readdirSync(join(project, ".bridge-project")).sort();
    expect(committed).toEqual(["bridge.json", "entry.mjs"]);
    const lines = readFileSync(join(project, PROJECT_ENTRY), "utf8").split("\n").length;
    expect(lines).toBeLessThan(80);
  });

  it("points the manager at instructions inside the installed runtime", () => {
    setup();
    const report = status(project, env);
    expect(report.instructions.root).toBe(runtimePath);
    for (const key of ["workflow_skills", "codex_role_skill", "exchange_helper", "claude_executor_package"]) {
      expect(existsSync((report.instructions as Record<string, string>)[key])).toBe(true);
      expect((report.instructions as Record<string, string>)[key].startsWith(runtimePath)).toBe(true);
    }
  });

  it("is idempotent", () => {
    setup();
    const again = setup();
    expect(again.code).toBe(0);
    expect((again.json as any).changes).toEqual([]);
  });

  it("writes a managed block with no home directory, machine path or runtime id", () => {
    setup();
    const toml = readFileSync(join(project, ".codex/config.toml"), "utf8");
    expect(toml).toContain(`args = ["./${PROJECT_ENTRY}"`);
    expect(toml).not.toContain(sharedHome);
    expect(toml).not.toContain(runtimeId);
    expect(mcpDefinition({}, "dispatcher").required).toBe(false);
    expect(renderCodexBlock({}, "dispatcher")).toContain("env_vars");
  });
});

describe("reads and refusals never mutate", () => {
  it("status writes nothing in a project that is not enabled", () => {
    const before = listing(project);
    const report = status(project, env);
    expect(report.state).toBe("not-enabled");
    expect(listing(project)).toEqual(before);
  });

  it("a dry run writes nothing", () => {
    const planned = plugin(project, ["setup", "--json", "--source", REPO, "--commit", runtimeCommit], env);
    expect((planned.json as any).applied).toBe(false);
    expect((planned.json as any).changes.length).toBeGreaterThan(0);
    expect(existsSync(join(project, ".bridge-project"))).toBe(false);
  });

  it("refuses a project whose config already defines mcp_servers.bridge, leaving the bytes unchanged", () => {
    mkdirSync(join(project, ".codex"), { recursive: true });
    const custom = '[mcp_servers.bridge]\ncommand = "my-own-server"\n';
    writeFileSync(join(project, ".codex/config.toml"), custom);
    const result = setup();
    expect(result.code).toBe(1);
    expect((result.json as any).ok).toBe(false);
    expect(((result.json as any).conflicts as { code: string }[])[0].code).toBe("CODEX_CONFIG_CONFLICT");
    // Exactly one table, exactly the user's bytes.
    expect(readFileSync(join(project, ".codex/config.toml"), "utf8")).toBe(custom);
    expect(existsSync(join(project, ".bridge-project"))).toBe(false);
  });

  it("refuses a copied setup record without rewriting it", () => {
    mkdirSync(join(project, ".bridge-runtime"), { recursive: true });
    const foreign = JSON.stringify({
      format: "claude-codex-bridge.workspace-install/v1",
      workspace: { kind: "git", root: "/somewhere/else", git_dir: "/somewhere/else/.git" },
      runtime: { id: runtimeId },
    });
    writeFileSync(join(project, ".bridge-runtime/install.json"), foreign);
    const result = setup();
    expect(result.code).toBe(1);
    expect(((result.json as any).refusals as { code: string }[]).map((r) => r.code)).toContain("SETUP_RECORD_FOREIGN");
    expect(readFileSync(join(project, ".bridge-runtime/install.json"), "utf8")).toBe(foreign);
  });

  it("refuses a hand edited entry point instead of overwriting it", () => {
    setup();
    const edited = `${readFileSync(join(project, PROJECT_ENTRY), "utf8")}\n// my own change\n`;
    writeFileSync(join(project, PROJECT_ENTRY), edited);
    const result = setup();
    expect(result.code).toBe(1);
    expect(((result.json as any).conflicts as { code: string }[]).map((c) => c.code)).toContain("PROJECT_FILE_MODIFIED");
    expect(readFileSync(join(project, PROJECT_ENTRY), "utf8")).toBe(edited);
  });

  it("keeps a hand edited file when asked to, instead of refusing", () => {
    setup();
    const edited = `${readFileSync(join(project, PROJECT_ENTRY), "utf8")}\n// my own change\n`;
    writeFileSync(join(project, PROJECT_ENTRY), edited);
    const result = setup(project, ["--keep-local"]);
    expect(result.code).toBe(0);
    expect(((result.json as any).kept_local as { path: string }[]).map((k) => k.path)).toContain(PROJECT_ENTRY);
    expect(readFileSync(join(project, PROJECT_ENTRY), "utf8")).toBe(edited);
  });

  it("refuses to write through a symlinked managed path", () => {
    const elsewhere = join(root, "elsewhere");
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(project, ".bridge-project"));
    const result = setup();
    expect(result.code).toBe(1);
    expect(JSON.stringify((result.json as any).refusals)).toMatch(/symlink|REDIRECT/iu);
    expect(existsSync(join(elsewhere, "bridge.json"))).toBe(false);
  });

  it("preserves the user's own content around the managed blocks", () => {
    mkdirSync(join(project, ".codex"), { recursive: true });
    writeFileSync(join(project, ".codex/config.toml"), 'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "true"\n');
    writeFileSync(join(project, ".gitignore"), "node_modules/\n*.log\n");
    mkdirSync(join(project, ".agents/skills/my-own"), { recursive: true });
    writeFileSync(join(project, ".agents/skills/my-own/SKILL.md"), "the user's own skill\n");
    expect(setup().code).toBe(0);
    const toml = readFileSync(join(project, ".codex/config.toml"), "utf8");
    expect(toml).toContain('model = "gpt-5"');
    expect(toml).toContain("[mcp_servers.other]");
    expect(toml.match(/\[mcp_servers\.bridge\]/gu)?.length).toBe(1);
    expect(readFileSync(join(project, ".gitignore"), "utf8")).toContain("*.log");
    expect(readFileSync(join(project, ".agents/skills/my-own/SKILL.md"), "utf8")).toBe("the user's own skill\n");
  });
});

describe("concurrent and interrupted preparation", () => {
  it("two simultaneous first uses leave one consistent result and no half-written state", () => {
    const args = ["setup", "--yes", "--json", "--source", REPO, "--commit", runtimeCommit];
    const runs = [0, 1].map(() =>
      spawn(process.execPath, [PLUGIN_ENTRY, ...args], { cwd: project, env: childEnv(env) }),
    );
    const codes = runs.map(
      (child) =>
        new Promise<number>((resolveCode) => {
          child.on("exit", (code) => resolveCode(code ?? 1));
        }),
    );
    return Promise.all(codes).then((results) => {
      expect(results.filter((code) => code === 0).length).toBeGreaterThanOrEqual(1);
      expect(status(project, env).state).toBe("ready");
      const record = JSON.parse(readFileSync(join(project, ".bridge-runtime/install.json"), "utf8"));
      expect(record.runtime.id).toBe(runtimeId);
      expect(existsSync(join(project, ".bridge-runtime/pending.json"))).toBe(false);
    });
  }, 120_000);

  it("an interrupted apply is completed by the next run, not left half applied", () => {
    // The product's own fault injection: kill the process after the first write of an apply.
    const killed = spawnSync(
      process.execPath,
      [PLUGIN_ENTRY, "setup", "--yes", "--json", "--source", REPO, "--commit", runtimeCommit],
      { cwd: project, encoding: "utf8", env: childEnv({ ...env, CLAUDE_CODEX_BRIDGE_TEST_CRASH_AFTER: "1" }) },
    );
    expect(killed.status).not.toBe(0);
    expect(existsSync(join(project, ".bridge-runtime/pending.json"))).toBe(true);
    const finished = setup();
    expect(finished.code).toBe(0);
    expect(status(project, env).state).toBe("ready");
    expect(existsSync(join(project, ".bridge-runtime/pending.json"))).toBe(false);
  }, 120_000);
});

/**
 * Start the committed entry point exactly as a client would, feed it MCP frames and collect what
 * it answered. The launch gate runs inside that process, so a refusal is observed the way a user
 * observes it: on stderr, with nothing served.
 */
async function launchEntry(
  cwd: string,
  { frames = [] as unknown[], waitMs = 3500, env: extraEnv = {} as NodeJS.ProcessEnv, preload = "" } = {},
) {
  const child = spawn(process.execPath, [...(preload ? ["--import", preload] : []), join(cwd, PROJECT_ENTRY), "--caller", "codex", "--delegation", "allow"], {
    cwd,
    env: childEnv({ ...env, ...extraEnv }),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  child.stdout.on("data", (chunk) => (out += chunk));
  child.stderr.on("data", (chunk) => (err += chunk));
  for (const frame of frames) child.stdin.write(`${JSON.stringify(frame)}\n`);
  const exited = await new Promise<number | null>((done) => {
    const timer = setTimeout(() => done(null), waitMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      done(code ?? 1);
    });
  });
  const replies = out
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { child, exited, stdout: out, stderr: err, replies };
}

/**
 * A synthetic native turn envelope.
 *
 * The identity guard authorises on the request `_meta` a Codex host sends, so a model-free client
 * can produce it. Nothing here fakes authorisation: the guard validates every field, and a call
 * without this envelope is refused exactly as it was before.
 */
const NATIVE_THREAD = "01a0b000-0000-7000-8000-00000000abcd";
const NATIVE_META = {
  threadId: NATIVE_THREAD,
  "x-codex-turn-metadata": {
    session_id: NATIVE_THREAD,
    thread_id: NATIVE_THREAD,
    codex_version: "0.154.0",
    thread_source: "cli",
  },
};

const nativeMeta = (thread: string) => ({
  threadId: thread,
  "x-codex-turn-metadata": { session_id: thread, thread_id: thread, codex_version: "0.154.0", thread_source: "cli" },
});

const mutationFrom = (thread: string, key: string) => ({
  jsonrpc: "2.0",
  id: 2,
  method: "tools/call",
  params: {
    name: "bridge_create_task",
    _meta: nativeMeta(thread),
    arguments: {
      spec: {
        objective: "materialise this worktree",
        scope: { paths: ["README.md"] },
        expected_deliverable: "nothing",
        verification_criteria: ["none"],
      },
      idempotency_key: key,
    },
  },
});

const authorizedMutation = (key: string) => ({
  jsonrpc: "2.0",
  id: 2,
  method: "tools/call",
  params: {
    name: "bridge_create_task",
    _meta: NATIVE_META,
    arguments: {
      spec: {
        objective: "materialise this worktree",
        scope: { paths: ["README.md"] },
        expected_deliverable: "nothing",
        verification_criteria: ["none"],
      },
      idempotency_key: key,
    },
  },
});

const unauthorizedMutation = () => {
  const { params, ...rest } = authorizedMutation("unauthorised");
  const { _meta, ...withoutMeta } = params as Record<string, unknown>;
  return { ...rest, params: withoutMeta };
};

const HANDSHAKE = [
  { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "w14-test", version: "1" } } },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 1, method: "tools/list" },
];

describe("the launch gate", () => {
  const declarationOf = (path: string) => JSON.parse(readFileSync(join(path, PROJECT_DECLARATION), "utf8"));
  const rewrite = (path: string, value: unknown) =>
    writeFileSync(join(path, PROJECT_DECLARATION), `${JSON.stringify(value, null, 2)}\n`);

  it("serves a prepared worktree and binds that worktree's own database", async () => {
    setup();
    const run = await launchEntry(project, { frames: HANDSHAKE });
    expect(run.replies.find((frame: any) => frame.id === 0)?.result?.serverInfo?.name, run.stderr).toBe("bridge-native-project");
    expect(run.replies.find((frame: any) => frame.id === 1)?.result?.tools?.length).toBeGreaterThan(10);
    expect(run.stderr).toContain(`workspace=${project}`);
    expect(run.stderr).toContain(`db=${join(project, ".bridge/bridge.db")}`);
    // A handshake and a tool listing are reads: they bind this worktree and create no state.
    expect(existsSync(join(project, ".bridge/bridge.db"))).toBe(false);
    run.child.kill("SIGKILL");
  }, 60_000);

  it("refuses and serves nothing when the applied selection and the declared pin differ", async () => {
    setup();
    const other = installRuntime({ source: REPO, ref: git(REPO, "rev-parse", `${runtimeCommit}~1`), home: sharedHome, env: childEnv({}) }).runtime;
    rewrite(project, { ...declarationOf(project), pinned: { runtime_id: other.id, commit: other.manifest.source.commit } });
    const run = await launchEntry(project, { frames: HANDSHAKE });
    expect(run.stderr).toContain("PIN_DIVERGED");
    expect(run.replies).toEqual([]);
    expect(run.exited).toBe(1);
  }, 600_000);

  it("refuses a copied setup record and never rewrites it", async () => {
    setup();
    const record = JSON.parse(readFileSync(join(project, ".bridge-runtime/install.json"), "utf8"));
    record.workspace.root = "/somewhere/else";
    const bytes = JSON.stringify(record);
    writeFileSync(join(project, ".bridge-runtime/install.json"), bytes);
    const run = await launchEntry(project, { frames: HANDSHAKE });
    expect(run.stderr).toContain("SETUP_RECORD_FOREIGN");
    expect(run.replies).toEqual([]);
    expect(readFileSync(join(project, ".bridge-runtime/install.json"), "utf8")).toBe(bytes);
    expect(existsSync(join(project, ".bridge/bridge.db"))).toBe(false);
  }, 60_000);

  it("refuses a worktree whose local state is partial, without repairing it", async () => {
    setup();
    // A selection removed while the state directory remains is not a pristine inherited worktree:
    // it is a half-removed setup, and it is refused rather than silently re-created.
    removeTree(join(project, ".bridge-runtime"));
    mkdirSync(join(project, ".bridge"), { recursive: true });
    writeFileSync(join(project, ".bridge/marker"), "left behind\n");
    const run = await launchEntry(project, { frames: HANDSHAKE });
    expect(run.stderr).toContain("SETUP_STATE_PARTIAL");
    expect(run.replies).toEqual([]);
    expect(existsSync(join(project, ".bridge-runtime"))).toBe(false);
    expect(readFileSync(join(project, ".bridge/marker"), "utf8")).toBe("left behind\n");
  }, 60_000);

  it("refuses a disabled project and an unrecognised declaration", async () => {
    setup();
    rewrite(project, { ...declarationOf(project), enabled: false });
    expect((await launchEntry(project, { frames: HANDSHAKE })).stderr).toContain("disabled");
    rewrite(project, { format: "something/else" });
    expect((await launchEntry(project, { frames: HANDSHAKE })).stderr).toMatch(/not a recognised bridge declaration/u);
  }, 60_000);

  it("refuses a pin whose commit does not match the runtime answering to its id", async () => {
    setup();
    rewrite(project, { ...declarationOf(project), pinned: { runtime_id: runtimeId, commit: "0".repeat(40) } });
    const run = await launchEntry(project, { frames: HANDSHAKE });
    expect(run.stderr).toContain("PIN_COMMIT_MISMATCH");
    expect(run.replies).toEqual([]);
  }, 60_000);

  it("resolves the worktree from its own directory, never from PWD", () => {
    const sub = join(project, "sub dir", "deeper");
    mkdirSync(sub, { recursive: true });
    expect(resolveWorkspaceRoot(sub)).toBe(project);
  });
});

describe("closing the client", () => {
  it("runs the server in the entry process itself and leaves nothing behind on SIGTERM", async () => {
    setup();
    const run = await launchEntry(project, { frames: HANDSHAKE });
    expect(run.exited).toBe(null); // still serving
    // No wrapper: the entry point is the server, so there is no child to orphan.
    expect(spawnSync("pgrep", ["-P", String(run.child.pid)], { encoding: "utf8" }).stdout.trim()).toBe("");
    run.child.kill("SIGTERM");
    const closed = await new Promise<boolean>((done) => {
      const timer = setTimeout(() => done(false), 10_000);
      run.child.on("exit", () => {
        clearTimeout(timer);
        done(true);
      });
    });
    expect(closed).toBe(true);
    expect(spawnSync("pgrep", ["-f", join(project, PROJECT_ENTRY)], { encoding: "utf8" }).stdout.trim()).toBe("");
  }, 60_000);
});

describe("an inherited worktree serves without any manual step (AC-03)", () => {
  /** Enable the project, commit it, and hand back a worktree that inherits it untouched. */
  function inherit(name: string): string {
    setup();
    git(project, "add", "-A");
    git(project, "commit", "-qm", "enable bridge");
    const external = join(root, name);
    git(project, "worktree", "add", "-q", "-b", name.replace(/\s+/gu, "-"), external);
    return real(external);
  }

  it("inherits the declaration and entry point and none of its own local state", () => {
    const external = inherit("an inherited worktree");
    expect(existsSync(join(external, PROJECT_DECLARATION))).toBe(true);
    expect(existsSync(join(external, PROJECT_ENTRY))).toBe(true);
    expect(existsSync(join(external, ".bridge-runtime"))).toBe(false);
    expect(existsSync(join(external, ".bridge"))).toBe(false);
    expect(status(external, env).state).toBe("inherited-pristine");
  }, 120_000);

  it("serves a handshake and reads with zero writes, with no setup call at all", async () => {
    const external = inherit("a read only worktree");
    const before = listing(external);
    const run = await launchEntry(external, { frames: HANDSHAKE });
    expect(run.replies.find((f: any) => f.id === 0)?.result?.serverInfo?.name, run.stderr).toBe("bridge-native-project");
    expect(run.replies.find((f: any) => f.id === 1)?.result?.tools?.length).toBeGreaterThan(10);
    expect(run.stderr).toContain(`workspace=${external}`);
    expect(listing(external)).toEqual(before);
    expect(existsSync(join(external, ".bridge-runtime"))).toBe(false);
    run.child.kill("SIGKILL");
  }, 120_000);

  it("materialises its own selection on the first authorised mutation, in the same process", async () => {
    const external = inherit("a mutating worktree");
    const run = await launchEntry(external, { frames: [...HANDSHAKE, authorizedMutation("w14-materialise")] });
    const result = run.replies.find((f: any) => f.id === 2);
    expect(result?.result?.isError, JSON.stringify(result)).toBeFalsy();
    expect(JSON.parse(result.result.content[0].text).state).toBe("PENDING");

    // Its own record, its own selection, its own database — written by that one call.
    const record = JSON.parse(readFileSync(join(external, ".bridge-runtime/install.json"), "utf8"));
    expect(record.workspace.root).toBe(external);
    expect(record.runtime.id).toBe(runtimeId);
    expect(real(join(external, ".bridge-runtime/current"))).toBe(real(runtimePath));
    expect(existsSync(join(external, ".bridge/bridge.db"))).toBe(true);
    expect(status(external, env).state).toBe("ready");
    const stopped = new Promise<void>((done) => run.child.once("exit", () => done()));
    run.child.kill("SIGTERM");
    await stopped;
    // Joint wave13/wave14 path: real installed dispatcher writes diagnostics, and the
    // installed exporter describes its plugin without starting an agent or changing state.
    const before = stateFingerprint(join(external, ".bridge"));
    const task = JSON.parse(result.result.content[0].text).task_id;
    const exported = spawnSync(process.execPath, [join(runtimePath, "scripts/bridge.mjs"), "diagnose",
      "--workspace", external, "--task", task, "--home", sharedHome, "--json"],
      { encoding: "utf8", env: childEnv({ ...env, HOME: root }), timeout: 120_000 });
    expect(exported.status, exported.stderr + exported.stdout).toBe(0);
    const { readZip } = await import("../diagnostics/zip.mjs");
    const entries = readZip(JSON.parse(exported.stdout).package);
    const doctor = JSON.parse(entries.get("doctor.json")!.toString());
    expect(doctor.distribution.integration_source).toBe("project-dispatcher");
    expect(doctor.distribution.runtime.commit).toBe(runtimeCommit);
    expect(doctor.distribution.package.name).toBe("bridge-claude");
    expect(doctor.distribution.executor.observed_plugin_dir).toBeNull();
    expect(doctor.distribution.pin.diverged).toBe(false);
    expect([...entries.keys()].some((name) => name.startsWith("logs/"))).toBe(true);
    expect(stateFingerprint(join(external, ".bridge"))).toEqual(before);
  }, 120_000);

  it("writes nothing when a mutation is not authorised by the native guard", async () => {
    const external = inherit("an unauthorised worktree");
    const before = listing(external);
    const run = await launchEntry(external, { frames: [...HANDSHAKE, unauthorizedMutation()] });
    const result = run.replies.find((f: any) => f.id === 2);
    expect(result?.result?.isError).toBe(true);
    expect(result.result.content[0].text).toContain("NATIVE_CONTEXT_INVALID");
    expect(listing(external)).toEqual(before);
    expect(existsSync(join(external, ".bridge-runtime"))).toBe(false);
    run.child.kill("SIGKILL");
  }, 120_000);

  it("refuses partial local state instead of materialising over it", async () => {
    const external = inherit("a partial worktree");
    mkdirSync(join(external, ".bridge-runtime"), { recursive: true });
    writeFileSync(join(external, ".bridge-runtime/install.json"), "{ not json");
    const run = await launchEntry(external, { frames: HANDSHAKE });
    expect(run.stderr).toMatch(/SETUP_RECORD_INVALID|SETUP_STATE_PARTIAL/u);
    expect(run.replies).toEqual([]);
    expect(readFileSync(join(external, ".bridge-runtime/install.json"), "utf8")).toBe("{ not json");
  }, 120_000);

  it("binds its own database, not the one of the checkout it came from", async () => {
    const external = inherit("a second worktree");
    const run = await launchEntry(external, { frames: HANDSHAKE });
    expect(run.stderr, run.stderr).toContain(`workspace=${external}`);
    expect(run.stderr).toContain(`db=${join(external, ".bridge/bridge.db")}`);
    expect(run.stderr).not.toContain(`db=${join(project, ".bridge/bridge.db")}`);
    run.child.kill("SIGKILL");
  }, 120_000);

  it("two inherited worktrees materialise independently and concurrently", async () => {
    setup();
    git(project, "add", "-A");
    git(project, "commit", "-qm", "enable bridge");
    const a = join(root, "worktree a");
    const b = join(root, "worktree b");
    git(project, "worktree", "add", "-q", "-b", "wt-a", a);
    git(project, "worktree", "add", "-q", "-b", "wt-b", b);
    const runs = await Promise.all([
      launchEntry(real(a), { frames: [...HANDSHAKE, authorizedMutation("a")] }),
      launchEntry(real(b), { frames: [...HANDSHAKE, authorizedMutation("b")] }),
    ]);
    for (const [index, where] of [a, b].entries()) {
      const result = runs[index].replies.find((f: any) => f.id === 2);
      expect(result?.result?.isError, runs[index].stderr).toBeFalsy();
      const record = JSON.parse(readFileSync(join(real(where), ".bridge-runtime/install.json"), "utf8"));
      expect(record.workspace.root).toBe(real(where));
      runs[index].child.kill("SIGKILL");
    }
  }, 180_000);
});

/**
 * W15-C1: the committed entry point answers a pure read about this project's pin.
 *
 * A worktree inherited through Git has no `.bridge-runtime/current` and the machine may have no
 * bridge plugin at all, so this read is the only portable way to learn which instruction set the
 * project's pin selects. It resolves the runtime from the pin, never from a local selection.
 */
describe("the project entry point reports without serving (W15-C1)", () => {
  function entryStatus(cwd: string, extraEnv: NodeJS.ProcessEnv = {}, flag = "--status") {
    const out = spawnSync(process.execPath, [join(cwd, PROJECT_ENTRY), flag], {
      cwd,
      encoding: "utf8",
      env: childEnv({ ...env, ...extraEnv }),
      timeout: 60_000,
    });
    let json: any = null;
    try {
      json = JSON.parse(out.stdout);
    } catch {
      json = null;
    }
    return { code: out.status, stdout: out.stdout, stderr: out.stderr, json };
  }

  function inherit(name: string): string {
    setup();
    git(project, "add", "-A");
    git(project, "commit", "-qm", "enable bridge");
    const external = real(join(root, name));
    git(project, "worktree", "add", "-q", "-b", name.replace(/\s+/gu, "-"), external);
    return external;
  }

  it("answers in a pristine inherited worktree, with no selection and no write", () => {
    const external = inherit("a pristine reporting worktree");
    expect(existsSync(join(external, ".bridge-runtime"))).toBe(false);
    const before = listing(external);

    const report = entryStatus(external);
    expect(report.code, report.stdout + report.stderr).toBe(0);
    expect(report.json.ok).toBe(true);
    expect(report.json.state).toBe("inherited-pristine");
    expect(report.json.reads_only).toBe(true);
    // The instruction paths come from the pinned runtime, and they exist.
    expect(report.json.instructions.root).toBe(runtimePath);
    for (const key of ["workflow_skills", "codex_role_skill", "exchange_helper", "claude_executor_package"]) {
      expect(existsSync(report.json.instructions[key]), key).toBe(true);
    }
    expect(report.json.preference).toMatchObject({ path: "AGENTS.md", managed_block: "absent", authoritative: false });
    // A read is a read: no selection, no database, no state of any kind.
    expect(listing(external)).toEqual(before);
    expect(existsSync(join(external, ".bridge-runtime"))).toBe(false);
    expect(existsSync(join(external, ".bridge"))).toBe(false);
  }, 180_000);

  // W15-I4: a marker pair proves nothing about consent. Only the exact block this runtime writes
  // is recognised, and even that is reported as an observation, never as authorization.
  it("never presents a marker pair as consent, and flags a rewritten block as modified", () => {
    setup();
    expect(entryStatus(project).json.state).toBe("ready");

    // Markers around text that says the opposite of the preference.
    writeFileSync(
      join(project, "AGENTS.md"),
      "# rules\n\n# >>> claude-codex-bridge managed block >>>\nNever delegate implementation.\n# <<< claude-codex-bridge managed block <<<\n",
    );
    const contradiction = entryStatus(project, {}, "--instructions");
    expect(contradiction.code).toBe(0);
    expect(contradiction.json.preference.managed_block).toBe("modified");
    expect(contradiction.json.preference.authoritative).toBe(false);
    expect(contradiction.json.preference.note).toMatch(/prohibition always wins/iu);
    expect(contradiction.json.preference).not.toHaveProperty("declared");
    expect(contradiction.json.instructions.root).toBe(runtimePath);

    // The exact block the setup writes is the only thing reported as known.
    expect(setup(project, ["--with-preference", "--keep-local"]).code).toBe(1); // a modified block is refused
    writeFileSync(join(project, "AGENTS.md"), "# rules\n");
    expect(setup(project, ["--with-preference"]).code).toBe(0);
    expect(entryStatus(project).json.preference.managed_block).toBe("known");
  }, 180_000);

  it("reports the absence of the pinned runtime instead of serving or installing it", () => {
    const external = inherit("a runtimeless worktree");
    const emptyHome = join(root, "an empty bridge home");
    const before = listing(external);
    const report = entryStatus(external, { CLAUDE_CODEX_BRIDGE_HOME: emptyHome });
    expect(report.code).toBe(1);
    expect(report.json.ok).toBe(false);
    expect(report.json.error.code).toBe("RUNTIME_NOT_INSTALLED");
    expect(report.json.instructions).toBeNull();
    expect(report.json.next_step).toMatch(/setup/iu);
    // Reporting a missing runtime installs nothing, here or under the named home.
    expect(existsSync(emptyHome)).toBe(false);
    expect(listing(external)).toEqual(before);
  }, 180_000);

  it("reports a pin whose commit does not match, and a declaration it cannot recognise", () => {
    setup();
    const declaration = JSON.parse(readFileSync(join(project, PROJECT_DECLARATION), "utf8"));
    writeFileSync(
      join(project, PROJECT_DECLARATION),
      `${JSON.stringify({ ...declaration, pinned: { runtime_id: runtimeId, commit: "0".repeat(40) } }, null, 2)}\n`,
    );
    const mismatch = entryStatus(project);
    expect(mismatch.code).toBe(1);
    expect(mismatch.json.state).toBe("pin-commit-mismatch");
    expect(mismatch.json.instructions).toBeNull();

    writeFileSync(join(project, PROJECT_DECLARATION), `${JSON.stringify({ format: "something/else" }, null, 2)}\n`);
    const unrecognised = entryStatus(project);
    expect(unrecognised.code).toBe(1);
    expect(unrecognised.json.error.code).toBe("DECLARATION_INVALID");
    expect(unrecognised.json.instructions).toBeNull();
  }, 180_000);

  it("records the preference only when the plugin setup is explicitly asked, showing the diff", () => {
    setup();
    const own = "# Project rules\n\nKeep this line.\n";
    writeFileSync(join(project, "AGENTS.md"), own);
    // The ordinary path never touches it, so a plugin update cannot introduce a policy.
    expect(setup().code).toBe(0);
    expect(readFileSync(join(project, "AGENTS.md"), "utf8")).toBe(own);
    expect(entryStatus(project).json.preference.managed_block).toBe("absent");

    const planned = plugin(project, ["setup", "--with-preference", "--json", "--source", REPO, "--commit", runtimeCommit], env);
    expect(planned.code, planned.stdout + planned.stderr).toBe(0);
    expect((planned.json as any).applied).toBe(false);
    const change = ((planned.json as any).changes as { path: string; diff?: string }[]).find((c) => c.path === "AGENTS.md");
    expect(change?.diff, JSON.stringify((planned.json as any).changes)).toContain("+## Bridge");
    expect(readFileSync(join(project, "AGENTS.md"), "utf8")).toBe(own); // a plan writes nothing

    const applied = setup(project, ["--with-preference"]);
    expect(applied.code, applied.stdout + applied.stderr).toBe(0);
    const written = readFileSync(join(project, "AGENTS.md"), "utf8");
    expect(written.startsWith(own)).toBe(true);
    expect(written).toContain("entry.mjs --status");
    expect(written).not.toContain(sharedHome);
    expect(written).not.toContain(runtimeId);
    expect(entryStatus(project).json.preference.managed_block).toBe("known");

    // Idempotent, and the plain path still leaves it alone.
    expect(((setup(project, ["--with-preference"]).json as any).changes as { path: string }[]).some((c) => c.path === "AGENTS.md")).toBe(false);
    expect(setup().code).toBe(0);
    expect(readFileSync(join(project, "AGENTS.md"), "utf8")).toBe(written);
  }, 180_000);

  // W15-I2: a project with no AGENTS.md, or an empty one, must still see the proposed text.
  it("shows the proposed preference as a diff when AGENTS.md is absent or empty", () => {
    for (const [name, seed] of [["absent", null], ["empty", ""]] as [string, string | null][]) {
      const fresh = makeRepo(join(root, `a ${name} agents project`));
      expect(plugin(fresh, ["setup", "--yes", "--json", "--source", REPO, "--commit", runtimeCommit], env).code).toBe(0);
      if (seed !== null) writeFileSync(join(fresh, "AGENTS.md"), seed);
      const planned = plugin(fresh, ["setup", "--with-preference", "--json", "--source", REPO, "--commit", runtimeCommit], env);
      expect(planned.code, planned.stdout + planned.stderr).toBe(0);
      const change = ((planned.json as any).changes as { path: string; action: string; diff?: string }[])
        .find((c) => c.path === "AGENTS.md");
      expect(change, `${name}: ${JSON.stringify((planned.json as any).changes)}`).toBeTruthy();
      expect(change!.action).toBe(seed === null ? "create" : "append");
      expect(change!.diff, `${name}: no diff`).toContain("+## Bridge");
      expect(change!.diff).toContain("+`node ./.bridge-project/entry.mjs --status`");
      expect(existsSync(join(fresh, "AGENTS.md"))).toBe(seed !== null); // a plan writes nothing
    }
  }, 300_000);

  // W15-I1: the preference names an entry point, so the entry point must exist and answer.
  it("writes a preference whose named entry point really runs", () => {
    setup();
    expect(setup(project, ["--with-preference"]).code).toBe(0);
    const block = readFileSync(join(project, "AGENTS.md"), "utf8");
    const named = block.match(/`node (\.\/[^`]+?) --status`/u);
    expect(named, block).toBeTruthy();
    expect(existsSync(join(project, named![1]))).toBe(true);
    const run = spawnSync(process.execPath, [named![1], "--status"], { cwd: project, encoding: "utf8", env: childEnv(env), timeout: 60_000 });
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(JSON.parse(run.stdout).instructions.root).toBe(runtimePath);
  }, 180_000);

  // W15-I3: one classification. A pin whose commit does not match must look the same from the
  // plugin and from the entry point, and must hand out no instructions from either.
  it("classifies a pin commit mismatch identically in the plugin and the entry point", () => {
    setup();
    const declaration = JSON.parse(readFileSync(join(project, PROJECT_DECLARATION), "utf8"));
    writeFileSync(
      join(project, PROJECT_DECLARATION),
      `${JSON.stringify({ ...declaration, pinned: { runtime_id: runtimeId, commit: "0".repeat(40) } }, null, 2)}\n`,
    );
    const before = listing(project);

    const fromPlugin = plugin(project, ["status", "--json"], env);
    expect(fromPlugin.code).toBe(1);
    expect((fromPlugin.json as any).state).toBe("pin-commit-mismatch");
    expect((fromPlugin.json as any).runtime.state).toBe("pin-commit-mismatch");
    expect((fromPlugin.json as any).instructions).toBeNull();
    expect((fromPlugin.json as any).next_step).toMatch(/pins commit/u);

    const fromEntry = entryStatus(project);
    expect(fromEntry.code).toBe(1);
    expect(fromEntry.json.state).toBe("pin-commit-mismatch");
    expect(fromEntry.json.instructions).toBeNull();
    expect(fromEntry.json.next_step).toBe((fromPlugin.json as any).next_step);
    expect(listing(project)).toEqual(before);
  }, 180_000);

  // W15-I5: the shipped entry skill stays a trigger plus setup boundaries. The workflow itself
  // must come from the pinned runtime, so the package must not carry its own copy of it.
  it("ships a thin entry skill that defers to the pinned instructions", () => {
    const skill = readFileSync(join(REPO, "plugins", "bridge-codex", "skills", "bridge", "SKILL.md"), "utf8");
    expect(skill).toContain("instructions.codex_role_skill");
    expect(skill).toMatch(/requires a runtime that ships it|RUNTIME_WITHOUT_STATUS/u);
    // No second, unpinned copy of the classification the role skill owns.
    expect(skill).not.toMatch(/a finished plan or design does not need to be redesigned/u);
    expect(skill).not.toMatch(/unapproved proposal is a subject for a decision/u);
  });

  // W15-C2: the pre-bootstrap intent file must live in this worktree's own exchange namespace.
  // Writing it into `.bridge/` would make the very bootstrap it precedes refuse to run.
  it("lets a real bootstrap proceed with an intent file in the exchange namespace", async () => {
    const external = inherit("an intent bearing worktree");
    const exchange = spawnSync(
      "python3",
      [join(REPO, ".agents/skills/feature-exchange/scripts/feature_exchange.py"), "namespace", "--repo", external],
      { encoding: "utf8", env: childEnv(env) },
    );
    expect(exchange.status, exchange.stderr).toBe(0);
    const space = JSON.parse(exchange.stdout);
    expect(space.namespace.startsWith(external)).toBe(false); // outside the repository

    // One file, written atomically, before any mutation of this worktree.
    const intents = join(space.namespace, "intents");
    mkdirSync(intents, { recursive: true });
    const intentPath = join(intents, "root-task-F-W15-root.json");
    const intent = JSON.stringify({ op: "root-task", key: "F-W15:root", request: { objective: "Coordinate F-W15" } });
    writeFileSync(`${intentPath}.tmp`, intent);
    renameSync(`${intentPath}.tmp`, intentPath);
    cleanupIntents.push(intents);

    // The bootstrap is untouched by it: a read still writes nothing, and the first authorised
    // mutation prepares this worktree exactly as it does without an intent file.
    const before = listing(external);
    const readOnly = await launchEntry(external, { frames: HANDSHAKE });
    expect(readOnly.replies.find((f: any) => f.id === 1)?.result?.tools?.length, readOnly.stderr).toBeGreaterThan(10);
    expect(listing(external)).toEqual(before);
    readOnly.child.kill("SIGKILL");

    const run = await launchEntry(external, { frames: [...HANDSHAKE, authorizedMutation("w15-intent")] });
    const reply = run.replies.find((f: any) => f.id === 2);
    expect(reply?.result?.isError, JSON.stringify(reply) + run.stderr.slice(-400)).toBeFalsy();
    expect(JSON.parse(readFileSync(join(external, ".bridge-runtime/install.json"), "utf8")).workspace.root).toBe(external);
    expect(readFileSync(intentPath, "utf8")).toBe(intent); // the manager's file, untouched
    run.child.kill("SIGKILL");
  }, 180_000);

  it("would have blocked that same bootstrap had the intent gone into .bridge/", async () => {
    const external = inherit("a misplaced intent worktree");
    mkdirSync(join(external, ".bridge"), { recursive: true });
    writeFileSync(join(external, ".bridge/root-task-F-W15-root.json"), '{"op":"root-task"}\n');
    const run = await launchEntry(external, { frames: HANDSHAKE });
    expect(run.stderr).toContain("SETUP_STATE_PARTIAL");
    expect(run.replies).toEqual([]);
    expect(existsSync(join(external, ".bridge-runtime"))).toBe(false);
  }, 180_000);

  it("still reports for a disabled project, which refuses to serve", async () => {
    setup();
    const declaration = JSON.parse(readFileSync(join(project, PROJECT_DECLARATION), "utf8"));
    writeFileSync(join(project, PROJECT_DECLARATION), `${JSON.stringify({ ...declaration, enabled: false }, null, 2)}\n`);
    const report = entryStatus(project);
    expect(report.code).toBe(0);
    expect(report.json.state).toBe("project-disabled");
    expect(report.json.next_step).toMatch(/disabled/iu);
    expect((await launchEntry(project, { frames: HANDSHAKE })).stderr).toContain("disabled");
  }, 180_000);
});

/**
 * W15-I8: the preference names an entry point that comes from the *target* runtime, so a project
 * pinned to a runtime older than the read-only mode would be told to run a read that never
 * answers. The refusal has to be decided from what that runtime actually ships, and it has to
 * happen before anything is written.
 *
 * The historical runtime is built here from a real commit of this repository — the parent of the
 * commit that introduced the mode — into the suite's own temporary home. The machine's installed
 * runtimes are never touched.
 */
describe("the preference refuses a target runtime that cannot serve it (W15-I8)", () => {
  let historicalId: string;

  beforeAll(() => {
    const introduced = git(REPO, "log", "--format=%H", "-S", '"--instructions"', "--", "scripts/bridge-project/entry-template.mjs")
      .split("\n")
      .filter(Boolean)
      .at(-1);
    if (!introduced) throw new Error("cannot locate the commit that introduced the read-only entry mode");
    const before = git(REPO, "rev-parse", `${introduced}~1`);
    const { runtime } = installRuntime({ source: REPO, ref: before, home: sharedHome, env: childEnv({}) });
    historicalId = runtime.id;
    // The precondition this case exists for, read off the target itself.
    expect(existsSync(join(runtime.path, "scripts/bridge-project/entry-template.mjs"))).toBe(true);
    expect(readFileSync(join(runtime.path, "scripts/bridge-project/entry-template.mjs"), "utf8")).not.toContain("--status");
  }, 900_000);

  it("refuses before any write, and that target really cannot answer the read", () => {
    const before = listing(project);
    const refused = plugin(project, ["setup", "--yes", "--json", "--to", historicalId, "--with-preference"], env);
    expect(refused.code, refused.stdout + refused.stderr).toBe(1);
    expect((refused.json as any).ok).toBe(false);
    expect((refused.json as any).applied).toBe(false);
    const refusal = ((refused.json as any).refusals as { code: string; message: string; nextStep: string }[])
      .find((entry) => entry.code === "PREFERENCE_UNSUPPORTED_RUNTIME");
    expect(refusal, JSON.stringify((refused.json as any).refusals)).toBeTruthy();
    expect(refusal!.message).toContain(historicalId);
    expect(refusal!.nextStep).toMatch(/pin is never moved for you/u);

    // Zero project writes: no declaration, no entry point, no config block, no AGENTS.md.
    expect(listing(project)).toEqual(before);
    expect(existsSync(join(project, PROJECT_DECLARATION))).toBe(false);
    expect(existsSync(join(project, "AGENTS.md"))).toBe(false);

    // And the refusal is not theoretical. Prepare the same project on that same historical
    // runtime *without* the preference — which stays allowed — and run the entry point the
    // preference would have named: it answers with no status JSON at all.
    expect(plugin(project, ["setup", "--yes", "--json", "--to", historicalId], env).code).toBe(0);
    const asked = spawnSync(process.execPath, [join(project, PROJECT_ENTRY), "--status"], {
      cwd: project,
      encoding: "utf8",
      env: childEnv(env),
      input: "",
      timeout: 60_000,
    });
    expect(() => JSON.parse(asked.stdout)).toThrow();
    expect(asked.stdout).not.toContain("instructions");
  }, 900_000);

  it("still records the preference when the target does serve the read", () => {
    expect(setup().code).toBe(0);
    const applied = setup(project, ["--with-preference"]);
    expect(applied.code, applied.stdout + applied.stderr).toBe(0);
    const block = readFileSync(join(project, "AGENTS.md"), "utf8");
    expect(block).toContain("entry.mjs --status");
    // The named entry point answers here, which is the whole difference from the case above.
    const asked = spawnSync(process.execPath, [join(project, PROJECT_ENTRY), "--status"], {
      cwd: project,
      encoding: "utf8",
      env: childEnv(env),
      input: "",
      timeout: 60_000,
    });
    expect(asked.status, asked.stdout + asked.stderr).toBe(0);
    expect(JSON.parse(asked.stdout).instructions.root).toBe(runtimePath);
  }, 300_000);
});

describe("update and rollback while the worktree is in use", () => {
  it("refuses to move the pin while a bridge server is serving this worktree", async () => {
    setup();
    const older = installRuntime({ source: REPO, ref: git(REPO, "rev-parse", `${runtimeCommit}~1`), home: sharedHome, env: childEnv({}) }).runtime;
    const run = await launchEntry(project, { frames: [...HANDSHAKE, authorizedMutation("hold-open")] });
    expect(run.replies.find((f: any) => f.id === 2)?.result?.isError, run.stderr).toBeFalsy();
    try {
      const moved = plugin(project, ["update", "--to", older.id, "--yes", "--json"], env);
      expect(moved.code).toBe(1);
      const codes = ((moved.json as any).refusals as { code: string }[]).map((r) => r.code);
      expect(codes).toContain("ACTIVE_SESSION");
      // Nothing moved: the declaration and the applied selection still name the served runtime.
      expect(JSON.parse(readFileSync(join(project, PROJECT_DECLARATION), "utf8")).pinned.runtime_id).toBe(runtimeId);
      expect(JSON.parse(readFileSync(join(project, ".bridge-runtime/install.json"), "utf8")).runtime.id).toBe(runtimeId);
    } finally {
      run.child.kill("SIGKILL");
    }
  }, 600_000);
});

describe("two first uses of the SAME worktree (W14-R2-06)", () => {
  it("produces exactly one owner, refuses the other as a foreign manager, and leaves neither stuck", async () => {
    setup();
    git(project, "add", "-A");
    git(project, "commit", "-qm", "enable bridge");
    const external = real(join(root, "one shared worktree"));
    git(project, "worktree", "add", "-q", "-b", "shared", external);

    // Both processes complete the handshake first, so both hold the worktree's database open when
    // the mutations arrive. That is the situation in which the process scan used to veto both.
    const both = await Promise.all([
      launchEntry(external, { frames: [...HANDSHAKE, mutationFrom("same-worktree-a", "a")], waitMs: 6000 }),
      launchEntry(external, { frames: [...HANDSHAKE, mutationFrom("same-worktree-b", "b")], waitMs: 6000 }),
    ]);
    try {
      const outcomes = both.map((run) => {
        const reply = run.replies.find((f: any) => f.id === 2);
        if (!reply) return "no reply";
        if (!reply.result?.isError) return "owner";
        return JSON.parse(reply.result.content[0].text).error.code as string;
      });
      expect(outcomes.filter((o) => o === "owner").length, JSON.stringify({ outcomes, err: both.map((r) => r.stderr.slice(-300)) })).toBe(1);
      expect(outcomes.filter((o) => o === "MANAGER_FOREIGN_THREAD").length).toBe(1);

      // One selection, naming this worktree; no interrupted apply left behind.
      const record = JSON.parse(readFileSync(join(external, ".bridge-runtime/install.json"), "utf8"));
      expect(record.workspace.root).toBe(external);
      expect(record.runtime.id).toBe(runtimeId);
      expect(existsSync(join(external, ".bridge-runtime/pending.json"))).toBe(false);

      // Neither process is wedged: both still answer a read afterwards.
      for (const run of both) run.child.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" })}\n`);
      await new Promise((done) => setTimeout(done, 2500));
    } finally {
      for (const run of both) run.child.kill("SIGKILL");
    }
  }, 300_000);

  it("keeps the ordinary CLI active-session refusal while a server is serving", async () => {
    setup();
    const older = installRuntime({ source: REPO, ref: git(REPO, "rev-parse", `${runtimeCommit}~1`), home: sharedHome, env: childEnv({}) }).runtime;
    const run = await launchEntry(project, { frames: [...HANDSHAKE, authorizedMutation("hold")] });
    try {
      const moved = plugin(project, ["update", "--to", older.id, "--yes", "--json"], env);
      expect(moved.code).toBe(1);
      expect(((moved.json as any).refusals as { code: string }[]).map((r) => r.code)).toContain("ACTIVE_SESSION");
    } finally {
      run.child.kill("SIGKILL");
    }
  }, 600_000);
});

describe("an interrupted automatic first use (W14-R2-07)", () => {
  function inheritedWorktree(name: string): string {
    setup();
    git(project, "add", "-A");
    git(project, "commit", "-qm", "enable bridge");
    const external = real(join(root, name));
    git(project, "worktree", "add", "-q", "-b", name.replace(/\s+/gu, "-"), external);
    return external;
  }

  it("recovers at the next authorised mutation, after a pure read, with no manual setup", async () => {
    const external = inheritedWorktree("an interrupted worktree");

    // The product's own fault injection, inside the first authorised mutation.
    const crashed = await launchEntry(external, {
      frames: [...HANDSHAKE, mutationFrom("interrupted", "k1")],
      env: { CLAUDE_CODEX_BRIDGE_TEST_CRASH_AFTER: "1" },
      waitMs: 8000,
    });
    crashed.child.kill("SIGKILL");
    expect(existsSync(join(external, ".bridge-runtime/pending.json"))).toBe(true);
    expect(existsSync(join(external, ".bridge-runtime/install.json"))).toBe(false);

    // A restart serves reads and still writes nothing.
    const before = listing(external);
    const readOnly = await launchEntry(external, { frames: HANDSHAKE });
    expect(readOnly.replies.find((f: any) => f.id === 1)?.result?.tools?.length, readOnly.stderr).toBeGreaterThan(10);
    expect(listing(external)).toEqual(before);
    readOnly.child.kill("SIGKILL");

    // The next authorised mutation completes the interrupted apply.
    const recovered = await launchEntry(external, { frames: [...HANDSHAKE, mutationFrom("interrupted", "k2")], waitMs: 8000 });
    const reply = recovered.replies.find((f: any) => f.id === 2);
    expect(reply?.result?.isError, JSON.stringify(reply) + recovered.stderr.slice(-400)).toBeFalsy();
    expect(JSON.parse(readFileSync(join(external, ".bridge-runtime/install.json"), "utf8")).workspace.root).toBe(external);
    expect(existsSync(join(external, ".bridge-runtime/pending.json"))).toBe(false);
    recovered.child.kill("SIGKILL");
  }, 300_000);

  it("refuses a journal copied from another worktree instead of resuming it", async () => {
    const external = inheritedWorktree("a copied journal worktree");
    mkdirSync(join(external, ".bridge-runtime"), { recursive: true });
    const foreign = `${JSON.stringify({
      format: "claude-codex-bridge.workspace-pending/v1",
      action: "init",
      workspace: { kind: "git", root: "/somewhere/else", git_dir: "/somewhere/else/.git" },
      runtime_id: runtimeId,
      tag: "deadbeef",
      paths: [],
    })}\n`;
    writeFileSync(join(external, ".bridge-runtime/pending.json"), foreign);
    const run = await launchEntry(external, { frames: HANDSHAKE });
    expect(run.stderr).toContain("SETUP_STATE_PARTIAL");
    expect(run.replies).toEqual([]);
    expect(readFileSync(join(external, ".bridge-runtime/pending.json"), "utf8")).toBe(foreign);
    expect(existsSync(join(external, ".bridge-runtime/install.json"))).toBe(false);
  }, 180_000);

  it("refuses a tampered or runtime-mismatched journal", async () => {
    const external = inheritedWorktree("a tampered journal worktree");
    mkdirSync(join(external, ".bridge-runtime"), { recursive: true });
    for (const body of [
      "{ not json",
      JSON.stringify({ format: "claude-codex-bridge.workspace-pending/v1", action: "init", workspace: { kind: "git", root: external, git_dir: join(external, ".git") }, runtime_id: "0.1.0-000000000000", tag: "t", paths: [] }),
      JSON.stringify({ format: "claude-codex-bridge.workspace-pending/v1", action: "init", runtime_id: runtimeId, tag: "t", paths: [] }),
    ]) {
      writeFileSync(join(external, ".bridge-runtime/pending.json"), body);
      const run = await launchEntry(external, { frames: HANDSHAKE });
      expect(run.stderr, body.slice(0, 60)).toContain("SETUP_STATE_PARTIAL");
      expect(run.replies).toEqual([]);
      expect(readFileSync(join(external, ".bridge-runtime/pending.json"), "utf8")).toBe(body);
    }
  }, 180_000);
});

describe("every interruption boundary recovers itself (W14-R2-07)", () => {
  function inherit(name: string): string {
    setup();
    git(project, "add", "-A");
    git(project, "commit", "-qm", "enable bridge");
    const external = real(join(root, name));
    git(project, "worktree", "add", "-q", "-b", name.replace(/\s+/gu, "-"), external);
    return external;
  }

  /**
   * A one-shot preload that kills this process at a chosen point of the apply.
   *
   * `mkdir` fires at the first `.bridge-runtime` creation, either before it happens or immediately
   * after it returns; `symlink` fires at the selection link, i.e. after the journal is published
   * and before anything is selected. The later boundaries use the product's own
   * `CLAUDE_CODEX_BRIDGE_TEST_CRASH_AFTER` counter.
   */
  function killAt(where: "mkdir-before" | "mkdir-after" | "symlink"): string {
    const file = join(root, `kill-${where}.mjs`);
    const kill = 'process.kill(process.pid, "SIGKILL");';
    const body =
      where === "symlink"
        ? [
            'const original = fs.symlinkSync;',
            `fs.symlinkSync = function (...args) { ${kill} return original.apply(this, args); };`,
          ]
        : [
            "const original = fs.mkdirSync;",
            'fs.mkdirSync = function (path, ...args) {',
            '  if (String(path).endsWith("/.bridge-runtime")) {',
            where === "mkdir-after"
              ? `    const result = original.call(this, path, ...args); ${kill} return result;`
              : `    ${kill}`,
            "  }",
            "  return original.call(this, path, ...args);",
            "};",
          ];
    writeFileSync(file, ['import fs from "node:fs";', 'import { syncBuiltinESMExports } from "node:module";', ...body, "syncBuiltinESMExports();"].join("\n"));
    return `file://${file}`;
  }

  /** Crash at `where`, then prove a pure read and then an authorised mutation recover. */
  async function recoversAfter(
    name: string,
    injection: { preload?: string; env?: NodeJS.ProcessEnv },
    expected: { localDir: boolean; pending: boolean; record: boolean },
  ) {
    const external = inherit(name);
    // The native envelope's thread id is validated by the guard: it admits no spaces.
    const thread = name.replace(/\s+/gu, "-");
    const crashed = await launchEntry(external, {
      frames: [...HANDSHAKE, mutationFrom(thread, "k1")],
      waitMs: 9000,
      ...(injection.preload ? { preload: injection.preload } : {}),
      ...(injection.env ? { env: injection.env } : {}),
    });
    crashed.child.kill("SIGKILL");

    // The interruption landed where this case says it did. The runtime's own marker is always
    // there, because the reservation precedes every local write.
    expect(existsSync(join(external, ".bridge/workspace.json")), name).toBe(true);
    expect(existsSync(join(external, ".bridge-runtime")), `${name}: local directory`).toBe(expected.localDir);
    expect(existsSync(join(external, ".bridge-runtime/pending.json")), `${name}: journal`).toBe(expected.pending);
    expect(existsSync(join(external, ".bridge-runtime/install.json")), `${name}: record`).toBe(expected.record);

    // A restart serves reads and writes nothing.
    const before = listing(external);
    const readOnly = await launchEntry(external, { frames: HANDSHAKE });
    expect(readOnly.replies.find((f: any) => f.id === 1)?.result?.tools?.length, readOnly.stderr).toBeGreaterThan(10);
    expect(listing(external), `${name}: a read must write nothing`).toEqual(before);
    readOnly.child.kill("SIGKILL");

    // The next authorised mutation finishes the preparation and leaves no journal behind.
    const recovered = await launchEntry(external, { frames: [...HANDSHAKE, mutationFrom(`${thread}-2`, "k2")], waitMs: 9000 });
    expect(recovered.replies.find((f: any) => f.id === 2)?.result?.isError, `${name}: ${recovered.stderr.slice(-400)}`).toBeFalsy();
    expect(JSON.parse(readFileSync(join(external, ".bridge-runtime/install.json"), "utf8")).workspace.root).toBe(external);
    expect(existsSync(join(external, ".bridge-runtime/pending.json")), `${name}: journal left behind`).toBe(false);
    recovered.child.kill("SIGKILL");
  }

  it("recovers when the interruption came before the local directory existed", async () => {
    await recoversAfter("before mkdir", { preload: killAt("mkdir-before") }, { localDir: false, pending: false, record: false });
  }, 300_000);

  it("recovers when the interruption came right after the local directory was created", async () => {
    // The boundary W14-R2-07 left open: an empty `.bridge-runtime/` plus an own native marker.
    await recoversAfter("after mkdir", { preload: killAt("mkdir-after") }, { localDir: true, pending: false, record: false });
  }, 300_000);

  it("recovers when the interruption came after the journal and before the selection", async () => {
    await recoversAfter("after journal", { preload: killAt("symlink") }, { localDir: true, pending: true, record: false });
  }, 300_000);

  it("recovers when the interruption came after the selection", async () => {
    await recoversAfter("after selection", { env: { CLAUDE_CODEX_BRIDGE_TEST_CRASH_AFTER: "1" } }, { localDir: true, pending: true, record: false });
  }, 300_000);

  it("recovers when the interruption came after the record", async () => {
    await recoversAfter("after record", { env: { CLAUDE_CODEX_BRIDGE_TEST_CRASH_AFTER: "2" } }, { localDir: true, pending: true, record: true });
  }, 300_000);

  it("refuses a state directory that is not this worktree's own", async () => {
    const external = inherit("a foreign state worktree");
    mkdirSync(join(external, ".bridge"), { recursive: true });
    const foreign = `${JSON.stringify({ workspace_id: "ws_deadbeef", root: "/somewhere/else", database: "/somewhere/else/.bridge/bridge.db" })}\n`;
    writeFileSync(join(external, ".bridge/workspace.json"), foreign);
    const run = await launchEntry(external, { frames: HANDSHAKE });
    expect(run.stderr).toContain("SETUP_STATE_PARTIAL");
    expect(run.replies).toEqual([]);
    expect(readFileSync(join(external, ".bridge/workspace.json"), "utf8")).toBe(foreign);
    expect(existsSync(join(external, ".bridge-runtime"))).toBe(false);
  }, 180_000);

  it("treats a bare local directory as neither evidence nor contradiction", async () => {
    const external = inherit("a bare directory worktree");
    mkdirSync(join(external, ".bridge-runtime"), { recursive: true });
    writeFileSync(join(external, ".bridge-runtime/something-of-mine.txt"), "kept\n");
    // No journal, no marker, nothing that explains it: still refused, and the unknown file stays.
    const refused = await launchEntry(external, { frames: HANDSHAKE });
    expect(refused.stderr).toContain("SETUP_STATE_PARTIAL");
    expect(refused.replies).toEqual([]);
    expect(readFileSync(join(external, ".bridge-runtime/something-of-mine.txt"), "utf8")).toBe("kept\n");
    refused.child.kill("SIGKILL");
  }, 180_000);

  it("refuses a state directory with no readable marker", async () => {
    const external = inherit("an unexplained state worktree");
    mkdirSync(join(external, ".bridge"), { recursive: true });
    writeFileSync(join(external, ".bridge/bridge.db"), "not a database\n");
    const run = await launchEntry(external, { frames: HANDSHAKE });
    expect(run.stderr).toContain("SETUP_STATE_PARTIAL");
    expect(run.replies).toEqual([]);
    expect(readFileSync(join(external, ".bridge/bridge.db"), "utf8")).toBe("not a database\n");
  }, 180_000);
});

describe("rollback returns to the previous runtime (W14-R2-09)", () => {
  it("uses this worktree's own selection history, not the declared pin", () => {
    setup();
    const older = installRuntime({ source: REPO, ref: git(REPO, "rev-parse", `${runtimeCommit}~1`), home: sharedHome, env: childEnv({}) }).runtime;
    expect(plugin(project, ["update", "--to", older.id, "--yes", "--json"], env).code).toBe(0);
    expect(JSON.parse(readFileSync(join(project, PROJECT_DECLARATION), "utf8")).pinned.runtime_id).toBe(older.id);

    const back = plugin(project, ["rollback", "--yes", "--json"], env);
    expect(back.code, back.stderr).toBe(0);
    expect((back.json as any).applied).toBe(true);
    expect((back.json as any).runtime.id).toBe(runtimeId);
    // Both the committed declaration and the local selection move together.
    expect(JSON.parse(readFileSync(join(project, PROJECT_DECLARATION), "utf8")).pinned.runtime_id).toBe(runtimeId);
    expect(JSON.parse(readFileSync(join(project, ".bridge-runtime/install.json"), "utf8")).runtime.id).toBe(runtimeId);
  }, 600_000);

  it("accepts an explicit --to and refuses when there is no history to roll back to", () => {
    setup();
    const refused = plugin(project, ["rollback", "--yes", "--json"], env);
    expect(refused.code).toBe(1);
    expect(refused.stdout + refused.stderr).toContain("ROLLBACK_NO_PREVIOUS");
    expect(JSON.parse(readFileSync(join(project, PROJECT_DECLARATION), "utf8")).pinned.runtime_id).toBe(runtimeId);

    const older = installRuntime({ source: REPO, ref: git(REPO, "rev-parse", `${runtimeCommit}~1`), home: sharedHome, env: childEnv({}) }).runtime;
    const explicit = plugin(project, ["rollback", "--to", older.id, "--yes", "--json"], env);
    expect(explicit.code, explicit.stderr).toBe(0);
    expect((explicit.json as any).runtime.id).toBe(older.id);
  }, 600_000);

  it("refuses to roll back while a bridge server is serving this worktree", async () => {
    setup();
    const older = installRuntime({ source: REPO, ref: git(REPO, "rev-parse", `${runtimeCommit}~1`), home: sharedHome, env: childEnv({}) }).runtime;
    expect(plugin(project, ["update", "--to", older.id, "--yes", "--json"], env).code).toBe(0);
    const run = await launchEntry(project, { frames: [...HANDSHAKE, mutationFrom("serving", "hold")], waitMs: 6000 });
    try {
      const back = plugin(project, ["rollback", "--yes", "--json"], env);
      expect(back.code).toBe(1);
      expect(((back.json as any).refusals as { code: string }[]).map((r) => r.code)).toContain("ACTIVE_SESSION");
      expect(JSON.parse(readFileSync(join(project, PROJECT_DECLARATION), "utf8")).pinned.runtime_id).toBe(older.id);
    } finally {
      run.child.kill("SIGKILL");
    }
  }, 600_000);
});

describe("the setup plan is read-only (W14-R2-08)", () => {
  it("installs nothing and creates no bridge home without --yes", () => {
    const emptyHome = join(root, "an untouched home");
    const planned = plugin(project, ["setup", "--json", "--offline", "--source", REPO], { CLAUDE_CODEX_BRIDGE_HOME: emptyHome });
    expect(planned.code, planned.stderr).toBe(0);
    expect((planned.json as any).applied).toBe(false);
    expect((planned.json as any).runtime_installed_now).toBe(false);
    expect((planned.json as any).would_install_runtime.commit).toMatch(/^[0-9a-f]{40}$/u);
    // Neither the distribution home nor the project was touched.
    expect(existsSync(emptyHome)).toBe(false);
    expect(existsSync(join(project, ".bridge-project"))).toBe(false);
    expect(existsSync(join(project, ".codex/config.toml"))).toBe(false);
  }, 120_000);

  it("still shows a reviewable per-file plan when the runtime is already installed", () => {
    const planned = plugin(project, ["setup", "--json", "--source", REPO, "--commit", runtimeCommit], env);
    expect(planned.code).toBe(0);
    expect((planned.json as any).applied).toBe(false);
    const paths = ((planned.json as any).changes as { path: string }[]).map((c) => c.path);
    expect(paths).toContain(PROJECT_DECLARATION);
    expect(paths).toContain(".codex/config.toml");
    expect(existsSync(join(project, ".bridge-project"))).toBe(false);
  }, 120_000);
});

describe("the pin is independent of any plugin cache", () => {
  it("survives deleting a plugin cache, and a declaration names no cache path", () => {
    setup();
    const cache = join(root, "codex-home", "plugins", "cache", "m", "bridge-codex", "1.0.0");
    mkdirSync(cache, { recursive: true });
    writeFileSync(join(cache, "SKILL.md"), "a cached copy\n");
    const before = digestOf(join(runtimePath, ".agents/skills"));
    rmSync(join(root, "codex-home"), { recursive: true, force: true });
    expect(digestOf(join(runtimePath, ".agents/skills"))).toBe(before);
    expect(readFileSync(join(project, PROJECT_DECLARATION), "utf8")).not.toContain("plugins/cache");
    expect(status(project, env).state).toBe("ready");
  });

  it("the declaration content is exactly what the installed runtime would write", () => {
    setup();
    expect(readFileSync(join(project, PROJECT_DECLARATION), "utf8")).toBe(declarationContent(loadRuntime(sharedHome, runtimeId)));
  });
});
