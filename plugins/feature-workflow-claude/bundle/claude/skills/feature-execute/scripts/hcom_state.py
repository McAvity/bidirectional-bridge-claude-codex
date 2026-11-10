#!/usr/bin/env python3
"""Private hcom bookkeeping, not a launcher or a Git delivery validator.

Only a fresh init/prepare permits launch/send in its immediate caller. Re-reading
state never grants that permission: an interrupted caller must inspect hcom history.
The coordinator independently verifies workflow bytes, Git scope, tests and review
before recording a receipt. This helper never invokes hcom, Git or a model.
"""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile

FORMAT = 'feature-workflow.hcom-state/v1'
LINE = re.compile(r'^DELIVERY=local-v1 BASE=([0-9a-f]{40}) HEAD=([0-9a-f]{40}) '
                  r'LEDGER=(\S+) OUTCOME=(COMPLETE|PARTIAL) WORKTREE=(clean|dirty:[0-9]+)$')


class Refusal(ValueError):
    def __init__(self, code, details=None):
        super().__init__(code)
        self.details = details


def require(condition, code, details=None):
    if not condition:
        raise Refusal(code, details)


def now():
    return datetime.now(timezone.utc).isoformat()


def absolute(value):
    require(isinstance(value, str) and Path(value).is_absolute(), 'ABSOLUTE_PATH_REQUIRED')
    return str(Path(value).resolve())


def text(value):
    return isinstance(value, str) and bool(value.strip())


def read_json(path):
    return json.loads(Path(path).read_text())


def inside(path, root):
    return Path(path) == Path(root) or Path(root) in Path(path).parents


def relative_path(value, workspace):
    require(text(value) and not Path(value).is_absolute() and '..' not in Path(value).parts,
            'RELATIVE_PATH_REQUIRED')
    resolved = (Path(workspace) / value).resolve()
    require(inside(resolved, workspace) and resolved != Path(workspace), 'PATH_OUTSIDE_WORKSPACE')
    return resolved


def default_state(workspace, feature):
    key = hashlib.sha256((workspace + '\0' + feature).encode()).hexdigest()[:24]
    base = Path(os.environ.get('XDG_STATE_HOME', str(Path.home() / '.local/state')))
    require(base.is_absolute(), 'ABSOLUTE_STATE_HOME_REQUIRED')
    return base / 'feature-workflow/hcom' / key


@contextmanager
def locked(root):
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (root / '.lock').open('a') as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Refusal('STATE_BUSY')
        yield


def save(root, state):
    fd, name = tempfile.mkstemp(prefix='.state-', dir=root)
    try:
        with os.fdopen(fd, 'w') as handle:
            json.dump(state, handle, indent=2, ensure_ascii=False)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(name, root / 'state.json')
    finally:
        if os.path.exists(name):
            os.unlink(name)


def session(data, workspace):
    require(isinstance(data, dict), 'SESSION_OBJECT_REQUIRED')
    require(text(data.get('name')) and text(data.get('session_id')), 'SESSION_ID_REQUIRED')
    require(absolute(data.get('directory')) == workspace, 'SESSION_WORKSPACE_MISMATCH')
    return {key: data[key] for key in ('name', 'session_id')} | {'directory': workspace}


def check_session(state, path):
    require(path is not None, 'SESSION_FILE_REQUIRED')
    observed = session(read_json(path), state['workspace'])
    require(state['session'] == observed, 'SESSION_MISMATCH')
    return observed


def contract_checks(data):
    """Keep legacy command keys; new contracts bind stable IDs to frozen commands."""
    checks = data.get('checks')
    require(isinstance(checks, list) and checks, 'CHECKS_REQUIRED')
    if all(text(c) for c in checks):
        require(len(set(checks)) == len(checks), 'DUPLICATE_CHECK')
        return 'command', {c: c for c in checks}
    require(all(isinstance(c, dict) for c in checks), 'CHECKS_FORMAT_MIXED_OR_INVALID')
    for check in checks:
        require(isinstance(check.get('id'), str) and
                re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,63}', check['id']), 'CHECK_ID_INVALID')
        require(text(check.get('command')), 'CHECK_COMMAND_REQUIRED', {'check_id': check['id']})
    require(len({c['id'] for c in checks}) == len(checks), 'DUPLICATE_CHECK_ID')
    return 'check_id', {c['id']: c['command'] for c in checks}


