# Review14 — R13-01 correction: REWORK

Round8 task task_<historical-2> DONE. Reviewed exact range
61396c517e062704da93985da3f685ac9d3df077..493430578d4d51b23b23d30da3bc285a6dbc443b.
Coordinator Codex review independent of Claude execution, not independent of coordination;
a separate read-only Codex reviewer inspected helper/path semantics and tests.
No product correction or acceptance applied in this checkpoint.

## Evidence and disposition

Namespace round8 ZIP verify PASS: purpose corrections-review, exact feature and range,
SHA256 cae06dd51c9d6d8ae7173dfd66c63345166a2005e58cb6658c7b7ad816af4e8e.
Archive: <operator-home>/tmp/bridge-exchange/ws_<historical-worktree-hash>/packages/F-W7-manager-isolation-round-8.zip.
Clean export; 12 changed files; no supplied document changed/missing. Actual diff stays in scope,
coordinator records untouched. Independent Python discovery: 25/25 PASS. Executor reports build,
387 JS and110 pilot tests PASS; not rerun at this intermediate review. Independent SHA comparison:
all11 historical archives from the pre-round snapshot unchanged. No paid model pilot claim.

R13-01: **progress**, not closed. Real-worktree same-name ZIP/staging regression and canonical
namespace helper are implemented, but inherited Git environment can defeat --repo selection and
current operational examples still prescribe the old collision-prone layout.

## R14-01 — required: --repo must select the actual worktree

feature_exchange.py git() inherits all process environment; workspace_namespace() and export
selection use it. Read-only reviewer reproduction with TWO existing real worktrees: clean keys
differ; with child-only GIT_DIR/GIT_WORK_TREE pointing to A, namespace --repo A and --repo B return
the same key. This defeats decision08's actual --repo namespace and can select the wrong export
source, not merely its output directory. Product resolveWorkspaceIdentity already neutralizes Git
repository selection overrides; inspect its policy without changing product code.

Neutralize inherited Git variables that redirect repository/worktree/object/index selection for
all exchange Git subprocesses, consistently including verify's direct subprocess. Add a regression
with cwd A, --repo B and polluted Git environment pointing to A; assert key and export contents/range
come from B and independent verify succeeds. Retain explicit output/staging path semantics.

## R14-02 — required: current commands must use the current namespace

feature-exchange/SKILL.md only changed its policy paragraph. Active Export, Verify and Import
examples (lines27,42,68–69) still use flat $HOME/tmp paths, including --output and --staging.
These are live instructions, not historical ledgers. Following them recreates the original collision.
Update current runnable examples to --name/--stage-name and resolved packages/incoming locations;
state explicit literal paths as deliberate overrides, not the normal convention. Check current
bridge round instructions agree. Preserve all historical archives and prior review/ledger text.

## Small related corrections

Move unittest.main() after NamespaceCase so direct execution includes the new regression class.
New ledger07 should correct ledger06 limitation3: explicit staging inside repo is still rejected
by existing guard; explicit output is only rejected inside feature directory. Do not rewrite ledger06.
Exercise namespace-inside-repo rejection and existing staging refusal as targeted guard coverage;
use a changed allowed return document to prove staging separation beyond empty reports if practical.

## Next action and authority

Ordinary focused correction under decision08 and user's authorization; no new product decision.
New round9 after DONE in same pinned Claude session,75min/200turns, then independent re-review.
Ledger07, new namespace ZIP, base = this coordinator checkpoint. No runtime changes, deployment,
wave9 merge, diagnostics, installer or acceptance. This is material progress, not repeated impasse.
