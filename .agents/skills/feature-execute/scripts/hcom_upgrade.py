#!/usr/bin/env python3
"""Explicit, journalled upgrade of an hcom feature; never starts a model.

The default is a read-only plan. --yes publishes a verified immutable bundle,
then updates the feature lock and private state in a replayable transaction.
Historical contracts, receipts and identities are never rewritten.
"""
import argparse
import copy
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
import hcom_state as H

FORMAT = 'feature-workflow.hcom-upgrade/v1'


def guarded(path):
    """Reject redirects in managed paths, including missing final components."""
    path = Path(path)
    H.require(path.is_absolute(), 'ABSOLUTE_PATH_REQUIRED')
    H.require('..' not in path.parts, 'PATH_REDIRECTED')
    # macOS /tmp and /var themselves are aliases; canonicalize the anchor first.
    for candidate in [path, *path.parents[:-1]]:
        H.require(not candidate.is_symlink(), 'PATH_REDIRECTED', {'path': str(candidate)})
    return path


def library():
    source = Path(__file__).resolve()
    for path in (source.parents[3] / 'scripts/workflow-lib.mjs',
                 source.parents[4] / 'scripts/workflow-source/workflow-lib.mjs'):
        if path.is_file():
            return path
    raise H.Refusal('WORKFLOW_LIBRARY_MISSING')


def node(action, data):
    # Import only our own bundled verifier, never executable code from --bundle.
    script = '''
import * as W from LIBRARY;
import {readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
const p=JSON.parse(readFileSync(0,'utf8'));
try {
 let result;
 if (p.action==='verify') {
  const m=W.verifyBundle(p.bundle);
  const problems=W.checkCompatibility(m.requires,null,{mode:'standalone'});
  if(problems.length) throw new W.WorkflowError('WORKFLOW_INCOMPATIBLE',JSON.stringify(problems));
  const target=join(W.storeRoot(),m.workflow_id);
  if(existsSync(target)) W.verifyBundle(target,m.identity);
  result={manifest:m,target};
 } else if(p.action==='publish') result=W.storePublish(W.storeRoot(),p.bundle);
 else if(p.action==='lock') result=W.validateLock(p.lock);
 else throw Error('unknown operation');
 process.stdout.write(JSON.stringify({ok:true,result}));
} catch(e) {process.stdout.write(JSON.stringify({ok:false,code:e.code||'WORKFLOW_VERIFICATION_FAILED',detail:e.detail||e.message}));}
'''.replace('LIBRARY', json.dumps(library().as_uri()))
    proc = subprocess.run(['node', '--input-type=module', '-e', script],
                          input=json.dumps(dict(data, action=action)), capture_output=True,
                          text=True, timeout=60)
    H.require(proc.returncode == 0, 'WORKFLOW_VERIFICATION_FAILED', {'detail': proc.stderr[-1000:]})
    response = json.loads(proc.stdout)
    H.require(response.get('ok'), response.get('code', 'WORKFLOW_VERIFICATION_FAILED'),
              {'detail': response.get('detail')})
    return response['result']


def encoded(value):
    return json.dumps(value, indent=2, ensure_ascii=False) + '\n'


def atomic(path, content):
    path = guarded(path)
    fd, temporary = tempfile.mkstemp(prefix='.upgrade-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as out:
            out.write(content)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def bridge_closed(workspace, feature):
    ref = feature.get('bridge')
    if not ref:
        return
    H.require(isinstance(ref, dict) and H.text(ref.get('feature_id')), 'BRIDGE_REFERENCE_INVALID')
    database = guarded(workspace / '.bridge/bridge.db')
    H.require(database.is_file(), 'BRIDGE_FEATURE_STATE_UNKNOWN')
    try:
        with closing(sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)) as db:
            row = db.execute('SELECT json FROM features WHERE feature_id=?',
                             (ref['feature_id'],)).fetchone()
        record = json.loads(row[0]) if row else None
    except (sqlite3.Error, ValueError):
        raise H.Refusal('BRIDGE_FEATURE_STATE_UNKNOWN')
    H.require(isinstance(record, dict) and record.get('feature_id') == ref['feature_id'] and
              (not ref.get('parent_task_id') or record.get('parent_task_id') == ref['parent_task_id']),
              'BRIDGE_FEATURE_STATE_UNKNOWN')
    H.require(record.get('state') in ('accepted', 'rejected', 'cancelled'), 'BRIDGE_FEATURE_ACTIVE')


