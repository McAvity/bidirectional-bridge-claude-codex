# Local delivery: bridge rounds through Git

Load this when a Claude round executed through the bridge delivers its work to a coordinator
that shares the repository. The executor side applies §§ 1–3, the coordinator §§ 4–7. The
delivered commits are the handoff: no ZIP, export or archive `verify` is needed. A
`feature-exchange` package stays available for a recipient without repository access or on
explicit request (§ 8).

## 1. Why the first summary line

The bridge keeps only part of the executor's final JSON. `summary` is stored trimmed to its
first 4000 characters. `changed_scope`, well-formed `verification_results` and
`remaining_risks` are kept; malformed check entries are dropped silently. With a `blocker` the
task becomes PARTIAL/BLOCKED, the blocker is prepended to `remaining_risks` and
`recommended_next_action` is replaced. `verification_snapshot`, `reproduction_snapshot`,
`commit_or_diff` (always `null` for Claude) and any unknown key are not stored; the full final
text survives only as a `claude-report*.md` artifact when it is long or carries reproduction
evidence. Task id, attempt and the contract (`task.spec`) belong to the bridge and are read with
`bridge_get_task`; the executor does not report them.

Delivery data therefore goes in the one channel that always survives: line 1 of `summary`.

## 2. Delivery line

```text
DELIVERY=local-v1 BASE=<40-hex> HEAD=<40-hex> LEDGER=<repo-path|none> OUTCOME=<COMPLETE|PARTIAL> WORKTREE=<clean|dirty:N>
```

Exactly this key order, single spaces, first line of `summary`; prose follows on later lines.

- `BASE`: the full commit named by the round contract, copied. The executor never chooses it.
- `HEAD`: `git rev-parse HEAD` after the last commit of the round.
- `LEDGER`: the new `execution/<TASK-ID>/<n>.md` committed in `BASE..HEAD`; `none` only when
  the contract grants no write scope (then `HEAD` = `BASE`, and the findings go in `summary`).
- `OUTCOME`: `PARTIAL` whenever `blocker` is non-null, work is unfinished or own work is left
  uncommitted.
- `WORKTREE`: `git status --porcelain=v1 --untracked-files=all` after the final commit;
  `N` = number of entries. When dirty, classify every entry (§ 3) in `remaining_risks` items
  `UNCOMMITTED preexisting: <paths>`, `UNCOMMITTED own: <paths>`, `UNCOMMITTED overlap: <paths>`
  and `UNCOMMITTED foreign: <paths>`; each item at most 2000 characters, overflow as `+K more`
  with the full list in the ledger.

`changed_scope` lists `git diff --name-only BASE HEAD`. When a contract explicitly requires a
package, its `PACKAGE=… SHA256=… PURPOSE=… RANGE=BASE..HEAD LEDGER=…` line comes second.

## 3. Executor procedure

1. At start record in the ledger: `BASE`, `git status --porcelain=v1 --untracked-files=all`,
   and `git hash-object <path>` of each dirty path inside the write scope. These are
   *preexisting* entries: not yours, not delivered, never cleaned, reset or stashed.
2. Do not edit a path that was dirty at start unless the contract assigns it; if the work needs
   it, stop with a blocker naming the path.
3. Implement, run the contract checks on the final code, write the ledger. Commit only your own
   in-scope paths, staged by name (`git add -- <paths>`, never `-A` or `.`). Only the ledger may
   be committed after the checks; if code changes, rerun them. Never push or merge.
4. Classify the final status against the start record: an entry present at start with unchanged
   bytes is `preexisting`; a new entry inside your write scope is `own`; a new entry outside it
   is `foreign` (not yours: you write only in scope); a start entry inside the scope whose bytes
   changed is `overlap` (attribution unresolved). Any `own` or `overlap` entry means
   `OUTCOME=PARTIAL`: unfinished executor work is never COMPLETE and never presented as delivered.
5. Finish with the delivery line. A `PARTIAL` round still commits its ledger (outcome `blocked`
   or `partial`) and completed work, so progress is not lost.

A diagnosis or "no change needed" task is a valid result: the range may contain only the ledger.

## 4. Coordinator receipt (before review)

Read `bridge_get_task`: deliverable, artifacts, attempts. In the executor worktree `W`:

1. **Parse** line 1 of `summary` against § 2. Missing or malformed: no delivery; treat as
   PARTIAL, read any report artifact, never PASS.
2. **Status**: the effective outcome is the more conservative of `OUTCOME` and
   `deliverable.status` (the adapter downgrades missing or failing checks). A mismatch is a finding.
