#!/usr/bin/env python3
"""Operator-only preparation for a separately budgeted continuation. No R1 replay.
prepare/preflight never start Codex, Claude or a bridge server against retained DBs.
"""
import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path
import sqlite3
import sys
import time
import pilot
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'common'))
from codex_args import sessions, is_manager_meta

SCOPE = 'wave10-retained-r1-continuation-v2'
BUDGET = {'claude_rounds': 2, 'claude_max_turns_per_invocation': 32,
          'a_r2_ms': 2700000, 'b_r2_ms': 2700000, 'mcp_seconds': 3300,
          'gate_seconds': 1500, 'operator_seconds': 1200, 'gate_bash_ms': 1800000,
          'astra_a_turns': 3, 'astra_b_turns': 2, 'foreign_turns': 1,
          'wall_minutes': 90, 'latest_b_r2_start_minutes': 30, 'astra_turns_are_planning_only': True,
          'automatic_retries': 0, 'extra_recovery': 0, 'additional_api_spend_usd': 0}
COUNTER_NOTICE = '''Approved continuation budget: use spec.max_turns=32 only for each remaining R2, enforced by the runner's
--max-turns. Do not compare bridge turn_count / result num_turns with that ceiling.
In successful Claude CLI 2.1.269 results num_turns counts initial/user-role messages,
including separate tool results; streamed blocks may share one assistant message.id.
The prior R1 result 18 was 1 initial prompt + 17 tool results, with 12 distinct
assistant responses, 11 containing tool_use. Keep all these fields distinct.
A real max-turns termination, timeout, denial or failed attempt remains STOP.
Do not repeat R1 or its review. This is a separately timed continuation after a gap.
'''


def read_db(repo):
    db = repo / '.bridge/bridge.db'
    with sqlite3.connect(db.as_uri() + '?mode=ro', uri=True) as c:
        c.row_factory = sqlite3.Row
        if c.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise ValueError('database integrity failed')
        binding = dict(c.execute('SELECT * FROM manager_binding').fetchone())
        features = c.execute('SELECT json FROM features').fetchall()
        if len(features) != 1: raise ValueError('expected one retained feature')
        feature = json.loads(features[0][0])
        attempts = [dict(x) for x in c.execute("SELECT * FROM task_attempts WHERE agent='claude' ORDER BY started_at")]
        logical = hashlib.sha256('\n'.join(c.iterdump()).encode()).hexdigest()
    return {'binding': binding, 'feature': feature, 'attempts': attempts, 'logical_sha256': logical}


def waiting(state):
    f = state['feature']
    return (f['feature_id'] == 'F-W10-pair' and f['state'] == 'waiting_user'
            and f['question'] == {'id': 'q1', 'text': 'Which suffix should round 2 use?', 'answer': None}
            and f['active_task_id'] is None and all(x['ended_at'] is not None for x in state['attempts']))


def audit(root):
    manifest = pilot.preflight(root)
    result = {'claude_version': pilot.run(['claude','--version']),
              'claude_binary_sha256': pilot.digest(Path(shutil.which('claude')).resolve()),
              'runtime_sha': manifest['runtime_sha'], 'runtime_build_sha256': manifest['runtime_build_sha256'], 'pairs': {}}
    for pair in ('a', 'b'):
        repo = root/pair
        s = read_db(repo)
        if not waiting(s) or len(s['attempts']) != 1 or s['attempts'][0]['outcome'] != 'COMPLETE':
            raise ValueError('not the retained successful R1 waiting_user baseline')
        if s['binding']['active_instance_id'] is not None:
            raise ValueError('manager is still active')
        sid = s['binding']['native_thread_id']
        if sid != (root/f'session-{pair}.txt').read_text().strip():
            raise ValueError('session file differs from native binding')
        matches = [path for _, ident, path in sessions(repo) if ident == sid]
        if len(matches) != 1: raise ValueError('exact Codex rollout missing or ambiguous')
        with matches[0].open() as f: meta = json.loads(f.readline())['payload']
        if not is_manager_meta(meta): raise ValueError('not an original Codex TUI session')
        handle = s['attempts'][0]['execution_handle']
        paths = list((Path.home()/'.claude/projects').glob('*/'+handle+'.jsonl'))
        if len(paths) != 1: raise ValueError('exact Claude transcript missing or ambiguous')
        if pilot.git(repo, 'status', '--porcelain'): raise ValueError('retained worktree is not clean')
        namespace = manifest['namespaces'][pair]['workspace_key']
        package = root/'exchange'/namespace/'packages/r1.zip'
        if (package.parent/'r2.zip').exists() or (repo/'.pilot/gate-ready').exists() or (repo/'.pilot/round2-started').exists():
            raise ValueError('R2 evidence already exists')
        head = pilot.git(repo, 'rev-parse', 'HEAD')
        pilot.run([sys.executable, root/'runtime/.agents/skills/feature-exchange/scripts/feature_exchange.py',
                   'verify', '--repo', repo, '--archive', package, '--expect-feature', 'docs/features/F-W10-pair',
                   '--expect-purpose', 'implementation-review', '--expect-base', manifest['fixture_heads'][pair], '--expect-head', head])
        result['pairs'][pair] = {**s, 'head': head, 'package_sha256': pilot.digest(package),
            'namespace': namespace, 'codex_rollout': str(matches[0]), 'codex_rollout_sha256': pilot.digest(matches[0]),
            'claude_transcript': str(paths[0]), 'claude_transcript_sha256': pilot.digest(paths[0])}
    a,b = (result['pairs'][p] for p in ('a','b'))
    if a['binding']['native_thread_id'] == b['binding']['native_thread_id'] or a['attempts'][0]['execution_handle'] == b['attempts'][0]['execution_handle']:
        raise ValueError('session collision')
    return result


