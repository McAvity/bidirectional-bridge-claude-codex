// The privacy boundary of the incident export (wave13 §4, review R2-01).
//
// Everything that reaches a package passes through `projectRecord` exactly once. There is no
// second path: the manifest, the gaps, the timeline, the evidence metadata, the versions, the
// doctor subset and every record share these rules.
//
//  - **Allowlisted keys.** Each part of the result declares a spec: which fields exist and what
//    each one is. A field that is not in the spec cannot appear, so a new column, a new log
//    detail or a new payload key does not silently start travelling. What was dropped is
//    reported as a count, never as a name/value pair.
//  - **Typed values.** Every value must match its declared type — an identifier, a machine
//    label, a count, a flag, a timestamp, a hex digest, a bounded file name or an aliased path.
//    A value that does not match is replaced by the constant `"invalid"`; the original is never
//    written, not even truncated. This is what stops free text from riding along inside a field
//    that happens to be allowed.
//  - **No error text.** A parse failure becomes a stable code (`unparsable`), never the parser's
//    message, because that message quotes the input.
//
// Redaction of known credential shapes stays as a second guardrail for the few aliased-path and
// label fields, but the package does not rely on it: the type rules decide what may pass.

import { createHash } from "node:crypto";

/** A repository identifier: task, run, feature, instance, agent. */
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
/** A machine label: a state, an error code, a termination kind, an authored short reason. */
const LABEL = /^[A-Za-z0-9][A-Za-z0-9 ._:+-]{0,63}$/u;
/** A hex digest or a short reference. */
const HEX = /^[0-9a-f]{6,64}$/u;
/** A file name produced by the bridge itself. */
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
/** An evidence file: `<task id>/attempt-<n>.json`. */
const EVIDENCE_FILE = /^[A-Za-z0-9_-]{1,128}\/attempt-\d{1,6}\.json$/u;
/** An ISO instant, the only date shape a package carries. */
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
/** A semantic-ish version or a runtime id. */
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u;

/** Value that failed its declared type. The original is never written. */
export const INVALID = "invalid";

/**
 * Closed vocabularies of the fields that come from the diagnosed state.
 *
 * A shape rule alone cannot separate a bridge error code from an arbitrary token that happens to
 * look like one — review R2-01 planted exactly such a token in `details.reason` — so the fields
 * whose domain the bridge itself defines are checked against that domain. A value outside it is
 * reported as `"invalid"`: honest for a package produced by a newer runtime with a new code, and
 * closed against anything the state was made to carry.
 */
const VOCABULARY = {
  task_state: new Set(["PENDING", "CLAIMED", "WORKING", "VERIFYING", "BLOCKED", "DONE", "FAILED", "CANCELLED"]),
  deliverable_status: new Set(["COMPLETE", "PARTIAL", "FAILED", "BLOCKED"]),
  error_code: new Set([
    "INVALID_ARGUMENT", "NOT_FOUND", "ILLEGAL_TRANSITION", "NOT_OWNER", "SCOPE_CONFLICT", "LEASE_INVALID",
    "DEPENDENCY_UNSATISFIED", "DEPENDENCY_CYCLE", "IDEMPOTENCY_MISMATCH", "TIMEOUT", "ADAPTER_FAILURE",
    "RUNTIME_PROFILE_MISMATCH", "UNIMPLEMENTED", "WORKSPACE_MISMATCH", "NATIVE_CONTEXT_INVALID",
    "MANAGER_FOREIGN_THREAD", "MANAGER_INSTANCE_FENCED", "MANAGER_FENCED", "FEATURE_CONFLICT",
    "STATE_LOCKED", "INTERNAL",
  ]),
  termination_kind: new Set(["completed", "timeout", "cancelled", "crash", "failed", "unknown"]),
  feature_state: new Set(["ready", "running", "awaiting_review", "waiting_user", "blocked", "accepted"]),
  phase: new Set([
    "startup", "shutdown", "guard", "handler", "runtime", "deadline", "evidence", "bookkeeping", "unguarded",
  ]),
  op: new Set(["process", "tool", "manager", "attempt", "adapter", "log"]),
  any_state: new Set([
    "PENDING", "CLAIMED", "WORKING", "VERIFYING", "BLOCKED", "DONE", "FAILED", "CANCELLED",
    "ready", "running", "awaiting_review", "waiting_user", "blocked", "accepted",
  ]),
  log_event: new Set([
    "start", "serving", "stop", "warning", "transport.failed", "authorized", "instance.detached",
    "instance.detach_failed", "call.finished", "dispose.failed", "rotated", "retention", "close",
    "started", "finished", "evidence.recorded", "evidence.write_failed", "telemetry.write_failed",
  ]),
  outcome: new Set(["ok", "error", "refused"]),
  agent: new Set(["claude", "codex", "bridge", "orchestrator"]),
  journal_mode: new Set(["wal", "delete", "truncate", "persist", "memory", "off", "WAL", "DELETE"]),
  recovery_mode: new Set(["timeout", "owner", "delegated_manager"]),
  doctor_status: new Set(["ok", "warn", "error", "unknown", "skipped"]),
};

