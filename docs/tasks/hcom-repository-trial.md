# Hcom: bounded trial on this repository

Status: prepared; no model launched for this trial. F-W21 remains accepted.
Preparation baseline: F-W21 acceptance commit `9e25ca9`. Create the execution
worktree from the later commit containing this document, not from feature-workflow.
The user creates that worktree and gives its coordinator the prompt below.

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

Pasting the prompt authorizes this bounded execution, local commits and the local
standalone configuration below. Preparation alone has not run it. Final feature
acceptance remains with the user; a task receipt is not feature acceptance.

## Bridge pin versus workflow selection

The main checkout's local pin can be 0.8.0 while this branch's committed pin is
0.6.2. A new worktree inherits committed files, not another checkout's local edit.
Bridge runtime 0.8.2 and workflow 1.1.0 are separate releases. Updating the runtime
alone does not select this candidate workflow; 1.1.0 has not been published.

This trial deliberately selects standalone hcom in the new execution worktree.
It does not require upgrading the main checkout or restarting its client. Do not
invoke any Bridge MCP tools, including a manager claim. A loaded MCP connection
is not proof that it belongs to this worktree. Do not modify global plugins,
installed runtimes, another worktree's declaration or an existing feature's lock.

Before selection, confirm this is the user's new isolated worktree, not F-W21's
preparation checkout or the main checkout. Record canonical root, branch, HEAD and
starting dirt. Ensure there is no existing active trial/Bridge workstream in it.
Save the exact original `.bridge-project/bridge.json` bytes privately, and set only
`enabled` to `false` in that worktree. Keep the pin fields intact. This is a
deliberate test configuration, not a fallback around a resolver refusal. Do not
commit this local change; record it as coordinator-owned baseline dirt, excluded
from worker delivery. Do not change `.codex/config.toml` or repair global MCP.

Use Node 24 and Python >=3.11, checking the actual binaries available. On this
host Python 3.12 and `TMPDIR=/private/tmp` avoid unrelated test-environment errors.
Keep a private persistent trial directory outside the worktree and record its
location for resumption. Use its `workflow-store` as
`CLAUDE_CODEX_BRIDGE_HOME` consistently for every workflow helper call, and its
`state` as the explicit hcom helper state. This does not select a Bridge runtime.
Never reuse another trial's state or change these paths to evade a refusal.

From the actual new worktree, after the explicit local disable:

```sh
node plugins/feature-workflow-codex/scripts/workflow.mjs verify-plugin --json
node plugins/feature-workflow-codex/scripts/workflow.mjs begin \
  --feature-id F-W21-repo-trial --standalone --json
node plugins/feature-workflow-codex/scripts/workflow.mjs resolve \
  --feature F-W21-repo-trial --entry feature-execute --standalone --json
```

Run `begin` only for a new trial before creating its feature documents. On resume,
resolve the existing lock instead. Require `source: bundle`, `code: BOUND_BUNDLE`,
`project.pin: standalone`, version 1.1.0 and identity:

`sha256:2205a80f5109effb2596b021a4dc7738c86a9803db6fe93071f4cbf170a386eb`

Read the guide and feature-execute entry from the returned instruction root,
including `references/hcom-loop.md` and `references/local-delivery.md`. Verify
the returned bundle; the worker gets that bundle's `claude` directory, not an
installed global skill. Any mismatch blocks dispatch; do not regenerate packages
or silently choose another source. This is a local candidate test, not proof of
marketplace installation or a Bridge runtime upgrade.

## Coordinator procedure

1. Record this approved scope in a minimal separate trial brief/design/decision,
   task and feature index, using the selected workflow conventions. Record
   `execution.transport: hcom`; leave accepted F-W21 documents unchanged. No new
   planning gate is needed for the exact scope authorized by the prompt.
2. Prepare dependencies with `npm ci --ignore-scripts` and `npm run build` in this
   worktree, not in an installed runtime. Record environment and reproduce the
   focused failure before sending a task. Run the focused suite:
   `npm test -- claude/claude-side/src/adapters/claude-code-runner.evidence.test.ts`.
   If the reported defect is absent, investigate with a direct fixture reproduction;
   do not invent another task. Ordinary build/tests use no model budget.
3. Commit coordinator documents/lock separately. Do not stage the local declaration
   change. Add `.hcom-work/` to Git's resolved info/exclude if absent (it can be
   shared by linked worktrees; append only this pattern, preserve existing entries).
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
7. Stop the owned worker normally and confirm stopped. Restore the original local
   declaration bytes only after confirming it still contains exactly the local
   test edit and no later edits; never reset unrelated dirt. If work is unsettled,
   preserve the exact state/config and report it for resumption instead.
8. Commit coordinator review, sanitized evidence and progress/handoff. Report
   commits, tests, round count, session continuity, approval interventions, duration,
   remaining issues and whether receipt was accepted. Never commit raw transcripts,
   account/session identifiers, databases, local config, contracts/reports or private
   state. Do not claim all repository tests passed from this focused check.

## Preparation validation

On 2026-11-10 a disposable Git repository with the inherited pin explicitly
disabled and a separate store passed verify-plugin, begin and resolve above.
Resolve returned the exact identity and standalone BOUND_BUNDLE. No model was
launched. This validates bootstrap selection only; actual repository delegation
and the fixture fix remain for the new agent. Candidate bundle bytes are unchanged.

## Prompt for the new coordinator

```text
Przeprowadź opisaną w docs/tasks/hcom-repository-trial.md próbę feature-execute
przez hcom w tym nowym worktree. To zlecenie wykonania, nie samo planowanie.
Przeczytaj AGENTS.md, docs/HANDOFF.md i procedurę próby. Ustal rzeczywisty root,
branch i HEAD; nie pracuj w głównym checkoutcie ani przygotowawczym F-W21.

Jawnie wybieram standalone hcom tylko dla tego worktree. Zgadzam się na opisane
tymczasowe enabled=false w jego deklaracji Bridge'a, z zachowaniem pina,
bez commitowania tej konfiguracji i z bezpiecznym przywróceniem po próbie.
Wybierz i zweryfikuj wskazany lokalny pakiet workflow 1.1.0 przez begin/resolve
--standalone. Nie używaj starego zainstalowanego skilla ani Bridge MCP.

Zleć jednemu Claude'owi przez hcom poprawkę ucinanego stderr w fake-claude-cli,
zgodnie z zakresem i kontrolami z dokumentu. Autoryzuję realną delegację na
istniejącym koncie, maksymalnie dwie rundy w tej samej sesji i 20 minut od
pierwszego zlecenia do odbioru, ze standardowymi uprawnieniami. Autoryzuję
potrzebne lokalne commity kodu, ledgerów i dokumentacji. Jako koordynator
wykonaj niezależny review dostawy i ewentualną drugą rundę konkretnych poprawek.

F-W21 pozostaje zaakceptowany; dla próby użyj F-W21-repo-trial / W21-T01.
Nie poszerzaj zakresu, nie uruchamiaj dodatkowych agentów, nie rób push/merge
ani wydania. Zakończ raportem testów, commitów i rzeczywistego przebiegu hcom.
Przy blokadzie zachowaj stan i wskaż konkretną przyczynę; bez cichego fallbacku.
```
