# W14-03 — corrections evidence

What the corrections do, how each was proven, and what is still not evidenced. Hosts: `codex-cli
0.154.0`, Claude Code `2.1.273`, Node `v24.15.0`. Every client run is model-free and every profile
lives under a temporary root; the operator's own configuration is never read for settings and never
written. **No test mutates a file of this repository** — generator drift is proven on a throwaway
git worktree.

## Round 6 — one rule for interrupted preparation (W14-R2-07, pre-journal boundary)

**Reproduced** at `dabaf19…` against the shipped pin, in a temporary runtime home asserted by the
script itself. The gate defined a recoverable reservation as `!existsSync(local.dir) && native own`,
so an interruption immediately *after* the `.bridge-runtime` mkdir — an empty directory plus a valid
own marker — was refused:

```
2_after_mkdir   dir=True pend=False rec=False marker=True | read=False recovered=False
                SETUP_STATE_PARTIAL: ... has partial state that is not this worktree's own: unexplained
```

**Fixed** by replacing the accumulated per-boundary conditions with one rule: local state that is
*explained* as this worktree's own — by its selection journal or by the runtime's own state marker
— and *not contradicted* may finish through the existing guarded plan, whether or not the directory
exists. A bare directory is neither evidence nor contradiction; unknown files in it are preserved.
Foreign and unreadable journals and markers, a non-symlink `current`, foreign or invalid records,
pin mismatches, symlinked managed paths and the native identity guard are all unchanged.

Five interruption points against the refreshed pin `87cceed8…`:

```
1 before mkdir                     dir=False pend=False rec=False | read=True recovered=True pending_after=False
2 after mkdir                      dir=True  pend=False rec=False | read=True recovered=True pending_after=False
3 after journal, before selection  dir=True  pend=True  rec=False | read=True recovered=True pending_after=False
4 after selection                  dir=True  pend=True  rec=False | read=True recovered=True pending_after=False
5 after record                     dir=True  pend=True  rec=True  | read=True recovered=True pending_after=False
```

Every restart serves reads with a byte-identical tree and no setup command; every recovery happens
at the next authorised mutation and leaves no journal behind. Regressions:
`every interruption boundary recovers itself (W14-R2-07)`, five cases driven by the same helper,
plus the refusal cases below.

One defect of this round, found and fixed before the pin was refreshed: reading the selection inside
the new rule put it in the temporal dead zone, so the first pinned build threw on every launch. The
reproduction caught it because it runs the *installed* pin rather than the working tree.

## Round 5 — the remaining interruption boundaries and rollback (W14-R2-07, R2-09)

Reproduced at `f3bba25…` with an explicit temporary runtime home asserted before every mutating
call, then fixed and re-proven against the refreshed default pin `ba4025b1…`. Nothing ran in the
operator's own bridge home, and no unrelated runtime was inspected or removed.

### W14-R2-07, boundary before the first `.bridge-runtime` write

**Reproduced** with the reviewer's one-shot preload, which kills the process at the first
`.bridge-runtime` creation — after the runtime has made its own native reservation:

```
A_crash:        exit=-9  state_dir=true  marker=true  local_dir=false
A_restart_read: served=false   ("…it never adopts state it did not write")
A_recover:      no reply        record=false
```

**Fixed.** `.bridge/workspace.json` is the runtime's own record of which worktree that state
belongs to, so it is the existing authority for "explained and mine". `classifyNativeState` reads
it — read-only, no database opened — and an `own` reservation with no selection directory now
serves reads and is completed by the next authorised mutation:

```
A_restart_read: served=true, 35 tools, tree unchanged
A_recover:      isError=null   record=true
```

### W14-R2-07, boundary after the record write

**Reproduced** with `CLAUDE_CODEX_BRIDGE_TEST_CRASH_AFTER=2`: the record is written before the
journal is removed, so `pending.json` survived, and a later successful mutation left it in place
forever (`pending_still_there: true`) because `decide` reported `resuming=false` for a valid record
and the materialiser returned early on one.

**Fixed.** An *own* unfinished journal is work to complete even when the record is valid;
`planChange` picks it up as `plan.pending` exactly as the CLI does. `pending_still_there: false`.

### W14-R2-09 — default rollback selected the current runtime

