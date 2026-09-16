/**
 * W15-03: what "kontynuuj" may and may not do after an interruption.
 *
 * Every case below runs against the real control plane, the real orchestrator and the real
 * feature workflow on a real SQLite file. Only the agent runtime is a fixture adapter, so the
 * reservations, idempotency records, attempts, leases and events are the product's own. Closing
 * and reopening the store is how a manager restart is expressed: the in-process caches go, the
 * durable state stays, which is exactly the situation a resumed session is in.
 *
 * Each case asserts what a duplicate would disturb — task count, attempt count, worker launches,
 * identity, the key, the contract that reached the worker, the event history and the budget —
 * rather than only that a call returned.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AdapterHealth,
  DeliverableStatus,
  EventType,
  TaskState,
  type AgentAdapter,
  type TaskInvocation,
  type TaskSpec,
} from "@bridge/protocol";
import { ControlPlane } from "./control-plane.js";
import { Orchestrator } from "./orchestrator.js";
import { FeatureWorkflow } from "./feature-workflow.js";

const spec: TaskSpec = {
  objective: "round 1 of F-W15",
  scope: { paths: ["feature/**"] },
  dependencies: [],
  expected_deliverable: "package",
  verification_criteria: ["npm test"],
  max_turns: 32,
};

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const undo of cleanup.splice(0).reverse()) undo();
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "w15-continue-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const seen: TaskInvocation[] = [];
  const behavior = {
    gate: undefined as Promise<void> | undefined,
    handle: "session-original" as string | null,
    partial: false,
  };
  const adapter: AgentAdapter = {
    info: { agent: "claude", implementation: "fixture", version: "1", capabilities: ["resume"], max_concurrency: 1 },
    async health() {
      return { status: AdapterHealth.READY, checked_at: Date.now() };
    },
    async cancel() {},
    async invoke(invocation, ctx) {
      seen.push(invocation);
      if (behavior.handle) await ctx.saveExecutionHandle(behavior.handle);
      if (behavior.gate) await behavior.gate;
      const check = { kind: "test" as const, command: "npm test", passed: true, exit_code: 0, summary: "pass" };
      return {
        task_id: invocation.task_id,
        agent: "claude",
        status: behavior.partial ? DeliverableStatus.PARTIAL : DeliverableStatus.COMPLETE,
        summary: "package",
        changed_scope: [],
        artifacts: [],
        commit_or_diff: null,
        verification_performed: [check.command],
        verification_results: [check],
        remaining_risks: behavior.partial ? ["needs a user decision"] : [],
        dependencies_unblocked: [],
        recommended_next_action: "review",
        at: Date.now(),
      };
    },
  };

  /** A manager restart: a new connection to the same durable state, no in-process memory. */
  function open() {
    const cp = ControlPlane.open({ databasePath: join(dir, "bridge.db"), workspaceRoot: dir });
    cp.adapters.register(adapter);
    cleanup.push(() => cp.close());
    const orchestrator = new Orchestrator(cp);
    return { cp, orchestrator, flow: new FeatureWorkflow(cp, orchestrator) };
  }

  const env = open();
  const parent = env.cp.tasks.create({
    spec: { ...spec, objective: "Coordinate F-W15", scope: { paths: ["manager/**"] } },
    created_by: "codex",
    idempotency_key: "F-W15:root",
  });
  env.cp.tasks.claim(parent.task_id, "codex");
  env.flow.create("feature", "codex", parent.task_id);

  /** Exactly what a manager persists before sending: the key and the arguments, unchanged. */
  const intent = {
    op: "round" as const,
    key: "F-W15:round-1",
    request: { feature_id: "feature", manager: "codex", spec, input_artifacts: [] as string[], deadline_ms: 5000 },
  };
  const request = { ...intent.request, idempotency_key: intent.key };

  const counts = (cp = env.cp) => ({
    tasks: cp.tasks.list({}).length,
    launches: seen.length,
  });

  return { ...env, dir, open, seen, behavior, parent, intent, request, counts };
}

const settle = () => new Promise((done) => setTimeout(done, 20));

