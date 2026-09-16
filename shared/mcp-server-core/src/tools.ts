/**
 * MCP tool surface over the control plane.
 *
 * This is the coordination API both agents call. Every tool is a thin projection of a
 * control-plane operation — no business logic lives here, so the MCP transport can be
 * swapped (HTTP, in-process) without changing semantics.
 *
 * Two conventions worth knowing:
 *  - every mutating tool takes an optional `idempotency_key`, because an MCP call that
 *    times out leaves the caller unable to tell whether it applied (D-005);
 *  - errors come back as structured `BridgeError` JSON inside an `isError` result, so the
 *    calling agent can branch on `code` instead of parsing prose.
 */

import { z } from "zod";
import {
  BridgeError,
  MAX_RECOVERY_DEADLINE_MS,
  MAX_TASK_MAX_TURNS,
  MIN_RECOVERY_DEADLINE_MS,
  MIN_TASK_MAX_TURNS,
  DeliverableStatus,
  ErrorCode,
  TaskState,
  type AgentId,
  type Deliverable,
  type TaskSpec,
  type VerificationResult,
} from "@bridge/protocol";
import {
  FeatureWorkflow,
  digestRef,
  loggableId,
  type ControlPlane,
  type DiagnosticsLogger,
  type Orchestrator,
} from "@bridge/control-plane";
import type { ManagerRegistry } from "@bridge/control-plane";
import type { AuthorizedSession, IdentityRuntime, ToolClass } from "./identity-runtime.js";

/* ------------------------------------------------------------------ *
 * Zod shapes (the MCP SDK builds JSON Schema from these)
 * ------------------------------------------------------------------ */

const writeScopeShape = z.object({
  paths: z.array(z.string().min(1)).min(1).describe("Repo-relative glob patterns you intend to write."),
  note: z.string().optional(),
});

const taskSpecShape = z.object({
  objective: z.string().min(1).describe("One sentence stating what 'done' means."),
  scope: writeScopeShape,
  dependencies: z.array(z.string()).default([]).describe("Task ids that must be DONE first."),
  expected_deliverable: z.string().min(1),
  verification_criteria: z
    .array(z.string().min(1))
    .min(1)
    .describe("How completion will be checked. At least one is mandatory."),
  preferred_agent: z.string().optional(),
  deadline_ms: z.number().int().optional(),
  max_turns: z
    .number()
    .int()
    .min(MIN_TASK_MAX_TURNS)
    .max(MAX_TASK_MAX_TURNS)
    .optional()
    .describe("Finite worker turn ceiling; omit for the conservative runtime default."),
  priority: z.number().int().min(0).max(100).optional(),
  tags: z.array(z.string()).optional(),
});

const verificationShape = z.object({
  kind: z.enum(["test", "typecheck", "build", "lint", "static_analysis", "benchmark", "manual"]),
  command: z.string().min(1).describe("The exact command that was executed."),
  passed: z.boolean(),
  exit_code: z.number().int().nullable(),
  summary: z.string(),
  duration_ms: z.number().int().optional(),
  output_excerpt: z.string().optional(),
});

/* ------------------------------------------------------------------ *
 * Tool definitions
 * ------------------------------------------------------------------ */

export interface ToolContext {
  readonly cp: ControlPlane;
  readonly orchestrator: Orchestrator;
  /** Identity bound when the server process starts. Tool arguments cannot override it. */
  readonly defaultAgent: AgentId;
  /** Generic server-side delegation policy selected when the process starts. */
  readonly delegationPolicy: DelegationPolicy;
  /**
   * Worktree/manager identity runtime. Present only when the server was constructed with a
   * canonical workspace (the product composition root); absent for embedders and unit tests,
   * which keep the pre-isolation behaviour.
   */
  readonly identity?: IdentityRuntime;
  /** Raw `_meta` of the request currently being served (contract section 5.1). */
  readonly nativeMeta?: unknown;
  /**
   * Authority check for an asynchronous operation. The handler must hand it to the reservation
   * (orchestrator/feature round) so it runs inside that transaction, before any durable write or
   * worker launch (contract section 6.3).
   */
  readonly authorize?: () => void;
  /** Reservation boundary: publish markers and release the worktree lock before the worker runs. */
  readonly onReserved?: () => void;
  /** Manager session established by the guard for this call, when identity is enforced. */
  readonly managerSession?: AuthorizedSession;
  /** Manager registry bound to the transaction of this call. */
  readonly managerRegistry?: ManagerRegistry;
  /** Local diagnostics log of this process; absent for embedders and unit tests. */
  readonly logger?: DiagnosticsLogger;
}

export type DelegationPolicy = "allow" | "deny";

export interface ToolDefinition {
  readonly name: string;
  /** Operation class of contract section 6.1; defaults to a guarded mutation. */
  readonly klass?: ToolClass;
  readonly title: string;
  readonly description: string;
  readonly inputShape: z.ZodRawShape;
  readonly handler: (args: Record<string, unknown>, ctx: ToolContext) => unknown | Promise<unknown>;
}

const agentArg = { agent: z.string().optional().describe("Calling agent id; defaults to the server's identity.") };
const idemArg = {
  idempotency_key: z
    .string()
    .optional()
    .describe("Replay-safety key. Retrying with the same key returns the original result."),
};
/** Per-attempt recovery budget. It never changes the persisted task contract. */
const recoveryBudgetArgs = {
  deadline_ms: z
    .number()
    .int()
    .min(MIN_RECOVERY_DEADLINE_MS)
    .max(MAX_RECOVERY_DEADLINE_MS)
    .optional()
    .describe("Explicit runtime deadline for this recovery attempt. Required with recover_timeout; keep it below the client tool timeout."),
  max_turns: z
    .number()
    .int()
    .min(MIN_TASK_MAX_TURNS)
    .max(MAX_TASK_MAX_TURNS)
    .optional()
    .describe("Turn ceiling for this recovery attempt only; the task contract is unchanged."),
};
const recoveryBudget = (args: Record<string, unknown>) => ({
  ...(args["deadline_ms"] !== undefined ? { deadline_ms: args["deadline_ms"] as number } : {}),
  ...(args["max_turns"] !== undefined ? { max_turns: args["max_turns"] as number } : {}),
});
const lineageArgs = {
  run_id: z
    .string()
    .regex(/^run_[0-9a-hjkmnp-tv-z]{10}$/u)
    .optional()
    .describe("Durable run correlation id. Omit to create a new root run."),
  parent_task_id: z
    .string()
    .nullable()
    .optional()
    .describe("Immediate parent task. Child run/depth are validated against it."),
  delegation_depth: z.number().int().min(0).max(32).optional(),
};

