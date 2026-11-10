"""Guarded exit uses a scripted hcom executable, never a real agent."""
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
import test_hcom_state as fixtures

FINISH = Path(__file__).resolve().parents[1] / '.agents/skills/feature-execute/scripts/hcom_finish.py'


class HcomFinishTests(unittest.TestCase):
    def setUp(self):
        self.f = fixtures.HcomStateTests()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.f.ready()
        self.f.prepare()
        self.f.cli('sent', '--event-id', 'event-1')
        self.bin = self.f.root / 'bin'
        self.bin.mkdir()
        self.log = self.f.root / 'hcom-calls.jsonl'
        self.observed = self.f.root / 'live.json'
        self.observed.write_text(json.dumps(json.loads(self.f.session.read_text()) |
                                           {'tool': 'claude', 'status': 'listening'}))
        self.terminal = self.f.root / 'terminal.json'
        self.terminal.write_text(json.dumps({'ready': True, 'prompt_empty': True, 'input_text': ''}))
        stub = self.bin / 'hcom'
        stub.write_text('#!/usr/bin/env python3\n' +
                        'import json, os, pathlib, sys\n' +
                        f'with open({str(self.log)!r}, "a") as f: f.write(json.dumps([sys.argv[1:], os.environ.get("HCOM_DIR")])+"\\n")\n' +
                        f'if sys.argv[1] == "list": print(pathlib.Path({str(self.observed)!r}).read_text())\n' +
                        f'elif sys.argv[1:2] == ["term"] and sys.argv[2] != "inject": print(pathlib.Path({str(self.terminal)!r}).read_text())\n' +
                        'elif os.environ.get("HCOM_TEST_FAIL_EXIT"): sys.exit(1)\n' +
                        'else: print("injected")\n')
        stub.chmod(0o755)

    def finish(self, ok, fail_exit=False):
        env = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ['PATH'],
                   HCOM_DIR='/wrong/inherited/namespace')
        if fail_exit:
            env['HCOM_TEST_FAIL_EXIT'] = '1'
        p = subprocess.run([sys.executable, str(FINISH), '--workspace', str(self.f.workspace),
                            '--feature', 'F-test', '--state', str(self.f.state)],
                           env=env, capture_output=True, text=True, timeout=30)
        data = json.loads(p.stdout)
        self.assertEqual(p.returncode, 0 if ok else 2, p.stdout + p.stderr)
        calls = [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []
        return data, calls

    def test_failed_receipt_never_closes_worker(self):
        self.f.receipt(self.f.delivery() | {'verification_results': []}, ok=False)
        data, calls = self.finish(False)
        self.assertFalse(data['terminal_command_attempted'])
        self.assertEqual(calls, [])

    def test_accepted_receipt_closes_only_bound_idle_session(self):
        self.f.receipt()
        data, calls = self.finish(True)
        self.assertTrue(data['shutdown_requested'])
        self.assertFalse(data['stopped_verified'])
        self.assertEqual([c[0] for c in calls], [['list', 'worker-one', '--json'],
                                               ['term', 'worker-one', '--json'],
                                               ['term', 'inject', 'worker-one', '/exit', '--enter']])
        self.assertTrue(all(c[1] == str(self.f.state / 'hcom') for c in calls))

    def test_changed_report_refuses_terminal_injection(self):
        self.f.receipt()
        (self.f.workspace / self.f.c['report_path']).write_text('{}')
        data, calls = self.finish(False)
        self.assertFalse(data['terminal_command_attempted'])
        self.assertTrue(all(c[0][0] == 'list' for c in calls))

    def test_wrong_session_and_busy_worker_are_not_closed(self):
        self.f.receipt()
        original = json.loads(self.observed.read_text())
        for change in [{'session_id': 'other'}, {'status': 'active'}, {'tool': 'codex'}]:
            with self.subTest(change=change):
                self.observed.write_text(json.dumps(original | change))
                data, calls = self.finish(False)
                self.assertFalse(data['terminal_command_attempted'])
                self.assertTrue(all(c[0][0] == 'list' for c in calls))

    def test_uncertain_exit_is_not_retried_or_claimed_stopped(self):
        self.f.receipt()
        data, calls = self.finish(False, fail_exit=True)
        self.assertTrue(data['terminal_command_attempted'])
        self.assertIsNone(data['shutdown_requested'])
        self.assertFalse(data['stopped_verified'])
        self.assertEqual(sum(c[0][:2] == ['term', 'inject'] for c in calls), 1)
        second, again = self.finish(False)
        self.assertIn('FINISH_ALREADY_REQUESTED', second['code'])
        self.assertEqual(calls, again)

    def test_terminal_draft_or_unknown_readiness_never_injects(self):
        self.f.receipt()
        for terminal in [{'ready': True, 'prompt_empty': False, 'input_text': 'draft'},
                         {'ready': False, 'prompt_empty': True},
                         {'ready': True, 'prompt_empty': None}, {}]:
            with self.subTest(terminal=terminal):
                self.terminal.write_text(json.dumps(terminal))
                data, calls = self.finish(False)
                self.assertFalse(data['terminal_command_attempted'])
                self.assertTrue(all(c[0][:2] != ['term', 'inject'] for c in calls))
                self.assertFalse((self.f.state / 'finish-intent.json').exists())


if __name__ == '__main__':
    unittest.main()
