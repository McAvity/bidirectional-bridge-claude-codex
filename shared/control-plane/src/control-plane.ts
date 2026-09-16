import { dirname, join, resolve } from "node:path";
import { TerminationEvidenceStore } from "./evidence-store.js";
/**
 * The control plane facade.
 *
 * One object wiring together the store, clock, task lifecycle, leases, artifacts and
 * deliverables. Adapters and the MCP server talk to this and nothing below it, which is
 * what keeps D-003 ("the control plane is the only writer of state") enforceable rather
 * than aspirational.
 *
 * When a workspace identity is supplied the plane opens **lazily** (`ControlPlane.deferred`):
 * process start and reads must not create or migrate a database, so the store is opened
 * read-only for reads and read-write only on an authorized ownership path (contract §4.2–§4.4).
 */

import {
  BridgeError,
  ErrorCode,
  type AdapterRegistry,
  type BridgeEvent,
  type RandomSource,
} from "@bridge/protocol";
import { SimpleAdapterRegistry } from "./adapter-registry.js";
import type { DiagnosticsLogger } from "./diagnostics-log.js";
import { ArtifactRegistry } from "./artifact-registry.js";
import { AttemptService } from "./attempt-service.js";
import { type Clock, systemClock } from "./clock.js";
import { DeliverableService } from "./deliverable-service.js";
import { LeaseManager } from "./lease-manager.js";
import { ManagerRegistry } from "./manager-registry.js";
import { SqliteStateStore, type JournalMode, type StoreOpenMode } from "./store/sqlite-store.js";
import type { EventQuery, StateStore } from "./store/state-store.js";
import { TaskService } from "./task-service.js";
import type { WorkspaceIdentity } from "./workspace-identity.js";

export interface ControlPlaneOptions {
  /** Absolute path to the repository the agents operate on. */
  readonly workspaceRoot: string;
  /** Database file path, or `:memory:`. Defaults to `<workspaceRoot>/.bridge/bridge.db`. */
  readonly databasePath?: string;
  readonly journalMode?: JournalMode;
  readonly clock?: Clock;
  /** Test-only deterministic id source. */
  readonly rng?: RandomSource;
  /** Inject a different backend; bypasses SQLite entirely. */
  readonly store?: StateStore;
  readonly inlineArtifactLimitBytes?: number;
  readonly onWarning?: (message: string, details?: Record<string, unknown>) => void;
  /**
   * Local diagnostics log of this process (wave13 §1). The control plane only *observes* into
   * it — attempt lifecycle and evidence-write facts — and never decides state from it.
   */
  readonly logger?: DiagnosticsLogger;
  /** Canonical worktree identity; enables the isolation protocol and lazy opening. */
  readonly workspace?: WorkspaceIdentity;
  /** null disables evidence files; otherwise defaults beside the database. */
  readonly evidenceDir?: string | null;
}

interface Services {
  readonly store: StateStore;
  readonly tasks: TaskService;
  readonly leases: LeaseManager;
  readonly artifacts: ArtifactRegistry;
  readonly deliverables: DeliverableService;
  readonly attempts: AttemptService;
  readonly managers: ManagerRegistry;
  readonly evidence: TerminationEvidenceStore;
}

export class ControlPlane {
  readonly clock: Clock;
  readonly adapters: AdapterRegistry;
  readonly workspaceRoot: string;
  readonly workspace: WorkspaceIdentity | undefined;
  readonly databasePath: string;
  /** Diagnostics observation sink; absent for embedders and unit tests. */
  readonly logger: DiagnosticsLogger | undefined;

  private services: Services | undefined;
  private openMode: StoreOpenMode | undefined;
  /** Read-only projection, independent of the writer so reads never disturb a running round. */
  private readServices: Services | undefined;

  private constructor(
    private readonly options: ControlPlaneOptions,
    store: StateStore | undefined,
  ) {
    this.workspaceRoot = options.workspace?.root ?? options.workspaceRoot;
    this.workspace = options.workspace;
    this.databasePath = options.databasePath ?? `${this.workspaceRoot}/.bridge/bridge.db`;
    this.logger = options.logger;
    this.clock = options.clock ?? systemClock;
    this.adapters = new SimpleAdapterRegistry();
    if (store) this.attach(store, "initialize");
  }

