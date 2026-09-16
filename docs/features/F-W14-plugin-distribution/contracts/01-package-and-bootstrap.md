# Contract: plugin packages, marketplace and worktree setup (W14-01…W14-03)

Status: **revision 5 — implemented**. Revision 1 was proposed design; revision 2 described what
W14-02 built, and `reviews/02-implementation.md` returned REWORK with W14-R2-01…05. This revision
records the architecture those findings forced, which is *smaller* than revision 2's: the parallel
setup implementation is gone and the wave12 machinery does the work.

Revision 4 corrected three things revision 3 got wrong: a release pin naming a commit that does not
exist, an inherited worktree still requiring a manual `setup`, and the exchange verifier reporting
an installation-supplied document as missing.

Revision 5 resolves the **boundary between the native guard and the wave12 selection journal**,
which is where W14-R2-06…08 landed. No new framework, lock protocol or facade: three narrow
changes, described in §3b.

Evidence: [`evidence/W14-03/`](../evidence/W14-03/README.md). The superseded W14-02 matrix is
corrected in place at [`evidence/W14-02/`](../evidence/W14-02/README.md). Host facts also come from
[`evidence/W14-01/`](../evidence/W14-01/README.md). Hosts: `codex-cli 0.154.0`, Claude Code
`2.1.273`. Codex packaging documentation re-read at
<https://developers.openai.com/plugins/build/plugins>.

## 0. Disposition of the review findings

| Finding | Revision 2 did | Revisions 3–4 do |
| --- | --- | --- |
| W14-R2-01 | `prepare` wrote a declaration only; a clean project returned `NO_PIN`, the skill told the user to clone a bridge and install a runtime by hand, and no local selection was ever written | The Codex package carries the installer and a pinned release descriptor naming a commit this repository actually has. `setup` with no `--commit` acquires that pin (hash-verified), installs it as an immutable runtime and writes this worktree's own `install.json` and `current`. No clone, no runtime id, no manual step (§2, §4) |
| W14-R2-02 | The generator rewrote a Python string literal, so the shipped exporter failed with `Missing selected file: ${CLAUDE_PLUGIN_ROOT}/workflow/README.md` | Code is never rewritten; the helper resolves the shared guide from the target repository and otherwise from its own installation. Export **and** verify are proven in a foreign repository from both installed paths (§3) |
| W14-R2-03 | A parallel `bootstrap.mjs` checked only the copied record path; a diverged pin and a foreign record still launched; an existing custom `mcp_servers.bridge` was preserved *and* a second table appended | The parallel implementation is deleted. Writes go through wave12 `planChange`/`applyPlan`; the launch gate validates the declaration, manifest, pinned commit, resolved identity, record and selection before the server is imported (§5, §6) |
| W14-R2-04 | The dispatcher spawned the runtime as a child, which survived SIGTERM to the dispatcher | There is no child. The entry point imports the launcher in its own process (§6) |
| W14-R2-05 | The matrix claimed AC-02/03/05/06/07 from recorder fixtures, and a test mutated the canonical skill tree | Every claim is re-derived against a real installed runtime; generator drift is proven on a temporary git worktree, so no repository file is mutated by a test |
| W14-R1-01…04 | see revision 2 | Carried forward and now actually enforced by the wave12 guards rather than by a parallel implementation |
| W14-R2-06 | two first uses of the *same* worktree both refused `ACTIVE_SESSION` naming the other's open database; neither ever took the selection | `insideGuardedMutation` removes the process scan's veto for a caller already inside the guard's critical section (§3b) |
| W14-R2-07 | an interrupted automatic preparation refused `SETUP_STATE_PARTIAL` forever and needed a manual `setup` | the journal records its worktree and runtime; a provably own interrupted apply serves and resumes at the next authorised mutation (§3b) |
| W14-R2-08 | `setup` without `--yes` installed the runtime while reporting `applied=false` | acquisition and build happen only under `--yes`; the plan is honest about what it cannot compute yet (§3b) |

