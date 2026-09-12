/**
 * `@bridge/control-plane` — shared coordination state for the Claude <-> Codex bridge.
 *
 * The control plane is the sole owner of task state, ownership, leases, dependencies,
 * artifacts, and the event log. Agents interact with it; they never write state directly.
 */

export { ControlPlane } from "./control-plane.js";
export type { ControlPlaneOptions, ControlPlaneSnapshot, RecoveryReport } from "./control-plane.js";

export { SimpleAdapterRegistry } from "./adapter-registry.js";

export {
  TERMINATION_EVIDENCE_SCHEMA,
  TERMINATION_EVIDENCE_STDERR_MAX_BYTES,
  TerminationEvidenceStore,
} from "./evidence-store.js";
export type { RecordTerminationEvidenceInput, TerminationEvidenceRecord } from "./evidence-store.js";

export { MAX_DELEGATION_DEPTH, TaskService } from "./task-service.js";
export type {
  BeginRecoveryInput,
  CreateTaskInput,
  DependencyReport,
  TransitionInput,
} from "./task-service.js";

export { LeaseManager } from "./lease-manager.js";
export type { AcquireLeaseInput, LeaseConflict } from "./lease-manager.js";

export { ArtifactRegistry } from "./artifact-registry.js";
export type { ArtifactRegistryOptions, PublishArtifactInput } from "./artifact-registry.js";

export { DeliverableService } from "./deliverable-service.js";
export type { SubmitOptions } from "./deliverable-service.js";

export { AttemptService, normalizeAttemptTelemetry } from "./attempt-service.js";
export type { NormalizeAttemptTelemetryInput } from "./attempt-service.js";

export { Orchestrator } from "./orchestrator.js";
export type { DelegateOptions, RecoveryOptions } from "./orchestrator.js";

export { ManualClock, systemClock } from "./clock.js";
export type { Clock } from "./clock.js";

export { SqliteStateStore } from "./store/sqlite-store.js";
export type { JournalMode, SqliteStoreOptions, StoreOpenMode } from "./store/sqlite-store.js";
export type {
  EventAppend,
  EventQuery,
  AttemptTelemetryQuery,
  IdempotencyRecord,
  StateStore,
  TaskQuery,
} from "./store/state-store.js";

export { hashRequest, runIdempotent, stableStringify } from "./idempotency.js";
export type { IdempotentOptions } from "./idempotency.js";

export {
  resolveWorkspaceIdentity,
  resolveDatabasePath,
  stateDirectory,
  canonicalizeWithoutCreating,
} from "./workspace-identity.js";
export type { WorkspaceIdentity, WorkspaceKind } from "./workspace-identity.js";

export {
  MARKER_NAME,
  LOCK_NAME,
  WorktreeCriticalSection,
  assertProbeUsable,
  assertStateDirectoryExplained,
  buildMarker,
  buildOwner,
  completePublication,
  markerPath,
  newNonce,
  ownerPath,
  probeWorkspaceState,
  publishReservation,
  readMarker,
  readOwner,
  releaseOwnReservation,
  repairRecordsFromBinding,
} from "./workspace-state.js";
export type { MarkerRecord, OwnerRecord, StateProbe } from "./workspace-state.js";

export {
  ManagerRegistry,
  VERIFIED_ADAPTERS,
  TURN_METADATA_KEY,
  classifyNativeContext,
} from "./manager-registry.js";
export type { ManagerAuthority, NativeCallContext } from "./manager-registry.js";

export type {
  ManagerBindingRecord,
  ManagerEpochRecord,
  ManagerInstanceRecord,
  WorkspaceBindingRecord,
} from "./store/state-store.js";

export { FeatureWorkflow } from "./feature-workflow.js";
export type { FeatureRecord } from "./store/state-store.js";
