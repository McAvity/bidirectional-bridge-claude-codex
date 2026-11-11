#!/usr/bin/env python3
"""Live PTY readiness and one pre-dispatch same-session startup repair.

No task prompts, fresh workers, permission changes or uncertain-command retries.
Use check immediately before prepare; stop/resume only for a diagnosed startup fault.
"""
import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import re
import subprocess
import sys

import hcom_state as state_helper


def command(argv, env):
    result = subprocess.run(['hcom', *argv], env=env, text=True, capture_output=True, timeout=45)
    state_helper.require(result.returncode == 0, 'HCOM_COMMAND_FAILED', result.stderr or result.stdout)
    return result.stdout


def record(path, data):
    # Exclusive intent survives failure/timeout: uncertainty never grants a retry.
    with path.open('x') as handle:
        json.dump(data, handle)
        handle.flush()
        os.fsync(handle.fileno())


def live(state, env, startup_stop=False):
    rows = json.loads(command(['list', '--json'], env))
    state_helper.require(isinstance(rows, list), 'LIVE_LIST_REQUIRED')
    matches = [r for r in rows if isinstance(r, dict) and r.get('name') == state['session']['name']]
    state_helper.require(len(matches) == 1, 'BOUND_SESSION_NOT_LIVE')
    row = matches[0]
    state_helper.require(state_helper.session(row, state['workspace']) == state['session'], 'SESSION_MISMATCH')
    eligible = row.get('status') == 'listening' or (startup_stop and
        row.get('status') == 'blocked' and row.get('status_context') == 'launch_blocked')
    state_helper.require(row.get('tool') == 'claude' and eligible, 'BOUND_CLAUDE_NOT_IDLE_OR_STARTUP_BLOCKED')
    return row


def empty_terminal(name, env):
    terminal = json.loads(command(['term', name, '--json'], env))
    state_helper.require(isinstance(terminal, dict) and terminal.get('ready') is True and
                         terminal.get('prompt_empty') is True and terminal.get('input_text') in ('', None),
                         'EMPTY_READY_TERMINAL_REQUIRED')
    return {key: terminal.get(key) for key in ('ready', 'prompt_empty', 'input_text')}