## 1. Host constraints this design obeys

- **C1.** A Codex *plugin* MCP server starts with `cwd` inside the version-pinned plugin cache and
  a stripped environment; the handshake carries no project root and no `roots` capability. A
  plugin-declared MCP server cannot infer its workspace.
- **C2.** `claude -p --plugin-dir <dir|zip>` loads a plugin for one session with no profile and no
  project install, and gives its MCP subprocess the project `cwd` and `CLAUDE_PROJECT_DIR`.
- **C3.** Installing a new Codex plugin version **deletes** the previous version's cache directory.
  The plugin cache is not a durable home for a pin.
- **C4.** A **project-scoped** `[mcp_servers.*]` entry resolves relative `command`, `args` and `cwd`
  against Codex's own process directory. This is the only mechanism that binds a server to a
  worktree.
- **C5.** Codex reads a project `.codex/config.toml` **only for a trusted project** and **only when
  the client starts at the project root**. Both are host decisions; neither is bypassed.
- **C6.** The environment is stripped for a project-scoped MCP server too, so a variable the server
  needs must be named in `env_vars`.
- **C7 (W14-03).** `new URL(...).pathname` percent-encodes, so it cannot resolve a project
  directory containing a space. The entry point and the launch gate use `fileURLToPath`.

## 2. One source, two generated packages, two in-repo marketplaces

`scripts/plugin-packages/generate.mjs` is the only writer of the packages. It reads the single
canonical instruction set — `.agents/skills/`, the two role `using-bridge` skills and
`docs/features/README.md` — and writes:

```text
plugins/bridge-codex/    thin entry skill + the installer + the pinned release descriptor
plugins/bridge-claude/   the whole feature workflow and the bridge role skill
.agents/plugins/marketplace.json    Codex marketplace; the repository root is the root
.claude-plugin/marketplace.json     Claude Code marketplace, same root
```

**Source equivalence is enforced.** `--check` (`npm run packages:check`) regenerates into a
temporary directory and compares the whole tree plus a digest of the canonical sources. A test
proves the failure mode by editing a canonical skill **in a throwaway git worktree**.

**Only instruction text is rewritten.** `.md`, `.yaml` and `.yml` have checkout-relative references
turned into `${CLAUDE_PLUGIN_ROOT}/...`; code is copied byte for byte. Rewriting a code literal is
what broke the exporter in revision 2.

**Nothing is installed by a marketplace.** Neither package contains a `package.json`, a lockfile or
`node_modules`. Dependencies are installed by the wave12 installer, into the immutable runtime.

**Reproducible acquisition without npm publish.** `scripts/plugin-packages/release.json` is a
*source* file — the generator copies it verbatim, so the pin does not move when the repository
does. It names a full commit **that this repository actually contains** (a test runs
`git cat-file -e` on it; revision 3 shipped a hash that was never a commit) and a repository. `acquireSource()` resolves that commit from, in
order: an explicit `--source`, `CLAUDE_CODEX_BRIDGE_SOURCE`, a cache under `<home>/sources/`, then
a `git fetch` of exactly that commit. Every path verifies the resolved hash before anything is
built, so no unpinned `HEAD` is ever installed, and the first three need no network.

## 3. Instructions live in the installed runtime only

The Codex package contains one skill, `bridge`, and no workflow. It tells the manager to run
`bridge-plugin.mjs status` and follow the absolute paths the report gives —
`instructions.codex_role_skill`, `instructions.workflow_skills`, `instructions.exchange_helper`,
`instructions.claude_executor_package` — all inside the runtime this worktree selected.

Consequences:

- there is never a newer instruction copy than the runtime being driven, because there is only one
  copy and it is inside that runtime;
- nothing generic is written into a target repository: a prepared worktree gets the declaration,
  a 54-line entry point, the managed MCP block, the ignore block and its own local selection;
