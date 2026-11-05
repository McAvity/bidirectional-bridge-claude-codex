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

On Linux, `--yes` now falls back automatically when the native read-only plan refuses
only `ACTIVE_USE_UNKNOWN`. A second read-only JSON plan confirms the machine code;
console text never triggers elevation. The wrapper authenticates the existing read-only
observer with `sudo -v` (or `sudo -n -v` without a terminal), then repeats the plan once.
Only a successful plan permits backup/apply. The last form selects that observer upfront.
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


## Automatic Linux observer fallback — 2026-11-05

User requested automatic sudo observation for the recurring Ubuntu refusal. Branch
fix/upgrade-auto-observer. Only the source-clone operator wrapper and its documentation
change; no runtime/plugin rebuild, release pin change, project apply or privileged
command was performed during implementation.

With --yes, a failed native Linux plan is diagnosed through the CLI's read-only JSON
output. Only a non-applied plan with exclusively ACTIVE_USE_UNKNOWN refusals permits
sudo authentication and one re-plan. Authentication does not elevate backup, installer
or doctor. An active session, other/mixed refusal, malformed probe, invalid mode,
sandbox, interrupted process, macOS or plan-only invocation keeps the original stop.
Without a terminal automatic authentication uses sudo -n -v, so there is no unattended
password prompt. Explicit --sudo-observer remains supported. A refusal from the new
plan or from apply stops; mutations are never retried automatically.

Validation: upgrade orchestration17/17 and process observer16/17 pass, one privileged
host test skipped (33 pass/1 skip total). New tests cover actual JSON subprocess
responses plus injected authentication/command sequencing, refusal after escalation,
no mutation replay, noninteractive denial and interruption. SQLite backup remains a
real temporary-database test. Build, Node/Bash syntax, CLI help, documentation links
and diff check pass. No real sudo/password prompt or macOS execution is claimed.
The script in this checkout is ready to use with the ordinary --yes command; no new
bridge runtime version is needed. Publication is not part of this local change.


## Explicit outcome and terminal status — 2026-11-05

User reported a successful apply followed by a generic exit-1 error. Read-only
inspection confirmed the target pin, runtime contents and MCP handshake; the failing
project-trust check queried the default Codex context instead of the interactive
shell's profile. With the explicit matching profile the project check passed. The
agent's separate active-use observation remained incomplete without terminal sudo
credentials, so this is not a claim that the entire doctor rerun passed.

Changes on `fix/upgrade-auto-observer`:
- Per-project final result: OK/SUCCESS or OK/PLAN_OK (0), WARN/APPLIED_VERIFICATION_FAILED
  (2, verified selection followed by doctor failure), ERROR/FAILED (1 otherwise).
- Errors include the stage and distinguish apply not started from attempted writes.
  No implicit rollback or repeated apply; later workspaces stop and previous successes
  remain valid. Startup failures also print a final ERROR.
- Green/yellow/red terminal labels for outcomes and doctor checks; underlying errors
  remain errors. Pipes, NO_COLOR and dumb terminals receive plain text; JSON unchanged.
- Profiles remain explicit: the installer does not execute shell wrappers or change trust.

Validation: 39 tests passed and 1 privileged-host test skipped across upgrade orchestration,
process observation and terminal formatting; package generation/check, syntax and docs
checks passed. Generated installer copies match source. No runtime or target-project
changes, release, push, model calls or personal configuration edits. Next: user can rerun
only doctor in the matching profile with terminal observer authorization; future upgrades
should pass that profile or its environment override.


## Already-current setup and final summary — 2026-11-05

A user rerun confirmed another path: the installer returns successfully without process
inspection when there are no changes, so only doctor encounters ACTIVE_USE_UNKNOWN.
The wrapper now diagnoses that failure through a read-only JSON doctor report. Only
an incomplete report whose blockers are exclusively active_use/unknown/ACTIVE_USE_UNKNOWN
allows Linux observer authentication and one doctor retry. Ordinary warnings can coexist;
unrelated errors, sandbox, macOS, interruption or already-selected sudo do not trigger it.
Apply is never repeated. Noninteractive authentication uses cached credentials only.

Every normal execution finishes with a last FINAL line including OK/WARN/ERROR, numeric
exit code and plain-language outcome. Exit 2 explicitly says runtime selection is OK but
verification is incomplete; it does not claim full success. Successful plans are clearly
separated from successful apply+doctor. Detailed stage errors remain above the summary.

Validation: 25 upgrade tests and 3 output tests PASS, including no-op-path doctor fallback,
failed sudo/retry, platform/interruption restrictions, mixed blockers, summary ordering
and read-only plan outputs. Syntax/docs/diff checks PASS. No real project apply, runtime
change, new release or push. User may rerun the same upgrade command with their profile;
terminal sudo authentication can now be requested at the doctor stage too.
