/**
 * Per-process identity runtime: native context, workspace bootstrap dispatch and the guard.
 *
 * Contract §4.4 (Mode 1 unbound bootstrap / Mode 2 bound operation / Mode 3 marker repair),
 * §6.3 (authority and every schema-affecting write inside the transaction that reserves state)
 * and §7 (thread plus active instance authorisation).
 *
 * Three rules shape the structure:
 *  - nothing writes before the authority decision, including schema, markers and reconciliation;
 *  - an asynchronous operation is authorised twice: once at dispatch, so a legitimate replay that
 *    reserves nothing is still checked, and once inside the reservation transaction itself;
 *  - the worktree critical section is released at the reservation/publication boundary, exactly
 *    once, never while a worker runs.
 */

import { createHash, randomBytes } from "node:crypto";
import {
  ControlPlane,
  DiagnosticsLogger,
  ManagerRegistry,
  SqliteStateStore,
  WorktreeCriticalSection,
  assertProbeUsable,
  assertStateDirectoryExplained,
  classifyNativeContext,
  completePublication,
  digestRef,
  probeWorkspaceState,
  publishReservation,
  releaseOwnReservation,
  repairRecordsFromBinding,
  stateDirectory,
  type ManagerBindingRecord,
  type NativeCallContext,
  type StateProbe,
  type WorkspaceIdentity,
} from "@bridge/control-plane";
import { BridgeError, ErrorCode, type AgentId } from "@bridge/protocol";

/** Operation classes of contract §6.1. */
export type ToolClass = "read" | "mutate" | "handoff" | "takeover";

export interface AuthorizedSession {
  readonly binding: ManagerBindingRecord;
  readonly native: NativeCallContext;
}

/**
 * Per-call write permission for the diagnostics log (review R1-01).
 *
 * One object per MCP request, created by the tool layer and filled in by the guard. It is what
 * separates "this process was once authorized" from "the call being served right now is
 * authorized": refusals, reads and calls that overlap a running round each carry their own
 * audit, so none of them can write a record on another call's authority.
 */
export interface CallAudit {
  authorized: boolean;
  armed: boolean;
  epoch: number | null;
  generation: number | null;
  thread: string | null;
  task_id: string | null;
  attempt: number | null;
}

export function newCallAudit(): CallAudit {
  return {
    authorized: false,
    armed: false,
    epoch: null,
    generation: null,
    thread: null,
    task_id: null,
    attempt: null,
  };
}

/** Named operations that launch or resume a worker (contract §8). */
export const LAUNCH_OPERATIONS: ReadonlySet<string> = new Set([
  "bridge_delegate",
  "bridge_feature_run",
  "bridge_resume_task",
  "bridge_resume_delegated_task",
]);

export interface LegacyAdoption {
  readonly reason: string;
}

/** Hooks handed to a call body so guard, repair, publication and unlock stay ordered. */
export interface GuardHooks {
  /**
   * Read-only authority check for a request that has not reserved anything yet. It never
   * adopts an instance and never migrates: those belong to the reserving transaction.
   */
  precheck(): void;
  /** Runs inside the transaction that reserves state; throws to deny. */
  authorize(): AuthorizedSession;
  /** Runs inside the same transaction, after the operation succeeded. */
  afterOperation(session: AuthorizedSession): void;
  /** Reservation/publication boundary: publish markers and release the lock, once. */
  settle(): void;
  /** Failure boundary: release this attempt's own reservation and the lock, once. */
  abort(): void;
}

export class IdentityRuntime {
  readonly instanceId: string;

  constructor(
    readonly cp: ControlPlane,
    readonly workspace: WorkspaceIdentity,
    readonly role: AgentId,
    instanceId = `inst_${randomBytes(8).toString("hex")}`,
    readonly legacyAdoption?: LegacyAdoption,
    /**
     * Diagnostics log of this process (wave13 §1). It is armed here and nowhere else: the
     * authorized write point is the guard that has just granted this call authority over the
     * worktree, so a refusal, a read or a handshake can never create `.bridge/logs/`.
     */
    readonly logger?: DiagnosticsLogger,
  ) {
    this.instanceId = instanceId;
  }

