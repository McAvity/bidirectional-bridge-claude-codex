/**
 * Workflow binding of bridge features (F-W19 W19-03; contract
 * docs/features/F-W19-workflow-versioning/contracts/01-workflow-binding.md § 5–§ 10).
 *
 * The bridge database is the operational source of a feature's selected workflow release
 * (`FeatureRecord.workflow`); the feature's `workflow.lock.json` is its portable projection.
 * Every admitted attempt records the identity it runs with (`attempt_workflow`), inside the same
 * reservation transaction that creates the task or the recovery attempt, after the authority
 * guard, and only after the exact bundle verified and the release proved compatible with this
 * runtime. A replay returns the stored reservation and never adopts a newer selection.
 *
 * Bundle, store, lock and compatibility primitives are the W19-02 helper library
 * (`scripts/workflow-source/workflow-lib.mjs`), injected as a port so the generator, the
 * standalone helper and the runtime share one implementation. Without a configured port the
 * control plane keeps its pre-binding behaviour and says so (`binding: "not-configured"`).
 */

import { BridgeError, ErrorCode, EventType, TaskState, type AttemptWorkflow } from "@bridge/protocol";
import type { ControlPlane } from "./control-plane.js";
import { assertFeatureOpen, featureTerminal } from "./feature-closure.js";
import { hashRequest } from "./idempotency.js";
import type { AttemptWorkflowRecord, FeatureRecord, WorkflowBindingRecord } from "./store/state-store.js";

/** What this runtime advertises (contract § 5.2); copied into runtime-manifest.json. */
export const WORKFLOW_BINDING_ADVERTISEMENT = Object.freeze({
  contracts: [1] as readonly number[],
  capabilities: ["feature.lifecycle/v1", "feature.close/v1", "round.recovery/v1", "round.report/v1", "workflow.binding/v1"] as readonly string[],
});

export interface LegacyProfile {
  readonly runtime_id: string;
  readonly requires: unknown;
}

const LEGACY_REQUIRES = Object.freeze({
  workflow_formats: { bundle: 1, lock: 1 },
  bridge: { binding_contract: 1, capabilities: ["feature.lifecycle/v1", "feature.close/v1", "round.recovery/v1", "round.report/v1"], known_incompatible: [] },
});

/**
 * Legacy compatibility profiles (contract § 10.5), keyed by the exact instruction-set digest of
 * an installed runtime manifest. Only sets checked for this runtime are listed; an unlisted set
 * is `LEGACY_UNPROVEN`. Both sets drive features through bridge_feature_* incl. close and
 * recovery, and deliver through local-v1 (round.report).
 */
export const LEGACY_PROFILES: Readonly<Record<string, LegacyProfile>> = Object.freeze({
  "5961e6804bdde8fba699388c2206a90e7e6ecf880919650946812c2cf784bb74": { runtime_id: "0.6.2-771e797a73d3", requires: LEGACY_REQUIRES },
  "8c05792ad75e7550eddc00c4ef26eb1c7096951e2be384508321e39bfb78a4ed": { runtime_id: "0.7.0-6ed9a4537e37", requires: LEGACY_REQUIRES },
});

