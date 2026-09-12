# Review 06 — revision 5: REWORK

Task task_<historical-7> DONE. Executor bc144c7db056d0b81787cbb73ad5a14791cd0b65; base9f807c08b838c00d0a12aa1d7104a40bb42c17e2. Authority decisions/06.md. Independent coordinator and read-only Codex identity_review. No acceptance or implementation.

## Verification

Independent round-4.zip verify exact feature/purpose/base/head PASS, SHAa54818f37d3c81f06bf1eef3b3a913281d0b5cb543b327589189d03dfc4ed3f6, clean export, changed/missing documents empty. git diff --check PASS, worktree clean, only contract and ledger05 changed. Isolated sqlite3 reproduction of proposed PK and UNIQUE: insert (epoch1,generation1,I1), (1,2,I2), then (1,3,I1) throws UNIQUE constraint failed: manager_instances.epoch, manager_instances.instance_id. This is an actual schema counterexample, not a product test.

## Previous findings

R05-01 progress: death-safe lock mechanism replaces persistent wx, but lifecycle has remaining holes (R06-02/03).
R05-02 progress: own-artifact exemption fixes ordinary fresh bootstrap, not pre-publication crash leftovers (R06-02).
R05-03 resolved at contract level: DDL/migration now transactional with authority, journal initialization protected by L, attach leaves existing mode unchanged; implementation tests still required.
R05-04 progress: epoch CAS and history-based eligibility fix requested races, but new UNIQUE prevents permitted explicit H (R06-01).
R05-05 resolved: exact0.154.0 adapter, no unverified patch range.

## Required corrections

### R06-01 — history index prohibits explicit reactivation

Sections7/12 permit explicit H to return I1 after I1->I2, but UNIQUE(epoch,instance_id) disallows its next activation row. Keep append-only activation history keyed by (epoch,generation); ordinary adoption eligibility needs an EXISTS query, not uniqueness of instance over its entire epoch. A nonunique lookup index suffices. Verify against actual SQLite: I1->I2->I1 via explicit full-CAS H succeeds preserving all activation rows; ordinary M by historical/fenced instance still fails. Include same-instance H behavior (defined no-op/refusal or coherent activation), without inventing a new session.

### R06-02 — incomplete bootstrap state machine after crashes

Section4.1 creates nonce.tmp BEFORE linking A/B. If process dies after temp write but before either link, its nonce is not this operation's nonce under4.4 step3, hence unexplained state; yet4.5 says death before publication always proceeds normally. Define evidence-based classification of interrupted protocol temp files (without deleting arbitrary files or accepting a mere wildcard as valid evidence) and partial publication, including foreign/malformed content. Do not promise automatic recovery for a state deliberately rejected. No loss of existing C/ownership and no scanning arbitrary DBs for identity.

Also4.4 explicitly excludes bound current-schema M from L, even when markers incomplete;4.5 promises next authorized ownership mutation completes them under L. Make recovery-needed a concrete dispatch condition with identity/instance validation BEFORE durable marker repair; preserve H/T behavior and existing C binding/history. Clarify that takeover/handoff/migration on a bound database skips initial reservation publication (step4), rather than creating a fresh nonce before checking authority. Distinguish unbound bootstrap, existing ownership, and marker-only repair without ambiguity.

Acceptance: trace missing .bridge; failed operation; death before temp/link, after one link, after main DB commit; ordinary M on incomplete markers; foreign M; explicit H/T. Unknown unrelated state still fails closed. Add small isolated filesystem/model checks for decisive cases if helpful; label them contract experiments, not implemented production protocol.

### R06-03 — lock initialization and filesystem guarantee

4.4 step2 creates L with DDL BEFORE busy_timeout and BEGIN, yet says acquisition failure writes nothing beyond mkdir. This is false for L initialization and timeout can occur at DDL first. L does not need lock_meta to hold a BEGIN IMMEDIATE lock: use a concrete order open->configure connection-local timeout->BEGIN, DDL only if justified and protected. State exactly which coordination infrastructure may exist on failed acquisition; it is not manager ownership/domain writes. Check against actual node:sqlite, including initial file creation and killed-holder reopen, and keep immutable=false semantics. Do not claim a hot journal necessarily exists from a transaction with no write.

The claim that broken advisory locks automatically yield state_locked has no detection mechanism. Document supported working local filesystem locking as a precondition and unsupported mounts as unverified; detected lock errors/busy fail closed. Do not add filesystem diagnostics/installer to manufacture a guarantee outside this task.

## Route

Ordinary corrections within decision06, real progress, not a no-progress impasse. Same Claude session, next round5,75min/200turns. New ledger06 and round-5 archive, preserve all earlier evidence. Seek coherent final protocol and focused experimental checks, not extra product scope. Independent review again; feature remains unaccepted.
