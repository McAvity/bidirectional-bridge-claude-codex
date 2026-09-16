// Behaviour of the portable project dispatcher, its facade and the bootstrap it performs.
//
// Everything here runs against real temporary worktrees and real git; nothing is mocked away,
// because the properties under test are filesystem and process properties.

import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

const { status, resolveWorkspace, readLocalRecord, pathIsRedirected, bridgeHome } = await import(
  join(HERE, "locate.mjs")
);
const { prepare, acquireLock, spliceBlock, BootstrapRefusal, BLOCK_BEGIN, BLOCK_END, CODEX_CONFIG } = await import(
  join(HERE, "bootstrap.mjs")
);
const { handle, TOOLS, callTool } = await import(join(HERE, "facade.mjs"));
const { plan } = await import(join(HERE, "dispatch.mjs"));

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

function makeRepo(path: string): void {
  mkdirSync(path, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", path], { env: GIT_ENV });
  writeFileSync(join(path, "README.md"), "project\n");
  git(path, "add", "-A");
  git(path, "commit", "-qm", "init");
}

/** A fake installed runtime: enough manifest and launcher for resolution, no build. */
function installRuntime(home: string, id: string): string {
  const path = join(home, "runtimes", id);
  mkdirSync(join(path, "scripts"), { recursive: true });
  mkdirSync(join(path, ".agents/skills/feature-execute"), { recursive: true });
  mkdirSync(join(path, ".codex/skills/using-bridge"), { recursive: true });
  writeFileSync(join(path, "scripts", "native-bridge-mcp.mjs"), "// launcher\n");
  writeFileSync(join(path, ".agents/skills/feature-execute/SKILL.md"), "pinned workflow\n");
  writeFileSync(join(path, ".codex/skills/using-bridge/SKILL.md"), "pinned role\n");
  writeFileSync(
    join(path, "runtime-manifest.json"),
    JSON.stringify({
      format: "claude-codex-bridge.runtime/v1",
      runtime_id: id,
      source: { commit: "a".repeat(40) },
      compatibility: {},
      instructions: { set_sha256: "b".repeat(64), files: [] },
      mcp: { launcher: "scripts/native-bridge-mcp.mjs" },
      tree_sha256: "c".repeat(64),
    }),
  );
  return path;
}

let root: string;
let project: string;
let home: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bridge-project-"));
  project = join(root, "a project with spaces");
  home = join(root, "home");
  makeRepo(project);
  env = { ...process.env, CLAUDE_CODEX_BRIDGE_HOME: home };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const sources = () => ({
  "dispatch.mjs": readFileSync(join(HERE, "dispatch.mjs"), "utf8"),
  "locate.mjs": readFileSync(join(HERE, "locate.mjs"), "utf8"),
  "bootstrap.mjs": readFileSync(join(HERE, "bootstrap.mjs"), "utf8"),
  "facade.mjs": readFileSync(join(HERE, "facade.mjs"), "utf8"),
});

describe("workspace resolution", () => {
  it("resolves the git top level from the working directory, not from PWD", () => {
    const sub = join(project, "sub dir", "deeper");
    mkdirSync(sub, { recursive: true });
    // A misleading PWD is exactly the W14-01 failure mode; it must not be consulted.
    const resolved = resolveWorkspace(sub);
    expect(resolved.root).toBe(realish(project));
    expect(resolved.inGitRepository).toBe(true);
  });

  it("resolves an external worktree to itself, not to the main checkout", () => {
    const external = join(root, "external worktree");
    git(project, "worktree", "add", "-q", "-b", "feature", external);
    const resolved = resolveWorkspace(external);
    expect(resolved.root).toBe(realish(external));
    expect(resolved.gitDir).toContain("worktrees");
  });

  it("reports a directory outside any repository without throwing", () => {
    const loose = join(root, "loose");
    mkdirSync(loose);
    expect(resolveWorkspace(loose).inGitRepository).toBe(false);
  });
});

function realish(path: string): string {
  return execFileSync("realpath", [path], { encoding: "utf8" }).trim();
}

describe("status is a pure read", () => {
  it("reports not-enabled and writes nothing at all", () => {
    const before = listing(project);
    const report = status(project, env);
    expect(report.state).toBe("not-enabled");
    expect(report.reads_only).toBe(true);
    expect(listing(project)).toEqual(before);
  });

  it("names the installed runtime as the instruction root once prepared", () => {
    const runtime = installRuntime(home, "0.2.0-abcdefabcdef");
    prepare({ cwd: project, env, pin: { runtime_id: "0.2.0-abcdefabcdef" }, sources: sources() });
    const report = status(project, env);
    expect(report.state).toBe("needs-preparation");
    expect(report.instructions.root).toBe(runtime);
    expect(report.instructions.workflow_skills).toBe(join(runtime, ".agents/skills"));
    // The instruction set is never copied into the project.
    expect(existsSync(join(project, ".agents/skills"))).toBe(false);
    expect(existsSync(join(project, ".claude/skills"))).toBe(false);
  });
});

function listing(dir: string): string[] {
  const out = spawnSync("find", [dir, "-mindepth", "1"], { encoding: "utf8" });
  return out.stdout.split("\n").filter(Boolean).sort();
}

describe("prepare", () => {
  it("writes only the portable declaration, dispatcher, MCP block and ignore block", () => {
    installRuntime(home, "0.2.0-abcdefabcdef");
    const result = prepare({ cwd: project, env, pin: { runtime_id: "0.2.0-abcdefabcdef" }, sources: sources() });
    expect(result.applied).toBe(true);
    const paths = result.changes.map((c: { path: string }) => c.path).sort();
    expect(paths).toEqual(
      [".bridge-project/bootstrap.mjs", ".bridge-project/bridge.json", ".bridge-project/dispatch.mjs", ".bridge-project/facade.mjs", ".bridge-project/locate.mjs", ".codex/config.toml", ".gitignore"].sort(),
    );
    const declaration = JSON.parse(readFileSync(join(project, ".bridge-project/bridge.json"), "utf8"));
    expect(declaration.pinned.runtime_id).toBe("0.2.0-abcdefabcdef");
  });

  it("writes a managed block with no machine path, home directory or runtime id", () => {
    installRuntime(home, "0.2.0-abcdefabcdef");
    prepare({ cwd: project, env, pin: { runtime_id: "0.2.0-abcdefabcdef" }, sources: sources() });
    const toml = readFileSync(join(project, CODEX_CONFIG), "utf8");
    expect(toml).toContain('args = ["./.bridge-project/dispatch.mjs"');
    expect(toml).not.toContain(home);
    expect(toml).not.toContain("0.2.0-abcdefabcdef");
    expect(toml).not.toContain(process.env.HOME ?? "/nonexistent-home");
  });

  it("is idempotent: a second run changes nothing", () => {
    installRuntime(home, "0.2.0-abcdefabcdef");
    prepare({ cwd: project, env, pin: { runtime_id: "0.2.0-abcdefabcdef" }, sources: sources() });
    const again = prepare({ cwd: project, env, sources: sources() });
    expect(again.changes).toEqual([]);
  });

  it("preserves the user's own content around the managed blocks", () => {
    mkdirSync(join(project, ".codex"), { recursive: true });
    writeFileSync(join(project, ".codex/config.toml"), 'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "true"\n');
    writeFileSync(join(project, ".gitignore"), "node_modules/\n*.log\n");
    installRuntime(home, "0.2.0-abcdefabcdef");
    prepare({ cwd: project, env, pin: { runtime_id: "0.2.0-abcdefabcdef" }, sources: sources() });
    const toml = readFileSync(join(project, ".codex/config.toml"), "utf8");
    expect(toml).toContain('model = "gpt-5"');
    expect(toml).toContain("[mcp_servers.other]");
    expect(readFileSync(join(project, ".gitignore"), "utf8")).toContain("*.log");
  });

  it("refuses to write through a symlinked managed path", () => {
    installRuntime(home, "0.2.0-abcdefabcdef");
    const elsewhere = join(root, "elsewhere");
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(project, ".bridge-project"));
    expect(() => prepare({ cwd: project, env, pin: { runtime_id: "0.2.0-abcdefabcdef" }, sources: sources() })).toThrow(
      /MANAGED_PATH_IS_SYMLINK|symlink/u,
    );
    expect(existsSync(join(elsewhere, "bridge.json"))).toBe(false);
  });

  it("refuses a local record copied from another worktree and never adopts it", () => {
    installRuntime(home, "0.2.0-abcdefabcdef");
    mkdirSync(join(project, ".bridge-runtime"), { recursive: true });
    const foreign = JSON.stringify({ root: "/somewhere/else", runtime: { id: "0.1.0-000000000000" } });
    writeFileSync(join(project, ".bridge-runtime/install.json"), foreign);
    expect(() => prepare({ cwd: project, env, pin: { runtime_id: "0.2.0-abcdefabcdef" }, sources: sources() })).toThrow(
      /FOREIGN_WORKSPACE_RECORD|copied/u,
    );
    expect(readFileSync(join(project, ".bridge-runtime/install.json"), "utf8")).toBe(foreign);
    expect(existsSync(join(project, ".bridge-project/bridge.json"))).toBe(false);
  });

  it("refuses without a pin instead of guessing a runtime", () => {
    expect(() => prepare({ cwd: project, env, sources: sources() })).toThrow(/NO_PIN|pinned runtime/u);
  });

  it("dry run reports the same plan and writes nothing", () => {
    installRuntime(home, "0.2.0-abcdefabcdef");
    const planned = prepare({ cwd: project, env, pin: { runtime_id: "0.2.0-abcdefabcdef" }, dryRun: true, sources: sources() });
    expect(planned.applied).toBe(false);
    expect(planned.changes.length).toBeGreaterThan(0);
    expect(existsSync(join(project, ".bridge-project"))).toBe(false);
  });
});

