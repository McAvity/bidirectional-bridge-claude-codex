# Wave13 + wave14 — coordinator delivery review

Date: 2026-09-16. Mode: implementation / integration boundary.
Reviewer: coordinating Codex session, independent of both implementers and their wave-local review sessions. No models or delegation used for this review.

## Verdict

**PASS for the local wave13 delivery and the explicitly independent wave14 scope.** No new demonstrated acceptance blocker found in this bounded review. This is a recommendation for user acceptance, not acceptance itself. The combined product is not yet integrated or validated; wave14 remains open for that work.

Inputs:
- wave13: `67957034a2a48b5d3d82a5fdef22e5e6e4f5d2fa..9cf1f4321f3686fcdf6f42a7e9a3265798385440`;
- wave14: `1cd1be7..e76a06626046be6798ecde3bd57348605079e731`;
- integration checkout at review start: `f80c0c7`.

Final handoff archives F-W13-final-implementation.zip and F-W14-local-delivery.zip independently passed the respective feature_exchange.py verify with expected feature, purpose, full base and head. These are whole-delivery coordinator packages, not substitutes for the existing per-round evidence. No missing/changed selected documents were reported.

## Reviewed risks and evidence

Wave13: inspected the scoped exporter, typed projection and default exclusions, safe path descent, snapshot/cutoff handling, logging authorization and the final regression evidence. Native session handles are digested; repository feature/task identifiers intentionally remain correlatable. The package is not anonymous, and the documented local inspection before sharing still applies. Retained findings R1-01–03 and R2-01–06 remain resolved within this review's scope; no evidence invalidating their final dispositions was found.

Wave14: inspected dispatcher refusal/preparation, authoritative pin and local selection, first-mutation hook placement after native authorization, plugin acquisition and distribution metadata. Retained findings R1-01–04 and R2-01–09 remain resolved within the independently delivered scope. Existing actual-runtime interruption/concurrency and TUI evidence is retained, not relabelled as a new pilot by this reviewer.

Independent checks:
- wave13 diagnostics/export and diagnostics logger suites: **38/38 PASS** (24 export + 14 logger).
- wave14 setup / dispatcher suites: **61/61 PASS** (52 dispatcher + 9 setup), including five interruption boundaries, concurrent ownership and rollback.
- wave14 packages:check: **PASS**, generated packages match canonical sources.
- archive verification: **PASS for both deliveries**.

Full suites reported by the wave coordinators (481/32/140 and 486/43/140) are retained evidence, not full-suite reruns by this reviewer. No real-model smoke, marketplace installation from the public network, publication, runtime replacement or product merge was performed here. Targeted tests use temporary fixtures and synthetic workers.

## Remaining integration work — not a request to reopen local reviews

A read-only git merge-tree preview found conflicts in docs/HANDOFF.md, docs/setup-layout.md, scripts/native-bridge-mcp.mjs, scripts/setup/doctor.mjs, shared/mcp-server-core/src/server.ts and tools.ts. Resolve semantically in a separate integration worktree. Preserve both first-mutation setup and per-call logging authorization; handshake, reads and foreign-manager refusal must not acquire write authority through either mechanism. Preserve executor plugin selection and logger lifecycle on shutdown.

The wave14 metadata contract was based on an earlier wave13 revision. Reconcile it against final 9cf1f43. The current wave13 exporter constructs a doctor subset and versions projection without wave14's distribution object, so merging doctor alone cannot deliver plugin/pin metadata in incident ZIPs. Add an explicit privacy-reviewed projection of that data, maintaining configured-versus-observed and unknown values. Do not import code from the diagnosed project's selected runtime to collect it.

After resolving the shared code, exercise a fresh inherited worktree through the dispatcher: handshake/read/foreign refusal unchanged, authorized setup and logging, then diagnose with the new metadata and original privacy protections. Run required combined regression checks, regenerate/check packages from common sources, and pin a runtime containing both waves. The existing wave14 pin 87cceed8 contains its independent implementation, not integrated wave13. Document publication/fetch availability separately; do not claim public installation from unpublished commits.

There is no justification here for another full audit of unchanged individual rounds. Next action is local delivery acceptance and one combined integration, followed by verification of the combined result. Wave15 remains DRAFT until that integration is settled.
