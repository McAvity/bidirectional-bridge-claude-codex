#!/usr/bin/env node
// Generate the two distribution packages and both marketplace manifests from the canonical
// sources in this repository. There is exactly one copy of every instruction: `.agents/skills/`,
// the two role `using-bridge` skills and `docs/features/README.md`. Nothing here is hand edited.
//
//   node scripts/plugin-packages/generate.mjs            write the packages
//   node scripts/plugin-packages/generate.mjs --check     fail when the tree differs
//
// `--check` is the source-equivalence gate: it regenerates into a temporary directory and
// compares the whole tree, so a canonical skill edited without regenerating fails the build.

import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { byString, sha256, walkFiles } from "../setup/common.mjs";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const GENERATED_MARKER = "GENERATED.json";
export const GENERATED_FORMAT = "claude-codex-bridge.generated-package/v1";

/** Canonical instruction sources. The same list the runtime manifest hashes. */
export const WORKFLOW_SKILLS = ".agents/skills";
export const CODEX_ROLE_SKILL = ".codex/skills/using-bridge";
export const CLAUDE_ROLE_SKILL = ".claude/skills/using-bridge";
export const WORKFLOW_GUIDE = "docs/features/README.md";
export const UPGRADE_SKILL = "scripts/plugin-packages/skills/bridge-upgrade";

export const CODEX_PACKAGE = "plugins/bridge-codex";
export const CLAUDE_PACKAGE = "plugins/bridge-claude";
export const CODEX_MARKETPLACE = ".agents/plugins/marketplace.json";
export const CLAUDE_MARKETPLACE = ".claude-plugin/marketplace.json";
export const MARKETPLACE_NAME = "claude-codex-bridge";

const AUTHOR = "claude-codex-bridge";

/** Everything the package needs to acquire, install and select a pinned runtime by itself. */
export const INSTALLER_FILES = [
  "scripts/bridge.mjs",
  "scripts/diagnostics/safe-read.mjs",
  "scripts/diagnostics/collect.mjs",
  "scripts/diagnostics/project.mjs",
  "scripts/diagnostics/zip.mjs",
  "scripts/setup/common.mjs",
  "scripts/setup/diff.mjs",
  "scripts/setup/doctor.mjs",
  "scripts/setup/distribution.mjs",
  "scripts/setup/processes.mjs",
  "scripts/setup/runtime.mjs",
  "scripts/setup/workspace.mjs",
  "scripts/bridge-project/dispatch.mjs",
  "scripts/bridge-project/entry-template.mjs",
  "scripts/bridge-project/locate.mjs",
  "scripts/bridge-project/pending-selection.mjs",
  "scripts/plugin-packages/acquire.mjs",
  "scripts/plugin-packages/bridge-plugin.mjs",
  "scripts/plugin-packages/release.json",
];
const skipGenerated = (_rel, entry) =>
  entry.name === "node_modules" || entry.name === "__pycache__" || entry.name.endsWith(".pyc");

function packageVersion() {
  return JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).version;
}

/** Stable JSON: two-space indent, trailing newline, key order exactly as written here. */
function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// reference rewriting
// ---------------------------------------------------------------------------

/**
 * Rewrite references that only resolve inside a bridge checkout.
 *
 * A package is read from the host's plugin cache or from an installed runtime, never from the
 * target repository, so `.agents/skills/...` and `../../../docs/features/README.md` would both
 * be dead links there. `${CLAUDE_PLUGIN_ROOT}` is expanded by Claude Code inside skill content.
 */
export function rewriteForClaude(text) {
  return text
    .replaceAll(
      ".agents/skills/feature-exchange/scripts/feature_exchange.py",
      "${CLAUDE_PLUGIN_ROOT}/skills/feature-exchange/scripts/feature_exchange.py",
    )
    .replaceAll("](../../../docs/features/README.md)", "](../../workflow/README.md)")
    .replaceAll("`.agents/skills/`", "`${CLAUDE_PLUGIN_ROOT}/skills/`")
    .replaceAll("`.agents/skills/feature-execute/SKILL.md`", "`${CLAUDE_PLUGIN_ROOT}/skills/feature-execute/SKILL.md`")
    .replaceAll(".agents/skills/feature-execute/SKILL.md", "${CLAUDE_PLUGIN_ROOT}/skills/feature-execute/SKILL.md")
    .replaceAll("docs/features/README.md", "${CLAUDE_PLUGIN_ROOT}/workflow/README.md")
    // Anything still naming the canonical directory is a checkout-relative path; the package is
    // read from a plugin cache, so it must point at the package instead.
    .replaceAll(".agents/skills/", "${CLAUDE_PLUGIN_ROOT}/skills/");
}

