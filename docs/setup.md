# Setup, updates and doctor

Install a pinned bridge runtime once, set up each worktree with one command, then start plain
`codex` in that worktree. Updates, rollbacks and diagnostics work per worktree. Where files go
is described in [setup-layout.md](setup-layout.md).

This page is the CLI procedure, which stays supported and is the fallback for environments
without plugins. The shorter route — install the plugin once, then ask Codex to enable a project, after which every
worktree of that project needs only its own local selection and no runtime install — is
[plugin-distribution.md](plugin-distribution.md).

## Requirements

- Linux or macOS and a worktree on a local filesystem (no network or FUSE mounts for bridge state);
- Node.js 22.13 or newer (tested with 24), npm, Git and Python 3.11 or newer;
- Codex CLI for the manager: **0.154.0** has the previously verified identity adapter.
  **0.155.1** and other unverified versions may use the same metadata contract with a
  `CODEX_VERSION_UNVERIFIED` warning; a version mismatch alone does not block setup or calls;
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

`--with-preference` is **refused here**, by name. This CLI prepares the per-worktree (wave12)
shape, and the preference block points at `.bridge-project/entry.mjs`, which only the dispatcher
profile installs; writing it from `init` would leave an instruction naming a file this worktree
will never have. The refusal is `PREFERENCE_REQUIRES_DISPATCHER` and nothing is written. The same
precondition has a second half that applies to the dispatcher profile too: a target runtime that
does not serve `.bridge-project/entry.mjs --status` is refused with
`PREFERENCE_UNSUPPORTED_RUNTIME`, again before any write and without moving the pin. Record the
preference where the entry point actually exists — see
[plugin-distribution.md](plugin-distribution.md). `init`, `update` and `rollback` never read or
write `AGENTS.md` in any case, so no update can introduce a policy.

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
client starts. Its local state still starts empty and is still never inherited: the worktree
serves reads as it is, and its own selection and record are written by its first authorised
mutation, through the same plan `init` uses. Two steps remain the host's own and are
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
supports; an unverified Codex version produces a warning, not a refusal. The new
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
removed immediately. Pass `--no-handshake` to skip the server start. Exit status 0 means `ok`;
unchecked items make the result `incomplete`, never `ok`.

#### Codex context

Doctor runs `codex` itself, so a shell function or alias that adds `--profile` to your
interactive `codex` does not apply to it. The Codex CLI context it queries is chosen explicitly:

1. `--codex-profile <name>`;
2. otherwise the environment variable `CLAUDE_CODEX_BRIDGE_CODEX_PROFILE`;
3. otherwise the default configuration, with no profile.

The report states the context and its source (`codex context:` line; `codex_context` in
`--json`). Its `codex_project` result describes that CLI context only, not necessarily the
session you are running. Trust is read from `config.toml` with the selected profile's
`<name>.config.toml` layered over it, so the profile's own entry for a path wins; the worktree's
entry wins over its main repository's. Profiles that are not selected are never read, and no
trust entry is written. A profile known only as a legacy `[profiles.<name>]` table needs no
separate file where the Codex version still accepts it (newer versions refuse it). An empty or
malformed name, or a profile Codex refuses or cannot find, is reported as an error; doctor never
falls back to the default configuration instead.

A launcher that already chooses a profile can hand the same choice to doctor explicitly. Exported
from the launcher, the variable reaches doctor runs started inside that Codex session (for example
by an upgrade skill). Illustrative shell function; adapt your own launcher:

```sh
codex() {
  local profile="work"
  CLAUDE_CODEX_BRIDGE_CODEX_PROFILE="$profile" command codex --profile "$profile" "$@"
}
# or, for a doctor run from the same shell:
export CLAUDE_CODEX_BRIDGE_CODEX_PROFILE=work
```

### Doctor codes

