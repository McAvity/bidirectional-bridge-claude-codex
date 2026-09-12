#!/usr/bin/env python3
"""Operator-only wave10 preparation/launch/evidence. Never pass this file to agents.
No model process is started by prepare, preflight or snapshot.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import time

SOURCE = Path(__file__).resolve().parents[3]
SCOPE = 'wave10-two-pairs-v1'
BUDGET = {'claude_rounds': 4, 'claude_turns_per_round': 12, 'round_deadline_ms': 480000,
          'manager_turns_per_pair': 10, 'foreign_probe_turns': 2, 'wall_minutes': 40,
          'automatic_retries': 0, 'paid_api_spend_usd': 0}


def run(args, cwd=None):
    return subprocess.check_output(list(map(str, args)), cwd=cwd, text=True).strip()


def git(repo, *args):
    env = {k: v for k, v in os.environ.items() if k not in {
        'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE',
        'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE',
        'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'}}
    return subprocess.check_output(['git', '-C', str(repo), *map(str, args)],
                                   text=True, env=env).strip()


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_hash(runtime):
    paths = [runtime / 'scripts/native-bridge-mcp.mjs', runtime / 'package-lock.json']
    paths += sorted(runtime.glob('shared/*/dist/**/*.js'))
    paths += sorted(runtime.glob('claude/*/dist/**/*.js'))
    paths += sorted(runtime.glob('codex/*/dist/**/*.js'))
    h = hashlib.sha256()
    for path in paths:
        h.update(str(path.relative_to(runtime)).encode() + b'\0' + path.read_bytes())
    return h.hexdigest()


def prepare(args):
    dest = args.run.resolve()
    if dest.exists():
        raise ValueError('destination exists; choose a new run, never reset it')
    if SOURCE == dest or SOURCE in dest.parents:
        raise ValueError('run must be outside the source checkout')
    sha = git(SOURCE, 'rev-parse', args.runtime_sha + '^{commit}')
    dest.mkdir(parents=True, mode=0o700)
    runtime = dest / 'runtime'
    # A separate object database; never register a worktree in the development repository.
    subprocess.run(['git', 'clone', '--no-local', '--single-branch', '--branch', 'wave10',
                    str(SOURCE), str(runtime)], check=True, stdout=subprocess.DEVNULL)
    git(runtime, 'checkout', '--detach', sha)
    with (dest / 'build.log').open('w') as log:
        for cmd in [['npm', 'ci', '--ignore-scripts'], ['npm', 'run', 'build']]:
            subprocess.run(cmd, cwd=runtime, stdout=log, stderr=subprocess.STDOUT, check=True)
    seed = dest / 'seed'
    seed.mkdir()
    git(seed, 'init', '-q', '-b', 'seed')
    git(seed, 'config', 'user.name', 'pilot-operator')
    git(seed, 'config', 'user.email', 'operator@pilot.invalid')
    git(seed, 'config', 'core.hooksPath', '/dev/null')
    for rel in ['.agents/skills', '.codex/skills/using-bridge', '.claude/skills/using-bridge']:
        shutil.copytree(runtime / rel, seed / rel)
    shutil.copytree(runtime / 'docs/features', seed / 'docs/features',
                    ignore=shutil.ignore_patterns('F-*'))
    write(seed / '.gitignore', '.bridge/\n.codex/config.toml\n.pilot/\n__pycache__/\n')
    write(seed / '.claude/settings.json', json.dumps({'permissions': {'allow': ['Bash(git:*)', 'Bash(python3:*)']}}))
    write(seed / 'AGENTS.md', 'Read TASK.md. Work only in this worktree and its exchange namespace.\n'
          'One manager and one Claude feature session. No further delegation or operator-file reads.\n'
          'Never inspect sibling worktrees, the runtime source, or parent directories.\n')
    write(seed / 'gate.py', 'from pathlib import Path\nimport time\n'
          'end = time.monotonic() + 180\n'
          'while not Path(".pilot/continue").exists():\n'
          '    if time.monotonic() >= end: raise SystemExit("operator gate expired")\n'
          '    time.sleep(1)\n')
    feature = seed / 'docs/features/F-W10-pair'
    write(feature / 'brief.md', '# F-W10-pair\nImplement render(label) returning PAIR + ":" + label.\n'
          'Round 2 adds a suffix selected explicitly by the user. Validate with Python unittest.\n')
    write(feature / 'feature.json', json.dumps({'schema_version': 1, 'feature_id': 'F-W10-pair',
          'phase': 'execution', 'brief': 'docs/features/F-W10-pair/brief.md',
          'tasks': [], 'context_files': [], 'latest_review': None, 'latest_decision': None}, indent=2))
    git(seed, 'add', '.')
    git(seed, 'commit', '-qm', 'Synthetic two-pair pilot fixture')
    namespaces = {}
    for pair in ['a', 'b']:
        repo = dest / pair
        git(seed, 'worktree', 'add', '-q', '-b', 'pair-' + pair, str(repo))
        write(repo / 'TASK.md', f'PAIR={pair.upper()}\nFeature: F-W10-pair; round keys r1 and r2.\n'
              + ('Before implementing round 1, worker runs `python3 gate.py` once; stop if it expires.\n' if pair == 'b' else '')
              + 'Only edit render.py, test_render.py and docs/features/F-W10-pair/execution/**.\n'
              'Round 1 implements render(label); round 2 adds the user-selected suffix.\n')
        git(repo, 'add', 'TASK.md')
        git(repo, 'commit', '-qm', 'Set synthetic pair requirement')
        exchange = runtime / '.agents/skills/feature-exchange/scripts/feature_exchange.py'
        ns = json.loads(run([sys.executable, exchange, 'namespace', '--repo', repo]))
        namespaces[pair] = ns
        # Compute the production key, but keep pilot packages in this isolated run directory.
        package_dir = dest / 'exchange' / ns['workspace_key'] / 'packages'
        package_dir.mkdir(parents=True)
        prompt = f'''Read AGENTS.md and TASK.md. You are manager Astra of pair {pair.upper()}.
User authorizes this pilot only: at most two Claude rounds, 12 turns and 480000 ms each,
zero retries, no extra agents. Create/claim a manager root, set it WORKING, and create feature F-W10-pair using bridge.
Read bridge_server_info and bridge_manager_status; report the exact native thread ID for resume.
Round r1: implement TASK.md round 1 through bridge_feature_run (its retries are fixed at zero),
spec.max_turns=12. Do not pass max_attempts: it is not a feature_run argument. Have Claude test, commit and export a verified implementation-review ZIP
using --feature docs/features/F-W10-pair --output {package_dir}/r1.zip,
--base equal to HEAD just before that round.
Use the same feature's Claude session for r2; never replace or recover a DONE task.
After r1, review only the delivered scope, then call bridge_feature_wait_user with question_id q1
and question "Which suffix should round 2 use?". End your turn and wait for the operator.
Do not accept the feature, run r2, read operator files, or exceed this scope.
'''
        write(dest / f'START-{pair.upper()}.txt', prompt)
    manifest = {'scope': SCOPE, 'budget': BUDGET, 'runtime_sha': sha,
                'runtime_build_sha256': build_hash(runtime), 'namespaces': namespaces,
                'fixture_heads': {p: git(dest / p, 'rev-parse', 'HEAD') for p in ['a', 'b']},
                'prepared_only': True}
    write(dest / 'manifest.json', json.dumps(manifest, indent=2) + '\n')
    write(dest / 'approval.example.json', json.dumps({**{'approved': False, 'scope': SCOPE,
          'runtime_sha': sha, 'subscription_only_confirmed': False}, 'budget': BUDGET}, indent=2))
    handshake = subprocess.run(['node', str(runtime / 'tools/pilot/wave10/handshake.mjs'),
                                str(dest / 'a'), str(dest / 'b')],
                               capture_output=True, text=True, timeout=30)
    write(dest / 'handshake.json', handshake.stdout)
    write(dest / 'handshake.stderr', handshake.stderr)
    if handshake.returncode:
        raise ValueError('pinned runtime handshake failed; inspect handshake files before readiness')
    print(f'PREPARED (models not run; two real MCP handshakes passed): {dest}')


def preflight(root):
    m = json.loads((root / 'manifest.json').read_text())
    runtime = root / 'runtime'
    if not json.loads((root / 'handshake.json').read_text()).get('ok'):
        raise ValueError('successful pinned runtime handshake required')
    if git(runtime, 'rev-parse', 'HEAD') != m['runtime_sha'] or git(runtime, 'status', '--porcelain'):
        raise ValueError('runtime revision or tracked/untracked source changed')
    if build_hash(runtime) != m['runtime_build_sha256']:
        raise ValueError('pinned build changed')
    if run(['node', '--version']).split('.')[0] != 'v24':
        raise ValueError('Node 24 required')
    if run(['codex', '--version']) != 'codex-cli 0.154.0':
        raise ValueError('unsupported Codex host; do not bypass identity adapter')
    run(['claude', '--version'])  # version only; does not invoke a model
    if m['namespaces']['a']['workspace_key'] == m['namespaces']['b']['workspace_key']:
        raise ValueError('exchange namespaces collide')
    for pair in ['a', 'b']:
        repo = root / pair
        if git(repo, 'branch', '--show-current') != 'pair-' + pair:
            raise ValueError('unexpected pilot branch')
        if git(repo, 'rev-parse', '--show-toplevel') != str(repo):
            raise ValueError('unexpected worktree root')
    return m


def launch(args):
    root = args.run.resolve()
    m = preflight(root)
    approval = json.loads((root / 'approval.json').read_text())
    expected = {'approved': True, 'scope': SCOPE, 'runtime_sha': m['runtime_sha'],
                'subscription_only_confirmed': True, 'budget': BUDGET}
    if approval != expected:
        raise ValueError('explicit user approval of this exact scope/budget required')
    repo = root / args.pair
    config = {'command': shutil.which('node'), 'args': [str(root / 'runtime/scripts/native-bridge-mcp.mjs'),
              '--caller', 'codex', '--delegation', 'deny' if args.mode == 'foreign' else 'allow',
              '--workspace', str(repo)], 'cwd': str(repo), 'startup_timeout_sec': 30,
              'tool_timeout_sec': 600}
    command = ['codex', '-m', 'gpt-6-astra', '-C', str(repo)]
    for key, value in config.items():
        command += ['-c', f'mcp_servers.bridge.{key}={json.dumps(value)}']
    command += ['-c', 'model_reasoning_effort="high"']
    if args.mode == 'resume':
        # Capture from bridge_manager_status before closing, never select newest rollout.
        session = (root / f'session-{args.pair}.txt').read_text().strip()
        if not re.fullmatch(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}', session):
            raise ValueError('an exact native UUID from manager_status is required')
        command += ['resume', session]
    elif args.mode == 'foreign':
        command += ['Read no files. Call bridge_manager_status once, then bridge_create_task once '
                    'with a minimal no-write spec. Report the exact rejection code. '
                    'Do not take over, resume, delegate, run shell commands or retry.']
    started = root / 'started-at.txt'
    if not started.exists():
        write(started, str(time.time()))
    if time.time() - float(started.read_text()) > 40 * 60:
        raise ValueError('40 minute run budget exhausted')
    # In-session turns/rounds and elapsed time require operator supervision; no hard dollar meter.
    os.chdir(repo)
    os.execvp(command[0], command)


def snapshot(args):
    root = args.run.resolve()
    if not re.fullmatch(r'[a-zA-Z0-9_-]+', args.label):
        raise ValueError('invalid label')
    target = root / 'evidence' / args.label
    target.mkdir(parents=True, exist_ok=False)
    for pair in ['a', 'b']:
        repo = root / pair
        out = target / pair
        out.mkdir()
        db = repo / '.bridge/bridge.db'
        if db.exists():
            with sqlite3.connect(db.as_uri() + '?mode=ro', uri=True) as src:
                with sqlite3.connect(out / 'bridge.db') as dst:
                    src.backup(dst)
                    write(out / 'logical.sql', '\n'.join(dst.iterdump()))
            for file in (repo / '.bridge').rglob('*'):
                if file.is_file() and file.suffix == '.json':
                    dest = out / 'state' / file.relative_to(repo / '.bridge')
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(file, dest)
            if Path(str(db) + '.owner').exists():
                shutil.copy2(str(db) + '.owner', out / 'database.owner')
        write(out / 'git.json', json.dumps({'head': git(repo, 'rev-parse', 'HEAD'),
              'status': git(repo, 'status', '--porcelain')}, indent=2))
    packages = {str(p.relative_to(root)): digest(p) for p in (root / 'exchange').rglob('*.zip')}
    write(target / 'packages.json', json.dumps(packages, indent=2))
    shutil.copy2(root / 'manifest.json', target / 'manifest.json')
    print(f'PRIVATE SNAPSHOT: {target}; no model PASS inferred')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    for name in ['prepare', 'preflight', 'launch', 'snapshot']:
        p = sub.add_parser(name)
        p.add_argument('--run', type=Path, required=True)
        if name == 'prepare':
            p.add_argument('--runtime-sha', required=True)
        if name == 'launch':
            p.add_argument('--pair', choices=['a', 'b'], required=True)
            p.add_argument('--mode', choices=['start', 'resume', 'foreign'], required=True)
        if name == 'snapshot':
            p.add_argument('--label', required=True)
    args = parser.parse_args()
    if args.command == 'prepare': prepare(args)
    elif args.command == 'preflight':
        preflight(args.run.resolve()); print('PREFLIGHT OK; no model or account/budget claim')
    elif args.command == 'launch': launch(args)
    else: snapshot(args)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        sys.exit(f'REFUSED: {error}')
