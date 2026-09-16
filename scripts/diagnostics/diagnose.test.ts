/**
 * Incident export (wave13 §3–§5): the real CLI, real worktree state and a synthetic executor.
 *
 * Every fixture here is produced by spawning the actual launcher against a temporary worktree
 * with the repository's `fake-claude-cli` on PATH, so the packages under test are built from
 * state the bridge really wrote — a timed-out round, its attempt, its termination evidence and
 * its diagnostics log. No model is called and no paid pilot is involved.
 */

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
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
  readonly packages: string;
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

  async stop(): Promise<number | null> {
    this.child.kill("SIGTERM");
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
  } = {},
): Promise<Fixture> {
  const root = temporary(`bridge-diag-${label}-`);
  const home = temporary(`bridge-diag-home-${label}-`);
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "claude"), `#!/bin/sh\nexec "${process.execPath}" "${fakeClaude}" "$@"\n`, { mode: 0o755 });
  const client = new Client(root, {
    ...process.env,
    HOME: home,
    PATH: `${bin}${delimiter}${process.env["PATH"] ?? ""}`,
    FAKE_CLAUDE_MODE: mode,
    FAKE_CLAUDE_STDERR: `fake runtime warning: ${SECRETS.apiKey} leaked into stderr\n`,
  });
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
  await client.stop();
  return {
    root,
    home,
    env: {
      HOME: home,
      PATH: `${bin}${delimiter}${process.env["PATH"] ?? ""}`,
      FAKE_CLAUDE_MODE: mode,
      FAKE_CLAUDE_STDERR: `fake runtime warning: ${SECRETS.apiKey} leaked into stderr\n`,
    },
    packages: join(home, "tmp", "bridge-exchange"),
    evidenceFailed,
    taskId: root_task.task_id as string,
    roundTaskId: (round.task?.task_id ?? round.task_id) as string,
    featureId,
    stderr: client.stderr.join(""),
  };
}

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

