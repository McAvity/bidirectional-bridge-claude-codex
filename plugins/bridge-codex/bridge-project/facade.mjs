// The facade MCP server: what the project dispatcher serves when the pinned runtime is not
// installed here yet.
//
// Its tool catalogue is **static**. A host that never re-reads a tool list still sees the same
// two tools before and after preparation, so nothing depends on `notifications/tools/list_changed`
// — the dependency W14-01 could not measure. The facade owns no database, no lease, no manager
// identity and no domain state; it can only report and prepare.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BootstrapRefusal, prepare } from "./bootstrap.mjs";
import { status } from "./locate.mjs";

export const SERVER_INFO = { name: "claude-codex-bridge-facade", version: "1" };

export const TOOLS = [
  {
    name: "bridge_status",
    description:
      "Report this worktree, the pinned runtime, the selected runtime and where the instruction set lives. Read-only: it claims no manager and writes nothing.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "bridge_prepare_worktree",
    description:
      "Prepare this worktree for the bridge after the user asked for it. Writes the portable project declaration, the managed MCP block and the ignore block, under an exclusive lock. Requires the resolved workspace to be passed back explicitly.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string", description: "Absolute worktree root, exactly as bridge_status reported it." },
        confirm: { type: "boolean", description: "Must be true: preparation is an instructed operation, never a side effect." },
        runtime_id: { type: "string", description: "Runtime id to pin when the project declares none yet." },
        dry_run: { type: "boolean" },
      },
      required: ["workspace", "confirm"],
      additionalProperties: false,
    },
  },
];

function dispatcherSources() {
  const here = dirname(fileURLToPath(import.meta.url));
  const out = {};
  for (const name of ["dispatch.mjs", "locate.mjs", "bootstrap.mjs", "facade.mjs"]) {
    out[name] = readFileSync(join(here, name), "utf8");
  }
  return out;
}

export function callTool(name, args, { cwd = process.cwd(), env = process.env } = {}) {
  if (name === "bridge_status") {
    return { ok: true, payload: status(cwd, env) };
  }
  if (name === "bridge_prepare_worktree") {
    if (args?.confirm !== true) {
      return { ok: false, payload: { code: "NOT_CONFIRMED", message: "preparation requires confirm: true" } };
    }
    const resolved = status(cwd, env);
    if (typeof args.workspace !== "string" || args.workspace !== resolved.workspace.root) {
      return {
        ok: false,
        payload: {
          code: "WORKSPACE_MISMATCH",
          message: `this server resolved ${resolved.workspace.root}; the call named ${args?.workspace ?? "nothing"}`,
          next_step: "call bridge_status and pass back the workspace it reports",
        },
      };
    }
    try {
      return {
        ok: true,
        payload: prepare({
          cwd,
          env,
          pin: args.runtime_id ? { runtime_id: args.runtime_id } : undefined,
          dryRun: args.dry_run === true,
          sources: dispatcherSources(),
        }),
      };
    } catch (error) {
      if (error instanceof BootstrapRefusal) {
        return { ok: false, payload: { code: error.code, message: error.message, next_step: error.nextStep } };
      }
      throw error;
    }
  }
  return { ok: false, payload: { code: "UNKNOWN_TOOL", message: `no tool named ${name}` } };
}

/** One JSON-RPC message in, zero or one message out. Pure, so it can be tested directly. */
export function handle(message, context = {}) {
  const { id, method, params } = message ?? {};
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions:
          "The pinned bridge runtime is not installed on this machine yet. Call bridge_status to see the pin, then bridge_prepare_worktree when the user asks to enable the bridge here.",
      },
    };
  }
  if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  if (method === "tools/call") {
    const { ok, payload } = callTool(params?.name, params?.arguments ?? {}, context);
    return {
      jsonrpc: "2.0",
      id,
      result: { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], isError: !ok },
    };
  }
  if (id === undefined) return null; // a notification
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } };
}

export function serve({ input = process.stdin, output = process.stdout, context = {} } = {}) {
  let buffer = "";
  input.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      let reply;
      try {
        reply = handle(message, context);
      } catch (error) {
        reply = message.id === undefined ? null : { jsonrpc: "2.0", id: message.id, error: { code: -32603, message: String(error?.message ?? error) } };
      }
      if (reply) output.write(`${JSON.stringify(reply)}\n`);
    }
  });
}
