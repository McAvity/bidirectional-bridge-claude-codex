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

Source identity registered; changelog prepared. Local release checks and exact-distribution
CI are pending. Publication requires successful CI at the exact commit to be tagged.
Then publish an immutable annotated `workflow-v1.1.4` tag and experimental GitHub release,
fast-forwarding the integration branch without force. No npm registry publication.

## Adoption

Refresh the existing marketplace and update the `feature-workflow` plugin for new features.
Reload skills or restart the client if needed to load the updated plugin. A workflow-only
release does not require updating the Bridge engine or changing project runtime pins.
Existing feature locks retain their exact release; switch only explicitly between rounds.
The prior local 1.1.4 candidate has a different identity and remains valid for its existing
locks; do not overwrite its stored bytes or silently relabel it as this published bundle.
