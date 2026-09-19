# Current handoff

## Wave16 executing after authorized runtime upgrade

Runtime0.3.2-34ecb8d45465 is selected; doctor handshake passed. Manager bootstrap
succeeded. Claude implements W16-01–03; Codex coordinates and independently reviews.
[Progress](plans/wave16-progress.md), [feature](features/F-W16-local-delivery/feature.json).
Local commits only; no push/merge/deploy/model smoke. Earlier bootstrap block is resolved.

## Wave16 execution authorized — blocked before delegation

The whole W16-01–03 implementation, integration and independent review are now
authorized, with Claude through bridge and local commits only. This worktree pins
`0.2.0-ff225e550966`, which rejects host Codex `0.155.1` with
`NATIVE_CONTEXT_INVALID` before creating the manager root. No database, feature or
Claude round was created; runtime unchanged. [Checkpoint](plans/wave16-progress.md)
records evidence and resumption. A compatible client/runtime is needed before
execution; runtime changes in this session, push/merge/deploy and model smoke remain
unauthorized. Earlier “awaiting execution instruction” entries are historical.

## 0.3.2 published — bridge-upgrade skill

GitHub prerelease/tag v0.3.2 on79da6b7; runtime source pin34ecb8d. Both marketplace
plugins include bridge-upgrade. CI35435206335 SUCCESS:575 JS; Python44 passed/3 skipped;
pilot129 passed/2 skipped (local Python47/pilot140 PASS). Build/packages/docs PASS.
[Full record](tasks/bridge-upgrade-skill.md). Earlier local-only checkpoints below are historical.
Project pin and running runtime remain unchanged; user plugin refresh and project
upgrade are separate from publication. No model-driven upgrade smoke was run.

## Bridge-upgrade skill — local implementation

Both generated client plugins now include bridge-upgrade; Claude carries the same
existing installer as Codex. Handles marketplace refresh, exact release runtime,
setup vs update, active-client exit/apply/resume and verification. No runtime switch,
release pin change or publication performed. [Validation and limits](tasks/bridge-upgrade-skill.md).
Code f5783c1, fixture correction e93f53e; Python47/pilot140 PASS, JS574 unchanged cases
plus corrected new regression PASS across the full and focused runs. No model smoke.
Next: publish/update plugins when authorized; wave16/17 scopes remain separate.

## Wave17 planned — standalone feature workflow distribution

[Wave17](plans/wave17.md): separate workflow plugin, two client packages from shared
sources, existing repo and marketplace. Standalone use without bridge; bridge use
follows pinned runtime instructions. Contract task covers legacy plugin coexistence
and delegated Claude. Packaging depends on integrated wave16.
Brief/design/index and W17-01–04 are ready for plan review, not implementation.
[Progress](plans/wave17-progress.md). No runtime, profile or publication changes.

## Wave15 history reconciled — 2026-09-19

All wave15 commits are integrated with the accepted0.3.1 delivery. Release pin41962cc
and wave16 documents are unchanged. Both decisions survive: release authorization02
and [technical acceptance03](features/F-W15-natural-workflow/decisions/03.md).
Original manager feature accepted/root DONE; model smoke remains separately scoped,
not a behavioural PASS. Historical pending-acceptance instructions below are superseded.

## Wave16 plan accepted — awaiting execution instruction

[Wave16](plans/wave16.md) records local task delivery through bridge and Git,
with feature-exchange optional for external transfer or explicit export requests.
Preserve provenance/scope review, existing round contracts and wave15 intent/replay.
User accepted the reviewed plan on 2026-09-19: [decision01](plans/wave16/decisions/01.md).
R16-N1/N2 are inputs to W16-01/03, not new gates. Implementation awaits a separate
instruction; this accepts no product criteria and changes no runtime or smoke scope.
[Progress](plans/wave16-progress.md). Earlier release/smoke checkpoints remain in force.

## Codex 0.155.1 fix published — 0.3.1

