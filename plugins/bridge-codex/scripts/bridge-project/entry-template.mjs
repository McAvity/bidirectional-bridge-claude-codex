#!/usr/bin/env node
// Committed project entry point of the bridge. Deliberately minimal: it holds no workflow, no
// setup logic and no policy — only enough to find the pinned installed runtime and let *its* code
// take over in this same process. Everything generic lives in the installation, never here.
//
// Written by the bridge; edit `.bridge-project/bridge.json` instead. A hand edited copy is
// detected and refused rather than overwritten.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// `fileURLToPath`, not `.pathname`: a project directory may contain spaces, which a URL
// percent-encodes and the filesystem does not.
const here = fileURLToPath(new URL(".", import.meta.url));

function bridgeHome() {
  const explicit = process.env.CLAUDE_CODEX_BRIDGE_HOME;
  if (explicit) return resolve(explicit);
  const data = process.env.XDG_DATA_HOME && isAbsolute(process.env.XDG_DATA_HOME)
    ? process.env.XDG_DATA_HOME
    : join(homedir(), ".local", "share");
  return join(data, "claude-codex-bridge");
}

// `--status` / `--instructions`: report this project's pin and the instruction paths of the
// runtime it selects, then exit. Purely a read, and the answer stays useful when the runtime is
// missing, so a manager is never left guessing which workflow version a project expects.
const argv = process.argv.slice(2);
const reading = argv.includes("--status") || argv.includes("--instructions");

function fail(code, message, nextStep) {
  if (reading) {
    const report = { format: "claude-codex-bridge.project-entry/v1", ok: false, state: code.toLowerCase(),
      error: { code, message }, next_step: nextStep, instructions: null, reads_only: true };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(1);
  }
  process.stderr.write(`claude-codex-bridge: ${message}\n  next: ${nextStep}\n`);
  process.exit(1);
}

const SETUP_STEP = "ask the bridge setup skill to prepare this project again";

let declaration;
try {
  declaration = JSON.parse(readFileSync(join(here, "bridge.json"), "utf8"));
} catch (error) {
  fail("DECLARATION_UNREADABLE", `cannot read .bridge-project/bridge.json (${error.message})`, SETUP_STEP);
}
const runtimeId = declaration?.pinned?.runtime_id;
if (declaration?.format !== "claude-codex-bridge.project/v1" || typeof runtimeId !== "string") {
  fail("DECLARATION_INVALID", "the project declaration is not a recognised bridge declaration", SETUP_STEP);
}
if (declaration.enabled === false && !reading) {
  fail("PROJECT_DISABLED", "the bridge is disabled for this project", "set enabled to true in .bridge-project/bridge.json, or ask the setup skill to enable it");
}

const dispatcher = join(bridgeHome(), "runtimes", runtimeId, "scripts", "bridge-project", "dispatch.mjs");
let launch;
try {
  ({ launch } = await import(pathToFileURL(dispatcher).href));
} catch (error) {
  fail(
    "RUNTIME_NOT_INSTALLED",
    `the pinned runtime ${runtimeId} is not installed here (${error.code ?? error.message})`,
    "ask the bridge setup skill to set this project up; it installs exactly this pinned runtime",
  );
}
await launch({ cwd: process.cwd(), argv, declaration });
