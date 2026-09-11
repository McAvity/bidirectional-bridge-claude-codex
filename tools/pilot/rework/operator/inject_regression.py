"""TEST INTERVENTION for the rework test (operator-only; never shown to agents).

  python3 inject_regression.py --run DIR [--results DIR/operator-results] [--dry-run]
                               [--allow-waiting] [--accept-aborted-turn]

Commits the regression from regressions.py to src/textkit/units.py under the separate identity
`pilot-teammate`, as a normal commit on the checked-out branch. It never edits an executor commit,
package, ledger or bridge record, never calls a bridge tool, never resets or cleans anything.

Flow (fail closed):
  1. lock `<results>/injection.lock` (O_EXCL) — a second injector, or a stale lock, is refused;
  2. observe: branch, HEAD, status, target bytes, bridge feature/attempts, Astra's turns, `claude -p`;
  3. slow checks on an export of exactly that HEAD: tests, owner cases before/after, every completed
     round has its own verified package, the latest round has a PASS review;
  4. write `injection-started-<ts>.json`, observe again: any drift → refused, nothing written;
  5. commit through git objects and `update-ref <branch> <new> <observed HEAD>` (compare-and-swap):
     if HEAD moved, the ref update fails and nothing changes; the worktree file is replaced only if
     it still holds the observed bytes;
  6. failure after the ref update → `injection-failed-<ts>.json` with the stage; no rollback.
Astra's last turn must be `complete`; `aborted` only with --accept-aborted-turn (recorded).
Limit: git refs and the index are protected by git's own locks, but an uncooperative process could
still write the worktree file between the last check and the replace; it is detected afterwards
(status check → partial failure), not prevented.
"""
import argparse
import difflib
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REWORK = HERE.parent
sys.path.insert(0, str(REWORK.parent / 'common'))
sys.path.insert(0, str(HERE))
import collect  # noqa: E402
import regressions  # noqa: E402

TRAILS = ('injection.json', 'injection-started', 'injection-failed')


class GitError(RuntimeError):
    pass


class Refused(RuntimeError):
    """Nothing was changed in the repository."""


class PartialFailure(RuntimeError):
    """The commit is on the branch but a later step failed; state is recorded, never rolled back."""
    def __init__(self, stage, message):
        super().__init__(f'{stage}: {message}')
        self.stage = stage


def git_out(repo, *args, env=None, input=None):
    p = subprocess.run(['git', '-C', str(repo), *args], capture_output=True, env=env,
                       input=input if input is None or isinstance(input, bytes) else input.encode())
    if p.returncode:
        raise GitError(f"git {' '.join(args[:3])}: {p.stderr.decode(errors='replace').strip()[:300]}")
    return p.stdout.decode(errors='replace').strip()


def stamp():
    return datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')


def sha(data):
    return hashlib.sha256(data).hexdigest()


# ── lock ──────────────────────────────────────────────────────────────────────
def acquire_lock(path):
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        raise Refused(f'{path} exists: another intervention is running or a previous one crashed; '
                      'inspect the trail files and remove the lock manually') from None
    with os.fdopen(fd, 'w') as fh:
        fh.write(json.dumps({'pid': os.getpid(), 'at': stamp()}))


def release_lock(path):
    Path(path).unlink(missing_ok=True)


