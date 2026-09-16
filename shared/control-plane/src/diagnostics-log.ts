/**
 * Local diagnostics log (wave13 §1/§2): one bounded JSONL stream per bridge process.
 *
 * Why it exists: when a round gets stuck, the only durable explanation used to be the SQLite
 * event log, which says what the control plane decided but not what the *process* did — which
 * call was refused before it could write, when the launcher came up, which attempt the runtime
 * was in when the client timed out. This records those process-level facts next to the state
 * they explain, without becoming a second source of truth: nothing here decides DONE, BLOCKED
 * or recovery, and no payload, prompt, answer, transcript or tool argument is copied into it.
 *
 * Three rules shape the implementation:
 *
 *  - **Nothing is written before the worktree is bound and this process is authorized.** The
 *    logger starts disarmed; `arm()` is called by the identity guard after an authorized
 *    operation, and only then is `<root>/.bridge/logs/` created. A refused call, a read and a
 *    handshake therefore write no file — the no-mutation rule of the isolation protocol covers
 *    the log exactly as it covers the database. Records produced before that go to the bounded
 *    stderr sink only and are counted, so the gap is visible rather than silently filled.
 *  - **Failure is bounded and honest.** Every filesystem error is caught, counted, warned about
 *    at most `MAX_WARNINGS` times on stderr, and after `MAX_FAILURES` the logger disables
 *    itself. It never throws into the product path, never retries in a loop and never reports a
 *    record as written when it was not.
 *  - **Retention only ever deletes this bridge's own log files.** Candidates must match the
 *    file-name pattern, be regular files (symlinks are skipped, never followed), not be this
 *    process's current file, and not be named by another instance's live marker.
 *
 * stdout is the MCP transport: this module writes to a file descriptor it opened and to the
 * injected warning sink (stderr), never to stdout.
 */

import { createHash } from "node:crypto";
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";

/** Format identifier carried by every record, so a truncated tail is still self-describing. */
export const DIAGNOSTICS_LOG_SCHEMA = "claude-codex-bridge.log/v1";

/** Log directory inside the worktree state directory (`.bridge/logs`). */
export const LOG_DIRECTORY_NAME = "logs";

/** `bridge-<UTC compact timestamp>-<instance suffix>-<rotation index>.jsonl`. */
const FILE_PATTERN = /^bridge-\d{8}T\d{6}Z-[0-9a-f]{4,32}-\d{2}\.jsonl$/u;
/** `instance-<instance suffix>.active` — names the file a live process is writing. */
const MARKER_PATTERN = /^instance-[0-9a-f]{4,32}\.active$/u;

const MAX_WARNINGS = 3;
const MAX_FAILURES = 3;
const MAX_DETAIL_KEYS = 12;
const MAX_VALUE_CHARS = 200;
const DETAIL_KEY = /^[a-z][a-z0-9_]{0,31}$/u;
/** Ids that may appear verbatim: repository-level identifiers, not free text. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;

export interface DiagnosticsLogLimits {
  /** Maximum serialized bytes of one record; a larger record is clamped, never dropped silently. */
  readonly maxRecordBytes: number;
  /** Rotate to the next file once the current one reaches this size. */
  readonly maxFileBytes: number;
  /** Total bytes of this worktree's retained log files. */
  readonly maxTotalBytes: number;
  /** Maximum number of retained files. */
  readonly maxFiles: number;
  /** Maximum age of a retained file. */
  readonly maxAgeMs: number;
}

/**
 * Finite defaults. They bound one worktree at 32 MiB / 16 files / 14 days, which keeps a few
 * weeks of ordinary rounds while never growing without limit; the values are documented in
 * docs/diagnostics.md and can be lowered or raised per worktree through the environment.
 */
export const DEFAULT_DIAGNOSTICS_LIMITS: DiagnosticsLogLimits = {
  maxRecordBytes: 8 * 1024,
  maxFileBytes: 4 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
  maxFiles: 16,
  maxAgeMs: 14 * 24 * 60 * 60 * 1000,
};

