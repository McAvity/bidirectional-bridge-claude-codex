# Workflow 1.1.1: reliable hcom receipt and completion

Status: implementation/validation in progress. User explicitly requested the
receipt fixes, a new release and an audit of the 15 approvals on 2026-11-10.
Release worktree/branch: release/workflow-1.1.1, based on F-W21-test53f24e3.

Scope: publish experimental workflow-v1.1.1 in the existing GitHub marketplace.
Workflow1.1.0 was a local candidate; preserve its historical lock/evidence rather
than regenerate its identity or claim the blocked trial passed. Bridge runtime
and plugin version stay0.8.2; no installed runtime rebuild, global permission
change, new paid model trial or automatic recovery of the stopped worker.
The MCP connection is bound to a foreign worktree; no state was claimed there.

Changes: stable check IDs with legacy string compatibility; report scaffold and
stateless validation; explicit report-only correction before receipt; guarded
normal exit after accepted receipt, matching live session and unchanged report.
No helper substitutes for independent Git/test review. Audit and recommendations:
[15 permission approvals](../hcom-mvp/permission-audit.md).

Publication sequence: generate workflow packages, run relevant local validation
and independent review, commit source, register its exact identity/commit, push
release branch for full exact-SHA CI, then publish immutable annotated tag and
experimental GitHub release. No npm publication or automatic project migration.
Preserve the main checkout's unrelated local pin; integration remote can advance
only by fast-forward after the exact release revision passes CI.

Validation, source/distribution SHAs, review and publication evidence follow here.

## Local implementation checkpoint

Generated workflow1.1.1 identity:
`sha256:0b8d7d20e82c6051c14fd258adeba98f9deb9d7c35110516170ac63d3f25d9cf`.
No change to either Bridge role package or its release descriptor. Source install
(`npm ci --ignore-scripts --offline`) and build PASS; focused fixture/runner72 PASS;
helper/finish/bootstrap34 PASS before one added blocked-trial refusal case. Full
Python/pilot suites include that last case and are in progress. Package equivalence,
skill validator, working-tree documentation315 files and diff checks PASS.

Independent helper/finish review found two shutdown gaps: terminal composer state
and retry across wrapper invocations. Both corrected with empty-ready terminal
validation and an exclusive persistent finish-intent; six finish tests now pass.
Final rereview pending. No real-agent path is claimed from these scripted tests.
