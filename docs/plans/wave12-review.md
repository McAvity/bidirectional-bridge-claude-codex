# Wave12 — coordinator review

Input: `0741ae9`, base `95f9ea1`. Date: 2026-09-15.
Verdict: REWORK for one demonstrated setup boundary defect. AC-08 remains partial.
No product acceptance, model pilot, merge, push or runtime deployment.

## W12-R1 — init writes outside the target workspace (required)

AC-03/AC-04 require preserving user files and independent worktrees. In
scripts/setup/workspace.mjs, planInstructions follows directory symlinks while
reading paths; applyPlan/writeAtomic creates files through those parent directories.
There is no boundary check for managed target paths.

Independent reproduction on a fresh temporary project: create an empty external
shared-skills directory; make project/.agents a symlink to it; run the delivered CLI
init --workspace <project> --home <isolated installed runtime home> --yes --json.
Result: exit 0, applied; 14 files created in the external shared-skills directory.
Installed source: 0741ae9. No user files or real projects were touched in the test.
This can make initializing A change instructions shared with B. It is not merely
an adversarial race; a pre-existing ordinary directory symlink is sufficient.

Correction: enforce the workspace boundary for managed write destinations, including
parent directories. Prefer a clear refusal for externally redirected paths over
silently changing shared instructions. Cover init/update/rollback and metadata/backups
as applicable. Validate before any application writes; preserve unrelated files.
Do not add a new general filesystem framework. Add a regression with a real directory
symlink and an unchanged external-directory snapshot on refusal.

## W12-N1 — unsupported diagnosis of the existing detach issue (nonblocking note)

The report says IdentityRuntime lacks detach. The delivered source contains detach()
and importing shared/mcp-server-core/dist/identity-runtime.js yields
`typeof IdentityRuntime.prototype.detach === "function"`.
The observed fenced restart may still be real, but this cause is not established.
Correct the report to distinguish observation, tested runtime revision and hypothesis.
Do not initiate a separate runtime repair based on the current explanation. Any
separate task should carry a minimal reproducer for the actual closed/reopened instance.

## Remaining acceptance

Keep AC-08 partial until a real TUI path is checked. A model smoke is not authorized
by this review. Preserve user acceptance as distinct from Astra technical review;
the prepared smoke may simulate acceptance only if explicitly labelled synthetic.
Review corrections narrowly: W12-R1, changed-path regressions and report correction.
No repeated full review or new 75-minute pilot is requested.
