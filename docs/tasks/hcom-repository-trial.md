# Hcom: bounded trial on this repository

Historical checkpoint: the trial ran and ended code PASS / receipt BLOCKED on
workflow1.1.0. See [review](../features/F-W21-repo-trial/reviews/01-implementation.md).
The preparation procedure below records its original scope, not authorization to
replay it after release1.1.1. Its lock/state remain unchanged; `hcom:prepare` now
refuses this blocked trial. New features select the released workflow through the
normal plugin begin/resolve entry; recovery of this stopped session is separate.

Status: ready to test; no model launched for this trial. F-W21 remains accepted.
Create the execution worktree from the latest F-W21 commit containing this version,
not from feature-workflow or the earlier handoff commit 930c498. The branch records
runtime 0.8.2, workflow 1.1.0, the trial lock, scope and hcom transport together.
This supersedes the temporary-disable/standalone procedure from 930c498.

The coordinator starts with `npm run hcom:prepare`. There are no version/transport
choices or configuration edits to ask the user to perform. Standard client permission
prompts still apply. This is a local test distribution, not a public release.

## Scope and authorization

Run the candidate feature-execute through hcom on one useful repository task:
make `claude/claude-side/test/fixtures/fake-claude-cli.mjs` deliver all requested
stderr before terminating in `noresult` mode, preserving exit code 3, framing and
other modes. On macOS the current immediate `process.exit(3)` can truncate
100001 bytes to 65536. The evidence test already detects this without changing
production behavior. Diagnose the fixture directly as well as through the runner.

Worker write scope:

- `claude/claude-side/test/fixtures/fake-claude-cli.mjs`
- `claude/claude-side/src/adapters/claude-code-runner.evidence.test.ts`, only if a
  meaningful regression assertion is needed; preserve the existing byte/tail checks.
- New ledgers under `docs/features/F-W21-repo-trial/execution/W21-T01/`.
- The current contract's ignored `.hcom-work/report-rN.json`.

No production runner changes, workflow changes, fixes for the unrelated RLIMIT
diagnostics or Linux /proc fixtures, release, push or merge. One Claude worker,
at most two task dispatches in the same session, at most 20 minutes from first
task dispatch to final receipt. Existing account and default permissions only;
no new API credentials, bypass flags or additional model reviewers. The coordinator
reviews independently because it does not implement the fixture change. Round 2
is for an actual finding, not an artificial change to demonstrate messaging.
At the deadline, stop dispatching; inspect unfinished work and settle/stop only
the owned worker normally. Timeout is not proof of delivery or cancellation.

Pasting the prompt authorizes this bounded execution, local commits and preparation
of the exact recorded dependencies. Preparation alone has not run it. Final feature
acceptance remains with the user; a task receipt is not feature acceptance.

## One prepared version

The committed project pin is `0.8.2-a303b643983b`, source commit
`a303b643983bf1ed1e896b1cbd252420ae30806b`. Bridge stays enabled. Its portable Codex
configuration omits the historical `cwd = "."` setting. No local pin edits or
runtime selection/database from another worktree are needed for this trial.

The committed feature lock selects workflow 1.1.0 with identity:

`sha256:2205a80f5109effb2596b021a4dc7738c86a9803db6fe93071f4cbf170a386eb`

The exact candidate bundle is included under `plugins/feature-workflow-codex/bundle`.
The feature index already selects hcom, and brief/design/decision/task are present.
The coordinator does not run begin/adopt/switch or replace the lock. Existing
F-W21-hcom-mvp acceptance and its historical workflow remain unchanged.

```sh
npm run hcom:prepare
```

Run in the new worktree with Node 24. This composes existing tools: verify the local
bundle against the lock, install the pinned runtime from this repository's exact
Git commit if absent, verify its contents, restore the exact included workflow to
its store, and resolve the recorded feature-execute entry. It does not update project
configuration, select a new version, start a model, claim a manager or install global
plugins. Repeating it does not reset trial execution state or change tracked files.
A missing runtime may require network access for its existing npm installer; the
repository includes sources and lockfiles, not OS binaries, npm cache or credentials.
Hcom, Claude and their existing login are host prerequisites. This host already has
the pinned runtime installed; its separate MCP doctor handshake passed.

Read the guide and feature-execute skill at the returned verified instruction root.
The executor uses that same bundle's Claude variant. Hcom is the transport even
though the project retains an enabled Bridge runtime. No Bridge manager/round calls
are used for this trial. Do not infer the current conversation's live MCP root from
an independent doctor result. No existing client restart is needed to load a new
Bridge connection for a task that does not use that connection.

