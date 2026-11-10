# Execution design

Use the committed workflow lock and `execution.transport: hcom`. Preparation is
`npm run hcom:prepare` at the actual worktree root. It checks the committed pin,
lock and bundle, invokes the existing exact-commit runtime installer and exact
bundle restore, then resolves feature-execute. No pin/config/lock edits, version
choices, manager claims, workers or project-state copying occur in preparation.

One Claude executor owns the fixture/test/new ledger; the coordinator owns
contracts, feature index, task status, review and receipt. Follow the selected
hcom loop, using a fresh private namespace for this worktree and the supplied
verified Claude bundle. Subsequent invocation resumes existing state, never resets.
Round 2, if necessary, returns concrete findings to the same session. Do not
implement the correction locally if delegation fails; report the limitation.

The [trial procedure](../../tasks/hcom-repository-trial.md) defines file scope,
checks and the one-worker/two-round/20-minute limit. Ordinary client permission
prompts remain. No new engine/controller or public release is part of the trial.
