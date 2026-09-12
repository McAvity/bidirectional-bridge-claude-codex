// Operator-only real stdio handshake against the pinned runtime; never invokes a model.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const launcher = resolve(dirname(fileURLToPath(import.meta.url)), '../../../scripts/native-bridge-mcp.mjs');
const workspaces = process.argv.slice(2);
if (workspaces.length !== 2 || new Set(workspaces.map(p => resolve(p))).size !== 2) {
  throw new Error('provide exactly two distinct prepared worktrees');
}
const watchdog = setTimeout(() => { process.stderr.write('handshake deadline exceeded\n'); process.exit(1); }, 20000);
const results = await Promise.all(workspaces.map(async workspace => {
  const state = resolve(workspace, '.bridge');
  if (existsSync(state)) throw new Error('handshake requires an unused pilot worktree');
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [launcher, '--caller', 'codex', '--delegation', 'allow', '--workspace', workspace],
    cwd: workspace, stderr: 'pipe' });
  const client = new Client({ name: 'wave10-operator-handshake', version: '1' });
  let stderr = '';
  transport.stderr?.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
  const result = { workspace, ok: false };
  async function call(name, args = {}) {
    const response = await client.callTool({ name, arguments: args });
    if (response.isError) throw new Error(JSON.stringify(response));
    return JSON.parse(response.content[0].text);
  }
  try {
    await client.connect(transport);
    const names = (await client.listTools()).tools.map(t => t.name);
    const info = await call('bridge_server_info');
    const status = await call('bridge_manager_status');
    const needed = ['bridge_feature_run', 'bridge_feature_wait_user', 'bridge_feature_answer_user',
      'bridge_resume_delegated_task', 'bridge_manager_resume_instance', 'bridge_manager_takeover'];
    if (!needed.every(name => names.includes(name))) throw new Error('required tools missing');
    if (info.caller !== 'codex' || info.delegation !== 'allow') throw new Error('wrong server identity');
    if (status.manager !== null || status.workspace.bound !== false) throw new Error('unexpected binding');
    Object.assign(result, { ok: true, tools: names.length, info, unbound: true });
  } catch (error) { result.error = String(error); }
  finally {
    await client.close();
    result.no_state_created = !existsSync(state);
    result.ok &&= result.no_state_created;
    result.stderr_tail = stderr;
  }
  return result;
}));
clearTimeout(watchdog);
console.log(JSON.stringify({ models_run: false, results, ok: results.every(r => r.ok) }, null, 2));
process.exitCode = results.every(r => r.ok) ? 0 : 1;
