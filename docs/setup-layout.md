# Setup layout

Shared contract of the setup commands (wave12) and later logging and incident export (wave13).
It fixes where installed runtimes, per-worktree selection, state and diagnostics live, and which
files may be committed. It does not change the [isolation protocol](manager-identity.md).
The user procedure is in [setup.md](setup.md).

## Installed runtimes

`<home>` is `$CLAUDE_CODEX_BRIDGE_HOME`, or `${XDG_DATA_HOME:-~/.local/share}/claude-codex-bridge`.

| Path | Contents |
| --- | --- |
| `<home>/runtimes/<id>/` | One immutable runtime: `git archive` of one commit, `npm ci --ignore-scripts`, `npm run build`, then made read-only. `<id>` is `<package version>-<first 12 hex of the commit>`. |
| `<home>/runtimes/<id>/runtime-manifest.json` | Manifest, format `claude-codex-bridge.runtime/v1`. |
| `<home>/runtimes/<id>/install.log` | Output of the install commands. |
| `<home>/runtimes/.staging-<id>-<nonce>/` | An install in progress or an interrupted one; never selected. |

A new version is installed beside the old ones and never overwrites a runtime. Worktrees may
share a runtime directory because it is read-only; they never share anything else.

Manifest fields:

- `runtime_id`, `package_version`, `install_format` (`git-archive+npm-ci+build`), `created_at`;
- `source.commit` (full hash) and `source.repository` (the local clone it was archived from);
- `built_with.node`, `built_with.npm`, `lockfile_sha256`;
- `compatibility.state_schema_version` — the newest SQLite schema this runtime reads and writes;
  `compatibility.codex_identity_adapters` — verified Codex host versions;
  `compatibility.node_minimum`; a field is `null` when that runtime did not export it;
- `instructions.set_sha256` and `instructions.files[]` (`path`, `sha256`) — the instruction set;
- `mcp.launcher`, `mcp.startup_timeout_sec`, `mcp.tool_timeout_sec`;
- `tree_sha256` — every installed file except `node_modules/`, the manifest and `install.log`.

## Per worktree

Two shapes exist. **Wave12** selects the runtime with a per-worktree `.bridge-runtime/current`
symlink, which a new worktree does not inherit. **Wave14** commits a portable declaration and a
dispatcher instead, so a worktree created from an enabled project resolves its runtime by itself;
see [plugin-distribution.md](plugin-distribution.md). Both are supported; wave12 remains the
fallback for environments without plugins.

| Path | In Git | Written by | Contents |
| --- | --- | --- | --- |
| `.bridge-project/bridge.json` | committed | prepare (wave14) | Portable project declaration, format `claude-codex-bridge.project/v1`: `enabled` and the authoritative `pinned.runtime_id` |
| `.bridge-project/{dispatch,locate,bootstrap,facade}.mjs` | committed | prepare (wave14) | The portable dispatcher: resolves the real worktree and the pin at startup and hands over to the pinned installed runtime, or serves the static setup facade |
| `.codex/config.toml`, managed `[mcp_servers.bridge]` block | may be committed | init, update, prepare | Portable MCP definition. Wave12 writes the relative launcher path under `.bridge-runtime/current`; wave14 writes `./.bridge-project/dispatch.mjs` with `required = false` and `env_vars = ["CLAUDE_CODEX_BRIDGE_HOME", "XDG_DATA_HOME"]`. Neither contains a user path |
| `.agents/skills/feature-*`, `.codex/skills/using-bridge/`, `.claude/skills/using-bridge/`, `docs/features/README.md` | may be committed | init, update, rollback | Instruction set of the selected runtime |
| `.gitignore`, managed block | may be committed | init | Ignores `.bridge/` and `.bridge-runtime/` |
| `.bridge-runtime/current` | never | init, update, rollback | Symlink to `<home>/runtimes/<id>` — the runtime selection |
| `.bridge-runtime/install.json` | never | init, update, rollback | Selection record, format `claude-codex-bridge.workspace-install/v1` |
| `.bridge-runtime/pending.json`, `.bridge-runtime/backup/` | never | init, update, rollback | Journal and backups of an apply in progress; present only after an interruption |
| `.bridge/` | never | bridge runtime | Database, markers, lock and termination `evidence/` ([manager-identity](manager-identity.md), [recovery](recovery.md)) |
| `.bridge/logs/` | never | reserved for wave13 | Local runtime logs; already an explained entry of the state directory |
| `.bridge/bootstrap.lock` | never | prepare (wave14) | Exclusive claim of one worktree's bootstrap; removed when it finishes, broken and reported when older than ten minutes |

`install.json` records the worktree `root` and `git_dir`, the selected runtime and its commit,
the hash of every managed file as last written, and a history of `init`/`update`/`rollback`
selections. A record naming another worktree is a copy and is refused, never adopted.
The selection of one worktree is never read by another: a new Herdr or Git worktree starts
without `.bridge-runtime/` and `.bridge/` and needs its own `init`.

Codex resolves the relative launcher path from its own process directory, so `codex` is started
in the worktree root, which the launcher requires anyway. Two host properties measured in W14-02
make that mandatory rather than conventional: Codex reads a project `.codex/config.toml` only for
a project trusted in `CODEX_HOME/config.toml`, and it loads no project configuration at all when
started in a subdirectory. It also starts an MCP server with a stripped environment, which is why
the wave14 block names the two variables that can move the installation.

Instructions are never written into a target repository by the wave14 path. The instruction set of
the selected runtime stays in `<home>/runtimes/<id>/`, and the delegated executor is given
`<home>/runtimes/<id>/plugins/bridge-claude` through `--plugin-dir`.

## Outside the worktree

| Path | Contents |
| --- | --- |
| `~/tmp/bridge-exchange/ws_<16 hex>/{packages,incoming,staging}/` | Exchange namespace of the worktree (`feature_exchange.py namespace`) |

## Distribution metadata

`doctor --json` also carries `distribution`, format `claude-codex-bridge.distribution/v1`:
`integration_source` (`project-dispatcher`, `project-config` or `unknown`), the package, runtime
and instruction identities, the configured and separately the *observed* executor identity, and a
tri-state `pin.diverged`. Every path appears as a location class plus a digest, never as a path.
This is doctor metadata only: wave13 keeps ownership of logging, retention and diagnose, and no
integration with it is implied. See
[the contract](features/F-W14-plugin-distribution/contracts/02-wave13-metadata.md).

## Doctor output

`doctor --json` prints one object, format `claude-codex-bridge.doctor/v1`: `status`
(`ok`, `problems` or `incomplete`), `workspace`, `checks[]` and the first `next_step`. Each check
has `id`, `status` (`ok`, `warn`, `error`, `unknown`, `skipped`), `code`, `summary`, optional
`details` and `next_step`. `ok` checks use code `OK`; other codes are stable identifiers listed
in [setup.md](setup.md#doctor-codes). Unknown or skipped required checks make the result
`incomplete`, never `ok`.

## Guidance for wave13

- Write local logs under `.bridge/logs/` of the worktree; rotation and retention stay there.
- An incident export belongs in the worktree exchange namespace (`packages/`), not in Git.
- Identify versions from `runtime-manifest.json` and the selection from `install.json`; attach
  `doctor --json` output instead of re-collecting host checks.
- Do not add another state source: events and attempts stay in the worktree database.
