# Hcom recovery and workflow upgrades

Use the selected bundle's helpers with the same canonical workspace, feature and private
state directory as [hcom-loop.md](hcom-loop.md). This is coordinator work. The worker never
changes lifecycle state, accepts itself or chooses another bundle. Existing authorization
covers recovery that restores the agreed execution; a changed product scope, cancellation
or expanded model/time budget needs its own authority unless already granted.

The helper separates observation from action. `reconcile` reads hcom and records effects;
`resume` unblocks a receipt or requests the same native session; `cancel` abandons work.
None sends a task. `prepare` alone grants one immediate dispatch. Inspect exit status and
JSON `ok:true`; after any uncertain result, reconcile before another external command.
Resume, cancel and initialization grants use a stable `--key`; decisions also require a
concrete `--reason` and ledger/decision `--decision-ref`. Observational reconcile needs
none of these. Repeating a completed key is not a fresh request. Use a new key only
for a distinct action or a retry whose earlier command was proven not applied.

```sh
HCOM_FLOW_RECOVERY="$(dirname "$HCOM_FLOW_HELPER")/hcom_lifecycle.py"
python3 "$HCOM_FLOW_RECOVERY" reconcile --workspace "$HCOM_FLOW_WORKSPACE" \
  --feature "$HCOM_FLOW_FEATURE" --state "$HCOM_FLOW_STATE"
```

## Choose the next action

| Observed state | Action |
| --- | --- |
| Received `blocked`, prerequisite now verified | `resume`; record the verification and prepare a new round from the actual delivered/integrated HEAD. |
| Prepared, send response lost | `reconcile` matches the exact contract path/digest and recipient in request history. Receive existing work; never resend it. |
| Proven command never applied | Explicit `reconcile --resolution not-applied` below; missing log entries alone are insufficient. |
| Same bound worker stopped/crashed | `resume` requests that native session once; `reconcile` confirms readiness. Inspect pending work before any new contract. |
| Exit/resume returned uncertainly | `reconcile` records matching stop/readiness, or retain the pending operation until evidence resolves it. |
| User abandons unfinished work | `cancel`, then `reconcile`; retain partial code, contracts and receipts without accepting or integrating them. |
| `finished`, later correction authorized | Reconcile finish, resume the same session, confirm readiness; then prepare a fresh round. |
| Old state/bundle | Explicit journalled upgrade below; plugin refresh alone does not change an existing feature lock. |

## Resume a received blocker or stopped worker

Verify the prerequisite first (for example, retry the exact network check after VPN recovery),
and record it in the existing execution ledger. Then:

```sh
python3 "$HCOM_FLOW_RECOVERY" resume --workspace "$HCOM_FLOW_WORKSPACE" \
  --feature "$HCOM_FLOW_FEATURE" --state "$HCOM_FLOW_STATE" \
  --key resume-network-1 --reason 'Required network check now passes' \
  --decision-ref 'docs/features/F-X/execution/T-X/01.md'
```

For a live ready worker, a blocked receipt gains a separate continuation record. Its report,
decision and old contract remain unchanged. Readiness and normal prepare still apply.
For a stopped worker this requests one tracked `hcom r`; it does not repeat the old task.
Run reconcile after readiness. If the previous receipt is blocked, run resume with a new
key to record its continuation. If delivery is pending, inspect history/report and receive
that round first; a resumed process does not imply it completed or needs another dispatch.
Session identity, model and permission settings remain bound. A missing/ambiguous stop
record or unavailable native session stays a specific blocker; never launch a replacement
under the old state. Cancellation remains the way to abandon it once stop is established.

## Interrupted commands

The helper persists intent before resume/stop. An observation may complete it even when
the original command timed out. Do not erase intent files or change `blocked` to `accepted`.
For a command independently established to have ended without applying its effect:

```sh
python3 "$HCOM_FLOW_RECOVERY" reconcile --workspace "$HCOM_FLOW_WORKSPACE" \
  --feature "$HCOM_FLOW_FEATURE" --state "$HCOM_FLOW_STATE" \
  --resolution not-applied --target prepared --confirm-command-ended \
  --reason 'Original command ended before submission; terminal and full history checked' \
  --decision-ref 'docs/features/F-X/execution/T-X/01.md' \
  --evidence-ref 'Private command result and observation reference'
```