describe("concurrent first use", () => {
  it("serialises two simultaneous bootstraps: the loser is refused and writes nothing", () => {
    installRuntime(home, "0.2.0-abcdefabcdef");
    const held = acquireLock(realish(project));
    try {
      let refusal: { code?: string } | null = null;
      try {
        prepare({ cwd: project, env, pin: { runtime_id: "0.2.0-abcdefabcdef" }, sources: sources() });
      } catch (error) {
        refusal = error as { code?: string };
      }
      expect(refusal?.code).toBe("BOOTSTRAP_IN_PROGRESS");
      expect(existsSync(join(project, ".bridge-project/bridge.json"))).toBe(false);
    } finally {
      held.release();
    }
  });

  it("two real processes racing produce one consistent result", () => {
    installRuntime(home, "0.2.0-abcdefabcdef");
    const script = join(root, "race.mjs");
    writeFileSync(
      script,
      `import { prepare } from ${JSON.stringify(join(HERE, "bootstrap.mjs"))};
import { readFileSync } from "node:fs";
const sources = Object.fromEntries(["dispatch.mjs","locate.mjs","bootstrap.mjs","facade.mjs"].map((n) => [n, readFileSync(${JSON.stringify(HERE)} + "/" + n, "utf8")]));
try { const r = prepare({ cwd: process.argv[2], pin: { runtime_id: "0.2.0-abcdefabcdef" }, sources }); console.log(JSON.stringify({ ok: true, changes: r.changes.length })); }
catch (e) { console.log(JSON.stringify({ ok: false, code: e.code })); }
`,
    );
    const runs = [0, 1].map(() =>
      spawnSync(process.execPath, [script, project], { encoding: "utf8", env: { ...env } }),
    );
    const results = runs.map((r) => JSON.parse(r.stdout.trim()));
    // Either both serialise cleanly, or the loser is refused; never two conflicting writes.
    const succeeded = results.filter((r) => r.ok);
    expect(succeeded.length).toBeGreaterThanOrEqual(1);
    const declaration = JSON.parse(readFileSync(join(project, ".bridge-project/bridge.json"), "utf8"));
    expect(declaration.pinned.runtime_id).toBe("0.2.0-abcdefabcdef");
    expect(existsSync(join(project, ".bridge/bootstrap.lock"))).toBe(false);
  });

  it("an interrupted bootstrap leaves a stale lock that is broken and reported, not honoured forever", () => {
    installRuntime(home, "0.2.0-abcdefabcdef");
    const stale = acquireLock(realish(project));
    const result = prepare({
      cwd: project,
      env,
      pin: { runtime_id: "0.2.0-abcdefabcdef" },
      sources: sources(),
      // the production default is ten minutes; the same code path breaks a lock older than that
      lockOptions: { staleMs: 0 },
    });
    expect(result.applied).toBe(true);
    expect(result.lock.broke_stale).toBe(true);
    stale.release();
  });
});