const LIMIT_BOUNDS: Record<keyof DiagnosticsLogLimits, readonly [number, number]> = {
  maxRecordBytes: [512, 64 * 1024],
  maxFileBytes: [64 * 1024, 64 * 1024 * 1024],
  maxTotalBytes: [256 * 1024, 512 * 1024 * 1024],
  maxFiles: [2, 200],
  maxAgeMs: [60 * 60 * 1000, 365 * 24 * 60 * 60 * 1000],
};

/** Environment variables are the single local configuration surface (docs/diagnostics.md). */
const ENV_LIMITS: ReadonlyArray<{
  readonly key: keyof DiagnosticsLogLimits;
  readonly variable: string;
  readonly scale: number;
}> = [
  { key: "maxRecordBytes", variable: "BRIDGE_LOG_MAX_RECORD_BYTES", scale: 1 },
  { key: "maxFileBytes", variable: "BRIDGE_LOG_MAX_FILE_BYTES", scale: 1 },
  { key: "maxTotalBytes", variable: "BRIDGE_LOG_MAX_TOTAL_BYTES", scale: 1 },
  { key: "maxFiles", variable: "BRIDGE_LOG_MAX_FILES", scale: 1 },
  { key: "maxAgeMs", variable: "BRIDGE_LOG_MAX_AGE_DAYS", scale: 24 * 60 * 60 * 1000 },
];

export interface DiagnosticsLogConfig {
  readonly enabled: boolean;
  readonly limits: DiagnosticsLogLimits;
  /** Human-readable problems with the supplied configuration; the defaults were kept for those. */
  readonly problems: readonly string[];
}

/**
 * Read the per-worktree configuration from the environment the launcher was started in.
 * An unusable value never disables logging and never becomes an unbounded limit: the default
 * is kept and the problem is reported so the launcher can warn once.
 */
export function readDiagnosticsLogConfig(env: NodeJS.ProcessEnv = process.env): DiagnosticsLogConfig {
  const problems: string[] = [];
  const raw = (env["BRIDGE_LOG"] ?? "").trim().toLowerCase();
  let enabled = true;
  if (raw === "off" || raw === "0" || raw === "false") enabled = false;
  else if (raw !== "" && raw !== "on" && raw !== "1" && raw !== "true") {
    problems.push(`BRIDGE_LOG='${raw}' is not on/off; logging stays enabled`);
  }
  const limits: Record<string, number> = { ...DEFAULT_DIAGNOSTICS_LIMITS };
  for (const { key, variable, scale } of ENV_LIMITS) {
    const text = env[variable];
    if (text === undefined || text.trim() === "") continue;
    const value = Number(text.trim()) * scale;
    const [min, max] = LIMIT_BOUNDS[key];
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
      problems.push(`${variable}='${text}' is outside ${min / scale}..${max / scale}; using the default`);
      continue;
    }
    limits[key] = value;
  }
  return { enabled, limits: limits as unknown as DiagnosticsLogLimits, problems };
}

/** Where the record came from and what happened; the caller supplies only allowlisted fields. */
export interface DiagnosticsLogEntry {
  /** Coarse subsystem: `process`, `tool`, `manager`, `adapter`, `log`. */
  readonly op: string;
  /** Specific operation, e.g. `start`, `call.finished`, `authorized`, `retention`. */
  readonly event: string;
  readonly tool?: string | null;
  readonly outcome?: "ok" | "error" | "refused" | null;
  /** Stable error code (`BridgeError.code`) when the operation failed. */
  readonly code?: string | null;
  /** Where it failed: `guard`, `handler`, `startup`, `shutdown`, `logger`. */
  readonly phase?: string | null;
  readonly request_id?: string | number | null;
  readonly duration_ms?: number | null;
  readonly feature_id?: string | null;
  readonly task_id?: string | null;
  readonly attempt?: number | null;
  /** Small map of scalar facts; never payloads, prompts, arguments or transcripts. */
  readonly details?: Record<string, unknown>;
}