async function waitFor<T>(probe: () => T | undefined, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("condition was not reached in time");
    await new Promise((done) => setTimeout(done, 25));
  }
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
      if (entry.isDirectory()) visit(join(directory, entry.name), relative);
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
  return { entries, manifest, text, json };
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
    // Nothing exported, nothing left behind, nothing changed.
    expect(existsSync(fixture.packages)).toBe(true);
    const namespace = join(fixture.packages, readdirSync(fixture.packages)[0]!);
    expect(readdirSync(join(namespace, "staging"))).toEqual([]);
    expect(existsSync(join(namespace, "packages"))).toBe(false);
    expect(fingerprint(fixture.root)).toEqual(before);
  }, 60_000);

  it("exports the selected feature with a manifest, hashes, a timeline and machine records", async () => {
    const fixture = await incident("feature");
    const report = diagnoseJson(fixture, ["--feature", fixture.featureId]);
    expect(report.status).toBe(0);

    const path = report.json.package as string;
    expect(path.startsWith(join(fixture.packages))).toBe(true);
    expect(path.endsWith(".zip")).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(createHash("sha256").update(readFileSync(path)).digest("hex")).toBe(report.json.sha256);

    const pkg = open(path);
    expect(pkg.manifest.scope).toMatchObject({ kind: "feature", feature_id: fixture.featureId });
    expect(pkg.manifest.scope.task_ids).toContain(fixture.roundTaskId);
    // Every entry is listed with its hash, and every listed hash matches.
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
    expect(timeline).toContain("approximation, not proof");

    const tasks = pkg.json("records/tasks.json") as Array<{ task_id: string; state: string }>;
    expect(tasks.map((task) => task.task_id)).toContain(fixture.roundTaskId);
    const attempts = pkg.json("records/attempts.json") as Array<{ attempt: number; outcome: string; execution_handle_ref: string | null }>;
    expect(attempts[0]).toMatchObject({ attempt: 0, outcome: "TIMEOUT" });
    expect(attempts[0]!.execution_handle_ref).toMatch(/^[0-9a-f]{12}$/u);
    const events = pkg.json("records/events.json") as Array<{ type: string; event_id: number }>;
    expect(events.length).toBeGreaterThan(3);
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["attempt.started", "attempt.ended", "delegation.failed"]),
    );
    expect(pkg.json("records/feature.json")).toMatchObject({ feature_id: fixture.featureId, question_present: true });

    // The package is verifiable on its own terms.
    const inspected = diagnoseJson(fixture, ["--inspect", path]);
    expect(inspected.json).toMatchObject({ integrity: "ok", format: "claude-codex-bridge.diagnostics/v1" });
  }, 60_000);

  it("snapshots a live WAL writer consistently and changes nothing in the source", async () => {
    const fixture = await incident("wal");
    const before = fingerprint(fixture.root);

    // A second process holds the database open in WAL mode and keeps writing while the export
    // runs: the snapshot must contain its committed rows, and the source must be untouched.
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
           db.exec("INSERT INTO events (type, task_id, agent, at, payload_json) VALUES ('probe.write', NULL, 'codex', " + Date.now() + ", '{\\"n\\":" + n + "}')");
         }, 15);`,
        join(fixture.root, ".bridge", "bridge.db"),
      ],
      { stdio: "ignore" },
    );
    try {
      await new Promise((done) => setTimeout(done, 300));
      const report = diagnoseJson(fixture, ["--since", "1h", "--with-database"]);
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
      // Rows the concurrent writer committed into the WAL are in the snapshot.
      expect(Number(db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'probe.write'").get().n)).toBeGreaterThan(0);
      db.close();
    } finally {
      writer.kill("SIGKILL");
    }
    // The export wrote nothing into the worktree: same files, same bytes.
    expect(fingerprint(fixture.root)).toEqual(before);
  }, 90_000);

  it("excludes secrets and content by default and names every extension explicitly", async () => {
    const fixture = await incident("privacy");
    const report = diagnoseJson(fixture, ["--feature", fixture.featureId]);
    const pkg = open(report.json.package as string);

    for (const secret of Object.values(SECRETS)) {
      expect(pkg.text, `the default package must not contain ${secret}`).not.toContain(secret);
    }
    // No raw database, no evidence file, no local paths.
    expect([...pkg.entries.keys()].some((name) => name.startsWith("database/"))).toBe(false);
    expect([...pkg.entries.keys()].some((name) => /^evidence\/task/u.test(name))).toBe(false);
    expect(pkg.text).not.toContain(fixture.root);
    expect(pkg.text).not.toContain(fixture.home);
    expect(pkg.manifest.workspace.root).toBe("<workspace>");
    expect(pkg.manifest.extensions).toEqual({ evidence_files: false, raw_database: false });
    expect(pkg.manifest.privacy.withheld.join(" ")).toContain("prompts");
    expect(report.json.risk.join(" ")).toContain("nothing was uploaded");
    // Evidence is referenced by metadata even when its content is not included.
    const index = pkg.json("evidence/index.json") as Array<{ file: string; included_in_package: boolean; sha256: string }>;
    expect(index.length).toBeGreaterThan(0);
    expect(index[0]).toMatchObject({ included_in_package: false });
    expect(index[0]!.sha256).toMatch(/^[0-9a-f]{64}$/u);

    // The extensions are explicit, listed in the manifest and announced in the risk note.
    const extended = diagnoseJson(fixture, ["--feature", fixture.featureId, "--with-evidence", "--with-database"]);
    const big = open(extended.json.package as string);
    expect(big.manifest.extensions).toEqual({ evidence_files: true, raw_database: true });
    expect([...big.entries.keys()]).toContain("database/snapshot.db");
    expect([...big.entries.keys()].some((name) => /^evidence\/task.*attempt-0\.json$/u.test(name))).toBe(true);
    expect(extended.json.risk.join(" ")).toContain("EXTENSION");
    // The evidence store's own redaction still applies inside the extension.
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
    // A half-written line, the kind a hard kill leaves behind.
    writeFileSync(join(logDirectory, logFile), `${readFileSync(join(logDirectory, logFile), "utf8")}{"schema":"claude`);
    // Evidence that cannot be read.
    const evidenceDirectory = join(fixture.root, ".bridge", "evidence", fixture.roundTaskId);
    writeFileSync(join(evidenceDirectory, "attempt-0.json"), "{ not json");

    const report = diagnoseJson(fixture, ["--feature", fixture.featureId]);
    expect(report.status).toBe(0);
    const gaps = (report.json.gaps as Array<{ part: string; reason: string }>).map((gap) => `${gap.part}:${gap.reason}`);
    expect(gaps).toContain("logs:unparsable_lines");
    expect(gaps).toContain("evidence:unreadable");
    const pkg = open(report.json.package as string);
    expect(pkg.manifest.gaps.length).toBeGreaterThanOrEqual(2);
    // The usable part is still there.
    expect((pkg.json("records/tasks.json") as unknown[]).length).toBeGreaterThan(0);

    // A database that cannot be opened at all still produces a package built from the logs.
    writeFileSync(join(fixture.root, ".bridge", "bridge.db"), "this is not a database");
    const broken = diagnoseJson(fixture, ["--since", "2h"]);
    expect(broken.status).toBe(0);
    const brokenGaps = (broken.json.gaps as Array<{ part: string; reason: string }>).map((gap) => `${gap.part}:${gap.reason}`);
    expect(brokenGaps.some((gap) => gap.startsWith("database"))).toBe(true);
    const brokenPkg = open(broken.json.package as string);
    expect(brokenPkg.manifest.counts.log_records).toBeGreaterThan(0);
    expect(brokenPkg.manifest.counts.tasks).toBe(0);
  }, 90_000);

  it("refuses a redirected state directory, never follows a symlinked log and never overwrites", async () => {
    const fixture = await incident("symlink");
    const outside = temporary("bridge-diag-victim-");
    const victim = join(outside, "bridge-20260101T000000Z-aaaabbbbccccdddd-00.jsonl");
    writeFileSync(victim, "untouched\n");

    // A symlink inside the log directory carrying a log file name is skipped, not read.
    symlinkSync(victim, join(fixture.root, ".bridge", "logs", "bridge-20260101T000000Z-aaaabbbbccccdddd-00.jsonl"));
    const report = diagnoseJson(fixture, ["--feature", fixture.featureId]);
    expect(report.status).toBe(0);
    expect((report.json.gaps as Array<{ reason: string }>).some((gap) => gap.reason === "symlink_skipped")).toBe(true);
    expect(open(report.json.package as string).text).not.toContain("untouched");
    expect(readFileSync(victim, "utf8")).toBe("untouched\n");

    // The same package name is never written twice.
    const target = join(fixture.home, "explicit.zip");
    expect(diagnose(fixture, ["--feature", fixture.featureId, "--out", target]).status).toBe(0);
    const bytes = readFileSync(target);
    const again = diagnose(fixture, ["--feature", fixture.featureId, "--out", target]);
    expect(again.status).toBe(1);
    expect(again.stderr + again.stdout).toContain("DIAGNOSE_PACKAGE_EXISTS");
    expect(readFileSync(target)).toEqual(bytes);

    // A state directory redirected out of the worktree is refused before anything is read.
    const redirected = temporary("bridge-diag-redirected-");
    const state = join(redirected, ".bridge");
    symlinkSync(join(fixture.root, ".bridge"), state);
    const refused = diagnose({ root: redirected, home: fixture.home }, ["--feature", fixture.featureId]);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("DIAGNOSE_STATE_REDIRECTED");
  }, 90_000);

  it("reports an unwritable destination and leaves no working copy behind", async () => {
    if (process.getuid?.() === 0) return; // root ignores the mode bits this case depends on
    const fixture = await incident("access");
    const namespaceRoot = join(fixture.home, "tmp", "bridge-exchange");
    // Produce the namespace, then take write permission away from it.
    expect(diagnose(fixture, ["--feature", fixture.featureId]).status).toBe(0);
    const namespace = join(namespaceRoot, readdirSync(namespaceRoot)[0]!);
    const packages = join(namespace, "packages");
    const before = readdirSync(packages);
    chmodSync(packages, 0o500);
    try {
      const refused = diagnose(fixture, ["--feature", fixture.featureId]);
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain("DIAGNOSE_OUTPUT_UNWRITABLE");
    } finally {
      chmodSync(packages, 0o700);
    }
    expect(readdirSync(join(namespace, "packages"))).toEqual(before);
    expect(readdirSync(join(namespace, "staging"))).toEqual([]);
  }, 90_000);

  it("shows the executor deadline, the adapter failure and the evidence gap as separate facts", async () => {
    const timedOut = await incident("deadline");
    const timedOutPackage = open(diagnoseJson(timedOut, ["--feature", timedOut.featureId]).json.package as string);
    const logRecords = [...timedOutPackage.entries.entries()]
      .filter(([name]) => name.startsWith("logs/"))
      .flatMap(([, data]) =>
        data
          .toString("utf8")
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Record<string, any>),
      );
    const started = logRecords.find((record) => record["op"] === "attempt" && record["event"] === "started")!;
    const finished = logRecords.find((record) => record["op"] === "attempt" && record["event"] === "finished")!;
    expect(started["details"]).toMatchObject({ deadline_ms: 1_200, agent: "claude" });
    expect(finished).toMatchObject({ code: "TIMEOUT", phase: "deadline", attempt: 0 });
    expect(finished["details"]).toMatchObject({ termination_kind: "timeout" });
    // The package never claims anything about the MCP client timeout, which is a different budget.
    expect(timedOutPackage.entries.get("ANALYSIS.md")!.toString("utf8")).toContain("timeout is a different budget");
    const evidenceIndex = timedOutPackage.json("evidence/index.json") as Array<{ termination_kind: string; stderr_truncated: boolean }>;
    expect(evidenceIndex[0]).toMatchObject({ termination_kind: "timeout" });

    // A forced adapter failure is a different termination, recorded as such.
    const crashed = await incident("adapter", { mode: "noresult", deadline: 20_000 });
    const crashedPackage = open(diagnoseJson(crashed, ["--feature", crashed.featureId]).json.package as string);
    const crashedRecords = [...crashedPackage.entries.entries()]
      .filter(([name]) => name.startsWith("logs/"))
      .flatMap(([, data]) =>
        data.toString("utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, any>),
      );
    const failure = crashedRecords.find((record) => record["op"] === "attempt" && record["event"] === "finished")!;
    expect(failure).toMatchObject({ outcome: "error", phase: "runtime" });
    expect(failure["code"]).toBe("ADAPTER_FAILURE");
    expect(failure["details"]).toMatchObject({ termination_kind: "crash" });
    expect(crashedPackage.json("records/attempts.json")[0]).toMatchObject({ outcome: "ADAPTER_FAILURE" });
  }, 120_000);

  it("records an evidence write that failed, and exports it as a gap with the attempt", async () => {
    if (process.getuid?.() === 0) return; // root ignores the mode bits this case depends on
    const fixture = await incident("evidence", { evidenceFailure: true });
    // The extra attempt really ran and really timed out; only its evidence could not be stored.
    expect(fixture.evidenceFailed.error?.code).toBe("TIMEOUT");

    const report = diagnoseJson(fixture, ["--since", "1h"]);
    expect(report.status).toBe(0);
    const pkg = open(report.json.package as string);
    const records = [...pkg.entries.entries()]
      .filter(([name]) => name.startsWith("logs/"))
      .flatMap(([, data]) =>
        data.toString("utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, any>),
      );
    const failure = records.find((record) => record["event"] === "evidence.write_failed");
    expect(failure, "the failed evidence write must be observable").toBeDefined();
    expect(failure).toMatchObject({ op: "attempt", outcome: "error", phase: "evidence", code: "EACCES" });
    // Both attempts are visible; the one whose evidence failed has no evidence entry invented.
    const recorded = records.filter((record) => record["event"] === "evidence.recorded");
    expect(recorded.length).toBe(1);
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
      // Small files, so the live round rotates its log while the export reads it.
      BRIDGE_LOG_MAX_FILE_BYTES: "65536",
      BRIDGE_LOG_MAX_TOTAL_BYTES: "262144",
      BRIDGE_LOG_MAX_FILES: "2",
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
      const records = [...pkg.entries.entries()]
        .filter(([name]) => name.startsWith("logs/"))
        .flatMap(([, data]) =>
          data.toString("utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, any>),
        );
      // The attempt is open: started, not finished, and the round's call has not returned.
      expect(records.some((record) => record["event"] === "started")).toBe(true);
      expect(records.some((record) => record["event"] === "finished")).toBe(false);
      expect(records.some((record) => record["tool"] === "bridge_feature_run" && record["event"] === "call.finished")).toBe(false);
      const attempts = pkg.json("records/attempts.json") as Array<{ outcome: string | null; ended_at: number | null }>;
      expect(attempts[0]).toMatchObject({ outcome: null, ended_at: null });
      expect(pkg.manifest.cutoffs.processes.observed).toBe(false);

      // The worker was not stopped by the export: the round still completes on its own.
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
      checks: Array<{ id: string; status: string; code: string; summary: string }>;
    };
    expect(doctor.subset).toBe("safe");
    expect(doctor.omitted).toEqual(["handshake", "codex_project"]);
    expect(doctor.checks.find((check) => check.id === "handshake")!.status).toBe("skipped");
    expect(doctor.checks.find((check) => check.id === "codex_project")!.status).toBe("skipped");
    expect(doctor.checks.find((check) => check.id === "logs")).toBeDefined();
    // The subset keeps ids, codes and aliased summaries only — no details, no local paths.
    for (const check of doctor.checks) {
      expect(Object.keys(check).sort()).toEqual(["code", "id", "next_step", "status", "summary"]);
      expect(check.summary).not.toContain(fixture.root);
    }
  }, 60_000);
});
