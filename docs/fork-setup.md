# Fork setup and current limits

Use Node 24 and Python 3.11 for the currently tested baseline. Clone the
`feature-workflow` branch, then run:

```sh
npm ci --ignore-scripts
npm run build
npm test
python3 -m unittest discover -s tests -v
```

For another project, a new worktree, or a worktree of this repository, follow
[setup.md](setup.md): install a pinned runtime of one commit, run `init` for the worktree and
start plain `codex` there. `init` installs `.agents/skills/`, `docs/features/README.md`, both
`using-bridge` skills and a managed MCP block, preserving existing local modifications; no
historical ZIP or patch is needed. The managed block keeps `tool_timeout_sec = 5400` for
rounds up to `deadline_ms = 4500000`; the client timeout never stops a running round. Keep the
runtime used by active workers pinned while developing changes in another worktree.
Authenticate the local Codex and Claude installations normally; no credentials belong in this
repository.

Read [the manager loop](../.agents/skills/feature-execute/references/bridge-loop.md)
and [feature session API](feature-workflow.md) before starting. Runtime databases,
transcripts and local exchange packages stay outside version control. Runtime state is
project-specific. In development, use one manager per worktree; concurrent managers
in a shared worktree are not certified.

Local verification of the imported extension baseline covers 342 bridge tests and
19 exchange tests. Earlier human-operated pilot evidence showed three rounds in one
Claude session, user waiting and restart, and final acceptance. It did not exercise a
REWORK correction round: the worker fixed the seeded issue in its first delivery.
Private pilot transcripts and machine-specific fixtures are intentionally not included.
The reviewed correction-pilot tools are in `tools/pilot/`; the real-model correction run remains pending. See `docs/HANDOFF.md` for current status.

No orphan-process supervisor, automatic wake-up of a closed manager or `/goal` is added.
Setup, updates and the doctor are described in [setup.md](setup.md); diagnostic exports are
planned next. Existing upstream certification manifests are historical and do not certify this
fork. CI does not launch paid agents or require provider credentials.