Prerelease/tag v0.3.1 on eef7f18; feature-workflow published, runtime pin41962cc.
CI35431614450 SUCCESS on Codex0.155.1:574 JS/46 Python; pilot130 PASS plus one
optional module skip (local140 PASS). Independent review and real-host temporary setup PASS.
Version mismatches now warn; native identity and ownership checks remain enforced.
[Progress and next setup step](plans/codex-version-warning.md). Supervising runtime unchanged.
Earlier publication checkpoints below are historical.

## Codex 0.155.1 compatibility — 0.3.1 publication checkpoint

Version-only refusals replaced with CODEX_VERSION_UNVERIFIED warnings; metadata,
subagent and ownership guards remain enforced. Code3d5891b, test correction41962cc,
release pin41962cc. Independent review PASS; actual-host temporary setup PASS.
See [progress](plans/codex-version-warning.md) for full validation and CI checkpoint.
Supervising runtime unchanged; full CI required before release tag.

## Wave15 0.3.0 published; activation then smoke

GitHub prerelease/tag v0.3.0: 0143fa4. CI35160973276 SUCCESS (565 JS/46 Python/140 pilot).
Runtime0.3.0-2611d1ecccfa installed beside ff225e5. User must close this client and
run the prepared local activation script; then resume the same session, read
entry --status and the new pinned instructions, verify doctor, and perform the
bounded smoke in a disposable project. See [release checkpoint](plans/wave15-release.md).
No feature_accept or behavioural PASS yet. The original wave15 manager stays untouched.

## Earlier authorization — retained

User authorized integration of b64b858 plus review10eb3ed, version bump, publication
and runtime activation before the bounded smoke from the plan. Behavioural acceptance
is still pending; do not feature_accept. Existing runtime ff225e5 must remain untouched
until normal client shutdown. New runtime is installed beside it. See
[decision02](features/F-W15-natural-workflow/decisions/02.md) and
[release progress](plans/wave15-progress.md). Older statuses below are historical.

## Wave15 — local delivery ready for acceptance

All authorized tasks implemented and independently reviewed: technical PASS.
Final code756ada2, executor report292cb14; JS565, Python46, pilot140 PASS.
See [delivery](features/F-W15-natural-workflow/handoff.md) and [progress](plans/wave15-progress.md)
for commits, evidence, limitations and resume point. User acceptance q-01 pending.
No model smoke, push, merge, deployment or supervising runtime change.
Earlier implementation/planning entries are historical.

## Wave15 — implementation authorized

Whole wave15 authorized in worktree wave15: Claude implementation through bridge,
Codex coordination/review. Local commits only, no push/merge/deploy or model smoke.
See [progress](plans/wave15-progress.md). Earlier planning-only entries are historical.

## Runtime activated; wave15 planning only

User completed the dispatcher update. Commit e721aa4 selects runtime ff225e5;
coordinator doctor confirms ok after resume. Migration/fix commits are published.
[Wave15](plans/wave15.md) now has a bounded plan, tasks and acceptance criteria;
implementation and model smoke are NOT authorized. CI35130755901 SUCCESS on 38367c8
validates the published migration, doctor correction and aligned configuration test. Earlier pending activation and
wave15 draft entries are historical. See [progress](plans/wave15-progress.md).

## Dispatcher migration — diagnostic correction

Runtime187fd3b activation and the project dispatcher migration succeeded.
Migration commit3c21218 preserves the inherited worktree setup in Git.
Doctor incorrectly compared the new configuration with the legacy launcher;
[correction and deployment checkpoint](tasks/dispatcher-doctor.md) records the fix.
Corrected runtime ff225e5 is installed beside the current selection. Its doctor
reports ok against this project. Selecting it waits for normal client shutdown;
no active runtime is overwritten. Earlier pending-activation notes are historical.

## Release accepted and published — wave13/wave14

The user accepted the combined wave14 delivery and authorized publication and activation
in this project. Published code/docs/CI: ca9895a. The runtime187fd3b is installed
beside wave12; the current project still selects860e2e7 because live clients
and bridge processes trigger ACTIVE_SESSION. No bypass or process termination.
After normally closing this checkout’s clients, use the supported update command
from [setup](setup.md) to select0.2.0-187fd3b29206, then doctor.
README now documents the repository marketplace and first-project/worktree steps.
CI35120711465 SUCCESS on published ca9895a. Result is recorded in the final section of [the integration report](plans/wave13-wave14-integration.md).
Wave15 remains DRAFT. Older pending-acceptance/publication entries below are historical.

