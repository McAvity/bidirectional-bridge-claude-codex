#!/usr/bin/env node
// Setup CLI of the bridge: install a pinned runtime, set up a worktree, update, roll back and
// diagnose it. Runs from a fresh clone or from an installed runtime; see docs/setup.md.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SetupError, bridgeHome, canonical, run } from "./setup/common.mjs";
import { unifiedDiff } from "./setup/diff.mjs";
import { formatDoctor, runDoctor } from "./setup/doctor.mjs";
import { installRuntime, listRuntimes, loadRuntime, loadRuntimeAt, runtimesDir } from "./setup/runtime.mjs";
import { applyPlan, planChange, readRecord, readSelection, resolveIdentity, rollbackTarget } from "./setup/workspace.mjs";

const HELP = `bridge.mjs — install, set up and diagnose the Claude Code <-> Codex bridge

  install   [--source <bridge clone>] [--ref <commit>]
            build the runtime of one commit into <home>/runtimes/<id>, beside older ones
  runtimes  list installed runtimes
  init      --workspace <worktree> [--runtime <id>] [--keep-local] [--with-preference] [--yes]
  update    --workspace <worktree> --runtime <id> [--keep-local] [--with-preference] [--yes]
  rollback  --workspace <worktree> [--to <id>] [--keep-local] [--yes]
            plan (and with --yes apply) the MCP configuration, instructions and runtime
            selection of one worktree; without --yes nothing is written.
            --with-preference also records the short collaboration preference in the project's
            AGENTS.md, between the managed markers. It is never written without that flag, the
            rest of the file is preserved, and a locally edited block is a conflict, not a
            rewrite. The plan prints the exact diff first.
  doctor    --workspace <worktree> [--codex-profile <name>] [--no-handshake]
            check tools, setup, configuration, state and a real MCP handshake; no models
  diagnose  --workspace <worktree> [--feature <id> | --task <id> [--attempt <n>] | --since <30m|6h|ISO>]
            [--db <path>] [--with-evidence] [--with-database] [--inspect <file.zip>]
            collect one incident into a local package in this worktree's exchange namespace.
            Without a scope it prints what can be selected and exports nothing. The package name
            is generated and never overwrites an existing one. The default package carries
            identifiers, states, timings and machine codes only; --with-evidence adds termination
            evidence (redacted runtime stderr) and --with-database the raw snapshot. Nothing is
            uploaded and the source worktree is not changed.

Common options: --home <dir> (default $CLAUDE_CODEX_BRIDGE_HOME or
~/.local/share/claude-codex-bridge), --json. Exit status: 0 ok, 1 refused or problems, 2 usage.
`;

const VALUE_FLAGS = new Set([
  "--source", "--ref", "--home", "--workspace", "--runtime", "--to", "--codex-profile",
  "--feature", "--task", "--attempt", "--since", "--db", "--inspect",
]);
const BOOLEAN_FLAGS = new Set([
  "--yes", "--json", "--keep-local", "--no-handshake", "--help", "--with-evidence", "--with-database",
  "--with-preference",
]);
const COMMANDS = new Set(["install", "runtimes", "init", "update", "rollback", "doctor", "diagnose"]);

class UsageError extends Error {}

function parse(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (VALUE_FLAGS.has(flag)) {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith("--")) throw new UsageError(`${flag} requires a value`);
      options[flag.slice(2)] = value;
      index += 1;
    } else if (BOOLEAN_FLAGS.has(flag)) {
      options[flag.slice(2)] = true;
    } else {
      throw new UsageError(`unknown option: ${flag}`);
    }
  }
  if (command === undefined || command === "--help" || command === "-h" || options.help) return { command: "help", options };
  if (!COMMANDS.has(command)) throw new UsageError(`unknown command: ${command}`);
  return { command, options };
}

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function ownRuntime() {
  try {
    return loadRuntimeAt(scriptRoot);
  } catch {
    return null;
  }
}

function requireWorkspace(options) {
  if (!options.workspace) throw new UsageError("--workspace <worktree> is required");
  return options.workspace;
}

