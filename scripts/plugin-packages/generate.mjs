#!/usr/bin/env node
// Generate the distribution packages and both marketplace manifests from the canonical sources in
// this repository. There is exactly one copy of every instruction: `.agents/skills/`, the two role
// `using-bridge` skills and `docs/features/README.md`. Nothing here is hand edited.
//
// Two independently versioned components (contract F-W19 01-workflow-binding.md § 3):
//
//   bridge   — `bridge-codex` / `bridge-claude` (setup, upgrade, roles; the Claude one is also the
//              runtime's executor role package). Version: package.json. No feature-* skills.
//   workflow — the `feature-workflow` plugin for each client: the seven feature-* skills with their
//              resources, the guide, the instruction-source reader and the workflow helper, plus
//              `bundle/` = the complete immutable dual-client bundle of this release. Version:
//              scripts/workflow-source/release.json.
//
// Neither component's inputs reach the other's packages, digests or marketplace entry, so a
// workflow-only change leaves every bridge byte unchanged and vice versa.
//
//   node scripts/plugin-packages/generate.mjs [--component bridge|workflow|all]           write
//   node scripts/plugin-packages/generate.mjs --check [--component bridge|workflow|all]   compare
//
// `--check` is the source-equivalence gate: it regenerates into a temporary directory and
// compares the selected component's trees and marketplace entries (all: every generated path),
// so a canonical skill edited without regenerating fails the build.

import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { byString, sha256, walkFiles } from "../setup/common.mjs";
import * as W from "../workflow-source/workflow-lib.mjs";

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
export const WORKFLOW_PLUGIN = "feature-workflow";
export const WORKFLOW_CODEX_PACKAGE = "plugins/feature-workflow-codex";
export const WORKFLOW_CLAUDE_PACKAGE = "plugins/feature-workflow-claude";
/** The seven public entries of the workflow plugin, in workflow order. */
export const WORKFLOW_ENTRIES = ["feature-flow", "feature-design", "feature-plan", "feature-execute", "feature-review", "feature-decide", "feature-exchange"];
/** Canonical instruction-source reader, copied verbatim into both workflow packages. */
export const SOURCE_READER = "scripts/workflow-source/select-source.mjs";
export const SOURCE_PREAMBLE = "scripts/plugin-packages/templates/workflow-source-preamble.md";
/** Workflow helper (verify/restore/begin/finalize/resolve/switch), copied verbatim. */
export const WORKFLOW_HELPER = "scripts/workflow-source/workflow.mjs";
export const WORKFLOW_LIB = "scripts/workflow-source/workflow-lib.mjs";
/** Workflow release source (version, requires) and the append-only registry of published ones. */
export const WORKFLOW_RELEASE = "scripts/workflow-source/release.json";
export const WORKFLOW_RELEASES = "scripts/workflow-source/releases.json";
const THIN_ENTRY_TEMPLATE = "scripts/plugin-packages/templates/codex-entry-SKILL.md";
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
  "scripts/setup/process-observer.py",
  "scripts/setup/codex-writer-workspaces.py",
  "scripts/setup/runtime.mjs",
  "scripts/setup/workflow-status.mjs",
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

/** Bridge (engine) version: package.json. */
export function packageVersion() {
  return JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).version;
}