def no_dispatch(state, env):
    state_helper.require(state['rounds'] == [], 'STARTUP_REPAIR_AFTER_PREPARE_FORBIDDEN')
    # A prepared-but-unacknowledged send is already barred above. Also catch messages
    # sent outside the helper; one feature owns this namespace. Query all history,
    # including stopped sessions; any message or truncation marker blocks repair.
    messages = command(['events', '--type', 'message', '--all', '--last', '1', '--full'], env)
    state_helper.require(not messages.strip(), 'STARTUP_MESSAGES_EXIST')


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('command', choices=['check', 'stop', 'resume'])
    p.add_argument('--workspace', required=True)
    p.add_argument('--feature', required=True)
    p.add_argument('--state')
    p.add_argument('--session-file', help='New private readiness snapshot; check only')
    args = p.parse_args(argv)
    attempted = False
    try:
        workspace = state_helper.absolute(args.workspace)
        root = Path(state_helper.absolute(args.state)) if args.state else state_helper.default_state(workspace, args.feature)
        state_helper.require(not state_helper.inside(root, workspace), 'STATE_INSIDE_WORKSPACE')
        state_helper.require((root / 'state.json').is_file(), 'STATE_MISSING')
        with state_helper.locked(root):
            state = state_helper.read_json(root / 'state.json')
            state_helper.validate_binding(state, workspace, args.feature)
            bound = state.get('session')
            state_helper.require(isinstance(bound, dict) and
                                 re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', bound.get('name', '')),
                                 'BOUND_SESSION_REQUIRED')
            name = bound['name']
            env = dict(os.environ, HCOM_DIR=str(root / 'hcom'))
            if args.command == 'check':
                state_helper.require(args.session_file is not None, 'SESSION_FILE_REQUIRED')
                dest = Path(state_helper.absolute(args.session_file))
                state_helper.require(state_helper.inside(dest, root) and dest != root, 'PRIVATE_SNAPSHOT_REQUIRED')
                row = live(state, env)
                state_helper.require(row.get('hooks_bound') is True and row.get('process_bound') is True,
                                     'DELIVERY_BINDINGS_NOT_READY')
                terminal = empty_terminal(name, env)
                snapshot = {**bound, 'tool': 'claude', 'status': 'listening',
                            'hooks_bound': True, 'process_bound': True,
                            'workflow_readiness': {'checked_at': state_helper.now(), 'terminal': terminal}}
                record(dest, snapshot)
                result = {'ready': True, 'session_file': str(dest),
                          'next_step': 'Prepare immediately with this snapshot; readiness is not proof of task delivery.'}
            else:
                no_dispatch(state, env)
                stop_path = root / 'startup-stop-intent.json'
                resume_path = root / 'startup-resume-intent.json'
                state_helper.require(not resume_path.exists(), 'STARTUP_RESUME_ALREADY_REQUESTED')
                if args.command == 'stop':
                    state_helper.require(not stop_path.exists(), 'STARTUP_STOP_ALREADY_REQUESTED')
                    live(state, env, startup_stop=True)
                    empty_terminal(name, env)
                    record(stop_path, {'at': state_helper.now(), 'session': bound})
                    attempted = True
                    command(['term', 'inject', name, '/exit', '--enter'], env)
                    result = {'shutdown_requested': True, 'stopped_verified': False,
                              'next_step': 'After normal stop, run resume once; do not repeat an uncertain stop.'}
                else:
                    state_helper.require(stop_path.is_file(), 'STARTUP_STOP_INTENT_REQUIRED')
                    stop = state_helper.read_json(stop_path)
                    state_helper.require(stop.get('session') == bound, 'SESSION_MISMATCH')
                    rows = json.loads(command(['list', '--json'], env))
                    state_helper.require(isinstance(rows, list) and all(isinstance(r, dict) for r in rows),
                                         'LIVE_LIST_REQUIRED')
                    state_helper.require(not any(r.get('name') == name for r in rows), 'BOUND_SESSION_STILL_PRESENT')
                    raw = command(['events', '--agent', name, '--type', 'life', '--all',
                                   '--last', '1', '--full'], env)
                    events = [json.loads(line) for line in raw.splitlines() if line.strip()]
                    state_helper.require(len(events) == 1, 'NORMAL_STOP_REQUIRED')
                    event = events[0]
                    state_helper.require(isinstance(event, dict), 'NORMAL_STOP_REQUIRED')
                    data = event.get('data', {})
                    state_helper.require(isinstance(data, dict), 'NORMAL_STOP_REQUIRED')
                    snapshot = data.get('snapshot', {})
                    state_helper.require(isinstance(snapshot, dict), 'NORMAL_STOP_REQUIRED')
                    state_helper.require(event.get('type') == 'life' and event.get('instance') == name and
                                         data.get('action') == 'stopped' and data.get('reason') == 'exit:prompt_input_exit' and
                                         snapshot.get('tool') == 'claude' and
                                         state_helper.session(snapshot, workspace) == bound and
                                         datetime.fromisoformat(event['ts']) >= datetime.fromisoformat(stop['at']),
                                         'NORMAL_STOP_REQUIRED')
                    record(resume_path, {'at': state_helper.now(), 'session': bound, 'delivery': 'inject'})
                    attempted = True
                    # hcom tracked resume keeps the native ID and launch settings. Do not
                    # override model/permissions, or inherit a new prompt/CLI argument set.
                    for key in ('HCOM_CLAUDE_ARGS', 'HCOM_NOTES', 'HCOM_HINTS', 'HCOM_TAG'):
                        env.pop(key, None)
                    env['HCOM_CLAUDE_DELIVERY'] = 'inject'
                    output = command(['--go', 'r', name, '--headless', '--dir', workspace, '--json'], env)
                    result = {'resume_requested': True, 'ready': False,
                              'launch': json.loads(output),
                              'next_step': 'Run check for the same binding; no task until it passes. No second resume.'}
            print(json.dumps({'ok': True, **result}))
            return 0
    except (OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
        print(json.dumps({'ok': False, 'code': str(error), 'command_attempted': attempted,
                          'details': getattr(error, 'details', None)}))
        return 2


if __name__ == '__main__':
    sys.exit(main())
