# W14-01 — host feasibility evidence

Model-free probes run on this machine on 2026-09-16 against the installed hosts.
Raw results: [`results/`](results/). Probe sources and their isolation and
zero-cost guarantees: [`scripts/plugin-probes/`](../../../../../scripts/plugin-probes/README.md).

Reproduce:

```sh
python3 scripts/plugin-probes/run_probes.py \
  --out-dir docs/features/F-W14-plugin-distribution/evidence/W14-01/results
```

| Host | Version observed |
| --- | --- |
| Codex | `codex-cli 0.154.0` |
| Claude Code | `2.1.273` |

Both versions match the compatibility statement in
[wave14](../../../../plans/wave14.md); no host was upgraded, downgraded or
reconfigured for these probes. Every probe used a disposable `CODEX_HOME` /
`CLAUDE_CONFIG_DIR` under `~/tmp/w14-01-probes/`; the personal profiles were not
read for configuration and not written.

**Host evidence vs fixture checks.** Everything on this page comes from running
the installed CLIs and recording what their subprocesses received. The unit
tests in [`tests/plugin-probes/`](../../../../../tests/plugin-probes/) are
*fixture checks only*: they verify the probe generators, the isolation guard and
the zero-cost assertions. They prove nothing about host behaviour.

**Documentation.** The Claude Code
[plugin reference](https://code.claude.com/docs/en/plugins-reference) and
[marketplace guide](https://code.claude.com/docs/en/plugin-marketplaces) were
read on 2026-09-16 and agree with the observed behaviour. The Codex plugin
documentation at `https://learn.chatgpt.com/docs/plugins` **could not be
fetched** in this round (the fetch tool was not authorised), so every Codex
statement below rests on the installed CLI and on the local
`~/.codex/skills/.system/plugin-creator` manifest constraints, not on the vendor
page. That page should be re-read before W14-02 commits to a manifest shape.

---

## Q1 — Does a Codex plugin MCP server get the project/worktree directory?

**No. There is no supported channel in Codex 0.154.0.** Probe
[`codex-plugin-mcp-cwd.json`](results/codex-plugin-mcp-cwd.json), 8 cases, all
model-free (`every_session_was_model_free: true`).

| Observation | Result |
| --- | --- |
| Server `cwd` | Always the version-pinned plugin cache directory `<CODEX_HOME>/plugins/cache/<marketplace>/<plugin>/<version>`, never the project. `cwd: "."` in `.mcp.json` and relative `args` both resolve there; `codex mcp list --json` shows Codex rewriting them to absolute cache paths. |
| Inherited environment | Stripped to `HOME, LANG, LC_ALL, LOGNAME, PATH, SHELL, TERM, USER`. No `PWD`, no `CODEX_*`, nothing naming the project. |
| `env_vars: ["PWD"]` | Forwards the **parent process's** `PWD` verbatim. It equals the worktree only when the immediate parent was a shell sitting in it. |
| `codex -C <dir>` | Does **not** change the forwarded `PWD`: the server sees the shell's directory, not Codex's working root. |
| Parent without `PWD` | `PWD` is simply absent (a launcher that spawns Codex directly, e.g. from a GUI or an orchestrator). |
| Stale parent `PWD` | Forwarded unchanged, resolving to a **different repository** — the failure mode that would silently bind the bridge to the wrong worktree. |
| MCP `initialize` | `clientInfo: codex-mcp-client/0.154.0`; capabilities are `experimental.codex/auth-change` and `elicitation` only. **No `roots` capability**, no project path anywhere in the handshake. |

Positive sub-result worth keeping: when `PWD` *is* the worktree, resolving the
root with `git rev-parse --show-toplevel` works for paths containing spaces, for
a launch from a subdirectory, and for an **external Herdr-style git worktree**
whose gitdir lives in another checkout. The resolution step is fine; the input is
what Codex does not provide.

Consequence: a Codex plugin cannot ship a project-bound bridge MCP server. Either
the workspace arrives as an explicit, validated tool argument, or the
project-scoped `[mcp_servers.bridge]` block of wave12 stays. See
[`contracts/01-package-and-bootstrap.md`](../../contracts/01-package-and-bootstrap.md).

## Q2 — Can a delegated Claude get its instructions with no project install?

**Yes, via `--plugin-dir`, which the bridge already controls.** Probe
[`claude-delegated-instructions.json`](results/claude-delegated-instructions.json),
5 cases, every one reporting `total_cost_usd == 0`, zero input and output tokens
and `api_error_status == 400` from the CLI's own result frame.

- Control (`no-plugin-dir`, empty `CLAUDE_CONFIG_DIR`, no project `.claude/`):
  `Loaded 0 skills`, no plugin MCP server. The positive cases are therefore not
  picking up an ambient install.
- `--plugin-dir <dir>`: `Loaded inline plugin from path: w14-probe`,
  `Loaded 1 skills from plugin w14-probe`, and
  `MCP server "plugin:w14-probe:probe"` started. No install of any kind.
- The plugin MCP subprocess runs with `cwd` = the project directory and inherits
  the full environment including `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT` and
  `CLAUDE_PLUGIN_DATA` — the exact opposite of the Codex result above.
- Works when launched from a subdirectory, works when `--plugin-dir` points at a
  `.zip`, and coexists with `--disallowed-tools` (so the existing further-delegation
  lock is unaffected).

Caveat: `CLAUDE_PROJECT_DIR` is the launch directory, so from `<root>/sub dir` it
is the subdirectory, not the git root. The executor's workspace must keep coming
from the bridge, which already passes `cwd: invocation.workspace_root`.

## Q3 — Does a cache refresh preserve a running feature's pinned set?

**Codex: no — the update deletes the previous version's directory.**
Probe [`plugin-cache-update-restart.json`](results/plugin-cache-update-restart.json).

- The Codex cache is version-keyed
  (`<CODEX_HOME>/plugins/cache/<marketplace>/<plugin>/<version>`).
- After the documented update flow (publish a new version, `codex plugin add`
  again), `cache_versions_present` is `["1.1.0"]`: the `1.0.0` directory and the
  `SKILL.md` a session had been reading are **gone**. Any absolute path recorded
  inside the cache stops resolving.
- A restart moves runtime and instructions **together** — after the update both
  the MCP server cwd and the skill path `codex debug prompt-input` reports are
  under `1.1.0`. So new instructions are not mixed with an old runtime; the
  version simply switches under the project without asking.
- `codex plugin remove` deletes the whole plugin cache tree.
- A wave12-style immutable runtime kept **outside** the plugin cache is
  byte-identical after both the update and the removal.

**Claude Code: yes — both versions are retained.** After
`claude plugin update`, the cache holds `1.0.0` *and* `1.1.0`, and the CLI says
`Restart to apply changes`. The two hosts differ here, so the design cannot rely
on cache retention.

Consequence: the plugin cache must not be the home of the pinned runtime or the
pinned instruction set. Wave12's `<home>/runtimes/<id>/` already satisfies this
and is confirmed untouched by plugin operations.

## Supplementary — does a missing launcher block Codex startup?

Probe [`missing-runtime-startup.json`](results/missing-runtime-startup.json).
A worktree that inherits the committed `[mcp_servers.bridge]` block without the
gitignored `.bridge-runtime/current` symlink still reaches the model request
under `codex exec`, with `required = true` and with `required = false`. So a
setup skill can run in a freshly created worktree.

**Scope limit:** only `codex exec` was exercised. The interactive TUI is a
different front end; its behaviour on a failing `required` server is unverified
and must be confirmed (a PTY smoke, as in wave12 AC-08) before any design relies
on it.

## What is not evidenced here

- No real delegation, no model ran, and no claim about end-to-end Astra → Claude
  behaviour is made. These probes cover host mechanics only.
- One host, one OS, one Codex and one Claude Code version. Nothing here supports
  a compatibility claim for other versions.
- The Codex vendor plugin documentation was not readable in this round.
- Interactive TUI behaviour (startup dialogs, `/mcp`, trust prompts) is untested.
- Nothing about wave13 logging was executed; the metadata interface in
  [`contracts/02-wave13-metadata.md`](../../contracts/02-wave13-metadata.md) is a
  proposal against a baseline that does not yet contain wave13.
