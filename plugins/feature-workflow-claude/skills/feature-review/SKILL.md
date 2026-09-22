---
name: feature-review
description: "Independently review a feature plan, technical contracts, implementation or correction against its brief and evidence. Produces findings and recommendations without applying fixes or granting user approval."
---

> **Instruction source — check first.** This is `feature-workflow:feature-review` from the `feature-workflow`
> plugin. Before any phase work, from the target worktree root run
> `node "${CLAUDE_PLUGIN_ROOT}/scripts/select-source.mjs" --json` (append `--standalone` only when the user explicitly asked to work
> without the bridge) and follow its answer:
>
> - `source: plugin` — follow this file and this package's resources.
> - `source: runtime` — the project pins a bridge runtime: follow
>   `<instructions.workflow_skills>/feature-review/SKILL.md`, the guide `instructions.guide` and
>   the helper `instructions.exchange_helper` of that runtime instead of this file. Never mix
>   the two sets.
> - `source: none` (exit 3) — report `code` and `next_step` and stop. Do not install, set
>   up, move a pin or fall back to this copy.
>
> Put the answer's `record` line in the ledger of a significant execution or review. Inside a
> bridge round the round contract remains the authority.

Read [the shared workflow](../../workflow/README.md) first, then the relevant repository AGENTS.md and the selected feature files. Resolve all paths against the repository root; sibling skills ship together in `${CLAUDE_PLUGIN_ROOT}/skills/`. Use the user’s language for summaries and preserve the repository’s document conventions. The workflow is task-local guidance, not authority to alter unrelated work.

# Feature Review

Choose the mode from the request: `plan`, `contracts`, `implementation`, or `corrections`. Require independence from the executor for an independent verdict; disclose if independence is limited. A coordinating session that did not implement the change can provide it. Add another reviewer only for a named risk, missing expertise/evidence or an explicitly required independent gate; preserve existing delegation restrictions. Read the actual source material before the executor's interpretations drive the verdict.

## Establish evidence

Read brief, design, selected tasks, relevant decisions/contracts, ledgers and code/tests needed for the mode. Establish exact input versions and code/snapshot scope. With a ZIP, read its manifest and state what was supplied. Request only missing context essential to the verdict; perform useful document review even when full code review is impossible. Do not claim repository-wide correctness from a partial archive.

## Mode-specific questions

- Plan: Does the proposed solution meet the user's goal? Are consequential assumptions evidenced or marked? Do task outcomes cover acceptance, expose true dependencies, avoid duplication and identify design gates? Is parallelism/integration feasible? Could a fresh competent executor complete each implementation task without inventing product decisions?
- Contracts: Are outputs sufficiently concrete for their consumers, compatible with the agreed goal, explicit about failure/uncertainty, and accompanied by representative examples? Are impacted tasks/design aligned? Judge only the requested contract scope, not an unimplemented feature.
- Implementation: Inspect actual Git changes and relevant current code, not only ledgers. Check observed behavior, acceptance, integration, regression risks, declared/undeclared deviations and evidence accuracy. Re-run focused checks when feasible and material. Distinguish retained claims from independently verified results.
- Experiment scope within plan/contracts/implementation: Apply the shared wave guidance. For a plan, check the comparison, controls, budget, stop rule, data separation and usable outputs. For execution, inspect actual configuration, data coverage, failures/exclusions, analysis and relevant harness/model code; assess effect size, uncertainty, selection bias and whether conclusions exceed the evidence. A valid negative or inconclusive result may PASS. State separately whether execution is sound, what the hypothesis result is and whether product acceptance is evidenced. Missing raw data/code limits the verdict; a report alone does not establish reproducibility.
- Corrections: Trace open finding IDs through the governing authorization, code/spec changes and new evidence. Close each material finding explicitly; check related regressions. Retain closed findings unless a concrete change invalidates their evidence. Give new defects their own findings even when they resemble a previous issue. Broaden review only for a concrete new risk. Apply the shared step-back rule when the same problem recurs, including rounds that made progress.

## Bridge round deliveries

For a round executed through the bridge, the coordinator reviews and the executor's
`COMPLETE`, `PASS` claims, delivery line and ledger are inputs, not findings. First run the
receipt checks of [local-delivery.md](../feature-execute/references/local-delivery.md): contract
base, delivered head and ancestry, scope of the diff and of every commit, untouched coordinator
records, new ledger, worktree dirt (preexisting separate from unfinished executor work) and
evidence; a failed check is a required finding. When the contract required a package, also run
`feature_exchange.py verify` with the expected feature, purpose, base and head. Then review the
delivered `HEAD` itself: the `base..head` range, the files at that commit, and the decisive
checks rerun by you on it. Describe later integration drift separately and attribute it to
nobody by default. Name the reviewed task id and delivered SHA. For each required
finding carried from the previous review, state `resolved`, `progress` or `no progress`; the
coordinator uses this for the shared retry rule. Disclose that the reviewer is the
coordinating session, independent of the executor but not of the coordination.

## Output

For a new phase or materially different scope, write `reviews/NN-<mode>.md`. For corrections in the same phase, prefer a dated append-only entry in the existing review register, recording the reviewed revision/task, finding dispositions, checks and limitations without overwriting earlier verdicts. A further round alone does not require a new file. Start with executive summary (verdict, impact, decisions, next action). Record input references/hashes, inspected code range and limitations. Use `PASS`, `REWORK` or `BLOCKED`; missing essential evidence blocks a reliable verdict, while a demonstrated defect usually means rework.

Use stable finding IDs such as R03-01 with requirement, observation, precise evidence, impact, disposition (acceptance blocker, nonblocking note or separate out-of-scope task) and recommended resolution (code/spec/both/evidence). Only acceptance blockers are required corrections: tie them to a demonstrated requirement violation or essential missing evidence. Do not defer an unmet acceptance criterion without an authorized scope change. Include acceptance coverage where meaningful, using existing acceptance evidence instead of copying a second matrix. Tests passing is not proof all requirements are met. Do not manufacture stylistic or speculative blockers.

Do not edit code, contracts, brief, design or tasks to fix findings. You may write your review and update the index when acting as coordinator. A PASS is a reviewer recommendation, not a user decision. Route the result according to existing authority: a local PASS releases eligible downstream work; in-scope REWORK goes to `$feature-execute` and focused local re-review. Neither requires a new user decision. For BLOCKED, first obtain available missing evidence locally and continue unaffected authorized work. Use `$feature-decide` for actual unresolved choices or final acceptance, and `$feature-exchange` only at a genuine external handoff or explicit request. The integrated final review produces the external executive recommendation; it does not require external reviews of each completed task. Do not invent an external gate for extra certainty. If the user asked for review and fixes together, finish the review first and proceed only with already authorized corrections in the appropriate role; keep records separate.