def preflight(args, workspace, root, feature_dir, manifest, target):
    state = H.read_json(guarded(root / 'state.json'))
    H.validate_binding(state, str(workspace), args.feature)
    H.require(not state.get('upgrade_pending'), 'WORKFLOW_UPGRADE_PENDING')
    feature = H.read_json(guarded(feature_dir / 'feature.json'))
    H.require(feature.get('feature_id') == args.feature, 'FEATURE_MISMATCH')
    H.require(feature.get('execution', {}).get('transport') == 'hcom', 'HCOM_TRANSPORT_REQUIRED')
    bridge_closed(workspace, feature)
    lock = H.read_json(guarded(feature_dir / 'workflow.lock.json'))
    node('lock', {'lock': lock})
    H.require(lock.get('feature', {}).get('feature_id') == args.feature, 'FEATURE_MISMATCH')
    H.require(lock['generation'] == args.expected_generation, 'GENERATION_CONFLICT')
    H.require(lock['workflow']['identity'] == state['workflow_identity'], 'WORKFLOW_IDENTITY_MISMATCH')
    H.require(lock['workflow']['identity'] != manifest['identity'], 'ALREADY_SELECTED')
    rounds = state.get('rounds', [])
    H.require(isinstance(rounds, list), 'STATE_INVALID')
    # Migration changes instructions/binding only. A stopped, busy or uncertain
    # worker must not make recovery instructions impossible to install. Existing
    # guards and historical contracts remain authoritative for subsequent actions.
    if args.session_file:
        H.check_session(state, args.session_file)
        H.check_readiness(args.session_file, root)
    at = H.now()
    new_lock = copy.deepcopy(lock)
    new_lock['workflow'] = {key: manifest[key] for key in ('version', 'identity', 'workflow_id', 'kind')}
    new_lock['generation'] += 1
    new_lock['origin'] = {'kind': 'switch', 'from_identity': lock['workflow']['identity']}
    new_lock['history'].append({'generation': new_lock['generation'], 'op': 'switch',
                               'version': manifest['version'], 'identity': manifest['identity'],
                               'origin': 'switch', 'at': at})
    node('lock', {'lock': new_lock})
    new_state = copy.deepcopy(state)
    new_state.update(format=H.FORMAT, workflow_identity=manifest['identity'],
                     workflow_bundle=str(target), worker_root=str(target / 'claude'))
    new_state.setdefault('lifecycle', 'open')
    new_state.setdefault('operations', [])
    new_state.setdefault('workflow_upgrades', []).append({
        'at': at, 'from_identity': state['workflow_identity'], 'to_identity': manifest['identity'],
        'generation': new_lock['generation'], 'reason': args.reason, 'decision_ref': args.decision_ref})
    return state, new_state, new_lock


def result(journal, applied, code):
    return {'ok': True, 'format': FORMAT, 'code': code, 'applied': applied,
            'workspace': journal['request']['workspace'], 'feature_id': journal['request']['feature'],
            'from_identity': journal['from_identity'], 'to_identity': journal['request']['identity'],
            'generation': journal['request']['expected_generation'] + 1,
            'bundle': journal['target'], 'state': journal['root'],
            'preserved_history': True, 'launch_authorized': False, 'dispatch_permitted': False,
            'shutdown_permitted': False, 'recovery_required': journal['recovery_required']}


def replay(journal_path, journal, state_path, lock_path):
    """Complete only the exact transaction snapshots; never overwrite subsequent work."""
    before, pending, after = (journal[key] for key in ('before_state', 'pending_state', 'after_state'))
    state_bytes, lock_bytes = state_path.read_text(), lock_path.read_text()
    if journal.get('status') == 'done':
        state, lock = json.loads(state_bytes), json.loads(lock_bytes)
        H.require(state.get('workflow_identity') == journal['request']['identity'] and
                  lock.get('workflow', {}).get('identity') == journal['request']['identity'] and
                  lock.get('generation') == journal['request']['expected_generation'] + 1,
                  'UPGRADE_REPLAY_DRIFT')
        return result(journal, False, 'ALREADY_UPGRADED')
    H.require(state_bytes in (before, pending, after) and
              lock_bytes in (journal['before_lock'], journal['after_lock']), 'UPGRADE_REPLAY_DRIFT')
    if state_bytes == before:
        H.require(lock_bytes == journal['before_lock'], 'UPGRADE_REPLAY_DRIFT')
        atomic(state_path, pending)
    if lock_bytes != journal['after_lock']:
        atomic(lock_path, journal['after_lock'])
    if state_bytes != after:
        atomic(state_path, after)
    journal['status'] = 'done'
    atomic(journal_path, encoded(journal))
    return result(journal, True, 'UPGRADED')


