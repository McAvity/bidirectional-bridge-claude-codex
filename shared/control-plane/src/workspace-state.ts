/**
 * Worktree state records and the death-safe critical section (contract §4).
 *
 * Records:
 *  - **A** marker `<root>/.bridge/workspace.json`: one database per worktree;
 *  - **B** owner `<database>.owner`: one worktree per database, external paths included;
 *  - **C** `workspace_binding` row inside the database: authoritative;
 *  - **L** `<root>/.bridge/state.lockdb`: serialization only, never ownership.
 *
 * Exclusivity is decided by recorded identity, never by comparing two paths that could both be
 * redirected through the same symlink.
 */

import { randomBytes } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import type { DatabaseSync as DatabaseSyncCtor } from "node:sqlite";
import { BridgeError, ErrorCode } from "@bridge/protocol";
import { SqliteStateStore } from "./store/sqlite-store.js";
import type { ManagerBindingRecord, WorkspaceBindingRecord } from "./store/state-store.js";
import { stateDirectory, type WorkspaceIdentity } from "./workspace-identity.js";

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as { DatabaseSync: typeof DatabaseSyncCtor };

export const MARKER_NAME = "workspace.json";
export const LOCK_NAME = "state.lockdb";
const LOCK_BUSY_TIMEOUT_MS = 5_000;

export type RecordState = "reserving" | "bound";

export interface MarkerRecord {
  readonly schema_version: 1;
  readonly workspace_id: string;
  readonly kind: string;
  readonly root: string;
  readonly git_dir: string | null;
  readonly git_common_dir: string | null;
  readonly database: string;
  readonly state: RecordState;
  readonly reservation_nonce: string;
  readonly created_at: string;
}

export interface OwnerRecord {
  readonly schema_version: 1;
  readonly workspace_id: string;
  readonly root: string;
  readonly database: string;
  readonly state: RecordState;
  readonly reservation_nonce: string;
  readonly created_at: string;
}

export type ParsedRecord<T> =
  | { readonly kind: "absent" }
  | { readonly kind: "valid"; readonly record: T }
  | { readonly kind: "unparsable"; readonly detail: string };

function mismatch(message: string, reason: string, details: Record<string, unknown> = {}): never {
  throw new BridgeError(ErrorCode.WORKSPACE_MISMATCH, message, { reason, ...details });
}

export function newNonce(): string {
  return randomBytes(12).toString("hex");
}

export function markerPath(identity: WorkspaceIdentity): string {
  return join(stateDirectory(identity), MARKER_NAME);
}

export function ownerPath(databasePath: string): string {
  return `${databasePath}.owner`;
}

function readJson<T>(path: string, validate: (value: Record<string, unknown>) => boolean): ParsedRecord<T> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "absent" };
    return { kind: "unparsable", detail: (error as Error).message };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { kind: "unparsable", detail: (error as Error).message };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { kind: "unparsable", detail: "not an object" };
  }
  const value = parsed as Record<string, unknown>;
  if (value["schema_version"] !== 1 || !validate(value)) {
    return { kind: "unparsable", detail: "unsupported or incomplete record" };
  }
  return { kind: "valid", record: value as unknown as T };
}

export function readMarker(identity: WorkspaceIdentity): ParsedRecord<MarkerRecord> {
  return readJson<MarkerRecord>(
    markerPath(identity),
    (v) =>
      typeof v["workspace_id"] === "string" &&
      typeof v["root"] === "string" &&
      typeof v["database"] === "string" &&
      typeof v["reservation_nonce"] === "string" &&
      (v["state"] === "reserving" || v["state"] === "bound"),
  );
}

export function readOwner(databasePath: string): ParsedRecord<OwnerRecord> {
  return readJson<OwnerRecord>(
    ownerPath(databasePath),
    (v) =>
      typeof v["workspace_id"] === "string" &&
      typeof v["root"] === "string" &&
      typeof v["reservation_nonce"] === "string" &&
      (v["state"] === "reserving" || v["state"] === "bound"),
  );
}

