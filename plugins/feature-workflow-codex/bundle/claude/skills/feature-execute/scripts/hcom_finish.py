#!/usr/bin/env python3
"""Request normal exit only for the bound, idle worker after a verified accepted receipt.

This entry never launches a worker or retries an uncertain terminal injection.
It does not claim the process has stopped; confirm the stop from hcom afterwards.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
import hcom_state as state_helper


def checked(argv, env):
    result = subprocess.run(argv, env=env, text=True, capture_output=True, timeout=20)
    if result.returncode != 0:
        raise ValueError(f'COMMAND_FAILED: {argv[0]}: {result.stderr or result.stdout}')
    return result.stdout


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', required=True)
    parser.add_argument('--feature', required=True)
    parser.add_argument('--state')
    args = parser.parse_args(argv)
    helper = Path(__file__).with_name('hcom_state.py')
    base = ['--workspace', args.workspace, '--feature', args.feature]
    if args.state:
        base += ['--state', args.state]
    attempted = False
    try:
        workspace = state_helper.absolute(args.workspace)
        root = Path(state_helper.absolute(args.state)) if args.state else state_helper.default_state(workspace, args.feature).resolve()
        state_helper.require(not state_helper.inside(root, workspace), 'STATE_INSIDE_WORKSPACE')
        state_helper.require((root / 'state.json').is_file(), 'STATE_MISSING')
        with state_helper.locked(root):
            status = json.loads(checked([sys.executable, str(helper), 'status', *base], os.environ))
            state = status['state']
            intent = Path(status['state_dir']) / 'finish-intent.json'
            if intent.exists() and not state_helper.intent_resolved(root, intent.name):
                raise ValueError('FINISH_ALREADY_REQUESTED: inspect preserved intent and hcom history; do not resend')
            state_helper.require_open(state, root)
            if not state['rounds'] or (state['rounds'][-1].get('receipt') or {}).get('decision') != 'accepted':
                raise ValueError('ACCEPTED_RECEIPT_REQUIRED')
            name = (state.get('session') or {}).get('name')
            if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', name):
                raise ValueError('SESSION_NAME_REQUIRED')
            # Do not inherit another project's HCOM_DIR from the coordinator's shell.
            env = dict(os.environ, HCOM_DIR=str(Path(status['state_dir']) / 'hcom'))
            observed = json.loads(checked(['hcom', 'list', name, '--json'], env))
            if not isinstance(observed, dict) or observed.get('status') != 'listening' or observed.get('tool') != 'claude':
                raise ValueError('BOUND_CLAUDE_MUST_BE_LISTENING')
            with tempfile.NamedTemporaryFile(mode='w', dir=status['state_dir'], prefix='.finish-', suffix='.json') as snapshot:
                json.dump(observed, snapshot)
                snapshot.flush()
                guard = json.loads(checked([sys.executable, str(helper), 'close-check', *base,
                                           '--session-file', snapshot.name], env))
            if guard.get('ok') is not True or guard.get('shutdown_permitted') is not True:
                raise ValueError('SHUTDOWN_NOT_PERMITTED')
            terminal = json.loads(checked(['hcom', 'term', name, '--json'], env))
            if not isinstance(terminal, dict) or terminal.get('ready') is not True or \
                    terminal.get('prompt_empty') is not True or terminal.get('input_text') not in ('', None):
                raise ValueError('EMPTY_READY_TERMINAL_REQUIRED')
            # Exclusive creation makes uncertain exit durable across process restarts.
            # Preserve this record even on failure; only explicit diagnosis may resolve it.
            if intent.exists():
                archive = root / ('finish-intent-' + state_helper.hashlib.sha256(intent.read_bytes()).hexdigest() + '.json')
                if archive.exists():
                    state_helper.require(archive.read_bytes() == intent.read_bytes(), 'FINISH_ARCHIVE_CONFLICT')
                else:
                    with archive.open('x') as old:
                        old.write(intent.read_text())
                        old.flush()
                        os.fsync(old.fileno())
                intent.unlink()
            with intent.open('x') as record:
                json.dump({'at': datetime.now(timezone.utc).isoformat(), 'session': state['session'],
                           'round': state['rounds'][-1]['contract']['round'],
                           'accepted_report_sha256': state['rounds'][-1]['receipt']['report_sha256']}, record)
                record.flush()
                os.fsync(record.fileno())
            state['lifecycle'] = 'finishing'
            state_helper.save(root, state)
            attempted = True
            checked(['hcom', 'term', 'inject', name, '/exit', '--enter'], env)
            print(json.dumps({'ok': True, 'shutdown_requested': True, 'stopped_verified': False,
                              'next_step': 'Confirm the bound worker stopped normally using hcom history/status; do not resend an uncertain exit.'}))
            return 0
    except (OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
        print(json.dumps({'ok': False, 'code': str(error), 'terminal_command_attempted': attempted,
                          'shutdown_requested': None if attempted else False,
                          'stopped_verified': False}))
        return 2


if __name__ == '__main__':
    sys.exit(main())
