# Unblock a Claude child with a manager answer

`bridge_resume_delegated_task` accepts optional `message` text for a BLOCKED child
owned by the Claude adapter. The caller must own its direct parent and have created the
delegation. With a message, a nonblank `idempotency_key` is required.

```json
{
  "task_id": "<existing blocked child task ID>",
  "idempotency_key": "<unique key for this answer>",
  "message": "Choose option B. Continue within the existing scope."
}
```

The message must be nonblank and at most 8000 characters. Its exact bytes are persisted
in the recovery reservation alongside the recovered attempt number, inside the transaction
that reserves the attempt. The Claude prompt receives it as a manager clarification while
resuming the existing runtime session. Task objective, scope, owner and lineage remain
unchanged. The model is instructed to report conflicting requests rather than expand scope;
this is not a semantic proof that a natural-language answer preserves requirements.

Identical concurrent requests share the existing recovery. Repeating the same request after
completion or server restart returns the recorded outcome without redelivering the answer.
Reusing the key with a different message (including omission) is IDEMPOTENCY_MISMATCH.
A fresh message/key cannot reopen DONE. Existing recovery calls without message retain their
previous behavior and their idempotency hashes remain compatible.

This is limited to manager-authorized BLOCKED Claude children. It does not add messages to
direct-owner recovery, other runtimes, active WORKING tasks or completed tasks. Existing
handle checks, lease checks and strict-session resume still apply. A live orphaned worker
must be dealt with before recovery; expiration of a lease is not proof that it stopped.

The clarification text is local durable task input in SQLite. Do not put credentials in it.
It is not copied into telemetry or a shared transcript logger by this change.

This feature does not automatically restore a cleared /goal, modify a goal, or establish
that /goal is supported by the bridge's generated prompt. That remains a separate test.