**Reproduced:** after a real `update`, `rollback --yes` refused `ROLLBACK_SAME_RUNTIME` naming the
runtime it was supposed to leave, because the resolver treated rollback like setup and read the
declared pin.

**Fixed** by extracting the wave12 CLI's history-based `rollbackTarget` into
`scripts/setup/workspace.mjs` and sharing it verbatim:

```
update   --to 0.2.0-242330778de4  -> ok
rollback --yes                    -> ok, runtime 0.2.0-ba4025b1425d
declaration_now = selection_now   = 0.2.0-ba4025b1425d      db_preserved = true
```

Explicit `--to` still wins; the compatibility and active-session guards are the plan's own.

### Independent host evidence cited, not re-run

The coordinator's review records a plain interactive Codex 0.154.0 TUI in an isolated profile, with
a trusted pristine inherited worktree, a provider pointed at a closed local port and the installed
repository marketplace plugin: `/mcp` shows **bridge connected (35 tools)** and `/skills` shows
**bridge (bridge-codex)**, exit 0, with no `.bridge-runtime` or `.bridge` created and no model
session events. That observation is on runtime `6b483b2e…`. It establishes normal TUI startup and
instruction discovery — **not** a real delegation, and not the recovery behaviour of the later
runtimes. It is cited here as the coordinator's evidence; this round did not re-run it and no model
was used.

## Round 4 — the guard/journal boundary (W14-R2-06…08)

The reviewer reproduced three defects on the shipped runtime `6b483b2e…`. All three are reproduced
here and fixed; the evidence below is from real runtimes, model-free.

### W14-R2-06 — two first uses of the same worktree

**Reproduced** with the reviewer's own script at `6b483b2e…`: both processes returned
`INTERNAL/ACTIVE_SESSION` naming the other's `state-open` descriptor, `record_exists: false`.

**Fixed.** The same script against the corrected runtime `2423307…`:

```
outcomes: ["OWNER", "MANAGER_FOREIGN_THREAD"]
record_exists: true   pending_exists: false
record_root: <this worktree>
reads_after: [true, true]
```

Exactly one owner; the loser is refused by the native guard itself and writes nothing; neither
process is wedged. Regression: `two first uses of the SAME worktree (W14-R2-06)`. The ordinary CLI
`ACTIVE_SESSION` refusal while a server is serving is re-asserted in the same block.

### W14-R2-07 — interrupted automatic preparation

**Reproduced:** with `CLAUDE_CODEX_BRIDGE_TEST_CRASH_AFTER=1` the first authorised mutation exits
`-9` leaving `pending.json` and the state directory; the restart refused `SETUP_STATE_PARTIAL`.

**Fixed.** Against the corrected runtime:

```
interrupted_exit: -9        after_crash: record=false pending=true state_dir=true
restart_read:  served=true  tree_unchanged=true          (no setup, no writes)
recovered:     isError=null record=true  pending=false   record_root=<this worktree>
```

Regression: `an interrupted automatic first use (W14-R2-07)`, plus three refusal cases — a journal
copied from another worktree, an unreadable one, one naming another runtime, and one with no
workspace recorded — each leaving the file byte-identical and serving nothing.

### W14-R2-08 — the plan installed a runtime

**Reproduced:** `setup` without `--yes` returned `applied=false, runtime_installed_now=true`. Worse
than reported: with no `CLAUDE_CODEX_BRIDGE_HOME` set it installed
`0.2.0-6b483b2e1a23` into the operator's **real** `~/.local/share/claude-codex-bridge/runtimes/`.
That runtime was removed immediately after the reproduction, by hash-confirming it was the one the
dry run created; the supervisor runtime `0.2.0-860e2e77d95f` beside it was not touched and no
`sources/` cache was created.

**Fixed.** The same command now reports `applied=false`, `runtime_installed_now=false` and
`would_install_runtime.commit`, and creates neither the bridge home nor anything in the project.
Regression: `the setup plan is read-only (W14-R2-08)`, which also asserts the reviewable per-file
plan is still produced when the runtime *is* installed.

## Corrected in the previous attempt of this round

Three concrete defects were found in the first W14-03 attempt and are fixed here:

1. **The release pin named a commit that does not exist.** `git cat-file -e` rejected it. The pin
   is now a real commit of this repository that carries the corrected runtime, and a test runs
   `git cat-file -e` on whatever the package ships.
