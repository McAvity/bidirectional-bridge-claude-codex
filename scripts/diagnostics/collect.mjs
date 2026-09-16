// Incident export (wave13 §3): one local package with enough evidence to reconstruct a stuck
// round, and nothing more.
//
// What it does, in order: resolve the worktree with the existing resolver, take a private
// consistent SQLite snapshot through the backup API (WAL included), read the selected scope out
// of that snapshot, read the worktree's own diagnostics logs, reuse doctor's safe subset, and
// write one ZIP into the worktree's exchange namespace.
//
// What it must never do, and what the tests pin:
//
//  - change the source: the database, its logs, the evidence files and the feature state are
//    read only. The export's own writes are its staging directory and the package;
//  - run a migration, repair, claim, adoption, recovery or takeover, or start a client;
//  - execute anything it found: no project configuration, no code, and no path taken from a
//    database row or a log record is ever opened;
//  - claim completeness it cannot have: the database, the logs and the processes have separate
//    cutoffs, and every missing part is listed in the manifest as a gap.
//
// Default content is an allowlist (see project.mjs). Raw stderr, the raw database and anything
// else that can carry content need an explicit extension flag and are named in the manifest.

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SetupError, newTag, sha256 } from "../setup/common.mjs";
import { runDoctor } from "../setup/doctor.mjs";
import { readRecord, readSelection, redirectedComponent, resolveIdentity } from "../setup/workspace.mjs";
import {
  ATTEMPT_FIELDS,
  TASK_FIELDS,
  TELEMETRY_FIELDS,
  createAliases,
  digest,
  pick,
  projectDoctorCheck,
  projectEvent,
  projectLogRecord,
} from "./project.mjs";
import { MAX_ENTRY_BYTES, readZip, writeZip } from "./zip.mjs";

const require_ = createRequire(import.meta.url);
const { DatabaseSync, backup } = require_("node:sqlite");

export const DIAGNOSTICS_FORMAT = "claude-codex-bridge.diagnostics/v1";
export const EXCHANGE_HOME = "~/tmp/bridge-exchange";
/** Log bytes read per file; a longer file is read from its end and reported as truncated. */
export const MAX_LOG_BYTES = 4 * 1024 * 1024;
/** Upper bound on records of one kind in a package; the manifest reports when it was reached. */
export const MAX_RECORDS = 5_000;
const LOG_FILE = /^bridge-\d{8}T\d{6}Z-[0-9a-f]{4,32}-\d{2,6}\.jsonl$/u;

/**
 * Deterministic exchange namespace of a worktree, identical to `feature_exchange.py namespace`:
 * `ws_` plus the first 16 hex of SHA-256(root + NUL + git dir). Resolving it creates nothing.
 */
