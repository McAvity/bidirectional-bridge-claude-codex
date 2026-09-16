# W14 review 02 — package/bootstrap implementation

## Executive summary
REWORK. Packages and probes are useful, but installation, pin enforcement, migration and external instruction paths do not yet meet the authorized workflow. Ordinary corrections remain authorized; no product question is needed.
Reviewed Claude task `task_a5b6kt56sk`, range `ecfb0c5e9761677d2344bf023b4b3b9c8dd98534..3c61427f02a2e7632275dd2c13c564089ee6ffa9`. Codex coordinator is independent of implementation, not coordination.
Archive F-W14-round-2.zip verified: SHA-256 `889cc5f6af43da315f207f0a4272a2bbae3b0cb04c071738395ef631c30d22b0`, 54 changes, no drift or scope breach. Executor changed_scope used globs for generated dirs; next report should list exact files.

## Independent checks
27 bootstrap JS tests pass at reviewed HEAD. Earlier independent 29 exchange and 140 pilot tests were run before this implementation and are not final-code validation. Worker reports final build, 461 JS,41 Python,140 pilot; its evidence page incorrectly says 488 JS in 34 files while ledger/structured result says461/33.
Reproductions used only synthetic /tmp repositories/processes, no model or personal configuration. No active runtime was changed. Actual reproducible failures below outweigh fixture PASS.

## Carried findings
W14-R1-01: progress — no full manager skill copies, but installed manager instructions still use target-relative exporter commands; 635 lines of generic dispatcher/bootstrap/facade/resolver code are copied into every project, contrary to section3.
W14-R1-02: progress — real host starts a dispatcher in external worktree, but test substitutes a recorder for native bridge, and clean-machine setup fails (R2-01).
W14-R1-03: progress — exclusive lock exists, but foreign binding and mutation/migration guards are absent (R2-03).
W14-R1-04: resolved for proposed data semantics (configured/observed and nullable divergence); working integration boundary is decision02, not an accepted diagnose implementation.

## Required findings

### W14-R2-01 — Installation and local preparation are incomplete
Requirement: goals1–3, AC-01/02/03, no manual runtime path/clone/init knowledge.
Evidence: installed thin skill invokes prepare without pin; clean repo returns NO_PIN. Skill tells user to install runtime manually from a bridge clone; package includes no runtime installation path or selected default release. prepare never creates install.json/current, and its own unit test expects needs-preparation immediately after preparation. Real doctor still resolves legacy selection; a newly enabled dispatcher project has none. New-worktree host test uses `_fake_runtime` with a recorder, not a real MCP handshake, state or exchange.
Correction: deliver complete reproducible installation from the generated distribution, initiated by the setup skill under the existing use request. Package must contain or reliably obtain a pinned source/runtime with verified identity; dependency install/build cannot be assumed to happen in marketplace. No manual runtime id/clone step. Reuse wave12 immutable installer guarantees; write actual local selection only after authorized use. Test isolated fresh home/project and two external worktrees against a real separately built runtime, with meaningful handshake/read and synthetic authorized calls, no model.

### W14-R2-02 — Instructions/exporter remain unusable outside this checkout
Requirement: section3 and AC-04/05.
Evidence: generator rewrites Python literal selected workflow path to `${CLAUDE_PLUGIN_ROOT}/workflow/README.md`. Running generated feature_exchange.py against a minimal foreign repo exits1: `Missing selected file: ${CLAUDE_PLUGIN_ROOT}/workflow/README.md`. Python does not expand this variable, and its safe local_path resolver only selects repository files. Manager entry loads unchanged canonical instructions, whose commands still name project-relative .agents/skills and guide. Rewriting links is not enough.
Correction: make canonical helper accept/resolve its installed resources deliberately while keeping target repo selection/safe archive naming; generator must not blindly transform code literals. Provide pinned manager instructions with operational absolute/package paths, correct all relative links, and preserve target overrides. Real export+verify in a clean target repo from both installed instruction paths is required. Generic helpers stay installed outside target code; replace copied ~635-line generic project implementation with minimal portable configuration/entrypoint pointing at installed code.

