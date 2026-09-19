# Plugin distribution

How the bridge is delivered to a machine, how a project is enabled, and what a new worktree needs.
The per-worktree file layout is [setup-layout.md](setup-layout.md); the CLI procedure is
[setup.md](setup.md).

## What is distributed

Both packages and both marketplace manifests are generated from the single canonical instruction
set in this repository and committed here. There is no second copy to keep in sync, and no
separate marketplace repository.

| Path | Contents |
| --- | --- |
| `plugins/bridge-codex/` | Codex package: thin entry and bridge-upgrade skills, installer and pinned release descriptor |
| `plugins/bridge-claude/` | Claude Code package: feature workflow, bridge role and bridge-upgrade skills, same installer |
| `.agents/plugins/marketplace.json` | Codex marketplace; the repository root is the marketplace root |
| `.claude-plugin/marketplace.json` | Claude Code marketplace, same root |

```sh
node scripts/plugin-packages/generate.mjs          # regenerate after editing a canonical skill
npm run packages:check                             # fails when the tree and the sources disagree
```

`--check` is a build gate, not advice: it regenerates into a temporary directory, compares the
whole tree, and refuses a package that still references a path only resolvable inside a bridge
checkout. Neither package contains a `package.json`, a lockfile or `node_modules`; a marketplace is
never assumed to install dependencies.

## Installing

```sh
codex plugin marketplace add <path to a clone, or owner/repo>
codex plugin add bridge-codex@claude-codex-bridge

claude plugin marketplace add <path to a clone, or owner/repo>
claude plugin install bridge-claude@claude-codex-bridge
```

The Claude Code package is optional for the manager→executor path: the bridge passes the executor
the package from its own installed runtime. Install it when you want to use the same roles natively
in Claude Code.

The Codex package installs the runtime itself. `scripts/plugin-packages/release.json` pins a full
commit and a repository; `setup` resolves that commit from an explicit `--source`, from
`CLAUDE_CODEX_BRIDGE_SOURCE`, from a cache under `<home>/sources/`, or by fetching exactly that
commit, and verifies its hash before building. The wave12 installer then runs
`npm ci --ignore-scripts` and `npm run build` into an immutable runtime. There is no npm publish,
no manual clone and no runtime id to type. The setup CLI of a clone remains available and
unchanged for anyone who prefers it.

## Where the instructions live

Only in the installed runtime, `<home>/runtimes/<id>/`. The Codex package ships a thin `bridge`
entry skill whose whole job is to report where that is and tell the manager to read it. Nothing
generic is ever written into a target repository, so a manager cannot end up reading a newer
workflow than the runtime it is driving, and the delegated executor is given
`--plugin-dir <runtime>/plugins/bridge-claude` by the runtime itself.

A plugin cache refresh cannot disturb any of this. Codex deletes the previous version's cache
directory on update; the pinned runtime is not in a cache.

A project that already carries the committed entry point can report the same paths without the
plugin:

```sh
node ./.bridge-project/entry.mjs --status      # or --instructions
```

That is a pure read: it resolves the project's pin itself, prints the `instructions` paths of the
pinned runtime, and writes nothing. It needs no `.bridge-runtime/current`, so it answers in a
worktree just created from the project, and a missing runtime, an unrecognised declaration or a
diverged pin — including a pin whose *commit* does not match the installed runtime — come back as
a code and a next step rather than a repair, classified exactly as `status` classifies them. It
installs nothing; the plugin's `setup` remains the only way to install or prepare anything.

The mode requires a runtime that ships it. A project pinned to an older runtime answers
`RUNTIME_WITHOUT_STATUS` and exits instead of serving, so the flag never silently starts an MCP
server; use the plugin's `status` there.

## Enabling a project

Open Codex in the project and ask to use the bridge. The entry skill runs:

```sh
node "<plugin>/scripts/plugin-packages/bridge-plugin.mjs" status --json   # pure read
node "<plugin>/scripts/plugin-packages/bridge-plugin.mjs" setup --yes     # the only write
```