export interface DiagnosticsLoggerOptions {
  /** MCP connection instance id (`inst_<hex>`); identifies the writer within the worktree. */
  readonly instanceId: string;
  /** Startup-bound caller role. */
  readonly role: string;
  /** Package version of the running source. */
  readonly packageVersion: string;
  /** Installed runtime id from `runtime-manifest.json`, or null in a development checkout. */
  readonly runtimeId?: string | null;
  readonly config?: DiagnosticsLogConfig;
  /** Bounded stderr sink. Never stdout. */
  readonly warn: (line: string) => void;
  readonly pid?: number;
  /** Injected for tests. */
  readonly now?: () => number;
  readonly monotonicMs?: () => number;
  readonly isProcessAlive?: (pid: number) => boolean;
}

export interface DiagnosticsLogStatus {
  readonly enabled: boolean;
  readonly armed: boolean;
  readonly disabled: boolean;
  readonly file: string | null;
  readonly written: number;
  readonly deferred: number;
  readonly failures: number;
  readonly rotations: number;
  readonly deleted: number;
}

function defaultProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else: still live, still protected.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function compactUtc(at: number): string {
  return new Date(at).toISOString().replace(/[-:]/gu, "").replace(/\.\d+Z$/u, "Z");
}

/** Strings become single-line and length-bounded; anything else becomes null. */
function scalar(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const clean = value.replace(/\p{C}/gu, " ").trim();
  return clean.length > MAX_VALUE_CHARS ? `${clean.slice(0, MAX_VALUE_CHARS)}~` : clean;
}

/** A repository identifier is kept verbatim; anything else is reported as `invalid`. */
export function loggableId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return "invalid";
  return SAFE_ID.test(value) ? value : "invalid";
}

/** Correlation without content: manager-chosen keys are referenced by a short digest. */
export function digestRef(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12);
}

export class DiagnosticsLogger {
  private readonly limits: DiagnosticsLogLimits;
  private readonly enabled: boolean;
  private readonly pid: number;
  private readonly now: () => number;
  private readonly monotonic: () => number;
  private readonly alive: (pid: number) => boolean;
  private readonly instanceSuffix: string;
  private readonly startedAt: number;

  private directory: string | null = null;
  private workspaceId: string | null = null;
  private fd: number | null = null;
  private fileName: string | null = null;
  private fileBytes = 0;
  private rotationIndex = 0;
  private seq = 0;
  private deferred = 0;
  private written = 0;
  private failures = 0;
  private warnings = 0;
  private rotations = 0;
  private deleted = 0;
  private disabled = false;
  private closed = false;
  private enforcing = false;

  constructor(private readonly options: DiagnosticsLoggerOptions) {
    const config = options.config ?? { enabled: true, limits: DEFAULT_DIAGNOSTICS_LIMITS, problems: [] };
    this.limits = config.limits;
    this.enabled = config.enabled;
    this.pid = options.pid ?? process.pid;
    this.now = options.now ?? (() => Date.now());
    const origin = process.hrtime.bigint();
    this.monotonic =
      options.monotonicMs ?? (() => Number(process.hrtime.bigint() - origin) / 1_000_000);
    this.alive = options.isProcessAlive ?? defaultProcessAlive;
    this.instanceSuffix = /[0-9a-f]{4,}$/u.exec(options.instanceId)?.[0] ?? "0000";
    this.startedAt = this.now();
    for (const problem of config.problems) this.warn(`configuration: ${problem}`);
  }

  get status(): DiagnosticsLogStatus {
    return {
      enabled: this.enabled,
      armed: this.fd !== null,
      disabled: this.disabled,
      file: this.directory && this.fileName ? join(this.directory, this.fileName) : null,
      written: this.written,
      deferred: this.deferred,
      failures: this.failures,
      rotations: this.rotations,
      deleted: this.deleted,
    };
  }

  /** Milliseconds since this process started; the ordering evidence a wall clock cannot give. */
  monotonicMs(): number {
    return this.monotonic();
  }

