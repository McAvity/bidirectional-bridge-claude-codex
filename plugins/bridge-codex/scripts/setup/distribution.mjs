// Distribution metadata: which integration this worktree actually uses, and which versions.
//
// This is the bridge's own doctor metadata. It is **not** a wave13 diagnose integration: wave13
// owns logging, retention and export and is absent from this baseline, so nothing here writes a
// log, opens a sink or claims that a diagnose report consumed it.
//
// Privacy rules, from review finding W14-R1-04:
//   - no absolute path leaves this module. A path becomes a stable location *class* plus a
//     SHA-256, which allows correlation but does not guarantee anonymity against guessing;
//   - a value that was only *configured* is never reported as *observed*. Configured and observed
//     executor identity are separate fields, and an unobserved value is `null`, never `false`;
//   - divergence is tri-state: `true`, `false`, or `null` when it could not be determined.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
import { readBounded } from "../diagnostics/safe-read.mjs";
import { sha256 } from "./common.mjs";

export const DISTRIBUTION_FORMAT = "claude-codex-bridge.distribution/v1";

/**
 * Classify a path without disclosing it.
 *
 * The class is the only human-readable part; the digest lets two reports be compared. Wave13
 * stays authoritative for aliasing and for any allowlist: this is deliberately the smallest
 * safe shape, not a competing redaction scheme.
 */
export function locationOf(path, { home = null, worktree = null, userHome = homedir() } = {}) {
  if (!path) return null;
  const inside = (base) => base && (path === base || path.startsWith(base.endsWith(sep) ? base : base + sep));
  let location = "other";
  if (inside(home ? join(home, "runtimes") : null)) location = "installed-runtime";
  else if (inside(worktree)) location = "worktree";
  else if (/[\\/]plugins[\\/]cache[\\/]/u.test(path)) location = "plugin-cache";
  else if (inside(userHome)) location = "user-home";
  return { location, sha256: sha256(path), depth: path.split(sep).filter(Boolean).length };
}

function readJson(root, path) {
  try {
    return JSON.parse(readBounded(root, path, { maxBytes: 1024 * 1024, from: "start" }).data.toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Build the distribution block.
 *
 * `observed` carries facts taken from something that actually ran (an attempt record, a live
 * handshake). When no observation is available every observed field stays `null`; the caller
 * must not substitute the configured value.
 */
export function distributionMetadata({
  home,
  worktree,
  runtime = null,
  declaration = null,
  selection = null,
  integrationSource = "unknown",
  observed = null,
  userHome = homedir(),
} = {}) {
  const place = (path) => locationOf(path, { home, worktree, userHome });
  const manifest = runtime?.manifest ?? null;
  const declaredPin = declaration?.pinned?.runtime_id ?? null;
  const appliedPin = selection?.runtime_id ?? null;

  const executorPackage = runtime?.path ? join(runtime.path, "plugins", "bridge-claude") : null;
  const executorPackagePresent = executorPackage ? existsSync(join(executorPackage, ".claude-plugin", "plugin.json")) : false;
  const generated = executorPackagePresent ? readJson(runtime.path, join(executorPackage, "GENERATED.json")) : null;

  return {
    format: DISTRIBUTION_FORMAT,
    integration_source: integrationSource,
    package: {
      name: generated?.plugin ?? null,
      version: generated?.version ?? null,
      source_digest: generated?.source_digest ?? null,
    },
    runtime: {
      runtime_id: runtime?.id ?? null,
      commit: manifest?.source?.commit ?? null,
      location: place(runtime?.path ?? null),
    },
    instructions: {
      set_sha256: manifest?.instructions?.set_sha256 ?? null,
      file_count: manifest?.instructions?.files?.length ?? null,
      // The instruction set lives where the runtime lives; the raw path is never emitted.
      location: place(runtime?.path ?? null),
    },
    executor: {
      configured_plugin_dir: place(executorPackagePresent ? executorPackage : null),
      configured_package_version: generated?.version ?? null,
      // Only a real delegated run can fill these in. Static configuration never may.
      observed_plugin_dir: observed?.executorPluginDir ? place(observed.executorPluginDir) : null,
      observed_package_version: observed?.executorPackageVersion ?? null,
      observed_at: observed?.at ?? null,
    },
    pin: {
      declared: declaredPin,
      applied: appliedPin,
      // Tri-state: `null` means "not determined", which is not the same as "they agree".
      diverged: declaredPin === null || appliedPin === null ? null : declaredPin !== appliedPin,
    },
    notes: [
      "Locations are classes and digests, never paths.",
      "Observed fields are null unless a real run reported them; configured values are never copied into them.",
      "Wave13 owns logging, retention and diagnose; this block is doctor metadata only.",
    ],
  };
}

export { relative };
