/** Narrow compatibility gate for pre-0.6.2 Claude delivery-schema failures. */
import { createHash } from "node:crypto";
import { AttemptTerminationKind, BridgeError, ErrorCode, EventType, TaskState, type Task, type TaskAttempt } from "@bridge/protocol";
import type { ControlPlane } from "./control-plane.js";

export function assertInvalidDeliveryFailure(cp: ControlPlane, task: Task, prior: TaskAttempt): void {
  const refuse = (message: string): never => {
    throw new BridgeError(ErrorCode.ILLEGAL_TRANSITION, message, { task_id: task.task_id, attempt: prior.attempt });
  };
  if (task.state !== TaskState.FAILED || task.owner !== "claude" || prior.agent !== "claude" ||
      prior.ended_at === undefined || prior.outcome !== ErrorCode.INVALID_ARGUMENT || cp.deliverables.get(task.task_id)) {
    refuse("only a settled Claude FAILED/INVALID_ARGUMENT with no accepted deliverable can recover its report");
  }
  const history = cp.events({ task_id: task.task_id, types: [EventType.TASK_STATE_CHANGED, EventType.ATTEMPT_ENDED], limit: 100_000 });
  let failureIndex = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]!.type === EventType.TASK_STATE_CHANGED) { failureIndex = i; break; }
  }
  const failure = history[failureIndex];
  if (!failure || failure.agent !== "claude" || failure.payload["to"] !== TaskState.FAILED ||
      typeof failure.payload["reason"] !== "string" ||
      !failure.payload["reason"].startsWith("INVALID_ARGUMENT: Deliverable failed validation:")) {
    refuse("durable failure is not a deliverable schema rejection");
  }
  if (!history.slice(0, failureIndex).some(e => e.type === EventType.ATTEMPT_ENDED &&
      e.agent === "claude" && e.payload["attempt"] === prior.attempt && e.payload["outcome"] === ErrorCode.INVALID_ARGUMENT)) {
    refuse("the matching attempt must have ended before its schema-rejection transition");
  }
  const telemetry = cp.attempts.queryTelemetry({ task_id: task.task_id, attempt: prior.attempt, limit: 1 })[0];
  if (!telemetry || telemetry.agent !== "claude" || telemetry.termination_kind !== AttemptTerminationKind.COMPLETED ||
      telemetry.process_exit_code !== 0) {
    refuse("completed runtime telemetry with exit code 0 is required; an error code alone is insufficient");
  }
  const reports = cp.artifacts.list(task.task_id).filter(a => a.kind === "report" && a.produced_by === "claude" &&
    a.created_at >= prior.started_at && a.created_at <= prior.ended_at! &&
    a.metadata?.["source"] === "claude-final-output");
  const total = reports[0]?.metadata?.["total_chunks"];
  const digest = reports[0]?.metadata?.["complete_report_sha256"];
  if (!reports.length || !Number.isInteger(total) || reports.length !== total ||
      typeof digest !== "string" || !/^[0-9a-f]{64}$/u.test(digest)) {
    refuse("a complete preserved final report from this attempt is required");
  }
  reports.sort((a, b) => Number(a.metadata?.["sequence"]) - Number(b.metadata?.["sequence"]));
  const text: string[] = [];
  for (const [index, artifact] of reports.entries()) {
    if (artifact.metadata?.["sequence"] !== index + 1 || artifact.metadata?.["total_chunks"] !== total ||
        artifact.metadata?.["complete_report_sha256"] !== digest || !cp.artifacts.verifyIntegrity(artifact.artifact_id).intact) {
      refuse("preserved report chunks are incomplete, inconsistent or corrupted");
    }
    text.push(cp.artifacts.read(artifact.artifact_id));
  }
  if (createHash("sha256").update(text.join(""), "utf8").digest("hex") !== digest) {
    refuse("preserved report does not match its complete digest");
  }
}
