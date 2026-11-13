#!/usr/bin/env python3
"""Recover one hcom workstream without rewriting receipts or blindly retrying commands.

resume: unblock a received round, or resume its stopped native session (no task send).
cancel: stop this workstream without acceptance; --interrupt permits killing its busy worker.
reconcile: record observed effects; explicit not-applied resolutions require operator evidence.
"""
import argparse
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

sys.dont_write_bytecode = True
import hcom_state as H
import hcom_startup as startup


def stamp(value):
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    H.require(result.tzinfo is not None, 'TIMESTAMP_REQUIRED')
    return result


def observe(state, env):
    rows = json.loads(startup.command(['list', '--json'], env))
    H.require(isinstance(rows, list) and all(isinstance(r, dict) for r in rows), 'LIVE_LIST_REQUIRED')
    events, before = [], None
    while True:
        query = ['events', '--all', '--last', '10000', '--full']
        if before is not None:
            query += ['--sql', 'id < ' + str(before)]
        raw = startup.command(query, env)
        page = [json.loads(line) for line in raw.splitlines() if line.strip()]
        H.require(all(isinstance(e, dict) and isinstance(e.get('data'), dict)
                  and e.get('ts') and e.get('id') is not None for e in page), 'COMPLETE_HISTORY_REQUIRED')
        if before is not None:
            H.require(all(type(e['id']) is int and e['id'] < before for e in page), 'HISTORY_CURSOR_INVALID')
        events.extend(page)
        if len(page) < 10000:
            break
        H.require(all(type(e['id']) is int for e in page), 'HISTORY_CURSOR_INVALID')
        before = min(e['id'] for e in page)
    H.require(len({str(e['id']) for e in events}) == len(events), 'DUPLICATE_EVENT_ID')
    events.sort(key=lambda e: stamp(e['ts']))
    bound = state.get('session')
    matches = []
    if bound:
        H.require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', bound['name']) is not None, 'SESSION_NAME_REQUIRED')
        matches = [r for r in rows if r.get('name') == bound['name'] or r.get('session_id') == bound['session_id']]
        H.require(len(matches) <= 1, 'SESSION_AMBIGUOUS')
        if matches:
            H.require(H.session(matches[0], state['workspace']) == bound and matches[0].get('tool') == 'claude',
                      'SESSION_MISMATCH')
    return rows, matches[0] if matches else None, events


def stopped(state, row, events, after=None, normal=False):
    if row or not state.get('session'):
        return None
    bound = state['session']
    own = [e for e in events if e.get('instance') == bound['name'] and e.get('type') == 'life']
    if not own:
        return None
    event = own[-1]
    data, snap = event['data'], event['data'].get('snapshot', {})
    if (data.get('action') != 'stopped' or not isinstance(snap, dict) or snap.get('tool') != 'claude'
            or any(snap.get(k) != v for k, v in bound.items())
            or (after and stamp(event['ts']) < stamp(after))
            or (normal and data.get('reason') != 'exit:prompt_input_exit')):
        return None
    return event


def ready(state, row, env):
    H.require(row is not None and row.get('status') == 'listening' and
              row.get('hooks_bound') is True and row.get('process_bound') is True, 'BOUND_SESSION_NOT_READY')
    startup.empty_terminal(state['session']['name'], env)


def stop_effect(state, events, after, normal=False):
    # A later external resume does not undo an earlier exit's observed effect.
    # This settles the command only; current absence is checked separately.
    matches = [e for e in events if stopped(state, None, [e], after, normal)]
    return matches[-1] if matches else None


def evidence(args):
    H.require(H.text(args.reason) and H.text(args.decision_ref), 'REASON_AND_DECISION_REQUIRED')
    return {'reason': args.reason, 'decision_ref': args.decision_ref}


def audit(state, action, args, **extra):
    entry = {'at': H.now(), 'action': action, **evidence(args), **extra}
    state.setdefault('recovery_history', []).append(entry)
    return entry


def requested(state, kind, args):
    H.require(H.text(args.key), 'IDEMPOTENCY_KEY_REQUIRED')
    prior = next((o for o in state.get('operations', []) if o['key'] == args.key), None)
    if prior:
        H.require(prior['kind'] == kind and prior['reason'] == args.reason and
                  prior['decision_ref'] == args.decision_ref, 'IDEMPOTENCY_MISMATCH')
    return prior


def reserve(state, root, kind, args, **extra):
    H.require(not any(o['status'] == 'intent' for o in state.get('operations', [])), 'OPERATION_UNRESOLVED')
    H.require(requested(state, kind, args) is None, 'USE_NEW_OPERATION_KEY_AFTER_RESOLUTION')
    op = {'key': args.key, 'kind': kind, 'status': 'intent', 'at': H.now(),
          'session': state.get('session'), **evidence(args), **extra}
    state.setdefault('operations', []).append(op)
    H.save(root, state)  # Persist before any external side effect; never erase on timeout.
    return op


