# Setup, updates and doctor

Install a pinned bridge runtime once, set up each worktree with one command, then start plain
`codex` in that worktree. Updates, rollbacks and diagnostics work per worktree. Where files go
is described in [setup-layout.md](setup-layout.md).

This page is the CLI procedure, which stays supported and is the fallback for environments
without plugins. The shorter route — install the plugin once, then ask Codex to enable a project, after which every
worktree of that project needs only its own local selection and no runtime install — is
[plugin-distribution.md](plugin-distribution.md).

## Requirements

- Linux and a worktree on a local filesystem (no network or FUSE mounts for bridge state);
- Node.js 22.13 or newer (tested with 24), npm, Git and Python 3.11 or newer;
- Codex CLI **0.154.0** for the manager: the manager identity adapter is verified for exactly
  this version and other versions are refused;
- Claude Code for the worker; both clients logged in normally.

## 1. Install a pinned runtime

```sh
git clone https://github.com/McAvity/bidirectional-bridge-claude-codex.git bridge
cd bridge
git checkout <commit>
node scripts/bridge.mjs install
```

`install` archives that commit, runs `npm ci --ignore-scripts` and `npm run build` in a new
directory `~/.local/share/claude-codex-bridge/runtimes/<version>-<commit>` and makes it
read-only. Nothing is built inside the clone. Installing another commit adds a directory next
to the existing ones; an installed runtime is never rebuilt or overwritten, and installing the
same commit again changes nothing. `--ref <commit>` installs another commit of the clone and
`--home <dir>` (or `CLAUDE_CODEX_BRIDGE_HOME`) selects another location.
`node scripts/bridge.mjs runtimes` lists what is installed.

Every command below can be run from the clone or from an installed runtime,
`node ~/.local/share/claude-codex-bridge/runtimes/<id>/scripts/bridge.mjs`.

## 2. Set up a worktree

```sh
node scripts/bridge.mjs init --workspace <worktree> --runtime <id>
node scripts/bridge.mjs init --workspace <worktree> --runtime <id> --yes
```

Without `--yes` the command prints the planned changes with diffs and writes nothing.
`init` adds, in the worktree:

- the workflow skills in `.agents/skills/`, the role skills `.codex/skills/using-bridge/` and
  `.claude/skills/using-bridge/`, and `docs/features/README.md`;
- a managed `[mcp_servers.bridge]` block appended to `.codex/config.toml`;
- a managed block in `.gitignore` for `.bridge/` and `.bridge-runtime/`;
- `.bridge-runtime/current`, a link to the selected runtime, and its record `install.json`.

Existing settings, other MCP servers, `AGENTS.md`, `CLAUDE.md` and your own skills stay as they
are. The Codex block contains no user paths, so the skills, the block and the `.gitignore` block
may be committed. `.bridge/` and `.bridge-runtime/` are local and never committed. The personal
Codex and Claude profiles, model, sandbox, approvals, login and billing are not touched.

Running `init` again changes nothing. A file that differs from every shipped copy is reported
as a conflict and nothing is written; `--keep-local` keeps such instruction files unchanged
and applies the rest. An existing `mcp_servers.bridge` definition outside the managed block is
always a conflict. If an apply is interrupted, run the same command again: it completes the
change from what is on disk.

## 3. Start the manager

```sh
cd <worktree>
codex
```

Codex starts the bridge from the managed block; no wrapper or command-line flags are needed.
Start it in the worktree root. Codex loads project configuration only for trusted projects:
approve the trust prompt once for the repository (its worktrees inherit that trust). Check
with `codex mcp list` in the worktree, or with `doctor`. The block marks the server as
`required`, so Codex refuses to open a session there while the bridge cannot start; for work
without the bridge, `codex -c mcp_servers.bridge.enabled=false` opens a session anyway.

## 4. A new Herdr or Git worktree

Create the worktree as usual (Herdr places it outside the checkout), then run `init` once for
it. A new worktree has its own runtime selection, database, exchange namespace and logs; it
never reuses another worktree's. Never copy `.bridge/` or `.bridge-runtime/` between
worktrees: a copied state or setup record is refused, not adopted.

