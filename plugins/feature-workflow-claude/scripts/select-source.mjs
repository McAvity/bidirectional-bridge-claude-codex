#!/usr/bin/env node
// Instruction-source reader of the feature-workflow plugin. Canonical source; the generator copies
// it verbatim to `<package>/scripts/select-source.mjs` in both workflow packages. Contract:
// docs/features/F-W17-workflow-plugin/contracts/01-distribution.md § 4.
//
//   node select-source.mjs [--cwd DIR] [--package-root DIR] [--standalone] [--json]
//
// It answers one question: which instruction set must a feature-workflow skill follow in this
// worktree — this package's own resources, or the runtime the project pins? It never writes,
// never installs, never starts an MCP server and never executes the project's entry point. A
// project pin is classified by the pinned runtime's own `scripts/bridge-project/locate.mjs`, so
// there is no second pin algorithm here; the only local logic is finding that file.
//
// The project pin always comes first (review R02-01). Where this package lies on disk proves
// neither delegation nor the pin: it is compared with the pin only after the pinned runtime
// classified the worktree as serving, and a package inside a different runtime is refused.
//
// Exit codes: 0 answer, 3 refusal (`source: none`), 1 reader error.

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const FORMAT = "feature-workflow.instruction-source/v1";
export const HOME_ENV = "CLAUDE_CODEX_BRIDGE_HOME";
const DECLARATION = ".bridge-project/bridge.json";
const READER = "scripts/bridge-project/locate.mjs";
const LOCAL_DELIVERY = "feature-execute/references/local-delivery.md";
const RUNTIME_ID = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}-[0-9a-f]{12}$/u;
// States in which the pinned runtime is the unambiguous instruction set of this worktree.
const SERVING = new Set(["ready", "inherited-pristine"]);

/** Same rule as locate.mjs:bridgeHome; the runtime's own answer is cross-checked below. */
export function bridgeHome(env = process.env) {
  if (env[HOME_ENV]) return resolve(env[HOME_ENV]);
  const data = env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : join(homedir(), ".local", "share");
  return join(data, "claude-codex-bridge");
}