### W14-R2-03 — Pin, migration and foreign-state checks do not gate writes/launch
Requirement: sections2/4/5, AC-05/06/07; preserve native guard, no active switch, no custom clobber.
Evidence from `/tmp/w14-review-behavior.mjs`: status=pin-diverged but dispatcher plan route=runtime at the new declaration; status=foreign-record also route=runtime. prepare checks only copied install.root, not gitdir, DB binding, active manager/client or native request identity. It accepts a new --runtime even with current active state. Existing custom `[mcp_servers.bridge]` is preserved AND another same table appended (two tables); modified managed blocks/helpers are overwritten without owned-hash conflict checks. Invalid/disabled declarations are not robustly refused; runtime IDs/manifests are not validated against the authoritative commit/compatible set. Files are planned before taking the lock; revalidation does not recompute their contents.
Correction: simplify around existing wave12 identity/setup validation, not a competing partial setup. Validate id/commit/manifest and declaration before loading; refuse mismatch/copied state without mutation; use real binding/active-use protection before setup/migration, and do not offer an unguarded MCP mutation facade. Preserve modified managed/custom files via diff/conflict checks. Pin update/rollback must update the authoritative declaration and local selection consistently with active-session refusal; unchanged legacy commands alone cannot guarantee this. Test actual conflicting manager metadata and DB copies, unchanged bytes on refusal, different-pin concurrent setup, interrupted apply and malformed/symlink paths.

### W14-R2-04 — Dispatcher leaves runtime alive on shutdown
Requirement: wave12 active-session guarantees and transparent integration (AC-05/07); newly added process wrapper must preserve existing close/detach behavior.
Evidence: synthetic runtime spawned by dispatcher remains alive after SIGTERM to dispatcher (parent exit -15, child alive=true). Reproduction used own temporary process and terminated the surviving child afterwards. dispatch.mjs neither forwards signals nor handles spawn errors.
Correction: avoid extra process where possible, or explicitly forward/await clean signal/EOF shutdown and handle startup errors; test real MCP detach after client closure. This is not a request for general orphan supervision; it fixes the newly introduced wrapper.

### W14-R2-05 — Evidence overstates product coverage
Requirement: truthful AC evidence, required model-free validation.
Evidence: AC-02/03 marked met using missing-runtime recorder fixture; AC-05 divergence tested only in status, while actual launch ignores it; AC-06 mismatched workspace is treated as foreign-manager refusal without native metadata; AC-07 tests only legacy command regression and preserved neighbor text. No real native runtime in new worktree, no actual interrupted bootstrap, and interactive TUI is untested. tests/test_plugin_distribution.py mutates the real canonical skill temporarily; isolate that test in a fixture tree to avoid races/data-loss risk. Counts488 vs461 conflict.
Correction: retain old ledgers, correct the current evidence matrix; prove new behavior with actual installed distribution/runtime and model-free host startup. Add deterministic tests for the failures above, actual interruption/concurrency and cache/pin preservation. Test TUI startup without inference if it is a required path. Do not replace implementation gaps with a request for a paid pilot. Full required checks and package verification after fixes.

## Simplification and route
The remaining core failure is an incomplete parallel setup implementation. Prefer reuse of immutable installation, ownership/conflict/active checks and local selection already present in wave12, with a thin portable project entry plus installed helpers. A missing-runtime facade that only writes a declaration cannot install anything and adds an unguarded mutation surface; remove it if a thin skill-driven setup suffices. The existing authorization covers these architectural corrections.
Run one coherent correction round in the same Claude session. Final review should focus on these findings and AC gaps, not re-review unchanged probe research. Joint wave13 integration is deferred by decision02; all other independently authorized work continues.

## 2026-09-16 — correction review, task task_v62rz4kag7 (attempts 0/1)

