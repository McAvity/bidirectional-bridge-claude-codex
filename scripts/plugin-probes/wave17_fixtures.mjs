#!/usr/bin/env node
// W17-01 fixtures: disposable runtimes and candidate feature-workflow packages for the host probes.
// Research instrument only — W17-02 owns the product generator. Everything is written under the
// destination the caller gives, which the probes keep inside a disposable run root.
//
//   node wave17_fixtures.mjs runtime <dest-home> --commit <sha> --id <runtime id> [--repo DIR]
//   node wave17_fixtures.mjs package <dest> --client claude|codex --commit <sha> --version <v> [--repo DIR]
//
// Instruction bytes always come from a Git commit (`git archive`), never from the working tree, so
// the pre-wave16 pin 34ecb8d and the post-wave16 base give two genuinely different instruction sets.

import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256, treeDigest, walkFiles } from "../setup/common.mjs";
import { rewriteForClaude } from "../plugin-packages/generate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
export const PLUGIN_NAME = "feature-workflow";
export const SIX = ["feature-design", "feature-plan", "feature-execute", "feature-review", "feature-decide", "feature-exchange"];
const RUNTIME_PATHS = [".agents/skills", ".codex/skills/using-bridge", ".claude/skills/using-bridge", "docs/features/README.md", "scripts", "plugins/bridge-claude"];
// The launch files verifyRuntime requires. Stubs: the reader never executes them.
const STUBS = [
  "shared/control-plane/dist/index.js",
  "shared/mcp-server-core/dist/index.js",
  "claude/claude-side/dist/index.js",
  "codex/codex-side/dist/index.js",
  "node_modules/@modelcontextprotocol/sdk/package.json",
  "node_modules/@openai/codex/package.json",
];