# ── observation and drift ─────────────────────────────────────────────────────
class Context:
    """Where the intervention looks. The default views read the real bridge DB, Codex sessions and
    processes; tests replace them with stand-ins while keeping a real git repository."""
    def __init__(self, repo, results, branch_ref=None, run_dir=None, setup=None):
        self.repo, self.results, self.run_dir, self.setup = Path(repo), Path(results), run_dir, setup
        self.branch_ref = branch_ref or git_out(repo, 'symbolic-ref', '-q', 'HEAD')

    def git_view(self):
        target = self.repo / regressions.TARGET
        return {'branch_ref': git_out(self.repo, 'symbolic-ref', '-q', 'HEAD'), 'head': git_out(self.repo, 'rev-parse', 'HEAD'),
                'status': git_out(self.repo, 'status', '--porcelain'),
                'target_sha256': sha(target.read_bytes()) if target.exists() else None}

    # Default (real) views — replaced in tests.
    def bridge_view(self):
        state = collect.bridge_state(collect.open_db(self.repo))
        feature = (state.get('features') or [None])[0] or {}
        return {'feature_state': feature.get('state'), 'latest_task_id': feature.get('latest_task_id'),
                'task_ids': feature.get('task_ids'), 'open_attempts': state.get('open_attempts'),
                'attempts': len(state.get('attempts') or [])}

    def manager_view(self):
        manager = collect.split_sessions(collect.codex_sessions(self.repo))['manager']
        turns = manager['turn_events'] if manager else []
        return {'manager_session': manager and manager['session_id'], 'manager_turns': len(turns),
                'manager_last_turn': turns[-1]['type'] if turns else None}

    def claude_pids(self):
        return collect.processes(self.repo)['claude_p_pids_in_repo']

    def rounds(self):
        db = collect.open_db(self.repo)
        feature = (collect.bridge_state(db).get('features') or [None])[0]
        return collect.load_rounds(db, feature['task_ids']) if db is not None and feature else []

    def coverage(self, rounds):
        feature_dir = f"docs/features/{self.setup['feature_id']}"
        return collect.package_coverage(rounds, self.run_dir / 'exchange', collect.verifier(self.repo, feature_dir))

    def package_hashes(self):
        return {p.name: sha(p.read_bytes()) for p in sorted((self.run_dir / 'exchange').glob('*.zip'))}

    def reviewed(self):
        db = collect.open_db(self.repo)
        feature = (collect.bridge_state(db).get('features') or [None])[0]
        if not feature:
            return False
        docs = collect.repo_docs(self.repo, f"docs/features/{self.setup['feature_id']}", feature['task_ids'])
        return any(r['task_id'] == feature.get('latest_task_id') and r['verdict'] == 'PASS' and r.get('commit')
                   for r in docs['reviews'].values())

    def evaluate(self, head):
        """Repository tests and owner cases on an export of `head`, as is and with the regression."""
        cases = self.run_dir / 'acceptance-owner/cases.json'
        with tempfile.TemporaryDirectory() as tmp:
            out = []
            for name, regress in (('now', False), ('regressed', True)):
                tree = Path(tmp) / name
                tree.mkdir()
                archive = subprocess.run(['git', '-C', str(self.repo), 'archive', head], capture_output=True, check=True).stdout
                subprocess.run(['tar', '-x', '-C', str(tree)], input=archive, check=True)
                if regress:
                    target = tree / regressions.TARGET
                    target.write_text(regressions.apply(target.read_text()))
                tests = subprocess.run([sys.executable, '-m', 'unittest', 'discover', '-s', 'tests'], cwd=tree, capture_output=True,
                                       text=True, env={**os.environ, 'PYTHONPATH': 'src', 'PYTHONDONTWRITEBYTECODE': '1'})
                data = json.loads(subprocess.run([sys.executable, str(REWORK.parent / 'common/check_cases.py'), str(tree / 'src'), str(cases)],
                                                 capture_output=True, text=True).stdout)
                out += [{'ok': tests.returncode == 0, 'tail': tests.stderr.strip().splitlines()[-1:]},
                        {'passed': data['passed'], 'failed': data['failed'], 'failing_inputs': [f['case'].get('input') for f in data['failures']]}]
        return tuple(out)

    def executor_commits(self):
        return git_out(self.repo, 'log', '--format=%H', f"--author={self.setup['git_identities']['executor']}").split()


def observe(ctx):
    return {**ctx.git_view(), **ctx.bridge_view(), **ctx.manager_view(), 'claude_pids': ctx.claude_pids()}


DRIFT_KEYS = ('branch_ref', 'head', 'status', 'target_sha256', 'feature_state', 'latest_task_id', 'task_ids', 'open_attempts',
              'attempts', 'claude_pids', 'manager_turns', 'manager_last_turn')


def drift(before, after):
    return [k for k in DRIFT_KEYS if before.get(k) != after.get(k)]


def preconditions(state, rounds, coverage, reviewed, hidden, applicable, earlier, allow_waiting, accept_aborted):
    allowed = ('awaiting_review', 'waiting_user') if allow_waiting else ('awaiting_review',)
    turns_ok = ('complete', 'aborted') if accept_aborted else ('complete',)
    done = [r['task_id'] for r in rounds if r.get('state') == 'DONE']
    per_round = coverage[1].get('rounds', {})
    return {
        'no earlier intervention or trail': not earlier,
        'worktree clean': state['status'] == '',
        f'feature state in {allowed}': state.get('feature_state') in allowed,
        'no open attempt': state.get('open_attempts') == 0,
        'no claude -p process in the repo': not state.get('claude_pids'),
        f"manager's last turn is {'/'.join(turns_ok)}": state.get('manager_last_turn') in turns_ok,
        'latest round reviewed PASS': bool(reviewed),
        'every completed round has its own verified package': bool(done) and coverage[0] == 'PASS'
                                                                and all(not per_round.get(t, {'problems': ['missing']})['problems'] for t in done),
        'first delivery correct (owner cases 100% at HEAD)': hidden[0]['failed'] == 0,
        'intervention applicable': applicable is True,
        'intervention makes an owner case fail': hidden[1]['failed'] > 0,
    }


