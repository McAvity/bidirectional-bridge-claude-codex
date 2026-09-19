# Contract: manager identity and worktree isolation (W7-ID-01)

Policy amendment, 2026-09-19: the user authorized replacing the strict version
allowlist in §5.3/A-01 with a warning. Well-formed unverified versions may use the
same validated metadata adapter; missing/malformed/inconsistent metadata, subagents,
foreign threads and fenced instances remain refused. The current behaviour is described
in [manager identity](../../../manager-identity.md). Historical revision6 and its
verification evidence below are preserved; unverified hosts are not labelled verified.

Status: **proposed** for coordinator contract review, revision 6. No product code is implemented
by this round. Code facts were inspected at `e5cc93a43c2c9c2d127725048a65faa2050b1696`; this
revision is written on `d94c2dee56464863f42cae1cfd192e02f8108034`.

Revision 6 corrects R06-01…R06-03 of `reviews/06-protocol-completeness.md` inside
`decisions/06.md`: the instance history index no longer forbids a permitted explicit
reactivation, the bootstrap state machine classifies interrupted temp files and partial
publication by evidence and dispatches marker repair through an identity-checked branch that
bound calls do not confuse with a fresh reservation, and the lock database has a concrete
initialization order with an honestly stated filesystem precondition. Historical ledgers,
reviews, decisions and packages are untouched.

Inputs (SHA-256):

| File | SHA-256 |
| --- | --- |
| `docs/features/F-W7-manager-isolation/brief.md` | `64c12e87764e3712c0e7a658b93e5c3558bb254986ca158cb20a8f5d91539e6e` |
| `docs/features/F-W7-manager-isolation/decisions/06.md` | `0c4fce5ef9902e62e720dd4e87e3221092da3c20862f439adf506db25916f4ff` |
| `docs/features/F-W7-manager-isolation/evidence/03-native-manager-identity.md` | `1f4baeaba51a8fc757df2817cf67dee58710f5d8c9b6abdbbc63ddcc82fccc69` |
| `docs/features/F-W7-manager-isolation/evidence/04-call-time-binding.md` | `a28517e225d5bd19381f0d0eccff5bd7a442f6e2c10a72cf73d430ecf26d1d77` |
| `docs/features/F-W7-manager-isolation/reviews/06-protocol-completeness.md` | recorded in ledger 06 |

## 1. Verified starting state

### 1.1 Bridge code (base `e5cc93a`)

- `scripts/native-bridge-mcp.mjs:30-86,100` binds `--caller`, `--delegation`, `--workspace`,
  `--db`; the workspace is not canonicalised and nothing ties `--db` to a worktree.
- `shared/mcp-server-core/src/server.ts:102-108` registers tools with
  `async (args) => runTool(tool, args ?? {}, this.ctx)`, **discarding the per-request context**.
  The installed SDK (`@modelcontextprotocol/sdk` **1.30.0**) types tool callbacks with
  `RequestHandlerExtra` (`dist/esm/server/mcp.d.ts:261`) carrying `_meta?: RequestMeta`
  (`dist/esm/shared/protocol.d.ts:173-189`).
- `shared/control-plane/src/store/sqlite-store.ts:226-246`: the **constructor** creates parent
  directories, creates/opens the file, sets `busy_timeout`, runs `PRAGMA journal_mode`, DDL,
  `migrateSchema()` and a `schema_meta` upsert (`240-245`) — every open is a durable write today.
  `transaction()` (`310-337`) is `BEGIN IMMEDIATE` with `busy_timeout = 5000` (`74,237`).
- `control-plane.ts:74-88,134-147`, `lifecycle.ts:52-65`, `lease-manager.ts:236-258` — boot
  recovery reaps leases and writes `lease.expired` events, while liveness is the wall-clock
  `isLive` (`lease-manager.ts:53-54`) used by `findConflicts`/`acquire`/`renew`/`release`/
  `listLive`, so reaping is bookkeeping only.
- `feature-workflow.ts:25-30,32-40,43-69` — `owned()` compares the role string; `get()` writes a
  row and a `FEATURE_UPDATED` event.
- Recovery authorisation (`orchestrator.ts:994-1085`) derives from durable role ownership and
  lineage and is **unchanged** by this contract.

### 1.2 Codex host, verified locally (read-only, `rust-v0.154.0` / `6b9826e3`)

| Fact | Location |
| --- | --- |
| `MCP_TOOL_THREAD_ID_META_KEY = "threadId"` | `core/src/mcp_tool_call.rs:1184` |
| Host inserts `threadId` from `sess.thread_id`; creates the map when absent; **returns a non-object `_meta` unchanged** | `core/src/mcp_tool_call.rs:1328-1349`, call site `506-529` |
| Turn metadata object added under `x-codex-turn-metadata` | `core/src/mcp_tool_call.rs:1245-1262` |
| `session_id`/`thread_id` plus optional `parent_thread_id`, `subagent_kind`, `thread_source`, `forked_from_thread_id`, each `skip_serializing_if = "Option::is_none"` | `core/src/responses_metadata.rs:376-406,528-542` |
| `subagent_metadata_kind` is `Some` **only** for `SessionSource::SubAgent` | `core/src/responses_metadata.rs:445-455` |
| MCP metadata strips `agent_name`/`parent_turn_id`/`root_turn_id`, keeps identity fields | `core/src/turn_metadata.rs:234-248` |
| Guardian review config sets `mcp_servers` to an empty map (hard error if it fails); used by production review; asserted by an upstream test (read, not executed) | `core/src/guardian/reviewer_config.rs:67-73,89-110`, `guardian/review.rs:879-885`, `guardian/tests.rs:3902-3941` |
| Resume keeps the thread id; new/forked threads get new ids; a family may share `session_id` | `core/src/session/session.rs:761-797` |

Verified on exactly `rust-v0.154.0`, which is why §5.3 accepts only that version.

### 1.3 Read-only SQLite behaviour — contract experiment

Node **v24.15.0**, `node:sqlite`: a writer created a WAL database and closed cleanly (directory
held only `probe.db`); `new DatabaseSync(path, {readOnly:true})` plus one `SELECT` then created
`probe.db-wal` and `probe.db-shm`, with the main file's SHA-256 unchanged. Reads therefore
guarantee durable-state immutability, not filesystem immutability (§6.4). `immutable=1` is not
used, because it ignores a live WAL and would serve stale data.

### 1.4 Lock database semantics — contract experiment (basis for §4.4 step 2)