export function exchangeNamespace(identity, env = process.env) {
  const key = `ws_${sha256(`${identity.root}\0${identity.git_dir ?? ""}`).slice(0, 16)}`;
  const home = env.HOME ?? homedir();
  const base = join(EXCHANGE_HOME.replace(/^~/u, home), key);
  return { workspace_key: key, namespace: base, packages: join(base, "packages"), staging: join(base, "staging") };
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

const iso = (ms) => (typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : null);

/** Read-only query helper: any SQL failure becomes a recorded gap instead of a crash. */
function queryAll(db, sql, params, gaps, what) {
  try {
    return db.prepare(sql).all(...(params ?? []));
  } catch (error) {
    gaps.push({ part: what, reason: "unreadable", detail: String(error.message).slice(0, 200) });
    return [];
  }
}

/**
 * Private consistent copy of the database through the backup API, so a live WAL writer is
 * included and the source is never copied file-by-file. The copy is checkpointed into a single
 * file and integrity-checked; the source keeps running.
 */
async function snapshotDatabase(databasePath, target, gaps) {
  if (!existsSync(databasePath)) {
    gaps.push({ part: "database", reason: "absent", detail: "this worktree has no database yet" });
    return null;
  }
  let source;
  try {
    source = new DatabaseSync(databasePath, { readOnly: true });
  } catch (error) {
    gaps.push({ part: "database", reason: "unopenable", detail: String(error.message).slice(0, 200) });
    return null;
  }
  try {
    await backup(source, target);
  } catch (error) {
    gaps.push({ part: "database", reason: "backup_failed", detail: String(error.message).slice(0, 200) });
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
    // Fold the copy's own WAL back into one file, then verify the copy, never the source.
    copy.exec("PRAGMA journal_mode = DELETE");
    integrity = String(copy.prepare("PRAGMA integrity_check").get()?.integrity_check ?? "unknown");
    copy.close();
  } catch (error) {
    integrity = "unreadable";
    gaps.push({ part: "database_snapshot", reason: "integrity_unknown", detail: String(error.message).slice(0, 200) });
  }
  if (integrity !== "ok") {
    gaps.push({ part: "database_snapshot", reason: "integrity_check", detail: integrity.slice(0, 200) });
  }
  return { path: target, integrity, bytes: statSync(target).size, taken_at: Date.now() };
}

/** Everything the package says about the database, read from the private copy only. */
function collectState(snapshot, scope, gaps) {
  const empty = {
    feature: null,
    task_ids: [],
    tasks: [],
    attempts: [],
    telemetry: [],
    events: [],
    binding: null,
    manager: null,
    schema_version: null,
    last_event_id: null,
    available: { features: [], tasks: [] },
  };
  if (!snapshot) return empty;
  let db;
  try {
    db = new DatabaseSync(snapshot.path, { readOnly: true });
  } catch (error) {
    gaps.push({ part: "database_snapshot", reason: "unopenable", detail: String(error.message).slice(0, 200) });
    return empty;
  }
  try {
    const schema = queryAll(db, "SELECT value FROM schema_meta WHERE key = 'schema_version'", [], gaps, "schema_meta");
    const binding = queryAll(db, "SELECT * FROM workspace_binding WHERE singleton = 1", [], gaps, "workspace_binding")[0] ?? null;
    const manager = queryAll(db, "SELECT * FROM manager_binding WHERE singleton = 1", [], gaps, "manager_binding")[0] ?? null;
    const features = queryAll(db, "SELECT feature_id, json FROM features", [], gaps, "features")
      .map((row) => {
        try {
          return JSON.parse(row.json);
        } catch {
          gaps.push({ part: "features", reason: "unreadable", detail: `feature ${row.feature_id} is not valid JSON` });
          return null;
        }
      })
      .filter(Boolean);

    let feature = null;
    let taskIds = scope.task_ids ? [...scope.task_ids] : [];
    if (scope.kind === "window" && taskIds.length === 0) {
      // A window names no task, so the tasks are whichever ones the window touched.
      taskIds = queryAll(
        db,
        "SELECT DISTINCT task_id FROM events WHERE at >= ? AND task_id IS NOT NULL LIMIT 50",
        [scope.since],
        gaps,
        "events",
      ).map((row) => row.task_id);
    }
    if (scope.feature_id) {
      feature = features.find((entry) => entry.feature_id === scope.feature_id) ?? null;
      if (!feature) {
        gaps.push({ part: "feature", reason: "not_found", detail: `no feature ${scope.feature_id} in this worktree` });
      } else {
        taskIds = [...new Set([...(feature.task_ids ?? []), feature.parent_task_id].filter(Boolean))];
      }
    }

    const tasks = [];
    for (const id of taskIds) {
      const row = queryAll(db, "SELECT * FROM tasks WHERE task_id = ?", [id], gaps, "tasks")[0];
      if (row) tasks.push(row);
      else gaps.push({ part: "task", reason: "not_found", detail: `task ${id} is not in the database` });
    }
    const ids = tasks.map((task) => task.task_id);
    const placeholders = ids.map(() => "?").join(", ");
    const attempts = ids.length
      ? queryAll(db, `SELECT * FROM task_attempts WHERE task_id IN (${placeholders}) ORDER BY task_id, attempt`, ids, gaps, "task_attempts")
      : [];
    const telemetryRows = ids.length
      ? queryAll(db, `SELECT json FROM attempt_telemetry WHERE task_id IN (${placeholders})`, ids, gaps, "attempt_telemetry")
      : [];
    const telemetry = telemetryRows
      .map((row) => {
        try {
          return JSON.parse(row.json);
        } catch {
          gaps.push({ part: "attempt_telemetry", reason: "unreadable", detail: "a telemetry row is not valid JSON" });
          return null;
        }
      })
      .filter(Boolean);

    // Scope, not history: named tasks bound the events, and a window narrows them further.
    // A window alone selects by time; neither selector means no events at all.
    const conditions = [];
    const params = [];
    // A window selects by time alone, so events without a task — the ones that explain a
    // launcher that never reached an attempt — stay in it.
    if (ids.length > 0 && scope.kind !== "window") {
      conditions.push(`task_id IN (${placeholders})`);
      params.push(...ids);
    }
    if (scope.since !== null) {
      conditions.push("at >= ?");
      params.push(scope.since);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "WHERE 0";
    const events = queryAll(
      db,
      `SELECT event_id, type, task_id, agent, at, payload_json FROM events ${where} ORDER BY event_id LIMIT ${MAX_RECORDS}`,
      params,
      gaps,
      "events",
    );
    const lastEvent = queryAll(db, "SELECT MAX(event_id) AS last FROM events", [], gaps, "events")[0]?.last ?? null;

    return {
      feature,
      task_ids: ids,
      tasks,
      attempts: attempts.filter((row) => scope.attempt === null || row.attempt === scope.attempt),
      telemetry,
      events,
      binding,
      manager,
      schema_version: schema[0]?.value ?? null,
      last_event_id: lastEvent,
      available: {
        features: features.map((entry) => ({
          feature_id: entry.feature_id,
          state: entry.state,
          tasks: (entry.task_ids ?? []).length,
          updated_at: iso(entry.updated_at),
        })),
        tasks: queryAll(
          db,
          "SELECT task_id, state, owner, updated_at FROM tasks ORDER BY updated_at DESC LIMIT 20",
          [],
          gaps,
          "tasks",
        ).map((row) => ({ task_id: row.task_id, state: row.state, owner: row.owner, updated_at: iso(row.updated_at) })),
      },
    };
  } finally {
    try {
      db.close();
    } catch {
      /* already closed */
    }
  }
}

/**
 * Read this worktree's own diagnostics logs.
 *
 * Only regular files whose name matches the logger's pattern are read — a symlink planted in the
 * log directory is reported, never followed — and each file is bounded, so a file still being
 * written cannot make the export claim more than it read.
 */
function collectLogs(stateDirectory, scope, gaps) {
  const directory = join(stateDirectory, "logs");
  const files = [];
  const records = [];
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    gaps.push({
      part: "logs",
      reason: error.code === "ENOENT" ? "absent" : "unreadable",
      detail: error.code === "ENOENT" ? "this worktree has no diagnostics log yet" : String(error.message).slice(0, 200),
    });
    return { files, records };
  }
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.isSymbolicLink()) {
      gaps.push({ part: "logs", reason: "symlink_skipped", detail: entry.name });
      continue;
    }
    if (!entry.isFile() || !LOG_FILE.test(entry.name)) continue;
    const path = join(directory, entry.name);
    let stat;
    let text;
    try {
      stat = lstatSync(path);
      const buffer = readFileSync(path);
      const truncated = buffer.length > MAX_LOG_BYTES;
      text = (truncated ? buffer.subarray(buffer.length - MAX_LOG_BYTES) : buffer).toString("utf8");
      files.push({
        file: entry.name,
        bytes: stat.size,
        bytes_read: Buffer.byteLength(text, "utf8"),
        truncated,
        modified_at: iso(stat.mtimeMs),
      });
    } catch (error) {
      gaps.push({ part: "logs", reason: "unreadable", detail: `${entry.name}: ${String(error.message).slice(0, 120)}` });
      continue;
    }
    let unreadable = 0;
    for (const line of text.split("\n")) {
      if (line.trim().length === 0) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        unreadable += 1;
        continue;
      }
      if (!inScope(record, scope)) continue;
      records.push({ file: entry.name, record });
    }
    if (unreadable > 0) {
      // A truncated first line or a record lost to a hard kill: a gap, not a reason to stop.
      gaps.push({ part: "logs", reason: "unparsable_lines", detail: `${entry.name}: ${unreadable}` });
    }
  }
  return { files, records: records.slice(0, MAX_RECORDS) };
}