  private noteAuthority(
    audit: CallAudit,
    binding: ManagerBindingRecord | null,
    native: NativeCallContext | null,
  ): void {
    audit.authorized = true;
    audit.epoch = binding?.epoch ?? null;
    audit.generation = binding?.instance_generation ?? null;
    // The native thread id is a local session handle: correlate by digest, never by value.
    audit.thread = digestRef(binding?.native_thread_id ?? native?.thread_id ?? null);
  }

  /**
   * Arm the diagnostics log after an authorized operation has committed (or, for an
   * asynchronous launch, after its reservation committed). Never called on a refusal, and
   * never for a call this request did not authorize: the permission is per call, carried by
   * `audit`, so overlapping calls cannot inherit each other's authority (review R1-01).
   */
  private armLogger(audit: CallAudit, toolName: string): void {
    const logger = this.logger;
    if (!logger || !audit.authorized || audit.armed) return;
    audit.armed = true;
    logger.arm({
      stateDirectory: stateDirectory(this.workspace),
      workspaceId: this.workspaceId,
      by: toolName,
    });
    logger.record({
      op: "manager",
      event: "authorized",
      tool: toolName,
      outcome: "ok",
      phase: "guard",
      task_id: audit.task_id,
      attempt: audit.attempt,
      details: {
        epoch: audit.epoch,
        instance_generation: audit.generation,
        thread_ref: audit.thread,
        role: this.role,
      },
    });
  }

  /**
   * Is this connection still the active instance of the worktree's manager? Pure read; used
   * before a shutdown record so a session that lost the worktree to a takeover stops writing
   * into state that is no longer its own.
   */
  isActiveInstance(): boolean {
    try {
      const probe = probeWorkspaceState(this.workspace, this.databasePath);
      if (!probe.binding) return false;
      if (this.role !== "codex") return true;
      return probe.managerBinding?.active_instance_id === this.instanceId;
    } catch {
      return false;
    }
  }

  get databasePath(): string {
    return this.cp.databasePath;
  }

  get workspaceId(): string {
    return workspaceIdFor(this.workspace);
  }

  probe(): StateProbe {
    const probe = probeWorkspaceState(this.workspace, this.databasePath);
    assertProbeUsable(this.workspace, probe, { adoptLegacy: this.legacyAdoption !== undefined });
    return probe;
  }

  /** Class R: read-only projection; never creates, migrates or replaces a live writer. */
  prepareRead(): StateProbe {
    const probe = this.probe();
    if (probe.databaseExists) this.cp.activate("readonly");
    return probe;
  }

  requireReadableState(): StateProbe {
    const probe = this.prepareRead();
    if (!probe.databaseExists || !probe.binding) {
      throw new BridgeError(
        ErrorCode.NOT_FOUND,
        "this worktree has no bridge state yet; it is created by the first authorized ownership call",
        { root: this.workspace.root },
      );
    }
    return probe;
  }

  status(): Record<string, unknown> {
    const probe = this.prepareRead();
    const manager = probe.managerBinding;
    return {
      workspace: {
        workspace_id: probe.binding?.workspace_id ?? null,
        kind: this.workspace.kind,
        root: this.workspace.root,
        git_dir: this.workspace.git_dir,
        project_key: this.workspace.project_key,
        database: this.databasePath,
        database_exists: probe.databaseExists,
        bound: probe.binding !== null,
      },
      process: { instance_id: this.instanceId, role: this.role },
      manager: manager
        ? {
            native_thread_id: manager.native_thread_id,
            epoch: manager.epoch,
            instance_generation: manager.instance_generation,
            active_instance: manager.active_instance_id !== null,
            is_calling_instance: manager.active_instance_id === this.instanceId,
            active_feature_id: manager.active_feature_id,
            resume_hint:
              manager.active_instance_id === this.instanceId
                ? null
                : `bridge_manager_resume_instance {expected_epoch: ${manager.epoch}, expected_generation: ${manager.instance_generation}}`,
          }
        : null,
      recovery: {
        marker_state: probe.marker.kind === "valid" ? probe.marker.record.state : probe.marker.kind,
        owner_state: probe.owner.kind === "valid" ? probe.owner.record.state : probe.owner.kind,
        recovery_needed: probe.recoveryNeeded,
        reservation_nonce_matches_binding:
          probe.binding !== null &&
          probe.marker.kind === "valid" &&
          probe.marker.record.reservation_nonce === probe.binding.reservation_nonce,
      },
      legacy_adopted: probe.binding ? probe.binding.legacy_adopted === 1 : false,
      adoption: probe.binding?.adoption_json ? JSON.parse(probe.binding.adoption_json) : null,
      schema_version: probe.schemaVersion,
    };
  }

