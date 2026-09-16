#!/usr/bin/env node
// Entry point the thin Codex skill runs. Copied verbatim into the generated Codex package, so it
// must only import from files that travel with it.
//
//   bridge-plugin.mjs status  [--json]            pure read: workspace, pin, runtime, instructions
//   bridge-plugin.mjs prepare [--yes] [--json]    the one writing operation, after an instruction
//
// Without `--yes`, `prepare` reports the plan and writes nothing.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BootstrapRefusal, prepare } from "../bridge-project/bootstrap.mjs";
import { status } from "../bridge-project/locate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_SCRIPTS = join(HERE, "..", "bridge-project");

const HELP = `bridge-plugin.mjs — enable and inspect the bridge in this worktree

  status                     report workspace, pin, selected runtime and instruction root
  prepare [--yes]            prepare this worktree; without --yes nothing is written

Options: --json, --runtime <id> (pin a runtime when the project declares none), --help
`;

/** The dispatcher files committed into a prepared project. */
export function dispatcherSources(from = PROJECT_SCRIPTS) {
  const out = {};
  for (const name of ["dispatch.mjs", "locate.mjs", "bootstrap.mjs", "facade.mjs"]) {
    out[name] = readFileSync(join(from, name), "utf8");
  }
  return out;
}

function print(value, asJson, lines) {
  process.stdout.write(asJson ? `${JSON.stringify(value, null, 2)}\n` : `${lines(value).join("\n")}\n`);
}

export async function main(argv, { cwd = process.cwd(), env = process.env } = {}) {
  const [command, ...rest] = argv;
  const asJson = rest.includes("--json");
  const runtimeIndex = rest.indexOf("--runtime");
  const runtimeId = runtimeIndex >= 0 ? rest[runtimeIndex + 1] : undefined;

  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return 0;
  }

  if (command === "status") {
    const report = status(cwd, env);
    print(report, asJson, (r) => [
      `state:        ${r.state}`,
      `workspace:    ${r.workspace.root}`,
      `pin:          ${r.declaration.pinned?.runtime_id ?? "<none declared>"}`,
      `runtime:      ${r.runtime.state}${r.runtime.path ? ` (${r.runtime.path})` : ""}`,
      `instructions: ${r.instructions ? r.instructions.root : "<unavailable: install the pinned runtime>"}`,
    ]);
    return report.state === "ready" ? 0 : 1;
  }

  if (command === "prepare") {
    try {
      const result = prepare({
        cwd,
        env,
        pin: runtimeId ? { runtime_id: runtimeId } : undefined,
        dryRun: !rest.includes("--yes"),
        sources: dispatcherSources(),
      });
      print(result, asJson, (r) => [
        `${r.applied ? "prepared" : "plan"}: ${r.root}`,
        `pin:      ${r.pin.runtime_id}`,
        `runtime:  ${r.runtime}`,
        ...(r.changes.length === 0 ? ["changes:  none"] : ["changes:", ...r.changes.map((c) => `  ${c.action.padEnd(6)} ${c.path}`)]),
        r.applied ? "result:   applied" : "result:   dry run, nothing written; re-run with --yes",
      ]);
      return 0;
    } catch (error) {
      if (error instanceof BootstrapRefusal) {
        const payload = { code: error.code, message: error.message, next_step: error.nextStep };
        if (asJson) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        else process.stderr.write(`error ${error.code}: ${error.message}\n${error.nextStep ? `  next: ${error.nextStep}\n` : ""}`);
        return 1;
      }
      throw error;
    }
  }

  process.stderr.write(`unknown command: ${command}\n\n${HELP}`);
  return 2;
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`${error?.stack ?? String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
