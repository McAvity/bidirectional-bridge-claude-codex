# Contract: plugin packages, marketplace and worktree bootstrap (W14-01)

Status: **proposed**, revision 1. No product code is implemented by this round.
Written on `1f7d34f1d3bf1de15c2b9cef5b3b121f2c8c27c0`; host facts come from the
model-free probes recorded in
[`evidence/W14-01/`](../evidence/W14-01/README.md), run against
`codex-cli 0.154.0` and Claude Code `2.1.273`.

Inputs (SHA-256):

| File | SHA-256 |
| --- | --- |
| `docs/plans/wave14.md` | `94d8813cc42600f1434ec8ac16e2b262dfe8d5e92a10a17799de4c9973810289` |
| `docs/setup-layout.md` | `cc0e3d4cc44f29dfd3188f39101324efe250b9c1daf9069263b6cf7511fdca2b` |
| `docs/features/F-W14-plugin-distribution/brief.md` | `8b320b5563e6b41a406ed89fb05f60df447e2ca13a1f7d592062070f4a09451c` |
| `docs/features/F-W14-plugin-distribution/decisions/01.md` | `66c488ff60b7f9651104238df531cd5e2d8705ab62f5ca128389347b443439b0` |
| `work-items/W14-01.md` | `d328699774b84aad70997ed88bafa6c194ee22e1416e41203f82f89d5cfc8ee9` |
| `evidence/W14-01/results/codex-plugin-mcp-cwd.json` | `cd98bc21d7f7701fe0d175023fc21fe042e6622935fa1a2082e349af06cb5013` |
| `evidence/W14-01/results/claude-delegated-instructions.json` | `3b6d1adcde6dfe0467da66430d81d38c1575aa20a29b77aa74b0916759a1d20f` |
| `evidence/W14-01/results/plugin-cache-update-restart.json` | `4df597bdf5a0197c65d74c4916b4530e810728cf13d74a209e797f4dbc66153a` |
| `evidence/W14-01/results/missing-runtime-startup.json` | `0fe06ea7231c1ceea6d3b68a38398cd107a714b8b5b607f3142f9e58ebc199d2` |

## 1. Constraints the probes fix

These are host facts, not design preferences. Every later choice follows from
them.

- **C1.** A Codex plugin MCP server is started with `cwd` inside the
  version-pinned plugin cache and an environment stripped to an allowlist, and
  the MCP handshake carries no project root. `env_vars: ["PWD"]` re-exports
  whatever the parent process had — absent under a non-shell launcher, stale
  under an orchestrator, and divergent under `codex -C`. **A plugin-declared MCP
  server therefore cannot infer its workspace.**
- **C2.** `claude -p --plugin-dir <dir|zip>` loads a plugin for one session, with
  no profile or project install, and gives its MCP subprocess the project `cwd`
  plus `CLAUDE_PROJECT_DIR` / `CLAUDE_PLUGIN_ROOT`.
- **C3.** The Codex plugin cache is destructive on update: installing a new
  version deletes the previous version's directory. Claude Code keeps both. The
  plugin cache is therefore not a durable home for anything a running feature
  must resume against.
- **C4.** Codex resolves relative `command`/`args`/`cwd` of a **project-scoped**
  `[mcp_servers.*]` entry against its own process directory (wave12 contract,
  re-confirmed by `codex mcp list --json` in the probes). That mechanism is the
  only one that binds a bridge server to a worktree today.
- **C5.** Under `codex exec`, a bridge server that cannot launch does not abort
  the session even with `required = true`. TUI behaviour is **unverified**.

## 2. Decided shape

### 2.1 One source, two generated packages, one in-repo marketplace

```text
packages/                         # generated, committed, reproducible
  codex/bridge/                   # Codex plugin payload
    .codex-plugin/plugin.json
    skills/                       # generated from .agents/skills + .codex/skills
    scripts/                      # bootstrap entry point
  claude/bridge-executor/         # Claude Code plugin payload
    .claude-plugin/plugin.json
    skills/                       # generated from .agents/skills + .claude/skills
.agents/plugins/marketplace.json  # Codex marketplace (repo/team form)
.claude-plugin/marketplace.json   # Claude Code marketplace
```