/** Default runtime for init: the current selection, the runtime this CLI runs from, or HEAD's. */
function defaultRuntime(home, workspace) {
  const selection = readSelection(canonical(workspace));
  if (selection.kind === "ok") return selection.runtime;
  const own = ownRuntime();
  if (own) return own;
  const head = run("git", ["-C", scriptRoot, "rev-parse", "HEAD"]);
  const commit = head.status === 0 ? head.stdout.trim() : null;
  const match = listRuntimes(home).find((runtime) => runtime.manifest?.source.commit === commit);
  if (match) return match;
  throw new SetupError("RUNTIME_NOT_SELECTED", "no runtime selected for this worktree and none installed for this clone's HEAD", {
    nextStep: "run `install` first, or pass --runtime <id> (see `runtimes`)",
  });
}

function planJson(plan, applied) {
  return {
    format: "claude-codex-bridge.setup-plan/v1",
    action: plan.action,
    workspace: plan.root,
    runtime: { from: plan.from, to: plan.target.id, path: plan.target.path, commit: plan.target.commit },
    ok: plan.ok,
    changed: plan.changed,
    applied,
    changes: plan.ops.map((op) => ({
      kind: op.kind,
      path: op.path,
      action: op.action,
      ...(op.kind === "select" ? { to: op.toPath } : { before_sha256: op.before ?? null, after_sha256: op.after }),
      ...(op.previous ? { diff: unifiedDiff(op.previous.toString("utf8"), (op.content ?? readFileSync(op.source)).toString("utf8"), op.path) } : {}),
    })),
    kept_local: plan.kept,
    conflicts: plan.conflicts,
    refusals: plan.refusals,
    notes: plan.notes,
  };
}