## Current: wave13/wave14 integration

Wave13 e5ec270 and wave14 50458be are integrated locally for feature-workflow.
Final code afe1bd8: build,536 JS,46 Python,140 pilot-tooling, packages and docs PASS.
Independent integration review PASS after FIFO correction187fd3b; distribution pins
that corrected runtime. [Integration report](plans/wave13-wave14-integration.md) records
inputs, evidence and deployment boundaries. No push or active runtime switch.
Wave14 is ready for final user acceptance; its original bridge feature was not
accepted by a different manager. Older entries below are historical.
Active runtime selections remain unchanged; wave15 is still DRAFT.

## Wave13 and wave14 — coordinator review

Both local deliveries have been reviewed at wave13 `9cf1f43` and wave14 `e76a066`.
See [the review and integration boundary](plans/wave13-wave14-review.md).
No product merge, push or runtime switch was performed. User acceptance and the
combined integration remain next; older executing/planned-only entries below are historical.

## Wave15 draft; wave13 and wave14 executing

The user reports both wave13 and wave14 are executing separately. Their scopes stay
unchanged. [Wave15 DRAFT](plans/wave15.md) records natural feature requests and
candidate usability improvements; refine only after both waves are accepted and
integrated. No wave15 implementation is authorized. [Progress](plans/wave15-progress.md).

## Wave14 planned; wave13 executing
## Wave14 — independent local delivery accepted; final session checkpoint, 2026-09-16

The user accepted independent delivery `e76a06626046be6798ecde3bd57348605079e731`.
Coordinator review PASS is recorded in `0109643ca570acf989ec83139871a1ff5f1748be`
on `waves13-14-review` (`docs/plans/wave13-wave14-review.md`).
[Actual user decision](features/F-W14-plugin-distribution/decisions/03.md).
The whole wave14 feature remains open: integration with final wave13 and validation
of the combined result belong to the coordinator. W14-03 remains open; no
`feature_accept` is called. This session ends after the documentation-only local
commit and SHA handoff. No new review, tests, merge, push or deployment. Existing
evidence and packages are preserved unchanged; prior checkpoints below are historical.

## Wave14 — independent local delivery, review PASS, 2026-09-16

Code `1880b3914f4dd3bffe2a618e01f43b4d6281ac81`; generated distribution pins runtime
`87cceed8d08c298ce2976aa3ce9bec771dea31fe`. Claude implemented in one bridge session;
Codex independently reviewed and closed all implementation findings. Both plugins and
marketplaces remain in this repository, generated from shared sources.

Independent clean-clone validation: npm ci/build, 486 JS, 43 Python, 140 pilot-tooling tests
and packages check PASS. Actual runtime: five interruption/recovery boundaries, same-worktree
owner race, pure reads and plain Codex TUI (35 tools and plugin skill) PASS, without model inference.
[Delivery handoff](features/F-W14-plugin-distribution/handoff.md),
[progress](plans/wave14-progress.md). No active Claude round; no user acceptance inferred.

Joint diagnostics/logging validation is deliberately deferred until wave13 acceptance.
Working interface refs are cf2365c/review853302c, not accepted wave13 commits. No wave13
worktree or active runtime was changed; supervisor remains 0.2.0-860e2e77d95f.
Local commits only: no push, merge, deployment or additional model pilot. The optional
bounded smoke proposal is recorded in the handoff and requires separate authorization.
Earlier status sections below are historical.

## Wave14 execution authorized; wave13 executing

The user reports wave13 is executing in a separate worktree. Earlier planned-only
status below is historical. [Wave14](plans/wave14.md) plans plugin distribution and
automatic worktree preparation; implementation authorized; Claude through bridge, Codex coordination/review. Local commits only; no push/merge/deployment or additional model pilots.
[Wave14 progress](plans/wave14-progress.md). Do not modify wave13 or active runtimes.