  /**
   * Authorize file logging for this worktree. Called by the identity guard after an operation
   * this process was authorized to perform, never on a refusal, a read or a handshake.
   */
  arm(target: { readonly stateDirectory: string; readonly workspaceId: string | null; readonly by?: string }): void {
    if (!this.enabled || this.disabled || this.closed || this.fd !== null) return;
    this.workspaceId = target.workspaceId;
    const directory = join(target.stateDirectory, LOG_DIRECTORY_NAME);
    if (!this.prepareDirectory(target.stateDirectory, directory)) return;
    this.directory = directory;
    if (!this.openNextFile()) return;
    // The first record re-states the process facts that were produced before arming, so the
    // file explains itself without a pre-binding buffer that would need its own ownership.
    this.record({
      op: "process",
      event: "start",
      phase: "startup",
      details: {
        started_at: new Date(this.startedAt).toISOString(),
        deferred_records: this.deferred,
        armed_by: target.by ?? null,
        max_record_bytes: this.limits.maxRecordBytes,
        max_file_bytes: this.limits.maxFileBytes,
        max_total_bytes: this.limits.maxTotalBytes,
        max_files: this.limits.maxFiles,
        max_age_ms: this.limits.maxAgeMs,
      },
    });
    this.enforce();
  }

  /** Append one record. Never throws; a record produced before arming is counted, not buffered. */
  record(entry: DiagnosticsLogEntry): void {
    if (this.closed || this.disabled || !this.enabled) return;
    const line = this.serialize(entry);
    if (this.fd === null) {
      this.deferred += 1;
      return;
    }
    this.append(line);
  }

  /** Final record, marker removal and file close. Idempotent. */
  close(reason: string): void {
    if (this.closed) return;
    if (this.fd !== null) {
      this.record({
        op: "log",
        event: "close",
        phase: "shutdown",
        details: {
          reason,
          records: this.written,
          deferred: this.deferred,
          failures: this.failures,
          rotations: this.rotations,
          deleted_files: this.deleted,
          file_bytes: this.fileBytes,
        },
      });
    }
    this.closed = true;
    this.releaseFile();
    if (this.failures > 0) {
      this.options.warn(
        `[bridge-log] ${this.failures} diagnostics log write(s) failed; the log of this process is incomplete`,
      );
    }
  }

  /* ------------------------------------------------------------------ *
   * Serialization
   * ------------------------------------------------------------------ */

  private serialize(entry: DiagnosticsLogEntry): string {
    const base: Record<string, unknown> = {
      schema: DIAGNOSTICS_LOG_SCHEMA,
      ts: new Date(this.now()).toISOString(),
      seq: (this.seq += 1),
      mono_ms: Math.round(this.monotonic() * 1000) / 1000,
      pid: this.pid,
      instance: this.options.instanceId,
      role: this.options.role,
      source: this.options.packageVersion,
      runtime: this.options.runtimeId ?? null,
      workspace: this.workspaceId,
      op: scalar(entry.op),
      event: scalar(entry.event),
      tool: scalar(entry.tool ?? null),
      outcome: scalar(entry.outcome ?? null),
      code: scalar(entry.code ?? null),
      phase: scalar(entry.phase ?? null),
      request_id: scalar(entry.request_id ?? null),
      duration_ms: typeof entry.duration_ms === "number" ? Math.round(entry.duration_ms) : null,
      feature_id: scalar(entry.feature_id ?? null),
      task_id: scalar(entry.task_id ?? null),
      attempt: typeof entry.attempt === "number" ? entry.attempt : null,
    };
    const details = this.details(entry.details);
    const full = `${JSON.stringify({ ...base, details })}\n`;
    if (Buffer.byteLength(full, "utf8") <= this.limits.maxRecordBytes) return full;
    const clamped = `${JSON.stringify({ ...base, details: null, truncated: true })}\n`;
    if (Buffer.byteLength(clamped, "utf8") <= this.limits.maxRecordBytes) return clamped;
    return `${JSON.stringify({
      schema: DIAGNOSTICS_LOG_SCHEMA,
      ts: base["ts"],
      seq: base["seq"],
      op: base["op"],
      event: base["event"],
      truncated: true,
    })}\n`;
  }