function printPlan(json) {
  const lines = [`${json.action}: ${json.workspace}`, `runtime: ${json.runtime.from ?? "none"} -> ${json.runtime.to} (commit ${json.runtime.commit})`];
  if (json.changes.length > 0) {
    lines.push("changes:");
    for (const change of json.changes) {
      lines.push(`  ${change.kind === "select" ? "select" : change.action.padEnd(6)}  ${change.path}${change.to ? ` -> ${change.to}` : ""}`);
    }
    for (const change of json.changes) if (change.diff) lines.push(change.diff.trimEnd());
  } else {
    lines.push("changes: none");
  }
  for (const kept of json.kept_local) lines.push(`kept local: ${kept.path}`);
  for (const note of json.notes) lines.push(`note: ${note}`);
  if (json.conflicts.length > 0) {
    lines.push("conflicts:");
    for (const conflict of json.conflicts) {
      lines.push(`  ${conflict.code} ${conflict.path}: ${conflict.message}`);
      if (conflict.nextStep) lines.push(`    next: ${conflict.nextStep}`);
    }
  }
  if (json.refusals.length > 0) {
    lines.push("refused:");
    for (const refusal of json.refusals) {
      lines.push(`  ${refusal.code}: ${refusal.message}`);
      if (refusal.nextStep) lines.push(`    next: ${refusal.nextStep}`);
    }
  }
  if (!json.ok) lines.push("result: nothing written");
  else if (json.applied) lines.push("result: applied");
  else if (!json.changed) lines.push("result: no changes");
  else lines.push("result: dry run, nothing written; re-run with --yes to apply");
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function workspaceCommand(command, options, home) {
  const workspace = requireWorkspace(options);
  let target;
  if (command === "init") target = options.runtime ? loadRuntime(home, options.runtime) : defaultRuntime(home, workspace);
  else if (command === "update") {
    if (!options.runtime) throw new UsageError("update requires --runtime <id>");
    target = loadRuntime(home, options.runtime);
  } else target = rollbackTarget(home, workspace, options, loadRuntime);
  // Resolve the worktree with a complete runtime, so an incomplete target is refused, not a crash.
  const selection = readSelection(canonical(workspace));
  const resolver = [selection.kind === "ok" ? selection.runtime : null, ownRuntime(), target]
    .find((runtime) => runtime && existsSync(join(runtime.path, "shared/control-plane/dist/index.js"))) ?? target;
  const identity = await resolveIdentity(resolver.path, workspace);
  const plan = planChange({
    action: command,
    home,
    identity,
    target,
    keepLocal: Boolean(options["keep-local"]),
    preference: Boolean(options["with-preference"]) && command !== "rollback",
  });
  let applied = false;
  if (options.yes && plan.ok && plan.changed) applied = applyPlan(plan).applied;
  const json = planJson(plan, applied);
  if (options.json) process.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
  else printPlan(json);
  return plan.ok ? 0 : 1;
}

async function main(argv) {
  const { command, options } = parse(argv);
  if (command === "help") {
    process.stdout.write(HELP);
    return 0;
  }
  const home = options.home ? resolve(options.home) : bridgeHome();
  if (command === "install") {
    if (!options.source && ownRuntime()) {
      throw new UsageError("this CLI runs from an installed runtime; pass --source <local bridge clone>");
    }
    const { runtime, created } = installRuntime({ source: options.source ?? scriptRoot, ref: options.ref ?? "HEAD", home });
    const result = { format: "claude-codex-bridge.install/v1", created, runtime_id: runtime.id, path: runtime.path, commit: runtime.manifest.source.commit };
    if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
      process.stdout.write(
        `${created ? "installed" : "already installed"}: ${runtime.id}\n  path: ${runtime.path}\n  commit: ${result.commit}\n` +
          `next: node ${join(runtime.path, "scripts", "bridge.mjs")} init --workspace <worktree> --runtime ${runtime.id}\n`,
      );
    }
    return 0;
  }
  if (command === "runtimes") {
    const runtimes = listRuntimes(home).map((runtime) => ({
      id: runtime.id,
      path: runtime.path,
      commit: runtime.manifest?.source.commit ?? null,
      created_at: runtime.manifest?.created_at ?? null,
      error: runtime.error ? runtime.error.code : null,
    }));
    if (options.json) process.stdout.write(`${JSON.stringify({ format: "claude-codex-bridge.runtimes/v1", home: runtimesDir(home), runtimes }, null, 2)}\n`);
    else if (runtimes.length === 0) process.stdout.write(`no runtimes in ${runtimesDir(home)}\n`);
    else for (const runtime of runtimes) process.stdout.write(`${runtime.id}  ${runtime.error ?? runtime.created_at}  ${runtime.path}\n`);
    return 0;
  }
  if (command === "doctor") {
    const report = await runDoctor({
      home,
      workspace: requireWorkspace(options),
      codexProfile: options["codex-profile"],
      handshake: !options["no-handshake"],
      cliRuntime: ownRuntime(),
    });
    process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatDoctor(report));
    return report.status === "ok" ? 0 : 1;
  }
  if (command === "diagnose") {
    const { formatDiagnose, inspectPackage, runDiagnose } = await import("./diagnostics/collect.mjs");
    if (options.inspect) {
      const inspected = inspectPackage(resolve(options.inspect));
      process.stdout.write(`${JSON.stringify(inspected, null, 2)}\n`);
      return inspected.integrity === "ok" ? 0 : 1;
    }
    const report = await runDiagnose({
      home,
      workspace: requireWorkspace(options),
      feature: options.feature,
      task: options.task,
      attempt: options.attempt,
      since: options.since,
      db: options.db,
      withEvidence: Boolean(options["with-evidence"]),
      withDatabase: Boolean(options["with-database"]),
      cliRuntime: ownRuntime(),
    });
    process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatDiagnose(report));
    // A summary is a usable answer, not a failure; a package with gaps is still a package.
    return 0;
  }
  return workspaceCommand(command, options, home);
}

// node:sqlite is still flagged experimental on some supported Node releases; its warning is noise here.
process.removeAllListeners("warning");
process.on("warning", (warning) => {
  if (warning.name === "ExperimentalWarning" && /SQLite/iu.test(warning.message)) return;
  process.stderr.write(`${warning.name}: ${warning.message}\n`);
});

const json = process.argv.includes("--json");
main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    if (error instanceof UsageError) {
      process.stderr.write(`usage error: ${error.message}\n\n${HELP}`);
      process.exitCode = 2;
      return;
    }
    if (error instanceof SetupError) {
      if (json) {
        process.stdout.write(`${JSON.stringify({ format: "claude-codex-bridge.error/v1", code: error.code, message: error.message, next_step: error.nextStep ?? null, details: error.details ?? null }, null, 2)}\n`);
      } else {
        process.stderr.write(`error ${error.code}: ${error.message}\n${error.nextStep ? `  next: ${error.nextStep}\n` : ""}`);
      }
      process.exitCode = 1;
      return;
    }
    process.stderr.write(`${error?.stack ?? String(error)}\n`);
    process.exitCode = 1;
  },
);
