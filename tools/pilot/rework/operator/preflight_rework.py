"""Preflight for the rework test (operator-only). Starts no paid agent and sends no prompt.

Usage: python3 preflight_rework.py --run DIR [--skip-dryrun]
Writes DIR/operator-results/preflight.json and prints a table; exit 1 when a required check fails.
Set CODEX_PROFILE when your Codex setup uses a named profile (the launcher passes it the same way).
Agent CLIs are used only for `--version`, `auth/login status`, `codex mcp list` and
`codex debug prompt-input` (local render, no model call). R07 runs the tooling dry run: the real
bridge with a scripted `claude` stand-in in a temporary directory.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REWORK = HERE.parent
PILOT_TOOLS = REWORK.parent
COMMON = PILOT_TOOLS / 'common'
SKILLS = ['feature-design', 'feature-plan', 'feature-review', 'feature-decide', 'feature-execute', 'feature-exchange', 'using-bridge']
DECIMAL_GAP = ['4.1h', '8.2h', '2.05h', '0.7d', '1.4d', '0.82w', '1d 4.1h']
LEAKS = r'check_cases|EXPECTED\.md|inject_regression|regressions\.py|pilot-teammate|operator-results|operator/|tools/pilot|ingerencj|INJECTION'
HINTS = ['units', 'float', '4.1', 'teammate', 'zespoł', 'regres', 'ingerenc', 'to_seconds', 'HEAD']
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(COMMON))
import collect_rework  # noqa: E402
import regressions  # noqa: E402
import setup_common as base  # noqa: E402

checks = []


def check(cid, ok, detail, required=True):
    checks.append({'id': cid, 'ok': bool(ok), 'required': required, 'detail': detail})


def run(*cmd, cwd=None, env=None, timeout=300):
    return subprocess.run([str(c) for c in cmd], cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def tree(root):
    return {p.relative_to(root).as_posix(): sha(p) for p in sorted(Path(root).rglob('*')) if p.is_file() and '__pycache__' not in p.parts}


def cases_on(src, cases):
    return json.loads(run(sys.executable, COMMON / 'check_cases.py', src, cases).stdout)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', required=True)
    parser.add_argument('--skip-dryrun', action='store_true')
    args = parser.parse_args()
    run_dir = Path(args.run).resolve()
    setup = json.loads((run_dir / 'SETUP.json').read_text())
    repo, cases = Path(setup['repo']), run_dir / 'acceptance-owner/cases.json'
    results = run_dir / 'operator-results'
    results.mkdir(parents=True, exist_ok=True)
    codex = shutil.which('codex') or 'codex'
    profile_args = ['--profile', os.environ['CODEX_PROFILE']] if os.environ.get('CODEX_PROFILE') else []
    env_src = {**os.environ, 'PYTHONPATH': 'src', 'PYTHONDONTWRITEBYTECODE': '1'}

    versions = {'node': run('node', '--version').stdout.strip(), 'python': sys.version.split()[0],
                'codex': run(codex, '--version').stdout.strip(), 'claude': run('claude', '--version').stdout.strip()}
    claude_auth = run('claude', 'auth', 'status', timeout=60)
    codex_auth = run(codex, 'login', 'status', timeout=60)
    check('R01 toolchain and logins (status only)', all(versions.values()) and '"loggedIn": true' in claude_auth.stdout
          and codex_auth.returncode == 0, {**versions, 'codex_login': (codex_auth.stdout + codex_auth.stderr).strip()[:40]})

    dirty = run('git', '-C', base.ROOT, 'status', '--porcelain', '--', 'shared', 'claude', 'codex', 'scripts').stdout.strip()
    built = base.BUILD_MARKER.is_file() and 'Recovery attempts start outside run()' in base.BUILD_MARKER.read_text()
    check('R02 bridge sources of this checkout unmodified and built', built and not dirty and setup.get('tools_commit') == run('git', '-C', base.ROOT, 'rev-parse', 'HEAD').stdout.strip(),
          {'built': built, 'uncommitted_bridge_changes': dirty[:300], 'setup_tools_commit': setup.get('tools_commit')})

    status = run('git', '-C', repo, 'status', '--porcelain').stdout
    commits = run('git', '-C', repo, 'rev-list', 'HEAD').stdout.split()
    tests = run(sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', cwd=repo, env=env_src)
    check('R03 run repo clean, single setup commit, no bridge state, base tests pass', not status and commits == [setup['initial_commit']]
          and not (repo / '.bridge').exists() and tests.returncode == 0, {'status': status, 'commits': len(commits)})

    wf = {k: v for k, v in tree(repo / '.agents').items() if not k.startswith('skills/using-bridge/')}
    same = (wf == tree(base.WORKFLOW_SKILLS) and tree(repo / '.agents/skills/using-bridge') == tree(base.USING_BRIDGE['codex'])
            and tree(repo / '.claude/skills/using-bridge') == tree(base.USING_BRIDGE['claude'])
            and sha(repo / 'docs/features/README.md') == sha(base.FEATURES_README))
    check('R04 workflow skills and using-bridge = this checkout', same, same)

    leaks = run('grep', '-rIl', '-E', LEAKS, '--exclude-dir=.git', repo, run_dir / 'acceptance-owner').stdout.split()
    block = (run_dir / 'START-ASTRA.txt').read_text()
    hints = [h for h in HINTS if h.lower() in block.lower()]
    operator_md = (REWORK / 'OPERATOR.md').read_text()
    check('R05 no operator material in agent inputs; start block has no hint; OPERATOR.md shows the exact request',
          not leaks and not hints and collect_rework.TRIGGER in operator_md,
          {'leaks': leaks, 'hints_in_start_block': hints, 'trigger_in_operator_md': collect_rework.TRIGGER in operator_md})

    with tempfile.TemporaryDirectory() as tmp:
        exact, regressed = Path(tmp) / 'exact', Path(tmp) / 'regressed'
        for d in (exact, regressed):
            shutil.copytree(HERE / 'reference/src', d / 'src', ignore=shutil.ignore_patterns('__pycache__'))
            shutil.copy2(repo / 'src/textkit/units.py', d / 'src/textkit/units.py')
        target = regressed / 'src/textkit/units.py'
        target.write_text(regressions.apply(target.read_text()))
        ref_ok, ref_bad = cases_on(exact / 'src', cases), cases_on(regressed / 'src', cases)
        base_copy = Path(tmp) / 'base'
        shutil.copytree(repo, base_copy, ignore=shutil.ignore_patterns('.git', '.agents', '.claude'))
        shutil.copy2(target, base_copy / 'src/textkit/units.py')
        base_after = run(sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', cwd=base_copy, env=env_src)
    failing = [f['case'].get('input') for f in ref_bad['failures']]
    check('R06 owner cases valid; intervention breaks exactly the decimal cases; base tests stay green',
          ref_ok['failed'] == 0 and failing == DECIMAL_GAP and base_after.returncode == 0 and sha(cases) == setup['owner_cases_sha256'],
          {'reference': f"{ref_ok['passed']}/{ref_ok['passed'] + ref_ok['failed']}", 'with_intervention_fails': failing,
           'base_tests_after_intervention': base_after.returncode == 0})

    units = [run(sys.executable, '-m', 'unittest', 'discover', '-s', PILOT_TOOLS / 'tests', cwd=base.ROOT, env={**os.environ, 'PILOT_SKIP_DRYRUN': '1'})]
    check('R07a pilot tool unit tests (tools/pilot/tests)', all(u.returncode == 0 for u in units),
          [u.stderr.strip().splitlines()[-1] for u in units])
    if args.skip_dryrun:
        check('R07b tooling dry run (real bridge, scripted executor)', False, 'skipped', required=False)
    else:
        with tempfile.TemporaryDirectory() as tmp:
            dr = run('node', HERE / 'dryrun.mjs', Path(tmp) / 'dry', cwd=HERE, timeout=600)
            table = [l for l in dr.stdout.splitlines() if l.startswith('| RC-')]
        check('R07b tooling dry run (real bridge, scripted executor): all RC PASS', dr.returncode == 0 and table
              and all(l.rstrip().endswith('| PASS |') for l in table), table or dr.stderr[-400:])

    fx_tests = run(sys.executable, base.ROOT / 'tests/test_feature_exchange.py',
                   env={**os.environ, 'FEATURE_EXCHANGE': str(repo / '.agents/skills/feature-exchange/scripts/feature_exchange.py')})
    check('R08 feature_exchange tests (run copy)', fx_tests.returncode == 0, fx_tests.stderr.strip().splitlines()[-1:])

    with tempfile.TemporaryDirectory() as tmp:
        hs = run('node', COMMON / 'bridge_handshake.mjs', repo, Path(tmp) / 'bridge.db')
    hsj = json.loads(hs.stdout) if hs.stdout.strip().startswith('{') else {}
    check('R09 bridge MCP handshake (32 tools, codex/allow)', hs.returncode == 0 and hsj.get('tool_count') == 32, {k: hsj.get(k) for k in ('tool_count', 'server_info')})

    mcp = run('bash', COMMON / 'astra.sh', 'check', env={**os.environ, 'CODEX_BIN': codex, 'PILOT_DIR': str(run_dir)})
    line = next((l for l in mcp.stdout.splitlines() if l.startswith('bridge')), '')
    check('R10 Codex sees the bridge MCP server for this run (astra.sh check)', mcp.returncode == 0 and str(repo) in line and 'enabled' in line, line[:200])

    pi = run(codex, *profile_args, 'debug', 'prompt-input', cwd=repo, timeout=120)
    visible = {s: s in pi.stdout for s in SKILLS}
    check('R11 Codex context lists repo skills and AGENTS.md (no bridge state created)', pi.returncode == 0 and all(visible.values())
          and 'textkit — instrukcje repozytorium' in pi.stdout and not (repo / '.bridge').exists(), visible)

    running = [l for l in run('pgrep', '-af', 'native-bridge-mcp').stdout.splitlines() if str(repo) in l and 'pgrep' not in l]
    trails = sorted(p.name for p in results.glob('injection*'))
    check('R12 empty exchange, no bridge process, no intervention record, trail or lock', not any((run_dir / 'exchange').iterdir())
          and not running and not trails, {'bridge_processes': running, 'intervention_files': trails})

    with tempfile.NamedTemporaryFile('r', suffix='.jsonl') as log:
        nt = run('bash', COMMON / 'notify.sh', '{"type":"agent-turn-complete"}',
                 env={**os.environ, 'PILOT_NOTIFY_LOG': log.name, 'PILOT_NOTIFY_DRY': '1'})
        entry = log.read()
    check('R13 notify hook records turn completion', nt.returncode == 0 and 'agent-turn-complete' in entry, entry.strip()[:80], required=False)

    ok = all(c['ok'] for c in checks if c['required'])
    (results / 'preflight.json').write_text(json.dumps({'run': str(run_dir), 'ok': ok, 'checks': checks}, indent=2, ensure_ascii=False) + '\n')
    for c in checks:
        print(f"{'PASS' if c['ok'] else 'FAIL'}  {c['id']}")
    print('PREFLIGHT', 'OK' if ok else 'FAILED', '->', results / 'preflight.json')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