export interface StateProbe {
  readonly databasePath: string;
  readonly databaseExists: boolean;
  readonly marker: ParsedRecord<MarkerRecord>;
  readonly owner: ParsedRecord<OwnerRecord>;
  readonly binding: WorkspaceBindingRecord | null;
  readonly managerBinding: ManagerBindingRecord | null;
  readonly schemaVersion: number;
  readonly hasHistory: boolean;
  /** Markers are incomplete while an authoritative binding exists (contract §4.4 Mode 3). */
  readonly recoveryNeeded: boolean;
}

function fileExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read-only preflight (contract §4.4 step 0). Opens nothing for write, creates no directory and
 * never migrates: a legacy or foreign database must be classified without being touched.
 */
export function probeWorkspaceState(identity: WorkspaceIdentity, databasePath: string): StateProbe {
  const marker = readMarker(identity);
  const owner = readOwner(databasePath);
  const databaseExists = fileExists(databasePath);
  let binding: WorkspaceBindingRecord | null = null;
  let managerBinding: ManagerBindingRecord | null = null;
  let schemaVersion = 0;
  let hasHistory = false;
  if (databaseExists) {
    let probe: SqliteStateStore | undefined;
    try {
      probe = new SqliteStateStore({ path: databasePath, mode: "readonly" });
      binding = probe.getWorkspaceBinding() ?? null;
      managerBinding = probe.getManagerBinding() ?? null;
      schemaVersion = probe.schemaVersion();
      hasHistory = probe.countDomainRows() > 0;
    } catch (error) {
      mismatch(`database cannot be read: ${(error as Error).message}`, "database_unreadable", {
        database: databasePath,
      });
    } finally {
      probe?.close();
    }
  }
  const markerIncomplete = marker.kind !== "valid" || marker.record.state !== "bound";
  const ownerIncomplete = owner.kind !== "valid" || owner.record.state !== "bound";
  return {
    databasePath,
    databaseExists,
    marker,
    owner,
    binding,
    managerBinding,
    schemaVersion,
    hasHistory,
    recoveryNeeded: binding !== null && (markerIncomplete || ownerIncomplete),
  };
}

/**
 * Classify the probe against this worktree (contract §4.5/§4.6). Throws for anything that does
 * not demonstrably belong here; never repairs ambiguous records.
 */
export interface ProbeOptions {
  /** Explicit, operator-requested adoption of an unbound legacy database (contract §10). */
  readonly adoptLegacy?: boolean;
}