def run(args):
    H.require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}', args.feature) is not None,
              'FEATURE_ID_INVALID')
    H.require(args.expected_generation > 0 and H.text(args.reason) and H.text(args.decision_ref),
              'UPGRADE_REASON_REQUIRED')
    # A caller-selected workspace anchor may itself be aliased; managed descendants may not.
    workspace = Path(H.absolute(args.workspace))
    H.require(workspace.is_dir(), 'WORKSPACE_MISSING')
    root = guarded(Path(args.state) if args.state else H.default_state(str(workspace), args.feature))
    H.require(not H.inside(root, workspace), 'STATE_INSIDE_WORKSPACE')
    guarded(root / '.lock')
    for name in ('finish-intent.json', 'startup-stop-intent.json', 'startup-resume-intent.json'):
        guarded(root / name)
    feature_dir = guarded(workspace / 'docs/features' / args.feature)
    state_path, lock_path = guarded(root / 'state.json'), guarded(feature_dir / 'workflow.lock.json')
    H.require(state_path.is_file() and lock_path.is_file(), 'UPGRADE_SOURCE_MISSING')
    bundle = guarded(Path(args.bundle))
    checked = node('verify', {'bundle': str(bundle)})
    manifest, target = checked['manifest'], Path(checked['target'])
    # Integrity was verified above; this checks migration protocol support, not authenticity.
    for client in ('claude', 'codex'):
        scripts = bundle / client / 'skills/feature-execute/scripts'
        H.require((scripts / 'hcom_upgrade.py').is_file() and
                  "feature-workflow.hcom-state/v2" in (scripts / 'hcom_state.py').read_text(),
                  'TARGET_LIFECYCLE_UNSUPPORTED')
    request = {'workspace': str(workspace), 'feature': args.feature, 'identity': manifest['identity'],
               'expected_generation': args.expected_generation, 'reason': args.reason,
               'decision_ref': args.decision_ref}
    key = hashlib.sha256(json.dumps({k: request[k] for k in
                         ('workspace', 'feature', 'identity', 'expected_generation')}, sort_keys=True).encode()).hexdigest()[:24]
    journal_dir = guarded(root / 'upgrades')
    journal_path = guarded(journal_dir / (key + '.json'))
    if journal_path.exists():
        journal = H.read_json(journal_path)
        H.require(journal.get('format') == FORMAT and journal.get('request') == request and
                  journal.get('root') == str(root) and journal.get('target') == str(target),
                  'UPGRADE_REPLAY_MISMATCH')
        if not args.yes:
            return result(journal, False, 'REPLAY_AVAILABLE')
        with H.locked(root):
            # Immutable target must remain fully verified on every replay.
            node('verify', {'bundle': str(target)})
            return replay(journal_path, H.read_json(journal_path), state_path, lock_path)
    before_state, before_lock = state_path.read_text(), lock_path.read_text()
    state, new_state, new_lock = preflight(args, workspace, root, feature_dir, manifest, target)
    H.require(state_path.read_text() == before_state and lock_path.read_text() == before_lock,
              'UPGRADE_SOURCE_CHANGED')
    pending_state = copy.deepcopy(state)
    pending_state.update(format=H.FORMAT, upgrade_pending=key)
    unresolved_intent = any(not H.intent_resolved(root, name) for name in
                            ('finish-intent.json', 'startup-stop-intent.json', 'startup-resume-intent.json'))
    current = state['rounds'][-1] if state['rounds'] else None
    recovery_required = (state.get('lifecycle', 'open') != 'open' or not state.get('session') or
                         any(op.get('status') == 'intent' for op in state.get('operations', [])) or
                         unresolved_intent or bool(current and not H.settled(current)))
    journal = {'format': FORMAT, 'status': 'pending', 'request': request,
               'recovery_required': recovery_required,
               'root': str(root), 'target': str(target), 'from_identity': state['workflow_identity'],
               'before_state': before_state, 'pending_state': encoded(pending_state),
               'after_state': encoded(new_state), 'before_lock': before_lock,
               'after_lock': encoded(new_lock)}
    if not args.yes:
        return result(journal, False, 'PLAN_READY')
    with H.locked(root):
        # Recheck authorization, readiness and files after acquiring the mutation lock.
        preflight(args, workspace, root, feature_dir, manifest, target)
        H.require(state_path.read_text() == journal['before_state'] and
                  lock_path.read_text() == journal['before_lock'], 'UPGRADE_SOURCE_CHANGED')
        published = node('publish', {'bundle': str(bundle)})
        H.require(published['path'] == str(target) and published['identity'] == manifest['identity'],
                  'WORKFLOW_IDENTITY_MISMATCH')
        journal_dir.mkdir(mode=0o700, exist_ok=True)
        atomic(journal_path, encoded(journal))
        return replay(journal_path, journal, state_path, lock_path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('workspace', 'feature', 'bundle', 'reason', 'decision-ref'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--expected-generation', required=True, type=int)
    parser.add_argument('--state')
    parser.add_argument('--session-file', help='optional fresh same-session readiness snapshot; migration itself never resumes or dispatches')
    parser.add_argument('--yes', action='store_true', help='apply the plan; otherwise read only')
    args = parser.parse_args()
    try:
        response = run(args)
    except H.Refusal as exc:
        response = {'ok': False, 'code': str(exc), 'details': exc.details, 'applied': False}
    except (OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as exc:
        response = {'ok': False, 'code': 'UPGRADE_INPUT_INVALID', 'details': str(exc), 'applied': False}
    print(json.dumps(response, indent=2, ensure_ascii=False))
    return 0 if response['ok'] else 2


if __name__ == '__main__':
    sys.exit(main())
