# Workflow 1.1.6: hcom recovery

User authorized implementation, publication and existing-project upgrade instructions.
Branch: `feat/hcom-lifecycle-recovery`, based on `164a202`.
This is a workflow release, not F-W22 execution or a Bridge runtime release.

## Behavior

`hcom_lifecycle.py resume|reconcile|cancel` preserves original receipts and session binding.
Blocked receipts gain a separate continuation after the prerequisite is verified. Commands
that may have applied are observed rather than blindly repeated. Prepared work proven not
sent is retired with evidence, and the next round has a new number/contract. Stop/resume
intents survive timeout, startup failures, intervening exits and process restarts.
Cancellation retains partial work and never means acceptance or automatic integration.

`hcom_upgrade.py` verifies/publishes an immutable bundle and journals the feature lock plus
private state migration. Interrupted migration replays only its exact snapshots. Pending
rounds/operations and historical identities remain intact. It does not start a model,
change the Bridge runtime or bypass an active Bridge workstream. The new state format v2
is deliberately rejected by older helpers. A live readiness snapshot is optional for
migration; it remains required for task dispatch.

Missing or ambiguous termination evidence still needs diagnosis. Absence alone does not
prove a normal stop, and no force-reset/accept-all path is added.

## Validation and review

Independent review found and resolved lifecycle edge cases; final review PASS with 39/39
independent lifecycle/migration cases and 5/5 final regression cases. Tests use scripted
hcom, no model. A disposable projection of the real blocked feature's state and lock
passed actual bundle migration, immutable blocked receipt preservation, resume and next
round preparation. Original project files remained unchanged; this is not a live-agent run.

Local build, package equivalence, doc links and final focused suites are checked before
publication. An early broad run overlapped final source edits and observed generated-package
drift; its Claude host probe also hit the sandbox socket restriction. These results are not
counted as passes; final stable-source checks and exact-commit CI supersede them. The generic
skill quick-validator requires unavailable PyYAML locally; repository entry/package checks
validate the actual distributed skill instead. Final publication evidence is recorded below.

## Upgrade an existing project without restarting its worker

Keep the current hcom worker and private namespace. Do not run Bridge Update for this fix.
For Claude's user-scoped entry plugin:

```sh
claude plugin marketplace update claude-codex-bridge
claude plugin update feature-workflow@claude-codex-bridge --scope user
```

Reload client skill discovery as supported by that client, or use a fresh coordinator.
The new plugin does not change an existing feature lock. The explicit migration below
does not require restarting the hcom worker or the coordinator.

An agent can obtain the exact published tools independently of client plugin discovery:

```sh
git clone --depth 1 --branch workflow-v1.1.6 \
  https://github.com/McAvity/bidirectional-bridge-claude-codex.git \
  "$HOME/.local/share/claude-codex-bridge/releases/workflow-v1.1.6"
```

If that path already exists, verify its tag/commit and clean state instead of overwriting
it. The packaged bundle is `plugins/feature-workflow-codex/bundle` inside that checkout;
no build is necessary. Verify it with the checkout's packaged `scripts/workflow.mjs verify`.
Then follow the bundled [recovery and upgrade procedure](../../.agents/skills/feature-execute/references/hcom-recovery.md):
derive the original state directory, read the actual lock generation, record the user's
upgrade authority, run the new bundle's `hcom_upgrade.py` plan and `--yes`, then re-resolve.
Use the returned immutable bundle for all further helpers and new contracts.

For the affected `f-003`, give its coordinator this instruction:

> Upgrade the existing f-003 hcom workflow to published workflow-v1.1.6 using the new
> verified bundle's hcom_upgrade.py (plan, then --yes). Preserve the current session,
> commits, original blocked receipt and private state. Reconcile any interrupted
> operation, verify the previously failing network prerequisite, then use
> hcom_lifecycle.py resume and continue the authorized work through hcom. Do not switch
> transport, rerun initialization, change the Bridge runtime, or resend uncertain work.

The exact CLI flags and evidence requirements are in the recovery reference. Routine
technical recovery under the existing execution authority needs no repeated user approval.
Commit the project lock/decision/ledger changes according to that project's rules; never
commit private state, transcripts or the hcom database.
