# Feature flow distribution and release

Status: published, 2026-10-27. User requested importing the personal feature-flow skill into
this repository and issuing a new bridge version. Scope: preserve its lifecycle,
two human gates, step commits and resume rules; ship via both workflow plugins and
the runtime instruction set. No engine/schema change, project migration or model
pilot. The personal original is retained until marketplace adoption is confirmed.

Canonical source: `.agents/skills/feature-flow/`. The only behavioural adaptation is
portable instruction-source resolution for repository/runtime and plugin entrypoints;
missing flow in an older pinned runtime requires upgrade, not instruction mixing.
Generated packages and discovery checks include seven entries. Version 0.6.0 is
experimental, matching the existing release channel. Publish only after release CI.

Validation, review, source pin and publication results will be recorded below.

## Local review and validation

Independent instruction/distribution review: PASS after clarifying that only the
feature-workflow plugin uses the source reader; the runtime's bridge-claude executor
package uses its own sibling instructions. Eight synthetic decision scenarios covered
agreed brief, status at Gate 1, full-scope approval, PASS without acceptance, partial
acceptance, cancellation, compaction during a round, and an old pin lacking the skill.
These are instruction traces, not real model lifecycle pilots. No required findings remain.

Build, skill validation, packages and 232 documentation files PASS. Actual plugin
discovery in isolated Codex/Claude profiles and outside-checkout distribution:14/14.
Python suite113 tests: two setup failures with ACTIVE_USE_UNKNOWN on this host;
pilot tooling140/140 and historical plugin probes37/37 PASS. Full JS:586 PASS,76 failed,7 skipped; the failure count matches the already
recorded host process-inspection baseline, not a release PASS.
Public release depends on isolated-user CI, including the complete installer suites.

Source d721a837053687fe200d76703e7194c53852f7fa, distribution8b0eeb6.
Exact runtime0.6.0-d721a8370536 installed under a disposable bridge home; manifest
contains both flow instruction files and all three relevant packages contain the flow.
Build is immutable and no project selects it.
[Release CI40540195793](https://github.com/McAvity/bidirectional-bridge-claude-codex/actions/runs/40540195793)
completed SUCCESS; monitored at five-minute intervals.

No personal skill was removed, no project pin or active runtime was switched.

## Published

Experimental [v0.6.0](https://github.com/McAvity/bidirectional-bridge-claude-codex/releases/tag/v0.6.0)
at8b0eeb68033e8806888e4e532805dcf0b2d6fd34, runtime source d721a837053687fe200d76703e7194c53852f7fa.
CI PASS: JS668 passed/1 skipped, Python113 tests, pilot131 tests, protected observer17/17.
Build, package equivalence and documentation pass. No real-model lifecycle pilot.

Canonical skill and generated marketplace packages are published in this repository.
Personal original retained; clients may refresh their workflow plugin and explicitly
upgrade old project pins before using the packaged flow. The qualified marketplace
entry avoids confusing the personal copy with the distributed one. No global plugins,
project pin, personal profile or running runtime were changed by this release.
