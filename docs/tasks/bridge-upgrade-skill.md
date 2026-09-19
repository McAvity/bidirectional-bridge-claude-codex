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

Validation pending. No active runtime, personal plugin, pin, profile, model or release
was changed. No push. Next: validate packages, scenario boundaries and required suites;
record results, then integrate local commits if clean.
