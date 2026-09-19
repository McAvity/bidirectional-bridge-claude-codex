# Codex version compatibility — 2026-09-19

User authorized 0.155.1 compatibility and replacing the version block with at most a warning.
Branch fix/codex-version-warning, base fb246e8, worktree wave15 only.
Active runtime ff225e5 is separate and unchanged. It refused bridge_create_task on
0.155.1 with native_adapter_unsupported before creating a task; local implementation
therefore continues with an independent read-only reviewer. No replacement bridge,
spoofed version, copied state or runtime bypass.

Scope: setup/doctor version policy, strict metadata adapter with unverified fallback,
visible warnings, deterministic regression tests, current docs and generated package.
0.154.0 remains historically verified; observed live 0.155.1 request passed metadata
shape/identifier checks up to the old version gate. This is not a guardian/model smoke.
Malformed/missing metadata, subagents, foreign sessions, fenced instances and schema
incompatibility retain their existing refusals.

Implementation and independent review in progress. Build PASS; full validation pending.
Next: finalize regressions, review, tests, commit and release delivery.

## Review and validation checkpoint

Code3d5891b, independent reviewer version_policy_review: core PASS, 26 identity tests PASS.
Coordinator identity protocol/native launcher29 PASS. Read-only reviewer found rollback
text warning omission (fixed), stale README policy (fixed), and pending release pin (next).
Build/packages/docs/diff PASS; Python46/pilot140 PASS; full JS running.
Version0.3.1 prepared for delivery; supervising runtime and project declaration unchanged.

## Full-suite fixture correction

First full run:571 PASS/1 FAIL. Successful update in the new warning check changed
the shared diagnostic fixture from runtimeA toB; its later repair step still expected A.
Test-only41962cc moves version cases into independent projects and checks repeat warnings.
No product change. Runtime pin moved to41962cc so the shipped source includes the corrected
regression. Focused setup and full-suite revalidation pending.
Actual installed Codex0.155.1: public plugin setup with default new pin/source override
in temporary project PASS, applied=true, preference present, entry status ready, warning
visible. No model was invoked and no host metadata/guardian certification is claimed.

## Publication checkpoint

Focused setup3 PASS after41962cc; independent review confirms isolation correction.
Code build PASS, install npm ci --ignore-scripts PASS, identity29 and reviewer26 PASS,
Python46/pilot140 PASS, packages/docs/diff PASS. First full run571/1 is retained honestly;
the sole failing scenario is now rechecked green, plus two isolated version cases.
Publish the fast-forward on feature-workflow under the continuing user authorization
for this setup delivery, then require the full CI result before tagging0.3.1.
No supervising runtime changes or target-project installation.

CI host updated from0.154.0 to0.155.1 so the publication gate exercises the user's
actual reported CLI release. The previous queued run is superseded by this commit.
Synthetic regressions retain coverage of the old verified and future versions.
