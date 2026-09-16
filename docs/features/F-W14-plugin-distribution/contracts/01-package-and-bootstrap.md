# Contract: plugin packages, marketplace and worktree bootstrap (W14-01, W14-02)

Status: **revision 2 — implemented**. Revision 1 was proposed design; `reviews/01-contracts.md`
returned REWORK with W14-R1-01…04. This revision corrects those findings and describes what
W14-02 actually built. Implementation evidence:
[`evidence/W14-02/`](../evidence/W14-02/README.md).

Host facts come from the model-free probes of
[`evidence/W14-01/`](../evidence/W14-01/README.md) and from the host checks in
`tests/test_plugin_distribution.py`, both against `codex-cli 0.154.0` and Claude Code `2.1.273`.
Codex packaging documentation was re-read at
<https://developers.openai.com/plugins/build/plugins> (fetched by the coordinator for this round).

## 0. What changed from revision 1

| Finding | Revision 1 said | Revision 2 does |
| --- | --- | --- |
| W14-R1-01 | §2.4 ran wave12 `init`, copying the whole instruction set into the project, while §2.6 promised a thin pinned entry | The Codex package ships **only** a thin entry skill. No instruction file is written into a target repository at all. §3 |
| W14-R1-02 | Every worktree started without an MCP server, ran setup, then restarted | A committed, machine-neutral **project dispatcher** resolves the worktree and the pin at startup. An inherited worktree is ready on first start; only *initial project enablement* costs a restart. §4 |
| W14-R1-03 | Claimed the wave12 journal already covered concurrency | An `O_EXCL` lock with revalidation under it, and tests for the race, the stale lock, symlinks and copied records. §5 |
| W14-R1-04 | Metadata emitted raw paths and reported configured values as observed | Path classes plus digests, configured and observed separated, tri-state divergence. [Contract 02](02-wave13-metadata.md) |

## 1. Constraints the probes fix

- **C1.** A Codex plugin MCP server starts with `cwd` inside the version-pinned plugin cache and
  an environment stripped to an allowlist; the handshake carries no project root and no `roots`
  capability. **A plugin-declared MCP server cannot infer its workspace.**
- **C2.** `claude -p --plugin-dir <dir|zip>` loads a plugin for one session with no profile and
  no project install, and gives its MCP subprocess the project `cwd` and `CLAUDE_PROJECT_DIR`.
- **C3.** Installing a new Codex plugin version **deletes** the previous version's cache
  directory. Claude Code keeps both. The plugin cache is not a durable home for a pin.
- **C4.** A **project-scoped** `[mcp_servers.*]` entry resolves relative `command`, `args` and
  `cwd` against Codex's own process directory, and the child receives that directory as an
  absolute `cwd`. This is the only mechanism that binds a server to a worktree.
- **C5 (new, W14-02).** Codex reads a project `.codex/config.toml` **only for a trusted project**
  (`projects."<path>".trust_level = "trusted"` in `CODEX_HOME/config.toml`), and **only when the
  client starts at the project root** — a launch from a subdirectory loads no project config at
  all. Both are host consent and host scope decisions; neither is bypassed.
- **C6 (new, W14-02).** The environment is stripped for a **project**-scoped MCP server too. A
  variable the server needs must be named in `env_vars`.

## 2. One source, two generated packages, two in-repo marketplaces

`scripts/plugin-packages/generate.mjs` is the only writer of the packages. It reads the single
canonical instruction set — `.agents/skills/`, the two role `using-bridge` skills and
`docs/features/README.md` — and writes:

```text
plugins/bridge-codex/     Codex package: thin entry skill + the project scripts
plugins/bridge-claude/    Claude Code package: the whole workflow and role authority
.agents/plugins/marketplace.json    Codex marketplace, entry ./plugins/bridge-codex
.claude-plugin/marketplace.json     Claude Code marketplace, entry ./plugins/bridge-claude
```

The repository root is the marketplace root for both hosts, so
`codex plugin marketplace add <clone-or-repo>` and `claude plugin marketplace add <clone-or-repo>`
both work with no dependency on the author's checkout (AC-01). Host checks install from it.

**Source equivalence is enforced, not documented.** `generate.mjs --check` regenerates into a
temporary directory and compares the whole tree plus a digest of the canonical sources; editing a
canonical skill without regenerating fails it. It is wired as `npm run packages:check`, and a test
asserts the failure mode rather than only the success.

**References are rewritten.** A package is read from a plugin cache or an installed runtime, so
`.agents/skills/...` and `../../../docs/features/README.md` would be dead there. The generator
rewrites them to `${CLAUDE_PLUGIN_ROOT}/...` (expanded by Claude Code inside skill content) and
refuses to emit a package that still contains a checkout-relative reference.

**No dependency installation is assumed.** Neither package contains a `package.json`, a lockfile
or `node_modules`; everything they run is dependency-free Node. A marketplace is never relied on
to build anything.

## 3. Instructions live in the installed runtime only (W14-R1-01)