const who = (args: Record<string, unknown>, ctx: ToolContext): AgentId => {
  const supplied = args["agent"] as string | undefined;
  if (supplied !== undefined && supplied !== ctx.defaultAgent) {
    throw new BridgeError(
      ErrorCode.INVALID_ARGUMENT,
      `caller '${supplied}' contradicts the server-bound identity '${ctx.defaultAgent}'`,
      { supplied_agent: supplied, bound_agent: ctx.defaultAgent },
    );
  }
  return ctx.defaultAgent;
};

async function executeTool(
  tool: ToolDefinition,
  args: Record<string, unknown>,
  ctx: ToolContext,
  nativeMeta: unknown,
): Promise<unknown> {
  const identity = ctx.identity;
  if (!identity) return tool.handler(args, ctx);
  const klass = tool.klass ?? "mutate";
  // Startup policy is checked before the manager guard, so a server that forbids delegation
  // answers with its policy rather than with an identity verdict (contract section 6.1).
  if (
    ctx.delegationPolicy === "deny" &&
    (tool.name === "bridge_delegate" || tool.name === "bridge_feature_run")
  ) {
    throw new BridgeError(
      ErrorCode.INVALID_ARGUMENT,
      "delegation is denied by this server's startup policy",
      { policy: "deny", caller: ctx.defaultAgent, target: args["to"] },
    );
  }
  if (klass === "read") {
    if (tool.name === "bridge_manager_status" || tool.name === "bridge_server_info") {
      return tool.handler(args, ctx);
    }
    identity.requireReadableState();
    return tool.handler(args, ctx);
  }
  if (tool.name === "bridge_manager_resume_instance" || tool.name === "bridge_manager_takeover") {
    // These tools drive the guard themselves; the class is carried for documentation.
    return tool.handler(args, ctx);
  }
  if (ASYNC_MUTATORS.has(tool.name)) {
    return identity.runMutationAsync(nativeMeta, tool.name, async (authorize, onReserved) =>
      tool.handler(args, { ...ctx, authorize, onReserved }),
    );
  }
  return identity.runMutation(
    nativeMeta,
    "mutate",
    (managerSession, managerRegistry) => tool.handler(args, { ...ctx, managerSession, managerRegistry }),
    tool.name,
  );
}

