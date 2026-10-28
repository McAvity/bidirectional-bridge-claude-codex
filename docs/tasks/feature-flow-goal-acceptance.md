# Feature-flow: verify the agreed outcome before acceptance

Status: locally implemented on `fix/feature-flow-goal-acceptance` (2026-10-28).
Base: `618758f`. Canonical sources are `.agents/skills`; installed personal skills
and pinned runtimes are outside this delivery.

## Change

`feature-flow` now compares evidence with the agreed user outcome and required
gates before offering acceptance. A technically sound negative experiment may
complete an investigation, but cannot establish a required success threshold.
Continue meaningful work within existing authority. At a real limit, record the
unmet goal and prepare a bounded continuation proposal when a consequential
scope or budget decision is necessary. Existing monetary, call and time limits,
execution approval and final acceptance remain in force.

`feature-review` reports outcome/gate achievement separately from execution PASS.
Both skills distinguish finding severity from disposition: a minor requirement
violation remains required, while optional suggestions may be declined with a
reason. Account for all findings without silently discarding them or making
all suggestions mandatory. Generated plugin copies and manifests match the
canonical sources.

## Validation

- Both skill validators, `npm run packages:check`, `npm run build` and
  `git diff --check`: PASS.
- Pilot tooling: 140 tests PASS.
- Full JavaScript suite: 586 PASS, 76 FAIL, 7 skipped. An isolated checkout of
  the unmodified base reproduces the identical set of failing tests. Failures
  concern setup/process inspection on this host (`ACTIVE_USE_UNKNOWN`).
- Full Python suite: 113 tests, 3 failures. The base distribution suite reproduces
  the identical three failures: two installer refusals from process inspection
  and the existing delegated-skill count expectation (12 versus 14).
- No real-model workflow pilot was run; static/package checks do not demonstrate
  actual agent behaviour. No paid model calls were needed for this change.

Logs remain outside the repository under `/tmp/bridge-goal-*`. No unrelated
installer or fixture changes are included. No publication, release, runtime
switch or personal installation change was performed. Next: review the source
change; distribute and adopt it through the normal release/upgrade process when
authorised. Current projects keep their existing pins.

## Release preparation — 0.6.1

User requested committing, pushing and releasing the reviewed changes. The source
was already committed as ec9d712; no duplicate implementation commit was created.
Coordinator review PASS covered the two skills and generated copies; optional wording
suggestion was not applied. Release prepared in a separate worktree.

One release-test correction: delegated Claude discovery still expected twelve entries
after 0.6.0 added the seventh skill to both packages. It now checks the exact fourteen
qualified names, including feature-flow, rather than a count. No runtime code changed.
Release CI and exact source pin will be recorded below. Active runtimes and project
pins remain untouched.

Release preparation checks: clean dependency installation and build PASS; package
equivalence,233 documentation files and diff-check PASS. Focused distribution17/17
PASS, including real Claude discovery with a local API stub and exact runtime package
precedence over personal plugins. No successful model inference was requested.
Full suites will run in the isolated CI environment; existing baseline logs are retained.
