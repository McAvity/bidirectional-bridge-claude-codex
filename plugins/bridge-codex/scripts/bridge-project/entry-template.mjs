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
import { pathToFileURL } from "node:url";

const here = new URL(".", import.meta.url).pathname;

function bridgeHome() {
  const explicit = process.env.CLAUDE_CODEX_BRIDGE_HOME;
  if (explicit) return resolve(explicit);
  const data = process.env.XDG_DATA_HOME && isAbsolute(process.env.XDG_DATA_HOME)
    ? process.env.XDG_DATA_HOME
    : join(homedir(), ".local", "share");
  return join(data, "claude-codex-bridge");
}

function fail(message, nextStep) {
  process.stderr.write(`claude-codex-bridge: ${message}\n  next: ${nextStep}\n`);
  process.exit(1);
}

let declaration;
try {
  declaration = JSON.parse(readFileSync(join(here, "bridge.json"), "utf8"));
} catch (error) {
  fail(`cannot read .bridge-project/bridge.json (${error.message})`, "ask the bridge setup skill to prepare this project again");
}
const runtimeId = declaration?.pinned?.runtime_id;
if (declaration?.format !== "claude-codex-bridge.project/v1" || typeof runtimeId !== "string") {
  fail("the project declaration is not a recognised bridge declaration", "ask the bridge setup skill to prepare this project again");
}
if (declaration.enabled === false) {
  fail("the bridge is disabled for this project", "set enabled to true in .bridge-project/bridge.json, or ask the setup skill to enable it");
}

const dispatcher = join(bridgeHome(), "runtimes", runtimeId, "scripts", "bridge-project", "dispatch.mjs");
let launch;
try {
  ({ launch } = await import(pathToFileURL(dispatcher).href));
} catch (error) {
  fail(
    `the pinned runtime ${runtimeId} is not installed here (${error.code ?? error.message})`,
    "ask the bridge setup skill to set this project up; it installs exactly this pinned runtime",
  );
}
await launch({ cwd: process.cwd(), argv: process.argv.slice(2), declaration });