Both payloads are **generated** from the single canonical skill set in
`.agents/skills/` plus the role-specific `using-bridge` skills. The generator is
the only writer of `packages/`; a check re-runs it and fails on any diff, so the
"no manual copies" rule of the brief is enforced mechanically rather than by
convention. Source, both packages and both marketplaces stay in this repository
(decision 01).

Manifest constraints that the generator must respect, taken from the installed
Codex `plugin-creator` reference and confirmed by installing generated fixtures:
`.codex-plugin/plugin.json` requires real `name`, `version` (strict semver),
`description`, `author.name` and the `interface` block
(`displayName`, `shortDescription`, `longDescription`, `developerName`,
`category`); `hooks` is rejected; `mcpServers` is written only when the companion
file exists. Marketplace entries require `policy.installation`,
`policy.authentication` and `category`, with `source.path` relative to the
marketplace root. The Claude payload uses `.claude-plugin/plugin.json` and
`${CLAUDE_PLUGIN_ROOT}` for every path inside `.mcp.json`.

The Codex marketplace root is the repository root (its manifest lives at
`.agents/plugins/marketplace.json` and its entries point at `./packages/codex/…`),
so `codex plugin marketplace add <path-or-repo>` works from a clone with no
dependency on the author's checkout (AC-01). Neither marketplace installs Node
dependencies for us: the payloads must run on the host's Node with no
`npm install` step, so the plugin ships **no** `node_modules` and the runtime it
uses is the wave12 installed runtime, not the plugin cache (C3).

### 2.2 The bridge MCP server stays project-scoped

Because of **C1**, the Codex plugin does **not** declare the bridge MCP server.
It declares no MCP server at all in revision 1. The bridge server keeps the
wave12 managed `[mcp_servers.bridge]` block with the relative launcher path and
`--workspace .`, which **C4** shows is the only binding that actually works.

The plugin's contribution is the part that does not need a workspace: the skills,
and a bootstrap script that a skill invokes through the agent's shell — which
*does* run in the worktree.

Rejected alternative, recorded with its cost: a workspace-agnostic plugin MCP
server that receives the worktree as an explicit, validated tool argument
(`bridge_setup(workspace=…)`). It would remove the restart in §2.4 and it fits
the brief's rule that binding follows an instructed use rather than a handshake.
It is rejected for revision 1 because the current server binds `--caller`,
`--delegation` and `--workspace` for the process lifetime
(`scripts/native-bridge-mcp.mjs`), late binding would have to be reconciled with
the identity guard, and a mid-session tool-set change depends on
`notifications/tools/list_changed` handling that **no probe in this round
verified**. It should be reconsidered only with that handling measured.

### 2.3 Project declaration, separate from local state

A committed, portable declaration states that the project uses the bridge and
which set it is pinned to. It carries no host paths, no identity and no session
state, so a new worktree inherits it through Git unchanged:

```json
{
  "format": "claude-codex-bridge.project/v1",
  "enabled": true,
  "pinned": { "runtime_id": "0.2.0-860e2e77d95f", "commit": "860e2e77d95f…" }
}
```

Everything local stays exactly where `docs/setup-layout.md` already puts it:
`.bridge-runtime/` for the selection, `.bridge/` for the database, markers, lock
and logs. Nothing local is shared through the common gitdir, and a copied
`.bridge-runtime/install.json` naming another worktree is refused, never adopted
— the existing rule is unchanged and load-bearing here.

### 2.4 Enabling a project and preparing a new worktree

1. Once per machine: add the marketplace and install the plugin.
2. In a project: the user asks, in ordinary words, to use the bridge. The
   `bridge-setup` skill — available from the plugin in every directory —
   resolves root and gitdir, writes or reads the project declaration, installs or
   reuses the pinned runtime under `<home>/runtimes/<id>/`, and writes the
   managed block, the instruction set, the ignore block and `.bridge-runtime/`
   idempotently. This is the existing wave12 `init`, invoked for the user instead
   of typed by the user.