describe("inherited worktree", () => {
  it("a worktree created after enablement starts ready with no preparation step", () => {
    installRuntime(home, "0.2.0-abcdefabcdef");
    prepare({ cwd: project, env, pin: { runtime_id: "0.2.0-abcdefabcdef" }, sources: sources() });
    git(project, "add", "-A");
    git(project, "commit", "-qm", "enable bridge");

    const external = join(root, "inherited worktree");
    git(project, "worktree", "add", "-q", "-b", "inherited", external);

    // Inherited through git: the declaration and the dispatcher are both present, the local
    // state directories are not, and nothing has to be prepared before the client starts.
    expect(existsSync(join(external, ".bridge-project/bridge.json"))).toBe(true);
    expect(existsSync(join(external, ".bridge-project/dispatch.mjs"))).toBe(true);
    expect(existsSync(join(external, ".bridge-runtime"))).toBe(false);
    expect(existsSync(join(external, ".bridge"))).toBe(false);

    const decision = plan({ cwd: external, env });
    expect(decision.route).toBe("runtime");
    expect(decision.workspace.root).toBe(realish(external));
    expect(decision.pin.runtime_id).toBe("0.2.0-abcdefabcdef");
  });

  it("routes to the facade, not to a wrong version, when the pinned runtime is absent here", () => {
    installRuntime(home, "0.2.0-abcdefabcdef");
    prepare({ cwd: project, env, pin: { runtime_id: "0.2.0-abcdefabcdef" }, sources: sources() });
    const otherHome = join(root, "other-home");
    installRuntime(otherHome, "0.9.9-ffffffffffff");
    const decision = plan({ cwd: project, env: { ...process.env, CLAUDE_CODEX_BRIDGE_HOME: otherHome } });
    expect(decision.route).toBe("facade");
    expect(decision.runtime.state).toBe("runtime-missing");
  });
});

