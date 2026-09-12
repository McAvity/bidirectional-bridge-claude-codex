# Review10 — recovery2: REWORK

Task task_<historical-5> BLOCKED attempt2, executor3395f1ac4364ab8f981aa71e2787dd23a70548e7. Bridge blocker is structured evidence validation: reproduction evidence requires valid checks and distinct identified pre-fix/final snapshots. No timeout. Keep same session/task. Independent coordinator plus read-only identity_review.

Independent build PASS, npm test376/376 across26files PASS. Exact recovery-2.zip verify PASS, SHA41ee4cdfb11568a30189cc4e8f17bae352356f63f4b0f888ca9302ade89bf7c0;29changes; known coordinator dirty snapshot disclosed. Coordinator pilotwrapper110tests PASS from prior check retained; no code acceptance implied.

## Prior findings

R09-01/02/03/04/05: resolved in reviewed paths (pure feature preflight, replay result, H/T CAS before repair, feature slots, bootstrap transactional schema). R09-06/07: progress but remaining async side effects/repair and DB consistency below; do not equate376passing tests with full matrix coverage. No repeated no-progress impasse. Formal delivery evidence correction also needed.

## Required

R10-01: async never invokes hooks.afterOperation where bound marker repair lives. A valid delegate/feature_run/recovery with incomplete A/B leaves them incomplete. Run post-successful-reservation repair before L release, preserving authority/CAS ordering and no repair on failed request. Test bound worktree with reserving/missing markers and gated fake worker: at worker start markers bound, L free, normal result; no new epoch/history caused by repair.

R10-02: dispatch-time async authorization invokes mutating authorize in its own transaction (identity-runtime236), so it can commit detached-instance adoption and schema migration before a later invalid operation fails. Replay needs a PURE current-authority check, not early mutations. Adoption/migration remain inside actual operation/reservation transaction. Test clean-detached binding and fresh instance -> recovery missing task: denial leaves binding/generation/history unchanged; analogous old-schema invalid async request leaves schema unchanged. Authorized valid replay still works without extra activation/launch; explicit valid adoption works through its real operation. Do not solve replay by reintroducing INTERNAL.

R10-03: C.database_path is not compared to requested canonical DB; A/B absence lets a copy in the SAME worktree pass. Independently reproduced on3395: bind T1; clean close; copy bridge.db to root/copy.db; remove A; probe(copy), assertProbeUsable -> accepted=true although C.database_path differs. Reject before write/repair when C points elsewhere, even same root/gitdir. Compare all authoritative identity/nonce fields consistently, including owner database and reserving nonce contradictions; interrupted publication is not permission to overwrite contradictory state. Test actual copied DB with A absent and Cpath mismatch; no writes to either DB or creation of owners, plus ordinary missing-A matching-C recovery still works.

R10-04: repair final structured deliverable evidence. Local claude-code-runner.ts920–936 requires valid VerificationResult entries and reproduction_snapshot / verification_snapshot strings containing DISTINCT actual40hex commit or64hex hash identifiers whenever reproduction_results is nonempty. Capture each real snapshot BEFORE its checks; cite paths for file hashes and include test fixture identity where applicable. Don't invent a hash for an earlier uncaptured temporary edit or classify old expected failure as final check. Run a focused red/green reproduction with captured snapshots if necessary; otherwise retain honestly limited historical claims in ledger without invalid structured reproduction. Final verification_results only final-code checks, all real failing results retained. This is a delivery-format correction, not runtime work.

## Recovery

Ordinary same-task recovery,75min/200turns, new ledger04. Preserve existing partial ZIPs/ledgers. Complete packet unique round-6-recovery-3.zip, originalbase511d7de, purposeimplementation-review. Known coordinator dirty files (reviews08/09/10,index,PROGRESS,task,operatorwrapper) remain outside executor commit; this arrangement is already recorded, no new scope blocker. After DONE coordinator checkpoint and integrated clean packet. No runtime/wave9/merge/session replacement/feature acceptance.