def prepare(root, out):
    if out.exists(): raise ValueError('use a new continuation directory; never overwrite')
    baseline = audit(root)
    out.mkdir(parents=True, mode=0o700)
    prompts = {}
    for p in ('a','b'):
        prompts[f'BOOT-{p.upper()}.txt'] = COUNTER_NOTICE + f'''Resume manager {p.upper()} in this exact native session.
Read bridge_manager_status. If detached/fenced, explicitly resume this manager instance
with the observed expected_epoch and expected_generation. No takeover or task recovery.
Read feature F-W10-pair and confirm retained waiting_user/q1 unanswered, prior R1 task
and Claude session. Report the exact native thread ID and stop. No user answer, round,
new feature, new manager root, review of R1 or package rewrite. Stop on any mismatch.
'''
        round_prompt = (root/f'ROUND2-{p.upper()}.txt').read_text().replace('spec.max_turns=12','spec.max_turns=32').replace('deadline_ms=480000','deadline_ms=2700000').replace('deadline_ms=1200000','deadline_ms=2700000').replace('timeout=600000','timeout=1800000').replace('540 seconds','1500 seconds')
        if p=='b':
            round_prompt = round_prompt.replace('`python3 gate.py`','`python3 .pilot/gate-continuation-v2.py`')
        prompts[f'ROUND2-{p.upper()}.txt'] = COUNTER_NOTICE + 'This approved instruction supersedes old timing/max_turns and B gate.py instructions in TASK.md and previous prompts. Do not use the old 540-second B gate. Runtime environment supplies BASH_MAX_TIMEOUT_MS=1800000 and disables auto-backgrounding; wait for the gate command to complete. Release is immediate when A starts, not a required delay.\n' + round_prompt
    for p in ('a','b'):
        prompts[f'STATUS-{p.upper()}.txt'] = COUNTER_NOTICE + 'Read bridge_manager_status and bridge_feature_get for F-W10-pair. Report current identity, question and round state. Finish any pending review of the existing R2 delivery if appropriate, but never launch or repeat a worker round, answer q1 again, take over or run task recovery. If only explicit resume of this exact manager instance is needed, use the observed epoch/generation. Stop on mismatch.\n'
    prompts['RESTART-A.txt'] = COUNTER_NOTICE + (root/'RESUME-A.txt').read_text()
    # All prepared inputs use the same multiline PTY paste path verified in R1.
    prompts['FOREIGN.txt'] = 'Foreign-manager probe only; no worker or takeover.\n' + (root/'FOREIGN.txt').read_text() + '\n'
    for name, text in prompts.items(): pilot.write(out/name, text)
    gate = root/'b/.pilot/gate-continuation-v2.py'
    gate_text = pilot.gate_source().replace(' + 540', ' + 1500')
    if gate.exists():
        if gate.read_text() != gate_text: raise ValueError('continuation gate already differs')
    else:
        pilot.write(gate, gate_text)
    m = {'scope': SCOPE, 'budget': BUDGET, 'original_run': str(root),
         'operator_sha': pilot.git(pilot.SOURCE, 'rev-parse', 'HEAD'),
         'operator_file_sha256': pilot.digest(Path(__file__)), 'gate_sha256': pilot.digest(gate), 'baseline': baseline,
         'prompt_sha256': {n: pilot.digest(out/n) for n in prompts}, 'original_v2_uninterrupted': False}
    pilot.write(out/'manifest.json', json.dumps(m, indent=2)+'\n')
    pilot.write(out/'approval.example.json', json.dumps({'approved': False, 'scope': SCOPE,
        'manifest_sha256': pilot.digest(out/'manifest.json'), 'budget': BUDGET,
        'subscription_only_confirmed': True}, indent=2))
    if audit(root) != baseline: raise ValueError('retained state changed during preparation')
    print('CONTINUATION PREPARED; no models, original state unchanged, approval pending')