def contract(path, state, expected_sha256=None):
    require(path is not None, 'CONTRACT_REQUIRED')
    resolved = Path(path).resolve()
    require(inside(resolved, state['workspace']), 'CONTRACT_OUTSIDE_WORKSPACE')
    raw = resolved.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if expected_sha256 is not None:
        require(digest == expected_sha256, 'CONTRACT_SHA256_MISMATCH')
    data = json.loads(raw)
    require(isinstance(data, dict), 'CONTRACT_OBJECT_REQUIRED')
    require(data.get('feature_id') == state['feature_id'], 'FEATURE_MISMATCH')
    require(absolute(data.get('workspace')) == state['workspace'], 'WORKSPACE_MISMATCH')
    require(data.get('workflow_identity') == state['workflow_identity'], 'WORKFLOW_MISMATCH')
    require(absolute(data.get('worker_root')) == state['worker_root'], 'WORKER_ROOT_MISMATCH')
    require(absolute(data.get('workflow_bundle')) == state['workflow_bundle'], 'WORKFLOW_BUNDLE_MISMATCH')
    require(text(data.get('task_id')) and text(data.get('objective')), 'TASK_OBJECTIVE_REQUIRED')
    require(type(data.get('round')) is int and data['round'] > 0, 'ROUND_REQUIRED')
    require(re.fullmatch('[0-9a-f]{40}', str(data.get('base_commit', ''))), 'BASE_REQUIRED')
    require(isinstance(data.get('write_scope'), list) and bool(data['write_scope']), 'SCOPE_REQUIRED')
    for scope in data['write_scope']:
        relative_path(scope, state['workspace'])
    contract_checks(data)
    relative_path(data.get('ledger_dir'), state['workspace'])
    relative_path(data.get('report_path'), state['workspace'])
    return data, str(resolved), digest


def report(path, state, current):
    require(path is not None, 'REPORT_REQUIRED')
    expected = relative_path(current['contract']['report_path'], state['workspace'])
    require(Path(path).resolve() == expected, 'REPORT_PATH_MISMATCH')
    data = read_json(path)
    require(isinstance(data, dict), 'REPORT_OBJECT_REQUIRED')
    c = current['contract']
    for key in ('feature_id', 'task_id', 'round', 'workflow_identity'):
        require(data.get(key) == c[key] and type(data.get(key)) is type(c[key]),
                'REPORT_' + key.upper() + '_MISMATCH')
    require(text(data.get('summary')), 'SUMMARY_REQUIRED')
    line = LINE.fullmatch(data['summary'].splitlines()[0])
    require(line is not None, 'DELIVERY_LINE_REQUIRED')
    require(line[1] == c['base_commit'], 'DELIVERY_BASE_MISMATCH')
    require(data.get('status') == line[4], 'DELIVERY_STATUS_MISMATCH')
    ledger = relative_path(line[3], state['workspace'])
    ledger_dir = relative_path(c['ledger_dir'], state['workspace'])
    require(ledger != ledger_dir and inside(ledger, ledger_dir), 'LEDGER_SCOPE_MISMATCH')
    require('blocker' in data and (data['blocker'] is None or text(data['blocker'])), 'BLOCKER_REQUIRED')
    require(data['status'] != 'PARTIAL' or text(data['blocker']), 'PARTIAL_NEEDS_BLOCKER')
    for field in ('changed_scope', 'remaining_risks'):
        require(isinstance(data.get(field), list) and all(text(v) for v in data[field]), field.upper() + '_REQUIRED')
    key, expected_checks = contract_checks(c)
    checks = data.get('verification_results')
    require(isinstance(checks, list) and all(isinstance(v, dict) and text(v.get(key)) and
            v.get('result') in ('passed', 'failed', 'not_run') for v in checks), 'VERIFICATION_REQUIRED')
    require(len({v[key] for v in checks}) == len(checks), 'DUPLICATE_CHECK')
    if key == 'check_id':
        for check in checks:
            ident = check[key]
            require(ident in expected_checks, 'UNKNOWN_CHECK_ID', {'check_id': ident})
            require('command' not in check or check['command'] == expected_checks[ident],
                    'CHECK_COMMAND_MISMATCH', {'check_id': ident})
    return data


def acceptance_issues(delivered, c):
    key, expected = contract_checks(c)
    observed = {v[key]: v['result'] for v in delivered['verification_results']}
    issues = {}
    if delivered['status'] != 'COMPLETE':
        issues['status'] = delivered['status']
    if delivered['blocker'] is not None:
        issues['blocker'] = delivered['blocker']
    missing = [check for check in expected if check not in observed]
    nonpassing = [check for check in observed if observed[check] != 'passed']
    if missing:
        issues['missing_checks'] = missing
    if nonpassing:
        issues['nonpassing_checks'] = nonpassing
    return issues


