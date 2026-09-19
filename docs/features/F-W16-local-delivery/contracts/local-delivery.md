# Local delivery contract (W16-01)

Status: proposed by W16-01; governs W16-02/03 once the coordinator's contract review
releases it. Authority: [execution decision](../decisions/01.md), plan
[wave16](../../../plans/wave16.md) (§ „Minimalny kontrakt lokalnej dostawy”), R16-N1 in
[plan review](../../../plans/wave16/reviews/01-plan.md). No public API, schema, adapter or
helper change. Applies only to rounds whose contract is issued under a runtime that ships
this contract; open 0.3.2 rounds keep their ZIP obligation (§ 8).

## 1. What survives normalization (R16-N1)

Source at `2d750c3b`. The executor's final JSON passes through
`parseStructuredOutput` → runner result → `ClaudeAdapter.finish/partial` →
`DeliverableService.submit` (schema, honesty gate) → one stored deliverable per task.

| Executor output | Retained as | Source |
| --- | --- | --- |
| `summary` | `deliverable.summary`, trimmed, first 4000 chars; also `deliverable.submitted` event payload | runner 532–535, 1032; deliverable-service 130–146 |
| `changed_scope` | `deliverable.changed_scope` verbatim (claim, not checked against Git) | runner 1033–1035; adapter 316 |
| `verification_results` | kept only if well-formed; malformed entries **dropped silently** | runner 503–530, 996–998 |
| `remaining_risks` | kept; with a blocker the blocker is prepended | runner 1038; adapter 284–297, 352 |
| `recommended_next_action` | kept on the success path; **replaced** by a fixed text when `blocker` is set | runner 1039–1041; adapter 365–366 |
| `blocker` | status PARTIAL → task BLOCKED | adapter 284–297; deliverable-service 165–189 |
| `verification_snapshot`, `reproduction_snapshot` | **not retained**; only validated, and visible in the report artifact when it exists | runner 1002–1019 |
| `commit_or_diff` and any unknown key | **dropped**; `commit_or_diff` is always `null` | runner 474–500, 1044 |
| Full final text | `claude-report*.md` artifact (sha256 in registry, `complete_report_sha256` metadata) only when text > 4000 chars or reproduction evidence exists | runner 556–585, 1019 |

Task id, attempt, contract (`task.spec`) and attempts are bridge-owned and read through
`bridge_get_task` (tools.ts 544–570; artifact integrity via `bridge_read_artifact`,
862–885). The prompt does not give Claude its own task id (runner 373–462), so the
executor never reports it. A resumed task overwrites its
deliverable row (sqlite-store 768–776); earlier summaries remain in
`deliverable.submitted` events and report artifacts.

Consequence: the only executor-controlled channel that always survives is the **start of
`summary`**. Base/head, ledger, outcome and tree state must be there.

## 2. Delivery line (the single format)

`summary` begins with exactly one line, keys in this order, single spaces:

```text
DELIVERY=local-v1 BASE=<40-hex> HEAD=<40-hex> LEDGER=<repo-path|none> OUTCOME=<COMPLETE|PARTIAL> WORKTREE=<clean|dirty:N>
```

- `BASE`: the full commit the contract names; copied, never chosen by the executor.
- `HEAD`: the full SHA of the final delivered commit (`git rev-parse HEAD`), taken after
  the last commit. The tested code is `HEAD`'s tree; if code changes after the checks,
  rerun them. Only the ledger may be committed after the checks.
- `LEDGER`: new `execution/<TASK>/<n>.md` committed in `BASE..HEAD`; `none` only when
  the contract has no write scope (then `HEAD` = `BASE` and findings go in `summary`).
- `OUTCOME`: `PARTIAL` whenever `blocker` is non-null or work is unfinished.
- `WORKTREE`: from `git status --porcelain=v1 --untracked-files=all` after the final
  commit; `N` = entry count. When dirty, add `remaining_risks` entries
  `UNCOMMITTED own: <paths>` and/or `UNCOMMITTED preexisting: <paths>` (each ≤ 2000
  chars, the schema limit; suffix `+K more` and list the rest in the ledger).

The rest of `summary` is prose. `changed_scope` lists the paths in `git diff --name-only
BASE HEAD`. An explicitly requested package adds a second line `PACKAGE=… SHA256=…
PURPOSE=… RANGE=BASE..HEAD` (§ 8). No other field, trailer or JSON key carries delivery data.

## 3. Coordinator receipt (before review)

Read `bridge_get_task`: deliverable, artifacts, attempts. In the executor worktree `W`:

1. **Parse.** `summary` line 1 matches § 2 exactly. Missing/malformed → no delivery;
   treat as PARTIAL, read the output artifact if any, never PASS.
2. **Status.** Effective outcome = the more conservative of `OUTCOME` and
   `deliverable.status` (the adapter downgrades on missing/failed checks,
   adapter 300–306). A mismatch is a finding.
