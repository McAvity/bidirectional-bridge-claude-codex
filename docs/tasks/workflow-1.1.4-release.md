# Workflow 1.1.4 release

Publication authorized by the user on 2026-11-13 after the state/summary implementation.
Branch: `release/workflow-1.1.4`. Source:
`b9e98cf37541a6f8ea42cd6948d7bea94bb1c6b4`.
Workflow identity:
`sha256:d114f0c5414ceb885826ef6de43f82c2990cdbf52d0b54a4f2e5257cfa8c43ba`.

## Scope and evidence

Release combines [styled-terminal startup](hcom-placeholder-startup.md) and
[automatic state selection / readable summaries](hcom-state-summary.md).
Both client packages carry the same verified dual-client bundle. Bridge 0.8.2 package
bytes, installed plugins/bundles, project pins and existing feature locks stay unchanged.
F-W22 planning documents in this history do not authorize its execution.

Implementation review found no remaining blockers. Focused hcom tests passed 65/65;
package equivalence, skill validation and retrospective summary over a completed run
passed. The successful F-001 model trial used the earlier local 1.1.4 candidate's startup
fix, not the final state/summary instructions. Final summary measurements were verified
against that history; no new model was launched for this release.

## Publication progress

Published [workflow-v1.1.4](https://github.com/McAvity/bidirectional-bridge-claude-codex/releases/tag/workflow-v1.1.4)
at 2026-11-13T06:17:06Z as an experimental prerelease, not a draft.
Distribution/tag: `f17d4f8f3157195e403dac6eb966f0f093630296`.
Annotated tag and `feature-workflow` were pushed atomically without force; the registered
source identity and generated bundle were unchanged after verification. No npm publication,
client activation, feature switch or model launch was performed.

## Release validation

[CI 43375365163](https://github.com/McAvity/bidirectional-bridge-claude-codex/actions/runs/43375365163)
passed at exactly the tagged distribution SHA: JavaScript 782 PASS / 2 skipped across all
56 test files; Python 326 cases OK / 6 explicit host skips; pilot tooling 131 cases OK /
2 explicit PTY skips; protected observer 21 PASS. Install, build, package equivalence and
documentation checks also passed. Independent release audit verified all 60 bundle files
per client against the source commit, ancestry, unchanged Bridge bytes and publication scope.

Local Node 24 install/build, package equivalence and documentation (325 files) passed.
The focused hcom suite passed 65/65. Full local Python ran 326 cases with one host-setup
failure; that exact host test subsequently passed in isolation with diagnostic capture.
The local full JavaScript run was incomplete: 123 PASS / 17 failures across four reported
files, with process-inspection/doctor refusals and a Vitest `onTaskUpdate` RPC timeout.
Local pilot tooling ran 131 cases with one macOS open-file-observer failure and two skips.
These local aggregate runs are not reported as all-green; the exact-SHA Linux CI above
is the successful full regression run. The inherited upstream certification manifest
still rejects unlisted fork material, as already documented by the fork's release policy;
it was not rewritten or presented as current certification.

Raw host logs remain private. No product change was made to bypass process observation or
weaken a test. The release-specific implementation and regression evidence remain separate
from the broader local host-test limitations.

## Adoption

Refresh the existing marketplace and update the `feature-workflow` plugin for new features.
Reload skills or restart the client if needed to load the updated plugin. A workflow-only
release does not require updating the Bridge engine or changing project runtime pins.
Existing feature locks retain their exact release; switch only explicitly between rounds.
The prior local 1.1.4 candidate has a different identity and remains valid for its existing
locks; do not overwrite its stored bytes or silently relabel it as this published bundle.
