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
  to this round, quoted with their question id; "Follow `.agents/skills/feature-execute/SKILL.md`,
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
  reviewed.

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
2. `python3 .agents/skills/feature-exchange/scripts/feature_exchange.py verify --archive <zip>
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

## Interruptions, retries and restart

- After any timeout, error or restart, call `bridge_feature_get` before another mutating call.
- Repeat an interrupted operation with the same key and identical arguments. A new key means
  a new operation; never use one to retry.
- A client tool timeout on `bridge_feature_run` or `bridge_resume_delegated_task` does not
  stop the work. Read the state: `running` → wait; `awaiting_review` or `blocked` →
  `bridge_get_task` for the result.
- After your own restart: read `feature.json` (`bridge`, `next_action`), the latest review
  and decision, then `bridge_feature_get`. If the latest review does not name
  `latest_task_id`, review that round before anything else.
- A `running` state that outlives its deadline may be a stranded worker. Do not clear it or
  start around it; confirm the old worker has stopped, then use recovery, or report it.