  /** Re-classify the current request's metadata; identity is never cached across calls. */
  lastNative(meta: unknown): NativeCallContext {
    return classifyNativeContext(meta);
  }

  /** Roles whose host supplies no Codex metadata (contract §8). */
  private guardForeignRole(probe: StateProbe, toolName: string, klass: ToolClass): void {
    if (klass !== "mutate") {
      throw new BridgeError(
        ErrorCode.NATIVE_CONTEXT_INVALID,
        "manager operations require a native Codex session",
        { reason: "native_context_missing", role: this.role },
      );
    }
    if (LAUNCH_OPERATIONS.has(toolName) && probe.binding && probe.managerBinding) {
      throw new BridgeError(
        ErrorCode.MANAGER_FOREIGN_THREAD,
        `${toolName} is reserved for the manager session that owns this worktree`,
        { role: this.role, operation: toolName, epoch: probe.managerBinding.epoch },
      );
    }
    if (!probe.databaseExists || !probe.binding) {
      throw new BridgeError(
        ErrorCode.NOT_FOUND,
        "this worktree has no bridge state yet; the manager creates it",
        { root: this.workspace.root },
      );
    }
  }

  private openWriter(): SqliteStateStore {
    this.cp.activate("attach");
    return this.cp.store as SqliteStateStore;
  }

  /** Synchronous guarded mutation: guard, operation and repair share one transaction. */
  runMutation<T>(
    meta: unknown,
    kind: ToolClass,
    run: (session: AuthorizedSession, registry: ManagerRegistry) => T,
    toolName = "",
    audit: CallAudit = newCallAudit(),
  ): T {
    return this.dispatch(meta, kind, toolName, audit, (hooks, registry, store) => {
      let result: T;
      try {
        result = store.transaction(() => {
          const session = hooks.authorize();
          const value = run(session, registry);
          hooks.afterOperation(session);
          return value;
        });
      } catch (error) {
        hooks.abort();
        throw error;
      }
      // Only a committed transaction arms the log: a rolled-back bootstrap leaves no binding
      // and therefore no authorized owner of this worktree's log directory.
      this.armLogger(audit, toolName);
      hooks.settle();
      return result;
    });
  }

  /**
   * Asynchronous guarded mutation.
   *
   * `run` receives the reservation guard and the reservation boundary callback. A call that
   * legitimately reserves nothing (an idempotent replay) is still authorised — at dispatch — and
   * is never turned into an internal error.
   */
  async runMutationAsync<T>(
    meta: unknown,
    toolName: string,
    run: (authorize: () => void, onReserved: () => void) => Promise<T>,
    audit: CallAudit = newCallAudit(),
  ): Promise<T> {
    return this.dispatch(meta, "mutate", toolName, audit, async (hooks, _registry, store) => {
      // Dispatch-time authority for the already-bound case: a replay reserves nothing, so the
      // reservation guard would never run, yet the caller must still own the worktree. This
      // check is pure — an invalid request leaves no adoption and no migration behind.
      if (this.boundAtDispatch) {
        try {
          hooks.precheck();
        } catch (error) {
          hooks.abort();
          throw error;
        }
      }
      try {
        const result = await run(
          () => {
            try {
              hooks.authorize();
            } catch (error) {
              // Authority changed between the pure precheck and the reservation: this call is
              // refused after all, so it must not write to the worktree's log either.
              audit.authorized = false;
              throw error;
            }
          },
          () => {
            hooks.settle();
            // The reservation has committed and the worker is about to run: a long round is
            // visible in the log from its start, not only when it finishes.
            this.armLogger(audit, toolName);
          },
        );
        hooks.settle();
        this.armLogger(audit, toolName);
        return result;
      } catch (error) {
        hooks.abort();
        throw error;
      }
    });
  }

