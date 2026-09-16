# Current handoff

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
