/**
 * Storage abstraction.
 *
 * The control plane talks only to this interface, so SQLite can be swapped for another
 * backend (Postgres for multi-machine operation, for example) without touching lifecycle,
 * lease, or dependency logic. Per D-001 the storage layer stays replaceable.
 *
 * Implementations MUST provide:
 *  - serialisable transactions (`transaction` runs its body atomically);
 *  - an append-only event log written in the SAME transaction as the state change it
 *    describes, so the log can never disagree with the state;
 *  - monotonically increasing `event_id`.
 */

import type {
  AgentId,
  Artifact,
  ArtifactId,
  AttemptTelemetry,
  BridgeEvent,
  Deliverable,
  EventType,
  Lease,
  LeaseId,
  StatusUpdate,
  Task,
  TaskAttempt,
  TaskId,
  TaskState,
  VerificationResult,
} from "@bridge/protocol";

export interface EventAppend {
  readonly type: EventType;
  readonly task_id: TaskId | null;
  readonly agent: AgentId;
  readonly payload: Record<string, unknown>;
  readonly idempotency_key?: string;
}

export interface TaskQuery {
  readonly state?: TaskState | readonly TaskState[];
  readonly owner?: AgentId | null;
  readonly tag?: string;
  readonly limit?: number;
}

export interface EventQuery {
  /** Return events with `event_id` strictly greater than this. */
  readonly after?: number;
  readonly task_id?: TaskId;
  readonly types?: readonly EventType[];
  readonly limit?: number;
}

export interface AttemptTelemetryQuery {
  readonly run_id?: string;
  readonly task_id?: TaskId;
  readonly agent?: AgentId;
  readonly attempt?: number;
  readonly limit?: number;
}

/** Cached result of a previously-applied idempotent operation. */
export interface IdempotencyRecord {
  readonly key: string;
  readonly operation: string;
  /** Hash of the request payload, to detect a key reused with different arguments. */
  readonly request_hash: string;
  readonly response_json: string;
  readonly created_at: number;
}

/**
 * All methods are synchronous: SQLite is synchronous, and keeping the store sync means
 * `transaction` can guarantee atomicity without await points that could interleave.
 */
export interface FeatureRecord {
  feature_id: string;
  manager: AgentId;
  parent_task_id: string;
  latest_task_id: string | null;
  active_task_id: string | null;
  task_ids: string[];
  state: "ready" | "running" | "awaiting_review" | "waiting_user" | "blocked" | "accepted";
  question: { id: string; text: string; answer: string | null } | null;
  updated_at: number;
  /** Worktree that owns this feature (contract §11); absent on pre-isolation records. */
  workspace_id?: string | null;
  /** Manager epoch that created or last adopted the feature. */
  manager_epoch?: number | null;
  /** One entry per launched round, attributing it to the manager that launched it. */
  round_launches?: Array<{
    task_id: string;
    native_thread_id: string;
    epoch: number;
    launched_at: number;
  }>;
}

/** Record A/B/C identity of the worktree that owns this database (contract §4.1). */
export interface WorkspaceBindingRecord {
  readonly workspace_id: string;
  readonly kind: string;
  readonly root: string;
  readonly git_dir: string | null;
  readonly git_common_dir: string | null;
  readonly database_path: string;
  readonly reservation_nonce: string;
  readonly bound_at: number;
  readonly legacy_adopted: number;
  readonly adoption_json: string | null;
}

/** Current manager ownership of the worktree (contract §7). */
export interface ManagerBindingRecord {
  readonly epoch: number;
  readonly native_thread_id: string;
  readonly active_instance_id: string | null;
  readonly instance_generation: number;
  readonly active_feature_id: string | null;
  readonly updated_at: number;
}

/** Append-only ownership history; one row per epoch. */
export interface ManagerEpochRecord {
  readonly epoch: number;
  readonly native_thread_id: string;
  readonly workspace_id: string | null;
  readonly role: AgentId;
  readonly adapter_id: string;
  readonly native_corroboration: string;
  readonly codex_version: string;
  readonly thread_source: string | null;
  readonly bound_at: number;
  readonly bound_by_kind: string;
  readonly ended_at: number | null;
  readonly end_kind: string | null;
  readonly takeover_reason: string | null;
  readonly predecessor_epoch: number | null;
}