/** Paths that must never survive into a generated package, because they need a bridge checkout. */
export const FORBIDDEN_REFERENCES = [".agents/skills/", "docs/features/README.md", "../../../docs/"];

/** A reference is fine when it is anchored to the package or to the installed runtime. */
const ANCHORS = ["CLAUDE_PLUGIN_ROOT", "<instructions.root>", "instructions.codex_role_skill"];

export function scanForbidden(root) {
  const bad = [];
  for (const rel of walkFiles(root, skipGenerated)) {
    if (rel === GENERATED_MARKER) continue;
    // Instruction text only. Shipped code resolves its own paths and is not rewritten.
    if (rel.startsWith("scripts/")) continue;
    if (!/\.(md|yaml|yml)$/u.test(rel)) continue;
    const text = readFileSync(join(root, rel), "utf8");
    for (const needle of FORBIDDEN_REFERENCES) {
      let index = text.indexOf(needle);
      while (index >= 0) {
        const before = text.slice(Math.max(0, index - 32), index);
        if (!ANCHORS.some((anchor) => before.includes(anchor))) bad.push({ file: rel, reference: needle, at: index });
        index = text.indexOf(needle, index + needle.length);
      }
    }
  }
  return bad.sort((a, b) => byString(`${a.file}:${a.at}`, `${b.file}:${b.at}`));
}

// ---------------------------------------------------------------------------
// payloads
// ---------------------------------------------------------------------------

/**
 * Files whose *text* is instruction content and may be rewritten.
 *
 * Code is never transformed. Review W14-R2-02 found the generator rewriting a Python string
 * literal into `${CLAUDE_PLUGIN_ROOT}/...`, which Python does not expand, breaking the shipped
 * exporter. A helper resolves its own installed resources deliberately instead.
 */
const REWRITABLE = /\.(md|yaml|yml)$/u;

function copyTree(fromRoot, from, toRoot, to, transform) {
  const out = [];
  const source = join(fromRoot, from);
  for (const rel of walkFiles(source, skipGenerated)) {
    const text = readFileSync(join(source, rel));
    const target = join(toRoot, to, rel);
    mkdirSync(dirname(target), { recursive: true });
    const content = transform && REWRITABLE.test(rel) ? Buffer.from(transform(text.toString("utf8")), "utf8") : text;
    writeFileSync(target, content, { mode: (statSync(join(source, rel)).mode & 0o111) !== 0 ? 0o755 : 0o644 });
    out.push(`${to}/${rel}`);
  }
  return out;
}

const THIN_ENTRY = () => readFileSync(join(REPO_ROOT, "scripts/plugin-packages/templates/codex-entry-SKILL.md"), "utf8");


function installerFiles(root) {
  const files = [];
  for (const rel of INSTALLER_FILES) {
    const target = join(root, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(join(REPO_ROOT, rel)), { mode: rel.endsWith("bridge.mjs") ? 0o755 : 0o644 });
    files.push(rel);
  }
  return files;
}

function codexPackage(root, version) {
  const files = [];
  mkdirSync(join(root, ".codex-plugin"), { recursive: true });
  writeFileSync(
    join(root, ".codex-plugin", "plugin.json"),
    json({
      name: "bridge-codex",
      version,
      description: "Manager-side entry point for the Claude Code <-> Codex bridge.",
      author: { name: AUTHOR },
      license: "MIT",
      skills: "./skills/",
      interface: {
        displayName: "Bridge (Codex)",
        shortDescription: "Drive Claude Code rounds from Codex.",
        longDescription:
          "Enables a project or worktree to use the Claude Code <-> Codex bridge and points the manager at the instruction set of the runtime that worktree selected.",
        developerName: AUTHOR,
        category: "Productivity",
      },
    }),
  );
  files.push(".codex-plugin/plugin.json");

  mkdirSync(join(root, "skills", "bridge"), { recursive: true });
  writeFileSync(join(root, "skills", "bridge", "SKILL.md"), THIN_ENTRY());
  files.push("skills/bridge/SKILL.md");

  // The installer travels with the package, mirroring the repository layout so every relative
  // import keeps resolving. This is what lets the setup skill install a pinned runtime with no
  // clone and no runtime id, and it is why a marketplace is never asked to build anything.
  files.push(...installerFiles(root));
  files.push(...copyTree(REPO_ROOT, UPGRADE_SKILL, root, "skills/bridge-upgrade"));
  return files.sort(byString);
}