def match_request(state, current, events):
    bound = state.get('session') or {}
    return [e for e in events if e.get('type') == 'message' and
            e['data'].get('intent') == 'request' and isinstance(e['data'].get('delivered_to'), list) and
            isinstance(e['data'].get('text'), str) and
            bound.get('name') in (e['data'].get('delivered_to') or []) and
            current['contract_path'] in e['data'].get('text', '') and
            current['contract_sha256'] in e['data'].get('text', '') and
            stamp(e['ts']) >= stamp(current['prepared_at'])]


def resolve_legacy(state, root, row, events, env):
    for name in ('finish-intent.json', 'startup-stop-intent.json', 'startup-resume-intent.json'):
        path = root / name
        if not path.exists() or H.intent_resolved(root, name):
            continue
        intent = H.read_json(path)
        H.require(intent.get('session') == state.get('session'), 'SESSION_MISMATCH')
        event = stop_effect(state, events, intent['at'])
        resolution = None
        if name == 'startup-resume-intent.json' and row:
            resolution = 'observed_present'
        elif event:
            resolution = ('observed_stopped' if event['data'].get('reason') == 'exit:prompt_input_exit'
                          else 'observed_abnormal_stop')
            if name == 'finish-intent.json':
                state['lifecycle'] = 'finished'
        if resolution:
            state.setdefault('resolved_intents', {})[name] = {
                'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'resolution': resolution,
                'at': H.now(), 'event_id': event.get('id') if event else None}


def reconcile(state, root, args, row, events, env):
    resolve_legacy(state, root, row, events, env)
    for op in state.get('operations', []):
        if op['status'] != 'intent':
            continue
        if op['kind'] == 'resume' and row:
            op.update(status='done', observed_at=H.now(), outcome='observed_present')
            state['lifecycle'] = 'open'
        elif op['kind'] == 'resume':
            event = stopped(state, row, events, op['at'])
            if event:
                op.update(status='done', observed_at=H.now(), event_id=event['id'],
                          outcome='observed_ended')
                state['lifecycle'] = 'open'
        elif op['kind'] == 'cancel':
            event = stop_effect(state, events, op['at'])
            if event:
                op.update(status='done', observed_at=H.now(), event_id=event.get('id'))
                state['lifecycle'] = 'cancelled' if stopped(state, row, events, op['at']) else 'cancelling'
    if state['rounds']:
        current = state['rounds'][-1]
        if not current.get('send_event_id') and not current.get('disposition'):
            matches = match_request(state, current, events)
            H.require(len(matches) <= 1, 'MULTIPLE_MATCHING_DISPATCHES')
            if matches:
                current['send_event_id'] = str(matches[0]['id'])
    if args.resolution:
        evidence(args)
        H.require(args.confirm_command_ended and H.text(args.evidence_ref), 'COMMAND_END_AND_EVIDENCE_REQUIRED')
        # Absence from a log is not proof of non-execution. The operator must inspect
        # original command/process/terminal evidence and explicitly attest it ended.
        # This never grants a task resend, and never rewrites an acknowledged request.
        if args.target == 'initialization':
            H.require(state.get('lifecycle', 'open') == 'open' and not state.get('session') and not state['rounds'],
                      'INITIALIZATION_ALREADY_BOUND')
            H.require(not json.loads(startup.command(['list', '--json'], env)) and not events,
                      'INITIALIZATION_ACTIVITY_OBSERVED')
            prior = requested(state, 'launch_grant', args)
            if prior is None:
                H.require(not any(o['status'] == 'intent' for o in state.get('operations', [])), 'OPERATION_UNRESOLVED')
                state.setdefault('operations', []).append({'key': args.key, 'kind': 'launch_grant', 'status': 'done',
                    'at': H.now(), **evidence(args), 'evidence_ref': args.evidence_ref})
                H.save(root, state)
                return True
        elif args.target == 'prepared':
            ready(state, row, env)
            H.require(bool(state['rounds']), 'NO_PREPARED_ROUND')
            current = state['rounds'][-1]
            H.require(not current.get('send_event_id') and not current.get('receipt') and
                      not match_request(state, current, events), 'DISPATCH_ALREADY_OBSERVED')
            current['disposition'] = 'not_sent'
            current['resolution'] = audit(state, 'not_sent', args, evidence_ref=args.evidence_ref)
        elif args.target in ('finish-intent.json', 'startup-stop-intent.json', 'startup-resume-intent.json'):
            path = root / args.target
            H.require(path.is_file() and not H.intent_resolved(root, args.target), 'NO_UNRESOLVED_INTENT')
            intent = H.read_json(path)
            H.require(intent.get('session') == state.get('session'), 'SESSION_MISMATCH')
            if args.target == 'startup-resume-intent.json':
                H.require(stopped(state, row, events) is not None, 'STOPPED_SESSION_REQUIRED')
            else:
                if args.target == 'startup-stop-intent.json':
                    startup.live(state, env, startup_stop=True)
                    startup.empty_terminal(state['session']['name'], env)
                else:
                    ready(state, row, env)
                H.require(not any(e.get('instance') == state['session']['name'] and e.get('type') == 'life'
                          and e['data'].get('action') == 'stopped' and stamp(e['ts']) >= stamp(intent['at'])
                          for e in events), 'STOP_ALREADY_OBSERVED')
            state.setdefault('resolved_intents', {})[args.target] = audit(
                state, 'not_applied', args, sha256=hashlib.sha256(path.read_bytes()).hexdigest(), evidence_ref=args.evidence_ref)
            if args.target == 'finish-intent.json':
                state['lifecycle'] = 'open'
        else:
            op = next((o for o in state.get('operations', []) if o['key'] == args.target), None)
            H.require(op is not None and op['status'] == 'intent', 'NO_UNRESOLVED_OPERATION')
            if op['kind'] == 'resume':
                H.require(stopped(state, row, events) is not None, 'STOPPED_SESSION_REQUIRED')
                H.require(not any(e.get('instance') == state['session']['name'] and e.get('type') == 'life'
                          and e['data'].get('action') in ('created', 'ready') and stamp(e['ts']) >= stamp(op['at'])
                          for e in events), 'RESUME_ALREADY_OBSERVED')
            else:
                ready(state, row, env)
                H.require(not any(e.get('instance') == state['session']['name'] and e.get('type') == 'life'
                          and e['data'].get('action') == 'stopped' and stamp(e['ts']) >= stamp(op['at'])
                          for e in events), 'STOP_ALREADY_OBSERVED')
            op.update(status='not_applied', resolution=audit(state, 'not_applied', args, evidence_ref=args.evidence_ref))
    H.save(root, state)
    return False


