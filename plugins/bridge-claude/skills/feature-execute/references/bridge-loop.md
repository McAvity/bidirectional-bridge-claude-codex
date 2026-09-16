# Bridge loop: coordinator drives Claude rounds

Load this when you coordinate a feature whose implementation runs as Claude Code rounds
through the bridge MCP (`bridge_feature_*`). You are the coordinator: you own the feature
index, round contracts, independent review, decision records and the user channel. The
executor side is the "Bridge round executor" section of `feature-execute`.

The bridge stores durable routing state. It never decides, reviews, accepts, forwards user
messages or starts work by itself. Every round, recovery, question and acceptance is an
explicit call from you.

## Start or reuse the feature

1. Call `bridge_server_info` once per session; require `caller: codex`, `delegation: allow`.
2. Require an authorized execution scope (`decisions/NN.md` or a recorded user instruction),
   authorization to delegate it to Claude through the bridge, and authorization for local
   commits (round packages are commit ranges). Without them, prepare the decision instead of
   starting rounds. Rounds run `git commit` and `python3` and write the package into the
  worktree's exchange namespace outside the
   repository; the project's Claude permissions must allow that.
3. Call `bridge_feature_get({feature_id: <feature-id>})`. If the feature exists, continue
   from its state and make sure `feature.json` records its `bridge` block. Never create a
   second root or feature for the same feature directory.
4. Otherwise: `bridge_create_task` (root; objective "Coordinate <feature-id>"; scope = your
   own write paths: `<feature>/reviews/**`, `<feature>/decisions/**`, `<feature>/feature.json`,
   registered task files) → `bridge_claim_task` → `bridge_set_state` `WORKING` →
   `bridge_feature_create({feature_id: <feature-id>, parent_task_id})`. Record
   `"bridge": {"feature_id": "...", "parent_task_id": "..."}` in `feature.json`.
5. Write your files only while no round is `running`, and commit them only when no round task
   is open (`running` or `blocked`), so a round's commit range holds only the executor's
   commits. Wrap each batch of writes in `bridge_acquire_lease` on your write scope and
   `bridge_release_lease`.

## Round contract

One round = one bounded `bridge_feature_run`. Build the `spec` so a fresh executor could act
on it alone:

- `objective`: feature id and round number; task IDs; governing authorization (path);
  for corrections the review path and required finding IDs; the user decisions that apply
  to this round, quoted with their question id; "Follow `${CLAUDE_PLUGIN_ROOT}/skills/feature-execute/SKILL.md`,
  section Bridge round executor"; the ledger directory `execution/<TASK-ID>/`; the package
  export (purpose, `--base` = current HEAD before the round, and the archive file name for
  `--name`, which resolves inside this worktree's exchange namespace
  `~/tmp/bridge-exchange/ws_<16 hex>/packages/` — run `feature_exchange.py namespace` to read it;
  give an explicit `--output` path only when a literal location is genuinely required).
- `scope.paths`: code/test globs of the task plus `docs/features/<id>/execution/**`.
  Exclude `feature.json`, `reviews/`, `decisions/` and other features.
- `expected_deliverable`: package path, SHA-256, purpose, `base..head`, ledger path, outcome.
- `verification_criteria`: concrete commands that must pass on the final code.
- `deadline_ms`: the executor's own bound, below the client tool timeout minus a margin for
  the kill grace, the deliverable and the package check (4 500 000 for a 5400 s timeout,
  1 500 000 for 1800 s). A client tool timeout that fires first does not stop the round.
  `max_turns` sized to the work: the bridge accepts at most 256, the runtime default is 12,
  and a 75-minute round needs roughly 200 — an undersized ceiling ends the round early.
- `idempotency_key`: `<feature-id>:round-<N>`, N = `len(task_ids) + 1` read from
  `bridge_feature_get` in state `ready` or `awaiting_review` after the previous round was
  reviewed. Choose it **once**, write it to the round's intent file before the call (below), and
  after any interruption take it from that file — recomputing the count after a reservation has
  landed yields a new key and a duplicated round.

Put only contract material in the round. Ordinary conversation with the user, questions
addressed to the user, and your own commentary are never round input. The bridge appends
nothing on its own.

## After every call: act on the feature state

| State | Do | Never |
|---|---|---|
| `ready` | Run round 1. | Run without authorization. |
| `running` | A round or its recovery executes. Wait: `sleep 60`–`120`, then `bridge_feature_get`; repeat within the deadline (this polling is the intended exception to "avoid polling"). Keep this session open. | Start a round, ask, or recover. |
| `awaiting_review` | Review the latest round (below) and route the result. | Treat `COMPLETE` as review or acceptance. |
| `blocked` | `bridge_get_task(latest_task_id)`; read the blocker. Resolve within authority with `bridge_resume_delegated_task({task_id, message, idempotency_key: "<task>:resume-<task.attempt + 1>"})`; otherwise ask the user. | Run a new round, create a sibling, or delegate around the blocker. |
| `waiting_user` | Show the pending question; wait for the user's real answer. | Run, recover, or treat silence as consent. |
| `accepted` | Finish the root task. | Start more rounds. |

