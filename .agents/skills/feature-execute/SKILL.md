---
name: feature-execute
description: "Execute an authorized feature scope through tasks, integration, local review and corrections and maintain an evidence ledger. Use after planning/decision, including contract tasks; not for unsolicited redesign."
---

Read [the shared workflow](../../../docs/features/README.md) first, then the relevant repository AGENTS.md and the selected feature files. Resolve all paths against the repository root; sibling skills ship together in `.agents/skills/`. Use the user’s language for summaries and preserve the repository’s document conventions. The workflow is task-local guidance, not authority to alter unrelated work.

# Feature Execute

## Establish executable scope

Read the selected task(s), `feature.json`, brief, design, relevant contracts and governing decision. Respect the user's requested scope (one task, an accepted wave, integration, or corrections). Check dependencies and the actual Yumi lifecycle. A recorded user instruction already approving these inputs is sufficient; record it rather than asking again. If no approved scope exists, prepare the concrete blocker/decision needed and do not silently approve your own design.

Inspect Git state, protect unrelated changes, record input hashes and starting revision. If work is uncommitted or mixed, keep a precise changed-file/snapshot record; do not claim HEAD identifies those bytes. Create `execution/<TASK-ID>/<next-number>.md` and update it at meaningful checkpoints. A contract/design task can be authorized to produce proposed contracts even while downstream implementation remains gated. Record round-local write scope separately from authorization for the remaining feature; a technical dependency passing releases already authorized downstream work, but does not expand a task-only instruction.

When the user authorizes implementation of the feature, default to its entire remaining agreed scope, including integration, independent local review and corrections restoring agreed behavior. Preserve explicitly narrower authorization and experiment budgets. Approval of a plan alone is not an instruction to execute. Installing this workflow does not expand an earlier task-only decision.

## Execute and validate

Implement the bounded outcome, choosing ordinary local details autonomously. Make only the spec/contract changes the governing decision authorizes. Follow existing Git/Yumi commit practices and permissions; the workflow does not forbid authorized task commits or require new push/merge permission when already granted.

For an experiment task, execute the authorized protocol and budget, including any permitted adaptive batches, using the shared wave guidance. Record run/data identities, actual cost, failures, exclusions and deviations; keep exploration separate from confirmation. Preserve negative and inconclusive results. Producing a research report does not authorize promotion of a candidate, a larger budget or a new product claim. Store large raw outputs outside the feature directory and link reproducible evidence from its report and ledger.

Capture material problems, solutions, deviations, proposals, checks and limitations in the shared ledger format. Preserve original ledgers. Run relevant required checks and verify user-visible behavior where applicable; do not substitute fixture success for real integration or treat missing access/operator review as passed.

When a new product, contract or scope decision is needed, stop only affected work, record alternatives and a recommendation, and continue independently authorized work. Do not silently reinterpret the brief to match convenient implementation. Distinguish normal implementation choices from material deviations.

## Parallel work and integration

Only delegate when the user or applicable repo instructions authorize it. For an authorized wave, assign bounded tasks, separate worktrees, frozen input contracts and distinct ledgers. Check shared file/service/migration conflicts; coordinate merges using repository rules. Workers do not edit the shared feature index concurrently. The coordinator owns that update.

For integration, inspect what actually reached the integration branch, record task commit-to-integrated-commit mapping when rebased/cherry-picked, and verify the combined behavior. Write `execution/integration/<next-number>.md` when relevant. Passing isolated task checks alone does not complete the feature.

## Continue locally

A completed task or ledger is not an external approval gate. Continue ready tasks within the authorized scope, observing dependencies and required local contract checks. Route technical findings to local corrections and focused re-review; reference finding IDs and the existing authorization without creating a new user decision for every fix. Do not change product requirements to make a review pass.

The coordinator arranges local review independent of the executor using available, authorized sessions or agents; the coordinator may provide it when they did not implement the change. Do not claim executor self-review is independent. Before adding another reviewer, state the concrete value using the shared review guidance; completion of a round is not sufficient. If no independent reviewer is available, record the limitation and a local handoff, continue other eligible work, and do not turn this into a request for an external ZIP after every task. Context/session limits require a resumable ledger and next action, not renewed approval.

Apply the shared step-back rule to recurring problems even while corrections make progress; prefer a simpler in-scope approach when it preserves requirements. Check existing authorization and obtain available local evidence before escalating. Escalate early only for a concrete decision outside existing authority, an explicit external gate, or a genuine impasse under the shared retry rule. State the unresolved choice, evidence, recommendation and why it cannot be resolved locally. Continue unaffected authorized work. Never add an external review merely for extra certainty.

## Bridge mode

When the implementation runs as Claude Code rounds through the bridge MCP, the roles split:

- **Coordinator** (the manager holding `bridge_feature_*` tools): read
  [references/bridge-loop.md](references/bridge-loop.md) and follow it. You keep integration,
  the feature index, task statuses, independent review, decisions and the user channel.
  Rounds of one feature are one delegated workstream in one Claude session.
- **Bridge round executor** (Claude inside a round): the section below.

When coordinating a bridge round, follow using-bridge’s waiting policy: await delivery
without reviewing work-in-progress files. Review the delivered revision, not intermediate edits.

## Bridge round executor

Inside a round, this section replaces the rest of this skill: do not continue to other tasks,
set task statuses, update `feature.json`, arrange review or prepare external handoffs. The
round contract in the bridge prompt is your authority: its objective, write scope and
verification criteria, plus the governing decision it cites. Read the files it names. A new
round after a completed one is a new contract in the same conversation; keep earlier work
unless the contract changes it. A resumed task with a manager clarification continues the
same task. So does a task resumed after the bridge stopped the previous attempt at its
deadline: check what your earlier attempt already changed and committed, keep it, and continue
from there within the same contract instead of restarting the work.

Deliver through Git as [references/local-delivery.md](references/local-delivery.md) specifies:

1. Record the contract base and the worktree status at start in your ledger; paths already
   dirty are not yours. Do the bounded work and run the contract's checks on the final code.
2. Write a ledger in the directory the contract gives (`execution/<TASK-ID>/`), using the
   next free number; never edit an earlier ledger. A resumed attempt gets its own ledger.
3. Commit your in-scope changes locally, naming the paths when staging and committing
   (`git commit -m <message> -- <paths>`), only files in the write scope. The
   delivery is these commits; if the contract and governing decision do not authorize commits,
   stop and report that as the blocker. Never push or merge.
4. End with the bridge JSON. Line 1 of `summary` is the delivery line
   `DELIVERY=local-v1 BASE=<full sha> HEAD=<full sha> LEDGER=<path> OUTCOME=<COMPLETE|PARTIAL>
   WORKTREE=<clean|dirty:N>`, then the outcome; classify any uncommitted entry as the reference
   describes. Report every contract check in `verification_results`; the bridge records the
   round complete only when all of them pass and `blocker` is null.

Export no package unless the contract explicitly requires one. A contract that does (including
every contract issued under an earlier runtime) is followed literally: after the final commit run
`python3 .agents/skills/feature-exchange/scripts/feature_exchange.py export --feature <feature>
--purpose <purpose> --base <base> --name <file>.zip` with its values (`--name` resolves in this
worktree's exchange namespace; an explicit `--output` stays literal), then `... verify --archive
<path>`. Report `PACKAGE=<path> SHA256=<hash> PURPOSE=<purpose> RANGE=<base>..<head>
LEDGER=<path>` as line 2 after the delivery line, or as the summary prefix when an older contract
prescribes exactly that.

The coordinator owns `feature.json`, `reviews/`, `decisions/`, task statuses, review and
acceptance: leave them unchanged and do not review your own round as independent. Do not
delegate or call bridge tools. You cannot reach the user: when a product decision, missing
authority or out-of-scope change blocks the contract, stop the affected work and finish
`PARTIAL` with `blocker` stating the question, options, evidence and your recommendation.
If a manager clarification asks for changes outside the write scope or objective, do the
in-scope part and finish `PARTIAL` with the conflict as `blocker`. A non-null `blocker`
always makes the round blocked, and `OUTCOME=PARTIAL` always needs one: without a blocker the
bridge records the round DONE. For a `PARTIAL` round, write the ledger (outcome `blocked`),
commit completed in-scope work and report `OUTCOME=PARTIAL`; unfinished uncommitted work is
disclosed, never delivered. Export no package for it even when the contract requires one;
after the coordinator resumes the task, finish it and deliver (and export) then.

## Finish

Set the task state through actual Yumi conventions, retaining incomplete gates. Record the ending code revision/snapshot and validation target before returning. Update the index if you are the coordinator, pointing to the next review; do not mark the whole feature accepted.

For corrections, reference finding IDs and the governing authorization. Apply authorized changes to canonical specs/code, not only the correction record. Reuse this skill and ledger structure. After the whole authorized scope is integrated, obtain independent `$feature-review`; resolve in-scope required findings locally and re-review affected behavior within agreed limits. When ready for user acceptance or a material decision, prepare one short handoff: delivered and integrated commits, original ledgers, reviews, evidence, limitations and an executive recommendation. A recipient with access to the repository and those commits needs no ZIP; use `$feature-exchange` only for a recipient without that access or on explicit request. Do not mark the feature accepted on the user's behalf. If only one task was authorized, finish that scope and report its local next action without inventing an external review requirement.
