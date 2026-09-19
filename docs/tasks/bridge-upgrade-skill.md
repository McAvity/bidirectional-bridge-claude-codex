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
JS suite still running. Real client probes use isolated profiles/local stubs, not models.

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
was changed. No push. Next: validate packages, scenario boundaries and required suites;
record results, then integrate local commits if clean.

The first JS run found a test-fixture error in the new inherited-worktree regression:
a manually invented declaration is correctly refused as PROJECT_FILE_MODIFIED.
The regression now inherits files produced by an actual installed older runtime,
matching the reported case. No installer guard or skill behaviour was relaxed.
Targeted validation follows; the initial failing run is not reported as PASS.
