/**
 * Local delivery through the real Claude execution path (wave16, W16-01 probe made permanent).
 *
 * The adapter spawns a scripted stand-in for the CLI (`scripted-claude-cli.mjs`, real
 * stream-json frames) inside a real temporary Git repository. Each step may write files and run
 * real `git` commands, so the delivery line names commits that exist. Everything between the
 * CLI and storage is product code: `ClaudeCodeRunner` parsing and normalization,
 * `ClaudeAdapter` COMPLETE/PARTIAL mapping, `Orchestrator`, `FeatureWorkflow`,
 * `DeliverableService` (schema and honesty gate), artifacts and events.
 *
 * What this proves: which executor output survives into what the coordinator reads, and that
 * the delivery line of `.agents/skills/feature-execute/references/local-delivery.md` carries
 * real, checkable commits through PARTIAL, recovery and a correction round of one session.
 * What it cannot prove: that a model writes that line or follows the procedure (R16-N2).
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ControlPlane, FeatureWorkflow, Orchestrator } from "@bridge/control-plane";
import { DeliverableStatus, EventType, TaskState, seededRandom, type TaskSpec } from "@bridge/protocol";
import { ClaudeAdapter } from "./claude-adapter.js";
import { ClaudeCodeRunner, CLAUDE_SUMMARY_MAX_CHARS } from "./claude-code-runner.js";

const here = dirname(fileURLToPath(import.meta.url));
const scriptedCli = join(here, "..", "..", "test", "fixtures", "scripted-claude-cli.mjs");

class ScriptedRunner extends ClaudeCodeRunner {
  override buildArgs(invocation: Parameters<ClaudeCodeRunner["buildArgs"]>[0], prompt: string): string[] {
    return [scriptedCli, ...super.buildArgs(invocation, prompt)];
  }
}

const LEDGER = "docs/features/F-X/execution/W-01/01.md";
const DELIVERY = /^DELIVERY=local-v1 BASE=([0-9a-f]{40}) HEAD=([0-9a-f]{40}) LEDGER=(\S+) OUTCOME=(COMPLETE|PARTIAL) WORKTREE=(clean|dirty:\d+)$/;
const pass = { kind: "test", command: "node --test", passed: true, exit_code: 0, summary: "3 passed" };

let root: string;
let repo: string;
let queue: string;
let argvLog: string;
let base: string;
let steps = 0;
let cp: ControlPlane;

const gitEnv = (): NodeJS.ProcessEnv => {
  const e = { ...process.env };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete e[name];
  return e;
};
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", env: gitEnv() }).trim();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "w16-delivery-"));
  repo = join(root, "repo");
  queue = join(root, "queue");
  argvLog = join(root, "argv.log");
  mkdirSync(repo);
  mkdirSync(queue);
  git("init", "-q", "-b", "main");
  git("config", "user.email", "executor@example.invalid");
  git("config", "user.name", "Executor");
  mkdirSync(join(repo, "docs"), { recursive: true });
  writeFileSync(join(repo, "docs", "README.md"), "base\n");
  git("add", "--", "docs/README.md");
  git("commit", "-q", "-m", "base");
  base = git("rev-parse", "HEAD");
  steps = 0;
  cp = ControlPlane.open({ workspaceRoot: repo, databasePath: ":memory:", rng: seededRandom(16) });
  cp.adapters.register(new ClaudeAdapter({ agent: "claude", runner: new ScriptedRunner({
    command: process.execPath, maxTurns: 8, permissionMode: "plan",
    env: { ...process.env, SCRIPTED_CLAUDE_QUEUE: queue, SCRIPTED_CLAUDE_ARGV_LOG: argvLog },
  }) }));
});

afterEach(() => {
  cp.close();
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function step(value: Record<string, unknown>) {
  steps += 1;
  writeFileSync(join(queue, `${String(steps).padStart(3, "0")}.json`), JSON.stringify(value));
}
const fence = (value: unknown) => "```json\n" + JSON.stringify(value, null, 2) + "\n```";
const line = (outcome: string, worktree = "clean", head = "{{HEAD}}") =>
  `DELIVERY=local-v1 BASE=${base} HEAD=${head} LEDGER=${LEDGER} OUTCOME=${outcome} WORKTREE=${worktree}`;
const spec = (objective = `round 1; contract base ${base}; deliver per local-delivery.md`): TaskSpec => ({
  objective, scope: { paths: ["docs/**"] }, dependencies: [],
  expected_deliverable: "delivery line, ledger, checks", verification_criteria: ["node --test"],
});
/** A committed round: work file and ledger staged by name, as the executor procedure requires. */
const commitStep = (file: string, text: string) => ({
  write: { [file]: `${file}\n`, [LEDGER]: "# ledger\n" },
  git: [["add", "--", file, LEDGER], ["commit", "-q", "-m", `deliver ${file}`]],
  text,
});

