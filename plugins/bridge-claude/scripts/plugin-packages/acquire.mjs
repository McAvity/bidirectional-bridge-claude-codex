// Obtain the pinned bridge source, so nobody has to clone anything by hand.
//
// The Codex package carries `release.json` with a pinned commit. This module turns that pin into
// a local checkout whose commit hash is verified, which the wave12 installer then builds into an
// immutable runtime. It never resolves a branch, never uses HEAD and never installs anything
// itself.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SetupError, run } from "../setup/common.mjs";

export const RELEASE_FORMAT = "claude-codex-bridge.release/v1";
export const SOURCE_ENV = "CLAUDE_CODEX_BRIDGE_SOURCE";

export function readRelease(from = join(dirname(fileURLToPath(import.meta.url)), "release.json")) {
  const value = JSON.parse(readFileSync(from, "utf8"));
  if (value.format !== RELEASE_FORMAT) {
    throw new SetupError("RELEASE_INVALID", `${from} is not a ${RELEASE_FORMAT} descriptor`, { nextStep: "reinstall the plugin" });
  }
  if (!/^[0-9a-f]{40}$/u.test(value.pinned?.commit ?? "")) {
    throw new SetupError("RELEASE_UNPINNED", `${from} does not pin a full commit hash`, {
      nextStep: "reinstall the plugin, or pass --source <bridge clone> --commit <sha> explicitly",
    });
  }
  return value;
}

export const sourcesDir = (home) => join(home, "sources");

function hasCommit(repository, commit) {
  const out = run("git", ["-C", repository, "cat-file", "-e", `${commit}^{commit}`]);
  return out.status === 0;
}

/** The commit a checkout would actually archive, so a wrong pin can never be built silently. */
function verify(repository, commit) {
  const out = run("git", ["-C", repository, "rev-parse", `${commit}^{commit}`]);
  if (out.status !== 0 || out.stdout.trim() !== commit) {
    throw new SetupError("SOURCE_COMMIT_MISMATCH", `${repository} does not contain the pinned commit ${commit}`, {
      nextStep: "pass --source <clone that contains it>, or reinstall the plugin for a release you can fetch",
    });
  }
  return { repository, commit };
}

/**
 * Resolve a checkout containing `commit`, cloning it only if nothing local already has it.
 *
 * Order: an explicit `source`, the `CLAUDE_CODEX_BRIDGE_SOURCE` environment variable, a cache
 * under `<home>/sources/`, then a fetch from `repository`. The first four never touch the
 * network, which is what makes the tests offline and reproducible.
 */
export function acquireSource({ home, commit, repository, source = null, env = process.env, allowNetwork = true }) {
  const candidates = [source, env[SOURCE_ENV]].filter(Boolean).map((path) => resolve(path));
  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      throw new SetupError("SOURCE_MISSING", `${candidate} does not exist`, { nextStep: "pass an existing bridge clone" });
    }
    return { ...verify(candidate, commit), origin: "explicit" };
  }

  const cache = join(sourcesDir(home), "bridge.git");
  if (existsSync(cache) && hasCommit(cache, commit)) return { ...verify(cache, commit), origin: "cache" };

  if (!allowNetwork) {
    throw new SetupError("SOURCE_UNAVAILABLE_OFFLINE", `no local checkout contains ${commit} and fetching is disabled`, {
      nextStep: `pass --source <bridge clone>, or set ${SOURCE_ENV}`,
    });
  }
  if (!repository) {
    throw new SetupError("SOURCE_UNAVAILABLE", `no local checkout contains ${commit} and the release names no repository`, {
      nextStep: `pass --source <bridge clone>, or set ${SOURCE_ENV}`,
    });
  }

  mkdirSync(sourcesDir(home), { recursive: true });
  if (!existsSync(cache)) {
    const init = run("git", ["init", "--bare", "-q", cache], { timeoutMs: 120_000 });
    if (init.status !== 0) {
      throw new SetupError("SOURCE_INIT_FAILED", `could not create ${cache}: ${init.stderr.trim()}`, { nextStep: "check write access to the bridge home" });
    }
  }
  // Fetch exactly the pinned commit. No branch is resolved, so a moved branch changes nothing.
  const fetch = run("git", ["-C", cache, "fetch", "--depth", "1", repository, commit], { timeoutMs: 600_000 });
  if (fetch.status !== 0 || !hasCommit(cache, commit)) {
    throw new SetupError("SOURCE_FETCH_FAILED", `could not fetch ${commit} from ${repository}: ${fetch.stderr.trim() || "commit not found"}`, {
      nextStep: `pass --source <bridge clone that contains it>, or set ${SOURCE_ENV}`,
    });
  }
  return { ...verify(cache, commit), origin: "fetched" };
}
