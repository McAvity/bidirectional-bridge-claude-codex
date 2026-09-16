#!/usr/bin/env node
// Entry point the thin Codex skill runs. Copied verbatim into the generated Codex package next to
// the installer, so the package can do the whole job with no clone, no runtime id and no manual
// step:
//
//   bridge-plugin.mjs status                   pure read: workspace, pin, runtime, instructions
//   bridge-plugin.mjs setup [--yes]            acquire the pinned source, install the runtime,
//                                              prepare this worktree; nothing is written without --yes
//   bridge-plugin.mjs update --to <id> [--yes] move the declaration and the local selection together
//   bridge-plugin.mjs rollback [--to <id>] [--yes]
//
// Every write goes through the wave12 plan/apply machinery, so ownership conflicts, copied
// records, symlinked paths, an already-defined `mcp_servers.bridge`, active sessions and the
// resumable journal are the wave12 ones. Nothing here re-implements them.

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SetupError, bridgeHome, canonical } from "../setup/common.mjs";
import { installRuntime, listRuntimes, loadRuntime } from "../setup/runtime.mjs";
import { applyPlan, declarationContent, planChange, resolveIdentity } from "../setup/workspace.mjs";
import { status } from "../bridge-project/locate.mjs";
import { acquireSource, readRelease } from "./acquire.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const HELP = `bridge-plugin.mjs — enable and inspect the bridge in this worktree

  status                        report workspace, pin, selected runtime and instruction root
  setup    [--yes]              install the pinned runtime if needed and prepare this worktree
  update   --to <runtime id> [--yes]
  rollback [--to <runtime id>] [--yes]

Options:
  --json                        machine-readable output
  --source <bridge clone>       use this checkout instead of fetching the pinned commit
  --commit <sha>                override the pinned commit (with --source)
  --keep-local                  keep locally modified managed files instead of refusing
  --offline                     never fetch; fail if no local checkout has the pinned commit
