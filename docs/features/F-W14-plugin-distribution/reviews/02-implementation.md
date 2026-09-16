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
