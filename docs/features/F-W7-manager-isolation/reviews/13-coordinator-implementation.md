# Review13 — independent coordinator review: REWORK

Reviewed delivery d5ea3ca, range 511d7de..d5ea3ca; W7-ID-02 and final correction
(task_<historical-4> per review12). Reviewer: coordinating Astra from the main checkout,
independent of the implementation executor and the wave7 manager's implementation turns,
but involved in earlier workflow/recovery decisions. No product fixes or acceptance applied.

## Evidence checked

Read brief, contract identity r6 (relevant lifecycle, roles, workspace and test sections),
decision07, integration04 and review12; inspected manager-registry, identity-runtime,
workspace-state/identity, server/tool dispatch and feature/orchestrator mutation boundaries.

Final package verified against feature docs/features/F-W7-manager-isolation,
purpose implementation-review, base 511d7de6fe388113e13558840ac747f1e7045834,
head d5ea3ca53dc9f1adc1fc4e2d1c2d7c7d9f2ffcd4.
SHA256: 89a4e4c7dcffb6d6c7ae6777be57e464dbef90650d42cf4142199455fb4e9b63.
Verify passed: clean export, matching code range, no missing/changed supplied documents.
First verify invocation mistakenly used the feature slug instead of the required full path;
corrected invocation passed. This was a reviewer invocation error, not a delivery defect.

Independent execution: npm test 387/387 (28 files), exchange 19/19, pilot tooling 110/110,
including scripted dry run. No model launched, no feature database accessed or changed.
Build PASS is retained from review12, not rerun here. Product HEAD remained d5ea3ca.

## R13-01 — required: complete package isolation promised by AC-04

Requirement: brief AC-04 includes separate artifacts/packages for two Git worktrees.
Contract section13 instead says packages stay in ~/tmp. feature-exchange/SKILL.md line12
recommends unique feature/purpose/run names but requires no worktree namespace; examples
use ~/tmp/F-001-plan-review-01.zip. The exporter takes an arbitrary --output and opens it
with ZipFile(..., 'x') (script lines186–190). Neither the package path nor its naming rule
is bound to the resolved worktree.

Two independent worktrees can legitimately reuse feature and round names. Following the
same documented output convention makes the second export collide with the first. Exclusive
creation prevents silent overwrite (good), but does not provide independent package paths.
The reported AC-04 coverage therefore overstates delivered isolation outside the DB.
This is a mismatch between brief and contract/instructions, not a demonstrated bypass of
manager or database ownership checks.

Required resolution: define a deterministic worktree-specific exchange namespace (it may
remain under ~/tmp), use it consistently in round contracts and export/staging instructions,
and add a small two-real-worktree regression using identical feature/purpose/run names:
both exports must coexist, and each package must verify against its own source range.
Preserve historical archives and caller-specified output paths under the agreed policy.
Do not build an installer or redesign the exporter unnecessarily. If package isolation is
intentionally deferred, obtain an explicit scope decision and narrow AC-04/claims instead
of marking that requirement PASS.

## Other findings and limits

No additional concrete blocking defect found in the inspected native binding, CAS takeover,
instance fencing, reservation guards or derived response paths. Earlier R11 closures appear
consistent with code and passing regressions; this is not proof against all schedules.

Codex host adapter is pinned to exactly0.154.0; local POSIX-locking filesystem is a prerequisite.
Protection is against accidental session mixups, not malicious same-UID callers. Real two-model
pilot remains a release gate, not grounds for pretending synthetic evidence is real.

This is an isolated delivery based on the pre-wave9 runtime. Timeout-recovery source is not
integrated here: docs alone do not make recover_timeout available. Before deployment, integrate
with current feature-workflow in a separate branch and recheck ownership guards together with
FAILED/TIMEOUT recovery. Do not replace the live pinned runtime with this branch as-is.

## Recommendation

Close R13-01 with a focused correction/review (or an explicit scope decision). Do not accept,
merge or deploy automatically. The new review file is the only working-tree change made here;
it is left uncommitted for the wave7 coordinator to record separately from executor output.
