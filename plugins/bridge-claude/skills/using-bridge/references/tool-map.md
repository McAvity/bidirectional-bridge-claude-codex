# Bridge tool map

Use the live MCP schema as the final authority. Load this map only when the exact tool purpose or expected use is unclear.

## Common manager flow

| Tool | Use |
|---|---|
| `bridge_server_info` | Confirm bound caller and delegation policy once per fresh session. |
| `bridge_create_task` | Create a depth-0 manager root with objective, scope, dependencies, deliverable, and verification criteria. |
| `bridge_claim_task` | Atomically own the root. Claiming is not write permission. |
| `bridge_set_state` | Move the owned root to `WORKING`. |
| `bridge_acquire_lease` | Acquire scope before manager file writes. Delegated child leases are automatic. |
| `bridge_delegate` | Create and execute one bounded child through the opposite runtime. |
| `bridge_submit_deliverable` | Finalize the owned root with structured result and real verification. |
| `bridge_release_lease` | Release a manually acquired manager lease. |

## Feature rounds (Codex manager, one Claude session)

| Tool | Use |
|---|---|
| `bridge_feature_create` | Pin a feature to the owned root; launches nothing. |
| `bridge_feature_get` | Read state, ordered round task ids and the pending question. Call first after any interruption. |
| `bridge_feature_run` | Launch one round; after `DONE` it strictly resumes the same Claude session in a new task. Same key replays. |
| `bridge_feature_wait_user` | Persist a blocking question for the user; nothing is sent to Claude. |
| `bridge_feature_answer_user` | Record the user's answer; launches and forwards nothing. |
| `bridge_feature_accept` | Accept after the acceptance decision; no rounds afterwards. |

## Conditional task and coordination tools

| Tool | Use |
|---|---|
| `bridge_list_tasks` | Check for duplication or unknown state; avoid routine polling. |
| `bridge_get_task` | Inspect one task after ambiguity, interruption, or recovery; `termination_evidence` gives the local file path for an attempt that ended without a result. |
| `bridge_check_scope` | Plan around possible concurrent writes without mutating state. |
| `bridge_renew_lease` | Extend an unusually long active lease; cannot revive an expired lease. |
| `bridge_report_status` | Record meaningful milestones, not narration. |
| `bridge_publish_artifact` | Publish an owned, in-scope output; inline limit is 64 KiB. |
| `bridge_read_artifact` | Read a declared input or result artifact. |
| `bridge_record_verification` | Persist real verification incrementally; submission may carry it directly. |
| `bridge_block_task` | Block an owned task honestly. Never block another owner’s child. |
| `bridge_add_dependency` | Add a dependency to a task the agent controls; cycles are rejected. |
| `bridge_snapshot` | Inspect counts, ready tasks, adapters, and live leases when concurrency matters. |

## Recovery and debugging tools

| Tool | Use |
|---|---|
| `bridge_recover` | Expire dead leases and report stranded tasks; it does not retry work. |
| `bridge_resume_task` | Strictly resume one owned, recoverable task using persisted runtime state; optional `deadline_ms`/`max_turns` bound that attempt only. |
| `bridge_resume_delegated_task` | Let a direct parent owner request strict recovery of its delegated child; the child owner remains the execution identity. With `recover_timeout: true` plus an explicit `deadline_ms` it reopens a child the bridge stopped at its deadline; no other `FAILED` is eligible. |
| `bridge_read_events` | Read a targeted event history; do not busy-poll. |
| `bridge_query_telemetry` | Query final attempt telemetry after completion when requested or diagnosing. |
| `bridge_set_execution_handle` | Adapter/recovery plumbing; avoid ordinary manager use. |
| `bridge_get_execution_handle` | Sensitive debug-only access; never expose the value. |

Mutating tools generally support idempotency keys. Replaying the same key and payload returns the original result; reusing a key with different data yields `IDEMPOTENCY_MISMATCH`.
