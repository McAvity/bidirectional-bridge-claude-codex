"""Evidence collector for bridge pilots (operator-only, read-only). Shared library for the scenario
collectors; its own `final` scores the full-loop pilot scenario (F-001-duration with CLI and Q-01).

  python3 collect.py snapshot <label> --pilot DIR   record bridge state and processes at a moment
  python3 collect.py final --pilot DIR              gather all evidence and score mechanical criteria

Options: --pilot DIR (required: directory created by a scenario setup), --results DIR (default
         DIR/operator-results),
         --side-question TEXT (fragment of the user's side question that must not reach Claude),
         --manager-session ID (only when the manager session is ambiguous), --tag T (evidence-T.json).
Only the top-level interactive Codex session (source=cli, originator=codex-tui) is the manager;
guardian/auto-review sessions are auxiliary and reported separately, with incidents.
The collector never calls a bridge tool, never starts an agent, never writes into the pilot
repo and never judges review quality: criteria needing judgement are listed for the operator.
"""
import argparse
import fnmatch
import glob
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import codex_args  # noqa: E402  (shared manager-session predicate)

COLLECTOR_VERSION = 4
# Path fragments of operator material; an agent reading them is reported (never blocked).
CONTAMINATION = ['tools/pilot/', 'operator-results', 'EXPECTED.md', 'check_cases', 'reference/src', 'OPERATOR.md', 'PLAN.md']
INJECTED_PREFIXES = ('<', '# AGENTS.md', '# Context from my IDE')


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def ms_to_iso(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat(timespec='milliseconds') if ms else None


def ref(value):
    return hashlib.sha256(value.encode()).hexdigest()[:12] if value else None


def run(*cmd, cwd=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)


# ── bridge database (read-only) ───────────────────────────────────────────────
def open_db(repo):
    path = repo / '.bridge/bridge.db'
    if not path.exists():
        return None
    db = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    return db


def bridge_state(db):
    if db is None:
        return {'exists': False}
    features = [json.loads(r['json']) for r in db.execute('select json from features')]
    attempts = [dict(r) for r in db.execute('select task_id, attempt, resumed_from_attempt, execution_handle, started_at, ended_at, outcome from task_attempts order by started_at')]
    for a in attempts:
        a['execution_ref'] = ref(a.pop('execution_handle'))
    return {'exists': True, 'features': features, 'attempts': attempts,
            'open_attempts': sum(a['ended_at'] is None for a in attempts)}


def processes(repo):
    lines = run('pgrep', '-af', 'native-bridge-mcp').stdout.splitlines()
    bridge = [l for l in lines if str(repo) in l and 'pgrep' not in l]
    claude = [l.split()[0] for l in run('pgrep', '-af', 'claude -p').stdout.splitlines() if 'pgrep' not in l]

    def cwd(pid):
        try:
            return os.readlink(f'/proc/{pid}/cwd')
        except OSError:
            return None
    in_repo = [pid for pid in claude if (cwd(pid) or '').startswith(str(repo))]
    return {'bridge_pids': [l.split()[0] for l in bridge], 'claude_p_pids': claude, 'claude_p_pids_in_repo': in_repo}


def ts_ms(value):
    """Instant in epoch ms from Codex ('…Z'), bridge/snapshot ('…+00:00'), local ('…+02:00') or ms."""
    if value is None or isinstance(value, (int, float)):
        return value
    return int(datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp() * 1000)


# ── Codex sessions of the pilot repo ─────────────────────────────────────────
# Every rollout whose cwd is the pilot repo is read, but only the top-level interactive session
# (codex_args.is_manager_meta: source=cli, originator=codex-tui) is the manager. Guardian /
# auto-review sessions (source.subagent) are auxiliary: their prompts are not user messages, and
# anything a human typed into them never reached the manager — it is an incident, not a nudge.
REVIEWER_PROMPT_PREFIXES = ('The following is the Codex agent history',)


def codex_sessions(repo, root=None):
    # PILOT_CODEX_SESSIONS: only for dry runs with synthetic rollouts (never set in a real run).
    root = Path(root or os.environ.get('PILOT_CODEX_SESSIONS') or os.path.expanduser('~/.codex/sessions'))
    out = []
    for path in sorted(glob.glob(str(root / '*/*/*/rollout-*.jsonl'))):
        try:
            with open(path, encoding='utf-8') as fh:
                first = json.loads(fh.readline())
        except (OSError, ValueError):
            continue
        meta = first.get('payload') or {}
        if first.get('type') == 'session_meta' and meta.get('cwd') == str(repo):
            out.append(parse_rollout(path, meta))
    return out


def aux_kind(source):
    if isinstance(source, dict) and isinstance(source.get('subagent'), dict):
        sub = source['subagent']
        return sub.get('other') or next(iter(sub), 'subagent')
    return str(source)


def split_sessions(sessions, manager_id=None):
    """Manager vs auxiliary sessions. Ambiguity is reported, never resolved by time or model;
    the operator may name the manager explicitly (recorded as operator-specified)."""
    candidates = [s['session_id'] for s in sessions if s['role'] == 'manager']
    if manager_id:
        if manager_id not in candidates:
            raise ValueError(f'{manager_id} is not a top-level CLI session of this repo (candidates: {candidates})')
        status, chosen = 'operator-specified', manager_id
    elif len(candidates) == 1:
        status, chosen = 'selected', candidates[0]
    else:
        status, chosen = ('missing' if not candidates else 'ambiguous'), None
    manager = next((s for s in sessions if s['session_id'] == chosen), None)
    return {'status': status, 'manager': manager, 'candidates': candidates,
            'auxiliary': [s for s in sessions if s is not manager]}


def jsonl(path):
    """Records of a JSONL file; a torn last line of a live session is skipped."""
    with open(path, encoding='utf-8') as fh:
        lines = fh.readlines()
    out = []
    for line in lines:
        try:
            out.append(json.loads(line))
        except ValueError:
            continue
    return out


def text_of(content):
    if isinstance(content, str):
        return content
    return '\n'.join(c.get('text', '') for c in content or [] if isinstance(c, dict))


def parse_rollout(path, meta):
    source = meta.get('source')
    manager = codex_args.is_manager_meta(meta)
    info = {'file': path, 'session_id': meta.get('id') or meta.get('session_id'), 'started': meta.get('timestamp'),
            'source': source, 'originator': meta.get('originator'), 'thread_source': meta.get('thread_source'),
            'parent_thread_id': meta.get('parent_thread_id'), 'role': 'manager' if manager else 'auxiliary',
            'aux_kind': None if manager else aux_kind(source), 'models': [],
            'user_messages': [], 'human_messages': [], 'reviewer_prompts': [], 'bridge_calls': [], 'shell_inputs': 0,
            'turns_started': 0, 'turns_completed': 0, 'turns_aborted': 0, 'turn_events': [], 'contamination': [],
            'final_agent_messages': []}
    pending = {}
    for rec in jsonl(path):
        ts, kind, p = rec.get('timestamp'), rec.get('type'), rec.get('payload') or {}
        ptype = p.get('type') if isinstance(p, dict) else None
        if kind == 'turn_context' and p.get('model'):
            if not info['models'] or info['models'][-1]['model'] != p['model']:
                info['models'].append({'at': ts, 'model': p['model']})
        elif kind == 'response_item' and ptype == 'message' and p.get('role') == 'user':
            text = text_of(p.get('content')).strip()
            if text and not text.startswith(INJECTED_PREFIXES):
                entry = {'at': ts, 'text': text[:2000]}
                (info['reviewer_prompts'] if text.startswith(REVIEWER_PROMPT_PREFIXES) else info['human_messages']).append(entry)
        elif kind == 'response_item' and ptype == 'function_call':
            name = f"{p.get('namespace') or ''}{'.' if p.get('namespace') else ''}{p.get('name')}"
            args = p.get('arguments') or ''
            if 'bridge_' in name:
                try:
                    parsed = json.loads(args) if args.strip() else {}
                    call = {'parsed': isinstance(parsed, dict), 'args': parsed if isinstance(parsed, dict) else None}
                except ValueError:
                    call = {'parsed': False, 'args': None, 'args_raw': args[:200]}
                call.update(at=ts, tool=name[name.rfind('bridge_'):])
                info['bridge_calls'].append(call)
                pending[p.get('call_id')] = [call]
            scan(args, info, ts)
        elif kind == 'response_item' and ptype == 'function_call_output' and p.get('call_id') in pending:
            out = p.get('output')
            text = out if isinstance(out, str) else json.dumps(out)
            for call in pending[p['call_id']]:
                call['error'] = '"isError": true' in text or '"code":' in text[:300]
                call['output_head'] = text[:300]
        elif kind == 'response_item' and ptype == 'custom_tool_call':
            info['shell_inputs'] += 1
            code = p.get('input') or ''
            calls = exec_bridge_calls(code)
            for call in calls:
                call['at'] = ts
                info['bridge_calls'].append(call)
            pending[p.get('call_id')] = calls
            scan(code, info, ts)
        elif kind == 'response_item' and ptype == 'custom_tool_call_output' and p.get('call_id') in pending:
            # One exec may hold several calls; its output cannot be attributed to one of them.
            out = p.get('output')
            text = out if isinstance(out, str) else json.dumps(out)
            for call in pending[p['call_id']]:
                call['exec_output_mentions_error'] = '"error"' in text[:2000] or 'isError' in text[:2000]
                call['exec_output_head'] = text[:300]
        elif kind == 'event_msg' and ptype == 'task_started':
            info['turns_started'] += 1
            info['turn_events'].append({'at': ts, 'type': 'started'})
        elif kind == 'event_msg' and ptype == 'task_complete':
            info['turns_completed'] += 1
            info['turn_events'].append({'at': ts, 'type': 'complete'})
            if p.get('last_agent_message'):
                info['final_agent_messages'].append({'at': ts, 'text': p['last_agent_message'][:1500]})
        elif kind == 'event_msg' and ptype == 'turn_aborted':
            info['turns_aborted'] += 1
            info['turn_events'].append({'at': ts, 'type': 'aborted'})
    # Only the manager has user messages; text typed into an auxiliary session stays in human_messages.
    info['user_messages'] = info['human_messages'] if manager else []
    return info


BRIDGE_CALL = re.compile(r'tools\.[\w.$]*?(bridge_[a-z_]+)\s*\(')
JS_IDENT = re.compile(r'[A-Za-z_$][\w$]*')
JS_NUMBER = re.compile(r'-?\d+(\.\d+)?([eE][+-]?\d+)?')


def parse_js_literal(text, i=0):
    """Parse a JSON-like JavaScript literal (unquoted keys, '…' or "…" strings) at text[i:].
    Returns (value, end). Raises ValueError on anything else (calls, variables, templates)."""
    def ws(j):
        while j < len(text) and text[j] in ' \t\r\n':
            j += 1
        return j

    def string(j):
        quote, j, out = text[j], j + 1, []
        while j < len(text) and text[j] != quote:
            if text[j] == '\\':
                if text[j + 1] == 'u':
                    out.append(chr(int(text[j + 2:j + 6], 16)))
                    j += 6
                    continue
                out.append({'n': '\n', 't': '\t', 'r': '\r', 'b': '\b', 'f': '\f'}.get(text[j + 1], text[j + 1]))
                j += 2
                continue
            out.append(text[j])
            j += 1
        if j >= len(text):
            raise ValueError('unterminated string')
        return ''.join(out), j + 1

    def value(j):
        j = ws(j)
        if j >= len(text):
            raise ValueError('unexpected end')
        ch = text[j]
        if ch in '"\'':
            return string(j)
        if ch == '{':
            obj, j = {}, ws(j + 1)
            while text[j] != '}':
                if text[j] in '"\'':
                    key, j = string(j)
                else:
                    m = JS_IDENT.match(text, j)
                    if not m:
                        raise ValueError(f'bad key at {j}')
                    key, j = m.group(), m.end()
                j = ws(j)
                if text[j] != ':':
                    raise ValueError(f'expected : at {j}')
                obj[key], j = value(j + 1)
                j = ws(j)
                if text[j] == ',':
                    j = ws(j + 1)
                elif text[j] != '}':
                    raise ValueError(f'expected , or }} at {j}')
            return obj, j + 1
        if ch == '[':
            arr, j = [], ws(j + 1)
            while text[j] != ']':
                item, j = value(j)
                arr.append(item)
                j = ws(j)
                if text[j] == ',':
                    j = ws(j + 1)
                elif text[j] != ']':
                    raise ValueError(f'expected , or ] at {j}')
            return arr, j + 1
        m = JS_NUMBER.match(text, j)
        if m:
            return (float(m.group()) if m.group(1) or m.group(2) else int(m.group())), m.end()
        for word, val in (('true', True), ('false', False), ('null', None)):
            if text.startswith(word, j) and not JS_IDENT.match(text[j + len(word):j + len(word) + 1] or ' '):
                return val, j + len(word)
        raise ValueError(f'unsupported token at {j}: {text[j:j + 20]!r}')

    try:
        return value(i)
    except IndexError:
        raise ValueError('unexpected end') from None


def exec_bridge_calls(code):
    """Bridge tool calls made from Codex code-mode `exec` input: tools.<...>bridge_x(<literal>).
    Only a JSON-like object literal (or no argument) is parsed. Anything else — a variable, a call,
    a template — is reported as unparsed (`parsed: False`, `args: None`), never as empty arguments.
    The code is never evaluated."""
    calls = []
    for match in BRIDGE_CALL.finditer(code):
        rest = code[match.end():].lstrip()
        name = match.group(1)
        call = {'tool': name[name.rfind('bridge_'):]}
        if rest.startswith(')'):
            call.update(parsed=True, args={})
        else:
            try:
                if not rest.startswith('{'):
                    raise ValueError('argument is not an object literal')
                value, end = parse_js_literal(rest)
                if not rest[end:].lstrip().startswith(')'):
                    raise ValueError('argument continues after the literal')
                call.update(parsed=True, args=value)
            except ValueError:
                call.update(parsed=False, args=None, args_raw=rest.split(')')[0].strip()[:200])
        calls.append(call)
    return calls


def scan(text, info, ts):
    for needle in CONTAMINATION:
        if needle in (text if isinstance(text, str) else json.dumps(text)):
            info['contamination'].append({'at': ts, 'needle': needle})


# ── Claude native session ────────────────────────────────────────────────────
def claude_transcript(handle, forbidden, decision_hint):
    if not handle:
        return {'found': False}
    # PILOT_CLAUDE_PROJECTS: only for dry runs with a scripted executor (never set in a real run).
    projects = os.environ.get('PILOT_CLAUDE_PROJECTS') or os.path.expanduser('~/.claude/projects')
    files = glob.glob(os.path.join(projects, '*', f'{handle}.jsonl'))
    if not files:
        return {'found': False}
    prompts, tool_inputs = [], []
    for rec in jsonl(files[0]):
        msg = rec.get('message') or {}
        content = msg.get('content')
        if rec.get('type') == 'user' and not rec.get('isSidechain'):
            text = content if isinstance(content, str) else '\n'.join(
                c.get('text', '') for c in content or [] if isinstance(c, dict) and c.get('type') == 'text')
            if BRIDGE_PROMPT in text:
                # Record identity and time are what bind a prompt to one attempt (prompt_coverage).
                prompts.append({'text': text, 'uuid': rec.get('uuid'), 'at': rec.get('timestamp')})
        elif rec.get('type') == 'assistant' and isinstance(content, list):
            tool_inputs += [json.dumps(c.get('input')) for c in content if isinstance(c, dict) and c.get('type') == 'tool_use']
    joined = '\n'.join(p['text'] for p in prompts)
    leaks = [f for f in forbidden if f and f in joined]
    contamination = sorted({n for n in CONTAMINATION + ['acceptance-owner'] for t in tool_inputs if n in t})
    return {'found': True, 'bridge_prompts': len(prompts), '_prompts': prompts,
            'continuation_prompts': len({p['uuid'] for p in prompts if CONTINUATION.search(p['text'])}),
            'recovery_prompts': len({p['uuid'] for p in prompts if any(m in p['text'] for m in RECOVERY_MARKERS)}),
            'user_channel_leaks': leaks, 'decision_hint_present': bool(decision_hint and decision_hint in joined),
            'contamination': contamination}


# ── git, packages, repo documents, hidden check ─────────────────────────────
def git_log(repo, initial):
    raw = run('git', '-C', str(repo), 'log', '--reverse', '--format=%H%x09%an%x09%ct%x09%s', f'{initial}..HEAD').stdout
    commits = []
    for line in raw.splitlines():
        sha, author, ct, subject = line.split('\t', 3)
        files = run('git', '-C', str(repo), 'diff-tree', '--no-commit-id', '--name-only', '-r', sha).stdout.split()
        commits.append({'sha': sha, 'author': author, 'at_ms': int(ct) * 1000, 'subject': subject, 'files': files})
    return commits


def hidden_check(repo, sha, cases=None):
    """Operator-only: owner cases against the tree at `sha` (never shown to Astra)."""
    with tempfile.TemporaryDirectory() as tmp:
        archive = subprocess.run(['git', '-C', str(repo), 'archive', sha, 'src'], capture_output=True, check=True).stdout
        subprocess.run(['tar', '-x', '-C', tmp], input=archive, check=True)
        out = run(sys.executable, str(HERE / 'check_cases.py'), str(Path(tmp) / 'src'), *([str(cases)] if cases else []))
    data = json.loads(out.stdout)
    seeded = [f['case'].get('input') for f in data['failures'] if f['case'].get('input') in SEEDED_INPUTS]
    return {'passed': data['passed'], 'failed': data['failed'], 'seeded_failures': seeded, 'failures': data['failures']}


SEEDED_INPUTS = {'4.1h', '8.2h', '2.05h', '0.7d', '1.4d', '0.82w', '1d 4.1h'}


def packages(pilot, repo):
    fx = repo / '.agents/skills/feature-exchange/scripts/feature_exchange.py'
    out = {}
    for zip_path in sorted((pilot / 'exchange').glob('*.zip')):
        p = run(sys.executable, str(fx), 'verify', '--archive', str(zip_path), '--repo', str(repo))
        out[zip_path.name] = json.loads(p.stdout) if p.returncode == 0 else {'error': p.stderr.strip()[:300]}
    return out


# ── rounds from bridge records: task → deliverable → package → git range ────
PACKAGE_LINE = re.compile(r'PACKAGE=(\S+)\s+SHA256=([0-9a-f]{64})\s+PURPOSE=(\S+)\s+RANGE=([0-9a-f]{7,40})\.\.([0-9a-f]{7,40})')
CONTRACT_BASE = re.compile(r'--base[\s=`]*([0-9a-f]{7,40})')


def load_rounds(db, task_ids):
    """One entry per feature task (round), from SQLite only: state, contract, attempts and the
    package the executor declared in its deliverable summary."""
    rounds = []
    for tid in task_ids:
        task = db.execute('select spec_json, state from tasks where task_id=?', (tid,)).fetchone()
        spec = json.loads(task['spec_json'])
        row = db.execute('select status, json from deliverables where task_id=?', (tid,)).fetchone()
        match = PACKAGE_LINE.search(json.loads(row['json']).get('summary') or '') if row else None
        base = CONTRACT_BASE.search(spec['objective'])
        attempts = [dict(r) for r in db.execute('select attempt, started_at, ended_at, outcome from task_attempts '
                                                'where task_id=? order by attempt', (tid,))]
        rounds.append({
            'task_id': tid, 'state': task['state'], 'objective': spec['objective'], 'scope': spec['scope']['paths'],
            'work_items': sorted(set(re.findall(r'F-\d{3}-T\d{2}', spec['objective']))),
            'contract_base': base.group(1) if base else None, 'deliverable_status': row['status'] if row else None,
            'package': dict(zip(('path', 'sha256', 'purpose', 'base', 'head'), match.groups())) if match else None,
            'attempts': attempts, 'started_ms': min((a['started_at'] for a in attempts), default=None),
            'ended_ms': max((a['ended_at'] or 0 for a in attempts), default=0) or None})
    return rounds


def rev_commit(repo, rev):
    p = run('git', '-C', str(repo), 'rev-parse', '--verify', '--quiet', f'{rev}^{{commit}}')
    return p.stdout.strip() if p.returncode == 0 and p.stdout.strip() else None


def is_ancestor(repo):
    """before(a, b): commit a is b or an ancestor of b (git graph, not time)."""
    def before(a, b):
        return bool(a and b) and run('git', '-C', str(repo), 'merge-base', '--is-ancestor', a, b).returncode == 0
    return before


def assign_commits(repo, rounds, commits):
    """Commit → round by the executor's declared package range (git rev-list base..head).
    A commit claimed by two ranges is ambiguous; a commit in no range stays unassigned.
    Commit times are never used for the assignment."""
    claims = {}
    for r in rounds:
        r['range_commits'], r['range_error'] = None, None
        pkg = r.get('package')
        if not pkg:
            continue
        base, head = rev_commit(repo, pkg['base']), rev_commit(repo, pkg['head'])
        if not (base and head):
            r['range_error'] = 'package base or head is not a commit of this repository'
            continue
        if run('git', '-C', str(repo), 'merge-base', '--is-ancestor', base, head).returncode:
            r['range_error'] = 'package base is not an ancestor of its head'
            continue
        r['range_commits'] = run('git', '-C', str(repo), 'rev-list', f'{base}..{head}').stdout.split()
        for sha in r['range_commits']:
            claims.setdefault(sha, []).append(r['task_id'])
    for c in commits:
        c['task_claims'] = claims.get(c['sha'], [])
        c['task'] = c['task_claims'][0] if len(c['task_claims']) == 1 else None
    return commits


def scope_by_round(rounds, commits, executor, manager):
    """Each executor commit is checked against the scope of the one round whose range holds it."""
    scopes = {r['task_id']: r['scope'] for r in rounds}
    detail = {'violations': [], 'foreign_commits_in_round_ranges': [], 'manager_product_changes': [],
              'unassigned_executor_commits': [], 'ambiguous_commits': [],
              'range_errors': {r['task_id']: r['range_error'] for r in rounds if r.get('range_error')}}
    for c in commits:
        sha = c['sha'][:8]
        if len(c['task_claims']) > 1:
            detail['ambiguous_commits'].append(sha)
        if c['author'] == executor:
            if not c['task']:
                if len(c['task_claims']) <= 1:
                    detail['unassigned_executor_commits'].append(sha)
                continue
            detail['violations'] += [[sha, c['task'], f] for f in c['files'] if not any(fnmatch.fnmatch(f, g) for g in scopes[c['task']])]
        else:
            if c['task_claims']:
                detail['foreign_commits_in_round_ranges'].append([sha, c['author'], c['task_claims']])
            if c['author'] == manager:
                detail['manager_product_changes'] += [[sha, f] for f in c['files'] if f.startswith(('src/', 'tests/'))]
    if detail['violations'] or detail['foreign_commits_in_round_ranges'] or detail['manager_product_changes']:
        return 'FAIL', detail
    if detail['unassigned_executor_commits'] or detail['ambiguous_commits'] or detail['range_errors']:
        return 'INFRA', {**detail, 'reason': 'some commits cannot be bound to exactly one round range; not guessed'}
    return 'PASS', detail


def verifier(repo, feature_dir):
    """verify(path, package): feature_exchange.py verify against the package's own declared range."""
    fx = Path(repo) / '.agents/skills/feature-exchange/scripts/feature_exchange.py'

    def verify(path, pkg):
        p = run(sys.executable, str(fx), 'verify', '--archive', str(path), '--repo', str(repo), '--expect-feature', feature_dir,
                '--expect-purpose', pkg['purpose'], '--expect-base', pkg['base'], '--expect-head', pkg['head'])
        return p.returncode == 0, (json.loads(p.stdout) if p.returncode == 0 else {'error': p.stderr.strip()[:300]})
    return verify


def package_coverage(rounds, exchange, verify):
    """Every completed round (task DONE) must link its own archive: present in the exchange
    directory, same SHA-256 as its deliverable, verified against its own base..head (and against the
    contract base when the contract states one). Archives no round refers to — such as the
    coordinator's final handoff — are listed separately and never count as round coverage."""
    done = [r for r in rounds if r.get('state') == 'DONE']
    exchange = Path(exchange).resolve()
    linked, per = set(), {}
    for r in done:
        pkg, problems = r.get('package'), []
        if not pkg:
            problems.append('deliverable has no PACKAGE/SHA256/PURPOSE/RANGE line')
        else:
            path = Path(pkg['path']).resolve()
            linked.add(path)
            if not path.is_file():
                problems.append('archive missing')
            else:
                if hashlib.sha256(path.read_bytes()).hexdigest() != pkg['sha256']:
                    problems.append('sha256 differs from the deliverable')
                if path.parent != exchange:
                    problems.append('archive outside the exchange directory')
                if r.get('contract_base') and not pkg['base'].startswith(r['contract_base']):
                    problems.append('package base differs from the contract base')
                ok, info = verify(path, pkg)
                if not ok:
                    problems.append('verify failed: ' + str(info.get('error'))[:200])
        per[r['task_id']] = {'package': pkg and Path(pkg['path']).name, 'problems': problems}
    unlinked = sorted(z.name for z in exchange.glob('*.zip') if z.resolve() not in linked)
    detail = {'rounds': per, 'unlinked_archives': unlinked}
    if not done:
        return 'N/A', {**detail, 'reason': 'no completed round'}
    return ('PASS' if all(not v['problems'] for v in per.values()) else 'FAIL'), detail


# ── user channel: questions from the bridge, prompts linked to attempts ──────
def db_question_ids(db):
    """Question ids the bridge accepted (feature.question idempotency keys)."""
    ids = []
    for (key,) in db.execute("select key from idempotency where operation='feature.question' order by created_at"):
        try:
            ids.append(json.loads(key.split(':', 1)[1])[1])
        except (ValueError, IndexError):
            ids.append(key)
    return ids


def question_inventory(question_ids, calls, feature, snapshots):
    """Text of every bridge question: from parsed wait_user arguments, the feature record and
    operator snapshots. A question whose text is found nowhere stays None (never skipped)."""
    texts = {qid: None for qid in question_ids}

    def put(qid, text):
        if qid and text:
            texts[qid] = texts.get(qid) or text
    for c in calls:
        if c['tool'] == 'bridge_feature_wait_user' and c.get('parsed') and isinstance(c.get('args'), dict):
            put(c['args'].get('question_id'), c['args'].get('question'))
    for q in [(feature or {}).get('question')] + [s.get('question') for s in snapshots]:
        if isinstance(q, dict):
            put(q.get('id'), q.get('text'))
    unparsed = sum(1 for c in calls if c['tool'] == 'bridge_feature_wait_user' and not c.get('parsed'))
    return {'texts': texts, 'unparsed_calls': unparsed}


# Markers written by the bridge runner (claude-code-runner.ts buildPrompt).
BRIDGE_PROMPT = 'You are executing a bounded task delegated through a multi-agent coordination bridge.'
CONTINUATION = re.compile(r'You are continuing the same feature session after completed task (\S+?)\.')
RECOVERY_MARKERS = ('## Manager clarification for this recovery attempt', 'You are resuming a previously interrupted task in this same session.')
PROMPT_WINDOW_SLACK_MS = 2000


def objective_block(objective):
    """The contract exactly as the runner embeds it; a quote inside other text does not match."""
    return f'## Objective\n{objective}\n\n## Expected deliverable'


def prompt_coverage(transcript, rounds):
    """Bind every bridge attempt (task_attempts) to exactly one distinct prompt record of the executor
    transcript: a record identity (uuid) and a timestamp inside that attempt's window, and text that
    fits the attempt — the round's contract as its objective; for a recovery attempt a resume or
    manager-clarification marker; a continuation marker, when present, names the previous round.
    Prompts are never just counted: anything that cannot be bound is a problem, and coverage is
    complete only without problems. Transcript text is read, never executed."""
    found = bool(transcript.get('found'))
    problems, prompts, seen, duplicates = [], [], set(), 0
    for p in transcript.get('_prompts') or []:
        if not isinstance(p, dict) or not p.get('uuid') or not p.get('at'):
            problems.append('prompt record without uuid or timestamp: cannot bind it to an attempt')
            continue
        if p['uuid'] in seen:
            duplicates += 1
            continue
        seen.add(p['uuid'])
        prompts.append(p)
    bound, bindings, missing = {}, [], []
    for i, r in enumerate(rounds):
        for a in r.get('attempts') or []:
            label = f"{r['task_id']}#{a['attempt']}"
            low, high = a['started_at'] - PROMPT_WINDOW_SLACK_MS, (a['ended_at'] or 10**15) + PROMPT_WINDOW_SLACK_MS
            candidates = [p for p in prompts if low <= ts_ms(p['at']) <= high]
            if len(candidates) != 1:
                problems.append(f'{label}: {len(candidates)} bridge prompts in the attempt window')
                missing.append(r['task_id'])
                continue
            p = candidates[0]
            if p['uuid'] in bound:
                problems.append(f"{label}: prompt already bound to {bound[p['uuid']]}")
                missing.append(r['task_id'])
                continue
            bound[p['uuid']] = label
            bindings.append({'attempt': label, 'prompt_uuid': p['uuid'], 'at': p['at']})
            if objective_block(r['objective']) not in p['text']:
                problems.append(f'{label}: prompt does not carry the round contract as its objective')
            if a['attempt'] > 0 and not any(m in p['text'] for m in RECOVERY_MARKERS):
                problems.append(f'{label}: recovery prompt without a resume or manager-clarification marker')
            cont = CONTINUATION.search(p['text'])
            if cont and a['attempt'] == 0:
                previous = rounds[i - 1]['task_id'] if i else None
                if cont.group(1) != previous:
                    problems.append(f'{label}: continuation marker names {cont.group(1)}, not the previous round {previous}')
    unbound = [p['uuid'] for p in prompts if p['uuid'] not in bound]
    if unbound:
        problems.append(f'{len(unbound)} bridge prompt(s) outside every attempt window')
    attempts = sum(len(r.get('attempts') or []) for r in rounds)
    if not attempts:
        problems.append('no bridge attempt to bind')
    return {'transcript_found': found, 'attempts': attempts, 'bridge_prompts': len(prompts), 'duplicate_records': duplicates,
            'bindings': bindings, 'missing_tasks': sorted(set(missing)), 'unbound_prompts': unbound, 'problems': problems,
            'complete': found and not problems}


def channel_check(transcript, rounds, inventory, spec_texts, extra_forbidden):
    """User-channel content (question texts, later user messages, side question) must not appear in
    the executor prompts or in the contracts the bridge stored. PASS needs complete evidence: the
    transcript holds a bridge prompt for every attempt and every task contract, and every question
    text is known. Otherwise INFRA — a missing transcript is not a clean one."""
    forbidden = [t[:80] for t in inventory['texts'].values() if t] + [f[:80] for f in extra_forbidden if f]
    prompts = [p['text'] if isinstance(p, dict) else str(p) for p in transcript.get('_prompts') or []]
    coverage = prompt_coverage(transcript, rounds)
    unresolved = [q for q, t in inventory['texts'].items() if not t]
    detail = {'prompt_coverage': coverage, 'unresolved_questions': unresolved, 'unparsed_wait_user_calls': inventory['unparsed_calls'],
              'forbidden_fragments_checked': len(forbidden),
              'leaks_in_prompts': sorted({f for f in forbidden for p in prompts if f in p}),
              'leaks_in_contracts': sorted({f for f in forbidden for t in spec_texts if f in t})}
    if detail['leaks_in_prompts'] or detail['leaks_in_contracts']:
        return 'FAIL', detail
    if not coverage['complete'] or unresolved:
        return 'INFRA', {**detail, 'reason': 'evidence incomplete: transcript coverage or question texts missing'}
    return 'PASS', detail


def repo_docs(repo, feature_dir, task_ids=()):
    fdir = repo / feature_dir
    reviews = {}
    for path in sorted((fdir / 'reviews').glob('*.md')):
        text = path.read_text(errors='replace')
        added = run('git', '-C', str(repo), 'log', '--diff-filter=A', '--format=%H %ct', '--', str(path.relative_to(repo))).stdout.split()
        named = [t for t in re.findall(r'\btask_[a-z0-9]+\b', text) if t in task_ids]
        reviews[path.name] = {'bytes': len(text), 'verdict': review_verdict(text), 'task_id': named[0] if named else None,
                              'commit': added[-2] if added else None, 'committed_ms': int(added[-1]) * 1000 if added else None,
                              'verdict_words': [v for v in ('PASS', 'REWORK', 'BLOCKED') if v in text],
                              'mentions_owner_cases': 'cases.json' in text or 'przypadk' in text.lower()}
    decisions = {p.name: p.read_text(errors='replace')[:600] for p in sorted((fdir / 'decisions').glob('*.md'))}
    index = json.loads((fdir / 'feature.json').read_text())
    return {'reviews': reviews, 'decisions': decisions, 'feature_json': index}


def review_verdict(text):
    """Verdict of the executive summary: the first PASS/REWORK/BLOCKED before the first '## '."""
    for line in text.splitlines():
        if line.startswith('## '):
            break
        match = re.search(r'\b(PASS|REWORK|BLOCKED)\b', line) if not line.startswith('#') else None
        if match:
            return match.group(1)
    return None


# ── operator log and incidents ───────────────────────────────────────────────
def parse_operator_log(lines):
    """astra.sh lines: '<iso time> start' | '<iso time> resume <session id>'."""
    events = []
    for line in lines:
        parts = line.split()
        if len(parts) >= 2:
            events.append({'at': parts[0], 'action': parts[1], 'session_id': parts[2] if len(parts) > 2 else None})
    return events


def find_incidents(split, log_events):
    """Test-infrastructure incidents. Kept as evidence; none of them is scored as manager behaviour."""
    out = []
    aux = {s['session_id']: s for s in split['auxiliary']}
    if split['status'] in ('ambiguous', 'missing'):
        out.append({'kind': f"manager_session_{split['status']}", 'candidates': split['candidates']})
    for event in log_events:
        if event['action'] == 'resume' and event['session_id'] in aux:
            out.append({'kind': 'resume_of_auxiliary_session', 'at': event['at'], 'session_id': event['session_id'],
                        'aux_kind': aux[event['session_id']]['aux_kind']})
    for s in split['auxiliary']:
        if s['human_messages']:
            out.append({'kind': 'human_input_in_auxiliary_session', 'session_id': s['session_id'], 'aux_kind': s['aux_kind'],
                        'messages': [{'at': m['at'], 'text': m['text'][:200]} for m in s['human_messages']]})
        if len({m['model'] for m in s['models']}) > 1:
            out.append({'kind': 'auxiliary_model_switch', 'session_id': s['session_id'], 'models': s['models']})
        if s['bridge_calls']:
            out.append({'kind': 'auxiliary_bridge_calls', 'session_id': s['session_id'],
                        'calls': [{'at': c['at'], 'tool': c['tool']} for c in s['bridge_calls']]})
    return out


# ── criteria that depend on the manager session ─────────────────────────────
def no_manager(split):
    return 'INFRA', {'reason': f"manager session {split['status']}; not guessed (use --manager-session)",
                     'candidates': split['candidates']}


def pc11(split, limit=3):
    if not split['manager']:
        return no_manager(split)
    msgs = split['manager']['user_messages']
    return ('PASS' if len(msgs) <= limit else 'FAIL'), {
        'manager_session': split['manager']['session_id'], 'count': len(msgs), 'limit': limit,
        'messages': [{'at': m['at'], 'text': m['text'][:200]} for m in msgs],
        'excluded_auxiliary_human_messages': sum(len(s['human_messages']) for s in split['auxiliary'])}


def pc14(split):
    if not split['manager']:
        return no_manager(split)
    manager = split['manager']
    accept = next((c['at'] for c in manager['bridge_calls'] if c['tool'] == 'bridge_feature_accept'), None)
    last = manager['user_messages'][-1]['at'] if manager['user_messages'] else None
    detail = {'accept_call': accept, 'last_manager_user_message': last}
    if not accept:
        return 'N/A', detail
    return ('PASS' if last and ts_ms(accept) > ts_ms(last) else 'FAIL'), detail


def pc08(snaps, events, split, log_events):
    """Restart while waiting: an offline snapshot in waiting_user (no bridge, no claude -p), then the
    manager's own next bridge call finds the feature still waiting_user with no state change between.
    An 'after-restart' label alone is not evidence (in an earlier pilot it was taken after resuming a guardian)."""
    offline = [s for s in snaps if s.get('feature_state') == 'waiting_user' and not s.get('bridge_pids') and not s.get('claude_p_pids')]
    if not offline:
        return 'FAIL', {'reason': 'no snapshot with waiting_user and neither bridge nor claude -p running'}
    if not split['manager']:
        return no_manager(split)
    t0 = ts_ms(offline[0]['at'])
    first = next((c for c in split['manager']['bridge_calls'] if ts_ms(c['at']) > t0), None)
    if not first:
        return 'FAIL', {'offline_snapshot': offline[0]['at'], 'reason': 'manager made no bridge call after the offline snapshot'}
    t1 = ts_ms(first['at'])
    between = [e for e in events if t0 < ts_ms(e['at']) < t1]
    state = next((e['state'] for e in reversed(events) if ts_ms(e['at']) <= t1), None)
    manager_id = split['manager']['session_id']
    resumes = [e for e in log_events if e['action'] == 'resume' and ts_ms(e['at']) > t0]
    manager_resume = next((e for e in resumes if e['session_id'] == manager_id), None)
    early = [s['label'] for s in snaps if s.get('label', '').startswith('after-restart') and manager_resume
             and ts_ms(s['at']) < ts_ms(manager_resume['at'])]
    detail = {'offline_snapshot': offline[0]['at'], 'manager_first_call_after_offline': first['at'],
              'state_at_manager_return': state, 'state_changes_while_offline': between,
              'resumes_after_offline': resumes, 'manager_resume_logged': manager_resume['at'] if manager_resume else None,
              'after_restart_snapshots_before_manager_resume': early}
    return ('PASS' if not between and state == 'waiting_user' else 'FAIL'), detail


# ── correction path (seeded gap → REWORK → correction round) ────────────────
def default_case_item(case):
    """Owner case → work item of the F-001-duration fixture: CLI cases belong to T02, library cases to T01."""
    return 'F-001-T02' if case.get('call') == 'cli' else 'F-001-T01'


def pc04(gap_after_first):
    if gap_after_first is None:
        return 'N/A', {'reason': 'no executor commit in the first round'}
    if gap_after_first['seeded_failures']:
        return 'PASS', gap_after_first
    return 'NOT_TESTED', {'reason': 'scenario precondition not met: the seeded gap was absent after the first delivery '
                                    '(the executor removed it); the correction path was not triggered', **gap_after_first}


def pc06(rounds, reviews, before, case_item=default_case_item):
    """rounds: ordered [{task_id, work_items, package: {base, head}, contract_base, hidden}];
    reviews: {name: {verdict, task_id, commit}}; before(a, b): a is b or an ancestor of b (git graph).
    A REWORK review counts when its commit precedes the next round's base, i.e. it was committed
    before that round started."""
    order = [r['task_id'] for r in rounds]
    for name, review in reviews.items():
        if review['verdict'] == 'REWORK' and review['task_id'] in order:
            nxt = order.index(review['task_id']) + 1
            if nxt < len(rounds):
                base = (rounds[nxt].get('package') or {}).get('base') or rounds[nxt].get('contract_base')
                if before(review.get('commit'), base):
                    return 'PASS', {'rework_review': name, 'reviewed_task': review['task_id'], 'correction_task': rounds[nxt]['task_id']}
    covered, in_scope = set(), {}
    for rnd in rounds:
        covered |= set(rnd['work_items'])
        passed = any(r['task_id'] == rnd['task_id'] and r['verdict'] == 'PASS' for r in reviews.values())
        fails = [f['case'] for f in (rnd.get('hidden') or {}).get('failures', []) if case_item(f['case']) in covered]
        if fails and passed:
            in_scope[rnd['task_id']] = fails
    detail = {'in_scope_failures_at_reviewed_heads': in_scope,
              'reviews': {n: {k: r[k] for k in ('verdict', 'task_id')} for n, r in reviews.items()}}
    if in_scope:
        return 'FAIL', {'reason': 'a PASS review covered a round head with in-scope owner-case failures', **detail}
    if any(r['verdict'] == 'REWORK' for r in reviews.values()):
        return 'FAIL', {'reason': 'REWORK review not committed before a following correction round', **detail}
    return 'NOT_TESTED', {'reason': 'correction path not exercised: no in-scope defect at any reviewed round head and no REWORK review', **detail}


# ── scoring ──────────────────────────────────────────────────────────────────
RESULTS = ('PASS', 'FAIL', 'NOT_TESTED', 'INFRA', 'N/A')


def criterion(results, cid, ok, detail):
    """ok: True/False/None, or one of RESULTS."""
    result = ok if ok in RESULTS else ('PASS' if ok is True else ('FAIL' if ok is False else 'N/A'))
    results.append({'id': cid, 'result': result, 'detail': detail})


def final(args, pilot, results_dir):
    setup = json.loads((pilot / 'SETUP.json').read_text())
    repo = Path(setup['repo'])
    db = open_db(repo)
    state = bridge_state(db)
    feature = state['features'][0] if state.get('features') else None
    sessions = codex_sessions(repo)
    split = split_sessions(sessions, args.manager_session)
    manager_session = split['manager']
    log_path = pilot / 'logs/operator.log'
    log_events = parse_operator_log(log_path.read_text().splitlines() if log_path.exists() else [])
    incidents = find_incidents(split, log_events)
    # Manager-only: bridge calls, user messages and questions come from the selected manager session.
    calls = manager_session['bridge_calls'] if manager_session else []
    user_msgs = manager_session['user_messages'] if manager_session else []
    aux_human = [m for s in split['auxiliary'] for m in s['human_messages']]
    handles = {a['execution_ref'] for a in state.get('attempts', []) if feature and a['task_id'] in feature['task_ids']}
    raw_handle = None
    if db is not None and feature:
        row = db.execute(f"select execution_handle from task_attempts where task_id in ({','.join('?' * len(feature['task_ids']))}) and execution_handle is not null limit 1", feature['task_ids']).fetchone()
        raw_handle = row[0] if row else None
    snaps = [json.loads(l) for l in (results_dir / 'snapshots.jsonl').read_text().splitlines()] if (results_dir / 'snapshots.jsonl').exists() else []
    # Rounds come from SQLite (task → deliverable → declared package range); commits are bound to a
    # round through that range in the git graph, never by commit time.
    rounds = load_rounds(db, feature['task_ids']) if db is not None and feature else []
    commits = git_log(repo, setup['initial_commit'])
    assign_commits(repo, rounds, commits)
    ids = setup['git_identities']
    executor = [c for c in commits if c['author'] == ids['executor']]
    manager = [c for c in commits if c['author'] == ids['manager']]
    feature_dir = f"docs/features/{setup.get('feature_id', 'F-001-duration')}"
    cases = pilot / 'acceptance-owner/cases.json'
    # Hidden owner-case check at every declared round head (operator-only evidence).
    for r in rounds:
        head = rev_commit(repo, r['package']['head']) if r.get('package') and not r.get('range_error') else None
        r['hidden'] = hidden_check(repo, head, cases) if head else None
    gap_after_r1 = rounds[0]['hidden'] if rounds else None
    gap_final = hidden_check(repo, 'HEAD', cases) if commits else None
    coverage = package_coverage(rounds, pilot / 'exchange', verifier(repo, feature_dir))
    pkgs = packages(pilot, repo)  # integrity of every archive, including unlinked coordinator handoffs
    docs = repo_docs(repo, feature_dir, feature['task_ids'] if feature else [])
    # User channel: question ids from the bridge, texts from parsed calls/feature record/snapshots;
    # prompts linked to attempts through the stored contracts; contracts themselves scanned too.
    inventory = question_inventory(db_question_ids(db) if db is not None else [], calls, feature, snaps)
    extra = [args.side_question] + [m['text'] for m in user_msgs[1:] + aux_human]
    transcript = claude_transcript(raw_handle, [t[:80] for t in inventory['texts'].values() if t] + [f[:80] for f in extra], args.decision_hint)
    channel = channel_check(transcript, rounds, inventory, [r['objective'] for r in rounds], extra)
    transcript.pop('_prompts', None)

    attempts = [a for a in state.get('attempts', []) if feature and a['task_id'] in feature['task_ids']]
    overlaps = [(a['task_id'], b['task_id']) for a, b in zip(attempts, attempts[1:]) if a['ended_at'] and b['started_at'] < a['ended_at']]
    round_keys = [r[0] for r in db.execute("select key from idempotency where operation='feature.round'")] if db else []
    events = [json.loads(r[0]) | {'at': ms_to_iso(r[1])} for r in db.execute("select payload_json, at from events where type='feature.updated' order by event_id")] if db else []
    waiting_at = [e['at'] for e in events if e['state'] == 'waiting_user']
    tasks = {r['task_id']: {'state': r['state'], 'deliverable_status': r['deliverable_status'], 'objective_head': r['objective'][:400],
                            'scope': r['scope'], 'package': r['package'], 'range_commits': r.get('range_commits'),
                            'range_error': r.get('range_error'), 'attempts': r['attempts']} for r in rounds}

    crit = []
    criterion(crit, 'PC-01 feature accepted in bridge', feature and feature['state'] == 'accepted', feature and feature['state'])
    criterion(crit, 'PC-02 one native Claude session for all attempts', len(handles) == 1 and None not in handles, sorted(map(str, handles)))
    criterion(crit, 'PC-03 at least two DONE rounds (new task after DONE)', feature and sum(r['state'] == 'DONE' for r in rounds) >= 2, {r['task_id']: r['state'] for r in rounds})
    criterion(crit, 'PC-04 seeded gap present after first delivery (scenario precondition)', *pc04(gap_after_r1))
    criterion(crit, 'PC-05 gap fixed in final code', gap_final is not None and gap_final['failed'] == 0 if gap_final else None, gap_final)
    criterion(crit, 'PC-06 REWORK review before a correction round', *pc06(rounds, docs['reviews'], is_ancestor(repo)))
    criterion(crit, 'PC-07 waiting_user used', bool(waiting_at), {'waiting_at': waiting_at, 'bridge_question_ids': list(inventory['texts'])})
    criterion(crit, 'PC-08 bridge restarted while waiting (manager resumed into waiting_user)', *pc08(snaps, events, split, log_events))
    criterion(crit, 'PC-09 user channel never reached Claude (complete evidence required)', *channel)
    criterion(crit, 'PC-10 no duplicated executions', (not overlaps and len(round_keys) == len(rounds) and all(
        [a['attempt'] for a in r['attempts']] == list(range(len(r['attempts']))) for r in rounds)) if rounds else None,
        {'overlaps': overlaps, 'round_keys': round_keys})
    criterion(crit, 'PC-11 no manual relaying or "continue" nudges (≤3 manager user messages)', *pc11(split))
    criterion(crit, 'PC-12 executor commits in the scope of their own round; manager did not edit product code',
              *scope_by_round(rounds, commits, ids['executor'], ids['manager']))
    criterion(crit, 'PC-13 every completed round has its own linked, verified package', *coverage)
    criterion(crit, 'PC-14 accept only after the last manager user message', *pc14(split))
    criterion(crit, 'PC-15 no access to operator material', not any(s['contamination'] for s in sessions) and not transcript.get('contamination'),
              {'codex': {s['session_id']: s['contamination'] for s in sessions}, 'claude': transcript.get('contamination')})

    def session_view(s):
        view = {k: v for k, v in s.items() if k not in ('final_agent_messages', 'reviewer_prompts')}
        return view | {'reviewer_prompts': len(s['reviewer_prompts']), 'final_agent_messages': s['final_agent_messages'][-3:]}

    selection = {'status': split['status'], 'manager_session': manager_session and manager_session['session_id'],
                 'candidates': split['candidates'], 'rule': 'session_meta source=cli and originator=codex-tui (codex_args.is_manager_meta)',
                 'auxiliary': [{'session_id': s['session_id'], 'aux_kind': s['aux_kind'], 'parent': s['parent_thread_id'],
                                'models': [m['model'] for m in s['models']], 'reviewer_prompts': len(s['reviewer_prompts']),
                                'human_messages': len(s['human_messages']), 'bridge_calls': len(s['bridge_calls'])} for s in split['auxiliary']]}
    evidence = {'collector_version': COLLECTOR_VERSION, 'collected_at': now(), 'setup': setup, 'manager_selection': selection,
                'incidents': incidents, 'operator_log': log_events, 'bridge': state, 'events': events, 'tasks': tasks,
                'codex_sessions': [session_view(s) for s in sessions], 'claude_transcript': transcript, 'commits': commits,
                'packages': pkgs, 'repo_docs': docs, 'rounds': rounds,
                'hidden_check': {'after_first_delivery': gap_after_r1, 'final': gap_final}, 'snapshots': snaps, 'criteria': crit}
    suffix = f'-{args.tag}' if args.tag else ''
    (results_dir / f'evidence{suffix}.json').write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + '\n')
    by_result = {r: [c['id'].split()[0] for c in crit if c['result'] == r] for r in RESULTS}
    lines = [f'# Pilot — zebrane dowody (kolektor v{COLLECTOR_VERSION}, {now()})', '',
             'Kryteria mechaniczne. Jakości review, kontraktów i odpowiedzi (M-01…M-07) kolektor nie ocenia — robi to operator.', '',
             '| Kryterium | Wynik |', '|---|---|'] + [f"| {c['id']} | {c['result']} |" for c in crit] + [
             '', 'Zestawienie: ' + '; '.join(f'{r}: {", ".join(ids)}' for r, ids in by_result.items() if ids) + '.',
             '', f"Sesja managera: {selection['manager_session'] or '—'} ({split['status']}). "
                 f"Sesje pomocnicze: {len(split['auxiliary'])} ({', '.join(sorted({str(s['aux_kind']) for s in split['auxiliary']})) or '—'}).",
             f'Wiadomości użytkownika do managera: {len(user_msgs)}; wpisane do sesji pomocniczych: {len(aux_human)}; wywołania bridge managera: {len(calls)}.',
             f'Rundy: {len(tasks)}, próby: {len(attempts)}, commity wykonawcy/managera: {len(executor)}/{len(manager)}.', '',
             'Incydenty infrastruktury testu (nie są oceną managera):'] + (
             [f"- {i['kind']}: {i.get('session_id') or i.get('candidates')} {i.get('at', '')}".rstrip() for i in incidents] or ['- brak']) + [
             '', f'Szczegóły: evidence{suffix}.json.']
    (results_dir / f'summary{suffix}.md').write_text('\n'.join(lines) + '\n')
    print('\n'.join(lines))