2. **AC-03 was still not met.** The launch gate refused a worktree with no local record, so every
   inherited worktree needed a manual `setup` — and the tests hid it by calling `setup` themselves.
   Fixed by the step back described below.
3. **`verify` reported an installation-supplied document as missing**, because it resolved every
   manifest entry against the target repository regardless of provenance.

## The correction in one line

The parallel setup implementation is gone. `setup` installs a pinned runtime through the wave12
installer and writes the worktree through wave12 `planChange`/`applyPlan`; the project keeps a
declaration and a 54-line entry point, and a launch gate refuses before anything is served.

## Checks

| Command | Result |
| --- | --- |
| `npm ci --ignore-scripts` | exit 0 |
| `npm run build` | exit 0 |
| `npm test` | 33 files, 486 tests, exit 0 (52 of them the distribution suite) |
| `npm run packages:check` | exit 0 |
| `python3 -m unittest discover -s tests -v` | 43 tests, OK |
| `python3 -m unittest discover -s tools/pilot/tests -v` | 140 tests, OK (1 skipped) |
| `git diff --check` | clean |
| relative-link scan over `docs/**/*.md` and `*.md` | no broken links |

`scripts/bridge-project/bridge-project.test.ts` and `tests/test_plugin_distribution.py` both build
**one real runtime** with the product's own installer, from this repository's HEAD commit, and run
every case against it. There is no recorder fixture standing in for the bridge anywhere.

## Disposition of the review findings

### W14-R2-01 — installation and local preparation

**Reproduced:** in a clean project, revision 2's `prepare` returned `NO_PIN`, the skill told the
user to clone a bridge, and no `install.json` or `current` was ever written.

**Fixed.** The Codex package now carries the installer (`scripts/bridge.mjs`, `scripts/setup/*`)
and `scripts/plugin-packages/release.json`, a *source* file pinning a full commit and a repository.
`setup` picks the runtime (the project's declared pin first, otherwise the release pin — the caller
never supplies an id), acquires that commit with `acquireSource()` (explicit `--source`,
`CLAUDE_CODEX_BRIDGE_SOURCE`, a cache under `<home>/sources/`, then a fetch of exactly that commit,
hash-verified in every case), installs it immutably, and writes the worktree through the wave12
plan — including `.bridge-runtime/install.json` and `current`.

Proven by: `installation from the distribution` (5 cases) and
`CodexHost.test_the_repository_marketplace_installs_a_package_that_can_set_a_project_up`, which
installs the package from the repository marketplace into a disposable Codex home and then runs the
*installed* entry point.

**Honest limit:** the fetch path needs the pinned commit to be reachable in the configured
repository. This branch is not published, so the tests exercise `--source` and the local cache —
which are the offline, reproducible paths — and the fetch path itself is unexercised here.

### W14-R2-02 — instructions and exporter outside this checkout

**Reproduced:** the generated exporter failed with
`Missing selected file: ${CLAUDE_PLUGIN_ROOT}/workflow/README.md`, because the generator had
rewritten a Python string literal.

**Fixed.** The generator rewrites only `.md`/`.yaml`/`.yml`; code is copied byte for byte, and a
test asserts no instruction text still points into a bridge checkout. `feature_exchange.py` now
resolves the shared workflow guide deliberately: the target repository's own copy when it has one,
otherwise `--workflow-guide`, `$BRIDGE_WORKFLOW_GUIDE`, or the copy shipped beside the helper. The
archive name stays canonical and the manifest records `source: installed`.

Proven by: `InstalledExporter` — export **and** verify in a foreign minimal repository, from the
installed runtime helper *and* from the generated Claude package helper, with `integrity: ok` and
the guide present although the foreign repository has none. The manager entry skill now hands the
manager absolute `instructions.*` paths (role skill, workflow skills, exchange helper, executor
package), checked to exist under the runtime by
`installation from the distribution > points the manager at instructions inside the installed runtime`.

### W14-R2-03 — pin, migration and foreign-state checks

**Reproduced:** `status` said `pin-diverged` and `foreign-record` while the dispatcher still routed
`route=runtime`; an existing custom `[mcp_servers.bridge]` was preserved *and* a second table
appended.

