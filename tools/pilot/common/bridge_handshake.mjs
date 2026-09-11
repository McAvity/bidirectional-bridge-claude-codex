// Preflight (operator-only): start the bridge MCP server of this checkout exactly as Codex will
// (same launcher, caller, delegation, workspace) but with a throwaway database, list its tools and
// read its bound identity. Starts no agent and writes nothing into the pilot repo.
// Usage: node bridge_handshake.mjs <repo> <tmp-db-path>   (run `npm run build` first)
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [repo, db] = process.argv.slice(2);
const launcher = resolve(dirname(fileURLToPath(import.meta.url)), '../../../scripts/native-bridge-mcp.mjs');
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [launcher, '--caller', 'codex', '--delegation', 'allow', '--workspace', repo, '--db', db],
  cwd: repo, stderr: 'pipe',
});
const client = new Client({ name: 'pilot-preflight', version: '1' });
let stderr = '';
transport.stderr?.on('data', b => { stderr += b; });
const result = { ok: false };
try {
  await client.connect(transport);
  const tools = (await client.listTools()).tools.map(t => t.name).sort();
  const info = JSON.parse((await client.callTool({ name: 'bridge_server_info', arguments: {} })).content[0].text);
  const snapshot = JSON.parse((await client.callTool({ name: 'bridge_snapshot', arguments: {} })).content[0].text);
  const feature = tools.filter(t => t.startsWith('bridge_feature_'));
  Object.assign(result, {
    tool_count: tools.length, feature_tools: feature, server_info: info,
    adapters: snapshot.adapters ?? snapshot.adapter_health ?? null,
    ok: info.caller === 'codex' && info.delegation === 'allow' && feature.length === 6,
  });
} catch (error) {
  result.error = String(error);
} finally {
  await client.close();
  result.stderr_tail = stderr.split('\n').slice(-5).join('\n');
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}
