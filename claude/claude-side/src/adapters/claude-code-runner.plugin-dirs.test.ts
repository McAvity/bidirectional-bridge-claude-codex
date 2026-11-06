/**
 * W17-03: the instruction packages a runtime hands a delegated Claude.
 *
 * `pluginDir` is the runtime's self-sufficient `bridge-claude` package, passed by every runtime so
 * far; `pluginDirs` adds further packages (the runtime's own `feature-workflow`) after it. The argv
 * contract is asserted on the real `buildArgs`, and once through a spawned stand-in CLI.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TaskInvocation } from "@bridge/protocol";
import { ClaudeCodeRunner, buildPrompt, executorPluginDirs, workflowBlock } from "./claude-code-runner.js";

const here = dirname(fileURLToPath(import.meta.url));
const fakeCli = join(here, "..", "..", "test", "fixtures", "fake-claude-cli.mjs");

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "claude-runner-plugin-dirs-"));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function invocation(): TaskInvocation {
  return {
    task_id: "task_aaaaaaaaaa",
    spec: {
      objective: "report runtime information without modifying any source",
      scope: { paths: ["docs/*.md"] },
      dependencies: [],
      expected_deliverable: "a summary",
      verification_criteria: ["node --version runs"],
    },
    inputs: [],
    workspace_root: workspace,
    lease_id: "lease_aaaaaaaaaa",
    deadline_at: Date.now() + 20_000,
    attempt: 0,
    idempotency_key: "k",
    previous_execution_handle: null,
  } as TaskInvocation;
}

/** Every value that follows a `--plugin-dir`, in order. */
function pluginDirArgs(args: readonly string[]): string[] {
  const out: string[] = [];
  args.forEach((arg, index) => {
    if (arg === "--plugin-dir") out.push(args[index + 1]!);
  });
  return out;
}

describe("executor plugin directories", () => {
  it("passes the bridge package first and the workflow package second", () => {
    const runner = new ClaudeCodeRunner({
      pluginDir: "/runtime/plugins/bridge-claude",
      pluginDirs: ["/runtime/plugins/feature-workflow-claude"],
    });
    expect(pluginDirArgs(runner.buildArgs(invocation(), "p"))).toEqual([
      "/runtime/plugins/bridge-claude",
      "/runtime/plugins/feature-workflow-claude",
    ]);
  });

  it("keeps the single-package form of older runtimes unchanged", () => {
    const runner = new ClaudeCodeRunner({ pluginDir: "/runtime/plugins/bridge-claude" });
    expect(pluginDirArgs(runner.buildArgs(invocation(), "p"))).toEqual(["/runtime/plugins/bridge-claude"]);
  });

  it("passes nothing when the caller supplies no package", () => {
    expect(pluginDirArgs(new ClaudeCodeRunner({}).buildArgs(invocation(), "p"))).toEqual([]);
  });

  it("drops duplicates and empty entries without reordering", () => {
    expect(executorPluginDirs({ pluginDir: "/a", pluginDirs: ["/b", "/a", "", "/b"] })).toEqual(["/a", "/b"]);
    expect(executorPluginDirs({ pluginDirs: ["/b"] })).toEqual(["/b"]);
  });

  it("reaches the spawned CLI as repeated --plugin-dir arguments", async () => {
    const argvFile = join(workspace, "argv.json");
    class FixtureRunner extends ClaudeCodeRunner {
      override buildArgs(inv: TaskInvocation, prompt: string): string[] {
        return [fakeCli, ...super.buildArgs(inv, prompt)];
      }
    }
    const runner = new FixtureRunner({
      command: process.execPath,
      env: { ...process.env, FAKE_CLAUDE_MODE: "ok", FAKE_CLAUDE_ARGV_FILE: argvFile },
      maxTurns: 4,
      permissionMode: "plan",
      pluginDir: "/runtime/plugins/bridge-claude",
      pluginDirs: ["/runtime/plugins/feature-workflow-claude"],
    });
    const context = {
      report: async () => undefined,
      publishArtifact: async () => "art_aaaaaaaaaa",
      recordVerification: async () => undefined,
      raiseBlocker: async () => undefined,
      saveExecutionHandle: async () => undefined,
      signal: new AbortController().signal,
    };
    await runner.run(invocation(), context as never).catch(() => undefined);
    const recorded = JSON.parse(readFileSync(argvFile, "utf8")) as { args: string[] };
    expect(pluginDirArgs(recorded.args)).toEqual([
      "/runtime/plugins/bridge-claude",
      "/runtime/plugins/feature-workflow-claude",
    ]);
  });

  it("F-W19: a bound attempt gets the role package and the admitted store variant, never the runtime workflow", () => {
    const workflow = { identity: `sha256:${"a".repeat(64)}`, workflow_id: "1.0.0-aaaaaaaaaaaa", version: "1.0.0", generation: 3, kind: "release",
      client_root: "/home/u/.local/share/claude-codex-bridge/workflows/1.0.0-aaaaaaaaaaaa/claude" };
    const runner = new ClaudeCodeRunner({ pluginDir: "/runtime/plugins/bridge-claude", pluginDirs: ["/runtime/plugins/feature-workflow-claude"] });
    const args = runner.buildArgs({ ...invocation(), workflow } as TaskInvocation, "p");
    expect(pluginDirArgs(args)).toEqual(["/runtime/plugins/bridge-claude", workflow.client_root]);
    expect(args).not.toContain("/runtime/plugins/feature-workflow-claude");
    expect(executorPluginDirs({ pluginDirs: ["/runtime/plugins/feature-workflow-claude"] }, workflow)).toEqual([workflow.client_root]);
    const fresh = buildPrompt({ ...invocation(), workflow } as TaskInvocation, false);
    expect(fresh).toContain(`WORKFLOW=1.0.0 IDENTITY=${workflow.identity} GENERATION=3 ROOT=${workflow.client_root}`);
    expect(fresh).toContain("INSTRUCTIONS=bundle:1.0.0-aaaaaaaaaaaa");
    const resumed = buildPrompt({ ...invocation(), workflow, continuation_of_task_id: "task_prev" } as TaskInvocation, true);
    expect(resumed.indexOf("## Workflow binding")).toBeGreaterThan(resumed.indexOf("same feature session"));
    expect(resumed).toContain("supersede every earlier workflow instruction visible in this session");
    expect(workflowBlock(workflow, false).join("\n")).not.toContain("supersede");
    expect(buildPrompt(invocation(), false)).not.toContain("## Workflow binding");
  });
});