3. In a new worktree of an enabled project: the same skill runs, reads the
   inherited declaration, and prepares only the local state. No manual command,
   no flags, no copying.
4. One client restart after step 2 or 3, because the MCP server list is read at
   session start. **C5** says the session before the restart still works under
   `codex exec`, so the skill can run there; the TUI equivalent is an open
   question (§4).

Concurrency and refusal rules are unchanged: detection, handshake or a read never
assign a manager or create domain state; a foreign manager is refused with no
mutation; two simultaneous first uses must not overwrite each other's
configuration, which the existing `pending.json` / backup journal already covers.

### 2.5 The delegated executor

By **C2** the bridge passes `--plugin-dir <selected runtime>/packages/claude/bridge-executor`
when it spawns `claude -p`. The executor then has the instruction set of the
**selected** runtime — not of whatever is newest, and not of whatever the user
happens to have installed. No Claude Code plugin install is required for
Astra → Claude to work; the published Claude package exists so a person can use
the same roles natively, which is a separate, optional path.

The `--plugin-dir` argument sits beside the existing `--add-dir`,
`--disallowed-tools` and `--permission-mode` arguments and was probed together
with the further-delegation lock; it does not weaken it.

### 2.6 Versions, updates and removal

The pinned set is `runtime + instructions` together, identified by the wave12
`runtime_id`. The authoritative pin is the project declaration (§2.3); a
worktree's `.bridge-runtime/install.json` records which pin it actually applied.
A divergence produces a named condition and an explicit update or rollback
operation — never a silent switch to whatever the plugin cache now holds.

**C3** makes this mandatory rather than stylistic: a plugin update deletes the
previous Codex cache version, so no pin may ever point inside the plugin cache.
The installed runtime directory is confirmed byte-identical after both a plugin
update and a plugin removal. Removing the plugin therefore leaves features,
databases, packages, evidence and installed runtimes in place; only the
distribution channel goes away.

Manager instructions must match the selected set for the same reason. Revision 1
keeps a thin, stable entry skill in the plugin that reads the selected runtime
and loads the workflow instructions from it, rather than always loading the
newest full workflow out of the plugin cache.

### 2.7 Migration and fallback

An existing wave12 worktree keeps working untouched until an explicit migration.
Because the plugin declares no MCP server (§2.2) there is no double-server or
tool-name conflict to resolve in revision 1 — a benefit worth naming, since it
was one of the plan's risks. The wave12 CLI stays the supported fallback for
environments without plugins, and `doctor` reports which integration source,
which selected version and which conflict cause it sees.

## 3. Path references inside the packages

Every reference of the form `.agents/skills/...` must resolve from the package.
This includes `feature-exchange`'s `scripts/feature_exchange.py`, which the
bridge-loop instructions invoke by path, and the `docs/features/README.md`
reference. Revision 1 requires the generator to rewrite these to package-relative
or runtime-relative references and a check to fail on any remaining literal
`.agents/skills/` path inside a generated package. Shipping today's files in an
archive with dead links does not satisfy this.

## 4. Open questions for W14-02

1. **TUI startup with an unusable bridge server.** Only `codex exec` was probed
   (**C5**). If the TUI refuses to start, step 4 of §2.4 breaks and the managed
   block must be written with `required = false` until the runtime exists, or
   kept out of Git entirely. Needs a PTY smoke like wave12 AC-08.
2. **Whether the project declaration should also be the `required` gate**, i.e.
   whether a worktree with a declaration but no runtime should fail loudly rather
   than start degraded.
3. **Late-bound plugin MCP** (§2.2 rejected alternative) — only with measured
   `tools/list_changed` behaviour and a reconciled identity guard.
4. **Codex vendor documentation** could not be read this round; the manifest
   shape above rests on the installed CLI and the local `plugin-creator`
   reference and must be re-checked before the generator is frozen.

## 5. What this contract does not do

It does not implement anything, does not change `docs/setup-layout.md`, does not
touch wave13, and does not authorise publishing a plugin or a marketplace
anywhere. It proposes; the coordinator decides.
