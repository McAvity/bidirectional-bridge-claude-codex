#!/usr/bin/env python3
"""Operator-only PTY relay. No model decisions, bridge calls or identity injection.
The supervising operator selects the next prepared prompt from observed evidence.
Requires pexpect and pyte; raw screens and actions stay in the private run directory.
"""
import argparse
import json
import os
import sqlite3
from pathlib import Path
import time
import pexpect
import pyte
import pilot


def clean_env():
    env = dict(os.environ)
    # A child CLI owns its native identity. Do not inherit the supervising CLI's ID.
    for key in ('CODEX_THREAD_ID', 'CODEX_INTERNAL_ORIGINATOR_OVERRIDE'):
        env.pop(key, None)
    env['TERM'] = 'xterm-256color'
    return env


def paste(text):
    if '\x1b' in text or '\r' in text or '\x00' in text:
        raise ValueError('control characters in prompt')
    return '\x1b[200~' + text + '\x1b[201~'


class Client:
    def __init__(self, command, directory, name):
        self.directory = directory
        self.name = name
        self.screen = pyte.Screen(160, 48)
        self.stream = pyte.Stream(self.screen)
        self.log = (directory / f'{name}.pty.log').open('x')
        self.child = pexpect.spawn(command[0], command[1:], env=clean_env(),
                                   encoding='utf-8', codec_errors='replace',
                                   dimensions=(48, 160), cwd=directory)
        self.child.logfile_read = self.log
        self.started = time.monotonic()
        self.turns = 0
        self.closing = False
        self.exited = False
        self.pending = ''
        self.submit_when_visible = None
        self.pending_turn = False

    def poll(self):
        if self.exited:
            return
        try:
            chunk = self.child.read_nonblocking(65536, timeout=0)
            self.stream.feed(chunk)
            self.pending += chunk
            while '\x1b[6n' in self.pending:
                self.pending = self.pending.split('\x1b[6n', 1)[1]
                self.child.send('\x1b[1;1R')
            self.pending = self.pending[-8:]
        except pexpect.TIMEOUT:
            pass
        except pexpect.EOF:
            self.child.close()
            self.exited = True
            self.log.close()
        (self.directory / f'{self.name}.screen.txt').write_text(self.text())
        if self.submit_when_visible and self.submit_when_visible in self.text():
            self.child.send('\r')
            self.submit_when_visible = None
            if self.pending_turn:
                self.turns += 1
                self.pending_turn = False

    def text(self):
        return '\n'.join(line.rstrip() for line in self.screen.display)

    def send_prompt(self, text):
        if self.exited or self.closing or self.submit_when_visible:
            raise ValueError('client closed')
        if self.turns >= (2 if self.name == 'foreign' else 10):
            raise ValueError('manager turn budget exhausted')
        self.child.send(paste(text))
        self.submit_when_visible = '[Pasted Content' if '\n' in text else text[:60]
        self.pending_turn = True

    def close(self):
        self.child.send('/quit')
        self.submit_when_visible = '/quit'
        self.closing = True
        self.close_started = time.monotonic()

    def stop(self):
        if not self.exited:
            # Abort only this owned PTY; no recovery or replacement session.
            self.child.sendcontrol('c')
            self.child.terminate(force=True)
            self.log.close()
            self.exited = True