function real(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function worktreeOf(cwd) {
  const top = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  return top.status === 0 && top.stdout.trim() ? real(top.stdout.trim()) : null;
}

/**
 * The installed runtime directory this package lies in, if any. A location only: it is never
 * treated as a delegation identity or as a pin, only checked against a pin already resolved.
 */
export function packageRuntime(packageRoot, home) {
  const rel = relative(real(join(home, "runtimes")), real(packageRoot));
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  const id = rel.split(sep)[0];
  return RUNTIME_ID.test(id) ? id : null;
}

function readDeclaration(root) {
  const path = join(root, DECLARATION);
  if (!existsSync(path)) return { kind: "absent" };
  try {
    return { kind: "present", value: JSON.parse(readFileSync(path, "utf8")) };
  } catch (error) {
    return { kind: "invalid", detail: String(error.message ?? error) };
  }
}

/** Traces of the wave12 per-worktree layout or of a bridge block without a portable declaration. */
function legacyTraces(root) {
  const traces = [];
  for (const rel of [".bridge-runtime", ".bridge"]) if (existsSync(join(root, rel))) traces.push(rel);
  const config = join(root, ".codex/config.toml");
  if (existsSync(config) && /^\s*\[mcp_servers\.bridge\]/mu.test(readFileSync(config, "utf8"))) traces.push(".codex/config.toml [mcp_servers.bridge]");
  return traces;
}

function packageInfo(packageRoot) {
  let marker = null;
  try {
    marker = JSON.parse(readFileSync(join(packageRoot, "GENERATED.json"), "utf8"));
  } catch {
    marker = null;
  }
  return { root: packageRoot, plugin: marker?.plugin ?? null, version: marker?.version ?? null, source_digest: marker?.source_digest ?? null };
}

function pluginInstructions(packageRoot) {
  const skills = join(packageRoot, "skills");
  return {
    workflow_skills: skills,
    guide: join(packageRoot, "workflow/README.md"),
    exchange_helper: join(skills, "feature-exchange/scripts/feature_exchange.py"),
    local_delivery: existsSync(join(skills, LOCAL_DELIVERY)) ? join(skills, LOCAL_DELIVERY) : null,
  };
}

function runtimeInstructions(runtimePath, fromStatus) {
  const skills = fromStatus?.workflow_skills ?? join(runtimePath, ".agents/skills");
  return {
    workflow_skills: skills,
    guide: join(runtimePath, "docs/features/README.md"),
    exchange_helper: fromStatus?.exchange_helper ?? join(skills, "feature-exchange/scripts/feature_exchange.py"),
    claude_executor_package: fromStatus?.claude_executor_package ?? null,
    local_delivery: existsSync(join(skills, LOCAL_DELIVERY)) ? join(skills, LOCAL_DELIVERY) : null,
  };
}

/** The runtime's reader is used only when its text exports both functions this contract relies on. */
function servesReader(runtimePath) {
  const path = join(runtimePath, READER);
  if (!existsSync(path)) return false;
  const text = readFileSync(path, "utf8");
  return /export\s+function\s+status\s*\(/u.test(text) && /export\s+function\s+instructionPaths\s*\(/u.test(text);
}

function record(result) {
  if (result.source === "plugin") {
    return `INSTRUCTIONS=plugin:${result.package.plugin ?? "unknown"}@${result.package.version ?? "unknown"} DIGEST=${result.package.source_digest ?? "unknown"}`;
  }
  if (result.source === "runtime") return `INSTRUCTIONS=runtime:${result.runtime.id} SET=${result.runtime.set_sha256 ?? "unknown"}`;
  return `INSTRUCTIONS=none CODE=${result.code}`;
}

export async function selectSource({ cwd = process.cwd(), env = process.env, packageRoot, standalone = false } = {}) {
  if (!packageRoot || !existsSync(packageRoot) || !statSync(packageRoot).isDirectory()) {
    throw new Error(`package root is not an existing directory: ${packageRoot}`);
  }
  const home = bridgeHome(env);
  const root = worktreeOf(real(cwd));
  const base = {
    format: FORMAT,
    reads_only: true,
    worktree: root,
    home,
    explicit_standalone: standalone,
    package: { ...packageInfo(packageRoot), inside_runtime: packageRuntime(packageRoot, home) },
    declaration: null,
    runtime: null,
    instructions: null,
    next_step: null,
  };
  const finish = (fields) => {
    const result = { ...base, ...fields };
    result.record = record(result);
    return result;
  };
  const plugin = (code, extra = {}) => finish({ source: "plugin", code, instructions: pluginInstructions(packageRoot), ...extra });
  // Everything that is not a working pin: diagnose, never fall back — unless the user scoped the
  // work as standalone, which is then recorded together with what was not used.
  const refuse = (code, nextStep, extra = {}) =>
    standalone
      ? plugin("EXPLICIT_STANDALONE", { pin_not_used: code, next_step: nextStep, ...extra })
      : finish({ source: "none", code, next_step: nextStep, ...extra });

  if (root === null) return plugin("STANDALONE_NO_WORKTREE");
  const declaration = readDeclaration(root);
  if (declaration.kind === "absent") {
    const traces = legacyTraces(root);
    if (traces.length === 0) return plugin("STANDALONE_NO_BRIDGE");
    return refuse("LEGACY_LAYOUT", "this worktree has bridge state but no portable declaration; run the bridge plugin's status or `doctor` and migrate with its setup", { legacy_traces: traces });
  }
  if (declaration.kind === "invalid") {
    return refuse("DECLARATION_INVALID", `${DECLARATION} is not valid JSON; inspect it — nothing was changed`, { declaration: { kind: "invalid", detail: declaration.detail } });
  }
  const pin = declaration.value?.pinned ?? {};
  base.declaration = { enabled: declaration.value?.enabled !== false, runtime_id: pin.runtime_id ?? null, commit: pin.commit ?? null };
  if (typeof pin.runtime_id !== "string" || !RUNTIME_ID.test(pin.runtime_id)) {
    return refuse("DECLARATION_INVALID", `${DECLARATION} names no valid pinned runtime id`);
  }
  if (declaration.value.enabled === false) {
    return refuse("PROJECT_DISABLED", `the bridge is disabled for this project in ${DECLARATION}; work standalone only when the user scopes it so`);
  }
  const runtimePath = join(home, "runtimes", pin.runtime_id);
  if (!existsSync(join(runtimePath, "runtime-manifest.json"))) {
    return refuse("RUNTIME_MISSING", `runtime ${pin.runtime_id} is not installed under ${join(home, "runtimes")}; ask the bridge setup skill to install exactly that pin`, {
      runtime: { id: pin.runtime_id, path: runtimePath, commit: null, state: "runtime-missing", set_sha256: null },
    });
  }
  if (!servesReader(runtimePath)) {
    return refuse("RUNTIME_WITHOUT_READER", `runtime ${pin.runtime_id} ships no ${READER} with status/instructionPaths; use the bridge plugin's status`, {
      runtime: { id: pin.runtime_id, path: runtimePath, commit: null, state: "without-reader", set_sha256: null },
    });
  }

  const locate = await import(pathToFileURL(join(runtimePath, READER)).href);
  const status = locate.status(root, env);
  const runtime = {
    id: pin.runtime_id,
    path: runtimePath,
    commit: status.runtime?.commit ?? null,
    state: status.state,
    set_sha256: status.instructions?.set_sha256 ?? null,
  };
  if (real(status.home) !== real(home)) {
    return refuse("HOME_MISMATCH", `the pinned runtime resolves the bridge home as ${status.home}, not ${home}; set ${HOME_ENV} explicitly`, { runtime });
  }
  if (!SERVING.has(status.state) || !status.instructions) {
    return refuse("PIN_UNRESOLVED", status.next_step ?? `the project pin is in state ${status.state}`, { runtime, pin_state: status.state });
  }
  // The pin is valid and serving. A package inside a *different* runtime is a conflict between
  // the copy being run and the pin; `--standalone` cannot waive it, because a valid pin wins.
  const inside = base.package.inside_runtime;
  if (inside !== null && inside !== pin.runtime_id) {
    return finish({
      source: "none",
      code: "PACKAGE_PIN_MISMATCH",
      runtime,
      next_step: `this package belongs to runtime ${inside} but the project pins ${pin.runtime_id}; ` +
        "run the pinned runtime's instructions, or move the pin with the bridge setup skill",
    });
  }
  return finish({
    source: "runtime",
    code: "PINNED_RUNTIME",
    runtime,
    instructions: runtimeInstructions(runtimePath, status.instructions),
    package_matches_pin: inside === pin.runtime_id,
  });
}

function parse(argv, defaultPackageRoot) {
  const options = { cwd: process.cwd(), packageRoot: defaultPackageRoot, standalone: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--cwd") options.cwd = resolve(argv[++index]);
    else if (flag === "--package-root") options.packageRoot = resolve(argv[++index]);
    else if (flag === "--standalone") options.standalone = true;
    else if (flag === "--json") options.json = true;
    else throw new Error(`unknown argument ${flag}`);
  }
  if (!statSync(options.cwd).isDirectory()) throw new Error(`not a directory: ${options.cwd}`);
  return options;
}

/**
 * Command-line entry. The default package root is the directory above this file, which inside a
 * generated package is the package itself (`<package>/scripts/select-source.mjs`).
 */
export async function main(argv = process.argv.slice(2), defaultPackageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")) {
  try {
    const result = await selectSource(parse(argv, defaultPackageRoot));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.source === "none" ? 3 : 0;
  } catch (error) {
    process.stderr.write(`${error?.stack ?? String(error)}\n`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
