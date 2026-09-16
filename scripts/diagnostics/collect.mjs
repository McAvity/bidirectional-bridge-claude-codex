// Incident export (wave13 §3): one local package with enough evidence to reconstruct a stuck
// round, and nothing more.
//
// Order: resolve the worktree with this CLI's own trusted build, take a private consistent
// SQLite snapshot through the backup API (WAL included), read the selected scope out of that
// snapshot, read the worktree's own diagnostics logs through the safe-read boundary, reuse
// doctor's safe subset, and publish one ZIP into the worktree's exchange namespace.
//
// What it must never do, and what the tests pin:
//
//  - **execute anything the diagnosed worktree chose.** The identity resolver, the doctor and
//    every module this file loads come from this CLI's own build. `.bridge-runtime/current` of
//    the worktree is data to describe, never code to run (review R2-04);
//  - **follow a link, or read outside the worktree.** Every read goes through `safe-read.mjs`:
//    no path component may be a symlink, only regular files are opened, and every read is
//    bounded and described (review R2-02, R2-05);
//  - **change the source.** The database, the logs, the evidence and the feature state are read
//    only; the export's own writes are its private staging directory and the published package,
//    which is linked into place so a collision is refused instead of overwritten;
//  - **claim completeness it cannot have.** The database, the logs and the processes have
//    separate cutoffs; every missing, truncated or changed part is a machine-readable gap.
//
// Default content is an allowlist with typed values (see project.mjs). The raw database and the
// runtime stderr need an explicit extension flag and are named in the manifest.

import { existsSync, linkSync, mkdirSync, readFileSync, rmSync, statSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SetupError, newTag, sha256 } from "../setup/common.mjs";
import { runDoctor } from "../setup/doctor.mjs";
import { loadControlPlane, readRecord, readSelection } from "../setup/workspace.mjs";
import {
  ATTEMPT_SPEC,
  DOCTOR_SPEC,
  EVENT_PAYLOAD_SPEC,
  EVENT_SPEC,
  EVIDENCE_SPEC,
  FEATURE_SPEC,
  GAP_SPEC,
  LOG_DETAIL_SPEC,
  LOG_FILE_SPEC,
  LOG_SPEC,
  TASK_SPEC,
  TELEMETRY_SPEC,
  createAliases,
  digest,
  projectField,
  projectRecord,
} from "./project.mjs";
import { UnsafePathError, assertUnderRoot, fileIdentity, identityChanged, readBounded, safeListDirectory } from "./safe-read.mjs";
import { MAX_ENTRY_BYTES, readZip, writeZip } from "./zip.mjs";

const require_ = createRequire(import.meta.url);
const { DatabaseSync, backup } = require_("node:sqlite");

/** This CLI's own root. Everything the exporter executes comes from here. */
const ownRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const DIAGNOSTICS_FORMAT = "claude-codex-bridge.diagnostics/v1";
/** Bytes read per log file, from its end. A longer file is reported as a truncated prefix. */
export const MAX_LOG_BYTES = 1024 * 1024;
/** Upper bound on records of one kind in a package; reaching it is reported, never silent. */
export const MAX_RECORDS = 5_000;
/** Upper bound on tasks a time window may pull in; reaching it is reported. */
export const MAX_WINDOW_TASKS = 50;
const LOG_FILE = /^bridge-\d{8}T\d{6}Z-[0-9a-f]{4,32}-\d{2,6}\.jsonl$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;

const iso = (ms) => (typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : null);

/** Collect gaps as machine facts: a part, a reason, and at most a code, a file name and a count. */
class Gaps {
  constructor() {
    this.entries = [];
  }

  add(part, reason, extra = {}) {
    this.entries.push({ part, reason, ...extra });
  }

  /** Translate an unsafe-path refusal into a gap without ever copying its message. */
  addUnsafe(part, error, file) {
    this.entries.push({
      part,
      reason: error instanceof UnsafePathError ? error.reason : "unreadable",
      ...(error?.code ? { code: error.code } : {}),
      ...(file ? { file } : {}),
    });
  }

  projected(aliases) {
    return this.entries.map((entry) => projectRecord(entry, GAP_SPEC, aliases, { countDropped: false }));
  }
}

function parseSince(value, now) {
  if (value === undefined) return null;
  const relative = /^(\d+)([mhd])$/u.exec(String(value).trim());
  if (relative) {
    const factor = { m: 60_000, h: 3_600_000, d: 86_400_000 }[relative[2]];
    return now - Number(relative[1]) * factor;
  }
  const parsed = Date.parse(String(value));
  if (Number.isNaN(parsed)) {
    throw new SetupError("DIAGNOSE_SCOPE_INVALID", `--since expects an ISO timestamp or 30m/6h/2d, not '${value}'`, {
      nextStep: "pass --since 2h or --since 2026-09-16T06:00:00Z",
    });
  }
  return parsed;
}

/** Read-only query helper: a SQL failure becomes a recorded gap, never a crash or a message. */
function queryAll(db, sql, params, gaps, part) {
  try {
    return db.prepare(sql).all(...(params ?? []));
  } catch (error) {
    gaps.add(part, "unreadable", { code: error?.code ?? "SQLITE_ERROR" });
    return [];
  }
}

/**
 * Private consistent copy of the database through the backup API, so a live WAL writer is
 * included and the source is never copied file by file. The copy is checkpointed into one file
 * and integrity-checked; the source keeps running and is never written.
 */
async function snapshotDatabase(databasePath, target, gaps) {
  if (!existsSync(databasePath)) {
    gaps.add("database", "absent");
    return null;
  }
  let source;
  try {
    source = new DatabaseSync(databasePath, { readOnly: true });
  } catch (error) {
    gaps.add("database", "unopenable", { code: error?.code ?? "SQLITE_CANTOPEN" });
    return null;
  }
  try {
    await backup(source, target);
  } catch (error) {
    gaps.add("database", "backup_failed", { code: error?.code ?? "SQLITE_ERROR" });
    return null;
  } finally {
    try {
      source.close();
    } catch {
      /* already closed */
    }
  }
  let integrity = "unknown";
  try {
    const copy = new DatabaseSync(target);
    copy.exec("PRAGMA journal_mode = DELETE");
    const row = copy.prepare("PRAGMA integrity_check").get();
    integrity = String(row?.integrity_check ?? "unknown");
    copy.close();
  } catch (error) {
    integrity = "unreadable";
    gaps.add("database_snapshot", "integrity_unknown", { code: error?.code ?? "SQLITE_ERROR" });
  }
  if (integrity !== "ok") gaps.add("database_snapshot", "integrity_failed");
  return { path: target, integrity, bytes: statSync(target).size, taken_at: Date.now() };
}

