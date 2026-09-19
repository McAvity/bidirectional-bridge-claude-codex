# Changelog

This project is **experimental and pre-1.0**. It has made no production release. Entries record
checkpoints, not compatibility promises: while the major version is `0`, any release may
contain breaking changes to the MCP tool surface, the task lifecycle, error codes, the
persisted schema, the telemetry shape, or the documented workflows. See
[docs/release-policy.md](docs/release-policy.md).

Grouped as Added / Changed / Fixed / Documentation / Security. Breaking changes are called out
explicitly.

## Unreleased

## 0.3.2 — 2026-09-19 (experimental)

### Added

- `bridge-upgrade` skill in both client plugins: marketplace refresh, exact release
  preparation, inherited-worktree setup/update selection and exit/apply/resume guidance.
- The Claude plugin carries the same generated installer payload as the Codex plugin,
  so upgrades do not require a separate bridge checkout.

### Validation boundary

The installer and runtime state machine are unchanged. This is a GitHub/marketplace
release, not an npm publication or an automatic project runtime update. Existing
pins and live sessions remain unchanged. Model-driven upgrade behaviour and the
previously scoped wave15 smoke remain unverified; see the
[validation record](docs/tasks/bridge-upgrade-skill.md).

## 0.3.1 — 2026-09-19 (experimental)

### Changed

- Codex host versions outside the verified list (including 0.155.1) now produce
  `CODEX_VERSION_UNVERIFIED` warnings in setup, doctor and successful guarded MCP calls,
  instead of a version-only refusal. Metadata validation, subagent rejection and manager
  ownership/fencing remain enforced; unverified host behaviour is not certified.

## 0.3.0 — 2026-09-17 (experimental; wave15 smoke pending)

### Added

- Natural feature requests and safe continuation guidance in the selected runtime.
- Optional, explicitly requested project collaboration preference in AGENTS.md.
- Read-only project entry status/instruction discovery in inherited worktrees.

### Fixed

- Dispatcher-aware doctor and target-runtime compatibility checks for preferences.
- Regression coverage for interruption, replay and role-specific instructions.

### Validation boundary

Technical checks and coordinator review cover the implementation. Wave15 real-model
smoke is pending; this is not full behavioural acceptance or production certification.
Updating a plugin does not move a project's runtime pin. Close the project clients
before selecting the new runtime; historical runtime files remain untouched.

### Changes carried from earlier fork checkpoints


### Added

- Add `scripts/bridge.mjs` with `install`, `runtimes`, `init`, `update`, `rollback` and
  `doctor`: read-only runtimes pinned to one commit, per-worktree runtime selection, a managed
  Codex MCP block, instructions and ignores, completion of an interrupted apply, refusal while a
  worktree is in use or its database schema is newer, and a model-free doctor with a versioned
  JSON report and a real MCP handshake.

### Changed

- **Breaking for bridge checkouts:** the repository's `.codex/config.toml` and `.mcp.json` start
  the runtime selected in `.bridge-runtime/current`; run `node scripts/bridge.mjs init` in each
  bridge worktree before starting a client there.

### Documentation

- Add [docs/setup.md](docs/setup.md) and the layout shared with diagnostics,
  [docs/setup-layout.md](docs/setup-layout.md).

## 0.2.0 — 2026-08-13

### Added

- Add manager-authorized strict recovery for direct delegated child tasks through
  `bridge_resume_delegated_task`.
- Add a locally linkable `claude-codex-bridge` executable for external project use.
- Add portable external project configuration examples for Codex and Claude Code.
- Add a manually maintained routing policy for bounded delegation decisions.
- Add deterministic synchronization checks for the Claude/Codex skill mirrors.
- Add regression coverage for external workspace selection and linked-launcher startup.

### Changed

- Make the native launcher's workspace default to the process current working directory rather
  than the Bridge source repository.
- Allow a manager to request strict recovery of its direct delegated child while execution
  identity, ownership, leases, telemetry, and session handles remain worker-owned.
- Require substantial tasks to evaluate useful bounded delegation while trivial and tightly
  coupled work remains local.