Node **v24.15.0**, `node:sqlite`, scratch directory. Observed, step by step:

| Step | Observation |
| --- | --- |
| `new DatabaseSync(path)` on a missing file, **no DDL** | `state.lockdb` exists and is **0 bytes** |
| `PRAGMA busy_timeout = 500`, then `BEGIN IMMEDIATE` with **no schema and no write** | Succeeds — a write lock needs no table. `state.lockdb-journal` appears while the transaction is open; the main file stays 0 bytes |
| Second process attempting `BEGIN IMMEDIATE` while the holder lives | Fails with `ERR_SQLITE_ERROR` (`SQLITE_BUSY`) after the timeout |
| Holder `kill -9`, then a new contender | **Acquires immediately**, with no cleanup step, because the write lock is a kernel-held POSIX advisory lock released on process death |
| After that contender's clean `ROLLBACK` | The journal is removed; the directory holds only the 0-byte `state.lockdb` |

So L needs **no schema**, and the transient `-journal` belongs to an open transaction rather than
being a permanent residue; revision 5's phrasing about a hot journal necessarily being left behind
is corrected accordingly. These are isolated contract experiments, not product tests.

### 1.5 Instance-history schema — contract experiment (basis for §7.1 and §12)

With `PRIMARY KEY (epoch, instance_generation)` and a **non-unique** index on
`(epoch, instance_id)`, inserting `(1,1,I1)`, `(1,2,I2)`, `(1,3,I1)` all succeed and every
activation row is preserved; the eligibility query
`SELECT NOT EXISTS(SELECT 1 FROM manager_instances WHERE epoch=? AND instance_id=?)` returned
`0` for `I1` (already seen in this epoch, so not eligible for automatic adoption) and `1` for a
fresh `I3`. Revision 5's `UNIQUE(epoch, instance_id)` index made the third insert fail, which
would have made the explicitly permitted reactivation impossible (R06-01).

## 2. Identity model (AC-01)

| Link | Identity | Storage |
| --- | --- | --- |
| Project | canonical `git-common-dir` (`project_key`) | `workspace_binding.git_common_dir` |
| Worktree | `workspace_id` (`ws_…`) = canonical root + per-worktree git dir | `workspace_binding` (C), marker (A) |
| Database | owning `workspace_id` + root | owner file (B) and C |
| Feature | `feature_id` + `workspace_id` | `features` payload |
| Manager | native Codex **thread id** + `epoch` | `manager_bindings`, `manager_binding` |
| Manager connection | **active instance id** + `instance_generation` | `manager_binding`, `manager_instances` |
| Task / round | `task_id` + binding epoch | `tasks`, `features.round_launches` |
| Attempt / worker session | `(task_id, attempt)` / `execution_handle` | `task_<historical-11>` |

Branch is never identity. **Role stays separate from manager identity**: `--caller` keeps every
existing meaning (adapter selection, `task.owner`, lease holder, lineage and recovery
authorisation, `who()` validation) and `FeatureWorkflow.create` still requires role `codex`.

## 3. Workspace identity and database selection (AC-04)

```ts
export interface WorkspaceIdentity {
  readonly kind: "git" | "directory";
  readonly root: string; readonly git_dir: string | null;
  readonly git_common_dir: string | null; readonly project_key: string;
}
export function resolveWorkspaceIdentity(workspace: string, o?: {git?: string; env?: NodeJS.ProcessEnv}): WorkspaceIdentity;
export function resolveDatabasePath(identity: WorkspaceIdentity, raw?: string): string;
```

