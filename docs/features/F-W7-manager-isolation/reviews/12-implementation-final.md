# Review12 — W7-ID-02 integrated implementation: PASS

Recommendation: accept the implemented manager/worktree isolation scope after the user's own review. No required local finding remains. This is technical review, not user acceptance, deployment or merge into feature-workflow. Diagnostic export, installer and the real-model release pilot remain outside this delivery.

Reviewed task task_<historical-4> DONE (round7), executor1d872db6b58aa199c325aad7a2532877e754dd32, correction base117fd9f5a98aa66a8e8b0b0340d899f0f6b8ecf7. Integrated implementation range511d7de6fe388113e13558840ac747f1e7045834..1d872db6b58aa199c325aad7a2532877e754dd32, including preceding task_<historical-5> DONE attempt3. Authority decisions/07.md and contract r6/review07; previous review11. Reviewer is coordinating Codex, independent of Claude execution but not of coordination. A bounded read-only second Codex independently checked guards, replay, CAS and final completion changes across corrections.

## Finding closure

R11-01 resolved: FeatureWorkflow.result derives through view; replay and response construction do not mutate. Normal worker completion reconciles in an explicit transaction that repeats authority validation. If ownership changed, stored feature may remain stale while responses derive the correct state; an authorized mutator later reconciles. Regressions cover replay after detach with no activation/event/state write, normal completion, and response after takeover. Second reviewer found no remaining concrete blocker in this path.

R11-02 resolved: A and B nonce checks against C are independent of reserving/bound state. Both contradictory states refuse before repair; same-nonce interrupted publication and absent-record reconstruction remain supported. Public-tool regressions cover both records/states. Earlier R08..R10 issues are closed by the recorded code corrections and tests; previously partial claims are preserved as history, not current evidence.

## Independent verification actually run on final code

| Check | Result |
| --- | --- |
| npm run build | PASS, exit0 |
| npm test -- --reporter=dot | PASS387tests,28files, exit0 |
| python3 -m unittest discover -s tests -v | PASS19tests, exit0 |
| python3 -m unittest discover -s tools/pilot/tests -v | PASS110tests, exit0 |
| git diff --check | PASS |
| round-7.zip exact feature/purpose/base/head verify | PASS; clean export; four executor files; no missing/changed documents |

Round7 package: <operator-home>/tmp/F-W7-manager-isolation-round-7.zip, purpose corrections-review, SHA52bb1c1f9aaa00103090ec954aa08823f853eaca7a771aa75711a6aa22d8dfeb. Initial npm ci --ignore-scripts was run successfully by executor on the existing lockfile; coordinator did not repeat installation unnecessarily. No dependency upgrades.

Earlier independent tests included actual SQLite schema execution, killed-process lock acquisition, failed H incorrectly recreating an owner file before the fix, and copied same-worktree DB path bypass before its fix. Final tests cover these regressions. Historical uncaptured red/green observation in ledger03 is not used as identified structured evidence; ledger04/05 carry captured evidence. Latest bridge tasks are DONE. Saved Claude execution handles were compared privately across final contract task, implementation/recovery and final correction: equality true; no native handle published.

## Scope and acceptance evidence

- AC-01/02: workspace/database records, native manager epoch and active instance, feature slot and round attribution; guarded general mutations and asynchronous reservation paths, with fixture regression coverage.
- AC-03: host MCP context adapter exactly0.154.0, missing/foreign/subagent refusal, clean detach, explicit H with epoch/generation CAS, stale-instance fencing, takeover and history. Metadata never comes from model arguments/environment/session scanning.
- AC-04: real Git worktree and SQLite tests, process lock contention/death, canonical paths and same/foreign-worktree copies, partial publication and nonce consistency. State is worktree-local; explicit external DB keeps its documented restrictions.
- AC-05: fixture execution survives reads and ownership transition; waiting_user and exact fixture worker session survive manager restart across two worktree contexts. These are synthetic adapter/server tests; separate real stdio launcher tests exercise native envelopes. This is NOT a two-live-model pilot or an end-to-end real Codex/Claude acceptance result.
- AC-06: docs/manager-identity.md, feature-workflow documentation, README and both role-skill mirrors describe identity/resume/adoption/limits. No diagnostics or installer added.
- AC-07: all repository suites above pass, with meaningful guard/race/failure regressions. Tests support the reviewed behavior; they are not a proof of every possible schedule, filesystem or historical DB variant.

The synthetic operator wrapper fix is coordinator commit117fd9f, separate from product executor commits; it only supplies an explicitly synthetic host envelope in a scripted tooling test. No operator fixture or production auth workaround was supplied to the executor. Runtime bridge-runtime-956b171 was neither edited nor rebuilt; no feature-workflow/wave9 merge/rebase/cherry-pick occurred.

## Limits and handoff

Guarantee is accidental mixup protection, not same-UID malicious authentication. Supported envelope is exactly Codex0.154.0. State requires working local POSIX advisory locking; network/FUSE mounts unverified. SQLite reads may create technical sidecars. Corrupt or contradictory records fail closed and may need operator inspection. Feature rows may lag completed task state after fencing, while read responses derive current state. Real-model pilot and release/deployment decisions are separate.

W7-ID-02 is done at implementation/local-review level. Final integrated package and coordinator checkpoint are recorded in execution/integration/04.md and PROGRESS.md. Await the user's acceptance or correction request; never call bridge_feature_accept or deploy/merge merely because this review passes.
