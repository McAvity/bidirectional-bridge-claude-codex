// Privacy projection of the incident export (wave13 §4).
//
// Two rules, applied to everything that reaches a package:
//
//  - **allowlist, never denylist.** Each record type has a fixed list of fields; anything else,
//    including every free-text field the control plane stores (objectives, scopes, questions,
//    answers, blockers, reasons, verification output), is dropped before it can be written. A new
//    column in the database therefore does not silently start leaking into packages.
//  - **aliases instead of local identity.** Absolute paths are replaced by stable aliases so the
//    correlation inside one package survives, while the user's home, worktree and temp paths do
//    not leave the machine. The alias map is derived, never written into the package.
//
// Redaction here is a guardrail, not a guarantee: a manager that puts content into an identifier
// still puts it in the package, which is why the manifest says so in plain words.

import { createHash } from "node:crypto";

/** Longest a projected string may be before it is cut; identifiers are far shorter. */
const MAX_TEXT = 200;
/** Known credential shapes, kept in step with the evidence store's guardrail. */
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
 * Named roots (`<workspace>`, `<home>`, `<runtimes>`, `<exchange>`) keep a package readable;
 * every other absolute path becomes `<path-N>`, numbered in first-seen order so two mentions of
 * the same directory stay recognisably the same directory.
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

  const text = (value) => {
    if (typeof value !== "string" || value.length === 0) return value;
    let out = value;
    for (const { label, re } of SECRET_PATTERNS) {
      out = out.replace(new RegExp(re.source, re.flags), `[redacted:${label}]`);
    }
    // Absolute POSIX paths anywhere inside a string, not only whole-string values. The
    // lookbehind keeps a relative fragment (`task_x/attempt-0.json`) intact: only a path that
    // really starts at the root is local identity worth hiding.
    out = out.replace(/(?<![A-Za-z0-9._@+-])\/[A-Za-z0-9._@+-]+(?:\/[A-Za-z0-9._@+-]+)*/gu, (match) => aliasPath(match));
    return out.length > MAX_TEXT ? `${out.slice(0, MAX_TEXT)}~` : out;
  };

  return {
    path: (value) => (typeof value === "string" ? text(value) : null),
    text,
    /** Number of generic aliases handed out; the manifest reports it, the map stays here. */
    get count() {
      return generic.size;
    },
  };
}

/** Scalar projection: numbers and booleans pass, strings are aliased, everything else is null. */
function scalar(value, aliases) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return aliases.text(value);
  return null;
}

/** Keep only `fields` of `record`, projected. Unknown fields cannot reach the package. */
export function pick(record, fields, aliases) {
  const out = {};
  for (const field of fields) out[field] = scalar(record?.[field], aliases);
  return out;
}

export const TASK_FIELDS = [
  "task_id",
  "run_id",
  "parent_task_id",
  "delegation_depth",
  "state",
  "owner",
  "created_by",
  "created_at",
  "updated_at",
  "claimed_at",
  "completed_at",
  "version",
  "attempt",
];

export const ATTEMPT_FIELDS = [
  "task_id",
  "attempt",
  "agent",
  "resumed_from_attempt",
  "started_at",
  "updated_at",
  "ended_at",
  "outcome",
];

export const TELEMETRY_FIELDS = [
  "task_id",
  "attempt",
  "run_id",
  "agent",
  "runtime",
  "runtime_version",
  "requested_model",
  "model",
  "delegation_depth",
  "orchestration_started_at",
  "runtime_started_at",
  "first_output_at",
  "runtime_ended_at",
  "completed_at",
  "wall_duration_ms",
  "runtime_duration_ms",
  "input_tokens",
  "output_tokens",
  "num_turns",
  "termination_kind",
  "outcome",
  "error_code",
];

/**
 * Event payload keys that may appear in a package.
 *
 * Every one of them is an identifier, a count, a machine label or a hash. Free-text payload
 * fields the control plane also stores — `reason`, `message`, `question`, `answer`, `blockers`,
 * `objective` — are absent on purpose and are reported as withheld in the manifest.
 */
export const EVENT_PAYLOAD_FIELDS = [
  "attempt",
  "attempts",
  "previous_attempt",
  "recovered_attempt",
  "resumed_from_attempt",
  "status",
  "state",
  "from",
  "to",
  "code",
  "outcome",
  "termination_kind",
  "same_execution_handle",
  "authorization_kind",
  "requested_by",
  "retryable",
  "deadline_ms",
  "max_turns",
  "file",
  "bytes",
  "sha256",
  "stderr_total_bytes",
  "stderr_truncated",
  "feature_id",
  "task_id",
  "epoch",
  "instance_generation",
  "duration_ms",
  "artifacts",
];

/** One event, projected: envelope fields plus an allowlisted, scalar-only payload. */
export function projectEvent(row, aliases) {
  let payload = {};
  let payloadError = null;
  try {
    const parsed = JSON.parse(row.payload_json ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const field of EVENT_PAYLOAD_FIELDS) {
        if (parsed[field] === undefined) continue;
        const value = parsed[field];
        payload[field] = Array.isArray(value) ? value.length : scalar(value, aliases);
      }
    }
  } catch (error) {
    payloadError = String(error.message).slice(0, 120);
    payload = {};
  }
  return {
    event_id: row.event_id,
    at: row.at,
    type: aliases.text(String(row.type)),
    task_id: row.task_id ?? null,
    agent: row.agent ?? null,
    payload,
    ...(payloadError ? { payload_unreadable: payloadError } : {}),
  };
}

/** A diagnostics log record, projected. The logger already allowlists; this re-checks and aliases. */
export const LOG_FIELDS = [
  "schema",
  "ts",
  "seq",
  "mono_ms",
  "pid",
  "instance",
  "role",
  "source",
  "runtime",
  "workspace",
  "op",
  "event",
  "tool",
  "outcome",
  "code",
  "phase",
  "request_id",
  "duration_ms",
  "feature_id",
  "task_id",
  "attempt",
  "truncated",
];

export function projectLogRecord(record, aliases) {
  const out = pick(record, LOG_FIELDS, aliases);
  const details = record?.details;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const projected = {};
    for (const [key, value] of Object.entries(details)) {
      if (!/^[a-z][a-z0-9_]{0,31}$/u.test(key)) continue;
      projected[key] = scalar(value, aliases);
    }
    out.details = projected;
  } else {
    out.details = null;
  }
  return out;
}

/** Doctor check, projected to the safe subset: ids, machine codes and an aliased summary. */
export function projectDoctorCheck(check, aliases) {
  return {
    id: check.id,
    status: check.status,
    code: check.code,
    summary: aliases.text(String(check.summary ?? "")),
    next_step: check.next_step ? aliases.text(String(check.next_step)) : null,
  };
}

/** Stable short digest used where a value correlates but must not travel verbatim. */
export function digest(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex").slice(0, 12);
}