**REWORK, with substantial progress.** Reviewed `f490b46e986b39ee30d5d2ede2630f564d14fcce`, runtime release `6b483b2e1a231d9db786b39f5032cbaee3d18caa`. Archive F-W14-round-3-resumed.zip verified independently: SHA-256 `b2b03c21540c1b4746c38376ccd082b395c6616e21a4de9c0ec8837b00a584aa`, base `11155278043753ac190b408b3d729d923ed83fc9`, 51 changes, no scope breach or drift. Initial attempt was BLOCKED by malformed reproduction evidence; strict same-task resume completed DONE. No duplicate delegation.

Dispositions: R2-01 **progress** (real installer/default pin and successful single-worktree first mutation; race/recovery below remain); R2-02 **resolved** (installed helper export and provenance-aware verify independently reproduced, no missing target guide); R2-03 **progress** (native authorization before materialisation, pin/foreign/custom guards and live update refusal; concurrent/recovery cases below remain); R2-04 **resolved** (same-process import, no wrapper child); R2-05 **progress** (real runtime tests and corrected counts, but AC-06 still overstates automatic concurrent/recovery coverage). R1-01 resolved; R1-02/03 progress; R1-04 unchanged resolved working semantics, joint diagnose deferred.

Executor reports build, 468 JS,43 Python,140 pilot (1 skipped), packages check. Independent review verifies package and installed-guide report semantics, runs default-pin local-source installation, and runs the following actual-runtime synthetic MCP probes. No models, personal profiles or active supervisor changes.

### W14-R2-06 — same-worktree concurrent first use cannot progress

At release commit `6b483b2e1a231d9db786b39f5032cbaee3d18caa`, start two committed entry processes in ONE pristine inherited worktree, complete initialize/tools-list on both (no writes), then send bridge_create_task with distinct valid synthetic native envelopes. Both return INTERNAL/ACTIVE_SESSION naming the other's state-open file. Neither produces install.json; both processes retain their database descriptors until terminated. Thus the native guard's serialized bootstrap and setup's process scan obstruct one another. Reproduction script `/tmp/w14-same-worktree-review.py`, evidence `/tmp/w14-race-review-6tywvno3/report.json` (operator-local synthetic paths only). Two DIFFERENT worktrees in the new suite do not cover this requirement.

Correction: keep the native ownership/critical-section boundary authoritative. Adapt the existing setup preparation narrowly for an authorized first mutation already under that guard; don't add a second facade/lock protocol or weaken ordinary update/rollback checks. Prove exactly one successful owner and foreign-manager refusal without writes from the loser, on the same worktree; verify retry/reads do not get stuck. Preserve malformed/subagent/copied-state refusals.

### W14-R2-07 — interrupted automatic preparation requires manual setup again

Same runtime, separate fresh inherited worktree. First authorized mutation with product fault injection `CLAUDE_CODEX_BRIDGE_TEST_CRASH_AFTER=1` exits -9 after selecting runtime, leaving its journal and native reservation. Restart without injection refuses before serving: SETUP_STATE_PARTIAL, no record, pending.json present. Evidence `/tmp/w14-race-review-6tywvno3/interruption-report.json`. Existing test recovers an explicit setup CLI call; it does not prove recovery of automatic first use.

Correction: distinguish provably same-worktree recoverable journal/native reservation from unexplained or copied partial state, using existing identity/recovery evidence. Permit pure startup/reads and recover only at the next authorized native mutation; no manual setup/restart loop, no automatic foreign adoption. Test interruption at meaningful write boundaries and copied/tampered pending state.

### W14-R2-08 — setup plan claims no writes after installing runtime

