# Shared Codex writer attribution — macOS hotfix

Status: locally delivered, 2026-11-10. User requested a quick working updater for an
existing project blocked by 0.8.1. Branch/worktree: `fix/shared-writer-workspaces`.
No new release or active-runtime rebuild; the corrected installer still selects the
existing immutable 0.8.1 runtime. Workflow 1.0.0 unchanged.

## Implementation

The macOS process reader refines its existing foreign-cwd writer refusal using an
optional Python standard-library local WebSocket reader. Darwin LOCAL_PEERPID binds
responses to the exact observed process. The Codex home comes from observed writer
paths, not the caller's environment. It queries initialize, loaded/list and read with
includeTurns=false only. Two metadata passes and three inventories must agree.
It checks all loaded IDs plus observed writer IDs, including hidden guardians.
Only exact not-loaded responses release stale open-writer evidence. Live local
environments (cwd plus runtimeWorkspaceRoots) are authoritative; persisted thread.cwd
is deliberately ignored. Overlapping target paths block. Unsupported data, failures,
missing Python, identity mismatch or races fail closed. Existing bridge/state checks
remain. Linux behavior is unchanged.

No bridge mutation/delegation was performed: this conversation's MCP resolves to a
foreign worktree. One bounded native read-only review found no remaining blockers;
its metadata-source concern led to checking live environments instead of historical cwd.

## Validation

- Node 24 build PASS; process/startup tests 21 PASS / 2 explicit skips (Linux-only
  process integration and opt-in startup acceptance).
- Python synthetic metadata/transport tests 18 PASS, including stale cwd, extra
  workspace roots, active hidden guardian, finished guardian, changed inventory,
  unsupported metadata, peer mismatch and malformed/fragmented WebSocket frames.
- Generated packages equivalence and diff whitespace checks PASS.
- Actual Codex 0.167 shared daemon: unrelated empty synthetic target permitted;
  active affected project still reports ACTIVE_SESSION with no configuration conflict.
- Separate Codex 0.167, isolated temporary home, no credentials/model: active target
  blocked; unrelated target permitted; target permitted after normal unsubscribe and
  daemon remains running. First short wait correctly found the thread still loaded:
  default unload delay is 60 seconds. Repeated with delay=0 in the synthetic home;
  an in-flight inventory change refused, then the stable retry passed.
- Prepared a private stable installer copy and exit/apply script for the affected
  project, with bounded read-only retries while target sessions unload. It retains
  normal update/status/doctor checks. No live project update was applied during testing.

Next: user exits target project clients and runs the prepared script, then verifies
live MCP after resume. Future release should include this source change; no publication
is implied by this local hotfix. Existing user pin/config edits remain untouched.
