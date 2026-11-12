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
  with TMPDIR=/private/tmp passed; full workflow rerun is pending below.

No installed immutable bundle was edited. Candidate release only, not published.
Independent review and fresh test preparation are the next steps. Retain the old trial
and its state; prepare a new independent root from its pre-solution baseline, pinned
to the candidate, with no AGENTS.md or custom project launcher. Do not execute F-001
during preparation. User will start the independent agent with the minimal prompt.
