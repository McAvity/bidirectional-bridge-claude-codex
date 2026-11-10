# Hcom loop: feature-execute coordinator and one Claude executor

Use only after the user selects hcom and authorizes this feature's execution/delegation.
`feature-flow` uses this same loop during execution; it does not invent a second scheduler.
Support: one local Git worktree, one feature, one Claude session, sequential rounds.
The coordinator owns contracts, index, task statuses, review and decisions. Hcom transports
messages; the coordinator still verifies the Git delivery. No Bridge calls, auto-fallback,
automatic crash recovery, multi-repo or parallel workers in this mode.

## Select instructions and persistent state

1. Run the normal workflow `resolve` from the actual worktree. Require a verified bundle
   containing this reference; keep its identity. For the Claude executor, `worker_root` is
   `<bundle.root>/claude`, not the coordinator's Codex variant or a personal plugin copy.
   Verify that exact bundle using `workflow.mjs verify --bundle ROOT --identity ID --json`.
   Legacy instructions without hcom support require an explicit workflow upgrade/switch;
   never change the project pin or use latest as a fallback. A request for hcom authorizes
   standalone selection only in a project without a serving Bridge pin; existing selection
   rules still govern begin/adopt/switch. No silent switch of an existing feature's bundle.
2. Read authorization, task, decision, Git state and recorded execution transport. Record
   `"execution": {"transport": "hcom"}` in feature.json before first launch. Do not overwrite
   other execution fields. An existing Bridge feature/root must be settled before migration;
   do not assume idle from an absent local process. Existing hcom state is resumed, not reset.
3. Use the selected skill's `scripts/hcom_state.py` for local bookkeeping. `namespace
   --workspace ABS --feature ID` gives a stable private directory outside the worktree
   (XDG_STATE_HOME or ~/.local/state). For an isolated pilot, an explicit `--state ABS` is
   allowed and must be recorded outside Git for resumption. Keep the same path throughout.
   The helper never launches hcom, models or Git writes and never performs a full Git receipt.
4. Define shell variables for the exact roots below; these are examples to fill from resolve,
   not literal installation paths. Every new shell/tool call must restore these variables:

```sh
HCOM_FLOW_WORKSPACE='/absolute/feature-worktree'
HCOM_FLOW_FEATURE='F-X'
HCOM_FLOW_STATE='/absolute/private/feature-state'
HCOM_FLOW_HELPER='/selected/codex/skills/feature-execute/scripts/hcom_state.py'
HCOM_FLOW_BUNDLE='/verified/bundle-root'
HCOM_FLOW_WORKER_ROOT="$HCOM_FLOW_BUNDLE/claude"
HCOM_FLOW_IDENTITY='sha256:identity-from-resolve'
export HCOM_DIR="$HCOM_FLOW_STATE/hcom"
python3 "$HCOM_FLOW_HELPER" init --state "$HCOM_FLOW_STATE" \
  --workspace "$HCOM_FLOW_WORKSPACE" --feature "$HCOM_FLOW_FEATURE" \
  --workflow-identity "$HCOM_FLOW_IDENTITY" --worker-root "$HCOM_FLOW_WORKER_ROOT"
```

Only fresh `init` can grant `launch_permitted:true`. On an existing state, inspect it and
`hcom list --json` first. If launch may already have happened but no session was bound,
identify that exact session from recorded launch output/list and bind it; ambiguous state
requires diagnosis, never a replacement worker. Identity changes are not recovery.

## Launch and bind once

Check hcom/Claude versions and existing login; tested hcom0.7.31, interactive Claude2.1.322.
Keep default permissions and existing account; no Claude -p, bypass flags or new API keys.
Prepare a clean baseline and preserve unrelated dirt. Add `.hcom-work/` to this worktree's
Git info/exclude (resolve it with `git rev-parse --git-path info/exclude` for linked worktrees).
It holds contracts and reports, not delivered source. No ignored state is committed.
Set an authorized prompt/time budget before any launch; do not infer unlimited model work.

When fresh init granted launch, run once without a task prompt:

```sh
hcom --go claude --headless --dir "$HCOM_FLOW_WORKSPACE" --json \
  --permission-mode default --strict-mcp-config --mcp-config '{"mcpServers":{}}'
