"""Synthetic CLI integration: lifecycle recovery uses scripted hcom, never a model."""
import copy
import importlib.util
from datetime import datetime, timezone, timedelta
import json
import os
import subprocess
import sys
import unittest
from unittest.mock import patch

import test_hcom_startup as startup_fixtures

LIFECYCLE = startup_fixtures.STARTUP.with_name('hcom_lifecycle.py')


class HcomLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.s = startup_fixtures.HcomStartupTests()
        self.s.setUp()
        self.addCleanup(self.s.doCleanups)
        self.f = self.s.f

    def state(self):
        return self.f.cli('status')['state']

    def save(self, state):
        self.f.write(self.f.state / 'state.json', state)

    def run_lifecycle(self, command, *extra, ok=True, key='operation-1', reason='Network restored'):
        argv = [sys.executable, str(LIFECYCLE), command, '--workspace', str(self.f.workspace),
                '--feature', 'F-test', '--state', str(self.f.state), '--key', key,
                '--reason', reason, '--decision-ref', 'decisions/06.md', *extra]
        env = dict(os.environ, PATH=str(self.s.bin) + os.pathsep + os.environ['PATH'],
                   HCOM_DIR='/foreign/state', HCOM_CLAUDE_DELIVERY='native',
                   HCOM_CLAUDE_ARGS='unwanted prompt', NO_COLOR='1', TERM='dumb')
        result = subprocess.run(argv, env=env, text=True, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0 if ok else 2, result.stdout + result.stderr)
        answer = json.loads(result.stdout)
        self.assertEqual(answer['ok'], ok)
        return answer

    def commands(self, prefix):
        return [call[0] for call in self.s.calls() if call[0][:len(prefix)] == prefix]

    def blocked(self):
        self.f.prepare()
        self.f.cli('sent', '--event-id', '23')
        report = self.f.delivery()
        report.update(status='PARTIAL', blocker='VPN temporarily unavailable')
        report['summary'] = report['summary'].replace('OUTCOME=COMPLETE', 'OUTCOME=PARTIAL')
        self.f.receipt(report, decision='blocked')
        return copy.deepcopy(self.state()['rounds'][0]['receipt'])

    def attestation(self, target):
        return ['--resolution', 'not-applied', '--target', target,
                '--confirm-command-ended', '--evidence-ref', 'execution/operator-check.md']

    def event(self, current, **changes):
        event = {'id': 24, 'ts': datetime.now(timezone.utc).isoformat(), 'type': 'message',
                 'instance': 'coordinator', 'data': {'intent': 'request', 'delivered_to': [self.s.bound['name']],
                  'text': f"Read {current['contract_path']} sha256 {current['contract_sha256']}"}}
        event.update(changes)
        return event

    def set_events(self, events):
        self.s.payload['events'] = '\n'.join(json.dumps(event) for event in events)
        self.s.write()

    def test_blocked_resume_and_next_prepare_preserve_receipt(self):
        receipt = self.blocked()
        self.assertEqual(self.f.prepare(self.f.c | {'round': 2}, ok=False)['code'], 'PREVIOUS_ROUND_UNSETTLED')
        result = self.run_lifecycle('resume')
        self.assertTrue(result['ready'])
        self.assertFalse(result['dispatch_permitted'])
        state = self.state()
        self.assertEqual(state['rounds'][0]['receipt'], receipt)
        self.assertEqual(state['rounds'][0]['continuation']['action'], 'unblocked')
        self.assertTrue(self.f.prepare(self.f.c | {'round': 2, 'report_path': '.hcom-work/report-2.json'})['dispatch_permitted'])
        self.assertEqual(self.state()['rounds'][0]['receipt'], receipt)
        self.assertEqual(self.commands(['send']), [])

    def test_resume_repeated_key_is_noop_and_conflicting_key_refused(self):
        self.blocked()
        self.run_lifecycle('resume')
        before = (self.f.state / 'state.json').read_bytes()
        self.assertTrue(self.run_lifecycle('resume')['replayed'])
        self.assertEqual((self.f.state / 'state.json').read_bytes(), before)
        self.assertEqual(self.run_lifecycle('resume', reason='Different decision', ok=False)['code'], 'IDEMPOTENCY_MISMATCH')
        self.assertEqual(self.commands(['--go', 'r']), [])

    def test_blocked_resume_refuses_changed_report(self):
        self.blocked()
        report = self.f.workspace / self.f.c['report_path']
        report.write_text(report.read_text() + '\n')
        self.assertEqual(self.run_lifecycle('resume', ok=False)['code'], 'RECEIVED_REPORT_CHANGED')
        self.assertNotIn('continuation', self.state()['rounds'][0])

    def test_uncertain_prepared_reconciles_exact_history_and_never_resends(self):
        self.f.prepare()
        current = self.state()['rounds'][0]
        valid = self.event(current)
        unrelated = self.event(current, id=20, data=dict(valid['data'], delivered_to=['other']))
        wrong_hash = self.event(current, id=21, data=dict(valid['data'], text=current['contract_path'] + ' badhash'))
        old = self.event(current, id=22, ts=(datetime.now(timezone.utc) - timedelta(days=1)).isoformat())
        self.set_events([unrelated, wrong_hash, old, valid])
        self.run_lifecycle('reconcile')
        self.assertEqual(self.state()['rounds'][0]['send_event_id'], '24')
        self.run_lifecycle('reconcile')
        self.assertEqual(self.run_lifecycle('resume', ok=False)['code'], 'RECEIPT_OR_RECONCILIATION_REQUIRED')
        self.assertEqual(self.f.prepare(self.f.c | {'round': 2}, ok=False)['code'], 'PREVIOUS_ROUND_UNSETTLED')
        self.assertEqual(self.commands(['send']), [])

    def test_multiple_matching_dispatches_refuse_acknowledgement(self):
        self.f.prepare()
        current = self.state()['rounds'][0]
        self.set_events([self.event(current), self.event(current, id=25)])
        self.assertEqual(self.run_lifecycle('reconcile', ok=False)['code'], 'MULTIPLE_MATCHING_DISPATCHES')
        self.assertIsNone(self.state()['rounds'][0]['send_event_id'])

    def test_not_sent_needs_explicit_evidence_and_does_not_replay_old_round(self):
        self.f.prepare()
        original = copy.deepcopy(self.state()['rounds'][0])
        self.assertEqual(self.run_lifecycle('reconcile', '--resolution', 'not-applied', '--target', 'prepared',
                                           ok=False)['code'], 'COMMAND_END_AND_EVIDENCE_REQUIRED')
        self.run_lifecycle('reconcile', *self.attestation('prepared'))
        current = self.state()['rounds'][0]
        self.assertEqual(current['contract'], original['contract'])
        self.assertEqual(current['disposition'], 'not_sent')
        self.assertIsNone(current['receipt'])
        self.assertEqual(self.f.cli('sent', '--event-id', 'late', ok=False)['code'], 'ROUND_RETIRED')
        self.assertEqual(self.f.receipt(ok=False)['code'], 'ROUND_RETIRED')
        self.f.prepare(ok=False)
        self.assertTrue(self.f.prepare(self.f.c | {'round': 2})['dispatch_permitted'])
        self.assertEqual(self.commands(['send']), [])

    def test_not_sent_cannot_erase_observed_dispatch(self):
        self.f.prepare()
        self.set_events([self.event(self.state()['rounds'][0])])
        self.assertEqual(self.run_lifecycle('reconcile', *self.attestation('prepared'), ok=False)['code'],
                         'DISPATCH_ALREADY_OBSERVED')
        self.assertNotIn('disposition', self.state()['rounds'][0])

    def test_stopped_worker_resume_reconciles_same_session_then_unblocks(self):
        receipt = self.blocked()
        self.s.stopped()
        result = self.run_lifecycle('resume', key='native-resume')
        self.assertTrue(result['resume_requested'])
        self.assertFalse(result['dispatch_permitted'])
        self.assertEqual(self.run_lifecycle('resume', key='native-resume', ok=False)['code'],
                         'RECONCILE_OPERATION_BEFORE_RETRY')
        self.assertEqual(len(self.commands(['--go', 'r'])), 1)
        self.s.payload['rows'] = [self.s.row]
        self.s.write()
        self.run_lifecycle('reconcile')
        self.assertEqual(self.state()['operations'][0]['status'], 'done')
        self.assertEqual(self.state()['session'], self.s.bound)
        self.assertEqual(self.state()['rounds'][0]['receipt'], receipt)
        self.assertNotIn('continuation', self.state()['rounds'][0])
        self.run_lifecycle('resume', key='unblock')
        self.assertIn('continuation', self.state()['rounds'][0])
        self.assertEqual(len(self.commands(['--go', 'r'])), 1)
        launch = next(call for call in self.s.calls() if call[0][:2] == ['--go', 'r'])
        self.assertEqual(launch[2:4], ['inject', None])
        self.assertTrue(all(call[1] == str(self.f.state / 'hcom') for call in self.s.calls()))

    def test_uncertain_resume_is_preserved_and_attested_before_new_key(self):
        self.s.stopped()
        self.s.payload['fail'] = True
        self.s.write()
        self.run_lifecycle('resume', ok=False)
        self.assertEqual(self.state()['operations'][0]['status'], 'intent')
        self.assertEqual(self.run_lifecycle('resume', ok=False)['code'], 'RECONCILE_OPERATION_BEFORE_RETRY')
        self.assertEqual(len(self.commands(['--go', 'r'])), 1)
        self.run_lifecycle('reconcile', *self.attestation('operation-1'))
        self.assertEqual(self.state()['operations'][0]['status'], 'not_applied')
        self.run_lifecycle('resume', ok=False)
        self.s.payload['fail'] = False
        self.s.write()
        self.assertTrue(self.run_lifecycle('resume', key='new-attempt')['resume_requested'])
        self.assertEqual(len(self.commands(['--go', 'r'])), 2)

    def test_resume_then_crash_before_reconcile_does_not_strand_pending_operation(self):
        self.s.stopped()
        self.run_lifecycle('resume')
        at = self.state()['operations'][0]['at']
        self.s.stopped()
        stopped_event = copy.deepcopy(self.s.event)
        stopped_event['id'] = 102
        stopped_event['data']['reason'] = 'exit:signal'
        self.set_events([{'id': 101, 'ts': at, 'type': 'life', 'instance': self.s.bound['name'],
                          'data': {'action': 'ready'}}, stopped_event])
        self.run_lifecycle('reconcile')
        self.assertEqual(self.state()['operations'][0]['outcome'], 'observed_ended')
        self.assertTrue(self.run_lifecycle('resume', key='second-resume')['resume_requested'])

    def test_resumed_but_launch_blocked_worker_can_be_cancelled(self):
        self.s.stopped()
        self.run_lifecycle('resume')
        self.s.payload['rows'] = [dict(self.s.row, status='blocked', status_context='launch_blocked',
                                      hooks_bound=False, process_bound=False)]
        self.s.write()
        self.run_lifecycle('reconcile')
        self.assertEqual(self.state()['operations'][0]['outcome'], 'observed_present')
        self.assertTrue(self.run_lifecycle('cancel', '--interrupt', key='cancel-after-resume')['shutdown_requested'])

    def test_successful_legacy_startup_repair_does_not_strand_blocked_round(self):
        self.blocked()
        past = datetime.now(timezone.utc) - timedelta(seconds=20)
        self.f.write(self.f.state / 'startup-stop-intent.json',
                     {'at': past.isoformat(), 'session': self.s.bound})
        self.s.stopped()
        self.s.event['ts'] = (past + timedelta(seconds=1)).isoformat()
        self.f.write(self.f.state / 'startup-resume-intent.json',
                     {'at': (past + timedelta(seconds=2)).isoformat(), 'session': self.s.bound})
        self.s.payload['rows'] = [self.s.row]
        self.s.payload['events'] = json.dumps(self.s.event)
        self.s.write()
        self.run_lifecycle('reconcile')
        self.assertEqual(len(self.state()['resolved_intents']), 2)
        self.assertTrue(self.run_lifecycle('resume')['ready'])

    def test_cancel_idle_then_observed_stop_preserves_all_rounds(self):
        self.blocked()
        rounds = copy.deepcopy(self.state()['rounds'])
        self.assertTrue(self.run_lifecycle('cancel')['shutdown_requested'])
        self.assertEqual(self.state()['lifecycle'], 'cancelling')
        self.assertEqual(self.run_lifecycle('cancel', ok=False)['code'], 'RECONCILE_OPERATION_BEFORE_RETRY')
        self.assertEqual(len(self.commands(['term', 'inject'])), 1)
        self.s.stopped()
        result = self.run_lifecycle('reconcile')
        self.assertEqual(result['lifecycle'], 'cancelled')
        self.assertEqual(self.state()['rounds'], rounds)
        self.assertTrue(self.run_lifecycle('cancel')['cancelled'])
        self.assertEqual(len(self.commands(['term', 'inject'])), 1)
        self.assertEqual(self.run_lifecycle('resume', key='after-cancel', ok=False)['code'], 'WORKFLOW_CANCELLED')
        self.f.prepare(self.f.c | {'round': 2}, ok=False)

    def test_busy_cancel_requires_interrupt_and_observed_stop(self):
        self.f.prepare()
        rounds = copy.deepcopy(self.state()['rounds'])
        self.s.payload['rows'] = [dict(self.s.row, status='active')]
        self.s.write()
        self.assertEqual(self.run_lifecycle('cancel', ok=False)['code'], 'BOUND_SESSION_NOT_READY')
        self.assertEqual(self.commands(['kill']), [])
        self.assertTrue(self.run_lifecycle('cancel', '--interrupt')['shutdown_requested'])
        self.assertEqual(self.commands(['kill']), [['kill', self.s.bound['name']]])
        self.s.stopped()
        self.s.event['data']['reason'] = 'exit:signal'
        self.s.payload['events'] = json.dumps(self.s.event)
        self.s.write()
        self.assertEqual(self.run_lifecycle('reconcile')['lifecycle'], 'cancelled')
        self.assertEqual(self.state()['rounds'], rounds)

    def test_pending_finish_reconcile_records_finished_without_new_exit(self):
        self.f.prepare()
        self.f.cli('sent', '--event-id', '23')
        self.f.receipt()
        self.f.write(self.f.state / 'finish-intent.json', {'at': datetime.now(timezone.utc).isoformat(),
                                                          'session': self.s.bound})
        state = self.state()
        state['lifecycle'] = 'finishing'
        self.save(state)
        self.assertEqual(self.run_lifecycle('resume', ok=False)['code'], 'FINISH_PENDING_RECONCILIATION')
        self.s.stopped()
        self.assertEqual(self.run_lifecycle('reconcile')['lifecycle'], 'finished')
        self.assertEqual(self.state()['resolved_intents']['finish-intent.json']['resolution'], 'observed_stopped')
        self.assertEqual(self.commands(['term', 'inject']), [])

    def test_unapplied_finish_requires_positive_operator_attestation(self):
        self.f.write(self.f.state / 'finish-intent.json', {'at': datetime.now(timezone.utc).isoformat(),
                                                          'session': self.s.bound})
        state = self.state()
        state['lifecycle'] = 'finishing'
        self.save(state)
        self.run_lifecycle('reconcile')
        self.assertNotIn('resolved_intents', self.state())
        self.run_lifecycle('reconcile', *self.attestation('finish-intent.json'))
        self.assertEqual(self.state()['lifecycle'], 'open')
        self.assertEqual(self.state()['resolved_intents']['finish-intent.json']['action'], 'not_applied')

    def test_abnormal_stop_resolves_finish_uncertainty_without_claiming_normal_exit(self):
        self.f.write(self.f.state / 'finish-intent.json', {'at': datetime.now(timezone.utc).isoformat(),
                                                          'session': self.s.bound})
        state = self.state()
        state['lifecycle'] = 'finishing'
        self.save(state)
        self.s.stopped()
        self.s.event['data']['reason'] = 'exit:signal'
        self.set_events([self.s.event])
        self.run_lifecycle('reconcile')
        self.assertEqual(self.state()['resolved_intents']['finish-intent.json']['resolution'], 'observed_abnormal_stop')
        self.assertTrue(self.run_lifecycle('cancel')['cancelled'])

    def test_legacy_state_and_pending_upgrade_deny_mutation_before_hcom(self):
        original = self.state()
        for changes, code in (({'format': 'feature-workflow.hcom-state/v1'}, 'STATE_UPGRADE_REQUIRED'),
                              ({'upgrade_pending': 'transaction-1'}, 'WORKFLOW_UPGRADE_PENDING')):
            with self.subTest(changes=changes):
                self.save(dict(original, **changes))
                for action in ('resume', 'cancel', 'reconcile'):
                    self.assertEqual(self.run_lifecycle(action, ok=False)['code'], code)
                self.assertEqual(self.s.calls(), [])

    def test_legacy_startup_intent_blocks_resume_and_cancel_until_reconciled(self):
        self.f.write(self.f.state / 'startup-stop-intent.json',
                     {'at': datetime.now(timezone.utc).isoformat(), 'session': self.s.bound})
        for action in ('resume', 'cancel'):
            with self.subTest(action=action):
                self.assertEqual(self.run_lifecycle(action, ok=False)['code'],
                                 'RECONCILE_INTENT_BEFORE_CANCEL' if action == 'cancel' else 'STARTUP_PENDING_RECONCILIATION')
        self.assertEqual(self.commands(['term', 'inject']), [])
        self.assertEqual(self.commands(['--go', 'r']), [])
        self.run_lifecycle('reconcile', *self.attestation('startup-stop-intent.json'))
        self.assertTrue(self.run_lifecycle('cancel')['shutdown_requested'])

    def test_unapplied_startup_stop_can_recover_launch_blocked_worker(self):
        self.f.write(self.f.state / 'startup-stop-intent.json',
                     {'at': datetime.now(timezone.utc).isoformat(), 'session': self.s.bound})
        self.s.payload['rows'] = [dict(self.s.row, status='blocked', status_context='launch_blocked',
                                      hooks_bound=False, process_bound=False)]
        self.s.write()
        self.run_lifecycle('reconcile', *self.attestation('startup-stop-intent.json'))
        self.assertTrue(self.s.run_guard('stop')['shutdown_requested'])
        self.assertEqual(len(list(self.f.state.glob('startup-stop-intent-*.json'))), 1)

    def test_observed_stop_cannot_be_relabelled_unapplied_after_worker_reappears(self):
        self.run_lifecycle('cancel')
        self.s.stopped()
        # An independently resumed native session is visible again. Prior stop still happened.
        self.s.payload['rows'] = [self.s.row]
        self.s.write()
        self.assertEqual(self.run_lifecycle('reconcile', *self.attestation('operation-1'), ok=False)['code'],
                         'NO_UNRESOLVED_OPERATION')
        self.assertEqual(self.state()['operations'][0]['status'], 'intent')
        # Reconcile the positive evidence separately; it does not falsely claim live absence.
        self.run_lifecycle('reconcile')
        self.assertEqual(self.state()['operations'][0]['status'], 'done')
        self.assertEqual(self.state()['lifecycle'], 'cancelling')
        self.assertTrue(self.run_lifecycle('cancel', key='second-cancel')['shutdown_requested'])

    def test_rebound_or_malicious_worker_name_never_reaches_mutating_command(self):
        self.s.payload['rows'] = [dict(self.s.row, session_id='another-native-session')]
        self.s.write()
        self.assertEqual(self.run_lifecycle('cancel', '--interrupt', ok=False)['code'], 'SESSION_MISMATCH')
        self.assertEqual(self.commands(['kill']), [])
        state = self.state()
        state['session']['name'] = '--all'
        self.save(state)
        self.s.payload['rows'] = [dict(self.s.row, name='--all')]
        self.s.write()
        self.run_lifecycle('cancel', '--interrupt', ok=False)
        self.assertEqual(self.commands(['kill']), [])

    def test_initialization_grant_is_explicit_and_one_shot(self):
        state = self.state()
        state['session'] = None
        self.save(state)
        self.s.payload['rows'] = []
        self.s.write()
        self.assertFalse(self.run_lifecycle('reconcile')['launch_permitted'])
        self.assertTrue(self.run_lifecycle('reconcile', *self.attestation('initialization'))['launch_permitted'])
        self.assertFalse(self.run_lifecycle('reconcile', *self.attestation('initialization'))['launch_permitted'])
        self.assertEqual(self.commands(['--go', 'r']), [])
        self.assertFalse(self.f.initialize()['launch_permitted'])
        self.s.payload['rows'] = [self.s.row]
        self.s.write()
        self.assertEqual(self.run_lifecycle('reconcile', *self.attestation('initialization'),
                                           key='new-key', ok=False)['code'], 'INITIALIZATION_ACTIVITY_OBSERVED')

    def test_history_paginates_by_id_without_losing_equal_timestamps(self):
        sys.path.insert(0, str(LIFECYCLE.parent))
        self.addCleanup(sys.path.remove, str(LIFECYCLE.parent))
        spec = importlib.util.spec_from_file_location('lifecycle_test', LIFECYCLE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        common = {'ts': datetime.now(timezone.utc).isoformat(), 'type': 'life',
                  'instance': 'coordinator', 'data': {'action': 'ready'}}
        recent = [dict(common, id=i) for i in range(2, 10002)]
        older = dict(common, id=1)
        answers = [json.dumps([self.s.row]), '\n'.join(map(json.dumps, recent)), json.dumps(older)]
        with patch.object(module.startup, 'command', side_effect=answers) as command:
            rows, row, events = module.observe(self.state(), {})
        self.assertEqual(len(events), 10001)
        self.assertIn('--sql', command.call_args_list[-1].args[0])
        self.assertEqual(command.call_args_list[-1].args[0][-1], 'id < 2')


if __name__ == '__main__':
    unittest.main()
