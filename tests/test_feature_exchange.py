"""Contract tests for feature_exchange.py (export, verify, inspect-return).

Run: python3 -m unittest discover -s tests -v
The script under test defaults to this repository; override with FEATURE_EXCHANGE.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

SCRIPT = Path(os.environ.get('FEATURE_EXCHANGE', Path(__file__).resolve().parents[1] /
              '.agents/skills/feature-exchange/scripts/feature_exchange.py'))
FEATURE = 'docs/features/F-001-demo'
TASK = 'work-items/F-001-T01.md'


def git(repo, *args):
    return subprocess.run(['git', '-C', str(repo), *args], check=True, capture_output=True).stdout


class ExchangeCase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='fx-test-'))
        self.addCleanup(shutil.rmtree, self.tmp)
        self.repo = self.tmp / 'repo'
        self.out = self.tmp / 'exchange'
        self.out.mkdir()
        r = self.repo
        (r / FEATURE).mkdir(parents=True)
        (r / 'work-items').mkdir()
        (r / 'src').mkdir()
        (r / 'docs/features/README.md').write_text('# workflow\n')
        (r / FEATURE / 'brief.md').write_text('# Brief\nAC-01 works.\n')
        (r / FEATURE / 'feature.json').write_text(json.dumps({
            'schema_version': 1, 'feature_id': 'F-001-demo', 'phase': 'execution',
            'tasks': [TASK], 'context_files': [], 'next_action': 'execute'}) + '\n')
        (r / TASK).write_text('# T01\nstatus: todo\n')
        (r / 'src/app.py').write_text('VALUE = 1\n')
        git(self.tmp, 'init', '-q', '-b', 'main', str(r))
        git(r, 'config', 'user.email', 't@example.invalid')
        git(r, 'config', 'user.name', 'test')
        git(r, 'add', '-A')
        git(r, 'commit', '-qm', 'base')
        self.base = git(r, 'rev-parse', 'HEAD').decode().strip()
        (r / 'src/app.py').write_text('VALUE = 2\n')
        (r / 'src/new.py').write_text('NEW = True\n')
        (r / FEATURE / 'execution/F-001-T01').mkdir(parents=True)
        (r / FEATURE / 'execution/F-001-T01/01.md').write_text('# Ledger\nOutcome: complete\n')
        git(r, 'add', '-A')
        git(r, 'commit', '-qm', 'round 1')
        self.head = git(r, 'rev-parse', 'HEAD').decode().strip()

    def run_tool(self, *args, check=True):
        proc = subprocess.run([sys.executable, str(SCRIPT), *args, '--repo', str(self.repo)],
                              capture_output=True, text=True)
        if check and proc.returncode != 0:
            self.fail(f'{args[0]} failed: {proc.stderr}')
        return proc

    def export(self, name='r1.zip', purpose='implementation-review', base=True):
        path = self.out / name
        args = ['export', '--feature', FEATURE, '--purpose', purpose, '--output', str(path)]
        if base:
            args += ['--base', self.base]
        self.run_tool(*args)
        return path

    def verify(self, archive, *extra, check=True):
        proc = self.run_tool('verify', '--archive', str(archive), *extra, check=check)
        return proc, (json.loads(proc.stdout) if proc.returncode == 0 else None)

    def rewrite(self, source, target, change):
        with zipfile.ZipFile(source) as z:
            entries = {i.filename: z.read(i) for i in z.infolist()}
        change(entries)
        with zipfile.ZipFile(target, 'x') as z:
            for name, data in entries.items():
                z.writestr(name, data)
        return target


class VerifyTests(ExchangeCase):
    def test_valid_round_package_matches_repository(self):
        archive = self.export()
        _, report = self.verify(archive, '--expect-purpose', 'implementation-review',
                                '--expect-feature', FEATURE)
        self.assertEqual(report['integrity'], 'ok')
        self.assertEqual(report['purpose'], 'implementation-review')
        self.assertEqual(report['code_range']['head'], self.head)
        self.assertIs(report['code_range_matches_repository'], True)
        self.assertEqual(report['documents']['changed'], [])
        self.assertEqual(report['documents']['missing'], [])
        self.assertIn(f'{FEATURE}/execution/F-001-T01/01.md', report['documents']['files'])
        self.assertEqual(len(report['archive_sha256']), 64)

    def test_tampered_document_fails_integrity(self):
        archive = self.export()
        bad = self.rewrite(archive, self.out / 'bad.zip',
                           lambda e: e.__setitem__(f'{FEATURE}/brief.md', b'# Brief\nchanged\n'))
        proc, _ = self.verify(bad, check=False)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn('content mismatch', proc.stderr)

    def test_unlisted_file_fails_integrity(self):
        archive = self.export()
        bad = self.rewrite(archive, self.out / 'extra.zip',
                           lambda e: e.__setitem__(f'{FEATURE}/sneaky.md', b'x\n'))
        proc, _ = self.verify(bad, check=False)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn('does not match manifest', proc.stderr)

    def test_code_diff_not_matching_repository_fails(self):
        archive = self.export()

        def change(entries):
            manifest = json.loads(entries['exchange-manifest.json'])
            forged = b'diff --git a/src/app.py b/src/app.py\n'
            manifest['files']['exchange/code.diff'].update(
                sha256=__import__('hashlib').sha256(forged).hexdigest(), size=len(forged))
            entries['exchange/code.diff'] = forged
            entries['exchange-manifest.json'] = json.dumps(manifest).encode()
        bad = self.rewrite(archive, self.out / 'forged.zip', change)
        proc, _ = self.verify(bad, check=False)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn('code.diff', proc.stderr)

    def test_expectation_mismatch_fails(self):
        archive = self.export()
        proc, _ = self.verify(archive, '--expect-purpose', 'plan-review', check=False)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn('purpose', proc.stderr)
        proc, _ = self.verify(archive, '--expect-head', self.base, check=False)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn('head', proc.stderr)

    def test_later_document_edits_are_reported_not_hidden(self):
        archive = self.export()
        (self.repo / FEATURE / 'brief.md').write_text('# Brief\nedited later\n')
        _, report = self.verify(archive)
        self.assertEqual(report['integrity'], 'ok')
        self.assertEqual(report['documents']['changed'], [f'{FEATURE}/brief.md'])

    def test_document_only_package_has_no_code_range(self):
        archive = self.export(name='plan.zip', purpose='plan-review', base=False)
        _, report = self.verify(archive)
        self.assertIsNone(report['code_range'])
        self.assertIsNone(report['code_range_matches_repository'])


class VerifyHardeningTests(ExchangeCase):
    def forge(self, archive, name, change):
        """Rewrite an archive, keeping the manifest consistent with the changed entries."""
        import hashlib

        def apply(entries):
            manifest = json.loads(entries['exchange-manifest.json'])
            change(entries, manifest)
            for path, rec in manifest['files'].items():
                rec.update(sha256=hashlib.sha256(entries[path]).hexdigest(), size=len(entries[path]))
            entries['exchange-manifest.json'] = json.dumps(manifest).encode()
        return self.rewrite(archive, self.out / name, apply)

    def test_expected_head_and_base_accept_the_round(self):
        archive = self.export()
        _, report = self.verify(archive, '--expect-head', 'HEAD', '--expect-base', self.base)
        self.assertEqual(report['code_range']['base'], self.base)
        self.assertEqual(report['code_changes'], 3)

    def test_expected_base_mismatch_fails(self):
        archive = self.export()
        proc, _ = self.verify(archive, '--expect-base', self.head, check=False)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn('base', proc.stderr)

    def test_empty_range_is_reported(self):
        path = self.out / 'empty.zip'
        self.run_tool('export', '--feature', FEATURE, '--purpose', 'implementation-review',
                      '--output', str(path), '--base', self.head)
        _, report = self.verify(path, '--expect-head', 'HEAD')
        self.assertEqual(report['code_changes'], 0)

    def test_tampered_code_snapshot_fails(self):
        archive = self.export()
        bad = self.forge(archive, 'snap.zip',
                         lambda e, m: e.__setitem__('exchange/code/src/app.py', b'VALUE = 99\n'))
        proc, _ = self.verify(bad, check=False)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn('snapshot', proc.stderr)

    def test_code_change_list_must_match_repository(self):
        archive = self.export()

        def strip(entries, manifest):
            manifest['code_changes'] = []
            for name in [n for n in entries if n.startswith('exchange/code/')]:
                del entries[name]
                del manifest['files'][name]
        proc, _ = self.verify(self.forge(archive, 'strip.zip', strip), check=False)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn('code_changes', proc.stderr)

    def test_unknown_or_malformed_commits_fail(self):
        archive = self.export()
        missing = self.forge(archive, 'missing.zip',
                             lambda e, m: m['code_range'].update(base='0' * 40))
        proc, _ = self.verify(missing, check=False)
        self.assertIn('absent', proc.stderr)
        malformed = self.forge(archive, 'malformed.zip',
                               lambda e, m: m['code_range'].update(base='--output=/tmp/x'))
        proc, _ = self.verify(malformed, check=False)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn('commit id', proc.stderr)

    def test_document_package_with_expected_head_fails(self):
        archive = self.export(name='docs.zip', purpose='plan-review', base=False)
        proc, _ = self.verify(archive, '--expect-head', 'HEAD', check=False)
        self.assertNotEqual(proc.returncode, 0)

    def test_missing_document_is_reported(self):
        archive = self.export()
        (self.repo / TASK).unlink()
        _, report = self.verify(archive)
        self.assertEqual(report['documents']['missing'], [TASK])

    def test_malformed_manifest_is_a_clean_error(self):
        archive = self.export()
        bad = self.rewrite(archive, self.out / 'list.zip',
                           lambda e: e.__setitem__('exchange-manifest.json', b'[]'))
        proc, _ = self.verify(bad, check=False)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn('feature-exchange:', proc.stderr)
        self.assertNotIn('Traceback', proc.stderr)


class ExistingContractTests(ExchangeCase):
    def test_inspect_return_rejects_changed_manifest(self):
        archive = self.export(name='orig2.zip', purpose='plan-review', base=False)
        incoming = self.rewrite(archive, self.out / 'return2.zip',
                                lambda e: e.__setitem__('exchange-manifest.json', b'{}'))
        proc = self.run_tool('inspect-return', '--original', str(archive), '--incoming',
                             str(incoming), '--staging', str(self.tmp / 'st2'), check=False)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn('preserve original manifest', proc.stderr)

    def test_export_rejects_output_inside_feature(self):
        proc = self.run_tool('export', '--feature', FEATURE, '--purpose', 'plan-review',
                             '--output', str(self.repo / FEATURE / 'x.zip'), check=False)
        self.assertNotEqual(proc.returncode, 0)

    def test_inspect_return_stages_changed_documents_without_touching_repo(self):
        archive = self.export(name='orig.zip', purpose='plan-review', base=False)
        review = f'{FEATURE}/reviews/01-plan.md'
        incoming = self.rewrite(archive, self.out / 'return.zip',
                                lambda e: e.__setitem__(review, b'# Review\nPASS\n'))
        staging = self.tmp / 'staging'
        self.run_tool('inspect-return', '--original', str(archive), '--incoming', str(incoming),
                      '--staging', str(staging))
        report = json.loads((staging / 'return-report.json').read_text())
        self.assertEqual([c['classification'] for c in report['changes']], ['apply'])
        self.assertFalse((self.repo / review).exists())


if __name__ == '__main__':
    unittest.main()