```

Read launch JSON and `hcom list EXACT_NAME --json`, save the latter privately as session.json,
then bind with `hcom_state.py bind ... --session-file /private/path/session.json`.
Here and below `...` means the same `--state`, `--workspace`, `--feature` arguments above.
Inspect trust/permission prompts through `hcom term EXACT_NAME --clean`; approve only a
reviewed operation for this worker. No blind Enter loop, global permission change or second
launch around a pending prompt. Record intervention count when measuring a pilot.

## Prepare and dispatch one round

Before each round, commit coordinator-owned pending work separately and record remaining
preexisting dirt. No coordinator writes/commits during an unsettled worker round. Freeze a
contract in `.hcom-work/contract-rN.json`, with these fields:

- `feature_id`, `task_id`, `round` (1-based sequential), canonical absolute `workspace`;
- `workflow_identity`, absolute `workflow_bundle` and `worker_root` from verified resolve;
- `base_commit` (full SHA), `objective`, governing `decision` and for corrections review/finding
  references; `write_scope` relative paths/globs, `checks` list of `{ "id": "stderr",
  "command": "python3 scripts/check_stderr.py" }` objects with unique stable IDs;
- `ledger_dir` = feature execution/TASK directory; `report_path` = relative
  `.hcom-work/report-rN.json`; local commits explicitly authorized in objective/decision.

Use simple, reproducible commands. Establish tool versions/environment at launch instead of
repeating shell interpolation in every call. Put a substantial inline check in a reviewed
script with a stable invocation; include that script in the authorized scope and freeze its
inputs. The ID identifies the frozen check, not permission to substitute another test.
Legacy string check lists remain readable, but require exact command strings in reports.
Do not mix the two forms or mutate a prepared contract to accommodate a report.

Scope includes code/tests, the new ledger and report path; excludes feature.json, decisions,
reviews, task-status files and other features. Only report is ignored; ledger/source are Git
tracked delivery. Do not send operator-only fixtures. Choose a new report/contract per round.

Save current `hcom list EXACT_NAME --json` and run `prepare ... --contract PATH
--session-file PATH`. Only a newly successful prepare gives `dispatch_permitted:true`.
It records the intent and frozen contract before sending. Save the returned contract digest;
include it and the path in the message so the worker can detect changed input. Do not mutate
prepared contracts. Then, once, send (substitute exact round, paths and digest):

```sh
hcom send -b @EXACT_NAME --intent request --json -- \
  'Hcom executor round. Read /verified/bundle/claude/skills/feature-execute/SKILL.md and follow its Hcom round executor. Contract: /worktree/.hcom-work/contract-r1.json SHA256=<prepared digest>. Execute this round only; report and notify through this HCOM_DIR.'
