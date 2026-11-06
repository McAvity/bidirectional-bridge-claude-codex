// Legacy adapter (`legacy-adapter/v1`) of the bridge runtime: turns the workflow-owned part of an
// exact, installed old runtime's instruction set into a dual-client bundle (contract F-W19
// 01-workflow-binding.md § 10.2). Runtime-side only; it is not copied into workflow packages.
//
// Rules:
//   - the source is the runtime's own manifest (`instructions.files` with hashes); every file is
//     verified, and the recomputed set digest must equal the expected one — never a guess;
//   - only `.agents/skills/feature-*/**` and `docs/features/README.md` are taken; `using-bridge`,
//     `bridge-upgrade` and any `plugins/bridge-*` stay with the current runtime;
//   - client variants are produced by the generator's own reference rewriting; the rule text is
//     otherwise unchanged and no preamble is added. The adapter's source hash is provenance.

import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { rewriteForClaude, rewriteForCodex } from "../plugin-packages/generate.mjs";
import * as W from "./workflow-lib.mjs";

export const ADAPTER_NAME = "legacy-adapter/v1";
const SKILLS = ".agents/skills/";
const GUIDE = "docs/features/README.md";
const REWRITABLE = /\.(md|yaml|yml)$/u;

export function adapterSha256() {
  const own = readFileSync(fileURLToPath(import.meta.url));
  const generator = readFileSync(fileURLToPath(new URL("../plugin-packages/generate.mjs", import.meta.url)));
  return W.sha256(Buffer.concat([own, Buffer.from("\0"), generator]));
}

/** The set digest exactly as the installer computes it (setup/runtime.mjs). */
export function setDigest(files) {
  return W.sha256(files.map((file) => `${file.path}\0${file.sha256}\n`).join(""));
}

/** Workflow-owned paths of an old instruction set; everything else is listed as excluded. */
export function partition(files) {
  const included = [];
  const excluded = [];
  for (const file of files) {
    if ((file.path.startsWith(`${SKILLS}feature-`) && file.path.split("/").length > 3) || file.path === GUIDE) included.push(file);
    else excluded.push(file.path);
  }
  return { included, excluded };
}

/**
 * Read and verify an installed runtime's instruction set. Throws WorkflowError codes:
 * LEGACY_SOURCE_MISSING, LEGACY_SET_MISMATCH, LEGACY_SOURCE_CORRUPT.
 */
export function readRuntimeSet(runtimeDir, expectedSetSha256) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(runtimeDir, "runtime-manifest.json"), "utf8"));
  } catch {
    throw new W.WorkflowError("LEGACY_SOURCE_MISSING", runtimeDir, { next_step: "reinstall exactly the recorded runtime (setup install by pin); no newer set is substituted" });
  }
  const files = manifest?.instructions?.files;
  if (!Array.isArray(files) || typeof manifest.instructions.set_sha256 !== "string") {
    throw new W.WorkflowError("LEGACY_SOURCE_CORRUPT", "runtime manifest lists no instruction set");
  }
  if (manifest.instructions.set_sha256 !== expectedSetSha256) {
    throw new W.WorkflowError("LEGACY_SET_MISMATCH", manifest.instructions.set_sha256, { expected: expectedSetSha256 });
  }
  if (setDigest(files) !== manifest.instructions.set_sha256) throw new W.WorkflowError("LEGACY_SOURCE_CORRUPT", "set digest does not match its file list");
  const contents = new Map();
  for (const file of files) {
    if (!W.safeRelpath(file.path)) throw new W.WorkflowError("LEGACY_SOURCE_CORRUPT", `unsafe path ${file.path}`);
    const path = join(runtimeDir, file.path);
    let stat;
    try {
      stat = lstatSync(path);
    } catch {
      throw new W.WorkflowError("LEGACY_SOURCE_CORRUPT", `missing ${file.path}`);
    }
    if (!stat.isFile()) throw new W.WorkflowError("LEGACY_SOURCE_CORRUPT", `not a regular file: ${file.path}`);
    const data = readFileSync(path);
    if (W.sha256(data) !== file.sha256) throw new W.WorkflowError("LEGACY_SOURCE_CORRUPT", `hash mismatch: ${file.path}`);
    contents.set(file.path, { data, mode: (stat.mode & 0o100) !== 0 ? "755" : "644" });
  }
  return { manifest, files, contents };
}

/**
 * Build the legacy bundle (manifest + variants) for `runtimeId` from its verified set.
 * `profile` is the runtime's legacy profile: `{requires}` checked like any release (§ 10.5).
 */
export function legacyBundle({ runtimeDir, runtimeId, expectedSetSha256, profile }) {
  const { manifest, files, contents } = readRuntimeSet(runtimeDir, expectedSetSha256);
  const { included, excluded } = partition(files);
  if (!included.some((file) => file.path.startsWith(SKILLS))) throw new W.WorkflowError("LEGACY_SOURCE_CORRUPT", "the set has no feature-* skills");
  const version = `legacy-${runtimeId}`;
  const variants = {};
  for (const [client, rewrite] of [["claude", rewriteForClaude], ["codex", rewriteForCodex]]) {
    const files_ = {};
    files_[`.${client}-plugin/plugin.json`] = {
      data: W.jsonBytes({ name: "feature-workflow", version, description: `Legacy workflow of runtime ${runtimeId} (adapter ${ADAPTER_NAME}).`, skills: "./skills/" }),
      mode: "644",
    };
    for (const file of included) {
      const source = contents.get(file.path);
      const rel = file.path === GUIDE ? "workflow/README.md" : `skills/${file.path.slice(SKILLS.length)}`;
      const data = REWRITABLE.test(file.path) ? Buffer.from(rewrite(source.data.toString("utf8")), "utf8") : source.data;
      files_[rel] = { data, mode: source.mode };
    }
    variants[client] = files_;
  }
  const bundle = W.bundleManifest({
    version,
    kind: "legacy",
    requires: profile.requires,
    variants,
    legacy: {
      runtime_id: runtimeId,
      runtime_commit: manifest.source?.commit ?? null,
      instructions_set_sha256: expectedSetSha256,
      adapter: { name: ADAPTER_NAME, sha256: adapterSha256() },
      workflow_files: included.map((file) => ({ path: file.path, sha256: file.sha256 })),
    },
    source: { runtime_id: runtimeId, runtime_commit: manifest.source?.commit ?? null, commit: null },
  });
  return { manifest: bundle, variants, excluded };
}