- the exchange helper works from an installation. It selects the target repository's own
  `docs/features/README.md` when that repository has one and otherwise the copy shipped beside it,
  recorded in the manifest as `source: installed`. Archive naming and the safe path rules are
  unchanged. **Verification honours that provenance**: a document recorded as `installed` is
  reported under `documents.supplied_by_installation` rather than as missing, while a document taken
  from the target must still be present and still match — real drift and a real deletion are still
  reported. Both the runtime helper and the generated Claude package helper are proven to export
  **and** verify in a foreign repository, and the report semantics are asserted, not just the exit
  code;
- the delegated executor is given `--plugin-dir <runtime>/plugins/bridge-claude` by the runtime
  itself (**C2**), so it reads the pinned set with no user installation, and **C3** cannot take it
  away mid-round.

## 3b. The guard and the selection journal (W14-R2-06…08)

**The native identity guard is the authoritative critical section.** Two entry processes in one
pristine worktree both complete the handshake, so both hold that worktree's database open. The
setup plan's process scan then saw the *other* bridge process as `state-open` and refused both with
`ACTIVE_SESSION`, so neither could ever take the selection. `planChange` gains one option,
`insideGuardedMutation`, used only by the materialiser: it drops the `bridge-mcp`/`state-open` veto
for a caller that is already inside the guard's critical section, because exactly one caller is
there and a second is refused as a foreign manager. Every other refusal is untouched, and ordinary
`init`, `update` and `rollback` from the CLI keep the full scan — including the `ACTIVE_SESSION`
refusal while a server is serving.

**An interrupted automatic preparation resumes itself.** The journal now records the worktree and
the runtime it belongs to, so a resume can prove ownership. The launch gate serves a worktree whose
partial state is *provably its own* interrupted apply and completes it at the next authorised
mutation through the existing resumable journal. A journal naming another worktree, an unreadable
one, one for a different runtime, or one written before the journal recorded its workspace stays
`SETUP_STATE_PARTIAL` with nothing written. No manual setup, no extra restart, no adoption.

**A plan writes nothing.** Acquiring a source and building a runtime are writes under the bridge
home; they now happen only under `--yes`. Without it, a worktree whose pinned runtime is not
installed gets an honest plan naming the commit that would be installed and no invented file diff;
when the runtime *is* installed the full reviewable per-file plan is produced as before.

## 3a. An inherited worktree serves as it is (AC-03)

Revision 3 required a `setup` call in every worktree, because the launch gate refused a worktree
with no local record. That is the manual per-worktree step AC-03 forbids, and it was the third time
the same requirement came back, so the design stepped back instead of being patched again.

A worktree inherited from an enabled project is **pristine** by construction: it has the committed
declaration and entry point and none of its own local state, because local state is never
inherited. The gate now lets such a worktree serve, and registers what its first mutating call must
write. The server runs that **once, inside the guarded mutation, after the identity guard has
authorised the caller** — the existing mutation boundary in `runTool`, not a new one. Therefore:

- the handshake, `tools/list` and every class-R read leave the worktree byte-identical;
- a call the native guard refuses (no or malformed native context, a foreign session) writes
  nothing at all;
- the first authorised mutation materialises the worktree's own `install.json`, `current` and
  database through the ordinary wave12 `init` plan — same lock, journal, ownership hashes, symlink
  and copied-record refusals, and active-use check. A refusal there fails that call and leaves the
  worktree untouched;
- **partial** local state is still refused: a `.bridge-runtime/` or `.bridge/` without a usable
  record is `SETUP_STATE_PARTIAL`, and divergent, invalid, disabled and foreign cases are unchanged.

Known limit: `bridge_manager_resume_instance` and `bridge_manager_takeover` drive the guard
themselves and deliberately do not trigger materialisation. They manage identity rather than domain
state; a pristine worktree whose very first call is one of those stays pristine.

## 4. Setting a project up

`setup` is the only writing command and does the whole job:

1. choose the runtime: what the project already declares, else the distribution's release pin. A
   caller never supplies a runtime id;
2. install it if this machine does not have it — immutable, idempotent, beside any others;
3. write the worktree through wave12 `planChange({ profile: "dispatcher" })` and `applyPlan`.