async function delegate() {
  const out = await new Orchestrator(cp).delegate({ from: "codex", to: "claude", spec: spec(), input_artifacts: [], deadline_ms: 20_000 });
  return stored(out.task_id);
}
function stored(task_id: string) {
  const deliverable = cp.deliverables.get(task_id)!;
  const artifacts = cp.artifacts.list(task_id).map((a) => ({ name: a.name, content: cp.artifacts.read(a.artifact_id) }));
  const submitted = cp.events({ task_id })
    .filter((e) => e.type === EventType.DELIVERABLE_SUBMITTED)
    .map((e) => (e.payload as { summary: string; status: string }));
  return { deliverable, artifacts, submitted, task: cp.tasks.get(task_id) };
}
const parse = (summary: string) => DELIVERY.exec(summary.split("\n")[0]!);

describe("what the coordinator receives from a delivery (normalization, W16-01 R16-N1)", () => {
  it("keeps line 1 of summary and drops snapshots, commit_or_diff, unknown keys and malformed checks", async () => {
    step(commitStep("docs/a.md", "Done.\n\n" + fence({
      summary: `${line("COMPLETE")}\nImplemented a.`, changed_scope: ["docs/a.md", LEDGER],
      verification_snapshot: "{{HEAD}}", commit_or_diff: `${base}..{{HEAD}}`, delivery: { base },
      verification_results: [pass, { kind: "test", passed: true, exit_code: 0, summary: "no command" }],
      remaining_risks: [], recommended_next_action: "review the delivered head", blocker: null,
    })));
    const { deliverable, artifacts, submitted, task } = await delegate();
    const head = git("rev-parse", "HEAD");
    expect(task.state).toBe(TaskState.DONE);
    expect(deliverable.status).toBe(DeliverableStatus.COMPLETE);
    expect(parse(deliverable.summary)?.slice(1)).toEqual([base, head, LEDGER, "COMPLETE", "clean"]);
    expect(deliverable.commit_or_diff).toBeNull();
    expect(JSON.stringify(deliverable)).not.toMatch(/verification_snapshot|"delivery"/);
    expect(deliverable.verification_results).toHaveLength(1);
    expect(deliverable.changed_scope).toEqual(["docs/a.md", LEDGER]);
    expect(deliverable.recommended_next_action).toBe("review the delivered head");
    expect(artifacts).toHaveLength(0);
    expect(submitted[0]?.summary.split("\n")[0]).toBe(deliverable.summary.split("\n")[0]);
    // The named commits are real: the head is in the repository and descends from the base.
    expect(git("merge-base", "--is-ancestor", base, head)).toBe("");
    expect(git("diff", "--name-only", base, head).split("\n")).toEqual(["docs/a.md", LEDGER]);
    expect(git("status", "--porcelain=v1", "--untracked-files=all")).toBe("");
  });

  it("keeps the line when the summary is truncated and preserves the full text as a report artifact", async () => {
    step({ text: "# Report\n" + "EVIDENCE ".repeat(700) + "\n" + fence({
      summary: `${line("COMPLETE")}\n${"S".repeat(5000)}`, changed_scope: [],
      verification_snapshot: "{{HEAD}}", verification_results: [pass], remaining_risks: [], recommended_next_action: "review",
    }) });
    const { deliverable, artifacts } = await delegate();
    expect(deliverable.summary).toHaveLength(CLAUDE_SUMMARY_MAX_CHARS);
    expect(parse(deliverable.summary)?.[2]).toBe(base); // HEAD = BASE: nothing committed
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]!.content).toContain(`"verification_snapshot": "${base}"`);
  });

  it("keeps reproduction snapshots only in the forced report artifact", async () => {
    step({ text: fence({
      summary: line("COMPLETE"), changed_scope: [], reproduction_results: [{ ...pass, passed: false, exit_code: 1, summary: "red" }],
      reproduction_snapshot: base, verification_snapshot: "a".repeat(64), verification_results: [pass],
      remaining_risks: [], recommended_next_action: "review",
    }) });
    const { deliverable, artifacts } = await delegate();
    expect(deliverable.status).toBe(DeliverableStatus.COMPLETE);
    expect(JSON.stringify(deliverable)).not.toContain("reproduction_snapshot");
    expect(artifacts[0]!.content).toContain(`"reproduction_snapshot": "${base}"`);
  });

  it("keeps a legacy PACKAGE prefix verbatim for contracts that still require a package", async () => {
    const pkg = `PACKAGE=/tmp/x.zip SHA256=${"c".repeat(64)} PURPOSE=implementation-review RANGE=${base}..{{HEAD}} LEDGER=${LEDGER}`;
    step(commitStep("docs/b.md", fence({ summary: `${pkg} ready`, changed_scope: [], verification_results: [pass],
      remaining_risks: [], recommended_next_action: "review" })));
    const { deliverable } = await delegate();
    expect(deliverable.summary.startsWith(pkg.replace("{{HEAD}}", git("rev-parse", "HEAD")))).toBe(true);
  });

  it("without a JSON block the raw text is the summary and the round is PARTIAL for lack of evidence", async () => {
    step({ text: `${line("COMPLETE")}\nno json block` });
    const { deliverable, task } = await delegate();
    expect(deliverable.status).toBe(DeliverableStatus.PARTIAL);
    expect(task.state).toBe(TaskState.BLOCKED);
    expect(deliverable.remaining_risks).toContain("no verification evidence was produced");
  });

  it("records a claimed OUTCOME=PARTIAL without blocker as COMPLETE/DONE: only the receipt can catch it", async () => {
    step(commitStep("docs/c.md", fence({
      summary: `${line("PARTIAL", "dirty:1")}\nHalf done.`, changed_scope: ["docs/c.md", LEDGER],
      verification_results: [pass], remaining_risks: ["UNCOMMITTED own: docs/d.md"], recommended_next_action: "finish", blocker: null,
    })));
    writeFileSync(join(repo, "docs", "d.md"), "unfinished\n"); // left uncommitted by the "executor"
    const { deliverable, task } = await delegate();
    // The bridge state says finished; the delivery line says otherwise. Effective outcome is the
    // more conservative one (local-delivery.md § 4.2), so this is a required finding, not a PASS.
    expect(task.state).toBe(TaskState.DONE);
    expect(deliverable.status).toBe(DeliverableStatus.COMPLETE);
    expect(parse(deliverable.summary)?.[4]).toBe("PARTIAL");
    expect(deliverable.recommended_next_action).toBe("finish");
  });
});

