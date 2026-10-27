# Feature flow distribution and release

Status: in progress. User requested importing the personal feature-flow skill into
this repository and issuing a new bridge version. Scope: preserve its lifecycle,
two human gates, step commits and resume rules; ship via both workflow plugins and
the runtime instruction set. No engine/schema change, project migration or model
pilot. The personal original is retained until marketplace adoption is confirmed.

Canonical source: `.agents/skills/feature-flow/`. The only behavioural adaptation is
portable instruction-source resolution for repository/runtime and plugin entrypoints;
missing flow in an older pinned runtime requires upgrade, not instruction mixing.
Generated packages and discovery checks include seven entries. Version 0.6.0 will
be experimental, matching the existing release channel. Publish only after release CI.

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
pilot tooling140/140 and historical plugin probes37/37 PASS. Full JS still running.
Public release depends on isolated-user CI, including the complete installer suites.

No personal skill was removed, no project pin or active runtime was switched.
