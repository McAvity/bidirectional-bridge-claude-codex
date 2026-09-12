/**
 * Termination evidence: bounded diagnostics for an attempt that ended without a normal result.
 *
 * Why this exists: a runtime stopped at its deadline or cancelled returns no result, so the
 * one place that explains a long silence or a startup failure — the runtime's stderr — was
 * only ever held in the adapter's memory and lost. This keeps its redacted tail and the
 * process/stream facts as one local file per attempt.
 *
 * What it must never become: a transcript store or a second state database. Files live next
 * to the coordination database (`<db dir>/evidence/<task_id>/attempt-<n>.json`, mode 0600),
 * are written once and never overwritten, and are referenced from the event log by metadata
 * only. Nothing here is written to stdout or returned as content through MCP. Redaction is a
 * guardrail for known credential shapes and session handles, not a guarantee.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  AttemptTerminationKind,
  BridgeError,
  ErrorCode,
  EventType,
  type AgentId,
  type TaskId,
  type TerminationEvidence,
} from "@bridge/protocol";
import { SECRET_PATTERNS } from "./attempt-service.js";
import type { Clock } from "./clock.js";
import type { StateStore } from "./store/state-store.js";

export const TERMINATION_EVIDENCE_SCHEMA = "bridge.termination-evidence.v1";
/** Retained stderr per attempt, in UTF-8 bytes, after redaction. */
export const TERMINATION_EVIDENCE_STDERR_MAX_BYTES = 16 * 1024;

const SAFE_TASK_ID = /^[A-Za-z0-9_-]{1,128}$/;
const MACHINE_LABEL = /^[a-z][a-z0-9_]{0,39}$/;
const RUNTIME_LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SIGNAL_NAME = /^SIG[A-Z0-9]{1,12}$/;
const MAX_FRAME_TYPES = 16;
const TERMINATION_KINDS = new Set<string>(Object.values(AttemptTerminationKind));

export interface RecordTerminationEvidenceInput {
  readonly task_id: TaskId;
  readonly attempt: number;
  readonly agent: AgentId;
  readonly evidence: TerminationEvidence;
}

/** Metadata about one stored evidence file; this, never the content, is what MCP exposes. */
export interface TerminationEvidenceRecord {
  readonly attempt: number;
  /** Path relative to the evidence directory. */
  readonly file: string;
  /** Absolute local path, or null when this control plane has no evidence directory. */
  readonly path: string | null;
  readonly bytes: number;
  readonly sha256: string;
  readonly termination_kind: string;
  readonly reason: string;
  readonly stderr_total_bytes: number;
  readonly stderr_truncated: boolean;
  readonly recorded_at: number;
}

export class TerminationEvidenceStore {
  constructor(
    private readonly store: StateStore,
    private readonly clock: Clock,
    /** Null disables file evidence (for example an in-memory database). */
    readonly directory: string | null,
  ) {}

  /** Store evidence for one attempt at most once; returns null when evidence is disabled. */
  record(input: RecordTerminationEvidenceInput): TerminationEvidenceRecord | null {
    if (!SAFE_TASK_ID.test(input.task_id) || !Number.isInteger(input.attempt) || input.attempt < 0) {
      throw new BridgeError(ErrorCode.INVALID_ARGUMENT, "evidence requires a valid task id and attempt", {
        task_id: input.task_id,
        attempt: input.attempt,
      });
    }
    const attempt = this.store.getAttempt(input.task_id, input.attempt);
    if (attempt === undefined) {
      throw new BridgeError(
        ErrorCode.NOT_FOUND,
        `attempt ${input.attempt} does not exist for ${input.task_id}`,
        { task_id: input.task_id, attempt: input.attempt },
      );
    }
    if (attempt.agent !== input.agent) {
      throw new BridgeError(ErrorCode.INVALID_ARGUMENT, "evidence agent does not match the attempt", {
        task_id: input.task_id,
        attempt: input.attempt,
      });
    }
    if (this.directory === null) return null;
    const existing = this.list(input.task_id).find((record) => record.attempt === input.attempt);
    if (existing !== undefined) return existing;

    const handles = this.store
      .listAttempts(input.task_id)
      .map((candidate) => candidate.execution_handle)
      .filter((handle): handle is string => typeof handle === "string" && handle.length > 0);
    const document = this.document(input, handles);
    const file = `${input.task_id}/attempt-${input.attempt}.json`;
    const path = join(this.directory, file);
    mkdirSync(join(this.directory, input.task_id), { recursive: true, mode: 0o700 });
    let content = `${JSON.stringify(document, null, 2)}\n`;
    try {
      writeFileSync(path, content, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // Another process wrote this attempt's file first; keep and index its content.
      content = readFileSync(path, "utf8");
    }

    const stored = JSON.parse(content) as {
      readonly termination_kind?: unknown;
      readonly reason?: unknown;
      readonly stderr?: { readonly total_bytes?: unknown; readonly truncated?: unknown };
    };
    const now = this.clock.now();
    const record: TerminationEvidenceRecord = {
      attempt: input.attempt,
      file,
      path,
      bytes: Buffer.byteLength(content, "utf8"),
      sha256: createHash("sha256").update(content, "utf8").digest("hex"),
      termination_kind: String(stored.termination_kind),
      reason: String(stored.reason),
      stderr_total_bytes: Number(stored.stderr?.total_bytes ?? 0),
      stderr_truncated: stored.stderr?.truncated === true,
      recorded_at: now,
    };
    this.store.appendEvent(
      {
        type: EventType.ATTEMPT_EVIDENCE_RECORDED,
        task_id: input.task_id,
        agent: input.agent,
        payload: {
          attempt: record.attempt,
          file: record.file,
          bytes: record.bytes,
          sha256: record.sha256,
          termination_kind: record.termination_kind,
          reason: record.reason,
          stderr_total_bytes: record.stderr_total_bytes,
          stderr_truncated: record.stderr_truncated,
        },
      },
      now,
    );
    return record;
  }

