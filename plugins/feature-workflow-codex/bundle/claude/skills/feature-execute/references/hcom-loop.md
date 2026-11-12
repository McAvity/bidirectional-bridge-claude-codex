# Hcom loop: feature-execute coordinator and one Claude executor

Use only after the user selects hcom and authorizes this feature's execution/delegation.
`feature-flow` uses this same loop during execution; it does not invent a second scheduler.
Support: one local Git worktree, one feature, one Claude session, sequential rounds.
The coordinator owns contracts, index, task statuses, review and decisions. Hcom transports
messages; the coordinator still verifies the Git delivery. No Bridge calls, task retries after uncertain delivery, automatic crash recovery,
multi-repo or parallel workers in this mode. A bounded pre-dispatch startup repair
is described below; it never replaces a worker or restarts task execution.

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
For a new worker, use session-scoped `--permission-mode auto` unless the user explicitly
selects another mode. Record the requested mode in `feature.json.execution.permission_mode`
while preserving other execution fields, and record the observed mode when available in
startup metadata. Existing sessions retain their mode; do not relaunch or change a bound
session merely to apply this default. Keep the existing account; no Claude -p, bypass flags,
blanket tool allowances or new API keys.

Auto mode delegates permission review to the client's classifier; it is not an OS sandbox
or additional task authority. Put the authorized local edits, checks, commits and hcom
communication in the round contract. Push, publication, deployment, production operations,
global configuration changes and writes to other projects need separate user authorization
unless already explicitly included in the user's scope. Contract scope, Git review, receipt
and guarded finish remain required. Do not modify global/project permission settings.

Before dispatch, confirm the installed client supports auto and inspect any mode/startup
notice. If account/model/policy restrictions or classifier fallback prevent the requested
mode, report the actual mode and blocker; do not silently substitute manual/bypass, change
models/accounts, disable checks or start a replacement worker. Existing approval of auto
covers its normal startup confirmation; inspect the exact prompt rather than blindly
accepting unrelated trust or tool permissions.
Prepare a clean baseline and preserve unrelated dirt. Add `.hcom-work/` to this worktree's
Git info/exclude (resolve it with `git rev-parse --git-path info/exclude` for linked worktrees).
It holds contracts and reports, not delivered source. No ignored state is committed.
Set an authorized prompt/time budget before any launch; do not infer unlimited model work.

Use session-scoped `HCOM_CLAUDE_DELIVERY=inject` for fresh launches. This uses the
interactive PTY and avoids dependence on Claude's native-mod rollout. Do not change
`hcom config` globally or infer the running worker's transport from a new shell's env.
Record `feature.json.execution.delivery = "inject"` for this launch. Existing workers
keep their transport unless the pre-dispatch repair below is applicable.
Hcom distinguishes Claude's placeholder from a real draft using terminal styling.
For the child launch only, remove `NO_COLOR`, `CLICOLOR` and `CLICOLOR_FORCE`, and set
`TERM=xterm-256color` and `FORCE_COLOR=1`. An inherited `NO_COLOR=1` can make an empty
Claude prompt appear nonempty and block startup/delivery. These are terminal display
settings, not permission changes; keep the parent shell and global settings unchanged.
The bundled resume helper applies the same environment to its child launch.
When fresh init granted launch, run once without a task prompt:

```sh
env -u NO_COLOR -u CLICOLOR -u CLICOLOR_FORCE TERM=xterm-256color FORCE_COLOR=1 \
  HCOM_CLAUDE_DELIVERY=inject hcom --go claude --headless --dir "$HCOM_FLOW_WORKSPACE" --json \
  --permission-mode auto --strict-mcp-config --mcp-config '{"mcpServers":{}}'
```

Read launch JSON and `hcom list EXACT_NAME --json`, save the latter privately as session.json,
then bind with `hcom_state.py bind ... --session-file /private/path/session.json`.
Here and below `...` means the same `--state`, `--workspace`, `--feature` arguments above.
Inspect trust/permission prompts through `hcom term EXACT_NAME --clean`; approve only a
reviewed operation for this worker. No blind Enter loop, global permission change or second
launch around a pending prompt. Record intervention count when measuring a pilot.