def stateless_contract(args, workspace):
    require(args.contract is not None, 'CONTRACT_REQUIRED')
    require(isinstance(args.contract_sha256, str) and
            re.fullmatch(r'[0-9a-f]{64}', args.contract_sha256), 'CONTRACT_SHA256_REQUIRED')
    path = Path(args.contract).resolve()
    require(inside(path, workspace), 'CONTRACT_OUTSIDE_WORKSPACE')
    raw = path.read_bytes()
    require(hashlib.sha256(raw).hexdigest() == args.contract_sha256, 'CONTRACT_SHA256_MISMATCH')
    c = json.loads(raw)
    require(isinstance(c, dict), 'CONTRACT_OBJECT_REQUIRED')
    require(text(c.get('workflow_identity')), 'WORKFLOW_IDENTITY_REQUIRED')
    worker = absolute(c.get('worker_root'))
    bundle = absolute(c.get('workflow_bundle'))
    require(Path(worker).name == 'claude' and str(Path(worker).parent) == bundle,
            'CLAUDE_VARIANT_REQUIRED')
    state = {'workspace': workspace, 'feature_id': args.feature,
             'workflow_identity': c['workflow_identity'], 'worker_root': worker,
             'workflow_bundle': bundle}
    c, _, _ = contract(path, state, args.contract_sha256)
    return c, state


def report_template(c):
    key, checks = contract_checks(c)
    return {field: c[field] for field in ('feature_id', 'task_id', 'round', 'workflow_identity')} | {
        'status': 'PARTIAL', 'summary': '', 'changed_scope': [], 'remaining_risks': [],
        'verification_results': [{key: ident, 'result': 'not_run', 'details': ''} for ident in checks],
        'blocker': 'Report template: fill actual delivery, checks and remaining work before validation.'}


def close_check(state, session_file):
    check_session(state, session_file)
    require(bool(state['rounds']), 'NO_PREPARED_ROUND')
    current = state['rounds'][-1]
    receipt = current.get('receipt')
    require(isinstance(receipt, dict) and receipt.get('decision') == 'accepted', 'ACCEPTED_RECEIPT_REQUIRED')
    require(text(current.get('send_event_id')), 'SEND_ACKNOWLEDGEMENT_REQUIRED')
    path = relative_path(current['contract']['report_path'], state['workspace'])
    require(hashlib.sha256(path.read_bytes()).hexdigest() == receipt.get('report_sha256'),
            'ACCEPTED_REPORT_CHANGED')
    delivered = report(path, state, current)
    require(delivered == receipt.get('report'), 'ACCEPTED_REPORT_CHANGED')
    issues = acceptance_issues(delivered, current['contract'])
    require(not issues, 'REPORT_NOT_ACCEPTABLE', issues)