describe("pin and plugin cache independence", () => {
  it("the declaration and the selected runtime live outside any plugin cache", () => {
    installRuntime(home, "0.2.0-abcdefabcdef");
    prepare({ cwd: project, env, pin: { runtime_id: "0.2.0-abcdefabcdef" }, sources: sources() });
    const report = status(project, env);
    expect(report.instructions.root).toContain(join(home, "runtimes"));
    expect(report.instructions.root).not.toContain("plugins/cache");
    expect(readFileSync(join(project, ".bridge-project/bridge.json"), "utf8")).not.toContain("plugins/cache");
  });

  it("deleting a plugin cache does not disturb the pinned instruction set", () => {
    const runtime = installRuntime(home, "0.2.0-abcdefabcdef");
    prepare({ cwd: project, env, pin: { runtime_id: "0.2.0-abcdefabcdef" }, sources: sources() });
    const cache = join(root, "codex-home", "plugins", "cache", "m", "bridge-codex", "1.0.0");
    mkdirSync(cache, { recursive: true });
    writeFileSync(join(cache, "SKILL.md"), "cached copy\n");
    const before = readFileSync(join(runtime, ".agents/skills/feature-execute/SKILL.md"), "utf8");
    rmSync(join(root, "codex-home"), { recursive: true, force: true });
    expect(readFileSync(join(runtime, ".agents/skills/feature-execute/SKILL.md"), "utf8")).toBe(before);
    expect(status(project, env).state).toBe("needs-preparation");
  });

  it("a pin different from the local selection is reported, never silently switched", () => {
    installRuntime(home, "0.2.0-abcdefabcdef");
    prepare({ cwd: project, env, pin: { runtime_id: "0.2.0-abcdefabcdef" }, sources: sources() });
    mkdirSync(join(project, ".bridge-runtime"), { recursive: true });
    writeFileSync(
      join(project, ".bridge-runtime/install.json"),
      JSON.stringify({ root: realish(project), runtime: { id: "0.1.0-111111111111" } }),
    );
    expect(status(project, env).state).toBe("pin-diverged");
  });
});

