#!/usr/bin/env node
/**
 * A scripted stand-in for the `claude` binary, for local-delivery regressions.
 *
 * Same stream-json frame shapes as `fake-claude-cli.mjs` (captured from Claude Code 2.1.222),
 * but each invocation consumes the next step file from SCRIPTED_CLAUDE_QUEUE, so one test can
 * drive several attempts and rounds of one session. A step is JSON:
 *
 *   { "write": { "<repo path>": "<content>" }, "remove": ["<repo path>"],
 *     "git": [["add", "--", "a.md"], ["commit", "-m", "x"]], "text": "<final output>" }
 *
 * File actions and git commands run in the working directory the adapter spawned us in (the
 * task's workspace root), so a step can create real commits. `{{HEAD}}` in `text` is replaced
 * with `git rev-parse HEAD` after the actions, as an executor reads it after its last commit.
 * The argv of every invocation is appended to SCRIPTED_CLAUDE_ARGV_LOG for resume assertions.
 * What this cannot exercise is the model; it proves the transport and storage path only.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { argv, cwd, env, stdout } from "node:process";

const args = argv.slice(2);
if (args.includes("--version")) {
  stdout.write("2.1.222 (Claude Code)\n");
  process.exit(0);
}
if (env.SCRIPTED_CLAUDE_ARGV_LOG) appendFileSync(env.SCRIPTED_CLAUDE_ARGV_LOG, `${JSON.stringify(args)}\n`);

const queue = env.SCRIPTED_CLAUDE_QUEUE;
const next = readdirSync(queue).filter((name) => name.endsWith(".json")).sort()[0];
if (!next) {
  process.stderr.write("scripted-claude-cli: no step left in the queue\n");
  process.exit(4);
}
const step = JSON.parse(readFileSync(join(queue, next), "utf8"));
renameSync(join(queue, next), join(queue, `${next}.done`));

const gitEnv = { ...env };
for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete gitEnv[name];
const git = (gitArgs) => execFileSync("git", gitArgs, { cwd: cwd(), encoding: "utf8", env: gitEnv });
for (const [path, content] of Object.entries(step.write ?? {})) {
  mkdirSync(dirname(join(cwd(), path)), { recursive: true });
  writeFileSync(join(cwd(), path), content);
}
for (const path of step.remove ?? []) rmSync(join(cwd(), path), { force: true });
for (const gitArgs of step.git ?? []) git(gitArgs);
const text = String(step.text ?? "").replaceAll("{{HEAD}}", git(["rev-parse", "HEAD"]).trim());

const resumeIndex = args.indexOf("--resume");
const sessionId = resumeIndex >= 0 ? args[resumeIndex + 1] : "22222222-3333-4444-8555-666666666666";
const emit = (frame) => stdout.write(`${JSON.stringify(frame)}\n`);
emit({ type: "system", subtype: "init", cwd: cwd(), session_id: sessionId, tools: ["Bash"], mcp_servers: [],
  model: "claude-opus-5", permissionMode: "plan", apiKeySource: "none", claude_code_version: "2.1.222",
  uuid: "2cf21c75-ea12-42d4-ac74-550b8c2e05b4" });
emit({ type: "assistant", message: { model: "claude-opus-5", role: "assistant", content: [{ type: "text", text }],
  usage: { input_tokens: 1, output_tokens: 1 } }, session_id: sessionId });
emit({ is_error: false, duration_api_ms: 10, num_turns: 1, stop_reason: "end_turn", session_id: sessionId,
  total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 }, modelUsage: { "claude-opus-5": {} },
  subtype: "success", result: text, type: "result", duration_ms: 10 });