## Next work — wave13 planned, 2026-09-16
## Current work — wave13 implementation, 2026-09-16

[Wave13 plan](plans/wave13.md) covers automatic logging, retention and incident export.
[Progress](plans/wave13-progress.md). The user authorized full implementation through Claude bridge rounds, local commits only (no push/merge/deploy). Logging/retention passed coordinator review after corrections at 59b3de3; ledgers through 50073f5. Incident exporter delivered at cf2365c; coordinator review02 requires privacy, scope, filesystem and evidence corrections. Next: same-session Claude correction round, then focused re-review and full validation. The supervising wave12 runtime remains unchanged.
The user reports main-checkout init complete and doctor status=ok for the pinned
wave12 runtime. Activation instructions below are historical; no need to repeat init.
The reported database was not yet bound; this is not a real-task validation.

## Current integration — wave12, 2026-09-16

Accepted wave12 delivery `860e2e7` is integrated and published on feature-workflow; CI 35053428452 passed.
A separate immutable runtime pinned to `860e2e77d95fb5e1d7c5f25ddc0909cfead13c6f`
is installed locally. No active runtime has been rebuilt or switched.
Main-checkout activation is deferred until its current Codex/bridge session exits.
Before reopening Codex in that checkout, run from a shell:

```sh
node scripts/bridge.mjs init --workspace "$PWD" --runtime 0.2.0-860e2e77d95f --yes
node scripts/bridge.mjs doctor --workspace "$PWD"
```

Run these from the worktree root after closing its clients. Do not bypass an
ACTIVE_SESSION refusal. Other worktrees require their own explicit init and retain
old selections until then. No automatic adoption or database repair is authorized.
Smoke evidence and trust entry remain preserved. Publication/validation details:
[wave12 progress](plans/wave12-progress.md). Next product scope: wave13 diagnostics.
Historical implementation/acceptance checkpoints below remain evidence, not active work.

## Wave12 — setup, updates and doctor implemented locally, 2026-09-15

`scripts/bridge.mjs` installs a read-only runtime per commit, sets up one worktree (managed Codex
MCP block, instructions, ignores, `.bridge-runtime/current`), updates or rolls back only that
worktree, and runs a model-free doctor with a real MCP handshake. Coordinator REWORK W12-R1
(init wrote through a directory symlink) is fixed in `cb6cf1a` and closed by the focused review
in `e087245`: managed paths that are symlinks are refused before any write. Validation after the
fix: build, 434 JS, 29 exchange and 140 pilot tests, documentation links.

Authorized AC-08 smoke, 2026-09-15: PASS. Runtime `e087245` was installed in a separate home and
initialized in a new disposable project. After the trust prompt, plain `codex` TUI (the user's
shell function adds only `--profile`) loaded the bridge from `.bridge-runtime/current`; `/mcp`
listed 35 tools. Astra ran one Claude round through the bridge (DONE, 88 s, 14 turns) and reviewed
the real code, tests and package (PASS). She recorded a synthetic acceptance, which is not user
acceptance. `/quit` detached the instance and doctor reported `ok` 20/20. The runtime is unchanged;
the only Codex config change is the smoke project's trust entry. Limits: one host and a trivial
feature; the operator drove the TUI through a PTY; this host blocks the Codex sandbox (AppArmor
user namespaces), so Astra's commands went through automatic escalation review. Evidence stays
local in `~/tmp/wave12-smoke-20260915/` until acceptance.

After merge the repository configs start `.bridge-runtime/current`: run
`node scripts/bridge.mjs init` in each bridge worktree before a client starts there, and do not
switch the active main-checkout session mid-work. Observed, cause unconfirmed: a launcher closed by
stdin EOF leaves its instance active and the same thread is fenced on restart, while a SIGTERM close
detaches; `detach()` exists. In the smoke, a real Codex `/quit` detached the instance normally; a
restart was not tried. No runtime change without a confirmed cause.

