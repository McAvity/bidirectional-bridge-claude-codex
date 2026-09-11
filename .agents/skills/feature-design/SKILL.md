---
name: feature-design
description: "Define a feature with the user and write its brief for later repository planning. Use for shaping a new feature or revising its agreed behavior; skip when the user supplies an agreed brief."
---

Read [the shared workflow](../../../docs/features/README.md) first, then the relevant repository AGENTS.md and the selected feature files. Resolve all paths against the repository root; sibling skills ship together in `.agents/skills/`. Use the user’s language for summaries and preserve the repository’s document conventions. The workflow is task-local guidance, not authority to alter unrelated work.

# Feature Design

Discuss the intended user outcome, alternatives, tradeoffs, scope and observable acceptance. Resolve consequential choices with the user; propose reasonable defaults for routine details. Do not turn unknown repository internals into invented facts. Label assumptions and questions that the local planner must verify.

Create `docs/features/<feature-id>/brief.md` using the repository's existing ID convention, checking collisions. Preserve supplied examples, exclusions and uncertainty. Include goal, behavior, scope/non-goals, constraints, acceptance criteria with stable IDs, and important unresolved questions. A brief may point to existing canonical specs; identify intended changes to them. Do not create a separate intake ticket for an already coherent brief.

For a revised feature, read its current decision/history first, preserve IDs, describe the proposed semantic change and its impact. Keep accepted and proposed behavior distinct. Record the user's existing agreement faithfully; do not ask again for an agreement already given.

For experiment-led features, separate the desired product outcome from research questions and wave completion criteria. Permit negative or inconclusive findings; do not require a hypothesis to succeed just to complete a research task. Keep later technical choices conditional on evidence.

Do not create implementation tasks, choose unverified repository architecture, modify product code or proceed into implementation. Finish with the brief path, material open decisions and the next invocation: `$feature-plan` for this feature. Export through `$feature-exchange` when requested. A brief-only directory is valid; the planner creates the machine index later.
