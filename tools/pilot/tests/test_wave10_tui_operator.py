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

    def client_fixture(self, directory):
        from unittest.mock import Mock
        c = object.__new__(op.Client)
        c.exited=False; c.closing=False; c.input_state='idle'
        c.turn_limit=None; c.turns=0; c.child=Mock(); c.command=[]
        c.text=Mock(return_value='initial screen')
        c.rollout_paths=Mock(return_value=[])
        return c

    def test_explicit_submit_short_and_multiline_without_display_label(self):
        for prompt in ('short', 'first\nsecond\nthird'):
            c=self.client_fixture(None)
            c.send_prompt(prompt)
            self.assertEqual(c.turns,0)
            c.text.return_value=prompt
            c.submit(c.screen_hash())
            self.assertEqual(c.child.send.call_args.args,('\r',))
            self.assertEqual(c.turns,1)
            self.assertEqual(c.input_state,'submitted_unconfirmed')
            with self.assertRaises(ValueError): c.submit(c.screen_hash())
            with self.assertRaises(ValueError): c.send_prompt(prompt)

    def test_delayed_display_requires_current_screen_and_never_auto_enters(self):
        c=self.client_fixture(None); c.send_prompt('one\ntwo')
        old=c.screen_hash()
        self.assertEqual(c.child.send.call_count,1)
        c.text.return_value='one\ntwo'
        with self.assertRaises(ValueError): c.submit(old)
        self.assertEqual(c.child.send.call_count,1)
        c.submit(c.screen_hash())
        self.assertEqual(c.child.send.call_count,2)

    def test_missing_confirmation_locks_input_until_exact_native_evidence(self):
        import json
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'rollout.jsonl'; path.write_text('')
            c=self.client_fixture(directory); c.rollout_paths.return_value=[path]
            c.send_prompt('one\ntwo'); c.submit(c.screen_hash())
            self.assertFalse(c.confirm_started())
            with self.assertRaises(ValueError): c.send_prompt('one\ntwo')
            with self.assertRaises(ValueError): c.close()
            start={'type':'event_msg','payload':{'type':'task_started','turn_id':'synthetic-turn'}}
            msg={'type':'response_item','payload':{'role':'user','content':[{'text':'one\ntwo'}]}}
            path.write_text(json.dumps(start)+'\n')
            self.assertFalse(c.confirm_started())
            with path.open('a') as f:f.write(json.dumps(msg)+'\n')
            self.assertTrue(c.confirm_started())
            self.assertEqual(c.confirmation['turn_id'],'synthetic-turn')
            self.assertEqual(c.child.send.call_count,2)

    def test_old_matching_turn_cannot_confirm_new_submission(self):
        import json
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'rollout.jsonl'
            path.write_text(json.dumps({'type':'event_msg','payload':{'type':'task_started','turn_id':'old'}})+'\n'+json.dumps({'type':'response_item','payload':{'role':'user','content':[{'text':'same'}]}})+'\n')
            c=self.client_fixture(directory);c.rollout_paths.return_value=[path]
            c.send_prompt('same');c.submit(c.screen_hash())
            self.assertFalse(c.confirm_started())

    def test_delayed_real_pty_explicit_enter_without_model(self):
        import time
        host = "import os,tty,time; tty.setraw(0); print('READY',flush=True); data=b''; " + "\nwhile not data.endswith(b'\x1b[201~'): data+=os.read(0,1)\ntime.sleep(.15)\nprint('RENDERED',flush=True)\nkey=os.read(0,1)\nprint('ENTER='+str(key==bytes([13])),flush=True)"
        for prompt in ('short', 'one\ntwo'):
            with tempfile.TemporaryDirectory() as directory:
                c=op.Client([sys.executable,'-c',host],Path(directory),'a')
                try:
                    end=time.monotonic()+5
                    while 'READY' not in c.text() and time.monotonic()<end:c.poll()
                    self.assertIn('READY',c.text());c.send_prompt(prompt)
                    while 'RENDERED' not in c.text() and time.monotonic()<end:c.poll()
                    self.assertIn('RENDERED',c.text());self.assertEqual(c.turns,0)
                    c.submit(c.screen_hash())
                    while not c.exited and time.monotonic()<end:c.poll()
                    self.assertIn('ENTER=True',c.text());self.assertEqual(c.turns,1)
                finally:c.stop()

    def test_planned_astra_turns_do_not_block_needed_state_read(self):
        from unittest.mock import Mock
        c=object.__new__(op.Client)
        c.exited=False; c.closing=False; c.input_state='idle'; c.command=[]
        c.turn_limit=None; c.turns=20; c.child=Mock()
        c.send_prompt('Read status only')
        c.child.send.assert_called_once()

    def test_turn_budget_blocks_before_send(self):
        c = object.__new__(op.Client)
        c.exited=False; c.closing=False; c.input_state='idle'; c.command=[]; c.name='foreign'; c.turns=2; c.turn_limit=2
        with self.assertRaises(ValueError): c.send_prompt('must not send')

if __name__ == '__main__': unittest.main()
