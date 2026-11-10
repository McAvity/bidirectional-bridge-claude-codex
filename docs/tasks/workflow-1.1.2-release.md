# Workflow 1.1.2: session auto mode for hcom workers

Status: published, 2026-11-10. User accepted auto mode and requested proceeding.
Branch/worktree: release/workflow-1.1.2, based on published 1.1.1 checkpoint10483ec.

New workers use --permission-mode auto unless the user explicitly selects another
mode. Record the requested mode, inspect client support and startup/fallback notices,
and report blockers without silently switching mode/model/account. Existing sessions
keep their mode. Task authorization, independent review, receipt and guarded finish
remain required; no blanket allowlist, bypass or global/project settings changes.
Bridge stays0.8.2. No runtime rebuild, client activation, paid trial or historical
trial recovery is included. The previous 15 approvals are not an auto-mode measurement.

Canonical instruction and public launch example updated; both client packages regenerated.
Package equivalence, skill validation and working-tree docs315 PASS. Relevant hcom
regressions35 PASS (scripted, no real model). Full exact-distribution CI follows. Release sequence: source commit,
append immutable source/identity registration, distribution commit, exact-SHA CI,
annotated tag and experimental GitHub release, then publication checkpoint.

The main checkout and unrelated pin are preserved. Foreign Bridge MCP state is not used.

Source commit: `2d413b2186a745964c7f9cd8a5154513ec50a176`. Registered identity: `sha256:0a0994b841cb9d74785f15e6cf3e5e2f18619b16ccfdf4a3ce3526f75060a30b`.
Distribution/tag commit: `ef8965cd68639744e6f47a48be0e9800ebd1b058`.

## Published checkpoint

[Experimental release workflow-v1.1.2](https://github.com/McAvity/bidirectional-bridge-claude-codex/releases/tag/workflow-v1.1.2)
published at 2026-11-10T18:13:24Z, not a draft. Annotated immutable tag and remote
integration branch were updated atomically after exact-distribution
[CI42871152136](https://github.com/McAvity/bidirectional-bridge-claude-codex/actions/runs/42871152136)
SUCCEEDED: JS782 PASS/2 skipped, Python296 OK/5 skipped, pilot131 OK/2 skipped;
build, package equivalence, docs316 and protected process observer also passed.
Local hcom35 and skill validation passed. Branch and source registration are committed.

The released change is the launch instruction and both generated workflow packages;
no receipt/helper/runtime behavior changed. Both Bridge role packages remain identical
to1.1.1's distribution. New clients need plugin refresh/discovery; existing feature
locks require an explicit workflow switch. No installed client was activated here.
Previous manual-run15 approvals are historical, not an auto-mode benchmark. No paid
model launched or prior trial state recovered. Main checkout's unrelated pin and the
trial worktree are preserved. No required release work remains.
