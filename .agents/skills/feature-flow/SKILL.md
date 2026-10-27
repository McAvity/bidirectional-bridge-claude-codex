---
name: feature-flow
description: "Run or resume a whole feature-workflow lifecycle automatically, with human gates before execution and final acceptance. Use when the user asks for the continuous feature flow, not an isolated design, plan, review or implementation step."
---

# Feature Flow

Orchestrate the existing `feature-workflow` skills from the feature's actual stage through finalisation. An individual skill's closing suggestion is your next internal action, not a request for the user to copy another command. Continue until a human gate or a real unresolved question requires an answer.

## Authority and instruction source

The user's request to run this continuous flow delegates preparatory phases, routine technical decisions, bounded independent reviews and local commits for the named feature. It does **not** waive the two human gates below. Merely installing, discussing or testing this skill does not activate the flow for an existing feature. Preserve any narrower user scope and existing explicit authorisation.

Read [the shared workflow](../../../docs/features/README.md) and the target repository's AGENTS.md first. Use the instruction set from which this skill was selected. When entered through the `feature-workflow` marketplace plugin, its source preamble instructs you to run `scripts/select-source.mjs --json` from the target worktree; follow that selection for this flow and every underlying phase. Recheck that selection when resuming or if the project pin changes. A `source: none` refusal is a real blocker; report its code and next step without switching sources or moving the pin. If the selected runtime has no `feature-flow/SKILL.md`, report that it needs an upgrade; do not mix this plugin's new flow with an older runtime's phases.

When loaded directly from a repository, pinned runtime or its `bridge-claude` executor package (which has no source preamble/reader), use this skill's sibling `feature-*` directories and their shared guide. No personal skill or separate marketplace installation is required in that case. Do not assume that the directory holding this skill is the target worktree: resolve feature files and Git operations against the actual project. An explicitly requested standalone run follows the source reader's `--standalone` rules; it never silently bypasses a project's bridge pin.

Load each phase's actual skill when needed. This file defines routing, delegated decisions and pauses; the selected skills remain authoritative for their artefacts, checks, task lifecycle, reviews, bridge operations and recovery. Do not copy their procedures into a second workflow.

Use the conversation's language; when unavailable, use the brief's language. Invocation syntax alone is not a language preference. Respect the selected bridge manager/worker role: this skill does not turn a delegated worker into a coordinator or authorise a fallback to another runtime.

## Resume before advancing

Resolve the named feature and read its brief, index if present, latest applicable decisions/reviews, execution evidence and Git state. With bridge, read its durable feature/root/question state too. Inspect the versions actually reviewed; an index phase alone does not establish approval or completion.

**A pending human question takes precedence over the routing table.** Handle the latest message against that question first; do not re-run `feature-decide`, reconstruct an already shown gate or restart phases because the index still says `decision`. Record the user's opt-in to `feature-flow` in the ordinary decision history when one is created, and name the flow and its pending step in the canonical `next_action`. This preserves continuity without a second state store. Do not invent a missing earlier approval: repair only what current evidence establishes, or record the new real answer against its shown scope.

- Reuse current valid outputs. An agreed brief needs planning, not another design discussion; a current PASS needs a decision, not another review.
- Keep the same worktree, feature identity, owned root and pinned execution session where they exist. Follow the selected workflow's intent/replay/recovery rules; never create a replacement around an active or blocked operation.
- Distinguish an already satisfied human gate from an outstanding one. Prior explicit approval tied to the current reviewed scope remains valid; do not request it again.
- Before yielding, persist the exact next action and any pending question in the canonical artefact appropriate to that stage. Use existing decisions and index fields; do not introduce a separate flow state store or create an index before planning.
- A status question, silence, an expired wait or a tool result is not execution permission or acceptance. Answer status/help questions briefly while preserving the pending gate. Interpret plain replies against the actual pending question, without requiring a magic phrase or repeated skill invocation.

## Route the work

