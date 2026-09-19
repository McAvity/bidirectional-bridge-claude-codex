# W16-03 report — local delivery regressions and acceptance evidence

Scope: model-free regressions for the wave16 local delivery procedure, investigation of the
review inputs from [reviews/02-implementation.md](../reviews/02-implementation.md), and AC-01–08
coverage for [wave16](../../../plans/wave16.md). Executed by Claude as bridge round W16-03 under
the [execution decision](../decisions/01.md); not an independent review, not user acceptance.

## Tested revisions

| What | Revision |
| --- | --- |
| Round base (contract) | `d4e8b7b18631ec61789c6391399d0e747c81e900` |
| Tests, clarified instructions, regenerated plugins | `08ed5b2794fdb67f03f4f8394a2efbd7e81bd6fe` |
| Delivered head (adds this report and the ledgers, docs only) | reported in the round summary; docs-sensitive checks rerun there |

No production source changed in wave16: `git diff --name-only ef90b8d HEAD -- shared claude
codex scripts tools`, excluding `*.test.ts` and `test/fixtures/`, is empty (`ef90b8d` =
feature-workflow tip merged into wave16). Builds ran in this checkout only; the supervising
runtime was not rebuilt or inspected for changes.

## New regressions

1. `claude/claude-side/src/adapters/claude-code-runner.delivery.test.ts` (7 tests) with fixture
   `claude/claude-side/test/fixtures/scripted-claude-cli.mjs`. A scripted stream-json CLI runs
   real `git` commands in a temporary repository; the real `ClaudeCodeRunner`, `ClaudeAdapter`,
   `Orchestrator`, `FeatureWorkflow` and `DeliverableService` store the result. It replaces the
   temporary `/tmp/w16probe` probe of W16-01 (cases P1–P6 preserved) and adds:
   - the delivery line names commits that exist, descend from the base and match the diff;
   - `OUTCOME=PARTIAL` with `blocker: null` and passing checks is stored COMPLETE, task DONE;
   - one session across a blocked attempt, its keyed recovery (manager message delivered,
     `--resume` with the same session id, new ledger, cumulative `BASE..HEAD`, earlier PARTIAL
     line kept in `deliverable.submitted` events) and a correction round with the delivered head
     as new base (new task, same session, continuation prompt).
2. `tests/test_local_delivery.py` (30 tests). `receipt()` transcribes the coordinator commands
   of `local-delivery.md` § 4 and runs them against real temporary repositories; `drift()`
   covers § 5. It is test code, not a product helper. Cases: correct delivery; missing/malformed
   line; base other than the contract base (even an ancestor); unknown base or head; head not
   descending from base; merge in range (allowed only by contract); claimed PARTIAL vs stored
   COMPLETE; out-of-scope final diff; add-then-revert visible only per commit; foreign commit
   inside the range named with its SHA; coordinator record touched; missing ledger, edited
   earlier ledger, ledger amended inside the round; ledger-only (no-code) result; `LEDGER=none`;
   preexisting in-scope dirt; staging a preexisting path (letters change, bytes do not);
   own untracked, staged, deleted and `rm --cached` paths; overlap; a preexisting path committed
   by a bare `git commit`; foreign dirt; misreported `WORKTREE`; renames and paths with spaces;
   later integration drift; rewritten integration branch; explicit export of the delivered head
   after drift (namespace path, `verify --expect-base/--expect-head`, default head would include
   the drift); explicit return inspected into namespace staging without touching the repo; two
   guards that the tested commands and line format are the published ones.

Reused, not duplicated: `shared/control-plane/src/wave15-continuation.test.ts` (W15 intent files
and identical replay, keyed recovery, no duplicate round), `feature-workflow.test.ts`
(DONE → new round, waiting_user, explicit acceptance), `scripts/bridge-project/bridge-project.test.ts`
(intent files in the exchange namespace), `tests/test_feature_exchange.py` (export, verify,
inspect-return, namespace isolation) and `tests/test_plugin_distribution.py` (generated packages).

## Findings from the investigation and clarifications made

Each clarification in `local-delivery.md` (and short pointers in `feature-execute` SKILL and
`bridge-loop.md`) is backed by a case above; F2 and F3 first surfaced as failures of this
round's own draft tests, which assumed the naive commands were enough. Plugins were regenerated.

