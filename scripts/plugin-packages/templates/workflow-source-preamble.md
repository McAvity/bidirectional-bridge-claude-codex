> **Workflow selection — check first.** This is `{{ENTRY}}` from the `feature-workflow` plugin.
> Before any phase work, from the target worktree root run
> `{{HELPER}} resolve --feature <feature id or docs/features/<dir>> --entry {{SKILL}} --json`;
> for a feature that has no directory yet (the start of design or flow) run `{{HELPER}} resolve --new --json`.
> Append `--standalone` only when the user explicitly asked to work without the bridge. Follow its answer:
>
> - `source: bundle` (`BOUND_BUNDLE`) — follow `<instructions.workflow_skills>/{{SKILL}}/SKILL.md`, the
>   guide `instructions.guide` and the helpers of that stored, verified workflow, even if it is this
>   file's own release; never mix two sets. With the bridge, pass `bundle.identity` as
>   `workflow_identity` to every `bridge_feature_run` and `bridge_resume_*` call. After a workflow
>   switch, or a `WORKFLOW_ACK_*` refusal, run `resolve` again and re-read the entry in this same
>   session before the next call; do not open a new session.
> - `SELECTION_REQUIRED` — a new feature: run `{{HELPER}} begin` (or `begin --feature-id <id>`), then
>   `resolve` again; after the design assigns the id run `{{HELPER}} finalize --draft <token>
>   --feature-id <id>` and, with the bridge, `bridge_workflow_bind` after `bridge_feature_create`.
>   An existing feature without a lock needs the user's explicit choice: `adopt --explicit`
>   standalone, `bridge_workflow_bind_legacy` with the bridge. Never take the latest silently.
>   `begin --feature-id` answering `FEATURE_EXISTS` means exactly that case: run
>   `{{HELPER}} resolve --feature <id>` and follow its answer.
> - `source: runtime` (`LEGACY_PINNED_RUNTIME`) — the project pins a runtime without workflow binding:
>   follow `<instructions.workflow_skills>/{{SKILL}}/SKILL.md`, `instructions.guide` and
>   `instructions.exchange_helper` of that runtime, as before. If that runtime lacks this entry,
>   report that a runtime upgrade is needed.
> - `LEGACY_BIND_REQUIRED` — a feature from before workflow binding whose old set is proven by its
>   ledgers. With the bridge, the manager calls `bridge_workflow_bind_legacy` with the answer's
>   `bind_legacy` values (the bridge feature id and a new idempotency key), then runs `resolve`
>   again and continues the same phase under its gates with that old rule set; nothing else changes.
>   `LEGACY_AMBIGUOUS` / `LEGACY_UNPROVEN` need the user's explicit choice of one recorded or
>   installed runtime first (`explicit_choice: true`); `LEGACY_SOURCE_MISSING` needs that exact
>   runtime reinstalled. Never bind the latest workflow instead.
> - any other `source: none` (exit 3) — report `code` and `next_step` and stop. Do not install, set
>   up, move a pin, restore, start a new session or fall back to this copy.
>
> Put the answer's `record` line in the ledger of a significant execution or review. Inside a bridge
> round the round contract and its `Workflow binding` block remain the authority.{{PACKAGE_NOTE}}
