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
| Client timeout on `bridge_feature_run` | The round keeps running. Call `bridge_feature_get`; while `running`, wait and read again; when it ends, read the result with `bridge_get_task`. | Do not recover a running round, send a recovery `message`, or retry with a new key. |
| Child `BLOCKED` / `PARTIAL` | Consume useful evidence and blocker at the parent; resolve or report it. | Do not mutate the child as manager or upgrade it to complete. |
| `NOT_OWNER` | Stop the mutation; read state if needed. | Do not steal ownership, finish the task, or release another holder’s lease. |
| `SCOPE_CONFLICT` | Wait and recheck, narrow to disjoint scope, or return a blocker. | Do not steal or overlap the lease. |
| Validation failure | Correct the payload/result once using existing real evidence. | Do not rerun completed work or invent paths/checks. |
| Round `FAILED` with attempt outcome `TIMEOUT` | Read `bridge_get_task` and its `termination_evidence` file, confirm the worker stopped, then resume once with `recover_timeout`, a justified `deadline_ms` and `max_turns`. | Do not reopen any other `FAILED`, reuse the expired deadline implicitly, or repeat after a second timeout without a decision. |
| Failed recovery | Report the same task, new attempt, lineage, and exact reason. | Do not create a sibling task or fresh runtime thread. |

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