/* eslint-disable @typescript-eslint/no-explicit-any */
/** The subset of workflow-lib.mjs and legacy-adapter.mjs the runtime uses (all synchronous). */
export interface WorkflowStorePort {
  readonly lib: {
    WorkflowError: new (...args: any[]) => Error & { code: string; detail: string; data: Record<string, unknown> };
    storeRoot(env: NodeJS.ProcessEnv): string;
    bridgeHome(env: NodeJS.ProcessEnv): string;
    storeEntry(store: string, identity: string): { state: "verified" | "missing" | "corrupt"; code?: string; detail?: string; path: string | null; manifest?: any };
    storePublish(store: string, bundleDir: string): { result: string; workflow_id: string; identity: string; path: string };
    writeBundle(dir: string, manifest: any, variants: any): void;
    verifyBundle(dir: string, expectedIdentity?: string | null): any;
    checkCompatibility(requires: unknown, runtime: unknown, options: { mode: string }): Array<Record<string, unknown> & { code: string }>;
    featurePath(worktree: string, name: string, options?: { allowDraft?: boolean }): string;
    canonicalAnchor(path: string): string;
    readLock(dir: string): any | null;
    writeLock(dir: string, lock: any): void;
    newLock(manifest: any, options: { origin: Record<string, unknown>; at: string; draftToken?: string | null; featureId?: string | null }): any;
    jsonBytes(value: unknown): Buffer;
    sha256(data: Buffer | string): string;
    legacyEvidence(records: string[], pin: string | null, installed: Set<string>): Record<string, any> & { verdict: string };
    featureRecords(dir: string): string[];
  };
  readonly legacy: {
    legacyBundle(input: { runtimeDir: string; runtimeId: string; expectedSetSha256: string; profile: LegacyProfile }): { manifest: any; variants: any; excluded: string[] };
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Load the helper library of this runtime checkout/installation (`<root>/scripts/workflow-source/`). */
export async function loadWorkflowStore(root?: URL): Promise<WorkflowStorePort> {
  const base = root ?? new URL("../../../", import.meta.url);
  const lib = await import(new URL("scripts/workflow-source/workflow-lib.mjs", base).href);
  const legacy = await import(new URL("scripts/workflow-source/legacy-adapter.mjs", base).href);
  return { lib, legacy } as WorkflowStorePort;
}

export interface WorkflowBindingOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly legacyProfiles?: Readonly<Record<string, LegacyProfile>>;
  /** Override of the advertisement used for compatibility checks (tests of § 5.3). */
  readonly advertisement?: { readonly contracts: readonly number[]; readonly capabilities: readonly string[] };
  readonly packageVersion?: string;
  /** Test hook: runs after the database commit of a change and before its lock projection. */
  readonly beforeProjection?: (op: string, featureId: string) => void;
}

type Refusal = { reason: string; code: string; [key: string]: unknown };

const LOCK_PATH = /^docs\/features\/([^/]+)\/workflow\.lock\.json$/u;
const FEATURE_DIR = /^docs\/features\/([^/]+)$/u;
const IDENTITY = /^sha256:[0-9a-f]{64}$/u;
const SET = /^[0-9a-f]{64}$/u;
const RUNTIME_ID = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}-[0-9a-f]{12}$/u;

export class WorkflowBindings {
  private readonly env: NodeJS.ProcessEnv;
  private readonly profiles: Readonly<Record<string, LegacyProfile>>;

  constructor(private readonly cp: ControlPlane, readonly port: WorkflowStorePort, private readonly options: WorkflowBindingOptions = {}) {
    this.env = options.env ?? process.env;
    this.profiles = options.legacyProfiles ?? LEGACY_PROFILES;
  }

  /* ---------------- helpers ---------------- */

  refuse(code: string, message: string, data: Record<string, unknown> = {}): never {
    const details: Refusal = { reason: code.toLowerCase(), code, ...data };
    throw new BridgeError(ErrorCode.WORKFLOW_REFUSED, `${code}: ${message}`, details);
  }

  private lib<T>(fn: () => T): T {
    try {
      return fn();
    } catch (error) {
      if (error instanceof this.port.lib.WorkflowError) {
        const e = error as Error & { code: string; detail: string; data: Record<string, unknown> };
        this.refuse(e.code, e.detail || e.message, e.data ?? {});
      }
      throw error;
    }
  }

  private advertisement(): { package_version: string | null; workflow_binding: { contracts: readonly number[]; capabilities: readonly string[] } } {
    return { package_version: this.options.packageVersion ?? null, workflow_binding: this.options.advertisement ?? WORKFLOW_BINDING_ADVERTISEMENT };
  }

  private store(): string {
    return this.lib(() => this.port.lib.storeRoot(this.env));
  }

