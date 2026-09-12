# Review 07 — contract revision 6: PASS

W7-ID-01 contract corrections pass local independent review. No required finding remains in the reviewed contract scope. Implementation W7-ID-02 is technically unblocked; this is not product validation or user acceptance of F-W7-manager-isolation.

Reviewed task task_<historical-6> (DONE), executor commit19914a074fafa7228bbae066934e2b1f49833555, base d94c2dee56464863f42cae1cfd192e02f8108034. Authority decisions/06.md; previous review06-protocol-completeness.md; ledger execution/W7-ID-01/06.md. Reviewer is the coordinating Codex session, independent of Claude's execution but not of coordination. A second read-only Codex identity_review independently checked native context, instance CAS/history and related regressions; it found no remaining blocker in that scope.

Contract SHA-256: 1ba2318e6d12bb0e2860db069ba5091bd11aa4a7bd2f295e3500759a3cf9f480.

## Required findings closed

| Finding | Disposition | Review evidence |
| --- | --- | --- |
| R06-01 | resolved | Nonunique instance lookup index preserves activation history; explicit I1->I2->I1 and EXISTS-based fresh adoption are compatible. Full epoch/generation CAS and same-instance no-op are defined. Exact SQL independently executed. |
| R06-02 | resolved | Modes distinguish unbound publication from existing ownership; recovery_needed routes marker repair through L. Section6.3 explicitly requires authoritative CAS/identity validation in the main transaction before marker repair. Temporary records need parsed worktree identity and nonce consistency; unknown/malformed/foreign state fails closed. Startup and reads report only. |
| R06-03 | resolved | L needs no schema; fixed open/timeout/BEGIN order, truthful infrastructure residue, and working local filesystem locking stated as a precondition. No invented detection or installer scope. Independently reproduced contention and process-death release. |

Earlier substantive corrections remain: external --db and A/B/C exclusivity, protected schema changes, exact host adapter0.154.0, mandatory per-request native metadata (never model args), guardian exclusion supported by version-bound host source, epoch/generation fencing and explicit takeover. No hook, launcher or manual token is needed for the accepted accidental-mixup boundary.

## Independent checks actually run

- feature_exchange.py verify on <operator-home>/tmp/F-W7-manager-isolation-round-5.zip with exact feature, contract-review purpose, base and head: PASS. SHA-256349e07c079d6d9816b96e59aea473d8acb786b6cfae56a4321be5bbd432432e1; clean export, matching range, two changed files, no changed/missing document snapshots.
- git diff --check d94c2dee56464863f42cae1cfd192e02f8108034..19914a074fafa7228bbae066934e2b1f49833555: PASS; clean working tree before coordinator checkpoint; only contracts/identity.md and new ledger06 in executor range.
- Python sqlite3 in-memory database executed the exact SQL block extracted from this contract. Three activations (epoch1,generation1,I1), (1,2,I2), (1,3,I1) succeeded; all three rows retained. Eligibility NOT EXISTS was false for I1, true for fresh I3.
- Independent Node v24.15.0 node:sqlite scratch subprocess experiment: schema-less L opened; connection-local busy_timeout200; holder BEGIN IMMEDIATE; contender reported SQLITE_BUSY; holder killed and waited; next contender acquired and rolled back; final main file remained0bytes. No schema or product state used.

These are targeted contract/mechanism experiments, not an implementation of the protocol. npm/build/Python product suites and the planned section14 matrix were not run for this documentation-only delivery. No real two-manager/worktree pilot is claimed.

## Acceptance coverage and implementation obligations

The contract defines AC-01..07 and section14 provides the implementation matrix: native missing/foreign/context confusion, guardian/subagents, simultaneous first calls, DB-selection races, atomic failure, exact resume, epoch ABA, stale instance, takeover during work, initialization/migration boundaries and interrupted marker publication. PASS means the proposal is ready to implement, not that these scenarios already passed.

During implementation preserve the explicit fail-closed rule for unparsable A/B (section4.5); a recovery_needed diagnostic flag does not authorize repairing ambiguous records. Section6.3's transactional authority guard must precede marker repair, regardless of the high-level dispatch shorthand in section4.4. Distinguish infrastructure files from domain/ownership writes in assertions. These are existing normative constraints, not new behavior or permission to weaken them.

Remaining documented limits: host version exactly0.154.0; local filesystem with working advisory locks; no authentication against malicious same-UID process; first legitimate ownership caller wins among roots; SQLite readers may create technical sidecars. Malformed interrupted state may require operator inspection. The supervising runtime remains pinned and unchanged.

## Resume point

W7-ID-01: done at contract/review level. W7-ID-02: ready by dependency, not started in this contract-correction step. Feature remains awaiting_review, not accepted. Next implementation uses the same pinned Claude feature session through the existing workflow, with a concrete scope/test plan based on this contract; no recovery of this DONE task. Preserve round-1..5 archives and all earlier ledgers. Poll any future active round every5min; stop at new timeout or material decision. Coordinator checkpoint is separate from executor19914a0.