A project prepared the wave14 way needs no `init` here and no runtime install: it commits a
portable declaration and an entry point that resolve the worktree and the pinned runtime when the
client starts. Its local state still starts empty and is still never inherited, so one `setup`
from the bridge skill writes that worktree's own `.bridge-runtime/current` and nothing else. Two steps remain the host's own and are
not bypassed: Codex reads a project `.codex/config.toml` only for a project you have trusted, and
it loads no project configuration at all when started in a subdirectory — start it at the
worktree root. Enabling a project for the *first* time also costs one client restart, because a
client reads its MCP server list at startup.

## 5. Update

```sh
node scripts/bridge.mjs install --ref <new commit>
node scripts/bridge.mjs update --workspace <worktree> --runtime <new id>
node scripts/bridge.mjs update --workspace <worktree> --runtime <new id> --yes
```

`update` switches only the named worktree: its link, managed instructions and Codex block.
Other worktrees keep their runtime until they are updated themselves. The command refuses while
the worktree is in use — a running bridge server, a Codex or Claude process in the worktree,
or a process holding a `.bridge/` file open — and names the processes to close normally;
nothing is killed. It also refuses when the database schema is newer than the target runtime
supports or when the installed Codex version is not verified by the target runtime. The new
runtime migrates the database on its first authorized call, not during `update`.

## 6. Roll back

```sh
node scripts/bridge.mjs rollback --workspace <worktree> --yes
```

`rollback` selects the previous runtime from the worktree's record (or `--to <id>`) and restores
its instructions. It never restores an old copy of the database and never removes events. When
the newer runtime has already migrated the database to a schema the older runtime does not
support, rollback is refused with `STATE_SCHEMA_NEWER`.

## 7. Doctor

```sh
node scripts/bridge.mjs doctor --workspace <worktree>
node scripts/bridge.mjs doctor --workspace <worktree> --json
```

`doctor` starts no model, claims no manager, migrates nothing and runs no recovery. It checks
the tools and their versions, the selected runtime's files, instructions, the Codex block and
what Codex itself loads (`codex mcp get bridge`), Git ignores, the worktree state, filesystem,
write access, active use, and a real MCP handshake that only calls `bridge_server_info` and
`bridge_manager_status`. Its only write is a temporary lock probe inside `.bridge-runtime/`,
removed immediately. Pass `--codex-profile <name>` when Codex trust is kept in a profile file,
and `--no-handshake` to skip the server start. Exit status 0 means `ok`; unchecked items make the
result `incomplete`, never `ok`.

### Doctor codes

