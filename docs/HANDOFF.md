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

Complete local directory cutover and resumed-session checks in plans/wave8.md. Then continue
plans/wave7.md: manager/workspace identity and two-worktree isolation, diagnostic export,
versioned setup for normal codex startup, dependency maintenance and acceptance tests.
The current role owner `codex` is not a unique manager session identity. Use one active
manager/feature per worktree. No closed-manager wake-up, orphan supervisor or /goal support
is claimed. docs/tasks/review-integration-drift.md is a proposal, not active workflow policy.

## Source migration map

| Historical source | Canonical source / disposition |
|---|---|
| vendor/bidirectional-bridge patches | src/, scripts/, tests/ and Git history |
| wave5 workflow ZIP and patches | .agents/skills/, role-specific using-bridge skills, docs/features/ |
| wave6 operator helpers | tools/pilot/common/ |
| wave6 correction fixture/operator tools | tools/pilot/rework/ and tools/pilot/tests/ |
| wave7/wave8 active plans | docs/plans/ and this handoff |
| real pilot results, DBs, transcripts | private archive only; not build/test inputs |
| other vendor comparison experiments | historical archive; not active development sources |

No personal session IDs or machine configuration should be added here. Keep local cutover
commands outside the directories being moved. After resume, old experiments paths refer
to the archive and must not be reused as runtime paths.