Use Python >=3.11; on this host Python 3.12 and `TMPDIR=/private/tmp` avoid unrelated
fixture/environment errors. Use hcom_state.py's stable default namespace for this
canonical worktree and feature, save private launch/session metadata there, and use
its HCOM_DIR consistently. Do not copy state from another worktree or create a new
namespace to bypass a pending/unknown round. Contracts/reports stay in the committed
ignore pattern `.hcom-work/`. No private machine paths belong in tracked documents.

## Coordinator procedure

1. Read the prepared brief/design/decision/index and W21-T01. Verify the actual
   worktree, branch, HEAD and starting dirt. Resolve with `npm run hcom:prepare`;
   follow its selected skill. The scope and transport are already recorded: no new
   planning gate, feature creation, standalone override or configuration edits.
2. Prepare dependencies with `npm ci --ignore-scripts` and `npm run build` in this
   worktree, not in an installed runtime. Record environment and reproduce the
   focused failure before sending a task. Run the focused suite:
   `npm test -- claude/claude-side/src/adapters/claude-code-runner.evidence.test.ts`.
   If the reported defect is absent, investigate with a direct fixture reproduction;
   do not invent another task. Ordinary build/tests use no model budget.
3. Commit any coordinator-owned preparation/evidence separately before dispatch.
   Preserve unrelated changes. `.hcom-work/` is already ignored by this branch.
4. Follow the selected hcom loop exactly: stable private state/HCOM_DIR, fresh
   init launch grant, one headless interactive Claude with default permissions and
   empty MCP config, exact session binding, immutable round contract, prepare
   before send, acknowledgement recorded after send. Confirm actual versions/login.
   Never replay an uncertain send or replace an uncertain session. Review each
   actual permission prompt; no blind Enter loop or broad permission grant.
5. Contract checks include the focused evidence suite and a direct subprocess
   fixture check for exact bytes/tail and exit 3. Preserve other fixture modes.
   Freeze actual runnable commands and BASE; scope only the paths above. Read
   history before and after bounded waits, with progress updates. Coordinator
   makes no concurrent source/doc commits while the worker round is unsettled.
6. On RESULT_READY, validate correlation, actual Git ancestry, endpoint and every
   commit's scope, new ledger, declared checks and dirt attribution. Rerun decisive
   tests at delivered HEAD. Review independently and record accepted/rework/blocked
   receipt; send a fresh contract in the same session only if round 2 is needed.
7. Stop the owned worker normally and confirm stopped. Keep private state/history
   for diagnosis. If work is unsettled, preserve its exact state and report it for
   resumption; never reset/relaunch or discard unfinished changes.
8. Commit coordinator review, sanitized evidence and progress/handoff. Report
   commits, tests, round count, session continuity, approval interventions, duration,
   remaining issues and whether receipt was accepted. Never commit raw transcripts,
   account/session identifiers, databases, local config, contracts/reports or private
   state. Do not claim all repository tests passed from this focused check.

## Preparation validation

The earlier disposable standalone check is historical and not the start procedure.
The current branch was upgraded with the installed 0.8.2 updater; its standalone
MCP handshake passed (41 tools), with no manager claimed or model launched. Doctor
warned about unverified Codex 0.167.0 and a detected active Codex client; live MCP
verification remains separate. Workflow begin/resolve selected the exact 1.1.0
bundle against the enabled 0.8.2 pin. Candidate bundle bytes are unchanged.
Bootstrap regression checks and inherited-checkout evidence are recorded in handoff.
Actual repository delegation and fixture implementation remain for the test agent.

## Prompt for the new coordinator

```text
Wykonaj przygotowaną próbę F-W21-repo-trial przez hcom zgodnie z
AGENTS.md i docs/tasks/hcom-repository-trial.md. Zacznij od npm run hcom:prepare
w tym worktree i użyj wskazanego feature-execute. Wersje, transport i zadanie
są już zapisane w branchu; nie wybieraj ich ponownie ani nie wyłączaj Bridge'a.

Autoryzuję jednego Claude'a, maksymalnie dwie rundy w tej samej sesji i 20 minut,
na istniejącym koncie ze standardowymi uprawnieniami. Zleć poprawkę stderr
w fake-claude-cli, odbierz commity/ledger i przeprowadź niezależny review.
W razie konkretnego findingu zleć drugą rundę. Autoryzuję lokalne commity
w ustalonym zakresie. Bez dodatkowych agentów, push, merge i publikacji.
Zakończ raportem testów, commitów i działania hcom; nie poszerzaj zakresu.
```
