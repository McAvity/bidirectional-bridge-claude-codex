#!/usr/bin/env node
// W17-01 probe entry for the instruction-source reader. Since W17-02 the only implementation is
// the canonical scripts/workflow-source/select-source.mjs; this file re-exports it so the W17-01
// probes and their recorded commands keep working without a second, competing algorithm.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../workflow-source/select-source.mjs";

export * from "../workflow-source/select-source.mjs";

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Without --package-root the probes' historical default was scripts/; keep it.
  process.exitCode = await main(process.argv.slice(2), resolve(fileURLToPath(import.meta.url), "..", ".."));
}
