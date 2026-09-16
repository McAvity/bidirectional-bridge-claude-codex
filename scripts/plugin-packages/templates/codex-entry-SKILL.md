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

## 1. Look before doing anything

```sh
node "<plugin>/scripts/plugin-packages/bridge-plugin.mjs" status --json
```

Reading is pure: it writes nothing, claims no manager and creates no state. The report gives
`workspace`, the `pin` this project declares, the `runtime` and `selection` states, and — once a
runtime is installed — `instructions`, whose entries are absolute paths into that runtime:

- `instructions.codex_role_skill` — the bridge role instructions to follow as manager;
- `instructions.workflow_skills` — the `feature-*` skills;
- `instructions.exchange_helper` — the exporter to invoke as
  `python3 "<instructions.exchange_helper>" export --repo <worktree> ...`;
- `instructions.claude_executor_package` — what the runtime hands a delegated Claude.

Use those absolute paths. Do not copy anything from them into the project, and do not use a
workflow copy from anywhere else.

## 2. Enable the project, or this worktree, when asked

```sh
node "<plugin>/scripts/plugin-packages/bridge-plugin.mjs" setup --json          # plan only
node "<plugin>/scripts/plugin-packages/bridge-plugin.mjs" setup --yes --json    # apply
```

`setup` is the only writing operation, and it does the whole job:

1. it acquires the pinned bridge source — the project's own declared pin if the project already
   has one, otherwise the pin this distribution ships — verifying the commit hash. Nobody clones
   anything by hand and nobody types a runtime id;
2. it installs that commit as an immutable runtime beside any others, unless it is already
   installed;
3. it writes this worktree's configuration through the same plan/apply machinery the setup CLI
   uses: a locally modified managed file, an `mcp_servers.bridge` defined elsewhere, a copied
   setup record, a symlinked managed path or an active session are all refused with a named code,
   and nothing is written when anything is refused.

Report the plan before applying it when the user has not already asked you to go ahead.

Two steps belong to the host and are not bypassed: Codex reads a project `.codex/config.toml`
only for a project the user has trusted, and a client reads its MCP server list at startup — so
enabling a project the first time costs one trust decision and one restart. Say so plainly. A
worktree created later from an already-enabled project inherits the declaration and the entry
point; it still needs its own local selection, which the same `setup` command writes, and it never
adopts another worktree's state.

## 3. Moving the pin

```sh
node "<plugin>/scripts/plugin-packages/bridge-plugin.mjs" update --to <runtime id> --yes --json
node "<plugin>/scripts/plugin-packages/bridge-plugin.mjs" rollback --yes --json
```

Both move the committed declaration and this worktree's local selection together, and both refuse
while the worktree is in use. Delivering a new plugin version never moves a pin by itself.

## 4. When something is refused

Every refusal has a code and a next step: report them as they are. Do not work around a refusal,
do not remove `.bridge/` or `.bridge-runtime/` to make one go away, and do not adopt state this
worktree did not write.