Identity: `realpath(resolve(workspace))`, then `git -C <abs> rev-parse --path-format=absolute
--is-inside-work-tree --show-toplevel --git-dir --git-common-dir` (5 s timeout) with `GIT_DIR`,
`GIT_WORK_TREE`, `GIT_COMMON_DIR`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY` stripped; git absent
or not a repository → kind `directory`; `is-inside-work-tree` must be `true`; the resolved toplevel
must equal the canonicalised workspace (`not_worktree_root`). `--path-format=absolute` needs
git ≥ 2.31 with a documented fallback.

Explicit external `--db` is supported (default `<root>/.bridge/bridge.db`).
`resolveDatabasePath` canonicalises **without creating anything**, so a fresh default path
resolves during a read without creating `.bridge/`.

**Exclusivity is decided by recorded identity, never by path equality.** Two worktrees symlinking
`.bridge` to one directory make both path comparisons true, so path equality would admit shared
state. Marker A, owner file B and binding row C each record `workspace_id` + root, and the question
is always "does this state claim *this* worktree?". Invariants: one database per worktree (A, C),
one worktree per database (B, C).

## 4. Worktree state: records, dispatch, critical section

### 4.1 Records and their file forms

| Record | Location | Content | Purpose |
| --- | --- | --- | --- |
| **A. Marker** | `<root>/.bridge/workspace.json` | `workspace_id`, root, git dirs, `database`, `state: reserving\|bound`, `reservation_nonce` | one database per worktree |
| **B. Database owner** | `<database>.owner` | `workspace_id`, root, `reservation_nonce`, `state` | one worktree per database, external paths included |
| **C. Binding row** | `workspace_binding` in the database | identity, `database_path`, `reservation_nonce` | authoritative |
| **L. Lock database** | `<root>/.bridge/state.lockdb` | **no schema** (§1.4) | death-safe critical section; never ownership |

A and B are published atomically: write `<final-name>.<nonce>.tmp`, then `linkSync` to the final
name. `EEXIST` on the link is a lost race and is re-read, never overwritten. **C is
authoritative**: whenever A or B disagrees with C, C decides. L is infrastructure only.

**Interrupted temp files are classified by evidence, never by a wildcard (R06-02).** A file named
`workspace.json.<nonce>.tmp` or `<database-basename>.owner.<nonce>.tmp` counts as an *interrupted
protocol temp of this worktree* only when its content parses as a well-formed marker/owner record
whose `root` and `git_dir` equal this worktree's, whose `state` is `reserving`, and whose nonce is
the one embedded in its own name. Matching the name pattern alone is **not** evidence. A temp file
that is unparsable, names another worktree, or contradicts its own name is **unexplained state**
and fails closed exactly like an unknown file. An interrupted temp of this worktree never grants
anything: it is inert, it does not block a new attempt, and it may be removed **only** under the
critical section, only when its nonce matches neither the published A nor B, and only when no
binding row references that nonce. Nothing else is ever deleted.

### 4.2 Phase 1 — process start: identity only, no writes

Startup resolves identity and the database path and stops: no directory creation, no marker, no
owner file, no lock database, no write-open, no DDL, no migration, no `schema_meta`, no journal
pragma, no boot recovery. `serve()` may log a pure `inspectRecovery()` report only if a readable
database already exists. Identity failures exit non-zero before touching anything.

### 4.3 Phase 2 — reads report, never repair

Reads use `openReadOnly` (§6.2). A missing database yields an unbound report and creates nothing.
Reads never create `.bridge/`, never open or create L, never publish or complete A/B, never
migrate, reconcile or reap. Incomplete state is **reported**: `bridge_manager_status` exposes
`marker_state`, `marker_incomplete`, `reservation_nonce_matches_binding`, `recovery_needed` and
`recoverable`, so an operator sees a crash-interrupted bootstrap without any write during a read.
SQLite may still create technical sidecars (§1.3, §6.4).

### 4.4 Phase 3 — dispatch of the authorized path (R06-02)

The precheck (read-only, no writes, no `mkdir`) computes three facts: whether a binding row **C**
exists and matches this worktree, whether the schema is current, and
`recovery_needed = C exists ∧ (A or B missing, unparsable-for-this-worktree, or still
`reserving`)`. They select exactly one mode; there is no ambiguity and no fresh nonce is ever
minted while C exists:

| Mode | Condition | Sequence |
| --- | --- | --- |
| **1 — unbound bootstrap** | no C for this worktree | full sequence below, **including reservation publication** |
| **2 — bound operation** | C exists and matches | **skips reservation publication entirely**; takeover (T), handoff (H), migration and ordinary M reuse C's identity and `reservation_nonce`; L is entered only for T, H, migration or marker repair |
| **3 — marker-only repair** | C exists and `recovery_needed` | a sub-step of an authorized Mode-2 call, executed **after** identity/instance validation and before the operation |

**Mode 1 sequence**

0. **Preflight**, read-only, no writes and no `mkdir`: read A and B if present, probe C read-only
   if the database exists, classify per §4.1 and §4.5. Refusals here create nothing.
1. **`mkdirSync(<root>/.bridge, { recursive: true })`** — the first durable write, authorized path
   only, because `link` cannot create a missing parent. An empty `.bridge/` left by a later failure
   holds no state and is harmless.
2. **Acquire the critical section**, in exactly this order (§1.4): `new DatabaseSync(L)` — which
   creates a **0-byte** file if absent — then the connection-local `PRAGMA busy_timeout = 5000`,
   then `BEGIN IMMEDIATE`. **No DDL is executed on L**, because a write lock needs no schema. If
   acquisition fails (`SQLITE_BUSY` or a lock I/O error) the call fails closed with `STATE_LOCKED`.
   What may then exist is exactly: `<root>/.bridge/`, a 0-byte `state.lockdb`, and possibly a
   transient `state.lockdb-journal` belonging to some holder's open transaction — **coordination
   infrastructure only**, never a marker, owner file, database, binding, domain row or ownership.
3. **Re-classify under the lock**, with the self-artefact exemption: `.bridge/` itself, L and its
   sidecars, and this operation's own nonce-tagged temp files are known infrastructure; entries
   explained by the requested database and a matching marker are known; interrupted protocol temps
   are classified per §4.1; **anything else** — another `*.db`, another `*.owner`, an unparsable
   marker, a temp naming another worktree — is unexplained and fails closed.
4. **Publish the reservation**: write and link A and B with one fresh `reservation_nonce`,
   `state: "reserving"`.
5. **Open and mutate** through §6.3: one main-database `BEGIN IMMEDIATE` that re-verifies the
   nonce in A/B and the manager authority, performs any DDL/migration/`schema_meta` write, the
   operation and its events.
6. **Publish completion**: rewrite A and B to `state: "bound"` (tmp + `rename`), then release the
   critical section.

**Mode 2/3 sequence**: precheck → **authority validation against C's manager binding** (thread,
epoch, generation, active instance — §7) → if refused, stop with **no** durable write and no
marker repair → else, when L is required (T, H, migration or `recovery_needed`), acquire it as in
step 2 → perform Mode-3 marker repair if needed, rewriting A and B from **C's** identity and
`reservation_nonce` → perform the operation under §6.3 → release L. Ordinary Class M on a bound,
current-schema worktree with `recovery_needed = false` uses no critical section at all: it is a
single main-database transaction.

Marker repair never touches `manager_bindings`, `manager_binding`, `manager_instances` or any
domain row; it cannot create `epoch 1` or a history row, and it is never performed for a caller
that failed authority validation.

### 4.5 Crash, partial publication and recovery traces

Decided **under the critical section**, by evidence, never by liveness guessing. Repairs happen
only during an authorized ownership mutation; startup and reads only report (§4.3).

| Trace | Deterministic outcome |
| --- | --- |
| `.bridge/` missing, fresh worktree | Mode 1: `mkdir`, lock, classify (nothing to explain), publish, commit, complete. |
| Death **before** writing any temp | Nothing exists beyond possibly `.bridge/` and a 0-byte L. Next call proceeds as a normal Mode 1. |
| Death **after the temp write, before either link** | The leftover is classified per §4.1: well-formed, this worktree, `reserving`, self-consistent nonce ⇒ *interrupted protocol temp*, explained state. It blocks nothing; the next Mode 1 attempt proceeds with its own nonce and may remove the leftover under L once it matches neither published record and no binding references it. A malformed or foreign temp instead fails closed. |
| Death **after one link** (A without B, or B without A) | Repaired under L from the authoritative record: with C present and matching, the missing file is rebuilt from C's nonce; with no C, the pair is superseded with a fresh nonce after the read-only probe confirms no binding row. B naming another worktree ⇒ `database_owned_elsewhere`. |
| Death **after the main-database commit, before the rename** | A/B `reserving` **and** C exists — recoverable, never a deadlock. `recovery_needed` is true; the next authorized Mode-2 caller (ordinary M, H or T) repairs the markers under L **after** authority validation. Startup and reads only report it. |
| **Ordinary M on incomplete markers** by the owning thread and active instance | Authorized: Mode 2 with Mode-3 repair, then the operation. |
| **Foreign M** (wrong thread) or a fenced instance, on incomplete markers | Refused (`MANAGER_FOREIGN_THREAD` / `MANAGER_INSTANCE_FENCED`) with **no** marker repair and no durable write; the incomplete markers are left exactly as they were. |
| **Explicit H or T** on incomplete markers | Same ordering: CAS/authority first (§7), then repair under L, then the binding change. A failed CAS repairs nothing. |
| **Failed first operation** (Mode 1) | The main-database transaction rolls back, so no C and no ownership exist; the same process then releases **its own** nonce-identified reservation before releasing L. A process that dies instead leaves the row above. |
| Two contenders, one worktree, two different `--db` | L admits one; the loser is refused `second_database` before any database is opened. |
| Two worktrees, one database (including a shared or symlinked `.bridge`) | B and C identity refuse the second worktree. |
| A absent, C present and matching | A and B are rebuilt from C with the **same** `workspace_id` and nonce; a new id is never minted while C exists. |
| A absent, database absent, unexplained entries present | `unresolved_workspace_state`: nothing chosen, scanned for bindings, or deleted. |
| A or B unparsable, or naming another worktree | Fail closed; never repaired automatically; C is never modified. |
| Acquisition of L fails | `STATE_LOCKED`; only the infrastructure listed in step 2 may exist. |

### 4.6 Copied, shared, moved state and archiving

Reason codes: `copied_state`, `database_bound_elsewhere`, `database_owned_elsewhere`,
`second_database`, `unresolved_workspace_state`, `state_locked`, `moved_worktree`,
`unbound_legacy_state`. All fail fast with `code: message + remedy` on stderr, non-zero exit and
pure JSON-RPC stdout.

Moved worktree: deleting `workspace.json` is **ineffective** (C still names the old root) and is
documented as such. Primary remedy: `git worktree move <current> <recorded-root>` back.
Alternative: rename (never delete) `.bridge` → `.bridge.moved-<ISO>` **outside the repository** —
required because `.bridge.moved-*` is not matched by the existing `.bridge/` ignore rule — and
start fresh. **External `--db` archiving limitation**: such a database does not live under
`.bridge` and does not travel with the archive, so a fresh start needs a new `--db` while the
previous external database and its `.owner` stay intact. No rebind command, installer or `doctor`
is added.

## 5. The native call envelope (AC-03)

### 5.1 Captured context

Read once per call from `RequestHandlerExtra._meta` and carried explicitly; there is no global
"last request" value, and arguments are never a source or fallback.

```ts
export interface NativeCallContext {
  readonly thread_id: string;      // _meta.threadId
  readonly session_id: string;     // x-codex-turn-metadata.session_id  (required)
  readonly meta_thread_id: string; // x-codex-turn-metadata.thread_id   (required)
  readonly codex_version: string;  // required, must equal a verified version
  readonly adapter_id: string;     // "codex-0.154.0"
  readonly thread_source: string | null;
  readonly forked_from_thread_id: string | null;
}
```

### 5.2 Classification

| Input | Verdict | Reason |
| --- | --- | --- |
| `_meta` absent or not an object | reject | `native_context_missing` |
| `_meta.threadId` absent (including the host's non-object passthrough) | reject | `native_context_missing` |
| `threadId` not a non-empty string ≤ 128 chars of `[A-Za-z0-9._:-]` | reject | `native_context_malformed` |
| `x-codex-turn-metadata` absent | reject | `native_context_incomplete` |
| present but not an object, or `session_id`/`thread_id` missing | reject | `native_context_malformed` / `native_context_incomplete` |
| `thread_id !== _meta.threadId` or `session_id !== thread_id` | reject | `native_context_inconsistent` |
| `subagent_kind` or `parent_thread_id` present | reject | `native_subagent_rejected` |
| `codex_version` missing or not a verified version (§5.3) | reject | `native_adapter_unsupported` |
| `thread_source` present or absent | accepted either way, recorded | — |
| all checks pass | `root` | — |

`native_corroboration` is always `turn-metadata` for accepted ownership; there is no `none` value
and no fallback. `thread_source` stays optional because a legitimate root was observed without it.
No interactive-CLI requirement is invented (§9.4).

### 5.3 Verified adapter — exactly 0.154.0

The envelope **and** guardian behaviour were verified on exactly `rust-v0.154.0` (§1.2). The
allowlist therefore contains exactly one entry, `adapter_id = "codex-0.154.0"`, matching
`codex_version == "0.154.0"`. Any other version, including an unknown patch such as `0.154.1`, is
`native_adapter_unsupported` until verified and added explicitly. Class R needs no adapter.

## 6. Operation classes, database opening and serialization

### 6.1 Classes

| Class | Tools | Durable writes | Envelope |
| --- | --- | --- | --- |
| **R — read-only** | `bridge_server_info`, `bridge_manager_status`, `bridge_list_tasks`, `bridge_get_task`, `bridge_get_execution_handle`, `bridge_query_telemetry`, `bridge_snapshot`, `bridge_read_events`, `bridge_read_artifact`, `bridge_check_scope`, `bridge_feature_get`, `bridge_recover` | none | not required |
| **O — ownership-establishing** | the first Class M call in an unbound worktree | §4.4 Mode 1 | required, `root` |
| **M — guarded mutation** | feature tools, `bridge_delegate`, both resume tools, task/lease/artifact/deliverable tools | yes | required for role `codex`; §8 otherwise |
| **H — connection handoff** | `bridge_manager_resume_instance` | binding rows only | required, `root`, thread must match |
| **T — takeover** | `bridge_manager_takeover` | binding rows only | required, `root` |
| **I — internal** | orchestrator/adapter callbacks | yes | not applicable (§8) |

`bridge_feature_get` and `bridge_recover` are pure for every caller; reconcile and `reapExpired()`
run only inside a Class M/O/T transaction after the guard.

### 6.2 Store-opening API

```ts
SqliteStateStore.openReadOnly(path): ReadOnlyStateStore     // never creates the file
SqliteStateStore.attachExisting(path): SqliteStateStore     // read-write; NO DDL, NO migration,
                                                            // NO schema_meta write, NO journal change
