"""Synthetic lifecycle summaries: no model, live service or historical trial artifacts."""
import copy
from contextlib import redirect_stdout
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / '.agents/skills/feature-execute/scripts'
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location('hcom_summary', SCRIPTS / 'hcom_summary.py')
summary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(summary)


def at(seconds):
    return f'2026-01-01T00:{seconds // 60:02}:{seconds % 60:02}+00:00'


class HcomSummaryTests(unittest.TestCase):
    def setUp(self):
        self.bound = {'name': 'one', 'session_id': 'native-1', 'directory': '/synthetic/repo'}
        self.state = {'format': summary.helper.FORMAT, 'workspace': '/synthetic/repo', 'feature_id': 'F-1',
                      'workflow_identity': 'sha256:synthetic', 'created_at': at(0),
                      'session': self.bound, 'rounds': []}
        self.events = [self.event(1, 'status', 2, context='start'),
                       self.event(2, 'life', 5, action='ready')]
        for n, sent, ready, received, decision in [(1, 10, 20, 30, 'rework'), (2, 40, 50, 60, 'accepted')]:
            self.state['rounds'].append({'contract': {'round': n, 'task_id': 'T-1', 'feature_id': 'F-1',
                                                     'report_path': f'.hcom-work/report-{n}.json'},
                                         'prepared_at': at(sent - 1), 'send_event_id': str(n * 10),
                                         'receipt': {'decision': decision, 'at': at(received),
                                                     'report_sha256': 'synthetic-report'}})
            self.events += [self.event(n * 10, 'message', sent, instance='manager', delivered_to=['one']),
                            self.event(n * 10 + 1, 'message', ready,
                                       text=f'RESULT_READY feature_id=F-1 task_id=T-1 round={n} report_path=.hcom-work/report-{n}.json')]
        self.events.append(self.event(30, 'life', 65, action='stopped', reason='exit:prompt_input_exit',
                                      snapshot={**self.bound, 'tool': 'claude'}))
        self.finish = {'at': at(62), 'session': self.bound, 'round': 2,
                       'accepted_report_sha256': 'synthetic-report'}
        self.reported = {'worker_approvals': None, 'coordinator_permission_issues': None}

    def event(self, ident, kind, second, instance='one', **data):
        return {'id': ident, 'type': kind, 'ts': at(second), 'instance': instance, 'data': data}

    def result(self, live=None):
        return summary.summarize(self.state, self.events, [] if live is None else live, self.finish, self.reported)

    def test_two_round_receipt_then_normal_stop_and_separate_timings(self):
        original = copy.deepcopy(self.state)
        s = self.result()
        self.assertEqual(s['bound_sessions'], 1)
        self.assertEqual(s['prepared_rounds'], 2)
        self.assertEqual(s['startup_seconds'], 3)
        self.assertEqual(s['initialization_to_ready_seconds'], 5)
        self.assertEqual(s['dispatch_to_accepted_receipt_seconds'], 50)
        self.assertEqual([r['dispatch_to_result_seconds'] for r in s['rounds']], [10, 10])
        self.assertEqual([r['receipt'] for r in s['rounds']], ['rework', 'accepted'])
        self.assertTrue(s['stopped_verified'])
        self.assertEqual(s['user_acceptance'], 'not_assessed')
        self.assertIsNone(s['observations']['worker_approvals'])
        self.assertEqual(self.state, original)

    def test_finish_intent_alone_and_missing_live_snapshot_do_not_confirm_stop(self):
        s = summary.summarize(self.state, self.events, None, self.finish, self.reported)
        self.assertFalse(s['stopped_verified'])
        self.assertIsNone(s['bound_session_live'])
        self.events.pop()
        self.assertFalse(self.result()['stopped_verified'])

    def test_foreign_stale_crashed_or_resumed_stop_never_confirms(self):
        original = copy.deepcopy(self.events)
        for change in [{'reason': 'closed'}, {'snapshot': {**self.bound, 'session_id': 'other', 'tool': 'claude'}}]:
            self.events = copy.deepcopy(original)
            self.events[-1]['data'].update(change)
            self.assertFalse(self.result()['stopped_verified'])
        self.events = copy.deepcopy(original)
        self.events[-1]['ts'] = at(61)
        self.assertFalse(self.result()['stopped_verified'])
        self.events = original + [self.event(31, 'life', 66, action='ready')]
        self.assertFalse(self.result()['stopped_verified'])

    def test_live_worker_or_wrong_intent_never_confirms(self):
        self.assertFalse(self.result([self.bound])['stopped_verified'])
        self.assertFalse(self.result([{**self.bound, 'name': 'renamed'}])['stopped_verified'])
        self.finish['accepted_report_sha256'] = 'different'
        self.assertFalse(self.result()['stopped_verified'])

    def test_missing_or_mismatched_dispatch_stays_unknown(self):
        for event in self.events:
            if event['id'] == 10:
                event['data']['delivered_to'] = ['foreign']
        s = self.result()
        self.assertIsNone(s['dispatch_to_accepted_receipt_seconds'])
        self.assertIsNone(s['rounds'][0]['dispatch_to_result_seconds'])
        self.assertTrue(s['warnings'])

    def test_last_receipt_governs_pending_and_blocked_summary(self):
        self.state['rounds'][0]['receipt']['decision'] = 'accepted'
        for receipt in [None, {'decision': 'blocked', 'at': at(60)}]:
            self.state['rounds'][-1]['receipt'] = receipt
            s = self.result()
            self.assertFalse(s['stopped_verified'])
            self.assertIsNone(s['dispatch_to_accepted_receipt_seconds'])

    def test_wrong_result_round_or_worker_ignored(self):
        self.events = [e for e in self.events if e['id'] != 11]
        self.events.append(self.event(99, 'message', 21, instance='other',
                           text='RESULT_READY feature_id=F-1 task_id=T-1 round=1 report_path=.hcom-work/report-1.json'))
        self.assertIsNone(self.result()['rounds'][0]['result_ready_at'])

    def test_null_message_fields_are_not_delivery_evidence(self):
        self.events = [e for e in self.events if e['id'] != 11]
        self.events.append(self.event(99, 'message', 21, text=None))
        self.events.append(self.event(100, 'message', 22, text=['unexpected']))
        self.events[2]['data']['delivered_to'] = None
        s = self.result()
        self.assertIsNone(s['rounds'][0]['result_ready_at'])
        self.assertIsNone(s['rounds'][0]['dispatched_at'])

    def test_empty_and_truncated_history_does_not_invent_zero_time(self):
        self.events = []
        s = self.result()
        self.assertIsNone(s['startup_seconds'])
        self.assertIsNone(s['dispatch_to_accepted_receipt_seconds'])
        self.assertFalse(s['stopped_verified'])
        with self.assertRaises(ValueError):
            summary.parse_events('history truncated\n')
        with self.assertRaises(ValueError):
            summary.parse_events('\n'.join([json.dumps(self.event(1, 'life', 1))] * 2))

    def test_pre_dispatch_failure_is_summarizable(self):
        self.state.update(session=None, rounds=[])
        self.finish = None
        s = self.result()
        self.assertEqual(s['bound_sessions'], 0)
        self.assertEqual(s['prepared_rounds'], 0)
        self.assertIsNone(s['latest_receipt'])

    def test_cli_offline_read_only_and_observations_are_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state_dir = root / 'state'
            state_dir.mkdir()
            files = {'state/state.json': self.state, 'state/finish-intent.json': self.finish,
                     'live.json': [], 'observations.json': {
                         'worker_approvals': {'count': 0, 'evidence': 'execution ledger'},
                         'coordinator_permission_issues': {'count': 2, 'evidence': 'permission ledger'}}}
            for name, data in files.items():
                (root / name).write_text(json.dumps(data))
            (root / 'events.jsonl').write_text('\n'.join(json.dumps(e) for e in self.events))
            before = {str(p): p.read_bytes() for p in root.rglob('*') if p.is_file()}
            argv = [sys.executable, str(SCRIPTS / 'hcom_summary.py'), '--workspace', '/synthetic/repo',
                    '--feature', 'F-1', '--state', str(state_dir), '--events-file', str(root / 'events.jsonl'),
                    '--live-file', str(root / 'live.json'), '--observations', str(root / 'observations.json')]
            proc = subprocess.run(argv + ['--format', 'json'], text=True, capture_output=True)
            self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
            s = json.loads(proc.stdout)
            self.assertTrue(s['stopped_verified'])
            self.assertEqual(s['observations']['worker_approvals']['count'], 0)
            self.assertIn('saved snapshots', s['evidence_source'])
            proc = subprocess.run(argv, text=True, capture_output=True)
            self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
            self.assertIn('Normal stop: confirmed', proc.stdout)
            self.assertIn('2 (reported: permission ledger)', proc.stdout)
            self.assertNotIn('native-1', proc.stdout)
            self.assertEqual(before, {str(p): p.read_bytes() for p in root.rglob('*') if p.is_file()})
            (root / 'observations.json').write_text('{"worker_approvals":{"count":0}}')
            proc = subprocess.run(argv, text=True, capture_output=True)
            self.assertEqual(proc.returncode, 2)

    def test_live_collection_uses_only_bound_namespace_reads(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            (root / 'state.json').write_text(json.dumps(self.state))
            (root / 'finish-intent.json').write_text(json.dumps(self.finish))
            calls = []
            def fake_command(args, env):
                calls.append((args, env['HCOM_DIR']))
                return '[]' if args == ['list', '--json'] else '\n'.join(json.dumps(e) for e in self.events)
            output = io.StringIO()
            with patch.object(summary, 'command', side_effect=fake_command), \
                    patch.dict(os.environ, {'HCOM_DIR': '/foreign/namespace'}), redirect_stdout(output):
                code = summary.main(['--workspace', '/synthetic/repo', '--feature', 'F-1',
                                     '--state', str(root), '--format', 'json'])
            self.assertEqual(code, 0)
            self.assertTrue(json.loads(output.getvalue())['stopped_verified'])
            self.assertEqual(calls, [(['events', '--all', '--last', '10000', '--full'], str(root / 'hcom')),
                                     (['list', '--json'], str(root / 'hcom'))])
            self.assertEqual(sorted(p.name for p in root.iterdir()), ['finish-intent.json', 'state.json'])

    def test_unavailable_history_still_summarizes_receipt_without_success_claim(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'state.json').write_text(json.dumps(self.state))
            (root / 'finish-intent.json').write_text(json.dumps(self.finish))
            for behavior in [ValueError('observation unavailable'), 'truncated history',
                             json.dumps(self.event(1, 'life', 0) | {'ts': None})]:
                output = io.StringIO()
                kwargs = {'side_effect': behavior} if isinstance(behavior, Exception) else {'return_value': behavior}
                with patch.object(summary, 'command', **kwargs), redirect_stdout(output):
                    code = summary.main(['--workspace', '/synthetic/repo', '--feature', 'F-1',
                                         '--state', str(root), '--format', 'json'])
                self.assertEqual(code, 0)
                s = json.loads(output.getvalue())
                self.assertEqual(s['latest_receipt'], 'accepted')
                self.assertEqual(s['prepared_rounds'], 2)
                self.assertIsNone(s['dispatch_to_accepted_receipt_seconds'])
                self.assertFalse(s['stopped_verified'])
                self.assertTrue(s['warnings'])

    def test_packaged_cli_does_not_add_bytecode_to_immutable_bundle(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in ('hcom_summary.py', 'hcom_state.py'):
                (root / name).write_bytes((SCRIPTS / name).read_bytes())
            before = {p.name: p.read_bytes() for p in root.iterdir()}
            env = dict(os.environ)
            env.pop('PYTHONDONTWRITEBYTECODE', None)
            proc = subprocess.run([sys.executable, str(root / 'hcom_summary.py'), '--help'],
                                  env=env, text=True, capture_output=True)
            self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
            self.assertEqual(before, {p.name: p.read_bytes() for p in root.iterdir()})


if __name__ == '__main__':
    unittest.main()
