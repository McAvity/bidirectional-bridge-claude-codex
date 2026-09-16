/**
 * Agent-neutral MCP server for the coordination bridge.
 *
 * Nothing here knows about Claude or Codex. Either agent constructs this server, registers
 * its own adapter, and gets the identical coordination tool surface — which is what makes
 * the bridge symmetric rather than "Claude's server that Codex borrows".
 *
 * Transport is stdio first (D-001): what Claude Code, Cowork, and the Codex CLI all speak
 * natively, with no ports or auth for a local two-agent setup. The transport is injected,
 * so an HTTP/SSE transport drops in without touching the tool layer.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  ControlPlane,
  Orchestrator,
  type DiagnosticsLogger,
  type WorkspaceIdentity,
} from "@bridge/control-plane";
import type { AgentAdapter, AgentId } from "@bridge/protocol";
import { IdentityRuntime } from "./identity-runtime.js";
import {
  TOOLS,
  runTool,
  type DelegationPolicy,
  type ToolContext,
  type ToolDefinition,
} from "./tools.js";

export const DEFAULT_SERVER_INSTRUCTIONS =
  "Coordination bridge between local coding agents. Before substantial work: call " +
  "bridge_snapshot to see what the other agent owns, bridge_create_task to register your " +
  "unit of work, bridge_claim_task to take ownership, and bridge_acquire_lease to reserve " +
  "the files you will edit. Never write inside a scope another agent holds — raise a " +
  "blocker or delegate instead. Finish with bridge_record_verification (checks that really " +
  "ran) and bridge_submit_deliverable. In a new native session, create a root without a " +
  "parent (depth 0); pass its returned run_id and task_id when delegating a depth-1 child. " +
  "Omit caller agent fields because the process identity is already bound at startup. " +
  "Delegation back to an agent in the ancestor lineage is rejected. If a task you own was " +
  "stranded after persisting a runtime handle, use bridge_resume_task. If your owned manager " +
  "task directly delegated the stranded child, use bridge_resume_delegated_task; the bridge " +
  "keeps the child owner as execution identity. Never create a replacement task for recovery.";

export interface BridgeServerOptions {
  readonly workspaceRoot: string;
  readonly databasePath?: string;
  /** Identity bound to every caller-bearing tool when this process starts. */
  readonly agent?: AgentId;
  /** Server-side delegation gate. Defaults to `allow`. */
  readonly delegationPolicy?: DelegationPolicy;
  /** Adapters to register — each agent supplies its own. */
  readonly adapters?: readonly AgentAdapter[];
  /** Share an already-open control plane instead of opening one. */
  readonly controlPlane?: ControlPlane;
  /**
   * Canonical worktree identity. When present the server enforces the isolation protocol:
   * it opens nothing at startup, reads stay read-only, and ownership is bound by the first
   * authorized call carrying native per-request metadata.
   */
  readonly workspace?: WorkspaceIdentity;
  /**
   * Explicit, operator-requested adoption of an unbound legacy database (contract §10). Only a
   * deliberate flag may set it; it is recorded with provenance in the binding row.
   */
  readonly adoptLegacy?: { readonly reason: string };
  /**
   * Connection instance id. Supplied by the composition root so the diagnostics log and the
   * manager identity name the same instance; generated per process when omitted.
   */
  readonly instanceId?: string;
  /** Extra tools beyond the coordination set, for agent-specific surfaces. */
  readonly extraTools?: readonly ToolDefinition[];
  readonly serverName?: string;
  readonly serverVersion?: string;
  readonly instructions?: string;
  /**
   * Diagnostics sink. Defaults to stderr because stdout IS the MCP transport — anything
   * written there that is not a JSON-RPC frame corrupts the session.
   */
  readonly onWarning?: (message: string, details?: Record<string, unknown>) => void;
  /**
   * Local diagnostics log of this process (wave13 §1). The composition root owns it; it starts
   * disarmed and writes nothing until the identity guard authorizes an operation.
   */
  readonly logger?: DiagnosticsLogger;
}

export class BridgeMcpServer {
  readonly cp: ControlPlane;
  readonly orchestrator: Orchestrator;
  readonly identity: IdentityRuntime | undefined;
  readonly logger: DiagnosticsLogger | undefined;
  private readonly server: McpServer;
  private readonly ctx: ToolContext;
  private readonly tools: readonly ToolDefinition[];
  /** True when this instance opened the control plane and must therefore close it. */
  private readonly ownsControlPlane: boolean;
  private closed = false;

  constructor(options: BridgeServerOptions) {
    this.ownsControlPlane = options.controlPlane === undefined;
    const planeOptions = {
      workspaceRoot: options.workspaceRoot,
      ...(options.databasePath ? { databasePath: options.databasePath } : {}),
      ...(options.onWarning ? { onWarning: options.onWarning } : {}),
      ...(options.logger ? { logger: options.logger } : {}),
      ...(options.workspace ? { workspace: options.workspace } : {}),
    };
    this.cp =
      options.controlPlane ??
      (options.workspace ? ControlPlane.deferred(planeOptions) : ControlPlane.open(planeOptions));
    this.logger = options.logger;
    this.identity = options.workspace
      ? new IdentityRuntime(
          this.cp,
          options.workspace,
          options.agent ?? "bridge",
          options.instanceId,
          options.adoptLegacy,
          options.logger,
        )
      : undefined;
    this.orchestrator = new Orchestrator(this.cp);
    for (const adapter of options.adapters ?? []) this.cp.adapters.register(adapter);

    this.ctx = {
      cp: this.cp,
      orchestrator: this.orchestrator,
      defaultAgent: options.agent ?? "bridge",
      delegationPolicy: options.delegationPolicy ?? "allow",
      ...(this.identity ? { identity: this.identity } : {}),
      ...(options.logger ? { logger: options.logger } : {}),
    };

    this.tools = [...TOOLS, ...(options.extraTools ?? [])];

    this.server = new McpServer(
      {
        name: options.serverName ?? "bridge-coordination",
        version: options.serverVersion ?? "0.1.0",
      },
      { instructions: options.instructions ?? DEFAULT_SERVER_INSTRUCTIONS },
    );

    for (const tool of this.tools) {
      this.server.registerTool(
        tool.name,
        { title: tool.title, description: tool.description, inputSchema: tool.inputShape },
        async (
          args: Record<string, unknown>,
          extra?: { _meta?: unknown; requestId?: string | number },
        ) =>
          // The per-request context is the only identity source (contract section 5.1); the
          // JSON-RPC request id is the correlation handle the diagnostics log records.
          runTool(tool, args ?? {}, this.ctx, extra?._meta, extra?.requestId),
      );
    }
  }

  /** Connect over stdio (default) or an injected transport. */
  async connect(transport?: Transport): Promise<void> {
    await this.server.connect(transport ?? new StdioServerTransport());
  }

  /**
   * Shut down in dependency order: stop accepting protocol traffic, then release the
   * database. Idempotent, because signal handlers and explicit shutdown paths both call
   * it and a double `close()` on SQLite throws.
   *
   * Callers that passed their own `controlPlane` keep ownership of it; closing a handle
   * this server did not open would pull it out from under whoever else is using it.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.server.close();
    } finally {
      // Clean detach first: it lets an ordinary restart of the same thread adopt without a
      // handoff, while a crash still requires the explicit one.
      this.identity?.detach();
      if (this.ownsControlPlane && this.cp.isOpen) this.cp.close();
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Exposed for tests and for embedding the server in a larger host process. */
  get mcp(): McpServer {
    return this.server;
  }

  get toolNames(): readonly string[] {
    return this.tools.map((t) => t.name);
  }
}
