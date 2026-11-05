# F-W20 release0.7.0

Status: published,2026-11-05. User accepted F-W20 and requested publication for
project evaluation. [Decision04](../features/F-W20-multi-repo-execution/decisions/04.md).
Accepted checkpoint acc9d39; acceptance commit be3613e; delivered09b88a32/code fd01ab36.

Integration in release/0.7.0 from feature-workflow5257ca6: merge8f05032, only HANDOFF
conflicted; combined F-W20 acceptance with all existing F-W19/activation history.
Product paths match accepted F-W20 exactly. Main runtime0.6.2 stays immutable.
F-W19 implementation remains separate. No model pilot, project migration or npm publish.

Bridge feature is accepted. Historical root verifications keep the recorded local
host failures (76 JS/2 Python). Its coordinator result is honestly PARTIAL/BLOCKED;
this does not reopen the accepted feature or justify another worker. Current evidence
rules cannot turn that root COMPLETE even if another host later passes the tests.
No database edits or erased verifications. Separate release task tracks publication.

Validation: full F-W20 checks and baseline comparison are in its integration ledger.
Release preparation will check installation/build, packages, docs, targeted regressions
and the complete GitHub CI on the exact public release revision. Publication waits
for CI. Local ACTIVE_USE_UNKNOWN remains an explicit host limitation, not PASS.

Next: source version commit, then release descriptor pinned to that existing commit;
generate packages, integrate feature-workflow, push to McAvity fork, check CI, annotated
v0.7.0 tag and experimental GitHub release. Preserve active project pins. Test adoption
later in a selected fresh project/worktree; compare checkout paths before/after and
verify writes stay in the intended parent/children. No paid pilot has been authorized here.

Prepared source: 6ed9a4537e376165aa72bbd5a52cb0c41988a90a. Release descriptor pins this immutable source;
tag follows descriptor packaging commit, as in earlier releases. Source and packages
share canonical digest155ee41b931f. npm ci/build/packages/docs passed. Dependency
audit reports15 inherited advisories (1low/5moderate/6high/3critical), lockfile
dependency contents unchanged; no claim of security certification or unrelated audit fix.


## Published checkpoint

- Source6ed9a4537e376165aa72bbd5a52cb0c41988a90a, runtime0.7.0-6ed9a4537e37.
- Distribution b77de568df494ce128e25a472c2633b7fd1c976e, annotated tagv0.7.0.
- [Experimental release](https://github.com/McAvity/bidirectional-bridge-claude-codex/releases/tag/v0.7.0).
- [Full CI42007132875](https://github.com/McAvity/bidirectional-bridge-claude-codex/actions/runs/42007132875)
  on the exact distribution SHA: SUCCESS. JS707 pass/1 skipped; Python196 tests,
  5 skipped; pilot tooling131 tests,2 skipped; protected process observer17 pass.
  Installation, build, package equality and documentation also pass. CI uses an
  isolated OS test user, so local R20-I01 failures are not reproduced there.
- Independent local release checks: Python162 focused/TS10 pass; source install
  in a separate temporary home succeeded. SDK MCP handshake36tools, caller codex,
  delegation allow, no manager claim/database/model. Installed helper, reference
  and executor copy match the exact pinned source bytes.
- Main feature-workflow fast-forwarded to b77de56 and pushed. No active runtime or
  personal marketplace cache was changed; this project's pin is still0.6.2.

The tag push may trigger a redundant CI run; the complete passing run above already
covers its exact SHA. The final documentation-only checkpoint does not change the
release source or tag. No tag is moved. F-W20 is accepted; its old coordinator root
keeps PARTIAL/BLOCKED solely for immutable host-failure evidence. Release completion
is tracked separately, not by erasing those failures.

## First project evaluation (not run)

Pick a fresh worktree in a project with existing separate Git dependencies, and a
small authorized feature touching two repositories. Close clients for that worktree,
use bridge-upgrade or the checkout's scripts/upgrade-local.sh to adopt0.7.0, then
start a fresh agent and invoke ordinary feature-execute with the feature ID.
Check the selected instruction/runtime version and repo map, real child checkout
paths/branches/base commits and dependency bindings. At delivery verify each repo's
commits and dirt, and check the shared source checkouts remain unchanged. No merge
or deployment is needed for this evaluation. Keep local logs/ledgers for diagnosis.
This is a recommended procedure, not a report of a completed model pilot or approval
for one. Independent workflow versioning remains F-W19, still unimplemented.
