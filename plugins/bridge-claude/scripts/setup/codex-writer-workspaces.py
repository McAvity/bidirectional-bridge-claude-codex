#!/usr/bin/env python3
"""Read live Codex metadata over its local socket; never resume/subscribe/unload a thread.

Optional macOS refinement of the conservative process scan. No transcript, database,
model request or third-party module. Failure preserves CLIENT_WORKSPACE_UNKNOWN.
"""
import base64
import hashlib
import json
import os
import re
import socket
import struct
import sys
import time

LIMIT = 4 * 1024 * 1024
ID = re.compile(r'^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$')


class Reader:
    def __init__(self, home, pid):
        self.sock = socket.socket(socket.AF_UNIX)
        self.sock.settimeout(3)
        self.deadline = time.monotonic() + 10
        self.sock.connect(os.path.join(home, 'app-server-control', 'app-server-control.sock'))
        # Darwin LOCAL_PEERPID: bind the RPC result to the process observed by lsof,
        # not an arbitrary daemon selected by the invoking client's CODEX_HOME.
        if struct.unpack('i', self.sock.getsockopt(0, 2, 4))[0] != pid:
            raise ValueError('peer mismatch')
        self.file = self.sock.makefile('rb')
        self.serial = 0
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(('GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\n'
                           'Connection: Upgrade\r\nSec-WebSocket-Key: ' + key +
                           '\r\nSec-WebSocket-Version: 13\r\n\r\n').encode())
        header = b''
        while not header.endswith(b'\r\n\r\n'):
            header += self.exact(1)
            if len(header) > 16384:
                raise ValueError('header too large')
        lines = header.decode('ascii').split('\r\n')
        headers = dict(line.split(':', 1) for line in lines[1:] if ':' in line)
        headers = {k.lower(): v.strip() for k, v in headers.items()}
        accept = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
        if not lines[0].startswith('HTTP/1.1 101 ') or headers.get('sec-websocket-accept') != accept:
            raise ValueError('invalid handshake')
        if headers.get('sec-websocket-extensions'):
            raise ValueError('unexpected extension')

    def exact(self, count):
        if time.monotonic() > self.deadline:
            raise ValueError('deadline')
        value = self.file.read(count)
        if len(value) != count:
            raise ValueError('closed')
        return value

    def send(self, value, opcode=1):
        body = json.dumps(value).encode() if opcode == 1 else value
        size = len(body)
        mask = os.urandom(4)
        header = bytes([0x80 | opcode, 0x80 | size]) if size < 126 else bytes([0x80 | opcode, 0xfe]) + struct.pack('!H', size)
        self.sock.sendall(header + mask + bytes(v ^ mask[i % 4] for i, v in enumerate(body)))

    def receive(self):
        parts = bytearray()
        started = False
        while True:
            first, second = self.exact(2)
            opcode = first & 15
            size = second & 127
            if first & 0x70 or second & 0x80:
                raise ValueError('invalid frame')
            if size == 126:
                size = struct.unpack('!H', self.exact(2))[0]
            elif size == 127:
                size = struct.unpack('!Q', self.exact(8))[0]
            if size + len(parts) > LIMIT:
                raise ValueError('message too large')
            body = self.exact(size)
            if opcode in (9, 10):
                if not first & 128 or size > 125:
                    raise ValueError('invalid control frame')
                if opcode == 9:
                    self.send(body, 10)
                continue
            if opcode not in (0, 1) or (opcode == 0) != started:
                raise ValueError('unexpected frame')
            started = True
            parts.extend(body)
            if first & 128:
                return json.loads(parts)

    def request(self, method, params):
        self.serial += 1
        self.send({'id': self.serial, 'method': method, 'params': params})
        for _ in range(100):
            message = self.receive()
            if message.get('id') == self.serial:
                return message
        raise ValueError('too many messages')

    def close(self):
        self.file.close()
        self.sock.close()


