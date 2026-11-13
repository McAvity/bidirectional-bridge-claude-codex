#!/usr/bin/env python3
"""Read-only hcom execution summary; receipt is not user acceptance.

Default: read the bound namespace's event history and live list through hcom.
Offline: supply --events-file (JSONL) and optionally --live-file (JSON array).
Missing evidence remains unknown; no launch, send, stop or state writes occur.
"""
import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import subprocess
import sys

# Selected bundles are immutable; importing the sibling must not add bytecode.
sys.dont_write_bytecode = True
import hcom_state as helper


def timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return result if result.tzinfo else None
    except ValueError:
        return None


def elapsed(start, end):
    a, b = timestamp(start), timestamp(end)
    return round((b - a).total_seconds(), 3) if a and b and b >= a else None


def parse_events(raw):
    events = [json.loads(line) for line in raw.splitlines() if line.strip()]
    helper.require(all(isinstance(e, dict) and isinstance(e.get('data'), dict) and
                       timestamp(e.get('ts')) for e in events), 'EVENTS_FORMAT_INVALID')
    ids = [str(e.get('id')) for e in events]
    helper.require(len(set(ids)) == len(ids), 'DUPLICATE_EVENT_ID')
    return sorted(events, key=lambda e: timestamp(e['ts']))


def observations(path):
    result = {}
    data = helper.read_json(path) if path else {}
    helper.require(isinstance(data, dict), 'OBSERVATIONS_OBJECT_REQUIRED')
    for key in ('worker_approvals', 'coordinator_permission_issues'):
        entry = data.get(key)
        helper.require(entry is None or (isinstance(entry, dict) and
                       type(entry.get('count')) is int and entry['count'] >= 0 and
                       helper.text(entry.get('evidence'))), 'OBSERVATION_EVIDENCE_REQUIRED')
        result[key] = entry
    return result


def summarize(state, events, live, finish, reported):
    bound = state.get('session') or {}
    name = bound.get('name')
    warnings = []
    created = timestamp(state.get('created_at'))
    helper.require(created is not None, 'STATE_TIMESTAMP_INVALID')
    events = [e for e in events if timestamp(e['ts']) >= created]
    by_id = {str(e.get('id')): e for e in events}
    own = [e for e in events if name and e.get('instance') == name]
    ready = next((e['ts'] for e in own if e.get('type') == 'life' and
                  e['data'].get('action') == 'ready'), None)
    started = next((e['ts'] for e in own if e.get('type') == 'status' and
                    e['data'].get('context') == 'start'), None)
    rounds = []
    for r in state['rounds']:
        c, receipt = r['contract'], r.get('receipt') or {}
        event = by_id.get(str(r.get('send_event_id')))
        sent = None
        if (event and event.get('type') == 'message' and
                isinstance(event['data'].get('delivered_to'), list) and
                name in event['data'].get('delivered_to', []) and
                elapsed(r.get('prepared_at'), event['ts']) is not None):
            sent = event['ts']
        if r.get('send_event_id') and sent is None:
            warnings.append(f"Round {c['round']}: acknowledged dispatch event unavailable or mismatched.")
        expected = (f"RESULT_READY feature_id={c['feature_id']} task_id={c['task_id']} "
                    f"round={c['round']} report_path={c['report_path']}")
        # Last matching notification before receipt includes any report-only correction.
        results = [e['ts'] for e in own if e.get('type') == 'message' and
                   isinstance(e['data'].get('text'), str) and
                   e['data'].get('text', '').strip() == expected and
                   elapsed(sent, e['ts']) is not None and
                   (not receipt.get('at') or elapsed(e['ts'], receipt['at']) is not None)]
        result_at = results[-1] if results else None
        rounds.append({'round': c['round'], 'task_id': c['task_id'],
                       'dispatch_acknowledged': bool(r.get('send_event_id')),
                       'dispatched_at': sent, 'result_ready_at': result_at,
                       'receipt': receipt.get('decision'), 'receipt_at': receipt.get('at'),
                       'dispatch_to_result_seconds': elapsed(sent, result_at),
                       'dispatch_to_receipt_seconds': elapsed(sent, receipt.get('at'))})
    latest = (state['rounds'][-1].get('receipt') or {}) if rounds else {}
    accepted = latest.get('decision') == 'accepted'
    # An exit request is not evidence of a completed stop. Bind both intent and final
    # life event to the exact session and accepted report, and require live absence.
    valid_intent = bool(finish and bound and rounds and accepted and
                        finish.get('session') == bound and
                        finish.get('round') == rounds[-1]['round'] and
                        helper.text(latest.get('report_sha256')) and
                        finish.get('accepted_report_sha256') == latest['report_sha256'] and
                        elapsed(latest.get('at'), finish.get('at')) is not None)
    life = [e for e in own if e.get('type') == 'life']
    last_life = life[-1] if life else None
    stopped_at = None
    if valid_intent and last_life:
        d = last_life['data']
        snapshot = d.get('snapshot') or {}
        if (d.get('action') == 'stopped' and d.get('reason') == 'exit:prompt_input_exit' and
                isinstance(snapshot, dict) and snapshot.get('tool') == 'claude' and
                all(snapshot.get(k) == bound.get(k) for k in ('name', 'session_id', 'directory')) and
                elapsed(finish.get('at'), last_life['ts']) is not None):
            stopped_at = last_life['ts']
    live_present = None if live is None or not bound else any(
        row.get('name') == name or row.get('session_id') == bound.get('session_id') for row in live)
    stopped_verified = bool(stopped_at and live_present is False)
    if finish and not stopped_verified:
        warnings.append('Finish requested; normal stop not confirmed by matching history and live absence.')
    first_dispatch = rounds[0]['dispatched_at'] if rounds else None
    return {'format': 'feature-workflow.hcom-summary/v1', 'feature_id': state['feature_id'],
            'workflow_identity': state['workflow_identity'],
            'bound_sessions': 1 if bound else 0, 'prepared_rounds': len(rounds), 'rounds': rounds,
            'latest_receipt': latest.get('decision'),
            'startup_seconds': elapsed(started, ready),
            'initialization_to_ready_seconds': elapsed(state['created_at'], ready),
            'dispatch_to_accepted_receipt_seconds': elapsed(first_dispatch, latest.get('at')) if accepted else None,
            'finish_requested': finish is not None, 'normal_stop_event_at': stopped_at,
            'bound_session_live': live_present, 'stopped_verified': stopped_verified,
            'observations': reported, 'warnings': warnings,
            'user_acceptance': 'not_assessed'}