/**
 * Resolve the scope once, from the snapshot, for every source.
 *
 * A named feature or task that does not exist is a refusal, not a silent widening: exporting
 * "whatever else happened around then" is exactly what review R2-03 rejected.
 */
function resolveScope(db, request, gaps) {
  const scope = {
    kind: request.kind,
    feature_id: request.feature_id,
    attempt: request.attempt,
    since: request.since,
    task_ids: [],
    window_task_limit_reached: false,
  };
  if (db === null) {
    // Without a database the scope is whatever the logs of that window hold; a named scope
    // cannot be resolved at all and keeps only the identifier it was given.
    scope.task_ids = request.task_id ? [request.task_id] : [];
    return scope;
  }
  if (scope.kind === "feature") {
    const row = queryAll(db, "SELECT json FROM features WHERE feature_id = ?", [scope.feature_id], gaps, "feature")[0];
    if (!row) {
      throw new SetupError("DIAGNOSE_SCOPE_NOT_FOUND", `no feature '${scope.feature_id}' in this worktree`, {
        nextStep: "run diagnose without a scope to list the features this worktree has",
      });
    }
    let feature;
    try {
      feature = JSON.parse(row.json);
    } catch {
      gaps.add("feature", "unparsable");
      feature = null;
    }
    const ids = feature ? [...(feature.task_ids ?? []), feature.parent_task_id] : [];
    scope.task_ids = [...new Set(ids.filter((id) => typeof id === "string" && SAFE_ID.test(id)))];
    scope.feature = feature;
    return scope;
  }
  if (scope.kind === "task") {
    const row = queryAll(db, "SELECT task_id FROM tasks WHERE task_id = ?", [request.task_id], gaps, "task")[0];
    if (!row) {
      throw new SetupError("DIAGNOSE_SCOPE_NOT_FOUND", `no task '${request.task_id}' in this worktree`, {
        nextStep: "run diagnose without a scope to list recent tasks",
      });
    }
    scope.task_ids = [request.task_id];
    return scope;
  }
  // Window: the tasks are whichever ones the window touched, bounded and reported.
  const rows = queryAll(
    db,
    `SELECT DISTINCT task_id FROM events WHERE at >= ? AND task_id IS NOT NULL ORDER BY task_id LIMIT ${MAX_WINDOW_TASKS + 1}`,
    [scope.since],
    gaps,
    "events",
  );
  scope.task_ids = rows.slice(0, MAX_WINDOW_TASKS).map((row) => row.task_id).filter((id) => SAFE_ID.test(id));
  if (rows.length > MAX_WINDOW_TASKS) {
    scope.window_task_limit_reached = true;
    gaps.add("scope", "window_task_limit", { count: MAX_WINDOW_TASKS });
  }
  return scope;
}

/** Everything the package says about the database, read from the private copy only. */
function collectState(snapshot, request, gaps) {
  const empty = {
    scope: { ...request, task_ids: request.task_id ? [request.task_id] : [], window_task_limit_reached: false },
    feature: null,
    tasks: [],
    attempts: [],
    telemetry: [],
    events: [],
    binding: null,
    manager: null,
    schema_version: null,
    last_event_id: null,
    truncated: {},
    available: { features: [], tasks: [] },
  };
  if (!snapshot) return empty;
  let db;
  try {
    db = new DatabaseSync(snapshot.path, { readOnly: true });
  } catch (error) {
    gaps.add("database_snapshot", "unopenable", { code: error?.code ?? "SQLITE_CANTOPEN" });
    return empty;
  }
  try {
    const scope = resolveScope(db, request, gaps);
    const ids = scope.task_ids;
    const placeholders = ids.map(() => "?").join(", ");
    const inScopeTasks = ids.length > 0 ? `task_id IN (${placeholders})` : "0";
    const attemptFilter = scope.attempt === null ? "" : " AND attempt = ?";
    const attemptParam = scope.attempt === null ? [] : [scope.attempt];

    const tasks = ids.length > 0 ? queryAll(db, `SELECT * FROM tasks WHERE ${inScopeTasks}`, ids, gaps, "tasks") : [];
    for (const id of ids) {
      if (!tasks.some((task) => task.task_id === id)) gaps.add("task", "absent");
    }
    const attempts = ids.length > 0
      ? queryAll(
          db,
          `SELECT * FROM task_attempts WHERE ${inScopeTasks}${attemptFilter} ORDER BY task_id, attempt`,
          [...ids, ...attemptParam],
          gaps,
          "task_attempts",
        )
      : [];
    const telemetryRows = ids.length > 0
      ? queryAll(
          db,
          `SELECT json FROM attempt_telemetry WHERE ${inScopeTasks}${attemptFilter}`,
          [...ids, ...attemptParam],
          gaps,
          "attempt_telemetry",
        )
      : [];
    const telemetry = [];
    for (const row of telemetryRows) {
      try {
        telemetry.push(JSON.parse(row.json));
      } catch {
        gaps.add("attempt_telemetry", "unparsable");
      }
    }

    // Events of the selected tasks, inside the selected window, of the selected attempt.
    const conditions = [];
    const params = [];
    if (ids.length > 0) {
      conditions.push(inScopeTasks);
      params.push(...ids);
    } else {
      conditions.push("0");
    }
    if (scope.since !== null) {
      conditions.push("at >= ?");
      params.push(scope.since);
    }
    const events = queryAll(
      db,
      `SELECT event_id, type, task_id, agent, at, payload_json FROM events WHERE ${conditions.join(" AND ")} ORDER BY event_id LIMIT ${MAX_RECORDS + 1}`,
      params,
      gaps,
      "events",
    );
    const truncated = {};
    if (events.length > MAX_RECORDS) {
      truncated.events = MAX_RECORDS;
      gaps.add("events", "record_limit", { count: MAX_RECORDS });
    }

    const feature = scope.feature ?? null;
    return {
      scope,
      feature,
      tasks,
      attempts,
      telemetry,
      events: events.slice(0, MAX_RECORDS),
      binding: queryAll(db, "SELECT * FROM workspace_binding WHERE singleton = 1", [], gaps, "workspace_binding")[0] ?? null,
      manager: queryAll(db, "SELECT * FROM manager_binding WHERE singleton = 1", [], gaps, "manager_binding")[0] ?? null,
      schema_version: queryAll(db, "SELECT value FROM schema_meta WHERE key = 'schema_version'", [], gaps, "schema_meta")[0]?.value ?? null,
      last_event_id: queryAll(db, "SELECT MAX(event_id) AS last FROM events", [], gaps, "events")[0]?.last ?? null,
      truncated,
      available: { features: [], tasks: [] },
    };
  } finally {
    try {
      db.close();
    } catch {
      /* already closed */
    }
  }
}