## Current status — wave10 and wave11 accepted, 2026-09-13

The user authorized acceptance, integration, joint validation and publication.
Wave10 delivery `6eef24a` and focused review `db41788` are combined with wave11
`ed2f356`. Namespace, native manager isolation, timeout recovery and Z1–Z5 workflow
instructions are retained. All older pending-action sections below are historical.

The authorized segmented real-agent pilot supports P1–P6 and segment P7 PASS.
Original uninterrupted v2 remains UNVERIFIED; no repeat is required for acceptance.
Wave11 instructions are adopted; behavioral improvement is not yet empirically proven.
No active/pinned runtime is rebuilt or deployed by this integration. Pilot synthetic
features are not accepted on behalf of a real product user.

Accepted wave10/wave11 are integrated and published; CI result is recorded in their
progress files. No runtime deployment is implied. Broader setup/diagnostics work,
wave6 REWORK coverage and empirical long-duration limits remain separate work.


Canonical repository: McAvity/bidirectional-bridge-claude-codex, branch feature-workflow.
The fork preserves grizzly2005 upstream history and MIT notices. This repository contains
all development inputs; the historical experiments workspace is an optional private archive.

## Wave10 — authorized main-first scenarios completed; review ready

Preparation d7cdbb0, original bridge9e8f060 unchanged. Both retained R2 completed,
A restarted in the exact native session while B remained active;77.708s real R2
overlap. Both genuine Astra reviews PASS, verify4 PASS, final A6/B3 tests PASS.
140 operator tests, pinned build,2 handshakes and preflight PASS. Separate foreign
probe used the exact validated arguments: MANAGER_FOREIGN_THREAD on first attempt,
full before/after state unchanged. All clients normally closed; no live MCP/workers.

Segment868.526s: A3/B2 turns, Claude2/2, foreign1/2. R1 never repeated; histories and
sessions preserved. Final features awaiting_review, unaccepted, A generation10/B8,
epoch1 detached. No retry of an executed worker, replacement pair, recovery, push/merge.
P1–P6 PASS; P7 four packages/tests/new budget PASS, original uninterrupted v2 still
UNVERIFIED due preserved earlier gaps. This does not close all wave10.

Next: review final report and decide acceptance; do not restart the completed relay
or repeat R2. Latest evidence/checkpoint is the final section of wave10-report.md.
Historical blockers and budgets below remain historical, superseded by this result.

## Wave10 — relay fixed; continuation stopped at foreign input schema

Current fix4f32170 separates paste, explicit one-shot Enter and native rollout
confirmation.30 focused/140 total pilot tests PASS; fresh pinned build,2 handshakes
and preflight PASS. Real BOOT A/B and short FOREIGN all confirmed without resend.
Production bridge9e8f060 unchanged. Foreign selected empty scope.paths, causing
MCP-32602 before identity guard. One authorized probe consumed; no retry or R2.
No-mutation snapshot comparison passed, but P6 remains UNVERIFIED. Segment255.103s:
A1/B1/foreign1/Claude0, separate from previous segments. All clients normally closed;
original databases intact, waiting_user/q1, detached epoch1/generation6, R1 unchanged.
W10-09 closed; W10-11 open. Next probe needs schema-valid prepared arguments and
explicit authorization for an additional foreign attempt; do not silently reuse the
consumed allowance. Two Claude rounds remain unexecuted. See final report/checkpoint.

## Wave10 — approved continuation stopped at TUI input blocker

Tooling commits34bd367/79f75e0 aligned approved limits: Claude2x45min/max32,
MCP55min, operator20min, gate25min, Bash30min, segment90min. Astra turns are
planning only. Billing confirmed. Build, handshake2/2, preflight,26 tests PASS.
Production bridge stays9e8f060. Two real BOOT turns proved exact native resume
and waiting_user/q1. No R2 or foreign model turn: short multiline foreign paste
rendered literally, but relay waited for `[Pasted Content]`. W10-09 reopened.
A/B closed normally; databases intact, detached epoch1/generation4, R1 unchanged.
No owned MCP processes. P4–P7 remain UNVERIFIED; see final report section.

