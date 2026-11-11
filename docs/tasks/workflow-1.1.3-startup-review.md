# Workflow 1.1.3 startup review

PASS after corrections, 2026-11-11. The local startup/prepare/repair invariants are
covered; no required finding remains. This is an independent code/protocol review,
not evidence that a new real Claude session completed the released workflow.
The user still owns product acceptance. No model, real worker or private trial state
was launched or mutated by this review.

## Scope and independence

Reviewer was separate from the implementing coordinator. Reviewed working changes
from e457ce31fbdf66339cdcc0a860ce2653a185183a in fix/hcom-startup, focused on canonical
hcom_startup.py, hcom_state.py, hcom-loop.md and startup tests. No code edits by reviewer.
Inspected hcom0.7.31 source (de33e31a0cdbba4c5863f7cc050d8b79aa50bcdf), especially
commands/events.rs, commands/list.rs, commands/resume.rs, delivery.rs and
instance_lifecycle.rs, to check actual CLI schemas and state transitions.

Reviewed helper SHA256 before optional robustness follow-up:
- hcom_startup.py: b9d741568cc8c87ab90daee54cf4b4b3bfcf69b73766ed37db00169f1c59eacf
- hcom_state.py: efa62ceeaf67a4315e420dacd8bb5de276b2411d643461bf7c1d0684af68c0f7
- hcom-loop.md: 84e3679a995f4ecf44c46d1810b09a998162b151cdd2a9182f2d5802ecda7bfc

## Findings and dispositions

R113-01 (required, resolved): stop originally required listening, whereas native-mod
startup failure can set blocked/launch_blocked. Stop now permits only that narrowly
identified startup-blocked state as well as listening, still with exact binding,
zero rounds/messages and a ready empty terminal. Check/prepare remain listening-only.
Regression covers this state and rejects approval/tool/unknown blocked states.

R113-02 (required, resolved): resume originally read event.timestamp; hcom events
--full emits event.ts. Guard and fixture now use the real CLI field. Added integration
probe initializes an isolated synthetic hcom database, observes actual installed CLI
output, and feeds it into the guard; lifecycle operations remain stubbed.

R113-N01 (nonblocking robustness): malformed external JSON containers, such as null
rows/events/data, can raise AttributeError instead of a structured refusal in the
reviewed snapshot. They fail before resume, so this is not unsafe execution or a
required correctness fix. Prefer explicit object checks and a malformed-input test.
Any follow-up should retain the fail-closed order and be recorded below.

## Validation and reasoning

Independently ran startup suite12/12 PASS, then the added installed-hcom event-schema
probe1/1 PASS. These use fake workers; only the latter invokes actual hcom read/query
commands in a temporary synthetic namespace. No real-agent-path PASS claim.

The shared nonblocking state lock excludes competing prepare while stop/resume acts.
Durable exclusive intents precede side effects and survive command failures. Prepared
but unacknowledged rounds and any namespace messages forbid repair. Stop requires exact
name/native ID/workspace and a ready empty terminal. Resume requires the subsequent
same-session normal-stop event and absence from live instances. Tracked hcom resume
preserves native identity and saved CLI arguments; only delivery is overridden to
inject. Old readiness snapshots cannot pass prepare after stop or resume. A successful
resume itself grants no dispatch; a new live readiness snapshot is mandatory.

Remaining operational limits are explicit: readiness checks PTY/bindings, not model
acknowledgement; a coordinator must inspect direct terminal/transcript activity before
repair; ambiguous commands are not retried; unrelated recovery and post-dispatch task
replay remain outside this path. Package equivalence/full suite/release verification
belong to the implementing coordinator's checkpoint. Recommend continuing those steps.

## Follow-up review — 2026-11-11

R113-N01 resolved. Inspected explicit list/item/object guards for live rows, the
normal-stop event, its data and snapshot before field access. Malformed external
containers now produce the structured refusal before resume intent or command.
The added regression covers null/missing/truncated events and a null live-list item;
implementer reports the focused test passed. No additional execution was needed for
this narrow follow-up. Required R113-01/R113-02 fixes and side-effect ordering remain
intact. Final verdict PASS; no open review finding.

Updated reviewed hcom_startup.py SHA256:
`ab789489b695f08f9aa088b2cd7310bbb61babc0d1a1b68a2b6336fbbc9ed435`.
The hcom_state.py and hcom-loop.md hashes above remain unchanged. This follow-up
still makes no real-model, package-release or fresh-client activation claim.
