# Hcom state selection and execution summary

Authorized narrow follow-up to the successful F-001 trial, 2026-11-13.
Branch: `fix/hcom-state-summary`, based on `117ee13`.
This is not F-W22 execution or a workflow publication/client activation.

## Delivered behavior

- The coordinator derives its private directory using `hcom_state.py namespace
  --output path`; instructions no longer ask it to fill a guessed private path.
  Canonical worktree/feature hashing, default JSON output and existing init/reentry
  guards remain unchanged. Recorded explicit custom namespaces remain supported.
- `hcom_summary.py` reads bookkeeping and scoped hcom events/live list, emitting
  Markdown or JSON. It reports bound sessions, prepared rounds, observed start-to-ready
  and initialization-to-ready durations, round delivery/receipt durations, latest receipt,
  finish request and separately verified normal stop. User acceptance is not inferred.
- Stop confirmation requires the same native session/workspace, accepted receipt/hash,
  matching finish intent, subsequent normal-stop event and live absence. An intent alone,
  foreign/stale/abnormal stop, resumed/live worker or missing live evidence is insufficient.
- Missing or unreadable event history leaves measurements unknown with warnings; it
  does not substitute preparation time or prevent a partial state-based summary.
  Optional saved snapshots are explicitly historical, not current live status.
- Worker approval counts and coordinator permission issues are separate, unknown by
  default. Optional counts require an evidence reference and stay labeled as reported.
  Prompts, report bodies and native session IDs are excluded from summary output.
- Canonical instructions and both generated client packages include these mechanisms.

## Verification

- Final focused regression: `python3 -m unittest discover -s tests -p 'test_hcom*.py' -v`
  PASS, 65/65 tests, including 14 summary tests.
- Package source equivalence PASS with Node24; packaged helper CLI loads successfully.
- Skill validator and `git diff --check` PASS.
- Independent read-only review: no implementation blockers. Corrected its two residual
  notes: canonical macOS test-path expectation and null/non-string message fields.
- A later aggregate run caught Python importing its sibling into `__pycache__` inside
  the writable generated bundle, causing `BUNDLE_EXTRA_FILES` in the old trial-preparation
  guard. The summary now disables bytecode writes before that import. A regression
  test and running the packaged CLI before the package-equivalence check both PASS.
- Read-only retrospective check against the completed F-001 run reproduced 1 session,
  2 rounds, 447.728 seconds dispatch-to-receipt and the confirmed normal stop. Recorded
  start-to-ready 1.079 seconds is a different boundary from the earlier roughly 3-second
  launcher-to-ready observation; the helper labels that boundary explicitly.
  Without live-list evidence, the same saved history does not confirm the stop.
  Sandbox-denied hcom reads produced a partial summary; scoped read access then passed.

No paid model, new task dispatch, full repository suite, publication or installation was
performed. No private raw trial artifacts, transcripts or state were committed.

## Distribution / next step

Generated candidate remains workflow 1.1.4, now identity
`sha256:d114f0c5414ceb885826ef6de43f82c2990cdbf52d0b54a4f2e5257cfa8c43ba`.
This candidate is unpublished and uninstalled; the earlier installed 1.1.4 candidate and
existing feature locks were not replaced. Publish/activate through the normal workflow
release path when requested; never silently switch an existing feature's instructions.
F-W22 remains at its separate execution-approval gate.