export function assertProbeUsable(
  identity: WorkspaceIdentity,
  probe: StateProbe,
  options: ProbeOptions = {},
): void {
  if (probe.marker.kind === "unparsable") {
    mismatch(
      `${markerPath(identity)} cannot be parsed; inspect it manually — the bridge never rewrites ambiguous state`,
      "unresolved_workspace_state",
    );
  }
  if (probe.marker.kind === "valid") {
    const m = probe.marker.record;
    if (m.root !== identity.root || (m.git_dir ?? null) !== identity.git_dir) {
      mismatch(
        `this .bridge state belongs to ${m.root}; start in that worktree or archive the copy`,
        "copied_state",
        { recorded_root: m.root },
      );
    }
    if (m.database !== probe.databasePath) {
      mismatch(
        `this worktree already uses ${m.database}; a second database is not allowed`,
        "second_database",
        { recorded_database: m.database },
      );
    }
  }
  if (probe.owner.kind === "unparsable") {
    mismatch(`${ownerPath(probe.databasePath)} cannot be parsed`, "unresolved_workspace_state");
  }
  if (probe.owner.kind === "valid" && probe.owner.record.root !== identity.root) {
    mismatch(
      `database ${probe.databasePath} is owned by worktree ${probe.owner.record.root}`,
      "database_owned_elsewhere",
      { recorded_root: probe.owner.record.root },
    );
  }
  if (probe.binding) {
    // C is authoritative, and it names the database it belongs to. A copy inside this very
    // worktree therefore fails here even when the marker is gone (review R10-03).
    if (probe.binding.database_path !== probe.databasePath) {
      mismatch(
        `${probe.databasePath} contains a binding for ${probe.binding.database_path}; it is a copy, not this worktree's database`,
        "database_bound_elsewhere",
        { recorded_database: probe.binding.database_path },
      );
    }
    if (probe.binding.root !== identity.root || (probe.binding.git_dir ?? null) !== identity.git_dir) {
      mismatch(
        `database ${probe.databasePath} is bound to worktree ${probe.binding.root}`,
        "database_bound_elsewhere",
        { recorded_root: probe.binding.root },
      );
    }
    // C is authoritative, so A and B must not contradict it. Contradictions are refused, never
    // "repaired": only an interrupted publication (state `reserving`) is recoverable.
    if (probe.marker.kind === "valid") {
      const m = probe.marker.record;
      if (m.workspace_id !== probe.binding.workspace_id || m.database !== probe.binding.database_path) {
        mismatch(
          `${markerPath(identity)} contradicts the binding recorded in ${probe.binding.database_path}`,
          "unresolved_workspace_state",
        );
      }
      // A nonce that disagrees with the binding is a contradiction in *either* state: a
      // `reserving` record only means "interrupted publication" when it carries the binding's
      // own nonce (contract §4.1/§4.5, review R11-02).
      if (m.reservation_nonce !== probe.binding.reservation_nonce) {
        mismatch(
          `${markerPath(identity)} carries a different reservation (${m.state}) than the binding`,
          "unresolved_workspace_state",
        );
      }
    }
    if (probe.owner.kind === "valid") {
      const o = probe.owner.record;
      if (o.database !== probe.binding.database_path) {
        mismatch(
          `${ownerPath(probe.databasePath)} names a different database than the binding`,
          "unresolved_workspace_state",
        );
      }
      if (o.workspace_id !== probe.binding.workspace_id) {
        mismatch(
          `${ownerPath(probe.databasePath)} contradicts the binding recorded in the database`,
          "database_owned_elsewhere",
        );
      }
      if (o.reservation_nonce !== probe.binding.reservation_nonce) {
        mismatch(
          `${ownerPath(probe.databasePath)} carries a different reservation (${o.state}) than the binding`,
          "unresolved_workspace_state",
        );
      }
    }
  } else if (probe.databaseExists && probe.hasHistory && options.adoptLegacy !== true) {
    mismatch(
      `database ${probe.databasePath} has history but no workspace binding; adopt it explicitly if it belongs to this worktree`,
      "unbound_legacy_state",
      { database: probe.databasePath },
    );
  }
}

/**
 * Entries that are not explained by this worktree's protocol (contract §4.4 step 3).
 *
 * The operation's own infrastructure — the state directory, the lock database and its sidecars,
 * and nonce-tagged temp files whose parsed content names this worktree — is known. Anything else
 * fails closed; a name pattern alone is never evidence.
 */
export function assertStateDirectoryExplained(
  identity: WorkspaceIdentity,
  databasePath: string,
  probe: StateProbe,
): void {
  const dir = stateDirectory(identity);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // missing directory is the fresh case
  }
  const known = new Set([MARKER_NAME, LOCK_NAME, `${LOCK_NAME}-journal`, `${LOCK_NAME}-wal`, `${LOCK_NAME}-shm`, "logs", "manager"]);
  const dbBase = dirname(databasePath) === dir ? basename(databasePath) : null;
  if (dbBase) {
    for (const suffix of ["", "-wal", "-shm", "-journal", ".owner"]) known.add(`${dbBase}${suffix}`);
  }
  for (const entry of entries) {
    if (known.has(entry)) continue;
    if (isExplainedTemp(identity, dir, entry, dbBase)) continue;
    mismatch(
      `unexplained file in ${dir}: ${entry}; the bridge refuses to guess which state belongs to this worktree`,
      "unresolved_workspace_state",
      { entry },
    );
  }
  void probe;
}