/** The identifiers a summary offers, read from the snapshot without selecting anything. */
function collectAvailable(snapshot, gaps) {
  if (!snapshot) return { features: [], tasks: [] };
  let db;
  try {
    db = new DatabaseSync(snapshot.path, { readOnly: true });
  } catch (error) {
    gaps.add("database_snapshot", "unopenable", { code: error?.code ?? "SQLITE_CANTOPEN" });
    return { features: [], tasks: [] };
  }
  try {
    const features = [];
    for (const row of queryAll(db, "SELECT feature_id, json FROM features", [], gaps, "features")) {
      let parsed = null;
      try {
        parsed = JSON.parse(row.json);
      } catch {
        gaps.add("features", "unparsable");
      }
      features.push({
        feature_id: SAFE_ID.test(String(row.feature_id)) ? row.feature_id : "invalid",
        state: parsed?.state ?? null,
        tasks: (parsed?.task_ids ?? []).length,
        updated_at: iso(parsed?.updated_at),
      });
    }
    const tasks = queryAll(
      db,
      "SELECT task_id, state, owner, updated_at FROM tasks ORDER BY updated_at DESC LIMIT 20",
      [],
      gaps,
      "tasks",
    ).map((row) => ({ task_id: row.task_id, state: row.state, owner: row.owner, updated_at: iso(row.updated_at) }));
    return { features, tasks };
  } finally {
    try {
      db.close();
    } catch {
      /* already closed */
    }
  }
}

/**
 * Read this worktree's own diagnostics logs through the safe-read boundary.
 *
 * Only regular files, directly inside the real `.bridge/logs` directory, whose names the logger
 * itself produced. Each file is read as a bounded prefix of a known inode and the result records
 * which byte range was read, so the manifest describes a cutoff instead of implying a whole file.
 */
function collectLogs(stateDirectory, scope, gaps) {
  const directory = join(stateDirectory, "logs");
  const files = [];
  const records = [];
  let entries;
  try {
    entries = safeListDirectory(stateDirectory, directory);
  } catch (error) {
    gaps.addUnsafe("logs", error);
    return { files, records, read_at: Date.now() };
  }
  const read_at = Date.now();
  for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.isSymbolicLink()) {
      gaps.add("logs", "symlink", { file: entry.name });
      continue;
    }
    if (!entry.isFile()) {
      if (LOG_FILE.test(entry.name)) gaps.add("logs", "not_regular", { file: entry.name });
      continue;
    }
    if (!LOG_FILE.test(entry.name)) continue;
    let read;
    try {
      read = readBounded(stateDirectory, join(directory, entry.name), { maxBytes: MAX_LOG_BYTES, from: "end" });
    } catch (error) {
      gaps.addUnsafe("logs", error, entry.name);
      continue;
    }
    const text = read.data.toString("utf8");
    const lines = text.split("\n");
    // A bounded tail can start mid-record; that first fragment is a gap, not a record.
    const partialFirst = read.read_from > 0 && lines.length > 0;
    if (partialFirst) lines.shift();
    let unparsable = 0;
    let kept = 0;
    for (const line of lines) {
      if (line.trim().length === 0) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        unparsable += 1;
        continue;
      }
      if (!inScope(record, scope)) continue;
      records.push({ file: entry.name, record });
      kept += 1;
    }
    files.push({
      file: entry.name,
      bytes: read.identity.size,
      bytes_read: read.bytes_read,
      read_from: read.read_from,
      truncated: read.truncated,
      modified_at: read.identity.modified_at,
      inode: read.identity.inode,
      records_kept: kept,
      partial_last_line: unparsable > 0,
      identity: read.identity,
    });
    if (unparsable > 0) gaps.add("logs", "unparsable_lines", { file: entry.name, count: unparsable });
    if (partialFirst) gaps.add("logs", "prefix_truncated", { file: entry.name, count: read.read_from });
  }
  return { files, records: records.slice(0, MAX_RECORDS), truncated: records.length > MAX_RECORDS, read_at };
}

/**
 * Is this log record inside the selected scope?
 *
 * One rule for every source: the record must belong to a selected task (and attempt), or to the
 * selected feature, or be a process-level record inside the window this incident spans. A
 * record without a task from outside that window is another incident's context, not this one's.
 */
function inScope(record, scope) {
  const at = Date.parse(record?.ts ?? "");
  if (!Number.isFinite(at)) return false;
  if (scope.from !== null && at < scope.from) return false;
  if (scope.to !== null && at > scope.to) return false;
  const task = typeof record?.task_id === "string" ? record.task_id : null;
  if (task !== null) {
    if (!scope.task_ids.includes(task)) return false;
    if (scope.attempt !== null && typeof record?.attempt === "number" && record.attempt !== scope.attempt) return false;
    return true;
  }
  if (scope.feature_id !== null && record?.feature_id === scope.feature_id) return true;
  // Process-level context: only inside the incident's own time span.
  return record?.feature_id === null || record?.feature_id === undefined;
}