  private boundAtDispatch = false;

  private dispatch<T>(
    meta: unknown,
    kind: ToolClass,
    toolName: string,
    audit: CallAudit,
    body: (hooks: GuardHooks, registry: ManagerRegistry, store: SqliteStateStore) => T,
  ): T {
    const probe = this.probe();
    this.boundAtDispatch = probe.binding !== null;
    if (this.role !== "codex") {
      this.guardForeignRole(probe, toolName, kind);
      const store = this.openWriter();
      const passthrough: GuardHooks = {
        // An asynchronous replay reserves nothing, so this is the only authority check it gets;
        // `guardForeignRole` has already established that the worktree is bound and the
        // operation permitted, which is exactly the worker role's authority.
        precheck: () => this.noteAuthority(audit, probe.managerBinding, null),
        authorize: () => {
          // The worker role has no native session; `guardForeignRole` already established that
          // this worktree is bound and that the operation is a permitted mutation.
          this.noteAuthority(audit, probe.managerBinding, null);
          return { binding: probe.managerBinding as ManagerBindingRecord, native: null as never };
        },
        afterOperation: () => {},
        settle: () => {},
        abort: () => {},
      };
      return body(passthrough, this.cp.managers, store);
    }

    const native = this.lastNative(meta);
    return probe.binding
      ? this.inBound(probe, native, kind, audit, body)
      : this.inBootstrap(probe, native, kind, audit, body);
  }

  /** Mode 1: nothing is bound yet. Ownership and schema are written by the guard itself. */
  private inBootstrap<T>(
    probe: StateProbe,
    native: NativeCallContext,
    kind: ToolClass,
    audit: CallAudit,
    body: (hooks: GuardHooks, registry: ManagerRegistry, store: SqliteStateStore) => T,
  ): T {
    if (kind !== "mutate") {
      throw new BridgeError(
        ErrorCode.NOT_FOUND,
        "this worktree has no manager binding yet; the first authorized operation creates it",
        { root: this.workspace.root },
      );
    }
    const section = WorktreeCriticalSection.acquire(this.workspace);
    let released = false;
    const releaseOnce = (): void => {
      if (released) return;
      released = true;
      section.release();
    };
    try {
      const fresh = probeWorkspaceState(this.workspace, this.databasePath);
      assertProbeUsable(this.workspace, fresh, { adoptLegacy: this.legacyAdoption !== undefined });
      if (fresh.binding) {
        this.boundAtDispatch = true;
        return this.inBound(fresh, native, kind, audit, body, { release: releaseOnce });
      }
      assertStateDirectoryExplained(this.workspace, this.databasePath, fresh);
      const nonce = publishReservation(this.workspace, this.workspaceId, this.databasePath, fresh);

      const store = this.openWriter();
      // The journal mode of a brand-new file is the only pragma written here, under the lock.
      if (!fresh.databaseExists) store.ensureJournalMode();
      const registry = this.cp.managers;
      const adoption = fresh.hasHistory && this.legacyAdoption ? this.legacyAdoption : undefined;

      let settled = false;
      const finish = (): void => {
        if (settled) {
          releaseOnce();
          return;
        }
        settled = true;
        this.settleBootstrap(nonce);
        releaseOnce();
      };

      const hooks: GuardHooks = {
        // Nothing is bound yet: there is no prior authority to check without writing.
        precheck: () => {},
        authorize: () => {
          // Schema creation is part of the guarded transaction, so a failed first operation
          // rolls it back with the ownership it was meant to serve (review R09-05).
          store.initializeSchema();
          const binding = registry.bindFirstCall({
            native,
            role: this.role,
            instanceId: this.instanceId,
            workspaceId: this.workspaceId,
          });
          this.cp.store.putWorkspaceBinding?.({
            workspace_id: this.workspaceId,
            kind: this.workspace.kind,
            root: this.workspace.root,
            git_dir: this.workspace.git_dir,
            git_common_dir: this.workspace.git_common_dir,
            database_path: this.databasePath,
            reservation_nonce: nonce,
            bound_at: this.cp.clock.now(),
            legacy_adopted: adoption ? 1 : 0,
            adoption_json: adoption
              ? JSON.stringify({
                  adopted_at: new Date().toISOString(),
                  adopted_root: this.workspace.root,
                  git_dir: this.workspace.git_dir,
                  database_path: this.databasePath,
                  legacy_schema_version: fresh.schemaVersion,
                  row_counts: store.domainRowCounts(),
                  reason: adoption.reason,
                })
              : null,
          });
          this.noteAuthority(audit, binding, native);
          if (adoption) {
            this.cp.store.appendEvent(
              {
                type: "workspace.adopted" as never,
                task_id: null,
                agent: this.role,
                payload: {
                  root: this.workspace.root,
                  reason: adoption.reason,
                  legacy_schema_version: fresh.schemaVersion,
                  row_counts: store.domainRowCounts(),
                },
              },
              this.cp.clock.now(),
            );
          }
          return { binding, native };
        },
        afterOperation: () => {},
        settle: finish,
        abort: finish,
      };

      const result = body(hooks, registry, store);
      if (result instanceof Promise) {
        // The lock is released at the reservation boundary by `settle`; this only guarantees
        // that a rejection still settles exactly once.
        return result.catch((error: unknown) => {
          finish();
          throw error;
        }) as unknown as T;
      }
      return result;
    } catch (error) {
      releaseOnce();
      throw error;
    }
  }

