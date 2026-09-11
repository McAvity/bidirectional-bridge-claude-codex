"""TEST INTERVENTION for the rework test (operator-only; never shown to agents).

  python3 inject_regression.py --run DIR --repo-quiescent [--results DIR/operator-results]
                               [--allow-waiting] [--accept-aborted-turn]
  python3 inject_regression.py --run DIR --dry-run

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
     if HEAD moved, the ref update fails and nothing changes;
  6. swap the worktree file without clobbering (see below);
  7. failure after the ref update → `injection-failed-<ts>.json` with the stage; no rollback.
Astra's last turn must be `complete`; `aborted` only with --accept-aborted-turn (recorded).

Boundary. A real intervention runs only in a stopped test repository: the operator confirms it with
--repo-quiescent (Astra's turn has ended, no round runs, no editor or tool writes to the test repo),
and the script refuses when Astra's turn is not complete, a `claude -p` runs in the repo, or any
other process holds the target file open (/proc; not checked where /proc is unavailable).
Guarantees of the worktree swap (plain filesystem, no mandatory locks):
  - the current target is moved atomically (rename) to <git-dir>/pilot-intervention/ and kept there;
    nothing that was at the path is deleted;
  - a write completed before that move is detected (the moved bytes differ from the observed ones)
    and put back at the path if the path is still free: partial failure, code 2;
  - the intervention bytes are placed with link(), which fails instead of overwriting a file created
    at the path meanwhile: partial failure, code 2, that file is left alone;
  - a write through a descriptor opened before the move lands in the kept copy; it is detected if it
    completes before the final comparison, otherwise it is preserved there but not detected;
  - a write to the placed file afterwards is an ordinary later change (visible in `git status`).
The git refs and the index are protected by git's own locks and the compare-and-swap.
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

    def target_open_by(self):
        """Other processes holding the target file open (Linux /proc); ['unknown'] without /proc."""
        return open_by(self.repo / regressions.TARGET)

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

    def report(self, record):
        """INJECTION.md plus the hidden check and package verification after the commit (operator-only)."""
        cases = self.run_dir / 'acceptance-owner/cases.json'
        hidden = collect.hidden_check(self.repo, record['commit'], cases)
        hidden.pop('failures', None)
        after = self.coverage(self.rounds())
        record.update({'hidden_at_commit': hidden, 'package_coverage_after': after, 'packages_after': self.package_hashes()})
        write(self.results, 'injection.json', record)
        rows = [f"| {t} | {v.get('package')} | {'; '.join(v['problems']) or 'OK'} | {'; '.join(after[1]['rounds'].get(t, {}).get('problems', [])) or 'OK'} |"
                for t, v in record['package_coverage_before'][1].get('rounds', {}).items()]
        (self.results / 'INJECTION.md').write_text('\n'.join([
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

    def executor_commits(self):
        return git_out(self.repo, 'log', '--format=%H', f"--author={self.setup['git_identities']['executor']}").split()


def open_by(path):
    proc = Path('/proc')
    if not proc.is_dir():
        return ['unknown']
    target, found = str(Path(path).resolve()), []
    for fd_dir in proc.glob('[0-9]*/fd'):
        pid = fd_dir.parent.name
        if pid == str(os.getpid()):
            continue
        try:
            if any(os.readlink(fd) == target for fd in fd_dir.iterdir()):
                found.append(pid)
        except OSError:
            continue  # process ended or not ours to inspect
    return found


def observe(ctx):
    return {**ctx.git_view(), **ctx.bridge_view(), **ctx.manager_view(), 'claude_pids': ctx.claude_pids(),
            'target_open_by': ctx.target_open_by()}


DRIFT_KEYS = ('branch_ref', 'head', 'status', 'target_sha256', 'feature_state', 'latest_task_id', 'task_ids', 'open_attempts',
              'attempts', 'claude_pids', 'manager_turns', 'manager_last_turn', 'target_open_by')


def drift(before, after):
    return [k for k in DRIFT_KEYS if before.get(k) != after.get(k)]


def preconditions(state, rounds, coverage, reviewed, hidden, applicable, earlier, allow_waiting, accept_aborted, repo_quiescent):
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
        'no other process has the target file open': not state.get('target_open_by'),
        'operator confirmed the test repo is quiescent (--repo-quiescent)': bool(repo_quiescent),
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
    worktree/index still hold `old_bytes`, then swap the worktree file without clobbering (module
    docstring). Refused → nothing changed; PartialFailure → the commit is on the branch and a later
    step failed (recorded by the caller, never rolled back)."""
    repo = Path(repo)
    path = repo / target
    backup_dir = Path(git_out(repo, 'rev-parse', '--absolute-git-dir')) / 'pilot-intervention'
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
    backup_dir.mkdir(exist_ok=True)
    if os.stat(backup_dir).st_dev != os.stat(path.parent).st_dev:
        raise Refused(f'{backup_dir} is on another filesystem than the worktree; the swap needs an atomic rename')
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
    # From here the commit is on the branch; nothing below overwrites or deletes a foreign write.
    swap_worktree(path, backup_dir / f'{path.name}.replaced-{stamp()}', old_bytes, new_bytes)
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