`;

const VALUE_FLAGS = new Set(["--to", "--source", "--commit", "--home"]);

export function parse(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (VALUE_FLAGS.has(flag)) {
      options[flag.slice(2)] = rest[index + 1];
      index += 1;
    } else if (flag?.startsWith("--")) {
      options[flag.slice(2)] = true;
    }
  }
  return { command, options };
}

/**
 * The runtime this worktree should end up on.
 *
 * `setup` prefers what the project already declares — an inherited worktree must not silently
 * move to a newer release — and otherwise uses the pin the distribution ships. No caller ever has
 * to know a runtime id.
 */
function targetRuntimeId(report, options, release) {
  if (options.to) return { runtimeId: options.to, commit: null, reason: "requested" };
  const declared = report.declaration?.pinned;
  if (declared?.runtime_id) return { runtimeId: declared.runtime_id, commit: declared.commit ?? null, reason: "declared" };
  return { runtimeId: null, commit: options.commit ?? release.pinned.commit, reason: "release" };
}

/**
 * The pinned runtime, installed if it is not here yet. Immutable, idempotent and never a guess.
 *
 * Nothing is acquired when the pin is already satisfied by an installed runtime — by id when the
 * project declares one, by commit when only the distribution's release pin applies. That is what
 * makes a second worktree, and an offline machine that has already installed the release, need
 * no source at all.
 */
function ensureRuntime({ home, runtimeId, commit, options }) {
  if (runtimeId) {
    try {
      return { runtime: loadRuntime(home, runtimeId), installed: false, source: null };
    } catch (error) {
      if (error.code !== "RUNTIME_NOT_INSTALLED") throw error;
      if (!commit) {
        throw new SetupError("PINNED_RUNTIME_UNAVAILABLE", `runtime ${runtimeId} is not installed and the declaration names no commit`, {
          nextStep: "pass --source <bridge clone> that contains the pinned commit",
        });
      }
    }
  } else if (commit) {
    const installed = listRuntimes(home).find((candidate) => candidate.manifest?.source.commit === commit);
    if (installed) return { runtime: installed, installed: false, source: null };
  }
  const release = readRelease(join(HERE, "release.json"));
  const source = acquireSource({
    home,
    commit,
    repository: release.repository,
    source: options.source ?? null,
    allowNetwork: !options.offline,
  });
  const { runtime, created } = installRuntime({ source: source.repository, ref: source.commit, home });
  if (runtimeId && runtime.id !== runtimeId) {
    throw new SetupError("PINNED_RUNTIME_MISMATCH", `building ${commit} produced runtime ${runtime.id}, not the declared ${runtimeId}`, {
      nextStep: "check the project declaration; a pin names one runtime id and one commit",
    });
  }
  return { runtime, installed: created, source };
}

async function writeWorktree({ action, home, workspace, runtime, options }) {
  const identity = await resolveIdentity(runtime.path, workspace);
  const plan = planChange({
    action,
    home,
    identity,
    target: runtime,
    profile: "dispatcher",
    keepLocal: Boolean(options["keep-local"]),
  });
  let applied = false;
  if (options.yes && plan.ok && plan.changed) applied = applyPlan(plan).applied;
  return {
    ok: plan.ok,
    applied,
    changed: plan.changed,
    action: plan.action,
    workspace: plan.root,
    runtime: { id: runtime.id, commit: runtime.manifest.source.commit, path: runtime.path },
    changes: plan.ops.map((op) => ({ kind: op.kind, path: op.path, action: op.action ?? "select" })),
    kept_local: plan.kept,
    conflicts: plan.conflicts,
    refusals: plan.refusals,
    notes: plan.notes,
  };
}

function report(value, asJson, lines) {
  process.stdout.write(asJson ? `${JSON.stringify(value, null, 2)}\n` : `${lines(value).join("\n")}\n`);
}

export async function main(argv, { cwd = process.cwd(), env = process.env } = {}) {
  const { command, options } = parse(argv);
  const asJson = Boolean(options.json);
  if (!command || command === "help" || options.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const current = status(cwd, env);
  const home = options.home ? resolve(options.home) : bridgeHome(env);

  if (command === "status") {
    report(current, asJson, (r) => [
      `state:        ${r.state}`,
      `workspace:    ${r.workspace.root}`,
      `pin:          ${r.declaration.pinned?.runtime_id ?? "<none declared>"}`,
      `runtime:      ${r.runtime.state}${r.runtime.path ? ` (${r.runtime.path})` : ""}`,
      `selection:    ${r.selection.runtime_id ?? r.selection.kind}`,
      `instructions: ${r.instructions ? r.instructions.root : "<unavailable: run setup>"}`,
    ]);
    return current.state === "ready" ? 0 : 1;
  }

  if (!["setup", "update", "rollback"].includes(command)) {
    process.stderr.write(`unknown command: ${command}\n\n${HELP}`);
    return 2;
  }
  if (!current.workspace.in_git_repository) {
    throw new SetupError("NOT_A_WORKTREE", `${current.workspace.root} is not inside a git worktree`, { nextStep: "run this from a git worktree" });
  }

  const release = readRelease(join(HERE, "release.json"));
  const wanted = targetRuntimeId(current, options, release);
  const { runtime, installed, source } = ensureRuntime({ home, runtimeId: wanted.runtimeId, commit: wanted.commit, options });

  // `init` for a worktree that has no selection yet, `update`/`rollback` when it has one: the
  // wave12 action decides which refusals apply, including the active-session one.
  const action = command === "setup" ? (current.selection.kind === "valid" ? "update" : "init") : command;
  const result = await writeWorktree({ action, home, workspace: canonical(current.workspace.root), runtime, options });
  result.runtime_installed_now = installed;
  result.source = source ? { origin: source.origin, commit: source.commit } : null;
  result.declaration = declarationContent(runtime).trim();

  report(result, asJson, (r) => [
    `${r.applied ? "prepared" : r.ok ? "plan" : "refused"}: ${r.workspace}`,
    `runtime:  ${r.runtime.id} (${r.runtime_installed_now ? "installed now" : "already installed"})`,
    ...(r.changes.length === 0 ? ["changes:  none"] : ["changes:", ...r.changes.map((c) => `  ${String(c.action).padEnd(6)} ${c.path}`)]),
    ...r.kept_local.map((k) => `kept local: ${k.path}`),
    ...r.conflicts.map((c) => `conflict: ${c.code} ${c.path}: ${c.message}`),
    ...r.refusals.map((c) => `refused:  ${c.code}: ${c.message}${c.nextStep ? `\n  next: ${c.nextStep}` : ""}`),
    r.applied ? "result:   applied" : r.ok ? "result:   dry run, nothing written; re-run with --yes" : "result:   nothing written",
  ]);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      if (error instanceof SetupError) {
        process.stderr.write(`error ${error.code}: ${error.message}\n${error.nextStep ? `  next: ${error.nextStep}\n` : ""}`);
        process.exitCode = 1;
        return;
      }
      process.stderr.write(`${error?.stack ?? String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