Targets are `prepared`, an operation's key, `finish-intent.json`,
`startup-stop-intent.json`, `startup-resume-intent.json`, or `initialization`.
The flag is an operator assertion backed by inspected evidence, not a timeout override.
If evidence is unavailable, keep the operation uncertain. `prepared` is preserved as
`not_sent`; use the next sequential round and fresh paths, never overwrite it. For
`initialization`, require no bound session, rounds, live workers or history and add a fresh
`--key`; only its first successful response grants one launch. A repeated call grants none.
This path does not recover a session that actually launched; bind that session instead.

## Cancel without acceptance

Record the user's abandonment or applicable run deadline. Reconcile earlier uncertain
operations, then:

```sh
python3 "$HCOM_FLOW_RECOVERY" cancel --workspace "$HCOM_FLOW_WORKSPACE" \
  --feature "$HCOM_FLOW_FEATURE" --state "$HCOM_FLOW_STATE" \
  --key cancel-1 --reason 'User abandoned the feature' \
  --decision-ref 'docs/features/F-X/decisions/02.md'
```

Idle ready workers receive normal `/exit`. A busy worker requires explicit `--interrupt`
under the cancellation authority; this kills only the bound worker. Never stop shared
daemons. Reconcile requires its matching stop event and live absence before `cancelled`.
Unbound initialization can be cancelled only with `--confirm-command-ended` after proving
no launch/history remains. Cancellation blocks new rounds and is distinct from accepted
delivery. Update the feature/task documents as cancelled, preserving completed partial work
and evidence; do not merge it merely to clear a slot. Restarting abandoned scope is a new
feature, not erasing the old record.

## Upgrade an existing hcom feature

An authorized workflow upgrade may use the **new verified plugin bundle's** migration
helper even while the existing lock still names the old bundle. This is the explicit
migration tool, not permission to execute tasks with unselected instructions. Read and
verify the new bundle before use. No Bridge runtime upgrade or MCP manager is involved.
A historical Bridge planning reference must be demonstrably closed; the helper reads its
database without mutation. An active/unknown Bridge workstream is not bypassed.

Retain the exact native session and all pending work. Migration grants no launch or dispatch
and does not require restarting or recovering a worker first. For a ready worker, optionally
use the new bundle's `hcom_startup.py check` to write a fresh readiness snapshot in the
original private state directory (this read path supports v1). Omit that check and the
`--session-file` argument below for a stopped/unready worker; recover it after migration.
Read the actual generation from `workflow.lock.json`; do not assume it is 1. Set
`HCOM_NEW_BUNDLE` to the newly verified bundle and `HCOM_NEW_SCRIPTS` to its
`codex/skills/feature-execute/scripts` (or `claude/...` for a Claude coordinator).

```sh
HCOM_UPGRADE_SNAPSHOT="$HCOM_FLOW_STATE/upgrade-ready-$(date +%s).json"
python3 "$HCOM_NEW_SCRIPTS/hcom_startup.py" check \
  --workspace "$HCOM_FLOW_WORKSPACE" --feature "$HCOM_FLOW_FEATURE" \
  --state "$HCOM_FLOW_STATE" --session-file "$HCOM_UPGRADE_SNAPSHOT"
python3 "$HCOM_NEW_SCRIPTS/hcom_upgrade.py" \
  --workspace "$HCOM_FLOW_WORKSPACE" --feature "$HCOM_FLOW_FEATURE" \
  --state "$HCOM_FLOW_STATE" --bundle "$HCOM_NEW_BUNDLE" \
  --expected-generation "$HCOM_LOCK_GENERATION" \
  --reason 'Adopt lifecycle recovery for the existing hcom feature' \
  --decision-ref 'docs/features/F-X/decisions/02.md' \
  --session-file "$HCOM_UPGRADE_SNAPSHOT"
```

Default is a read-only plan. After checking it, repeat with `--yes` under the existing
upgrade authorization, refreshing readiness if older than 60 seconds. The helper publishes
an immutable bundle, increments the feature lock and migrates private state to v2 while
preserving all historical contracts, receipts and bindings. It journals both files; if
interrupted, rerun the exact request with `--yes`. Replay does not need a new readiness
snapshot and refuses unrelated drift. Do not manually edit either file to recover it.

Re-resolve the feature and use the returned immutable bundle for all further helpers and
new contracts. Old helpers reject v2 instead of ignoring lifecycle guards. A blocked old
receipt still needs resume after migration. Existing client/worker sessions may continue;
the next round explicitly names the new instructions. Refresh client skill discovery when
needed, but do not restart a worker merely to reload a workflow bundle.
