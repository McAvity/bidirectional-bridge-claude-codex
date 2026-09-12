# Feature sessions and user questions

A Codex manager can keep one Claude conversation across multiple bounded tasks. A
completed round stays `DONE`; review corrections create another task with a new
objective, scope and verification criteria. The new invocation strictly resumes the
persisted Claude session. Missing or changed session handles fail the round; there
is no fallback to a fresh conversation.

## Tool sequence

1. Create and claim a parent task as the server-bound `codex` identity.
2. `bridge_feature_create({feature_id, parent_task_id})` creates the durable workflow.
   Repeating the same identity and parent is safe. This does not launch Claude.
3. `bridge_feature_run({feature_id, spec, input_artifacts: [], deadline_ms,
   idempotency_key})` explicitly launches the first round. The server must permit
   delegation. The result includes the feature, task and structured deliverable.
4. Read and review the returned deliverable. For feature-exchange, require the
   package path and version in the contract/summary, or publish the package as an
   artifact. Artifacts are explicitly supplied as `input_artifacts` in later rounds.
   The bridge does not unzip or approve packages. A path in a summary is only a
   reference; the manager must read and validate the actual package.
5. To request a user decision, call
   `bridge_feature_wait_user({feature_id, question_id, question})`, then show the
   question in the manager's user channel. The persisted state is `waiting_user`.
   Neither the question nor ordinary manager commentary is forwarded to Claude.
6. After receiving the answer, call
   `bridge_feature_answer_user({feature_id, question_id, answer})`. This persists
   the answer and **does not launch Claude or forward anything to it**. It is the
   manager's record of the user's answer, not independent proof that a human supplied it.
7. After a `DONE` round, explicitly call `bridge_feature_run` with a fresh key and
   the correction contract. The bridge never appends recorded questions or answers to
   a round; write the decision that applies to this round into its contract yourself.
   The predecessor is recorded in the feature's ordered `task_ids` and
   `feature.updated` event; its session handle seeds the new attempt.
8. For a `BLOCKED` task, use `bridge_resume_delegated_task` with the existing task id,
   a fresh idempotency key and explicit `message` containing the clarification.
   Recording an answer alone does not inject it into this recovery. Do not create
   a sibling task to bypass a blocker. `bridge_feature_get` reconciles the result.
9. After reviewing a successful final round, call `bridge_feature_accept`. Worker
   `COMPLETE` only advances to `awaiting_review`; it never accepts the feature.
   Acceptance forbids later rounds, so call it only after the acceptance decision the
   workflow requires (normally the user's, recorded outside the bridge).

`bridge_feature_get({feature_id})` returns state, ordered task ids and the current
question/answer. It does not expose execution handles. Questions and answers are
stored in the shared coordination database; avoid putting secrets in them.

## States and replay

- `ready`: no round yet; an explicit first run is allowed.
- `running`: a round is reserved or executing, including a recovery attempt of its
  `BLOCKED` task. No second round or user question; recovery only for a stranded
  worker confirmed stopped (see Operational limits).
- `awaiting_review`: latest task is `DONE`, its attempt ended and lease was released.
- `waiting_user`: new runs and recovery of feature tasks are forbidden. Recording the
  answer returns the feature to `ready`, `awaiting_review` or `blocked`, following its
  latest task.
- `blocked`: latest ended round is not `DONE`; inspect task state/error. Recovery covers
  `BLOCKED` tasks and, with the explicit `recover_timeout` opt-in and a new `deadline_ms`,
  a `FAILED` task whose last attempt ended at the bridge deadline with its session kept.
  Every other `FAILED` stays terminal.
- `accepted`: final manager acceptance; no more rounds or recovery.

A round key is scoped to the feature and atomically reserved with its task. Reusing
it with the same request returns that task's current state/deliverable, including
while it is running; it does not wait on or launch another worker. Reusing it with
changed arguments is `IDEMPOTENCY_MISMATCH`. A new key means a new round and is
allowed only in `ready`/`awaiting_review`. Question ids must be unique within the
feature; replaying an old question does not replace a newer one. Answer retries
must refer to the current question and repeat the same text.

SQLite schema 4 adds `features` without changing existing task or recovery rows.
Feature state, routing and replay reservations survive bridge restarts. Only the
owning manager can operate the feature tools. Recovery of older feature tasks is
also rejected once a newer task exists. The feature reservation serializes session
use even for disjoint write scopes and separate bridge connections.

Round packages live in the worktree's own exchange namespace,
`~/tmp/bridge-exchange/ws_<16 hex>/packages/`, which `feature_exchange.py namespace` prints;
`--name` and `--stage-name` apply it, while an explicit `--output`/`--staging` stays literal. Two
worktrees can therefore reuse one feature, purpose and round name without colliding.

## Worktree and manager identity

Feature rounds run inside one worktree owned by one native Codex session. Ownership is taken by
the first authorized call, identified from the host's per-request MCP metadata; startup and reads
claim nothing. A second session, or a second connection of the same session after a crash, is
refused until it resumes or takes over explicitly. See
[manager-identity.md](manager-identity.md) for the states, the tools
(`bridge_manager_status`, `bridge_manager_resume_instance`, `bridge_manager_takeover`) and the
refusal codes. A takeover never cancels a running round: the worker keeps going and its result is
recorded as usual.

## Operational limits

This first version supports a Codex manager, one Claude session per feature and
one workspace. It does not keep an OS process alive between rounds, run `/goal`,
forward every progress message, wake a closed manager, or supervise orphaned
processes. Process exit after a bounded invocation is independent of feature
acceptance.

A stranded `running` reservation does not expire when a lease expires. Inspect the
latest task/attempt and confirm the old worker has stopped before using existing
recovery. A crash before an attempt/session handle was persisted cannot be resumed
automatically. A round that the bridge stopped at its deadline is reopened only by an
explicit `bridge_resume_delegated_task({recover_timeout: true, deadline_ms, ...})`;
other terminal `FAILED` rounds and such early crashes require manual reconciliation.
There is deliberately no tool that silently clears the lock, retries automatically, or
starts a replacement session. Routine dependency, scope and artifact preflight
errors roll back the new task/reservation. An unrelated cross-process scope race
can still fail after reservation; inspect the task/error before intervening.

These tools provide durable explicit routing. They do not install manager skills
or configuration automatically, nor implement an autonomous agent-to-agent loop.
The manager must call the tools according to this sequence. The `using-bridge` skill
section "Feature rounds" and the feature workflow skills (`feature-execute` reference
`bridge-loop.md`) describe how a manager drives this loop.
