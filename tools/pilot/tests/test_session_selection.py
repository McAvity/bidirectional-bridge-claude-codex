import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'common'))
import codex_args  # noqa: E402

class SessionSelection(unittest.TestCase):
    def test_guardian_is_excluded_even_when_resumed_with_astra(self):
        with tempfile.TemporaryDirectory() as tmp:
            rows = []
            for timestamp, sid, source in [('1', 'manager', 'cli'), ('2', 'guardian', {'subagent': {'other': 'guardian'}})]:
                path = Path(tmp) / (sid + '.jsonl')
                path.write_text(json.dumps({'payload': {'source': source, 'originator': 'codex-tui'}}) + '\n' + json.dumps({'type': 'turn_context', 'payload': {'model': 'gpt-6-astra'}}))
                rows.append((timestamp, sid, path))
            with patch.object(codex_args, 'sessions', return_value=rows):
                self.assertEqual(codex_args.manager_session(tmp), 'manager')
                with self.assertRaises(ValueError):
                    codex_args.manager_session(tmp, '2')
            with patch.object(codex_args, 'sessions', return_value=[rows[0], rows[0]]):
                with self.assertRaises(ValueError):
                    codex_args.manager_session(tmp)

if __name__ == '__main__':
    unittest.main()