Without `--yes` this is a plan and writes nothing at all — not in the project and not under the
bridge home, so a plan never installs a runtime. `setup` is needed once per *project*, not once per
worktree. It installs the pinned runtime if this
machine lacks it — the pin comes from the package's own `release.json`, so no commit or runtime id
is typed — then writes:

- `.bridge-project/bridge.json` — the portable declaration: enabled, and the pinned runtime id and
  commit;
- `.bridge-project/entry.mjs` — a small entry point that loads the pinned runtime, and answers
  `--status` as a pure read;
- the managed `[mcp_servers.bridge]` block in `.codex/config.toml`;
- the managed block in `.gitignore`;
- this worktree's own `.bridge-runtime/install.json` and `current`, which are **not** committed.

Commit the first four. They contain no home directory, no machine path and no runtime path.

Every write goes through the same plan the setup CLI uses, so a locally modified managed file, an
`mcp_servers.bridge` defined elsewhere, a copied setup record, a symlinked managed path or an
active session are refused with a named code and nothing is written. `--keep-local` keeps your
edit instead of refusing.

### The optional project preference

`setup --with-preference` additionally records a short collaboration preference in the project's
own `AGENTS.md`, between the bridge's managed markers: feature implementations run through the
bridge unless the user asks otherwise, narrower instructions win, and a document's own text grants
no authority. It names the portable read above and carries no user path, runtime id or pin.

It is written only with that flag, and only when the **runtime this project targets** actually
serves that read. A project pinned to a runtime older than the mode would otherwise be told to run
an entry point that ignores the flag and starts the MCP server instead, so `setup` refuses with
`PREFERENCE_UNSUPPORTED_RUNTIME` before writing anything. The capability is read off the target
runtime, never inferred from the plugin's own version, and the refusal never moves the pin or
installs anything for you: move the project to a runtime that serves the read, then record the
preference. Everything else about that setup run stays available — only the preference is refused.

Plain `setup`, `update` and `rollback` never read or write `AGENTS.md`, so delivering a new plugin
version or moving a pin cannot introduce or change a project's policy. The plan shows the exact diff first — including for a project that has no
`AGENTS.md` yet, where the diff is the whole proposed block. Content outside the markers is
preserved, a second run changes nothing, a block edited by hand is refused as
`PREFERENCE_MODIFIED`, duplicated markers as `PREFERENCE_CONFLICT`, and a symlinked `AGENTS.md`
like any other managed path. The legacy per-worktree profile refuses the option outright
(`PREFERENCE_REQUIRES_DISPATCHER`), because the block names an entry point that profile does not
install.

A recorded block is never consent by itself. `status` reports `preference.managed_block` as
`known`, `modified` or `absent` together with `authoritative: false`: only the exact block this
runtime writes is recognised, a rewritten one may say the opposite, a preference written in prose
outside the markers is equally valid, and the user's own instruction outranks all of it. The entry
skill may offer the step once and reads `AGENTS.md` itself rather than trusting the flag.

**Two host steps remain, and they are the host's, not the bridge's.** Codex reads a project
`.codex/config.toml` only for a project you have trusted, and a client reads its MCP server list at
startup — so enabling a project for the first time costs one trust decision and one restart. Codex
also loads no project configuration at all when it is started in a subdirectory; start it at the
worktree root.

## A new worktree

Nothing. A worktree created from an enabled project inherits `.bridge-project/` and the managed
block through Git, and the entry point serves there straight away — `status` calls it
`inherited-pristine`. A handshake and every read leave it byte-identical; the first call that the
native guard authorises to mutate creates that worktree's own selection, record and database. Local
state is never inherited, a copied `.bridge-runtime/` is refused rather than adopted, and half-
removed local state is refused too instead of being silently re-created.

