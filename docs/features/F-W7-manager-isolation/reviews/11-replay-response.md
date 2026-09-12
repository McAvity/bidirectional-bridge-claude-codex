# Review11 — W7-ID-02 final delivery: REWORK (narrow corrections)

Task task_<historical-5> DONE attempt3, executor df54bb25f92386f39d43b4e1122e2488ae3abe8f; base511d7de6fe388113e13558840ac747f1e7045834. Full independent package verify PASS, SHAcaec0d5bb885a4717564dd2d62b3a706b75c64eeeb915cfad009056b23c48497,31executor files, coordinator dirty snapshot truthfully recorded. Independent npm run build PASS; npm test381/381 across27files PASS; Python19/19 PASS; pilot tools110/110 PASS. No live-model pilot. Source/contract review by coordinator and bounded read-only identity_review Codex.

R10-01/02/04 resolved: async reservation marker repair, pure precheck vs adoption/migration, valid before/after structured evidence. R10-03 progress: C.database_path and owner DB comparison now prevent same-worktree copies; one nonce rule below still omitted. All preceding meaningful fixes preserved. DONE is delivery, not acceptance.

## Required final narrow corrections

R11-01: FeatureWorkflow.result() still calls mutating this.get()/refresh(). Both replay and post-worker response can therefore reconcile/events outside the guard. Replay after clean detach on a fresh eligible instance has pure authority precheck but no activation transaction; stale stored feature state gets written anyway. A result after long-running worker can likewise mutate after takeover. Build responses through pure view/derive; leave reconcile in guarded reservations or explicitly trusted worker completion paths. Test stale stored running feature with completed task, replay from fresh same-thread instance after detach: correct derived response but feature/event/activation unchanged, no new adapter start. Test response after takeover likewise does not perform request-side writes.

R11-02: assertProbeUsable compares reservation_nonce to C only when marker/owner.state==='bound'; a RESERVING record with a different nonce is silently accepted and repaired. Contract4.1/4.5 says contradictory A/B/C must be refused, not inferred as interrupted publication. Matching-nonce reserving is recoverable; mismatching-nonce reserving is contradictory. Reject either A or B mismatch before writes/repair. Test both states and each record separately; preserve valid crash-aftercommit same-nonce repair and absent-record reconstruction. Do not weaken the contract to make it pass.

## Checkpoint/route

Ordinary corrections within decision07; new round7 in SAME pinned Claude session because preceding task is now DONE, no recovery DONE. New execution/W7-ID-02/05.md. Narrow product scope feature-workflow.ts,workspace-state.ts and relevant tests; original accepted contract unchanged.75min/200turns, polling5min. Coordinator commits its previously retained checkpoint/operator-wrapper files separately now that no round is open. Next correction package purpose corrections-review, base that checkpoint, unique round-7.zip. Preserve all earlier archives. Independent review again; no runtime/wave9/merge/feature acceptance.
