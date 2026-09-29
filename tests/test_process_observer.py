"""Synthetic Linux procfs regression tests; no sudo or model is invoked."""
import importlib.util
import os
import io
import json
from contextlib import redirect_stdout
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('observer', Path(__file__).resolve().parents[1] / 'scripts/setup/process-observer.py')
observer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(observer)


class ProcessObserverTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.proc = Path(self.tmp.name) / 'proc'
        self.root = Path(self.tmp.name) / 'workspace with spaces'
        self.proc.mkdir()
        self.root.mkdir()
        self.uid = os.getuid()

    def process(self, pid=200, argv=('sleep',), comm='sleep', cwd=None, files=(), start='123', state='S'):
        base = self.proc / str(pid)
        base.mkdir(exist_ok=True)
        (base / 'fd').mkdir(exist_ok=True)
        (base / 'stat').write_text(f'{pid} (name with ) parentheses) ' + ' '.join([state] + ['0'] * 18 + [start]))
        (base / 'cmdline').write_bytes(b'\0'.join(os.fsencode(arg) for arg in argv))
        (base / 'comm').write_text(comm)
        (base / 'cwd').symlink_to(cwd or self.root)
        for i, target in enumerate(files):
            (base / 'fd' / str(i)).symlink_to(target)
        return base

    def run_scan(self):
        return observer.observe(str(self.root), self.uid, 100, str(self.proc))

    def test_unrelated_process_and_workspace_with_spaces(self):
        self.process()
        self.assertEqual(self.run_scan(), {'supported': True, 'entries': [], 'unreadable': 0})

    def test_client_launcher_and_state_holder(self):
        self.process(argv=('node', '/runtime/native-bridge-mcp.mjs', '--workspace', str(self.root), 'PRIVATE'),
                     comm='codex', cwd=Path(self.tmp.name), files=(str(self.root / '.bridge/db'),))
        self.process(pid=201, comm='claude')
        r = self.run_scan()
        self.assertTrue(r['supported'])
        self.assertEqual(r['entries'][0]['kinds'], ['bridge-mcp', 'state-open'])
        self.assertEqual(r['entries'][1]['kinds'], ['client'])
        self.assertNotIn('PRIVATE', str(r))
        self.assertNotIn(str(self.root), str(r))

    def test_dispatcher_and_empty_argv_holder(self):
        self.process(argv=('node', '.bridge-project/entry.mjs'))
        self.process(pid=201, argv=(), files=(str(self.root / '.bridge/db'),))
        r = self.run_scan()
        self.assertTrue(r['supported'])
        self.assertEqual([x['kinds'] for x in r['entries']], [['bridge-mcp'], ['state-open']])

    def test_no_daemon_name_allowlist(self):
        for pid, name in enumerate(('systemd', 'sshd', 'ssh-agent'), 200):
            self.process(pid=pid, comm=name, files=(str(self.root / '.bridge/db'),))
        self.assertEqual(len(self.run_scan()['entries']), 3)

    def test_other_uid_and_installer_excluded(self):
        self.process(pid=100, comm='codex')
        base = self.process(comm='claude')
        real = observer.identity
        with patch.object(observer, 'identity', side_effect=lambda b: (self.uid + 1, '123') if b == str(base) else real(b)):
            self.assertEqual(self.run_scan()['entries'], [])

    def test_permission_denial_remains_unknown(self):
        self.process()
        real = os.readlink
        def deny(path):
            if str(path).endswith('/cwd'):
                raise PermissionError(13, 'SECRET')
            return real(path)
        with patch.object(observer.os, 'readlink', side_effect=deny):
            r = self.run_scan()
        self.assertFalse(r['supported'])
        self.assertNotIn('SECRET', str(r))

    def test_zombie_does_not_need_cwd_or_fds(self):
        base = self.process(state='Z', argv=())
        (base / 'cwd').unlink()
        (base / 'fd').rmdir()
        self.assertTrue(self.run_scan()['supported'])

    def test_surviving_missing_cwd_is_not_treated_as_exit(self):
        base = self.process()
        (base / 'cwd').unlink()
        self.assertFalse(self.run_scan()['supported'])

    def test_pid_reuse_and_late_process_are_unknown(self):
        self.process()
        real = observer.identity
        calls = 0
        def changed(base):
            nonlocal calls
            calls += 1
            owner, start = real(base)
            return owner, start if calls == 1 else '456'
        with patch.object(observer, 'identity', side_effect=changed):
            self.assertFalse(self.run_scan()['supported'])
        real_list = os.listdir
        scans = 0
        def late(path):
            nonlocal scans
            if str(path) == str(self.proc):
                scans += 1
                if scans == 2:
                    self.process(pid=201)
            return real_list(path)
        with patch.object(observer.os, 'listdir', side_effect=late):
            self.assertFalse(self.run_scan()['supported'])

    def test_malformed_snapshot_is_unknown(self):
        base = self.process()
        (base / 'stat').write_text('broken')
        self.assertFalse(self.run_scan()['supported'])


class ObserverProtocolTests(unittest.TestCase):
    def test_main_binds_reply_and_filters_original_uid(self):
        nonce = 'a' * 32
        with patch.object(observer.sys, 'argv', ['-c', '1001', '321', '/tmp', nonce]), \
             patch.object(observer.os, 'geteuid', return_value=0), \
             patch.object(observer, 'observe', return_value={'supported': True, 'entries': [], 'unreadable': 0}) as scan:
            out = io.StringIO()
            with redirect_stdout(out):
                self.assertEqual(observer.main(), 0)
            scan.assert_called_once_with(os.path.realpath('/tmp'), 1001, 321)
            self.assertEqual(json.loads(out.getvalue()), {
                'supported': True, 'entries': [], 'unreadable': 0, 'format': 'bridge-process-observation/v1',
                'uid': 1001, 'installer_pid': 321, 'root': os.path.realpath('/tmp'), 'nonce': nonce, 'observer_euid': 0})

    def test_main_refuses_unprivileged_or_invalid_requests_without_scan(self):
        for euid, args in [(1001, ['1001', '321', '/tmp', 'a' * 32]),
                           (0, ['0', '321', '/tmp', 'a' * 32]),
                           (0, ['1001', '321', 'relative', 'a' * 32]),
                           (0, ['1001', '321', '/tmp', 'short'])]:
            with patch.object(observer.sys, 'argv', ['-c'] + args), \
                 patch.object(observer.os, 'geteuid', return_value=euid), patch.object(observer, 'observe') as scan:
                self.assertEqual(observer.main(), 1)
                scan.assert_not_called()

    def test_incomplete_observation_never_becomes_idle_after_retries(self):
        with patch.object(observer.sys, 'argv', ['-c', '1001', '321', '/tmp', 'a' * 32]), \
             patch.object(observer.os, 'geteuid', return_value=0), \
             patch.object(observer, 'observe', return_value={'supported': False, 'entries': [], 'unreadable': 1}) as scan:
            out = io.StringIO()
            with redirect_stdout(out):
                self.assertEqual(observer.main(), 0)
            self.assertEqual(scan.call_count, 3)
            self.assertFalse(json.loads(out.getvalue())['supported'])


if __name__ == '__main__':
    unittest.main()
