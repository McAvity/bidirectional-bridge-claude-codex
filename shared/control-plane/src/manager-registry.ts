/**
 * Manager ownership: native per-request identity, epochs, active instance and generation.
 *
 * Identity always comes from the host-supplied per-request MCP metadata (contract §5); tool
 * arguments, environment variables and session files are never a source and never a fallback.
 * CAS values control concurrency only — they are not identity proof.
 *
 * Every method here must run inside the caller's `BEGIN IMMEDIATE` transaction: the guard and
 * the write it authorises have to be one atomic step (contract §6.3).
 */

import { BridgeError, ErrorCode, type AgentId } from "@bridge/protocol";
import type { Clock } from "./clock.js";
import type {
  ManagerBindingRecord,
  ManagerEpochRecord,
  StateStore,
} from "./store/state-store.js";

/** Host versions whose envelope *and* guardian behaviour were verified (contract §5.3). */
export const VERIFIED_ADAPTERS: ReadonlyMap<string, string> = new Map([["0.154.0", "codex-0.154.0"]]);

export const TURN_METADATA_KEY = "x-codex-turn-metadata";

export interface NativeCallContext {
  readonly thread_id: string;
  readonly session_id: string;
  readonly meta_thread_id: string;
  readonly codex_version: string;
  readonly adapter_id: string;
  readonly version_warning?: { code: string; message: string };
  readonly thread_source: string | null;
  readonly forked_from_thread_id: string | null;
}

const THREAD_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;