| Actual state | Next action |
| --- | --- |
| Goal or sufficiently agreed brief missing | `feature-design`; resolve routine details autonomously and ask only consequential questions. A brief is ready when the requested outcome/scope are settled; unresolved routine implementation choices do not block planning. Save a consequential open design question in the brief if no index exists yet. |
| Agreed brief without a current plan/tasks/index | `feature-plan`. |
| Current plan without independent review | `feature-review`, mode `plan`. |
| Plan review requires corrections within the agreed goal | `feature-decide` records delegated correction scope; `feature-plan` applies it, followed by focused review of material changes. Do not invoke `feature-execute` before the execution gate, even for planning corrections. |
| Current plan review PASS | `feature-decide`: prepare the proposed decision for the reviewed plan and whole remaining execution; then apply Gate 1. Reuse any existing approved plan decision, but keep the new execution scope explicitly proposed until authorised. |
| Execution authorised and work remains | `feature-execute` through tasks, contract checks, integration and independent local review. Continue ordinary corrections within that authority. |
| Implementation review requires in-scope corrections | Route findings to execution and focused independent re-review; keep their IDs and existing authorisation. |
| Entire authorised scope integrated and independently reviewed, no required findings remain | Apply Gate 2. |
| Real acceptance already given | `feature-decide` records it if not already recorded, then finish only the remaining finalisation below. |

A review PASS is evidence for an automatic next technical step. When recording a delegated technical decision, name the agent as decision-maker and cite the user's request for this flow as the authority. Do not fabricate a human answer or record execution approval before Gate 1. Each decision must clearly distinguish proposed scope from approved scope; do not label pending execution `approved`. Allocate records using the selected `feature-decide` convention. Record a new human answer in the next decision linked to its proposal; reuse an existing approved record only when it already records that answer. Preserve earlier decisions. Nonblocking notes can be adopted or declined with a short reason; do not turn them into extra requirements or user questions.

Required findings stay visible. Correct a plan without changing its goal, or an implementation to restore agreed behaviour, then re-review the affected scope. Do not add a fresh reviewer merely because a round ended. Keep reviewers independent of the work under review; an agent that authored the plan cannot provide its independent verdict. Use the selected workflow's budget, repeat-failure and step-back rules instead of an unbounded retry loop.

## Commit every completed step

After each completed design, plan, review, decision, execution/correction delivery or integration/finalisation step, commit that step's changes before advancing. This is a workflow-step boundary, not every tool call. Skip an empty diff; do not create empty commits or repeat an existing delivery commit. Include documents, reviews and applicable task/index updates, not only implementation. A technical PASS advances automatically after its commit; it does not imply execution permission or user acceptance.

Before the first changed step, inspect the repository's work items. Prefer an active general system-development/workflow task whose agreed scope covers these commits. Keep feature/task references in commit descriptions and evidence; use a dedicated implementation task when the repository's delivery contract requires it. Do not attribute changes to an unrelated, finished or otherwise ineligible task just because it is general.

If no suitable general task exists, propose one with a short description and scope, and obtain any repository-required confirmation/creation authority before creating it through the repository's task tool. Resolve any required existing-ID confirmation once and reuse the recorded choice while it remains applicable. Save the agreement in normal workflow records; do not invent confirmation or ask again before every commit. This one-time bookkeeping question is an allowed additional stop when needed. Never invent an ID, activate a task or edit task frontmatter merely to make the hook pass.

Commit only paths changed by this step and belonging to the authorised work; preserve unrelated files and staging. Follow repository commit conventions and selected bridge ownership/lease rules. Executor delivery commits count for their steps: never make a coordinator commit during an open executor round or broaden the worker's contracted scope. Settle the round, then commit coordinator-owned step outputs before advancing. A failed or unsafe checkpoint commit is a blocker to resolve, not permission to accumulate later phases or bypass hooks. Preserve the two human gates regardless of how many commits already exist.

## Gate 1 — before execution

Stop once before the first execution of the current reviewed scope unless the user's already recorded, specific approval satisfies this gate. Prepare the reviewable plan and proposal before asking. Never treat starting this meta-flow, accepting the design, or a technical PASS as this approval.

Before yielding, verify that the preparatory steps and execution proposal have their step commits, unless the user explicitly required an uncommitted snapshot. These commits are not execution approval. For such an explicit snapshot exception, identify its actual bytes and do not claim HEAD identifies them. Resolve required work-item selection before the first step commit as described above; do not defer all preparatory commits to this gate.

