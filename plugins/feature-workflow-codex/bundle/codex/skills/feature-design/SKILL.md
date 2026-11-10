---
name: feature-design
description: "Define a feature with the user and write its brief for later repository planning. Use for shaping a new feature or revising its agreed behavior; skip when the user supplies an agreed brief."
---

> **Workflow selection — check first.** This is `feature-workflow:feature-design` from the `feature-workflow` plugin.
> Inside a delegated **hcom executor round**, use the supplied contract's exact workflow:
> verify `workflow_bundle` against `workflow_identity` with
> `node "<worker_root>/scripts/workflow.mjs" verify --bundle "<workflow_bundle>" --identity "<workflow_identity>" --json`,
> require `worker_root` to be that bundle's `claude` directory, then read its feature-execute
> entry and hcom executor reference. Do not select/adopt another workflow or coordinate.
> For coordinators and ordinary phase work, from the target worktree root run
> `node "<package>/scripts/workflow.mjs" resolve --feature <feature id or docs/features/<dir>> --entry feature-design --json`;
> for a feature that has no directory yet (the start of design or flow) run `node "<package>/scripts/workflow.mjs" resolve --new --json`.
> Append `--standalone` only when the user explicitly asked to work without the bridge. Follow its answer:
>
> - `source: bundle` (`BOUND_BUNDLE`) — follow `<instructions.workflow_skills>/feature-design/SKILL.md`, the
>   guide `instructions.guide` and the helpers of that stored, verified workflow, even if it is this
>   file's own release; never mix two sets. With the bridge, pass `bundle.identity` as
>   `workflow_identity` to every `bridge_feature_run` and `bridge_resume_*` call. After a workflow
>   switch, or a `WORKFLOW_ACK_*` refusal, run `resolve` again and re-read the entry in this same
>   session before the next call; do not open a new session.
> - `SELECTION_REQUIRED` — a new feature: run `node "<package>/scripts/workflow.mjs" begin` (or `begin --feature-id <id>`), then
>   `resolve` again; after the design assigns the id run `node "<package>/scripts/workflow.mjs" finalize --draft <token>
>   --feature-id <id>` and, with the bridge, `bridge_workflow_bind` after `bridge_feature_create`.
>   An existing feature without a lock needs the user's explicit choice: `adopt --explicit`
>   standalone, `bridge_workflow_bind_legacy` with the bridge. Never take the latest silently.
>   `begin --feature-id` answering `FEATURE_EXISTS` means exactly that case: run
>   `node "<package>/scripts/workflow.mjs" resolve --feature <id>` and follow its answer.
> - `source: runtime` (`LEGACY_PINNED_RUNTIME`) — the project pins a runtime without workflow binding:
>   follow `<instructions.workflow_skills>/feature-design/SKILL.md`, `instructions.guide` and
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
> round the round contract and its `Workflow binding` block remain the authority.
> `<package>` is this plugin's directory, two levels above this SKILL.md; the skills list gives its absolute path.

Read [the shared workflow](../../workflow/README.md) first, then the relevant repository AGENTS.md and the selected feature files. Resolve all paths against the repository root; sibling skills ship together in `<package>/skills/`. Use the user’s language for summaries and preserve the repository’s document conventions. The workflow is task-local guidance, not authority to alter unrelated work.

# Feature Design

Discuss the intended user outcome, alternatives, tradeoffs, scope and observable acceptance. Resolve consequential choices with the user; propose reasonable defaults for routine details. Do not turn unknown repository internals into invented facts. Label assumptions and questions that the local planner must verify.

Create `docs/features/<feature-id>/brief.md` using the repository's existing ID convention, checking collisions. Preserve supplied examples, exclusions and uncertainty. Include goal, behavior, scope/non-goals, constraints, acceptance criteria with stable IDs, and important unresolved questions. A brief may point to existing canonical specs; identify intended changes to them. Do not create a separate intake ticket for an already coherent brief.

For a revised feature, read its current decision/history first, preserve IDs, describe the proposed semantic change and its impact. Keep accepted and proposed behavior distinct. Record the user's existing agreement faithfully; do not ask again for an agreement already given.

For experiment-led features, separate the desired product outcome from research questions and wave completion criteria. Permit negative or inconclusive findings; do not require a hypothesis to succeed just to complete a research task. Keep later technical choices conditional on evidence.

Do not create implementation tasks, choose unverified repository architecture, modify product code or proceed into implementation. Finish with the brief path, material open decisions and the next invocation: `$feature-plan` for this feature. Export through `$feature-exchange` when requested. A brief-only directory is valid; the planner creates the machine index later.
