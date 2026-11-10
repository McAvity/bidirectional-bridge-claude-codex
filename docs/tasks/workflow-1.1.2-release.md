# Workflow 1.1.2: session auto mode for hcom workers

Status: implementation, 2026-11-10. User accepted auto mode and requested proceeding.
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