A `FAILED` round whose last attempt ended `TIMEOUT` (the bridge stopped it at `deadline_ms`)
keeps its session and can be reopened once, explicitly, when the extra runtime is authorized:
`bridge_resume_delegated_task({task_id, recover_timeout: true, deadline_ms: <new budget>,
max_turns: <sized>, idempotency_key: "<task>:timeout-recovery-<n>", message: <optional>})`.
Before calling it: read `bridge_get_task`, confirm the attempt outcome is `TIMEOUT` and no
worker process survives, choose a deadline that reflects why the round ran out of time, and
state the new budget to the user if the authorization did not already cover it. Repeating the
same request replays it; it never starts a second worker.

Any other terminal `FAILED` round, a strict-resume failure, or a second timeout in a row is
not recoverable by these tools: report the exact error to the user. Never start a fresh
Claude session, and never treat recovery as an automatic retry.

`bridge_get_task` also lists `termination_evidence` for attempts that ended without a result:
metadata and a local file path. Read that file (`jq . <path>`) for the runtime's bounded
stderr tail and process facts before deciding what the new deadline should be. Its content is
diagnostic, not round input.

## Review each round

1. `bridge_get_task(latest_task_id)`: read the deliverable and artifacts. A path in the
   summary is a claim.
2. `python3 ${CLAUDE_PLUGIN_ROOT}/skills/feature-exchange/scripts/feature_exchange.py verify --archive <zip>
   --expect-feature <feature> --expect-purpose <purpose> --expect-base <contract base>
   --expect-head HEAD`. Compare its `archive_sha256` with the reported hash.
3. Check the round against its contract: `git diff --name-only <base>..HEAD` and
   `git status --porcelain` must stay within `scope.paths`, and `feature.json`, `reviews/`,
   `decisions/` and task files must be untouched by the executor.
4. Use `$feature-review` in the appropriate mode: inspect the changed scope and new ledger,
   rerun decisive checks, and record the reviewed task id and exact revision. For corrections,
   append a dated entry to the existing review register and recheck open findings and concrete
   related regressions; a new round alone does not require a new review file or another reviewer.
   For every carried required finding, record `resolved`, `progress` or `no progress`.
   Keep new material defects visible and retain earlier evidence whose scope is unchanged.
5. A missing, failing or stale package, an empty `code_changes` range, uncommitted in-scope
   work or any change outside the scope is a required finding for the next round, not a user
   question.
6. Route:
   - required findings within the authorized behavior → next round with a correction
     contract. Existing authorization covers it; do not ask the user;
   - PASS with authorized tasks remaining → next round for them;
   - PASS for the whole authorized scope → export the final handoff with `$feature-exchange`
     and ask for acceptance (below), unless the recorded authorization explicitly delegates
     acceptance to you;
   - a material choice outside the authorization → ask the user;
   - the same material finding with `no progress` in two consecutive reviews, or two
     consecutive recoveries of one task ending blocked on the same blocker → stop and ask
     the user with the cause of the impasse and the concrete decision needed. This is not a
     limit on the number of rounds: continue authorized corrections within the explicit budget.
     Progress alone does not justify preserving an increasingly complex approach: at the third
     review of the same problem in a phase, apply the shared step-back rule. This requires no
     extra document or automatic user question and never permits accepting a material defect.

Update `feature.json` (`phase`, `latest_review`, `latest_decision`, `next_action`) and task
statuses after each review. Keep executor `COMPLETE`, your review verdict and user acceptance
as three separate facts.

## Ask the user

`bridge_feature_wait_user` freezes every round and recovery of this feature until the answer
is recorded. Before asking, check existing authorization, gather locally available essential
evidence and finish the rounds that do not depend on the answer. Do not use a missing local
investigation as a reason to ask whether an existing requirement should still apply.

1. `bridge_feature_wait_user({feature_id, question_id: "q-NN", question})`, NN = the next
   number not yet used in this feature. The question is self-contained: the decision,
   options, evidence, your recommendation.
2. Show the same question to the user and end your turn.
3. When the user answers, call `bridge_feature_answer_user` with the answer in the user's
   words; unrelated remarks in the same message may be left out and answered in the user
   channel. A message that does not answer the question is not an answer: reply to it, keep
   waiting. Nothing is sent to Claude. The feature returns to the state it had before the
   question (`ready`, `awaiting_review` or `blocked`). Record a decision with
   `$feature-decide` when the answer decides scope, behavior or acceptance.
4. Continue explicitly: after a `DONE` round, a new round whose contract quotes the decision;
   for a `BLOCKED` task, `bridge_resume_delegated_task` with the decision as `message`.
   Pass only the part of the answer that the round needs.

## Acceptance or stop

After the user's acceptance answer (or explicitly delegated acceptance) is recorded in
`decisions/NN.md`: `bridge_feature_accept`, then `bridge_submit_deliverable` for the root
with the review and decision references and a real passing check. If the user asks for
changes instead, record the decision and run the next round; the feature stays
`awaiting_review` until then. If the user stops the feature (impasse, `FAILED` round,
changed goal), record that decision and submit the root as `PARTIAL` or `FAILED` with the
reason; never accept it.