Next: repair paste/submit without models; prefer explicit operator submit after
screen inspection over another display-label assumption. Fresh pinned tooling and
baseline required before further execution. Do not restart stopped relay or repeat
R1. Historical pending-approval sections below are superseded by this checkpoint.

## Wave10 — retained-session continuation prepared, approval pending

Current preparation commits `c136c7d` and final pin `51c358a` adds a separately budgeted operator segment;
no models ran in this follow-up. Read-only audit confirms both original databases,
waiting_user/q1, exact native TUI rollouts and Claude handles; resume itself remains
UNVERIFIED until an authorized real turn. The old bridge stays pinned at `9e8f060`.
A fresh auxiliary tooling build passed two MCP handshakes; 24 operator tests and
5 focused runner regressions passed. No full integration review repeated.

The num_turns discrepancy is resolved from the exact 2.1.269 binary and retained
transcripts: success counts user-role messages (1+17=18), while the executor limits
loop iterations separately. There are 12 distinct assistant responses, 11 using tools.
The max-turns error branch can report its own loop counter. Raw telemetry is unchanged;
operator comparisons against max_turns are withdrawn, executor enforcement remains.

Proposed continuation: resume both existing Astras, foreign probe, B/r2, close and
resume A during active B, A/r2 and final verification. Budget: two Claude rounds with
max_turns=12 (A 8min/B 20min), 3 new A turns, 2 B turns, 1 foreign turn, 45min segment,
no retries or additional task recovery. This is not uninterrupted v2: P1–P6 can be
assessed using the required combined/new evidence, but original P7's continuous
60min condition cannot be retroactively proved. See [continuation protocol](../tools/pilot/wave10/CONTINUATION.md)
and the latest [report/checkpoint](plans/wave10-report.md). Approval applies to this
new segment; the existing subscription confirmation remains valid.

## Wave10 — partial real pilot; stopped after R1

The accepted integration remains unchanged; no full implementation review was repeated.
The user authorized autonomous native TUI operation, the v2 model budget and existing
subscription billing. Operator commits: `19ad974` and `9e8f060`; real-run runtime is
pinned to `9e8f060`, in a separate local pilot directory. Build, two real MCP handshakes,
preflight and 14 operator tests passed. No active runtime or other wave worktree changed.

Two actual Codex TUI Astras and two actual bridge Claude workers completed R1 with
74.394 seconds of worker overlap. Both managers independently reviewed delivery and
reached waiting_user/q1. Both R1 archives verify; A tests 5/5 and B tests 3/3 pass.
The operator prematurely stopped and closed both clients on reported num_turns=18 versus
max_turns=12. Subsequent evidence establishes different counters: 12 distinct assistant
responses, 11 tool-use round trips and 17 tool results in each worker. This does not show
an integration defect or a turn-budget overrun. The premature operator STOP is the cause
of the incomplete scenario; no retry, recovery or replacement session followed.

P1/P2 PASS; P3–P7 UNVERIFIED (R1 isolation is evidenced, R2 is absent). Foreign probe,
A restart during B/r2 and both R2 deliveries were not performed. All owned pilot processes
are stopped; raw evidence and native identifiers remain outside Git. Next: resolve the
pilot continuation boundary after the unplanned close of B; do not automatically replay
or add a B restart under the original scenario. See [progress](plans/wave10-progress.md),
[final report](plans/wave10-report.md) and [operator protocol](../tools/pilot/wave10/OPERATOR.md).
No push, merge or whole-wave completion.

## Implemented and reviewed

Persistent feature sessions, explicit manager-driven rounds, BLOCKED recovery, waiting_user,
idempotent retries and separate worker completion/review/user acceptance. Skills drive the
manager loop through explicit MCP calls. User-channel text is not automatically appended
to worker prompts. See feature-workflow.md and the feature-execute bridge-loop reference.

Portable pilot tooling is in tools/pilot/. Import: d850a02, 7ae7f15; review fixes:
ceaf7f5, 5b86f8e, 4469246; collector version 4: 66b6f99.
Independent targeted review passed 110/110 tooling tests including a scripted dry run.
The injector is for a quiescent test repository, not arbitrary concurrent product work.

