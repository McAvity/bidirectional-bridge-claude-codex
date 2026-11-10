# Shared boundary for one delegated round

This reference is for an executor given one explicit round contract, through Bridge or hcom.
Read its objective, governing decision, write scope, base revision, checks and ledger location.
Complete only that round. A correction is a new contract; preserve earlier work and ledgers.
The coordinator owns feature.json, task statuses, reviews, decisions and the user channel.
Do not delegate, call Bridge tools, arrange independent self-review or start the next task.

Use the exact selected instruction set supplied for the round. Missing or mismatched
instructions block dependent work; a newer installed plugin is not a replacement.
Record the instruction identity in the new ledger. Scope is an instruction, not an OS sandbox.

Deliver committed, bounded work using [local-delivery.md](local-delivery.md) §§2–3:
record starting Git state and base, preserve unrelated changes, run the contract checks,
write a new ledger and commit only named in-scope paths. The local-v1 line identifies the
actual delivered commit range. Own unfinished work or a question outside the contract
means PARTIAL with an explicit blocker, never fabricated success. No push or merge.

The transport-specific entry specifies the final envelope and how it is sent. Bridge
retains its existing JSON adapter and workflow-binding rules. Hcom uses a report file and
notification; neither transport's “complete” replaces coordinator review or user acceptance.