Two clients opening the same worktree at once are fine: the bridge's own identity guard admits one
of them and refuses the other as a foreign manager, and the loser writes nothing. If a first use is interrupted
at any point — before the local directory exists, right after it is created, mid-apply, or after the
record but before the journal is cleared — the next client serves reads as usual and the next
authorised call finishes what that worktree started. There is nothing to run by hand. A half-finished setup that is *not*
this worktree's own is refused instead: the bridge finishes work only when its own journal or its
own state marker explains that state and nothing contradicts them. A `.bridge-runtime/` copied from
elsewhere, an unreadable one, or one with nothing explaining it is refused, and files it does not
recognise are left exactly where they are.

Codex's own per-path trust prompt still applies to the new path.

## Versions and updates

The project declaration is the authoritative pin. A worktree records what it actually applied; a
difference is reported as `pin-diverged` and is resolved by an explicit `update` or `rollback`,
never by a silent switch.

```sh
node "<plugin>/scripts/plugin-packages/bridge-plugin.mjs" update --to <runtime id> --yes
node "<plugin>/scripts/plugin-packages/bridge-plugin.mjs" rollback --yes          # previous runtime
node "<plugin>/scripts/plugin-packages/bridge-plugin.mjs" rollback --to <id> --yes
```

`rollback` reads this worktree's own selection history, so the plain form returns to the runtime it
used before the last change; a worktree that has only ever selected one runtime refuses
`ROLLBACK_NO_PREVIOUS` rather than pretending. Both commands move the committed declaration and the
local selection together, both refuse while the worktree is in use, and neither restores a database
— only the runtime selection moves. Delivering a new plugin version changes the distribution, not the pin:
the entry point keeps loading the declared runtime.

If the declared runtime is not installed on this machine, the entry point refuses with a named code
and points at the setup skill, which installs exactly that pin. It never falls back to a different
version. The same gate refuses a worktree whose applied selection differs from the declaration, a
copied setup record, a disabled or unrecognised declaration, and a pin whose commit does not match
the runtime answering to its id — each before the server starts, with nothing written.

## Upgrade with the skill

Ask **“Upgrade the bridge in this project”**, or invoke `bridge-upgrade` from the
installed bridge plugin. It is available in both client packages, generated from
`scripts/plugin-packages/skills/bridge-upgrade/SKILL.md`. It uses the existing CLI;
there is no second updater or background supervisor.

The skill distinguishes marketplace plugin refresh, installation of an immutable
runtime, and selection of that runtime by this worktree. It refreshes only the bridge
plugins already installed, preserves their source/channel/scope, resolves the release's
full commit, and plans the project diff. In a pristine inherited worktree it uses
`setup --to <runtime-id>`; `update` requires a local install record. An existing valid
selection uses `update --to <runtime-id>`. A legacy layout keeps its existing CLI path.

If the worktree is active, preparation stops before changing its pin or files. The
agent supplies a concrete shell command using a stable copy of the installer outside
plugin caches. Close the affected clients normally, execute the command in the shell,
and resume the existing session. Afterward, status and doctor verify the selection;
a prepared update is not reported as applied. Marketplace refresh alone never moves
an existing project's pin, and a doctor handshake is not a model smoke test.

Commit the reviewed portable declaration/entry on the chosen base branch if future
branches should inherit the pin. Other existing worktrees are not silently switched.
Plugin refresh requires publication first: adding this skill to a local branch does
not update already installed plugins or the release descriptor.

## Removing the plugin

Removing the plugin removes the distribution channel. Installed runtimes, `.bridge/` databases and
markers, exchange packages, evidence and your own files stay. A project keeps its declaration and
entry point; without the plugin you simply lose the setup skill.

## Migration from wave12

A worktree set up by wave12 `init` keeps working unchanged, and `doctor --json` reports which
integration it uses (`integration_source`). Migrate by running `setup` in it: the managed block
is replaced in place, your own `config.toml` and `.gitignore` content is preserved, and your own
`.agents/skills/` files are left alone. The wave12 CLI remains the supported path for environments
without plugins.