def resume(state, root, args, row, events, env):
    evidence(args)
    H.require(state.get('lifecycle', 'open') not in ('cancelled', 'cancelling'), 'WORKFLOW_CANCELLED')
    H.require(state.get('session'), 'SESSION_BINDING_REQUIRED')
    prior = requested(state, 'resume', args)
    if prior:
        H.require(prior['status'] == 'done', 'RECONCILE_OPERATION_BEFORE_RETRY')
        return {'replayed': True, 'resume_requested': True, 'dispatch_permitted': False}
    H.require(not any(o['status'] == 'intent' for o in state.get('operations', [])), 'OPERATION_UNRESOLVED')
    H.require(H.intent_resolved(root, 'finish-intent.json'), 'FINISH_PENDING_RECONCILIATION')
    H.require(H.intent_resolved(root, 'startup-resume-intent.json'), 'STARTUP_PENDING_RECONCILIATION')
    H.require(H.intent_resolved(root, 'startup-stop-intent.json'), 'STARTUP_PENDING_RECONCILIATION')
    if row:
        ready(state, row, env)
        if state['rounds']:
            current = state['rounds'][-1]
            receipt = current.get('receipt') or {}
            H.require(receipt.get('decision') in ('accepted', 'rework', 'blocked') or
                      current.get('disposition') == 'not_sent', 'RECEIPT_OR_RECONCILIATION_REQUIRED')
            if receipt.get('decision') == 'blocked' and not current.get('continuation'):
                H.require(H.text(current.get('send_event_id')), 'SEND_ACKNOWLEDGEMENT_REQUIRED')
                path = H.relative_path(current['contract']['report_path'], state['workspace'])
                H.require(hashlib.sha256(path.read_bytes()).hexdigest() == receipt['report_sha256'] and
                          H.report(path, state, current) == receipt['report'], 'RECEIVED_REPORT_CHANGED')
                current['continuation'] = audit(state, 'unblocked', args, round=current['contract']['round'])
        state['lifecycle'] = 'open'
        state.setdefault('operations', []).append({'key': args.key, 'kind': 'resume', 'status': 'done',
            'at': H.now(), 'session': state['session'], **evidence(args)})
        H.save(root, state)
        return {'ready': True, 'dispatch_permitted': False, 'next_step': 'Prepare a new round; previous receipts remain historical.'}
    H.require(stopped(state, row, events) is not None, 'STOPPED_SESSION_REQUIRED')
    reserve(state, root, 'resume', args)
    launch_env = startup.claude_pty_env(env)
    for key in ('HCOM_CLAUDE_ARGS', 'HCOM_NOTES', 'HCOM_HINTS', 'HCOM_TAG'):
        launch_env.pop(key, None)
    output = startup.command(['--go', 'r', state['session']['name'], '--headless', '--dir', state['workspace'], '--json'], launch_env)
    return {'resume_requested': True, 'launch': json.loads(output), 'dispatch_permitted': False,
            'next_step': 'Reconcile observed same-session readiness. For blocked receipt, then resume with a new key to unblock; for pending delivery, inspect/receive it without sending again.'}