  /**
   * Finish a bootstrap attempt by what actually committed: a binding row completes the
   * publication, no binding row releases only this attempt's own reservation.
   */
  private settleBootstrap(nonce: string): void {
    let binding: ReturnType<SqliteStateStore["getWorkspaceBinding"]>;
    try {
      binding = (this.cp.store as SqliteStateStore).getWorkspaceBinding?.();
    } catch {
      binding = undefined;
    }
    if (binding) {
      try {
        completePublication(this.workspace, binding.workspace_id, binding.database_path, binding.reservation_nonce);
      } catch {
        // Markers stay `reserving`: a recoverable state that status reports and the next
        // authorized mutation repairs.
      }
      return;
    }
    releaseOwnReservation(this.workspace, this.databasePath, nonce);
  }

  /** Mode 2/3: already bound. Authority is validated inside the reserving transaction. */
  private inBound<T>(
    probe: StateProbe,
    native: NativeCallContext,
    kind: ToolClass,
    audit: CallAudit,
    body: (hooks: GuardHooks, registry: ManagerRegistry, store: SqliteStateStore) => T,
    held?: { release: () => void },
  ): T {
    const store = this.openWriter();
    const needsMigration = !store.schemaCurrent;
    if (kind !== "mutate" && probe.managerBinding === null) {
      // Handoff and takeover never migrate (review R09-03). They can still run against an
      // older schema as long as the ownership tables they compare-and-swap already exist;
      // when they do not, the caller must first perform an authorized mutation.
      throw new BridgeError(
        ErrorCode.WORKSPACE_MISMATCH,
        "this database predates manager ownership; an authorized mutation must migrate it first",
        { reason: "schema_migration_required", schema_version: probe.schemaVersion },
      );
    }
    const needsSection = held !== undefined || needsMigration || probe.recoveryNeeded || kind !== "mutate";
    const section = held ? undefined : needsSection ? WorktreeCriticalSection.acquire(this.workspace) : undefined;
    let released = false;
    const releaseOnce = (): void => {
      if (released) return;
      released = true;
      if (held) held.release();
      else section?.release();
    };

    try {
      const registry = this.cp.managers;
      let repairPending = probe.recoveryNeeded && probe.binding !== null;
      const repairNow = (session: AuthorizedSession | null): void => {
        if (!repairPending || !probe.binding) return;
        repairPending = false;
        void session;
        repairRecordsFromBinding(this.workspace, probe.binding);
      };
      const hooks: GuardHooks = {
        precheck: () => {
          registry.assertAuthorityPure(native, this.instanceId);
          // A legitimate replay is authorized here and nowhere else: it reserves nothing, so
          // the reservation guard never runs. A later denial inside the reservation revokes
          // this permission again (see `runMutationAsync`).
          this.noteAuthority(audit, registry.read() ?? null, native);
        },
        authorize: () => {
          if (kind !== "mutate") {
            // The real CAS lives in the handler; this class performs no write of its own and
            // must not repair or migrate before that CAS has succeeded.
            const current = registry.read() as ManagerBindingRecord;
            this.noteAuthority(audit, current, native);
            return { binding: current, native };
          }
          const session = { binding: registry.authorizeMutation(native, this.instanceId).binding, native };
          this.noteAuthority(audit, session.binding, native);
          // Migration is part of the guarded transaction, never a precondition of the guard.
          if (needsMigration) store.initializeSchema();
          return session;
        },
        afterOperation: (session) => {
          // Marker repair happens only after the operation (and, for H/T, after its CAS)
          // succeeded, inside the same transaction.
          repairNow(session);
        },
        settle: () => {
          // Asynchronous operations never reach `afterOperation`: their body returns at the
          // reservation boundary. Repair here, still holding the lock, after the reservation
          // has been authorized and committed (review R10-01). Repair touches only the marker
          // and owner files, so it creates no epoch, activation or event.
          if (repairPending) {
            try {
              this.cp.store.transaction(() => {
                registry.assertAuthorityPure(native, this.instanceId);
                repairNow(null);
              });
            } catch {
              // Authority changed between the reservation and this boundary: leave the
              // incomplete markers for the next authorized mutation rather than repairing
              // them on behalf of a session that no longer owns the worktree.
              repairPending = false;
            }
          }
          releaseOnce();
        },
        abort: releaseOnce,
      };

      const result = body(hooks, registry, store);
      if (result instanceof Promise) {
        return result.catch((error: unknown) => {
          releaseOnce();
          throw error;
        }) as unknown as T;
      }
      return result;
    } catch (error) {
      releaseOnce();
      throw error;
    }
  }