/**
 * An interrupted protocol temp is recognised only when it is one of the two protocol records,
 * parses as a well-formed record of **this** worktree, and carries the nonce embedded in its own
 * name. Matching `*.tmp`, or carrying only a few fields, is never evidence.
 */
function isExplainedTemp(
  identity: WorkspaceIdentity,
  dir: string,
  entry: string,
  databaseBase: string | null,
): boolean {
  const match = /^(.+)\.([0-9a-f]{8,})(?:\.rewrite)?\.tmp$/u.exec(entry);
  if (!match) return false;
  const [, base, nonce] = match;
  const expected = new Set([MARKER_NAME, ...(databaseBase ? [`${databaseBase}.owner`] : [])]);
  if (!expected.has(base!)) return false;
  const parsed = readJson<Record<string, unknown>>(join(dir, entry), () => true);
  if (parsed.kind !== "valid") return false;
  const record = parsed.record as unknown as Partial<MarkerRecord & OwnerRecord>;
  if (record.schema_version !== 1) return false;
  if (record.root !== identity.root) return false;
  if (typeof record.workspace_id !== "string" || record.workspace_id.length === 0) return false;
  if (typeof record.database !== "string" || record.database.length === 0) return false;
  if (record.reservation_nonce !== nonce) return false;
  if (record.state !== "reserving" && record.state !== "bound") return false;
  // A marker additionally pins the worktree's git dir; an owner record does not carry one.
  if (base === MARKER_NAME && (record.git_dir ?? null) !== identity.git_dir) return false;
  return true;
}

