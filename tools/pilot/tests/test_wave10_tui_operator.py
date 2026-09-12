"""No-model checks for the PTY operator's safety boundaries."""
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parents[1] / 'wave10'
sys.path.insert(0, str(HERE))
try:
    import tui_operator as op
except ModuleNotFoundError as exc:
    if exc.name not in {"pexpect", "pyte"}:
        raise
    raise unittest.SkipTest("optional real-TUI operator requires pexpect and pyte") from exc


class TuiOperatorTests(unittest.TestCase):
    def test_identity_is_owned_by_child(self):
        with patch.dict(os.environ, {'CODEX_THREAD_ID':'parent', 'CODEX_INTERNAL_ORIGINATOR_OVERRIDE':'fake'}):
            env = op.clean_env()
            self.assertNotIn('CODEX_THREAD_ID', env)
            self.assertNotIn('CODEX_INTERNAL_ORIGINATOR_OVERRIDE', env)
            self.assertEqual(os.environ['CODEX_THREAD_ID'], 'parent')

    def test_paste_cannot_inject_terminal_controls(self):
        for text in ['hello\x1b[201~', 'hi\r/quit', '\x00']:
            with self.assertRaises(ValueError): op.paste(text)
        self.assertEqual(op.paste('first\nsecond'), '\x1b[200~first\nsecond\x1b[201~')

    def test_real_pty_transport_without_model(self):
        with tempfile.TemporaryDirectory() as directory:
            c = op.Client([sys.executable, '-c', 'import sys; print("READY",flush=True); print(input(),flush=True)'], Path(directory), 'a')
            import time
            end = time.monotonic()+5
            while 'READY' not in c.text() and time.monotonic()<end: c.poll()
            self.assertIn('READY', c.text())
            c.child.send('synthetic\r')
            while not c.exited and time.monotonic()<end: c.poll()
            self.assertTrue(c.exited)
            self.assertIn('synthetic', c.text())
            c.stop()

    def test_enter_waits_for_host_paste_marker(self):
        with tempfile.TemporaryDirectory() as directory:
            c = op.Client([sys.executable, '-c', 'print("[Pasted Content 100 chars]",flush=True); input(); print("SUBMITTED",flush=True)'], Path(directory), 'a')
            c.submit_when_visible = '[Pasted Content'
            c.pending_turn = True
            self.assertEqual(c.turns, 0)
            import time
            end = time.monotonic()+5
            while not c.exited and time.monotonic()<end: c.poll()
            self.assertIn('SUBMITTED', c.text())
            self.assertEqual(c.turns, 1)
            self.assertIsNone(c.submit_when_visible)
            c.stop()

    def test_turn_budget_blocks_before_send(self):
        c = object.__new__(op.Client)
        c.exited=False; c.closing=False; c.submit_when_visible=None; c.name='foreign'; c.turns=2
        with self.assertRaises(ValueError): c.send_prompt('must not send')

if __name__ == '__main__': unittest.main()
