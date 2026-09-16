// Behaviour of the distribution: installing a pinned runtime, preparing a worktree, and the
// launch gate of the committed entry point.
//
// Nothing here is a fixture stand-in. One real runtime is built once for the whole file with the
// product's own installer, from this repository's HEAD commit, into a temporary home; every case
// then runs against that runtime, real git worktrees and the real launch gate. No model is
// involved and no client is required.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
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

afterEach(() => {
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
async function launchEntry(cwd: string, { frames = [] as unknown[], waitMs = 3500 } = {}) {
  const child = spawn(process.execPath, [join(cwd, PROJECT_ENTRY), "--caller", "codex", "--delegation", "allow"], {
    cwd,
    env: childEnv(env),
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
    expect(existsSync(join(project, ".bridge/bridge.db"))).toBe(true);
    run.child.kill("SIGKILL");
  }, 60_000);

  it("refuses and serves nothing when the applied selection and the declared pin differ", async () => {
    setup();
    const other = installRuntime({ source: REPO, ref: git(REPO, "rev-parse", "HEAD~1"), home: sharedHome, env: childEnv({}) }).runtime;
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

  it("refuses a worktree that was never prepared, without creating any state", async () => {
    setup();
    removeTree(join(project, ".bridge-runtime"));
    const run = await launchEntry(project, { frames: HANDSHAKE });
    expect(run.stderr).toContain("SETUP_NOT_INITIALIZED");
    expect(run.replies).toEqual([]);
    expect(existsSync(join(project, ".bridge"))).toBe(false);
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

describe("an inherited worktree", () => {
  it("inherits the declaration and entry point and needs only its own local selection", () => {
    setup();
    git(project, "add", "-A");
    git(project, "commit", "-qm", "enable bridge");
    const external = join(root, "inherited worktree");
    git(project, "worktree", "add", "-q", "-b", "inherited", external);

    expect(existsSync(join(external, PROJECT_DECLARATION))).toBe(true);
    expect(existsSync(join(external, PROJECT_ENTRY))).toBe(true);
    expect(existsSync(join(external, ".bridge-runtime"))).toBe(false);
    expect(existsSync(join(external, ".bridge"))).toBe(false);
    expect(status(external, env).state).toBe("needs-selection");

    const prepared = setup(external);
    expect(prepared.code).toBe(0);
    // Only its own selection: no reinstall, no configuration rewrite, no instruction copy.
    expect(((prepared.json as any).changes as { path: string }[]).map((c) => c.path)).toEqual([".bridge-runtime/current"]);
    expect((prepared.json as any).runtime_installed_now).toBe(false);
    expect(status(external, env).state).toBe("ready");
  }, 120_000);

  it("binds its own database, not the one of the checkout it came from", async () => {
    setup();
    git(project, "add", "-A");
    git(project, "commit", "-qm", "enable bridge");
    const external = join(root, "second worktree");
    git(project, "worktree", "add", "-q", "-b", "second", external);
    setup(external);
    const run = await launchEntry(external, { frames: HANDSHAKE });
    expect(run.stderr, run.stderr).toContain(`workspace=${real(external)}`);
    expect(existsSync(join(external, ".bridge/bridge.db"))).toBe(true);
    expect(existsSync(join(project, ".bridge/bridge.db"))).toBe(false);
    run.child.kill("SIGKILL");
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