  /** Evidence metadata for a task, reconstructed from the event log. */
  list(task_id: TaskId): TerminationEvidenceRecord[] {
    return this.store
      .readEvents({ task_id, types: [EventType.ATTEMPT_EVIDENCE_RECORDED], limit: 1000 })
      .map((event) => {
        const payload = event.payload;
        const file = String(payload["file"]);
        return {
          attempt: Number(payload["attempt"]),
          file,
          path: this.directory === null ? null : join(this.directory, file),
          bytes: Number(payload["bytes"]),
          sha256: String(payload["sha256"]),
          termination_kind: String(payload["termination_kind"]),
          reason: String(payload["reason"]),
          stderr_total_bytes: Number(payload["stderr_total_bytes"]),
          stderr_truncated: payload["stderr_truncated"] === true,
          recorded_at: event.at,
        };
      });
  }

  /** Explicit projection: unknown keys, free-text labels and oversized values cannot pass. */
  private document(input: RecordTerminationEvidenceInput, handles: readonly string[]) {
    const evidence = input.evidence;
    const redacted = redact(typeof evidence.stderr?.tail === "string" ? evidence.stderr.tail : "", handles);
    const tail = utf8Tail(redacted.text, TERMINATION_EVIDENCE_STDERR_MAX_BYTES);
    const keptBytes = Buffer.byteLength(tail, "utf8");
    const reportedTotal = count(evidence.stderr?.total_bytes);
    const totalBytes = Math.max(reportedTotal ?? 0, Buffer.byteLength(redacted.text, "utf8"));
    return {
      schema: TERMINATION_EVIDENCE_SCHEMA,
      task_id: input.task_id,
      attempt: input.attempt,
      agent: input.agent,
      recorded_at: this.clock.now(),
      runtime: runtimeLabel(evidence.runtime),
      runtime_version: runtimeLabel(evidence.runtime_version),
      termination_kind: TERMINATION_KINDS.has(evidence.termination_kind)
        ? evidence.termination_kind
        : AttemptTerminationKind.UNKNOWN,
      reason: typeof evidence.reason === "string" && MACHINE_LABEL.test(evidence.reason)
        ? evidence.reason
        : "unknown",
      deadline_at: count(evidence.deadline_at),
      process: {
        exit_code: Number.isInteger(evidence.process?.exit_code) ? evidence.process.exit_code : null,
        signal: typeof evidence.process?.signal === "string" && SIGNAL_NAME.test(evidence.process.signal)
          ? evidence.process.signal
          : null,
        started_at: count(evidence.process?.started_at),
        ended_at: count(evidence.process?.ended_at),
        sigterm_sent: evidence.process?.sigterm_sent === true,
        sigkill_sent: evidence.process?.sigkill_sent === true,
      },
      stream: {
        stdout_bytes: count(evidence.stream?.stdout_bytes),
        frames: count(evidence.stream?.frames),
        frame_types: frameTypes(evidence.stream?.frame_types),
        first_output_at: count(evidence.stream?.first_output_at),
        last_frame_at: count(evidence.stream?.last_frame_at),
        result_frame: evidence.stream?.result_frame === true,
      },
      stderr: {
        total_bytes: totalBytes,
        kept_bytes: keptBytes,
        truncated: totalBytes > keptBytes,
        redactions: redacted.count,
        tail,
      },
    };
  }
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function runtimeLabel(value: unknown): string | null {
  if (typeof value !== "string" || !RUNTIME_LABEL.test(value)) return null;
  return SECRET_PATTERNS.some(({ re }) => re.test(value)) ? null : value;
}

function frameTypes(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_FRAME_TYPES) break;
    const amount = count(raw);
    if (MACHINE_LABEL.test(key) && amount !== null) out[key] = amount;
  }
  return out;
}

/** Replace session handles and known credential shapes; count what was replaced. */
function redact(text: string, handles: readonly string[]): { text: string; count: number } {
  let result = text;
  let replaced = 0;
  for (const handle of new Set(handles)) {
    const parts = result.split(handle);
    replaced += parts.length - 1;
    result = parts.join("[redacted:session]");
  }
  for (const { label, re } of SECRET_PATTERNS) {
    const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    result = result.replace(global, () => {
      replaced += 1;
      return `[redacted:${label}]`;
    });
  }
  return { text: result, count: replaced };
}

/** The last `maxBytes` of `text`, cut on a UTF-8 code-point boundary. */
function utf8Tail(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= maxBytes) return text;
  let start = bytes.length - maxBytes;
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++;
  return bytes.subarray(start).toString("utf8");
}
