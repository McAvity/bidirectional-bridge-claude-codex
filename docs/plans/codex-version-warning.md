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