/** Workflow release source; its version is independent of the bridge version. */
export function workflowRelease() {
  return W.readRelease(join(REPO_ROOT, WORKFLOW_RELEASE));
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

/**
 * Rewrite checkout references for the Codex workflow package.
 *
 * Codex documents no plugin-root variable for skill text, so references are anchored to
 * `<package>` — the plugin directory two levels above a skill's SKILL.md, whose absolute path the
 * host lists in the skills table — and Markdown links stay relative. Each SKILL.md of the package
 * also states that definition (the source preamble). Entry mentions are qualified with the plugin.
 */
export function rewriteForCodex(text) {
  return text
    .replaceAll(".agents/skills/feature-exchange/scripts/feature_exchange.py", "<package>/skills/feature-exchange/scripts/feature_exchange.py")
    .replaceAll("](../../../docs/features/README.md)", "](../../workflow/README.md)")
    .replaceAll("docs/features/README.md", "<package>/workflow/README.md")
    .replaceAll(".agents/skills/", "<package>/skills/");
}

/** Paths that must never survive into a generated package, because they need a bridge checkout. */
export const FORBIDDEN_REFERENCES = [".agents/skills/", "docs/features/README.md", "../../../docs/"];

/** A reference is fine when it is anchored to the package or to the installed runtime. */
const ANCHORS = ["CLAUDE_PLUGIN_ROOT", "<instructions.root>", "instructions.codex_role_skill", "<package>"];

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

const THIN_ENTRY = () => readFileSync(join(REPO_ROOT, THIN_ENTRY_TEMPLATE), "utf8");


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
      description: "Bridge role, setup and upgrade instructions for Claude Code; the runtime's executor role package.",
      author: { name: AUTHOR },
      license: "MIT",
      skills: "./skills/",
    }),
  );
  files.push(".claude-plugin/plugin.json");

  // Role-only since F-W19: the feature workflow is its own component (feature-workflow-claude), so
  // a workflow release never changes a byte of this package and its copies cannot shadow the
  // selected workflow by plugin name.
  files.push(...installerFiles(root));
  files.push(...copyTree(REPO_ROOT, UPGRADE_SKILL, root, "skills/bridge-upgrade"));
  files.push(...copyTree(REPO_ROOT, CLAUDE_ROLE_SKILL, root, "skills/using-bridge", rewriteForClaude));
  return files.sort(byString);
}

/**
 * The instruction-source preamble placed after a workflow skill's front matter.
 *
 * Only the workflow packages carry it. The canonical skills — and so the runtime's own copy and
 * the `bridge-claude` executor package — are unchanged: a pinned runtime is the source the reader
 * points at, and it must not point onward again.
 */
export function sourcePreamble(client, skill) {
  const helper = client === "claude"
    ? 'node "${CLAUDE_PLUGIN_ROOT}/scripts/workflow.mjs"'
    : 'node "<package>/scripts/workflow.mjs"';
  const note = client === "claude"
    ? ""
    : "\n> `<package>` is this plugin's directory, two levels above this SKILL.md; the skills list " +
      "gives its absolute path.";
  return readFileSync(join(REPO_ROOT, SOURCE_PREAMBLE), "utf8")
    .replaceAll("{{ENTRY}}", `${WORKFLOW_PLUGIN}:${skill}`)
    .replaceAll("{{HELPER}}", helper)
    .replaceAll("{{SKILL}}", skill)
    .replaceAll("{{PACKAGE_NOTE}}", note);
}

function withPreamble(text, preamble) {
  const match = /^---\n[\s\S]*?\n---\n/u.exec(text);
  if (!match) throw new Error("workflow skill without front matter");
  return `${match[0]}\n${preamble}\n${text.slice(match[0].length).replace(/^\n/u, "")}`;
}

/** Codex skill metadata: qualify the entry a default prompt mentions (`$feature-x`). */
function qualifyMentions(text) {
  return text.replace(/\$(feature-(?:flow|design|plan|execute|review|decide|exchange))\b/gu, `$${WORKFLOW_PLUGIN}:$1`);
}

