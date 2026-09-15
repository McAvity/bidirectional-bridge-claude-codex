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

| Path | In Git | Written by | Contents |
| --- | --- | --- | --- |
| `.codex/config.toml`, managed `[mcp_servers.bridge]` block | may be committed | init, update | Portable MCP definition: relative launcher path, no user paths |
| `.agents/skills/feature-*`, `.codex/skills/using-bridge/`, `.claude/skills/using-bridge/`, `docs/features/README.md` | may be committed | init, update, rollback | Instruction set of the selected runtime |
| `.gitignore`, managed block | may be committed | init | Ignores `.bridge/` and `.bridge-runtime/` |
| `.bridge-runtime/current` | never | init, update, rollback | Symlink to `<home>/runtimes/<id>` — the runtime selection |
| `.bridge-runtime/install.json` | never | init, update, rollback | Selection record, format `claude-codex-bridge.workspace-install/v1` |
| `.bridge-runtime/pending.json`, `.bridge-runtime/backup/` | never | init, update, rollback | Journal and backups of an apply in progress; present only after an interruption |
| `.bridge/` | never | bridge runtime | Database, markers, lock and termination `evidence/` ([manager-identity](manager-identity.md), [recovery](recovery.md)) |
| `.bridge/logs/` | never | reserved for wave13 | Local runtime logs; already an explained entry of the state directory |

`install.json` records the worktree `root` and `git_dir`, the selected runtime and its commit,
the hash of every managed file as last written, and a history of `init`/`update`/`rollback`
selections. A record naming another worktree is a copy and is refused, never adopted.
The selection of one worktree is never read by another: a new Herdr or Git worktree starts
without `.bridge-runtime/` and `.bridge/` and needs its own `init`.

Codex resolves the relative launcher path from its own process directory, so `codex` is started
in the worktree root, which the launcher requires anyway.

## Outside the worktree

| Path | Contents |
| --- | --- |
| `~/tmp/bridge-exchange/ws_<16 hex>/{packages,incoming,staging}/` | Exchange namespace of the worktree (`feature_exchange.py namespace`) |

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
