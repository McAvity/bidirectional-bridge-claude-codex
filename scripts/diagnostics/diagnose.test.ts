/**
 * Incident export (wave13 §3–§5): the real CLI, real worktree state and a synthetic executor.
 *
 * Every fixture is produced by spawning the actual launcher against a temporary worktree with
 * the repository's `fake-claude-cli` on PATH, so the packages under test are built from state
 * the bridge really wrote — a timed-out round, its attempt, its termination evidence and its
 * diagnostics log. No model is called and no paid pilot is involved.
 *
 * The second half of this file is the regression set of review 02-export (R2-01…R2-06).
 */

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { readZip } from "./zip.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const cli = join(repoRoot, "scripts", "bridge.mjs");
const launcher = join(repoRoot, "scripts", "native-bridge-mcp.mjs");
const fakeClaude = join(repoRoot, "claude", "claude-side", "test", "fixtures", "fake-claude-cli.mjs");

/** Secrets and content planted in several sources; none may reach a default package. */
const SECRETS = {
  objective: "SECRET-OBJECTIVE-never-export-me",
  roundObjective: "SECRET-ROUND-OBJECTIVE-never-export-me",
  question: "SECRET-QUESTION-never-export-me?",
  apiKey: "sk-ant-SECRETSECRETSECRETSECRET1234",
  /** Planted in a log `details` field the logger never writes (review R2-01). */
  detail: "REVIEW_PRIVATE_ANSWER_731",
  /** Planted inside malformed JSON, which a parser message would quote back. */
  malformed: "REVIEW_PRIVATE_MALFORMED_552",
};

const temporaries: string[] = [];

