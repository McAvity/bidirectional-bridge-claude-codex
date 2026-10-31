# Delivery validation recovery — 0.6.2

Status: released 0.6.2; affected project activation pending. User authorized the bridge correction, release and preparation
of a checked project upgrade. Worktree/branch: fix/delivery-validation-recovery.
No real project database, source or running runtime may be edited to bypass recovery.

## Scope

- Claude report fields that would violate the canonical deliverable schema become
  explicit PARTIAL/BLOCKED output with the original report preserved, never guessed
  changed paths, invented checks or automatic success.
- A direct manager may explicitly recover a historical FAILED Claude task only when
  durable records prove completed execution and rejection of its deliverable schema.
  Preserve task, scope, feature, session, original attempt and evidence; start one new
  adjacent attempt through strict resume. Other FAILED/INVALID_ARGUMENT stays terminal.
- Require a recovery clarification, explicit runtime deadline and idempotency key;
  preserve normal feature state, ownership, fencing, lease and replay guards.
- Update both role instructions and feature loop, tests, packages and release metadata.

## Validation and release gates

Synthetic fixtures only, no real prompts, session handles, task IDs or user answers.
Regressions: object changed_scope plus invalid reproduction evidence, preserved report,
normal BLOCKED recovery, historical SQLite/restart recovery, exact same session/task,
formal rejection without mutation for unrelated failures/missing evidence/active work,
wrong owner, waiting/closed features, strict-resume refusal and idempotency/replay.
Build, focused tests, required full suites and isolated CI before publication.
Independent review of the eligibility and validation boundaries before release.

Next: implement and verify; append actual results. Deployment/resume in the affected
project must use its real bound manager and existing session, never this diagnosis client.

## Implementation and first validation

Early runner validation, historical proof gate and explicit recovery mode implemented.
Build and61 focused tests PASS: actual runner/adapter/control-plane path with a scripted
CLI, historical SQLite/restart/idempotency and identity/timeout regression suites.
Pure-read eligibility on the affected live state PASS, without opening a write store,
reserving an attempt or exposing its session handle. No affected-project source/state changed.
Both roles, loop instructions, MCP schema and protocol/recovery docs updated.

First full local JS/pilot attempt hit ENOSPC on the root /tmp filesystem; results are
invalid as release verification. Reruns use a private scratch directory on the home
filesystem. Original Python113 tests passed with5 environment skips; it will be rerun
after source commit to exercise the current archive. Independent read-only review runs
through the existing pinned bridge; its supervising runtime stays immutable.

## Independent review corrections

The independent Claude review confirmed the historical proof/ownership/session/replay
gate and found three code/test issues: stale exact MCP key list, rejecting already
bounded/defaulted string summaries, and long blocker strings exceeding the canonical
risk limit. Corrected all three; regressions cover empty/9000-character summaries
and long blockers. Long runtime error-frame text is also preserved/bounded.
Its fourth finding concerned instructions/metadata which were delivered after the
initial read; all role/loop/protocol updates and 0.6.2 metadata now match.
Manager rerun:195/195 across8 suites, plus build/packages/docs/diff-check PASS.
The same reviewer is doing focused correction review, not a new broad audit.

Home-filesystem pilot rerun140/140 PASS. Full local JS before the review corrections:
611 PASS,77 failed,7 skipped; one is the stale MCP shape now corrected and76 match
the known protected-process setup baseline. Final full suites and isolated CI follow
the committed release source. No claim that these local full suites passed.

## Review complete — PASS

The same independent Claude reviewer closed all four findings and reran195/195
tests plus package source equivalence. No required findings remain. Reviewer scope
was implementation and focused corrections; no real-model recovery pilot was run.
Manager source771e797a73d3693b651806044fe3f88acd24ea02, release pin39230e9.
Historical short reports not preserved by an old runtime remain ineligible; no proof
is fabricated or bypassed to recover them. User's affected state has an intact report.
Full release CI is the publication gate. No affected task has been resumed.

## Published — 2026-10-31

Experimental [v0.6.2](https://github.com/McAvity/bidirectional-bridge-claude-codex/releases/tag/v0.6.2)
at6caae185f757a06609a3799bcc31e9ce2d471d98, source771e797a73d3693b651806044fe3f88acd24ea02.
[CI41193161217](https://github.com/McAvity/bidirectional-bridge-claude-codex/actions/runs/41193161217)
PASS: JS697/1skip, Python113/5skips, pilot131/2skips; protected observer17/17.
Final local suites: JS615PASS/76 baseline process-inspection failures/7skips;
Python113/2 baseline installer failures; pilot140PASS. ENOSPC attempt excluded.

Immutable runtime0.6.2-771e797a73d3 installed beside older versions. Real stdio
handshake:36 tools and new recovery parameter, no state creation/model invocation.
Independent Claude code review PASS is separate from a real task-recovery pilot.

Affected project plan changes only portable pin/local selection. Apply not performed:
ACTIVE_USE_UNKNOWN from restricted process metadata, and noninteractive sudo authorization
is unavailable. Private stable installer/apply kit outside Git includes a consistent
SQLite backup, exact runtime/status/doctor checks, exact existing manager resume command
and focused recovery handoff. User must close project clients normally and run it in
a terminal that can authorize the read-only observer. No task recovery, code correction,
application deployment or synthetic acceptance was performed in the affected project.
Manager must read updated runtime instructions, preserve existing task/session and use
one explicit recover_invalid_delivery request at the previously authorized budget.