The Codex package contains exactly one skill, `bridge`, and no workflow. It tells the manager to
run `bridge-plugin.mjs status`, read `instructions.root` from the report — the **installed runtime
this worktree selected** — and follow the skills there. Consequences:

- there is never a newer instruction copy than the runtime being driven, because there is only one
  copy and it is inside that runtime;
- nothing generic is written into a target repository. A prepared project receives the declaration,
  the dispatcher, the managed MCP block and the ignore block, and nothing else;
- the delegated executor is handed `--plugin-dir <runtime>/plugins/bridge-claude` by the runtime
  itself (**C2**), so it reads the pinned set with no user installation (AC-04), and **C3** cannot
  take it away mid-round because it is not in a plugin cache;
- the published Claude package keeps the full role authority for native use, which is the same
  bytes from the same generator.

## 4. The portable project dispatcher (W14-R1-02)

`prepare` writes `.bridge-project/{bridge.json,dispatch.mjs,locate.mjs,bootstrap.mjs,facade.mjs}`
and a managed block that names `./.bridge-project/dispatch.mjs` relatively. The block contains **no
home directory, no runtime id and no machine path** — a test asserts this — so it is portable and
inherited through Git.

At startup the dispatcher takes the working directory the host gives it (**C4**), derives the git
top level from *that directory* (never from `PWD`, the W14-01 failure mode), reads the project's
authoritative pin from `bridge.json`, and:

- **runtime present** → hands the connection to `<home>/runtimes/<id>/scripts/native-bridge-mcp.mjs`
  with an explicit absolute `--workspace`. The native identity guard, the delegation policy and the
  workspace binding are the ones that runtime implements; the dispatcher adds none of its own and
  overrides none;
- **runtime absent** → serves the facade: a **static** two-tool catalogue (`bridge_status`,
  `bridge_prepare_worktree`). Because the catalogue never changes, nothing depends on
  `notifications/tools/list_changed`, the dependency that was untestable in W14-01.

`env_vars = ["CLAUDE_CODEX_BRIDGE_HOME", "XDG_DATA_HOME"]` is in the block because of **C6**. Both
are variable *names*, not values, so the block stays identical for every user.

**Restart honesty.** Initial project enablement costs one host restart and one host trust decision
(**C5**): a client reads its MCP server list at startup, and Codex only reads a project config for
a trusted project. That is a host property, stated plainly in the skill and in `docs/setup.md`. A
worktree created later from an enabled project inherits the declaration and the dispatcher, needs
no bridge preparation step, and is proven to hand over to the pinned runtime on an ordinary first
start (`tests/test_plugin_distribution.py`, AC-03). Codex's own per-path trust prompt still
applies to that worktree and is not bypassed.

**Not covered:** a launch from a subdirectory. **C5** says Codex loads no project config at all in
that case, so the bridge is simply absent there; the bridge does not work around it.

## 5. Preparation is the only write, and it is exclusive (W14-R1-03)

`bridge_status`, the handshake and detection are pure: a test compares a full directory listing
before and after. `prepare` is reached only from an instructed call, and it:

1. resolves the real worktree, refusing a directory outside a git worktree;
2. refuses a local record naming another worktree — a copy is never adopted and never rewritten;
3. refuses any managed path that is, or passes through, a symlink;
4. takes an `O_EXCL` lock under `.bridge/`, **revalidates 2 and 3 under the lock**, and writes
   atomically. A stale lock older than ten minutes is broken deliberately and reported as
   `broke_stale`, so an interrupted setup cannot wedge a worktree;
5. splices only the managed block, preserving the user's own `config.toml` and `.gitignore`
   content, their own `.agents/skills/`, and every other file;
6. requires `confirm: true` and a `workspace` equal to the root the server itself resolved, so a
   call cannot redirect preparation elsewhere.

Tests cover the concurrent race with two real processes, the held lock, the stale lock, the
symlink, the copied record, idempotency, the dry run and migration from a wave12 block.

## 6. Versions, updates, rollback and migration

The pin is `runtime + instructions` together, identified by the wave12 `runtime_id`, declared in
the committed `bridge.json` and applied per worktree in `.bridge-runtime/install.json`. A
divergence is reported as `pin-diverged`; it never becomes a silent switch. Wave12 `update` and
`rollback` keep their guarantees and stay the way a pin is moved.

Migration is additive: a worktree still carrying the wave12 launcher block keeps working, doctor
reports `integration_source: project-config` for it and `project-dispatcher` for a migrated one,
and the wave12 CLI remains the supported fallback for environments without plugins. Only one
server is ever configured, because the plugin declares none (**C1**).

Removing the plugin removes the distribution channel only: installed runtimes, features,
databases, packages and evidence are untouched, and a test shows the pinned instruction set
surviving deletion of a whole plugin cache.

## 7. Out of scope here

Wave13 owns logging, retention and diagnose and is absent from this baseline; the doctor metadata
this round implements is described in [contract 02](02-wave13-metadata.md) and claims no diagnose
integration. No real-agent pilot was run, so no end-to-end Astra → Claude behaviour is claimed.
