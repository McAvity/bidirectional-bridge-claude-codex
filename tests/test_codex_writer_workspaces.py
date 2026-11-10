"""Synthetic metadata only: no personal Codex home, process or model."""
import io
import json
import struct
import time
from unittest.mock import patch
import importlib.util
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('writer_workspaces', pathlib.Path(__file__).resolve().parents[1] / 'scripts/setup/codex-writer-workspaces.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
A = '11111111-2222-3333-4444-555555555555'
B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'


class Fake:
    def __init__(self, home, threads, listed=None):
        self.home, self.threads = home, threads
        self.listed = list(threads) if listed is None else listed
        self.methods = []

    def send(self, value):
        assert value == {'method': 'initialized'}

    def request(self, method, params):
        self.methods.append(method)
        if method == 'initialize':
            return {'result': {'codexHome': self.home}}
        if method == 'thread/loaded/list':
            return {'result': {'data': self.listed, 'nextCursor': None}}
        assert method == 'thread/read' and params['includeTurns'] is False
        tid = params['threadId']
        if tid not in self.threads:
            return {'error': {'code': -32600, 'message': 'thread not loaded: ' + tid}}
        return {'result': {'thread': {'id': tid, 'cwd': self.threads[tid], 'environments': [{'environmentId': 'local', 'cwd': self.threads[tid], 'runtimeWorkspaceRoots': [self.threads[tid]]}], 'status': {'type': 'idle'}}}}


class WriterWorkspacesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = str(pathlib.Path(self.tmp.name).resolve())
        self.root = str(pathlib.Path(self.home, 'target'))
        self.other = str(pathlib.Path(self.home, 'other'))
        pathlib.Path(self.root).mkdir()
        pathlib.Path(self.other).mkdir()

    def inspect(self, fake):
        return m.inspect(fake, self.home, self.root, [A, B])

    def test_foreign_live_threads_and_finished_guardian_do_not_block(self):
        fake = Fake(self.home, {A: self.other})
        self.assertEqual(self.inspect(fake), {'supported': True, 'active': False})
        self.assertEqual(set(fake.methods), {'initialize', 'thread/loaded/list', 'thread/read'})

    def test_target_loaded_thread_blocks(self):
        self.assertTrue(self.inspect(Fake(self.home, {A: self.root}))['active'])

    def test_hidden_loaded_guardian_still_blocks(self):
        self.assertTrue(self.inspect(Fake(self.home, {A: self.other, B: self.root}, [A]))['active'])

    def test_new_loaded_thread_without_observed_lock_blocks(self):
        self.assertTrue(m.inspect(Fake(self.home, {B: self.root}), self.home, self.root, [A])['active'])

    def test_persisted_unloaded_thread_does_not_block(self):
        fake = Fake(self.home, {}, [])
        original = fake.request
        def request(method, params):
            if method == 'thread/read':
                return {'result': {'thread': {'id': params['threadId'], 'cwd': self.root, 'status': {'type': 'notLoaded'}}}}
            return original(method, params)
        fake.request = request
        self.assertFalse(self.inspect(fake)['active'])

    def test_changed_current_workspace_refuses(self):
        fake = Fake(self.home, {A: self.other})
        original = fake.request
        reads = 0
        def request(method, params):
            nonlocal reads
            if method == 'thread/read' and params['threadId'] == A:
                reads += 1
                if reads > 1:
                    fake.threads[A] = self.root
            return original(method, params)
        fake.request = request
        with self.assertRaises(ValueError):
            self.inspect(fake)

    def test_incomplete_pagination_and_changed_inventory_refuse(self):
        for change in ('pagination', 'new-thread'):
            with self.subTest(change=change):
                fake = Fake(self.home, {A: self.other})
                original = fake.request
                calls = 0
                def request(method, params):
                    nonlocal calls
                    r = original(method, params)
                    if method == 'thread/loaded/list':
                        calls += 1
                        if change == 'pagination': r['result']['nextCursor'] = A
                        elif calls > 1: r['result']['data'] = [A, B]
                    return r
                fake.request = request
                with self.assertRaises(ValueError): self.inspect(fake)

    def test_invalid_metadata_and_unknown_errors_refuse(self):
        for response in [
            {'error': {'code': -32603, 'message': 'unavailable'}},
            {'error': {'code': -32600, 'message': 'thread not loaded: WRONG'}},
            {'result': {'thread': {'id': B, 'cwd': self.other, 'status': {'type': 'idle'}}}},
            {'result': {'thread': {'id': A, 'cwd': 'relative', 'status': {'type': 'idle'}}}},
            {'result': {'thread': {'id': A, 'cwd': self.other, 'status': {'type': 'unknown'}}}},
        ]:
            with self.subTest(response=response):
                fake = Fake(self.home, {A: self.other})
                original = fake.request
                fake.request = lambda method, params: response if method == 'thread/read' else original(method, params)
                with self.assertRaises(ValueError): self.inspect(fake)

    def test_live_environment_overrides_stale_persisted_cwd(self):
        fake = Fake(self.home, {A: self.root})
        original = fake.request
        def request(method, params):
            r = original(method, params)
            if method == 'thread/read' and params['threadId'] == A:
                r['result']['thread']['cwd'] = self.other
            return r
        fake.request = request
        self.assertTrue(self.inspect(fake)['active'])

    def test_extra_workspace_root_blocks_even_if_cwd_elsewhere(self):
        fake = Fake(self.home, {A: self.other})
        original = fake.request
        def request(method, params):
            r = original(method, params)
            if method == 'thread/read' and params['threadId'] == A:
                r['result']['thread']['environments'][0]['runtimeWorkspaceRoots'].append(self.root)
            return r
        fake.request = request
        self.assertTrue(self.inspect(fake)['active'])

    def test_missing_or_remote_live_environment_refuses(self):
        for envs in [None, [], [{'environmentId': 'remote', 'cwd': self.other, 'runtimeWorkspaceRoots': []}]]:
            fake = Fake(self.home, {A: self.other})
            original = fake.request
            def request(method, params):
                r = original(method, params)
                if method == 'thread/read' and params['threadId'] == A:
                    r['result']['thread']['environments'] = envs
                return r
            fake.request = request
            with self.assertRaises(ValueError): self.inspect(fake)

    def test_home_mismatch_refuses(self):
        with self.assertRaises(ValueError): self.inspect(Fake(self.other, {A: self.other}))

    def test_loaded_missing_thread_refuses(self):
        with self.assertRaises(ValueError): self.inspect(Fake(self.home, {}, [A]))

    def test_canonical_symlink_and_subdirectory_block(self):
        link = pathlib.Path(self.home, 'linked')
        link.symlink_to(self.root)
        self.assertTrue(self.inspect(Fake(self.home, {A: str(link)}))['active'])
        sub = pathlib.Path(self.root, 'sub')
        sub.mkdir()
        self.assertTrue(self.inspect(Fake(self.home, {A: str(sub)}))['active'])


class TransportTest(unittest.TestCase):
    def reader(self, data):
        reader = m.Reader.__new__(m.Reader)
        reader.file = io.BytesIO(data)
        reader.deadline = time.monotonic() + 10
        reader.sent = []
        reader.send = lambda value, opcode=1: reader.sent.append((value, opcode))
        return reader

    def test_fragmented_response_and_ping(self):
        reader = self.reader(b'\x01\x06{"id":' + b'\x89\x01x' + b'\x80\x021}')
        self.assertEqual(reader.receive(), {'id': 1})
        self.assertEqual(reader.sent, [(b'x', 10)])

    def test_extended_frame(self):
        body = json.dumps({'value': 'x' * 256}).encode()
        self.assertEqual(self.reader(b'\x81\x7e' + struct.pack('!H', len(body)) + body).receive(), json.loads(body))

    def test_truncated_masked_binary_oversized_and_bad_continuation_refuse(self):
        for data in [b'', b'\x81\x10x', b'\x81\x80', b'\x82\x00', b'\x80\x00',
                     b'\x81\x7f' + struct.pack('!Q', m.LIMIT + 1), b'\xc1\x00', b'\x08\x00']:
            with self.subTest(data=data):
                with self.assertRaises(ValueError): self.reader(data).receive()

    def test_wrong_socket_peer_refuses_before_rpc(self):
        with patch.object(m.socket, 'socket') as socket:
            socket.return_value.getsockopt.return_value = struct.pack('i', 321)
            with self.assertRaises(ValueError): m.Reader('/synthetic/home', 123)
            socket.return_value.sendall.assert_not_called()


if __name__ == '__main__': unittest.main()