| Code | Meaning |
| --- | --- |
| `HOST_UNSUPPORTED_PLATFORM` | Not Linux. |
| `GIT_MISSING`, `NODE_MISSING`, `NODE_UNSUPPORTED` | A required tool is missing or too old. |
| `PYTHON_MISSING`, `PYTHON_UNSUPPORTED` | No Python 3.11+ (feature exchange and TOML checks need it). |
| `CODEX_MISSING`, `CLAUDE_MISSING` | A client is not on `PATH`. |
| `CODEX_VERSION_UNSUPPORTED` | The Codex version has no verified identity adapter in the selected runtime. |
| `CODEX_VERSION_UNKNOWN`, `CODEX_ADAPTERS_UNKNOWN` | Not enough evidence about the host version. |
| `CODEX_LOGIN_MISSING`, `CLAUDE_LOGIN_MISSING`, `CLAUDE_LOGIN_UNKNOWN` | Log in normally; billing is not examined. |
| `WORKSPACE_MISSING`, `WORKSPACE_NOT_ROOT`, `WORKSPACE_UNRESOLVED` | Pass an existing worktree root. |
| `WORKSPACE_UNVERIFIED` | No installed runtime was available to resolve the worktree. |
| `SETUP_NOT_INITIALIZED` | Run `init`. |
| `SETUP_INTERRUPTED` | Re-run the interrupted command with `--yes`. |
| `SETUP_RECORD_FOREIGN`, `SETUP_RECORD_INVALID`, `SETUP_RECORD_MISMATCH`, `LOCAL_SETUP_CONFLICT` | The local setup record is copied, unreadable or inconsistent. |
| `PATH_REDIRECTED` | A managed path is a symlink; setup never writes through it. |
| `RUNTIME_SELECTION_BROKEN`, `RUNTIME_INCOMPLETE`, `RUNTIME_NOT_SELECTED` | The selected runtime is missing or its files do not match its manifest. |
| `INSTRUCTIONS_MISSING`, `INSTRUCTIONS_OUTDATED`, `INSTRUCTIONS_MODIFIED` | Instruction files are absent, from another version, or changed locally. |
| `CODEX_CONFIG_MISSING`, `CODEX_CONFIG_CONFLICT`, `CODEX_CONFIG_MODIFIED`, `CODEX_CONFIG_INVALID`, `CODEX_CONFIG_MISMATCH` | The managed block is absent, contradicted, edited, unparsable, or overridden. |
| `CODEX_PROJECT_UNTRUSTED` | Codex ignores the project configuration because the project is not trusted. |
| `CODEX_CONFIG_NOT_LOADED`, `CODEX_BRIDGE_DISABLED`, `CODEX_TIMEOUT_TOO_LOW`, `CODEX_OUTPUT_UNRECOGNIZED` | Codex does not load the bridge server as defined. |
| `GIT_IGNORE_MISSING` | `.bridge/` or `.bridge-runtime/` could be committed. |
| `STATE_OWNED_ELSEWHERE` | The state belongs to another worktree (copied `.bridge/`, second database). |
| `STATE_LEGACY_UNBOUND`, `STATE_UNRESOLVED`, `STATE_UNREADABLE`, `STATE_SCHEMA_NEWER`, `STATE_RECOVERY_NEEDED` | The state cannot be used as is; see [manager-identity](manager-identity.md). |
| `FILESYSTEM_UNSUPPORTED`, `FILESYSTEM_UNKNOWN`, `STATE_LOCKING_UNSUPPORTED` | The filesystem is not a known local one or its locking does not work. |
| `ACCESS_DENIED`, `SANDBOX_RESTRICTED` | A directory is not writable; `SANDBOX_RESTRICTED` when a Codex sandbox is the likely cause. |
| `ACTIVE_SESSION`, `ACTIVE_USE_UNKNOWN` | The worktree is in use, or that cannot be determined (no `/proc`, sandbox). |
| `HANDSHAKE_FAILED`, `HANDSHAKE_IDENTITY_MISMATCH`, `HANDSHAKE_TOOLS_MISSING`, `HANDSHAKE_NOT_POSSIBLE`, `HANDSHAKE_SKIPPED` | The MCP server did not start as configured, or was not tried. |

`init`, `update` and `rollback` refuse with `PATH_REDIRECTED`, `ACTIVE_SESSION`, `ACTIVE_USE_UNKNOWN`,
`STATE_SCHEMA_NEWER`, `STATE_UNREADABLE`, `RUNTIME_COMPATIBILITY_UNKNOWN`, `RUNTIME_INCOMPLETE`,
`CODEX_VERSION_UNSUPPORTED`, `SETUP_ALREADY_INITIALIZED`, `SETUP_NOT_INITIALIZED`,
`ROLLBACK_SAME_RUNTIME` or `ROLLBACK_NO_PREVIOUS`, and report file conflicts as
`INSTRUCTION_MODIFIED`, `CODEX_CONFIG_*` or `GITIGNORE_CONFLICT`. `install` reports
`INSTALL_SOURCE_INVALID` or `INSTALL_STEP_FAILED` with the path of its log.

## Limits

- Linux only, local filesystems only, one active manager and feature per worktree.
- Setup never writes through a symlink. When a managed directory or file — for example
  `.agents` shared with other projects, or anything below `.bridge-runtime/` except its
  `current` link — is a symlink, `init`, `update` and `rollback` refuse before writing,
  even if the link points inside the worktree. Replace it with a real directory, or keep those
  files unmanaged.
- Active use is read from `/proc` for the current user. Processes of other users are not
  inspected, and inside a Codex sandbox the answer is unknown, so `update` refuses there.
- Codex resolves the relative launcher path from its own working directory: start it in the
  worktree root. A `-c projects.<path>.trust_level` override does not make Codex load project
  configuration; trust must be approved in Codex.
- `.mcp.json` for a Claude Code manager is not managed by `init`.
- Removing a runtime is manual: check that no worktree links to it, then
  `chmod -R u+w <runtime> && rm -rf <runtime>`.

## Developing the bridge

This repository uses the same layout: its `.codex/config.toml` is the managed block and its
`.mcp.json` points to `.bridge-runtime/current`. Run `init` in each bridge worktree with a runtime
installed from an accepted commit, so an active manager never runs the build of the worktree it
is changing. Build and test changes in the worktree itself as before.