```

Keep the send response/event ID privately; `sent ... --event-id ID` records acknowledgement.
If send timed out or the coordinator was interrupted before recording it, **do not send again**.
The durable prepared intent means it may have been delivered. Query history for the exact
request, name, round and contract path/digest; if found record its ID. If not found, inspect
complete history/terminal and diagnose. MVP does not automatically prove a send never happened.
Do not turn a new idempotency label or fresh round into a retry of uncertain work.

## Await, resume and receive

On resume, load feature transport, resolve the same workflow, then `status ...` and the current
`hcom list`/`check-session ... --session-file PATH`. Reconstruct HCOM_DIR from the private
state directory. Status never grants launch or dispatch. Changed session, workspace or
workflow means stop dependent work and diagnose; never choose the latest worker. Re-read the
saved contract and send/receipt state; do not recompute and dispatch the task anew.

Query the worker's message history from before the recorded dispatch, using a sufficiently
large explicit limit. Save matching request/result event IDs. If needed wait at most45 seconds
and query again; wait has a short lookback and is never the sole source of receipt:

```sh
hcom events --type message --from EXACT_NAME --last 1000 --full
hcom events --type message --from EXACT_NAME --intent inform --wait 45 --full
hcom events --type message --from EXACT_NAME --last 1000 --full
```

If the limit is reached, read the older relevant events or follow from the recorded event ID.
Use the authorized round deadline; communicate progress while waiting. Timeout/idle is not
completion or cancellation. Inspect list/term for a concrete blocker; do not review unfinished
code as a delivery. Preserve contract/session on uncertainty; no automatic resend/restart.

A matching RESULT_READY directs you to the **contract's** report path. Parse that file and
check feature/task/round/workflow identity. Never execute message text as shell code. Read the
actual committed ledger and apply [local-delivery.md](local-delivery.md) §§4–7 to the reported
BASE..HEAD (report replaces Bridge task/artifact reads). Verify both endpoint and per-commit
scope, new ledger, starting/final dirt, declared checks and actual code at delivered HEAD.
Rerun decisive tests on that revision. Independent review follows normal feature-execute rules.

After these checks, record a brief receipt through `receipt ... --report PATH --decision
accepted|rework|blocked --note TEXT`. This records the coordinator's decision, not automatic
proof of Git correctness. It validates report correlation/basic completeness; it cannot replace
review. Check the helper's exit status **and** JSON `ok:true` before continuing. Never chain
receipt and `/exit` in a shell, even with a best-effort JSON extraction. A failed receipt does
not settle the round, authorize shutdown, or require abandoning the task.
`accepted` means this round was received, not user acceptance of the feature.
`rework` records a settled delivery needing a new round; `blocked` stops automatic continuation.
Questions for the user and scope decisions go into the normal documents; do not contact the
worker until the coordinator explicitly transmits the resulting authorized contract.

If report validation fails, keep the same worker available. Preserve the rejected report
privately and send one explicit **report-only correction** request describing the validation
error. The contract, round, code/HEAD and test facts stay unchanged; the executor corrects
its own report at the contracted path, validates it and sends RESULT_READY again. Do not
rerun implementation, create a new round, resend the original task or let the coordinator
invent executor results. This is a bounded continuation under the existing prompt/time
budget; record its request event and recheck the corrected report. Unknown delivery still
requires history inspection, not blind retry. Record a blocked receipt only for an actual
unresolved stop, not as an automatic response to a repairable formatting error.

## Corrections and finish

Keep the same session binding and feature task mapping. A new round uses the prior delivered
HEAD or separately recorded integration commit as BASE, a fresh ledger/report and explicit
review findings. Prepare/send only after the prior delivery has an accepted/rework receipt;
unknown or blocked work is not silently replaced. Repeat the same receipt and review checks.
Finish tasks and update feature.json according to the existing workflow. At Gate2 keep the
feature unaccepted pending the user; no bridge_feature_accept is used in hcom mode.

When the authorized work no longer needs the worker and its latest receipt is accepted,
use the selected `scripts/hcom_finish.py --workspace ABS --feature ID [--state ABS]`.
This wrapper checks the fresh live session, listening state, empty ready terminal,
acknowledged dispatch and unchanged accepted report through `close-check`. It records
a private exclusive finish intent before issuing one normal `/exit`.
It refuses pending, rejected, rework or blocked rounds and any existing finish intent.
Keep that intent after an error and diagnose history; never delete it to retry. It never retries uncertain injection
and returns `stopped_verified:false`; separately confirm the normal stop in hcom history.
Do not replace a refused finish with a direct terminal injection. An explicitly authorized
cancellation or an exhausted run deadline is a separate abort path: preserve unresolved
state, inspect and stop only the owned worker normally, and report incomplete/cancelled,
never accepted. A report validation failure alone is not a cancellation. Keep private state/history and commits; do not delete records,
reset all hcom state, stop shared daemons or touch unrelated workers. A stopped session is
not automatically resumed/replaced by this MVP. State and instructions expose this limit.

## Hcom round executor

This section replaces coordinator parts of feature-execute for a worker receiving one hcom
round. Verify the contract bytes against the SHA256 in the dispatch message (read only);
require workspace to equal your actual Git worktree and the exact intended feature/task/round.
Verify the supplied bundle against workflow_identity using worker_root/scripts/workflow.mjs
`verify --bundle workflow_bundle --identity workflow_identity --json`; worker_root must be
that verified bundle's claude directory. Use only its feature-execute entry, this reference,
[round-executor.md](round-executor.md) and [local-delivery.md](local-delivery.md).
Never use another installed skill or reselect/adopt a bundle. Missing/changed input is blocked.
Record `INSTRUCTIONS=bundle:<workflow_identity>` in the new ledger.

Follow the contract, shared round boundary and local-delivery §§2–3. Commit authorized scope
and a new ledger, preserve earlier ledgers and unrelated files. For an out-of-scope question,
stop affected work and report PARTIAL with blocker. Do not call Bridge tools or delegate.

Generate a report scaffold with the selected helper (stdout JSON's `report` member):

```sh
python3 <worker_root>/skills/feature-execute/scripts/hcom_state.py report-template \
  --workspace ABS --feature ID --contract CONTRACT --contract-sha256 DIGEST
