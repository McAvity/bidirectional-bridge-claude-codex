# Bridge 0.8.2 release

Status: PUBLISHED, 2026-11-10. Historical preparation notes follow the final checkpoint. User authorized the reusable
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

## Local candidate checks (before publication)

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

## Pinned source

Source a303b643983bf1ed1e896b1cbd252420ae30806b (runtime 0.8.2-a303b643983b).
Distribution metadata regenerated to that exact commit. Workflow bytes/registry unchanged.
Local full Python: 261 cases, 255 PASS and 6 sandbox-blocked failures/errors (three
loopback socket permissions, one Git worktree metadata write, two Codex setup process
visibility checks). These six will be rerun outside the sandbox; original failures
are preserved. Full exact-SHA Linux CI is required before publishing the tag.

## Published checkpoint

- Source `a303b643983bf1ed1e896b1cbd252420ae30806b`, runtime `0.8.2-a303b643983b`.
- Distribution `531d1db6b64c489adb61fe4234398c73bc07f43c`; immutable annotated tag
  `bridge-v0.8.2` resolves to that exact commit. Fast-forwarded `feature-workflow`
  and pushed it atomically with the tag. Documentation checkpoint follows separately.
- [GitHub experimental prerelease](https://github.com/McAvity/bidirectional-bridge-claude-codex/releases/tag/bridge-v0.8.2)
  published, not a draft. No npm publication. Workflow 1.0.0 unchanged.
- [Exact-distribution CI](https://github.com/McAvity/bidirectional-bridge-claude-codex/actions/runs/42799719049)
  SUCCESS: JS 782 PASS / 2 skipped; Python 256 PASS / 5 skipped;
  pilot tooling 129 PASS / 2 skipped; protected Linux observer 21 PASS;
  install/build/package equivalence/documentation checks PASS.
- All six locally sandbox-blocked Python cases passed outside the sandbox on the
  stable distribution (including real Codex startup and Claude HTTP-stub cases).
  Together with the original 255 passes, all 261 local cases are covered. No paid model.
- Fresh installation from the generated package selected the exact pinned source;
  standalone MCP in the project and inherited worktree returned 41 tools, correct
  caller/delegation and exact roots. Neither read created a runtime database.
- Final package digest `70eaed61d4f9`; workflow `1.0.0-34ff737662b4` unchanged.
  Independent review and focused/installed-updater checks are recorded above.
- Preserved the main checkout's existing project-pin edit (active 0.8.0), personal
  plugins and all active runtimes. Live bridge in this conversation remains misbound
  to a foreign workspace; no coordination writes were made there.

Publication is complete. Adoption: refresh the already-installed Bridge plugin,
invoke bridge-upgrade in the intended worktree, run the supplied installed-runtime
command after normal client exit, then resume and verify live MCP identity/workspace.
No open release blocker. Codex 0.167.0 remains version-unverified; the macOS observer
has explicit unsupported/incomplete-observation refusals, Linux remains conservative,
and no new real-agent model pilot or behavioral certification is claimed.