describe("facade", () => {
  it("offers a static catalogue, so nothing depends on tools/list_changed", () => {
    installRuntime(home, "0.2.0-abcdefabcdef");
    const before = handle({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { cwd: project, env });
    prepare({ cwd: project, env, pin: { runtime_id: "0.2.0-abcdefabcdef" }, sources: sources() });
    const after = handle({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { cwd: project, env });
    expect(after.result.tools).toEqual(before.result.tools);
    expect(TOOLS.map((t: { name: string }) => t.name)).toEqual(["bridge_status", "bridge_prepare_worktree"]);
  });

  it("answers initialize without touching the worktree", () => {
    const before = listing(project);
    const reply = handle({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18" } }, { cwd: project, env });
    expect(reply.result.serverInfo.name).toBe("claude-codex-bridge-facade");
    expect(listing(project)).toEqual(before);
  });

  it("refuses preparation without an explicit confirmation", () => {
    const { ok, payload } = callTool("bridge_prepare_worktree", { workspace: realish(project) }, { cwd: project, env });
    expect(ok).toBe(false);
    expect(payload.code).toBe("NOT_CONFIRMED");
    expect(existsSync(join(project, ".bridge-project"))).toBe(false);
  });

  it("refuses a call that names a different workspace than the one it resolved", () => {
    const { ok, payload } = callTool(
      "bridge_prepare_worktree",
      { workspace: "/somewhere/else", confirm: true },
      { cwd: project, env },
    );
    expect(ok).toBe(false);
    expect(payload.code).toBe("WORKSPACE_MISMATCH");
    expect(existsSync(join(project, ".bridge-project"))).toBe(false);
  });
});

describe("migration protection", () => {
  it("leaves an existing wave12 managed block's neighbours and custom skills untouched", () => {
    installRuntime(home, "0.2.0-abcdefabcdef");
    mkdirSync(join(project, ".agents/skills/my-own"), { recursive: true });
    writeFileSync(join(project, ".agents/skills/my-own/SKILL.md"), "the user's own skill\n");
    mkdirSync(join(project, ".codex"), { recursive: true });
    writeFileSync(
      join(project, ".codex/config.toml"),
      `profile = "work"\n\n${BLOCK_BEGIN}\n[mcp_servers.bridge]\ncommand = "node"\nargs = [".bridge-runtime/current/scripts/native-bridge-mcp.mjs"]\n${BLOCK_END}\n\n[mcp_servers.other]\ncommand = "true"\n`,
    );
    prepare({ cwd: project, env, pin: { runtime_id: "0.2.0-abcdefabcdef" }, sources: sources() });
    const toml = readFileSync(join(project, ".codex/config.toml"), "utf8");
    expect(toml).toContain('profile = "work"');
    expect(toml).toContain("[mcp_servers.other]");
    expect(toml).toContain("./.bridge-project/dispatch.mjs");
    expect(toml).not.toContain(".bridge-runtime/current/scripts");
    expect(readFileSync(join(project, ".agents/skills/my-own/SKILL.md"), "utf8")).toBe("the user's own skill\n");
  });

  it("replaces only the managed block when splicing", () => {
    const spliced = spliceBlock(`keep me\n${BLOCK_BEGIN}\nold\n${BLOCK_END}\nkeep me too\n`, "new");
    expect(spliced).toContain("keep me");
    expect(spliced).toContain("keep me too");
    expect(spliced).toContain("new");
    expect(spliced).not.toContain("old");
  });
});
