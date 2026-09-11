"""Tests for inject_regression.py (operator-only). Every test uses a throwaway git repository in a
temporary directory; no real run directory is ever touched.
Run: python3 -m unittest discover -s tools/pilot/tests -v
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
PILOT = HERE.parent
sys.path.insert(0, str(PILOT / 'common'))
sys.path.insert(0, str(PILOT / 'rework/operator'))
import inject_regression as inj  # noqa: E402
import regressions  # noqa: E402

TARGET = regressions.TARGET
OLD = (PILOT / 'rework/agent/fixture' / TARGET).read_bytes()
NEW = regressions.apply(OLD.decode()).encode()
ENV = dict(os.environ, GIT_CONFIG_GLOBAL='/dev/null', GIT_CONFIG_NOSYSTEM='1')


def git(repo, *args, author='someone'):
    env = dict(ENV, GIT_AUTHOR_NAME=author, GIT_AUTHOR_EMAIL=f'{author}@t.invalid',
               GIT_COMMITTER_NAME=author, GIT_COMMITTER_EMAIL=f'{author}@t.invalid')
    return subprocess.run(['git', '-C', str(repo), *args], env=env, check=True, capture_output=True, text=True).stdout.strip()


class Repo(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.repo = self.root / 'repo'
        (self.repo / 'src/textkit').mkdir(parents=True)
        (self.repo / TARGET).write_bytes(OLD)
        (self.repo / 'README').write_text('x\n')
        git(self.repo, 'init', '-q', '-b', 'main')
        git(self.repo, 'add', '-A')
        git(self.repo, 'commit', '-q', '-m', 'setup', author='pilot-setup')
        self.head = git(self.repo, 'rev-parse', 'HEAD')

    def tearDown(self):
        self.tmp.cleanup()

    def commit_intervention(self, expected=None):
        return inj.commit_intervention(self.repo, expected or self.head, 'refs/heads/main', TARGET, OLD, NEW,
                                       regressions.TEAMMATE, regressions.COMMIT_MESSAGE, [])


class CompareAndSwapCommit(Repo):
    def test_commit_lands_as_the_teammate_on_top_of_the_observed_head(self):
        stages = []
        new = inj.commit_intervention(self.repo, self.head, 'refs/heads/main', TARGET, OLD, NEW,
                                      regressions.TEAMMATE, regressions.COMMIT_MESSAGE, stages)
        self.assertEqual(git(self.repo, 'rev-parse', 'HEAD'), new)
        self.assertEqual(git(self.repo, 'rev-parse', 'HEAD^'), self.head)
        self.assertEqual(git(self.repo, 'log', '-1', '--format=%an|%cn'), 'pilot-teammate|pilot-teammate')
        self.assertEqual((self.repo / TARGET).read_bytes(), NEW)
        self.assertEqual(git(self.repo, 'status', '--porcelain'), '')
        self.assertEqual(stages, ['objects', 'ref', 'worktree', 'index'])

    def test_foreign_commit_after_the_observation_is_never_overwritten(self):
        (self.repo / TARGET).write_bytes(OLD + b'# teammate edit\n')
        git(self.repo, 'commit', '-qam', 'foreign change', author='other-person')
        foreign = git(self.repo, 'rev-parse', 'HEAD')
        with self.assertRaises(inj.Refused):
            self.commit_intervention()
        self.assertEqual(git(self.repo, 'rev-parse', 'HEAD'), foreign)
        self.assertEqual((self.repo / TARGET).read_bytes(), OLD + b'# teammate edit\n')
        self.assertNotIn('pilot-teammate', git(self.repo, 'log', '--format=%an'))

    def test_uncommitted_change_in_the_target_is_left_alone(self):
        (self.repo / TARGET).write_bytes(OLD + b'# work in progress\n')
        with self.assertRaises(inj.Refused):
            self.commit_intervention()
        self.assertEqual(git(self.repo, 'rev-parse', 'HEAD'), self.head)
        self.assertEqual((self.repo / TARGET).read_bytes(), OLD + b'# work in progress\n')

    def test_head_moving_just_before_the_ref_update_is_refused(self):
        real = inj.git_out

        def racing(repo, *args, **kw):
            if args[:1] == ('update-ref',):  # someone commits between the checks and the ref update
                (self.repo / 'README').write_text('raced\n')
                git(self.repo, 'commit', '-qam', 'race', author='other-person')
            return real(repo, *args, **kw)
        with patch.object(inj, 'git_out', racing):
            with self.assertRaises(inj.Refused) as ctx:
                self.commit_intervention()
        self.assertIn('compare-and-swap', str(ctx.exception))
        self.assertEqual(git(self.repo, 'log', '-1', '--format=%s'), 'race')
        self.assertEqual((self.repo / TARGET).read_bytes(), OLD)

    def test_failure_after_the_ref_update_is_partial_and_not_rolled_back(self):
        real = inj.git_out

        def broken_index(repo, *args, **kw):
            if args[:2] == ('update-index', '--cacheinfo') and 'env' not in kw:
                raise inj.GitError('simulated index lock')
            return real(repo, *args, **kw)
        stages = []
        with patch.object(inj, 'git_out', broken_index):
            with self.assertRaises(inj.PartialFailure) as ctx:
                inj.commit_intervention(self.repo, self.head, 'refs/heads/main', TARGET, OLD, NEW,
                                        regressions.TEAMMATE, regressions.COMMIT_MESSAGE, stages)
        self.assertEqual(ctx.exception.stage, 'index')
        self.assertEqual(stages, ['objects', 'ref', 'worktree'])
        self.assertEqual(git(self.repo, 'log', '-1', '--format=%an'), 'pilot-teammate')  # commit kept, no reset


class Drift(unittest.TestCase):
    BASE = {'branch_ref': 'refs/heads/main', 'head': 'a', 'status': '', 'target_sha256': 's', 'feature_state': 'awaiting_review',
            'latest_task_id': 't1', 'task_ids': ['t1'], 'open_attempts': 0, 'attempts': 1, 'claude_pids': [],
            'manager_turns': 2, 'manager_last_turn': 'complete'}

    def test_identical_observations_have_no_drift(self):
        self.assertEqual(inj.drift(self.BASE, dict(self.BASE)), [])

    def test_every_relevant_change_is_drift(self):
        for key, value in (('head', 'b'), ('status', ' M x'), ('target_sha256', 't'), ('feature_state', 'running'),
                           ('latest_task_id', 't2'), ('task_ids', ['t1', 't2']), ('open_attempts', 1), ('attempts', 2),
                           ('claude_pids', ['9']), ('manager_turns', 3), ('manager_last_turn', 'started')):
            self.assertEqual(inj.drift(self.BASE, dict(self.BASE, **{key: value})), [key], key)


class Lock(unittest.TestCase):
    def test_second_injector_is_refused_and_the_lock_kept(self):
        with tempfile.TemporaryDirectory() as tmp:
            lock = Path(tmp) / 'injection.lock'
            inj.acquire_lock(lock)
            with self.assertRaises(inj.Refused):
                inj.acquire_lock(lock)
            self.assertTrue(lock.exists())
            inj.release_lock(lock)
            self.assertFalse(lock.exists())


class Preconditions(unittest.TestCase):
    STATE = dict(Drift.BASE)
    COVERAGE = ('PASS', {'rounds': {'t1': {'problems': []}}})
    ROUNDS = [{'task_id': 't1', 'state': 'DONE'}]
    HIDDEN = ({'failed': 0}, {'failed': 7})

    def checks(self, **kw):
        args = dict(state=self.STATE, rounds=self.ROUNDS, coverage=self.COVERAGE, reviewed=True, hidden=self.HIDDEN,
                    applicable=True, earlier=[], allow_waiting=False, accept_aborted=False)
        args.update(kw)
        return inj.preconditions(**args)

    def test_all_conditions_hold(self):
        self.assertTrue(all(self.checks().values()))

    def test_aborted_turn_needs_the_explicit_exception(self):
        state = dict(self.STATE, manager_last_turn='aborted')
        self.assertFalse(all(self.checks(state=state).values()))
        self.assertTrue(all(self.checks(state=state, accept_aborted=True).values()))

    def test_completed_round_without_package_blocks(self):
        coverage = ('FAIL', {'rounds': {'t1': {'problems': ['deliverable has no PACKAGE/SHA256/PURPOSE/RANGE line']}}})
        self.assertFalse(self.checks(coverage=coverage)['every completed round has its own verified package'])

    def test_no_completed_round_blocks(self):
        self.assertFalse(self.checks(rounds=[], coverage=('N/A', {'rounds': {}}))['every completed round has its own verified package'])

    def test_earlier_trail_blocks(self):
        self.assertFalse(self.checks(earlier=['injection-failed-20260911T180000Z.json'])['no earlier intervention or trail'])


class Orchestration(Repo):
    """The whole flow with a real git repository and stand-ins only for the bridge, Codex and tests."""
    def context(self, **kw):
        results = self.root / 'results'
        results.mkdir(exist_ok=True)
        ctx = inj.Context(repo=self.repo, results=results, branch_ref='refs/heads/main')
        ctx.bridge_view = lambda: {'feature_state': 'awaiting_review', 'latest_task_id': 't1', 'task_ids': ['t1'], 'open_attempts': 0, 'attempts': 1}
        ctx.manager_view = lambda: {'manager_turns': 2, 'manager_last_turn': 'complete'}
        ctx.claude_pids = lambda: []
        ctx.rounds = lambda: [{'task_id': 't1', 'state': 'DONE'}]
        ctx.coverage = lambda rounds: ('PASS', {'rounds': {'t1': {'problems': [], 'package': 'r01.zip'}}})
        ctx.package_hashes = lambda: {'r01.zip': 'aaa'}
        ctx.reviewed = lambda: True
        ctx.evaluate = lambda head: ({'ok': True}, {'passed': 47, 'failed': 0}, {'ok': True}, {'passed': 40, 'failed': 7})
        ctx.executor_commits = lambda: []
        for key, value in kw.items():
            setattr(ctx, key, value)
        return ctx

    def trails(self):
        return sorted(p.name for p in (self.root / 'results').glob('injection*'))

    def test_success_records_started_and_final_trail(self):
        code = inj.run(self.context(), dry_run=False, allow_waiting=False, accept_aborted=False)
        self.assertEqual(code, 0)
        record = json.loads((self.root / 'results/injection.json').read_text())
        self.assertEqual(record['commit'], git(self.repo, 'rev-parse', 'HEAD'))
        self.assertEqual(record['completed_rounds_before'], ['t1'])
        self.assertEqual(record['package_tasks_before'], ['t1'])
        self.assertIn('injection-started.json', self.trails())
        self.assertFalse((self.root / 'results/injection.lock').exists())

    def test_repo_change_between_the_checks_and_the_write_is_refused(self):
        def evaluate_while_someone_commits(head):
            (self.repo / 'README').write_text('changed during the checks\n')
            git(self.repo, 'commit', '-qam', 'concurrent', author='other-person')
            return {'ok': True}, {'passed': 47, 'failed': 0}, {'ok': True}, {'passed': 40, 'failed': 7}
        code = inj.run(self.context(evaluate=evaluate_while_someone_commits), dry_run=False, allow_waiting=False, accept_aborted=False)
        self.assertEqual(code, 1)
        self.assertEqual(git(self.repo, 'log', '-1', '--format=%s'), 'concurrent')
        self.assertNotIn('pilot-teammate', git(self.repo, 'log', '--format=%an'))
        refused = [n for n in self.trails() if n.startswith('injection-refused')]
        self.assertEqual(len(refused), 1)
        self.assertIn('head', json.loads((self.root / 'results' / refused[0]).read_text())['drift'])

    def test_manager_turn_starting_during_the_checks_is_refused(self):
        turns = iter([{'manager_turns': 2, 'manager_last_turn': 'complete'}, {'manager_turns': 3, 'manager_last_turn': 'started'}])
        code = inj.run(self.context(manager_view=lambda: next(turns)), dry_run=False, allow_waiting=False, accept_aborted=False)
        self.assertEqual(code, 1)
        self.assertEqual(git(self.repo, 'rev-parse', 'HEAD'), self.head)

    def test_git_failure_after_start_keeps_a_failure_trail(self):
        real = inj.git_out

        def broken_index(repo, *args, **kw):
            if args[:2] == ('update-index', '--cacheinfo') and 'env' not in kw:
                raise inj.GitError('simulated index lock')
            return real(repo, *args, **kw)
        with patch.object(inj, 'git_out', broken_index):
            code = inj.run(self.context(), dry_run=False, allow_waiting=False, accept_aborted=False)
        self.assertEqual(code, 2)
        failed = [n for n in self.trails() if n.startswith('injection-failed')]
        self.assertEqual(len(failed), 1)
        self.assertEqual(json.loads((self.root / 'results' / failed[0]).read_text())['stage'], 'index')
        self.assertFalse((self.root / 'results/injection.json').exists())
        # A second run refuses because the trail exists; nothing is reset.
        self.assertEqual(inj.run(self.context(), dry_run=False, allow_waiting=False, accept_aborted=False), 1)

    def test_dry_run_commits_nothing(self):
        self.assertEqual(inj.run(self.context(), dry_run=True, allow_waiting=False, accept_aborted=False), 0)
        self.assertEqual(git(self.repo, 'rev-parse', 'HEAD'), self.head)
        self.assertTrue(any(n.startswith('injection-dryrun') for n in self.trails()))


if __name__ == '__main__':
    unittest.main()