function publishAtomic(finalPath: string, record: object, nonce: string): void {
  const tmp = `${finalPath}.${nonce}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  try {
    linkSync(tmp, finalPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    unlinkSync(tmp);
    mismatch(`another bootstrap published ${finalPath} first`, "second_database", { path: finalPath });
  }
  unlinkSync(tmp);
}

function rewriteAtomic(finalPath: string, record: object, nonce: string): void {
  const tmp = `${finalPath}.${nonce}.rewrite.tmp`;
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, finalPath);
}

export function buildMarker(
  identity: WorkspaceIdentity,
  workspaceId: string,
  databasePath: string,
  nonce: string,
  state: RecordState,
): MarkerRecord {
  return {
    schema_version: 1,
    workspace_id: workspaceId,
    kind: identity.kind,
    root: identity.root,
    git_dir: identity.git_dir,
    git_common_dir: identity.git_common_dir,
    database: databasePath,
    state,
    reservation_nonce: nonce,
    created_at: new Date().toISOString(),
  };
}

export function buildOwner(
  identity: WorkspaceIdentity,
  workspaceId: string,
  databasePath: string,
  nonce: string,
  state: RecordState,
): OwnerRecord {
  return {
    schema_version: 1,
    workspace_id: workspaceId,
    root: identity.root,
    database: databasePath,
    state,
    reservation_nonce: nonce,
    created_at: new Date().toISOString(),
  };
}

/**
 * Publish A and B for a bootstrap attempt and return the nonce actually in force (contract
 * §4.4 step 4 and §4.5).
 *
 * The probe is taken under the critical section and has no binding row, so:
 *  - a missing record is created atomically;
 *  - a record left `reserving` by an interrupted attempt is superseded with a fresh nonce, which
 *    is safe precisely because no binding committed (any survivor fails its nonce re-check);
 *  - a record claiming `bound` without a binding row is a contradiction and fails closed.
 */
export function publishReservation(
  identity: WorkspaceIdentity,
  workspaceId: string,
  databasePath: string,
  probe: StateProbe,
): string {
  if (probe.binding) {
    mismatch("publication attempted for an already bound worktree", "unresolved_workspace_state");
  }
  for (const [label, record] of [
    ["marker", probe.marker],
    ["owner", probe.owner],
  ] as const) {
    if (record.kind === "valid" && record.record.state === "bound") {
      mismatch(
        `${label} claims a completed binding that the database does not contain; inspect the state manually`,
        "unresolved_workspace_state",
      );
    }
  }
  const nonce = newNonce();
  const marker = buildMarker(identity, workspaceId, databasePath, nonce, "reserving");
  const owner = buildOwner(identity, workspaceId, databasePath, nonce, "reserving");
  if (probe.marker.kind === "valid") rewriteAtomic(markerPath(identity), marker, nonce);
  else publishAtomic(markerPath(identity), marker, nonce);
  if (probe.owner.kind === "valid") rewriteAtomic(ownerPath(databasePath), owner, nonce);
  else publishAtomic(ownerPath(databasePath), owner, nonce);
  return nonce;
}

/** Mark the publication complete (contract §4.4 step 6). */
export function completePublication(
  identity: WorkspaceIdentity,
  workspaceId: string,
  databasePath: string,
  nonce: string,
): void {
  rewriteAtomic(markerPath(identity), buildMarker(identity, workspaceId, databasePath, nonce, "bound"), nonce);
  rewriteAtomic(ownerPath(databasePath), buildOwner(identity, workspaceId, databasePath, nonce, "bound"), nonce);
}

/**
 * Marker-only repair from the authoritative binding (contract §4.4 Mode 3). Rebuilds A and B
 * with C's identity and nonce; never touches ownership rows or domain state.
 */
export function repairRecordsFromBinding(
  identity: WorkspaceIdentity,
  binding: WorkspaceBindingRecord,
): void {
  const nonce = binding.reservation_nonce;
  rewriteAtomic(
    markerPath(identity),
    buildMarker(identity, binding.workspace_id, binding.database_path, nonce, "bound"),
    nonce,
  );
  rewriteAtomic(
    ownerPath(binding.database_path),
    buildOwner(identity, binding.workspace_id, binding.database_path, nonce, "bound"),
    nonce,
  );
}

/** Release a reservation this process published, identified by its own nonce. */
export function releaseOwnReservation(
  identity: WorkspaceIdentity,
  databasePath: string,
  nonce: string,
): void {
  for (const path of [markerPath(identity), ownerPath(databasePath)]) {
    const parsed = readJson<Record<string, unknown>>(path, () => true);
    if (parsed.kind === "valid" && (parsed.record as { reservation_nonce?: string }).reservation_nonce === nonce) {
      try {
        unlinkSync(path);
      } catch {
        /* already gone */
      }
    }
  }
}

/**
 * The worktree critical section (contract §4.4 step 2): open → connection-local busy timeout →
 * `BEGIN IMMEDIATE`, with **no DDL**. A write lock needs no schema, and the kernel releases it
 * when the holding process dies, which is what makes the protocol recoverable after a crash.
 */
export class WorktreeCriticalSection {
  private constructor(private readonly db: InstanceType<typeof DatabaseSyncCtor>) {}

  static acquire(identity: WorkspaceIdentity, timeoutMs = LOCK_BUSY_TIMEOUT_MS): WorktreeCriticalSection {
    const dir = stateDirectory(identity);
    mkdirSync(dir, { recursive: true });
    const db = new DatabaseSync(join(dir, LOCK_NAME));
    try {
      db.exec(`PRAGMA busy_timeout = ${timeoutMs}`);
      db.exec("BEGIN IMMEDIATE");
    } catch (error) {
      db.close();
      throw new BridgeError(
        ErrorCode.STATE_LOCKED,
        `another bridge operation holds this worktree: ${(error as Error).message}`,
        { root: identity.root },
      );
    }
    return new WorktreeCriticalSection(db);
  }

  release(): void {
    try {
      this.db.exec("ROLLBACK");
    } catch {
      /* nothing to roll back */
    } finally {
      this.db.close();
    }
  }
}
