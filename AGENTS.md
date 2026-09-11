# Working on this fork

Start with docs/HANDOFF.md and docs/plans/wave7.md. The integration branch is
feature-workflow; main tracks the upstream baseline. Keep upstream history and MIT notices.

Sources: shared/*/src/ (bridge packages), scripts/native-bridge-mcp.mjs (MCP entry),
.agents/skills/ (feature workflow), .codex/skills/using-bridge and
.claude/skills/using-bridge (role-specific instructions), tools/pilot/ (operator test tools).
Read the relevant skill before running its workflow. Operator-only fixtures must not be
shown to pilot agents. Pilot tools are not the production installer or diagnostics product.

Use one branch/worktree per change, with a clear scope and a progress note. Herdr may
create worktrees outside this checkout. Resolve the actual workspace; never assume the
main checkout path. Git worktrees share Git metadata, not their working files.
Use one active manager/feature per worktree until multi-manager isolation is implemented.
Keep runtime databases, logs and exchange output separate. Never edit/rebuild the bridge
runtime currently supervising your own worker; use a separately pinned build.

Validation (Node 24, Python 3.11 tested):
- npm ci --ignore-scripts
- npm run build
- npm test
- python3 -m unittest discover -s tests -v
- python3 -m unittest discover -s tools/pilot/tests -v
CI and these tests use no paid model. Real pilots follow tools/pilot/rework/OPERATOR.md.
Do not claim a real-agent path passed from a scripted dry run.

Never commit runtime databases, transcripts, credentials, personal configuration or real
user answers. Synthetic fixtures must stand alone. Preserve unrelated changes and historical
evidence; no reset/clean to resolve drift. Review delivered commits separately from proposed
contract changes (docs/tasks/review-integration-drift.md is not yet implemented).
Update the handoff/progress when stopping: commits, validation, unresolved issues, next step.
