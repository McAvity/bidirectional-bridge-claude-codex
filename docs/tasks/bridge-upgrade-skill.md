# Bridge-upgrade skill — progress

2026-09-19; base ec9a5da; branch bridge-upgrade-skill. User authorized a small local
implementation using the existing CLI, without a new updater, background continuation
or automatic rollback. No wave16/17 scope change or runtime deployment.

Implemented: one canonical skill, generated for Codex and Claude; Claude package now
ships the same existing installer as Codex. Source digest includes the new skill.
Instructions cover marketplace/source/scope, immutable release selection, inherited
worktree setup vs update, active-client exit/apply/resume, stable cache-independent
commands, verification and scoped Git changes. Added package self-containment check
and regression for the actual SETUP_NOT_INITIALIZED case. README/distribution updated.

Validation in progress: install/build PASS; skill frontmatter PASS; generator and
links PASS; 47 Python tests and 140 pilot-tooling tests PASS. Actual CLI help confirmed
Codex marketplace upgrade + plugin add and Claude marketplace update + plugin update.
The full JS result and focused correction are recorded below. Real client probes use isolated profiles/local stubs, not models.

Instruction walkthrough (not a model-behaviour claim):
- inherited old pin/no install.json -> explicit setup --to, now covered by regression;
- valid record -> update --to, repeated application should be a no-op;
- active client -> prepare separate runtime/stable installer, leave pin unchanged,
  exit/apply/doctor/exact-session resume; no forced kill or new manager;
- plugin refresh only/plan only -> no project switch; plan only has no writes;
- cache deletion -> deferred command points outside cache;
- missing runtime -> install exact release commit first, not setup preserving old pin;
- local edits/invalid state -> preserve and report, no reset or automatic rollback.

Generic plugin-creator validator rejects the pre-existing Codex manifest for missing
interface.defaultPrompt and interface.capabilities on both baseline and this branch.
The manifest is unchanged; repository generator validation and real Codex installation
probes pass. Claude's own plugin validator passes. This is not reported as a green
generic validator or a new product defect fixed by this change. No active runtime, personal plugin, pin, profile, model or release
was changed. No push. Next: integrate the validated local commits; publication and runtime selection remain separate.

The first JS run found a test-fixture error in the new inherited-worktree regression:
a manually invented declaration is correctly refused as PROJECT_FILE_MODIFIED.
The regression now inherits files produced by an actual installed older runtime,
matching the reported case. No installer guard or skill behaviour was relaxed.
Targeted validation follows; the initial failing run is not reported as PASS.

## Final validation and handoff

Implementation f5783c1; fixture-only correction e93f53e. No product/skill changes in
the correction. Full npm test on f5783c1: 574 passed, 1 failed (the new invalid fixture),
37 files, 306 s. Focused rerun on e93f53e: the corrected regression passed; 68 unrelated
cases skipped by the name filter. Thus all 574 unchanged cases and the corrected new
case are covered; no claim of a second all-green full-suite run. Build PASS.
Python47 and pilot140 PASS; generator, docs and diff PASS. Host tests exercised actual
Codex/Claude installation with isolated profiles and local model stubs. New copied
package CLI test proves both standalone packages execute outside this checkout and
leave project/home unchanged on status. No actual marketplace refresh or model-driven
upgrade of a user's project was performed.

Only generated copies grew by the existing installer payload. No new dependency,
installer algorithm, protocol, automatic rollback, version bump or release pin change.
The source skill is scripts/plugin-packages/skills/bridge-upgrade/SKILL.md; generated
entry points are plugins/bridge-{codex,claude}/skills/bridge-upgrade/SKILL.md.
After local integration, the skill still needs publication/plugin refresh to become
available in installed clients. Preserve running runtime and the independent wave16
worktree; neither is upgraded by this implementation. No push.

## Publication authorized — 2026-09-19

User requested publication to the existing McAvity fork. Preparing version0.3.2 and
an immutable release source pin; the project's own declaration remains unchanged.
Publication includes the three local skill commits. Full CI must pass on the published
release candidate before creating the annotated tag and GitHub prerelease.

## Published 0.3.2 — 2026-09-19

GitHub prerelease/tag v0.3.2 on `79da6b7ffa06274536e318d870918bc8315ad8dc`.
Runtime source pin `34ecb8d4546543743228f2397b2a16ed10885e31` (version0.3.2).
CI35435206335 PASS:575 JS/37 files; Python47 discovered (44 passed,3 skipped: no Claude
CLI); pilot131 discovered (129 passed,2 skipped: optional PTY dependencies). Local
Python47/pilot140 covered the host/PTY checks. Install/build/packages/docs PASS.
The release CI is a fully green run, superseding the local fixture-only limitation.

Source, both versioned marketplace packages, annotated tag and GitHub release are
published in McAvity/bidirectional-bridge-claude-codex. Existing project declaration,
active runtime, personal plugin caches and profiles were not changed. Next: refresh
installed plugins to obtain bridge-upgrade; use it for a separately requested project
runtime upgrade. Model-driven upgrade behaviour remains unverified.
