# Wave8 — repository migration

Status: source integration prepared; directory cutover and resumed-session checks pending.

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