/** Termination-evidence metadata; the files themselves only with the explicit extension. */
function collectEvidence(evidenceRoot, scope, gaps, { include }) {
  const index = [];
  const files = [];
  let root;
  try {
    root = assertUnderRoot(dirname(evidenceRoot), evidenceRoot);
  } catch (error) {
    if (!(error instanceof UnsafePathError) || error.reason !== "absent") gaps.addUnsafe("evidence", error);
    return { index, files };
  }
  for (const taskId of scope.task_ids) {
    if (!/^[A-Za-z0-9_-]{1,128}$/u.test(taskId)) continue;
    let entries;
    try {
      entries = safeListDirectory(root, join(root, taskId));
    } catch (error) {
      if (!(error instanceof UnsafePathError) || error.reason !== "absent") gaps.addUnsafe("evidence", error);
      continue;
    }
    for (const entry of entries) {
      const match = /^attempt-(\d{1,6})\.json$/u.exec(entry.name);
      if (!match) continue;
      const attempt = Number(match[1]);
      if (scope.attempt !== null && attempt !== scope.attempt) continue;
      if (!entry.isFile()) {
        gaps.add("evidence", entry.isSymbolicLink() ? "symlink" : "not_regular");
        continue;
      }
      let read;
      try {
        read = readBounded(root, join(root, taskId, entry.name), { maxBytes: MAX_ENTRY_BYTES, from: "start" });
      } catch (error) {
        gaps.addUnsafe("evidence", error);
        continue;
      }
      let parsed;
      try {
        parsed = JSON.parse(read.data.toString("utf8"));
      } catch {
        gaps.add("evidence", "unparsable");
        continue;
      }
      index.push({
        task_id: taskId,
        attempt: parsed.attempt ?? attempt,
        file: `${taskId}/${entry.name}`,
        bytes: read.bytes_read,
        sha256: sha256(read.data),
        termination_kind: parsed.termination_kind ?? null,
        reason: parsed.reason ?? null,
        stderr_total_bytes: parsed.stderr?.total_bytes ?? null,
        stderr_kept_bytes: parsed.stderr?.kept_bytes ?? null,
        stderr_truncated: parsed.stderr?.truncated ?? null,
        included_in_package: include,
      });
      if (include) files.push({ name: `evidence/${taskId}/${entry.name}`, data: read.data });
    }
  }
  return { index, files };
}

const RUNTIME_SPEC = {
  runtime_id: "version",
  package_version: "version",
  commit: "hex",
  created_at: "iso",
  node: "version",
  state_schema_version: "count",
  instructions_sha256: "sha256",
};
const SELECTION_SPEC = { runtime_id: "version", applied_at: "iso", history: "count" };

/** Versions of what produced the state: the installed runtime, the selection and the host. */
function collectVersions(root, aliases, gaps) {
  // The selection is read as data: its manifest is parsed, nothing in it is loaded or executed.
  const selection = readSelection(root);
  const record = readRecord(root);
  const manifest = selection.kind === "ok" ? selection.runtime?.manifest ?? null : null;
  if (selection.kind !== "ok") gaps.add("runtime_selection", selection.kind);
  if (record.kind !== "valid") gaps.add("install_record", record.kind);
  return {
    runtime: projectRecord(
      manifest
        ? {
            runtime_id: manifest.runtime_id ?? null,
            package_version: manifest.package_version ?? null,
            commit: manifest.source?.commit ?? null,
            created_at: manifest.created_at ?? null,
            node: manifest.built_with?.node ?? null,
            state_schema_version: manifest.compatibility?.state_schema_version ?? null,
            instructions_sha256: manifest.instructions?.set_sha256 ?? null,
          }
        : {},
      RUNTIME_SPEC,
      aliases,
      { countDropped: false },
    ),
    selection: projectRecord(
      record.kind === "valid"
        ? {
            runtime_id: record.value.runtime?.id ?? null,
            applied_at: record.value.applied_at ?? null,
            history: Array.isArray(record.value.history) ? record.value.history.length : null,
          }
        : {},
      SELECTION_SPEC,
      aliases,
      { countDropped: false },
    ),
    host: { node: projectField(process.version.replace(/^v/u, ""), "version", aliases), platform: projectField(process.platform, "label", aliases) },
    collector: { source: "own-build", root: aliases.path(ownRoot) },
  };
}