describe("PARTIAL, recovery and correction in one Claude session", () => {
  it("delivers cumulative commits across a blocked attempt and its recovery, then a new-base correction round", async () => {
    const parent = cp.tasks.create({ spec: { ...spec("Coordinate F-X"), scope: { paths: ["manager/**"] } }, created_by: "codex" });
    cp.tasks.claim(parent.task_id, "codex");
    const orchestrator = new Orchestrator(cp);
    const flow = new FeatureWorkflow(cp, orchestrator);
    flow.create("F-X", "codex", parent.task_id);

    // Attempt 1: partial work committed, blocked on a decision.
    step(commitStep("docs/part1.md", fence({
      summary: `${line("PARTIAL")}\nNeed a decision.`, changed_scope: ["docs/part1.md", LEDGER], verification_results: [pass],
      remaining_risks: [], recommended_next_action: "answer", blocker: "choose A or B; recommend A",
    })));
    const round1 = await flow.run({ feature_id: "F-X", manager: "codex", spec: spec(), input_artifacts: [], deadline_ms: 20_000, idempotency_key: "F-X:round-1" });
    const task1 = round1.task.task_id;
    const head1 = git("rev-parse", "HEAD");
    expect(round1.task.state).toBe(TaskState.BLOCKED);
    expect(flow.get("F-X", "codex").state).toBe("blocked");
    expect(parse(cp.deliverables.get(task1)!.summary)?.slice(1, 5)).toEqual([base, head1, LEDGER, "PARTIAL"]);

    // Recovery of the same task: new ledger, new head, same contract base (cumulative range).
    const ledger2 = LEDGER.replace("01.md", "02.md");
    step({ write: { "docs/part2.md": "part2\n", [ledger2]: "# ledger 2\n" },
      git: [["add", "--", "docs/part2.md", ledger2], ["commit", "-q", "-m", "finish"]],
      text: fence({ summary: line("COMPLETE").replace(LEDGER, ledger2), changed_scope: ["docs/part1.md", "docs/part2.md", LEDGER, ledger2],
        verification_results: [pass], remaining_risks: [], recommended_next_action: "review" }) });
    await orchestrator.resumeDelegatedTask({ task_id: task1, requested_by: "codex", message: "The user chose A.", idempotency_key: `${task1}:resume-1` } as never);
    const head2 = git("rev-parse", "HEAD");
    const after = stored(task1);
    expect(after.task.state).toBe(TaskState.DONE);
    expect(parse(after.deliverable.summary)?.slice(1, 5)).toEqual([base, head2, ledger2, "COMPLETE"]);
    // The stored deliverable row is replaced; the earlier PARTIAL line survives in the events.
    expect(after.submitted.map((s) => parse(s.summary)?.[4])).toEqual(["PARTIAL", "COMPLETE"]);
    expect(git("merge-base", "--is-ancestor", head1, head2)).toBe("");
    expect(git("diff", "--name-only", base, head2).split("\n").sort()).toEqual(["docs/part1.md", "docs/part2.md", LEDGER, ledger2].sort());

    // Correction round: a new task whose contract base is the delivered head, same session.
    step({ write: { "docs/fix.md": "fix\n", "docs/features/F-X/execution/W-02/01.md": "# ledger\n" },
      git: [["add", "--", "docs/fix.md", "docs/features/F-X/execution/W-02/01.md"], ["commit", "-q", "-m", "fix"]],
      text: fence({ summary: `DELIVERY=local-v1 BASE=${head2} HEAD={{HEAD}} LEDGER=docs/features/F-X/execution/W-02/01.md OUTCOME=COMPLETE WORKTREE=clean`,
        changed_scope: ["docs/fix.md"], verification_results: [pass], remaining_risks: [], recommended_next_action: "review" }) });
    const round2 = await flow.run({ feature_id: "F-X", manager: "codex", spec: spec(`correction; contract base ${head2}`), input_artifacts: [], deadline_ms: 20_000, idempotency_key: "F-X:round-2" });
    expect(round2.task.task_id).not.toBe(task1);
    const line3 = parse(cp.deliverables.get(round2.task.task_id)!.summary);
    expect(line3?.[1]).toBe(head2);
    expect(line3?.[2]).toBe(git("rev-parse", "HEAD"));
    expect(git("diff", "--name-only", head2, "HEAD").split("\n")).toEqual(["docs/features/F-X/execution/W-02/01.md", "docs/fix.md"]);

    // One session throughout: attempt 2 and round 2 resumed the session attempt 1 created,
    // carried the manager's clarification and the continuation note respectively.
    const argvs = readFileSync(argvLog, "utf8").trim().split("\n").map((l) => JSON.parse(l) as string[]);
    expect(argvs).toHaveLength(3);
    expect(argvs[0]).not.toContain("--resume");
    const session = "22222222-3333-4444-8555-666666666666";
    expect(argvs[1]![argvs[1]!.indexOf("--resume") + 1]).toBe(session);
    expect(argvs[2]![argvs[2]!.indexOf("--resume") + 1]).toBe(session);
    expect(argvs[1]!.join(" ")).toContain("The user chose A.");
    expect(argvs[2]!.join(" ")).toContain(`after completed task ${task1}`);
    expect(git("status", "--porcelain=v1", "--untracked-files=all")).toBe("");
  });
});
