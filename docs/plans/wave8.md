# Wave8 — repository migration

Status: COMPLETE. Source integration, directory cutover and resumed-session checks completed.

1. Review pilot tools: complete at 66b6f99 (110 tests, scripted dry run).
2. Integrate source and shared agent instructions; publish after checking files/history.
3. Clone the published feature-workflow branch into a staging directory. Build/test there;
   no dependency on the old experiments workspace is allowed.
4. Record exact manager session ID locally. Stop processes using old/staging paths.
5. From an external terminal rename old bridge to bridge-archive and stage to bridge.
   Refuse occupied destinations. Keep all evidence and old Git history.
6. Repair archived linked worktree metadata after moving its main checkout. Register new
   Herdr worktrees against the new fork; never copy runtime DBs to fake a session resume.
7. Resume the recorded manager session explicitly in the new bridge directory. Read
   AGENTS.md and HANDOFF.md before acting on historical commands; verify root/remotes/SHA,
   MCP and runtime paths. Run final-path preflight. Record completion locally and in progress.

Layout: main checkout ~/workspace/bridge; archive ~/workspace/bridge-archive;
Herdr worktrees ~/.herdr/worktrees/bridge/<name>. Working files and bridge state are
separate per worktree; Git metadata is shared. Stable supervisor builds stay outside
edited worktrees. Full two-worktree runtime isolation remains a wave7 acceptance test.

Keep private transcripts, database/WAL files, user answers and machine-specific session IDs
local. Only sanitized findings and synthetic pilot sources go to GitHub. Do not move active
native worker sessions. Herdr detach is not process shutdown. A failed cutover must preserve
both directories; rollback after new work starts requires another state inventory.

Acceptance: published clone builds/tests and prepares its pilot without historical ZIPs,
vendors or absolute old paths; a new agent can continue from repository instructions;
archive is preserved and is no longer a development source. Missing real-agent tests
remain NOT_TESTED. Migration does not implement diagnostics/setup or change that verdict.

## Completion evidence

The published checkout at ea3a25e was moved to the final bridge path; the old workspace
is preserved as bridge-archive. Its linked pilot-tools worktree resolves correctly and
is clean after git worktree repair. Origin is the personal public fork, upstream is
preserved, and the original manager conversation resumed in the new checkout.

Before cutover: clean-clone build and 342 bridge / 19 exchange / 110 pilot tests passed.
GitHub CI: https://github.com/McAvity/bidirectional-bridge-claude-codex/actions/runs/34642279145
After cutover: a fresh temporary fixture passed all 14 preflight checks, including
32-tool MCP handshake, launcher configuration, Codex skill discovery, exchange tests
and the scripted correction dry run. Runtime paths point to the final checkout.
No real model task was launched. Temporary evidence remains local.

This validates the pilot launcher configuration, not automatic MCP setup for every
plain codex session. Normal startup/setup, pinned supervisor distribution and concurrent
Herdr worktree isolation remain wave7 work. REWORK with real models and review-quality
assessment remain pending. No private runtime state was imported or published.
