# Review09 — recovery attempt1: REWORK

Task task_<historical-5> remains BLOCKED/PARTIAL; executor1095c166dbd3fccfd940cd9e89c03ef6f9b05126. Reviewed partial range f9bfcce..1095c16; full implementation base511d7de. No recovery package (correct for PARTIAL). Coordinator plus read-only Codex identity_review, independent of executor. Authority decision07, no acceptance.

R08-03/04/06 show concrete fixes (stable writer under reads, named public Claude launch prohibition, detach generation/event) and new tests. R08-01/02/05/07/08 progress, not closed: required findings below. R08-09 resolved locally by coordinator's minimal uncommitted test-harness change; see provenance below. Not a repeated unchanged scope blocker.

## Required corrections

R09-01: FeatureWorkflow.run calls mutating get/refresh before authorize; feature_run of foreign/fenced caller may reconcile feature/events before rejection. Use pure preflight; every request-side reconcile/event/idempotency write under actual authority guard. Test unreconciled completed feature, foreign run and byte/logical unchanged state. Round attribution must derive epoch/thread from same transaction guard, not preflight.

R09-02: feature-run and recovery persisted/active replay bypass gate, then runMutationAsync returns INTERNAL for a legitimate replay. Current ownership must be checked on replay without reserving/launching new work. Test completed and concurrent replay through public MCP for owning and foreign callers; preserve exact result, attempts/start count.

R09-03: H/T inBound authorize does registry.read only, then migration/repair, while real thread/CAS checks happen in later tool handler. Reproduced independently against built1095c16: bootstrap T1, unlink bridge.db.owner, call H with FOREIGN metadata and epoch1/generation1 -> isError=true BUT owner file recreated. Validate H/T CAS before any filesystem repair; these classes must not migrate. Test foreign H, stale H/T on incomplete markers, unchanged A/B and schema. No reliance on SQL rollback to undo filesystem writes.

R09-04: feature slot claim only create/run, not wait_user/answer_user/accept. Enforce contract feature ownership/active slot on ALL mutating feature touches, including adopted historical features, in same transaction; read remains pure. Test activeF1, attempted F2 mutations rejected with FEATURE_CONFLICT and no events, first touch claims empty slot, accept releases only its active feature. Cover legacy feature attribution/adoption events and provenance required by contract (including per-table counts).

R09-05: bootstrap still calls store.initializeSchema BEFORE body/operation transaction (identity-runtime inBootstrap); that method commits its own transaction. A failed first operation or legacy adoption can leave schema/schema_meta migration despite claimed full rollback. Place initialization within the actual reservation/operation transaction with bootstrap authority proven; journal change only new file under L as contract. Test actual historical schema fixture and failure rollback, not merely lower schema_version on already-new schema. Never rewrite existing journal.

R09-06: fix critical-section lifecycle for async paths. inBootstrap releases L in synchronous finally when body returns Promise, but settleBootstrap publishes/cleans only after Promise result (potentially long-running worker), outside L. inBound attaches result.finally(section.release) AND immediately releases in synchronous finally; later finally may reject otherwise successful async result by closing already closed database. Release exactly once at appropriate reservation/publication boundary, without holding lock for full model execution and without deferred unguarded filesystem changes. Test async first ownership, recovery-needed bound async operation, gated worker concurrent takeover, final successful result and canonical markers. Request guards must retain fresh authority and nonce semantics across any awaits.

R09-07: finish R08-07 real crash/race tests, section14 process/worktree/stdin coverage and missing two-worktree waiting_user restart with exact fixture worker session. Do not declare all requirements verified from a few happy-path tool tests. Add deterministic regressions for each above issue, then full suites. Retain actual limitations.

## Coordinator harness correction (R08-09)

Only tools/pilot/rework/operator/dryrun.mjs call wrapper changed: synthetic request _meta with threadId/session_id/thread_id=dryrun-manager and codex_version0.154.0, explicitly labelled scripted tooling fixture. Production guard unchanged; no operator prompts/fixtures added to worker input. Coordinator independently ran python3 -m unittest discover -s tools/pilot/tests -v:110tests PASS,16.180s. This reversible validation-harness correction is within user-authorized ordinary regression fixes, outside CHILD product scope; worker must neither edit nor commit it.

Coordinator checkpoint files and this wrapper are deliberately uncommitted while task BLOCKED, preserving bridge-loop commit separation. They are pre-existing coordinator work, not uncommitted executor work. Worker may run suite using them and commit only its own scoped changes; final package manifest must truthfully record dirty coordinator snapshot (no false all-worktree-clean claim). Once DONE and reviewed, coordinator commits its own files separately and exports/verifies integrated clean handoff. This resolves the scope obstacle without replacing task/session, broadening child scope, changing runtime or weakening tests.

## Next recovery

Same BLOCKED task/session, ordinary resume,4500000ms/200turns, no recover_timeout. New ledger03; preserve01/02 and historical partial ZIP. Required R09-01..07, R08-09 now locally resolved. Completed worker package filename round-6-recovery-2.zip (new, never overwrite), original base511d7de, final executor HEAD; clearly record pre-existing coordinator paths separately from own clean scoped changes. No coordinator commits by executor, no wave9/feature-workflow integration, no acceptance. Stop actual timeout/material decision/impasse.
