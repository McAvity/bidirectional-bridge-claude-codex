# Hcom placeholder startup compatibility — 2026-11-12

Scope: user requested the compatibility fix and preparation of another isolated F-001
trial after c09841a blocked before dispatch. This is separate from F-W22, whose Gate 1
remains pending. Branch `fix/hcom-placeholder-startup`, base `1d19ca8`.

## Diagnosis and change

Hcom0.7.31 with Claude2.1.322 reads placeholder styling through vt100 dim attributes
(`aannoo/hcom`, source de33e31a, `src/pty/screen.rs:is_dim_after_prompt`). The coordinator
environment carried NO_COLOR=1. An independent fresh launch reproduced an idle composer
with a visible Try placeholder but prompt_empty=false. The archived failed-trial screen
also reproduces EMPTY_READY_TERMINAL_REQUIRED in the unchanged helper.

Fresh launch now removes NO_COLOR/CLICOLOR/CLICOLOR_FORCE and sets TERM=xterm-256color,
FORCE_COLOR=1 and HCOM_CLAUDE_DELIVERY=inject for that child command only. The bounded
same-session resume helper applies the identical environment. Parent/global settings,
permissions, model selection and readiness/receipt checks remain unchanged. No Try-prefix
heuristic, automatic Enter, force-ready or automatic worker replacement was added.
Existing workers are not silently changed; the failed trial stays historical.

## Actual compatibility check

Two startup-only diagnostic sessions, then one bounded transport message in the styled
session, in a disposable repository separate from all F-001 trials. Existing account,
auto, no repository task, no source edits. One initial folder trust was confirmed after
inspecting its exact path. The live task did not execute F-001 or the stderr fix.

| Check | Observation |
| --- | --- |
| Inherited display environment | Placeholder parsed as nonempty, reproducing failure |
| Styled child environment | Launch ready, prompt_empty=true, input_text empty |
| Actual draft equal to placeholder text | prompt_empty=false; helper correctly refuses |
| Clear only that diagnostic draft | Helper accepts empty prompt again |
| One hcom request/response | Request delivered; worker sent HCOM_STYLE_OK inform event |
| Normal exit | Styled worker stopped with exit:prompt_input_exit; both live lists empty |

Raw private evidence is outside Git in the operator's probe directory. No transcripts,
account details, session identifiers or machine settings are included here. This verifies
startup and communication on these installed versions, not a full feature receipt.

## Validation and delivery

- Hcom helper tests: 50/50 PASS, including refusal for the failed-screen shape and
  verification of resume child env with a deliberately hostile display environment.
- Generated candidate workflow: 1.1.4-234b644986e9,
  identity sha256:234b644986e93983420bb1f3f523667229a9c35bb83ae8a94371c00babbff5c2.
- Component source-equivalence PASS; canonical feature-execute skill validator PASS.
  Validator used the existing isolated PyYAML cache because system Python lacks PyYAML.
- Broader workflow tests initially ran under default Node25 and an aliased macOS tmp
  directory: copied ESM entrypoints exited without JSON. A targeted rerun on Node24
  with TMPDIR=/private/tmp passed. Correct-environment workflow run: 59/60 passed,
  one local HTTP/socket fixture was denied by sandbox. That exact case passed with
  local socket access; all60 cases are covered, not claimed a single all-green run.

No installed immutable bundle was edited. Candidate release only, not published.
## Independent review and retry handoff

Independent reviewer `/root/review_placeholder_fix`: **PASS**, exact change
`1d19ca8..961ad34`, no required corrections. Reviewed child-only env changes,
unchanged lifecycle/draft checks, generated source equivalence and private diagnostic
results. Independently ran startup14/14 PASS on Node24/Python3.12. No reviewer model
launch. Real resume was not exercised end-to-end; its argv/env are covered by tests.

After the user confirmed the terminal left the old directory, a cwd inspection found
no remaining holder. Previous trial c09841a and its private evidence were preserved in
the operator archive. A new independent repo now occupies the same trial path, branch
F-001-hcom-retry, single root commit `209434f`. No remote/alternates, AGENTS.md, custom
launcher, previous attempt ledger or hcom state. Sources/oracle/tests are byte-identical
to the pre-solution baseline; only the workflow lock and candidate wording changed.

The official begin helper published candidate1.1.4 alongside existing immutable bundles.
Installed plugin1.1.3 successfully resolves the new trial lock to that exact verified
bundle without standalone override or plugin refresh. Existing features remain unchanged.

Fresh baseline: offline npm ci/build PASS, runner64/64 PASS, evidence7/8 with only the
expected 65,536/100,001 byte failure; oracle fails bytes/tail while exit3/init-only pass.
No task model launched for this retry. Start a fresh coordinator in the trial root and
request “Wykonaj feature F-001 przez hcom.” Final feature receipt remains unverified.
The operator's preparation record contains absolute archive paths and private log hashes.
F-W22 remains at Gate 1; this hotfix is complete and no public release was made.
