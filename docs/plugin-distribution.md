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
| `plugins/bridge-codex/` | Codex package: one thin entry skill, the installer and the pinned release descriptor |
| `plugins/bridge-claude/` | Claude Code package: the whole feature workflow and the bridge role skill |
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

## Enabling a project

Open Codex in the project and ask to use the bridge. The entry skill runs:

```sh
node "<plugin>/scripts/plugin-packages/bridge-plugin.mjs" status --json   # pure read
node "<plugin>/scripts/plugin-packages/bridge-plugin.mjs" setup --yes     # the only write
```

`setup` installs the pinned runtime if this machine lacks it, then writes:

- `.bridge-project/bridge.json` — the portable declaration: enabled, and the pinned runtime id and
  commit;
- `.bridge-project/entry.mjs` — a 54-line entry point that loads the pinned runtime;
- the managed `[mcp_servers.bridge]` block in `.codex/config.toml`;
- the managed block in `.gitignore`;
- this worktree's own `.bridge-runtime/install.json` and `current`, which are **not** committed.

Commit the first four. They contain no home directory, no machine path and no runtime path.

Every write goes through the same plan the setup CLI uses, so a locally modified managed file, an
`mcp_servers.bridge` defined elsewhere, a copied setup record, a symlinked managed path or an
active session are refused with a named code and nothing is written. `--keep-local` keeps your
edit instead of refusing.

**Two host steps remain, and they are the host's, not the bridge's.** Codex reads a project
`.codex/config.toml` only for a project you have trusted, and a client reads its MCP server list at
startup — so enabling a project for the first time costs one trust decision and one restart. Codex
also loads no project configuration at all when it is started in a subdirectory; start it at the
worktree root.

## A new worktree

A worktree created from an enabled project inherits `.bridge-project/` and the managed block
through Git. One `setup` there writes only its own `.bridge-runtime/current`: no reinstall, no
configuration rewrite, no instruction copy. Local state is never inherited and a copied
`.bridge-runtime/` is refused, never adopted.

Codex's own per-path trust prompt still applies to the new path.

## Versions and updates

The project declaration is the authoritative pin. A worktree records what it actually applied; a
difference is reported as `pin-diverged` and is resolved by an explicit `update` or `rollback`,
never by a silent switch. Delivering a new plugin version changes the distribution, not the pin:
the entry point keeps loading the declared runtime.

If the declared runtime is not installed on this machine, the entry point refuses with a named code
and points at the setup skill, which installs exactly that pin. It never falls back to a different
version. The same gate refuses a worktree whose applied selection differs from the declaration, a
copied setup record, a disabled or unrecognised declaration, and a pin whose commit does not match
the runtime answering to its id — each before the server starts, with nothing written.

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