function git(repo, args, options = {}) {
  const out = spawnSync("git", ["-C", repo, ...args], { encoding: options.encoding ?? "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (out.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${out.stderr}`);
  return out.stdout;
}

/** Extract `paths` of `commit` into `dest` (paths absent at that commit are skipped). */
export function extractCommit(repo, commit, paths, dest) {
  const present = paths.filter((path) => git(repo, ["ls-tree", "--name-only", commit, "--", path]).trim() !== "");
  mkdirSync(dest, { recursive: true });
  const tar = spawnSync("git", ["-C", repo, "archive", "--format=tar", commit, "--", ...present], { maxBuffer: 256 * 1024 * 1024 });
  if (tar.status !== 0) throw new Error(`git archive failed: ${tar.stderr}`);
  const untar = spawnSync("tar", ["-x", "-C", dest], { input: tar.stdout });
  if (untar.status !== 0) throw new Error(`tar failed: ${untar.stderr}`);
  return present;
}

export function buildRuntime({ home, id, commit, repo = REPO }) {
  const path = join(home, "runtimes", id);
  extractCommit(repo, commit, RUNTIME_PATHS, path);
  for (const rel of STUBS) {
    mkdirSync(dirname(join(path, rel)), { recursive: true });
    writeFileSync(join(path, rel), rel.endsWith(".json") ? "{}\n" : "// W17-01 fixture stub, never executed\n");
  }
  const instructionFiles = walkFiles(join(path, ".agents/skills")).map((rel) => ({
    path: `.agents/skills/${rel}`,
    sha256: sha256(readFileSync(join(path, ".agents/skills", rel))),
  }));
  const files = walkFiles(path, (rel, entry) => entry.name === "node_modules" || rel === "runtime-manifest.json" || rel === "install.log");
  const manifest = {
    format: "claude-codex-bridge.runtime/v1",
    runtime_id: id,
    package_version: id.split("-")[0],
    install_format: "w17-01-fixture",
    source: { repository: "w17-01-fixture", commit: git(repo, ["rev-parse", `${commit}^{commit}`]).trim() },
    compatibility: { state_schema_version: 5 },
    instructions: {
      set_sha256: sha256(instructionFiles.map((file) => `${file.path}:${file.sha256}`).join("\n")),
      files: instructionFiles,
    },
    tree_sha256: treeDigest(path, files),
  };
  writeFileSync(join(path, "runtime-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { path, manifest };
}

/**
 * Candidate Codex rewrite. Codex expands no plugin-root variable in skill text, so references are
 * anchored to `<package>` — the directory two levels above a skill's SKILL.md, whose absolute path
 * the host lists in the model-visible skills table.
 */
export function rewriteForCodex(text) {
  return text
    .replaceAll(".agents/skills/feature-exchange/scripts/feature_exchange.py", "<package>/skills/feature-exchange/scripts/feature_exchange.py")
    .replaceAll("](../../../docs/features/README.md)", "](../../workflow/README.md)")
    .replaceAll("docs/features/README.md", "<package>/workflow/README.md")
    .replaceAll(".agents/skills/", "<package>/skills/");
}

const REWRITABLE = /\.(md|yaml|yml)$/u;

function manifestFor(client, version) {
  const base = {
    name: PLUGIN_NAME,
    version,
    description: "Feature workflow: design, plan, execute, review, decide and exchange (W17-01 candidate).",
    author: { name: "claude-codex-bridge" },
    license: "MIT",
    skills: "./skills/",
  };
  if (client === "claude") return [".claude-plugin/plugin.json", base];
  return [
    ".codex-plugin/plugin.json",
    {
      ...base,
      interface: {
        displayName: "Feature workflow",
        shortDescription: "Plan, execute and review features.",
        longDescription: "The six feature-* skills with their references and exchange helper (W17-01 candidate).",
        developerName: "claude-codex-bridge",
        category: "Productivity",
      },
    },
  ];
}

export function buildPackage({ dest, client, commit, version, repo = REPO }) {
  const staging = mkdtempSync(join(tmpdir(), "w17-01-src-"));
  try {
    extractCommit(repo, commit, [".agents/skills", "docs/features/README.md"], staging);
    const rewrite = client === "claude" ? rewriteForClaude : rewriteForCodex;
    rmSync(dest, { recursive: true, force: true });
    const files = [];
    for (const rel of walkFiles(join(staging, ".agents/skills"))) {
      const source = join(staging, ".agents/skills", rel);
      const target = join(dest, "skills", rel);
      mkdirSync(dirname(target), { recursive: true });
      const bytes = readFileSync(source);
      writeFileSync(target, REWRITABLE.test(rel) ? rewrite(bytes.toString("utf8")) : bytes);
      files.push(`skills/${rel}`);
    }
    mkdirSync(join(dest, "workflow"), { recursive: true });
    writeFileSync(join(dest, "workflow/README.md"), rewrite(readFileSync(join(staging, "docs/features/README.md"), "utf8")));
    files.push("workflow/README.md");
    mkdirSync(join(dest, "scripts"), { recursive: true });
    copyFileSync(join(HERE, "wave17_select_source.mjs"), join(dest, "scripts/select-source.mjs"));
    chmodSync(join(dest, "scripts/select-source.mjs"), 0o755);
    files.push("scripts/select-source.mjs");
    const [manifestPath, manifest] = manifestFor(client, version);
    mkdirSync(dirname(join(dest, manifestPath)), { recursive: true });
    writeFileSync(join(dest, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`);
    files.push(manifestPath);
    const digest = sha256(files.filter((rel) => rel !== manifestPath).sort().map((rel) => `${rel}:${sha256(readFileSync(join(dest, rel)))}`).join("\n"));
    writeFileSync(
      join(dest, "GENERATED.json"),
      `${JSON.stringify({ format: "w17-01-candidate-package", plugin: PLUGIN_NAME, client, version, source_commit: commit, source_digest: digest }, null, 2)}\n`,
    );
    return { dest, files: files.sort(), digest };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function main(argv) {
  const [command, dest, ...rest] = argv;
  const options = { repo: REPO };
  for (let index = 0; index < rest.length; index += 2) options[rest[index].replace(/^--/u, "")] = rest[index + 1];
  if (command === "runtime") {
    const { path, manifest } = buildRuntime({ home: resolve(dest), id: options.id, commit: options.commit, repo: resolve(options.repo) });
    return { path, runtime_id: manifest.runtime_id, commit: manifest.source.commit, set_sha256: manifest.instructions.set_sha256 };
  }
  if (command === "package") {
    const built = buildPackage({ dest: resolve(dest), client: options.client, commit: options.commit, version: options.version, repo: resolve(options.repo) });
    return { dest: built.dest, files: built.files.length, digest: built.digest };
  }
  throw new Error("usage: wave17_fixtures.mjs runtime|package <dest> ...");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${JSON.stringify(main(process.argv.slice(2)), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error?.stack ?? String(error)}\n`);
    process.exitCode = 1;
  }
}