/** Append-only activation history: one row per activation, not per instance. */
export interface ManagerInstanceRecord {
  readonly epoch: number;
  readonly instance_generation: number;
  readonly instance_id: string;
  readonly activated_at: number;
  readonly activated_by_kind: string;
  readonly ended_at: number | null;
  readonly end_kind: string | null;
}

export interface StateStore {
  /* ---- workspace + manager identity (optional: only the SQLite store implements it) ---- */
  getWorkspaceBinding?(): WorkspaceBindingRecord | undefined;
  putWorkspaceBinding?(record: WorkspaceBindingRecord): void;
  getManagerBinding?(): ManagerBindingRecord | undefined;
  putManagerBinding?(record: ManagerBindingRecord): void;
  insertManagerEpoch?(record: ManagerEpochRecord): void;
  updateManagerEpoch?(record: ManagerEpochRecord): void;
  listManagerEpochs?(limit?: number): ManagerEpochRecord[];
  insertManagerInstance?(record: ManagerInstanceRecord): void;
  endManagerInstance?(epoch: number, generation: number, ended_at: number, end_kind: string): void;
  instanceSeenInEpoch?(epoch: number, instance_id: string): boolean;
  listManagerInstances?(epoch: number): ManagerInstanceRecord[];
  /** Total rows across domain tables; 0 means a database with no history. */
  countDomainRows?(): number;
  schemaVersion?(): number;

  getFeature(id: string): FeatureRecord | undefined;
  putFeature(record: FeatureRecord): void;
  listFeatures(): FeatureRecord[];
  /** Runs `fn` inside an immediate write transaction. Rolls back on throw. */
  transaction<T>(fn: () => T): T;

  // ---- tasks ----
  insertTask(task: Task): void;
  getTask(id: TaskId): Task | undefined;
  updateTask(task: Task): void;
  listTasks(query?: TaskQuery): Task[];

  // ---- dependencies (edge table; `spec.dependencies` is the projection) ----
  addDependency(task_id: TaskId, depends_on: TaskId): void;
  getDependencies(task_id: TaskId): TaskId[];
  getDependents(task_id: TaskId): TaskId[];

  // ---- attempts (resumable execution handles) ----
  upsertAttempt(attempt: TaskAttempt): void;
  getAttempt(task_id: TaskId, attempt: number): TaskAttempt | undefined;
  listAttempts(task_id: TaskId): TaskAttempt[];

  // ---- final normalized attempt telemetry ----
  insertAttemptTelemetry(telemetry: AttemptTelemetry): void;
  listAttemptTelemetry(query?: AttemptTelemetryQuery): AttemptTelemetry[];

  // ---- leases ----
  insertLease(lease: Lease): void;
  getLease(id: LeaseId): Lease | undefined;
  updateLease(lease: Lease): void;
  /** Every lease still in HELD state, regardless of wall-clock expiry. */
  listHeldLeases(): Lease[];

  // ---- artifacts ----
  insertArtifact(artifact: Artifact): void;
  getArtifact(id: ArtifactId): Artifact | undefined;
  listArtifacts(task_id: TaskId): Artifact[];

  // ---- status / deliverables / verification ----
  insertStatus(update: StatusUpdate): void;
  latestStatus(task_id: TaskId): StatusUpdate | undefined;
  insertDeliverable(deliverable: Deliverable): void;
  getDeliverable(task_id: TaskId): Deliverable | undefined;
  insertVerification(task_id: TaskId, result: VerificationResult): void;
  listVerifications(task_id: TaskId): VerificationResult[];

  // ---- event log ----
  appendEvent(event: EventAppend, at: number): BridgeEvent;
  readEvents(query?: EventQuery): BridgeEvent[];
  lastEventId(): number;

  // ---- idempotency ----
  getIdempotency(key: string): IdempotencyRecord | undefined;
  putIdempotency(record: IdempotencyRecord): void;

  close(): void;
}