## Evidence limits

Historical human-operated pilot: 13 mechanical PASS, two NOT_TESTED (seeded defect and
REWORK correction path). The worker fixed the defect in its first round. Three rounds used
one native worker session; waiting/restart and final acceptance were observed. One mistaken
resume selected an auxiliary guardian; launcher selection and evidence collection were fixed.
Real review quality criteria remain unassessed. A prepared correction pilot has NOT been
run with real models. Follow tools/pilot/rework/OPERATOR.md for that separate activity.
Upstream certification manifests do not certify fork changes. CI uses no model credentials.

## Next work

Current stages: [wave10](plans/wave10.md) has a local integration and partial real pilot
stopped after R1; the full scenario remains unverified; [wave11](plans/wave11.md)
examines excessive review loops in wave7/wave9 and proposes evidence-based workflow simplification.
The accepted wave7 delivery is reported at 66e524f; this does not complete the wider wave7 roadmap.
Wave11 can run independently; its findings are not a prerequisite for preparing wave10.

Parallel integration task: [wave9](plans/wave9.md), with its own
[progress](plans/wave9-progress.md). It integrates timeout/recovery and reconciles
status without touching the runtime or worktree used by active wave7.

Wave8 directory cutover and resumed-session checks are complete (see plans/wave8.md). Continue
plans/wave7.md: manager/workspace identity and two-worktree isolation, diagnostic export,
versioned setup for normal codex startup, dependency maintenance and acceptance tests.
The role owner `codex` alone is not a unique manager session identity. The local wave10
integration adds native thread/epoch and instance binding; the published baseline does not
yet include that delivery. Continue using one active manager/feature per worktree. No closed-manager wake-up, orphan supervisor or /goal support
is claimed. docs/tasks/review-integration-drift.md is a proposal, not active workflow policy.

## Timeout recovery — integrated and published

Wave9 imports explicit deadline recovery, per-attempt budgets, bounded termination evidence,
and the finite 256-turn ceiling; defaults remain 12 turns. Configuration allows a 75-minute
round and 5400-second client wait. Other FAILED tasks remain terminal; no fresh-session fallback.
See [wave9 progress](plans/wave9-progress.md) and [source report](tasks/timeout-recovery/REPORT.md).

The source implementation was independently reviewed according to the coordinator's input.
The coordinator reports a separately pinned runtime at `956b171` was deployed for wave7:
initial timeout recovery preserved the task/session and returned BLOCKED/PARTIAL after about
6.5 minutes with a contract and an export blocker. A subsequent correction reached DONE;
contract review still required changes. Pinned wave7 document snapshot `88d1707`
(`docs/features/F-W7-manager-isolation/PROGRESS.md`, `reviews/03-corrections.md`) confirms
that reported DONE/REWORK distinction. Wave9 inspected those documents, not private runtime
evidence. This is neither feature acceptance nor empirical validation of 75/90 minutes or
200 turns. Wave6 remains 13/15, controlled REWORK and M-01…M-07 remain open.

Local validation passed: build, 379 JS tests, 19 exchange tests, 110 pilot-tooling tests,
documentation and whitespace checks. Coordinator review accepted the integration; merge fb9c843 is published on feature-workflow.
GitHub CI run 34676235601 passed build and 379 JS / 19 exchange / 110 pilot tests.
Wave9 does not change any active runtime or deploy a replacement. Original source commits
remain on timeout-recovery; sanitized import mapping is in wave9 progress.

## Source migration map

| Historical source | Canonical source / disposition |
|---|---|
| vendor/bidirectional-bridge patches | shared/, scripts/, tests/ and Git history |
| wave5 workflow ZIP and patches | .agents/skills/, role-specific using-bridge skills, docs/features/ |
| wave6 operator helpers | tools/pilot/common/ |
| wave6 correction fixture/operator tools | tools/pilot/rework/ and tools/pilot/tests/ |
| wave7/wave8 active plans | docs/plans/ and this handoff |
| real pilot results, DBs, transcripts | private archive only; not build/test inputs |
| other vendor comparison experiments | historical archive; not active development sources |