/** A readable chronology of the two sources, built only from already-projected values. */
function renderTimeline({ description, events, logRecords, versions, cutoffs }) {
  const cell = (value) => String(value ?? "").replace(/\|/gu, "\\|");
  const rows = [
    ...events.map((event) => ({
      at: Date.parse(event.at ?? "") || 0,
      source: "db",
      text: `${event.type}${event.task_id ? ` task=${event.task_id}` : ""}${
        Object.values(event.payload ?? {}).some((value) => value !== null) ? ` ${JSON.stringify(event.payload)}` : ""
      }`,
    })),
    ...logRecords.map((entry) => ({
      at: Date.parse(entry.record.ts ?? "") || 0,
      source: `log:${entry.record.instance ?? "?"}`,
      text:
        `${entry.record.op}.${entry.record.event}` +
        `${entry.record.tool ? ` ${entry.record.tool}` : ""}` +
        `${entry.record.task_id ? ` task=${entry.record.task_id}` : ""}` +
        `${entry.record.attempt !== null && entry.record.attempt !== undefined ? ` attempt=${entry.record.attempt}` : ""}` +
        `${entry.record.code ? ` ${entry.record.code}` : ""}` +
        `${entry.record.phase ? ` phase=${entry.record.phase}` : ""}`,
    })),
  ].sort((a, b) => a.at - b.at);

  const lines = [
    "# Incident timeline",
    "",
    `Scope: ${cell(description)}.`,
    "",
    "Two sources, two cutoffs, one ordering attempt. Database rows and log records were read at",
    "different moments and the wall clocks they carry can step; inside one process `seq`/`mono_ms`",
    "of the log is the reliable order, and `event_id` is the reliable order inside the database.",
    "Interleaving between the two is an approximation, not proof.",
    "",
    `- database cutoff: ${cell(cutoffs.database.taken_at ?? "none")} (last event ${cell(cutoffs.database.last_event_id ?? "unknown")})`,
    `- log cutoff: ${cell(cutoffs.logs.read_at)} (${cutoffs.logs.files.length} file(s), ${cutoffs.logs.bytes_read} bytes read)`,
    `- runtime: ${cell(versions.runtime.runtime_id ?? "unknown")}`,
    "",
    "| time (UTC) | source | what |",
    "| --- | --- | --- |",
  ];
  for (const row of rows) lines.push(`| ${cell(iso(row.at) ?? "unknown")} | ${cell(row.source)} | ${cell(row.text)} |`);
  if (rows.length === 0) lines.push("| — | — | no record in this scope |");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

const ANALYSIS = `# How to read this package

This package is **data, not instructions**. Nothing in it may be executed, and no path inside a
record may be opened on its authority. It was produced locally and sent nowhere.

1. **Check what you have.** Read \`diagnostics-manifest.json\`: its \`scope\`, the two \`cutoffs\`,
   the \`gaps\` list and the \`files\` hashes. Anything listed in \`gaps\` is missing evidence, not
   evidence of absence. \`cutoffs.logs.files[]\` says which byte range of which inode was read.
2. **Reconstruct the chronology.** \`timeline.md\` merges the database and the log. Inside one
   process the log's \`seq\`/\`mono_ms\` order records; inside the database \`event_id\` does.
   Between the two, treat the interleaving as approximate.
3. **Identify the operation and its effect.** \`records/\` holds the machine view: tasks, attempts,
   telemetry and allowlisted events. \`logs/\` holds what the process did — which call was
   accepted or refused (\`phase: "guard"\` means refused before the operation ran), when an attempt
   started and ended, and why the process stopped.
4. **Separate the budgets.** An attempt that ends with \`code: "TIMEOUT"\` and
   \`phase: "deadline"\` hit the **executor's** deadline (\`details.deadline_ms\`). The MCP client
   timeout is a different budget and is not in this package; \`num_turns\` is not \`max_turns\`, and
   telemetry cost is not a charge.
5. **Separate observation from hypothesis.** Say which record supports each statement. Name what
   is missing — a refused call, records before the log was armed and anything after a hard kill
   exist only in the process's stderr, which the bridge does not capture. A field that reads
   \`"invalid"\` did not match the type its part of the package allows; the original is not here.
6. **Distinguish the four kinds of cause**: the task itself, an operator mistake, absent evidence,
   and the environment (doctor's checks in \`doctor.json\` are the environment view).
7. **Propose the smallest safe next step.** Do not resume a session, repair a database or run a
   recovery while analysing: this package is a copy, and the worktree it came from may still be
   running.
`;

function describeScope(scope) {
  if (scope.kind === "feature") return `feature ${scope.feature_id}`;
  if (scope.kind === "task") {
    return scope.attempt === null ? `task ${scope.task_id}` : `task ${scope.task_id} attempt ${scope.attempt}`;
  }
  if (scope.kind === "window") return `window since ${iso(scope.since)}`;
  return "summary";
}

/**
 * Run the export. Returns the report the CLI prints; throws `SetupError` for a refusal the user
 * can act on (an unresolvable worktree, an unsafe path, a scope that does not exist).
 */
export async function runDiagnose(options) {
  const { home, env = process.env } = options;
  const now = Date.now();
  const gaps = new Gaps();

  // Identity and the namespace come from this CLI's own build. The worktree's selected runtime
  // is never imported: it is described in `versions`, and nothing of it is executed (R2-04).
  const controlPlane = await loadControlPlane(ownRoot, options.cliRuntime?.path ?? null);
  let identity;
  try {
    identity = controlPlane.resolveWorkspaceIdentity(resolve(options.workspace));
  } catch (error) {
    const reason = error?.details?.reason ?? null;
    throw new SetupError(
      reason === "not_worktree_root" ? "WORKSPACE_NOT_ROOT" : reason === "workspace_missing" ? "WORKSPACE_MISSING" : "WORKSPACE_UNRESOLVED",
      error?.message ?? "the worktree could not be resolved",
      { nextStep: "pass the worktree root of an existing project" },
    );
  }
  const root = identity.root;
  const stateDirectory = join(root, ".bridge");

  // The database: the worktree's own by default (no component may be a link), or an external one
  // the operator named deliberately, which is then checked on its own terms.
  let databasePath;
  let externalDatabase = false;
  try {
    if (options.db) {
      externalDatabase = true;
      const candidate = resolve(options.db);
      databasePath = assertUnderRoot(dirname(candidate), candidate);
    } else {
      databasePath = assertUnderRoot(root, join(stateDirectory, "bridge.db"));
    }
  } catch (error) {
    if (error instanceof UnsafePathError && error.reason === "absent") {
      databasePath = options.db ? resolve(options.db) : join(stateDirectory, "bridge.db");
    } else {
      throw new SetupError("DIAGNOSE_PATH_UNSAFE", `refusing to read ${error?.path ?? "this path"}: ${error?.reason ?? "unsafe"}`, {
        nextStep: "bridge state must be real files and directories; inspect that path by hand",
      });
    }
  }

  const namespace = controlPlane.exchangeNamespace(identity, env);
  const aliases = createAliases({
    workspace: root,
    home,
    exchange: namespace.namespace,
    userhome: env.HOME ?? "",
  });

  const since = parseSince(options.since, now);
  if (options.attempt !== undefined && !options.task) {
    throw new SetupError("DIAGNOSE_SCOPE_INVALID", "--attempt selects an attempt of one task", {
      nextStep: "pass --task <id> --attempt <n>",
    });
  }
  if (options.feature && options.task) {
    throw new SetupError("DIAGNOSE_SCOPE_INVALID", "--feature and --task select different scopes", {
      nextStep: "pass one of them",
    });
  }
  const attempt = options.attempt === undefined ? null : Number(options.attempt);
  if (attempt !== null && (!Number.isInteger(attempt) || attempt < 0)) {
    throw new SetupError("DIAGNOSE_SCOPE_INVALID", "--attempt expects a non-negative whole number", {
      nextStep: "pass --attempt 0",
    });
  }
  for (const [flag, value] of [["--feature", options.feature], ["--task", options.task]]) {
    if (value !== undefined && !SAFE_ID.test(String(value))) {
      throw new SetupError("DIAGNOSE_SCOPE_INVALID", `${flag} is not a valid identifier`, {
        nextStep: "copy the identifier from `diagnose` without a scope",
      });
    }
  }
  const request = {
    kind: options.feature ? "feature" : options.task ? "task" : since !== null ? "window" : "summary",
    feature_id: options.feature ?? null,
    task_id: options.task ?? null,
    attempt,
    since,
  };

  // Publication target: inside this worktree's namespace, with no link on the way.
  const staging = join(namespace.staging, `diagnose-${newTag()}`);
  try {
    mkdirSync(namespace.staging, { recursive: true, mode: 0o700 });
    mkdirSync(namespace.packages, { recursive: true, mode: 0o700 });
    assertUnderRoot(namespace.namespace, namespace.staging);
    assertUnderRoot(namespace.namespace, namespace.packages);
    mkdirSync(staging, { recursive: false, mode: 0o700 });
  } catch (error) {
    if (error instanceof UnsafePathError) {
      throw new SetupError("DIAGNOSE_OUTPUT_UNSAFE", `refusing to publish through ${error.path}: ${error.reason}`, {
        nextStep: "the exchange namespace must be real directories; inspect it by hand",
      });
    }
    throw new SetupError("DIAGNOSE_OUTPUT_UNWRITABLE", `cannot prepare ${namespace.namespace}: ${error.code ?? error.message}`, {
      nextStep: "check the permissions of the exchange namespace",
    });
  }

  try {
    const snapshot = await snapshotDatabase(databasePath, join(staging, "snapshot.db"), gaps);

    if (request.kind === "summary") {
      const available = collectAvailable(snapshot, gaps);
      const logs = collectLogs(stateDirectory, { task_ids: [], feature_id: null, attempt: null, from: now, to: now }, gaps);
      return {
        format: DIAGNOSTICS_FORMAT,
        mode: "summary",
        workspace: root,
        database: { present: snapshot !== null, integrity: snapshot?.integrity ?? null, last_event_id: snapshot ? null : null, external: externalDatabase },
        available,
        logs: logs.files.map((file) => ({ file: file.file, bytes: file.bytes, modified_at: iso(file.modified_at) })),
        gaps: gaps.projected(aliases),
        next_step: "select a scope: --feature <id>, --task <id> [--attempt <n>] or --since <30m|6h|ISO>",
      };
    }

    const state = collectState(snapshot, request, gaps);
    const scope = state.scope;
    const description = describeScope({ ...request, ...scope });

    // The incident's own time span bounds the process-level context, so a window never drags in
    // unrelated history and a named scope never reaches outside its own records (R2-03).
    const stamps = [
      ...state.tasks.flatMap((task) => [task.created_at, task.updated_at]),
      ...state.attempts.flatMap((row) => [row.started_at, row.ended_at]),
      ...state.events.map((event) => event.at),
    ].filter((value) => typeof value === "number" && Number.isFinite(value));
    const spanFrom = request.since ?? (stamps.length > 0 ? Math.min(...stamps) : now);
    const logScope = {
      task_ids: scope.task_ids,
      feature_id: request.feature_id,
      attempt: request.attempt,
      from: Math.min(spanFrom, now),
      to: now,
    };
    const logs = collectLogs(stateDirectory, logScope, gaps);
    if (logs.truncated) gaps.add("logs", "record_limit", { count: MAX_RECORDS });
    const versions = collectVersions(root, aliases, gaps);
    const evidenceRoot = join(dirname(databasePath), "evidence");
    const evidence = collectEvidence(evidenceRoot, scope, gaps, { include: Boolean(options.withEvidence) });

    let doctor = null;
    try {
      // Doctor is reused, not re-implemented, and its safe subset starts nothing and loads no
      // configuration the diagnosed project controls.
      const full = await runDoctor({
        home,
        workspace: root,
        handshake: false,
        safeSubset: true,
        cliRuntime: options.cliRuntime ?? null,
        env,
      });
      doctor = {
        format: full.format,
        generated_at: full.generated_at,
        status: full.status,
        subset: "safe",
        omitted: ["handshake", "codex_project"],
        checks: full.checks.map((check) => projectRecord(check, DOCTOR_SPEC, aliases, { countDropped: false })),
      };
    } catch (error) {
      gaps.add("doctor", "failed", { code: error?.code ?? "ERROR" });
    }

    const events = state.events.map((row) => {
      let payload = {};
      try {
        payload = JSON.parse(row.payload_json ?? "{}");
      } catch {
        // The parser's message quotes its input, so the gap is a code and nothing else (R2-01).
        gaps.add("events", "unparsable");
        payload = {};
      }
      return {
        ...projectRecord(row, EVENT_SPEC, aliases, { countDropped: false }),
        payload: projectRecord(payload, EVENT_PAYLOAD_SPEC, aliases),
      };
    });
    const logRecords = logs.records.map((entry) => ({
      file: entry.file,
      record: {
        ...projectRecord(entry.record, LOG_SPEC, aliases),
        details: entry.record?.details && typeof entry.record.details === "object" && !Array.isArray(entry.record.details)
          ? projectRecord(entry.record.details, LOG_DETAIL_SPEC, aliases)
          : null,
      },
    }));

    const cutoffs = {
      database: {
        taken_at: iso(snapshot?.taken_at ?? null),
        last_event_id: state.last_event_id,
        integrity: snapshot?.integrity ?? null,
        external: externalDatabase,
        method: "sqlite backup api (wal included)",
      },
      logs: {
        read_at: iso(logs.read_at),
        bytes_read: logs.files.reduce((total, file) => total + file.bytes_read, 0),
        files: logs.files.map((file) => projectRecord(file, LOG_FILE_SPEC, aliases, { countDropped: false })),
      },
      processes: { observed: false, note: "running processes are not inspected by the export" },
      records: state.truncated,
    };

    const byFile = new Map();
    for (const entry of logRecords) {
      if (!byFile.has(entry.file)) byFile.set(entry.file, []);
      byFile.get(entry.file).push(entry.record);
    }

    const entries = [];
    const add = (name, data) => entries.push({ name, data: Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8") });
    const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

    add("timeline.md", renderTimeline({ description, events, logRecords, versions, cutoffs }));
    add("ANALYSIS.md", ANALYSIS);
    add("records/tasks.json", json(state.tasks.map((task) => projectRecord(task, TASK_SPEC, aliases))));
    add(
      "records/attempts.json",
      json(
        state.attempts.map((row) => ({
          ...projectRecord(row, ATTEMPT_SPEC, aliases),
          // The execution handle is a session pointer: correlate by digest, never by value.
          execution_handle_ref: row.execution_handle ? digest(row.execution_handle) : null,
        })),
      ),
    );
    add("records/telemetry.json", json(state.telemetry.map((row) => projectRecord(row, TELEMETRY_SPEC, aliases))));
    add("records/events.json", json(events));
    add(
      "records/feature.json",
      json(
        state.feature
          ? projectRecord(
              {
                ...state.feature,
                // The question and its answer are user content and stay out of the package.
                question_present: state.feature.question !== null && state.feature.question !== undefined,
              },
              FEATURE_SPEC,
              aliases,
            )
          : null,
      ),
    );
    add(
      "records/workspace.json",
      json({
        workspace_id: projectField(state.binding?.workspace_id ?? null, "id", aliases),
        kind: projectField(identity.kind, "label", aliases),
        root: aliases.path(root),
        database: aliases.path(databasePath),
        database_external: externalDatabase,
        bound_at: projectField(state.binding?.bound_at ?? null, "epoch_ms", aliases),
        schema_version: projectField(Number(state.schema_version ?? NaN), "count", aliases),
        manager: state.manager
          ? {
              epoch: projectField(state.manager.epoch ?? null, "count", aliases),
              instance_generation: projectField(state.manager.instance_generation ?? null, "count", aliases),
              active_instance: Boolean(state.manager.active_instance_id),
              native_thread_ref: state.manager.native_thread_id ? digest(state.manager.native_thread_id) : null,
              active_feature_id: projectField(state.manager.active_feature_id ?? null, "id", aliases),
            }
          : null,
      }),
    );
    for (const [file, records] of byFile) add(`logs/${file}`, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
    add("evidence/index.json", json(evidence.index.map((entry) => projectRecord(entry, EVIDENCE_SPEC, aliases, { countDropped: false }))));
    for (const file of evidence.files) add(file.name, file.data);
    if (doctor) add("doctor.json", json(doctor));

    if (options.withDatabase) {
      if (!snapshot) gaps.add("database_extension", "absent");
      else if (snapshot.bytes > MAX_ENTRY_BYTES) gaps.add("database_extension", "too_large", { count: snapshot.bytes });
      else add("database/snapshot.db", readFileSync(snapshot.path));
    }

    // Did any log file change while the export ran? A rotation, a truncation or a deletion
    // between the read and here means the package holds a prefix of something that no longer
    // exists in that form, and it says so (R2-05).
    for (const file of logs.files) {
      const after = fileIdentity(join(stateDirectory, "logs", file.file));
      file.changed_during_export = identityChanged(file.identity, after);
      if (file.changed_during_export) gaps.add("logs", after === null ? "removed_during_export" : "changed_during_export", { file: file.file });
    }
    cutoffs.logs.files = logs.files.map((file) => projectRecord(file, LOG_FILE_SPEC, aliases, { countDropped: false }));

    const extensions = {
      evidence_files: Boolean(options.withEvidence),
      raw_database: entries.some((entry) => entry.name === "database/snapshot.db"),
    };
    const manifest = {
      format: DIAGNOSTICS_FORMAT,
      generated_at: iso(now),
      workspace: {
        root: aliases.path(root),
        workspace_id: projectField(state.binding?.workspace_id ?? null, "id", aliases),
        workspace_key: namespace.workspace_key,
        kind: projectField(identity.kind, "label", aliases),
      },
      scope: {
        kind: request.kind,
        feature_id: projectField(request.feature_id, "id", aliases),
        task_ids: projectField(scope.task_ids, "id_list", aliases),
        attempt: request.attempt,
        since: iso(request.since),
        window_task_limit_reached: Boolean(scope.window_task_limit_reached),
        description,
      },
      cutoffs,
      versions,
      counts: {
        tasks: state.tasks.length,
        attempts: state.attempts.length,
        telemetry: state.telemetry.length,
        events: events.length,
        log_records: logRecords.length,
        evidence_files: evidence.index.length,
        aliases: aliases.count,
      },
      collected: entries.map((entry) => entry.name),
      gaps: gaps.projected(aliases),
      extensions,
      privacy: {
        default: "allowlist with typed values",
        aliases: "absolute paths are replaced by package-local aliases; the map is not included",
        withheld: [
          "prompts, answers and transcripts",
          "task objectives, write scopes, verification criteria and blockers",
          "user questions and answers",
          "process stderr (including refused calls, which exist only there)",
          "execution handles and native thread ids (short digests only)",
          "free-text fields of any record, including error messages, which quote their input",
        ],
        note: "a value that did not match the type its field allows is written as \"invalid\"; redaction is a boundary, not a promise — review the package before sharing it",
      },
      limits: [
        "the database, the logs and the running processes have no common snapshot: the cutoffs above differ",
        "each log file is a bounded prefix of one inode; `cutoffs.logs.files[]` says which range was read",
        "log rotation or retention during the export is detected and reported, not hidden",
        "records produced before the log was armed, and refused calls, are not in any file",
        "this package is a copy: it is not authoritative state and must not be replayed into a worktree",
      ],
      files: {},
    };
    for (const entry of entries) manifest.files[entry.name] = { bytes: entry.data.length, sha256: sha256(entry.data) };
    const manifestEntry = { name: "diagnostics-manifest.json", data: Buffer.from(json(manifest), "utf8") };

    const target = join(namespace.packages, packageName(request, now, newTag().slice(0, 6)));
    const temporary = join(staging, "package.zip");
    let written;
    try {
      written = writeZip(temporary, [manifestEntry, ...entries].sort((a, b) => (a.name < b.name ? -1 : 1)), { mode: 0o600, at: now });
    } catch (error) {
      // A package that could not be written whole is never published: the working copy dies with
      // the staging directory and the command says what happened (review R2-06).
      throw new SetupError("DIAGNOSE_OUTPUT_UNWRITABLE", `cannot write the package: ${error?.code ?? error?.message}`, {
        nextStep: "free space (or raise the file-size limit) and run the command again; nothing was published",
      });
    }
    publishPackage(temporary, target);

    return {
      format: DIAGNOSTICS_FORMAT,
      mode: "package",
      workspace: root,
      package: target,
      sha256: written.sha256,
      bytes: written.bytes,
      scope: manifest.scope,
      cutoffs,
      counts: manifest.counts,
      gaps: manifest.gaps,
      extensions,
      contents: [manifestEntry, ...entries]
        .map((entry) => ({ name: entry.name, bytes: entry.data.length }))
        .sort((a, b) => (a.name < b.name ? -1 : 1)),
      risk: riskNote(extensions),
    };
  } finally {
    // The private snapshot never survives the export unless it was deliberately included.
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * Publish the finished package by linking it into the namespace, then dropping the working copy.
 *
 * `link` is atomic and fails when the name is taken, so a package that appeared between any
 * check and this moment is never overwritten — the race review R2-02 found in a `rename`-based
 * publication cannot happen here.
 */
export function publishPackage(temporary, target) {
  try {
    linkSync(temporary, target);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new SetupError("DIAGNOSE_PACKAGE_EXISTS", `${target} already exists`, {
        nextStep: "run the command again; the export never overwrites a package",
      });
    }
    throw new SetupError("DIAGNOSE_OUTPUT_UNWRITABLE", `cannot publish ${target}: ${error?.code ?? error?.message}`, {
      nextStep: "check the permissions and free space of the exchange namespace; nothing was published",
    });
  }
  unlinkSync(temporary);
}

function packageName(request, at, tag) {
  const stamp = new Date(at).toISOString().replace(/[-:]/gu, "").replace(/\.\d+Z$/u, "Z");
  const label = request.kind === "feature" ? request.feature_id : request.kind === "task" ? request.task_id : "window";
  const safe = String(label ?? "scope").replace(/[^A-Za-z0-9._-]/gu, "-").slice(0, 60);
  return `diagnose-${safe}-${stamp}-${tag}.zip`;
}

function riskNote(extensions) {
  const lines = [
    "Contains identifiers, states, timings and machine codes of the selected scope only.",
    "No prompts, answers, transcripts, objectives, scopes, blockers or error messages; paths are aliased.",
  ];
  if (extensions.evidence_files) {
    lines.push("EXTENSION: termination evidence files are included; they carry a redacted runtime stderr tail.");
  }
  if (extensions.raw_database) {
    lines.push("EXTENSION: a raw database snapshot is included; it contains every field the bridge stores, including free text.");
  }
  lines.push("Review the contents before sharing. The export stays local; nothing was uploaded.");
  return lines;
}

/** Read a package back and check it against its own manifest. */
export function inspectPackage(path) {
  const entries = readZip(path);
  const manifestRaw = entries.get("diagnostics-manifest.json");
  if (!manifestRaw) throw new SetupError("DIAGNOSE_PACKAGE_INVALID", `${path} has no diagnostics-manifest.json`);
  const manifest = JSON.parse(manifestRaw.toString("utf8"));
  const mismatched = [];
  for (const [name, record] of Object.entries(manifest.files ?? {})) {
    const data = entries.get(name);
    if (!data) mismatched.push({ name, reason: "missing" });
    else if (sha256(data) !== record.sha256 || data.length !== record.bytes) mismatched.push({ name, reason: "content" });
  }
  for (const name of entries.keys()) {
    if (name !== "diagnostics-manifest.json" && !(name in (manifest.files ?? {}))) mismatched.push({ name, reason: "unlisted" });
  }
  return {
    format: manifest.format,
    package: path,
    sha256: sha256(readFileSync(path)),
    scope: manifest.scope,
    cutoffs: manifest.cutoffs,
    counts: manifest.counts,
    gaps: manifest.gaps,
    extensions: manifest.extensions,
    entries: [...entries.keys()].sort(),
    integrity: mismatched.length === 0 ? "ok" : "mismatch",
    mismatched,
  };
}

export function formatDiagnose(report) {
  if (report.mode === "summary") {
    const lines = [`bridge diagnose: ${report.workspace}`, "no scope selected; nothing was exported", ""];
    lines.push(`database: ${report.database.present ? `present (integrity ${report.database.integrity})` : "absent"}`);
    lines.push("features:");
    if (report.available.features.length === 0) lines.push("  none");
    for (const feature of report.available.features) {
      lines.push(`  ${feature.feature_id}  ${feature.state}  ${feature.tasks} task(s)  ${feature.updated_at ?? ""}`);
    }
    lines.push("recent tasks:");
    if (report.available.tasks.length === 0) lines.push("  none");
    for (const task of report.available.tasks.slice(0, 10)) {
      lines.push(`  ${task.task_id}  ${task.state}  ${task.owner ?? "-"}  ${task.updated_at ?? ""}`);
    }
    lines.push(`logs: ${report.logs.length} file(s)`);
    for (const gap of report.gaps) lines.push(`gap: ${gap.part} ${gap.reason}${gap.file ? ` (${gap.file})` : ""}`);
    lines.push(`next: ${report.next_step}`);
    return `${lines.join("\n")}\n`;
  }
  const lines = [
    `bridge diagnose: ${report.workspace}`,
    `scope: ${report.scope.description}`,
    `package: ${report.package}`,
    `sha256: ${report.sha256}`,
    `size: ${report.bytes} bytes, ${report.contents.length} entries`,
    `database cutoff: ${report.cutoffs.database.taken_at ?? "none"} (integrity ${report.cutoffs.database.integrity ?? "n/a"})`,
    `log cutoff: ${report.cutoffs.logs.read_at} (${report.cutoffs.logs.files.length} file(s), ${report.cutoffs.logs.bytes_read} bytes)`,
    "contents:",
  ];
  for (const entry of report.contents) lines.push(`  ${String(entry.bytes).padStart(8)}  ${entry.name}`);
  if (report.gaps.length > 0) {
    lines.push("gaps:");
    for (const gap of report.gaps) {
      lines.push(`  ${gap.part}: ${gap.reason}${gap.file ? ` ${gap.file}` : ""}${gap.code ? ` (${gap.code})` : ""}`);
    }
  }
  lines.push("risk:");
  for (const line of report.risk) lines.push(`  ${line}`);
  return `${lines.join("\n")}\n`;
}
