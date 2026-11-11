"""Startup guard tests use only a scripted hcom executable, never a model."""
from datetime import datetime, timezone, timedelta
import json
import os
from pathlib import Path
import subprocess
import shutil
import sqlite3
import sys
import unittest
import test_hcom_state as fixtures

STARTUP = fixtures.HELPER.with_name('hcom_startup.py')


class HcomStartupTests(unittest.TestCase):
    def setUp(self):
        self.f = fixtures.HcomStateTests()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.f.ready()
        self.bin = self.f.root / 'bin'
        self.bin.mkdir()
        self.log = self.f.root / 'calls.jsonl'
        self.data = self.f.root / 'live.json'
        self.bound = self.f.cli('status')['state']['session']
        self.row = self.bound | {'tool': 'claude', 'status': 'listening',
                                  'hooks_bound': True, 'process_bound': True}
        self.screen = {'ready': True, 'prompt_empty': True, 'input_text': ''}
        self.payload = {'rows': [self.row], 'screen': self.screen, 'messages': '', 'events': ''}
        self.write()
        stub = self.bin / 'hcom'
        stub.write_text('#!/usr/bin/env python3\n' +
            'import json,os,pathlib,sys\n' +
            f'd=json.loads(pathlib.Path({str(self.data)!r}).read_text())\n' +
            f'with open({str(self.log)!r},"a") as f: f.write(json.dumps([sys.argv[1:],os.environ.get("HCOM_DIR"),os.environ.get("HCOM_CLAUDE_DELIVERY"),os.environ.get("HCOM_CLAUDE_ARGS")])+"\\n")\n' +
            'a=sys.argv[1:]\n' +
            'if a[0]=="list": print(json.dumps(d["rows"]))\n' +
            'elif a[:2]==["term","inject"] or a[:2]==["--go","r"]:\n' +
            ' if d.get("fail"): sys.exit(1)\n' +
            ' print(json.dumps({"ok":True}))\n' +
            'elif a[0]=="term": print(json.dumps(d["screen"]))\n' +
            'elif "message" in a: print(d["messages"],end="")\n' +
            'else: print(d["events"],end="")\n')
        stub.chmod(0o755)
        self.counter = 0

    def write(self):
        self.data.write_text(json.dumps(self.payload))

    def run_guard(self, action, ok=True):
        self.counter += 1
        args = [sys.executable, str(STARTUP), action, '--workspace', str(self.f.workspace),
                '--feature', 'F-test', '--state', str(self.f.state)]
        self.snapshot = self.f.state / f'ready-{self.counter}.json'
        if action == 'check': args += ['--session-file', str(self.snapshot)]
        env = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ['PATH'],
                   HCOM_DIR='/foreign/state', HCOM_CLAUDE_DELIVERY='native', HCOM_CLAUDE_ARGS='unwanted prompt')
        p = subprocess.run(args, env=env, text=True, capture_output=True, timeout=20)
        self.assertEqual(p.returncode, 0 if ok else 2, p.stdout + p.stderr)
        data = json.loads(p.stdout)
        self.assertEqual(data['ok'], ok)
        return data

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def stopped(self):
        self.payload['rows'] = []
        self.event = {'id': 7, 'ts': datetime.now(timezone.utc).isoformat(),
                      'type': 'life', 'instance': self.bound['name'], 'data': {
                          'action': 'stopped', 'reason': 'exit:prompt_input_exit',
                          'snapshot': self.row}}
        self.payload['events'] = json.dumps(self.event)
        self.write()

    @unittest.skipUnless(shutil.which('hcom'), 'installed hcom unavailable (no model)')
    def test_installed_hcom_event_schema_accepts_normal_stop(self):
        # Actual CLI output, synthetic private DB. All lifecycle mutations still
        # use our stub; this test never launches or contacts a model/client.
        executable = shutil.which('hcom')
        version = subprocess.run([executable, '--version'], capture_output=True, text=True, timeout=10)
        if '0.7.31' not in version.stdout:
            self.skipTest('schema probe targets verified hcom0.7.31')
        self.run_guard('stop')
        isolated = self.f.root / 'schema-hcom'
        env = dict(os.environ, HCOM_DIR=str(isolated))
        argv = [executable, 'events', '--all', '--last', '1', '--full']
        init = subprocess.run(argv, env=env, text=True, capture_output=True, timeout=20)
        self.assertEqual(init.returncode, 0, init.stderr)
        event = {'action': 'stopped', 'reason': 'exit:prompt_input_exit', 'snapshot': self.row}
        with sqlite3.connect(isolated / 'hcom.db') as conn:
            conn.execute('INSERT INTO events(timestamp,type,instance,data) VALUES (?,?,?,?)',
                         (datetime.now(timezone.utc).isoformat(), 'life', self.bound['name'], json.dumps(event)))
        observed = subprocess.run(argv, env=env, text=True, capture_output=True, timeout=20)
        self.assertEqual(observed.returncode, 0, observed.stderr)
        value = json.loads(observed.stdout)
        self.assertIn('ts', value)
        self.payload['rows'] = []
        self.payload['events'] = observed.stdout
        self.write()
        self.assertTrue(self.run_guard('resume')['resume_requested'])

    def test_ready_snapshot_can_prepare_actual_round(self):
        self.assertTrue(self.run_guard('check')['ready'])
        self.f.session = self.snapshot
        self.assertTrue(self.f.prepare()['dispatch_permitted'])
        self.assertTrue(all(c[1] == str(self.f.state / 'hcom') for c in self.calls()))
        self.assertFalse(any(c[0][0] in ('send', '--go') for c in self.calls()))

    def test_readiness_requires_live_bindings_and_exact_identity(self):
        for change in [{'hooks_bound': False}, {'process_bound': False}, {'session_id': 'other'},
                       {'directory': str(self.f.root)}, {'status': 'active'}, {'tool': 'codex'}]:
            with self.subTest(change=change):
                self.payload['rows'] = [self.row | change]
                self.write()
                self.run_guard('check', False)
                self.assertFalse(self.snapshot.exists())

    def test_no_clear_or_enter_for_nonempty_unknown_or_unready_terminal(self):
        for screen in [{}, {'ready': False, 'prompt_empty': True},
                       {'ready': True, 'prompt_empty': False, 'input_text': 'draft'},
                       {'ready': True, 'prompt_empty': None}]:
            self.payload['screen'] = screen
            self.write()
            self.run_guard('check', False)
            self.run_guard('stop', False)
        self.assertFalse(any(c[0][:2] == ['term', 'inject'] for c in self.calls()))

    def test_one_normal_stop_and_same_session_resume_inject(self):
        self.run_guard('stop')
        self.run_guard('resume', False)  # still live
        self.stopped()
        result = self.run_guard('resume')
        self.assertTrue(result['resume_requested'])
        self.assertFalse(result['ready'])
        resumed = [c for c in self.calls() if c[0][:2] == ['--go', 'r']]
        self.assertEqual(len(resumed), 1)
        self.assertEqual(resumed[0][0], ['--go', 'r', self.bound['name'], '--headless',
                                       '--dir', str(self.f.workspace), '--json'])
        self.assertEqual(resumed[0][2:], ['inject', None])
        self.assertEqual(self.f.cli('status')['state']['session'], self.bound)
        self.run_guard('resume', False)
        self.run_guard('stop', False)
        self.assertEqual(len([c for c in self.calls() if c[0][:2] == ['--go', 'r']]), 1)
        self.payload['rows'] = [self.row]
        self.write()
        self.run_guard('check')
        self.f.session = self.snapshot
        self.assertTrue(self.f.prepare()['dispatch_permitted'])

    def test_pre_stop_snapshot_cannot_prepare_after_stop_or_resume(self):
        self.run_guard('check')
        self.f.session = self.snapshot
        self.run_guard('stop')
        self.assertEqual(self.f.prepare(ok=False)['code'], 'STARTUP_REPAIR_PENDING')
        self.stopped()
        self.run_guard('resume')
        self.assertEqual(self.f.prepare(ok=False)['code'], 'LIVE_READINESS_BEFORE_RESUME')

    def test_native_launch_blocked_can_stop_but_never_dispatch(self):
        self.payload['rows'] = [self.row | {'status': 'blocked', 'status_context': 'launch_blocked'}]
        self.write()
        self.run_guard('check', False)
        self.run_guard('stop')
        self.assertTrue((self.f.state / 'startup-stop-intent.json').exists())

    def test_other_blocked_states_cannot_stop(self):
        for context in ['approval', 'tool:Bash', None]:
            self.payload['rows'] = [self.row | {'status': 'blocked', 'status_context': context}]
            self.write()
            self.run_guard('stop', False)
        self.assertFalse((self.f.state / 'startup-stop-intent.json').exists())

    def test_uncertain_stop_is_never_repeated(self):
        self.payload['fail'] = True
        self.write()
        self.assertTrue(self.run_guard('stop', False)['command_attempted'])
        self.run_guard('stop', False)
        self.assertEqual(len([c for c in self.calls() if c[0][:2] == ['term', 'inject']]), 1)
        self.assertTrue((self.f.state / 'startup-stop-intent.json').exists())

    def test_uncertain_resume_is_never_repeated(self):
        self.run_guard('stop')
        self.stopped()
        self.payload['fail'] = True
        self.write()
        self.assertTrue(self.run_guard('resume', False)['command_attempted'])
        self.run_guard('resume', False)
        self.assertEqual(len([c for c in self.calls() if c[0][:2] == ['--go', 'r']]), 1)

    def test_prepared_but_unacknowledged_round_forbids_repair(self):
        self.f.prepare()
        self.assertEqual(self.run_guard('stop', False)['code'], 'STARTUP_REPAIR_AFTER_PREPARE_FORBIDDEN')
        self.assertEqual(self.run_guard('resume', False)['code'], 'STARTUP_REPAIR_AFTER_PREPARE_FORBIDDEN')
        self.assertEqual(self.calls(), [])

    def test_any_message_or_truncated_history_forbids_repair(self):
        for raw in ['{"type":"message"}', '{"truncated":true}', 'not json']:
            self.payload['messages'] = raw
            self.write()
            self.assertEqual(self.run_guard('stop', False)['code'], 'STARTUP_MESSAGES_EXIST')
        self.assertFalse((self.f.state / 'startup-stop-intent.json').exists())

    def test_malformed_history_or_live_list_refuses_with_diagnostic(self):
        self.run_guard('stop')
        self.stopped()
        for event in [None, {}, {'data': None}, {'data': {'snapshot': None}}, {'truncated': True}]:
            self.payload['events'] = json.dumps(event)
            self.write()
            self.run_guard('resume', False)
        self.payload['rows'] = [None]
        self.write()
        self.assertEqual(self.run_guard('resume', False)['code'], 'LIVE_LIST_REQUIRED')
        self.assertFalse((self.f.state / 'startup-resume-intent.json').exists())

    def test_foreign_old_abnormal_stop_cannot_resume(self):
        self.run_guard('stop')
        self.stopped()
        original = json.loads(json.dumps(self.event))
        variants = [original | {'ts': (datetime.now(timezone.utc)-timedelta(days=1)).isoformat()},
                    original | {'instance': 'other'}, original | {'data': original['data'] | {'reason': 'crash'}},
                    original | {'data': original['data'] | {'snapshot': self.row | {'session_id': 'other'}}}]
        for event in variants:
            self.payload['events'] = json.dumps(event)
            self.write()
            self.run_guard('resume', False)
        self.assertFalse((self.f.state / 'startup-resume-intent.json').exists())


if __name__ == '__main__':
    unittest.main()