def duration(value):
    if value is None:
        return 'unknown'
    minutes, seconds = divmod(value, 60)
    return f'{int(minutes)}m {seconds:.3f}s' if minutes else f'{seconds:.3f}s'


def markdown(s):
    lines = [f"Hcom execution: {s['feature_id']}", '',
             f"- Bound native sessions: {s['bound_sessions']}; prepared rounds: {s['prepared_rounds']}.",
             f"- Startup (observed start → ready): {duration(s['startup_seconds'])}.",
             f"- Initialization → ready: {duration(s['initialization_to_ready_seconds'])}.",
             f"- First dispatch → accepted receipt: {duration(s['dispatch_to_accepted_receipt_seconds'])}.",
             f"- Latest receipt: {s['latest_receipt'] or 'pending'}; user acceptance: not assessed.",
             f"- Normal stop: {'confirmed' if s['stopped_verified'] else 'not confirmed'} "
             f"(finish requested: {str(s['finish_requested']).lower()}).",
             f"- Evidence: {s['evidence_source']}; confirmed only as of these observations."]
    for key, label in [('worker_approvals', 'Worker approvals'),
                       ('coordinator_permission_issues', 'Coordinator permission issues')]:
        entry = s['observations'][key]
        lines.append(f"- {label}: " + (f"{entry['count']} (reported: {entry['evidence']})" if entry else 'unknown; not measured.'))
    lines += ['', '| Round | Task | Dispatch → result | Dispatch → receipt | Receipt |',
              '| --- | --- | --- | --- | --- |']
    for r in s['rounds']:
        lines.append(f"| {r['round']} | {r['task_id']} | {duration(r['dispatch_to_result_seconds'])} | "
                     f"{duration(r['dispatch_to_receipt_seconds'])} | {r['receipt'] or 'pending'} |")
    lines += ['', *[f'Note: {w}' for w in s['warnings']]]
    return '\n'.join(lines).rstrip()


def command(args, env):
    p = subprocess.run(['hcom', *args], env=env, capture_output=True, text=True, timeout=30)
    helper.require(p.returncode == 0, 'HCOM_OBSERVATION_FAILED', p.stderr)
    return p.stdout


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--workspace', required=True)
    p.add_argument('--feature', required=True)
    for flag in ('state', 'events-file', 'live-file', 'observations'):
        p.add_argument('--' + flag)
    p.add_argument('--format', choices=['json', 'markdown'], default='markdown')
    args = p.parse_args(argv)
    try:
        workspace = helper.absolute(args.workspace)
        root = Path(helper.absolute(args.state)) if args.state else helper.default_state(workspace, args.feature).resolve()
        helper.require(not helper.inside(root, workspace), 'STATE_INSIDE_WORKSPACE')
        state = helper.read_json(root / 'state.json')
        helper.validate_binding(state, workspace, args.feature)
        helper.require(not args.live_file or args.events_file, 'EVENTS_FILE_REQUIRED')
        warnings = []
        if args.events_file:
            raw = Path(args.events_file).read_text()
            live = helper.read_json(args.live_file) if args.live_file else None
            source = 'saved snapshots (not a current live check)'
        else:
            env = dict(os.environ, HCOM_DIR=str(root / 'hcom'))
            source = 'hcom history and current live list'
            try:
                raw = command(['events', '--all', '--last', '10000', '--full'], env)
            except (OSError, ValueError, subprocess.TimeoutExpired):
                raw = ''
                warnings.append('History read failed; event-based measurements are unknown.')
            try:
                live = json.loads(command(['list', '--json'], env))
            except (OSError, ValueError, subprocess.TimeoutExpired):
                live = None
                warnings.append('Live list read failed; current absence is unknown.')
        if live is not None and not (isinstance(live, list) and all(isinstance(r, dict) for r in live)):
            live = None
            warnings.append('Live list is malformed; current absence is unknown.')
        try:
            events = parse_events(raw)
        except (ValueError, TypeError):
            events = []
            warnings.append('History is malformed or truncated; event-based measurements are unknown.')
        finish_path = root / 'finish-intent.json'
        finish = helper.read_json(finish_path) if finish_path.exists() else None
        helper.require(finish is None or isinstance(finish, dict), 'FINISH_INTENT_INVALID')
        result = summarize(state, events, live, finish, observations(args.observations))
        result['warnings'].extend(warnings)
        if len(events) >= 10000:
            result['warnings'].append('History limit reached; missing events are unknown, not zero.')
        result['evidence_source'] = source
        print(json.dumps({'ok': True, **result}) if args.format == 'json' else markdown(result))
        return 0
    except (OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as exc:
        print(json.dumps({'ok': False, 'code': str(exc), 'details': getattr(exc, 'details', None)}))
        return 2


if __name__ == '__main__':
    sys.exit(main())
