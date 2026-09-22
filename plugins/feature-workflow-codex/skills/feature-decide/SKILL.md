---
name: feature-decide
description: "Resolve feature review findings into an acceptance or an authorized correction scope, recording human decisions or explicitly delegated judgment. Use after review or when importing a user decision."
---

> **Instruction source — check first.** This is `feature-workflow:feature-decide` from the `feature-workflow`
> plugin. Before any phase work, from the target worktree root run
> `node "<package>/scripts/select-source.mjs" --json` (append `--standalone` only when the user explicitly asked to work
> without the bridge) and follow its answer:
>
> - `source: plugin` — follow this file and this package's resources.
> - `source: runtime` — the project pins a bridge runtime: follow
>   `<instructions.workflow_skills>/feature-decide/SKILL.md`, the guide `instructions.guide` and
>   the helper `instructions.exchange_helper` of that runtime instead of this file. Never mix
>   the two sets.
> - `source: none` (exit 3) — report `code` and `next_step` and stop. Do not install, set
>   up, move a pin or fall back to this copy.
>
> Put the answer's `record` line in the ledger of a significant execution or review. Inside a
> bridge round the round contract remains the authority.
> `<package>` is this plugin's directory, two levels above this SKILL.md; the skills list gives its absolute path.

Read [the shared workflow](../../workflow/README.md) first, then the relevant repository AGENTS.md and the selected feature files. Resolve all paths against the repository root; sibling skills ship together in `<package>/skills/`. Use the user’s language for summaries and preserve the repository’s document conventions. The workflow is task-local guidance, not authority to alter unrelated work.

# Feature Decide

Read the review and exact reviewed inputs, the brief, relevant ledgers, prior decisions and the user's instruction. Summarize the material choices in plain language. Determine whether the user has already approved a recommendation, delegated the decision, or only requested advice. Do not turn the last case into approval.

If a choice remains with the user, present the smallest concrete decision with a grounded recommendation; prepare any useful draft labelled proposed. If authorization already exists, record it and continue without a second permission request. The user's instruction can resolve different findings differently. Reject recommendations that merely lower requirements to fit already-written code without a justified change of goal/tradeoff.

Write the next `decisions/NN.md`. Include status `proposed` or `approved`, author/authority and source of agreement, review and input versions, dispositions by finding ID with rationale, and the exact permitted next scope. For acceptance, state what is accepted and any outstanding separately scoped work. For corrections, specify code/spec/both, affected criteria/tasks, dependencies and re-verification. Add new Yumi correction tasks only when needed; for a small fix, the decision can direct another execution of the existing task, observing Yumi reopening rules.

When a decision approves a future spec change, explicitly identify the old requirement and its authorized replacement. The executor then updates canonical documents. Do not describe pending edits as already applied. For a planning review that requires revisions, direct `$feature-plan` to perform them or `$feature-execute` for a bounded authorized document correction; require re-review only for material unresolved points.

For experiment-led work, separate acceptance of a completed wave from confirmation of its hypothesis and acceptance of the product feature. Record the evidence-backed disposition and next permitted scope: continue, simplify, bounded follow-up or stop. A valid negative result need not trigger rework. Do not promote a candidate or mark product criteria met merely because the experiment PASSed. Direct replanning when findings change the next wave; preserve prior evidence and any existing authorization for batches within the agreed limits.

When proposing execution authorization after planning or required contracts, default to the whole remaining agreed feature scope: tasks, integration, independent local technical review and corrections restoring agreed behavior. State boundaries, budgets and any genuine external gates. A narrower proposal needs a concrete reason; a task boundary, new ledger or desire for extra certainty is insufficient. Contract review may be a local dependency gate under existing authority. Restrict execution to a contract task only when a material unresolved decision or explicit user instruction requires that boundary.

Record only the scope actually authorized. Existing task-only decisions remain narrow until the user expands them; workflow installation does not grant that expansion. Local technical PASS and already authorized defect corrections do not need a new decision file. Use existing authorization in their review/ledger. Update `feature.json` to the real next action and latest applicable decision. Preserve all earlier ledgers and reviews.

For a bridge-managed feature, a question still pending with the user is recorded with
`bridge_feature_wait_user` and shown to the user; the user's reply is recorded with
`bridge_feature_answer_user`. Neither reaches or starts the executor. Cite the question id
and the recorded answer as the source of agreement; mark any simulated or test answer as
such. Record acceptance only from the user's acceptance or an explicitly delegated
acceptance; only then may the coordinator call `bridge_feature_accept`, which closes further
rounds. A reviewer `PASS` or executor `COMPLETE` alone never does.

No product implementation or silent closure of tasks in this role. Do not claim full acceptance where required real-data/operator evidence remains absent. If the user explicitly changes the acceptance scope, record that change and remaining consequences rather than implying the old criteria passed. Return the executive decision and the next exact skill invocation; export when requested.
