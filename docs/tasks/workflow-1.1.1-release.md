# Workflow 1.1.1: reliable hcom receipt and completion

Status: published, 2026-11-10. User explicitly requested the
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

Source commit: `cb864a92ac553021027e808cac8aac9ac0a57c89`. Registered exact workflow identity against that
source; distribution commit follows. Final independent rereview found no blockers,
six finish tests PASS; local hcom0.7.31 help/changelog confirm the terminal JSON
fields used by the guard. No live shutdown/model was used for this validation.

## Published checkpoint

- Source `cb864a9`; immutable distribution/tag target
  `37280cb1bfdc882c816097d619b9fc69c409b506`.
- [Experimental release workflow-v1.1.1](https://github.com/McAvity/bidirectional-bridge-claude-codex/releases/tag/workflow-v1.1.1)
  published, not a draft; annotated tag and feature-workflow remote updated atomically.
- [Exact-distribution CI42867143236](https://github.com/McAvity/bidirectional-bridge-claude-codex/actions/runs/42867143236)
  SUCCESS: JS782 PASS/2 skipped; Python296 cases OK/5 host skips;
  pilot131 cases OK/2 optional skips; protected-process observer21 PASS. Build,
  package equivalence and documentation315 files also PASS.
- Local Python296 covered: initial run290 PASS with six sandbox refusals; all six
  targeted retries outside the sandbox PASS (local HTTP stubs/process inspection/
  temporary worktrees, no model requests). Focused JS72 PASS. Local pilot131:
  128 PASS,2 skips,1 unchanged macOS process-observation refusal; Linux CI covers it.
- Source-registry restore regenerated the exact registered workflow identity into
  an empty private store. No installed runtime, project lock or trial state changed.
- Final independent finish/receipt review: no blockers after the terminal/intent
  fixes. New behavior is regression-tested with scripted hcom, not certified by a
  further paid real-agent trial. Future prompt count remains unmeasured.

The existing marketplace now offers workflow1.1.1 for new features after plugin
refresh/client discovery. Existing feature locks and the original blocked trial
remain unchanged. No engine/plugin version bump, automatic client activation,
global permission change or npm publication. Main checkout's unrelated local pin
is preserved; its local integration branch was not switched under that edit.
No required release work remains. Further model trial or recovery is separate.