export const TOOLS: readonly ToolDefinition[] = [
  {
    name: "bridge_feature_create",
    title: "Create a feature workflow",
    description: "Pin future Claude rounds to one feature. Requires a parent task owned by the Codex manager. Does not launch Claude.",
    inputShape: { feature_id: z.string().min(1).max(200), parent_task_id: z.string(), ...agentArg },
    handler: (a, c) => {
      const feature_id = a["feature_id"] as string;
      const flow = new FeatureWorkflow(c.cp, c.orchestrator);
      const session = c.managerSession;
      const created = flow.create(
        feature_id,
        who(a, c),
        a["parent_task_id"] as string,
        session
          ? { workspace_id: c.identity?.workspaceId ?? null, epoch: session.binding.epoch }
          : undefined,
      );
      // One active feature per worktree (contract section 11).
      claimFeatureSlot(c, feature_id);
      return created;
    },
  },
  {
    name: "bridge_feature_get",
    klass: "read",
    title: "Read a feature workflow",
    description: "Read durable routing state, latest task and pending user question. Inspect that task's deliverable/artifacts to retrieve feature-exchange packages.",
    inputShape: { feature_id: z.string(), ...agentArg },
    handler: (a, c) => {
      const flow = new FeatureWorkflow(c.cp, c.orchestrator);
      // Class R: derived state only. Reconciliation happens inside a guarded mutation.
      return c.identity
        ? { ...flow.view(a["feature_id"] as string, who(a, c)), reconciled: false }
        : flow.get(a["feature_id"] as string, who(a, c));
    },
  },
  {
    name: "bridge_feature_run",
    title: "Run a feature round",
    description: "Explicitly launch one Claude round. After DONE, create a new task and strictly resume the same session. BLOCKED tasks use bridge_resume_delegated_task. Replays never launch another worker.",
    inputShape: { feature_id: z.string(), spec: taskSpecShape, input_artifacts: z.array(z.string()).default([]),
      deadline_ms: z.number().int().min(1000).max(86_400_000), idempotency_key: z.string().min(1), ...agentArg },
    handler: (a, c) => {
      if (c.delegationPolicy === "deny") throw new BridgeError(ErrorCode.INVALID_ARGUMENT, "delegation is denied by this server's startup policy");
      return new FeatureWorkflow(c.cp, c.orchestrator).run({ feature_id: a["feature_id"] as string,
        manager: who(a, c), spec: a["spec"] as TaskSpec, input_artifacts: (a["input_artifacts"] as string[]) ?? [],
        deadline_ms: a["deadline_ms"] as number, idempotency_key: a["idempotency_key"] as string,
        ...(c.authorize
          ? {
              authorize: () => {
                c.authorize!();
                const registry = c.cp.managers;
                const binding = registry.read();
                if (binding) registry.claimFeature(a["feature_id"] as string, binding);
              },
            }
          : {}),
        ...(c.onReserved ? { onReserved: c.onReserved } : {}),
        ...(c.identity
          ? {
              // Attribution is resolved inside the reservation transaction, after the guard,
              // so it can never be copied from a stale preflight (review R09-01).
              attribution: () => {
                const binding = c.cp.managers.read();
                return binding
                  ? { native_thread_id: binding.native_thread_id, epoch: binding.epoch }
                  : null;
              },
            }
          : {}) });
    },
  },
  {
    name: "bridge_feature_wait_user",
    title: "Pause a feature for user input",
    description: "Persist a blocking question addressed to the user. Never sends it to Claude. The manager must show the question to the user separately.",
    inputShape: { feature_id: z.string(), question_id: z.string().min(1), question: z.string().min(1).max(8000), ...agentArg },
    handler: (a, c) => {
      const feature_id = a["feature_id"] as string;
      claimFeatureSlot(c, feature_id);
      return new FeatureWorkflow(c.cp, c.orchestrator).waitUser(feature_id, who(a, c), a["question_id"] as string, a["question"] as string);
    },
  },
  {
    name: "bridge_feature_answer_user",
    title: "Record the user answer",
    description: "Record an answer to the current question without launching Claude or forwarding it. To act on it, write the applicable decision into the next feature_run spec, or for a BLOCKED task into bridge_resume_delegated_task.message.",
    inputShape: { feature_id: z.string(), question_id: z.string().min(1), answer: z.string().min(1).max(8000), ...agentArg },
    handler: (a, c) => {
      const feature_id = a["feature_id"] as string;
      claimFeatureSlot(c, feature_id);
      return new FeatureWorkflow(c.cp, c.orchestrator).answerUser(feature_id, who(a, c), a["question_id"] as string, a["answer"] as string);
    },
  },
  {
    name: "bridge_feature_accept",
    title: "Accept a reviewed feature",
    description: "Manager explicitly accepts the completed feature after its review and the required acceptance decision. No rounds are possible afterwards. Worker COMPLETE alone never accepts the feature.",
    inputShape: { feature_id: z.string(), ...agentArg },
    handler: (a, c) => {
      const feature_id = a["feature_id"] as string;
      claimFeatureSlot(c, feature_id);
      const accepted = new FeatureWorkflow(c.cp, c.orchestrator).accept(feature_id, who(a, c));
      // Releasing frees only this feature's slot; another feature's slot is untouched.
      c.managerRegistry?.releaseFeature(feature_id);
      return accepted;
    },
  },

  {
    name: "bridge_manager_status",
    klass: "read",
    title: "Inspect worktree and manager identity",
    description:
      "Report the canonical worktree identity, this connection, the bound manager (native thread, " +
      "epoch, active instance) and any interrupted bootstrap. Pure: it never claims, repairs or " +
      "migrates anything.",
    inputShape: {},
    handler: (_args, ctx) => {
      if (!ctx.identity) {
        return { workspace: null, process: null, manager: null, identity_enforced: false };
      }
      return { ...ctx.identity.status(), identity_enforced: true };
    },
  },
  {
    name: "bridge_manager_resume_instance",
    klass: "handoff",
    title: "Resume manager ownership on this connection",
    description:
      "Make this MCP connection the active instance of the manager thread that already owns the " +
      "worktree, after an MCP restart or crash. Requires the current epoch and generation; the " +
      "native session identity comes from the request, never from arguments, and no token exists.",
    inputShape: {
      expected_epoch: z.number().int().min(1),
      expected_generation: z.number().int().min(1),
    },
    handler: (args, ctx) => {
      const identity = requireIdentity(ctx);
      return identity.runMutation(ctx.nativeMeta, "handoff", (_session, registry) => {
        const outcome = registry.resumeInstance({
          native: identity.lastNative(ctx.nativeMeta),
          instanceId: identity.instanceId,
          expectedEpoch: args["expected_epoch"] as number,
          expectedGeneration: args["expected_generation"] as number,
        });
        return {
          epoch: outcome.binding.epoch,
          instance_generation: outcome.binding.instance_generation,
          changed: outcome.changed,
        };
      });
    },
  },
  {
    name: "bridge_manager_takeover",
    klass: "takeover",
    title: "Take over a worktree from another manager session",
    description:
      "Explicitly move ownership to the calling native session. Compare-and-swap on the previous " +
      "thread and epoch, with a recorded reason. A running round is never cancelled; the previous " +
      "session is fenced and can only return through another explicit takeover.",
    inputShape: {
      expected_thread_id: z.string().min(1),
      expected_epoch: z.number().int().min(1),
      reason: z.string().min(1).max(2000),
    },
    handler: (args, ctx) => {
      const identity = requireIdentity(ctx);
      return identity.runMutation(ctx.nativeMeta, "takeover", (_session, registry) => {
        const binding = registry.takeover({
          native: identity.lastNative(ctx.nativeMeta),
          role: ctx.defaultAgent,
          instanceId: identity.instanceId,
          workspaceId: null,
          expectedThreadId: args["expected_thread_id"] as string,
          expectedEpoch: args["expected_epoch"] as number,
          reason: args["reason"] as string,
        });
        return { epoch: binding.epoch, instance_generation: binding.instance_generation };
      });
    },
  },
  {
    name: "bridge_server_info",
    klass: "read",
    title: "Inspect the bound bridge session",
    description:
      "Return the caller identity and delegation policy bound when this MCP server process " +
      "started. These values cannot be changed by tool arguments.",
    inputShape: {},
    handler: (_args, ctx) => ({
      caller: ctx.defaultAgent,
      delegation: ctx.delegationPolicy,
    }),
  },
  {
    name: "bridge_create_task",
    title: "Create a coordination task",
    description:
      "Register a bounded unit of work with an objective, write scope, dependencies, expected " +
      "deliverable and verification criteria. Returns the task_id. Create a task before doing " +
      "substantial work so the other agent can see ownership.",
    inputShape: { spec: taskSpecShape, ...lineageArgs, ...agentArg, ...idemArg },
    handler: (args, ctx) => {
      const task = ctx.cp.tasks.create({
        spec: args["spec"] as TaskSpec,
        created_by: who(args, ctx),
        ...(args["run_id"] ? { run_id: args["run_id"] as string } : {}),
        ...(args["parent_task_id"] !== undefined
          ? { parent_task_id: args["parent_task_id"] as string | null }
          : {}),
        ...(args["delegation_depth"] !== undefined
          ? { delegation_depth: args["delegation_depth"] as number }
          : {}),
        ...(args["idempotency_key"] ? { idempotency_key: args["idempotency_key"] as string } : {}),
      });
      return {
        task_id: task.task_id,
        run_id: task.run_id,
        parent_task_id: task.parent_task_id,
        delegation_depth: task.delegation_depth,
        state: task.state,
        created_at: task.created_at,
      };
    },
  },
  {
    name: "bridge_list_tasks",
    klass: "read",
    title: "List tasks",
    description:
      "List tasks, optionally filtered by state or owner. Call this before starting work to " +
      "avoid duplicating something the other agent already owns.",
    inputShape: {
      state: z
        .enum(["PENDING", "CLAIMED", "WORKING", "BLOCKED", "VERIFYING", "DONE", "FAILED", "CANCELLED"])
        .optional(),
      owner: z.string().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    },
    handler: (args, ctx) => {
      const tasks = ctx.cp.tasks.list({
        ...(args["state"] ? { state: args["state"] as TaskState } : {}),
        ...(args["owner"] ? { owner: args["owner"] as string } : {}),
        ...(args["limit"] ? { limit: args["limit"] as number } : {}),
      });
      return {
        count: tasks.length,
        tasks: tasks.map((t) => ({
          task_id: t.task_id,
          run_id: t.run_id,
          parent_task_id: t.parent_task_id,
          delegation_depth: t.delegation_depth,
          state: t.state,
          owner: t.owner,
          objective: t.spec.objective,
          scope: t.spec.scope.paths,
          dependencies: t.spec.dependencies,
          blockers: t.blockers,
          attempt: t.attempt,
        })),
      };
    },
  },
  {
    name: "bridge_get_task",
    klass: "read",
    title: "Get one task in full",
    description: "Full task record plus dependency status, artifacts, latest status and deliverable.",
    inputShape: { task_id: z.string() },
    handler: (args, ctx) => {
      const task_id = args["task_id"] as string;
      const task = ctx.cp.tasks.get(task_id);
      return {
        task,
        dependencies: ctx.cp.tasks.checkDependencies(task_id),
        artifacts: ctx.cp.artifacts.list(task_id).map((a) => ({
          artifact_id: a.artifact_id,
          name: a.name,
          kind: a.kind,
          bytes: a.bytes,
          sha256: a.sha256,
        })),
        latest_status: ctx.cp.tasks.latestStatus(task_id) ?? null,
        deliverable: ctx.cp.deliverables.get(task_id) ?? null,
        verifications: ctx.cp.deliverables.listVerifications(task_id),
        attempts: ctx.cp.attempts.list(task_id),
        telemetry: ctx.cp.attempts.queryTelemetry({ task_id }),
        // Location and integrity only; the stderr tail is read from the local file.
        termination_evidence: ctx.cp.evidence.list(task_id),
      };
    },
  },
  {
    name: "bridge_set_execution_handle",
    title: "Save a resumable execution handle",
    description:
      "Persist an opaque pointer to this attempt's resumable session (a Codex thread id, a " +
      "Claude session id). Call it as soon as the session exists so a crash leaves something " +
      "to resume from. Never pass secrets, credentials, or conversation content — the " +
      "coordination database is shared with the other agent.",
    inputShape: {
      task_id: z.string(),
      execution_handle: z
        .string()
        .min(1)
        .describe("Opaque session/thread identifier. Max 512 printable ASCII characters."),
      attempt: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Defaults to the task's current attempt."),
      ...agentArg,
    },
    handler: (args, ctx) => {
      const task_id = args["task_id"] as string;
      const task = ctx.cp.tasks.get(task_id);
      const attempt = (args["attempt"] as number | undefined) ?? task.attempt;
      const record = ctx.cp.attempts.saveHandle(
        task_id,
        attempt,
        who(args, ctx),
        args["execution_handle"] as string,
      );
      return { task_id, attempt: record.attempt, saved: true, updated_at: record.updated_at };
    },
  },
  {
    name: "bridge_get_execution_handle",
    klass: "read",
    title: "Read a resumable execution handle",
    description:
      "Fetch the execution handle saved for an attempt, so a restarted agent can reconnect " +
      "to the session it was using instead of starting the task from cold. The handle may be " +
      "stale; treat a failed resume as a normal cold start.",
    inputShape: {
      task_id: z.string(),
      attempt: z.number().int().min(0).optional().describe("Defaults to the task's current attempt."),
    },
    handler: (args, ctx) => {
      const task_id = args["task_id"] as string;
      const task = ctx.cp.tasks.get(task_id);
      const attempt = (args["attempt"] as number | undefined) ?? task.attempt;
      const record = ctx.cp.attempts.get(task_id, attempt);
      return {
        task_id,
        attempt,
        execution_handle: record?.execution_handle ?? null,
        previous_execution_handle: ctx.cp.attempts.previousHandle(task_id, attempt),
      };
    },
  },
  {
    name: "bridge_resume_task",
    title: "Resume an existing stranded task",
    description:
      "Atomically create a new attempt for a recoverable task owned by this caller, reacquire " +
      "its persisted scope, and strictly resume its stored runtime session. Task identity, " +
      "lineage, owner, objective, scope, and execution handle come only from durable state; " +
      "this operation never creates a task or accepts replacement identity fields.",
    inputShape: {
      task_id: z.string(),
      ...recoveryBudgetArgs,
      ...idemArg,
    },
    handler: (args, ctx) =>
      ctx.orchestrator.resumeTask(
        {
          task_id: args["task_id"] as string,
          requested_by: ctx.defaultAgent,
          ...recoveryBudget(args),
          ...(args["idempotency_key"] ? { idempotency_key: args["idempotency_key"] as string } : {}),
        },
        {
          ...(ctx.authorize ? { authorize: ctx.authorize } : {}),
          ...(ctx.onReserved ? { onReserved: ctx.onReserved } : {}),
        },
      ),
  },
  {
    name: "bridge_resume_delegated_task",
    title: "Resume a direct delegated child",
    description:
      "Request strict recovery of an existing recoverable child directly delegated by this " +
      "caller's owned parent task. Authorization comes from durable parent/child lineage; " +
      "the child owner remains the execution identity for its adapter, attempt, lease, " +
      "deliverable, telemetry, and persisted runtime session. This operation never transfers " +
      "ownership, accepts identity overrides, creates a replacement task, or exposes a handle. " +
      "A FAILED child stays terminal unless recover_timeout is set and durable state proves its " +
      "last attempt was stopped by the bridge deadline with a persisted session.",
    inputShape: {
      task_id: z.string(),
      message: z.string().min(1).max(8000).optional()
        .describe("Clarification for a BLOCKED or timed-out Claude child, within its existing objective and scope. Requires idempotency_key."),
      recover_timeout: z.boolean().optional()
        .describe("Reopen a FAILED child whose last attempt ended at the bridge deadline (TIMEOUT) with a persisted session. Requires deadline_ms and idempotency_key; use only after the extra runtime is authorized."),
      ...recoveryBudgetArgs,
      ...idemArg,
    },
    handler: (args, ctx) =>
      ctx.orchestrator.resumeDelegatedTask(
        {
          task_id: args["task_id"] as string,
          requested_by: ctx.defaultAgent,
          ...recoveryBudget(args),
          ...(args["recover_timeout"] !== undefined ? { recover_timeout: args["recover_timeout"] as boolean } : {}),
          ...(args["message"] !== undefined ? { message: args["message"] as string } : {}),
          ...(args["idempotency_key"] ? { idempotency_key: args["idempotency_key"] as string } : {}),
        },
        {
          ...(ctx.authorize ? { authorize: ctx.authorize } : {}),
          ...(ctx.onReserved ? { onReserved: ctx.onReserved } : {}),
        },
      ),
  },
  {
    name: "bridge_claim_task",
    title: "Claim ownership of a task",
    description:
      "Take ownership of an unowned task. Fails with NOT_OWNER if another agent already owns it. " +
      "Claiming does not grant write access — acquire a lease as well.",
    inputShape: { task_id: z.string(), ...agentArg, ...idemArg },
    handler: (args, ctx) => {
      const task = ctx.cp.tasks.claim(
        args["task_id"] as string,
        who(args, ctx),
        args["idempotency_key"] as string | undefined,
      );
      return { task_id: task.task_id, state: task.state, owner: task.owner };
    },
  },
  {
    name: "bridge_acquire_lease",
    title: "Acquire a write-scope lease",
    description:
      "Reserve exclusive write access to a set of path globs before editing files. Fails with " +
      "SCOPE_CONFLICT (listing the holder) if another agent is writing there. Leases expire, so a " +
      "crashed agent cannot block the scope forever.",
    inputShape: {
      task_id: z.string(),
      scope: writeScopeShape,
      ttl_ms: z.number().int().min(1000).default(900_000),
      ...agentArg,
    },
    handler: (args, ctx) => {
      const lease = ctx.cp.leases.acquire({
        task_id: args["task_id"] as string,
        holder: who(args, ctx),
        scope: args["scope"] as { paths: string[] },
        ttl_ms: (args["ttl_ms"] as number | undefined) ?? 900_000,
      });
      return {
        lease_id: lease.lease_id,
        expires_at: lease.expires_at,
        paths: lease.scope.paths,
      };
    },
  },
  {
    name: "bridge_check_scope",
    klass: "read",
    title: "Check whether a scope is free",
    description:
      "Non-mutating conflict check. Use before planning work to see whether the other agent is " +
      "already writing in the files you need.",
    inputShape: { scope: writeScopeShape, ...agentArg },
    handler: (args, ctx) => {
      const conflicts = ctx.cp.leases.findConflicts(
        args["scope"] as { paths: string[] },
        who(args, ctx),
      );
      return { free: conflicts.length === 0, conflicts };
    },
  },
  {
    name: "bridge_renew_lease",
    title: "Extend a lease",
    description: "Push back a lease's expiry during long work. Cannot revive an expired lease.",
    inputShape: { lease_id: z.string(), ttl_ms: z.number().int().min(1000), ...agentArg },
    handler: (args, ctx) => {
      const lease = ctx.cp.leases.renew(
        args["lease_id"] as string,
        who(args, ctx),
        args["ttl_ms"] as number,
      );
      return { lease_id: lease.lease_id, expires_at: lease.expires_at };
    },
  },
  {
    name: "bridge_release_lease",
    title: "Release a lease",
    description: "Free a write scope for the other agent. Safe to call twice.",
    inputShape: { lease_id: z.string(), ...agentArg },
    handler: (args, ctx) => {
      const lease = ctx.cp.leases.release(args["lease_id"] as string, who(args, ctx));
      return { lease_id: lease.lease_id, state: lease.state };
    },
  },
  {
    name: "bridge_set_state",
    title: "Change task state",
    description:
      "Move a task you own through the lifecycle: CLAIMED -> WORKING -> VERIFYING -> DONE, or to " +
      "BLOCKED/FAILED/CANCELLED. Entering WORKING is refused while dependencies are unsatisfied.",
    inputShape: {
      task_id: z.string(),
      to: z.enum(["CLAIMED", "WORKING", "BLOCKED", "VERIFYING", "DONE", "FAILED", "CANCELLED"]),
      reason: z.string().optional(),
      ...agentArg,
      ...idemArg,
    },
    handler: (args, ctx) => {
      const task = ctx.cp.tasks.transition({
        task_id: args["task_id"] as string,
        agent: who(args, ctx),
        to: args["to"] as TaskState,
        ...(args["reason"] ? { reason: args["reason"] as string } : {}),
        ...(args["idempotency_key"] ? { idempotency_key: args["idempotency_key"] as string } : {}),
      });
      return { task_id: task.task_id, state: task.state };
    },
  },
  {
    name: "bridge_report_status",
    title: "Report progress",
    description:
      "Publish a progress update an external supervisor can observe. Use at meaningful " +
      "milestones only — not for trivial internal steps.",
    inputShape: {
      task_id: z.string(),
      current_action: z.string(),
      next_action: z.string(),
      progress: z.number().min(0).max(1).nullable().optional(),
      ...agentArg,
    },
    handler: (args, ctx) => {
      const task_id = args["task_id"] as string;
      const task = ctx.cp.tasks.get(task_id);
      ctx.cp.tasks.reportStatus({
        task_id,
        agent: who(args, ctx),
        state: task.state,
        current_action: args["current_action"] as string,
        owned_scope: task.spec.scope.paths,
        progress: (args["progress"] as number | null | undefined) ?? null,
        artifacts: ctx.cp.artifacts.list(task_id).map((a) => a.artifact_id),
        blockers: task.blockers,
        next_action: args["next_action"] as string,
        at: ctx.cp.clock.now(),
      });
      return { ok: true };
    },
  },
  {
    name: "bridge_publish_artifact",
    title: "Publish an artifact",
    description:
      "Share a result as an artifact rather than pasting it into conversation. Provide either " +
      "inline content (small) or a repo-relative path. Content is hashed so consumers can detect drift.",
    inputShape: {
      task_id: z.string(),
      name: z.string(),
      kind: z.enum(["file", "diff", "log", "report", "test_result", "json"]).default("report"),
      inline: z.string().optional(),
      path: z.string().optional().describe("Repo-relative path. Mutually exclusive with 'inline'."),
      metadata: z.record(z.unknown()).optional(),
      ...agentArg,
    },
    handler: (args, ctx) => {
      const a = ctx.cp.artifacts.publish({
        task_id: args["task_id"] as string,
        produced_by: who(args, ctx),
        kind: (args["kind"] as "report") ?? "report",
        name: args["name"] as string,
        ...(args["inline"] !== undefined ? { inline: args["inline"] as string } : {}),
        ...(args["path"] !== undefined ? { path: args["path"] as string } : {}),
        ...(args["metadata"] ? { metadata: args["metadata"] as Record<string, unknown> } : {}),
      });
      return { artifact_id: a.artifact_id, sha256: a.sha256, bytes: a.bytes };
    },
  },
  {
    name: "bridge_read_artifact",
    klass: "read",
    title: "Read an artifact",
    description: "Fetch an artifact's content and metadata by id, with an integrity check.",
    inputShape: { artifact_id: z.string() },
    handler: (args, ctx) => {
      const id = args["artifact_id"] as string;
      const a = ctx.cp.artifacts.get(id);
      return {
        artifact: {
          artifact_id: a.artifact_id,
          task_id: a.task_id,
          name: a.name,
          kind: a.kind,
          media_type: a.media_type,
          bytes: a.bytes,
          sha256: a.sha256,
          produced_by: a.produced_by,
        },
        integrity: ctx.cp.artifacts.verifyIntegrity(id),
        content: ctx.cp.artifacts.read(id),
      };
    },
  },
  {
    name: "bridge_record_verification",
    title: "Record verification evidence",
    description:
      "Record a check that ACTUALLY RAN, with its real exit code. A task cannot be completed " +
      "without at least one passing check. Do not record a check you did not execute.",
    inputShape: { task_id: z.string(), result: verificationShape, ...agentArg },
    handler: (args, ctx) => {
      ctx.cp.deliverables.recordVerification(
        args["task_id"] as string,
        who(args, ctx),
        args["result"] as VerificationResult,
      );
      return { ok: true };
    },
  },
  {
    name: "bridge_submit_deliverable",
    title: "Submit the final deliverable",
    description:
      "Hand back the structured result and move the task to its terminal state. COMPLETE requires " +
      "at least one passing verification and no failing ones; otherwise submit PARTIAL or FAILED.",
    inputShape: {
      task_id: z.string(),
      status: z.enum(["COMPLETE", "PARTIAL", "FAILED"]),
      summary: z.string().min(1),
      changed_scope: z.array(z.string()).default([]),
      artifacts: z.array(z.string()).default([]),
      commit_or_diff: z.string().nullable().default(null),
      verification_results: z.array(verificationShape).default([]),
      remaining_risks: z.array(z.string()).default([]),
      recommended_next_action: z.string().default("review the artifacts"),
      ...agentArg,
    },
    handler: (args, ctx) => {
      const task_id = args["task_id"] as string;
      const deliverable: Deliverable = {
        task_id,
        agent: who(args, ctx),
        status: args["status"] as DeliverableStatus,
        summary: args["summary"] as string,
        changed_scope: (args["changed_scope"] as string[]) ?? [],
        artifacts: (args["artifacts"] as string[]) ?? [],
        commit_or_diff: (args["commit_or_diff"] as string | null) ?? null,
        verification_performed: ((args["verification_results"] as VerificationResult[]) ?? []).map(
          (v) => v.command,
        ),
        verification_results: (args["verification_results"] as VerificationResult[]) ?? [],
        remaining_risks: (args["remaining_risks"] as string[]) ?? [],
        dependencies_unblocked: ctx.cp.store.getDependents(task_id),
        recommended_next_action: (args["recommended_next_action"] as string) ?? "review the artifacts",
        at: ctx.cp.clock.now(),
      };
      const submitted = ctx.cp.deliverables.submit(deliverable);
      return {
        task_id,
        status: submitted.status,
        state: ctx.cp.tasks.get(task_id).state,
        dependencies_unblocked: submitted.dependencies_unblocked,
      };
    },
  },
  {
    name: "bridge_block_task",
    title: "Raise a blocker",
    description:
      "Escalate instead of guessing or working around another agent's scope. Moves the task to " +
      "BLOCKED with a recorded reason.",
    inputShape: { task_id: z.string(), reason: z.string().min(1), ...agentArg },
    handler: (args, ctx) => {
      const task = ctx.cp.tasks.block(
        args["task_id"] as string,
        who(args, ctx),
        args["reason"] as string,
      );
      return { task_id: task.task_id, state: task.state, blockers: task.blockers };
    },
  },
  {
    name: "bridge_add_dependency",
    title: "Declare a dependency",
    description:
      "Record that one task must wait for another. Cycles are rejected, so dependencies cannot " +
      "deadlock the two agents against each other.",
    inputShape: { task_id: z.string(), depends_on: z.string(), ...agentArg },
    handler: (args, ctx) => {
      const task = ctx.cp.tasks.addDependency(
        args["task_id"] as string,
        args["depends_on"] as string,
        who(args, ctx),
      );
      return { task_id: task.task_id, dependencies: task.spec.dependencies };
    },
  },
  {
    name: "bridge_delegate",
    title: "Delegate a task to another agent",
    description:
      "Hand a bounded task to another agent and wait for its deliverable. Requires a deadline, " +
      "which is what prevents open-ended agent-to-agent loops. Inputs are passed as artifact ids, " +
      "not conversation history.",
    inputShape: {
      to: z.string().describe("Target agent id, e.g. 'codex'."),
      spec: taskSpecShape,
      input_artifacts: z.array(z.string()).default([]),
      deadline_ms: z.number().int().min(1000).max(86_400_000),
      max_attempts: z.number().int().min(0).max(5).default(0),
      ...lineageArgs,
      ...agentArg,
      ...idemArg,
    },
    handler: async (args, ctx) => {
      if (ctx.delegationPolicy === "deny") {
        throw new BridgeError(
          ErrorCode.INVALID_ARGUMENT,
          "delegation is denied by this server's startup policy",
          { policy: "deny", caller: ctx.defaultAgent, target: args["to"] },
        );
      }
      const outcome = await ctx.orchestrator.delegate(
        {
        from: who(args, ctx),
        to: args["to"] as string,
        spec: args["spec"] as TaskSpec,
        ...(args["run_id"] ? { run_id: args["run_id"] as string } : {}),
        ...(args["parent_task_id"] !== undefined
          ? { parent_task_id: args["parent_task_id"] as string | null }
          : {}),
        ...(args["delegation_depth"] !== undefined
          ? { delegation_depth: args["delegation_depth"] as number }
          : {}),
        input_artifacts: (args["input_artifacts"] as string[]) ?? [],
        deadline_ms: args["deadline_ms"] as number,
        max_attempts: (args["max_attempts"] as number) ?? 0,
        ...(args["idempotency_key"] ? { idempotency_key: args["idempotency_key"] as string } : {}),
        },
        {
          ...(ctx.authorize ? { authorize: ctx.authorize } : {}),
          ...(ctx.onReserved ? { onReserved: ctx.onReserved } : {}),
        },
      );
      return outcome;
    },
  },
  {
    name: "bridge_query_telemetry",
    klass: "read",
    title: "Query normalized attempt telemetry",
    description:
      "Read final neutral telemetry records by run, task, agent, or attempt. Records never " +
      "contain raw prompts, conversation history, authentication data, or execution handles.",
    inputShape: {
      run_id: z.string().optional(),
      task_id: z.string().optional(),
      agent: z.string().optional(),
      attempt: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(500).default(100),
    },
    handler: (args, ctx) => {
      // `agent` is a read filter here, not a caller assertion. Native callers may inspect
      // the opposite runtime's exported telemetry without impersonating it.
      const records = ctx.cp.attempts.queryTelemetry({
        ...(args["run_id"] ? { run_id: args["run_id"] as string } : {}),
        ...(args["task_id"] ? { task_id: args["task_id"] as string } : {}),
        ...(args["agent"] ? { agent: args["agent"] as string } : {}),
        ...(args["attempt"] !== undefined ? { attempt: args["attempt"] as number } : {}),
        limit: (args["limit"] as number | undefined) ?? 100,
      });
      return { count: records.length, records };
    },
  },
  {
    name: "bridge_snapshot",
    klass: "read",
    title: "Coordination snapshot",
    description:
      "One-shot view of the whole system: task counts by state, ready tasks, live leases and their " +
      "holders, registered adapters. The cheapest way to answer 'what is the other agent doing?'.",
    inputShape: {},
    handler: (_args, ctx) => ctx.cp.snapshot(),
  },
  {
    name: "bridge_read_events",
    klass: "read",
    title: "Tail the event log",
    description:
      "Read the append-only event log, optionally after a given event_id. This is the supervisor " +
      "feed: poll with the last id you saw to stream progress.",
    inputShape: {
      after: z.number().int().min(0).optional(),
      task_id: z.string().optional(),
      limit: z.number().int().min(1).max(500).default(100),
    },
    handler: (args, ctx) => {
      const events = ctx.cp.events({
        ...(args["after"] !== undefined ? { after: args["after"] as number } : {}),
        ...(args["task_id"] ? { task_id: args["task_id"] as string } : {}),
        limit: (args["limit"] as number) ?? 100,
      });
      return { events, last_event_id: ctx.cp.lastEventId() };
    },
  },
  {
    name: "bridge_recover",
    klass: "read",
    title: "Run crash recovery",
    description:
      "Expire leases whose holder went away and report tasks left mid-flight. Does not auto-fail " +
      "or auto-retry anything — recovery decisions stay explicit.",
    inputShape: {},
    handler: (_args, ctx) => (ctx.identity ? ctx.cp.inspectRecovery() : ctx.cp.recover()),
  },
];

