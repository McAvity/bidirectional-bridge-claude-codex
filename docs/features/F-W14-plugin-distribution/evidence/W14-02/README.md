# W14-02 — implementation evidence

What was built, how it was checked, and what is still unproven. Host versions: `codex-cli
0.154.0`, Claude Code `2.1.273`, Node `v24.15.0`. Every host run below is model-free and uses a
disposable profile under a temporary root; the operator's own configuration is never read for
settings and never written.

## Checks

| Command | Result |
| --- | --- |
| `npm ci --ignore-scripts` | exit 0 |
| `npm run build` | exit 0 |
| `npm test` | 33 files, 461 tests, exit 0 (27 of them the new dispatcher suite) |
| `npm run packages:check` | exit 0 — packages match their canonical sources |
| `python3 -m unittest discover -s tests -v` | 41 tests, OK |
| `python3 -m unittest discover -s tools/pilot/tests -v` | 140 tests, OK (1 skipped) |
| `git diff --check` | clean |
| relative-link scan over `docs/**/*.md` and `*.md` | no broken links |

`tests/test_plugin_distribution.py` is the **host** evidence; `scripts/bridge-project/bridge-project.test.ts`
and `tests/plugin-probes/` are unit and fixture checks and prove nothing about a host.

## New host findings in this round

Both were measured while building the dispatcher and both changed the design.

- **A project `.codex/config.toml` is read only for a trusted project.** Without
  `projects."<path>".trust_level = "trusted"` in `CODEX_HOME/config.toml`, Codex starts no
  project-scoped MCP server at all. This is host consent; it is surfaced, not bypassed. It means a
  *new path* — including a new worktree — always involves the host's own trust decision.
- **Codex loads no project configuration when started in a subdirectory.** Launching from
  `<root>/sub dir/deeper` produced no MCP server. Combined with the above, a bridge worktree must
  be opened at its root. The bridge does not work around this and does not pretend to.
- **The environment is stripped for a project-scoped MCP server too**, not only for a
  plugin-scoped one. The first dispatcher hand-over test failed for exactly this reason: the
  server could not see `CLAUDE_CODEX_BRIDGE_HOME` and fell back to the default location. The
  managed block now names that variable and `XDG_DATA_HOME` in `env_vars`; both are variable
  names, so the block stays portable.

## Acceptance criteria

| AC | Evidence | Status |
| --- | --- | --- |
| AC-01 reproducible marketplace install for both hosts | `CodexHost.test_the_repository_marketplace_installs_the_codex_package`, `ClaudeHost.test_the_repository_marketplace_installs_the_claude_package` — real `codex plugin marketplace add`/`plugin add` and `claude plugin marketplace add`/`install` against this repository, no author checkout assumed. `GeneratedPackages.*` proves deterministic generation and the source-equivalence gate | **met** |
| AC-02 one instruction enables a project, then plain `codex` has tools and instructions with no MCP flags | `prepare` writes the whole configuration and the thin skill drives it; `CodexHost.test_an_inherited_external_worktree_starts_the_dispatcher_on_the_right_root` shows a plain `codex` session starting the bridge from the committed block with no flags | **met for the mechanism; the "one instruction" step itself is a model action and was not exercised by a model** |
| AC-03 a new external worktree works with no manual init, with its own state | same test: the worktree is created by `git worktree add`, has no `.bridge-runtime/`, and an ordinary session hands over to the pinned runtime with `--workspace <that worktree>` | **met, with the host trust decision for the new path stated explicitly** |
| AC-04 Astra delegates with the right instructions and no executor setup in the project | `ClaudeHost.test_a_delegated_executor_loads_the_package_with_no_install` (empty profile, no project `.claude/`, ≥6 workflow skills loaded, zero tokens) plus the runner change that passes `--plugin-dir <runtime>/plugins/bridge-claude`. The further-delegation lock is untouched | **met at the mechanism level; no real delegation ran** |
| AC-05 a plugin update does not change a running feature's version | The pin lives in the committed declaration and the runtime lives outside any plugin cache; `pin and plugin cache independence` deletes an entire plugin cache and shows the instruction set intact, and `pin-diverged` is reported rather than switched | **met for the pin and the instruction set; "a running feature survives" was not exercised with a live round** |
| AC-06 handshake/read/foreign refusal mutate nothing; concurrent preparation is safe | `status is a pure read` compares full directory listings; `facade` refuses an unconfirmed call and a mismatched workspace; `concurrent first use` races two real processes, holds a lock, and breaks a stale one; symlink and copied-record refusals leave the tree untouched | **met** |
| AC-07 migration preserves data and custom settings, no double MCP, CLI fallback | `migration protection` keeps the user's `config.toml` neighbours, `.gitignore` entries and their own `.agents/skills/` file while replacing only the managed block; the plugin declares no MCP server, so a second server cannot appear; wave12 `init`/`update`/`rollback` are unchanged and still pass their suite | **met** |
| AC-08 doctor recognises installation and versions | `bridge.mjs doctor --json` now emits `distribution` with `integration_source`, runtime, instruction and package identities and a tri-state `pin.diverged`; verified against this worktree | **doctor part met. `diagnose` belongs to wave13, which is absent: no diagnose integration is claimed** |
| AC-09 documentation covers install, new project/worktree, update, migration, rollback, removal | `docs/plugin-distribution.md`, plus the wave14 sections added to `docs/setup.md` and `docs/setup-layout.md` | **met** |

## What is not evidenced

- **No model ran.** No real Astra→Claude round, no pilot. Every "met" above is a mechanism
  measured on a host, not an end-to-end product demonstration.
- **The interactive TUI was not exercised.** All Codex evidence is `codex exec`. Whether the TUI
  behaves identically for a project-scoped server, a trust prompt or a restart is untested.
- **One host, one OS, one version of each client.**
- **Wave13 is absent.** The metadata block is the bridge's own doctor output. No diagnose
  interface was consumed, extended or merged.
- **A `runtime-missing` facade session was not driven by a client end to end.** The facade's
  handler is covered by unit tests and its routing by the dispatcher `plan`, but no Codex session
  was observed calling `bridge_prepare_worktree` through it.
- **Initial project enablement costs a host restart and a host trust decision.** That is stated in
  the skill and the documentation rather than engineered away.