  private details(raw: Record<string, unknown> | undefined): Record<string, unknown> | null {
    if (!raw) return null;
    const out: Record<string, unknown> = {};
    let dropped = 0;
    for (const [key, value] of Object.entries(raw)) {
      if (!DETAIL_KEY.test(key)) {
        dropped += 1;
        continue;
      }
      if (Object.keys(out).length >= MAX_DETAIL_KEYS) {
        dropped += 1;
        continue;
      }
      out[key] = scalar(value);
    }
    if (dropped > 0) out["dropped_fields"] = dropped;
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Files
   * ------------------------------------------------------------------ */

  private prepareDirectory(stateDirectory: string, directory: string): boolean {
    // A managed path that is a symlink is refused before any write (wave12 W12-R1): the log
    // must not be redirected out of this worktree's state directory.
    for (const path of [stateDirectory, directory]) {
      try {
        if (lstatSync(path).isSymbolicLink()) {
          this.disable(`${path} is a symlink; diagnostics logging is refused`);
          return false;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          this.fail("prepare", error);
          return false;
        }
      }
    }
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      return true;
    } catch (error) {
      this.fail("prepare", error);
      return false;
    }
  }

  private openNextFile(): boolean {
    if (this.directory === null) return false;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const name =
        `bridge-${compactUtc(this.now())}-${this.instanceSuffix}-` +
        `${String(this.rotationIndex).padStart(2, "0")}.jsonl`;
      this.rotationIndex += 1;
      try {
        // "ax" is O_CREAT|O_EXCL|O_APPEND: an existing path — including a symlink — fails here
        // rather than being written through.
        this.fd = openSync(join(this.directory, name), "ax", 0o600);
        this.fileName = name;
        this.fileBytes = 0;
        this.writeMarker(name);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
        this.fail("open", error);
        return false;
      }
    }
    this.disable("could not create a diagnostics log file with a free name");
    return false;
  }

  private writeMarker(fileName: string): void {
    if (this.directory === null) return;
    const path = join(this.directory, `instance-${this.instanceSuffix}.active`);
    try {
      // Rotation rewrites this process's own marker; anything else at that path — in particular
      // a symlink — is left alone rather than written through.
      if (!lstatSync(path).isFile()) {
        this.warn(`the active-log marker path is not a regular file; retention protection is off`);
        return;
      }
    } catch {
      /* absent is the normal case */
    }
    try {
      writeFileSync(
        path,
        `${JSON.stringify({
          schema: DIAGNOSTICS_LOG_SCHEMA,
          pid: this.pid,
          instance: this.options.instanceId,
          file: fileName,
          started_at: new Date(this.startedAt).toISOString(),
        })}\n`,
        { mode: 0o600, flag: "w" },
      );
    } catch (error) {
      // A missing marker only costs retention protection for this file; it is not fatal.
      this.warn(`could not write the active-log marker: ${(error as Error).message}`);
    }
  }

  private append(line: string): void {
    if (this.fd === null) return;
    try {
      const bytes = writeSync(this.fd, line);
      this.fileBytes += bytes;
      this.written += 1;
    } catch (error) {
      this.fail("write", error);
      return;
    }
    if (!this.enforcing && this.fileBytes >= this.limits.maxFileBytes) this.rotate();
  }

  private rotate(): void {
    const previous = this.fileName;
    this.closeFd();
    if (!this.openNextFile()) {
      // The log was armed and can no longer be written: say so once instead of degrading into
      // a silent no-op that looks like "never authorized".
      this.disable("rotation failed; this process writes no further diagnostics records");
      return;
    }
    this.rotations += 1;
    this.enforcing = true;
    try {
      this.append(this.serialize({ op: "log", event: "rotated", details: { previous_file: previous } }));
    } finally {
      this.enforcing = false;
    }
    this.enforce();
  }

  /**
   * Delete only this bridge's own, unused log files, oldest first, until the configured age,
   * total size and file count hold. Never follows a symlink, never touches the database,
   * historical packages, client transcripts or attempt evidence — none of which live here.
   */
  private enforce(): void {
    if (this.directory === null || this.fd === null) return;
    let entries;
    try {
      entries = readdirSync(this.directory, { withFileTypes: true });
    } catch (error) {
      this.fail("retention", error);
      return;
    }
    const protectedFiles = new Set<string>(this.fileName ? [this.fileName] : []);
    const staleMarkers: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !MARKER_PATTERN.test(entry.name)) continue;
      const marker = this.readMarker(join(this.directory, entry.name));
      if (marker && marker.pid !== this.pid && this.alive(marker.pid)) {
        protectedFiles.add(marker.file);
        continue;
      }
      if (marker && marker.pid === this.pid) continue;
      staleMarkers.push(entry.name);
    }

    const candidates: Array<{ name: string; bytes: number; mtimeMs: number }> = [];
    // Files another live instance is writing count towards the limits but are never deleted.
    let total = 0;
    let count = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !FILE_PATTERN.test(entry.name)) continue;
      let bytes = 0;
      let mtimeMs = 0;
      try {
        const stat = lstatSync(join(this.directory, entry.name));
        if (!stat.isFile()) continue;
        bytes = stat.size;
        mtimeMs = stat.mtimeMs;
      } catch {
        continue; // disappeared between readdir and stat: nothing to retain
      }
      total += bytes;
      count += 1;
      if (protectedFiles.has(entry.name)) continue;
      candidates.push({ name: entry.name, bytes, mtimeMs });
    }
    candidates.sort((a, b) => a.mtimeMs - b.mtimeMs);

    const now = this.now();
    const removed: string[] = [];
    for (const file of candidates) {
      const tooOld = now - file.mtimeMs > this.limits.maxAgeMs;
      const tooMany = count > this.limits.maxFiles;
      const tooBig = total > this.limits.maxTotalBytes;
      if (!tooOld && !tooMany && !tooBig) break;
      if (!this.remove(file.name)) continue;
      removed.push(file.name);
      total -= file.bytes;
      count -= 1;
    }
    for (const marker of staleMarkers) this.remove(marker);

    if (removed.length === 0) return;
    this.deleted += removed.length;
    this.enforcing = true;
    try {
      // The export must be able to see that older records were deleted rather than never written.
      this.append(
        this.serialize({
          op: "log",
          event: "retention",
          details: {
            deleted_files: removed.length,
            oldest_deleted: removed[0] ?? null,
            newest_deleted: removed[removed.length - 1] ?? null,
            retained_bytes: total,
          },
        }),
      );
    } finally {
      this.enforcing = false;
    }
  }

  private readMarker(path: string): { pid: number; file: string } | null {
    try {
      if (!lstatSync(path).isFile()) return null;
      const parsed = JSON.parse(readFileSync(path, "utf8")) as { pid?: unknown; file?: unknown };
      if (!Number.isInteger(parsed.pid) || typeof parsed.file !== "string") return null;
      return { pid: parsed.pid as number, file: parsed.file };
    } catch {
      return null;
    }
  }

  private remove(name: string): boolean {
    if (this.directory === null) return false;
    try {
      unlinkSync(join(this.directory, name));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      this.warn(`could not delete ${name}: ${(error as Error).message}`);
      return false;
    }
  }

  private releaseFile(): void {
    this.closeFd();
    if (this.directory === null) return;
    this.remove(`instance-${this.instanceSuffix}.active`);
  }

  private closeFd(): void {
    if (this.fd === null) return;
    try {
      closeSync(this.fd);
    } catch {
      /* already closed */
    }
    this.fd = null;
  }

  /* ------------------------------------------------------------------ *
   * Bounded failure handling
   * ------------------------------------------------------------------ */

  private fail(phase: string, error: unknown): void {
    this.failures += 1;
    this.warn(`${phase} failed: ${(error as Error).message}`);
    if (this.failures >= MAX_FAILURES) {
      this.disable(`disabled after ${this.failures} failures; the product operation is unaffected`);
    }
  }

  private disable(reason: string): void {
    if (this.disabled) return;
    this.disabled = true;
    this.closeFd();
    this.options.warn(`[bridge-log] ${reason}`);
  }

  private warn(line: string): void {
    if (this.warnings >= MAX_WARNINGS) return;
    this.warnings += 1;
    const suffix = this.warnings === MAX_WARNINGS ? " (further logger warnings are suppressed)" : "";
    this.options.warn(`[bridge-log] ${line}${suffix}`);
  }
}