def preflight(out):
    m = json.loads((out/'manifest.json').read_text())
    if m['scope'] != SCOPE or m['budget'] != BUDGET: raise ValueError('scope/budget mismatch')
    if m['operator_file_sha256'] != pilot.digest(Path(__file__)): raise ValueError('operator code changed')
    for name, digest in m['prompt_sha256'].items():
        if pilot.digest(out/name) != digest: raise ValueError('prepared prompt changed')
    if pilot.digest(Path(m['original_run'])/'b/.pilot/gate-continuation-v2.py') != m['gate_sha256']: raise ValueError('continuation gate changed')
    if audit(Path(m['original_run'])) != m['baseline']: raise ValueError('retained baseline drifted')
    return m


def command(out, m, role):
    if role not in ('a-initial', 'b-initial', 'a-restart', 'foreign'): raise ValueError('unsupported role')
    root = Path(m['original_run']); pair = 'b' if role == 'b-initial' else 'a'; repo = root/pair
    config = {'command': 'node', 'args': [str(root/'runtime/scripts/native-bridge-mcp.mjs'),
        '--caller', 'codex', '--delegation', 'deny' if role == 'foreign' else 'allow', '--workspace', str(repo)],
        'cwd': str(repo), 'startup_timeout_sec': 1200, 'tool_timeout_sec': BUDGET['mcp_seconds'],
        'env': {'BASH_MAX_TIMEOUT_MS': str(BUDGET['gate_bash_ms']), 'CLAUDE_CODE_DISABLE_BACKGROUND_TASKS': '1'}}
    args = ['codex', '--no-alt-screen', '-m', 'gpt-6-astra', '-C', str(repo), '-c', 'model_reasoning_effort="high"']
    for key,value in config.items():
        if isinstance(value,dict):
            for name,item in value.items(): args += ['-c','mcp_servers.bridge.'+key+'.'+name+'='+json.dumps(item)]
        else:
            args += ['-c', 'mcp_servers.bridge.'+key+'='+json.dumps(value)]
    args += ['-c', 'notify='+json.dumps(['env', 'PILOT_NOTIFY_DRY=1',
        'PILOT_NOTIFY_LOG='+str(out/'operator/notify.jsonl'), 'bash', str(root/'runtime/tools/pilot/common/notify.sh')])]
    if role != 'foreign': args += ['resume', m['baseline']['pairs'][pair]['binding']['native_thread_id']]
    return args



def check_worker_state(state, original):
    if (state['binding']['native_thread_id'] != original['binding']['native_thread_id']
            or state['binding']['epoch'] != original['binding']['epoch']):
        raise ValueError('manager identity/epoch changed')
    attempts = state['attempts']
    # Runner-enforced failures stop the continuation. Successful num_turns is raw
    # telemetry, not the executor ceiling and never an operator stop comparison.
    if len(attempts) > 2 or any(a['outcome'] not in (None, 'COMPLETE') for a in attempts):
        raise ValueError('failed or extra worker attempt; STOP')
    handles = {a['execution_handle'] for a in attempts if a['execution_handle']}
    if handles != {original['attempts'][0]['execution_handle']}:
        raise ValueError('Claude session changed')