def run(args):
    workspace = absolute(args.workspace)
    require(Path(workspace).is_dir(), 'WORKSPACE_MISSING')
    require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', args.feature), 'FEATURE_ID_INVALID')
    result = {'ok': True, 'launch_permitted': False, 'dispatch_permitted': False, 'shutdown_permitted': False}
    if args.command in ('report-template', 'validate-report'):
        c, context = stateless_contract(args, workspace)
        if args.command == 'report-template':
            return result | {'report': report_template(c)}
        delivered = report(args.report, context, {'contract': c})
        issues = acceptance_issues(delivered, c)
        if delivered['status'] == 'COMPLETE' and issues:
            return result | {'ok': False, 'code': 'REPORT_NOT_ACCEPTABLE',
                             'acceptable': False, 'acceptance_issues': issues}
        return result | {'acceptable': not issues, 'acceptance_issues': issues}
    root = Path(absolute(args.state)) if args.state else default_state(workspace, args.feature).resolve()
    require(not inside(root, workspace), 'STATE_INSIDE_WORKSPACE')
    result['state_dir'] = str(root)
    if args.command == 'namespace':
        return result
    target = root / 'state.json'
    # Missing/read-only queries do not create files or locks.
    if args.command in ('status', 'check-session', 'close-check'):
        require(target.is_file(), 'STATE_MISSING')
        state = read_json(target)
        validate_binding(state, workspace, args.feature)
        if args.command == 'check-session':
            check_session(state, args.session_file)
        if args.command == 'close-check':
            close_check(state, args.session_file)
            result['shutdown_permitted'] = True
        return result | {'state': state}
    with locked(root):
        if args.command == 'init':
            require(text(args.workflow_identity), 'WORKFLOW_IDENTITY_REQUIRED')
            worker_root = absolute(args.worker_root)
            require(Path(worker_root).name == 'claude', 'CLAUDE_VARIANT_REQUIRED')
            require((Path(worker_root) / 'skills/feature-execute/SKILL.md').is_file(), 'WORKER_SKILL_MISSING')
            if target.exists():
                state = read_json(target)
                validate_binding(state, workspace, args.feature)
                require(state['workflow_identity'] == args.workflow_identity and state['worker_root'] == worker_root,
                        'WORKFLOW_BINDING_MISMATCH')
                return result | {'state': state}
            state = {'format': FORMAT, 'workspace': workspace, 'feature_id': args.feature,
                     'workflow_identity': args.workflow_identity, 'worker_root': worker_root,
                     'workflow_bundle': str(Path(worker_root).parent),
                     'created_at': now(), 'session': None, 'rounds': []}
            save(root, state)
            return result | {'state': state, 'launch_permitted': True}
        require(target.is_file(), 'STATE_MISSING')
        state = read_json(target)
        validate_binding(state, workspace, args.feature)
        if args.command == 'bind':
            require(args.session_file is not None, 'SESSION_FILE_REQUIRED')
            observed = session(read_json(args.session_file), workspace)
            require(state['session'] is None or state['session'] == observed, 'SESSION_MISMATCH')
            state['session'] = observed
        elif args.command == 'prepare':
            check_session(state, args.session_file)
            c, path, digest = contract(args.contract, state)
            require(c['round'] == len(state['rounds']) + 1, 'ROUND_ALREADY_PREPARED_OR_OUT_OF_ORDER')
            require(not state['rounds'] or (state['rounds'][-1].get('receipt') or {}).get('decision')
                    in ('accepted', 'rework'), 'PREVIOUS_ROUND_UNSETTLED')
            state['rounds'].append({'contract': c, 'contract_path': path, 'contract_sha256': digest,
                                    'prepared_at': now(), 'send_event_id': None, 'receipt': None})
            result['dispatch_permitted'] = True
        elif args.command in ('sent', 'receipt'):
            require(bool(state['rounds']), 'NO_PREPARED_ROUND')
            current = state['rounds'][-1]
            if args.command == 'sent':
                require(text(args.event_id), 'EVENT_ID_REQUIRED')
                require(current['send_event_id'] in (None, args.event_id), 'SEND_EVENT_MISMATCH')
                current['send_event_id'] = args.event_id
            else:
                require(current['receipt'] is None, 'RECEIPT_ALREADY_RECORDED')
                require(args.decision in ('accepted', 'rework', 'blocked') and text(args.note), 'DECISION_NOTE_REQUIRED')
                delivered = report(args.report, state, current)
                if args.decision == 'accepted':
                    issues = acceptance_issues(delivered, current['contract'])
                    require(not issues, 'REPORT_NOT_ACCEPTABLE', issues)
                current['receipt'] = {'decision': args.decision, 'note': args.note, 'at': now(),
                                      'report': delivered, 'report_sha256': hashlib.sha256(Path(args.report).read_bytes()).hexdigest()}
        save(root, state)
        return result | {'state': state}


def validate_binding(state, workspace, feature):
    require(isinstance(state, dict) and state.get('format') == FORMAT, 'STATE_FORMAT_INVALID')
    require(state.get('workspace') == workspace, 'WORKSPACE_MISMATCH')
    require(state.get('feature_id') == feature, 'FEATURE_MISMATCH')


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('command', choices=['namespace', 'init', 'bind', 'status', 'check-session', 'prepare', 'sent', 'receipt',
                                      'report-template', 'validate-report', 'close-check'])
    for flag in ('workspace', 'feature'):
        p.add_argument('--' + flag, required=True)
    for flag in ('state', 'workflow-identity', 'worker-root', 'session-file', 'contract', 'contract-sha256',
                 'event-id', 'report', 'decision', 'note'):
        p.add_argument('--' + flag)
    try:
        answer = run(p.parse_args(argv))
        print(json.dumps(answer, ensure_ascii=False))
        return 0 if answer['ok'] else 2
    except (Refusal, OSError, ValueError, TypeError, KeyError) as exc:
        print(json.dumps({'ok': False, 'code': str(exc), 'details': getattr(exc, 'details', None),
                          'acceptable': False, 'launch_permitted': False, 'dispatch_permitted': False,
                          'shutdown_permitted': False}))
        return 2


if __name__ == '__main__':
    sys.exit(main())
