# Portable local upgrade script

Status: locally complete, 2026-10-20.
User requested a committed portable replacement for the private versioned apply script,
usable on other machines and selecting the version from the repository's code.

`scripts/upgrade-local.sh` is the Bash entry; `scripts/upgrade-local.mjs` orchestrates
existing acquisition, immutable runtime install, plan/apply and doctor. Target is the
canonical release descriptor's full pinned commit, never arbitrary HEAD or newest runtime.
There is no second updater or manual edit of install records, pins, databases or caches.

Examples from an updated bridge clone:

```bash
bash scripts/upgrade-local.sh                                  # current worktree, plan
bash scripts/upgrade-local.sh --yes /path/to/project            # apply and verify
bash scripts/upgrade-local.sh --yes /path/to/a /path/to/b
bash scripts/upgrade-local.sh --yes --sudo-observer --codex-profile my-profile /path/to/project
```

The last form is for Linux hosts needing explicit privileged process observation.
macOS keeps ps/lsof. Existing bridge home/profile environment variables are preserved;
no machine-specific home, project list, profile, runtime id or native session id is fixed.
Missing runtime plans do not fetch/build or create a bridge home. Applying installs the
pinned commit beside existing runtimes and may need GitHub/npm network access. Project
changes are still refused for active clients or ambiguous process inspection.

Each project is checked before backing up its default `.bridge/bridge.db` and before apply. Backups
live in private unique directories under the selected bridge home's backups/, include
committed WAL state through SQLite backup, and are integrity checked. A failure stops
the sequence; earlier successful projects remain updated. There is no automatic rollback.
After apply, selection is checked and doctor runs; only then is success reported.
Legacy per-worktree setups keep their existing layout; copied/invalid records are not
deleted. Disabled projects are not silently enabled. No marketplace refresh, Git commit,
push, process termination or automatic client restart is performed by this script.

Scope: this wrapper, focused regressions, README and handoff. Previously applied0.5.0
project pin committed separately as b2edfe7; unrelated local session state preserved.
Original private script remains local historical material; it is not copied into Git.

Validation and final commit/checkpoint will be recorded below. No real project upgrade
or real-model test is performed while validating this wrapper.

## Validation and handoff

npm ci --ignore-scripts and build PASS. New orchestration/backup tests11/11PASS,
including stop on refusal, no-write plans, exact descriptor commit, profile/home
preservation, disabled/foreign records, inherited/legacy layouts and SQLite WAL backup.
Real Bash entry invoked from another Git repository with spaces: missing-runtime plan
writes no project files and creates no bridge home. Bash/Node syntax, packages, links
and diff-check PASS. Linux host verified; macOS execution not empirically tested.

FullJS586PASS/76FAIL/7SKIP; the same77 failure headings as the known host baseline,
no new failures. Python113 tests/two identical baseline failures; pilot140/140PASS.
Host process-inspection refusals remain refusals, never bypassed by this wrapper.
No real project apply, marketplace refresh, client restart or model call was run for
these checks. Tests using injected command/status functions verify orchestration,
not a successful real installer apply; backup and dry-run probes use actual SQLite/CLI.

Final files: scripts/upgrade-local.sh, scripts/upgrade-local.mjs, focused tests,
README and this checkpoint. Target version remains the published release descriptor;
this operator helper needs no new runtime pin or version bump. Existing immutable
runtime and local state remain unchanged. Continue by invoking it from a normal shell
with explicit project paths after closing their clients.
