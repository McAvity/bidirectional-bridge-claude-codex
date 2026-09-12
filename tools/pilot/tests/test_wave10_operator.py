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