/** An attempt outcome is a status or an error code; both domains are closed. */
const ATTEMPT_OUTCOMES = new Set([...VOCABULARY.deliverable_status, ...VOCABULARY.error_code]);
/** A shutdown or termination reason the bridge itself writes. */
const REASONS = new Set(["transport closed", "startup failure", "SIGINT", "SIGTERM"]);
const MACHINE_REASON = /^[a-z][a-z0-9_]{0,31}$/u;
/** An errno name, the only "code" a filesystem failure contributes. */
const ERRNO = /^E[A-Z]{1,15}$/u;
/** A tool of this bridge. */
const TOOL = /^bridge_[a-z_]{1,48}$/u;
/** A database event type: dotted lowercase, as the control plane defines them. */
const EVENT_TYPE = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/u;

const SECRET_PATTERNS = [
  { label: "openai-key", re: /\bsk-[A-Za-z0-9_-]{16,}/gu },
  { label: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{16,}/gu },
  { label: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{16,}/gu },
  { label: "aws-key", re: /\bAKIA[0-9A-Z]{12,}/gu },
  { label: "bearer", re: /\bBearer\s+[A-Za-z0-9._-]{12,}/giu },
  { label: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/gu },
];

/**
 * Deterministic alias projector for one package.
 *
 * Named roots keep a package readable; every other absolute path becomes `<path-N>`, numbered in
 * first-seen order, so two mentions of one directory stay recognisably the same directory. The
 * map is derived here and never written into the package.
 */
export function createAliases(roots = {}) {
  const named = Object.entries(roots)
    .filter(([, value]) => typeof value === "string" && value.length > 1)
    .map(([label, value]) => ({ label: `<${label}>`, value }))
    // Longest first: `<workspace>` must win over the `<home>` that contains it.
    .sort((a, b) => b.value.length - a.value.length);
  const generic = new Map();

  const aliasPath = (path) => {
    for (const { label, value } of named) {
      if (path === value) return label;
      if (path.startsWith(`${value}/`)) return `${label}${path.slice(value.length)}`;
    }
    const known = [...generic.entries()].find(([value]) => path === value || path.startsWith(`${value}/`));
    if (known) return path === known[0] ? known[1] : `${known[1]}${path.slice(known[0].length)}`;
    const label = `<path-${generic.size + 1}>`;
    generic.set(path, label);
    return label;
  };

  /** Only for the few fields declared as `path`: alias the roots, then bound what remains. */
  const path = (value) => {
    if (typeof value !== "string" || value.length === 0) return null;
    let out = value;
    for (const { label, re } of SECRET_PATTERNS) {
      out = out.replace(new RegExp(re.source, re.flags), `[redacted:${label}]`);
    }
    out = out.replace(/(?<![A-Za-z0-9._@+-])\/[A-Za-z0-9._@+-]+(?:\/[A-Za-z0-9._@+-]+)*/gu, (match) => aliasPath(match));
    // A "path" that still shows no alias is not a path this package should carry.
    if (!out.startsWith("<")) return INVALID;
    return out.length > 200 ? `${out.slice(0, 200)}~` : out;
  };

  return {
    path,
    get count() {
      return generic.size;
    },
  };
}