/**
 * Every mutating touch of a feature takes (or confirms) the worktree's single active feature
 * slot, inside the guarded transaction. Adopted historical features claim the empty slot on
 * their first touch (contract section 11, review R09-04).
 */
function claimFeatureSlot(ctx: ToolContext, featureId: string): void {
  const registry = ctx.managerRegistry;
  const binding = ctx.managerSession?.binding ?? registry?.read();
  if (!registry || !binding) return;
  registry.claimFeature(featureId, binding);
}

function requireIdentity(ctx: ToolContext): IdentityRuntime {
  if (!ctx.identity) {
    throw new BridgeError(
      ErrorCode.UNIMPLEMENTED,
      "manager identity tools require a server started with a canonical workspace",
    );
  }
  return ctx.identity;
}

/** Tools whose handler is asynchronous and therefore guarded before, not inside, the work. */
const ASYNC_MUTATORS = new Set([
  "bridge_delegate",
  "bridge_feature_run",
  "bridge_resume_task",
  "bridge_resume_delegated_task",
]);

/**
 * Correlation fields taken from a call.
 *
 * The rule of wave13 §1: identifiers yes, content never. Objectives, scopes, questions,
 * answers, messages, reasons and every other free-text argument stay out of the log; a
 * manager-chosen idempotency key is referenced by digest so replays still correlate.
 */
