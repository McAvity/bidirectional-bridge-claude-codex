---
name: feature-plan
description: "Turn an agreed feature brief into a repository-grounded technical design and Yumi tasks for review. Use for initial planning or approved replanning, without product implementation."
---

> **Workflow selection — check first.** This is `feature-workflow:feature-plan` from the `feature-workflow` plugin.
> Before any phase work, from the target worktree root run
> `node "${CLAUDE_PLUGIN_ROOT}/scripts/workflow.mjs" resolve --feature <feature id or docs/features/<dir>> --entry feature-plan --json`;
> for a feature that has no directory yet (the start of design or flow) run `node "${CLAUDE_PLUGIN_ROOT}/scripts/workflow.mjs" resolve --new --json`.
> Append `--standalone` only when the user explicitly asked to work without the bridge. Follow its answer:
>
> - `source: bundle` (`BOUND_BUNDLE`) — follow `<instructions.workflow_skills>/feature-plan/SKILL.md`, the
>   guide `instructions.guide` and the helpers of that stored, verified workflow, even if it is this
>   file's own release; never mix two sets. With the bridge, pass `bundle.identity` as
>   `workflow_identity` to every `bridge_feature_run` and `bridge_resume_*` call. After a workflow
>   switch, or a `WORKFLOW_ACK_*` refusal, run `resolve` again and re-read the entry in this same
>   session before the next call; do not open a new session.
> - `SELECTION_REQUIRED` — a new feature: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/workflow.mjs" begin` (or `begin --feature-id <id>`), then
>   `resolve` again; after the design assigns the id run `node "${CLAUDE_PLUGIN_ROOT}/scripts/workflow.mjs" finalize --draft <token>
>   --feature-id <id>` and, with the bridge, `bridge_workflow_bind` after `bridge_feature_create`.
>   An existing feature without a lock needs the user's explicit choice: `adopt --explicit`
>   standalone, `bridge_workflow_bind_legacy` with the bridge. Never take the latest silently.
>   `begin --feature-id` answering `FEATURE_EXISTS` means exactly that case: run
>   `node "${CLAUDE_PLUGIN_ROOT}/scripts/workflow.mjs" resolve --feature <id>` and follow its answer.
> - `source: runtime` (`LEGACY_PINNED_RUNTIME`) — the project pins a runtime without workflow binding:
>   follow `<instructions.workflow_skills>/feature-plan/SKILL.md`, `instructions.guide` and
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

Read [the shared workflow](../../workflow/README.md) first, then the relevant repository AGENTS.md and the selected feature files. Resolve all paths against the repository root; sibling skills ship together in `${CLAUDE_PLUGIN_ROOT}/skills/`. Use the user’s language for summaries and preserve the repository’s document conventions. The workflow is task-local guidance, not authority to alter unrelated work.

# Feature Plan

## Load and reconcile

Resolve the supplied feature directory or brief. Accept `brief.md` or an explicitly named legacy brief without forcing design again. Inspect relevant code/tests, architecture, Git state and the real Yumi conventions: read local instructions and representative tasks and use the existing CLI only if available. Distinguish facts observed in code, inherited claims and open decisions.

Check existing work about this feature before allocating IDs. Reuse eligible work when compatible; if this is a restart, identify obsolete or conflicting plans/tasks and explain their treatment. Do not delete, close, reactivate or duplicate them merely because a new package omitted them. Follow user authorization for explicit retirement. Preserve original investigation records as context. No requirement to recreate old analysis when current repository inspection is sufficient.

## Produce reviewable planning

Write `design.md`: verified starting point and limits, smallest viable technical approach and rationale, shared interfaces, material decisions still proposed, delivery order and integration ownership. Keep it short enough to read; do not duplicate the brief or each task's acceptance list. Task dependencies are authoritative in tasks; any table in the design is a derived navigation aid.

Use Yumi task files in the existing location with its actual supported metadata/status lifecycle. If Yumi is absent, create equivalent Markdown tasks under the repo's existing work-items convention and state the fallback; do not install a new task system. Each task needs: feature/brief/design links, outcome, bounded scope/non-goals, true dependencies, starting components, acceptance and evidence, shared-file ownership and handoff, and stop conditions for material design changes. Map to stable brief acceptance IDs; add labels without changing semantics if the brief only has numbered criteria.

Separate architecture/contract decisions from routine implementation. When shared formats are unresolved, create a bounded design/contract task with its output location and review gate. Downstream tasks may be planned against that gate; don't pretend they are already executable. Do not demand a completed technical contract before allowing the task that creates it. Define representative fixtures and integrated acceptance, including real-data/operator gates only where the brief requires them.

For experiment-led work, follow the shared workflow’s wave guidance. Detail the next executable wave, identifying dependencies on earlier findings; retain later waves as conditional scope rather than inventing results or a complete implementation backlog. Each experiment task identifies its question, controls, metric, uncertainty method, data split, versions, budget, stop rule and evidence output. Values produced by a pilot may remain gated until that pilot is reviewed. Replanning consumes identified prior reports and decisions without duplicating completed tasks.

Describe feasible parallel lanes, shared file/migration ownership, integration owner/role and integrated checks. Do not launch subagents or worktrees merely to draft a plan. When the work spans several Git repositories (nested or external repositories, submodules, local packages), identify logical repo IDs, sources, version constraints or pins, read/write roles, dependency order and each repository's target branch, but no future local paths: `feature-execute` prepares the isolated checkouts at execution time ([multi-repo procedure](../feature-execute/references/multi-repo.md) § 1). A plain monorepo directory is not a separate repository. Use stronger review for hard contract/security/compatibility choices; do not hard-code model brands.

Create/update `feature.json` using the shared schema, registering exact task paths and deliberately selected context files. Set a truthful phase and next action. Record input brief hash and inspected code revision in `design.md`. Missing production access is a validation limitation, not permission to claim success or a reason to block unrelated planning.

## Checkpoint ownership

Distinguish local dependency/technical review gates from external user decisions. Propose execution of the entire remaining agreed feature scope after required choices are resolved, including integration, independent local review and in-scope corrections. Do not propose an external approval or ZIP after each task. Every proposed external gate needs a concrete unresolved choice, owner and reason existing authority cannot cover it. Contract creation may precede implementation without forcing an external handoff. Preserve explicitly narrow scope and conditional experiment waves, budgets and stop rules.

## Boundary and handoff

No product implementation. Resolve routine technical details from repository evidence; surface remaining product/architecture conflicts with a recommendation and the smallest necessary decision. A useful draft can retain explicitly blocked areas. Existing authorization for planning does not authorize the proposed architecture automatically.

Return a concise summary and paths, distinguishing ready work from design gates. Next: `$feature-review` mode plan (or external review through a ZIP), followed by `$feature-decide`. If requested, invoke `$feature-exchange` to package the draft without requiring an extra confirmation. Never pre-mark a decision as approved.