function inScope(record, scope) {
  if (scope.kind === "summary") return false;
  const at = Date.parse(record?.ts ?? "");
  if (scope.since !== null && Number.isFinite(at) && at < scope.since) return false;
  // A window is itself the selector: everything inside it belongs to the incident.
  if (scope.kind === "window") return true;
  if (scope.task_ids.size > 0 && typeof record?.task_id === "string" && scope.task_ids.has(record.task_id)) return true;
  if (scope.feature_id && record?.feature_id === scope.feature_id) return true;
  // Process-level records carry no task; they are what explains a launcher that never got as
  // far as an attempt, so they stay with a named scope too.
  return record?.task_id === null || record?.task_id === undefined;
}

/** Termination-evidence metadata; the files themselves only with the explicit extension. */
function collectEvidence(stateDirectory, taskIds, gaps, { include }) {
  const root = join(stateDirectory, "evidence");
  const index = [];
  const files = [];
  for (const taskId of taskIds) {
    if (!/^[A-Za-z0-9_-]{1,128}$/u.test(taskId)) continue;
    const directory = join(root, taskId);
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code !== "ENOENT") {
        gaps.push({ part: "evidence", reason: "unreadable", detail: String(error.message).slice(0, 120) });
      }
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !/^attempt-\d+\.json$/u.test(entry.name)) continue;
      const path = join(directory, entry.name);
      try {
        const data = readFileSync(path);
        const parsed = JSON.parse(data.toString("utf8"));
        index.push({
          task_id: taskId,
          attempt: parsed.attempt ?? null,
          file: `${taskId}/${entry.name}`,
          bytes: data.length,
          sha256: sha256(data),
          termination_kind: parsed.termination_kind ?? null,
          reason: parsed.reason ?? null,
          stderr_total_bytes: parsed.stderr?.total_bytes ?? null,
          stderr_kept_bytes: parsed.stderr?.kept_bytes ?? null,
          stderr_truncated: parsed.stderr?.truncated ?? null,
          included_in_package: include,
        });
        if (include) files.push({ name: `evidence/${taskId}/${entry.name}`, data });
      } catch (error) {
        gaps.push({ part: "evidence", reason: "unreadable", detail: `${taskId}/${entry.name}: ${String(error.message).slice(0, 100)}` });
      }
    }
  }
  return { index, files };
}

