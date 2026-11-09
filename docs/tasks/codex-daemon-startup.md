# Codex daemon startup after bridge upgrade

2026-11-09; branch `docs/codex-daemon-startup`, base `109dc07`.
Scope expanded from documentation to the user-authorized startup, migration and
diagnostic fixes. Work is isolated from the active checkout and installed runtime.
No release, activation or personal client configuration change is part of this patch.

## Observations and cause

Observed on macOS with Codex CLI 0.167.0 and bridge 0.8.0. Names, paths and native
session identifiers are intentionally omitted. Project A is the intended worktree;
project B is another checkout. Raw client logs remain private.

1. The upgrade applied successfully. Pin and local selection matched the exact
   release commit; runtime and instruction integrity checks passed. The standalone
   doctor started an MCP server and discovered 41 tools without claiming a manager.
2. The resumed native conversation had no usable bridge tools. Client startup logs
   showed Node `MODULE_NOT_FOUND` for project B's `.bridge-project/entry.mjs`.
   Read-only process inspection later confirmed the shared Codex daemon's cwd was B.
3. The historical managed configuration used a relative launcher and `cwd = "."` in
   [`mcpDefinition`](../../scripts/setup/workspace.mjs). In this observed client
   context, those paths resolved against the daemon's cwd instead of project A.
   Node failed before the bridge entry or its workspace guards could execute.
   We have not inspected the Codex implementation to identify its internal defect
   or established the first affected version. Do not generalize this observation
   to every Codex daemon or operating system.
4. A temporary `-c mcp_servers.bridge.cwd=...` override was an unsuccessful workaround.
   Two read-only app-server probes with that override returned error -32603,
   `failed to load workspace requirements: invalid data`, from `account/read`.
   A baseline probe without it succeeded. `--print-startup-config` succeeded in
   both cases, so static configuration validation was insufficient. The internal
   cause of the override-related account failure remains unknown.
5. Resuming without the shared daemon then exposed a separate native conversation
   writer lock. Read-only inspection identified the shared daemon as its holder;
   logs reported `already has an active writer`. Exiting the TUI had not released
   that conversation from the daemon. No bridge manager or database existed yet.
6. After the recovery instructions to stop the daemon when its other work was
   finished and resume the exact conversation using `--no-daemon`, live MCP calls
   succeeded. The native conversation identity was unchanged, 41 bridge tools
   were available, `bridge_server_info` returned `caller=codex, delegation=allow`,
   and `bridge_manager_status` reported project A with identity enforcement and
   no recovery needed. No Claude round or model smoke was run.

The initial absent old runtime also caused `PROJECT_FILE_MODIFIED` for an unchanged
committed declaration: the installer recognizes declarations from installed runtime
manifests. Installing the exact historical runtime through the normal installer
resolved this without editing the declaration or using `--keep-local`. This was
separate from the client startup failure.

## Why doctor passed

[`handshake`](../../scripts/setup/doctor.mjs) explicitly starts its child with
`cwd: resolve(root, definition.cwd ?? ".")`. Its result proves that the selected runtime
can serve MCP from the requested worktree. It does not interrogate the connection
owned by an already-running Codex daemon. Likewise, `codex_project` compares the
CLI's reported configuration, formerly including the literal `"."`, rather than observing
the cwd of the live MCP process. The successful standalone check and failed native
connection therefore measure different things.

The managed server is optional (`required = false`), allowing a client to start
when the pinned runtime is not installed. Consequently, an open conversation is
not evidence that bridge discovery succeeded. The final live checks are necessary.

## Implemented fixes

- **Portable startup:** new legacy and dispatcher Codex blocks omit `cwd`. On the
  affected client, an omitted value selects the conversation workspace; explicit
  `"."` selected the server process workspace. Arguments stay relative, without
  machine paths in Git. The normal upgrade migrates exact historical blocks for
  installed runtimes, including inherited dispatcher blocks without local records.
  Arbitrary block changes still conflict. The runtime advertises
  `codex_conversation_cwd` from its own shipped setup code. Explicitly targeting
  an older runtime retains its historical block and reports that the startup fix
  requires a corrected runtime; otherwise its first inherited-worktree mutation
  would reject the new block as a local edit. This also preserves old-target rollback.
