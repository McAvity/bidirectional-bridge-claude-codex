import { BridgeError, ErrorCode, EventType, TaskState, type TaskSpec } from "@bridge/protocol";
import type { ControlPlane } from "./control-plane.js";
import type { Orchestrator } from "./orchestrator.js";
import type { FeatureRecord } from "./store/state-store.js";
import { hashRequest } from "./idempotency.js";

interface RoundRequest {
  feature_id: string;
  manager: string;
  idempotency_key: string;
  spec: TaskSpec;
  input_artifacts: readonly string[];
  deadline_ms: number;
}
class RoundReplay extends Error {}

/** Durable routing state; only explicit run/resume operations invoke a worker. */
export class FeatureWorkflow {
  constructor(private readonly cp: ControlPlane, private readonly orchestrator: Orchestrator) {}

  private fail(message: string): never {
    throw new BridgeError(ErrorCode.INVALID_ARGUMENT, message);
  }

  private owned(id: string, manager: string): FeatureRecord {
    const f = this.cp.store.getFeature(id);
    if (!f) throw new BridgeError(ErrorCode.NOT_FOUND, "feature not found");
    if (f.manager !== manager) this.fail("feature belongs to another manager");
    return f;
  }

  private save(f: FeatureRecord): FeatureRecord {
    f.updated_at = this.cp.clock.now();
    this.cp.store.putFeature(f);
    this.cp.store.appendEvent({ type: EventType.FEATURE_UPDATED, task_id: f.parent_task_id,
      agent: f.manager, payload: { feature_id: f.feature_id, state: f.state,
        latest_task_id: f.latest_task_id, active_task_id: f.active_task_id,
        predecessor_task_id: f.task_ids.at(-2) ?? null } }, f.updated_at);
    return f;
  }

  /** Do not infer process termination from expired leases. An ended attempt is required. */
  private refresh(f: FeatureRecord): FeatureRecord {
    if (!f.latest_task_id || f.state === "waiting_user" || f.state === "accepted") return f;
    const task = this.cp.tasks.get(f.latest_task_id);
    const attempt = this.cp.attempts.list(task.task_id).at(-1);
    const held = this.cp.store.listHeldLeases().some(l => l.task_id === task.task_id);
    if (!attempt || attempt.ended_at == null || held) {
      // Recovery attempts start outside run(); report them as running until they end.
      if (attempt && f.state === "blocked") {
        f.state = "running";
        f.active_task_id = task.task_id;
        return this.save(f);
      }
      return f;
    }
    const state = task.state === TaskState.DONE ? "awaiting_review" : "blocked";
    if (f.state !== state || f.active_task_id !== null) {
      f.state = state;
      f.active_task_id = null;
      return this.save(f);
    }
    return f;
  }

  get(id: string, manager: string): FeatureRecord {
    return this.cp.store.transaction(() => this.refresh(this.owned(id, manager)));
  }

  create(id: string, manager: string, parent_task_id: string): FeatureRecord {
    return this.cp.store.transaction(() => {
      if (!id.trim() || id.length > 200 || manager !== "codex") this.fail("feature requires a Codex manager and a nonempty id (max 200)");
      const existing = this.cp.store.getFeature(id);
      if (existing) {
        if (existing.manager !== manager || existing.parent_task_id !== parent_task_id)
          throw new BridgeError(ErrorCode.IDEMPOTENCY_MISMATCH, "feature id already has another owner or parent");
        return this.refresh(existing);
      }
      const parent = this.cp.tasks.get(parent_task_id);
      if (parent.owner !== manager) this.fail("manager must own the parent task");
      this.cp.tasks.assertDelegationTargetNotInAncestors(parent_task_id, "claude");
      return this.save({ feature_id: id, manager, parent_task_id, latest_task_id: null,
        active_task_id: null, task_ids: [], state: "ready", question: null, updated_at: 0 });
    });
  }

  private replay(key: string, requestHash: string): string | null {
    const saved = this.cp.store.getIdempotency(key);
    if (!saved) return null;
    if (saved.operation !== "feature.round" || saved.request_hash !== requestHash)
      throw new BridgeError(ErrorCode.IDEMPOTENCY_MISMATCH, "round key reused with different arguments");
    return JSON.parse(saved.response_json) as string;
  }

  private result(id: string, manager: string, task_id: string, replayed: boolean) {
    return { feature: this.get(id, manager), task: this.cp.tasks.get(task_id),
      deliverable: this.cp.store.getDeliverable(task_id) ?? null, replayed };
  }