afterEach(() => {
  for (const path of temporaries.splice(0)) {
    try {
      chmodSync(path, 0o700);
    } catch {
      /* already writable or gone */
    }
    rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

function temporary(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  temporaries.push(path);
  return path;
}

interface Fixture {
  readonly root: string;
  readonly home: string;
  readonly env: NodeJS.ProcessEnv;
  readonly evidenceFailed: any;
  readonly namespaceRoot: string;
  readonly taskId: string;
  readonly roundTaskId: string;
  readonly featureId: string;
  readonly stderr: string;
}

/** One MCP call at a time over stdio; enough to drive the launcher into a real incident. */
class Client {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, (message: any) => void>();
  private buffer = "";
  private id = 0;
  readonly stderr: string[] = [];
  readonly exited: Promise<number | null>;

  constructor(workspace: string, env: NodeJS.ProcessEnv) {
    this.child = spawn(
      process.execPath,
      [launcher, "--caller", "codex", "--delegation", "allow", "--workspace", workspace],
      { cwd: repoRoot, env, stdio: ["pipe", "pipe", "pipe"] },
    ) as ChildProcessWithoutNullStreams;
    this.exited = new Promise((done) => this.child.once("exit", done));
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      for (;;) {
        const newline = this.buffer.indexOf("\n");
        if (newline < 0) return;
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (!line) continue;
        const message = JSON.parse(line) as { id?: number };
        if (message.id !== undefined && this.pending.has(message.id)) {
          this.pending.get(message.id)!(message);
          this.pending.delete(message.id);
        }
      }
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => this.stderr.push(chunk));
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  private send(method: string, params: unknown): Promise<any> {
    const id = (this.id += 1);
    return new Promise((done) => {
      this.pending.set(id, done);
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  async start(): Promise<void> {
    await this.send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "diagnose-test", version: "1" },
    });
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
  }

  async tool(name: string, args: Record<string, unknown>, thread = "thread-diagnose"): Promise<any> {
    const response = await this.send("tools/call", {
      name,
      arguments: args,
      _meta: {
        threadId: thread,
        "x-codex-turn-metadata": { session_id: thread, thread_id: thread, codex_version: "0.154.0" },
      },
    });
    return JSON.parse(response.result.content[0].text);
  }

  async stop(signal: NodeJS.Signals = "SIGTERM"): Promise<number | null> {
    this.child.kill(signal);
    return this.exited;
  }
}

/**
 * Drive the launcher into one finished incident: a feature, a round that ends the way `mode`
 * dictates, and a pending user question. Returns the identifiers the export selects by.
 */
async function incident(
  label: string,
  {
    mode = "hang",
    deadline = 1_200,
    featureId = "F-incident",
    thread = "thread-diagnose",
    /** Take write permission from the evidence directory and run one more attempt into it. */
    evidenceFailure = false,
    /** Run a second, unrelated delegation so a scope test has a foreign incident to exclude. */
    secondIncident = false,
    /** Kill the launcher instead of closing it, leaving the log without its closing records. */
    hardStop = false,
    extraEnv = {} as NodeJS.ProcessEnv,
  } = {},
): Promise<Fixture> {
  const root = temporary(`bridge-diag-${label}-`);
  const home = temporary(`bridge-diag-home-${label}-`);
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "claude"), `#!/bin/sh\nexec "${process.execPath}" "${fakeClaude}" "$@"\n`, { mode: 0o755 });
  const env = {
    ...process.env,
    HOME: home,
    PATH: `${bin}${delimiter}${process.env["PATH"] ?? ""}`,
    FAKE_CLAUDE_MODE: mode,
    FAKE_CLAUDE_STDERR: `fake runtime warning: ${SECRETS.apiKey} leaked into stderr\n`,
    ...extraEnv,
  };
  const client = new Client(root, env);
  await client.start();
  const spec = {
    objective: SECRETS.objective,
    scope: { paths: ["src/**"] },
    dependencies: [],
    expected_deliverable: "the deliverable",
    verification_criteria: ["npm test"],
  };
  const root_task = await client.tool("bridge_create_task", { spec }, thread);
  await client.tool("bridge_claim_task", { task_id: root_task.task_id }, thread);
  await client.tool("bridge_set_state", { task_id: root_task.task_id, to: "WORKING" }, thread);
  await client.tool("bridge_feature_create", { feature_id: featureId, parent_task_id: root_task.task_id }, thread);
  const round = await client.tool(
    "bridge_feature_run",
    {
      feature_id: featureId,
      spec: { ...spec, objective: SECRETS.roundObjective },
      deadline_ms: deadline,
      idempotency_key: `${featureId}:round-1`,
    },
    thread,
  );
  await client.tool(
    "bridge_feature_wait_user",
    { feature_id: featureId, question_id: "q1", question: SECRETS.question },
    thread,
  );
  if (secondIncident) {
    // A separate delegation with its own task: another incident in the same worktree.
    await client.tool(
      "bridge_delegate",
      {
        to: "claude",
        spec: { ...spec, scope: { paths: ["unrelated/**"] } },
        deadline_ms: 1_000,
        idempotency_key: `${featureId}:foreign`,
      },
      thread,
    );
  }
  let evidenceFailed = null;
  if (evidenceFailure) {
    const evidenceDirectory = join(root, ".bridge", "evidence");
    chmodSync(evidenceDirectory, 0o500);
    try {
      evidenceFailed = await client.tool(
        "bridge_delegate",
        {
          to: "claude",
          spec: { ...spec, scope: { paths: ["other/**"] } },
          deadline_ms: 1_000,
          idempotency_key: `${featureId}:evidence-failure`,
        },
        thread,
      );
    } finally {
      chmodSync(evidenceDirectory, 0o700);
    }
  }
  await client.stop(hardStop ? "SIGKILL" : "SIGTERM");
  return {
    root,
    home,
    env,
    evidenceFailed,
    namespaceRoot: join(home, "tmp", "bridge-exchange"),
    taskId: root_task.task_id as string,
    roundTaskId: (round.task?.task_id ?? round.task_id) as string,
    featureId,
    stderr: client.stderr.join(""),
  };
}

function diagnose(fixture: { root: string; home: string }, args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(
    process.execPath,
    [cli, "diagnose", "--workspace", fixture.root, "--home", join(fixture.home, "bridge-home"), ...args],
    { encoding: "utf8", env: { ...process.env, HOME: fixture.home, ...extraEnv }, timeout: 120_000 },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function diagnoseJson(fixture: { root: string; home: string }, args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  const result = diagnose(fixture, [...args, "--json"], extraEnv);
  try {
    return { ...result, json: JSON.parse(result.stdout) };
  } catch {
    throw new Error(`no JSON (exit ${result.status}):\n${result.stdout}\n${result.stderr}`);
  }
}

/** Content fingerprint of the worktree state; SQLite's own sidecars are technical files. */
function fingerprint(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const visit = (directory: string, prefix: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (/-(wal|shm|journal)$/u.test(entry.name)) continue;
      if (entry.isSymbolicLink()) out[relative] = "symlink";
      else if (entry.isDirectory()) visit(join(directory, entry.name), relative);
      else if (entry.isFile()) {
        out[relative] = createHash("sha256").update(readFileSync(join(directory, entry.name))).digest("hex");
      }
    }
  };
  if (existsSync(join(root, ".bridge"))) visit(join(root, ".bridge"), "");
  return out;
}

function open(path: string) {
  const entries = readZip(path);
  const manifest = JSON.parse(entries.get("diagnostics-manifest.json")!.toString("utf8"));
  const text = [...entries.values()].map((value) => value.toString("utf8")).join("\n");
  const json = (name: string) => JSON.parse(entries.get(name)!.toString("utf8"));
  const logRecords = () =>
    [...entries.entries()]
      .filter(([name]) => name.startsWith("logs/"))
      .flatMap(([, data]) =>
        data.toString("utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, any>),
      );
  return { entries, manifest, text, json, logRecords };
}

function packagesOf(fixture: { namespaceRoot: string }): string[] {
  if (!existsSync(fixture.namespaceRoot)) return [];
  return readdirSync(fixture.namespaceRoot).flatMap((key) => {
    const packages = join(fixture.namespaceRoot, key, "packages");
    return existsSync(packages) ? readdirSync(packages).map((name) => join(packages, name)) : [];
  });
}

function stagingOf(fixture: { namespaceRoot: string }): string[] {
  if (!existsSync(fixture.namespaceRoot)) return [];
  return readdirSync(fixture.namespaceRoot).flatMap((key) => {
    const staging = join(fixture.namespaceRoot, key, "staging");
    return existsSync(staging) ? readdirSync(staging).map((name) => join(staging, name)) : [];
  });
}

/** Append a synthetic diagnostics record to the worktree's newest log file. */
function appendLogRecord(root: string, record: Record<string, unknown>): void {
  const directory = join(root, ".bridge", "logs");
  const file = readdirSync(directory).filter((name) => name.endsWith(".jsonl")).sort().pop()!;
  appendFileSync(join(directory, file), `${JSON.stringify(record)}\n`);
}

function logTemplate(root: string): Record<string, any> {
  const directory = join(root, ".bridge", "logs");
  const file = readdirSync(directory).filter((name) => name.endsWith(".jsonl")).sort().pop()!;
  const lines = readFileSync(join(directory, file), "utf8").split("\n").filter(Boolean);
  return JSON.parse(lines[lines.length - 1]!);
}

async function waitFor<T>(probe: () => T | undefined, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("condition was not reached in time");
    await new Promise((done) => setTimeout(done, 20));
  }
}

describe("incident export", () => {
  it("without a scope it reports what can be selected and exports nothing", async () => {
    const fixture = await incident("summary");
    const before = fingerprint(fixture.root);
    const report = diagnoseJson(fixture, []);

    expect(report.status).toBe(0);
    expect(report.json).toMatchObject({ mode: "summary", format: "claude-codex-bridge.diagnostics/v1" });
    expect(report.json.available.features[0]).toMatchObject({ feature_id: fixture.featureId });
    expect(report.json.available.tasks.map((task: { task_id: string }) => task.task_id)).toContain(fixture.roundTaskId);
    expect(report.json.logs.length).toBeGreaterThan(0);
    expect(report.json.next_step).toContain("--feature");
    expect(packagesOf(fixture)).toEqual([]);
    expect(stagingOf(fixture)).toEqual([]);
    expect(fingerprint(fixture.root)).toEqual(before);
  }, 60_000);

  it("exports the selected feature with a manifest, hashes, a timeline and machine records", async () => {
    const fixture = await incident("feature");
    const report = diagnoseJson(fixture, ["--feature", fixture.featureId]);
    expect(report.status).toBe(0);

    const path = report.json.package as string;
    expect(path.startsWith(fixture.namespaceRoot)).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(createHash("sha256").update(readFileSync(path)).digest("hex")).toBe(report.json.sha256);

    const pkg = open(path);
    expect(pkg.manifest.scope).toMatchObject({ kind: "feature", feature_id: fixture.featureId });
    expect(pkg.manifest.scope.task_ids).toContain(fixture.roundTaskId);
    for (const [name, record] of Object.entries<{ sha256: string; bytes: number }>(pkg.manifest.files)) {
      const data = pkg.entries.get(name)!;
      expect(data, `${name} is listed but missing`).toBeDefined();
      expect(createHash("sha256").update(data).digest("hex")).toBe(record.sha256);
      expect(data.length).toBe(record.bytes);
    }
    expect([...pkg.entries.keys()].sort()).toEqual(
      ["diagnostics-manifest.json", ...Object.keys(pkg.manifest.files)].sort(),
    );

    const timeline = pkg.entries.get("timeline.md")!.toString("utf8");
    expect(timeline).toContain("# Incident timeline");
    expect(timeline).toContain(fixture.roundTaskId);
    expect(timeline).toContain("| db |");
    expect(timeline).toMatch(/\| log:inst_[0-9a-f]+ \|/u);

    const attempts = pkg.json("records/attempts.json") as Array<{ attempt: number; outcome: string; execution_handle_ref: string | null }>;
    expect(attempts[0]).toMatchObject({ attempt: 0, outcome: "TIMEOUT" });
    expect(attempts[0]!.execution_handle_ref).toMatch(/^[0-9a-f]{12}$/u);
    const events = pkg.json("records/events.json") as Array<{ type: string }>;
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["attempt.started", "attempt.ended", "delegation.failed"]),
    );
    expect(pkg.json("records/feature.json")).toMatchObject({ feature_id: fixture.featureId, question_present: true });

    const inspected = diagnoseJson(fixture, ["--inspect", path]);
    expect(inspected.json).toMatchObject({ integrity: "ok", format: "claude-codex-bridge.diagnostics/v1" });
  }, 60_000);

  it("snapshots a live WAL writer consistently and changes nothing in the source", async () => {
    const fixture = await incident("wal");
    const before = fingerprint(fixture.root);
    const writer = spawn(
      process.execPath,
      [
        "-e",
        `const { DatabaseSync } = require('node:sqlite');
         const db = new DatabaseSync(process.argv[1]);
         db.exec("PRAGMA journal_mode = WAL");
         let n = 0;
         setInterval(() => {
           n += 1;
           db.exec("INSERT INTO events (type, task_id, agent, at, payload_json) VALUES ('probe.write', '" + process.argv[2] + "', 'codex', " + Date.now() + ", '{\\"attempt\\":" + n + "}')");
         }, 15);`,
        join(fixture.root, ".bridge", "bridge.db"),
        fixture.roundTaskId,
      ],
      { stdio: "ignore" },
    );
    try {
      await new Promise((done) => setTimeout(done, 300));
      const report = diagnoseJson(fixture, ["--task", fixture.roundTaskId, "--with-database"]);
      expect(report.status).toBe(0);
      expect(report.json.cutoffs.database.integrity).toBe("ok");
      expect(report.json.cutoffs.database.method).toContain("backup api");

      const pkg = open(report.json.package as string);
      const snapshot = pkg.entries.get("database/snapshot.db")!;
      const copy = join(fixture.home, "copy.db");
      writeFileSync(copy, snapshot);
      const { DatabaseSync } = await import("node:sqlite");
      const db = new DatabaseSync(copy, { readOnly: true } as never) as any;
      expect(String(db.prepare("PRAGMA integrity_check").get().integrity_check)).toBe("ok");
      expect(Number(db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'probe.write'").get().n)).toBeGreaterThan(0);
      db.close();
    } finally {
      writer.kill("SIGKILL");
    }
    expect(fingerprint(fixture.root)).toEqual(before);
  }, 90_000);

  it("excludes secrets and content by default and names every extension explicitly", async () => {
    const fixture = await incident("privacy");
    const report = diagnoseJson(fixture, ["--feature", fixture.featureId]);
    const pkg = open(report.json.package as string);

    for (const secret of Object.values(SECRETS)) {
      expect(pkg.text, `the default package must not contain ${secret}`).not.toContain(secret);
    }
    expect([...pkg.entries.keys()].some((name) => name.startsWith("database/"))).toBe(false);
    expect([...pkg.entries.keys()].some((name) => /^evidence\/task/u.test(name))).toBe(false);
    expect(pkg.text).not.toContain(fixture.root);
    expect(pkg.text).not.toContain(fixture.home);
    expect(pkg.manifest.workspace.root).toBe("<workspace>");
    expect(pkg.manifest.extensions).toEqual({ evidence_files: false, raw_database: false });
    const index = pkg.json("evidence/index.json") as Array<{ file: string; included_in_package: boolean; sha256: string }>;
    expect(index.length).toBeGreaterThan(0);
    expect(index[0]).toMatchObject({ included_in_package: false });

    const extended = diagnoseJson(fixture, ["--feature", fixture.featureId, "--with-evidence", "--with-database"]);
    const big = open(extended.json.package as string);
    expect(big.manifest.extensions).toEqual({ evidence_files: true, raw_database: true });
    expect([...big.entries.keys()]).toContain("database/snapshot.db");
    expect([...big.entries.keys()].some((name) => /^evidence\/task.*attempt-0\.json$/u.test(name))).toBe(true);
    expect(extended.json.risk.join(" ")).toContain("EXTENSION");
    expect(big.text).not.toContain(SECRETS.apiKey);
    expect(big.text).toContain("[redacted:");
  }, 90_000);

  it("keeps two worktrees with the same feature name apart", async () => {
    const first = await incident("wsa", { featureId: "F-same", thread: "thread-a" });
    const second = await incident("wsb", { featureId: "F-same", thread: "thread-b" });

    const one = open(diagnoseJson(first, ["--feature", "F-same"]).json.package as string);
    const two = open(diagnoseJson(second, ["--feature", "F-same"]).json.package as string);

    expect(one.manifest.workspace.workspace_key).not.toBe(two.manifest.workspace.workspace_key);
    expect(one.manifest.workspace.workspace_id).not.toBe(two.manifest.workspace.workspace_id);
    expect(one.text).toContain(first.roundTaskId);
    expect(one.text, "one worktree's package must not mention the other's task").not.toContain(second.roundTaskId);
    expect(two.text).toContain(second.roundTaskId);
    expect(two.text).not.toContain(first.roundTaskId);
  }, 120_000);

  it("still exports from partially corrupt state and reports every gap", async () => {
    const fixture = await incident("corrupt");
    const logDirectory = join(fixture.root, ".bridge", "logs");
    const logFile = readdirSync(logDirectory).find((name) => name.endsWith(".jsonl"))!;
    writeFileSync(join(logDirectory, logFile), `${readFileSync(join(logDirectory, logFile), "utf8")}{"schema":"claude`);
    const evidenceDirectory = join(fixture.root, ".bridge", "evidence", fixture.roundTaskId);
    writeFileSync(join(evidenceDirectory, "attempt-0.json"), "{ not json");

    const report = diagnoseJson(fixture, ["--feature", fixture.featureId]);
    expect(report.status).toBe(0);
    const gaps = (report.json.gaps as Array<{ part: string; reason: string }>).map((gap) => `${gap.part}:${gap.reason}`);
    expect(gaps).toContain("logs:unparsable_lines");
    expect(gaps).toContain("evidence:unparsable");
    const pkg = open(report.json.package as string);
    expect((pkg.json("records/tasks.json") as unknown[]).length).toBeGreaterThan(0);

    writeFileSync(join(fixture.root, ".bridge", "bridge.db"), "this is not a database");
    const broken = diagnoseJson(fixture, ["--since", "2h"]);
    expect(broken.status).toBe(0);
    const brokenGaps = (broken.json.gaps as Array<{ part: string; reason: string }>).map((gap) => `${gap.part}:${gap.reason}`);
    expect(brokenGaps.some((gap) => gap.startsWith("database"))).toBe(true);
    const brokenPkg = open(broken.json.package as string);
    expect(brokenPkg.manifest.counts.tasks).toBe(0);
  }, 90_000);

  it("shows the executor deadline, the adapter failure and the evidence gap as separate facts", async () => {
    const timedOut = await incident("deadline");
    const timedOutPackage = open(diagnoseJson(timedOut, ["--feature", timedOut.featureId]).json.package as string);
    const records = timedOutPackage.logRecords();
    const started = records.find((record) => record["op"] === "attempt" && record["event"] === "started")!;
    const finished = records.find((record) => record["op"] === "attempt" && record["event"] === "finished")!;
    expect(started["details"]).toMatchObject({ deadline_ms: 1_200, agent: "claude" });
    expect(finished).toMatchObject({ code: "TIMEOUT", phase: "deadline", attempt: 0 });
    expect(finished["details"]).toMatchObject({ termination_kind: "timeout" });
    expect(timedOutPackage.entries.get("ANALYSIS.md")!.toString("utf8")).toContain("timeout is a different budget");
    const evidenceIndex = timedOutPackage.json("evidence/index.json") as Array<{ termination_kind: string }>;
    expect(evidenceIndex[0]).toMatchObject({ termination_kind: "timeout" });

    const crashed = await incident("adapter", { mode: "noresult", deadline: 20_000 });
    const crashedPackage = open(diagnoseJson(crashed, ["--feature", crashed.featureId]).json.package as string);
    const failure = crashedPackage.logRecords().find((record) => record["op"] === "attempt" && record["event"] === "finished")!;
    expect(failure).toMatchObject({ outcome: "error", phase: "runtime", code: "ADAPTER_FAILURE" });
    expect(failure["details"]).toMatchObject({ termination_kind: "crash" });
    expect(crashedPackage.json("records/attempts.json")[0]).toMatchObject({ outcome: "ADAPTER_FAILURE" });
  }, 120_000);

  it("records an evidence write that failed, and exports it as a gap with the attempt", async () => {
    if (process.getuid?.() === 0) return; // root ignores the mode bits this case depends on
    const fixture = await incident("evidence", { evidenceFailure: true });
    expect(fixture.evidenceFailed.error?.code).toBe("TIMEOUT");

    const report = diagnoseJson(fixture, ["--since", "1h"]);
    expect(report.status).toBe(0);
    const pkg = open(report.json.package as string);
    const failure = pkg.logRecords().find((record) => record["event"] === "evidence.write_failed");
    expect(failure, "the failed evidence write must be observable").toBeDefined();
    expect(failure).toMatchObject({ op: "attempt", outcome: "error", phase: "evidence", code: "EACCES" });
    const index = pkg.json("evidence/index.json") as Array<{ task_id: string }>;
    expect(index.some((entry) => entry.task_id === failure!["task_id"])).toBe(false);
    expect(index.some((entry) => entry.task_id === fixture.roundTaskId)).toBe(true);
  }, 90_000);

  it("exports a live round without stopping it, and shows the attempt still open", async () => {
    const root = temporary("bridge-diag-live-");
    const home = temporary("bridge-diag-live-home-");
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "claude"), `#!/bin/sh\nexec "${process.execPath}" "${fakeClaude}" "$@"\n`, { mode: 0o755 });
    const client = new Client(root, {
      ...process.env,
      HOME: home,
      PATH: `${bin}${delimiter}${process.env["PATH"] ?? ""}`,
      FAKE_CLAUDE_MODE: "hang",
    });
    try {
      await client.start();
      const spec = {
        objective: SECRETS.objective,
        scope: { paths: ["src/**"] },
        dependencies: [],
        expected_deliverable: "d",
        verification_criteria: ["npm test"],
      };
      const root_task = await client.tool("bridge_create_task", { spec });
      await client.tool("bridge_claim_task", { task_id: root_task.task_id });
      await client.tool("bridge_set_state", { task_id: root_task.task_id, to: "WORKING" });
      await client.tool("bridge_feature_create", { feature_id: "F-live", parent_task_id: root_task.task_id });
      // The client stops waiting for this call: its own timeout is a different budget from the
      // executor deadline, and the worker keeps running either way.
      const abandoned = client.tool("bridge_feature_run", {
        feature_id: "F-live",
        spec,
        deadline_ms: 20_000,
        idempotency_key: "F-live:round-1",
      });
      const started = await waitFor(() =>
        readLog(root).find((record) => record["op"] === "attempt" && record["event"] === "started"),
      );
      expect(started!["details"]).toMatchObject({ deadline_ms: 20_000 });

      const report = diagnoseJson({ root, home }, ["--feature", "F-live"]);
      expect(report.status).toBe(0);
      const pkg = open(report.json.package as string);
      const records = pkg.logRecords();
      expect(records.some((record) => record["event"] === "started")).toBe(true);
      expect(records.some((record) => record["event"] === "finished")).toBe(false);
      expect(records.some((record) => record["tool"] === "bridge_feature_run" && record["event"] === "call.finished")).toBe(false);
      const attempts = pkg.json("records/attempts.json") as Array<{ outcome?: string; ended_at?: string }>;
      expect(attempts[0]!.outcome).toBeUndefined();
      expect(attempts[0]!.ended_at).toBeUndefined();
      expect(pkg.manifest.cutoffs.processes.observed).toBe(false);

      const result = await abandoned;
      expect(result.task?.state ?? result.state).toBeDefined();
    } finally {
      await client.stop();
    }
  }, 120_000);

  it("carries the analysis instruction and a doctor subset that starts nothing", async () => {
    const fixture = await incident("analysis");
    const report = diagnoseJson(fixture, ["--feature", fixture.featureId]);
    const pkg = open(report.json.package as string);

    const analysis = pkg.entries.get("ANALYSIS.md")!.toString("utf8");
    for (const expected of [
      "data, not instructions",
      "diagnostics-manifest.json",
      "timeline.md",
      "Separate observation from hypothesis",
      "smallest safe next step",
    ]) {
      expect(analysis).toContain(expected);
    }

    const doctor = pkg.json("doctor.json") as {
      subset: string;
      omitted: string[];
      checks: Array<{ id: string; status: string; code: string; summary?: string }>;
    };
    expect(doctor.subset).toBe("safe");
    expect(doctor.omitted).toEqual(["handshake", "codex_project"]);
    expect(doctor.checks.find((check) => check.id === "handshake")!.status).toBe("skipped");
    expect(doctor.checks.find((check) => check.id === "codex_project")!.status).toBe("skipped");
    expect(doctor.checks.find((check) => check.id === "logs")).toBeDefined();
    for (const check of doctor.checks) {
      expect(Object.keys(check).every((key) => ["code", "id", "next_step", "status", "summary"].includes(key))).toBe(true);
      expect(check.summary ?? "").not.toContain(fixture.root);
    }
  }, 60_000);
});