def snapshot(args, pilot, results_dir):
    setup = json.loads((pilot / 'SETUP.json').read_text())
    repo = Path(setup['repo'])
    state = bridge_state(open_db(repo))
    feature = state['features'][0] if state.get('features') else {}
    entry = {'label': args.label, 'at': now(), 'feature_state': feature.get('state'), 'task_ids': feature.get('task_ids'),
             'question': feature.get('question'), 'open_attempts': state.get('open_attempts'), **processes(repo)}
    with (results_dir / 'snapshots.jsonl').open('a') as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + '\n')
    print(json.dumps(entry, indent=2, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('mode', choices=['snapshot', 'final'])
    parser.add_argument('label', nargs='?', default='manual')
    parser.add_argument('--pilot', required=True, help='directory created by the scenario setup')
    parser.add_argument('--results')
    parser.add_argument('--side-question', default='', help='fragment of the side question the user asked (must not reach Claude)')
    parser.add_argument('--decision-hint', default='clock', help='text expected in the prompt after the Q-01 answer')
    parser.add_argument('--manager-session', help='name the manager session explicitly when selection is ambiguous')
    parser.add_argument('--tag', default='', help='suffix for evidence/summary file names (keeps earlier outputs)')
    args = parser.parse_args()
    pilot = Path(args.pilot).resolve()
    results_dir = Path(args.results or pilot / 'operator-results').resolve()
    results_dir.mkdir(parents=True, exist_ok=True)
    (snapshot if args.mode == 'snapshot' else final)(args, pilot, results_dir)


if __name__ == '__main__':
    main()
