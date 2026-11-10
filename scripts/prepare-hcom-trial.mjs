#!/usr/bin/env node
// Test-branch entry: compose existing installers/readers, never change a selection.
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadRuntimeAt, verifyRuntime } from "./setup/runtime.mjs";

const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const feature = "F-W21-repo-trial";
const cli = "plugins/feature-workflow-codex/scripts/workflow.mjs";
const json = path => JSON.parse(readFileSync(join(root, path), "utf8"));
function run(script, args) {
  const result = spawnSync(process.execPath, [join(root, script), ...args], {
    cwd: root, encoding: "utf8", env: process.env, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${script}: ${result.error?.message ?? result.stderr}\n${result.stdout}`);
  }
  return JSON.parse(result.stdout);
}
function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}
try {
  requireCondition(process.argv.length === 2, "This entry takes no version or transport choices.");
  requireCondition(realpathSync(process.cwd()) === root, "Run npm run hcom:prepare from this worktree root.");
  const pin = json(".bridge-project/bridge.json");
  const release = json("scripts/plugin-packages/release.json");
  const lock = json(`docs/features/${feature}/workflow.lock.json`);
  const index = json(`docs/features/${feature}/feature.json`);
  requireCondition(index.phase !== 'blocked',
    'TRIAL_BLOCKED: this historical trial is preserved on workflow 1.1.0. Read its review; a new release does not authorize replay or migrate its lock.');
  requireCondition(pin.enabled === true && pin.pinned?.commit === release.pinned.commit &&
    pin.pinned?.runtime_id === `${release.package_version}-${release.pinned.commit.slice(0, 12)}`,
  "Project pin differs from this branch's release; nothing was changed.");
  requireCondition(index.feature_id === feature && index.execution?.transport === "hcom" &&
    lock.feature?.feature_id === feature, "Trial identity or transport differs; nothing was changed.");
  const bundle = run(cli, ["verify-plugin", "--json"]);
  requireCondition(bundle.ok && bundle.identity === lock.workflow?.identity,
    "Committed lock does not match the bundled workflow; nothing was changed.");

  // Installs alongside old versions if absent; never rebuilds an existing runtime.
  const runtime = run("scripts/bridge.mjs", ["install", "--source", root,
    "--ref", pin.pinned.commit, "--json"]);
  requireCondition(runtime.runtime_id === pin.pinned.runtime_id, "Installed runtime identity mismatch.");
  const verified = verifyRuntime(loadRuntimeAt(runtime.path, runtime.runtime_id));
  requireCondition(verified.length === 0, `Runtime verification failed: ${JSON.stringify(verified)}`);
  run(cli, ["restore", "--identity", lock.workflow.identity,
    "--from", join(root, "plugins/feature-workflow-codex"), "--json"]);
  const selected = run(cli, ["resolve", "--feature", feature, "--entry", "feature-execute", "--json"]);
  requireCondition(selected.source === "bundle" && selected.code === "BOUND_BUNDLE" &&
    selected.bundle?.identity === lock.workflow.identity &&
    selected.project?.runtime_id === pin.pinned.runtime_id,
  "Resolved workflow/runtime mismatch; no fallback selected.");
  process.stdout.write(`${JSON.stringify({ ready: true, model_started: false,
    workspace: root, feature, transport: "hcom", runtime: runtime.runtime_id,
    workflow: selected.bundle, instructions: selected.instructions, record: selected.record,
    next: "Read the selected feature-execute skill and the committed trial documents; execute the authorized hcom task.",
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