| Code | Meaning |
| --- | --- |
| `HOST_UNSUPPORTED_PLATFORM` | Neither Linux nor macOS. |
| `GIT_MISSING`, `NODE_MISSING`, `NODE_UNSUPPORTED` | A required tool is missing or too old. |
| `PYTHON_MISSING`, `PYTHON_UNSUPPORTED` | No Python 3.11+ (feature exchange and TOML checks need it). |
| `CODEX_MISSING`, `CLAUDE_MISSING` | A client is not on `PATH`. |
| `CODEX_VERSION_UNVERIFIED` | Warning: this Codex version is outside the verified list; setup continues and runtime identity checks still apply. Older runtimes retain their old refusal until explicitly updated. |
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
| `CODEX_PROJECT_UNTRUSTED` | In the queried Codex CLI context, the project is not trusted, so that context ignores its configuration. A session started with another profile may differ; select it with `--codex-profile` or `CLAUDE_CODEX_BRIDGE_CODEX_PROFILE`. |
| `CODEX_PROFILE_INVALID`, `CODEX_PROFILE_NOT_FOUND` | The selected Codex profile name is empty or malformed, Codex refuses it or its file does not parse, or no such profile exists. |
| `CODEX_CONFIG_NOT_LOADED`, `CODEX_BRIDGE_DISABLED`, `CODEX_TIMEOUT_TOO_LOW`, `CODEX_OUTPUT_UNRECOGNIZED` | Codex does not load the bridge server as defined. |
| `GIT_IGNORE_MISSING` | `.bridge/` or `.bridge-runtime/` could be committed. |
| `STATE_OWNED_ELSEWHERE` | The state belongs to another worktree (copied `.bridge/`, second database). |
| `STATE_LEGACY_UNBOUND`, `STATE_UNRESOLVED`, `STATE_UNREADABLE`, `STATE_SCHEMA_NEWER`, `STATE_RECOVERY_NEEDED` | The state cannot be used as is; see [manager-identity](manager-identity.md). |
| `FILESYSTEM_UNSUPPORTED`, `FILESYSTEM_UNKNOWN`, `STATE_LOCKING_UNSUPPORTED` | The filesystem is not a known local one or its locking does not work. |
| `ACCESS_DENIED`, `SANDBOX_RESTRICTED` | A directory is not writable; `SANDBOX_RESTRICTED` when a Codex sandbox is the likely cause. |
| `ACTIVE_SESSION`, `ACTIVE_USE_UNKNOWN` | The worktree is in use, or that cannot be determined (restricted or incomplete process inspection). |
| `HANDSHAKE_FAILED`, `HANDSHAKE_IDENTITY_MISMATCH`, `HANDSHAKE_TOOLS_MISSING`, `HANDSHAKE_NOT_POSSIBLE`, `HANDSHAKE_SKIPPED` | The MCP server did not start as configured, or was not tried. |
| `LOGS_PATH_REDIRECTED` | `.bridge/logs` is a symlink; the runtime refuses to log through it. |
| `LOGS_DEGRADED`, `LOGS_UNREADABLE` | The [diagnostics log](diagnostics.md) reported write failures, or its directory cannot be read. |

`init`, `update` and `rollback` refuse with `PATH_REDIRECTED`, `ACTIVE_SESSION`, `ACTIVE_USE_UNKNOWN`,
`STATE_SCHEMA_NEWER`, `STATE_UNREADABLE`, `RUNTIME_COMPATIBILITY_UNKNOWN`, `RUNTIME_INCOMPLETE`,
`SETUP_ALREADY_INITIALIZED`, `SETUP_NOT_INITIALIZED`,
`ROLLBACK_SAME_RUNTIME` or `ROLLBACK_NO_PREVIOUS`, and report file conflicts as
`INSTRUCTION_MODIFIED`, `CODEX_CONFIG_*` or `GITIGNORE_CONFLICT`. `install` reports
`INSTALL_SOURCE_INVALID` or `INSTALL_STEP_FAILED` with the path of its log.

The `logs` check reports the [diagnostics log](diagnostics.md) of the worktree: how many files
it holds, how much space they take, when the newest record was written, and whether the logger
reported failures or deleted files by retention. No log at all is `ok`: the runtime writes one
after its first authorized call.

## 8. Diagnose an incident