- **Doctor:** names historical configuration as `CODEX_RELATIVE_CWD` and directs
  users to a checked upgrade. Reports CLI inspection, standalone handshake and
  `live_client: not-checked` separately. A responding server that reports another
  workspace fails with `HANDSHAKE_WORKSPACE_MISMATCH`.
- **Upgrade output and skill:** distinguish apply/standalone success from live
  verification. Require actual `bridge_server_info` and `bridge_manager_status`
  in the resumed conversation, including exact workspace, caller and delegation
  policy. Recovery explains retained native writer ownership, no replacement
  conversation or lock deletion, and no automatic shared-daemon shutdown.
- **Active-use inspection:** macOS, Linux and the privileged Linux observer detect
  a shared Codex app-server outside the target root with an open native writer
  file. Return `CLIENT_WORKSPACE_UNKNOWN`, not a claim that this worktree is idle.
  This intentionally may block an upgrade when the writer belongs to another
  project: process cwd is not a reliable inventory of the daemon's conversations.
  This uncertainty is distinct from denied process reads and does not trigger a
  pointless privileged-observer retry. Plans that intentionally do not block on
  clients (initial selection) skip this client-only ambiguity, while still checking
  bridge processes, open state and incomplete observations. Ordinary unrelated files and a direct
  `--no-daemon` client are not classified as shared writers.
- **Missing historical runtime:** an exact canonical declaration matching committed
  Git bytes but naming an absent runtime reports `PROJECT_PIN_RUNTIME_MISSING`.
  The plan still refuses; it asks to verify/install that historical commit through
  the normal installer. Edited declarations retain `PROJECT_FILE_MODIFIED`.
- Regenerated both bridge plugin packages from the canonical installer/skill sources.

## Evidence and limits

The model-free native probe used Codex CLI 0.167.0 on macOS, an isolated Codex home,
synthetic MCP entries in **both** projects A and B, and a server process started in B.
A controlled pre-fix probe selected B with explicit `cwd = "."`; omission selected A.
`codex mcp get bridge --json` reports `transport.cwd: null` for the corrected block.
The opt-in repository regression passed with generated configuration for A and its
inherited Git worktree C; all paths contain spaces. It checks the discovered tool,
actual child cwd and absence of a startup marker in B. No login or model turn runs.

Run that additional check with an absolute path to the installed CLI:

```sh
BRIDGE_TEST_CODEX_BINARY=/absolute/path/to/codex npx vitest run scripts/setup/codex-startup.test.ts
```

This checks native `thread/start` and MCP discovery, not TUI interaction, a complete
model workflow or persistence/resume. An attempted empty-thread `thread/resume`
probe returned `no rollout found` before any model turn; it is not counted as
resume evidence. Actual exact-conversation recovery was observed separately in the
original incident (above). Other Codex versions and platforms remain unverified
by this native probe. Unit process snapshots cover Linux/macOS policy only.

## Progress and next step

Implementation and generated packages are complete. Independent read-only review
passed its syntax/parity checks and identified one medium overbroad-refusal case;
that case was narrowed with initial/selected-worktree and observer regression tests.
Also separated manager-status errors from wrong-workspace reports. The review's
version-specific detection and native-resume coverage limits remain explicit.
Final suite results are being recorded before delivery. Validation uses Node 24.14.0 and Python 3.12;
Python 3.11 is not installed on this host. The initial host-default Python 3.15
run hit a SQLite backup compatibility failure; validation uses the available
stable interpreter rather than weakening the backup check.

Next: integrate the reviewed patch and publish/install a separately pinned runtime
through the normal release and upgrade flow. The running 0.8.0 runtime was not
rebuilt, and the main checkout's pre-existing pin edit remains separate.

Official CLI reference for `--no-daemon`:
[Developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli).