function invalid(message: string, reason: string, details: Record<string, unknown> = {}): never {
  throw new BridgeError(ErrorCode.NATIVE_CONTEXT_INVALID, message, { reason, ...details });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Classify one request's `_meta` (contract §5.2).
 *
 * The complete turn-metadata object is mandatory because subagent classification depends on
 * it. Missing/malformed versions are refused; an unverified version uses the same strict
 * envelope checks and carries a warning (version policy updated 2026-09-19).
 */
export function classifyNativeContext(meta: unknown): NativeCallContext {
  if (!isObject(meta)) invalid("request carries no native context", "native_context_missing");
  const threadId = meta["threadId"];
  if (threadId === undefined || threadId === null) {
    invalid("request carries no native threadId", "native_context_missing");
  }
  if (typeof threadId !== "string" || !THREAD_ID_PATTERN.test(threadId)) {
    invalid("native threadId is malformed", "native_context_malformed");
  }
  const turn = meta[TURN_METADATA_KEY];
  if (turn === undefined) invalid("native turn metadata is absent", "native_context_incomplete");
  if (!isObject(turn)) invalid("native turn metadata is not an object", "native_context_malformed");

  if (turn["subagent_kind"] !== undefined || turn["parent_thread_id"] !== undefined) {
    invalid("subagent sessions may not own a worktree", "native_subagent_rejected");
  }
  const sessionId = turn["session_id"];
  const metaThreadId = turn["thread_id"];
  if (typeof sessionId !== "string" || typeof metaThreadId !== "string") {
    invalid("native turn metadata lacks session_id/thread_id", "native_context_incomplete");
  }
  if (metaThreadId !== threadId || sessionId !== metaThreadId) {
    invalid("native identifiers disagree", "native_context_inconsistent", {
      thread_id: metaThreadId === threadId ? "match" : "mismatch",
    });
  }
  const version = turn["codex_version"];
  if (typeof version !== "string" || version.length > 80 ||
      !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(version)) {
    invalid("native turn metadata lacks a well-formed codex_version", "native_context_malformed");
  }
  const verifiedAdapter = VERIFIED_ADAPTERS.get(version);
  // Version is compatibility information, never identity proof. Unknown hosts still have to
  // satisfy every metadata, subagent and ownership check; do not call this adapter verified.
  const adapter = verifiedAdapter ?? "codex-turn-metadata-unverified";
  const source = turn["thread_source"];
  const forked = turn["forked_from_thread_id"];
  return {
    thread_id: threadId,
    session_id: sessionId,
    meta_thread_id: metaThreadId,
    codex_version: version,
    adapter_id: adapter,
    ...(!verifiedAdapter ? { version_warning: {
      code: "CODEX_VERSION_UNVERIFIED",
      message: `Codex ${version} has not been fully verified; using the turn-metadata adapter with all identity checks enforced (verified: ${[...VERIFIED_ADAPTERS.keys()].join(", ")}).`,
    } } : {}),
    thread_source: typeof source === "string" ? source : null,
    forked_from_thread_id: typeof forked === "string" ? forked : null,
  };
}

export type ActivationKind = "bind" | "resume" | "adopt_detached" | "takeover";

export interface ManagerAuthority {
  readonly binding: ManagerBindingRecord;
  /** True when this call activated a connection that was not previously active. */
  readonly adopted: boolean;
}

export interface BindFirstCallInput {
  readonly native: NativeCallContext;
  readonly role: AgentId;
  readonly instanceId: string;
  readonly workspaceId: string | null;
}

export interface InstanceCasInput {
  readonly native: NativeCallContext;
  readonly instanceId: string;
  readonly expectedEpoch: number;
  readonly expectedGeneration: number;
}

export interface TakeoverInput {
  readonly native: NativeCallContext;
  readonly role: AgentId;
  readonly instanceId: string;
  readonly workspaceId: string | null;
  readonly expectedThreadId: string;
  readonly expectedEpoch: number;
  readonly reason: string;
}

export class ManagerRegistry {
  constructor(
    private readonly store: StateStore,
    private readonly clock: Clock,
  ) {}

  private required<T>(value: T | undefined, name: string): T {
    if (value === undefined) {
      throw new BridgeError(ErrorCode.INTERNAL, `store does not support ${name}`);
    }
    return value;
  }

  read(): ManagerBindingRecord | undefined {
    return this.required(this.store.getManagerBinding, "manager bindings").call(this.store);
  }

  private epochs(): ManagerEpochRecord[] {
    return this.required(this.store.listManagerEpochs, "manager history").call(this.store, 50);
  }

  private activate(
    epoch: number,
    generation: number,
    instanceId: string,
    kind: ActivationKind,
    at: number,
  ): void {
    this.required(this.store.insertManagerInstance, "manager instances").call(this.store, {
      epoch,
      instance_generation: generation,
      instance_id: instanceId,
      activated_at: at,
      activated_by_kind: kind,
      ended_at: null,
      end_kind: null,
    });
  }

  /** First authorised ownership call in an unbound worktree (contract §7.2, Mode 1). */
  bindFirstCall(input: BindFirstCallInput): ManagerBindingRecord {
    const existing = this.read();
    if (existing) {
      // Another root committed while we were preparing: fail without touching its binding.
      this.assertThread(existing, input.native);
    }
    const at = this.clock.now();
    const epoch = 1;
    this.required(this.store.insertManagerEpoch, "manager history").call(this.store, {
      epoch,
      native_thread_id: input.native.thread_id,
      workspace_id: input.workspaceId,
      role: input.role,
      adapter_id: input.native.adapter_id,
      native_corroboration: "turn-metadata",
      codex_version: input.native.codex_version,
      thread_source: input.native.thread_source,
      bound_at: at,
      bound_by_kind: "first_call",
      ended_at: null,
      end_kind: null,
      takeover_reason: null,
      predecessor_epoch: null,
    });
    this.activate(epoch, 1, input.instanceId, "bind", at);
    const binding: ManagerBindingRecord = {
      epoch,
      native_thread_id: input.native.thread_id,
      active_instance_id: input.instanceId,
      instance_generation: 1,
      active_feature_id: null,
      updated_at: at,
    };
    this.required(this.store.putManagerBinding, "manager bindings").call(this.store, binding);
    return binding;
  }

  private assertThread(binding: ManagerBindingRecord, native: NativeCallContext): void {
    if (binding.native_thread_id === native.thread_id) return;
    const history = this.epochs();
    const wasOwner = history.some((row) => row.native_thread_id === native.thread_id);
    throw new BridgeError(
      wasOwner ? ErrorCode.MANAGER_FENCED : ErrorCode.MANAGER_FOREIGN_THREAD,
      wasOwner
        ? "this session was superseded by an explicit takeover; regaining authority needs another explicit takeover"
        : "this worktree is managed by another native session; take over explicitly or use a different worktree",
      { epoch: binding.epoch, active_feature_id: binding.active_feature_id },
    );
  }

  /**
   * Read-only authority check for a request that has not reserved anything yet.
   *
   * It answers the same questions as `authorizeMutation` — is this the owning thread, and may
   * this connection act — but it writes nothing: adoption of a cleanly detached binding belongs
   * to the transaction that actually reserves state, so a request that turns out to be invalid
   * leaves no activation, epoch or schema change behind (review R10-02).
   */
  assertAuthorityPure(native: NativeCallContext, instanceId: string): void {
    const binding = this.read();
    if (!binding) return; // unbound: the bootstrap path decides
    this.assertThread(binding, native);
    if (binding.active_instance_id === instanceId) return;
    if (binding.active_instance_id === null) {
      const seen = this.required(this.store.instanceSeenInEpoch, "manager instances").call(
        this.store,
        binding.epoch,
        instanceId,
      );
      if (!seen) return; // a fresh connection would adopt when it reserves
    }
    throw new BridgeError(
      ErrorCode.MANAGER_INSTANCE_FENCED,
      "this connection is not the active instance of the bound manager; resume the instance explicitly",
      {
        epoch: binding.epoch,
        instance_generation: binding.instance_generation,
        active: binding.active_instance_id !== null,
      },
    );
  }

  /**
   * Authorise a guarded mutation: the owning thread AND the active instance (contract §7).
   * A clean detach leaves no active connection, so a *fresh* instance of the owning thread may
   * adopt; an instance already seen in this epoch must use an explicit handoff instead.
   */
  authorizeMutation(native: NativeCallContext, instanceId: string): ManagerAuthority {
    const binding = this.read();
    if (!binding) throw new BridgeError(ErrorCode.INTERNAL, "worktree has no manager binding");
    this.assertThread(binding, native);
    if (binding.active_instance_id === instanceId) return { binding, adopted: false };
    if (binding.active_instance_id === null) {
      const seen = this.required(this.store.instanceSeenInEpoch, "manager instances").call(
        this.store,
        binding.epoch,
        instanceId,
      );
      if (!seen) {
        const at = this.clock.now();
        const generation = binding.instance_generation + 1;
        this.activate(binding.epoch, generation, instanceId, "adopt_detached", at);
        const next: ManagerBindingRecord = {
          ...binding,
          active_instance_id: instanceId,
          instance_generation: generation,
          updated_at: at,
        };
        this.required(this.store.putManagerBinding, "manager bindings").call(this.store, next);
        return { binding: next, adopted: true };
      }
    }
    throw new BridgeError(
      ErrorCode.MANAGER_INSTANCE_FENCED,
      "this connection is not the active instance of the bound manager; resume the instance explicitly",
      {
        epoch: binding.epoch,
        instance_generation: binding.instance_generation,
        active: binding.active_instance_id !== null,
      },
    );
  }

  /** Explicit connection handoff (Class H): full `(epoch, generation)` CAS plus host identity. */
  resumeInstance(input: InstanceCasInput): { binding: ManagerBindingRecord; changed: boolean } {
    const binding = this.read();
    if (!binding) throw new BridgeError(ErrorCode.INTERNAL, "worktree has no manager binding");
    this.assertThread(binding, input.native);
    if (binding.epoch !== input.expectedEpoch || binding.instance_generation !== input.expectedGeneration) {
      throw new BridgeError(
        ErrorCode.MANAGER_INSTANCE_FENCED,
        "handoff expectation is stale; read bridge_manager_status and retry",
        { epoch: binding.epoch, instance_generation: binding.instance_generation },
      );
    }
    // Same instance with a matching CAS is an idempotent no-op: no new activation row, no
    // generation bump, so a retry cannot disturb a concurrent holder or invent a session.
    if (binding.active_instance_id === input.instanceId) return { binding, changed: false };

    const at = this.clock.now();
    if (binding.active_instance_id !== null) {
      this.required(this.store.endManagerInstance, "manager instances").call(
        this.store,
        binding.epoch,
        binding.instance_generation,
        at,
        "superseded",
      );
    }
    const generation = binding.instance_generation + 1;
    this.activate(binding.epoch, generation, input.instanceId, "resume", at);
    const next: ManagerBindingRecord = {
      ...binding,
      active_instance_id: input.instanceId,
      instance_generation: generation,
      updated_at: at,
    };
    this.required(this.store.putManagerBinding, "manager bindings").call(this.store, next);
    return { binding: next, changed: true };
  }

  /** Explicit takeover (Class T): compare-and-swap on the previous thread and epoch. */
  takeover(input: TakeoverInput): ManagerBindingRecord {
    const binding = this.read();
    if (!binding) throw new BridgeError(ErrorCode.INTERNAL, "worktree has no manager binding");
    if (binding.native_thread_id !== input.expectedThreadId || binding.epoch !== input.expectedEpoch) {
      throw new BridgeError(
        ErrorCode.MANAGER_FOREIGN_THREAD,
        "takeover expectation does not match the current binding",
        { epoch: binding.epoch },
      );
    }
    const at = this.clock.now();
    const previous = this.epochs().find((row) => row.epoch === binding.epoch);
    if (previous) {
      this.required(this.store.updateManagerEpoch, "manager history").call(this.store, {
        ...previous,
        ended_at: at,
        end_kind: "taken_over",
        takeover_reason: input.reason,
      });
    }
    if (binding.active_instance_id !== null) {
      this.required(this.store.endManagerInstance, "manager instances").call(
        this.store,
        binding.epoch,
        binding.instance_generation,
        at,
        "taken_over",
      );
    }
    const epoch = binding.epoch + 1;
    this.required(this.store.insertManagerEpoch, "manager history").call(this.store, {
      epoch,
      native_thread_id: input.native.thread_id,
      workspace_id: input.workspaceId,
      role: input.role,
      adapter_id: input.native.adapter_id,
      native_corroboration: "turn-metadata",
      codex_version: input.native.codex_version,
      thread_source: input.native.thread_source,
      bound_at: at,
      bound_by_kind: "takeover",
      ended_at: null,
      end_kind: null,
      takeover_reason: input.reason,
      predecessor_epoch: binding.epoch,
    });
    this.activate(epoch, 1, input.instanceId, "takeover", at);
    const next: ManagerBindingRecord = {
      epoch,
      native_thread_id: input.native.thread_id,
      active_instance_id: input.instanceId,
      instance_generation: 1,
      active_feature_id: binding.active_feature_id,
      updated_at: at,
    };
    this.required(this.store.putManagerBinding, "manager bindings").call(this.store, next);
    return next;
  }

  /**
   * Clean detach: the connection stops being active without ending the epoch.
   *
   * The generation is bumped so a handoff CAS captured before the detach can no longer apply,
   * and the transition is recorded exactly once; a repeated or stale call is a no-op.
   */
  detach(instanceId: string, role: AgentId = "bridge"): boolean {
    const binding = this.read();
    if (!binding || binding.active_instance_id !== instanceId) return false;
    const at = this.clock.now();
    this.required(this.store.endManagerInstance, "manager instances").call(
      this.store,
      binding.epoch,
      binding.instance_generation,
      at,
      "detached",
    );
    const generation = binding.instance_generation + 1;
    this.required(this.store.putManagerBinding, "manager bindings").call(this.store, {
      ...binding,
      active_instance_id: null,
      instance_generation: generation,
      updated_at: at,
    });
    this.store.appendEvent(
      {
        type: "manager.detached" as never,
        task_id: null,
        agent: role,
        payload: { epoch: binding.epoch, instance_generation: generation, previous_instance_ended: true },
      },
      at,
    );
    return true;
  }

  /** One active feature per worktree (contract §11). */
  claimFeature(featureId: string, binding: ManagerBindingRecord): ManagerBindingRecord {
    if (binding.active_feature_id === featureId) return binding;
    if (binding.active_feature_id !== null) {
      throw new BridgeError(
        ErrorCode.FEATURE_CONFLICT,
        `worktree already has an active feature (${binding.active_feature_id})`,
        { active_feature_id: binding.active_feature_id },
      );
    }
    const next: ManagerBindingRecord = {
      ...binding,
      active_feature_id: featureId,
      updated_at: this.clock.now(),
    };
    this.required(this.store.putManagerBinding, "manager bindings").call(this.store, next);
    return next;
  }

  releaseFeature(featureId: string): void {
    const binding = this.read();
    if (!binding || binding.active_feature_id !== featureId) return;
    this.required(this.store.putManagerBinding, "manager bindings").call(this.store, {
      ...binding,
      active_feature_id: null,
      updated_at: this.clock.now(),
    });
  }
}