/** One client variant of the workflow: the plugin's own files, without `bundle/` or a marker. */
function workflowVariant(root, client, version) {
  const files = [];
  const rewrite = client === "claude" ? rewriteForClaude : rewriteForCodex;
  const manifestPath = client === "claude" ? ".claude-plugin/plugin.json" : ".codex-plugin/plugin.json";
  const manifest = {
    name: WORKFLOW_PLUGIN,
    version,
    description: "Feature workflow: continuous flow or individual design, plan, execution, review, decision and exchange.",
    author: { name: AUTHOR },
    license: "MIT",
    skills: "./skills/",
    ...(client === "codex"
      ? {
          interface: {
            displayName: "Feature workflow",
            shortDescription: "Plan, execute, review and decide feature work.",
            longDescription:
              "The seven feature-* skills with their references and exchange helper. Works on its own; in a " +
              "project with workflow binding each feature keeps its verified workflow release independently of the runtime.",
            developerName: AUTHOR,
            category: "Productivity",
          },
        }
      : {}),
  };
  mkdirSync(join(root, dirname(manifestPath)), { recursive: true });
  writeFileSync(join(root, manifestPath), json(manifest));
  files.push(manifestPath);

  for (const skill of WORKFLOW_ENTRIES) {
    files.push(...copyTree(REPO_ROOT, `${WORKFLOW_SKILLS}/${skill}`, root, `skills/${skill}`, (text) => rewrite(text)));
    const entry = join(root, "skills", skill, "SKILL.md");
    writeFileSync(entry, withPreamble(readFileSync(entry, "utf8"), sourcePreamble(client, skill)));
    const metadata = join(root, "skills", skill, "agents", "openai.yaml");
    if (client === "codex") {
      try {
        writeFileSync(metadata, qualifyMentions(readFileSync(metadata, "utf8")));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }

  mkdirSync(join(root, "workflow"), { recursive: true });
  writeFileSync(join(root, "workflow", "README.md"), rewrite(readFileSync(join(REPO_ROOT, WORKFLOW_GUIDE), "utf8")));
  files.push("workflow/README.md");

  // Code is copied, never rewritten: the reader and the helper resolve their package root from
  // their own location.
  mkdirSync(join(root, "scripts"), { recursive: true });
  for (const [source, name] of [[SOURCE_READER, "select-source.mjs"], [WORKFLOW_HELPER, "workflow.mjs"], [WORKFLOW_LIB, "workflow-lib.mjs"]]) {
    writeFileSync(join(root, "scripts", name), readFileSync(join(REPO_ROOT, source)), { mode: 0o755 });
    files.push(`scripts/${name}`);
  }
  return files.sort(byString);
}

/**
 * The workflow release: both client variants and the bundle manifest (§ 3.1). Built in a temporary
 * directory so the variants are exactly what the packages carry. The registry is consulted, never
 * embedded: a registered version must reproduce its registered identity (VERSION_REUSED).
 */
export function workflowBundle() {
  const release = workflowRelease();
  const temp = mkdtempSync(join(tmpdir(), "workflow-variants-"));
  try {
    const variants = {};
    for (const client of W.CLIENTS) {
      const dir = join(temp, client);
      mkdirSync(dir, { recursive: true });
      workflowVariant(dir, client, release.version);
      variants[client] = W.readVariant(dir);
    }
    const manifest = W.bundleManifest({
      version: release.version,
      requires: release.requires,
      variants,
      // Provenance only, outside the identity. The commit holding these sources cannot name itself;
      // it is recorded in releases.json when the release is published.
      source: { repository: release.repository ?? null, release_source: WORKFLOW_RELEASE, commit: null },
    });
    const registryPath = join(REPO_ROOT, WORKFLOW_RELEASES);
    const registry = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, "utf8")) : { format: W.RELEASES_FORMAT, releases: [] };
    const registration = W.checkRegistry(registry, manifest);
    return { release, manifest, variants, registration };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

/** A workflow plugin package: its client variant at the root plus the whole bundle in `bundle/`. */
function workflowPackage(root, client, bundle) {
  for (const [rel, file] of Object.entries(bundle.variants[client])) {
    const target = join(root, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.data, { mode: file.mode === "755" ? 0o755 : 0o644 });
  }
  W.writeBundle(join(root, W.BUNDLE_DIR), bundle.manifest, bundle.variants);
  return walkFiles(root, skipGenerated).filter((rel) => rel !== GENERATED_MARKER).sort(byString);
}

// ---------------------------------------------------------------------------
// provenance
// ---------------------------------------------------------------------------

/**
 * Digest of the canonical sources the *bridge* packages are generated from: roles, upgrade skill,
 * installer files and the thin entry. No workflow input contributes (F-W19 § 3.5).
 */
export function sourceDigest(repoRoot = REPO_ROOT) {
  const parts = [];
  for (const top of [CODEX_ROLE_SKILL, CLAUDE_ROLE_SKILL, UPGRADE_SKILL]) {
    for (const rel of walkFiles(join(repoRoot, top), skipGenerated)) {
      parts.push(`${top}/${rel}:${sha256(readFileSync(join(repoRoot, top, rel)))}`);
    }
  }
  for (const rel of [...INSTALLER_FILES, THIN_ENTRY_TEMPLATE]) parts.push(`${rel}:${sha256(readFileSync(join(repoRoot, rel)))}`);
  parts.sort(byString);
  return sha256(parts.join("\n"));
}

/**
 * Digest of what a workflow package is generated from: the seven skills, the guide, the reader,
 * the helper, the preamble template and the release source (not the registry). The bundle
 * identity, not this digest, is the identity of the instructions.
 */
export function workflowSourceDigest(repoRoot = REPO_ROOT) {
  const parts = [];
  for (const skill of WORKFLOW_ENTRIES) {
    const top = `${WORKFLOW_SKILLS}/${skill}`;
    for (const rel of walkFiles(join(repoRoot, top), skipGenerated)) parts.push(`${top}/${rel}:${sha256(readFileSync(join(repoRoot, top, rel)))}`);
  }
  for (const rel of [WORKFLOW_GUIDE, SOURCE_READER, SOURCE_PREAMBLE, WORKFLOW_HELPER, WORKFLOW_LIB, WORKFLOW_RELEASE]) parts.push(`${rel}:${sha256(readFileSync(join(repoRoot, rel)))}`);
  parts.sort(byString);
  return sha256(parts.join("\n"));
}

function writeMarker(root, { name, version, files, sources, digest = sourceDigest() }) {
  const payload = {
    format: GENERATED_FORMAT,
    plugin: name,
    version,
    generator: "scripts/plugin-packages/generate.mjs",
    canonical_sources: sources,
    source_digest: digest,
    files: files.map((rel) => ({ path: rel, sha256: sha256(readFileSync(join(root, rel))) })),
  };
  writeFileSync(join(root, GENERATED_MARKER), json(payload));
}

// ---------------------------------------------------------------------------
// generation
// ---------------------------------------------------------------------------

export const COMPONENTS = {
  bridge: { packages: [CODEX_PACKAGE, CLAUDE_PACKAGE], entries: ["bridge-codex", "bridge-claude"] },
  workflow: { packages: [WORKFLOW_CODEX_PACKAGE, WORKFLOW_CLAUDE_PACKAGE], entries: [WORKFLOW_PLUGIN] },
};

function componentsOf(component) {
  if (component === "all") return ["bridge", "workflow"];
  if (!COMPONENTS[component]) throw new Error(`unknown component ${component}; use bridge, workflow or all`);
  return [component];
}

function generateBridge(outRoot) {
  const version = packageVersion();
  for (const target of COMPONENTS.bridge.packages) rmSync(join(outRoot, target), { recursive: true, force: true });
  const codexRoot = join(outRoot, CODEX_PACKAGE);
  mkdirSync(codexRoot, { recursive: true });
  writeMarker(codexRoot, { name: "bridge-codex", version, files: codexPackage(codexRoot, version), sources: [CODEX_ROLE_SKILL, UPGRADE_SKILL] });
  const claudeRoot = join(outRoot, CLAUDE_PACKAGE);
  mkdirSync(claudeRoot, { recursive: true });
  writeMarker(claudeRoot, { name: "bridge-claude", version, files: claudePackage(claudeRoot, version), sources: [CLAUDE_ROLE_SKILL, UPGRADE_SKILL] });
  return version;
}

function generateWorkflow(outRoot) {
  const bundle = workflowBundle();
  for (const target of COMPONENTS.workflow.packages) rmSync(join(outRoot, target), { recursive: true, force: true });
  for (const [client, target] of [["codex", WORKFLOW_CODEX_PACKAGE], ["claude", WORKFLOW_CLAUDE_PACKAGE]]) {
    const workflowRoot = join(outRoot, target);
    mkdirSync(workflowRoot, { recursive: true });
    writeMarker(workflowRoot, {
      name: WORKFLOW_PLUGIN,
      version: bundle.release.version,
      files: workflowPackage(workflowRoot, client, bundle),
      sources: [...WORKFLOW_ENTRIES.map((skill) => `${WORKFLOW_SKILLS}/${skill}`), WORKFLOW_GUIDE, SOURCE_READER, SOURCE_PREAMBLE, WORKFLOW_HELPER, WORKFLOW_LIB, WORKFLOW_RELEASE],
      digest: workflowSourceDigest(),
    });
  }
  return bundle;
}

/** Marketplace entries of one component, derived only from that component's version and paths. */
function marketplaceEntries(component, { bridgeVersion, workflowVersion }) {
  if (component === "bridge") {
    return {
      codex: [{
        name: "bridge-codex",
        source: { source: "local", path: `./${CODEX_PACKAGE}` },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Productivity",
      }],
      claude: [{
        name: "bridge-claude",
        source: `./${CLAUDE_PACKAGE}`,
        description:
          "Bridge role, setup and upgrade instructions for Claude Code, and the runtime's executor role package. " +
          "The feature workflow is the separate feature-workflow plugin.",
        version: bridgeVersion,
      }],
    };
  }
  return {
    codex: [{
      name: WORKFLOW_PLUGIN,
      source: { source: "local", path: `./${WORKFLOW_CODEX_PACKAGE}` },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: "Productivity",
    }],
    claude: [{
      name: WORKFLOW_PLUGIN,
      source: `./${WORKFLOW_CLAUDE_PACKAGE}`,
      description: "Feature workflow: continuous flow or individual design, plan, execution, review, decision and exchange.",
      version: workflowVersion,
    }],
  };
}

const MARKETPLACE_HEADS = {
  codex: { name: MARKETPLACE_NAME, interface: { displayName: "Claude Code <-> Codex bridge" } },
  claude: { name: MARKETPLACE_NAME, owner: { name: AUTHOR }, description: "Feature workflow and bridge role instructions for Claude Code." },
};

/**
 * Write both marketplace files. Entries of a component that is not being generated are kept as
 * they are in `outRoot` (when present), so `--component workflow` cannot touch a bridge entry.
 */
function writeMarketplaces(outRoot, selected, versions) {
  for (const [client, path] of [["codex", CODEX_MARKETPLACE], ["claude", CLAUDE_MARKETPLACE]]) {
    let existing = null;
    try {
      existing = JSON.parse(readFileSync(join(outRoot, path), "utf8"));
    } catch {
      existing = null;
    }
    const plugins = [];
    for (const component of ["bridge", "workflow"]) {
      if (selected.includes(component) || !existing) {
        plugins.push(...marketplaceEntries(component, versions)[client]);
      } else {
        const kept = (existing.plugins ?? []).filter((entry) => COMPONENTS[component].entries.includes(entry.name));
        plugins.push(...kept);
      }
    }
    mkdirSync(join(outRoot, dirname(path)), { recursive: true });
    writeFileSync(join(outRoot, path), json({ ...MARKETPLACE_HEADS[client], plugins }));
  }
}

/** Generate `component` ("bridge", "workflow" or "all") into `outRoot`; returns the written targets. */
export function generate(outRoot, { component = "all" } = {}) {
  const selected = componentsOf(component);
  const versions = { bridgeVersion: packageVersion(), workflowVersion: workflowRelease().version };
  const targets = [];
  if (selected.includes("bridge")) {
    generateBridge(outRoot);
    targets.push(...COMPONENTS.bridge.packages);
  }
  if (selected.includes("workflow")) {
    generateWorkflow(outRoot);
    targets.push(...COMPONENTS.workflow.packages);
  }
  writeMarketplaces(outRoot, selected, versions);
  return [...targets, CODEX_MARKETPLACE, CLAUDE_MARKETPLACE];
}

/** Canonical JSON of each marketplace entry of `component`, keyed by file and name (AC-01 test). */
export function marketplaceEntrySnapshot(root, component) {
  const out = new Map();
  for (const path of [CODEX_MARKETPLACE, CLAUDE_MARKETPLACE]) {
    let doc;
    try {
      doc = JSON.parse(readFileSync(join(root, path), "utf8"));
    } catch {
      out.set(`${path}#<file>`, "<missing>");
      continue;
    }
    for (const entry of doc.plugins ?? []) {
      if (COMPONENTS[component].entries.includes(entry.name)) out.set(`${path}#${entry.name}`, W.canonicalJson(entry).toString("utf8"));
    }
    const head = { ...doc };
    delete head.plugins;
    out.set(`${path}#<head>`, W.canonicalJson(head).toString("utf8"));
  }
  return out;
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

const PACKAGES = [CODEX_PACKAGE, CLAUDE_PACKAGE, WORKFLOW_CODEX_PACKAGE, WORKFLOW_CLAUDE_PACKAGE];

function parseArgs(argv) {
  const options = { check: false, json: false, component: "all" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--check") options.check = true;
    else if (argv[i] === "--json") options.json = true;
    else if (argv[i] === "--component") options.component = argv[++i];
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  componentsOf(options.component);
  return options;
}

async function main(argv) {
  const { check, json: asJson, component } = parseArgs(argv);
  const selected = componentsOf(component);
  const packages = selected.flatMap((name) => COMPONENTS[name].packages);
  if (!check) {
    const targets = generate(REPO_ROOT, { component });
    const forbidden = packages.flatMap((target) => scanForbidden(join(REPO_ROOT, target)));
    if (forbidden.length > 0) {
      process.stderr.write(`generated packages still reference the bridge checkout:\n${forbidden.map((f) => `  ${f.file}: ${f.reference}`).join("\n")}\n`);
      return 1;
    }
    process.stdout.write(asJson ? json({ generated: targets }) : `generated: ${targets.join(", ")}\n`);
    return 0;
  }

  const temp = mkdtempSync(join(tmpdir(), "bridge-packages-"));
  try {
    // The marketplace files of a component-only check start from the repository's, so the entries
    // of the other component are compared as they are, never regenerated.
    if (component !== "all") {
      for (const path of [CODEX_MARKETPLACE, CLAUDE_MARKETPLACE]) {
        if (existsSync(join(REPO_ROOT, path))) cpSync(join(REPO_ROOT, path), join(temp, path), { recursive: false });
      }
    }
    generate(temp, { component });
    const problems = diffSnapshots(snapshot(temp, packages), snapshot(REPO_ROOT, packages));
    const entryComponents = component === "all" ? ["bridge", "workflow"] : selected;
    for (const name of entryComponents) problems.push(...diffSnapshots(marketplaceEntrySnapshot(temp, name), marketplaceEntrySnapshot(REPO_ROOT, name)));
    if (component === "all") problems.push(...diffSnapshots(snapshot(temp, [CODEX_MARKETPLACE, CLAUDE_MARKETPLACE]), snapshot(REPO_ROOT, [CODEX_MARKETPLACE, CLAUDE_MARKETPLACE])));
    const forbidden = packages.flatMap((target) => scanForbidden(join(temp, target)));
    const unique = [...new Map(problems.map((p) => [`${p.path}:${p.problem}`, p])).values()].sort((a, b) => byString(a.path, b.path));
    const ok = unique.length === 0 && forbidden.length === 0;
    const bundle = selected.includes("workflow") ? JSON.parse(readFileSync(join(temp, WORKFLOW_CLAUDE_PACKAGE, W.BUNDLE_DIR, W.BUNDLE_MANIFEST), "utf8")) : null;
    const summary = {
      ok, component, problems: unique, forbidden_references: forbidden,
      ...(selected.includes("bridge") ? { source_digest: sourceDigest(), bridge_version: packageVersion() } : {}),
      ...(bundle ? { workflow_version: bundle.version, workflow_identity: bundle.identity, workflow_id: bundle.workflow_id } : {}),
    };
    if (asJson) {
      process.stdout.write(json(summary));
    } else if (ok) {
      const parts = [];
      if (summary.source_digest) parts.push(`bridge ${summary.bridge_version} source digest ${summary.source_digest.slice(0, 12)}`);
      if (bundle) parts.push(`workflow ${bundle.workflow_id}`);
      process.stdout.write(`packages match their canonical sources (${parts.join("; ")})\n`);
    } else {
      for (const problem of unique) process.stderr.write(`  ${problem.path}: ${problem.problem}\n`);
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
