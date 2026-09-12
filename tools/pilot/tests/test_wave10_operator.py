"""Operator gates never launch models in tests."""
import importlib.util
import json
from pathlib import Path
import tempfile
import subprocess
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('wave10_operator', Path(__file__).parents[1] / 'wave10/pilot.py')
OP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(OP)


class Wave10OperatorTests(unittest.TestCase):
    def test_cli_starts_without_import_shadowing(self):
        result = subprocess.run([sys.executable, str(SPEC.origin), '--help'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('prepare', result.stdout)

    def test_existing_run_is_preserved(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / 'evidence').write_text('keep')
            with self.assertRaisesRegex(ValueError, 'destination exists'):
                OP.prepare(SimpleNamespace(run=root, runtime_sha='HEAD'))
            self.assertEqual((root / 'evidence').read_text(), 'keep')

    def test_changed_budget_cannot_launch(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            approval = {'approved': True, 'scope': OP.SCOPE, 'runtime_sha': 'sha',
                        'subscription_only_confirmed': True, 'budget': {**OP.BUDGET, 'claude_rounds': 5}}
            (root / 'approval.json').write_text(json.dumps(approval))
            with patch.object(OP, 'preflight', return_value={'runtime_sha': 'sha'}), patch.object(OP.os, 'execvp') as launch:
                with self.assertRaisesRegex(ValueError, 'exact scope/budget'):
                    OP.launch(SimpleNamespace(run=root, pair='a', mode='start'))
                launch.assert_not_called()

    def test_resume_never_guesses_missing_session(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            approval = {'approved': True, 'scope': OP.SCOPE, 'runtime_sha': 'sha',
                        'subscription_only_confirmed': True, 'budget': OP.BUDGET}
            (root / 'approval.json').write_text(json.dumps(approval))
            with patch.object(OP, 'preflight', return_value={'runtime_sha': 'sha'}), patch.object(OP.os, 'execvp') as launch:
                with self.assertRaises(FileNotFoundError):
                    OP.launch(SimpleNamespace(run=root, pair='a', mode='resume'))
                launch.assert_not_called()

    def test_snapshot_does_not_overwrite_evidence(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / 'evidence/before').mkdir(parents=True)
            with self.assertRaises(FileExistsError):
                OP.snapshot(SimpleNamespace(run=root, label='before'))

    def test_schedule_leaves_time_for_work_after_gate(self):
        budget = OP.BUDGET
        self.assertLess(budget['operator_window_seconds'], budget['gate_seconds'])
        self.assertLess(budget['gate_seconds'] * 1000, budget['gate_bash_timeout_ms'])
        self.assertLess(120000 + budget['gate_seconds'] * 1000 + budget['round_deadline_ms'],
                        budget['b_round2_deadline_ms'])
        self.assertLess(budget['b_round2_deadline_ms'], budget['mcp_timeout_seconds'] * 1000)
        # Latest B/r2 start at minute 30 leaves at least 10 minutes for final evidence.
        self.assertLessEqual(30 * 60 + budget['b_round2_deadline_ms'] / 1000 + 10 * 60,
                             budget['wall_minutes'] * 60)

    def test_gate_announces_and_release_finishes_without_waiting_for_a_result(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            script = root / 'gate.py'
            script.write_text(OP.gate_source())
            result = subprocess.run([sys.executable, str(script), '--announce-only'], cwd=root,
                                    capture_output=True, text=True, timeout=3)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((root / '.pilot/round2-started').exists())
            self.assertFalse((root / '.pilot/gate-ready').exists())
            (root / '.pilot/continue').touch()
            result = subprocess.run([sys.executable, str(script)], cwd=root,
                                    capture_output=True, text=True, timeout=3)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((root / '.pilot/gate-ready').exists())

    def test_gate_expires_even_when_release_arrives_after_deadline(self):
        import os
        import runpy
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            script = root / 'gate.py'
            script.write_text(OP.gate_source())
            (root / '.pilot').mkdir()
            (root / '.pilot/continue').touch()
            old_cwd = Path.cwd()
            try:
                os.chdir(root)
                with patch('time.monotonic', side_effect=[0, OP.BUDGET['gate_seconds']]), patch.object(sys, 'argv', [str(script)]):
                    with self.assertRaisesRegex(SystemExit, 'operator gate expired'):
                        runpy.run_path(str(script), run_name='__main__')
            finally:
                os.chdir(old_cwd)

    def test_launcher_refuses_at_whole_pilot_deadline(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            approval = {'approved': True, 'scope': OP.SCOPE, 'runtime_sha': 'sha',
                        'subscription_only_confirmed': True, 'budget': OP.BUDGET}
            (root / 'approval.json').write_text(json.dumps(approval))
            (root / 'started-at.txt').write_text('0')
            with patch.object(OP, 'preflight', return_value={'runtime_sha': 'sha'}), patch.object(OP.time, 'time', return_value=3600), patch.object(OP.os, 'execvp') as launch:
                with self.assertRaisesRegex(ValueError, '60 minute run budget exhausted'):
                    OP.launch(SimpleNamespace(run=root, pair='a', mode='start'))
                launch.assert_not_called()
