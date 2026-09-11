"""Portability and separation checks for tools/pilot, plus the tooling dry run.

The dry run needs `npm ci --ignore-scripts && npm run build` in this checkout; it is skipped when the
build is missing or PILOT_SKIP_DRYRUN=1 (the preflight sets this to avoid running it twice).
"""
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
PILOT = HERE.parent
ROOT = PILOT.parents[1]
sys.path.insert(0, str(PILOT / 'common'))
sys.path.insert(0, str(PILOT / 'rework/operator'))
import collect_rework  # noqa: E402

OPERATOR_NAMES = re.compile(r'check_cases|EXPECTED\.md|inject_regression|regressions\.py|pilot-teammate|operator-results|'
                            r'operator/|tools/pilot|ingerencj|INJECTION|reference/src')
HINTS = ['units', 'float', '4.1', 'teammate', 'zespoł', 'regres', 'ingerenc', 'to_seconds', 'HEAD']


def files(root):
    return [p for p in sorted(root.rglob('*')) if p.is_file() and '__pycache__' not in p.parts]


class Portable(unittest.TestCase):
    def test_no_machine_or_experiment_paths(self):
        bad = re.compile(r'/home/|/Users/|experiments/|wave5|wave6|harness-bridge')
        hits = [str(p.relative_to(ROOT)) for p in files(PILOT) if p.suffix != '.pyc' and bad.search(p.read_text(errors='replace'))
                and p.name not in ('test_portable.py',)]
        self.assertEqual(hits, [])

    def test_agent_material_holds_no_operator_names(self):
        hits = [str(p.relative_to(PILOT)) for p in files(PILOT / 'rework/agent') if OPERATOR_NAMES.search(p.read_text(errors='replace'))]
        self.assertEqual(hits, [])

    def test_start_template_has_placeholders_and_no_hint(self):
        text = (PILOT / 'rework/agent/START-ASTRA.template.txt').read_text()
        self.assertIn('{CASES}', text)
        self.assertIn('{EXCHANGE}', text)
        self.assertEqual([h for h in HINTS if h.lower() in text.lower()], [])

    def test_operator_guide_shows_the_exact_request(self):
        self.assertIn(collect_rework.TRIGGER, (PILOT / 'rework/OPERATOR.md').read_text())


@unittest.skipIf(os.environ.get('PILOT_SKIP_DRYRUN') == '1', 'dry run disabled')
@unittest.skipUnless((ROOT / 'shared/control-plane/dist/feature-workflow.js').is_file()
                     and (ROOT / 'node_modules/@modelcontextprotocol/sdk').is_dir(), 'run npm ci --ignore-scripts && npm run build first')
class DryRun(unittest.TestCase):
    def test_tooling_dry_run_scores_every_criterion(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'dry'
            p = subprocess.run(['node', str(PILOT / 'rework/operator/dryrun.mjs'), str(out)], capture_output=True, text=True, timeout=600)
            rows = [l for l in p.stdout.splitlines() if l.startswith('| RC-')]
            self.assertEqual(p.returncode, 0, p.stdout[-2000:] + p.stderr[-2000:])
            self.assertEqual(len(rows), 16)
            self.assertFalse([p for p in files(PILOT) if 'claude-projects' in str(p) or 'operator-results' in str(p)])


if __name__ == '__main__':
    unittest.main()