def swap_worktree(path, backup, old_bytes, new_bytes):
    """Replace `path` by `new_bytes` without clobbering: move the current file aside atomically, check
    what was moved, then place the new bytes with link(), which fails if the path was re-created.
    The moved file is kept at `backup`."""
    tmp_file = path.with_name(f'.{path.name}.intervention-tmp')
    try:
        tmp_file.write_bytes(new_bytes)
        os.rename(path, backup)
    except OSError as exc:
        raise PartialFailure('worktree', f'could not move the target aside: {exc}; target untouched') from None
    if backup.read_bytes() != old_bytes:
        try:
            os.link(backup, path)  # put the foreign write back unless the path was re-created meanwhile
            where = f'restored at {path} and kept at {backup}'
        except FileExistsError:
            where = f'a new file exists at {path}; the moved content is kept at {backup}'
        raise PartialFailure('worktree', f'the target changed just before the swap; intervention bytes not applied ({where}; '
                                         f'intervention bytes at {tmp_file})')
    try:
        os.link(tmp_file, path)
    except FileExistsError:
        raise PartialFailure('worktree', f'the target was re-created during the swap and left untouched; replaced original kept '
                                         f'at {backup}; intervention bytes at {tmp_file}') from None
    except OSError as exc:
        raise PartialFailure('worktree', f'could not place the intervention bytes: {exc}; original kept at {backup}') from None
    tmp_file.unlink()
    if backup.read_bytes() != old_bytes:
        raise PartialFailure('worktree', f'a late write reached the replaced file through an old descriptor; kept at {backup}')


# ── orchestration ─────────────────────────────────────────────────────────────
def byte_ranges(before, after):
    ops = difflib.SequenceMatcher(None, before, after, autojunk=False).get_opcodes()
    return [{'op': op, 'before': [a0, a1], 'after': [b0, b1]} for op, a0, a1, b0, b1 in ops if op != 'equal']


def write(results, name, record):
    path = results / name
    path.write_text(json.dumps(record, indent=2, ensure_ascii=False) + '\n')
    return path


def run(ctx, dry_run, allow_waiting, accept_aborted, repo_quiescent=False):
    """Returns 0 (committed or dry run OK), 1 (refused, nothing changed) or 2 (partial failure)."""
    results, lock = ctx.results, ctx.results / 'injection.lock'
    try:
        acquire_lock(lock)
    except Refused as exc:
        write(results, f'injection-refused-{stamp()}.json', {'reason': str(exc)})
        print('REFUSED:', exc)
        return 1
    try:
        return _run_locked(ctx, dry_run, allow_waiting, accept_aborted, repo_quiescent)
    finally:
        release_lock(lock)


def _run_locked(ctx, dry_run, allow_waiting, accept_aborted, repo_quiescent):
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
                           allow_waiting, accept_aborted, repo_quiescent or dry_run)
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
        return partial_failure(ctx, record, stage, stages, exc)
    # Everything after the ref update is part of the intervention: any failure here is partial (2).
    stage = 'record'
    try:
        record.update({'commit': commit, 'stages': stages, 'observed_again': state1,
                       'committed_at_ms': int(git_out(repo, 'log', '-1', '--format=%ct', commit)) * 1000,
                       'files': git_out(repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', commit).split()})
        write(results, 'injection.json', record)
        stage = 'report'
        ctx.report(record)
    except Exception as exc:  # noqa: BLE001 — the commit exists; classify every failure as partial
        return partial_failure(ctx, record, stage, stages, exc, commit)
    print(f'INTERVENTION COMMITTED {commit} -> {results / "injection.json"}')
    return 0


def partial_failure(ctx, record, stage, stages, exc, commit=None):
    """Record a failure after the branch moved: trail file if possible, always stderr; code 2."""
    try:
        commit = commit or git_out(ctx.repo, 'rev-parse', 'HEAD')
    except (GitError, OSError):
        commit = commit or 'unknown'
    try:
        now = ctx.git_view()
    except (GitError, OSError) as view_error:
        now = {'error': str(view_error)}
    message = f'PARTIAL FAILURE after the branch moved (HEAD {commit}) at stage {stage}: {exc}'
    try:
        path = write(ctx.results, f'injection-failed-{stamp()}.json',
                     {**record, 'commit': commit, 'stage': stage, 'stages': stages, 'error': str(exc), 'git_now': now,
                      'note': 'not rolled back; inspect before any further step'})
        print(f'{message} -> {path}', file=sys.stderr)
    except Exception as trail_error:  # noqa: BLE001 — never lose the SHA and stage
        print(f'{message}; failure trail not written: {trail_error}', file=sys.stderr)
    return 2


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--run', required=True, help='run directory created by setup_rework.py')
    parser.add_argument('--results')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--allow-waiting', action='store_true')
    parser.add_argument('--accept-aborted-turn', action='store_true')
    parser.add_argument('--repo-quiescent', action='store_true',
                        help='operator confirms: Astra idle, no round running, nothing else writes to the test repo')
    args = parser.parse_args()
    run_dir = Path(args.run).resolve()
    results = Path(args.results or run_dir / 'operator-results').resolve()
    results.mkdir(parents=True, exist_ok=True)
    setup = json.loads((run_dir / 'SETUP.json').read_text())
    try:
        ctx = Context(setup['repo'], results, run_dir=run_dir, setup=setup)
    except GitError as exc:
        sys.exit(f'REFUSED: {exc}')
    sys.exit(run(ctx, args.dry_run, args.allow_waiting, args.accept_aborted_turn, args.repo_quiescent))


if __name__ == '__main__':
    main()