| ID | Evidence | Clarification |
| --- | --- | --- |
| W16-03-F1 | vitest: claimed `OUTCOME=PARTIAL` without blocker is stored COMPLETE/DONE | `OUTCOME=PARTIAL` always carries a blocker; coordinator treats a PARTIAL line on a DONE task as effective PARTIAL and routes a correction round |
| W16-03-F2 | `test_a_plain_commit_sweeps_an_already_staged_foreign_change_into_the_delivery`: `git add -- <own>` + bare `git commit` committed someone else's staged file | commit with the pathspec: `git commit -m <message> -- <paths>` (executor and coordinator) |
| W16-03-F3 | rename/space and `rm --cached` cases: plain porcelain quotes paths, a rename line names two paths, one path can have two records | use `git status --porcelain=v1 -z`; `WORKTREE=dirty:N` counts records; classify both rename paths |
| W16-03-F4 | preexisting path committed by the range passes every scope check | receipt step 8 and dispositions: a start-dirty path changed by the range is a required finding |
| W16-03-F5 | deleted own/preexisting paths cannot be hashed | fingerprint `deleted` in the start record; classify by path and bytes, not status letters |

No production helper was added: the receipt is about ten `git` commands and the transcription
shows them sufficient and deterministic. A shared helper would need a demonstrated consumer
beyond the coordinator's manual review; none was found.

## Acceptance coverage

"Mechanical" = demonstrated by model-free tests on real Git/control-plane code. "Behavioural" =
whether Claude and Astra actually follow the instructions; no model ran (R16-N2), so every
behavioural part is **unverified**.

| AC | Mechanical evidence | Behavioural status |
| --- | --- | --- |
| AC-01 no export/ZIP/import/verify for a local task | delivery vitest: commits delivered and stored with no exchange step; instructions make packages contract-only (W16-02) | unverified: needs a real round without ZIP |
| AC-02 contract, base/head, ledger, checks, result; scope confirmed before review | normalization cases; receipt base/head/ledger/scope/evidence cases; contract and task/attempt are bridge-owned (`bridge_get_task`) | unverified: coordinator must run the receipt |
| AC-03 no false PASS / misattribution | receipt: wrong/unknown base or head, ancestry, merges, out-of-scope incl. add-then-revert and foreign commits, dirt classes, preexisting committed, drift and rewritten branch; F1–F5 | partially: the checks detect, a reviewer must act on them |
| AC-04 review, corrections, continuation on existing states; role split | delivery vitest PARTIAL → recovery → correction; wave15 and feature-workflow tests | unverified for model roles |
| AC-05 no final ZIP; COMPLETE ≠ review ≠ acceptance | feature-workflow explicit-acceptance test; instructions (short handoff) | unverified |
| AC-06 explicit export/return with integrity and conflicts; old evidence unchanged | exchange suite; delivered-head export and return staging cases; no historical ledger/review/decision modified in wave16 (`git diff --diff-filter=MD ef90b8d HEAD -- docs work-items` lists only the canonical guides and coordinator HANDOFF/progress) | mechanical complete |
| AC-07 W15 intent/replay and namespace; no new duplicate path | wave15-continuation, bridge-project intent regression, namespace tests; no production code change | mechanical complete |
| AC-08 README, roles, plugins consistent; standalone execute kept | packages:check (source equivalence), link check, distribution tests; only executor section and Finish of feature-execute changed | consistency of wording is reviewer judgement |

## Validation (code snapshot `08ed5b2`)

Run on 2026-09-19 in this checkout after `9a9981f` (attempt-1 ledger only; code identical to
`08ed5b2`). The first attempt's full-suite run was interrupted before `npm test` finished and is
not counted.

| Command | Exit | Result |
| --- | --- | --- |
| `npm ci --ignore-scripts && npm run build` | 0 | install and `tsc --build` of this checkout |
| `npm test` | 0 | 38 files, 582 tests passed (base: 37 files, 575 tests) |
| `python3 -m unittest discover -s tests -v` | 0 | 77 tests OK, 0 skipped (30 in `test_local_delivery.py`) |
| `python3 -m unittest discover -s tools/pilot/tests -v` | 0 | 140 tests OK, 0 skipped |
| `npm run packages:check` | 0 | packages match their canonical sources (digest `bc6f05a279c7`) |

Link check, `git diff --check` and the package export/verify ran on the delivered head; see
the attempt-2 ledger and the round summary.

## Limits

- The synthetic CLI and the Python transcription prove transport, storage and the Git
  commands; they do not prove that a model writes the line, commits by pathspec, classifies
  dirt, or that the coordinator performs the receipt.
- `glob_re` ports `shared/protocol/src/scope.ts`; a divergence would only affect these tests.
- Model smoke was not run (not authorized); W15 smoke obligations remain separate.
- This round itself followed the pinned 0.3.2 instructions (ZIP package), as its contract required.
