# Recovery

Recovery continues an interrupted execution without inventing a replacement task or runtime
thread.

## Persisted handle model

Each attempt may store an opaque execution handle: a Claude session identifier or Codex
thread identifier. The adapter saves it as soon as the runtime exposes it. The control plane
caps and credential-screens the value, never parses it, and excludes it from events,
telemetry, proof exports, and user-facing reports.

## Recovery entry points

There are two explicit ways to request the same strict recovery operation. Both accept an
existing `task_id`, an optional idempotency key, and an optional per-attempt budget
(`deadline_ms`, `max_turns`) that applies to the recovery attempt only and never rewrites the
persisted contract. Caller identity is bound when the MCP process starts; neither operation
accepts an owner, agent, runtime, lineage, scope, or handle.

- `bridge_resume_task` is direct owner recovery. The bound caller must own the task.
- `bridge_resume_delegated_task` lets a manager request recovery of its direct delegated
  child. SQLite must prove that the caller owns the direct parent, created the child, and that
  parent and child have the expected same-run, adjacent-depth lineage. The caller must not be
  the child owner; an owner uses `bridge_resume_task`.

Manager authorization does not transfer ownership or make the manager the execution agent.
For delegated recovery, the child owner remains the identity used for adapter selection, task
transitions, attempt records, lease ownership, invocation callbacks, verification,
deliverables, telemetry, and handle persistence. Unrelated tasks, another manager's child,
and non-direct descendants are rejected.

After authorization, the control plane derives the owner, run lineage, write scope, previous
attempt, and persisted handle from SQLite. It then:

1. verifies that the task is stranded and recoverable;
2. rejects live or conflicting leases;
3. closes the interrupted attempt and creates the adjacent recovery attempt;
4. acquires a fresh lease over the original scope;
5. requires the adapter to resume the exact stored handle;
6. seals final telemetry and releases the lease on every exit path.

A stale handle, wrong returned handle, failed strict resume, timeout, or runtime crash does
not authorize a fresh thread. The task remains honestly blocked or failed according to the
recorded outcome.

## Rounds the bridge stopped at their deadline

A task the bridge itself ended at `deadline_ms` becomes `FAILED` with attempt outcome
`TIMEOUT`, and its session handle survives. `bridge_resume_delegated_task` reopens exactly
that case, and only with an explicit opt-in:

```
bridge_resume_delegated_task({
  task_id, recover_timeout: true, deadline_ms: 4500000, max_turns: 200,
  idempotency_key: "<feature>:<task>:timeout-recovery-1", message: "..."   // optional
})
```

All of the following must hold in durable state, in one transaction: the caller owns the
direct parent and created the child; the feature (if any) is bound to that manager, is not
`waiting_user`/`accepted`, and this is its latest task; the task is `FAILED`; its current
attempt has ended with outcome `TIMEOUT`, was recorded by the owner, and the FAILED
transition that followed it gives the deadline as its reason; attempt telemetry, when
present, records a timeout; a session handle is persisted; no later attempt, live lease or
active recovery exists; the adapter advertises `resume`. Anything else — a crashed runtime, a
rejected strict resume, a FAILED deliverable, a manual FAILED, a missing handle — stays
terminal, and `bridge_resume_task` never reopens a timeout at all.

`deadline_ms` is required here: the deadline that already proved too short is never reused
implicitly. The recovery keeps the task id, feature, owner, lineage, objective, scope and
runtime session; it adds one adjacent attempt, leaves the timed-out attempt's outcome and
telemetry untouched, and records the reopening as `FAILED -> WORKING` with reason
`timeout_recovery`. A recovery attempt that times out again ends `BLOCKED`, not `FAILED`.
Nothing about this is automatic: no retry budget triggers it, and repeating the request with
the same key replays the original result instead of running a second worker.

## Executor deadline and client tool timeout

Two independent limits, often confused:

- **Executor deadline** (`deadline_ms`): the bridge's own bound. At expiry the control plane
  aborts the invocation, the adapter terminates the runtime (SIGTERM, then SIGKILL after the
  kill grace), and the attempt ends `TIMEOUT`.
- **Client tool timeout**: how long the calling agent waits for the MCP response — Codex
  `tool_timeout_sec` (default 300 s; no maximum), Claude Code's per-server `timeout` in
  milliseconds (its stdio idle timeout defaults to 30 minutes). It never stops the round:
  the bridge keeps working and the call's result is read afterwards with
  `bridge_feature_get` and `bridge_get_task`.

Set the client timeout above the round deadline plus a margin for the kill grace, the
deliverable and the package check. A 75-minute round (`deadline_ms: 4500000`) therefore pairs
with `tool_timeout_sec = 5400` and `"timeout": 5400000`. Long rounds also need a turn budget:
`max_turns` is capped at 256, and the conservative default of 12 would end a long round early.

## Termination evidence

An attempt that ends without a normal result (deadline, cancel, missing result frame, runtime
error) leaves one JSON file next to the coordination database:
`<database dir>/evidence/<task_id>/attempt-<n>.json`, mode 0600, written once and never
overwritten. It holds the redacted last 16 KiB of the runtime's stderr, its total stderr byte
count, exit code/signal, kill flags, deadline, and stream counters (frame counts by type,
first/last output time). It never holds prompts, argv, frame content, transcripts or session
handles, and it is never returned as content through MCP: `bridge_get_task` shows only
`termination_evidence` metadata (path, bytes, sha256, termination kind, reason). Read it
locally, for example `jq . .bridge/evidence/<task_id>/attempt-0.json`. Files are kept until
someone deletes them; nothing rotates them. Redaction covers known credential shapes and
persisted session handles, which is a guardrail, not a guarantee.

## Operator workflow

1. Call `bridge_recover` to identify stranded state and expire dead leases.
2. Inspect the task with `bridge_get_task`; do not request or print its raw handle.
3. Choose exactly one path:
   - if the bound caller owns the task, call `bridge_resume_task` once;
   - if the bound caller owns the task's direct parent and created that child, call
     `bridge_resume_delegated_task` once from the manager client;
   - if that child is `FAILED` because the bridge deadline stopped it, add
     `recover_timeout: true` with an explicit `deadline_ms` (and `max_turns` when the round
     needs more turns), once the extra runtime is authorized.
4. Do not open the other native client merely for recovery. The bridge invokes the child's
   persisted owner/runtime internally; never use a direct CLI fallback or replacement child.
5. Verify the same task ID, owner, run, parent, depth, objective, scope, exact-session result,
   adjacent attempt, `resumed_from_attempt`, fresh worker-owned lease release, final state,
   and worker telemetry.

Before deciding, the local [diagnostics log](diagnostics.md) shows the same attempt from the
process side — when it started, which deadline it carried, how it ended and whether its evidence
could be written — and `bridge.mjs diagnose --task <id>` packages that view together with the
attempt records for someone else to read. Collecting it changes nothing and does not stop a
running worker; the export is never a recovery step.

Recovery semantics and state transitions are specified in [PROTOCOL.md](PROTOCOL.md) and
covered deterministically by `shared/control-plane/src/recovery.test.ts`. For symptom-first
guidance when a resume is refused, see
[troubleshooting.md](troubleshooting.md#strict-resume-fails).
