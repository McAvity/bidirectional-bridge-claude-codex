# Review15 — R13-01 final correction: PASS

R13-01 resolved; R14-01 and R14-02 resolved. Per-worktree package and staging namespaces now
satisfy the focused correction in decision08. Recommend user acceptance of the integrated delivery;
this review does not grant it. No merge or runtime deployment.

Coordinator Codex reviewed independently of Claude execution, not independently of coordination.
A separate read-only Codex reviewer rechecked Git environment selection, namespace guards and tests,
and returned PASS without product edits. This review traces the exchange correction, retaining
review12/13's earlier manager-identity conclusions and limits rather than claiming a new full audit.

## Exact delivery and provenance

Round8 task_<historical-2> DONE: 61396c517e062704da93985da3f685ac9d3df077..
493430578d4d51b23b23d30da3bc285a6dbc443b; review14 recorded separately at cc2a73b.
Round9 task_<historical-3> DONE: cc2a73b757ee586fc9b660d591d0fef1d5f44bde..
4dea37c578f0aeaf25351dd53ca47dfba71d8ff0. Executor touched four authorized files in round9;
no coordinator records or historical ledger edits. Full correction actual diff inspected.
Privately compared persisted execution handles for round7/8/9: present and equal; no native ID
or transcript is included here.

Both namespace packages independently verified with exact feature, corrections-review purpose,
base and head. Both clean at export, no changed/missing supplied documents, repository code range
matches. Namespace: ~/tmp/bridge-exchange/ws_<historical-worktree-hash>/packages/.

- F-W7-manager-isolation-round-8.zip SHA256:
  cae06dd51c9d6d8ae7173dfd66c63345166a2005e58cb6658c7b7ad816af4e8e (12 code changes).
- F-W7-manager-isolation-round-9.zip SHA256:
  4e11447fc35afebb781aa2be8ca73e50bed942c041bc127631b119875adbb493 (4 code changes).

Independent byte hashes: all11 historical archives captured before round8 unchanged after both
rounds; round8 itself unchanged after round9. No archive moved, renamed or overwritten.

## Findings and acceptance coverage

**R13-01 resolved.** Helper computes ws_ + first16hex SHA256(canonical root + NUL + canonical
per-worktree gitdir), aligned with workspace identity. Read-only namespace lookup creates no state
and claims no ownership. --name/--stage-name apply packages/staging directories; incoming has its
own namespace location. Two REAL Git worktrees reuse identical feature/purpose/round filenames:
both ZIPs coexist, verify against their own differing code ranges, and crossed expected head fails.
Same staging name stores distinct changed returned documents without modifying either worktree.
Symlink/subdirectory selection and branch/detached stability are exercised. This closes the package
portion of AC-04; database/manager coverage remains in earlier reviews.

**R14-01 resolved.** Both exchange Git subprocess call sites use git_env() to remove inherited
repository/worktree/index/object selection overrides. Regression runs from A with --repo B and
GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE/GIT_OBJECT_DIRECTORY pointing to A: B's key, archive namespace,
range and actual source snapshot are asserted; verification succeeds under pollution and clean.
This is the accidental environment-mixup guarantee tested, not isolation from arbitrary user Git
configuration or a hostile same-UID process.

**R14-02 resolved.** Current Export/Verify/Import examples use namespaced output and staging;
feature-execute bridge contracts, role mirrors, workflow/identity docs and contract13 agree.
Explicit --output/--staging remain deliberate literal overrides, with previous tilde/cwd semantics.
No silent namespace redirect or historical path migration. Existing archive creation is exclusive;
staging must be new and outside repo; namespace-inside-repo is refused. Explicit output retains
its previous narrower feature-directory guard. Ledger07 corrects ledger06's wording without editing it.
Direct unittest invocation now includes NamespaceCase.

## Independent validation on 4dea37c

- npm run build: PASS.
- npm test: 387/387,28 files PASS.
- python3 -m unittest discover -s tests -v: 29/29 PASS.
- python3 tests/test_feature_exchange.py: 29/29 PASS.
- python3 -m unittest discover -s tools/pilot/tests -v: 110/110 PASS.
- git diff --check and correction-range diff check: PASS; clean worktree before coordinator edits.
- Exact round9 package verify and prior archive hash comparison: PASS.

These are synthetic regression/tooling checks, including real temporary Git worktrees and a scripted
pilot dry run. They are not a paid-model or real two-model pilot. No new blocking defect found in
this bounded review; passing tests do not prove every filesystem/race/configuration case.

## Resume and release limits

W7-ID-02 implementation/corrections done, feature remains pending user acceptance. New integrated
final-02 ZIP in the namespace includes this review and the coordinator checkpoint; final manifest
identifies its exact clean head. Preserve final-01 and all correction packages.

Pinned supervising runtime <operator-home>/workspace/bridge-runtime-956b171 was not changed. This branch
remains an isolated pre-wave9 source delivery: timeout-recovery integration with current
feature-workflow needs a separate authorized branch and joint guard/recovery recheck before any
deployment. No merge merely because wave9 exists. Existing exact Codex0.154.0 adapter/local POSIX
filesystem/accidental-mixup limits remain; no diagnostics or installer work included.
