---
name: feature-review
description: "Independently review a feature plan, technical contracts, implementation or correction against its brief and evidence. Produces findings and recommendations without applying fixes or granting user approval."
---

Read [the shared workflow](../../../docs/features/README.md) first, then the relevant repository AGENTS.md and the selected feature files. Resolve all paths against the repository root; sibling skills ship together in `.agents/skills/`. Use the user’s language for summaries and preserve the repository’s document conventions. The workflow is task-local guidance, not authority to alter unrelated work.

# Feature Review

Choose the mode from the request: `plan`, `contracts`, `implementation`, or `corrections`. Prefer a separate session from execution; disclose if independence is limited. Read the actual source material before the executor's interpretations drive the verdict.

## Establish evidence

Read brief, design, selected tasks, relevant decisions/contracts, ledgers and code/tests needed for the mode. Establish exact input versions and code/snapshot scope. With a ZIP, read its manifest and state what was supplied. Request only missing context essential to the verdict; perform useful document review even when full code review is impossible. Do not claim repository-wide correctness from a partial archive.

## Mode-specific questions

- Plan: Does the proposed solution meet the user's goal? Are consequential assumptions evidenced or marked? Do task outcomes cover acceptance, expose true dependencies, avoid duplication and identify design gates? Is parallelism/integration feasible? Could a fresh competent executor complete each implementation task without inventing product decisions?
- Contracts: Are outputs sufficiently concrete for their consumers, compatible with the agreed goal, explicit about failure/uncertainty, and accompanied by representative examples? Are impacted tasks/design aligned? Judge only the requested contract scope, not an unimplemented feature.
- Implementation: Inspect actual Git changes and relevant current code, not only ledgers. Check observed behavior, acceptance, integration, regression risks, declared/undeclared deviations and evidence accuracy. Re-run focused checks when feasible and material. Distinguish retained claims from independently verified results.
- Experiment scope within plan/contracts/implementation: Apply the shared wave guidance. For a plan, check the comparison, controls, budget, stop rule, data separation and usable outputs. For execution, inspect actual configuration, data coverage, failures/exclusions, analysis and relevant harness/model code; assess effect size, uncertainty, selection bias and whether conclusions exceed the evidence. A valid negative or inconclusive result may PASS. State separately whether execution is sound, what the hypothesis result is and whether product acceptance is evidenced. Missing raw data/code limits the verdict; a report alone does not establish reproducibility.
- Corrections: Trace finding IDs through the decision, code/spec changes and new evidence. Close each material finding explicitly; check related regressions. Broaden review only for a concrete new risk.

## Bridge round packages

For a round executed through the bridge, the coordinator reviews and the executor's
`COMPLETE`, `PASS` claims and ledger are inputs, not findings. First run
`feature_exchange.py verify` on the round package with the expected feature, purpose, base and
head; a failing or stale package or an empty code range is a required finding. Check that the
round's commits and uncommitted changes stay in its write scope and leave coordinator records
untouched. Then review the repository itself: the `base..head` range, current files, and the
decisive checks rerun by you. Name the reviewed task id. For each required
finding carried from the previous review, state `resolved`, `progress` or `no progress`; the
coordinator uses this for the shared retry rule. Disclose that the reviewer is the
coordinating session, independent of the executor but not of the coordination.

## Output

Write the next `reviews/NN-<mode>.md`, preserving prior records. Start with executive summary (verdict, impact, decisions, next action). Record input references/hashes, inspected code range and limitations. Use `PASS`, `REWORK` or `BLOCKED`; missing essential evidence blocks a reliable verdict, while a demonstrated defect usually means rework.

Use stable finding IDs such as R03-01 with requirement, observation, precise evidence, impact, required/advisory classification and recommended resolution (code/spec/both/evidence). Include acceptance coverage where meaningful, using existing acceptance evidence instead of copying a second matrix. Tests passing is not proof all requirements are met. Do not manufacture stylistic or speculative blockers.

Do not edit code, contracts, brief, design or tasks to fix findings. You may write your review and update the index when acting as coordinator. A PASS is a reviewer recommendation, not a user decision. Route the result according to existing authority: a local PASS releases eligible downstream work; in-scope REWORK goes to `$feature-execute` and focused local re-review. Neither requires a new user decision. For BLOCKED, first obtain available missing evidence locally and continue unaffected authorized work. Use `$feature-decide` for actual unresolved choices or final acceptance, and `$feature-exchange` only at a genuine external handoff or explicit request. The integrated final review produces the external executive recommendation; it does not require external reviews of each completed task. Do not invent an external gate for extra certainty. If the user asked for review and fixes together, finish the review first and proceed only with already authorized corrections in the appropriate role; keep records separate.