## Interruptions, retries and restart: "continue"

After capacity, a lost response, a disconnect or a restart, the user may simply say *continue*.
That is enough. Do not ask them for task, attempt or session identifiers that are already in
durable state, and do not require a phrase or a skill name.

### Before writing the first mutation of an operation

Persist the intent first, so a later "continue" has the exact request to replay:

- one file per operation, in this worktree's own exchange namespace, beside the packages:
  `<namespace>/intents/<op>-<key>.json`, where `<namespace>` comes from
  `feature_exchange.py namespace --repo <worktree>` (a pure read). Never in `.bridge/` or
  `.bridge-runtime/`: an unexplained file there is refused by the setup and identity guards and
  would block the very bootstrap you are about to do;
- write it atomically (temp file in the same directory, then rename) before the call leaves;
- record the exact arguments, the idempotency key, the contract path and its SHA-256, the
  authorization path, the Git base, the budget, and the `latest_task_id` you read just before;
- after the call returns, add the ids it gave you. That is a write outside the repository, so it
  does not commit during an open round and does not enter the executor's package;
- it is not a second state store. It records intent, never acceptance. **The bridge is the only
  authority on whether an operation was accepted.** A missing or unreadable intent file is a
  blocker: say so and ask, rather than reconstructing a request from memory or from a hash.

### On "continue": read before you write

1. **Read your own work**: `git log <git_base>..HEAD`, `git status --porcelain`, and whether the
   round's package already exists in the exchange namespace. A summary that scrolled away is not
   evidence that a commit or an export did not happen.
2. **Read the intent files** for this feature: which operation was in flight, with which key.
3. **Read the bridge**: `bridge_feature_get`, then `bridge_get_task` for the latest task. These
   are pure reads; they need no manager instance and write nothing, so a further interruption
   here costs nothing.
4. Only then act, and only through the table below.

| What the state says | Do | Never |
|---|---|---|
| `running`, attempt open | Wait and poll, as above. Report that a round is in flight. | Start a round, recover, ask, or "check" with a new key. |
| `awaiting_review` | Collect the result (`bridge_get_task`) and review it. | Treat retrieval as a new round. |
| `blocked` | Read the blocker; resume the same task with its key. | Create a sibling or a replacement task. |
| `waiting_user` | Show the pending question and wait for a real answer. | Treat "continue" as the answer, or run around it. |
| Uncertain whether your call arrived | Re-send the **identical** request: same key, same arguments. | A new key, a "probe" call, or picking a task by objective or scope. |
| A foreign manager or an ambiguous session | Ask which context is meant. | A silent takeover, or choosing the newest session. |
| Budget or attempts exhausted | Report it and ask. | Renew a deadline or a turn ceiling because the work is unfinished. |

### Why the identical replay is the only move

An unchanged `latest_task_id` is an observation from one moment, not proof that your call was
lost: an interrupted request may commit its reservation immediately after you read. Re-sending
the identical request is correct in both cases — it replays when the reservation exists and
performs the operation once when it does not. A recomputed key (`len(task_ids) + 1` after a
reservation already landed) is what actually duplicates a round, so take the key from the intent
file, never from a fresh count.

The same rule covers the bootstrap steps, not only rounds: `bridge_create_task` with the
persisted key is the *only* way to tell whether a root task was created — one that was lost
before `bridge_claim_task` has no owner and will not appear in `bridge_list_tasks({owner:
"codex"})`. `bridge_claim_task` and `bridge_set_state` are safe to repeat for the same owner and
target state. `bridge_feature_create` is idempotent per feature id and refuses a different parent
rather than creating a second feature. `bridge_resume_delegated_task` needs its key: without one,
a repeat after the attempt ended really does spend another attempt.

### Losing a response is not the worker dying

If your call was interrupted but the MCP server survived, the round is very likely still running
and will finish normally: wait and collect. Only the server process dying leaves an attempt open
with nothing driving it. Distinguish them before acting — `bridge_feature_get` plus
`bridge_get_task` show whether the attempt ended, and the pure `bridge_recover` reports live and
expirable leases. If an orphaned attempt never persisted an execution handle, strict resume has
nothing to resume: that is a real limit. Stop, report the task, attempt, reason and evidence, and
ask. Never start a fresh Claude session, a replacement task or a new feature id to get around it.

### Ordinary rules that "continue" does not suspend

- After any timeout, error or restart, call `bridge_feature_get` before another mutating call.
- A client tool timeout on `bridge_feature_run` or `bridge_resume_delegated_task` does not stop
  the work.
- After your own restart: read `feature.json` (`bridge`, `next_action`), the latest review and
  decision, then the bridge. If the latest review does not name `latest_task_id`, review that
  round before anything else.
- A `running` state that outlives its deadline may be a stranded worker. Do not clear it or start
  around it; confirm the old worker stopped, then use recovery, or report it.
- Mutating again after a crash needs authority back: the same Codex thread resumes with
  `bridge_manager_resume_instance`; a different thread needs an explicit takeover with a reason.
