> **Instruction source — check first.** This is `{{ENTRY}}` from the `feature-workflow`
> plugin. Before any phase work, from the target worktree root run
> `{{READER}} --json` (append `--standalone` only when the user explicitly asked to work
> without the bridge) and follow its answer:
>
> - `source: plugin` — follow this file and this package's resources.
> - `source: runtime` — the project pins a bridge runtime: follow
>   `<instructions.workflow_skills>/{{SKILL}}/SKILL.md`, the guide `instructions.guide` and
>   the helper `instructions.exchange_helper` of that runtime instead of this file. Never mix
>   the two sets. If the selected runtime does not contain this entry, report that a runtime
>   upgrade is needed; do not fall back to the plugin copy.
> - `source: none` (exit 3) — report `code` and `next_step` and stop. Do not install, set
>   up, move a pin or fall back to this copy.
>
> Put the answer's `record` line in the ledger of a significant execution or review. Inside a
> bridge round the round contract remains the authority.{{PACKAGE_NOTE}}