**Fixed.** `bootstrap.mjs` and `facade.mjs` are deleted. Writes go through `planChange`, which
already owns symlink refusal, the copied-record refusal, ownership-hash conflicts, the
`mcp_servers.bridge` conflict rules, `findActiveUse` and the resumable journal; the dispatcher
profile adds only two managed files to that plan. Launching goes through `decide()`, which
validates the declaration, the runtime manifest, the **pinned commit**, the identity resolved by
the runtime's own code, the record and the selection — all before the server is imported.

Proven by: `reads and refusals never mutate` (7 cases, each asserting the bytes are unchanged) and
`the launch gate` (7 cases, each asserting `replies == []`, i.e. nothing served). The custom-table
case asserts the file is byte-identical and `preserves the user's own content` asserts exactly one
`[mcp_servers.bridge]` table after a migration.

### W14-R2-04 — dispatcher left the runtime alive

**Reproduced:** the synthetic runtime spawned by the dispatcher survived SIGTERM to the dispatcher.

**Fixed.** There is no child process. The entry point imports the runtime's launcher into its own
process after rewriting `process.argv`, so the client's signal reaches the real server and the
runtime's existing close behaviour is unchanged.

Proven by: `closing the client` — `pgrep -P <entry pid>` is empty while serving, SIGTERM closes the
process, and no process matching the entry point remains.

### AC-03 — the step back

Requiring `setup` in each worktree was the third appearance of the same requirement, so the design
stepped back instead of being patched a third time.

A worktree inherited from an enabled project is pristine by construction: committed declaration and
entry point, none of its own local state. The gate now serves it, and registers what its first
mutating call must write. The server runs that **once, inside the guarded mutation, after the
identity guard authorises the caller** — the existing boundary in `runTool`, not a new one. There is
no second setup facade, no hand-written project code and no per-worktree command or restart.

Proven end to end against a real runtime, in `an inherited worktree serves without any manual step`:

| Case | Assertion |
| --- | --- |
| pristine | declaration and entry point inherited, `.bridge-runtime/` and `.bridge/` absent, status `inherited-pristine` |
| handshake and reads | `serverInfo` answered, >10 tools listed, and a full directory listing is byte-identical before and after — **no setup call** |
| first authorised mutation | `bridge_create_task` succeeds; the worktree's own `install.json` (naming itself), `current` (pointing at the pinned runtime) and `bridge.db` appear, in the same process |
| unauthorised mutation | `NATIVE_CONTEXT_INVALID`, and the listing is unchanged: nothing is materialised for a caller the guard refuses |
| partial state | a `.bridge-runtime/` with an unusable record is refused and left byte-identical, never repaired |
| own database | `db=<this worktree>/.bridge/bridge.db`, never the checkout it came from |
| two worktrees | both materialise concurrently, each recording its own root |

The mutation uses a **synthetic native turn envelope** — the `_meta` shape the host sends. The guard
validates every field of it, so nothing is faked and no model is involved.

Known limit, stated rather than hidden: `bridge_manager_resume_instance` and
`bridge_manager_takeover` drive the guard themselves and do not trigger materialisation.

### Active update and rollback

`update --to <older runtime>` while a bridge server is serving the worktree is refused with
`ACTIVE_SESSION`, and neither the committed declaration nor the applied selection moves. Proven with
this round's own test runtime and a live server, model-free.

### W14-R2-05 — evidence overstated coverage

**Fixed.** The matrix below is re-derived from the checks above. The test that edited the canonical
skill tree now does it in a `git worktree add --detach` copy and removes it afterwards, and asserts
the canonical tree still passes `--check`. The W14-02 evidence page is corrected in place; its
earlier `488 JS / 34 files` line was wrong and is replaced by the measured figure.

## A defect the new tests found

`new URL(".", import.meta.url).pathname` percent-encodes, so a project directory containing a space
made the entry point look for `a%20project%20with%20spaces/.bridge-project/bridge.json`. Fixed with
`fileURLToPath` in both the entry point and the launch gate. It was invisible until every test
worktree had a space in its path.

## Acceptance criteria