def serve(out):
    from tui_operator import Client
    m = preflight(out)
    expected = {'approved': True, 'scope': SCOPE, 'manifest_sha256': pilot.digest(out/'manifest.json'),
                'budget': BUDGET, 'subscription_only_confirmed': True}
    if json.loads((out/'approval.json').read_text()) != expected: raise ValueError('continuation approval required')
    folder=out/'operator'; folder.mkdir(mode=0o700, exist_ok=False); (folder/'inbox').mkdir()
    root=Path(m['original_run']); clients={}; seen=set(); used=set(); count={'a':0,'b':0,'foreign':0}
    started=time.monotonic(); pilot.write(folder/'started-at.txt', str(time.time()))
    log=(folder/'actions.jsonl').open('x', buffering=1)
    def event(kind, **data): log.write(json.dumps({'at':time.time(),'kind':kind,**data})+'\n')
    try:
        while True:
            if time.monotonic()-started >= BUDGET['wall_minutes']*60: raise ValueError('continuation 90 minute deadline')
            for c in clients.values():
                c.poll()
                if c.exited and not c.closing: raise ValueError('unexpected TUI exit')
                if c.closing and not c.exited and time.monotonic()-c.close_started>BUDGET['operator_seconds']: raise ValueError('close deadline')
            for p in ('a','b'):
                s=read_db(root/p)
                check_worker_state(s,m['baseline']['pairs'][p])
                if p=='b' and len(s['attempts'])==2:
                    worker_start=s['attempts'][-1]['started_at']/1000
                    gate=root/'b/.pilot/gate-ready'
                    if gate.exists() and not (root/'b/.pilot/continue').exists() and time.time()-float(gate.read_text())>BUDGET['operator_seconds']:
                        raise ValueError('operator gate window expired')
            for f in sorted((folder/'inbox').glob('*.json')):
                if f.name in seen: continue
                seen.add(f.name); a=json.loads(f.read_text()); kind=a['action']; role=a.get('client'); event('action', request=a)
                if kind=='start':
                    if role in clients: raise ValueError('no replacement clients')
                    if role=='a-restart' and ('a-initial' not in clients or not clients['a-initial'].exited): raise ValueError('A must close normally')
                    clients[role]=Client(command(out,m,role),folder,role,turn_limit=1 if role=='foreign' else None)
                elif kind=='prompt':
                    allowed={'a-initial':['BOOT-A.txt','STATUS-A.txt'], 'b-initial':['BOOT-B.txt','ROUND2-B.txt','STATUS-B.txt'],
                             'a-restart':['RESTART-A.txt','ROUND2-A.txt','STATUS-A.txt'], 'foreign':['FOREIGN.txt']}
                    name=a['file']; key=(role,name)
                    if name not in allowed[role] or (key in used and not name.startswith('STATUS-')): raise ValueError('unapproved/repeated prompt')
                    who='foreign' if role=='foreign' else role[0]; limit={'a':3,'b':2,'foreign':1}[who]
                    if who=='foreign' and count[who]>=1: raise ValueError('one foreign probe only')
                    if name=='ROUND2-B.txt' and time.monotonic()-started>BUDGET['latest_b_r2_start_minutes']*60: raise ValueError('B/r2 latest start')
                    clients[role].send_prompt((out/name).read_text()); count[who]+=1; used.add(key)
                elif kind=='close': clients[role].close()
                elif kind=='release':
                    gate=root/'b/.pilot/gate-ready'; marker=root/'a/.pilot/round2-started'
                    b=read_db(root/'b')
                    if not marker.exists() or not gate.exists() or time.time()-float(gate.read_text())>BUDGET['operator_seconds']:
                        raise ValueError('release markers/window invalid')
                    if len(b['attempts'])!=2 or b['attempts'][-1]['ended_at'] is not None: raise ValueError('B not active')
                    with (root/'b/.pilot/continue').open('x') as h:h.write(str(time.time()))
                elif kind=='stop': event('stopped', reason=a['reason']); return
                else: raise ValueError('unsupported action')
                event('completed', request=f.name)
            pilot.write(folder/'status.json', json.dumps({'counts':count,'clients':{k:{'exited':c.exited,'closing':c.closing,'turns_sent':c.turns} for k,c in clients.items()}},indent=2))
            time.sleep(.2)
    except Exception as e:
        event('blocked',reason=str(e));raise
    finally:
        for c in clients.values():c.stop()
        log.close()


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('action',choices=['prepare','preflight','commands','serve']);p.add_argument('--out',type=Path,required=True);p.add_argument('--run',type=Path)
    a=p.parse_args();out=a.out.resolve()
    if a.action=='prepare':prepare(a.run.resolve(),out)
    elif a.action=='preflight':preflight(out);print('READ-ONLY PREFLIGHT PASS; native resume still UNVERIFIED')
    elif a.action=='commands':
        m=preflight(out);print(json.dumps({r:command(out,m,r) for r in ('a-initial','b-initial','a-restart','foreign')},indent=2))
    else:serve(out)

if __name__=='__main__':main()
