# Wave17 — local delivery ready for acceptance

W17-01–04 implemented by Claude through one bridge feature session and independently
reviewed by Codex coordinator: **technical PASS**, no open required findings.
User acceptance is pending; no acceptance, publication or deployment is inferred.

The repository now generates a separate `feature-workflow` plugin for Codex and Claude Code
in both existing marketplaces. Six entries work standalone or select pinned runtime
instructions. New runtimes pass both executor packages; old layouts remain compatible.
Wave16 local-delivery.md is packaged verbatim; old0.3.2 ZIP requirements are preserved.
Bridge-upgrade and setup stay in bridge packages. No production receipt helper was added.

Reviewed final executor delivery: `fcba1e2cd5c6a4fa566fd1db9b42848f33494a6a`.
Product checkpoints:08cefbe (packages),606d64b (delegation),d533651 (integration tests),
4ec57ca (host evidence),2115018 (docs). Contract correction340aefa resolved R02-01.
The final documentation correction is fcba1e2; coordinator review/checkpoint commits follow.
All delivery commits are already on this worktree's wave17 branch; no cherry-pick or merge
was needed, and no other worktree was changed. Original basefa08f1d.

Validation: npm ci/build; full JS590, Python100 (no skips), pilot-tooling140, probes37 and
packages:check PASS. Independent targeted JS15, Python50, probes37, package provenance,
Git ancestry/every-commit scope, generated trees and diff checks PASS. Full tests ran on
2115018; later changes are evidence/ledgers and the reviewed documentation-only correction.
Canonical documentation checker exits1 with two unchanged historical wave16 findings; no
new link/anchor/path error. [Evidence and AC map](evidence/W17-04-report.md),
[independent review](reviews/03-implementation.md), [progress](../../plans/wave17-progress.md).

Limits: model routing/compliance and real no-ZIP model execution are UNVERIFIED; all host
probes used zero inference. Codex qualified composer syntax and Git-marketplace refresh were
not observed; local marketplace discovery was tested. No extra model pilots. Supervising
runtime0.3.2-34ecb8d45465, project pin and release descriptor unchanged. No push, integration
merge, publication or deployment. The final optional-to-product ZIP is produced only because
this session's older pinned operational workflow requires it.

Resume: feature F-W17-workflow-plugin, manager root task_qkjep5yvm2. All four Claude rounds
are DONE; latest task task_vhnmy1vw1h was reviewed PASS. Ask user for acceptance (q-01), record
the actual reply with feature-decide and bridge_feature_answer_user; only an acceptance
permits bridge_feature_accept/root completion. A request for changes keeps the same feature
session and uses the next bounded round under the applicable authority. No new execution
approval is needed for in-scope corrections.