| AC | Evidence | Status |
| --- | --- | --- |
| AC-01 reproducible marketplace install for both hosts | `CodexHost` and `ClaudeHost` install from this repository's marketplaces into disposable homes; `GeneratedPackages` proves deterministic generation, the source-equivalence gate and its failure mode | **met** |
| AC-02 one instruction enables a project; plain `codex` then has tools and instructions with no MCP flags | `setup` from the installed package does the whole job; `codex mcp list` resolves the inherited block with no machine path in it, and a plain `codex exec` session starts model-free with it | **met for the mechanism.** The skill invocation itself is a model action and was not exercised by a model |
| AC-03 a new external worktree works with no manual init, with its own state | The inherited worktree runs **no bridge command at all**: it serves reads with a byte-identical tree and creates its own record, selection and database on the first authorised mutation, bound to its own database path. Partial and copied state are refused. See the AC-03 table above | **met**, with the host trust decision for the new path stated explicitly |
| AC-04 Astra delegates with the right instructions and no executor setup in the project | `ClaudeHost.test_a_delegated_executor_loads_the_package_with_no_install` (empty profile, no project `.claude/`, ≥6 workflow skills, zero tokens) plus the runner passing `--plugin-dir <runtime>/plugins/bridge-claude` | **met at the mechanism level.** No real delegation ran |
| AC-05 a plugin update does not change a running feature's version | The pin is the committed declaration and the runtime lives outside any plugin cache; deleting a whole plugin cache leaves the instruction set byte-identical; a pin that differs from the applied selection is refused at launch, not switched; and `update` is refused with `ACTIVE_SESSION` while the worktree is served, moving neither the declaration nor the selection | **met for the pin, the instruction set, the launch and the in-use refusal.** "A feature mid-round survives" was not exercised with a live delegated round |
| AC-06 handshake/read/foreign refusal mutate nothing; concurrent preparation is safe | `status` compares full directory listings; a real MCP handshake and `tools/list` create no database; **two first uses of the same worktree** yield one owner and one `MANAGER_FOREIGN_THREAD` with no writes from the loser; an interrupted automatic preparation resumes at the next authorised mutation after a pure read; copied, unreadable, runtime-mismatched and workspace-less journals are refused unchanged; two racing `setup` CLI processes leave one consistent result | **met** |
| AC-07 migration preserves data and custom settings, no double MCP, CLI fallback | Migration keeps the user's `config.toml` neighbours, `.gitignore` entries and their own `.agents/skills/` file, and leaves exactly one `[mcp_servers.bridge]`; the plugin declares no MCP server of its own; wave12 `init`/`update`/`rollback` are unchanged and still pass their suite | **met** |
| AC-08 doctor recognises installation and versions | `doctor --json` emits `distribution` with `integration_source`, package/runtime/instruction identities, configured-vs-observed executor identity and tri-state `pin.diverged`, with no path disclosed | **doctor part met.** `diagnose` is wave13's and is deferred by `decisions/02.md`: **not** claimed |
| AC-09 documentation covers install, new project/worktree, update, migration, rollback, removal | `docs/plugin-distribution.md`, plus the wave14 sections of `docs/setup.md` and `docs/setup-layout.md` | **met** |

## What is still not evidenced

- **No model ran.** No Astra → Claude round. Every "met" is a mechanism measured on a host.
- **TUI evidence is startup only, and is the coordinator's.** Its review observed `/mcp` connected
  with 35 tools and `/skills` listing the plugin on runtime `6b483b2e…`, with no state created and
  no model turn. This round's own Codex evidence is `codex exec`; Codex does not forward an MCP
  server's stderr, so the host test proves the host resolves the inherited block and that the same
  committed entry point serves a real 35-tool bridge bound to that worktree. Neither is a real
  delegation, and neither covers the later runtimes' recovery behaviour inside the TUI.
- **One host, one OS, one version of each client.**
- **Wave13 is deferred by `decisions/02.md`.** The metadata block is doctor output only; joint
  diagnose/logging validation stays an open item, not a passing check.
- **`bridge_manager_resume_instance` and `bridge_manager_takeover` do not materialise** a pristine
  worktree's local state, because they drive the identity guard themselves. A pristine worktree
  whose first call is one of those stays pristine.
- **The release pin is reachable only locally** until this branch is published, so the fetch path
  stays unexercised while `--source` and the cache are proven.
- **Recovery is proven at one write boundary** (`CLAUDE_CODEX_BRIDGE_TEST_CRASH_AFTER=1`, the first
  write of the apply). Later boundaries are covered by the same journal but were not each injected
  individually.
- **`insideGuardedMutation` is used by exactly one caller**, the materialiser. It removes only the
  process-scan veto; if a future caller passed it from outside the guard, the ordinary
  active-session protection would not apply to that caller.