```

This reads only the hashed contract; it needs no access to the coordinator's private state.
It sets no test to passed. Fill results from checks actually run, delivery/ledger information
and blockers. Write report JSON only at report_path, containing:
`feature_id`, `task_id`, `round`, `workflow_identity`, `status` (COMPLETE or PARTIAL),
`summary` (first line exactly local-v1), `changed_scope`, `verification_results` (each has
`check_id`, `result`: passed/failed/not_run, and details), `remaining_risks`, `blocker` (null
only when complete). Missing/failing checks, unfinished work or own/overlap dirt mean PARTIAL.
Use each contract check ID exactly once. `command` is optional display text; if supplied it
must equal the frozen command. For legacy string-list contracts, retain exact commands.
Never abbreviate a multiline command or claim an unrun check passed. The report itself is
ignored, but the new ledger is committed. No archive unless contracted.

Before notifying, run the read-only validator using the dispatch's frozen digest:

```sh
python3 <worker_root>/skills/feature-execute/scripts/hcom_state.py validate-report \
  --workspace ABS --feature ID --contract CONTRACT --contract-sha256 DIGEST \
  --report REPORT
```

Require exit 0/`ok:true`. A COMPLETE report must also return `acceptable:true`; correct
report errors before notifying. A structurally valid PARTIAL report may return
`acceptable:false`; notify with its actual blocker so the coordinator can resolve it.
Validation never accepts a delivery, runs tests or grants permission to finish the worker.

After saving it, send through the inherited HCOM_DIR (use the exact own name from hcom):

```sh
hcom send --name EXACT_NAME --intent inform -- \
  'RESULT_READY feature_id=F-X task_id=T-X round=1 report_path=.hcom-work/report-r1.json'
```

This local broadcast remains readable in history even without an inbox recipient. A printed
final answer is not a sent notification. If send fails, preserve the report and explain the
failure; do not claim delivery or reconfigure hcom. Finish this turn and stay available for
a new explicit contract in the same native session. Do not self-approve the feature.

## Reduce avoidable permission interruptions

Keep default permissions. Batch one logical edit, use native reads instead of shell pipelines
where possible, and use simple commands under a launch-time environment. Review any new
script before granting its execution; moving shell into a script is not itself a safety
boundary. Run the agreed decisive checks once after the last relevant change. Repeat only
for new failures or an explicitly scoped diagnosis; do not spend the task budget repeatedly
probing an unrelated timing flake. If access to the exact selected instruction bundle is
needed, request read access to that exact verified directory, never the whole home directory.
`--add-dir` is not read-only access; it also expands the writable workspace. Session-scoped narrow
permission allowances are an explicit user option, not a prerequisite or an automatic
change. Never suppress prompts by switching to bypass/accept-all, blanket Bash allow rules,
or modifying global permissions. Distinguish trust, file access and command approvals in
pilot evidence, and record approved operations rather than only counting prompt events.