function claudePackage(root, version) {
  const files = [];
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(root, ".claude-plugin", "plugin.json"),
    json({
      name: "bridge-claude",
      version,
      description: "Feature workflow and bridge role instructions for Claude Code.",
      author: { name: AUTHOR },
      license: "MIT",
      skills: "./skills/",
    }),
  );
  files.push(".claude-plugin/plugin.json");

  files.push(...installerFiles(root));
  files.push(...copyTree(REPO_ROOT, UPGRADE_SKILL, root, "skills/bridge-upgrade"));
  files.push(...copyTree(REPO_ROOT, WORKFLOW_SKILLS, root, "skills", rewriteForClaude));
  files.push(...copyTree(REPO_ROOT, CLAUDE_ROLE_SKILL, root, "skills/using-bridge", rewriteForClaude));

  mkdirSync(join(root, "workflow"), { recursive: true });
  writeFileSync(
    join(root, "workflow", "README.md"),
    rewriteForClaude(readFileSync(join(REPO_ROOT, WORKFLOW_GUIDE), "utf8")),
  );
  files.push("workflow/README.md");
  return files.sort(byString);
}

// ---------------------------------------------------------------------------
// provenance
// ---------------------------------------------------------------------------

/** Digest of the canonical sources a package was generated from. */
export function sourceDigest(repoRoot = REPO_ROOT) {
  const parts = [];
  for (const top of [WORKFLOW_SKILLS, CODEX_ROLE_SKILL, CLAUDE_ROLE_SKILL, UPGRADE_SKILL]) {
    for (const rel of walkFiles(join(repoRoot, top), skipGenerated)) {
      parts.push(`${top}/${rel}:${sha256(readFileSync(join(repoRoot, top, rel)))}`);
    }
  }
  parts.push(`${WORKFLOW_GUIDE}:${sha256(readFileSync(join(repoRoot, WORKFLOW_GUIDE)))}`);
  parts.sort(byString);
  return sha256(parts.join("\n"));
}

function writeMarker(root, { name, version, files, sources }) {
  const payload = {
    format: GENERATED_FORMAT,
    plugin: name,
    version,
    generator: "scripts/plugin-packages/generate.mjs",
    canonical_sources: sources,
    source_digest: sourceDigest(),
    files: files.map((rel) => ({ path: rel, sha256: sha256(readFileSync(join(root, rel))) })),
  };
  writeFileSync(join(root, GENERATED_MARKER), json(payload));
}

// ---------------------------------------------------------------------------
// generation
// ---------------------------------------------------------------------------