No personal session IDs or machine configuration should be added here. Keep local cutover
commands outside the directories being moved. After resume, old experiments paths refer
to the archive and must not be reused as runtime paths.

## Publication provenance

Local review IDs above map to public commits below. Only private session-link trailers
were removed; source trees are unchanged. Original reviewed history remains in the local archive.

| Local review commit | Public commit |
|---|---|
| d850a02 | 306d3f2 |
| 7ae7f15 | a7a6182 |
| ceaf7f5 | 7403418 |
| 5b86f8e | 258370b |
| 4469246 | dfeed9c |
| 66b6f99 | 66c7347 |
| 70d8dd4 | e26b321 |


## Wave13 local correction checkpoint (2026-09-16)

Wave13 branch: round3 `6c4059a` delivered through Claude bridge, package verified.
Coordinator review02 closes R2-01/03/04; R2-02/05/06 remain in progress (namespace
root symlink and direct rotation/ENOSPC evidence). Independent focused tests30 PASS;
worker reports477 JS,32 Python,140 pilot/build/docs PASS. Next: round4 in the same
bridge feature/session. See `docs/plans/wave13-progress.md` and review02. Local only;
no push, merge, deployment or supervising runtime changes.


## Wave13 local delivery ready (2026-09-16)

Supersedes the correction checkpoint above: code `79b104d`, round4 task DONE,
independent review02 PASS, all R1/R2 findings resolved, W13-01–03 locally done.
Claude final checks:481 JS/34 files,32 Python,140 pilot-tooling,build/docs PASS.
Codex:24 export tests plus four namespace/source symlink reproductions PASS;
package provenance and docs116 PASS. Model-free only; ENOSPC injected at write/fsync.
Final full-range packet: F-W13-final-implementation.zip, worktree exchange namespace.
Progress and complete limitations: `docs/plans/wave13-progress.md`; recommendation:
local acceptance. User acceptance remains pending. No integration merge, CI, push,
deployment or changes to the pinned supervising runtime.


## Wave13 accepted — awaiting coordinator integration (2026-09-16)

Supersedes the pending-acceptance checkpoint: the user accepted local wave13 delivery
`9cf1f4321f3686fcdf6f42a7e9a3265798385440`. Coordinator review PASS is recorded at
`0109643ca570acf989ec83139871a1ff5f1748be` on `waves13-14-review`, as supplied by the user.
The actual user decision is `docs/features/F-W13-diagnostics/decisions/02.md`.
Bridge question q-01 answered; `bridge_feature_accept` returned accepted.

Wave13 is received locally and awaits integration by the coordinator. All original
ledgers, evidence and round/final packages are preserved. The final package still covers
67957034..9cf1f432, SHA-256
`69ebd0e2fc122f6a62df6f93c922108e6b1eca4cf0944234ba9ed3ea0951eb9a`.
This closeout adds no review or tests and performs no merge, push, deployment or integration.
No pending worker round remains. End this session after committing the documentation;
the integration coordinator owns the next step. See `docs/plans/wave13-progress.md`.

## Archived wave15 manager handoff entries

The following entries are retained from1a2866d; they describe their historical state.

## Distribution publication reconciled — 2026-09-17

Remote feature-workflow already contains accepted b64b858 and published v0.3.0
(prerelease), runtime pin2611d1e, CI35160973276 SUCCESS. Local e56c04e is superseded;
do not merge it over the newer release. No redundant push or runtime activation.
Next: marketplace from feature-workflow and real-project setup.
See [progress](plans/wave15-progress.md) for evidence and parallel decision histories.

## Wave15 — accepted 2026-09-17

User accepted local delivery b64b858 via q-01; see
[decision02](features/F-W15-natural-workflow/decisions/02.md).
Next: real-project setup procedure using an explicit wave15 runtime.
No installation, model smoke, push, merge or deployment performed.
Earlier pending acceptance entries are historical.
