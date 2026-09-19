---
name: bridge-upgrade
description: "Upgrade this project's Claude Code / Codex bridge: refresh its installed marketplace plugins, prepare a pinned runtime, choose setup or update, and guide safe client restart. Use for bridge upgrades or an old-runtime compatibility refusal; not for upgrading the Codex or Claude binaries themselves."
---

# Bridge upgrade

Use the existing installer; do not implement a second updater. A request to upgrade
this project authorizes the routine preparation and update steps below. Preserve
explicit narrower scope, such as “plan only” or “plugin only”. Do not ask for the
same authorization again. Default to the current worktree, not every checkout.

`<plugin>` means the installed package containing this skill (two levels above
`skills/bridge-upgrade/SKILL.md`). Both bridge packages ship the same installer.
`<workspace>` is the actual Git worktree root, not the plugin cache or main checkout.
Resolve these paths and shell-quote them; replace placeholders in user commands.

## 1. Establish the target and existing state

Read the project's instructions and Git status. Record the current branch, pin,
selection and any local changes. From the worktree root run:

```sh
node "<plugin>/scripts/plugin-packages/bridge-plugin.mjs" status --json
```

This is a read, including in inherited worktrees with no local setup. Its nonzero
exit may report a missing installation rather than a crashed CLI; inspect the JSON.
Use this reader instead of invoking an old project entry with unsupported --status.
Keep the current runtime id and commit for the handoff/rollback. Do not copy a
selection record or database from another worktree.

Inspect installed plugins and their configured marketplace source using the host's
CLI. Refresh only bridge plugins already installed in the relevant clients; a
runtime-provided Claude executor package is not a user marketplace installation.
Do not install the other client's plugin merely because its executable exists.
Keep the configured marketplace branch/tag and installation scope. If it is pinned
to an older tag, report this instead of silently switching the source/channel.

## 2. Refresh distribution, then prepare an immutable runtime

Check `--help` for the installed CLI before using these known command forms:

```sh
codex plugin list --json
codex plugin marketplace upgrade <configured-marketplace>
codex plugin add bridge-codex@<configured-marketplace>

claude plugin list --json
claude plugin marketplace update <configured-marketplace>
claude plugin update bridge-claude@<configured-marketplace> --scope <installed-scope>
```

Use the existing source, not an arbitrary similarly named marketplace. For a local
marketplace there is no remote snapshot to refresh; use its current source and the
host's reinstall/update operation. Do not hand-edit marketplace caches or versions
to force a refresh. Confirm the actual installed version/path after the operation;
if the host kept an old version, say so rather than claiming an upgrade.

A cache refresh may delete the skill's old directory. Before it, save the small
checkpoint and any resources still needed into a private temporary directory outside
the plugin cache. After it, locate the refreshed package from the host's installed
plugin metadata and copy that complete package to the private directory. Use this
stable copy as `<plugin>` for preparation and commands handed to the user. Never
leave a deferred command pointing into a cache that may disappear. Do not claim the
running model has loaded new plugin instructions; restart is a separate step.

Read the refreshed package's `scripts/plugin-packages/release.json`: target is its
full `pinned.commit` and declared repository, unless the user selected a specific
release. Do not equate plugin version with runtime id or select “the last” runtime.
Use `node "<plugin>/scripts/bridge.mjs" runtimes --json` to find an installed runtime
with that exact source commit. Check its manifest; do not rebuild it in place.

If absent, reuse a source clone containing the commit or obtain the release's
repository with `git clone --no-checkout` in a separate temporary directory and
fetch the exact commit if needed. Verify `git rev-parse <commit>^{commit}` equals the
full target SHA, then install alongside the old runtime:

```sh
node "<plugin>/scripts/bridge.mjs" install --source "<source-clone>" --ref "<full-commit>" --json
```

Use the returned runtime id as `<target-id>` and verify its source commit. Preserve
the bridge home selected by CLAUDE_CODEX_BRIDGE_HOME/XDG_DATA_HOME; carry explicit
`--home` into deferred commands when needed. Installing a separate immutable runtime
is allowed while another runs; editing/rebuilding the supervising runtime is not.
A plan-only request stops before marketplace refresh, clone, install or any write.

## 3. Plan the project change and handle active clients

For the portable dispatcher project, use `setup` when the local selection is absent
(including inherited-pristine); use `update` when it is valid. Invalid/copied/partial
state is a diagnostic, not permission to delete it. A known interrupted setup may
be finished by the installer's existing checks; do not invent a repair.

```sh
node "<plugin>/scripts/plugin-packages/bridge-plugin.mjs" setup --to "<target-id>" --json
# Or, for a valid existing selection:
node "<plugin>/scripts/plugin-packages/bridge-plugin.mjs" update --to "<target-id>" --json
```

Plain `setup` preserves the old declared pin: the explicit `--to` is essential.
`update` without install.json refuses SETUP_NOT_INITIALIZED; use the verified setup
path, not a handwritten record. A legacy per-worktree installation uses the matching
`bridge.mjs update --workspace … --runtime …` path; do not silently migrate its layout.

Inspect the diff and named refusals. When the plan is valid and the target worktree
is idle, apply the same command with `--yes`. The requested upgrade covers this;
ask only about a genuine choice outside scope, such as discarding local edits.
Do not use --keep-local to hide a pin/config conflict or change project preferences.

If this client or another process uses the target worktree, finish preparation but
leave its pin and files unchanged. Do not bypass ACTIVE_SESSION/ACTIVE_USE_UNKNOWN,
kill clients, or stop an active worker to make the update pass. Give one copyable
shell command/script using the stable installer, exact workspace/home/target and
normal refusal checks, to run after the affected Codex/Claude clients exit normally.
Chain apply, verification and any restart with success checks; a failed step must
not start the next one. Record the original native session id when available from
trusted session metadata; never guess a session or pick the newest auto-review thread.
Tell the user which client(s) to close and that the command goes in their shell after
`/quit` or the client's normal exit. This skill cannot keep running after its host exits.

## 4. Verify and resume

After apply, run the stable CLI's status and doctor in the target workspace:

```sh
node "<plugin>/scripts/plugin-packages/bridge-plugin.mjs" status --json
node "<plugin>/scripts/bridge.mjs" doctor --workspace "<workspace>" --json
```

Confirm the exact pin/selection/commit, instruction paths and handshake. Distinguish
warnings (e.g. CODEX_VERSION_UNVERIFIED) from errors; do not waive identity, state or
configuration errors. On an error, preserve evidence and report the next concrete
step; do not reset state or automatically roll back a possibly migrated database.
For a requested rollback, use the existing CLI's checked rollback and its schema gates.

Review the changed project files with Git. Commit only the scoped portable files
when commits are authorized; never commit local state or private upgrade checkpoints.
If the goal is inheritance by new branches, the project declaration/entry must be
committed on the user's chosen base branch. Do not switch a live checkout to another
branch or update all worktrees. Existing worktrees need their own explicit update.

Restart affected clients so MCP and plugin discovery reload. Resume the exact existing
manager session when there is one; read the new pinned instructions and pure manager
status before continuing work. Do not start a replacement session to resolve fencing
or claim a round ran from a doctor handshake. If refreshed skills are not discovered
on resume, report that separately; a new manager thread is not an automatic workaround.

Summarize separately: plugin refresh, runtime installed, project pin applied or pending,
verification, and the exact exit/apply/resume action still needed. A prepared update
is not a completed upgrade. No model smoke, push or release is implied by this skill.
