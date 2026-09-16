# Dispatcher doctor correction

## Scope and cause

The project migration applied successfully, but doctor compared the dispatcher MCP
configuration with the legacy launcher definition. It reported CODEX_CONFIG_MODIFIED
and CODEX_CONFIG_MISMATCH, then tested the legacy launcher instead of the configured
entry. Fresh dispatcher projects also incorrectly required copied instructions.

Correction ff225e5 selects the diagnostic profile from the project integration,
checks runtime-provided instructions for dispatcher projects, and handshakes through
the actual dispatcher. Legacy setup remains supported.

## Evidence

Both fresh-setup and legacy-migration regressions failed before the correction.
The setup suite passes 12/12 afterward, including a broken dispatcher entry that
must fail the handshake. The installed corrected doctor reports status ok for the
migrated project; ACTIVE_SESSION is the expected warning while its client runs.
The migration is committed separately as 3c21218.

## Deployment

An immutable runtime built from ff225e550966806e2d39221eeaaa1428abc5307e is
installed alongside the selected 187fd3b runtime. The selection is not changed
while the current client is active. A dry-run plugin update has no conflicts;
its only refusal is ACTIVE_SESSION and its only changes are the project pin
and local runtime selection. Use the supported plugin update after normal client
shutdown, then doctor and commit the changed project declaration. No model calls
or database modifications were needed for this correction.

## Final validation

npm ci --ignore-scripts, build, all JavaScript tests, 46 exchange/Python tests,
140 pilot tests, generated packages and documentation links pass.
No model calls were made. Runtime activation remains a post-shutdown step.

## Publication CI follow-up

CI35130019847 on migrated project e721aa4 found one stale repository-configuration
assertion (537/538 tests passed): native-launcher.test.ts still expected legacy
Codex init output. The isolated doctor correction had passed before the repository
migration was combined with it. Update that assertion and explicit argv to the
dispatcher profile. Claude's unchanged configuration remains checked as before.
This is a test alignment with the committed migration, not wave15 implementation.