  /** Full verification of the exact identity in the store; refuses missing/corrupt (§ 3.3). */
  private verified(identity: string): { manifest: Record<string, any>; path: string } { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!IDENTITY.test(identity)) this.refuse("FORMAT_INVALID", "identity must be sha256:<64 hex>");
    const entry = this.lib(() => this.port.lib.storeEntry(this.store(), identity));
    if (entry.state !== "verified") {
      this.refuse(entry.state === "missing" ? "BUNDLE_MISSING" : "BUNDLE_CORRUPT", `workflow ${identity} is not available verified in the store`, {
        identity, store_problem: entry.code ?? null,
        next_step: `restore exactly ${identity} (workflow.mjs restore --identity ${identity} --from <plugin or bundle of that identity>)`,
      });
    }
    return { manifest: entry.manifest, path: entry.path! };
  }

  private compatible(manifest: Record<string, unknown>): void {
    const problems = this.port.lib.checkCompatibility(manifest["requires"], this.advertisement(), { mode: "bridge" });
    if (problems.length) this.refuse("WORKFLOW_INCOMPATIBLE", problems.map((p) => p.code).join(", "), { problems });
  }

  private featureDir(path: string, pattern: RegExp): { name: string; dir: string } {
    const match = pattern.exec(path);
    if (!match) this.refuse("FEATURE_PATH_OUTSIDE", `${path} is not ${pattern === LOCK_PATH ? "docs/features/<name>/workflow.lock.json" : "docs/features/<name>"}`);
    const name = match[1]!;
    const dir = this.lib(() => this.port.lib.featurePath(this.cp.workspaceRoot, name));
    return { name, dir };
  }

  private owned(featureId: string, manager: string): FeatureRecord {
    const f = this.cp.store.getFeature(featureId);
    if (!f) throw new BridgeError(ErrorCode.NOT_FOUND, "feature not found");
    if (f.manager !== manager) throw new BridgeError(ErrorCode.INVALID_ARGUMENT, "feature belongs to another manager");
    assertFeatureOpen(f);
    return f;
  }

  /** No running worker, unended attempt or held lease on the feature's latest task. */
  private assertIdle(f: FeatureRecord, operation: string, { requireSettled }: { requireSettled: boolean }): void {
    const busy = (message: string): never => this.refuse("WORKFLOW_SWITCH_ACTIVE_ATTEMPT", `${operation}: ${message}`, { feature_id: f.feature_id });
    if (f.active_task_id) busy("a round is active");
    if (f.latest_task_id) {
      const attempt = this.cp.store.listAttempts(f.latest_task_id).at(-1);
      if (attempt && attempt.ended_at == null) busy("the latest attempt has not ended");
      if (this.cp.store.listHeldLeases().some((l) => l.task_id === f.latest_task_id)) busy("the latest task still holds a lease");
      if (requireSettled && this.cp.store.getTask(f.latest_task_id)?.state !== TaskState.DONE) {
        busy("the latest round is not DONE; resolve or recover it under its current workflow first");
      }
    }
    if (f.state === "waiting_user") this.refuse("WORKFLOW_SWITCH_WAITING_USER", `${operation}: the feature waits for the user`, { feature_id: f.feature_id });
  }

  /**
   * R19-I02: a pending change is resumed only by the request that committed it. The hash is
   * persisted with the intent, so a retry after a crash with the same key and other arguments is
   * refused before anything is read from or written to the lock. A pending entry written without
   * a hash (none exist outside tests of this build) is refused as unverifiable.
   */
  private assertSameRequest(pending: NonNullable<WorkflowBindingRecord["pending_projection"]>, hash: string, operation: string): void {
    if (pending.request_hash !== hash) {
      throw new BridgeError(ErrorCode.IDEMPOTENCY_MISMATCH, `${operation} key reused with different arguments while its change is pending`, {
        reason: "workflow_pending_request_mismatch", pending_op: pending.op, generation: pending.generation });
    }
  }

  private replay(key: string, requestHash: string, operation: string): unknown | null {
    const saved = this.cp.store.getIdempotency(key);
    if (!saved) return null;
    if (saved.operation !== operation || saved.request_hash !== requestHash) {
      throw new BridgeError(ErrorCode.IDEMPOTENCY_MISMATCH, `${operation} key reused with different arguments`);
    }
    return JSON.parse(saved.response_json);
  }

  private remember(key: string, operation: string, requestHash: string, response: unknown): void {
    this.cp.store.putIdempotency({ key, operation, request_hash: requestHash, response_json: JSON.stringify(response), created_at: this.cp.clock.now() });
  }

  private save(f: FeatureRecord, op: string): void {
    f.updated_at = this.cp.clock.now();
    this.cp.store.putFeature(f);
    this.cp.store.appendEvent({ type: EventType.FEATURE_UPDATED, task_id: f.parent_task_id, agent: f.manager,
      payload: { feature_id: f.feature_id, state: f.state, workflow_op: op, workflow_identity: f.workflow?.identity ?? null,
        workflow_generation: f.workflow?.generation ?? null } }, f.updated_at);
  }

  private iso(): string {
    return new Date(this.cp.clock.now()).toISOString().replace(/\.\d{3}Z$/u, "Z");
  }

  /* ---------------- status (read-only) ---------------- */

  /** § 8: pure read. Never creates a lock, a store directory or a database row. */
  status(featureId?: string): Record<string, unknown> {
    const runtime = { binding: "configured", advertisement: this.advertisement().workflow_binding, schema_version: this.cp.store.schemaVersion?.() ?? null };
    if (!featureId) return { runtime };
    const f = this.cp.store.getFeature(featureId);
    if (!f) throw new BridgeError(ErrorCode.NOT_FOUND, "feature not found");
    const binding = f.workflow ?? null;
    let lock: Record<string, unknown> | null = null;
    let lockProblem: string | null = null;
    if (binding) {
      try {
        const { dir } = this.featureDir(binding.lock_path, LOCK_PATH);
        lock = this.port.lib.readLock(dir);
      } catch (error) {
        lockProblem = (error as BridgeError).details?.["code"] as string ?? (error as Error).message;
      }
    }
    let bundle: string = "n/a";
    if (binding) {
      const entry = (() => {
        try {
          return this.port.lib.storeEntry(this.port.lib.storeRoot(this.env), binding.identity);
        } catch (error) {
          return { state: "corrupt", code: (error as { code?: string }).code ?? "STORE_UNREADABLE" };
        }
      })();
      bundle = entry.state === "verified" ? "verified" : `${entry.state}:${entry.code ?? ""}`;
    }
    const lockWorkflow = lock?.["workflow"] as { identity?: string } | undefined;
    const lockGeneration = lock?.["generation"] as number | undefined;
    const state = !binding ? "legacy-unbound"
      : binding.pending_projection ? `switch-pending:${binding.pending_projection.op}`
        : lockProblem ? `lock-invalid:${lockProblem}`
          : !lock ? "lock-missing"
            : lockGeneration === binding.generation && lockWorkflow?.identity === binding.identity ? "in-sync"
              : (lockGeneration ?? 0) < binding.generation ? "projection-behind" : "diverged";
    const latest = f.latest_task_id ? this.cp.store.listAttemptWorkflows(f.latest_task_id) : [];
    return {
      runtime,
      feature: { feature_id: f.feature_id, state: f.state, closed: featureTerminal(f) },
      binding: binding ? { identity: binding.identity, version: binding.version, workflow_id: binding.workflow_id, kind: binding.kind,
        generation: binding.generation, lock_path: binding.lock_path, history: binding.history, pending_projection: binding.pending_projection,
        legacy: binding.legacy ?? null } : null,
      lock_state: state,
      bundle,
      latest_task_attempts: latest.map((a) => ({ attempt: a.attempt, identity: a.identity, generation: a.generation, kind: a.kind })),
      declaration_not_observation: "the binding and attempt identities are what the bridge admitted; whether a model applied them is observed only by a pilot",
    };
  }

  /* ---------------- bind ---------------- */

  /** Import a verified lock into an existing feature (§ 6.3). */
  bind(input: { feature_id: string; manager: string; lock_path: string; expected_identity: string; idempotency_key: string; authorize?: () => void }) {
    const key = `workflow.bind:${JSON.stringify([input.feature_id, input.idempotency_key])}`;
    const hash = hashRequest({ feature_id: input.feature_id, manager: input.manager, lock_path: input.lock_path, expected_identity: input.expected_identity });
    return this.cp.store.transaction(() => {
      input.authorize?.();
      const replayed = this.replay(key, hash, "workflow.bind");
      if (replayed) return { ...(replayed as object), replayed: true };
      const f = this.owned(input.feature_id, input.manager);
      const { dir } = this.featureDir(input.lock_path, LOCK_PATH);
      const lock = this.lib(() => this.port.lib.readLock(dir));
      if (!lock) this.refuse("LOCK_MISSING", `${input.lock_path} does not exist`);
      if (lock.workflow.identity !== input.expected_identity) {
        this.refuse("WORKFLOW_LOCK_MISMATCH", "the lock names another identity", { lock_identity: lock.workflow.identity, expected: input.expected_identity });
      }
      const { manifest } = this.verified(lock.workflow.identity);
      this.compatible(manifest);
      if (f.workflow) {
        if (f.workflow.identity === lock.workflow.identity && f.workflow.generation === lock.generation && f.workflow.lock_path === input.lock_path) {
          const response = { result: "ALREADY_BOUND", identity: f.workflow.identity, generation: f.workflow.generation };
          this.remember(key, "workflow.bind", hash, response);
          return { ...response, replayed: false };
        }
        this.refuse("WORKFLOW_ALREADY_BOUND", "the feature is bound to another selection; use switch", { bound: f.workflow.identity, generation: f.workflow.generation });
      }
      this.assertIdle(f, "bind", { requireSettled: false });
      f.workflow = {
        format: "bridge.workflow-binding/v1",
        identity: lock.workflow.identity, version: lock.workflow.version, workflow_id: lock.workflow.workflow_id, kind: lock.workflow.kind,
        generation: lock.generation, lock_path: input.lock_path,
        lock_sha256_at_bind: this.port.lib.sha256(this.port.lib.jsonBytes(lock)),
        history: [{ generation: lock.generation, op: "bind", identity: lock.workflow.identity, at: this.cp.clock.now(), idempotency_key: input.idempotency_key }],
        pending_projection: null,
      };
      this.save(f, "bind");
      const response = { result: "BOUND", identity: f.workflow.identity, generation: f.workflow.generation, workflow_id: f.workflow.workflow_id };
      this.remember(key, "workflow.bind", hash, response);
      return { ...response, replayed: false };
    });
  }

  /* ---------------- bind_legacy ---------------- */

  /**
   * Bind a lock-less pre-binding feature to the exact instruction set it followed (§ 10). The
   * source is a proven installed runtime; an ambiguous or unproven history needs the user's
   * explicit choice of one installed runtime, recorded as such. Never the latest workflow.
   */
  async bindLegacy(input: { feature_id: string; manager: string; feature_dir: string; runtime_id: string; expected_set_sha256: string;
    explicit_choice?: boolean; idempotency_key: string; authorize?: () => void }) {
    const key = `workflow.bind_legacy:${JSON.stringify([input.feature_id, input.idempotency_key])}`;
    const hash = hashRequest({ feature_id: input.feature_id, manager: input.manager, feature_dir: input.feature_dir, runtime_id: input.runtime_id,
      expected_set_sha256: input.expected_set_sha256, explicit_choice: input.explicit_choice === true });
    if (!RUNTIME_ID.test(input.runtime_id)) this.refuse("FORMAT_INVALID", "runtime_id");
    if (!SET.test(input.expected_set_sha256)) this.refuse("FORMAT_INVALID", "expected_set_sha256 must be 64 hex");
    // Pure preflight (no writes): evidence, profile and the exact source set.
    const preflight = this.cp.store.transaction(() => {
      input.authorize?.();
      const replayed = this.replay(key, hash, "workflow.bind_legacy");
      if (replayed) return { replayed };
      const f = this.owned(input.feature_id, input.manager);
      if (f.workflow?.pending_projection?.idempotency_key === input.idempotency_key) {
        this.assertSameRequest(f.workflow.pending_projection, hash, "bind_legacy");
        return { resume: true };
      }
      if (f.workflow) this.refuse("WORKFLOW_ALREADY_BOUND", "the feature is already bound", { bound: f.workflow.identity });
      this.assertIdle(f, "bind_legacy", { requireSettled: false });
      return { resume: false };
    });
    if ("replayed" in preflight) return { ...(preflight.replayed as object), replayed: true };
    if (preflight.resume) {
      const resumed = this.finishProjection(input.feature_id, input.manager, input.authorize);
      this.cp.store.transaction(() => { if (!this.cp.store.getIdempotency(key)) this.remember(key, "workflow.bind_legacy", hash, resumed); });
      return { ...resumed, replayed: false };
    }
    const { name, dir } = this.featureDir(input.feature_dir, FEATURE_DIR);
    if (this.lib(() => this.port.lib.readLock(dir))) this.refuse("LOCK_EXISTS", `${input.feature_dir} already has a workflow lock; use bind`);
    const home = this.lib(() => this.port.lib.bridgeHome(this.env));
    const runtimesDir = `${this.port.lib.canonicalAnchor(home)}/runtimes`;
    const installed = new Set<string>();
    try {
      const { readdirSync, existsSync } = await import("node:fs");
      for (const id of readdirSync(runtimesDir)) if (existsSync(`${runtimesDir}/${id}/runtime-manifest.json`)) installed.add(id);
    } catch { /* no runtimes */ }
    const evidence = this.port.lib.legacyEvidence(this.port.lib.featureRecords(dir), null, installed);
    let basis: string;
    if (evidence.verdict === "PROVEN") {
      if (evidence["runtime_id"] !== input.runtime_id) this.refuse("LEGACY_EVIDENCE_MISMATCH", "the recorded set belongs to another runtime", { evidence });
      if (evidence["set_sha256"] && !input.expected_set_sha256.startsWith(String(evidence["set_sha256"]))) this.refuse("LEGACY_EVIDENCE_MISMATCH", "the recorded set digest differs", { evidence });
      basis = String(evidence["basis"]);
    } else if (evidence.verdict === "SOURCE_MISSING") {
      this.refuse("LEGACY_SOURCE_MISSING", String(evidence["next_step"]), { evidence });
    } else {
      // AMBIGUOUS or UNPROVEN: only an explicit user choice of an installed runtime.
      if (input.explicit_choice !== true) this.refuse(evidence.verdict === "AMBIGUOUS" ? "LEGACY_AMBIGUOUS" : "LEGACY_UNPROVEN", "an explicit user choice of one installed runtime is required", { evidence });
      if (evidence.verdict === "AMBIGUOUS" && !(evidence["candidates"] as string[]).includes(input.runtime_id)) this.refuse("LEGACY_EVIDENCE_MISMATCH", "the chosen runtime is not one of the recorded candidates", { evidence });
      basis = `explicit user choice (${evidence.verdict.toLowerCase()} history)`;
    }
    if (!installed.has(input.runtime_id)) this.refuse("LEGACY_SOURCE_MISSING", `reinstall exactly runtime ${input.runtime_id}; no newer set is substituted`);
    const profile = this.profiles[input.expected_set_sha256];
    if (!profile || profile.runtime_id !== input.runtime_id) this.refuse("LEGACY_UNPROVEN", "this runtime has no legacy compatibility profile for that exact set", { set: input.expected_set_sha256 });
    const built = this.lib(() => this.port.legacy.legacyBundle({ runtimeDir: `${runtimesDir}/${input.runtime_id}`, runtimeId: input.runtime_id, expectedSetSha256: input.expected_set_sha256, profile }));
    this.compatible(built.manifest);
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const staging = mkdtempSync(`${tmpdir()}/workflow-legacy-`);
    try {
      this.lib(() => this.port.lib.writeBundle(`${staging}/bundle`, built.manifest, built.variants));
      this.lib(() => this.port.lib.storePublish(this.store(), `${staging}/bundle`));
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
    const lockPath = `docs/features/${name}/workflow.lock.json`;
    this.cp.store.transaction(() => {
      input.authorize?.();
      const f = this.owned(input.feature_id, input.manager);
      if (f.workflow) this.refuse("WORKFLOW_ALREADY_BOUND", "the feature was bound concurrently", { bound: f.workflow.identity });
      this.assertIdle(f, "bind_legacy", { requireSettled: false });
      this.verified(built.manifest.identity);
      f.workflow = {
        format: "bridge.workflow-binding/v1",
        identity: built.manifest.identity, version: built.manifest.version, workflow_id: built.manifest.workflow_id, kind: "legacy",
        generation: 1, lock_path: lockPath, lock_sha256_at_bind: null,
        history: [{ generation: 1, op: "bind_legacy", identity: built.manifest.identity, at: this.cp.clock.now(), idempotency_key: input.idempotency_key }],
        pending_projection: { generation: 1, op: "bind_legacy", idempotency_key: input.idempotency_key, request_hash: hash },
        legacy: { runtime_id: input.runtime_id, instructions_set_sha256: input.expected_set_sha256, basis },
      };
      this.save(f, "bind_legacy");
    });
    const done = this.finishProjection(input.feature_id, input.manager, input.authorize);
    const response = { ...done, excluded_runtime_owned: built.excluded.length, basis };
    this.cp.store.transaction(() => this.remember(key, "workflow.bind_legacy", hash, response));
    return { ...response, replayed: false };
  }

  /* ---------------- switch ---------------- */

  /**
   * Explicit switch (§ 7): verified target → one transaction (expected generation, idle and
   * settled feature, binding + history + pending projection) → lock projection → clear pending.
   * A retry with the same key completes a pending switch exactly once.
   */
  switch(input: { feature_id: string; manager: string; target_identity: string; expected_generation: number; idempotency_key: string; authorize?: () => void }) {
    const key = `workflow.switch:${JSON.stringify([input.feature_id, input.idempotency_key])}`;
    const hash = hashRequest({ feature_id: input.feature_id, manager: input.manager, target_identity: input.target_identity, expected_generation: input.expected_generation });
    const verdict = this.cp.store.transaction(() => {
      input.authorize?.();
      const replayed = this.replay(key, hash, "workflow.switch");
      if (replayed) return { replayed };
      const f = this.owned(input.feature_id, input.manager);
      const binding = f.workflow;
      if (!binding) this.refuse("WORKFLOW_UNBOUND", "bind the feature first", { feature_id: f.feature_id });
      if (binding.pending_projection) {
        if (binding.pending_projection.idempotency_key !== input.idempotency_key) {
          this.refuse("WORKFLOW_SWITCH_PENDING", "another change awaits its lock projection; retry it with its key or bridge_workflow_project", { pending: binding.pending_projection });
        }
        this.assertSameRequest(binding.pending_projection, hash, "switch");
        return { resume: true };
      }
      if (binding.generation !== input.expected_generation) {
        this.refuse("WORKFLOW_GENERATION_CONFLICT", `current generation is ${binding.generation}`, { generation: binding.generation, expected: input.expected_generation });
      }
      this.assertIdle(f, "switch", { requireSettled: true });
      const { manifest } = this.verified(input.target_identity);
      this.compatible(manifest);
      if (binding.identity === input.target_identity) this.refuse("WORKFLOW_ALREADY_SELECTED", "the feature already uses this identity");
      const from = binding.identity;
      const generation = binding.generation + 1;
      f.workflow = {
        ...binding,
        identity: manifest["identity"], version: manifest["version"], workflow_id: manifest["workflow_id"], kind: manifest["kind"],
        generation,
        history: [...binding.history, { generation, op: "switch", identity: manifest["identity"], from_identity: from, at: this.cp.clock.now(), idempotency_key: input.idempotency_key }],
        pending_projection: { generation, op: "switch", idempotency_key: input.idempotency_key, request_hash: hash },
      };
      this.save(f, "switch");
      return { resume: false, from, to: { identity: manifest["identity"], version: manifest["version"] } };
    });
    if ("replayed" in verdict) return { ...(verdict.replayed as object), replayed: true };
    const done = this.finishProjection(input.feature_id, input.manager, input.authorize);
    const response = { ...done, ...(verdict.resume ? {} : { from_identity: verdict.from, to: verdict.to }) };
    this.cp.store.transaction(() => {
      if (!this.cp.store.getIdempotency(key)) this.remember(key, "workflow.switch", hash, response);
    });
    return { ...response, replayed: false };
  }

  /** Complete a committed change's lock projection (explicit repair, § 7.3). */
  project(input: { feature_id: string; manager: string; authorize?: () => void }) {
    return this.finishProjection(input.feature_id, input.manager, input.authorize);
  }

  private finishProjection(featureId: string, manager: string, authorize?: () => void) {
    const f = this.cp.store.transaction(() => {
      authorize?.();
      return this.owned(featureId, manager);
    });
    const binding = f.workflow;
    if (!binding) this.refuse("WORKFLOW_UNBOUND", "nothing to project");
    const pending = binding.pending_projection;
    this.options.beforeProjection?.(pending?.op ?? "project", featureId);
    const { name, dir } = this.featureDir(binding.lock_path, LOCK_PATH);
    const lock = this.lib(() => this.port.lib.readLock(dir));
    const { manifest } = this.verified(binding.identity);
    if (!lock) {
      if (pending?.op !== "bind_legacy") this.refuse("LOCK_MISSING", `${binding.lock_path} is missing; restore it from Git history`);
      const created = this.port.lib.newLock(manifest, { origin: { kind: "legacy-bind", runtime_id: binding.legacy?.runtime_id ?? null }, at: this.iso(), featureId: name });
      this.lib(() => this.port.lib.writeLock(dir, created));
    } else if (lock.generation === binding.generation && lock.workflow.identity === binding.identity) {
      // Already projected (crash after the file write, before the database cleared pending).
    } else if (lock.generation === binding.generation - 1 && pending?.op === "switch") {
      const previous = binding.history.at(-1)?.from_identity;
      if (lock.workflow.identity !== previous) this.refuse("LOCK_DIVERGED", "the lock does not show the switched-from identity; nothing was written", { lock_identity: lock.workflow.identity });
      const next = {
        ...lock,
        workflow: { version: binding.version, identity: binding.identity, workflow_id: binding.workflow_id, kind: binding.kind },
        generation: binding.generation,
        origin: { kind: "switch", from_identity: previous },
        history: [...lock.history, { generation: binding.generation, op: "switch", version: binding.version, identity: binding.identity, origin: "switch", at: this.iso() }],
      };
      this.lib(() => this.port.lib.writeLock(dir, next));
    } else {
      this.refuse("LOCK_DIVERGED", "the lock and the binding disagree; nothing was written", { lock_generation: lock.generation, binding_generation: binding.generation });
    }
    return this.cp.store.transaction(() => {
      authorize?.();
      const current = this.owned(featureId, manager);
      if (current.workflow?.pending_projection) {
        current.workflow.pending_projection = null;
        this.save(current, "projected");
      }
      return { result: pending ? (pending.op === "switch" ? "SWITCHED" : "BOUND_LEGACY") : "IN_SYNC", identity: binding.identity, generation: binding.generation, lock_path: binding.lock_path };
    });
  }

  /* ---------------- admission (inside reservation transactions) ---------------- */

  private record(f: FeatureRecord, taskId: string, attempt: number, binding: WorkflowBindingRecord): void {
    const row: AttemptWorkflowRecord = { task_id: taskId, attempt, feature_id: f.feature_id, identity: binding.identity, workflow_id: binding.workflow_id,
      generation: binding.generation, kind: binding.kind, admitted_at: this.cp.clock.now() };
    this.cp.store.putAttemptWorkflow(row);
  }

  private admitCurrent(f: FeatureRecord, ack: string | null): WorkflowBindingRecord {
    const binding = f.workflow;
    if (!binding) {
      this.refuse("WORKFLOW_UNBOUND", "this feature has no workflow binding; bind its lock (bridge_workflow_bind) or bind its proven legacy set (bridge_workflow_bind_legacy)", { feature_id: f.feature_id });
    }
    if (binding.pending_projection) this.refuse("WORKFLOW_SWITCH_PENDING", "a committed change awaits its lock projection", { pending: binding.pending_projection });
    if (!ack) this.refuse("WORKFLOW_ACK_REQUIRED", "pass workflow_identity: the identity the manager just read with resolve", { bound: binding.identity, generation: binding.generation });
    if (ack !== binding.identity) this.refuse("WORKFLOW_ACK_MISMATCH", "the manager acknowledged another workflow; re-run resolve and re-read the bound entry", { acknowledged: ack, bound: binding.identity, generation: binding.generation });
    const { manifest } = this.verified(binding.identity);
    this.compatible(manifest);
    return binding;
  }

  /** New feature round: the task's first attempt (0) runs with the current binding. */
  admitRound(f: FeatureRecord, taskId: string, ack: string | null): void {
    const binding = this.admitCurrent(f, ack);
    this.record(f, taskId, 0, binding);
  }

  /**
   * Recovery (stranded, BLOCKED with message, explicit TIMEOUT or invalid-delivery terminal
   * recovery) of a feature task. The recovered attempt runs with the identity of the attempt it
   * resumes, which must still be the current binding; it never adopts a newer selection. A task
   * from before the binding may be recovered only under a legacy binding of generation 1 — the
   * proven old set it ran with.
   */
  admitRecovery(taskId: string, previousAttempt: number, recoveredAttempt: number, ack: string | null): AttemptWorkflowRecord | null {
    const feature = this.cp.store.listFeatures().find((f) => f.task_ids.includes(taskId));
    if (!feature) {
      if (ack) this.refuse("WORKFLOW_UNBOUND", "this task belongs to no feature; workflow_identity does not apply");
      return null;
    }
    const binding = this.admitCurrent(feature, ack);
    const history = this.cp.store.listAttemptWorkflows(taskId);
    const prior = this.cp.store.getAttemptWorkflow(taskId, previousAttempt) ?? history.at(-1);
    if (prior) {
      if (prior.identity !== binding.identity || prior.generation !== binding.generation) {
        this.refuse("WORKFLOW_ATTEMPT_IDENTITY_MISMATCH", "this task ran with another workflow selection; it is never recovered under a newer one", {
          task_identity: prior.identity, task_generation: prior.generation, bound: binding.identity, generation: binding.generation });
      }
    } else if (!(binding.kind === "legacy" && binding.generation === 1)) {
      this.refuse("WORKFLOW_ATTEMPT_UNBOUND", "this task predates the binding and the binding is not its proven legacy set; start a new round", { bound: binding.identity });
    }
    this.record(feature, taskId, recoveredAttempt, binding);
    return this.cp.store.getAttemptWorkflow(taskId, recoveredAttempt)!;
  }

  /**
   * The workflow of an attempt about to launch, verified again (it may have been deleted since
   * the reservation). Null for a pre-binding attempt. Throws before the worker starts.
   */
  launchWorkflow(taskId: string, attempt: number): AttemptWorkflow | null {
    const row = this.cp.store.getAttemptWorkflow(taskId, attempt);
    if (!row) return null;
    const { manifest, path } = this.verified(row.identity);
    return { identity: row.identity, workflow_id: row.workflow_id, version: String(manifest["version"]), generation: row.generation, kind: row.kind, client_root: `${path}/claude` };
  }
}