export function generate(outRoot) {
  const version = packageVersion();
  rmSync(join(outRoot, CODEX_PACKAGE), { recursive: true, force: true });
  rmSync(join(outRoot, CLAUDE_PACKAGE), { recursive: true, force: true });

  const codexRoot = join(outRoot, CODEX_PACKAGE);
  mkdirSync(codexRoot, { recursive: true });
  writeMarker(codexRoot, {
    name: "bridge-codex",
    version,
    files: codexPackage(codexRoot, version),
    sources: [CODEX_ROLE_SKILL, UPGRADE_SKILL],
  });

  const claudeRoot = join(outRoot, CLAUDE_PACKAGE);
  mkdirSync(claudeRoot, { recursive: true });
  writeMarker(claudeRoot, {
    name: "bridge-claude",
    version,
    files: claudePackage(claudeRoot, version),
    sources: [WORKFLOW_SKILLS, CLAUDE_ROLE_SKILL, WORKFLOW_GUIDE, UPGRADE_SKILL],
  });

  mkdirSync(join(outRoot, dirname(CODEX_MARKETPLACE)), { recursive: true });
  writeFileSync(
    join(outRoot, CODEX_MARKETPLACE),
    json({
      name: MARKETPLACE_NAME,
      interface: { displayName: "Claude Code <-> Codex bridge" },
      plugins: [
        {
          name: "bridge-codex",
          source: { source: "local", path: `./${CODEX_PACKAGE}` },
          policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
          category: "Productivity",
        },
      ],
    }),
  );

  mkdirSync(join(outRoot, dirname(CLAUDE_MARKETPLACE)), { recursive: true });
  writeFileSync(
    join(outRoot, CLAUDE_MARKETPLACE),
    json({
      name: MARKETPLACE_NAME,
      owner: { name: AUTHOR },
      description: "Feature workflow and bridge role instructions for Claude Code.",
      plugins: [
        {
          name: "bridge-claude",
          source: `./${CLAUDE_PACKAGE}`,
          description: "Feature workflow and bridge role instructions for Claude Code.",
          version,
        },
      ],
    }),
  );

  return [CODEX_PACKAGE, CLAUDE_PACKAGE, CODEX_MARKETPLACE, CLAUDE_MARKETPLACE];
}

/** Every generated path with its digest, for comparing two generations. */
export function snapshot(root, targets) {
  const out = new Map();
  for (const target of targets) {
    const absolute = join(root, target);
    let stat;
    try {
      stat = statSync(absolute);
    } catch {
      out.set(target, "<missing>");
      continue;
    }
    if (stat.isDirectory()) {
      for (const rel of walkFiles(absolute, skipGenerated)) {
        out.set(`${target}/${rel}`, sha256(readFileSync(join(absolute, rel))));
      }
    } else {
      out.set(target, sha256(readFileSync(absolute)));
    }
  }
  return out;
}

export function diffSnapshots(expected, actual) {
  const problems = [];
  for (const [path, digest] of expected) {
    if (!actual.has(path)) problems.push({ path, problem: "missing from the repository" });
    else if (actual.get(path) !== digest) problems.push({ path, problem: "differs from the generated content" });
  }
  for (const path of actual.keys()) if (!expected.has(path)) problems.push({ path, problem: "not produced by the generator" });
  return problems.sort((a, b) => byString(a.path, b.path));
}

async function main(argv) {
  const check = argv.includes("--check");
  const asJson = argv.includes("--json");
  if (!check) {
    const targets = generate(REPO_ROOT);
    const forbidden = [
      ...scanForbidden(join(REPO_ROOT, CODEX_PACKAGE)),
      ...scanForbidden(join(REPO_ROOT, CLAUDE_PACKAGE)),
    ];
    if (forbidden.length > 0) {
      process.stderr.write(`generated packages still reference the bridge checkout:\n${forbidden.map((f) => `  ${f.file}: ${f.reference}`).join("\n")}\n`);
      return 1;
    }
    process.stdout.write(asJson ? json({ generated: targets }) : `generated: ${targets.join(", ")}\n`);
    return 0;
  }

  const temp = mkdtempSync(join(tmpdir(), "bridge-packages-"));
  try {
    const targets = generate(temp);
    const problems = diffSnapshots(snapshot(temp, targets), snapshot(REPO_ROOT, targets));
    const forbidden = [
      ...scanForbidden(join(temp, CODEX_PACKAGE)),
      ...scanForbidden(join(temp, CLAUDE_PACKAGE)),
    ];
    const ok = problems.length === 0 && forbidden.length === 0;
    if (asJson) {
      process.stdout.write(json({ ok, problems, forbidden_references: forbidden, source_digest: sourceDigest() }));
    } else if (ok) {
      process.stdout.write(`packages match their canonical sources (source digest ${sourceDigest().slice(0, 12)})\n`);
    } else {
      for (const problem of problems) process.stderr.write(`  ${problem.path}: ${problem.problem}\n`);
      for (const bad of forbidden) process.stderr.write(`  ${bad.file}: references ${bad.reference}\n`);
      process.stderr.write("run `node scripts/plugin-packages/generate.mjs` and commit the result\n");
    }
    return ok ? 0 : 1;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`${error?.stack ?? String(error)}\n`);
      process.exitCode = 1;
    },
  );
}

export { relative };
