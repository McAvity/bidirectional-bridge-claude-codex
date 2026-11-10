# Repository trial: 15 permission approvals

Read-only audit of the completed F-W21-repo-trial (2026-11-10). Evidence: private
hcom SQLite event history opened read-only/immutable, PTY output and the executor
transcript for the two failed commands and edited scopes. No raw transcripts,
account/session identifiers or private paths are included here. No worker was
started and no permission configuration was changed during this audit.

Exactly **12 Bash + 2 Edit + 1 Write** approvals, plus one separate repository
trust confirmation. Thirteen requests have a subsequent approved-tool event. Two
have tool-failed events; transcript output proves they were allowed to execute and
failed as commands, rather than being denied. Times below are CET.

| # | Time | Approved operation | Observation |
| --- | --- | --- | --- |
| 1 | 17:24:15 | Bash: read selected skill, hash/read contract | Necessary startup reads, bundled in shell. |
| 2 | 17:24:33 | Bash: verify bundle, read round instructions, Git status/HEAD | Failed on unquoted `echo ======` interpreted by zsh. |
| 3 | 17:25:06 | Bash: reread instructions, status/HEAD/date, list ledgers | Partly repeated #2; failed listing a ledger directory that did not exist yet. |
| 4 | 17:25:50 | Bash: tool versions, direct stderr reproduction, read test, evidence suite | Relevant before-change reproduction. |
| 5 | 17:26:24 | Edit: fixture stderr comment | Could be one edit with #6. |
| 6 | 17:26:40 | Edit: exit call changed to exitCode | Actual functional correction. |
| 7 | 17:27:06 | Bash: evidence suite, direct byte/framing check, runner suite | Main after-change checks. |
| 8 | 17:28:26 | Bash: evidence rerun, error filter, deadline-test read | Start of ancillary timing-test diagnosis. |
| 9 | 17:29:10 | Bash: another evidence run, log search, fixture read | Repeated diagnostic work. |
| 10 | 17:29:41 | Bash: read output, five evidence-suite runs | Repeated diagnostic loop. |
| 11 | 17:30:55 | Bash: save patch, substitute base fixture, six isolated deadline runs, restore patch | Active working file temporarily replaced for out-of-scope comparison. |
| 12 | 17:31:50 | Bash: eight evidence suites at base and eight after patch, log analysis | Largest expansion of diagnosis. |
| 13 | 17:34:06 | Write: new execution ledger | Required delivery evidence. |
| 14 | 17:34:31 | Bash: scoped Git add/commit and delivery checks | Useful explicit commit approval. |
| 15 | 17:35:10 | Bash: inline Python report generation, RESULT_READY send, date | Report generator abbreviated the required command. |

The PTY explained many Bash prompts as variables that could not be checked before
execution: repeated PATH interpolation, workspace/bundle variables, shell pipelines
and a shell pipeline-status expression. The final generator additionally triggered
an expansion-obfuscation warning. Hcom itself did not require all fifteen prompts.

## Changes and recommendations

Workflow1.1.1 adds a report scaffold, stable check IDs and read-only validation;
report generation no longer needs to reconstruct a multiline test command. Normal
successful shutdown goes through the guarded finish helper. Instructions now call
for a stable launch environment, simple commands/native reads, one coherent patch,
and bounded diagnosis instead of automatic test repetition. A still-failing check
must be reported honestly, not labelled a flake without evidence. A base comparison
should use a separate export/checkout rather than swap files in the active delivery.

These changes address avoidable work in #2–3, #5–6, #8–12 and #15. They do not promise
a specific future prompt count: host policy, environment and failures still matter.
Keep normal permission mode; a readable script is easier to review but is not an
execution sandbox or proof that its contents remain safe.

If more automation is desired, the optional next step is an explicit, narrowly
scoped **session-only** permission profile for reviewed file paths and commands.
Claude's `--settings` can supply session settings and `--allowedTools` can allow
specified operations without prompts. This release does not enable either option.
Avoid general Bash/Edit allowances and bypass mode. `Edit(path)` covers Write too;
`--add-dir` extends the accessible workspace, not read-only access to a bundle.
Do not use “don't ask again” as a presumed session-only change: it can persist
permissions shared with worktrees. See the official
[CLI reference](https://code.claude.com/docs/en/cli-reference),
[session settings](https://code.claude.com/docs/en/settings#change-a-setting-for-one-session)
and [permission rules](https://code.claude.com/docs/en/permissions).