Give a short summary in the user's language, normally at most six lines:

- feature and intended result;
- agreed scope and only material exclusions;
- decisive validation and any real cost, risk or unresolved choice;
- one question authorising **the whole remaining scope**, including tasks, integration, independent local review, ordinary in-scope corrections and local commits.

If bridge already manages this feature, persist the question using its supported waiting operation. Otherwise use the proposed decision/index next action and ask in the user channel; do not create or launch a bridge execution feature merely to ask for permission. End the turn and wait for the real answer.

On approval, record the user's actual words through `feature-decide` and any existing bridge question, then execute without another permission request. The gate applies once per materially changed scope, not once per task, contract, correction or tool call. A materially expanded proposal returns through planning/review and a new Gate 1; routine implementation choices do not.

## Gate 2 — after execution, before acceptance

First complete the entire authorised scope, integrated checks, independent review and ordinary corrections. Do not stop at each task or return a partial delivery merely to obtain another approval.

Present a short handoff, normally at most six lines: delivered behaviour, actual checks and material limits, exact delivery/review reference, and a practical way to try it when relevant. Ask whether the user accepts this delivery. A current technical PASS is not acceptance. Persist the question through the selected workflow and wait, leaving the feature unaccepted so the user can test it.

- If the user asks how to test or requests status, answer and remain at this gate.
- If the user requests corrections within the agreed behaviour, record that scope, execute and re-review, then return to this gate. Do not repeat Gate 1 for already authorised corrections.
- If the user explicitly accepts, continue immediately with finalisation. Do not ask whether to write the decision, commit or close.
- An explicit rejection/cancellation follows the selected decision/closure procedure. A request for fixes is not cancellation.

## Finalise after the real acceptance

Use `feature-decide` to record the real acceptance source and exact accepted delivery, preserve prior reviews/evidence, and update the canonical index and genuine task statuses. Reuse an already recorded acceptance rather than writing a duplicate decision. If the user deliberately limited the run to part of a feature, acceptance closes only that delivery: preserve unfinished work and leave the whole feature unaccepted.

Commit **all remaining changes belonging to this feature**, including its decision, index, applicable task metadata and implementation, using the repository's conventions and explicit path lists. Preserve unrelated changes and staging; do not sweep them in or alter task status merely to satisfy a hook. Existing task delivery commits need not be rewritten. Commit at the point required by the underlying workflow; do not defer a required delivery commit until acceptance. Do not push, merge, deploy or publish unless separately authorised in the session.

Complete required writes and closing commits while their coordinator ownership/leases remain valid. For a complete accepted feature, follow the selected bridge guide to accept it, finish its owned root with references to the actual closing commits, and release owned leases in the required order. Confirm persisted completion. Do not terminate the root before the final commits it must report; an `accepted` index with unfinished bridge/Git work is still work to finish.

For an explicitly narrowed run, finish its scoped acceptance and commits, record in `next_action` that this run ended and the remaining scope needs a new explicit request, then stop without proposing the rest. Leave the bridge feature open and its coordinator root nonterminal in their actual supported states, release owned leases and preserve their IDs for resumption. Do not call feature accept/close or submit the feature root as terminal, invent an idle state, or leave an unanswered question about the already accepted delivery. Report the scoped completion and outstanding work clearly.

Finish with one short confirmation of closure, the decision/review reference and resulting commit(s). Do not ask for another acknowledgement or start the next feature automatically.

## Additional stops and continuity

Beyond the two gates, ask only for a consequential product/scope/budget choice outside delegated authority, unavailable required evidence/access, or a genuine impasse the selected workflow cannot resolve. Gather local evidence and make a concrete recommendation first; continue unaffected authorised work. Routine engineering choices, PASS, task completion and nonblocking comments are not stops.

After interruption or compaction, resume from durable evidence and the existing operation rather than repeating phases or human gates. Report blocked recovery/approval-review failures accurately; do not bypass them with a new session or key. This skill runs the workflow in the active conversation, not as a background scheduler. Do not claim it is continuing in the background after yielding for a human answer.