# ── the commit ────────────────────────────────────────────────────────────────
def commit_intervention(repo, expected_head, branch_ref, target, old_bytes, new_bytes, ident, message, stages):
    """Create the teammate commit on `branch_ref` only if HEAD is still `expected_head` and the
    worktree/index still hold `old_bytes`. Refused → nothing changed; PartialFailure → the commit is on
    the branch and a later step failed (recorded by the caller, never rolled back)."""
    repo = Path(repo)
    path = repo / target
    if git_out(repo, 'symbolic-ref', '-q', 'HEAD') != branch_ref:
        raise Refused('the checked-out branch changed')
    if git_out(repo, 'rev-parse', 'HEAD') != expected_head:
        raise Refused('HEAD moved since the observation')
    if git_out(repo, 'status', '--porcelain'):
        raise Refused('the worktree is not clean')
    if not path.exists() or path.read_bytes() != old_bytes:
        raise Refused('the target file differs from the observed bytes')
    entry = git_out(repo, 'ls-files', '-s', '--', target).split()
    old_blob = git_out(repo, 'hash-object', '--stdin', input=old_bytes)
    if len(entry) < 2 or entry[1] != old_blob or git_out(repo, 'rev-parse', f'{expected_head}:{target}') != old_blob:
        raise Refused('index or HEAD does not hold the observed target bytes')
    mode = entry[0]
    env = {**os.environ, 'GIT_AUTHOR_NAME': ident[0], 'GIT_AUTHOR_EMAIL': ident[1],
           'GIT_COMMITTER_NAME': ident[0], 'GIT_COMMITTER_EMAIL': ident[1]}
    new_blob = git_out(repo, 'hash-object', '-w', '--stdin', input=new_bytes)
    with tempfile.TemporaryDirectory() as tmp:
        index_env = {**os.environ, 'GIT_INDEX_FILE': str(Path(tmp) / 'index')}
        git_out(repo, 'read-tree', expected_head, env=index_env)
        git_out(repo, 'update-index', '--cacheinfo', f'{mode},{new_blob},{target}', env=index_env)
        tree = git_out(repo, 'write-tree', env=index_env)
    commit = git_out(repo, 'commit-tree', tree, '-p', expected_head, env=env, input=message)
    stages.append('objects')
    try:
        git_out(repo, 'update-ref', '-m', 'test intervention (pilot-teammate)', branch_ref, commit, expected_head)
    except GitError as exc:
        raise Refused(f'compare-and-swap of {branch_ref} failed (HEAD moved); nothing changed: {exc}') from None
    stages.append('ref')
    # From here the commit is on the branch.
    if path.read_bytes() != old_bytes:
        raise PartialFailure('worktree', 'target changed after the ref update; left untouched')
    tmp_file = path.with_name(f'.{path.name}.intervention-tmp')
    try:
        tmp_file.write_bytes(new_bytes)
        os.replace(tmp_file, path)
    except OSError as exc:
        raise PartialFailure('worktree', str(exc)) from None
    stages.append('worktree')
    try:
        git_out(repo, 'update-index', '--cacheinfo', f'{mode},{new_blob},{target}')
        git_out(repo, 'update-index', '-q', '--refresh')
    except GitError as exc:
        raise PartialFailure('index', str(exc)) from None
    stages.append('index')
    status = git_out(repo, 'status', '--porcelain')
    if status:
        raise PartialFailure('verify', f'worktree not clean after the intervention: {status[:200]}')
    return commit


# ── orchestration ─────────────────────────────────────────────────────────────
def byte_ranges(before, after):
    ops = difflib.SequenceMatcher(None, before, after, autojunk=False).get_opcodes()
    return [{'op': op, 'before': [a0, a1], 'after': [b0, b1]} for op, a0, a1, b0, b1 in ops if op != 'equal']


def write(results, name, record):
    path = results / name
    path.write_text(json.dumps(record, indent=2, ensure_ascii=False) + '\n')
    return path


