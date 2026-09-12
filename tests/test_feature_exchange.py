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


class NamespaceCase(unittest.TestCase):
    """Deterministic per-worktree exchange namespace (R13-01).

    Two worktrees of one repository may legitimately use the same feature, purpose and round
    name. The namespace keeps their packages and staging apart; it is collision isolation, not
    an authorization boundary. Explicit --output/--staging stay literal for backward
    compatibility.
    """

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='fx-ns-'))
        self.addCleanup(shutil.rmtree, self.tmp)
        self.home = self.tmp / 'home'
        (self.home / 'tmp').mkdir(parents=True)
        self.main = self.tmp / 'main'
        self.second = self.tmp / 'second'
        self._make_repo(self.main)
        git(self.main, 'worktree', 'add', '-q', '-b', 'other', str(self.second))
        # The second worktree gets its own round of work, so the ranges differ.
        (self.second / 'src/app.py').write_text('VALUE = 99\n')
        git(self.second, 'add', '-A')
        git(self.second, 'commit', '-qm', 'second worktree round')

    def _make_repo(self, repo):
        (repo / FEATURE).mkdir(parents=True)
        (repo / 'work-items').mkdir()
        (repo / 'src').mkdir()
        (repo / 'docs/features/README.md').write_text('# workflow\n')
        (repo / FEATURE / 'brief.md').write_text('# Brief\nAC-01 works.\n')
        (repo / FEATURE / 'feature.json').write_text(json.dumps({
            'schema_version': 1, 'feature_id': 'F-001-demo', 'phase': 'execution',
            'tasks': [TASK], 'context_files': [], 'next_action': 'execute'}) + '\n')
        (repo / TASK).write_text('# T01\nstatus: todo\n')
        (repo / 'src/app.py').write_text('VALUE = 1\n')
        git(self.tmp, 'init', '-q', '-b', 'main', str(repo))
        git(repo, 'config', 'user.email', 't@example.invalid')
        git(repo, 'config', 'user.name', 'test')
        git(repo, 'add', '-A')
        git(repo, 'commit', '-qm', 'base')
        self.base = git(repo, 'rev-parse', 'HEAD').decode().strip()
        (repo / 'src/app.py').write_text('VALUE = 2\n')
        git(repo, 'add', '-A')
        git(repo, 'commit', '-qm', 'round 1')

    def tool(self, repo, *args, check=True, cwd=None, extra_env=None, home=None):
        env = {**os.environ, 'HOME': str(home or self.home)}
        env.update(extra_env or {})
        proc = subprocess.run([sys.executable, str(SCRIPT), *args, '--repo', str(repo)],
                              capture_output=True, text=True, env=env, cwd=str(cwd) if cwd else None)
        if check and proc.returncode != 0:
            self.fail(f'{args[0]} in {repo} failed: {proc.stderr}')
        return proc

    def namespace(self, repo):
        return json.loads(self.tool(repo, 'namespace').stdout)

    def head(self, repo):
        return git(repo, 'rev-parse', 'HEAD').decode().strip()

    def test_key_is_stable_canonical_and_worktree_specific(self):
        main_ns = self.namespace(self.main)
        second_ns = self.namespace(self.second)
        self.assertNotEqual(main_ns['workspace_key'], second_ns['workspace_key'])
        self.assertTrue(main_ns['workspace_key'].startswith('ws_'))
        self.assertEqual(len(main_ns['workspace_key']), 19)

        # A subdirectory and a symlinked alias resolve to the same namespace.
        self.assertEqual(self.namespace(self.main / 'src')['workspace_key'], main_ns['workspace_key'])
        alias = self.tmp / 'alias'
        alias.symlink_to(self.main)
        self.assertEqual(self.namespace(alias)['workspace_key'], main_ns['workspace_key'])

        # The branch is not part of the identity.
        git(self.main, 'checkout', '-q', '-b', 'renamed')
        self.assertEqual(self.namespace(self.main)['workspace_key'], main_ns['workspace_key'])
        git(self.main, 'checkout', '-q', '--detach')
        self.assertEqual(self.namespace(self.main)['workspace_key'], main_ns['workspace_key'])

        # Selection is read-only: nothing was created on disk.
        self.assertFalse(Path(main_ns['namespace']).exists())

    def test_identical_names_from_two_worktrees_coexist_and_verify_own_range(self):
        name = 'F-001-demo-implementation-review-round-1.zip'
        args = ['export', '--feature', FEATURE, '--purpose', 'implementation-review',
                '--name', name, '--base', self.base]
        first = json.loads(self.tool(self.main, *args).stdout)
        second = json.loads(self.tool(self.second, *args).stdout)

        # Same file name, different namespace directories: both survive.
        self.assertEqual(Path(first['archive']).name, Path(second['archive']).name)
        self.assertNotEqual(first['archive'], second['archive'])
        for archive in (first['archive'], second['archive']):
            self.assertTrue(Path(archive).exists())
        self.assertEqual(Path(first['archive']).parent.parent,
                         Path(self.namespace(self.main)['namespace']))

        # Each package verifies against its own worktree and range, and not against the other.
        for repo, archive in ((self.main, first['archive']), (self.second, second['archive'])):
            ok = self.tool(repo, 'verify', '--archive', archive,
                           '--expect-feature', FEATURE,
                           '--expect-purpose', 'implementation-review',
                           '--expect-base', self.base, '--expect-head', self.head(repo))
            report = json.loads(ok.stdout)
            self.assertEqual(report['code_range']['head'], self.head(repo))
            self.assertTrue(report['code_range_matches_repository'])

        crossed = self.tool(self.main, 'verify', '--archive', second['archive'],
                            '--expect-head', self.head(self.main), check=False)
        self.assertNotEqual(crossed.returncode, 0)

    def test_namespace_target_is_not_overwritten(self):
        args = ['export', '--feature', FEATURE, '--purpose', 'corrections-review',
                '--name', 'same.zip', '--base', self.base]
        self.tool(self.main, *args)
        again = self.tool(self.main, *args, check=False)
        self.assertNotEqual(again.returncode, 0)

    def test_same_staging_name_stays_separate_per_worktree(self):
        exports = {}
        for repo in (self.main, self.second):
            out = json.loads(self.tool(repo, 'export', '--feature', FEATURE, '--purpose', 'decision',
                                       '--name', 'shared-name.zip', '--base', self.base).stdout)
            exports[repo] = out['archive']

        staged = []
        for repo in (self.main, self.second):
            report = json.loads(self.tool(repo, 'inspect-return', '--original', exports[repo],
                                          '--incoming', exports[repo],
                                          '--stage-name', 'return-1').stdout)
            staged.append(report['staging'])
        self.assertEqual(len({Path(p).name for p in staged}), 1)
        self.assertEqual(len(set(staged)), 2)
        for repo in (self.main, self.second):
            self.assertFalse((repo / '.bridge').exists())
            self.assertEqual(git(repo, 'status', '--porcelain').decode().strip(), '')

    def test_explicit_output_and_staging_paths_stay_literal(self):
        explicit = self.tmp / 'custom' / 'explicit.zip'
        out = json.loads(self.tool(self.main, 'export', '--feature', FEATURE, '--purpose', 'decision',
                                   '--output', str(explicit), '--base', self.base).stdout)
        self.assertEqual(Path(out['archive']), explicit.resolve())
        self.assertFalse(Path(self.namespace(self.main)['packages'], 'explicit.zip').exists())

        stage = self.tmp / 'custom-stage'
        report = json.loads(self.tool(self.main, 'inspect-return', '--original', str(explicit),
                                      '--incoming', str(explicit), '--staging', str(stage)).stdout)
        self.assertEqual(Path(report['staging']), stage.resolve())

    def test_output_and_name_are_mutually_exclusive(self):
        both = self.tool(self.main, 'export', '--feature', FEATURE, '--purpose', 'decision',
                         '--output', str(self.tmp / 'a.zip'), '--name', 'a.zip',
                         '--base', self.base, check=False)
        self.assertNotEqual(both.returncode, 0)
        neither = self.tool(self.main, 'export', '--feature', FEATURE, '--purpose', 'decision',
                            '--base', self.base, check=False)
        self.assertNotEqual(neither.returncode, 0)


    def test_repo_selection_survives_a_polluted_git_environment(self):
        """cwd A, --repo B and inherited Git overrides pointing at A: B must win.

        Inherited GIT_DIR/GIT_WORK_TREE redirect repository selection for every `git` child,
        so without sanitising them `--repo` would resolve the wrong worktree — choosing the
        wrong export source, not merely the wrong output directory.
        """
        clean_main = self.namespace(self.main)['workspace_key']
        clean_second = self.namespace(self.second)['workspace_key']
        self.assertNotEqual(clean_main, clean_second)

        polluted = {
            'GIT_DIR': str(self.main / '.git'),
            'GIT_WORK_TREE': str(self.main),
            'GIT_INDEX_FILE': str(self.main / '.git' / 'index'),
            'GIT_OBJECT_DIRECTORY': str(self.main / '.git' / 'objects'),
        }
        # Run from worktree A while asking for worktree B.
        key = json.loads(self.tool(self.second, 'namespace', cwd=self.main, extra_env=polluted).stdout)
        self.assertEqual(key['workspace_key'], clean_second)
        self.assertEqual(Path(key['root']), self.second.resolve())

        out = json.loads(self.tool(self.second, 'export', '--feature', FEATURE,
                                   '--purpose', 'corrections-review', '--name', 'polluted.zip',
                                   '--base', self.base, cwd=self.main, extra_env=polluted).stdout)
        self.assertEqual(Path(out['archive']).parent,
                         Path(self.namespace(self.second)['packages']))
        self.assertEqual(out['code_range']['head'], self.head(self.second))

        # The archive really carries B's content, not A's.
        with zipfile.ZipFile(out['archive']) as z:
            self.assertIn('VALUE = 99', z.read('exchange/code/src/app.py').decode())

        # Verification also resolves B under the same pollution, and independently when clean.
        for env in (polluted, None):
            report = json.loads(self.tool(self.second, 'verify', '--archive', out['archive'],
                                          '--expect-feature', FEATURE,
                                          '--expect-purpose', 'corrections-review',
                                          '--expect-base', self.base,
                                          '--expect-head', self.head(self.second),
                                          cwd=self.main, extra_env=env).stdout)
            self.assertTrue(report['code_range_matches_repository'])

    def test_namespace_inside_the_repository_is_refused(self):
        """A namespace that would land inside the repository fails instead of polluting it."""
        home_in_repo = self.main / 'nested-home'
        (home_in_repo / 'tmp').mkdir(parents=True)
        proc = self.tool(self.main, 'export', '--feature', FEATURE, '--purpose', 'decision',
                         '--name', 'inside.zip', '--base', self.base,
                         home=home_in_repo, check=False)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn('outside', proc.stderr)

    def test_explicit_staging_inside_the_repository_is_still_refused(self):
        """The pre-existing guard on --staging is unchanged by the namespace work."""
        archive = json.loads(self.tool(self.main, 'export', '--feature', FEATURE, '--purpose', 'decision',
                                       '--name', 'guard.zip', '--base', self.base).stdout)['archive']
        proc = self.tool(self.main, 'inspect-return', '--original', archive, '--incoming', archive,
                         '--staging', str(self.main / 'inside-staging'), check=False)
        self.assertNotEqual(proc.returncode, 0)
        self.assertFalse((self.main / 'inside-staging').exists())

    def test_changed_return_documents_stage_separately_per_worktree(self):
        """A real returned edit is staged in each namespace without touching either repo."""
        staged = {}
        for repo in (self.main, self.second):
            original = json.loads(self.tool(repo, 'export', '--feature', FEATURE, '--purpose', 'plan-review',
                                            '--name', 'review.zip', '--base', self.base).stdout)['archive']
            returned = Path(original).with_name('review-returned.zip')
            with zipfile.ZipFile(original) as z:
                entries = {i.filename: z.read(i) for i in z.infolist()}
            note = f'# Review\nWorktree {repo.name} said so.\n'.encode()
            entries[f'{FEATURE}/reviews/01-plan.md'] = note
            with zipfile.ZipFile(returned, 'x') as z:
                for name, data in entries.items():
                    z.writestr(name, data)
            report = json.loads(self.tool(repo, 'inspect-return', '--original', original,
                                          '--incoming', str(returned),
                                          '--stage-name', 'return-review').stdout)
            self.assertEqual(report['changes'], 1)
            staged[repo] = Path(report['staging'])
            self.assertEqual((staged[repo] / FEATURE / 'reviews/01-plan.md').read_bytes(), note)
            # Nothing was applied to the repository itself.
            self.assertFalse((repo / FEATURE / 'reviews/01-plan.md').exists())
            self.assertEqual(git(repo, 'status', '--porcelain').decode().strip(), '')

        self.assertNotEqual(staged[self.main], staged[self.second])
        self.assertEqual(staged[self.main].name, staged[self.second].name)


if __name__ == '__main__':
    unittest.main()
