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

## Correction R02-01 (2026-09-19, correction round on base `8bdea85`)

The integration review [02-implementation](../reviews/02-implementation.md) found a false PASS
that the evidence above did not cover: the published scope checks used Git's default rename
detection. Everything earlier in this report is kept as recorded; this section supersedes the
AC-03 claim for renames and the `test_local_delivery.py` count.

| Item | Detail |
| --- | --- |
| Finding | `git mv lib/other.py app/other.py`: `git diff --name-only` and `git log --name-only` list only `app/other.py`; the deleted out-of-scope source was hidden and `receipt()` returned no findings (effective COMPLETE) |
| Same class, found here | an earlier ledger moved onto the new ledger path: the pathspec-limited `--diff-filter=A` check saw an add, the `MD` check saw a rename; no finding |
| Fix | `local-delivery.md` § 4.6/4.7 and § 2 `changed_scope`: `--no-renames` with `-z` path-safe output for the endpoint and per-commit lists; earlier ledgers = any path of `git ls-tree -r -z --name-only BASE -- <ledger dir>` touched in `git log --no-renames --name-only -z --format= BASE..HEAD -- <ledger dir>` (modify, delete, move away, edit-and-restore); `LEDGER=none` only for a read-only contract with `HEAD` = `BASE` |
| Regressions | outside→inside rename (scope, names `lib/other.py`), inside→outside rename, valid in-scope rename (passes, lists both paths), earlier ledger renamed onto the new ledger, earlier ledger edited and restored, committed paths with spaces; add-then-revert retained; `LEDGER=none` fixture now states read-only explicitly |
| Reproduction | `tests/test_local_delivery.py` sha256 `013bb94b…1da7af` with the unfixed transcription (base `8bdea85`, `local-delivery.md` `c5f57708…525ec639`): 36 run, 5 failed — the two rename-scope cases, the valid rename (endpoint lacked the source), the earlier-ledger rename (`[]`) and edit-restore |
| Fixed snapshot | `d3b5385` (`tests/test_local_delivery.py` `692024f9…0e56d4`, `local-delivery.md` `58504b2e…10beac095`, plugins regenerated) |

Validation on `d3b5385`: `python3 -m unittest discover -s tests -v` exit 0, 83 tests OK, 0 skipped
(36 in `test_local_delivery.py`); `npx vitest run` of the delivery, feature-workflow and
wave15-continuation files exit 0, 3 files / 29 tests; `npm run packages:check` exit 0 (digest
`828af404a292`). Not rerun: the full JS suite (582) and pilot suite (140) from `08ed5b2`; since
then only instruction text, generated plugins and this Python test changed, none of which those
suites execute beyond what `packages:check` and the Python distribution tests cover.

AC-03 after the correction: renames, earlier-ledger moves and edit-restore are now detected
mechanically; the behavioural part stays unverified (R16-N2).