  private attach(store: StateStore, mode: StoreOpenMode): void {
    this.services = this.buildServices(store);
    this.openMode = mode;
  }

  private buildServices(store: StateStore): Services {
    const tasks = new TaskService(store, this.clock, this.options.rng);
    return {
      store,
      tasks,
      leases: new LeaseManager(store, this.clock, this.options.rng),
      artifacts: new ArtifactRegistry(
        store,
        this.clock,
        {
          workspaceRoot: this.workspaceRoot,
          ...(this.options.inlineArtifactLimitBytes !== undefined
            ? { inlineLimitBytes: this.options.inlineArtifactLimitBytes }
            : {}),
        },
        this.options.rng,
      ),
      deliverables: new DeliverableService(store, this.clock, tasks),
      attempts: new AttemptService(store, this.clock),
      managers: new ManagerRegistry(store, this.clock),
      evidence: new TerminationEvidenceStore(store, this.clock,
        this.options.evidenceDir !== undefined ? this.options.evidenceDir
          : this.options.store !== undefined || this.databasePath === ":memory:"
            ? null : join(dirname(resolve(this.databasePath)), "evidence")),
    };
  }

  /** Services for reads: the writer when a round holds it, otherwise the read projection. */
  private get readable(): Services {
    if (this.services) return this.services;
    if (this.readServices) return this.readServices;
    throw new BridgeError(ErrorCode.INTERNAL, "control plane has no open connection");
  }

  private get active(): Services {
    if (!this.services) {
      if (this.readServices) return this.readServices;
      throw new BridgeError(
        ErrorCode.INTERNAL,
        "control plane is not open; reads must call activate('readonly') and mutations the authorized path",
      );
    }
    return this.services;
  }

  get store(): StateStore {
    return this.active.store;
  }
  get tasks(): TaskService {
    return this.active.tasks;
  }
  get leases(): LeaseManager {
    return this.active.leases;
  }
  get artifacts(): ArtifactRegistry {
    return this.active.artifacts;
  }
  get deliverables(): DeliverableService {
    return this.active.deliverables;
  }
  get attempts(): AttemptService {
    return this.active.attempts;
  }
  get evidence(): TerminationEvidenceStore {
    return this.active.evidence;
  }
  get managers(): ManagerRegistry {
    return this.active.managers;
  }
  get isOpen(): boolean {
    return this.services !== undefined;
  }
  get mode(): StoreOpenMode | undefined {
    return this.openMode;
  }

  static open(options: ControlPlaneOptions): ControlPlane {
    const plane = new ControlPlane(options, options.store);
    if (!options.store) plane.activate("initialize");
    return plane;
  }

  /** Create a plane that has opened nothing yet (contract §4.2). */
  static deferred(options: ControlPlaneOptions): ControlPlane {
    return new ControlPlane(options, undefined);
  }

  /**
   * Open the store in the requested mode, reopening when the mode must be upgraded.
   * `readonly` never creates the file; `attach` opens read-write without DDL, migration,
   * `schema_meta` or journal changes; `initialize` is the only mutating opener.
   */
  activate(mode: StoreOpenMode): void {
    if (mode === "readonly") {
      // A read must never close or replace a live writer: an adapter callback of a running
      // round would lose its connection mid-flight (review R08-03).
      if (this.services) return;
      if (this.readServices) return;
      this.readServices = this.buildServices(new SqliteStateStore({ path: this.databasePath, mode }));
      return;
    }
    if (this.services && this.openMode === mode) return;
    if (this.services && this.options.store) return; // injected store: nothing to reopen
    this.closeStore();
    const store = new SqliteStateStore({
      path: this.databasePath,
      journalMode: this.options.journalMode ?? "auto",
      mode,
      onJournalFallback: (requested, actual, reason) =>
        this.options.onWarning?.(
          `SQLite journal mode fell back from ${requested} to ${actual}: ${reason}. ` +
            `Concurrent reads during writes will block; move the database to a local disk to restore WAL.`,
          { requested, actual },
        ),
    });
    this.attach(store, mode);
  }