def result(reader, method, params):
    message = reader.request(method, params)
    if 'error' in message or 'result' not in message:
        raise ValueError('RPC failed')
    return message['result']


def loaded(reader):
    response = result(reader, 'thread/loaded/list', {'limit': 1000})
    ids = response.get('data')
    if response.get('nextCursor') is not None or not isinstance(ids, list) or len(ids) > 1000:
        raise ValueError('incomplete inventory')
    if any(not isinstance(t, str) or not ID.fullmatch(t) for t in ids) or len(ids) != len(set(ids)):
        raise ValueError('invalid inventory')
    return set(ids)


def workspace(reader, tid):
    message = reader.request('thread/read', {'threadId': tid, 'includeTurns': False})
    if 'error' in message:
        # Finished ephemeral guardians can retain an open file but no loaded thread.
        error = message['error']
        if error.get('code') == -32600 and error.get('message') == 'thread not loaded: ' + tid:
            return None
        raise ValueError('unreadable thread')
    thread = message['result']['thread']
    if thread.get('id') != tid:
        raise ValueError('thread mismatch')
    state = thread.get('status', {}).get('type')
    if state == 'notLoaded':
        return None
    if state not in ('idle', 'active', 'systemError'):
        raise ValueError('unknown status')
    # thread.cwd can come from persisted history after resume. Only environments
    # is overwritten from the live config snapshot by apply_live_thread_settings.
    environments = thread.get('environments')
    if not isinstance(environments, list) or len(environments) != 1:
        raise ValueError('missing or unsupported live environment')
    environment = environments[0]
    if environment.get('environmentId') != 'local':
        raise ValueError('unsupported environment')
    roots = environment.get('runtimeWorkspaceRoots')
    if not isinstance(roots, list) or len(roots) > 128:
        raise ValueError('missing workspace roots')
    paths = [environment.get('cwd')] + roots
    if any(not isinstance(p, str) or not os.path.isabs(p) or not os.path.isdir(p) for p in paths):
        raise ValueError('invalid workspace path')
    return tuple(sorted(set(os.path.realpath(p) for p in paths)))


def inspect(reader, home, root, writer_ids):
    init = result(reader, 'initialize', {'clientInfo': {'name': 'bridge_workspace_reader', 'version': '1'},
                                        'capabilities': {'experimentalApi': True}})
    if os.path.realpath(init.get('codexHome', '')) != home:
        raise ValueError('home mismatch')
    reader.send({'method': 'initialized'})
    before = loaded(reader)
    ids = before | set(writer_ids)
    first = {tid: workspace(reader, tid) for tid in sorted(ids)}
    after = loaded(reader)
    second = {tid: workspace(reader, tid) for tid in sorted(ids)}
    if before != after or first != second or after != loaded(reader):
        raise ValueError('threads changed; retry')
    if any(first[tid] is None for tid in before):
        raise ValueError('loaded thread missing')
    active = any(paths is not None and any(os.path.commonpath([path, root]) in (path, root) for path in paths)
                 for paths in first.values())
    return {'supported': True, 'active': active}


def main():
    reader = None
    try:
        if sys.platform != 'darwin':
            raise ValueError('unsupported platform')
        request = json.loads(sys.stdin.read(65537))
        home, root, pid, ids = (request[k] for k in ('home', 'root', 'pid', 'writer_ids'))
        if not isinstance(pid, int) or pid <= 0 or not isinstance(ids, list) or not 0 < len(ids) <= 1000:
            raise ValueError('invalid request')
        if any(not isinstance(t, str) or not ID.fullmatch(t) for t in ids):
            raise ValueError('invalid ids')
        if not os.path.isabs(home) or not os.path.isabs(root):
            raise ValueError('invalid paths')
        home, root = os.path.realpath(home), os.path.realpath(root)
        reader = Reader(home, pid)
        report = inspect(reader, home, root, ids)
    except Exception:
        report = {'supported': False}
    finally:
        if reader:
            reader.close()
    print(json.dumps(report))


if __name__ == '__main__':
    main()
