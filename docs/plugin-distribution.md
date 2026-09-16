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
| `plugins/bridge-codex/` | Codex package: one thin entry skill and the project scripts |
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

A runtime is still installed with the setup CLI of a clone
(`node scripts/bridge.mjs install`); the plugin distributes instructions and the project scripts,
not the runtime.

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
node "<plugin>/scripts/bridge-plugin.mjs" status --json      # pure read
node "<plugin>/scripts/bridge-plugin.mjs" prepare --yes      # the only write
```

`prepare` writes, and writes nothing else:

- `.bridge-project/bridge.json` — the portable declaration: enabled, and the pinned `runtime_id`;
- `.bridge-project/{dispatch,locate,bootstrap,facade}.mjs` — the portable dispatcher;
- the managed `[mcp_servers.bridge]` block in `.codex/config.toml`;
- the managed block in `.gitignore`.

Commit those. They contain no home directory, no machine path and no runtime id.

**Two host steps remain, and they are the host's, not the bridge's.** Codex reads a project
`.codex/config.toml` only for a project you have trusted, and a client reads its MCP server list at
startup — so enabling a project for the first time costs one trust decision and one restart. Codex
also loads no project configuration at all when it is started in a subdirectory; start it at the
worktree root.

## A new worktree

Nothing. A worktree created from an enabled project inherits `.bridge-project/` and the managed
block through Git, and the dispatcher resolves the real worktree and the pin when the client starts
there. Its local state — `.bridge/` and `.bridge-runtime/` — starts empty and is created on first
instructed use, never inherited and never adopted from a copy.

Codex's own per-path trust prompt still applies to the new path.

## Versions and updates

The project declaration is the authoritative pin. A worktree records what it actually applied; a
difference is reported as `pin-diverged` and is resolved by an explicit `update` or `rollback`,
never by a silent switch. Delivering a new plugin version changes the distribution, not the pin:
the dispatcher keeps routing to the declared runtime.

If the declared runtime is not installed on this machine, the dispatcher serves a small facade with
a fixed two-tool catalogue — report and prepare — instead of silently using a different version.

## Removing the plugin

Removing the plugin removes the distribution channel. Installed runtimes, `.bridge/` databases and
markers, exchange packages, evidence and your own files stay. A project keeps its declaration and
dispatcher; without the plugin you simply lose the entry skill.

## Migration from wave12

A worktree set up by wave12 `init` keeps working unchanged, and `doctor --json` reports which
integration it uses (`integration_source`). Migrate by running `prepare` in it: the managed block
is replaced in place, your own `config.toml` and `.gitignore` content is preserved, and your own
`.agents/skills/` files are left alone. The wave12 CLI remains the supported path for environments
without plugins.