3. **Base.** `BASE` equals the contract base byte-for-byte (full SHA in the contract);
   `git -C W rev-parse --verify BASE^{commit}`.
4. **Head exists and descends.** `git cat-file -e HEAD^{commit}`;
   `git merge-base --is-ancestor BASE HEAD`. Failure → ancestry failure.
5. **Range shape.** `git rev-list --merges BASE..HEAD` is empty unless the contract
   allows merges; `git log --format='%H %s' BASE..HEAD` is the round's commit list.
6. **Scope.** Every path from `git diff --name-only BASE HEAD` **and** from
   `git log --name-only --format= BASE..HEAD` (catches add-then-revert) matches the
   contract write scope. `changed_scope` is compared, but Git is authoritative.
7. **Ledger.** `git diff --diff-filter=A --name-only BASE HEAD -- LEDGER` lists it;
   no earlier ledger is modified (`--diff-filter=MD` on `execution/`).
8. **Worktree.** `git -C W status --porcelain=v1 --untracked-files=all`. Compare with
   `WORKTREE`. Uncommitted or untracked work is never part of the delivery.
9. **Evidence.** Count and commands of `verification_results` match the ledger (dropped
   malformed entries show up as a gap). Report artifacts: `bridge_read_artifact`
   integrity `ok`.

## 4. Review target and integration drift

- Review reads the code at `HEAD` (`git show HEAD:<path>` or a detached worktree /
  `git archive HEAD` export); never the branch tip or `W`'s working files.
- Reruns of checks happen on a clean `HEAD` export and are recorded with that SHA.
- If the integration tip `T` ≠ `HEAD`: `git merge-base --is-ancestor HEAD T` → drift
  is `HEAD..T`, described and tested separately, attributed to nobody by default.
  Not an ancestor (rewritten/reset) → record that the delivered SHA is not integrated;
  review `HEAD` if the object exists, otherwise delivery fails.
- Never reset, stash or clean someone else's work to simplify review.

## 5. Failure dispositions (no false PASS, no misattribution)

| Condition | Disposition |
| --- | --- |
| No/malformed delivery line, wrong `BASE`, `HEAD` absent | Delivery not accepted; correction or resume in the same session |
| `BASE` not ancestor, unexpected merge in range | Ancestry failure; do not attribute range commits to the executor |
| Path outside write scope (diff or any commit) | Scope failure; name paths; do not revert others' work |
| `WORKTREE` misreported, or in-scope work left uncommitted in a COMPLETE round | Finding; uncommitted bytes are not reviewed as delivered |
| Out-of-scope or preexisting dirt | Reported separately, not attributed, not cleaned |
| Ledger missing/edited earlier ledger | Finding; evidence incomplete |
| Authorship/scope cannot be confirmed | Resolve the concrete mismatch; never default to PASS |

## 6. PARTIAL, resume and corrections

- `blocker` set → PARTIAL, task BLOCKED. The ledger (outcome `blocked`) and completed
  in-scope work are committed and reported by `HEAD`; unfinished bytes are disclosed via
  `WORKTREE`, not lost and not presented as delivered. No package is exported.
- A resumed attempt of the same task keeps the contract `BASE` and reports a new `HEAD`
  and a new ledger; the review range stays `BASE..HEAD` (cumulative).
- A correction round is a new task: its contract names the previous delivered `HEAD`
  (or the integration commit it builds on) as `BASE`.
- COMPLETE ≠ review PASS ≠ user acceptance; the line changes none of these states.

## 7. No-code tasks and evidence integrity

- A diagnosis or "no change needed" result is valid: the range may contain only the
  ledger (or be empty with `LEDGER=none`). Absence of code changes is not a failure.
- A hash or path alone proves nothing. Evidence that matters and is not versioned must be
  committed in the write scope (the ledger dir) or preserved as an integrity-checked bridge
  artifact; the coordinator publishes it (`bridge_publish_artifact`) when the executor
  cannot. External files are cited with path + sha256 and re-hashed by the reviewer.
- Checks in `verification_results` are claims with exit codes; review decides whether
  to rerun them on `HEAD`.

## 8. Legacy ZIP rounds and optional exchange

- A round whose contract was issued under 0.3.2 (summary starts `PACKAGE=`) is completed
  and reviewed under 0.3.2: `feature_exchange.py verify --archive P --expect-purpose …
  --expect-feature … --expect-base BASE --expect-head HEAD`, then § 3 steps 3–9 and § 4
  with `RANGE` as `BASE..HEAD`. Integrity of the ZIP is not a code review.
- Outcome and tree state for legacy rounds come from `deliverable.status`, manifest
  `worktree_dirty_at_export` and `git status`.
- Contracts already open are not rewritten; historical ledgers, packages and decisions stay.
- Under the new contract, export/verify/inspect-return and the namespace helper remain for
  external handoff or explicit request; W15 intent/replay is unchanged, and a delivery line
  never starts a new round or idempotency key.
