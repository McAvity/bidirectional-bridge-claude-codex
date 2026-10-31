# Recovery and failure actions

Load this reference only for a blocked, failed, interrupted, or stranded bridge task.

## Recovery sequence

1. Call `bridge_recover` to expire dead leases and identify stranded tasks.
2. Call `bridge_get_task` for the exact task. Do not expose the raw handle.
3. Confirm persisted strict-resume state exists and no live attempt or conflicting lease
   exists. The task must be non-terminal, or `FAILED` with its last attempt ended `TIMEOUT`.
4. Choose one path, preferably with an idempotency key:
   - current caller owns the task: call `bridge_resume_task` once;
   - current caller owns the direct parent and created its delegated child: call
     `bridge_resume_delegated_task` once;
   - that child is `FAILED` after the bridge deadline stopped it: the same call with
     `recover_timeout: true`, an explicit `deadline_ms`, a sized `max_turns` and a key, once
     the extra runtime is authorized. It is one deliberate operation, never an automatic retry.
5. For manager recovery, let the bridge derive the child owner and runtime from SQLite. Do not
   open the other native client, spoof ownership, or invoke the worker CLI directly.
6. Expect the same durable task, owner, lineage, and runtime session/thread, a new adjacent
   attempt, `resumed_from_attempt`, a fresh worker-owned lease, separate worker telemetry, and
   automatic lease release.
7. If resume fails, leave the same task blocked and report the exact failure. Never create a
   replacement sibling or fresh thread.

## Failure decisions

| Condition | Do | Do not |
|---|---|---|
| `QUOTA_EXHAUSTED` | Label a runtime-quota blocker; stop; resume the same eligible task after quota returns. | Do not call the target directly or create a replacement child. |
| `RUNTIME_UNAVAILABLE` | Report runtime unavailable and preserve durable state. | Do not bypass the bridge with a direct CLI invocation. |
| `TIMEOUT` | Assume partial work may exist; inspect the specific durable task; use only the declared retry budget or strict recovery. | Do not blindly restart or duplicate work. |
| Client timeout on `bridge_feature_run` | The round keeps running. Call `bridge_feature_get`; while `running`, follow the SKILL.md waiting policy (default status interval 10 minutes); when it ends, read the result with `bridge_get_task`. | Do not recover a running round, send a recovery `message`, or retry with a new key. |
| Child `BLOCKED` / `PARTIAL` | Consume useful evidence and blocker at the parent; resolve or report it. | Do not mutate the child as manager or upgrade it to complete. |
| `NOT_OWNER` | Stop the mutation; read state if needed. | Do not steal ownership, finish the task, or release another holder’s lease. |
| `SCOPE_CONFLICT` | Wait and recheck, narrow to disjoint scope, or return a blocker. | Do not steal or overlap the lease. |
| Validation failure | New malformed Claude reports are BLOCKED/PARTIAL; correct from existing evidence. A historical terminal schema rejection needs the explicit mode below. | Do not rerun completed work or invent paths/checks. |
| Round `FAILED` with attempt outcome `TIMEOUT` | Read `bridge_get_task` and its `termination_evidence` file, confirm the worker stopped, then resume once with `recover_timeout`, a justified `deadline_ms` and `max_turns`. | Do not reopen any other `FAILED`, reuse the expired deadline implicitly, or repeat after a second timeout without a decision. |
| Failed recovery | Report the same task, new attempt, lineage, and exact reason. | Do not create a sibling task or fresh runtime thread. |

## Closed features

`rejected`/`cancelled` are final. `FEATURE_CLOSED` forbids round/recovery/task mutation;
read historical results instead. `FEATURE_BUSY` or `FEATURE_UNSETTLED` on close means
active or insufficiently settled work, not permission to stop a process or retry a model.
Keep closure's idempotency key for a lost response. Missing close requires a runtime upgrade;
never use accept to release rejected work. Closed parent/worker outcomes are not rewritten.

## Historical malformed delivery

A historical `FAILED` round rejected at deliverable schema validation can use
`bridge_resume_delegated_task({task_id, recover_invalid_delivery: true,
deadline_ms: <authorized budget>, max_turns: <sized>, message: <bounded correction>,
idempotency_key: "<task>:report-recovery-<n>"})`. This is a separate explicit mode, never
combined with `recover_timeout`. The bridge proves a settled Claude attempt with
INVALID_ARGUMENT, the exact schema-rejection transition, completed/exit0 telemetry,
a complete intact original report and preserved session; ordinary feature/identity/lease
guards remain. Any missing proof refuses without reserving an attempt. Keep the same
contract and correct the report/evidence or already authorised defects; never repeat the
whole feature. New malformed Claude reports already return PARTIAL/BLOCKED with the
original report preserved and use normal BLOCKED recovery. Missing support requires
runtime upgrade, not a new session, direct CLI invocation or database edits.

## Termination evidence

An attempt that ended without a result leaves `<database dir>/evidence/<task_id>/attempt-<n>.json`
(mode 0600, written once): redacted stderr tail, exit code/signal, kill flags, deadline and
stream counters. `bridge_get_task` returns its metadata only. Read the file locally for
diagnosis; never paste it into a round contract, a user report or an artifact without checking
it for private content first.

## Parent/child boundary

A parent manager may read a child result but cannot block, finish, or otherwise mutate a child
owned by the other runtime. The narrow recovery exception is
`bridge_resume_delegated_task`: durable state must prove that the caller owns the direct parent
and created that child. The bridge then executes as the unchanged child owner. This permission
does not extend to unrelated tasks, siblings from another manager, or non-direct descendants.
After the child reaches a terminal result, the manager consumes it and finalizes its own root.