def serve(root):
    pilot.preflight(root)
    out = root / 'operator'
    out.mkdir(mode=0o700, exist_ok=False)
    inbox = out / 'inbox'
    inbox.mkdir()
    clients = {}
    seen = set()
    submitted = set()
    events = (out / 'actions.jsonl').open('x', buffering=1)
    def event(kind, **data):
        events.write(json.dumps({'at': time.time(), 'kind': kind, **data}) + '\n')
    event('ready', model_turns=0)
    try:
        while True:
            for client in clients.values():
                client.poll()
                if client.exited and not client.closing:
                    raise RuntimeError(f'unexpected client exit: {client.name}')
                if client.closing and not client.exited and time.monotonic()-client.close_started > 20:
                    raise RuntimeError('normal close deadline exceeded')
            started = root / 'started-at.txt'
            if started.exists() and time.time()-float(started.read_text()) >= 3600:
                raise RuntimeError('60 minute budget expired')
            for path in sorted(inbox.glob('*.json')):
                if path.name in seen:
                    continue
                seen.add(path.name)
                action = json.loads(path.read_text())
                kind, name = action['action'], action.get('client')
                event('action', request=path.name, action=action)
                if kind == 'start':
                    if name not in ('a', 'b', 'a-resumed', 'foreign') or name in clients:
                        raise ValueError('unapproved or duplicate client')
                    mode = 'resume' if name == 'a-resumed' else 'foreign' if name == 'foreign' else 'start'
                    if mode == 'resume' and ('a' not in clients or not clients['a'].exited):
                        raise ValueError('original A must be normally closed before resume')
                    pair = 'b' if name == 'b' else 'a'
                    command = ['python3', str(root/'runtime/tools/pilot/wave10/pilot.py'),
                               'launch', '--run', str(root), '--pair', pair, '--mode', mode,
                               '--operator-tui']
                    clients[name] = Client(command, out, name)
                    if mode == 'resume':
                        clients[name].turns = clients['a'].turns
                elif kind == 'prompt':
                    allowed = {'a': 'START-A.txt', 'b': ('START-B.txt', 'ROUND2-B.txt'),
                               'a-resumed': ('RESUME-A.txt', 'ROUND2-A.txt'), 'foreign': 'FOREIGN.txt'}
                    choices = allowed[name]
                    if isinstance(choices, str): choices = (choices,)
                    if action['file'] not in choices:
                        raise ValueError('not a prepared prompt')
                    key = (name, action['file'])
                    if key in submitted:
                        raise ValueError('prepared prompt already submitted; no retries')
                    clients[name].send_prompt((root/action['file']).read_text())
                    submitted.add(key)
                elif kind == 'trust':
                    # Only the known own-fixture onboarding screen, never a tool approval.
                    client = clients[name]
                    pair = 'b' if name == 'b' else 'a'
                    screen = client.text()
                    if str(root/pair) not in screen or 'Yes, continue' not in screen or 'trust' not in screen.lower():
                        raise ValueError('not the expected own-worktree trust screen')
                    client.child.send('\r')
                elif kind == 'close':
                    clients[name].close()
                elif kind == 'release':
                    if not (root/'a/.pilot/round2-started').exists() or not (root/'b/.pilot/gate-ready').exists():
                        raise ValueError('worker markers missing')
                    db = root/'b/.bridge/bridge.db'
                    with sqlite3.connect(db.as_uri()+'?mode=ro', uri=True) as conn:
                        active = conn.execute("SELECT count(*) FROM task_attempts WHERE ended_at IS NULL AND agent='claude'").fetchone()[0]
                    if active != 1:
                        raise ValueError('B worker is not active at release')
                    gate = float((root/'b/.pilot/gate-ready').read_text())
                    if time.time()-gate > 480:
                        raise ValueError('operator window expired')
                    with (root/'b/.pilot/continue').open('x') as f: f.write(str(time.time()))
                elif kind == 'stop':
                    event('stopped', reason=action['reason'])
                    return
                else:
                    raise ValueError('unknown operator action')
                event('completed', request=path.name)
            state = {name: {'turns': c.turns, 'exited': c.exited, 'closing': c.closing,
                            'pid': c.child.pid} for name,c in clients.items()}
            temp = out/'status.tmp'; temp.write_text(json.dumps(state, indent=2)); temp.replace(out/'status.json')
            time.sleep(.1)  # Poll cadence only; never used as a readiness signal.
    except Exception as exc:
        event('blocked', reason=str(exc))
        (out/'BLOCKED.txt').write_text(str(exc))
        raise
    finally:
        for c in clients.values(): c.stop()
        events.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', type=Path, required=True)
    serve(parser.parse_args().run.resolve())