SqliteStateStore.initializeOrMigrate(path, { create }): SqliteStateStore  // authorized path only
```

`attachExisting` opens read-write, reads `schema_meta.schema_version`, refuses a newer schema
(`schema_unsupported`) and refuses an older one (it requires the authorized migration path). It
**never changes persistent journal mode**, even when the current mode differs from the preferred
one: the mode is reported and left alone. Journal mode is set exactly once, when an authorized
initialization creates a new database inside the critical section; for an existing database it is
never rewritten.

### 6.3 Serialization boundaries

> **Every DDL, migration, `schema_meta` and journal-mode write happens inside the same
> serialized, authority-validated boundary as the operation that needs it — never before it.**

| Path | Serialization | Authority validation |
| --- | --- | --- |
| Class R | none (read-only connection) | none needed |
| Class M, bound database, current schema, no `recovery_needed` | main-database `BEGIN IMMEDIATE` | inside that transaction |
| Class O (Mode 1 bootstrap) | L **and** main-database `BEGIN IMMEDIATE` | nonce + binding re-read inside the transaction; DDL and `schema_meta` execute inside it; journal mode set only while creating the file, inside L |
| Class M/O requiring migration of an existing database | L **and** main-database `BEGIN IMMEDIATE` | authority re-verified inside the transaction, before migration statements, which roll back with it |
| Class T, Class H, and any Mode-3 marker repair | L **and** main-database `BEGIN IMMEDIATE` | CAS/authority (§7) inside the transaction, **before** any durable marker repair; neither ever runs DDL or migration |

Because T and H also take L, a migration cannot interleave with a takeover: one waits, and the
loser re-reads the binding on entry and is refused before any durable write. The precheck is a
fast refusal filter that authorizes nothing by itself.

Asynchronous operations are guarded at the existing reservation points —
`Orchestrator.delegate` (`orchestrator.ts:119-135`), `FeatureWorkflow.run`'s `onTaskCreated`
(`feature-workflow.ts:123-140`), `prepareRecovery` (`orchestrator.ts:520`).

### 6.4 Honest read semantics

Reads guarantee no durable state or ownership mutation: no `.bridge/` creation, marker, owner
file, lock database, binding, manager row, schema, `schema_meta`, migration, journal change,
reconcile, reap, domain rows or events. They do **not** promise an untouched filesystem for an
existing database: `-wal`/`-shm` may be created (§1.3). Those are SQLite-internal technical files,
distinguished from durable state. When the database does not exist, the stronger "creates nothing
at all" guarantee holds.

## 7. Ownership, instances and transitions (AC-02, AC-03)

Class M authorisation requires **both**:

```
thread_id(host context) == binding.native_thread_id     else MANAGER_FOREIGN_THREAD
instance_id(this process) == binding.active_instance_id else MANAGER_INSTANCE_FENCED
```

CAS parameters are never identity proof — identity is always the host context; CAS only controls
concurrency.

### 7.1 Handoff CAS, reactivation and adoption eligibility (R06-01)

- **Class H requires `expected_epoch` *and* `expected_generation`** in one compare-and-swap, plus
  the host-proved thread. Epochs are monotonic and never reused, so a delayed handoff carrying an
  older epoch's generation is rejected.
- **Reactivation is permitted and now representable.** `manager_instances` is append-only, keyed by
  `(epoch, instance_generation)`, with a **non-unique** lookup index on `(epoch, instance_id)`
  (§12). The sequence I1 → I2 → I1 within one epoch, via explicit full-CAS handoffs, inserts three
  activation rows and preserves all of them (§1.5). Revision 5's unique index made this impossible
  and is withdrawn.
- **Automatic adoption** after a clean detach (`active_instance_id IS NULL`) is limited to a
  connection whose `instance_id` satisfies
  `NOT EXISTS (SELECT 1 FROM manager_instances WHERE epoch = :epoch AND instance_id = :instance)`
  — an EXISTS test over history, not a uniqueness constraint. A fresh process always qualifies, so
  the tokenless restart still works; a previously active or fenced instance does not and must use
  explicit H. Ordinary Class M by a historical or fenced instance is always refused.
- **Same-instance H** is defined: if the caller is already the active instance and the CAS matches,
  the call is an **idempotent no-op success** — it returns the current `(epoch, generation)`,
  writes no activation row and does not bump the generation, so a retry cannot disturb a
  concurrent CAS holder or invent a new session. If the CAS does not match, it is refused like any
  other stale handoff.

### 7.2 Transitions

| State | Call | Result |
| --- | --- | --- |
| unbound | Class R | served; nothing bound; no durable write |
| unbound | Class M, envelope `root`, operation valid | Mode 1: binding at `epoch 1`, this instance active at `generation 1`, and the operation, in one transaction |
| unbound | envelope rejected | denied in the precheck; no `mkdir`, no L, no reservation, no write-open |
| unbound | operation invalid | full rollback; still unbound; own reservation released; L released |
| unbound | two concurrent Class M from roots T1, T2 | L admits one; the loser re-reads inside its transaction and gets `MANAGER_FOREIGN_THREAD`, writing nothing |
| bound(T1, active I1) | Class M from T1 on I1 | allowed (Mode 2) |
| bound(T1, active I1) | Class M from T1 on I2 | `MANAGER_INSTANCE_FENCED`; ordinary mutators never switch instances |
| bound(T1, active I1) | Class H from T1 on I2, CAS matches | I2 active, `generation + 1`, I1's row ends `superseded` |
| bound(T1, active I2) | Class H from T1 on **I1** (previously fenced), CAS matches | allowed: a new activation row for I1 at the next generation; all earlier rows preserved (§1.5) |
| bound(T1, active I1) | Class H from T1 on I1 (same instance), CAS matches | idempotent no-op success; no new row, no generation bump |
| bound(T1, active I1) | Class H with a stale epoch **or** generation | refused; re-read `bridge_manager_status` |
| bound(T1, active null after clean detach) | Class M/H from T1 on a **fresh** instance | adopted (`adopt_detached`), generation + 1 |
| bound(T1, active null after clean detach) | Class M from a **historical or fenced** instance of T1 | `MANAGER_INSTANCE_FENCED`; explicit H required |
| bound(T1, active I1 crashed) | Class H from T1 on a fresh instance | allowed with the full CAS; no liveness guess, no token |
| bound(T1) | Class M/H from T2 | `MANAGER_FOREIGN_THREAD` |
| bound(T1) | Class T from T2 with `expected_thread_id`, `expected_epoch`, `reason` | `epoch + 1`; T1's binding row ends `taken_over`; T2's instance active at generation 1 |
| bound(T2) after takeover | Class R from T1 | allowed — reads are never fenced |
| bound(T2) after takeover | Class M or H from T1 | `MANAGER_FENCED` |
| bound(T2) after takeover | Class T from T1 with the current `(thread, epoch)` and a reason | allowed: regaining authority only through an explicit, recorded takeover |

**Clean detach**: `BridgeMcpServer.close()` clears `active_instance_id` for its own instance in one
transaction (generation + 1, `manager.detached`, the instance row ends `detached`). **Crash**: the
field stays set and the replacement makes one explicit Class H call. A takeover transfers future
authority only — a running round continues in the process that launched it, its Class I writes are
unaffected, `bridge_feature_run` stays refused while `running` (`feature-workflow.ts:108-109`) and
recovery while a live lease exists (`orchestrator.ts:581-589`). No custody tokens exist anywhere.

## 8. Roles without Codex metadata

| Caller | Rule |
| --- | --- |
| `codex` MCP process | §5–§7 in full. |
| `claude` MCP process | Codex metadata does not exist on this channel and is not required. It can never perform Class O/H/T, and `bridge_manager_*` is unavailable. Its Class M calls stay limited to its own execution identity by today's role/lineage/lease rules, and while a manager binding exists it may not launch or recover. |
| Internal trusted worker (Class I) | Orchestrator and adapter callbacks are in-process, authorised by the attempt and lease they run under, and exempt from envelope checks. |
| Delegated Codex worker with its own bridge MCP | Presents its own root envelope; once the worktree is bound its thread is foreign and it is denied. |

## 9. Guardian, subagents and the honest boundary

**9.1** Protection against accidental mixing of correctly functioning local sessions; not
authentication. A same-UID process that forges the host envelope, edits the launcher or speaks
JSON-RPC directly is out of scope.

**9.2** Guardian review sessions are built with `mcp_servers` set to an empty map, a hard error if
that fails (`reviewer_config.rs:67-73`), in the builder used by production review
(`review.rs:879-885`), asserted by an upstream test (read, not executed). A guardian has no bridge
tools in the verified version and cannot make a first ownership call. The evidence is
version-bound, which is why §5.3 refuses any unverified version.

**9.3** A subagent with MCP servers carries `subagent_kind` (usually also `parent_thread_id`);
§5.2 rejects such envelopes in the read-only precheck, before any write.

**9.4** A complete root envelope proves which thread is calling, not which root the user meant. The
user's rule settles it: the first authorised ownership caller becomes the manager, and every later
root is foreign and must take over explicitly. A second root such as a scripted `codex exec` is a
different root, not a guardian-style bypass, and an "interactive" flag would not choose between two
roots either.

**9.5** No hook and no launcher is proposed; the call-time variant suffices for the accepted
boundary. MCP start/prewarm precedes `SessionStart` (`session/session.rs:1605-1639`), a "latest
hook in cwd" registry is inadmissible, `env_vars` copies parent values, and a wrapper does not gain
access to app-server responses.

## 10. Legacy databases: fail-closed

Detected by the read-only probe of §4.4 step 0, never by opening for write.

- **Empty** (no rows in `tasks`, `features`, `events`, `leases`, `artifacts`, `task_<historical-11>`,
  `idempotency`): bound by the authorized bootstrap; this also covers a schema-only file left by a
  rolled-back bootstrap.
- **With history**: rejected, `unbound_legacy_state`; nothing written, migrated or deleted.
- **Explicit adoption**: `--adopt-legacy-state --adopt-reason "<1..500>"`, refused when a binding
  exists, recording provenance (adopted root, git dir, database path, legacy schema version,
  per-table row counts, reason) in `workspace_binding.adoption_json` and a `workspace.adopted`
  event. Adoption requires a valid Class O call, so the adopting manager is bound in the same
  transaction, and its migration runs under §6.3.

Legacy features keep working; their `workspace_id`/binding fields are filled by the first Class M
call of the bound manager, with a `feature.manager_adopted` event.

## 11. Features and one active feature

`FeatureRecord` gains `workspace_id?`, `manager_epoch?` and
`round_launches?: Array<{task_id, native_thread_id, epoch, launched_at}>`.
`manager_binding.active_feature_id` enforces one active feature per worktree: set on
`feature_create` or the first Class M touch when `null`; a Class M call for a different
non-accepted feature is refused with `FEATURE_CONFLICT`; cleared by `bridge_feature_accept`.
`bridge_feature_get` (Class R) returns derived state plus `workspace`, `manager` (thread, epoch,
active instance, `is_calling_instance`), `round_launches`, `reconciled: false` and the §4.3
recovery fields; it never exposes execution handles.

## 12. Storage interfaces (schema 5)

```sql
CREATE TABLE IF NOT EXISTS workspace_binding (
  singleton      INTEGER PRIMARY KEY CHECK (singleton = 1),
  workspace_id   TEXT NOT NULL, kind TEXT NOT NULL, root TEXT NOT NULL,
  git_dir        TEXT, git_common_dir TEXT, database_path TEXT NOT NULL,
  reservation_nonce TEXT NOT NULL,
  bound_at       INTEGER NOT NULL,
  legacy_adopted INTEGER NOT NULL DEFAULT 0, adoption_json TEXT);

