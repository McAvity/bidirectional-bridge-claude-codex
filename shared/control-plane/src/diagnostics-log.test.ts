/**
 * Diagnostics log: authorized write point, bounded records, rotation and retention.
 *
 * These are the unit-level guarantees of wave13 §1/§2. The launcher-level proof that an
 * ordinary `codex` session produces these files without any manual command lives in
 * `shared/mcp-server-core/src/native-launcher.test.ts`.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DIAGNOSTICS_LIMITS,
  DIAGNOSTICS_LOG_SCHEMA,
  DiagnosticsLogger,
  readDiagnosticsLogConfig,
  type DiagnosticsLogLimits,
} from "./diagnostics-log.js";

const temporaries: string[] = [];

function workspace(): { root: string; state: string; logs: string } {
  const root = mkdtempSync(join(tmpdir(), "bridge-log-"));
  temporaries.push(root);
  return { root, state: join(root, ".bridge"), logs: join(root, ".bridge", "logs") };
}

interface Harness {
  readonly logger: DiagnosticsLogger;
  readonly warnings: string[];
}

function logger(
  limits: Partial<DiagnosticsLogLimits> = {},
  options: { pid?: number; at?: number } = {},
): Harness {
  const warnings: string[] = [];
  const at = options.at ?? Date.UTC(2026, 8, 16, 6, 11, 19);
  return {
    warnings,
    logger: new DiagnosticsLogger({
      instanceId: "inst_0123456789abcdef",
      role: "codex",
      packageVersion: "0.2.0-test",
      runtimeId: null,
      config: { enabled: true, limits: { ...DEFAULT_DIAGNOSTICS_LIMITS, ...limits }, problems: [] },
      warn: (line) => warnings.push(line),
      pid: options.pid ?? 424242,
      now: () => at,
      isProcessAlive: (pid) => pid === process.pid,
    }),
  };
}

function records(directory: string): Array<Record<string, any>> {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .flatMap((name) =>
      readFileSync(join(directory, name), "utf8")
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, any>),
    );
}

afterEach(() => {
  for (const path of temporaries.splice(0)) {
    rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

describe("diagnostics log", () => {
  it("writes nothing before the guard arms it", () => {
    const ws = workspace();
    const { logger: log } = logger();

    log.record({ op: "process", event: "serving" });
    log.record({ op: "tool", event: "call.finished", tool: "bridge_manager_status", outcome: "error" });

    expect(existsSync(ws.state)).toBe(false);
    expect(log.status).toMatchObject({ armed: false, written: 0, deferred: 2 });

    // Arming restates the deferred count instead of buffering records of unknown ownership.
    log.arm({ stateDirectory: ws.state, workspaceId: "ws_00112233445566", by: "bridge_create_task" });
    const first = records(ws.logs)[0]!;
    expect(first).toMatchObject({
      schema: DIAGNOSTICS_LOG_SCHEMA,
      op: "process",
      event: "start",
      workspace: "ws_00112233445566",
      role: "codex",
      source: "0.2.0-test",
      runtime: null,
      seq: 3,
    });
    expect(first["details"]).toMatchObject({ deferred_records: 2, armed_by: "bridge_create_task" });
    expect(statSync(join(ws.logs, readdirSync(ws.logs).find((n) => n.endsWith(".jsonl"))!)).mode & 0o777)
      .toBe(0o600);
    expect(statSync(ws.logs).mode & 0o777).toBe(0o700);
  });

  it("orders records by a process counter and a monotonic clock, not only wall time", () => {
    const ws = workspace();
    const { logger: log } = logger();
    log.arm({ stateDirectory: ws.state, workspaceId: "ws_1", by: "bridge_create_task" });
    log.record({ op: "tool", event: "call.finished", tool: "bridge_create_task", outcome: "ok" });
    log.record({ op: "tool", event: "call.finished", tool: "bridge_claim_task", outcome: "ok" });

    const all = records(ws.logs);
    expect(all.map((r) => r["seq"])).toEqual([1, 2, 3]);
    // The injected wall clock is frozen; ordering still has independent evidence.
    expect(new Set(all.map((r) => r["ts"])).size).toBe(1);
    const mono = all.map((r) => r["mono_ms"] as number);
    expect(mono.every((value, index) => index === 0 || value >= mono[index - 1]!)).toBe(true);
  });

  it("clamps an oversized record instead of writing an unbounded line", () => {
    const ws = workspace();
    const { logger: log } = logger({ maxRecordBytes: 1024 });
    log.arm({ stateDirectory: ws.state, workspaceId: "ws_1", by: "bridge_create_task" });
    const details: Record<string, unknown> = {};
    for (let index = 0; index < 12; index += 1) details[`field_${index}`] = "x".repeat(50_000);
    log.record({ op: "tool", event: "call.finished", tool: "bridge_feature_run", details });

    const lines = readFileSync(
      join(ws.logs, readdirSync(ws.logs).find((n) => n.endsWith(".jsonl"))!),
      "utf8",
    ).split("\n").filter(Boolean);
    for (const line of lines) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(1024);
    const last = JSON.parse(lines[lines.length - 1]!) as Record<string, any>;
    expect(last["truncated"]).toBe(true);
    expect(JSON.stringify(last)).not.toContain("xxxxx");
  });

  it("keeps only allowlisted scalar details and strips control characters", () => {
    const ws = workspace();
    const { logger: log } = logger();
    log.arm({ stateDirectory: ws.state, workspaceId: "ws_1", by: "bridge_create_task" });
    log.record({
      op: "tool",
      event: "call.finished",
      details: {
        reason: "line one\nline two",
        Nested: { secret: "value" },
        payload: ["a", "b"],
      },
    });
    const last = records(ws.logs).pop()!;
    expect(last["details"]).toMatchObject({ reason: "line one line two", payload: null, dropped_fields: 1 });
    expect(JSON.stringify(last)).not.toContain("secret");
  });

  it("rotates on the configured file size and records the rotation", () => {
    const ws = workspace();
    const { logger: log } = logger({ maxFileBytes: 2048 });
    log.arm({ stateDirectory: ws.state, workspaceId: "ws_1", by: "bridge_create_task" });
    for (let index = 0; index < 20; index += 1) {
      log.record({ op: "tool", event: "call.finished", tool: "bridge_get_task", details: { index } });
    }
    const files = readdirSync(ws.logs).filter((name) => name.endsWith(".jsonl"));
    expect(files.length).toBeGreaterThan(1);
    for (const file of files) {
      expect(statSync(join(ws.logs, file)).size).toBeLessThan(2048 + DEFAULT_DIAGNOSTICS_LIMITS.maxRecordBytes);
    }
    expect(records(ws.logs).filter((r) => r["event"] === "rotated").length).toBe(files.length - 1);
    expect(log.status.rotations).toBe(files.length - 1);
  });

  it("deletes only its own unused files and reports the gap it created", () => {
    const ws = workspace();
    mkdirSync(ws.logs, { recursive: true });
    // Two of this bridge's own older files, one foreign file, one file a live instance is using.
    const own = ["bridge-20260101T000000Z-aaaabbbbccccdddd-00.jsonl", "bridge-20260102T000000Z-aaaabbbbccccdddd-00.jsonl"];
    for (const name of own) writeFileSync(join(ws.logs, name), `${"{}\n".repeat(200)}`);
    writeFileSync(join(ws.logs, "operator-notes.txt"), "keep me");
    const busy = "bridge-20260103T000000Z-eeeeffff00001111-00.jsonl";
    writeFileSync(join(ws.logs, busy), "{}\n");
    writeFileSync(
      join(ws.logs, "instance-eeeeffff00001111.active"),
      `${JSON.stringify({ pid: process.pid, instance: "inst_eeeeffff00001111", file: busy })}\n`,
    );

    const { logger: log } = logger({ maxFiles: 2, maxTotalBytes: 4096 });
    log.arm({ stateDirectory: ws.state, workspaceId: "ws_1", by: "bridge_create_task" });

    const remaining = readdirSync(ws.logs);
    expect(remaining).toContain("operator-notes.txt");
    expect(remaining).toContain(busy);
    expect(remaining).toContain("instance-eeeeffff00001111.active");
    expect(remaining.filter((name) => own.includes(name))).toEqual([]);
    const retention = records(ws.logs).find((r) => r["event"] === "retention")!;
    expect(retention["details"]).toMatchObject({ deleted_files: 2 });
    expect(log.status.deleted).toBe(2);
  });

  it("deletes files older than the configured age and keeps younger ones", () => {
    const ws = workspace();
    mkdirSync(ws.logs, { recursive: true });
    const old = "bridge-20250101T000000Z-1111222233334444-00.jsonl";
    const fresh = "bridge-20260901T000000Z-1111222233334444-00.jsonl";
    writeFileSync(join(ws.logs, old), "{}\n");
    writeFileSync(join(ws.logs, fresh), "{}\n");
    const at = Date.now();
    utimesSync(join(ws.logs, old), new Date(at - 40 * 86_400_000), new Date(at - 40 * 86_400_000));
    utimesSync(join(ws.logs, fresh), new Date(at - 60_000), new Date(at - 60_000));

    const { logger: log } = logger({ maxAgeMs: 7 * 86_400_000 }, { at });
    log.arm({ stateDirectory: ws.state, workspaceId: "ws_1", by: "bridge_create_task" });

    const remaining = readdirSync(ws.logs);
    expect(remaining).not.toContain(old);
    expect(remaining).toContain(fresh);
  });

  it("never writes or deletes through a symlink", () => {
    const ws = workspace();
    const outside = mkdtempSync(join(tmpdir(), "bridge-log-victim-"));
    temporaries.push(outside);
    const victim = join(outside, "bridge-20260101T000000Z-9999888877776666-00.jsonl");
    writeFileSync(victim, "untouched\n");

    // A log directory redirected out of the worktree is refused outright.
    mkdirSync(ws.state, { recursive: true });
    symlinkSync(outside, ws.logs, "dir");
    const redirected = logger();
    redirected.logger.arm({ stateDirectory: ws.state, workspaceId: "ws_1", by: "bridge_create_task" });
    expect(redirected.logger.status).toMatchObject({ armed: false, disabled: true });
    expect(redirected.warnings.join("\n")).toContain("symlink");
    expect(readdirSync(outside)).toEqual([victim.split("/").pop()]);
    expect(readFileSync(victim, "utf8")).toBe("untouched\n");

    // A symlink *inside* the log directory that carries a log file name is neither read,
    // written nor deleted by retention.
    rmSync(ws.logs);
    mkdirSync(ws.logs, { recursive: true });
    const link = join(ws.logs, "bridge-20260101T000000Z-9999888877776666-00.jsonl");
    symlinkSync(victim, link);
    const { logger: log } = logger({ maxFiles: 2, maxTotalBytes: 1024 });
    log.arm({ stateDirectory: ws.state, workspaceId: "ws_1", by: "bridge_create_task" });
    log.record({ op: "tool", event: "call.finished", details: { padding: "z".repeat(2000) } });
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(victim, "utf8")).toBe("untouched\n");
  });

  it("fails bounded: a log that cannot be opened disables itself without throwing", () => {
    if (process.getuid?.() === 0) return; // root ignores the mode bits this case depends on
    const ws = workspace();
    mkdirSync(ws.state, { recursive: true });
    mkdirSync(ws.logs, { recursive: true, mode: 0o500 });
    const harness = logger();
    try {
      expect(() =>
        harness.logger.arm({ stateDirectory: ws.state, workspaceId: "ws_1", by: "bridge_create_task" }),
      ).not.toThrow();
      expect(harness.logger.status).toMatchObject({ armed: false, failures: 1 });
      // Later records neither throw nor claim to have been written.
      for (let index = 0; index < 50; index += 1) {
        harness.logger.record({ op: "tool", event: "call.finished", details: { index } });
      }
      expect(harness.logger.status.written).toBe(0);
      expect(harness.warnings.length).toBeLessThanOrEqual(4);
      expect(harness.warnings.join("\n")).toMatch(/EACCES|permission denied/iu);
      harness.logger.close("test");
      expect(readdirSync(ws.logs)).toEqual([]);
    } finally {
      rmSync(ws.logs, { recursive: true, force: true });
    }
  });

  it("stops writing after repeated write failures instead of looping", () => {
    const ws = workspace();
    const { logger: log, warnings } = logger({ maxFileBytes: 64 });
    log.arm({ stateDirectory: ws.state, workspaceId: "ws_1", by: "bridge_create_task" });
    // Remove the directory under the process: every rotation now fails.
    rmSync(ws.logs, { recursive: true, force: true });
    for (let index = 0; index < 100; index += 1) {
      expect(() => log.record({ op: "tool", event: "call.finished", details: { index } })).not.toThrow();
    }
    expect(log.status.disabled).toBe(true);
    expect(warnings.length).toBeLessThanOrEqual(MAX_EXPECTED_WARNINGS);
    expect(existsSync(ws.logs)).toBe(false);
  });

  it("closes with a final record and releases its active marker", () => {
    const ws = workspace();
    const { logger: log } = logger();
    log.arm({ stateDirectory: ws.state, workspaceId: "ws_1", by: "bridge_create_task" });
    expect(readdirSync(ws.logs).some((name) => name.endsWith(".active"))).toBe(true);
    log.record({ op: "tool", event: "call.finished", tool: "bridge_get_task", outcome: "ok" });
    log.close("SIGTERM");
    log.close("SIGTERM");

    expect(readdirSync(ws.logs).some((name) => name.endsWith(".active"))).toBe(false);
    const closing = records(ws.logs).pop()!;
    expect(closing).toMatchObject({ op: "log", event: "close" });
    expect(closing["details"]).toMatchObject({ reason: "SIGTERM", failures: 0 });
  });

  it("reads a finite configuration and keeps defaults for unusable values", () => {
    expect(readDiagnosticsLogConfig({}).limits).toEqual(DEFAULT_DIAGNOSTICS_LIMITS);
    expect(readDiagnosticsLogConfig({ BRIDGE_LOG: "off" }).enabled).toBe(false);

    const configured = readDiagnosticsLogConfig({
      BRIDGE_LOG_MAX_FILE_BYTES: "131072",
      BRIDGE_LOG_MAX_AGE_DAYS: "3",
      BRIDGE_LOG_MAX_TOTAL_BYTES: "0",
      BRIDGE_LOG_MAX_FILES: "not-a-number",
    });
    expect(configured.enabled).toBe(true);
    expect(configured.limits.maxFileBytes).toBe(131_072);
    expect(configured.limits.maxAgeMs).toBe(3 * 86_400_000);
    expect(configured.limits.maxTotalBytes).toBe(DEFAULT_DIAGNOSTICS_LIMITS.maxTotalBytes);
    expect(configured.limits.maxFiles).toBe(DEFAULT_DIAGNOSTICS_LIMITS.maxFiles);
    expect(configured.problems).toHaveLength(2);
  });

  it("writes nothing at all when logging is switched off", () => {
    const ws = workspace();
    const off = new DiagnosticsLogger({
      instanceId: "inst_0123456789abcdef",
      role: "codex",
      packageVersion: "0.2.0-test",
      config: { enabled: false, limits: DEFAULT_DIAGNOSTICS_LIMITS, problems: [] },
      warn: () => {},
    });
    off.arm({ stateDirectory: ws.state, workspaceId: "ws_1", by: "bridge_create_task" });
    off.record({ op: "tool", event: "call.finished" });
    off.close("test");
    expect(existsSync(ws.logs)).toBe(false);
  });
});

/** Three bounded warnings plus the final summary written by `close`. */
const MAX_EXPECTED_WARNINGS = 4;