## Live readiness and bounded startup repair

The bundled `scripts/hcom_startup.py` is shared by all projects; do not create a
project-specific launcher. It derives HCOM_DIR from the same private state and checks
the bound native session, workspace, Claude/listening status, live process and hook
bindings, and a ready PTY with an empty composer. `check-session` alone only checks
identity. A shell command returning success or a visible session is not readiness.

After startup prompts are settled, and immediately before **each** prepare, run:

```sh
python3 "$(dirname "$HCOM_FLOW_HELPER")/hcom_startup.py" check \
  --state "$HCOM_FLOW_STATE" --workspace "$HCOM_FLOW_WORKSPACE" \
  --feature "$HCOM_FLOW_FEATURE" --session-file "$HCOM_FLOW_STATE/ready-r1.json"
```

Choose a new private snapshot filename for each check (including retries). `prepare`
requires this snapshot, at most60 seconds old. If it expires, check again before
preparing; do not repeat a successful prepare. A failed check grants no dispatch.
The check probes PTY/bindings, not a model turn or an end-to-end task acknowledgement.
The fixed inject launch and this check are both required; do not send a probe prompt.
If starting normally, allow up to30 seconds for binding, then inspect the actual
terminal/launch diagnostic. Handle an explicitly visible trust/mode prompt under the
existing authority. For a suspected placeholder/draft parsing mismatch, inspect the
screen; only after confirming no user text exists may you clear the composer with
Ctrl-U **without Enter**, then check again. Do not auto-clear unknown input.
If the placeholder still reads as nonempty, report the rendering/PTY compatibility
blocker. Do not waive `prompt_empty`, classify text by a `Try ...` prefix, or repeat
clears/relaunches. Changing the caller's environment does not repair an already
running worker; preserve the session and follow the authorized stop/repair boundary.

For a diagnosed pre-dispatch startup/transport failure, execution authorization also
covers one normal stop and resume of the **same** native session, unless the user's
protocol explicitly forbids restart. First inspect full history and current-session
transcript: there must be no task prompt or work, including direct terminal input.
The helper additionally requires zero prepared rounds and no messages anywhere in
this private namespace. A prepared round, even without a send acknowledgement,
forbids this repair: follow uncertain-delivery diagnosis instead.

```sh
python3 "$(dirname "$HCOM_FLOW_HELPER")/hcom_startup.py" stop \
  --state "$HCOM_FLOW_STATE" --workspace "$HCOM_FLOW_WORKSPACE" --feature "$HCOM_FLOW_FEATURE"
# Once normal stop has completed (inspect history/status; no repeated /exit):
python3 "$(dirname "$HCOM_FLOW_HELPER")/hcom_startup.py" resume \
  --state "$HCOM_FLOW_STATE" --workspace "$HCOM_FLOW_WORKSPACE" --feature "$HCOM_FLOW_FEATURE"
```

`stop` accepts only listening Claude or its specific `blocked/launch_blocked` startup
state, requires a ready empty terminal, and persists intent before `/exit`. `resume`
requires the same session's subsequent normal-stop event, absence from the live list,
and zero prepared rounds/messages. It persists intent before a single `hcom r` with
inject; tracked resume preserves the original model, permissions and launch settings.
It does not grant dispatch: run `check` again and require the unchanged binding.
Timeout/nonzero/ambiguous results preserve intent and block retries; inspect rather
than resetting state, deleting intents, rebinding, launching a replacement or resending.
A failed repair remains blocked with a specific diagnostic. Record the intervention
and startup duration separately from dispatch-to-receipt timing. This is not general
crash recovery, and it never expands the approved model/prompt/time budget.

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

Run the live readiness check above and pass its fresh snapshot to
`prepare ... --contract PATH --session-file PRIVATE_READINESS_SNAPSHOT`. Only a newly successful prepare gives `dispatch_permitted:true`.
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

Use the selected session permission mode. Batch one logical edit, use native reads instead of shell pipelines
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
