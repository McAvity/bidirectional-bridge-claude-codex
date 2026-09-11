# Claude verification after a repair

The Claude runner's final JSON distinguishes two sets of checks:

- `reproduction_results`: checks on the pre-fix code, including expected failures.
- `verification_results`: acceptance checks on the final code after all edits.

When `reproduction_results` is nonempty, provide `reproduction_snapshot` and
`verification_snapshot`, each identifying the tested code by commit or SHA-256 with
file paths. For a multi-file change use a hash of an identified source manifest.
The two snapshot identities must differ. Capture the identities before running their
checks; rerun final checks if the source changes afterwards.

```json
{
  "reproduction_snapshot": "ranges.mjs SHA-256 <actual pre-fix digest>",
  "reproduction_results": [
    {"kind":"test","command":"node --test","passed":false,"exit_code":1,"summary":"pre-fix: 3 failures"}
  ],
  "verification_snapshot": "ranges.mjs SHA-256 <actual final digest>",
  "verification_results": [
    {"kind":"test","command":"node --test","passed":true,"exit_code":0,"summary":"final: 8 passed"}
  ]
}
```

These are additions to the Claude runner's report contract, not new fields in the neutral
Deliverable schema. Historical results and both snapshot references are preserved in a
report artifact, even when the report is short. Only final checks enter the canonical
`verification_results` and completion gate. Missing or ambiguous snapshot references
block completion when historical results are supplied. Historical evidence alone cannot
complete a task, and a failing final check still blocks it.

Snapshot references and check results are runtime-authored claims. The runner validates
their format and separation; it does not independently hash the workspace or execute the
checks. Independent review remains necessary. In particular, a valid-looking digest is
not proof that a check ran on those bytes.

Older reports remain supported. An unclassified red/green pair in `verification_results`
still yields PARTIAL. No interpretation of prose or last-green-wins rule is used.
The control plane now deduplicates identical evidence only: a same-command passing
submission cannot overwrite a different recorded failure. Integrations that previously
relied on that overwrite must separate reproduction evidence before submission.