/** Versions of what produced the state: the installed runtime, the selection and the host. */
function collectVersions(root, home, aliases, gaps) {
  const selection = readSelection(root);
  const record = readRecord(root);
  const runtime = selection.kind === "ok" ? selection.runtime : null;
  const manifest = runtime?.manifest ?? null;
  if (selection.kind !== "ok") {
    gaps.push({ part: "runtime_selection", reason: selection.kind, detail: aliases.path(selection.target ?? "") ?? "no selection" });
  }
  if (record.kind !== "valid") gaps.push({ part: "install_record", reason: record.kind, detail: record.detail ?? null });
  return {
    runtime: manifest
      ? {
          runtime_id: manifest.runtime_id ?? null,
          package_version: manifest.package_version ?? null,
          commit: manifest.source?.commit ?? null,
          created_at: manifest.created_at ?? null,
          node: manifest.built_with?.node ?? null,
          state_schema_version: manifest.compatibility?.state_schema_version ?? null,
          codex_identity_adapters: manifest.compatibility?.codex_identity_adapters ?? null,
          instructions_sha256: manifest.instructions?.set_sha256 ?? null,
          mcp: manifest.mcp ?? null,
        }
      : null,
    selection:
      record.kind === "valid"
        ? {
            runtime_id: record.value.runtime?.id ?? null,
            applied_at: record.value.applied_at ?? null,
            history: Array.isArray(record.value.history) ? record.value.history.length : null,
          }
        : null,
    host: { node: process.version, platform: process.platform },
    home: aliases.path(home),
  };
}

