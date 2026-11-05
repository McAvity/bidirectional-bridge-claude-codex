# F-W20 release0.7.0

Status: preparing,2026-11-05. User accepted F-W20 and requested publication for
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