describe("continuing after an interruption", () => {
  it("sends once when the interruption came before the call (nothing reserved)", async () => {
    const f = fixture();
    // The intent file exists; the call never left. The bridge is the authority on that.
    const before = f.open().flow.get("feature", "codex");
    expect(before.task_ids).toEqual([]);
    expect(before.state).toBe("ready");
    expect(f.counts()).toEqual({ tasks: 1, launches: 0 });

    const sent = await f.open().flow.run(f.request);
    expect(sent.replayed).toBe(false);
    expect(f.counts()).toEqual({ tasks: 2, launches: 1 });
    expect(f.seen[0]?.spec.objective).toBe(spec.objective);
    expect(f.seen[0]?.spec.max_turns).toBe(32);
    expect(f.flow.get("feature", "codex").task_ids).toEqual([sent.task.task_id]);
  });

  it("replays the accepted round when the response was lost, without a second worker", async () => {
    const f = fixture();
    let release!: () => void;
    f.behavior.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inFlight = f.flow.run(f.request);
    try {
      await settle();
      // The manager's response is gone; its state is not. A restart reads the reservation.
      const resumed = f.open();
      const during = resumed.flow.get("feature", "codex");
      expect(during.state).toBe("running");
      expect(during.active_task_id).not.toBeNull();
      expect(during.task_ids).toHaveLength(1);
      const reserved = during.active_task_id!;

      // The only admissible reaction: the identical key with the identical arguments.
      const replayed = await resumed.flow.run(f.request);
      expect(replayed.replayed).toBe(true);
      expect(replayed.task.task_id).toBe(reserved);
      expect(f.counts(resumed.cp)).toEqual({ tasks: 2, launches: 1 });

      // A different key while a round is active cannot start anything either.
      await expect(resumed.flow.run({ ...f.request, idempotency_key: "F-W15:round-2" })).rejects.toThrow(
        /cannot start a round/u,
      );
      expect(f.counts(resumed.cp)).toEqual({ tasks: 2, launches: 1 });
      // Same key, different arguments is a caller bug, not a retry.
      await expect(resumed.flow.run({ ...f.request, deadline_ms: 9000 })).rejects.toMatchObject({
        code: "IDEMPOTENCY_MISMATCH",
      });
    } finally {
      release();
      await inFlight;
    }
    expect(f.counts()).toEqual({ tasks: 2, launches: 1 });
    expect(f.cp.attempts.list(f.flow.get("feature", "codex").latest_task_id!)).toHaveLength(1);
  });

  it("survives repeated interruption while reconciling, and keeps one identity", async () => {
    const f = fixture();
    const first = await f.flow.run(f.request);
    // Three restarts in a row, each followed by the same identical replay.
    for (let round = 0; round < 3; round += 1) {
      const resumed = f.open();
      const replayed = await resumed.flow.run(f.request);
      expect(replayed.replayed).toBe(true);
      expect(replayed.task.task_id).toBe(first.task.task_id);
    }
    expect(f.counts()).toEqual({ tasks: 2, launches: 1 });
    expect(f.cp.attempts.list(first.task.task_id)).toHaveLength(1);
    const created = f.cp.events({ task_id: first.task.task_id }).filter((e) => e.type === EventType.TASK_CREATED);
    expect(created).toHaveLength(1);
  });

  it("retrieves a finished round instead of launching it again, and shows what a new key would cost", async () => {
    const f = fixture();
    const first = await f.flow.run(f.request);
    expect(first.task.state).toBe(TaskState.DONE);

    // Interruption after the round finished but before the manager read the result.
    const resumed = f.open();
    const view = resumed.flow.get("feature", "codex");
    expect(view.state).toBe("awaiting_review");
    expect(view.active_task_id).toBeNull();
    expect(resumed.cp.deliverables.get(first.task.task_id)?.status).toBe(DeliverableStatus.COMPLETE);
    expect(f.counts(resumed.cp)).toEqual({ tasks: 2, launches: 1 });

    // Retrieval is a read: replaying the same key after DONE still starts nothing.
    expect((await resumed.flow.run(f.request)).replayed).toBe(true);
    expect(f.counts(resumed.cp)).toEqual({ tasks: 2, launches: 1 });

    // The counterexample the rule exists for: after DONE a *recomputed* key really does duplicate.
    await resumed.flow.run({ ...f.request, idempotency_key: "F-W15:round-2" });
    expect(f.counts(resumed.cp)).toEqual({ tasks: 3, launches: 2 });
  });

  it("keeps the recovery of a blocked round to one attempt when its response is lost", async () => {
    const f = fixture();
    f.behavior.partial = true;
    const first = await f.flow.run(f.request);
    expect(first.task.state).toBe(TaskState.BLOCKED);
    expect(f.cp.attempts.list(first.task.task_id)).toHaveLength(1);

    const key = `${first.task.task_id}:resume-1`;
    const message = "The user chose option B.";
    let release!: () => void;
    f.behavior.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.behavior.partial = false;
    const inFlight = f.orchestrator.resumeDelegatedTask({
      task_id: first.task.task_id,
      requested_by: "codex",
      idempotency_key: key,
      message,
      max_turns: 48,
    });
    let resumed: ReturnType<typeof f.open>;
    try {
      await settle();
      resumed = f.open();
      // While the recovery attempt is open, the feature reads as running, and the same key is
      // reported as already active rather than starting a second attempt.
      expect(resumed.flow.get("feature", "codex").state).toBe("running");
      await expect(
        resumed.orchestrator.resumeDelegatedTask({
          task_id: first.task.task_id,
          requested_by: "codex",
          idempotency_key: key,
          message,
          max_turns: 48,
        }),
      ).rejects.toMatchObject({ code: "ILLEGAL_TRANSITION" });
      expect(resumed.cp.attempts.list(first.task.task_id)).toHaveLength(2);
    } finally {
      release();
      await inFlight;
    }

    // After it ends, the identical key replays the same reservation: no third attempt.
    const replay = await resumed!.orchestrator.resumeDelegatedTask({
      task_id: first.task.task_id,
      requested_by: "codex",
      idempotency_key: key,
      message,
      max_turns: 48,
    });
    expect(replay.recovered_attempt).toBe(1);
    expect(resumed!.cp.attempts.list(first.task.task_id)).toHaveLength(2);
    expect(f.counts(resumed!.cp)).toEqual({ tasks: 2, launches: 2 });

    // Budget and contract: the recovery ceiling applies to that attempt only and the stored task
    // spec is untouched, so a replay cannot quietly renew anything.
    expect(f.seen[1]?.spec.max_turns).toBe(48);
    expect(f.seen[1]?.manager_message).toBe(message);
    expect(resumed!.cp.tasks.get(first.task.task_id).spec.max_turns).toBe(32);
    const requested = resumed!.cp
      .events({ task_id: first.task.task_id })
      .filter((event) => event.type === EventType.RECOVERY_REQUESTED);
    expect(requested).toHaveLength(1);
    expect(requested[0]?.idempotency_key).toBe(key);
  });

  it("shows why a recovery without a key is not a retry", async () => {
    const f = fixture();
    f.behavior.partial = true;
    const first = await f.flow.run(f.request);

    // The attempt ends leaving the task recoverable again, which is the only state in which a
    // second keyless call can do damage; a DONE task is refused outright.
    await f.orchestrator.resumeDelegatedTask({ task_id: first.task.task_id, requested_by: "codex" });
    expect(f.cp.tasks.get(first.task.task_id).state).toBe(TaskState.BLOCKED);
    expect(f.cp.attempts.list(first.task.task_id)).toHaveLength(2);

    // A restart loses the in-process guard, so the repeat really does consume another attempt.
    const resumed = f.open();
    await resumed.orchestrator.resumeDelegatedTask({ task_id: first.task.task_id, requested_by: "codex" });
    expect(resumed.cp.attempts.list(first.task.task_id)).toHaveLength(3);
    expect(f.seen).toHaveLength(3);

    f.behavior.partial = false;
    await resumed.orchestrator.resumeDelegatedTask({ task_id: first.task.task_id, requested_by: "codex" });
    expect(resumed.cp.tasks.get(first.task.task_id).state).toBe(TaskState.DONE);
    // A DONE task is not recoverable, with or without a key.
    await expect(
      resumed.orchestrator.resumeDelegatedTask({ task_id: first.task.task_id, requested_by: "codex" }),
    ).rejects.toMatchObject({ code: "ILLEGAL_TRANSITION" });
  });

  it("separates a lost response from a dead server, and stops at the no-handle limit", async () => {
    // A lost response with a live server: the worker finishes and the round is simply collectable.
    const live = fixture();
    const inFlight = live.flow.run(live.request);
    await settle();
    await inFlight; // the manager never saw this resolve
    const collected = live.open().flow.get("feature", "codex");
    expect(collected.state).toBe("awaiting_review");
    expect(live.counts()).toEqual({ tasks: 2, launches: 1 });

    // A dead server during the round, with no session persisted yet: strict resume has nothing to
    // resume, and that is a real limit, not a reason to start anything new.
    const dead = fixture();
    dead.behavior.handle = null;
    let stuck!: () => void;
    dead.behavior.gate = new Promise<void>((resolve) => {
      stuck = resolve;
    });
    const abandoned = dead.flow.run(dead.request);
    await settle();
    const after = dead.open();
    const orphan = after.flow.get("feature", "codex");
    expect(orphan.state).toBe("running");
    const task = orphan.active_task_id!;
    expect(after.cp.attempts.list(task)[0]?.execution_handle ?? null).toBeNull();

    await expect(
      after.orchestrator.resumeDelegatedTask({ task_id: task, requested_by: "codex", idempotency_key: `${task}:resume-1` }),
    ).rejects.toThrow(/lease|persisted execution handle/u);
    // Nothing was invented to work around it: same task, same attempt, same launch count.
    expect(dead.counts(after.cp)).toEqual({ tasks: 2, launches: 1 });
    expect(after.cp.attempts.list(task)).toHaveLength(1);
    expect(after.flow.get("feature", "codex").task_ids).toEqual([task]);
    stuck();
    await abandoned;
  });

  it("does not let a resumed session walk past waiting_user, a foreign manager or a closed feature", async () => {
    const f = fixture();
    f.behavior.partial = true;
    const first = await f.flow.run(f.request);
    f.flow.waitUser("feature", "codex", "q-01", "Which option?");

    const resumed = f.open();
    expect(resumed.flow.get("feature", "codex").state).toBe("waiting_user");
    await expect(resumed.flow.run({ ...f.request, idempotency_key: "F-W15:round-2" })).rejects.toThrow();
    await expect(
      resumed.orchestrator.resumeDelegatedTask({
        task_id: first.task.task_id,
        requested_by: "codex",
        idempotency_key: `${first.task.task_id}:resume-1`,
        message: "go on",
      }),
    ).rejects.toThrow();
    // Another manager cannot read or drive this feature at all.
    expect(() => resumed.flow.get("feature", "someone-else")).toThrow(/another manager/u);
    await expect(
      resumed.orchestrator.resumeDelegatedTask({ task_id: first.task.task_id, requested_by: "claude" }),
    ).rejects.toThrow();
    expect(f.counts(resumed.cp)).toEqual({ tasks: 2, launches: 1 });

    // Answering is the user's fact, and it alone starts nothing.
    resumed.flow.answerUser("feature", "codex", "q-01", "Option B");
    expect(f.counts(resumed.cp)).toEqual({ tasks: 2, launches: 1 });
    expect(resumed.flow.get("feature", "codex").state).toBe("blocked");
  });

  it("reconciles an interrupted bootstrap without a second root, feature or claim", () => {
    const f = fixture();
    const root = f.cp.tasks.get(f.parent.task_id);

    // Root: the identical call with the persisted key is the discriminator. Nothing else is.
    const resumed = f.open();
    const again = resumed.cp.tasks.create({
      spec: { ...spec, objective: "Coordinate F-W15", scope: { paths: ["manager/**"] } },
      created_by: "codex",
      idempotency_key: "F-W15:root",
    });
    expect(again.task_id).toBe(root.task_id);
    expect(resumed.cp.tasks.list({}).filter((t) => t.spec.objective === "Coordinate F-W15")).toHaveLength(1);

    // Without a key the same arguments make a second, indistinguishable task — and an unclaimed
    // one is invisible to a listing by owner, which is why similarity is never a discriminator.
    const stray = resumed.cp.tasks.create({
      spec: { ...spec, objective: "Coordinate F-W15", scope: { paths: ["manager/**"] } },
      created_by: "codex",
    });
    expect(stray.task_id).not.toBe(root.task_id);
    expect(stray.owner).toBeNull();
    expect(resumed.cp.tasks.list({ owner: "codex" }).map((t) => t.task_id)).not.toContain(stray.task_id);

    // Claim and the WORKING transition are both safe to repeat for the same owner and target:
    // `transition` short-circuits when the task is already in the requested state, before the
    // legality check, so an interrupted bootstrap step is re-sent rather than reasoned about.
    expect(resumed.cp.tasks.claim(root.task_id, "codex").task_id).toBe(root.task_id);
    resumed.cp.tasks.transition({ task_id: root.task_id, agent: "codex", to: TaskState.WORKING, idempotency_key: "F-W15:root-working" });
    expect(resumed.cp.tasks.transition({ task_id: root.task_id, agent: "codex", to: TaskState.WORKING }).state).toBe(
      TaskState.WORKING,
    );
    expect(
      resumed.cp.tasks.transition({ task_id: root.task_id, agent: "codex", to: TaskState.WORKING, idempotency_key: "F-W15:root-working" }).state,
    ).toBe(TaskState.WORKING);
    // One state change in the history, however many times the step was repeated.
    expect(
      resumed.cp.events({ task_id: root.task_id }).filter((e) => e.type === EventType.TASK_STATE_CHANGED),
    ).toHaveLength(1);

    // The feature itself needs no key: the same id with the same parent returns the same record,
    // and a different parent is a mismatch rather than a second feature.
    expect(resumed.flow.create("feature", "codex", root.task_id).feature_id).toBe("feature");
    expect(() => resumed.flow.create("feature", "codex", stray.task_id)).toThrow(/IDEMPOTENCY_MISMATCH|another owner or parent/u);
  });
});
