# Bridge 0.8.2 release

Status: implementation and verification, 2026-11-10. User authorized the reusable
updater, bridge-upgrade skill update and new release. Branch/worktree release/0.8.2,
based on a0d5117. Preserve main checkout's separate project-pin edit and supervising
runtime. The live bridge MCP still points to a foreign worktree; no mutation there.

Scope: publish experimental bridge-v0.8.2; bridge engine/plugins 0.8.2, workflow 1.0.0
unchanged. Existing upgrade-local orchestration selects its own verified manifest
when installed, accepts --home and bounded --wait, prints actual refusals and retains
plan/backup/apply/receipt/doctor. Skill hands off the immutable installed path, never
/tmp or plugin cache. Includes previously reviewed macOS shared writer attribution.

User confirmed the prior private hotfix completed apply, status and standalone doctor;
subsequent live server_info and manager_status in that project passed with correct
caller, policy and workspace (unbound manager normal). This is user-reported live
acceptance, not a new model pilot or this conversation's MCP check.

Validation in progress: focused wait/orchestration 40 PASS with Node24/Python3.12.
An initial run using the host default Python and temp environment failed the existing
SQLite backup test; the prescribed isolated temp/Python3.12 rerun passed. Independent
review, installed-runtime integration and full exact-distribution CI follow. No check
that did not run is treated as passed. No release tag/source pin exists yet.

## Local candidate checks

- Build, package equivalence, 279-file documentation links and skill validator PASS.
- Final targeted wait/orchestration/process tests: 62 PASS / 1 Linux-only skip.
- Installed-runtime integration: all 3 cases PASS (legacy, dispatcher, inherited),
  including real waiting for an owned MCP process to close, explicit custom home,
  a source manifest newer than its embedded release pin, selection and standalone
  doctor; no model call. The filter excluded 27 other setup cases, not failures.
- Initial sandboxed integration refused process visibility as expected. First host
  integration found fractional spawnSync timeout; corrected with integer bounds and
  a real subprocess regression before the passing rerun.
- Independent native read-only review: no blockers; 40 focused tests independently
  passed before later timeout regression additions. Diagnostic-only timeout wording
  finding corrected with last refusal retained. Skill scenario uses only the immutable
  runtime path after plugin refresh. Full Python/CI remain in progress.