CREATE TABLE IF NOT EXISTS manager_bindings (            -- append-only history
  epoch                INTEGER PRIMARY KEY,              -- monotonic, never reused
  native_thread_id     TEXT NOT NULL,
  workspace_id         TEXT,
  role                 TEXT NOT NULL,
  adapter_id           TEXT NOT NULL,                    -- "codex-0.154.0"
  native_corroboration TEXT NOT NULL CHECK (native_corroboration = 'turn-metadata'),
  codex_version        TEXT NOT NULL,
  thread_source        TEXT,
  bound_at             INTEGER NOT NULL,
  bound_by_kind        TEXT NOT NULL,                    -- first_call | takeover
  ended_at             INTEGER, end_kind TEXT, takeover_reason TEXT,
  predecessor_epoch    INTEGER);

-- Append-only activation history. One row per activation, NOT per instance: an instance may be
-- activated, superseded and explicitly reactivated within one epoch (§7.1, verified in §1.5).
CREATE TABLE IF NOT EXISTS manager_instances (
  epoch                INTEGER NOT NULL,
  instance_generation  INTEGER NOT NULL,
  instance_id          TEXT NOT NULL,
  activated_at         INTEGER NOT NULL,
  activated_by_kind    TEXT NOT NULL,                    -- bind | resume | adopt_detached | takeover
  ended_at             INTEGER, end_kind TEXT,           -- detached | superseded | taken_over
  PRIMARY KEY (epoch, instance_generation));
