"""Exercise private hcom bookkeeping through its actual CLI; never launch a model."""
import copy
from datetime import datetime, timezone, timedelta
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HELPER = Path(__file__).resolve().parents[1] / '.agents/skills/feature-execute/scripts/hcom_state.py'


class HcomStateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.workspace = self.root / 'repo'
        self.workspace.mkdir()
        self.work = self.workspace / '.hcom-work'
        self.work.mkdir()
        self.state = self.root / 'operator'
        self.worker = self.root / 'bundle/claude'
        skill = self.worker / 'skills/feature-execute/SKILL.md'
        skill.parent.mkdir(parents=True)
        skill.write_text('synthetic selected skill')
        self.identity = 'sha256:' + 'a' * 64
        self.session = self.root / 'observed.json'
        self.write(self.session, {'name': 'worker-one', 'session_id': 'native-one', 'directory': str(self.workspace),
                                  'tool': 'claude', 'status': 'listening', 'hooks_bound': True, 'process_bound': True,
                                  'workflow_readiness': {'checked_at': datetime.now(timezone.utc).isoformat(),
                                      'terminal': {'ready': True, 'prompt_empty': True, 'input_text': ''}}})
        self.c = {'feature_id': 'F-test', 'task_id': 'T-1', 'round': 1, 'workspace': str(self.workspace),
                  'workflow_identity': self.identity, 'worker_root': str(self.worker),
                  'workflow_bundle': str(self.worker.parent), 'objective': 'Small change',
                  'base_commit': 'a' * 40, 'write_scope': ['app.py', 'docs/features/F-test/execution/T-1/**'],
                  'checks': ['python3 -m unittest'], 'ledger_dir': 'docs/features/F-test/execution/T-1',
                  'report_path': '.hcom-work/report-1.json'}

    def write(self, path, value):
        Path(path).write_text(json.dumps(value))
        return str(path)

    def cli(self, command, *args, ok=True, workspace=None, feature='F-test', state=None):
        proc = subprocess.run([sys.executable, str(HELPER), command, '--workspace', str(workspace or self.workspace),
                               '--feature', feature, '--state', str(state or self.state), *args],
                              text=True, capture_output=True)
        value = json.loads(proc.stdout)
        self.assertEqual(proc.returncode, 0 if ok else 2, (proc.stdout, proc.stderr))
        self.assertEqual(value['ok'], ok)
        if not ok:
            self.assertFalse(value['dispatch_permitted'])
            self.assertFalse(value['shutdown_permitted'])
        return value

    def initialize(self):
        return self.cli('init', '--workflow-identity', self.identity, '--worker-root', str(self.worker))

    def ready(self):
        self.initialize()
        self.cli('bind', '--session-file', str(self.session))

    def prepare(self, c=None, ok=True):
        c = self.c if c is None else c
        path = self.write(self.work / f'contract-{c["round"]}.json', c)
        return self.cli('prepare', '--contract', path, '--session-file', str(self.session), ok=ok)

    def delivery(self, c=None):
        c = self.c if c is None else c
        return {key: c[key] for key in ('feature_id', 'task_id', 'round', 'workflow_identity')} | {
            'summary': f'DELIVERY=local-v1 BASE={c["base_commit"]} HEAD={"b" * 40} '
                       f'LEDGER={c["ledger_dir"]}/01.md OUTCOME=COMPLETE WORKTREE=clean\nDelivered.',
            'status': 'COMPLETE', 'blocker': None, 'changed_scope': ['app.py', c['ledger_dir'] + '/01.md'],
            'remaining_risks': [], 'verification_results': [{'command': c['checks'][0], 'result': 'passed'}]}

    def receipt(self, data=None, decision='accepted', ok=True, path=None):
        data = self.delivery() if data is None else data
        dest = path or self.workspace / self.c['report_path']
        self.write(dest, data)
        return self.cli('receipt', '--report', str(dest), '--decision', decision,
                        '--note', 'Coordinator checked actual Git range and tests independently.', ok=ok)

    def test_prepare_requires_live_readiness_not_just_identity(self):
        self.ready()
        original = json.loads(self.session.read_text())
        for changed in [dict(original, workflow_readiness={}), dict(original, hooks_bound=False),
                        dict(original, process_bound=False), dict(original, status='active')]:
            self.write(self.session, changed)
            self.assertEqual(self.prepare(ok=False)['code'], 'LIVE_READINESS_REQUIRED')
        self.write(self.session, original | {'workflow_readiness': {
            'checked_at': (datetime.now(timezone.utc) - timedelta(seconds=61)).isoformat(),
            'terminal': {'ready': True, 'prompt_empty': True}}})
        self.assertEqual(self.prepare(ok=False)['code'], 'LIVE_READINESS_STALE')
        self.assertEqual(self.cli('status')['state']['rounds'], [])

    def test_init_is_bound_and_reentry_never_grants_launch(self):
        self.assertTrue(self.initialize()['launch_permitted'])
        self.assertFalse(self.initialize()['launch_permitted'])
        self.cli('init', '--workflow-identity', 'other', '--worker-root', str(self.worker), ok=False)
        other = self.root / 'another-repo'
        other.mkdir()
        self.cli('status', workspace=other, ok=False)
        self.cli('status', feature='F-other', ok=False)
        self.assertEqual(self.cli('status')['state']['workflow_identity'], self.identity)

    def test_missing_status_has_no_side_effects(self):
        self.cli('status', ok=False)
        self.assertFalse(self.state.exists())

    def test_state_must_be_outside_workspace_including_symlink(self):
        self.cli('init', '--workflow-identity', self.identity, '--worker-root', str(self.worker),
                 state=self.workspace / 'state', ok=False)
        link = self.root / 'linked'
        link.symlink_to(self.workspace, target_is_directory=True)
        self.cli('namespace', state=link / 'state', ok=False)
        self.assertFalse((self.workspace / 'state').exists())

    def test_exact_session_binding_cannot_be_replaced(self):
        self.ready()
        self.cli('check-session', '--session-file', str(self.session))
        observed = json.loads(self.session.read_text())
        for field, value in [('session_id', 'other-native'), ('name', 'other-worker'), ('directory', str(self.root))]:
            changed = observed | {field: value}
            self.write(self.session, changed)
            self.cli('bind', '--session-file', str(self.session), ok=False)
            self.cli('check-session', '--session-file', str(self.session), ok=False)
        self.assertEqual(self.cli('status')['state']['session']['session_id'], 'native-one')

    def test_prepare_snapshot_survives_uncertain_send_without_resend(self):
        self.ready()
        fresh = self.prepare()
        self.assertTrue(fresh['dispatch_permitted'])
        resumed = self.cli('status')
        self.assertFalse(resumed['dispatch_permitted'])
        self.assertIsNone(resumed['state']['rounds'][0]['send_event_id'])
        self.assertEqual(resumed['state']['rounds'][0]['contract'], self.c)
        self.prepare(ok=False)
        c2 = self.c | {'round': 2}
        self.prepare(c2, ok=False)
        # A lost sent acknowledgement is reconciled from history, not another send.
        self.cli('sent', '--event-id', '23')
        self.cli('sent', '--event-id', '23')
        self.cli('sent', '--event-id', '24', ok=False)
        self.assertFalse(self.cli('status')['dispatch_permitted'])

    def test_contract_mutation_does_not_change_saved_intent(self):
        self.ready()
        self.prepare()
        altered = self.c | {'objective': 'different task'}
        self.write(self.work / 'contract-1.json', altered)
        self.assertEqual(self.cli('status')['state']['rounds'][0]['contract']['objective'], 'Small change')
        self.prepare(altered, ok=False)

    def test_foreign_or_invalid_contract_never_prepares(self):
        self.ready()
        for changes in [{'feature_id': 'F-other'}, {'workspace': str(self.root)}, {'workflow_identity': 'other'},
                        {'worker_root': str(self.root)}, {'workflow_bundle': str(self.root)}, {'round': True}, {'base_commit': 'short'},
                        {'write_scope': ['../other']}, {'report_path': '../report.json'}, {'checks': []}]:
            with self.subTest(changes=changes):
                self.prepare(self.c | changes, ok=False)
                self.assertEqual(self.cli('status')['state']['rounds'], [])

    def test_session_change_before_prepare_is_refused(self):
        self.ready()
        observed = json.loads(self.session.read_text()) | {'session_id': 'other-native'}
        self.write(self.session, observed)
        self.prepare(ok=False)
        self.assertEqual(self.cli('status')['state']['rounds'], [])

    def test_receipt_then_correction_preserves_first_round(self):
        self.ready()
        self.prepare()
        first = self.receipt(decision='rework')['state']['rounds'][0]
        c2 = self.c | {'round': 2, 'base_commit': 'b' * 40, 'report_path': '.hcom-work/report-2.json'}
        prepared = self.prepare(c2)
        self.assertTrue(prepared['dispatch_permitted'])
        self.assertEqual(prepared['state']['rounds'][0], first)
        # A previous report cannot be used to settle the correction.
        self.receipt(ok=False)
        self.receipt(self.delivery(c2), path=self.workspace / c2['report_path'])
        self.assertEqual(len(self.cli('status')['state']['rounds']), 2)

    def test_stale_or_foreign_report_is_not_recorded(self):
        self.ready()
        self.prepare()
        for changes in [{'feature_id': 'F-other'}, {'task_id': 'other'}, {'round': 2},
                        {'workflow_identity': 'other'}, {'round': True}]:
            with self.subTest(changes=changes):
                self.receipt(self.delivery() | changes, ok=False)
        self.assertIsNone(self.cli('status')['state']['rounds'][0]['receipt'])

    def test_accept_requires_complete_and_all_contract_checks_passed(self):
        self.ready()
        self.prepare()
        for checks in [[], [{'command': 'different test', 'result': 'passed'}],
                       [{'command': self.c['checks'][0], 'result': 'not_run'}],
                       [{'command': self.c['checks'][0], 'result': 'failed'}]]:
            with self.subTest(checks=checks):
                self.receipt(self.delivery() | {'verification_results': checks}, ok=False)
        self.receipt(self.delivery() | {'blocker': 'pending issue'}, ok=False)
        partial = self.delivery()
        partial['status'] = 'PARTIAL'
        partial['summary'] = partial['summary'].replace('OUTCOME=COMPLETE', 'OUTCOME=PARTIAL')
        partial['blocker'] = 'unfinished code'
        self.receipt(partial, ok=False)
        self.receipt(partial, decision='blocked')
        self.prepare(self.c | {'round': 2}, ok=False)

    def test_malformed_delivery_and_wrong_base_are_not_receipts(self):
        self.ready()
        self.prepare()
        for summary in ['done', self.delivery()['summary'].replace('BASE=' + 'a' * 40, 'BASE=' + 'c' * 40),
                        self.delivery()['summary'].replace('LEDGER=' + self.c['ledger_dir'], 'LEDGER=other')]:
            self.receipt(self.delivery() | {'summary': summary}, ok=False)
        self.assertIsNone(self.cli('status')['state']['rounds'][0]['receipt'])

    def test_receipt_is_append_only(self):
        self.ready()
        self.prepare()
        stored = self.receipt()['state']['rounds'][0]['receipt']
        self.receipt(decision='rework', ok=False)
        self.assertEqual(self.cli('status')['state']['rounds'][0]['receipt'], stored)

    def identified_checks(self):
        self.c['checks'] = [{'id': 'unit', 'command': 'python3 -m unittest'},
                            {'id': 'direct', 'command': "python3 -c 'first line\nsecond line'"}]

    def identified_delivery(self):
        delivery = self.delivery()
        delivery['verification_results'] = [{'check_id': check['id'], 'result': 'passed'}
                                            for check in self.c['checks']]
        return delivery

    def stateless(self, operation, data=None, ok=True, digest=None):
        path = Path(self.write(self.work / 'contract-1.json', self.c))
        digest = digest or hashlib.sha256(path.read_bytes()).hexdigest()
        args = ['--contract', str(path), '--contract-sha256', digest]
        if data is not None:
            args += ['--report', self.write(self.workspace / self.c['report_path'], data)]
        return self.cli(operation, *args, ok=ok)

    def test_identified_multiline_check_needs_no_command_copy(self):
        self.identified_checks()
        self.ready()
        self.prepare()
        result = self.receipt(self.identified_delivery())
        self.assertEqual(result['state']['rounds'][0]['receipt']['decision'], 'accepted')

    def test_invalid_check_schemas_never_prepare(self):
        self.ready()
        for checks in [
            ['python3 -m unittest', {'id': 'direct', 'command': 'python3 check.py'}],
            [{'id': '', 'command': 'x'}], [{'id': '../outside', 'command': 'x'}],
            [{'id': 'unsafe space', 'command': 'x'}], [{'id': 'a' * 65, 'command': 'x'}],
            [{'id': True, 'command': 'x'}], [{'id': 'unit', 'command': ''}],
            [{'id': 'same', 'command': 'x'}, {'id': 'same', 'command': 'y'}],
        ]:
            with self.subTest(checks=checks):
                self.prepare(self.c | {'checks': checks}, ok=False)
                self.assertEqual(self.cli('status')['state']['rounds'], [])

    def test_identified_reports_refuse_unknown_duplicate_missing_or_changed_checks(self):
        self.identified_checks()
        self.ready()
        self.prepare()
        cases = [
            [], [{'check_id': 'unit', 'result': 'passed'}],
            [{'check_id': 'other', 'result': 'passed'}],
            [{'check_id': 'unit', 'result': 'passed'}] * 2,
            [{'command': 'python3 -m unittest', 'result': 'passed'}],
            [{'check_id': 'unit', 'result': 'passed'}, {'command': 'other', 'result': 'passed'}],
            [{'check_id': 'unit', 'result': 'failed'}, {'check_id': 'direct', 'result': 'passed'}],
            [{'check_id': 'unit', 'command': 'different execution', 'result': 'passed'},
             {'check_id': 'direct', 'result': 'passed'}],
        ]
        for checks in cases:
            with self.subTest(checks=checks):
                self.receipt(self.identified_delivery() | {'verification_results': checks}, ok=False)
                self.assertIsNone(self.cli('status')['state']['rounds'][0]['receipt'])
        good = self.identified_delivery()
        good['verification_results'][0]['command'] = self.c['checks'][0]['command']
        self.receipt(good)

    def test_legacy_abbreviation_can_be_corrected_in_same_round(self):
        self.c['checks'] = ["python3 -c 'first line\nsecond line'"]
        self.ready()
        self.prepare()
        shortened = self.delivery() | {'verification_results': [
            {'command': "python3 -c '<contract check>'", 'result': 'passed'}]}
        before = (self.state / 'state.json').read_bytes()
        refusal = self.receipt(shortened, ok=False)
        self.assertEqual(refusal['code'], 'REPORT_NOT_ACCEPTABLE')
        self.assertEqual(refusal['details']['missing_checks'], self.c['checks'])
        self.assertEqual((self.state / 'state.json').read_bytes(), before)
        # Correct the report, not the frozen contract or dispatch. Still one round.
        received = self.receipt()
        self.assertEqual(len(received['state']['rounds']), 1)
        self.assertEqual(received['state']['rounds'][0]['receipt']['decision'], 'accepted')

    def test_stateless_template_preserves_keys_without_claiming_pass(self):
        template = self.stateless('report-template')['report']
        self.assertEqual(template['verification_results'], [
            {'command': self.c['checks'][0], 'result': 'not_run', 'details': ''}])
        self.assertEqual(template['status'], 'PARTIAL')
        self.assertTrue(template['blocker'])
        self.assertFalse(self.state.exists())
        self.identified_checks()
        template = self.stateless('report-template')['report']
        self.assertEqual([v['check_id'] for v in template['verification_results']], ['unit', 'direct'])
        self.assertTrue(all(v['result'] == 'not_run' for v in template['verification_results']))
        self.assertFalse(self.state.exists())

    def test_worker_validation_is_read_only_and_not_a_receipt_or_grant(self):
        self.identified_checks()
        good = self.identified_delivery()
        result = self.stateless('validate-report', good)
        self.assertTrue(result['acceptable'])
        self.assertEqual(result['acceptance_issues'], {})
        for key in ('launch_permitted', 'dispatch_permitted', 'shutdown_permitted'):
            self.assertFalse(result[key])
        self.assertFalse(self.state.exists())
        missing = good | {'verification_results': good['verification_results'][:1]}
        result = self.stateless('validate-report', missing, ok=False)
        self.assertFalse(result['acceptable'])
        self.assertEqual(result['acceptance_issues']['missing_checks'], ['direct'])
        self.assertFalse(self.state.exists())
        self.ready()
        self.prepare()
        before = (self.state / 'state.json').read_bytes()
        self.stateless('validate-report', good)
        self.assertEqual((self.state / 'state.json').read_bytes(), before)

    def test_worker_validation_complete_failure_exits_nonzero_but_partial_can_notify(self):
        self.identified_checks()
        failed = self.identified_delivery()
        failed['verification_results'][0]['result'] = 'failed'
        answer = self.stateless('validate-report', failed, ok=False)
        self.assertEqual(answer['code'], 'REPORT_NOT_ACCEPTABLE')
        self.assertEqual(answer['acceptance_issues']['nonpassing_checks'], ['unit'])
        failed['status'] = 'PARTIAL'
        failed['summary'] = failed['summary'].replace('OUTCOME=COMPLETE', 'OUTCOME=PARTIAL')
        failed['blocker'] = 'Test failed; task is incomplete.'
        answer = self.stateless('validate-report', failed)
        self.assertTrue(answer['ok'])
        self.assertFalse(answer['acceptable'])
        self.assertFalse(answer['shutdown_permitted'])
        self.assertFalse(self.state.exists())

    def test_worker_validation_refuses_changed_contract_and_foreign_report(self):
        self.assertEqual(self.stateless('validate-report', self.delivery(), digest='0' * 64,
                                       ok=False)['code'], 'CONTRACT_SHA256_MISMATCH')
        self.stateless('validate-report', self.delivery() | {'feature_id': 'F-other'}, ok=False)
        self.assertFalse(self.state.exists())
        path = Path(self.write(self.work / 'contract-1.json', self.c))
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        wrong = self.write(self.work / 'wrong-report.json', self.delivery())
        self.cli('validate-report', '--contract', str(path), '--contract-sha256', digest,
                 '--report', wrong, ok=False)
        self.assertFalse(self.state.exists())

    def test_close_check_requires_accepted_receipt_and_send_ack(self):
        self.cli('close-check', '--session-file', str(self.session), ok=False)
        self.assertFalse(self.state.exists())
        self.ready()
        self.cli('close-check', '--session-file', str(self.session), ok=False)
        self.prepare()
        self.cli('close-check', '--session-file', str(self.session), ok=False)
        self.receipt(self.delivery() | {'verification_results': []}, ok=False)
        self.cli('close-check', '--session-file', str(self.session), ok=False)
        self.receipt()
        refusal = self.cli('close-check', '--session-file', str(self.session), ok=False)
        self.assertEqual(refusal['code'], 'SEND_ACKNOWLEDGEMENT_REQUIRED')
        self.cli('sent', '--event-id', '23')
        before = (self.state / 'state.json').read_bytes()
        result = self.cli('close-check', '--session-file', str(self.session))
        self.assertTrue(result['shutdown_permitted'])
        self.assertEqual((self.state / 'state.json').read_bytes(), before)
        self.assertFalse(self.cli('status')['shutdown_permitted'])

    def test_close_check_refuses_rework_and_blocked_receipts(self):
        for decision in ('rework', 'blocked'):
            with self.subTest(decision=decision):
                self.state = self.root / decision
                self.ready()
                self.prepare()
                self.cli('sent', '--event-id', '23')
                self.receipt(decision=decision)
                self.cli('close-check', '--session-file', str(self.session), ok=False)

    def test_close_check_refuses_changed_report_session_and_new_round(self):
        self.ready()
        self.prepare()
        self.cli('sent', '--event-id', '23')
        self.receipt()
        path = self.workspace / self.c['report_path']
        original = path.read_bytes()
        path.write_bytes(original + b'\n')
        self.assertEqual(self.cli('close-check', '--session-file', str(self.session), ok=False)['code'],
                         'ACCEPTED_REPORT_CHANGED')
        path.write_bytes(original)
        observed = json.loads(self.session.read_text())
        self.write(self.session, {'name': 'worker-one', 'session_id': 'other', 'directory': str(self.workspace)})
        self.cli('close-check', '--session-file', str(self.session), ok=False)
        self.write(self.session, observed)
        self.assertTrue(self.cli('close-check', '--session-file', str(self.session))['shutdown_permitted'])
        self.prepare(self.c | {'round': 2, 'report_path': '.hcom-work/report-2.json'})
        self.cli('close-check', '--session-file', str(self.session), ok=False)


if __name__ == '__main__':
    unittest.main()
