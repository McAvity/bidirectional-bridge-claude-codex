---
name: bridge
description: "Enable and use the Claude Code <-> Codex bridge in this project or worktree. Use when the user asks to turn the bridge on here, to run a feature through it, or when the bridge tools are missing or report a version mismatch."
---

# Bridge

This skill is deliberately thin. It carries no workflow: the feature workflow, the role
instructions and the exchange helper all live in the **installed runtime this worktree selected**,
so a manager never reads a newer copy than the runtime it is driving.

Everywhere below, `<plugin>` is this plugin's own directory — the skills table gives the absolute
path of this SKILL.md, and `<plugin>` is two levels above it (`<plugin>/skills/bridge/SKILL.md`).

## 1. Find the selected set

Run, from the worktree root:

```sh
node "<plugin>/scripts/bridge-plugin.mjs" status --json
```

The report names `workspace`, the `pin` this project declares, the `runtime` selected for this
worktree and `instructions.root` — the absolute directory holding the instruction set of that
runtime. Reading is pure: it never writes, never claims a manager and never creates state.

## 2. Follow the pinned instructions, not this file

Read the skills under `<instructions.root>/.agents/skills/` and the role skill at
`<instructions.codex_role_skill>`. Those are the instructions of the selected runtime. Do not use
a workflow copy from anywhere else, and do not copy them into the project.

## 3. Prepare this worktree when asked

When the user asks to enable the bridge here, or `status` reports a state other than `ready`:

```sh
node "<plugin>/scripts/bridge-plugin.mjs" prepare --json          # plan only
node "<plugin>/scripts/bridge-plugin.mjs" prepare --yes --json    # apply
```

`prepare` is the only writing operation. It resolves the real worktree root and git dir, takes an
exclusive lock, revalidates under it, and writes only the portable project declaration, the
dispatcher, the managed MCP block and the ignore block. It refuses a workspace whose local record
was copied from another worktree, refuses to write through a symlinked managed path, and leaves
every custom file alone.

The first time a project is enabled, the host must be told to trust it and the client must be
restarted once, because a client reads its MCP server list at startup. Say so plainly. A worktree
created later from an already-enabled project inherits the declaration and the dispatcher and
needs no bridge preparation step.

## 4. If the runtime is missing

`status` reports `runtime-missing` with the pinned id. Install exactly that runtime with the
setup CLI of a bridge clone; never silently fall back to a different version.