def run(ctx, dry_run, allow_waiting, accept_aborted):
    """Returns 0 (committed or dry run OK), 1 (refused, nothing changed) or 2 (partial failure)."""
    results, lock = ctx.results, ctx.results / 'injection.lock'
    try:
        acquire_lock(lock)
    except Refused as exc:
        write(results, f'injection-refused-{stamp()}.json', {'reason': str(exc)})
        print('REFUSED:', exc)
        return 1
    try:
        return _run_locked(ctx, dry_run, allow_waiting, accept_aborted)
    finally:
        release_lock(lock)


def _run_locked(ctx, dry_run, allow_waiting, accept_aborted):
    results, repo, target = ctx.results, ctx.repo, regressions.TARGET
    earlier = sorted(p.name for p in results.iterdir() if p.name.startswith(TRAILS))
    try:
        state0 = observe(ctx)
        # Exact committed bytes of the observed HEAD (git_out would decode and strip them).
        old_bytes = subprocess.run(['git', '-C', str(repo), 'show', f"{state0['head']}:{target}"], capture_output=True, check=True).stdout
        rounds = ctx.rounds()
        coverage = ctx.coverage(rounds)
        reviewed = ctx.reviewed()
        suite_before, hidden_before, suite_after, hidden_after = ctx.evaluate(state0['head'])
        try:
            new_bytes, applicable = regressions.apply(old_bytes.decode()).encode(), True
        except ValueError as exc:
            new_bytes, applicable = old_bytes, str(exc)
    except (GitError, subprocess.CalledProcessError, OSError, ValueError) as exc:
        write(results, f'injection-refused-{stamp()}.json', {'reason': f'observation failed (fail closed): {exc}'})
        print('REFUSED: observation failed:', exc)
        return 1
    checks = preconditions(state0, rounds, coverage, reviewed, (hidden_before, hidden_after), applicable, earlier,
                           allow_waiting, accept_aborted)
    done = [r['task_id'] for r in rounds if r.get('state') == 'DONE']
    packages = coverage[1].get('rounds', {})
    record = {
        'label': 'TEST INTERVENTION — operator-made regression, not executor work', 'dry_run': dry_run, 'checks': checks,
        'observed': state0, 'earlier_trails': earlier,
        'deviation': [d for d in (state0.get('feature_state') == 'waiting_user' and 'feature was waiting_user (acceptance asked)',
                                  state0.get('manager_last_turn') == 'aborted' and "manager's last turn was aborted (accepted explicitly)") if d],
        'head_before': state0['head'], 'target': target, 'author': regressions.TEAMMATE[0], 'commit_message': regressions.COMMIT_MESSAGE,
        'before': {'sha256': sha(old_bytes), 'size': len(old_bytes)}, 'after': {'sha256': sha(new_bytes), 'size': len(new_bytes)},
        'changed_byte_ranges': byte_ranges(old_bytes, new_bytes),
        'diff': ''.join(difflib.unified_diff(old_bytes.decode().splitlines(True), new_bytes.decode().splitlines(True), 'a/' + target, 'b/' + target)),
        'suite_before': suite_before, 'suite_after': suite_after, 'hidden_before': hidden_before, 'hidden_after': hidden_after,
        'completed_rounds_before': done,
        'package_tasks_before': sorted(t for t in done if t in packages and not packages[t]['problems']),
        'package_coverage_before': coverage, 'packages_before': ctx.package_hashes(),
        'executor_commits_before': ctx.executor_commits()}
    failed = [k for k, ok in checks.items() if not ok]
    if failed or dry_run:
        name = f"injection-{'refused' if failed else 'dryrun'}-{stamp()}.json"
        write(results, name, record)
        print(json.dumps(checks, indent=2, ensure_ascii=False))
        print(('REFUSED: ' + ', '.join(failed)) if failed else 'DRY RUN OK (nothing committed)', '->', results / name)
        return 1 if failed else 0

    write(results, 'injection-started.json', record)
    try:
        state1 = observe(ctx)
    except (GitError, OSError) as exc:
        write(results, f'injection-refused-{stamp()}.json', {**record, 'reason': f'second observation failed: {exc}'})
        return 1
    moved = drift(state0, state1)
    if moved:
        write(results, f'injection-refused-{stamp()}.json', {**record, 'drift': moved, 'observed_again': state1,
                                                              'reason': 'state changed during the checks; nothing written'})
        print('REFUSED: drift in', moved)
        return 1
    stages = []
    try:
        commit = commit_intervention(repo, state0['head'], state0['branch_ref'], target, old_bytes, new_bytes,
                                     regressions.TEAMMATE, regressions.COMMIT_MESSAGE, stages)
    except Refused as exc:
        write(results, f'injection-refused-{stamp()}.json', {**record, 'stages': stages, 'reason': str(exc)})
        print('REFUSED:', exc)
        return 1
    except (PartialFailure, GitError, OSError) as exc:
        stage = getattr(exc, 'stage', stages[-1] if stages else 'objects')
        try:
            now = ctx.git_view()
        except (GitError, OSError) as view_error:
            now = {'error': str(view_error)}
        write(results, f'injection-failed-{stamp()}.json', {**record, 'stage': stage, 'stages': stages, 'error': str(exc),
                                                             'git_now': now, 'note': 'not rolled back; inspect before any further step'})
        print(f'PARTIAL FAILURE at {stage}: {exc}')
        return 2
    record.update({'commit': commit, 'stages': stages, 'observed_again': state1,
                   'committed_at_ms': int(git_out(repo, 'log', '-1', '--format=%ct', commit)) * 1000,
                   'files': git_out(repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', commit).split()})
    write(results, 'injection.json', record)
    return 0


def report(ctx, record):
    """INJECTION.md plus the hidden check and package verification after the commit (operator-only)."""
    cases = ctx.run_dir / 'acceptance-owner/cases.json'
    hidden = collect.hidden_check(ctx.repo, record['commit'], cases)
    hidden.pop('failures', None)
    after = ctx.coverage(ctx.rounds())
    record.update({'hidden_at_commit': hidden, 'package_coverage_after': after, 'packages_after': ctx.package_hashes()})
    write(ctx.results, 'injection.json', record)
    rows = [f"| {t} | {v.get('package')} | {'; '.join(v['problems']) or 'OK'} | {'; '.join(after[1]['rounds'].get(t, {}).get('problems', [])) or 'OK'} |"
            for t, v in record['package_coverage_before'][1].get('rounds', {}).items()]
    (ctx.results / 'INJECTION.md').write_text('\n'.join([
        '# INGERENCJA TESTOWA (materiał operatora — nie pokazywać agentom)', '',
        f"Commit `{record['commit']}` autora `{record['author']}`, po review ostatniej rundy i przed prośbą o ponowne",
        'sprawdzenie. To regresja wprowadzona przez operatora, nie praca wykonawcy ani managera.', '',
        f"- Plik `{record['target']}`: SHA-256 przed `{record['before']['sha256']}` ({record['before']['size']} B),"
        f" po `{record['after']['sha256']}` ({record['after']['size']} B).",
        f"- Zmienione zakresy bajtów (przed → po): {json.dumps(record['changed_byte_ranges'])}",
        f"- HEAD przed: `{record['head_before']}`; etapy: {record['stages']}; odchylenia: {record['deviation'] or 'brak'}.",
        f"- Przypadki właściciela: przed {record['hidden_before']['passed']}/{record['hidden_before']['passed'] + record['hidden_before']['failed']},"
        f" po commicie {hidden['passed']}/{hidden['passed'] + hidden['failed']}.",
        f"- Testy repozytorium po ingerencji: {'przechodzą' if record['suite_after']['ok'] else 'NIE przechodzą'} {record['suite_after']['tail']}.", '',
        'Paczki rund (powiązanie deliverable → archiwum → verify własnego zakresu), przed i po:', '',
        '| Runda | Paczka | Przed | Po |', '|---|---|---|---|', *rows, '',
        '```diff', record['diff'].rstrip(), '```', '']))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--run', required=True, help='run directory created by setup_rework.py')
    parser.add_argument('--results')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--allow-waiting', action='store_true')
    parser.add_argument('--accept-aborted-turn', action='store_true')
    args = parser.parse_args()
    run_dir = Path(args.run).resolve()
    results = Path(args.results or run_dir / 'operator-results').resolve()
    results.mkdir(parents=True, exist_ok=True)
    setup = json.loads((run_dir / 'SETUP.json').read_text())
    try:
        ctx = Context(setup['repo'], results, run_dir=run_dir, setup=setup)
    except GitError as exc:
        sys.exit(f'REFUSED: {exc}')
    code = run(ctx, args.dry_run, args.allow_waiting, args.accept_aborted_turn)
    if code == 0 and not args.dry_run:
        record = json.loads((results / 'injection.json').read_text())
        report(ctx, record)
        print(f"INTERVENTION COMMITTED {record['commit']} -> {results / 'injection.json'}")
    sys.exit(code)


if __name__ == '__main__':
    main()