- Allow external repositories to use the Bridge without containing its source launcher.
- Disable only the project MCP entry named `bridge` inside delegated Codex worker threads to
  prevent recursive manager-server startup while preserving unrelated project MCP servers.

### Fixed

- Fix the recovery dead end where a manager could delegate to another runtime but could not
  safely request strict recovery of that worker.
- Preserve linked-launcher execution through Windows npm junctions and record the launcher's
  Unix executable bit.
- Handle bidirectional Codex App Server requests instead of treating them as ordinary RPC
  responses, and fail closed for unsupported interactive requests.
- Report failed Codex turns immediately when the runtime emits no token-usage event, rather
  than waiting until the delegated deadline or fabricating telemetry.
- Document that custom MCP SDK wrappers must set a request timeout longer than the bounded
  worker deadline instead of relying on the SDK's 60-second default.

### Documentation

- Document external repository installation and bidirectional manager/worker behavior.
- Document owner recovery versus manager-authorized delegated recovery.
- Document manual routing policy maintenance and the prohibition on quota-based or automatic
  benchmark routing.
- Document project trust, linked binary lifetime, external `.bridge/` ownership, and the
  non-recursive Codex worker configuration.

## 0.1.0 — 2026-08-11

### Documentation

- Rewrite `README.md` for a public audience: status banner, purpose, architecture, Node
  `>=22.13.0` requirement, the deterministic `npm ci` → `npm run build` → `npm test` workflow,
  quick start, both project-scoped MCP configurations, the `using-bridge` skill, bounded
  delegation with one Claude-to-Codex and one Codex-to-Claude worked example, ownership and
  leases, recovery, telemetry, troubleshooting, security, contribution, and release policy.
- Label the project Experimental, Pre-1.0, under active development, and not
  production-certified across the public documentation set, and state that APIs and workflows
  may change.
- Add `docs/troubleshooting.md`: symptom-first guidance for setup, MCP discovery and identity,
  ownership and lease errors, delegation and completion gates, recovery, telemetry `null`
  fields, and repository state.
- Add `docs/release-policy.md`: what pre-1.0 means for each interface, the versioning scheme,
  the changelog convention, the release checklist, claim discipline, licensing, and 1.0
  preconditions.
- Add `docs/tools/check-doc-links.mjs`, a dependency-free gate for broken relative links,
  missing heading anchors, and absolute filesystem paths in the public docs.
- Add a vulnerability-reporting section to `docs/security.md` and note that no external
  security review has been performed.
- Add concrete bidirectional delegation examples and an ownership-and-leases section to
  `docs/usage.md`.
- Restate the claim boundary throughout: no benchmark superiority, token or economic savings,
  production security or readiness, large-scale reliability, or optimal autonomous routing.
- Add the standard MIT License and keep every npm workspace package private from registry
  publication.

### Earlier in this cycle

- Position the bridge as an experimental, local Claude Code and Codex coordination system.
- Document installation, native project MCP usage, architecture, telemetry, recovery, security
  boundaries, and the roadmap.
- Record proven behavior separately from claims that still require controlled benchmarking.
- Package the same bounded `using-bridge` skill for project-local Claude Code and Codex
  discovery, and document its opt-in manager workflow.

### Repository hygiene

- Keep runtime SQLite state, generated output, local trust state, temporary files, and
  credential containers outside version control.
- Version only the shared `using-bridge` subtrees beneath otherwise private client-state
  directories.

### Fixed

- Make every bridge-created Claude worker request the protected `opus` / `high` runtime
  profile, persist requested versus actual model evidence, and reject reported non-Opus runs.
- Add a finite persisted Claude turn-budget contract: 1–64 turns, default 12, with 32 as the
  documented starting value for bounded repository audits and identical strict-resume use.
- Stop the Claude adapter from reporting allowed scope globs as changed files when a runtime
  omits exact paths, including blocked read-only runs.
- Replace generic "re-delegate" advice for blocked Claude work with same-task recovery
  guidance.
- Upgrade the deterministic test stack to fixed Vitest and Vite releases after the clean
  install exposed critical/high development-server advisories.

### Core bridge

- Add native MCP composition, runtime telemetry, same-task recovery, deterministic tests, and
  redacted proof artifacts.
