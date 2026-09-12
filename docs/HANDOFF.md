# Current handoff

Canonical repository: McAvity/bidirectional-bridge-claude-codex, branch feature-workflow.
The fork preserves grizzly2005 upstream history and MIT notices. This repository contains
all development inputs; the historical experiments workspace is an optional private archive.

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

Parallel integration task: [wave9](plans/wave9.md), with its own
[progress](plans/wave9-progress.md). It integrates timeout/recovery and reconciles
status without touching the runtime or worktree used by active wave7.

Wave8 directory cutover and resumed-session checks are complete (see plans/wave8.md). Continue
plans/wave7.md: manager/workspace identity and two-worktree isolation, diagnostic export,
versioned setup for normal codex startup, dependency maintenance and acceptance tests.
The current role owner `codex` is not a unique manager session identity. Use one active
manager/feature per worktree. No closed-manager wake-up, orphan supervisor or /goal support
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