/** Project one value against its declared type. Anything unexpected becomes `INVALID`. */
export function projectField(value, type, aliases) {
  if (value === null || value === undefined) return null;
  switch (type) {
    case "id":
      return typeof value === "string" && ID.test(value) ? value : INVALID;
    case "label":
      return typeof value === "string" && LABEL.test(value) ? value : INVALID;
    case "task_state":
    case "deliverable_status":
    case "termination_kind":
    case "feature_state":
    case "phase":
    case "op":
    case "any_state":
    case "log_event":
    case "outcome":
    case "agent":
    case "journal_mode":
    case "recovery_mode":
    case "doctor_status":
      return typeof value === "string" && VOCABULARY[type].has(value) ? value : INVALID;
    case "attempt_outcome":
      return typeof value === "string" && ATTEMPT_OUTCOMES.has(value) ? value : INVALID;
    case "code":
      // An operation code: a bridge error code, an attempt status or an errno of a failed read.
      return typeof value === "string" && (ATTEMPT_OUTCOMES.has(value) || ERRNO.test(value) || value === "SQLITE_ERROR" || value === "SQLITE_CANTOPEN" || value === "ESHORTWRITE")
        ? value
        : INVALID;
    case "reason":
      return typeof value === "string" && (REASONS.has(value) || MACHINE_REASON.test(value)) ? value : INVALID;
    case "tool":
      return typeof value === "string" && TOOL.test(value) ? value : INVALID;
    case "event_type":
      return typeof value === "string" && EVENT_TYPE.test(value) ? value : INVALID;
    case "version":
      return typeof value === "string" && VERSION.test(value) ? value : INVALID;
    case "hex":
      return typeof value === "string" && HEX.test(value) ? value : INVALID;
    case "sha256":
      return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value) ? value : INVALID;
    case "file":
      return typeof value === "string" && FILE_NAME.test(value) ? value : INVALID;
    case "evidence_file":
      return typeof value === "string" && EVIDENCE_FILE.test(value) ? value : INVALID;
    case "count":
      return typeof value === "number" && Number.isFinite(value) ? value : INVALID;
    case "flag":
      return typeof value === "boolean" ? value : INVALID;
    case "epoch_ms":
      // Stored as epoch milliseconds; a package carries instants, so it is projected as one.
      return typeof value === "number" && Number.isFinite(value) && value >= 0
        ? new Date(value).toISOString()
        : INVALID;
    case "iso":
      return typeof value === "string" && ISO.test(value) ? value : INVALID;
    case "path":
      return aliases.path(value);
    case "list_size":
      return Array.isArray(value) ? value.length : INVALID;
    case "id_list":
      return Array.isArray(value)
        ? value.slice(0, 200).map((entry) => (typeof entry === "string" && ID.test(entry) ? entry : INVALID))
        : INVALID;
    default:
      return INVALID;
  }
}

/**
 * Project a record against a spec `{ field: type }`.
 *
 * Fields the spec does not mention are counted, never named: `dropped_fields` says how many
 * there were, which is enough to notice that a source grew a field without leaking what it is.
 * Fields that were absent or null are omitted from the result.
 */
export function projectRecord(record, spec, aliases, { countDropped = true } = {}) {
  const out = {};
  const source = record && typeof record === "object" && !Array.isArray(record) ? record : {};
  for (const [field, type] of Object.entries(spec)) {
    const value = projectField(source[field], type, aliases);
    // A field that was absent or null is omitted rather than written as a null: the spec above
    // is the record's schema, so "not here" is unambiguous and a package stays readable.
    if (value !== null) out[field] = value;
  }
  if (countDropped) {
    const extra = Object.keys(source).filter((key) => !(key in spec)).length;
    if (extra > 0) out.dropped_fields = extra;
  }
  return out;
}

export const TASK_SPEC = {
  task_id: "id",
  run_id: "id",
  parent_task_id: "id",
  delegation_depth: "count",
  state: "task_state",
  owner: "agent",
  created_by: "agent",
  created_at: "epoch_ms",
  updated_at: "epoch_ms",
  claimed_at: "epoch_ms",
  completed_at: "epoch_ms",
  version: "count",
  attempt: "count",
};

export const ATTEMPT_SPEC = {
  task_id: "id",
  attempt: "count",
  agent: "agent",
  resumed_from_attempt: "count",
  started_at: "epoch_ms",
  updated_at: "epoch_ms",
  ended_at: "epoch_ms",
  outcome: "attempt_outcome",
};

export const TELEMETRY_SPEC = {
  task_id: "id",
  attempt: "count",
  run_id: "id",
  agent: "agent",
  runtime: "label",
  runtime_version: "version",
  requested_model: "label",
  model: "label",
  delegation_depth: "count",
  orchestration_started_at: "epoch_ms",
  runtime_started_at: "epoch_ms",
  first_output_at: "epoch_ms",
  runtime_ended_at: "epoch_ms",
  completed_at: "epoch_ms",
  wall_duration_ms: "count",
  runtime_duration_ms: "count",
  input_tokens: "count",
  output_tokens: "count",
  num_turns: "count",
  termination_kind: "termination_kind",
  outcome: "attempt_outcome",
  error_code: "code",
};

/** Envelope of one event; the payload has its own spec. */
export const EVENT_SPEC = {
  event_id: "count",
  at: "epoch_ms",
  type: "event_type",
  task_id: "id",
  agent: "agent",
};

/**
 * Event payload keys that may appear, with their types.
 *
 * Every one is an identifier, a count, a machine label or a hash. The free-text payload fields
 * the control plane also stores — `reason`, `message`, `question`, `answer`, `blockers`,
 * `objective` — are absent on purpose and are reported as withheld in the manifest.
 */
