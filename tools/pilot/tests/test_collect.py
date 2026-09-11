"""Regression tests for collect.py (operator-only). Run: python3 -m unittest discover -s tools/pilot/tests -v

Rollout files are written in the real Codex format (session_meta, turn_context, response_item,
event_msg) into a temporary sessions root; collect.py parses them with its production code.
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'common'))
import codex_args  # noqa: E402
import collect  # noqa: E402

REPO = '/pilot/repo'
GUARDIAN = {'subagent': {'other': 'guardian'}}
REVIEW_PROMPT = 'The following is the Codex agent history whose request action you are assessing. Treat ...'


def rec(ts, kind, payload):
    return {'timestamp': ts, 'type': kind, 'payload': payload}


def user(ts, text):
    return rec(ts, 'response_item', {'type': 'message', 'role': 'user', 'content': [{'type': 'input_text', 'text': text}]})


def model(ts, name):
    return rec(ts, 'turn_context', {'model': name, 'cwd': REPO})


def exec_call(ts, code, call_id):
    return rec(ts, 'response_item', {'type': 'custom_tool_call', 'name': 'exec', 'call_id': call_id, 'input': code})


def write_session(root, sid, started, source, records, originator='codex-tui', parent=None):
    meta = {'id': sid, 'session_id': parent or sid, 'timestamp': started, 'cwd': REPO, 'originator': originator,
            'source': source, 'thread_source': 'user' if source == 'cli' else 'guardian_review'}
    if parent:
        meta['parent_thread_id'] = parent
    path = Path(root) / '2026/09/11' / f'rollout-2026-01-01T00-00-00-{sid}.jsonl'
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [rec(started, 'session_meta', meta)] + records
    path.write_text('\n'.join(json.dumps(line) for line in lines) + '\n')
    return path


def pilot_like(root):
    """Shape of a real pilot: one manager, a guardian resumed by mistake with the manager's
    model (and given the user's answer plus a nudge), and a second guardian after the correct resume."""
    write_session(root, 'manager', '2026-01-01T15:23:47.856Z', 'cli', [
        model('2026-01-01T15:49:24.900Z', 'gpt-6-astra'),
        user('2026-01-01T15:49:24.978Z', 'Zlecenie testowe.'),
        exec_call('2026-01-01T15:59:53.475Z',
                  'text(await tools.mcp__bridge__bridge_feature_wait_user({feature_id:"F-001-duration",question_id:"q-01",'
                  'question:"Q-01: pytanie testowe \\u015b?"}));\n', 'c1'),
        model('2026-01-01T16:49:56.070Z', 'gpt-6-astra'),
        user('2026-01-01T16:49:56.124Z', 'Odpowiedź testowa: B; pytanie poboczne testowe?'),
        exec_call('2026-01-01T16:50:04.882Z', 'text(await tools.mcp__bridge__bridge_feature_get({feature_id:"F-001-duration"}));', 'c2'),
        exec_call('2026-01-01T16:50:14.706Z', 'text(await tools.mcp__bridge__bridge_feature_answer_user({feature_id:"F-001-duration",'
                  'question_id:"q-01",answer:"B (odpowiedź testowa)"}));', 'c3'),
        user('2026-01-01T16:57:24.037Z', 'Akceptacja testowa.'),
        exec_call('2026-01-01T16:58:10.010Z', 'text(await tools.mcp__bridge__bridge_feature_accept({feature_id:"F-001-duration"}));', 'c4'),
    ])
    write_session(root, 'guardian-1', '2026-01-01T15:23:48.189Z', GUARDIAN, [
        model('2026-01-01T15:49:37.693Z', 'codex-auto-review'),
        user('2026-01-01T15:49:37.694Z', REVIEW_PROMPT),
        user('2026-01-01T15:59:53.506Z', REVIEW_PROMPT),
        # resumed by mistake: the manager's model and the user's words land here
        model('2026-01-01T16:42:29.222Z', 'gpt-6-astra'),
        user('2026-01-01T16:42:29.224Z', 'Odpowiedź testowa: B; pytanie poboczne testowe?'),
        user('2026-01-01T16:43:53.967Z', 'kontynuuj (tekst testowy)'),
    ], parent='manager')
    write_session(root, 'guardian-2', '2026-01-01T16:49:22.931Z', GUARDIAN, [
        model('2026-01-01T16:50:04.964Z', 'codex-auto-review'),
        user('2026-01-01T16:50:04.965Z', REVIEW_PROMPT),
        user('2026-01-01T16:58:10.042Z', REVIEW_PROMPT),  # later than accept: must not matter
    ], parent='manager')


LOG = ['2026-01-01T17:23:32+02:00 start',
       '2026-01-01T18:40:47+02:00 resume guardian-1',
       '2026-01-01T18:49:20+02:00 resume manager']


class SessionSplit(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def split(self, manager_id=None):
        return collect.split_sessions(collect.codex_sessions(REPO, root=self.root), manager_id)

    def test_auxiliary_sessions_are_not_the_manager(self):
        pilot_like(self.root)
        split = self.split()
        self.assertEqual(split['status'], 'selected')
        self.assertEqual(split['manager']['session_id'], 'manager')
        self.assertEqual(sorted(s['session_id'] for s in split['auxiliary']), ['guardian-1', 'guardian-2'])
        self.assertEqual({s['aux_kind'] for s in split['auxiliary']}, {'guardian'})

    def test_manager_messages_counted_only_in_manager_session(self):
        pilot_like(self.root)
        result, detail = collect.pc11(self.split())
        self.assertEqual(result, 'PASS')
        self.assertEqual(detail['count'], 3)
        self.assertEqual(detail['excluded_auxiliary_human_messages'], 2)

    def test_guardian_resumed_with_manager_model_stays_auxiliary(self):
        pilot_like(self.root)
        split = self.split()
        guardian = next(s for s in split['auxiliary'] if s['session_id'] == 'guardian-1')
        self.assertEqual([m['model'] for m in guardian['models']], ['codex-auto-review', 'gpt-6-astra'])
        self.assertEqual([m['text'] for m in guardian['human_messages']],
                         ['Odpowiedź testowa: B; pytanie poboczne testowe?', 'kontynuuj (tekst testowy)'])
        self.assertEqual(len(guardian['reviewer_prompts']), 2)

    def test_manager_selection_matches_the_launcher(self):
        pilot_like(self.root)
        chosen = [s['session_id'] for s in collect.codex_sessions(REPO, root=self.root) if s['role'] == 'manager']
        metas = [{'source': 'cli', 'originator': 'codex-tui'}, {'source': GUARDIAN, 'originator': 'codex-tui'},
                 {'source': 'exec', 'originator': 'codex_exec'}]
        self.assertEqual(chosen, ['manager'])
        self.assertEqual([codex_args.is_manager_meta(m) for m in metas], [True, False, False])

    def test_accept_ordered_against_manager_messages_only(self):
        pilot_like(self.root)
        result, detail = collect.pc14(self.split())
        self.assertEqual(result, 'PASS')
        self.assertEqual(detail['last_manager_user_message'], '2026-01-01T16:57:24.037Z')
        self.assertEqual(detail['accept_call'], '2026-01-01T16:58:10.010Z')

    def test_accept_before_last_manager_message_fails(self):
        write_session(self.root, 'manager', '2026-01-01T15:00:00.000Z', 'cli', [
            user('2026-01-01T15:01:00.000Z', 'start'),
            exec_call('2026-01-01T15:05:00.000Z', 'await tools.mcp__bridge__bridge_feature_accept({feature_id:"F"});', 'c1'),
            user('2026-01-01T15:06:00.000Z', 'Akceptuję.'),
        ])
        self.assertEqual(collect.pc14(self.split())[0], 'FAIL')

    def test_ambiguous_manager_is_not_guessed(self):
        pilot_like(self.root)
        write_session(self.root, 'second-cli', '2026-01-01T17:00:00.000Z', 'cli', [user('2026-01-01T17:00:01.000Z', 'hej')])
        split = self.split()
        self.assertEqual(split['status'], 'ambiguous')
        self.assertIsNone(split['manager'])
        self.assertEqual(sorted(split['candidates']), ['manager', 'second-cli'])
        self.assertEqual(collect.pc11(split)[0], 'INFRA')
        self.assertEqual(collect.pc14(split)[0], 'INFRA')

    def test_operator_may_name_the_manager_explicitly(self):
        pilot_like(self.root)
        write_session(self.root, 'second-cli', '2026-01-01T17:00:00.000Z', 'cli', [user('2026-01-01T17:00:01.000Z', 'hej')])
        split = self.split(manager_id='manager')
        self.assertEqual(split['status'], 'operator-specified')
        self.assertEqual(split['manager']['session_id'], 'manager')
        self.assertIn('second-cli', [s['session_id'] for s in split['auxiliary']])
        with self.assertRaises(ValueError):
            self.split(manager_id='guardian-1')

    def test_missing_manager_is_infrastructure(self):
        write_session(self.root, 'guardian-1', '2026-01-01T15:23:48.189Z', GUARDIAN, [user('2026-01-01T15:49:37.694Z', REVIEW_PROMPT)])
        split = self.split()
        self.assertEqual(split['status'], 'missing')
        self.assertEqual(collect.pc11(split)[0], 'INFRA')

    def test_incidents_keep_the_misdirected_resume(self):
        pilot_like(self.root)
        kinds = {(i['kind'], i.get('session_id')) for i in collect.find_incidents(self.split(), collect.parse_operator_log(LOG))}
        self.assertIn(('resume_of_auxiliary_session', 'guardian-1'), kinds)
        self.assertIn(('human_input_in_auxiliary_session', 'guardian-1'), kinds)
        self.assertIn(('auxiliary_model_switch', 'guardian-1'), kinds)
        self.assertNotIn(('resume_of_auxiliary_session', 'manager'), kinds)


class ExecArguments(unittest.TestCase):
    def test_js_object_literal_arguments_are_parsed(self):
        calls = collect.exec_bridge_calls(
            'text(await tools.mcp__bridge__bridge_feature_wait_user({feature_id:"F-001",question_id:"q-01",'
            'question:"Q-01: jaki domy\\u015blny styl?",n:2,ok:true,tags:[\'a\',"b"],x:null}));')
        self.assertEqual(calls, [{'tool': 'bridge_feature_wait_user', 'parsed': True, 'args': {
            'feature_id': 'F-001', 'question_id': 'q-01', 'question': 'Q-01: jaki domyślny styl?', 'n': 2, 'ok': True,
            'tags': ['a', 'b'], 'x': None}}])

    def test_unparseable_arguments_are_kept_raw(self):
        calls = collect.exec_bridge_calls('await tools.bridge_feature_run({spec: buildSpec()});')
        self.assertEqual(calls[0]['tool'], 'bridge_feature_run')
        self.assertFalse(calls[0]['parsed'])
        self.assertIsNone(calls[0]['args'])

    def test_variable_argument_is_unparsed_not_empty(self):
        # R7-01: `request` must not look like a call without arguments.
        calls = collect.exec_bridge_calls('const request = {question: "private question"}; '
                                          'await tools.mcp__bridge__bridge_feature_wait_user(request);')
        self.assertEqual(len(calls), 1)
        self.assertFalse(calls[0]['parsed'])
        self.assertIsNone(calls[0]['args'])
        self.assertEqual(calls[0]['args_raw'], 'request')

    def test_call_without_arguments_is_parsed_empty(self):
        calls = collect.exec_bridge_calls('text(await tools.mcp__bridge__bridge_server_info());')
        self.assertEqual((calls[0]['args'], calls[0]['parsed']), ({}, True))


class Restart(unittest.TestCase):
    EVENTS = [{'state': 'waiting_user', 'at': '2026-01-01T15:59:56+00:00'},
              {'state': 'awaiting_review', 'at': '2026-01-01T16:50:14+00:00'}]
    SNAPS = [{'label': 'waiting-before-restart', 'at': '2026-01-01T16:36:25+00:00', 'feature_state': 'waiting_user', 'bridge_pids': ['1'], 'claude_p_pids': []},
             {'label': 'restart-offline', 'at': '2026-01-01T16:40:15+00:00', 'feature_state': 'waiting_user', 'bridge_pids': [], 'claude_p_pids': []},
             {'label': 'after-restart', 'at': '2026-01-01T16:41:56+00:00', 'feature_state': 'waiting_user', 'bridge_pids': ['2'], 'claude_p_pids': []}]

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        pilot_like(self.tmp.name)
        self.split = collect.split_sessions(collect.codex_sessions(REPO, root=self.tmp.name))

    def tearDown(self):
        self.tmp.cleanup()

    def test_restart_counts_the_manager_resume_not_the_label(self):
        result, detail = collect.pc08(self.SNAPS, self.EVENTS, self.split, collect.parse_operator_log(LOG))
        self.assertEqual(result, 'PASS')
        self.assertEqual(detail['manager_first_call_after_offline'], '2026-01-01T16:50:04.882Z')
        self.assertEqual(detail['state_at_manager_return'], 'waiting_user')
        self.assertEqual(detail['after_restart_snapshots_before_manager_resume'], ['after-restart'])

    def test_state_change_before_manager_returns_fails(self):
        events = self.EVENTS[:1] + [{'state': 'running', 'at': '2026-01-01T16:45:00+00:00'}] + self.EVENTS[1:]
        self.assertEqual(collect.pc08(self.SNAPS, events, self.split, collect.parse_operator_log(LOG))[0], 'FAIL')

    def test_no_offline_snapshot_is_not_evidence(self):
        self.assertEqual(collect.pc08(self.SNAPS[:1], self.EVENTS, self.split, [])[0], 'FAIL')


class CorrectionPath(unittest.TestCase):
    ROUNDS = [{'task_id': 't1', 'work_items': ['F-001-T01'], 'package': {'base': 'b1', 'head': 'h1'}, 'hidden': {'failures': [{'case': {'call': 'cli'}}]}},
              {'task_id': 't2', 'work_items': ['F-001-T02'], 'package': {'base': 'b2', 'head': 'h2'}, 'hidden': {'failures': []}}]
    ORDER = ['b1', 'h1', 'rev1', 'b2', 'h2']  # linear history

    def before(self, a, b):
        return self.ORDER.index(a) <= self.ORDER.index(b)

    def test_gap_absent_after_first_delivery_is_not_tested(self):
        result, detail = collect.pc04({'seeded_failures': [], 'failed': 3})
        self.assertEqual(result, 'NOT_TESTED')
        self.assertIn('precondition', detail['reason'])

    def test_gap_present_after_first_delivery_passes(self):
        self.assertEqual(collect.pc04({'seeded_failures': ['4.1h'], 'failed': 8})[0], 'PASS')

    def test_no_rework_and_no_in_scope_defect_is_not_tested(self):
        reviews = {'01.md': {'verdict': 'PASS', 'task_id': 't1', 'commit': 'rev1'}}
        result, detail = collect.pc06(self.ROUNDS, reviews, self.before)
        self.assertEqual(result, 'NOT_TESTED')
        self.assertEqual(detail['in_scope_failures_at_reviewed_heads'], {})

    def test_pass_review_over_an_in_scope_defect_fails(self):
        rounds = [dict(self.ROUNDS[0], hidden={'failures': [{'case': {'call': 'parse_duration', 'input': '4.1h'}}]})] + self.ROUNDS[1:]
        reviews = {'01.md': {'verdict': 'PASS', 'task_id': 't1', 'commit': 'rev1'}}
        self.assertEqual(collect.pc06(rounds, reviews, self.before)[0], 'FAIL')

    def test_rework_committed_before_the_next_round_base_passes(self):
        reviews = {'01.md': {'verdict': 'REWORK', 'task_id': 't1', 'commit': 'rev1'}}
        self.assertEqual(collect.pc06(self.ROUNDS, reviews, self.before)[0], 'PASS')

    def test_rework_after_the_next_round_started_does_not_count(self):
        reviews = {'01.md': {'verdict': 'REWORK', 'task_id': 't1', 'commit': 'h2'}}
        self.assertEqual(collect.pc06(self.ROUNDS, reviews, self.before)[0], 'FAIL')

    def test_review_verdict_comes_from_the_summary_line(self):
        text = '# Review 01 — T01\n\nPASS dla AC-01..AC-05. Brak REWORK.\n\n## Zakres\nREWORK w historii.\n'
        self.assertEqual(collect.review_verdict(text), 'PASS')
        self.assertEqual(collect.review_verdict('# R\n\nWerdykt: **REWORK** — F1.\n'), 'REWORK')


def git(repo, *args, author=None, date=None):
    env = dict(os.environ, GIT_CONFIG_GLOBAL='/dev/null', GIT_CONFIG_NOSYSTEM='1')
    if author:
        env.update(GIT_AUTHOR_NAME=author, GIT_AUTHOR_EMAIL=f'{author}@t.invalid', GIT_COMMITTER_NAME=author,
                   GIT_COMMITTER_EMAIL=f'{author}@t.invalid')
    if date:
        env.update(GIT_AUTHOR_DATE=date, GIT_COMMITTER_DATE=date)
    return subprocess.run(['git', '-C', str(repo), *args], env=env, check=True, capture_output=True, text=True).stdout.strip()


def commit(repo, author, files, message, date='2026-01-01T12:00:00+00:00'):
    for name, text in files.items():
        (Path(repo) / name).parent.mkdir(parents=True, exist_ok=True)
        (Path(repo) / name).write_text(text)
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', message, author=author, date=date)
    return git(repo, 'rev-parse', 'HEAD')


class RoundGraph(unittest.TestCase):
    """R7-02: scope per round from the declared package range in the git graph, not from time."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name) / 'repo'
        self.repo.mkdir()
        git(self.repo, 'init', '-q', '-b', 'main')
        # Every commit in the same second: time cannot tell the rounds apart.
        self.initial = commit(self.repo, 'setup', {'README': 'x'}, 'setup')
        self.head1 = commit(self.repo, 'claude-executor', {'src/lib.py': '1', 'src/cli.py': 'early'}, 'R1 work')
        self.rev = commit(self.repo, 'astra-codex', {'docs/reviews/01.md': 'PASS'}, 'review 01')
        self.head2 = commit(self.repo, 'claude-executor', {'src/cli.py': 'cli'}, 'R2 work')
        self.rounds = [
            {'task_id': 't1', 'state': 'DONE', 'scope': ['src/lib.py', 'tests/**'], 'package': {'base': self.initial, 'head': self.head1},
             'attempts': [{'started_at': 0, 'ended_at': 10**13}]},
            {'task_id': 't2', 'state': 'DONE', 'scope': ['src/cli.py'], 'package': {'base': self.rev, 'head': self.head2},
             'attempts': [{'started_at': 0, 'ended_at': 10**13}]}]

    def tearDown(self):
        self.tmp.cleanup()

    def commits(self):
        commits = collect.git_log(self.repo, self.initial)
        collect.assign_commits(self.repo, self.rounds, commits)
        return commits

    def test_commits_are_assigned_by_range_despite_identical_times(self):
        owners = {c['sha']: c['task'] for c in self.commits()}
        self.assertEqual((owners[self.head1], owners[self.rev], owners[self.head2]), ('t1', None, 't2'))

    def test_file_allowed_only_in_a_later_round_fails_the_earlier_one(self):
        result, detail = collect.scope_by_round(self.rounds, self.commits(), 'claude-executor', 'astra-codex')
        self.assertEqual(result, 'FAIL')
        self.assertEqual(detail['violations'], [[self.head1[:8], 't1', 'src/cli.py']])

    def test_executor_commit_outside_every_range_is_not_guessed(self):
        extra = commit(self.repo, 'claude-executor', {'src/lib.py': 'late'}, 'unpackaged work')
        self.rounds[0]['scope'].append('src/cli.py')  # remove the R1 violation to isolate the case
        result, detail = collect.scope_by_round(self.rounds, self.commits(), 'claude-executor', 'astra-codex')
        self.assertEqual(result, 'INFRA')
        self.assertEqual(detail['unassigned_executor_commits'], [extra[:8]])

    def test_overlapping_ranges_are_reported_not_resolved(self):
        self.rounds[1]['package']['base'] = self.initial  # R2 claims R1 commits and the manager's review
        self.rounds[0]['scope'].append('src/cli.py')
        self.rounds[1]['scope'] += ['src/lib.py', 'docs/**']
        commits = self.commits()
        self.assertIsNone(next(c['task'] for c in commits if c['sha'] == self.head1))
        result, detail = collect.scope_by_round(self.rounds, commits, 'claude-executor', 'astra-codex')
        self.assertEqual(result, 'FAIL')  # a round range holding the manager's commit is itself a violation
        self.assertIn(self.head1[:8], detail['ambiguous_commits'])
        self.assertEqual(detail['foreign_commits_in_round_ranges'], [[self.rev[:8], 'astra-codex', ['t2']]])

    def test_ambiguous_executor_commit_alone_is_infra(self):
        # Two rounds without a commit between them; R2 declares R1's base, so R1's work is claimed twice.
        repo = self.repo
        head3 = commit(repo, 'claude-executor', {'src/cli.py': 'more'}, 'R3 work')
        rounds = [{'task_id': 't2', 'state': 'DONE', 'scope': ['src/cli.py'], 'package': {'base': self.rev, 'head': self.head2}},
                  {'task_id': 't3', 'state': 'DONE', 'scope': ['src/cli.py'], 'package': {'base': self.rev, 'head': head3}}]
        commits = [c for c in collect.git_log(repo, self.rev)]
        collect.assign_commits(repo, rounds, commits)
        result, detail = collect.scope_by_round(rounds, commits, 'claude-executor', 'astra-codex')
        self.assertEqual(result, 'INFRA')
        self.assertEqual(detail['ambiguous_commits'], [self.head2[:8]])

    def test_manager_product_change_fails(self):
        commit(self.repo, 'astra-codex', {'src/lib.py': 'manager edit'}, 'manager edit')
        self.rounds[0]['scope'].append('src/cli.py')
        result, detail = collect.scope_by_round(self.rounds, self.commits(), 'claude-executor', 'astra-codex')
        self.assertEqual(result, 'FAIL')
        self.assertTrue(detail['manager_product_changes'])

    def test_no_executor_commit_is_bound_to_a_missing_range(self):
        self.rounds[1]['package'] = None
        self.rounds[0]['scope'].append('src/cli.py')
        result, detail = collect.scope_by_round(self.rounds, self.commits(), 'claude-executor', 'astra-codex')
        self.assertEqual(result, 'INFRA')
        self.assertEqual(detail['unassigned_executor_commits'], [self.head2[:8]])


class PackageCoverage(unittest.TestCase):
    """R7-03: every completed round needs its own linked, matching and verified package."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.exchange = Path(self.tmp.name)
        self.p1 = self.exchange / 'F-r01.zip'
        self.p1.write_bytes(b'round one')
        self.final = self.exchange / 'F-final-01.zip'
        self.final.write_bytes(b'coordinator handoff')
        self.rounds = [
            {'task_id': 't1', 'state': 'DONE', 'package': {'path': str(self.p1), 'sha256': hashlib.sha256(b'round one').hexdigest(),
                                                           'purpose': 'implementation-review', 'base': 'b1', 'head': 'h1'}},
            {'task_id': 't2', 'state': 'DONE', 'package': None}]
        self.verified = []

    def tearDown(self):
        self.tmp.cleanup()

    def verify(self, path, pkg):
        self.verified.append(Path(path).name)
        return True, {'integrity': 'ok'}

    def test_one_good_package_does_not_cover_a_missing_correction_package(self):
        result, detail = collect.package_coverage(self.rounds, self.exchange, self.verify)
        self.assertEqual(result, 'FAIL')
        self.assertEqual(detail['rounds']['t2']['problems'], ['deliverable has no PACKAGE/SHA256/PURPOSE/RANGE line'])
        self.assertEqual(detail['unlinked_archives'], ['F-final-01.zip'])

    def test_hash_mismatch_fails(self):
        self.rounds = self.rounds[:1]
        self.p1.write_bytes(b'changed')
        result, detail = collect.package_coverage(self.rounds, self.exchange, self.verify)
        self.assertEqual(result, 'FAIL')
        self.assertIn('sha256 differs from the deliverable', detail['rounds']['t1']['problems'])

    def test_verify_failure_fails(self):
        self.rounds = self.rounds[:1]
        result, _ = collect.package_coverage(self.rounds, self.exchange, lambda path, pkg: (False, {'error': 'head mismatch'}))
        self.assertEqual(result, 'FAIL')

    def test_every_round_linked_and_verified_passes(self):
        self.rounds = self.rounds[:1]
        result, detail = collect.package_coverage(self.rounds, self.exchange, self.verify)
        self.assertEqual(result, 'PASS')
        self.assertEqual(self.verified, ['F-r01.zip'])  # the coordinator handoff is not a round package

    def test_no_completed_round_is_not_applicable(self):
        self.assertEqual(collect.package_coverage([], self.exchange, self.verify)[0], 'N/A')


class ChannelEvidence(unittest.TestCase):
    """R7-01: the channel check needs complete evidence; missing coverage is INFRA, not PASS."""
    ROUNDS = [{'task_id': 't1', 'objective': 'Round 1 contract text', 'attempts': [{'attempt': 0}]},
              {'task_id': 't2', 'objective': 'Round 2 contract text', 'attempts': [{'attempt': 0}]}]
    PROMPTS = ['You are executing a bounded task delegated ...\nRound 1 contract text',
               'You are continuing the same feature session ...\nRound 2 contract text']

    def transcript(self, prompts):
        return {'found': True, 'bridge_prompts': len(prompts), '_prompts': prompts}

    def test_questions_come_from_the_bridge_even_when_codex_args_are_unparsed(self):
        calls = collect.exec_bridge_calls('await tools.mcp__bridge__bridge_feature_wait_user(request);')
        inventory = collect.question_inventory(['q-01'], calls, {'question': None}, [])
        self.assertEqual(inventory['texts'], {'q-01': None})
        self.assertEqual(inventory['unparsed_calls'], 1)
        snaps = [{'question': {'id': 'q-01', 'text': 'private question'}}]
        self.assertEqual(collect.question_inventory(['q-01'], calls, {'question': None}, snaps)['texts'], {'q-01': 'private question'})

    def test_unknown_question_text_is_infra(self):
        inventory = {'texts': {'q-01': None}, 'unparsed_calls': 1}
        result, detail = collect.channel_check(self.transcript(self.PROMPTS), self.ROUNDS, inventory, [], ['side question'])
        self.assertEqual(result, 'INFRA')
        self.assertEqual(detail['unresolved_questions'], ['q-01'])

    def test_transcript_without_bridge_prompts_is_infra(self):
        inventory = {'texts': {}, 'unparsed_calls': 0}
        result, detail = collect.channel_check(self.transcript([]), self.ROUNDS, inventory, [], ['side question'])
        self.assertEqual(result, 'INFRA')
        self.assertEqual(detail['prompt_coverage']['missing_tasks'], ['t1', 't2'])

    def test_missing_transcript_is_infra(self):
        result, _ = collect.channel_check({'found': False}, self.ROUNDS, {'texts': {}, 'unparsed_calls': 0}, [], ['x'])
        self.assertEqual(result, 'INFRA')

    def test_complete_evidence_without_leaks_passes(self):
        inventory = {'texts': {'q-01': 'private question'}, 'unparsed_calls': 1}
        result, _ = collect.channel_check(self.transcript(self.PROMPTS), self.ROUNDS, inventory, ['Round 1 contract text'], ['side question'])
        self.assertEqual(result, 'PASS')

    def test_leak_in_prompt_or_contract_fails(self):
        inventory = {'texts': {'q-01': 'private question'}, 'unparsed_calls': 0}
        leaky = [self.PROMPTS[0] + ' private question', self.PROMPTS[1]]
        self.assertEqual(collect.channel_check(self.transcript(leaky), self.ROUNDS, inventory, [], [])[0], 'FAIL')
        self.assertEqual(collect.channel_check({'found': False}, self.ROUNDS, inventory, ['private question in spec'], [])[0], 'FAIL')

    def test_unrecognised_transcript_file_counts_no_prompt(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / 'p').mkdir()
            (Path(tmp) / 'p' / 'handle-1.jsonl').write_text(json.dumps({'type': 'user', 'message': {'content': 'hello'}}) + '\n')
            with patch.dict(os.environ, {'PILOT_CLAUDE_PROJECTS': tmp}):
                transcript = collect.claude_transcript('handle-1', [], None)
        self.assertEqual((transcript['found'], transcript['bridge_prompts']), (True, 0))
        inventory = {'texts': {}, 'unparsed_calls': 0}
        self.assertEqual(collect.channel_check(transcript, self.ROUNDS, inventory, [], [])[0], 'INFRA')


class Times(unittest.TestCase):
    def test_mixed_timestamp_formats_compare_by_instant(self):
        self.assertLess(collect.ts_ms('2026-01-01T16:58:10.010Z'), collect.ts_ms('2026-01-01T16:58:10.042Z'))
        self.assertEqual(collect.ts_ms('2026-01-01T18:49:20+02:00'), collect.ts_ms('2026-01-01T16:49:20Z'))
        self.assertEqual(collect.ts_ms('2026-01-01T16:40:15+00:00'), collect.ts_ms('2026-01-01T16:40:15.000Z'))


if __name__ == '__main__':
    unittest.main()