  private closeStore(): void {
    if (this.services && !this.options.store) this.services.store.close();
    this.services = undefined;
    this.openMode = undefined;
  }

  private closeRead(): void {
    this.readServices?.store.close();
    this.readServices = undefined;
  }

  /* ---------------- supervisor-facing reads ---------------- */

  /** Tail the event log. An external supervisor polls with the last id it saw. */
  events(query?: EventQuery): BridgeEvent[] {
    return this.store.readEvents(query);
  }

  lastEventId(): number {
    return this.store.lastEventId();
  }

  /** One-shot picture of the system, for a supervisor or a `bridge status` command. */
  snapshot(): ControlPlaneSnapshot {
    const tasks = this.store.listTasks();
    const live = this.leases.listLive();
    const byState: Record<string, number> = {};
    for (const t of tasks) byState[t.state] = (byState[t.state] ?? 0) + 1;
    return {
      at: this.clock.now(),
      task_count: tasks.length,
      tasks_by_state: byState,
      ready_task_ids: this.tasks.readyTasks().map((t) => t.task_id),
      live_leases: live.map((l) => ({
        lease_id: l.lease_id,
        holder: l.holder,
        task_id: l.task_id,
        paths: l.scope.paths,
        expires_at: l.expires_at,
      })),
      last_event_id: this.store.lastEventId(),
      adapters: this.adapters.list().map((a) => ({
        agent: a.info.agent,
        implementation: a.info.implementation,
        capabilities: a.info.capabilities,
      })),
    };
  }

  /**
   * Crash recovery. Marks leases whose holder went away as EXPIRED so their scopes become
   * acquirable, and reports tasks stuck mid-flight for an operator or supervisor to decide on.
   * Deliberately does not auto-fail or auto-retry: guessing at recovery is how a bridge
   * silently discards another agent's work.
   */
  recover(): RecoveryReport {
    const expired = this.leases.reapExpired();
    return { ...this.inspectRecovery(), expired_leases: expired.map((l) => l.lease_id) };
  }

  /**
   * Pure counterpart of `recover()` (contract §4.2/§6.1): reports the same picture without
   * expiring anything, so process start and Class R reads never write.
   */
  inspectRecovery(): RecoveryReport {
    const now = this.clock.now();
    const live = this.leases.listLive();
    const stuck = this.store
      .listTasks({ state: ["WORKING", "VERIFYING", "CLAIMED"] })
      .map((t) => ({
        task_id: t.task_id,
        owner: t.owner,
        state: t.state,
        stale_ms: now - t.updated_at,
        has_live_lease: live.some((l) => l.task_id === t.task_id),
      }));
    const expirable = this.store
      .listHeldLeases()
      .filter((l) => !this.leases.isLive(l, now))
      .map((l) => l.lease_id);
    return { expired_leases: [], expirable_leases: expirable, in_flight_tasks: stuck, at: now };
  }

  close(): void {
    this.closeRead();
    this.closeStore();
  }
}

export interface ControlPlaneSnapshot {
  readonly at: number;
  readonly task_count: number;
  readonly tasks_by_state: Record<string, number>;
  readonly ready_task_ids: readonly string[];
  readonly live_leases: ReadonlyArray<{
    lease_id: string;
    holder: string;
    task_id: string;
    paths: readonly string[];
    expires_at: number;
  }>;
  readonly last_event_id: number;
  readonly adapters: ReadonlyArray<{
    agent: string;
    implementation: string;
    capabilities: readonly string[];
  }>;
}

export interface RecoveryReport {
  readonly expired_leases: readonly string[];
  /** Leases already dead by wall clock; reaping them is bookkeeping, done under a guard. */
  readonly expirable_leases?: readonly string[];
  readonly in_flight_tasks: ReadonlyArray<{
    task_id: string;
    owner: string | null;
    state: string;
    stale_ms: number;
    has_live_lease: boolean;
  }>;
  readonly at: number;
}