def cancel(state, root, args, row, events, env):
    evidence(args)
    if state.get('cancellation'):
        H.require(state['cancellation']['reason'] == args.reason and
                  state['cancellation']['decision_ref'] == args.decision_ref, 'CANCELLATION_DECISION_MISMATCH')
    if state.get('lifecycle') == 'cancelled':
        return {'replayed': True, 'cancelled': True}
    prior = requested(state, 'cancel', args)
    H.require(prior is None, 'RECONCILE_OPERATION_BEFORE_RETRY')
    H.require(not any(o['status'] == 'intent' for o in state.get('operations', [])), 'OPERATION_UNRESOLVED')
    for name in ('finish-intent.json', 'startup-stop-intent.json', 'startup-resume-intent.json'):
        H.require(H.intent_resolved(root, name), 'RECONCILE_INTENT_BEFORE_CANCEL', {'intent': name})
    state['lifecycle'] = 'cancelling'
    if not state.get('cancellation'):
        state['cancellation'] = audit(state, 'cancel_requested', args)
    H.save(root, state)
    if not row:
        if state.get('session'):
            H.require(stopped(state, row, events) is not None, 'STOPPED_SESSION_REQUIRED')
        else:
            H.require(args.confirm_command_ended and not events and
                      not json.loads(startup.command(['list', '--json'], env)), 'UNBOUND_LAUNCH_UNRESOLVED')
        state['lifecycle'] = 'cancelled'
        audit(state, 'cancelled', args)
        H.save(root, state)
        return {'cancelled': True, 'stopped_verified': True}
    if args.interrupt:
        command = ['kill', state['session']['name']]
    else:
        ready(state, row, env)
        command = ['term', 'inject', state['session']['name'], '/exit', '--enter']
    reserve(state, root, 'cancel', args, interrupt=args.interrupt)
    startup.command(command, env)
    return {'shutdown_requested': True, 'cancelled': False, 'stopped_verified': False,
            'next_step': 'Reconcile matching stop event and live absence; never label cancellation as acceptance.'}


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('command', choices=['resume', 'cancel', 'reconcile'])
    for flag in ('workspace', 'feature'):
        p.add_argument('--' + flag, required=True)
    for flag in ('state', 'reason', 'decision-ref', 'key', 'target', 'evidence-ref'):
        p.add_argument('--' + flag)
    p.add_argument('--resolution', choices=['not-applied'])
    p.add_argument('--confirm-command-ended', action='store_true')
    p.add_argument('--interrupt', action='store_true')
    args = p.parse_args(argv)
    try:
        workspace = H.absolute(args.workspace)
        root = Path(H.absolute(args.state)) if args.state else H.default_state(workspace, args.feature).resolve()
        H.require(not H.inside(root, workspace), 'STATE_INSIDE_WORKSPACE')
        H.require((root / 'state.json').is_file(), 'STATE_MISSING')
        with H.locked(root):
            state = H.read_json(root / 'state.json')
            H.validate_binding(state, workspace, args.feature)
            H.require_mutable(state)
            env = dict(os.environ, HCOM_DIR=str(root / 'hcom'))
            rows, row, events = observe(state, env)
            if args.command == 'reconcile':
                launch_grant = reconcile(state, root, args, row, events, env)
                result = {'lifecycle': state.get('lifecycle', 'open'),
                          'launch_permitted': launch_grant,
                          'pending_operations': [o['key'] for o in state.get('operations', []) if o['status'] == 'intent'],
                          'next_step': 'Use status; resume only under existing execution authority, or cancel.'}
            elif args.command == 'resume':
                result = resume(state, root, args, row, events, env)
            else:
                result = cancel(state, root, args, row, events, env)
            print(json.dumps({'ok': True, **result}))
        return 0
    except (OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as exc:
        print(json.dumps({'ok': False, 'code': str(exc), 'details': getattr(exc, 'details', None),
                          'next_step': 'Inspect status and reconcile; no blind retry, state deletion or transport change.'}))
        return 2


if __name__ == '__main__':
    sys.exit(main())
