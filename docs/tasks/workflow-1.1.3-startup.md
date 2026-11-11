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
The initial local Python run collected307 cases before the final added cases;
six sandbox-blocked host tests all passed when rerun outside sandbox. The final
focused run covers50 hcom cases. Local full JS had692 PASS/84 failures/8 skips,
with failures in setup/project/diagnostic process-access paths; pilot131 had one
macOS process-observer failure and two PTY skips. These local full runs are not
reported as all-green. Final exact-distribution Linux CI covers the committed set. A real fresh-agent run remains untested;
trial3 demonstrated the underlying inject/same-session approach, not this new helper.

Publication complete; the next optional step is a fresh real-agent trial using only
the released skill. No model, plugin activation or existing-feature switch was performed.

Source commit: `5d07491f907e5db44c364d2d659414d425117fc4`.
Workflow identity: `sha256:ca0ed85dea2a1d8ce2814609a1a1e36416d52b3a00012aeefdee566a0aaeebb6`.

## Published checkpoint

Distribution/tag: `fd0f5a2805eb3125a51683c88bf9e92e19a8d633`.
[CI42932494117](https://github.com/McAvity/bidirectional-bridge-claude-codex/actions/runs/42932494117)
succeeded at exactly that SHA: JS782 PASS/2skip across56 files; Python311 cases
OK/6skip (installed hcom absent on CI, actual local schema probe passed); pilot131
OK/2skip; protected observer21 PASS. Build/package equivalence/docs also passed.
Local skill validation and independent review PASS, no findings remain open.

[workflow-v1.1.3](https://github.com/McAvity/bidirectional-bridge-claude-codex/releases/tag/workflow-v1.1.3)
annotated immutable tag and experimental release published. Tag and remote
feature-workflow advanced atomically without force. Main checkout retains its
unrelated pin/local branch; no runtime files, trial histories or installed bundles
were changed. Both workflow client packages contain the same helper and instructions;
Bridge role packages are byte-identical to the base. No required release work remains.