Default package pin, local source, fresh temporary home, setup WITHOUT --yes: exit0, applied=false, but runtime installed and home created. At `006bf13a7be2952764b30b438506701b46c2ac6a`, source runtime `f37207a7352b3277ac6d5f5a7c6051a80b00c6b1`. Evidence `/tmp/w14-plan-review-lxuwq7n3/result.json`. Entry skill says plan-only and CLI says nothing written. Make dry-run genuinely read-only (including source cache/runtime) and apply acquire/build only under --yes, with honest pre-install planning output. Preserve a reviewable migration diff when runtime is present. This is an ordinary correction, not a new permission gate.

### Step back and next route

At the third review of AC-03 we replaced per-worktree setup with the existing native mutation boundary. Keep that simpler direction; remaining defects are the boundary between that guard and wave12 selection/recovery, not grounds for another framework. Existing authorization covers these narrow fixes, tests, refreshed actual release pin and full validation. Next round in the same Claude session. Keep earlier ledgers; don't label concurrent/interrupted automatic preparation PASS until these reproductions pass. User-authorized wave13 deferral remains unchanged.

## 2026-09-16 — round4 review, task task_cv5d1hf7qs

**REWORK, narrow remaining corrections.** Task DONE at `219bfe64bdec0e6fe7aea0b5562b8326a4bdec51`; runtime pin `242330778de4c72f49ddb6b02a9f0e047c7ea2e6`. Independently verified archive F-W14-round-4.zip, SHA-256 `4b7cf11fefa256dab2c9b5c5474b6aebbf7053f0ee8120c894645cfb75be6dd1`, 15 changes, exact base `323360adcdf7efbd1cc7843ac49a20aff5c41604`, clean scope. Executor: build,475 JS,43 Python,140 pilot (1 skipped), package gate PASS.

R2-06 **resolved**: exact reviewer script repeated against actual default pin now gives one successful PENDING task and one MANAGER_FOREIGN_THREAD, handshake creates no state, single record and no pending journal. Evidence `/tmp/w14-race-review-vlenqw8p/report.json`. R2-08 **resolved**: default-pin dry-run leaves project AND runtime home untouched (`/tmp/w14-dry-review-fixed-koot_ykn/result.json`). R2-07 **progress**: recovery after selection write works; two remaining boundaries below. R2-01/03/05 remain progress pending these boundaries and rollback; R2-02/04 stay resolved. No unchanged probe research was re-reviewed.

### R2-07, remaining actual interruption boundaries

1. SIGKILL just before the first `.bridge-runtime` mkdir, after native reservation exists: no local selection directory, own `.bridge/workspace.json` remains. Restart refuses SETUP_STATE_PARTIAL because the launch gate requires a setup journal. Actual native runtime2423307, one-shot Node fs preload `/tmp/w14-crash-before-selection.mjs` kills only this test process. Evidence `/tmp/w14-race-review-vlenqw8p/pre-selection-review.json`. This is exactly the gap between existing native recovery and setup recovery; do not require manual init for an explained own reservation.
2. Product fault injection AFTER=2 (record write): restart plus authorized mutation succeeds but pending.json remains forever because decide returns resuming=false for a valid record and materialiseSelection immediately returns on any valid record. AFTER=1 now recovers correctly. Exact script `/tmp/w14-interruption-review.py`, evidence `/tmp/w14-race-review-vlenqw8p/interruption-review.json`.

Use the existing read-only native state probe and ownership/reservation validation as the authority for explained same-worktree recovery. Do not add another recovery protocol or adopt arbitrary partial/copied state. Register completion for an own pending journal even when the record already exists; complete only after authorization. Test before local journal, after selection, after record, plus foreign/tampered state and refusal bytes. Refresh actual runtime pin after code is committed.

### W14-R2-09 — documented default rollback selects the current runtime

Actual isolated project updated successfully from6b483b2 to2423307. `bridge-plugin.mjs rollback --yes --json` then returns ROLLBACK_SAME_RUNTIME, pointing at2423307 instead of its previous6b483b2. Evidence `/tmp/w14-race-review-6tywvno3/rollback-review.json`. targetRuntimeId treats rollback like setup; the wave12 CLI already has history-based rollbackTarget. Reuse/extract that resolver for the plugin, preserving explicit --to and active/compatibility guards. Prove default rollback after update restores declaration+selection, no DB restoration, and no-history/active refusal; document the actual supported command.

