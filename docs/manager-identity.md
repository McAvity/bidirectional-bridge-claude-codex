# Manager identity and worktree isolation

This is the runtime behaviour implemented from
[`contracts/identity.md`](features/F-W7-manager-isolation/contracts/identity.md) revision 6. It
protects against **accidentally mixing correctly functioning local sessions**. It is not
authentication: a process running as the same user that forges host metadata, edits the launcher
or speaks JSON-RPC directly is out of scope.

## What identifies what

| Thing | Identity |
| --- | --- |
| Project | canonical `git rev-parse --git-common-dir` |
| Worktree | canonical worktree root plus its per-worktree git dir — never the branch |
| Database | the worktree recorded in its `.owner` file and in its `workspace_binding` row |
| Manager | the **native Codex thread** of the call that first took ownership, plus an `epoch` |
| Connection | the MCP process instance, plus an `instance_generation` |

The `--caller` role (`codex`/`claude`) keeps its existing meaning — adapter selection, task
ownership, leases, lineage and recovery authorisation. Manager identity is separate: it says
*which session* may currently drive this worktree.

## Where identity comes from

From the per-request MCP metadata the Codex host attaches to a tool call: `params._meta.threadId`
plus the `x-codex-turn-metadata` object. Tool arguments, environment variables, cwd and rollout
files are never read and never used as a fallback. A call is refused before it can write when the
metadata is missing, malformed, inconsistent or belongs to a subagent. Host version is
compatibility information, not identity proof: an unverified version (including `0.155.1`)
uses the same strict turn-metadata adapter and successful guarded calls return a
`warnings` entry with code `CODEX_VERSION_UNVERIFIED`. Version must still be present and
well-formed; no identity source or ownership check is bypassed.

## Lifecycle

- **Start and reads claim nothing.** Starting the server creates no `.bridge/`, no database, no
  marker and no lock, and reads open the database read-only. `bridge_manager_status` reports an
  unbound worktree instead of creating one. SQLite may still create its own `-wal`/`-shm`
  sidecars beside an existing database; those are technical files, not state or ownership.
- **The first authorized operation takes ownership.** It reserves the worktree state under a
  crash-safe lock, creates the database, and binds the calling thread — all in one step. If that
  operation fails, nothing is bound and the reservation is released.
- **Later calls must match.** A different native thread is refused (`MANAGER_FOREIGN_THREAD`).
  A different connection of the same thread is refused (`MANAGER_INSTANCE_FENCED`) until it
  resumes explicitly.
- **Restart.** After a clean shutdown a fresh connection of the same thread simply continues.
  After a crash, call `bridge_manager_resume_instance` with the current `expected_epoch` and
  `expected_generation` from `bridge_manager_status`. There are no tokens to store.
- **Detach.** A clean shutdown ends the active connection and bumps the generation, so a handoff
  expectation captured before the shutdown no longer applies; the transition is recorded once.
- **Takeover.** `bridge_manager_takeover` moves ownership to a different session. It needs the
  previous thread id, the current epoch and a reason, and it is recorded in history. A running
  round is never cancelled; the previous session is fenced and can only return through another
  explicit takeover. Reads are never fenced.

## When the bridge refuses

| Code / reason | Meaning and remedy |
| --- | --- |
| `NATIVE_CONTEXT_INVALID` | The call carried no usable native context. Use a native Codex session with valid metadata; do not pass ids as arguments. |
| `MANAGER_FOREIGN_THREAD` | Another session owns this worktree. Continue in that session, or take over explicitly on the user's instruction. |
| `MANAGER_INSTANCE_FENCED` | Your session owns the worktree but this connection is not the active one. Resume the instance explicitly. |
| `MANAGER_FENCED` | Your session was superseded by a takeover. Only another explicit takeover returns authority. |
| `copied_state` / `database_bound_elsewhere` / `database_owned_elsewhere` | `.bridge/` or the database belongs to a different worktree. Never copy `.bridge/`; give each worktree its own database. |
| `second_database` | This worktree already records a different database. Use the recorded one. |
| `unresolved_workspace_state` | Something in `.bridge/` cannot be explained. The bridge never guesses: inspect it manually. |
| `unbound_legacy_state` | A pre-isolation database with history. Adopt it deliberately, or point the worktree at its own database. |
| `STATE_LOCKED` | Another bridge operation holds this worktree's critical section. Retry. |

## Legacy databases

A pre-isolation database that still has history is refused (`unbound_legacy_state`). Adopting it
is a deliberate one-off operation, not a side effect of starting:

```sh
node scripts/native-bridge-mcp.mjs --caller codex --delegation allow \
  --workspace <worktree-root> --adopt-legacy-state --adopt-reason "<why this state is ours>"
```

Both flags are required together, the reason is 1–500 characters, and the adoption is recorded
with provenance in the binding row and a `workspace.adopted` event, which `bridge_manager_status`
reports afterwards.

## Features

A worktree holds one active feature at a time. Creating a second one while another is active is
refused with `FEATURE_CONFLICT`; accepting a feature frees the slot. Each feature records the
worktree and the manager epoch that created it, and every launched round is attributed to the
native thread and epoch that launched it.

## Exchange artifacts

Packages, retained returns and staging directories live in the worktree's deterministic exchange
namespace `~/tmp/bridge-exchange/ws_<first 16 hex of SHA-256(root + NUL + git dir)>/`, split into
`packages/`, `incoming/` and `staging/`. It uses the same identity as the worktree state, so two
worktrees never overwrite each other's artifacts even when they reuse a file name; resolving it is
read-only and grants nothing. `feature_exchange.py namespace` prints the paths, `--name` and
`--stage-name` use them, and an explicit `--output`/`--staging` is still taken literally.

## Requirements and limits

- The worktree state directory must be on a local filesystem with working POSIX advisory
  locking; network and FUSE mounts are unsupported for this purpose.
- The historically verified host is Codex `0.154.0`. Other versions are allowed with a warning
  when their metadata satisfies the same contract; this does not certify their guardian behaviour.
- Among several legitimate root sessions, the first one to take ownership becomes the manager.
- Start each client at the worktree root; a subdirectory is refused.
- One worktree, one database, one active feature.