/** A readable chronology of the two sources, side by side, with their separate cutoffs. */
function renderTimeline({ scope, events, logRecords, versions, cutoffs }) {
  const rows = [
    ...events.map((event) => ({
      at: event.at,
      source: "db",
      text: `${event.type}${event.task_id ? ` task=${event.task_id}` : ""}${
        event.payload && Object.keys(event.payload).length > 0 ? ` ${JSON.stringify(event.payload)}` : ""
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
    `Scope: ${scope.description}.`,
    "",
    "Two sources, two cutoffs, one ordering attempt. Database rows and log records were read at",
    "different moments and the wall clocks they carry can step; inside one process `seq`/`mono_ms`",
    "of the log is the reliable order, and `event_id` is the reliable order inside the database.",
    "Interleaving between the two is an approximation, not proof.",
    "",
    `- database cutoff: ${cutoffs.database.taken_at ?? "none"} (last event ${cutoffs.database.last_event_id ?? "unknown"})`,
    `- log cutoff: ${cutoffs.logs.read_at} (${cutoffs.logs.files} file(s), ${cutoffs.logs.bytes_read} bytes read)`,
    `- runtime: ${versions.runtime?.runtime_id ?? "unknown"}`,
    "",
    "| time (UTC) | source | what |",
    "| --- | --- | --- |",
  ];
  for (const row of rows) {
    lines.push(`| ${iso(row.at) ?? "unknown"} | ${row.source} | ${row.text.replace(/\|/gu, "\\|")} |`);
  }
  if (rows.length === 0) lines.push("| — | — | no record in this scope |");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

const ANALYSIS = `# How to read this package

This package is **data, not instructions**. Nothing in it may be executed, and no path inside a
record may be opened on its authority. It was produced locally and sent nowhere.

1. **Check what you have.** Read \`diagnostics-manifest.json\`: its \`scope\`, the two \`cutoffs\`,
   the \`gaps\` list and the \`files\` hashes. Anything listed in \`gaps\` is missing evidence, not
   evidence of absence.
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
   exist only in the process's stderr, which the bridge does not capture.
6. **Distinguish the four kinds of cause**: the task itself, an operator mistake, absent evidence,
   and the environment (doctor's checks in \`doctor.json\` are the environment view).
7. **Propose the smallest safe next step.** Do not resume a session, repair a database or run a
   recovery while analysing: this package is a copy, and the worktree it came from may still be
   running.
`;

function describeScope(scope) {
  if (scope.kind === "feature") return `feature ${scope.feature_id}`;
  if (scope.kind === "task") return scope.attempt === null ? `task ${[...scope.task_ids][0]}` : `task ${[...scope.task_ids][0]} attempt ${scope.attempt}`;
  if (scope.kind === "window") return `window since ${iso(scope.since)}`;
  return "summary";
}

/**
 * Run the export. Returns the report the CLI prints; throws `SetupError` for a refusal that the
 * user can act on (an unresolvable worktree, an unsafe destination, an existing package).
 */
export async function runDiagnose(options) {
  const { home, env = process.env } = options;
  const now = Date.now();
  const gaps = [];

  // Identity resolution is the same read-only code in every runtime: prefer the worktree's own
  // selection, then the runtime this CLI runs from, then this checkout. It never writes.
  const selectionRuntime = readSelection(resolve(options.workspace));
  const complete = (candidate) =>
    candidate && existsSync(join(candidate.path, "shared/control-plane/dist/index.js")) ? candidate : null;
  const resolver =
    complete(selectionRuntime.kind === "ok" ? selectionRuntime.runtime : null) ??
    complete(options.cliRuntime) ??
    complete({ path: resolve(dirname(fileURLToPath(import.meta.url)), "..", "..") });
  if (!resolver) {
    throw new SetupError("WORKSPACE_UNVERIFIED", "no complete runtime is available to resolve this worktree", {
      nextStep: "run diagnose from an installed runtime or a built checkout, or run init for this worktree first",
    });
  }
  const identity = await resolveIdentity(resolver.path, options.workspace);
  const root = identity.root;
  const stateDirectory = join(root, ".bridge");
  const redirected = redirectedComponent(root, ".bridge");
  if (redirected?.target) {
    throw new SetupError("DIAGNOSE_STATE_REDIRECTED", `${root}/.bridge is a symlink to ${redirected.target}; state must be a real directory`, {
      nextStep: "inspect that link by hand; the export never follows it",
    });
  }
  const databasePath = options.db ? resolve(options.db) : join(stateDirectory, "bridge.db");

  const aliases = createAliases({
    workspace: root,
    home: home,
    exchange: exchangeNamespace(identity, env).namespace,
    userhome: env.HOME ?? homedir(),
  });

  const since = parseSince(options.since, now);
  const scope = {
    kind: options.feature ? "feature" : options.task ? "task" : since !== null ? "window" : "summary",
    feature_id: options.feature ?? null,
    task_ids: new Set(options.task ? [options.task] : []),
    attempt: options.attempt === undefined ? null : Number(options.attempt),
    since,
  };
  if (scope.attempt !== null && scope.kind !== "task") {
    throw new SetupError("DIAGNOSE_SCOPE_INVALID", "--attempt selects an attempt of one task", {
      nextStep: "pass --task <id> --attempt <n>",
    });
  }
  scope.description = describeScope(scope);

  const namespace = exchangeNamespace(identity, env);
  if (resolve(namespace.namespace).startsWith(`${root}/`)) {
    throw new SetupError("DIAGNOSE_OUTPUT_UNSAFE", "the exchange namespace resolves inside the worktree", {
      nextStep: "unset HOME overrides that point into the repository",
    });
  }
  const staging = join(namespace.staging, `diagnose-${newTag()}`);
  let report;
  try {
    mkdirSync(staging, { recursive: true, mode: 0o700 });
  } catch (error) {
    throw new SetupError("DIAGNOSE_OUTPUT_UNWRITABLE", `cannot create ${staging}: ${error.message}`, {
      nextStep: "check the permissions of the exchange namespace",
    });
  }

  try {
    const snapshot = await snapshotDatabase(databasePath, join(staging, "snapshot.db"), gaps);
    const state = collectState(snapshot, scope, gaps);
    if (scope.kind === "feature" && state.feature) {
      for (const id of [...(state.feature.task_ids ?? []), state.feature.parent_task_id].filter(Boolean)) {
        scope.task_ids.add(id);
      }
    }
    const logs = collectLogs(stateDirectory, scope, gaps);
    const versions = collectVersions(root, home, aliases, gaps);

    // Summary mode: report what could be selected and export nothing.
    if (scope.kind === "summary") {
      rmSync(staging, { recursive: true, force: true });
      return {
        format: DIAGNOSTICS_FORMAT,
        mode: "summary",
        workspace: root,
        database: { present: snapshot !== null, integrity: snapshot?.integrity ?? null, last_event_id: state.last_event_id },
        available: state.available,
        logs: logs.files,
        gaps,
        next_step: "select a scope: --feature <id>, --task <id> [--attempt <n>] or --since <30m|6h|ISO>",
      };
    }

    let doctor = null;
    try {
      // Reuse doctor rather than re-implementing its checks, without the parts that would start
      // a client or load the project's own configuration.
      const full = await runDoctor({ home, workspace: root, handshake: false, safeSubset: true, cliRuntime: options.cliRuntime ?? null, env });
      doctor = {
        format: full.format,
        generated_at: full.generated_at,
        status: full.status,
        subset: "safe",
        omitted: ["handshake", "codex_project"],
        checks: full.checks.map((check) => projectDoctorCheck(check, aliases)),
      };
    } catch (error) {
      gaps.push({ part: "doctor", reason: "failed", detail: String(error.message).slice(0, 200) });
    }

    // A window scope learns its tasks from the window itself; a named scope already has them.
    for (const id of state.task_ids ?? []) scope.task_ids.add(id);
    const taskIds = [...scope.task_ids];
    const evidence = collectEvidence(stateDirectory, taskIds, gaps, { include: Boolean(options.withEvidence) });
    const events = state.events.map((row) => projectEvent(row, aliases));
    const logRecords = logs.records.map((entry) => ({ file: entry.file, record: projectLogRecord(entry.record, aliases) }));
    const cutoffs = {
      database: {
        taken_at: snapshot ? iso(snapshot.taken_at) : null,
        last_event_id: state.last_event_id,
        integrity: snapshot?.integrity ?? null,
        method: "sqlite backup api (wal included)",
      },
      logs: {
        read_at: iso(now),
        files: logs.files.length,
        bytes_read: logs.files.reduce((total, file) => total + file.bytes_read, 0),
        truncated: logs.files.some((file) => file.truncated),
      },
      processes: { observed: false, note: "running processes are not inspected by the export" },
    };

    const byFile = new Map();
    for (const entry of logRecords) {
      if (!byFile.has(entry.file)) byFile.set(entry.file, []);
      byFile.get(entry.file).push(entry.record);
    }

    const entries = [];
    const add = (name, data) => entries.push({ name, data: Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8") });

    add("timeline.md", renderTimeline({ scope, events, logRecords, versions, cutoffs }));
    add("ANALYSIS.md", ANALYSIS);
    add(
      "records/tasks.json",
      `${JSON.stringify(state.tasks.map((task) => pick(task, TASK_FIELDS, aliases)), null, 2)}\n`,
    );
    add(
      "records/attempts.json",
      `${JSON.stringify(state.attempts.map((attempt) => ({
        ...pick(attempt, ATTEMPT_FIELDS, aliases),
        // The execution handle is a session pointer: correlate by digest, never by value.
        execution_handle_ref: attempt.execution_handle ? digest(attempt.execution_handle) : null,
      })), null, 2)}\n`,
    );
    add(
      "records/telemetry.json",
      `${JSON.stringify(state.telemetry.map((record) => pick(record, TELEMETRY_FIELDS, aliases)), null, 2)}\n`,
    );
    add("records/events.json", `${JSON.stringify(events, null, 2)}\n`);
    add(
      "records/feature.json",
      `${JSON.stringify(
        state.feature
          ? {
              feature_id: state.feature.feature_id,
              state: state.feature.state,
              manager: state.feature.manager,
              parent_task_id: state.feature.parent_task_id,
              latest_task_id: state.feature.latest_task_id,
              active_task_id: state.feature.active_task_id,
              task_ids: state.feature.task_ids ?? [],
              updated_at: iso(state.feature.updated_at),
              workspace_id: state.feature.workspace_id ?? null,
              manager_epoch: state.feature.manager_epoch ?? null,
              // The question and its answer are user content and stay out of the package.
              question_present: state.feature.question !== null && state.feature.question !== undefined,
            }
          : null,
        null,
        2,
      )}\n`,
    );
    add(
      "records/workspace.json",
      `${JSON.stringify(
        {
          workspace_id: state.binding?.workspace_id ?? null,
          kind: identity.kind,
          root: aliases.path(root),
          database: aliases.path(databasePath),
          bound_at: iso(state.binding?.bound_at),
          schema_version: state.schema_version,
          manager: state.manager
            ? {
                epoch: state.manager.epoch ?? null,
                instance_generation: state.manager.instance_generation ?? null,
                active_instance: Boolean(state.manager.active_instance_id),
                native_thread_ref: state.manager.native_thread_id ? digest(state.manager.native_thread_id) : null,
                active_feature_id: state.manager.active_feature_id ?? null,
              }
            : null,
        },
        null,
        2,
      )}\n`,
    );
    for (const [file, records] of byFile) add(`logs/${file}`, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
    add("evidence/index.json", `${JSON.stringify(evidence.index, null, 2)}\n`);
    for (const file of evidence.files) add(file.name, file.data);
    if (doctor) add("doctor.json", `${JSON.stringify(doctor, null, 2)}\n`);

    if (options.withDatabase) {
      if (!snapshot) {
        gaps.push({ part: "database_extension", reason: "absent", detail: "no snapshot to include" });
      } else if (snapshot.bytes > MAX_ENTRY_BYTES) {
        gaps.push({ part: "database_extension", reason: "too_large", detail: `${snapshot.bytes} bytes` });
      } else {
        add("database/snapshot.db", readFileSync(snapshot.path));
      }
    }

    const extensions = {
      evidence_files: Boolean(options.withEvidence),
      raw_database: Boolean(options.withDatabase) && entries.some((entry) => entry.name === "database/snapshot.db"),
    };
    const manifest = {
      format: DIAGNOSTICS_FORMAT,
      generated_at: iso(now),
      workspace: {
        root: aliases.path(root),
        workspace_id: state.binding?.workspace_id ?? null,
        workspace_key: namespace.workspace_key,
        kind: identity.kind,
      },
      scope: {
        kind: scope.kind,
        feature_id: scope.feature_id,
        task_ids: taskIds,
        attempt: scope.attempt,
        since: iso(scope.since),
        description: scope.description,
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
      gaps,
      extensions,
      privacy: {
        default: "allowlist",
        aliases: "absolute paths are replaced by package-local aliases; the map is not included",
        withheld: [
          "prompts, answers and transcripts",
          "task objectives, write scopes, verification criteria and blockers",
          "user questions and answers",
          "process stderr (including refused calls, which exist only there)",
          "execution handles and native thread ids (short digests only)",
        ],
        note: "redaction is an allowlist plus known credential shapes, not a guarantee; review the package before sharing it",
      },
      limits: [
        "the database, the logs and the running processes have no common snapshot: the cutoffs above differ",
        "log rotation or retention during the export can remove older records; deletions are recorded in the log itself",
        "records produced before the log was armed, and refused calls, are not in any file",
        "this package is a copy: it is not authoritative state and must not be replayed into a worktree",
      ],
      files: {},
    };
    for (const entry of entries) {
      manifest.files[entry.name] = { bytes: entry.data.length, sha256: sha256(entry.data) };
    }
    const manifestEntry = { name: "diagnostics-manifest.json", data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8") };

    const name = options.name ?? defaultName(scope, now, newTag().slice(0, 6));
    const target = options.out ? resolve(options.out) : join(namespace.packages, name);
    if (existsSync(target)) {
      throw new SetupError("DIAGNOSE_PACKAGE_EXISTS", `${target} already exists`, {
        nextStep: "pass --out <path> with a new name; the export never overwrites a package",
      });
    }
    try {
      mkdirSync(dirname(target), { recursive: true });
    } catch (error) {
      throw new SetupError("DIAGNOSE_OUTPUT_UNWRITABLE", `cannot create ${dirname(target)}: ${error.message}`, {
        nextStep: "check the permissions of the destination directory",
      });
    }
    // Write inside the private staging directory first, then move it into place: an interrupted
    // export leaves no half-written package behind, and a destination that cannot be written is
    // a refusal rather than a partial file.
    const temporary = join(staging, "package.zip");
    const written = writeZip(temporary, [manifestEntry, ...entries].sort((a, b) => (a.name < b.name ? -1 : 1)), { mode: 0o600, at: now });
    try {
      renameSync(temporary, target);
    } catch (error) {
      throw new SetupError("DIAGNOSE_OUTPUT_UNWRITABLE", `cannot write ${target}: ${error.message}`, {
        nextStep: "check the permissions of the destination directory; nothing was written",
      });
    }

    report = {
      format: DIAGNOSTICS_FORMAT,
      mode: "package",
      workspace: root,
      package: target,
      sha256: written.sha256,
      bytes: written.bytes,
      scope: manifest.scope,
      cutoffs,
      counts: manifest.counts,
      gaps,
      extensions,
      contents: [manifestEntry, ...entries].map((entry) => ({ name: entry.name, bytes: entry.data.length })).sort((a, b) => (a.name < b.name ? -1 : 1)),
      risk: riskNote(extensions),
    };
    return report;
  } finally {
    // The private snapshot never survives the export unless it was deliberately included.
    rmSync(staging, { recursive: true, force: true });
  }
}

function defaultName(scope, at, tag) {
  const stamp = new Date(at).toISOString().replace(/[-:]/gu, "").replace(/\.\d+Z$/u, "Z");
  const label =
    scope.kind === "feature"
      ? scope.feature_id
      : scope.kind === "task"
        ? [...scope.task_ids][0]
        : "window";
  const safe = String(label).replace(/[^A-Za-z0-9._-]/gu, "-").slice(0, 60);
  // The tag keeps two exports of one scope in the same second from colliding; the export
  // never overwrites a package, so a collision would otherwise be a refusal.
  return `diagnose-${safe}-${stamp}-${tag}.zip`;
}

function riskNote(extensions) {
  const lines = [
    "Contains identifiers, states, timings and machine codes of the selected scope only.",
    "No prompts, answers, transcripts, objectives, scopes or blockers; paths are aliased.",
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

/** Read a package back: used by `--inspect` and by the tests. */
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
    lines.push(`database: ${report.database.present ? `present (integrity ${report.database.integrity}, last event ${report.database.last_event_id ?? "none"})` : "absent"}`);
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
    for (const gap of report.gaps) lines.push(`gap: ${gap.part} ${gap.reason}${gap.detail ? ` (${gap.detail})` : ""}`);
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
    `log cutoff: ${report.cutoffs.logs.read_at} (${report.cutoffs.logs.files} file(s), ${report.cutoffs.logs.bytes_read} bytes)`,
    "contents:",
  ];
  for (const entry of report.contents) lines.push(`  ${String(entry.bytes).padStart(8)}  ${entry.name}`);
  if (report.gaps.length > 0) {
    lines.push("gaps:");
    for (const gap of report.gaps) lines.push(`  ${gap.part}: ${gap.reason}${gap.detail ? ` (${gap.detail})` : ""}`);
  }
  lines.push("risk:");
  for (const line of report.risk) lines.push(`  ${line}`);
  return `${lines.join("\n")}\n`;
}
