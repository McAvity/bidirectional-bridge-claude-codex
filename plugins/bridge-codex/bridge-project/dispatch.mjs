#!/usr/bin/env node
// The portable project dispatcher.
//
// This file is committed into an enabled project and inherited by every worktree created from it.
// It contains no home directory, no runtime id and no machine path, so the same bytes work for
// every user and every checkout. The host starts it with the project directory as the working
// directory; from there it resolves the real worktree, reads the project's authoritative pin, and
//
//   - hands the connection to the pinned installed runtime when that runtime is present, so the
//     native identity guard, the delegation policy and the workspace binding are exactly the ones
//     that runtime implements — this dispatcher adds none of its own;
//   - otherwise serves the static-catalogue facade, which can report and prepare and nothing else.
//
// Starting it is not a claim: neither branch creates domain state, and a foreign or copied record
// is refused by the code below it, not repaired.

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bridgeHome, readDeclaration, resolveRuntime, resolveWorkspace } from "./locate.mjs";

export function parseArgs(argv) {
  const out = { caller: "codex", delegation: "allow" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--caller") out.caller = argv[index + 1];
    else if (argv[index] === "--delegation") out.delegation = argv[index + 1];
  }
  return out;
}

/** What this dispatcher would do, without doing it. Used by `status` and by the tests. */
export function plan({ cwd = process.cwd(), env = process.env } = {}) {
  const workspace = resolveWorkspace(cwd);
  const declaration = readDeclaration(workspace.root);
  const pin = declaration.kind === "valid" ? declaration.value.pinned : null;
  const runtime = resolveRuntime(bridgeHome(env), pin?.runtime_id ?? null);
  return {
    workspace,
    pin,
    runtime,
    route: runtime.state === "ok" ? "runtime" : "facade",
  };
}

export async function main(argv, { cwd = process.cwd(), env = process.env } = {}) {
  const args = parseArgs(argv);
  const decision = plan({ cwd, env });

  if (decision.route === "facade") {
    const { serve } = await import("./facade.mjs");
    process.stderr.write(
      `claude-codex-bridge: pinned runtime ${decision.pin?.runtime_id ?? "<none declared>"} is not installed ` +
        `(${decision.runtime.state}); serving the setup facade for ${decision.workspace.root}\n`,
    );
    serve({ context: { cwd, env } });
    return new Promise(() => {});
  }

  // The workspace is passed explicitly and absolutely: the runtime binds it for the process
  // lifetime and validates identity itself. Nothing is inferred from PWD.
  const child = spawn(
    process.execPath,
    [decision.runtime.launcher, "--caller", args.caller, "--delegation", args.delegation, "--workspace", decision.workspace.root],
    { cwd: decision.workspace.root, stdio: "inherit", env: process.env },
  );
  return new Promise((resolve) => {
    child.on("exit", (code, signal) => resolve(signal ? 1 : (code ?? 0)));
  });
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      if (typeof code === "number") process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`claude-codex-bridge dispatcher: ${error?.stack ?? String(error)}\n`);
      process.exitCode = 1;
    },
  );
}

export { dirname, join };