3. **Base**: `BASE` equals the contract base (always a full SHA in the contract);
   `git -C W rev-parse --verify BASE^{commit}`.
4. **Head**: `git cat-file -e HEAD^{commit}` and `git merge-base --is-ancestor BASE HEAD`.
5. **Range**: `git rev-list --merges BASE..HEAD` is empty unless the contract allows merges;
   `git log --format='%H %s' BASE..HEAD` is the round's commit list.
6. **Scope**: every path of `git diff --name-only BASE HEAD` **and** of
   `git log --name-only --format= BASE..HEAD` (catches add-then-revert) matches the write scope;
   coordinator files (`feature.json`, `reviews/`, `decisions/`, task files) are untouched.
   `changed_scope` is compared, Git is authoritative.
7. **Ledger**: `git diff --diff-filter=A --name-only BASE HEAD -- <LEDGER>` lists it; no earlier
   ledger is modified or deleted.
8. **Worktree**: `git -C W status --porcelain=v1 --untracked-files=all`, compared with
   `WORKTREE`, the classification and the ledger's start record (and the dirt you recorded
   when issuing the contract). Uncommitted bytes are never part of the delivery.
9. **Evidence**: the checks in the ledger match `verification_results` (a dropped malformed
   entry shows up as a gap); report artifacts read through `bridge_read_artifact` show integrity `ok`.

## 5. Review target and integration drift

- Review the code at `HEAD` (`git show HEAD:<path>`, a detached worktree or a `git archive HEAD`
  export), never the branch tip or `W`'s working files. Rerun decisive checks on a clean `HEAD`
  export and record that SHA.
- If the integration tip `T` differs from `HEAD`: when `git merge-base --is-ancestor HEAD T`
  holds, the drift is `HEAD..T`, described and tested separately and attributed to nobody by
  default. Otherwise record that the delivered SHA is not integrated; review `HEAD` if the object
  exists, else the delivery fails.
- Never reset, stash or clean someone else's work to simplify review.

## 6. Dispositions: no false PASS, no misattribution

| Condition | Disposition |
| --- | --- |
| No or malformed delivery line, wrong `BASE`, `HEAD` absent | Not accepted: correction round or resume of the same task |
| `BASE` not an ancestor, unexpected merge in the range | Ancestry failure; range commits are not attributed to the executor |
| Path outside the write scope in the diff or any commit | Scope failure; name the paths; do not revert others' work |
| `own`/`overlap` dirt or misreported `WORKTREE` in a COMPLETE round | Required finding; uncommitted bytes are not reviewed as delivered |
| `preexisting` dirt, including paths inside the scope, and `foreign` dirt | Reported separately, not attributed to the executor, not cleaned; `foreign` dirt is checked against other leases |
| Ledger missing, or an earlier ledger edited | Finding: evidence incomplete |
| Authorship or scope cannot be confirmed | Resolve the concrete mismatch; never default to PASS |

## 7. PARTIAL, resume, corrections and evidence

- A resumed attempt of the same task keeps the contract `BASE`, adds a new ledger and reports a
  new `HEAD`; the review range stays cumulative `BASE..HEAD`. Earlier summaries remain in the
  task's `deliverable.submitted` events.
- A correction or next round is a new task whose contract names the previously delivered `HEAD`
  (or the integration commit it builds on) as `BASE`.
- COMPLETE, review PASS and user acceptance stay three separate facts.
- A hash or path alone proves nothing. Evidence that matters and is not versioned is committed in
  the write scope or preserved as an integrity-checked bridge artifact (the coordinator publishes
  it when the executor cannot); external files are cited with path and SHA-256 and re-hashed by
  the reviewer. `verification_results` are claims with exit codes; review decides what to rerun.

## 8. Contracts that still require a package, and optional exchange

- A round contract that explicitly requires a package (every contract issued under a runtime
  before this procedure) is followed literally: export and `verify` as `feature-exchange`
  describes, `PACKAGE=…` line as the contract states. The reviewer verifies the archive with
  `--expect-base BASE --expect-head HEAD` and also applies §§ 4.3–4.9 and § 5 with the `RANGE`
  values; integrity of an archive is not a code review. Outcome and dirt of such rounds come from
  `deliverable.status`, the manifest's `worktree_dirty_at_export` and `git status`.
- Open contracts, historical ledgers, packages and decisions are never rewritten.
- Export, `verify`, `inspect-return` and the exchange namespace remain for recipients without
  repository access and for explicit requests. Coordinator intent files stay in that namespace;
  a delivery line never starts a round, retries one or creates an idempotency key.