### Additional independent host evidence

A plain interactive Codex0.154.0 TUI in an isolated profile, trusted pristine inherited worktree, custom provider at closed localhost port (no model task), and installed repository marketplace plugin shows `/mcp`: **bridge connected (35 tools)**, `/skills`: **bridge (bridge-codex)**. Exit0, no `.bridge-runtime` or `.bridge` created; no model session events. Runtime6b483b2; this verifies normal startup and instruction discovery, not a real agent delegation or updated recovery. Evidence `/tmp/w14-race-review-6tywvno3/tui-review.json`. TUI startup is no longer wholly untested; keep its exact revision and limits.

Executor ledger03 discloses one manual reproduction accidentally used the operator runtime home and then removed only its newly created test runtime; the supervising runtime was not changed. Future reproduction commands must assert an explicit temporary runtime home before every mutating call. This is an isolation correction, not permission to inspect or clean unrelated runtimes.

Next: one narrow same-session correction for R2-07 boundaries and R2-09, then final validation/review. No publication request: user explicitly authorized local delivery only. Wave13 integration remains deferred by decision02; no new product decision.

## 2026-09-16 — round5 review, task task_vywn202z73

**REWORK for one remaining R2-07 boundary; other required corrections resolved.** Reviewed `cadecb6e76c3a519b65ba51e064f02fee296c6ee`, runtime `ba4025b1425d4a2c4fa71f5725b415f13069c760`. Archive F-W14-round-5.zip independently verified, SHA-256 `6174a633f8a73c3efe0157236178d77d7b82ff2ebbe8fee1c511142d78906bb4`, 17 changes, no drift/scope breach. Worker full checks:482 JS,43 Python,140 pilot (1 skipped), build/generation PASS.

R2-09 **resolved**: exact previous update/rollback fixture now restores6b483b2 from2423307 with default rollback and no --to. R2-06 **resolved**, rechecked onba4025b: one successful owner, one MANAGER_FOREIGN_THREAD, pure handshakes, no pending journal. R2-08 remains resolved. R2-07 **progress**: independent injected kills before mkdir, after selection and after record all recover and clear the journal. Evidence under `/tmp/w14-race-review-mc4glks3/` (report.json, interruption-review.json, before-journal-review.json); rollback-fixed-review.json is in the earlier6tywvno3 fixture. Source acquisition through the fetch branch also passed with an independent local bare Git source and exactba4025b hash (`/tmp/w14-source-fetch-review-3NPO9O/result.json`); public network reachability remains untested/unpublished.

**The remaining gap is AFTER mkdir but BEFORE the journal.** The same actual-runtime fault probe now kills immediately AFTER `.bridge-runtime` mkdir returns, with an own native reservation and an empty real local directory. Restart still refuses SETUP_STATE_PARTIAL. `dispatch.decide` defines reserved as `!existsSync(local.dir) && native.kind === own`; mere directory existence discards the same valid native recovery evidence. Reproduction `/tmp/w14-before-journal-review.py`, after=false PASS versus after=true FAIL, exact runtimeba4025b. This is the already-required pre-journal recovery boundary, not a new feature.

Step back at the third check of this recovery finding: keep ONE authority rule — explained own native reservation plus no conflicting local metadata may recover through the existing guarded plan regardless of whether mkdir happened. Do not add another special-case recovery protocol. Own native evidence must not waive foreign/invalid journal, pin/record, symlink, ownership or native identity checks. Preserve unknown files; do not adopt unexplained state. Prove before mkdir, after mkdir, before journal publication, after selection and after record; pure reads and foreign/subagent refusals remain unchanged. One focused correction, actual pin refresh, full checks, then final handoff. Existing scope/authority sufficient.