The dispatcher profile writes `.bridge-project/bridge.json` (the portable pin),
`.bridge-project/entry.mjs`, the managed `[mcp_servers.bridge]` block naming
`./.bridge-project/entry.mjs` with `required = false` and
`env_vars = ["CLAUDE_CODEX_BRIDGE_HOME", "XDG_DATA_HOME"]` (**C6**), the ignore block, and the
worktree's own `.bridge-runtime/install.json` and `current`.

A worktree created later from an enabled project inherits the declaration, the entry point and the
managed block through Git, and needs **no** bridge command of its own: see §3a. Its local state is
still never inherited — it is created by that worktree's own first authorised mutation. Enabling a
project the first time costs one host trust decision and one client restart (**C5**); that is stated
in the skill and the documentation rather than engineered away.

## 5. Every write goes through the wave12 guards

`planChange` already owns what review W14-R2-03 asked for, and the dispatcher profile reuses it
rather than re-implementing it:

- a managed destination that is, or passes through, a symlink is refused before anything is planned;
- a `.bridge-runtime/install.json` naming another worktree is `SETUP_RECORD_FOREIGN` and is never
  adopted or rewritten;
- a managed file whose bytes match neither the recorded hash nor any installed runtime's content is
  `PROJECT_FILE_MODIFIED`; `--keep-local` keeps it instead;
- an `mcp_servers.bridge` defined outside the managed block, a locally edited managed block, or any
  key that would change the effective table, is a conflict — which is why a second table can no
  longer appear;
- `findActiveUse` refuses while the worktree has a live bridge server, an open database or a client;
- the apply is journalled: an interrupted run leaves `pending.json` and the next run completes it.

`init` is used when the worktree has no selection and `update`/`rollback` when it has, so the
active-session refusal and the "already initialised" refusal apply exactly as in wave12.

## 6. Launching

The committed entry point resolves the bridge home and the pin, then imports
`<runtime>/scripts/bridge-project/dispatch.mjs` and calls `launch()`. That gate refuses, **before**
the server is imported and with nothing written, when: the working directory is not a worktree, the
declaration is unrecognised or disabled, the runtime is missing or incomplete, the pinned commit
does not match the runtime answering to the pinned id, identity cannot be resolved, the record is
foreign, invalid or absent, the applied selection differs from the declared pin, or the selection
symlink does not point at it.

When it passes, the launcher runs **in the same process**: `process.argv` is rewritten with an
absolute `--workspace`, the working directory becomes the worktree, and the runtime's own module is
imported. There is no wrapper child, so the client's SIGTERM reaches the real server and its
existing close and detach behaviour is unchanged. The native identity guard inside the runtime
remains the authority; the gate adds no second opinion.

The unguarded setup facade of revision 2 is removed. A machine without the pinned runtime gets a
named refusal on stderr pointing at the setup skill, and the skill — which is always available from
the plugin — installs it.

## 7. Versions, migration and removal

The committed declaration is the authoritative pin; `.bridge-runtime/install.json` records what the
worktree actually applied. `update --to` and `rollback` move both together through the wave12
actions, so both refuse while the worktree is in use. Delivering a new plugin version never moves a
pin: `setup` prefers the project's declared pin over the distribution's release pin.

A wave12 worktree keeps working unchanged; `doctor --json` reports `integration_source` as
`project-config` for it and `project-dispatcher` for a migrated one, and the wave12 CLI remains the
supported fallback. Migrating is running `setup` in it. Removing the plugin removes only the
distribution channel: installed runtimes, databases, packages, evidence and the user's own files
stay.

## 8. Out of scope

Wave13 owns logging, retention and diagnose and is deferred by `decisions/02.md`; the doctor
metadata this round implements is described in [contract 02](02-wave13-metadata.md) and claims no
diagnose integration. No model ran, so no end-to-end Astra → Claude behaviour is claimed, and the
interactive Codex TUI is untested.