```sh
node scripts/bridge.mjs diagnose --workspace <worktree>
node scripts/bridge.mjs diagnose --workspace <worktree> --feature <feature id>
node scripts/bridge.mjs diagnose --workspace <worktree> --task <task id> [--attempt <n>]
node scripts/bridge.mjs diagnose --workspace <worktree> --since 2h
```

Without a scope, `diagnose` prints what can be selected — features, recent tasks, log files and
the database state — and exports nothing. With a scope it writes one ZIP into this worktree's
exchange namespace (`~/tmp/bridge-exchange/ws_<key>/packages/`, the namespace
`feature_exchange.py` also resolves), with a generated name. There is no destination flag: the
package is built in a private staging directory and linked into the namespace, which is atomic
and fails on a name that already exists, so nothing is ever overwritten and a partly written
package is never published. `--inspect <file.zip>` re-checks a package against its own manifest.

The command only reads: it takes a private consistent snapshot of the database through SQLite's
backup API (WAL included), reads the worktree's own diagnostics logs as bounded prefixes, reuses
doctor's safe subset, and changes nothing in the worktree — no migration, no repair, no recovery,
no claim, and no running worker is stopped. It executes nothing the diagnosed worktree selected:
its runtime is described from its manifest, never imported. Every path is checked from a trusted
anchor before the first read and before the first directory is created: no component may be a
symlink, so a redirected state, log, evidence or database path is refused or reported, and a
redirected exchange namespace refuses the command instead of creating anything inside it.
`--db <path>` names an external database deliberately.

The default package carries identifiers, states, timings and machine codes only.
`--with-evidence` adds the termination evidence files (a redacted runtime stderr tail) and
`--with-database` the raw snapshot; both are named in the manifest and in the printed risk note.
Nothing is uploaded. What a package contains, what it withholds and how to read it is described
in [diagnostics.md](diagnostics.md).

Refusals: `DIAGNOSE_SCOPE_INVALID` (an unusable `--since`, `--attempt` without `--task`, or
`--feature` together with `--task`), `DIAGNOSE_SCOPE_NOT_FOUND` (the named feature or task is not
in this worktree), `DIAGNOSE_PATH_UNSAFE` (a state path is a link or not a regular file),
`DIAGNOSE_OUTPUT_UNSAFE` (the namespace is redirected or resolves inside the worktree),
`DIAGNOSE_OUTPUT_UNWRITABLE` (the destination cannot be written, including a disk that filled
mid-package), `DIAGNOSE_PACKAGE_EXISTS` (that name is already taken) and
`DIAGNOSE_PACKAGE_INVALID` (`--inspect` on something that is not a package).

## Limits

- Linux and macOS, local filesystems only, one active manager and feature per worktree.
- Setup never writes through a symlink. When a managed directory or file — for example
  `.agents` shared with other projects, or anything below `.bridge-runtime/` except its
  `current` link — is a symlink, `init`, `update` and `rollback` refuse before writing,
  even if the link points inside the worktree. Replace it with a real directory, or keep those
  files unmanaged.
- Active use is read from `/proc` on Linux and `ps`/`lsof` on macOS for the current user. Processes of other users are not
  inspected, and inside a Codex sandbox the answer is unknown, so `update` refuses there.
- Codex resolves the relative launcher path from its own working directory: start it in the
  worktree root. A `-c projects.<path>.trust_level` override does not make Codex load project
  configuration; trust must be approved in Codex.
- `.mcp.json` for a Claude Code manager is not managed by `init`.
- Removing a runtime is manual: check that no worktree links to it, then
  `chmod -R u+w <runtime> && rm -rf <runtime>`.
- `diagnose` reports what it could not collect instead of failing: a missing, locked or corrupt
  database, unreadable log lines, a redirected directory, absent evidence and a missing runtime
  selection all appear as gaps in the manifest. A package with gaps is still a package.
- A hard kill during an export publishes nothing, but can leave a private working directory under
  `~/tmp/bridge-exchange/ws_<key>/staging/`. The next export neither reads nor needs it; remove it
  when you want the space back.

## Developing the bridge

