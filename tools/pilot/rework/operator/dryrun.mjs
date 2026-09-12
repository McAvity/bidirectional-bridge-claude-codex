// DRY RUN of the rework-test TOOLING — not the rework test and not evidence about any model.
// A scripted coordinator and a scripted executor (fakebin/claude) drive THIS checkout's real bridge
// through: setup → round 1 → placeholder review PASS → inject_regression.py (real) → re-check
// request → placeholder REWORK → correction round in the same session → placeholder PASS →
// collect_rework.py final. Reviews here are placeholders written by the script, not reviews.
// Every file (run, results, synthetic Codex rollout, stand-in transcripts) lives under <new-dir>.
//
//   npm ci --ignore-scripts && npm run build      (once, in this checkout)
//   node tools/pilot/rework/operator/dryrun.mjs <new-directory-outside-the-checkout>
// Exit code 0 only when every RC criterion is PASS.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const OUT = resolve(process.argv[2] ?? '');
if (!process.argv[2] || existsSync(OUT)) throw new Error('usage: node dryrun.mjs <new-directory>');
const RUN = resolve(OUT, 'run'), RES = resolve(RUN, 'operator-results'), SESS = resolve(OUT, 'codex-sessions');
const TRANSCRIPTS = resolve(OUT, 'claude-projects');
const REPO = resolve(RUN, 'repo'), EXCH = resolve(RUN, 'exchange');
const FID = 'F-001-duration', F = `docs/features/${FID}`;
const BRIDGE = resolve(ROOT, 'scripts/native-bridge-mcp.mjs');
const PATH_WITH_FAKE = `${resolve(HERE, 'fakebin')}:${process.env.PATH}`;
const ENV = { ...process.env, PATH: PATH_WITH_FAKE, PILOT_CODEX_SESSIONS: SESS, PILOT_CLAUDE_PROJECTS: TRANSCRIPTS };
const py = (script, ...a) => spawnSync('python3', [resolve(HERE, script), ...a], { encoding: 'utf8', env: ENV });
const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8' }).trim();
const coord = (paths, message) => { git('add', '--', ...paths); git('-c', 'user.name=astra-codex', '-c', 'user.email=astra-codex@pilot.invalid', 'commit', '-q', '-m', message); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = m => console.log(`[${new Date().toISOString()}] ${m}`);

mkdirSync(OUT, { recursive: true });
const setup = py('setup_rework.py', '--dest', RUN);
if (setup.status) throw new Error(setup.stderr);
const TRIGGER = execFileSync('python3', ['-c', 'import collect_rework; print(collect_rework.TRIGGER)'], { cwd: HERE, encoding: 'utf8' }).trim();

// Synthetic manager rollout (same format as Codex); only this dry run reads it.
const ROLL = resolve(SESS, '2026/01/01/rollout-2026-01-01T00-00-00-dryrun-manager.jsonl');
mkdirSync(dirname(ROLL), { recursive: true });
const rec = (type, payload) => appendFileSync(ROLL, JSON.stringify({ timestamp: new Date().toISOString(), type, payload }) + '\n');
rec('session_meta', { id: 'dryrun-manager', timestamp: new Date().toISOString(), cwd: REPO, source: 'cli', originator: 'codex-tui' });
const userMsg = text => { rec('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }); rec('event_msg', { type: 'task_started' }); };
const turnEnd = text => rec('event_msg', { type: 'task_complete', last_agent_message: text });

const client = new Client({ name: 'rework-dryrun', version: '1' });
await client.connect(new StdioClientTransport({
  command: process.execPath, cwd: REPO, stderr: 'pipe',
  args: [BRIDGE, '--caller', 'codex', '--delegation', 'allow', '--workspace', REPO],
  env: { ...process.env, PATH: PATH_WITH_FAKE, DRYRUN_TRANSCRIPTS: TRANSCRIPTS,
         GIT_AUTHOR_NAME: 'claude-executor', GIT_AUTHOR_EMAIL: 'claude-executor@pilot.invalid',
         GIT_COMMITTER_NAME: 'claude-executor', GIT_COMMITTER_EMAIL: 'claude-executor@pilot.invalid' },
}));
const call = async (name, a) => {
  // Synthetic host envelope for this scripted tooling check, not identity evidence from Codex.
  const _meta = { threadId: 'dryrun-manager', 'x-codex-turn-metadata': {
    session_id: 'dryrun-manager', thread_id: 'dryrun-manager', codex_version: '0.154.0',
  } };
  const r = await client.callTool({ name, arguments: a, _meta }, undefined, { timeout: 600_000 });
  if (r.isError) throw new Error(`${name}: ${r.content?.[0]?.text}`);
  return JSON.parse(r.content[0].text);
};
async function round(n, lines) {
  const base = git('rev-parse', 'HEAD');
  const pkg = resolve(EXCH, `${FID}-r${String(n).padStart(2, '0')}.zip`);
  const spec = {
    objective: [`Feature ${FID}, runda ${n}, task F-001-T01. Autoryzacja: ${F}/decisions/01.md. DRY RUN.`, ...lines,
      `Ledger: nowy plik w katalogu ${F}/execution/F-001-T01/ (kolejny wolny numer).`,
      `Paczka rundy: purpose implementation-review, --base ${base}, --output ${pkg}.`].join('\n'),
    scope: { paths: ['src/textkit/**', 'tests/**', `${F}/execution/**`] }, dependencies: [],
    expected_deliverable: 'package, ledger, commit', verification_criteria: ['unit tests pass'], max_turns: 10,
  };
  await call('bridge_feature_run', { feature_id: FID, spec, input_artifacts: [], deadline_ms: 600_000, idempotency_key: `${FID}:round-${n}` });
  let f;
  do { await sleep(1500); f = await call('bridge_feature_get', { feature_id: FID }); } while (f.state === 'running');
  log(`round ${n} -> ${f.state} ${f.latest_task_id}`);
  return f.latest_task_id;
}
const review = (nn, verdict, task, extra = '') => {
  const p = `${F}/reviews/${nn}-implementation.md`;
  mkdirSync(resolve(REPO, dirname(p)), { recursive: true });
  writeFileSync(resolve(REPO, p), `# Review ${nn} (DRY RUN placeholder — not a review)\n\n${verdict}: scripted placeholder for task ${task}.${extra}\n`);
  coord([p], `dry run: placeholder review ${nn}`);
};

try {
  userMsg('DRY RUN start order');
  const root = await call('bridge_create_task', { spec: { objective: `Coordinate ${FID}`, scope: { paths: [`${F}/reviews/**`, `${F}/decisions/**`, `${F}/feature.json`] },
    dependencies: [], expected_deliverable: 'reviewed feature', verification_criteria: ['owner cases'] }, idempotency_key: `${FID}:root` });
  const rootId = root.task_id ?? root.task?.task_id;
  await call('bridge_claim_task', { task_id: rootId, idempotency_key: `${FID}:root-claim` });
  await call('bridge_set_state', { task_id: rootId, to: 'WORKING', reason: 'dry run' });
  await call('bridge_feature_create', { feature_id: FID, parent_task_id: rootId });
  mkdirSync(resolve(REPO, `${F}/decisions`), { recursive: true });
  writeFileSync(resolve(REPO, `${F}/decisions/01.md`), '# Decyzja 01 (DRY RUN)\n');
  coord([`${F}/decisions/01.md`], 'dry run: authorization placeholder');
  const t1 = await round(1, ['Zrealizuj T01.']);
  review('01', 'PASS', t1);
  turnEnd('DRY RUN: report after round 1');

  const dry = py('inject_regression.py', '--run', RUN, '--dry-run');
  if (dry.status) throw new Error('intervention dry run refused: ' + dry.stdout.slice(-600));
  log(`inject --dry-run exit ${dry.status}`);
  // The scripted run is quiescent by construction: the coordinator waits, no round runs.
  const inj = py('inject_regression.py', '--run', RUN, '--repo-quiescent');
  log(`inject exit ${inj.status}: ${inj.stdout.trim().split('\n').pop()} ${inj.stderr.trim()}`);
  if (inj.status) throw new Error('intervention refused');

  userMsg(TRIGGER);
  review('02', 'REWORK', t1, ' F1: AC-03 violated at HEAD (placeholder).');
  const t2 = await round(2, ['Runda poprawek: F1 (placeholder).']);
  review('03', 'PASS', t2, ' F1 resolved (placeholder).');
  turnEnd('DRY RUN: report after correction');
} finally {
  await client.close();
}
const fin = py('collect_rework.py', 'final', '--run', RUN);
console.log(fin.stdout, fin.stderr);
writeFileSync(resolve(OUT, 'DRYRUN.md'), `# Dry run of rework-test tooling (${new Date().toISOString()})\n\nScripted coordinator and executor; not a test of any model.\n\n${fin.stdout}\n`);
const rows = fin.stdout.split('\n').filter(l => l.startsWith('| RC-'));
process.exitCode = fin.status === 0 && rows.length === 16 && rows.every(l => l.trimEnd().endsWith('| PASS |')) ? 0 : 1;