-- Lookup index only; deliberately NOT unique, so reactivation stays possible.
CREATE INDEX IF NOT EXISTS ix_manager_instances_epoch_instance
  ON manager_instances(epoch, instance_id);

CREATE TABLE IF NOT EXISTS manager_binding (             -- current
  singleton           INTEGER PRIMARY KEY CHECK (singleton = 1),
  epoch               INTEGER NOT NULL,
  native_thread_id    TEXT NOT NULL,
  active_instance_id  TEXT,                              -- NULL only after a clean detach
  instance_generation INTEGER NOT NULL,
  active_feature_id   TEXT,
  updated_at          INTEGER NOT NULL);
```

Adoption eligibility is the EXISTS query of §7.1, never a constraint violation.

`StateStore` gains workspace/manager binding accessors, `insertManagerInstance`/
`endManagerInstance`/`listManagerInstances`/`instanceSeenInEpoch`, and a `ReadOnlyStateStore`
projection for Class R and prechecks. `ControlPlane.open` takes `workspace?: WorkspaceIdentity`
and `mode: "read" | "attach" | "initialize"`; `inspectRecovery()` is the pure counterpart of
`recover()`; a `WorktreeCriticalSection` helper wraps §4.4 step 2 (open → busy_timeout → BEGIN
IMMEDIATE, no DDL). `BridgeMcpServer` passes a `NativeCallContext` and its `instance_id` into
`ToolContext` per call. `FeatureWorkflow` exposes `deriveState` (pure) and `reconcile`
(transactional, owner-only). New non-retryable `ErrorCode`s: `WORKSPACE_MISMATCH`,
`MANAGER_FOREIGN_THREAD`, `MANAGER_INSTANCE_FENCED`, `MANAGER_FENCED`, `NATIVE_CONTEXT_INVALID`,
`FEATURE_CONFLICT`, `STATE_LOCKED`.

## 13. Scope, configuration, platform precondition and boundaries

Default state lives in `<root>/.bridge/` (database, sidecars, marker, lock database); an explicit
external `--db` additionally owns its `<database>.owner`, with the archiving limitation of §4.6.
Configuration is versioned, so `git worktree add` yields a configured worktree; `.bridge/` is
gitignored and must never be copied. Packages, retained returns and staging live in the worktree's
own exchange namespace `~/tmp/bridge-exchange/ws_<first 16 hex of SHA-256(root + NUL + git dir)>/`
(`packages/`, `incoming/`, `staging/`), so two worktrees reusing one feature/purpose/round name do
not collide; the namespace is accidental-collision isolation, not an authorization boundary, and
resolving it is read-only. Explicit `--output`/`--staging` paths stay literal. Tasks are
`work-items/*.md`.
Diagnostics stay on stderr; no log files are created here and `<root>/.bridge/logs/` is reserved.
Transport is stdio only. Shared account limits are not isolated. The pinned supervising runtime is
untouched.

**Platform precondition (R06-03).** The worktree state directory must be on a **local filesystem
with working POSIX advisory locking**, which is what makes the critical section of §4.4 step 2
mutually exclusive and death-safe. Network and FUSE mounts are **unverified and unsupported** for
this purpose. Lock errors that SQLite actually reports — `SQLITE_BUSY`, lock I/O errors — fail
closed with `STATE_LOCKED`. A filesystem that accepts lock calls but does not enforce them cannot
be detected from inside this protocol, so revision 5's claim that broken advisory locks
automatically yield `state_locked` is withdrawn: that case is outside the guarantee and is
documented as such. No filesystem diagnostics, probe tooling or installer is added to manufacture a
guarantee this task does not own.

## 14. Test matrix (AC-07)

**Planned product tests, not executed.** This round produced no product code and ran none of
these. The isolated checks in §1.3–§1.5 are contract experiments on scratch files, explicitly not
product tests. Fixture adapters are labelled in every test name; nothing here is evidence of two
live model pairs.

| ID | Scenario | AC |
| --- | --- | --- |
| E-01 | Envelope table §5.2 end to end, including rejection when turn metadata is absent | 03 |
| E-02 | Synthetic subagent envelope rejected in the read-only precheck: no `mkdir`, L, reservation, write-open, binding or events. Labelled synthetic, not a real guardian call | 02, 03 |
| E-03 | Arguments never a fallback | 03 |
| A-01 | Adapter allowlist is exactly `0.154.0`; `0.154.1`, `0.155.0`, absent and malformed are refused; accepted ownership records `adapter_id` and `native_corroboration = 'turn-metadata'` | 03 |
| L-01 | Two contenders: one enters the critical section, the loser fails closed `STATE_LOCKED`; afterwards only `.bridge/`, a 0-byte `state.lockdb` and at most a transient journal exist — no marker, owner file, database or binding | 02, 04 |
| L-02 | Lock initialization order: open (0-byte file) → `busy_timeout` → `BEGIN IMMEDIATE` with **no DDL**; holder `SIGKILL` → next contender acquires with no cleanup | 02, 04 |
| L-03 | Death after temp write, before either link: leftover classified as an interrupted protocol temp; a new Mode-1 attempt succeeds; the leftover is removable only under L when it matches no published record and no binding | 04 |
| L-04 | Malformed or foreign `*.tmp`, and a `*.tmp` whose content contradicts its own name: `unresolved_workspace_state`, nothing deleted | 04 |
| L-05 | Death after one link (A without B and B without A), with and without a binding: repaired from C when present, superseded when absent, refused when B names another worktree | 04 |
| L-06 | Death after commit before rename: startup and every Class R call only report `recovery_needed`; the next authorized Mode-2 call repairs markers under L; a **foreign** M repairs nothing and leaves markers untouched; no `epoch 1` or history row is recreated | 02, 04, 05 |
| L-07 | Fresh bootstrap with `.bridge/` missing and with `.bridge/` empty; own lock database, its sidecars and own nonce-tagged temps never trigger refusal; an unknown extra `*.db`/`*.owner` still fails closed | 02, 04 |
| L-08 | Legacy with history rejected with the file unchanged; empty legacy bound; adoption flags bind with provenance and are refused when a binding exists or the reason is missing; copied legacy `waiting_user` feature and a legacy feature with no rounds both rejected | 04, 05, 06 |
| P-01 | Mode dispatch: bound H, T and migration **skip reservation publication** and mint no new nonce; ordinary bound M with `recovery_needed = false` takes no critical section; Mode-3 repair happens only after authority validation | 02, 04 |
| M-01 | Migration race: I1 pauses after the precheck, I2 takes over, I1 resumes — no DDL, `schema_meta` or journal-mode write by I1, and it is refused | 02, 05 |
| M-02 | `attachExisting` never rewrites journal mode or upserts `schema_meta`; a denied caller triggers neither | 02, 05 |
| M-03 | Authorized migration runs inside L and its transaction; a concurrent takeover waits or forces a full rollback with no schema change | 02, 05 |
| I-01 | Fresh instance after a clean detach adopts tokenlessly; generation + 1 | 03, 05 |
| I-02 | Fresh instance after a crash: ordinary M denied, one explicit Class H succeeds | 03 |
| I-03 | ABA: a delayed Class H carrying `(epoch 1, generation 1)` is rejected after T1 → T2 → T1 created a new epoch whose generation is also 1 | 03 |
| I-04 | **Reactivation**: I1 → I2 → I1 by explicit full-CAS H succeeds, all activation rows preserved; ordinary M by the historical/fenced instance still fails; automatic adoption refuses an instance already seen in the epoch while a fresh one succeeds | 03 |
| I-05 | Same-instance H with a matching CAS is an idempotent no-op (no new row, no generation bump); with a stale CAS it is refused | 03 |
| I-06 | Two simultaneous Class H: one winner, the other refused; ordinary mutators from both instances never switch the active instance | 03 |
| I-07 | After a takeover to T2: Class R from T1 works, Class M/H are `MANAGER_FENCED`, explicit Class T from T1 regains authority | 02, 03 |
| B-01…B-05 | First ownership call end to end; failed first operation releases only its own reservation; two concurrent roots produce one binding; readonly-first creates nothing when the database is absent; Class R against an existing database leaves durable state unchanged while tolerating `-wal`/`-shm` | 01, 02, 04, 05 |
| D-01…D-05 | Two processes/one worktree/two `--db`; two worktrees/one database including the shared-symlink case; external `--db` support and its archive limitation; marker lost with matching C rebuilt with the same id and nonce; fresh default path resolves during a read without creating `.bridge/` | 02, 04, 06 |
| W-01…W-08 | Worktree identity: two real worktrees; reopen stability; non-git directory; symlinked worktree path; subdirectory rejection; inherited `GIT_*` ignored; branch switch and detached HEAD; copied `.bridge/`, copied database, move away and back, archive-by-rename outside the repository | 01, 04, 06 |
| F-01, F-02 | One active feature per worktree; `round_launches` attribution; recovery keeps owner/lineage rules plus the guard | 01, 02, 05 |
| N-01, N-02 | Two stdio worktree pairs with a `waiting_user` restart while the other pair's gated round runs; static check that no product source reads `~/.codex/sessions`, rollout files or `CODEX_THREAD_ID` | 01, 03, 05 |
| X-01 | Full suites: `npm run build`, `npm test`, `python3 -m unittest discover -s tests -v`, `python3 -m unittest discover -s tools/pilot/tests -v` | 07 |

Existing tests to update: `feature-workflow.test.ts` (authority + pure `get`), `tools.test.ts`
(per-call `NativeCallContext` and instance id), `lifecycle`/`native-launcher` boot assertions,
`native-launcher.test.ts` (existing assertions unchanged, new cases appended).

## 15. Out of scope

Product implementation (W7-ID-02), hook, launcher, installer, `doctor`/`diagnose`, filesystem
lock diagnostics, diagnostic export, rebind command, orphan-process supervision, waking a closed
manager, `/goal`, multiple managers in one worktree, cross-machine coordination, and resistance to
a deliberately forged host envelope from a same-UID process.

## 16. Decisions in this revision

| ID | Decision |
| --- | --- |
| D-01 | Worktree identity = canonical root + per-worktree git dir; branch is not identity. |
| D-02 | Explicit external `--db` is supported; exclusivity is proved by recorded identity in A/B/C, never by path equality; the archiving limitation is documented. |
| D-03 | The critical section is `open → busy_timeout → BEGIN IMMEDIATE` on a schema-less `state.lockdb`; kernel-held, released on process death; on failed acquisition only `.bridge/`, a 0-byte lock file and a transient journal may exist. |
| D-04 | Dispatch is explicit: unbound bootstrap publishes a reservation; bound operations (M, H, T, migration) skip publication and reuse C's nonce; marker repair is a Mode-3 sub-step performed only after authority validation. |
| D-05 | Interrupted protocol temp files and partial publication are classified by parsed content naming this worktree; a name pattern alone is not evidence; unexplained or foreign state fails closed and nothing else is deleted. |
| D-06 | Manager identity = host-supplied native thread from a complete `_meta` envelope with a verified adapter; no tokens, arguments, environment or cwd scanning. |
| D-07 | Every DDL, migration, `schema_meta` and journal-mode write occurs inside the same serialized, authority-validated boundary as its operation; `attachExisting` changes neither journal mode nor `schema_meta`. |
| D-08 | Class M authorisation requires the owning thread and the active instance; Class H CAS covers `(epoch, generation)`; activation history is append-only with a non-unique index, so explicit reactivation works while automatic adoption is restricted by an EXISTS test; same-instance H is an idempotent no-op. |
| D-09 | Class R never mutates durable state; read guarantees are durable-state guarantees, with SQLite technical sidecars acknowledged. |
| D-10 | Legacy state with history is fail-closed; adoption is explicit and evidenced. |
| D-11 | The verified adapter is exactly `0.154.0`. |
| D-12 | No hook and no launcher is proposed. |
| D-13 | Working local advisory locking is a documented precondition; undetectable broken locking is outside the guarantee, and no diagnostics are added to fake one. |

Withdrawn in r6: `UNIQUE(epoch, instance_id)` (it forbade permitted reactivation), DDL on the lock
database before acquisition, the claim that a failed acquisition writes nothing beyond `mkdir`, the
claim that a hot journal necessarily remains, the unconditional "death before publication always
proceeds normally" (temp leftovers are now classified), and the assertion that broken advisory
locks automatically produce `state_locked`. Withdrawn earlier and still absent: advisory native
ids, manual tokens and custody, `bridge_manager_claim`/`attach`/`release`, path-equality
exclusivity, the byte-identical read claim, the `wx state.lock`, "next start completes the
rename", migration between precheck and transaction, generation-only CAS, unconditional adoption
on `active_instance_id IS NULL`, and the `0.154.*` range.

Open items for W7-ID-02: the adapter allowlist holds exactly one verified version; git ≥ 2.31 is
assumed with a documented fallback; the ordering rule of §9.4 remains the accepted residual risk;
the platform precondition of §13 is documented rather than enforced.