function callCorrelation(args: Record<string, unknown>): {
  feature_id: string | null;
  task_id: string | null;
  details: Record<string, unknown>;
} {
  const details: Record<string, unknown> = {};
  const run = loggableId(args["run_id"]);
  const parent = loggableId(args["parent_task_id"]);
  const target = loggableId(args["to"]);
  const key = digestRef(args["idempotency_key"]);
  if (run !== null) details["run_id"] = run;
  if (parent !== null) details["parent_task_id"] = parent;
  if (target !== null) details["target_agent"] = target;
  if (key !== null) details["idempotency_ref"] = key;
  if (typeof args["deadline_ms"] === "number") details["deadline_ms"] = args["deadline_ms"];
  if (typeof args["max_turns"] === "number") details["max_turns"] = args["max_turns"];
  return {
    feature_id: loggableId(args["feature_id"]),
    task_id: loggableId(args["task_id"]),
    details,
  };
}

/** Scalar result fields worth correlating; anything else, including nested payloads, is dropped. */
const RESULT_FIELDS = [
  "state",
  "outcome",
  "recovered_attempt",
  "resumed_from_attempt",
  "recovery_mode",
  "same_execution_handle",
  "epoch",
  "instance_generation",
  "changed",
] as const;

function resultSummary(result: unknown): {
  task_id: string | null;
  attempt: number | null;
  code: string | null;
  details: Record<string, unknown>;
} {
  const details: Record<string, unknown> = {};
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    return { task_id: null, attempt: null, code: null, details };
  }
  const value = result as Record<string, unknown>;
  const task = value["task"] as Record<string, unknown> | undefined;
  for (const field of RESULT_FIELDS) {
    const raw = value[field] ?? (task ? task[field] : undefined);
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
      details[field] = raw;
    }
  }
  const error = value["error"] as { code?: unknown } | undefined;
  const attempt = value["attempt"] ?? value["recovered_attempt"];
  return {
    task_id: loggableId(value["task_id"] ?? (task ? task["task_id"] : null)),
    attempt: typeof attempt === "number" ? attempt : null,
    // A round that ends in a runtime TIMEOUT reports it inside a successful envelope.
    code: typeof error?.code === "string" ? error.code : null,
    details,
  };
}

