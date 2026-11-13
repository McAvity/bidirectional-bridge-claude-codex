"""Model-free migration tests: real bundle verifier/store and disposable feature state."""
from contextlib import closing
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / '.agents/skills/feature-execute/scripts'
sys.path.insert(0, str(SCRIPTS))
sys.dont_write_bytecode = True
import hcom_upgrade as U


class UpgradeTests(unittest.TestCase):
    def setUp(self):
        self.temp = Path(tempfile.mkdtemp(prefix='hcom-upgrade-')).resolve()
        self.addCleanup(self.cleanup)
        self.workspace = self.temp / 'workspace'
        self.feature = self.workspace / 'docs/features/F-1'
        self.feature.mkdir(parents=True)
        self.state = self.temp / 'private'
        self.state.mkdir()
        self.bundle = self.temp / 'bundle'
        self.home = self.temp / 'store-home'
        self.env = patch.dict(os.environ, {'CLAUDE_CODEX_BRIDGE_HOME': str(self.home)})
        self.env.start()
        self.addCleanup(self.env.stop)
        script = '''import * as W from LIB;
const variants={};
for(const c of W.CLIENTS) variants[c]={
 [`.${c}-plugin/plugin.json`]:{data:'{"name":"feature-workflow"}',mode:'644'},
 'skills/feature-execute/scripts/hcom_state.py':{data:'FORMAT="feature-workflow.hcom-state/v2"',mode:'644'},
 'skills/feature-execute/scripts/hcom_upgrade.py':{data:'# synthetic migration support',mode:'644'}
};
const manifest=W.bundleManifest({version:'1.1.6',requires:{},variants,source:{kind:'test'}});
W.writeBundle(process.argv[1],manifest,variants);
console.log(JSON.stringify(manifest));'''.replace('LIB', json.dumps(U.library().as_uri()))
        self.manifest = json.loads(subprocess.check_output(
            ['node', '--input-type=module', '-e', script, str(self.bundle)], text=True))
        identity = 'sha256:' + 'a' * 64
        self.old = {'format': U.H.LEGACY_FORMAT, 'workspace': str(self.workspace), 'feature_id': 'F-1',
                    'workflow_identity': identity, 'workflow_bundle': '/old/bundle',
                    'worker_root': '/old/bundle/claude', 'created_at': U.H.now(),
                    'session': {'name': 'worker', 'session_id': 'native-1', 'directory': str(self.workspace)},
                    'rounds': [{'contract': {'workflow_identity': identity, 'round': 1},
                                'receipt': {'decision': 'blocked', 'report': '/old/report.json'}}]}
        self.lock = {'format': 'feature-workflow.lock/v1', 'feature': {'feature_id': 'F-1', 'draft_token': None},
                     'workflow': {'version': '1.1.5', 'identity': identity,
                                  'workflow_id': '1.1.5-' + 'a' * 12, 'kind': 'release'},
                     'generation': 1, 'origin': {'kind': 'begin'},
                     'history': [{'generation': 1, 'op': 'begin', 'version': '1.1.5', 'identity': identity,
                                  'origin': 'begin', 'at': U.H.now()}]}
        self.feature_doc = {'feature_id': 'F-1', 'execution': {'transport': 'hcom'}}
        self.write(self.state / 'state.json', self.old)
        self.write(self.feature / 'workflow.lock.json', self.lock)
        self.write(self.feature / 'feature.json', self.feature_doc)
        self.session_file = self.temp / 'ready.json'
        self.ready = dict(self.old['session'], tool='claude', status='listening', hooks_bound=True,
                          process_bound=True, workflow_readiness={'checked_at': U.H.now(),
                          'terminal': {'ready': True, 'prompt_empty': True, 'input_text': ''}})
        self.write(self.session_file, self.ready)
        self.args = U.argparse.Namespace(workspace=str(self.workspace), feature='F-1', state=str(self.state),
                                         bundle=str(self.bundle), expected_generation=1,
                                         reason='Resume after network recovery', decision_ref='decisions/06.md',
                                         session_file=str(self.session_file), yes=False)

    def cleanup(self):
        for path in [self.temp, *self.temp.rglob('*')]:
            if not path.is_symlink():
                path.chmod(path.stat().st_mode | 0o700)
        shutil.rmtree(self.temp)

    def write(self, path, value):
        path.write_text(U.encoded(value))

    def refusal(self, code):
        return self.assertRaisesRegex(U.H.Refusal, '^' + code + '$')

    def test_plan_read_only_and_apply_preserves_all_history(self):
        before = {str(p): p.read_bytes() for p in self.temp.rglob('*') if p.is_file()}
        result = U.run(self.args)
        self.assertEqual(result['code'], 'PLAN_READY')
        self.assertFalse(self.home.exists())
        self.assertEqual(before, {str(p): p.read_bytes() for p in self.temp.rglob('*') if p.is_file()})
        self.args.yes = True
        result = U.run(self.args)
        self.assertEqual(result['code'], 'UPGRADED')
        state = U.H.read_json(self.state / 'state.json')
        self.assertEqual(state['rounds'], self.old['rounds'])
        self.assertEqual(state['session'], self.old['session'])
        self.assertEqual(state['format'], U.H.FORMAT)
        self.assertEqual(state['lifecycle'], 'open')
        self.assertNotIn('upgrade_pending', state)
        self.assertEqual(state['workflow_identity'], self.manifest['identity'])
        self.assertTrue(Path(state['workflow_bundle']).is_dir())
        lock = U.H.read_json(self.feature / 'workflow.lock.json')
        self.assertEqual(lock['generation'], 2)
        self.assertEqual(lock['history'][0], self.lock['history'][0])
        self.assertEqual(U.run(self.args)['code'], 'ALREADY_UPGRADED')

    def test_replays_each_interruption_without_rewriting_receipts(self):
        # Each commit point is interrupted once in separate disposable state/store snapshots.
        original = U.atomic
        self.args.yes = True
        calls = 0
        def fail_after_pending(path, content):
            nonlocal calls
            original(path, content)
            calls += 1
            if calls == 2:
                raise OSError('simulated power loss after pending state')
        with patch.object(U, 'atomic', side_effect=fail_after_pending):
            with self.assertRaises(OSError):
                U.run(self.args)
        self.assertIn('upgrade_pending', U.H.read_json(self.state / 'state.json'))
        self.assertEqual(U.H.read_json(self.feature / 'workflow.lock.json')['generation'], 1)
        self.assertEqual(U.run(self.args)['code'], 'UPGRADED')
        self.assertEqual(U.H.read_json(self.state / 'state.json')['rounds'], self.old['rounds'])

    def test_journal_and_final_write_crashes_are_replayable(self):
        original = U.atomic
        self.args.yes = True
        for fail_at in (1, 4, 5):
            with self.subTest(write=fail_at):
                self.write(self.state / 'state.json', self.old)
                self.write(self.feature / 'workflow.lock.json', self.lock)
                shutil.rmtree(self.state / 'upgrades', ignore_errors=True)
                count = 0
                def fail(path, content):
                    nonlocal count
                    original(path, content)
                    count += 1
                    if count == fail_at:
                        raise OSError('simulated power loss')
                with patch.object(U, 'atomic', side_effect=fail):
                    with self.assertRaises(OSError):
                        U.run(self.args)
                self.assertIn(U.run(self.args)['code'], ('UPGRADED', 'ALREADY_UPGRADED'))
                self.assertEqual(U.H.read_json(self.state / 'state.json')['rounds'], self.old['rounds'])

    def test_v2_no_rounds_can_upgrade_but_private_state_required(self):
        self.old.update(format=U.H.FORMAT, rounds=[], lifecycle='open', operations=[])
        self.write(self.state / 'state.json', self.old)
        self.assertEqual(U.run(self.args)['code'], 'PLAN_READY')
        self.args.state = str(self.workspace / 'private')
        with self.refusal('STATE_INSIDE_WORKSPACE'):
            U.run(self.args)

    def test_startup_uncertainty_needs_matching_fresh_resume_readiness(self):
        self.write(self.state / 'startup-stop-intent.json', {'at': U.H.now()})
        with self.refusal('STARTUP_REPAIR_PENDING'):
            U.run(self.args)
        self.write(self.state / 'startup-resume-intent.json', {'at': U.H.now()})
        with self.refusal('LIVE_READINESS_BEFORE_RESUME'):
            U.run(self.args)
        self.ready['workflow_readiness']['checked_at'] = U.H.now()
        self.write(self.session_file, self.ready)
        self.assertEqual(U.run(self.args)['code'], 'PLAN_READY')

    def test_interruption_after_lock_replays_without_readiness(self):
        original = U.atomic
        self.args.yes = True
        def fail(path, content):
            original(path, content)
            if path == self.feature / 'workflow.lock.json':
                raise OSError('simulated crash')
        with patch.object(U, 'atomic', side_effect=fail):
            with self.assertRaises(OSError):
                U.run(self.args)
        self.args.session_file = None
        self.assertEqual(U.run(self.args)['code'], 'UPGRADED')

    def test_pending_journal_refuses_drift(self):
        original = U.atomic
        self.args.yes = True
        def fail(path, content):
            original(path, content)
            if path == self.state / 'state.json':
                raise OSError('simulated crash')
        with patch.object(U, 'atomic', side_effect=fail):
            with self.assertRaises(OSError):
                U.run(self.args)
        state = U.H.read_json(self.state / 'state.json')
        state['rounds'].append({'unrelated': True})
        self.write(self.state / 'state.json', state)
        with self.refusal('UPGRADE_REPLAY_DRIFT'):
            U.run(self.args)

    def test_completed_replay_does_not_rewind_subsequent_rounds(self):
        self.args.yes = True
        U.run(self.args)
        state = U.H.read_json(self.state / 'state.json')
        state['rounds'].append({'later': True})
        self.write(self.state / 'state.json', state)
        self.assertEqual(U.run(self.args)['code'], 'ALREADY_UPGRADED')
        self.assertEqual(U.H.read_json(self.state / 'state.json'), state)

    def test_bundle_corruption_and_redirects_fail_before_mutation(self):
        path = self.bundle / 'codex/skills/feature-execute/scripts/hcom_state.py'
        path.write_text('tampered')
        with self.assertRaises(U.H.Refusal):
            U.run(self.args)
        self.assertEqual(U.H.read_json(self.state / 'state.json'), self.old)
        self.assertFalse(self.home.exists())
        path.unlink()
        path.symlink_to(self.state / 'state.json')
        with self.assertRaises(U.H.Refusal):
            U.run(self.args)

    def test_managed_symlink_refused(self):
        saved = self.temp / 'saved-state.json'
        (self.state / 'state.json').rename(saved)
        (self.state / 'state.json').symlink_to(saved)
        with self.refusal('PATH_REDIRECTED'):
            U.run(self.args)

    def test_inflight_and_terminal_states_migrate_without_reopening_or_erasing(self):
        self.args.session_file = None
        self.args.yes = True
        for lifecycle in ('open', 'finishing', 'finished', 'cancelling', 'cancelled'):
            with self.subTest(lifecycle=lifecycle):
                source = dict(self.old, lifecycle=lifecycle,
                              operations=[{'key': 'pending-resume', 'kind': 'resume', 'status': 'intent'}],
                              rounds=[{'contract': {'workflow_identity': self.old['workflow_identity']},
                                       'send_event_id': None, 'receipt': None}])
                self.write(self.state / 'state.json', source)
                self.write(self.feature / 'workflow.lock.json', self.lock)
                shutil.rmtree(self.state / 'upgrades', ignore_errors=True)
                result = U.run(self.args)
                self.assertTrue(result['recovery_required'])
                self.assertFalse(result['launch_authorized'])
                self.assertFalse(result['dispatch_permitted'])
                migrated = U.H.read_json(self.state / 'state.json')
                self.assertEqual(migrated['lifecycle'], lifecycle)
                self.assertEqual(migrated['operations'], source['operations'])
                self.assertEqual(migrated['rounds'], source['rounds'])
                self.assertEqual(migrated['session'], source['session'])

    def test_pending_upgrade_refused_and_optional_snapshot_is_checked(self):
        self.write(self.state / 'state.json', dict(self.old, upgrade_pending='other'))
        with self.refusal('WORKFLOW_UPGRADE_PENDING'):
            U.run(self.args)
        self.write(self.state / 'state.json', self.old)
        self.ready['workflow_readiness']['checked_at'] = '2000-01-01T00:00:00+00:00'
        self.write(self.session_file, self.ready)
        with self.refusal('LIVE_READINESS_STALE'):
            U.run(self.args)
        self.args.session_file = None
        self.assertEqual(U.run(self.args)['code'], 'PLAN_READY')

    def test_generation_identity_and_transport_checks(self):
        self.args.expected_generation = 2
        with self.refusal('GENERATION_CONFLICT'):
            U.run(self.args)
        self.args.expected_generation = 1
        self.old['workflow_identity'] = 'sha256:' + 'b' * 64
        self.write(self.state / 'state.json', self.old)
        with self.refusal('WORKFLOW_IDENTITY_MISMATCH'):
            U.run(self.args)
        self.feature_doc['execution']['transport'] = 'bridge'
        self.write(self.feature / 'feature.json', self.feature_doc)
        with self.refusal('HCOM_TRANSPORT_REQUIRED'):
            U.run(self.args)

    def test_bridge_reference_requires_matching_closed_record(self):
        self.feature_doc['bridge'] = {'feature_id': 'F-1', 'parent_task_id': 'task-1'}
        self.write(self.feature / 'feature.json', self.feature_doc)
        with self.refusal('BRIDGE_FEATURE_STATE_UNKNOWN'):
            U.run(self.args)
        (self.workspace / '.bridge').mkdir()
        database = self.workspace / '.bridge/bridge.db'
        with closing(sqlite3.connect(database)) as db:
            db.execute('CREATE TABLE features(feature_id TEXT PRIMARY KEY,json TEXT)')
            db.execute('INSERT INTO features VALUES (?,?)', ('F-1', json.dumps(
                {'feature_id': 'F-1', 'parent_task_id': 'task-1', 'state': 'executing'})))
            db.commit()
        with self.refusal('BRIDGE_FEATURE_ACTIVE'):
            U.run(self.args)
        with closing(sqlite3.connect(database)) as db:
            db.execute('UPDATE features SET json=?', (json.dumps(
                {'feature_id': 'F-1', 'parent_task_id': 'task-1', 'state': 'cancelled'}),))
            db.commit()
        before = database.read_bytes()
        self.assertEqual(U.run(self.args)['code'], 'PLAN_READY')
        self.assertEqual(database.read_bytes(), before)

    def test_legacy_intents_and_resolution_digests_survive_upgrade(self):
        self.args.session_file = None
        self.args.yes = True
        intents = {}
        for name in ('finish-intent.json', 'startup-stop-intent.json', 'startup-resume-intent.json'):
            self.write(self.state / name, {'at': U.H.now(), 'session': self.old['session']})
            intents[name] = (self.state / name).read_bytes()
        self.old['resolved_intents'] = {'historical-intent.json': {'sha256': 'c' * 64, 'resolution': 'not_applied'}}
        self.old['lifecycle'] = 'finishing'
        self.write(self.state / 'state.json', self.old)
        result = U.run(self.args)
        self.assertTrue(result['recovery_required'])
        migrated = U.H.read_json(self.state / 'state.json')
        self.assertEqual(migrated['resolved_intents'], self.old['resolved_intents'])
        self.assertEqual(migrated['lifecycle'], 'finishing')
        for name, raw in intents.items():
            self.assertEqual((self.state / name).read_bytes(), raw)

    def test_provided_snapshot_must_match_bound_session(self):
        self.ready['session_id'] = 'other-session'
        self.write(self.session_file, self.ready)
        with self.refusal('SESSION_MISMATCH'):
            U.run(self.args)


if __name__ == '__main__':
    unittest.main()