  async run(request: RoundRequest) {
    const { feature_id, manager, idempotency_key } = request;
    if (!idempotency_key.trim()) this.fail("round requires an idempotency key");
    const key = `feature.round:${JSON.stringify([feature_id, idempotency_key])}`;
    const requestHash = hashRequest(request);
    const feature = this.get(feature_id, manager);
    const replay = this.replay(key, requestHash);
    if (replay) return this.result(feature_id, manager, replay, true);
    if (feature.active_task_id || !["ready", "awaiting_review"].includes(feature.state))
      this.fail("feature cannot start a round: resolve waiting_user or resume its BLOCKED task first");
    const predecessor = feature.latest_task_id;
    if (predecessor) {
      if (this.cp.tasks.get(predecessor).state !== TaskState.DONE) this.fail("previous round must be DONE");
      if (!this.cp.attempts.list(predecessor).at(-1)?.execution_handle) this.fail("previous round has no persisted session");
      if (!this.cp.adapters.get("claude")?.info.capabilities.includes("resume")) this.fail("Claude adapter cannot resume");
    }
    try {
      // User questions and answers are the manager's channel. A round receives only the
      // contract the manager explicitly writes; nothing recorded for the user is appended.
      const outcome = await this.orchestrator.delegate({ from: manager, to: "claude", spec: request.spec,
        parent_task_id: feature.parent_task_id, input_artifacts: request.input_artifacts,
        deadline_ms: request.deadline_ms, max_attempts: 0 }, {
        ...(predecessor ? { resumeFromTaskId: predecessor } : {}),
        onTaskCreated: task => {
          if (this.replay(key, requestHash)) throw new RoundReplay();
          const current = this.refresh(this.owned(feature_id, manager));
          if (current.active_task_id || current.latest_task_id !== predecessor ||
              current.state !== feature.state || hashRequest(current.question) !== hashRequest(feature.question))
            this.fail("feature changed while reserving this round; read its state and retry");
          if (!this.cp.tasks.checkDependencies(task.task_id).satisfied) this.fail("round dependencies are not DONE");
          if (this.cp.leases.findConflicts(task.spec.scope, "claude").length)
            throw new BridgeError(ErrorCode.SCOPE_CONFLICT, "round scope conflicts with a live lease");
          this.cp.artifacts.resolveMany(request.input_artifacts);
          current.latest_task_id = task.task_id;
          current.active_task_id = task.task_id;
          current.task_ids.push(task.task_id);
          current.state = "running";
          this.save(current);
          this.cp.store.putIdempotency({ key, operation: "feature.round", request_hash: requestHash,
            response_json: JSON.stringify(task.task_id), created_at: this.cp.clock.now() });
        },
      });
      return { ...this.result(feature_id, manager, outcome.task_id, false), error: outcome.error };
    } catch (error) {
      if (error instanceof RoundReplay) return this.result(feature_id, manager, this.replay(key, requestHash)!, true);
      throw error;
    }
  }

  waitUser(id: string, manager: string, question_id: string, text: string): FeatureRecord {
    return this.cp.store.transaction(() => {
      const f = this.refresh(this.owned(id, manager));
      if (!question_id.trim() || !text.trim() || text.length > 8000) this.fail("question id and text required (max 8000)");
      const questionKey = `feature.question:${JSON.stringify([id, question_id])}`;
      const questionHash = hashRequest({ id, manager, question_id, text });
      const previous = this.cp.store.getIdempotency(questionKey);
      if (previous) {
        if (previous.operation !== "feature.question" || previous.request_hash !== questionHash)
          throw new BridgeError(ErrorCode.IDEMPOTENCY_MISMATCH, "question id reused with different text");
        return f;
      }
      if (f.question?.id === question_id) {
        if (f.question.text !== text) throw new BridgeError(ErrorCode.IDEMPOTENCY_MISMATCH, "question id reused with different text");
        return f;
      }
      if (f.active_task_id || !["ready", "awaiting_review", "blocked"].includes(f.state)) this.fail("feature is not ready for a user question");
      // A recovery may have started since the last feature read.
      if (f.latest_task_id && this.cp.attempts.list(f.latest_task_id).at(-1)?.ended_at == null) this.fail("worker is still running");
      if (f.latest_task_id && this.cp.store.listHeldLeases().some(l => l.task_id === f.latest_task_id)) this.fail("worker lease has not been released");
      this.cp.store.putIdempotency({ key: questionKey, operation: "feature.question", request_hash: questionHash,
        response_json: "null", created_at: this.cp.clock.now() });
      f.question = { id: question_id, text, answer: null };
      f.state = "waiting_user";
      return this.save(f);
    });
  }

  answerUser(id: string, manager: string, question_id: string, answer: string): FeatureRecord {
    return this.cp.store.transaction(() => {
      const f = this.owned(id, manager);
      if (!answer.trim() || answer.length > 8000) this.fail("answer required (max 8000)");
      if (f.question?.id !== question_id) this.fail("answer refers to a stale or missing question");
      if (f.question.answer !== null) {
        if (f.question.answer !== answer) throw new BridgeError(ErrorCode.IDEMPOTENCY_MISMATCH, "question already has a different answer");
        return f;
      }
      if (f.state !== "waiting_user") this.fail("feature is not waiting for the user");
      f.question.answer = answer;
      f.state = f.latest_task_id ? (this.cp.tasks.get(f.latest_task_id).state === TaskState.DONE ? "awaiting_review" : "blocked") : "ready";
      return this.save(f);
    });
  }

  accept(id: string, manager: string): FeatureRecord {
    return this.cp.store.transaction(() => {
      const f = this.refresh(this.owned(id, manager));
      if (f.state === "accepted") return f;
      if (f.state !== "awaiting_review" || f.active_task_id) this.fail("accept requires a completed round and manager review");
      f.state = "accepted";
      return this.save(f);
    });
  }
}
