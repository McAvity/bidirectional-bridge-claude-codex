#!/usr/bin/env node
// Model-free MCP recorder used by the W14-01 host probes.
//
// It answers just enough of the MCP handshake for a host to consider the server
// started, and appends one JSON line per event to the file named by
// `--record <path>`. The path is an argument, not an environment variable,
// because Codex starts plugin MCP servers with a stripped environment
// (see docs/features/F-W14-plugin-distribution/evidence/W14-01/).
//
// Recorded: the process working directory, argv, the inherited environment
// (secret-looking names removed) and every JSON-RPC message the host sends.

import { appendFileSync } from "node:fs";

const argv = process.argv.slice(2);
const recordIndex = argv.indexOf("--record");
const recordPath = recordIndex >= 0 ? argv[recordIndex + 1] : null;
const SECRET = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH/i;

function record(entry) {
  if (!recordPath) return;
  try {
    appendFileSync(recordPath, `${JSON.stringify(entry)}\n`);
  } catch {
    // A probe recorder must never take the host down.
  }
}

record({
  ev: "start",
  at: new Date().toISOString(),
  cwd: process.cwd(),
  argv: process.argv.slice(1),
  env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !SECRET.test(k))),
});

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

let buffer = "";
process.stdin.on("data", (chunk) => {
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
      record({ ev: "unparsed", line });
      continue;
    }
    record({ ev: "in", at: new Date().toISOString(), msg: message });
    if (message.method === "initialize") {
      reply(message.id, {
        protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "w14-probe-recorder", version: "0.1.0" },
      });
    } else if (message.method === "tools/list") {
      reply(message.id, {
        tools: [
          {
            name: "probe_record",
            description: "W14 probe recorder; performs no work.",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      });
    } else if (message.id !== undefined) {
      reply(message.id, {});
    }
  }
});