  /** Clean detach on shutdown, so an ordinary restart is adopted without a handoff. */
  detach(): void {
    try {
      const probe = probeWorkspaceState(this.workspace, this.databasePath);
      if (!probe.binding || (this.role === "codex" && probe.managerBinding?.active_instance_id !== this.instanceId)) {
        // This connection no longer owns the worktree — a takeover or another instance took it.
        // Its state, including the log directory, belongs to that manager now.
        this.logger?.revoke("this connection is no longer the active instance of the worktree");
        return;
      }
      if (probe.managerBinding?.active_instance_id !== this.instanceId) return;
      this.cp.activate("attach");
      this.cp.store.transaction(() => this.cp.managers.detach(this.instanceId, this.role));
      this.logger?.record({
        op: "manager",
        event: "instance.detached",
        outcome: "ok",
        phase: "shutdown",
        details: { epoch: probe.managerBinding.epoch, instance_generation: probe.managerBinding.instance_generation },
      });
    } catch (error) {
      /* detaching is an optimisation; a crash is handled by explicit handoff */
      this.logger?.record({
        op: "manager",
        event: "instance.detach_failed",
        outcome: "error",
        phase: "shutdown",
        code: (error as { code?: string }).code ?? null,
      });
    }
  }
}

/** Stable per-worktree id; the marker and binding carry it so copies are detectable. */
function workspaceIdFor(workspace: WorkspaceIdentity): string {
  return `ws_${createHash("sha256")
    .update(`${workspace.root} ${workspace.git_dir ?? ""}`)
    .digest("hex")
    .slice(0, 16)}`;
}
