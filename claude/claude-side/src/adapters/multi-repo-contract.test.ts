/**
 * F-W20 W20-01: what the existing runner and scope code do with a multi-repo round, no model.
 *
 * Contract: docs/features/F-W20-multi-repo-execution/contracts/01-multi-repo.md.
 * Git placement, receipt and integration probes: tests/test_multi_repo_contract.py.
 *
 * Proven here, on product code without any change: (1) `buildArgs` turns alias-prefixed scope
 * globs into literal, parent-relative `--add-dir` values and never resolves a symlinked alias;
 * (2) scope normalization and overlap are textual, so two aliases of one physical checkout do not
 * conflict; (3) through a spawned stand-in CLI and the real adapter/orchestrator/deliverable path,
 * the DELIVERY, REPOS and PACKAGE lines survive in that order at the start of the stored summary,
 * also when prose is truncated, and `changed_scope` stays the flat array the executor sent.
 * Not proven: whether Claude Code lets Edit/Write follow a symlinked `--add-dir` outside the
 * project. That needs a real client; the contract keeps the physical in-parent checkout default.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ControlPlane, Orchestrator } from "@bridge/control-plane";
import {
  DeliverableStatus, TaskState, globsOverlap, normalizePath, scopeAllows, seededRandom,
  type TaskInvocation, type TaskSpec,
} from "@bridge/protocol";
import { ClaudeAdapter } from "./claude-adapter.js";
import { ClaudeCodeRunner, CLAUDE_SUMMARY_MAX_CHARS } from "./claude-code-runner.js";

const here = dirname(fileURLToPath(import.meta.url));
const scriptedCli = join(here, "..", "..", "test", "fixtures", "scripted-claude-cli.mjs");

class ScriptedRunner extends ClaudeCodeRunner {
  override buildArgs(invocation: Parameters<ClaudeCodeRunner["buildArgs"]>[0], prompt: string): string[] {
    return [scriptedCli, ...super.buildArgs(invocation, prompt)];
  }
}

const TASK_DIR = ".feature-repos/F-X";
const CHILD = `${TASK_DIR}/child-a`;
const ALIAS = `${TASK_DIR}/ext-b`;
const LEDGER = "docs/features/F-X/execution/W-01/01.md";
const SIDECAR = "docs/features/F-X/execution/W-01/01.repos.json";
const SCOPE = ["app/**", "deps/sub", "docs/features/F-X/execution/**", `${CHILD}/src/**`, `${ALIAS}/src/**`];
const DELIVERY = /^DELIVERY=local-v1 BASE=([0-9a-f]{40}) HEAD=([0-9a-f]{40}) LEDGER=(\S+) OUTCOME=(COMPLETE|PARTIAL) WORKTREE=(clean|dirty:\d+)$/;
const REPOS = /^REPOS=(\S+) SHA256=([0-9a-f]{64})$/;
const PACKAGE = /^PACKAGE=(\S+) SHA256=([0-9a-f]{64}) PURPOSE=(\S+) RANGE=([0-9a-f]{40})\.\.([0-9a-f]{40}) LEDGER=(\S+)$/;
const pass = { kind: "test", command: "python3 -m unittest", passed: true, exit_code: 0, summary: "ok" };

const gitEnv = (home: string): NodeJS.ProcessEnv => {
  const e: NodeJS.ProcessEnv = { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  for (const name of Object.keys(e)) if (name.startsWith("GIT_") && !name.startsWith("GIT_CONFIG_")) delete e[name];
  return e;
};

function invocation(root: string, paths: string[]): TaskInvocation {
  return {
    task_id: "task_aaaaaaaaaa",
    spec: { objective: "multi-repo argv", scope: { paths }, dependencies: [], expected_deliverable: "x", verification_criteria: ["x"] },
    inputs: [], workspace_root: root, lease_id: "lease_aaaaaaaaaa", deadline_at: Date.now() + 20_000,
    attempt: 0, idempotency_key: "k", previous_execution_handle: null,
  } as TaskInvocation;
}
const addDirs = (args: readonly string[]) => args.flatMap((a, i) => (a === "--add-dir" ? [args[i + 1]!] : []));

let root: string;
let parent: string;
let external: string;
let queue: string;
let argvLog: string;
let git: (cwd: string, ...args: string[]) => string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "w20-multi-ts-")));
  parent = join(root, "parent");
  external = join(root, "external", "ext-b");
  queue = join(root, "queue");
  argvLog = join(root, "argv.log");
  const home = join(root, "home");
  for (const d of [parent, external, queue, home]) mkdirSync(d, { recursive: true });
  const env = gitEnv(home);
  git = (cwd, ...args) => execFileSync("git", ["-c", "user.email=probe@example.invalid", "-c", "user.name=Probe",
    "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8", env }).trim();
  git(parent, "init", "-q");
  mkdirSync(join(parent, "app"));
  writeFileSync(join(parent, "app", "x.txt"), "x\n");
  git(parent, "add", "--", "app/x.txt");
  git(parent, "commit", "-q", "-m", "base");
  writeFileSync(join(parent, ".git", "info", "exclude"), `/${TASK_DIR}/\n`);
  mkdirSync(join(parent, CHILD, "src"), { recursive: true });
  git(join(parent, CHILD), "init", "-q");
  writeFileSync(join(parent, CHILD, "src", "a.txt"), "a\n");
  git(join(parent, CHILD), "add", "--", "src/a.txt");
  git(join(parent, CHILD), "commit", "-q", "-m", "child base");
  symlinkSync(external, join(parent, ALIAS));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe("runner argv for a physical child and an external alias (R20-P01, W20-01)", () => {
  it("passes literal parent-relative --add-dir values and resolves nothing", () => {
    const args = new ClaudeCodeRunner({ permissionMode: "acceptEdits", allowedTools: ["Read", "Edit", "Write", "Bash"] })
      .buildArgs(invocation(parent, SCOPE), "prompt");
    expect(addDirs(args)).toEqual(["app", "deps/sub", "docs/features/F-X/execution", `${CHILD}/src`, `${ALIAS}/src`]);
    // The alias is a symlink to a directory outside the parent; argv keeps the alias text.
    expect(realpathSync(join(parent, ALIAS))).toBe(external);
    expect(args.join("\n")).not.toContain(external);
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("acceptEdits");
  });

  it("widens a mid-path wildcard to its literal prefix, so per-repo scopes must be literal", () => {
    const args = new ClaudeCodeRunner({}).buildArgs(invocation(parent, [`${TASK_DIR}/*/src/**`]), "p");
    expect(addDirs(args)).toEqual([TASK_DIR]); // grants every child under the task directory
  });

  it("spawns the CLI in the parent with those directories", async () => {
    writeFileSync(join(queue, "001.json"), JSON.stringify({ text: "```json\n" + JSON.stringify({ summary: "no change", changed_scope: [],
      verification_results: [pass], remaining_risks: [] }) + "\n```" }));
    const cp = ControlPlane.open({ workspaceRoot: parent, databasePath: ":memory:", rng: seededRandom(20) });
    try {
      cp.adapters.register(new ClaudeAdapter({ agent: "claude", runner: new ScriptedRunner({ command: process.execPath, maxTurns: 4,
        permissionMode: "acceptEdits", env: { ...process.env, SCRIPTED_CLAUDE_QUEUE: queue, SCRIPTED_CLAUDE_ARGV_LOG: argvLog } }) }));
      await new Orchestrator(cp).delegate({ from: "codex", to: "claude", spec: spec(), input_artifacts: [], deadline_ms: 20_000 });
    } finally {
      cp.close();
    }
    const argv = JSON.parse(readFileSync(argvLog, "utf8").trim()) as string[];
    expect(addDirs(argv)).toEqual(["app", "deps/sub", "docs/features/F-X/execution", `${CHILD}/src`, `${ALIAS}/src`]);
  });
});

describe("scope semantics stay textual (design: lease is not physical protection)", () => {
  it("accepts task-directory globs, rejects '..' and silently strips a leading '/'", () => {
    expect(normalizePath(`./${CHILD}/src/**`)).toBe(`${CHILD}/src/**`);
    expect(() => normalizePath("../child/src/**")).toThrow(/\.\./);
    expect(normalizePath("/abs/child/**")).toBe("abs/child/**"); // never put absolute paths in scope
    expect(scopeAllows({ paths: SCOPE }, `${CHILD}/src/new.txt`)).toBe(true);
    expect(scopeAllows({ paths: SCOPE }, `${CHILD}/package.json`)).toBe(false);
  });

  it("does not see that two aliases name one physical checkout", () => {
    symlinkSync(external, join(parent, TASK_DIR, "other"));
    expect(realpathSync(join(parent, TASK_DIR, "other"))).toBe(realpathSync(join(parent, ALIAS)));
    expect(globsOverlap(`${ALIAS}/**`, `${TASK_DIR}/other/**`)).toBe(false);
    expect(globsOverlap(`${CHILD}/**`, "deps/sub")).toBe(false);
  });
});

function spec(): TaskSpec {
  return { objective: "W-01 multi-repo round; contract base in prompt", scope: { paths: SCOPE }, dependencies: [],
    expected_deliverable: "delivery lines, ledger, sidecar", verification_criteria: ["python3 -m unittest"] };
}

describe("DELIVERY, REPOS and PACKAGE transport through the real adapter path", () => {
  async function round(prose: string, withPackage: boolean) {
    const base = git(parent, "rev-parse", "HEAD");
    const childBase = git(join(parent, CHILD), "rev-parse", "HEAD");
    writeFileSync(join(parent, CHILD, "src", "b.txt"), "b\n");
    git(join(parent, CHILD), "add", "--", "src/b.txt");
    git(join(parent, CHILD), "commit", "-q", "-m", "child work");
    const childHead = git(join(parent, CHILD), "rev-parse", "HEAD");
    const sidecar = JSON.stringify({ schema: "multi-repo-v1", feature: "F-X", task: "W-01",
      parent: { base, scope: SCOPE.slice(0, 3) },
      repos: [{ id: "child-a", role: "write", kind: "clone", alias: CHILD, branch: "main", target: "main",
        base: childBase, head: childHead, scope: [`${CHILD}/src/**`], source: { locator: "example/child-a" }, dirt: {} }] }) + "\n";
    const digest = createHash("sha256").update(sidecar).digest("hex");
    const changed = ["app/x.txt", LEDGER, SIDECAR, `${CHILD}/src/b.txt`];
    const lines = [`DELIVERY=local-v1 BASE=${base} HEAD={{HEAD}} LEDGER=${LEDGER} OUTCOME=COMPLETE WORKTREE=clean`,
      `REPOS=${SIDECAR} SHA256=${digest}`];
    if (withPackage) lines.push(`PACKAGE=packages/F-X-r01.zip SHA256=${"c".repeat(64)} PURPOSE=implementation-review RANGE=${base}..{{HEAD}} LEDGER=${LEDGER}`);
    writeFileSync(join(queue, "001.json"), JSON.stringify({
      write: { "app/x.txt": "x2\n", [LEDGER]: "# ledger\n", [SIDECAR]: sidecar },
      git: [["add", "--", "app/x.txt", LEDGER, SIDECAR], ["commit", "-q", "-m", "deliver", "--", "app/x.txt", LEDGER, SIDECAR]],
      text: "```json\n" + JSON.stringify({ summary: [...lines, prose].join("\n"), changed_scope: changed,
        verification_results: [pass], remaining_risks: [], recommended_next_action: "receipt per repo", blocker: null }) + "\n```",
    }));
    const cp = ControlPlane.open({ workspaceRoot: parent, databasePath: ":memory:", rng: seededRandom(21) });
    try {
      cp.adapters.register(new ClaudeAdapter({ agent: "claude", runner: new ScriptedRunner({ command: process.execPath, maxTurns: 4,
        permissionMode: "acceptEdits",
        env: { ...process.env, ...gitEnv(join(root, "home")), SCRIPTED_CLAUDE_QUEUE: queue, SCRIPTED_CLAUDE_ARGV_LOG: argvLog,
          GIT_AUTHOR_NAME: "Probe", GIT_AUTHOR_EMAIL: "probe@example.invalid", GIT_COMMITTER_NAME: "Probe", GIT_COMMITTER_EMAIL: "probe@example.invalid" } }) }));
      const outcome = await new Orchestrator(cp).delegate({ from: "codex", to: "claude", spec: spec(), input_artifacts: [], deadline_ms: 20_000 });
      return { deliverable: cp.deliverables.get(outcome.task_id)!, task: cp.tasks.get(outcome.task_id), base, digest, changed, sidecar };
    } finally {
      cp.close();
    }
  }

  it.each([[false], [true]])("keeps the critical lines in order (package=%s) and the flat changed_scope", async (withPackage) => {
    const { deliverable, task, base, digest, changed, sidecar } = await round("Implemented W-01 in parent and child-a.", withPackage);
    const head = git(parent, "rev-parse", "HEAD");
    const lines = deliverable.summary.split("\n");
    expect(task.state).toBe(TaskState.DONE);
    expect(deliverable.status).toBe(DeliverableStatus.COMPLETE);
    expect(DELIVERY.exec(lines[0]!)?.slice(1, 3)).toEqual([base, head]);
    expect(REPOS.exec(lines[1]!)?.slice(1)).toEqual([SIDECAR, digest]);
    if (withPackage) expect(PACKAGE.exec(lines[2]!)?.slice(4, 6)).toEqual([base, head]);
    else expect(lines[2]).toBe("Implemented W-01 in parent and child-a.");
    expect(deliverable.changed_scope).toEqual(changed);
    // The sidecar read from the exact parent HEAD matches the line-2 hash and never names that HEAD.
    const committed = git(parent, "show", `${head}:${SIDECAR}`) + "\n";
    expect(committed).toBe(sidecar);
    expect(createHash("sha256").update(committed).digest("hex")).toBe(digest);
    expect(committed).not.toContain(head);
    // O4: the ignored child leaves the parent clean even though the child has its own history.
    expect(git(parent, "status", "--porcelain=v1", "--untracked-files=all")).toBe("");
  });

  it("keeps all three lines when long prose is truncated to the stored limit", async () => {
    const { deliverable, digest } = await round("P".repeat(6000), true);
    expect(deliverable.summary).toHaveLength(CLAUDE_SUMMARY_MAX_CHARS);
    const lines = deliverable.summary.split("\n");
    expect(DELIVERY.test(lines[0]!)).toBe(true);
    expect(REPOS.exec(lines[1]!)?.[2]).toBe(digest);
    expect(PACKAGE.test(lines[2]!)).toBe(true);
  });
});