export const EVENT_PAYLOAD_SPEC = {
  attempt: "count",
  attempts: "count",
  previous_attempt: "count",
  recovered_attempt: "count",
  resumed_from_attempt: "count",
  status: "deliverable_status",
  // A feature event carries a feature state, a task event a task state.
  state: "any_state",
  from: "any_state",
  to: "any_state",
  code: "code",
  outcome: "attempt_outcome",
  termination_kind: "termination_kind",
  same_execution_handle: "flag",
  authorization_kind: "reason",
  requested_by: "agent",
  retryable: "flag",
  deadline_ms: "count",
  max_turns: "count",
  file: "evidence_file",
  bytes: "count",
  sha256: "sha256",
  stderr_total_bytes: "count",
  stderr_truncated: "flag",
  feature_id: "id",
  task_id: "id",
  epoch: "count",
  instance_generation: "count",
  duration_ms: "count",
  artifacts: "list_size",
};

/** Envelope of one diagnostics log record. */
export const LOG_SPEC = {
  schema: "id",
  ts: "iso",
  seq: "count",
  mono_ms: "count",
  pid: "count",
  instance: "id",
  role: "label",
  source: "version",
  runtime: "version",
  workspace: "id",
  op: "op",
  event: "log_event",
  tool: "tool",
  outcome: "outcome",
  code: "code",
  phase: "phase",
  request_id: "count",
  duration_ms: "count",
  feature_id: "id",
  task_id: "id",
  attempt: "count",
  truncated: "flag",
};

/**
 * Log `details` keys that may appear, with their types.
 *
 * This is the list the runtime actually writes (see `diagnostics-log.ts` and its callers), not
 * "any scalar with a tidy key name". `message` of a control-plane warning is deliberately absent:
 * it is authored prose, and prose does not travel in a default package.
 */
export const LOG_DETAIL_SPEC = {
  aborted: "flag",
  actual: "journal_mode",
  agent: "agent",
  armed_by: "tool",
  attempt: "count",
  bytes: "count",
  changed: "flag",
  continuation: "flag",
  deadline_ms: "count",
  deferred: "count",
  deferred_records: "count",
  deleted_files: "count",
  dropped_fields: "count",
  epoch: "count",
  failures: "count",
  // `attempt.evidence.recorded` names an evidence file; the logger's own files are rotations.
  file: "evidence_file",
  file_bytes: "count",
  idempotency_ref: "hex",
  instance_generation: "count",
  label: "label",
  max_age_ms: "count",
  max_file_bytes: "count",
  max_files: "count",
  max_record_bytes: "count",
  max_total_bytes: "count",
  max_turns: "count",
  newest_deleted: "file",
  noted: "count",
  oldest_deleted: "file",
  outcome: "attempt_outcome",
  parent_task_id: "id",
  previous_file: "file",
  reason: "reason",
  records: "count",
  recovered_attempt: "count",
  recovery: "flag",
  recovery_mode: "recovery_mode",
  requested: "journal_mode",
  resumed_from_attempt: "count",
  retained_bytes: "count",
  role: "agent",
  rotations: "count",
  run_id: "id",
  runtime_ms: "count",
  same_execution_handle: "flag",
  started_at: "iso",
  // A call's result state is a task state or a feature state, depending on the tool.
  state: "any_state",
  status: "deliverable_status",
  stderr_truncated: "flag",
  target_agent: "agent",
  termination_kind: "termination_kind",
  thread_ref: "hex",
  tools: "count",
};

export const DOCTOR_SPEC = { id: "label", status: "doctor_status", code: "label", summary: "path", next_step: "path" };

export const EVIDENCE_SPEC = {
  task_id: "id",
  attempt: "count",
  file: "evidence_file",
  bytes: "count",
  sha256: "sha256",
  termination_kind: "termination_kind",
  reason: "reason",
  stderr_total_bytes: "count",
  stderr_kept_bytes: "count",
  stderr_truncated: "flag",
  included_in_package: "flag",
};

/**
 * A gap: what is missing and why, in machine terms only.
 *
 * `detail` is not a message — an error message quotes its input. A gap carries the errno-style
 * code, the bridge-generated file name it concerns, and a count.
 */
export const GAP_SPEC = { part: "label", reason: "label", code: "code", file: "file", count: "count" };

export const LOG_FILE_SPEC = {
  file: "file",
  bytes: "count",
  bytes_read: "count",
  read_from: "count",
  truncated: "flag",
  modified_at: "epoch_ms",
  inode: "count",
  changed_during_export: "flag",
  partial_last_line: "flag",
};

export const FEATURE_SPEC = {
  feature_id: "id",
  state: "feature_state",
  manager: "agent",
  parent_task_id: "id",
  latest_task_id: "id",
  active_task_id: "id",
  task_ids: "id_list",
  updated_at: "epoch_ms",
  workspace_id: "id",
  manager_epoch: "count",
  question_present: "flag",
};

/** Stable short digest where a value correlates but must not travel verbatim. */
export function digest(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex").slice(0, 12);
}

/** One projected gap. Callers pass machine fields only; anything else is dropped by the spec. */
export function gap(part, reason, extra = {}) {
  return { part, reason, ...extra };
}
