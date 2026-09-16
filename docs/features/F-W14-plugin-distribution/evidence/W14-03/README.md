# W14-03 — corrections evidence

What the corrections do, how each was proven, and what is still not evidenced. Hosts: `codex-cli
0.154.0`, Claude Code `2.1.273`, Node `v24.15.0`. Every client run is model-free and every profile
lives under a temporary root; the operator's own configuration is never read for settings and never
written. **No test mutates a file of this repository** — generator drift is proven on a throwaway
git worktree.

## The correction in one line

The parallel setup implementation is gone. `setup` installs a pinned runtime through the wave12
installer and writes the worktree through wave12 `planChange`/`applyPlan`; the project keeps a
declaration and a 54-line entry point, and a launch gate refuses before anything is served.

## Checks

| Command | Result |
| --- | --- |
| `npm ci --ignore-scripts` | exit 0 |
| `npm run build` | exit 0 |
| `npm test` | 33 files, 462 tests, exit 0 (28 of them the distribution suite) |
| `npm run packages:check` | exit 0 |
| `python3 -m unittest discover -s tests -v` | 42 tests, OK |
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
| AC-03 a new external worktree works with no manual init, with its own state | The inherited worktree has no `.bridge-runtime/`; one `setup` writes only `.bridge-runtime/current`, with no reinstall and no configuration rewrite; the entry point then serves, bound to that worktree's own database path | **met**, with the host trust decision for the new path stated explicitly |
| AC-04 Astra delegates with the right instructions and no executor setup in the project | `ClaudeHost.test_a_delegated_executor_loads_the_package_with_no_install` (empty profile, no project `.claude/`, ≥6 workflow skills, zero tokens) plus the runner passing `--plugin-dir <runtime>/plugins/bridge-claude` | **met at the mechanism level.** No real delegation ran |
| AC-05 a plugin update does not change a running feature's version | The pin is the committed declaration and the runtime lives outside any plugin cache; deleting a whole plugin cache leaves the instruction set byte-identical; a pin that differs from the applied selection is refused at launch, not switched | **met for the pin, the instruction set and the launch.** "A feature mid-round survives" was not exercised with a live round |
| AC-06 handshake/read/foreign refusal mutate nothing; concurrent preparation is safe | `status` compares full directory listings; a real MCP handshake and `tools/list` create no database; two racing `setup` processes leave one consistent result and no `pending.json`; a real interrupted apply is completed by the next run | **met** |
| AC-07 migration preserves data and custom settings, no double MCP, CLI fallback | Migration keeps the user's `config.toml` neighbours, `.gitignore` entries and their own `.agents/skills/` file, and leaves exactly one `[mcp_servers.bridge]`; the plugin declares no MCP server of its own; wave12 `init`/`update`/`rollback` are unchanged and still pass their suite | **met** |
| AC-08 doctor recognises installation and versions | `doctor --json` emits `distribution` with `integration_source`, package/runtime/instruction identities, configured-vs-observed executor identity and tri-state `pin.diverged`, with no path disclosed | **doctor part met.** `diagnose` is wave13's and is deferred by `decisions/02.md`: **not** claimed |
| AC-09 documentation covers install, new project/worktree, update, migration, rollback, removal | `docs/plugin-distribution.md`, plus the wave14 sections of `docs/setup.md` and `docs/setup-layout.md` | **met** |

## What is still not evidenced

- **No model ran.** No Astra → Claude round. Every "met" is a mechanism measured on a host.
- **The interactive Codex TUI is untested.** All Codex evidence is `codex exec`. Codex does not
  forward an MCP server's stderr, so the host test proves (a) the host resolves the inherited block
  and starts a session, and (b) the same committed entry point serves a real 35-tool bridge bound
  to that worktree — it does not observe the server inside the TUI.
- **The network fetch path of `acquireSource` is unexercised** (see W14-R2-01 above).
- **One host, one OS, one version of each client.**
- **Wave13 is deferred by `decisions/02.md`.** The metadata block is doctor output only; joint
  diagnose/logging validation stays an open item, not a passing check.
- **An in-use refusal during `update`/`rollback` is inherited from wave12**, not re-proven here with
  a live bridge server attached to the worktree under test.
