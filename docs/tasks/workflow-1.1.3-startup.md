# Workflow1.1.3: hcom startup and same-session repair

2026-11-11. User authorized the proposed corrections after trial3: inject launch,
live readiness before dispatch, bounded same-session pre-dispatch repair, shared
skill/helper and a new workflow version. Branch fix/hcom-startup based on published
1.1.2 checkpointe457ce3. Bridge runtime stays0.8.2; installed bundles and trial state
remain untouched. No paid agent trial is authorized by this maintenance change.

## Scope

Canonical feature-execute reference and helper; both generated client packages.
Fresh launch uses process-local HCOM_CLAUDE_DELIVERY=inject with existing auto policy.
Readiness checks exact binding, hooks/process, listening Claude and ready empty PTY;
prepare requires its private snapshot within60 seconds. It is not an end-to-end model
probe or proof that a task was delivered. Any prepared round bars startup recovery,
even if send acknowledgement is missing. A diagnosed startup fault may use one
normal stop and tracked resume; original native identity/settings remain bound.
Durable stop/resume intents forbid blind retries after uncertainty. No global config,
new worker, task resend, runtime upgrade or historical evidence rewrite.

## Validation / progress

Implementation complete. Independent [review](workflow-1.1.3-startup-review.md) PASS;
startup launch_blocked eligibility and the actual CLI ts field corrected. Malformed
external containers now return structured refusals. Installed-hcom0.7.31 synthetic
SQLite/CLI event probe PASS without launching any client. Final focused hcom regression suite50/50 PASS, including the installed-hcom schema probe.
Node24 npm ci/build, package equivalence, skill validation and docs317 PASS.
Full local Python/JS checks are in progress; pilot131 has one macOS process-observer
failure and two PTY skips. Exact-distribution Linux CI is the publication gate. A real fresh-agent run remains untested;
trial3 demonstrated the underlying inject/same-session approach, not this new helper.

Next: commit source and register immutable identity, then exact-distribution CI before tag/publication.

Source commit: `5d07491f907e5db44c364d2d659414d425117fc4`.
Workflow identity: `sha256:ca0ed85dea2a1d8ce2814609a1a1e36416d52b3a00012aeefdee566a0aaeebb6`.