/** Wrap a handler result in the MCP content envelope, converting errors to structured JSON. */
export async function runTool(
  tool: ToolDefinition,
  args: Record<string, unknown>,
  ctx: ToolContext,
  nativeMeta?: unknown,
  requestId?: string | number,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const logger = ctx.logger;
  const startedMs = logger?.monotonicMs() ?? 0;
  const correlation = callCorrelation(args);
  const finished = (
    outcome: "ok" | "error",
    code: string | null,
    extra: { task_id?: string | null; attempt?: number | null; details?: Record<string, unknown> },
  ): void => {
    logger?.record({
      op: "tool",
      event: "call.finished",
      tool: tool.name,
      outcome,
      code,
      // Whether the identity guard granted this call authority separates a refusal from a
      // failure inside the operation itself.
      phase: ctx.identity ? (ctx.identity.callWasAuthorized ? "handler" : "guard") : "unguarded",
      request_id: requestId ?? null,
      duration_ms: (logger?.monotonicMs() ?? 0) - startedMs,
      feature_id: correlation.feature_id,
      task_id: extra.task_id ?? correlation.task_id,
      attempt: extra.attempt ?? null,
      details: { ...correlation.details, ...(extra.details ?? {}) },
    });
  };
  try {
    const scoped: ToolContext = ctx.identity ? { ...ctx, nativeMeta } : ctx;
    const result = await executeTool(tool, args, scoped, nativeMeta);
    const summary = resultSummary(result);
    finished("ok", summary.code, {
      task_id: summary.task_id,
      attempt: summary.attempt,
      details: summary.details,
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    const bridgeErr = BridgeError.from(err);
    const reason = (bridgeErr.details as { reason?: unknown } | undefined)?.reason;
    finished("error", bridgeErr.code, {
      details: { reason: typeof reason === "string" ? reason : null },
    });
    return {
      content: [{ type: "text", text: JSON.stringify({ error: bridgeErr.toJSON() }, null, 2) }],
      isError: true,
    };
  }
}
