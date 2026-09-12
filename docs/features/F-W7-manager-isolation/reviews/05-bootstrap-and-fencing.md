# Review 05 — revision 4 corrections: REWORK

Reviewed task: task_<historical-8>, DONE, executor commit 17512076fa5556e6f493ecfdfc757a9fd2301366.
Base: 75e0854838b70da523086af6a11bc575c7c84772. Authority: decisions/06.md.
Independent coordinator review plus read-only Codex identity_review (envelope and instance protocol).
Delivery is not acceptance. Contract only; runtime unchanged.

## Evidence and scope

Independent feature_exchange.py verify of <operator-home>/tmp/F-W7-manager-isolation-round-3.zip with exact feature, contract-review purpose, base and head: PASS. SHA-256 446216ad1bbe145a5f498ccecc6bf64e05f5f0c7297eb48a4db999bdbd5a3642. Clean export, matching range, no changed/missing documents. git diff --check PASS; git status --short empty; exactly contracts/identity.md and execution/W7-ID-01/04.md changed.
A Python scratch reproduction creates state.lock using exclusive create in a subprocess then exits without cleanup. After process exit another exclusive create still raises FileExistsError; the directory is nonempty solely because of state.lock. Observed, not a proposed test. No product suites or live-agent isolation tests run.

## Previous required findings

| Finding | Disposition | Evidence |
| --- | --- | --- |
| R04-01 | progress | Mandatory turn metadata closes the fail-open paths; verified-version range still too broad (R05-05). |
| R04-02 | progress | Active instance restored, but epoch ABA and detached adoption permit stale activation (R05-04). |
| R04-03 | resolved | External --db restored with A/B/C identity and archive caveat; symlink path equality no longer proves ownership. |
| R04-04 | progress | Coherent preflight/reservation introduced, but persistent lock and fresh-directory recheck are incomplete (R05-01/02). |
| R04-05 | progress | Honest read semantics and store split improve the contract, but migration still precedes authoritative transactional guard (R05-03). |

## Required ordinary corrections

### R05-01 — persistent exclusive-create lock cannot recover after a crash

Section 4.4 step2 uses wx state.lock; process death does not release that pathname. Section4.5 stale-reservation recovery requires acquiring the very same lock, but defines no safe lock recovery. Crash after commit before marker rename is equally stuck. Nonce recheck does not solve acquiring a stale lock. Specify a concrete process-death-safe serialization primitive/protocol, how concurrent acquisition works, and how no two live holders emerge. Do not substitute PID/mtime guessing. A kernel-held lock is an option if its actual available mechanism and lifetime are established; this is contract design, not permission to add product code or an installer. Describe partial A/B publication, rollback and every crash boundary under that protocol. Recovery must happen only on authorized ownership mutation: replace the current 'next start completes rename' in section4.5/testD-05, which contradicts startup/read no durable writes. Re-reading C with an existing binding must never recreate epoch1/history or silently claim it for a foreign caller.

Acceptance: first call, two contenders, death while holding lock before/after DB commit, partial marker publication and authorized recovery all have deterministic safe outcomes. Startup/reads only report recoverable state.

### R05-02 — fresh bootstrap invalidates its own empty-directory preflight

Section4.4 step2 writes state.lock, then step3 repeats section4.5 classification. With A absent and requested DB absent, directory is now nonempty, so the stated rule returns unresolved_workspace_state even on a fresh worktree. Define mkdir timing (wx cannot create a missing parent) and distinguish known protocol infrastructure created/held by this operation from unknown prior state. Preserve fail-closed behavior for unexplained nonempty state; do not blindly ignore all files. Resolve this jointly with R05-01.

Acceptance: missing .bridge and empty .bridge both bootstrap; unknown existing files remain refusal; own lock/temp artifacts do not spuriously refuse a legitimate fresh bootstrap.

### R05-03 — precheck does not authorize later migration through takeover

Section6.3 orders read-only precheck, writing initializeOrMigrate, then authoritative BEGIN IMMEDIATE guard. Counterexample: I1 passes precheck; I2 commits takeover; I1 migrates/upserts schema_meta (or changes journal_mode under section6.2); only then transaction denies I1. Rollback cannot undo the preceding writes. The ledger's claim that this window cannot produce unauthorized durable writes is false. Specify serialization/transaction boundaries which cover authority validation AND every DDL/schema_meta/journal-mode change, both bootstrap and existing database migration, and interact coherently with takeover/resume. Merely calling a path 'authorized' is insufficient. Plain attachment must not conditionally change persistent journal mode before that protection. No weakening of the no unauthorized migration requirement.

Acceptance: deterministic pause after precheck with takeover/resume before write has no forbidden durable changes; schema initialization/migration and normal attach paths have explicit ownership guards and race tests. Existing read-side technical sidecar allowance stays.

### R05-04 — instance resume ABA and reactivation of fenced instances

Section7 H checks only expected_generation, while takeover resets generation=1. Delayed H from T1/generation1 can pass after T1 -> T2 -> T1 at a new epoch/generation1. Require expected_epoch plus expected_generation in one CAS with native identity. Separately: I1 is fenced by H to I2; I2 cleanly detaches; ordinary M from I1 sees active=null and automatically adopts. This violates the promise that a fenced instance cannot restore itself through an ordinary mutator. Define eligibility/history for automatic adoption of a fresh instance; a known fenced instance requires explicit H. Align interface, transition table, guard and tests. Qualify 'anything from T1' after takeover: reads remain Class R, and explicit authorized takeover remains available.

Acceptance: delayed H across epoch changes rejects; two simultaneous H have one winner; I1/H-to-I2/detach-I2/M-I1 rejects; fresh same-thread restart after clean detach remains tokenless and works; no ordinary mutator ping-pong.

### R05-05 — only 0.154.0 is verified

Sections5.3 and final open-items claim 0.154.* / 0.154.x verified although source and binary evidence cover exactly 0.154.0. Restrict adapter to that version (or explicit genuinely verified allowlist), align adapter ID and ledger, and reject unknown patches until verified. No launcher or further host-version investigation is needed for this correction.

## Route and resume point

REWORK within decision06; substantial progress, no repeated no-progress impasse and no new user decision. Next ordinary contract-only Claude round in the SAME pinned native session after DONE, 75 minutes/200 turns, polling5min. New ledger05 and round-4 package; preserve earlier packages/ledgers. Coordinator commits this review/index/progress separately before delegation. No W7-ID-02 implementation, no feature acceptance.