This repository uses the same layout: its `.codex/config.toml` is the managed block and its
`.mcp.json` points to `.bridge-runtime/current`. Run `init` in each bridge worktree with a runtime
installed from an accepted commit, so an active manager never runs the build of the worktree it
is changing. Build and test changes in the worktree itself as before.

### macOS process inspection and Python

Setup, update and rollback inspect live processes before changing configuration.
Linux uses `/proc`; macOS uses `/bin/ps` and `/usr/sbin/lsof` for same-user process,
working-directory and open-state-file evidence. Run setup outside a sandbox that
hides processes. Missing tools, denied or incomplete reads, and changing snapshots
produce `ACTIVE_USE_UNKNOWN`, never an assumption that the worktree is idle.
Retry after transient process changes. Other operating systems are explicitly
unsupported by this check. A bridge workspace argument that `ps` cannot resolve
unambiguously also produces an unknown result; close that bridge normally first.

Python 3.11+ with standard-library `tomllib`, exposed as `python3` on `PATH`, enables
full validation of `.codex/config.toml`. Check `command -v python3` and
`python3 --version` in the same shell used for setup; macOS system Python may be
older than a separately installed Python. The diagnostic distinguishes a missing
executable, missing `tomllib`, invalid TOML and an execution failure. The conservative
configuration scan remains in effect when parsing is unavailable. This warning is
separate from active-session detection and does not itself mean `/proc` is required.


### Linux protected processes: opt-in read-only observer

On some Linux hosts even processes of the same user have protected `/proc` cwd or
file descriptors (for example a user service or SSH agent). The default scan
returns `ACTIVE_USE_UNKNOWN`. Closing Codex cannot make those other processes readable.
Do not kill system services, disable OS restrictions or run the installer as root.

With a version of the installer that supports this option, authorize **only the
read-only process observation** in your terminal, then retry the ordinary command:

```sh
sudo -v
CLAUDE_CODEX_BRIDGE_PROCESS_INSPECTION=sudo node scripts/plugin-packages/bridge-plugin.mjs update --to <runtime-id> --yes
CLAUDE_CODEX_BRIDGE_PROCESS_INSPECTION=sudo node scripts/bridge.mjs doctor --workspace "$PWD"
```

Close project clients normally before applying an update. Replace `<runtime-id>`
with the exact already prepared target. Keep the same bridge home and doctor
profile as your normal commands. The environment option also applies to setup,
legacy init/update/rollback and doctor; it is deliberately not enabled globally.
`native` is the default; unknown values and `sudo` on macOS are refused.

Only `/usr/bin/sudo -n -- /usr/bin/python3 -I -S -c <fixed reader> ...` runs as root.
Python reads process metadata for the original user, never writes, kills processes,
imports project modules or executes npm/Git. The installer remains your ordinary
user. Inspect `scripts/setup/process-observer.py` before authorizing it; this is
trusted installer code, not a boundary against a malicious copy of the installer.
`-I -S` disables user Python paths and site startup; the system Python must exist.
Sudo must permit this command; `sudo -v` alone cannot grant a command disallowed by
local policy. No password is read by the installer and it never launches a prompt.

Each check requests a fresh, bounded observation, tied to the workspace, UID,
installer PID and request nonce. There is no saved “idle” report or override flag.
An active client, launcher or open state file still blocks the update. Missing
privilege, incomplete inspection, changing process identity or an invalid reply
still yields `ACTIVE_USE_UNKNOWN`. Root in a restricted container may also lack
the access required for a complete observation; the option does not override that.
Results expose only relevant PIDs and fixed activity labels, not argv, cwd or fd targets.

Why not use `ps` everywhere? Linux `ps` itself reads `/proc` and cannot report all
open state files. It would need `lsof`, which faces the same Linux permission checks,
and flattened arguments lose the exact argv boundaries used for workspace paths.
Keep Linux's native observer and macOS's existing `ps`/`lsof` backend. A snapshot is
not a lock against a new client starting afterwards; keep clients closed throughout
an update, as before.

References: [Linux ps](https://man7.org/linux/man-pages/man1/ps.1.html) and
[proc fd permissions](https://man7.org/linux/man-pages/man5/proc_pid_fd.5.html).