/* ------------------------------------------------------------------ *
 * Regressions of review 02-export
 * ------------------------------------------------------------------ */

describe("incident export — review 02-export regressions", () => {
  it("R2-01: no unknown detail, no parser message and no free text reach a default package", async () => {
    const fixture = await incident("r2-01");
    const template = logTemplate(fixture.root);
    // A log record whose `details` carry keys the logger never writes, including content.
    appendLogRecord(fixture.root, {
      ...template,
      seq: 9001,
      op: "tool",
      event: "call.finished",
      task_id: fixture.roundTaskId,
      details: {
        prompt: SECRETS.detail,
        answer: SECRETS.detail,
        message: `${SECRETS.detail} in an authored-looking field`,
        reason: SECRETS.detail,
        deadline_ms: 1234,
      },
    });
    // An event whose payload is malformed JSON: a parser message would quote the input.
    const db = join(fixture.root, ".bridge", "bridge.db");
    const { DatabaseSync } = await import("node:sqlite");
    const handle = new DatabaseSync(db) as any;
    handle.exec(
      `INSERT INTO events (type, task_id, agent, at, payload_json) VALUES ('probe.malformed', '${fixture.roundTaskId}', 'codex', ${Date.now()}, '{ broken ${SECRETS.malformed}')`,
    );
    handle.close();
    // A corrupt setup record, read as data by the versions collector.
    mkdirSync(join(fixture.root, ".bridge-runtime"), { recursive: true });
    writeFileSync(join(fixture.root, ".bridge-runtime", "install.json"), `{ not json ${SECRETS.detail}`);

    const report = diagnoseJson(fixture, ["--task", fixture.roundTaskId]);
    expect(report.status).toBe(0);
    const pkg = open(report.json.package as string);

    for (const secret of Object.values(SECRETS)) {
      expect(pkg.text, `the package must not contain ${secret}`).not.toContain(secret);
    }
    // The record is there, with only the keys the spec allows.
    const planted = pkg.logRecords().find((record) => record["seq"] === 9001)!;
    expect(planted).toBeDefined();
    expect(planted["details"]).toEqual({ deadline_ms: 1234, reason: "invalid", dropped_fields: 3 });
    // The malformed payload is a code, not a message.
    const gaps = (pkg.manifest.gaps as Array<Record<string, unknown>>).map((gap) => `${gap.part}:${gap.reason}`);
    expect(gaps).toContain("events:unparsable");
    expect(gaps).toContain("install_record:invalid");
    for (const gap of pkg.manifest.gaps as Array<Record<string, unknown>>) {
      expect(Object.keys(gap).every((key) => ["part", "reason", "code", "file", "count"].includes(key))).toBe(true);
    }
    // Nothing anywhere in the package is a raw local path.
    expect(pkg.text).not.toContain(fixture.root);
    expect(pkg.text).not.toContain(tmpdir() + "/bridge-diag");
  }, 90_000);

  it("R2-02: directory links, a linked database and output links are refused, not followed", async () => {
    const fixture = await incident("r2-02");
    const outside = temporary("bridge-diag-outside-");
    const victim = join(outside, "bridge-20260101T000000Z-aaaabbbbccccdddd-00.jsonl");
    writeFileSync(victim, `{"schema":"claude-codex-bridge.log/v1","ts":"2026-01-01T00:00:00.000Z","seq":1,"op":"tool","event":"call.finished","task_id":"${fixture.roundTaskId}","outside":"${SECRETS.detail}"}\n`);
    const outsideEvidence = temporary("bridge-diag-outside-evidence-");
    mkdirSync(join(outsideEvidence, fixture.roundTaskId), { recursive: true });
    writeFileSync(
      join(outsideEvidence, fixture.roundTaskId, "attempt-9.json"),
      JSON.stringify({ attempt: 9, termination_kind: "timeout", reason: "deadline", stderr: { tail: SECRETS.detail } }),
    );

    // The whole log directory is a link to somewhere else.
    const logs = join(fixture.root, ".bridge", "logs");
    rmSync(logs, { recursive: true, force: true });
    symlinkSync(outside, logs);
    // So is the evidence directory.
    const evidence = join(fixture.root, ".bridge", "evidence");
    rmSync(evidence, { recursive: true, force: true });
    symlinkSync(outsideEvidence, evidence);

    const report = diagnoseJson(fixture, ["--task", fixture.roundTaskId]);
    expect(report.status).toBe(0);
    const gaps = (report.json.gaps as Array<{ part: string; reason: string }>).map((gap) => `${gap.part}:${gap.reason}`);
    expect(gaps).toContain("logs:symlink");
    expect(gaps).toContain("evidence:symlink");
    const pkg = open(report.json.package as string);
    expect(pkg.text).not.toContain(SECRETS.detail);
    expect(pkg.manifest.counts.log_records).toBe(0);
    expect(pkg.manifest.counts.evidence_files).toBe(0);
    expect(readFileSync(victim, "utf8")).toContain(SECRETS.detail);

    // A database that is a link is refused before it is opened.
    rmSync(logs, { force: true });
    rmSync(evidence, { force: true });
    const elsewhere = join(outside, "moved.db");
    renameSync(join(fixture.root, ".bridge", "bridge.db"), elsewhere);
    symlinkSync(elsewhere, join(fixture.root, ".bridge", "bridge.db"));
    const refusedDb = diagnose(fixture, ["--since", "1h"]);
    expect(refusedDb.status).toBe(1);
    expect(refusedDb.stderr).toContain("DIAGNOSE_PATH_UNSAFE");
    renameSync(elsewhere, join(fixture.root, ".bridge", "bridge.db.real"));
    rmSync(join(fixture.root, ".bridge", "bridge.db"), { force: true });
    renameSync(join(fixture.root, ".bridge", "bridge.db.real"), join(fixture.root, ".bridge", "bridge.db"));

    // A packages directory that is a link is refused before anything is published.
    const namespaceKey = readdirSync(fixture.namespaceRoot)[0]!;
    const packages = join(fixture.namespaceRoot, namespaceKey, "packages");
    const outsideOutput = temporary("bridge-diag-outside-output-");
    rmSync(packages, { recursive: true, force: true });
    symlinkSync(outsideOutput, packages);
    const refusedOut = diagnose(fixture, ["--since", "1h"]);
    expect(refusedOut.status).toBe(1);
    expect(refusedOut.stderr).toContain("DIAGNOSE_OUTPUT_UNSAFE");
    expect(readdirSync(outsideOutput)).toEqual([]);

    // The removed selectors are gone rather than unvalidated.
    for (const flag of ["--out", "--name"]) {
      const rejected = diagnose(fixture, ["--since", "1h", flag, "../escape.zip"]);
      expect(rejected.status).toBe(2);
      expect(rejected.stderr).toContain("unknown option");
    }
  }, 120_000);

  it("R2-02: a published package is never overwritten, even by a same-named late arrival", async () => {
    const fixture = await incident("r2-02-publish");
    const { publishPackage } = await import("./collect.mjs");
    const staged = join(fixture.home, "staged.zip");
    const target = join(fixture.home, "published.zip");
    writeFileSync(staged, "fresh package");
    writeFileSync(target, "package that appeared first");
    expect(() => publishPackage(staged, target)).toThrow(/already exists/u);
    expect(readFileSync(target, "utf8")).toBe("package that appeared first");
    expect(existsSync(staged), "the working copy stays for the caller to clean up").toBe(true);
  }, 60_000);

  it("R2-03: one scope covers every source, and an unknown selector is refused", async () => {
    const fixture = await incident("r2-03", { secondIncident: true });
    // A second attempt of the same task, so `--attempt` has something to exclude.
    const db = join(fixture.root, ".bridge", "bridge.db");
    const { DatabaseSync } = await import("node:sqlite");
    const handle = new DatabaseSync(db) as any;
    const now = Date.now();
    handle.exec(
      `INSERT INTO task_attempts (task_id, attempt, agent, started_at, updated_at, ended_at, outcome) VALUES ('${fixture.roundTaskId}', 1, 'claude', ${now}, ${now}, ${now}, 'DONE')`,
    );
    handle.exec(
      `INSERT INTO attempt_telemetry (task_id, attempt, run_id, agent, json) VALUES ('${fixture.roundTaskId}', 1, 'run_second', 'claude', '{"task_id":"${fixture.roundTaskId}","attempt":1}')`,
    );
    handle.close();
    mkdirSync(join(fixture.root, ".bridge", "evidence", fixture.roundTaskId), { recursive: true });
    writeFileSync(
      join(fixture.root, ".bridge", "evidence", fixture.roundTaskId, "attempt-1.json"),
      JSON.stringify({ attempt: 1, termination_kind: "crash", reason: "adapter", stderr: { total_bytes: 1, kept_bytes: 1, truncated: false } }),
    );
    const template = logTemplate(fixture.root);
    appendLogRecord(fixture.root, { ...template, seq: 9101, op: "attempt", event: "started", task_id: fixture.roundTaskId, attempt: 1 });

    const report = diagnoseJson(fixture, ["--task", fixture.roundTaskId, "--attempt", "0"]);
    expect(report.status).toBe(0);
    const pkg = open(report.json.package as string);
    expect((pkg.json("records/attempts.json") as Array<{ attempt: number }>).map((row) => row.attempt)).toEqual([0]);
    expect((pkg.json("records/telemetry.json") as Array<{ attempt: number }>).map((row) => row.attempt)).toEqual([0]);
    expect((pkg.json("evidence/index.json") as Array<{ attempt: number }>).map((row) => row.attempt)).toEqual([0]);
    expect(pkg.logRecords().some((record) => record["attempt"] === 1)).toBe(false);
    // The unrelated incident of the same worktree is not in this package.
    const foreignTask = (diagnoseJson(fixture, []).json.available.tasks as Array<{ task_id: string }>)
      .map((task) => task.task_id)
      .find((id) => id !== fixture.roundTaskId && id !== fixture.taskId)!;
    expect(foreignTask).toBeDefined();
    expect(pkg.text).not.toContain(foreignTask);
    expect(pkg.manifest.scope.task_ids).toEqual([fixture.roundTaskId]);

    // Unknown identifiers are refused instead of silently widening the scope.
    const unknownFeature = diagnose(fixture, ["--feature", "F-does-not-exist"]);
    expect(unknownFeature.status).toBe(1);
    expect(unknownFeature.stderr).toContain("DIAGNOSE_SCOPE_NOT_FOUND");
    const unknownTask = diagnose(fixture, ["--task", "task_absent", "--since", "1h"]);
    expect(unknownTask.status).toBe(1);
    expect(unknownTask.stderr).toContain("DIAGNOSE_SCOPE_NOT_FOUND");
    for (const args of [
      ["--attempt", "0"],
      ["--feature", fixture.featureId, "--task", fixture.roundTaskId],
      ["--task", fixture.roundTaskId, "--attempt", "-1"],
      ["--since", "yesterday"],
    ]) {
      const invalid = diagnose(fixture, args);
      expect(invalid.status, args.join(" ")).toBe(1);
      expect(invalid.stderr).toContain("DIAGNOSE_SCOPE_INVALID");
    }
  }, 120_000);

  it("R2-04: a runtime chosen by the diagnosed worktree is never executed", async () => {
    const fixture = await incident("r2-04");
    const marker = join(fixture.home, "executed.marker");
    // A synthetic "installed runtime" whose control plane writes a marker when imported.
    const malicious = temporary("bridge-diag-runtime-");
    mkdirSync(join(malicious, "shared", "control-plane", "dist"), { recursive: true });
    writeFileSync(
      join(malicious, "shared", "control-plane", "dist", "index.js"),
      `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "executed");\nexport function resolveWorkspaceIdentity() { throw new Error("never"); }\n`,
    );
    writeFileSync(
      join(malicious, "runtime-manifest.json"),
      JSON.stringify({
        format: "claude-codex-bridge.runtime/v1",
        runtime_id: "0.0.0-malicious",
        package_version: "0.0.0",
        source: { commit: "0".repeat(40) },
        created_at: new Date().toISOString(),
        built_with: { node: "24.0.0" },
        compatibility: { state_schema_version: 5, codex_identity_adapters: ["0.154.0"], node_minimum: "22.13.0" },
        instructions: { set_sha256: "0".repeat(64), files: [] },
        mcp: { launcher: "scripts/native-bridge-mcp.mjs", startup_timeout_sec: 30, tool_timeout_sec: 5400 },
        tree_sha256: "0".repeat(64),
      }),
    );
    mkdirSync(join(fixture.root, ".bridge-runtime"), { recursive: true });
    symlinkSync(malicious, join(fixture.root, ".bridge-runtime", "current"));

    // Summary, package and the doctor subset inside it all run without touching that module.
    expect(diagnoseJson(fixture, []).status).toBe(0);
    expect(existsSync(marker), "diagnose must not import the diagnosed worktree's runtime").toBe(false);
    const report = diagnoseJson(fixture, ["--feature", fixture.featureId]);
    expect(report.status).toBe(0);
    expect(existsSync(marker)).toBe(false);

    // The selection is described as data, from its manifest, without being loaded.
    const pkg = open(report.json.package as string);
    expect(pkg.manifest.versions.runtime.runtime_id).toBe("0.0.0-malicious");
    expect(pkg.manifest.versions.collector.source).toBe("own-build");
    expect(existsSync(marker)).toBe(false);
  }, 90_000);

  it("R2-05: reads are bounded per file and every limit, truncation and change is reported", async () => {
    const fixture = await incident("r2-05");
    const logDirectory = join(fixture.root, ".bridge", "logs");
    const logFile = readdirSync(logDirectory).filter((name) => name.endsWith(".jsonl")).sort().pop()!;
    const template = logTemplate(fixture.root);

    // Grow the log past the bounded read, so the package holds a prefix and says so.
    const filler = `${JSON.stringify({ ...template, op: "tool", event: "call.finished", task_id: fixture.roundTaskId, details: { deadline_ms: 1 } })}\n`;
    const target = 1024 * 1024 + 256 * 1024;
    let written = statSync(join(logDirectory, logFile)).size;
    const chunk = filler.repeat(200);
    while (written < target) {
      appendFileSync(join(logDirectory, logFile), chunk);
      written += chunk.length;
    }

    const report = diagnoseJson(fixture, ["--task", fixture.roundTaskId]);
    expect(report.status).toBe(0);
    const pkg = open(report.json.package as string);
    const file = (pkg.manifest.cutoffs.logs.files as Array<Record<string, any>>).find((entry) => entry.file === logFile)!;
    expect(file.bytes).toBeGreaterThan(1024 * 1024);
    expect(file.bytes_read).toBeLessThanOrEqual(1024 * 1024);
    expect(file.read_from).toBeGreaterThan(0);
    expect(file.truncated).toBe(true);
    expect(file.inode).toBeGreaterThan(0);
    const gaps = (pkg.manifest.gaps as Array<{ part: string; reason: string }>).map((gap) => `${gap.part}:${gap.reason}`);
    expect(gaps).toContain("logs:prefix_truncated");
    // The log cutoff is the moment the logs were read, after the database snapshot.
    expect(Date.parse(pkg.manifest.cutoffs.logs.read_at)).toBeGreaterThanOrEqual(
      Date.parse(pkg.manifest.cutoffs.database.taken_at),
    );

    // A log that is rewritten while the export runs is detected, not silently packaged.
    const churn = spawn(
      process.execPath,
      [
        "-e",
        `const { appendFileSync, writeFileSync } = require('node:fs');
         const path = process.argv[1];
         setInterval(() => {
           appendFileSync(path, process.argv[2]);
         }, 5);`,
        join(logDirectory, logFile),
        filler,
      ],
      { stdio: "ignore" },
    );
    try {
      const during = diagnoseJson(fixture, ["--task", fixture.roundTaskId]);
      expect(during.status).toBe(0);
      const changed = (during.json.gaps as Array<{ part: string; reason: string }>).some(
        (gap) => gap.part === "logs" && (gap.reason === "changed_during_export" || gap.reason === "removed_during_export"),
      );
      expect(changed, "a log that changes during the export must be reported").toBe(true);
      const duringPkg = open(during.json.package as string);
      const duringFile = (duringPkg.manifest.cutoffs.logs.files as Array<Record<string, any>>).find(
        (entry) => entry.file === logFile,
      )!;
      expect(duringFile.changed_during_export).toBe(true);
    } finally {
      churn.kill("SIGKILL");
    }
  }, 120_000);

  it("R2-05: a record limit is reported instead of silently dropping the rest", async () => {
    const fixture = await incident("r2-05-limit");
    const db = join(fixture.root, ".bridge", "bridge.db");
    const { DatabaseSync } = await import("node:sqlite");
    const handle = new DatabaseSync(db) as any;
    handle.exec("BEGIN");
    const insert = handle.prepare(
      "INSERT INTO events (type, task_id, agent, at, payload_json) VALUES ('probe.bulk', ?, 'codex', ?, '{\"attempt\":0}')",
    );
    for (let index = 0; index < 5200; index += 1) insert.run(fixture.roundTaskId, Date.now());
    handle.exec("COMMIT");
    handle.close();

    const report = diagnoseJson(fixture, ["--task", fixture.roundTaskId]);
    expect(report.status).toBe(0);
    const pkg = open(report.json.package as string);
    expect(pkg.manifest.counts.events).toBe(5000);
    expect(pkg.manifest.cutoffs.records).toMatchObject({ events: 5000 });
    const gaps = (pkg.manifest.gaps as Array<{ part: string; reason: string; count?: number }>);
    expect(gaps.some((gap) => gap.part === "events" && gap.reason === "record_limit" && gap.count === 5000)).toBe(true);
  }, 120_000);

  it("R2-06: an interrupted export publishes nothing and damages nothing", async () => {
    const fixture = await incident("r2-06-kill");
    const before = fingerprint(fixture.root);
    const child = spawn(
      process.execPath,
      [cli, "diagnose", "--workspace", fixture.root, "--home", join(fixture.home, "bridge-home"), "--feature", fixture.featureId, "--with-database", "--json"],
      { env: { ...process.env, HOME: fixture.home }, stdio: "ignore" },
    );
    // Kill it the moment it starts working, while the private staging directory exists.
    await waitFor(() => (stagingOf(fixture).length > 0 ? true : undefined), 20_000).catch(() => undefined);
    child.kill("SIGKILL");
    const code = await new Promise<number | null>((done) => child.once("exit", (value, signal) => done(signal ? null : value)));
    expect(code).toBeNull();

    expect(packagesOf(fixture), "a killed export publishes nothing").toEqual([]);
    expect(fingerprint(fixture.root)).toEqual(before);
    // Leftover private staging is possible after a hard kill and is documented; the next export
    // neither reads it nor trips over it, and publishes normally.
    const after = diagnoseJson(fixture, ["--feature", fixture.featureId]);
    expect(after.status).toBe(0);
    expect(packagesOf(fixture)).toHaveLength(1);
  }, 120_000);

  it("R2-06: a write that cannot complete refuses cleanly and leaves no partial package", async () => {
    if (process.getuid?.() === 0) return; // root ignores the file-size limit this case depends on
    const fixture = await incident("r2-06-space");
    const before = fingerprint(fixture.root);
    // RLIMIT_FSIZE turns every write past the limit into a real errno from write(2) — the same
    // branch a full disk takes — deterministically and without root.
    const limited = spawnSync(
      "/bin/sh",
      [
        "-c",
        `ulimit -f 20; exec "${process.execPath}" "${cli}" diagnose --workspace "${fixture.root}" --home "${join(fixture.home, "bridge-home")}" --feature "${fixture.featureId}"`,
      ],
      { encoding: "utf8", env: { ...process.env, HOME: fixture.home }, timeout: 120_000 },
    );
    // `writeSync` answers a file-size limit — and a full disk — with a short write, not an
    // exception, so the writer proves the size on the descriptor and refuses (review R2-06).
    expect(limited.status, limited.stdout + limited.stderr).toBe(1);
    expect(limited.stderr).toContain("DIAGNOSE_OUTPUT_UNWRITABLE");
    expect(packagesOf(fixture), "no partial package is published").toEqual([]);
    expect(fingerprint(fixture.root), "the source is untouched by a failed export").toEqual(before);

    // The same worktree exports normally once the limit is gone.
    const recovered = diagnoseJson(fixture, ["--feature", fixture.featureId]);
    expect(recovered.status).toBe(0);
    expect(packagesOf(fixture)).toHaveLength(1);
  }, 120_000);

  it("R2-06: a hard-stopped worker leaves a visible gap, and the package says so", async () => {
    const fixture = await incident("r2-06-hardstop", { hardStop: true });
    const report = diagnoseJson(fixture, ["--feature", fixture.featureId]);
    expect(report.status).toBe(0);
    const pkg = open(report.json.package as string);
    const records = pkg.logRecords();
    // The killed process never wrote its shutdown records; the package shows the absence.
    expect(records.some((record) => record["event"] === "start")).toBe(true);
    expect(records.some((record) => record["op"] === "process" && record["event"] === "stop")).toBe(false);
    expect(records.some((record) => record["op"] === "log" && record["event"] === "close")).toBe(false);
    // The active marker of the dead instance is still there, and it is not a log record source.
    const markers = readdirSync(join(fixture.root, ".bridge", "logs")).filter((name) => name.endsWith(".active"));
    expect(markers).toHaveLength(1);
    expect(pkg.manifest.limits.join(" ")).toContain("refused calls");
  }, 90_000);
});

/** Every diagnostics record currently on disk in a worktree. */
function readLog(root: string): Array<Record<string, any>> {
  const directory = join(root, ".bridge", "logs");
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .flatMap((name) =>
      readFileSync(join(directory, name), "utf8")
        .split("\n")
        .filter(Boolean)
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as Record<string, any>];
          } catch {
            return [];
          }
        }),
    );
}
