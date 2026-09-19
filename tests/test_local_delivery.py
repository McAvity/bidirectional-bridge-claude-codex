"""Receipt checks of the local delivery procedure, against real temporary Git repositories.

Source of the procedure: .agents/skills/feature-execute/references/local-delivery.md (§§ 2-6).
`receipt()` below is a test-local transcription of the coordinator's published commands, not a
product helper: the coordinator runs the same `git` commands by hand. Each case builds the
repository state a round could leave behind and asserts what those commands report, so a
wrong base, a hidden out-of-scope change or misattributed dirt cannot pass silently.

Scope globs follow shared/protocol/src/scope.ts (`*`, `**`, `?`), ported here in `glob_re`.
The model side (whether an executor writes the line) is out of reach of these tests (R16-N2);
the transport of the line through the real adapter is covered by
claude/claude-side/src/adapters/claude-code-runner.delivery.test.ts.

Run: python3 -m unittest discover -s tests -p 'test_local_delivery.py' -v
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

EXCHANGE = Path(__file__).resolve().parents[1] / '.agents/skills/feature-exchange/scripts/feature_exchange.py'
FEATURE = 'docs/features/F-demo'
LEDGER_ROOT = f'{FEATURE}/execution/'
SCOPE = ['app/**', f'{FEATURE}/execution/**']
COORDINATOR = [f'{FEATURE}/feature.json', f'{FEATURE}/reviews/**', f'{FEATURE}/decisions/**', 'work-items/**']
DELIVERY = re.compile(r'^DELIVERY=local-v1 BASE=([0-9a-f]{40}) HEAD=([0-9a-f]{40}) LEDGER=(\S+) '
                      r'OUTCOME=(COMPLETE|PARTIAL) WORKTREE=(clean|dirty:(\d+))$')
CLEAN_ENV = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}


def glob_re(glob):
    """Port of globToRegExp in shared/protocol/src/scope.ts."""
    out, i = '', 0
    while i < len(glob):
        ch = glob[i]
        if ch == '*' and glob[i + 1:i + 2] == '*':
            j = i + 2 + (1 if glob[i + 2:i + 3] == '/' else 0)
            out = out[:-1] + '(?:/.*)?' if out.endswith('/') else out + '.*'
            i = j
            continue
        out += '[^/]*' if ch == '*' else '[^/]' if ch == '?' else re.escape(ch)
        i += 1
    return re.compile(f'^{out}$')


def matches(path, globs):
    return any(glob_re(g).match(path) for g in globs)


def git(repo, *args, check=True):
    proc = subprocess.run(['git', '-C', str(repo), *args], capture_output=True, text=True, env=CLEAN_ENV)
    if check and proc.returncode:
        raise AssertionError(f'git {args} failed: {proc.stderr}')
    return proc


def out(repo, *args):
    return git(repo, *args).stdout.strip()


def names(repo, *args):
    return [n for n in out(repo, *args).split('\n') if n]


def status_records(repo):
    """`git status --porcelain=v1 -z --untracked-files=all` → (entry count, {path: XY}).

    One entry per status record (the N of `WORKTREE=dirty:N`); a rename/copy record names two
    paths and both are classified, because the source path changed as well.
    """
    raw = git(repo, 'status', '--porcelain=v1', '-z', '--untracked-files=all').stdout.split('\0')
    entries, count, i = {}, 0, 0
    while i < len(raw) and raw[i]:
        xy, path = raw[i][:2], raw[i][3:]
        entries[path] = xy
        count += 1
        if 'R' in xy or 'C' in xy:
            i += 1
            entries[raw[i]] = xy
        i += 1
    return count, entries


def status(repo):
    return status_records(repo)[1]


def fingerprint(repo, path):
    file = Path(repo) / path
    return out(repo, 'hash-object', '--', path) if file.is_file() else 'deleted'


def start_record(repo):
    """Executor step 3.1: status plus bytes of every dirty path at the start of the round."""
    return {path: fingerprint(repo, path) for path in status(repo)}


def receipt(repo, summary, deliverable_status, contract_base, start=None, allow_merges=False):
    """Coordinator receipt, local-delivery.md § 4. Returns (findings, info)."""
    findings, info = [], {}
    match = DELIVERY.match(summary.split('\n')[0])
    if not match:
        return ['no-delivery'], {'effective': 'PARTIAL'}
    base, head, ledger, outcome, worktree = match.group(1, 2, 3, 4, 5)
    info['effective'] = 'PARTIAL' if 'PARTIAL' in (outcome, deliverable_status) else 'COMPLETE'
    if outcome != deliverable_status:
        findings.append('outcome-mismatch')
    if base != contract_base:
        findings.append('base-mismatch')
    if git(repo, 'rev-parse', '--verify', '--quiet', f'{base}^{{commit}}', check=False).returncode:
        findings.append('base-missing')
    if git(repo, 'cat-file', '-e', f'{head}^{{commit}}', check=False).returncode:
        return findings + ['head-missing'], info
    if 'base-missing' in findings or git(repo, 'merge-base', '--is-ancestor', base, head, check=False).returncode:
        return findings + ['ancestry'], info
    if names(repo, 'rev-list', '--merges', f'{base}..{head}') and not allow_merges:
        findings.append('merge')
    info['commits'] = names(repo, 'log', '--format=%H', f'{base}..{head}')
    endpoint = names(repo, 'diff', '--name-only', base, head)
    touched = names(repo, 'log', '--name-only', '--format=', f'{base}..{head}')
    info['endpoint'] = endpoint
    outside = sorted({p for p in endpoint + touched if not matches(p, SCOPE)})
    if outside:
        findings.append('scope')
        info['outside'] = outside
        info['outside_commits'] = [c for c in info['commits']
                                   if any(not matches(p, SCOPE) for p in names(repo, 'show', '--name-only', '--format=', c))]
    if any(matches(p, COORDINATOR) for p in endpoint + touched):
        findings.append('coordinator-file')
    if ledger == 'none':
        if head != base:
            findings.append('ledger')
    elif ledger not in names(repo, 'diff', '--diff-filter=A', '--name-only', base, head, '--', ledger):
        findings.append('ledger')
    if names(repo, 'diff', '--diff-filter=MD', '--name-only', base, head, '--', LEDGER_ROOT):
        findings.append('ledger-edited')

    count, now = status_records(repo)
    reported = 0 if worktree == 'clean' else int(match.group(6))
    if reported != count:
        findings.append('worktree-mismatch')
    start = start or {}
    classes = {}
    for path in now:
        if path in start:
            same = fingerprint(repo, path) == start[path]
            classes[path] = 'preexisting' if same else 'overlap' if matches(path, SCOPE) else 'foreign'
        else:
            classes[path] = 'own' if matches(path, SCOPE) else 'foreign'
    info['classes'] = classes
    if {'own', 'overlap'} & set(classes.values()) and info['effective'] == 'COMPLETE':
        findings.append('unfinished-own-work')
    if [p for p in start if matches(p, SCOPE) and p in set(endpoint + touched)]:
        findings.append('preexisting-committed')
    return findings, info


def drift(repo, head, tip):
    """§ 5: later integration commits, or proof that the delivered SHA is not integrated."""
    if git(repo, 'merge-base', '--is-ancestor', head, tip, check=False).returncode:
        return 'not-integrated'
    return names(repo, 'log', '--format=%H', f'{head}..{tip}')


class DeliveryCase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='w16-receipt-'))
        self.addCleanup(shutil.rmtree, self.tmp)
        self.repo = r = self.tmp / 'repo'
        for path, text in {
            'app/main.py': 'VALUE = 1\n', 'app/keep.py': 'KEEP = 1\n', 'lib/other.py': 'OTHER = 1\n',
            'docs/features/README.md': '# workflow\n', f'{FEATURE}/brief.md': '# Brief\n',
            f'{FEATURE}/feature.json': json.dumps({'schema_version': 1, 'feature_id': 'F-demo', 'phase': 'execution',
                                                   'tasks': [], 'context_files': [], 'next_action': 'execute'}) + '\n',
            f'{FEATURE}/execution/T-00/01.md': '# earlier ledger\n',
        }.items():
            (r / path).parent.mkdir(parents=True, exist_ok=True)
            (r / path).write_text(text)
        git(self.tmp, 'init', '-q', '-b', 'main', str(r))
        git(r, 'config', 'user.email', 'executor@example.invalid')
        git(r, 'config', 'user.name', 'Executor')
        git(r, 'add', '-A')
        git(r, 'commit', '-qm', 'base')
        self.base = out(r, 'rev-parse', 'HEAD')
        self.ledger = f'{FEATURE}/execution/T-01/01.md'

    def write(self, path, text):
        file = self.repo / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(text)

    def commit(self, files, message='work', remove=(), only_named=True):
        """An executor commit: paths staged by name and committed with the same pathspec.

        `git commit -- <paths>` records only those paths even when someone else's change is
        already staged; a plain `git commit` would sweep that change into the delivery.
        """
        for path, text in files.items():
            self.write(path, text)
        for path in remove:
            git(self.repo, 'rm', '-q', '--', path)
        if files:
            git(self.repo, 'add', '--', *files)
        paths = [*files, *remove]
        git(self.repo, 'commit', '-qm', message, *(['--', *paths] if only_named and paths else []))
        return out(self.repo, 'rev-parse', 'HEAD')

    def deliver(self, files=None, message='deliver', only_named=True):
        return self.commit({'app/main.py': 'VALUE = 2\n', self.ledger: '# ledger\n', **(files or {})}, message,
                           only_named=only_named)

    def line(self, head, outcome='COMPLETE', worktree='clean', base=None, ledger=None):
        return (f'DELIVERY=local-v1 BASE={base or self.base} HEAD={head} LEDGER={ledger or self.ledger} '
                f'OUTCOME={outcome} WORKTREE={worktree}\nprose')


class ParseAndIdentityTests(DeliveryCase):
    def test_a_correct_delivery_passes_every_receipt_check(self):
        head = self.deliver()
        findings, info = receipt(self.repo, self.line(head), 'COMPLETE', self.base)
        self.assertEqual(findings, [])
        self.assertEqual(info['effective'], 'COMPLETE')
        self.assertEqual(info['endpoint'], ['app/main.py', self.ledger])
        self.assertEqual(info['commits'], [head])

    def test_missing_or_malformed_line_is_no_delivery(self):
        head = self.deliver()
        for summary in ('Implemented it.', f'prose\n{self.line(head)}', self.line(head[:12]),
                        self.line(head).replace('OUTCOME=COMPLETE WORKTREE=clean', 'WORKTREE=clean OUTCOME=COMPLETE'),
                        self.line(head).replace('OUTCOME=COMPLETE', 'OUTCOME=DONE')):
            with self.subTest(summary=summary[:40]):
                self.assertEqual(receipt(self.repo, summary, 'COMPLETE', self.base), (['no-delivery'], {'effective': 'PARTIAL'}))

    def test_a_base_other_than_the_contract_base_fails_even_when_it_is_an_ancestor(self):
        middle = self.commit({'app/keep.py': 'KEEP = 2\n'}, 'coordinator-era commit')
        head = self.deliver()
        findings, _ = receipt(self.repo, self.line(head), 'COMPLETE', middle)
        self.assertEqual(findings, ['base-mismatch'])  # executor chose an older base: hides app/keep.py

    def test_an_unknown_base_or_head_fails(self):
        head = self.deliver()
        ghost = 'f' * 40
        self.assertIn('base-missing', receipt(self.repo, self.line(head, base=ghost), 'COMPLETE', ghost)[0])
        self.assertEqual(receipt(self.repo, self.line(ghost), 'COMPLETE', self.base)[0], ['head-missing'])

    def test_a_head_that_does_not_descend_from_the_base_is_an_ancestry_failure(self):
        git(self.repo, 'checkout', '-q', '--orphan', 'elsewhere')
        git(self.repo, 'rm', '-rq', '--cached', '.')
        head = self.commit({'app/main.py': 'VALUE = 9\n'}, 'unrelated history')
        self.assertEqual(receipt(self.repo, self.line(head, worktree=f'dirty:{len(status(self.repo))}'), 'COMPLETE', self.base)[0], ['ancestry'])

    def test_a_merge_in_the_range_is_flagged_unless_the_contract_allows_it(self):
        git(self.repo, 'checkout', '-q', '-b', 'side')
        self.commit({'app/keep.py': 'KEEP = 3\n'}, 'side')
        git(self.repo, 'checkout', '-q', 'main')
        self.deliver()
        git(self.repo, 'merge', '-q', '--no-edit', 'side')
        head = out(self.repo, 'rev-parse', 'HEAD')
        self.assertEqual(receipt(self.repo, self.line(head), 'COMPLETE', self.base)[0], ['merge'])
        self.assertEqual(receipt(self.repo, self.line(head), 'COMPLETE', self.base, allow_merges=True)[0], [])

    def test_a_claimed_partial_without_blocker_is_effectively_partial(self):
        # The adapter stores COMPLETE when checks pass and blocker is null (see the delivery vitest).
        head = self.deliver()
        findings, info = receipt(self.repo, self.line(head, outcome='PARTIAL'), 'COMPLETE', self.base)
        self.assertEqual(findings, ['outcome-mismatch'])
        self.assertEqual(info['effective'], 'PARTIAL')
        self.assertEqual(receipt(self.repo, self.line(head, outcome='PARTIAL'), 'PARTIAL', self.base)[0], [])


class ScopeAndLedgerTests(DeliveryCase):
    def test_an_out_of_scope_path_in_the_final_diff_is_named(self):
        head = self.deliver({'lib/other.py': 'OTHER = 2\n'})
        findings, info = receipt(self.repo, self.line(head), 'COMPLETE', self.base)
        self.assertEqual(findings, ['scope'])
        self.assertEqual(info['outside'], ['lib/other.py'])

    def test_an_added_then_reverted_path_is_caught_only_by_per_commit_names(self):
        self.commit({'lib/secret.py': 'TOKEN = "x"\n'}, 'add outside')
        self.commit({}, 'revert outside', remove=['lib/secret.py'])
        head = self.deliver()
        findings, info = receipt(self.repo, self.line(head), 'COMPLETE', self.base)
        self.assertNotIn('lib/secret.py', info['endpoint'])  # the endpoint diff alone would pass
        self.assertEqual(findings, ['scope'])
        self.assertEqual(info['outside'], ['lib/secret.py'])
        self.assertEqual(len(info['outside_commits']), 2)

    def test_a_foreign_commit_inside_the_range_is_named_not_attributed(self):
        self.deliver()
        git(self.repo, 'config', 'user.name', 'Someone Else')
        foreign = self.commit({'lib/other.py': 'OTHER = 3\n'}, 'another agent')
        git(self.repo, 'config', 'user.name', 'Executor')
        head = self.commit({'app/keep.py': 'KEEP = 4\n'}, 'executor again')
        findings, info = receipt(self.repo, self.line(head), 'COMPLETE', self.base)
        self.assertEqual(findings, ['scope'])
        self.assertEqual(info['outside_commits'], [foreign])  # the evidence for resolving it

    def test_a_coordinator_record_touched_by_the_round_is_flagged(self):
        head = self.deliver({f'{FEATURE}/feature.json': '{}\n'})
        self.assertEqual(receipt(self.repo, self.line(head), 'COMPLETE', self.base)[0], ['scope', 'coordinator-file'])

    def test_a_missing_ledger_or_an_edited_earlier_ledger_is_a_finding(self):
        head = self.commit({'app/main.py': 'VALUE = 5\n'})
        self.assertEqual(receipt(self.repo, self.line(head), 'COMPLETE', self.base)[0], ['ledger'])
        head = self.deliver({f'{FEATURE}/execution/T-00/01.md': '# rewritten history\n'})
        self.assertEqual(receipt(self.repo, self.line(head), 'COMPLETE', self.base)[0], ['ledger-edited'])

    def test_a_ledger_amended_within_the_round_is_still_a_new_ledger(self):
        self.deliver()
        head = self.commit({self.ledger: '# ledger, wording fixed\n'}, 'ledger wording')
        self.assertEqual(receipt(self.repo, self.line(head), 'COMPLETE', self.base)[0], [])

    def test_a_no_code_result_with_only_a_ledger_is_valid(self):
        head = self.commit({self.ledger: '# diagnosis: no change needed\n'}, 'diagnosis')
        findings, info = receipt(self.repo, self.line(head), 'COMPLETE', self.base)
        self.assertEqual((findings, info['endpoint']), ([], [self.ledger]))

    def test_ledger_none_requires_an_unchanged_head(self):
        self.assertEqual(receipt(self.repo, self.line(self.base, ledger='none'), 'COMPLETE', self.base)[0], [])
        head = self.deliver()
        self.assertEqual(receipt(self.repo, self.line(head, ledger='none'), 'COMPLETE', self.base)[0], ['ledger'])


class WorktreeTests(DeliveryCase):
    def test_preexisting_dirt_inside_the_scope_is_separate_and_allows_complete(self):
        self.write('app/keep.py', 'KEEP = "someone else, uncommitted"\n')
        self.write('app/notes.txt', 'untracked by someone else\n')
        start = start_record(self.repo)
        head = self.deliver()
        findings, info = receipt(self.repo, self.line(head, worktree='dirty:2'), 'COMPLETE', self.base, start)
        self.assertEqual(findings, [])
        self.assertEqual(info['classes'], {'app/keep.py': 'preexisting', 'app/notes.txt': 'preexisting'})

    def test_classes_follow_bytes_not_status_letters(self):
        self.write('app/keep.py', 'KEEP = "preexisting"\n')
        start = start_record(self.repo)
        git(self.repo, 'add', '--', 'app/keep.py')  # ' M' becomes 'M ' with the same bytes
        head = self.deliver()  # committed with a pathspec: the staged foreign change stays out
        self.assertEqual(status(self.repo), {'app/keep.py': 'M '})
        findings, info = receipt(self.repo, self.line(head, worktree='dirty:1'), 'COMPLETE', self.base, start)
        self.assertEqual((findings, info['classes']), ([], {'app/keep.py': 'preexisting'}))

    def test_a_plain_commit_sweeps_an_already_staged_foreign_change_into_the_delivery(self):
        self.write('app/keep.py', 'KEEP = "staged by someone else"\n')
        git(self.repo, 'add', '--', 'app/keep.py')
        start = start_record(self.repo)
        head = self.deliver(only_named=False)  # `git add -- <own paths>` then plain `git commit`
        self.assertIn('app/keep.py', names(self.repo, 'diff', '--name-only', self.base, head))
        findings, _ = receipt(self.repo, self.line(head), 'COMPLETE', self.base, start)
        self.assertEqual(findings, ['preexisting-committed'])

    def test_own_untracked_staged_and_deleted_paths_are_unfinished_work(self):
        head = self.deliver()
        self.write('app/untracked.py', 'X = 1\n')
        self.write('app/staged.py', 'Y = 1\n')
        git(self.repo, 'add', '--', 'app/staged.py')
        (self.repo / 'app/keep.py').unlink()          # unstaged deletion ' D'
        git(self.repo, 'rm', '-q', '--cached', '--', 'app/main.py')  # staged deletion 'D ' + untracked
        count, entries = status_records(self.repo)
        # `git rm --cached` leaves two records for one path ('D ' and '??'): N counts records.
        self.assertEqual((count, len(entries)), (5, 4))
        findings, info = receipt(self.repo, self.line(head, worktree=f'dirty:{count}'), 'COMPLETE', self.base, {})
        self.assertEqual(findings, ['unfinished-own-work'])
        self.assertEqual(set(info['classes'].values()), {'own'})
        self.assertEqual(entries['app/keep.py'], ' D')
        self.assertEqual(entries['app/staged.py'], 'A ')
        # Reported as PARTIAL (with a blocker, so the bridge records PARTIAL too) it is honest.
        partial, _ = receipt(self.repo, self.line(head, 'PARTIAL', f'dirty:{count}'), 'PARTIAL', self.base, {})
        self.assertEqual(partial, [])

    def test_changed_bytes_of_a_preexisting_path_are_an_overlap(self):
        self.write('app/keep.py', 'KEEP = "theirs"\n')
        start = start_record(self.repo)
        self.write('app/keep.py', 'KEEP = "theirs and mine"\n')
        head = self.deliver()
        findings, info = receipt(self.repo, self.line(head, worktree='dirty:1'), 'COMPLETE', self.base, start)
        self.assertEqual((findings, info['classes']), (['unfinished-own-work'], {'app/keep.py': 'overlap'}))

    def test_a_preexisting_path_committed_by_the_round_is_flagged(self):
        self.write('app/keep.py', 'KEEP = "not the executor\'s"\n')
        start = start_record(self.repo)
        head = self.deliver({'app/keep.py': 'KEEP = "not the executor\'s"\n'})
        findings, _ = receipt(self.repo, self.line(head), 'COMPLETE', self.base, start)
        self.assertEqual(findings, ['preexisting-committed'])  # foreign bytes may be in the delivery

    def test_new_dirt_outside_the_scope_is_foreign(self):
        head = self.deliver()
        self.write('lib/wip.py', 'W = 1\n')
        findings, info = receipt(self.repo, self.line(head, worktree='dirty:1'), 'COMPLETE', self.base, {})
        self.assertEqual((findings, info['classes']), ([], {'lib/wip.py': 'foreign'}))

    def test_a_misreported_worktree_is_a_finding(self):
        head = self.deliver()
        self.write('app/untracked.py', 'X = 1\n')
        self.assertEqual(receipt(self.repo, self.line(head), 'COMPLETE', self.base, {})[0],
                         ['worktree-mismatch', 'unfinished-own-work'])

    def test_renames_and_spaces_need_nul_separated_status(self):
        head = self.deliver()
        self.write('app/with space.py', 'S = 1\n')
        git(self.repo, 'mv', 'app/keep.py', 'app/kept.py')
        plain = out(self.repo, 'status', '--porcelain=v1', '--untracked-files=all').split('\n')
        self.assertIn('R  app/keep.py -> app/kept.py', plain)  # one line, two paths
        self.assertIn('?? "app/with space.py"', plain)          # quoted
        entries = status(self.repo)
        self.assertEqual(set(entries), {'app/kept.py', 'app/keep.py', 'app/with space.py'})
        self.assertEqual(len(plain), 2)  # N counts status entries (lines), not paths
        findings, _ = receipt(self.repo, self.line(head, worktree='dirty:3'), 'PARTIAL', self.base, {})
        self.assertIn('worktree-mismatch', findings)


class DriftAndExchangeTests(DeliveryCase):
    def test_later_integration_commits_are_drift_not_delivery(self):
        head = self.deliver()
        git(self.repo, 'config', 'user.name', 'Integrator')
        later = self.commit({'lib/other.py': 'OTHER = 4\n'}, 'integration after delivery')
        self.assertNotEqual(out(self.repo, 'rev-parse', 'HEAD'), head)
        self.assertEqual(receipt(self.repo, self.line(head), 'COMPLETE', self.base)[0], [])
        self.assertEqual(drift(self.repo, head, 'HEAD'), [later])
        self.assertEqual(out(self.repo, 'show', f'{head}:app/main.py'), 'VALUE = 2')  # review target

    def test_a_rewritten_integration_branch_reports_the_delivered_sha_as_not_integrated(self):
        head = self.deliver()
        git(self.repo, 'reset', '-q', '--hard', self.base)
        self.commit({'app/main.py': 'VALUE = 7\n'}, 'rewritten')
        self.assertEqual(drift(self.repo, head, 'HEAD'), 'not-integrated')
        self.assertEqual(receipt(self.repo, self.line(head), 'COMPLETE', self.base)[0], [])  # object still reviewable

    def tool(self, *args, check=True):
        env = {**CLEAN_ENV, 'HOME': str(self.tmp / 'home')}
        (self.tmp / 'home' / 'tmp').mkdir(parents=True, exist_ok=True)
        proc = subprocess.run([sys.executable, str(EXCHANGE), *args, '--repo', str(self.repo)],
                              capture_output=True, text=True, env=env)
        if check and proc.returncode:
            self.fail(f'{args[0]} failed: {proc.stderr}')
        return proc

    def test_an_explicit_export_names_the_delivered_head_after_drift(self):
        head = self.deliver()
        self.commit({'lib/other.py': 'OTHER = 5\n'}, 'integration after delivery')
        default = json.loads(self.tool('export', '--feature', FEATURE, '--purpose', 'implementation-review',
                                       '--base', self.base, '--name', 'tip.zip').stdout)
        self.assertNotEqual(default['code_range']['head'], head)  # head defaults to the moved tip
        exported = json.loads(self.tool('export', '--feature', FEATURE, '--purpose', 'implementation-review',
                                        '--base', self.base, '--head', head, '--name', 'delivered.zip').stdout)
        archive = exported['archive']
        self.assertIn(str(self.tmp / 'home' / 'tmp' / 'bridge-exchange'), archive)  # worktree namespace
        report = json.loads(self.tool('verify', '--archive', archive, '--expect-base', self.base,
                                      '--expect-head', head).stdout)
        self.assertEqual((report['integrity'], report['code_range_matches_repository']), ('ok', True))
        with zipfile.ZipFile(archive) as z:
            self.assertNotIn('exchange/code/lib/other.py', z.namelist())
        self.assertNotEqual(self.tool('verify', '--archive', archive, '--expect-head', 'HEAD', check=False).returncode, 0)

    def test_an_explicit_return_is_inspected_without_touching_the_repository(self):
        head = self.deliver()
        archive = json.loads(self.tool('export', '--feature', FEATURE, '--purpose', 'implementation-review',
                                       '--base', self.base, '--head', head, '--name', 'orig.zip').stdout)['archive']
        review = f'{FEATURE}/reviews/01-implementation.md'
        incoming = Path(archive).parent.parent / 'incoming' / 'return.zip'
        incoming.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(archive) as src, zipfile.ZipFile(incoming, 'x') as dst:
            for item in src.infolist():
                dst.writestr(item.filename, src.read(item))
            dst.writestr(review, '# External review\nPASS\n')
        self.tool('inspect-return', '--original', archive, '--incoming', str(incoming), '--stage-name', 'return-01')
        staged = Path(archive).parent.parent / 'staging' / 'return-01'
        report = json.loads((staged / 'return-report.json').read_text())
        self.assertEqual([c['classification'] for c in report['changes']], ['apply'])
        self.assertFalse((self.repo / review).exists())
        self.assertEqual(out(self.repo, 'rev-parse', 'HEAD'), head)


class PublishedProcedureTests(unittest.TestCase):
    """Guard the link between this transcription and the shipped reference: if the reference
    changes a command or the line format, these tests must be revisited. Text presence says
    nothing about whether a model follows it (R16-N2)."""

    def setUp(self):
        self.text = (Path(__file__).resolve().parents[1] /
                     '.agents/skills/feature-execute/references/local-delivery.md').read_text()

    def test_the_documented_line_is_the_one_parsed_here(self):
        documented = re.search(r'```text\n(DELIVERY=[^\n]+)\n```', self.text).group(1)
        self.assertEqual(documented, 'DELIVERY=local-v1 BASE=<40-hex> HEAD=<40-hex> LEDGER=<repo-path|none> '
                                     'OUTCOME=<COMPLETE|PARTIAL> WORKTREE=<clean|dirty:N>')

    def test_the_commands_exercised_here_are_the_published_ones(self):
        for command in ('git status --porcelain=v1 -z --untracked-files=all', 'git hash-object -- <path>',
                        'git commit -m <message> -- <paths>', 'git merge-base --is-ancestor BASE HEAD',
                        'git rev-list --merges BASE..HEAD', 'git diff --name-only BASE HEAD',
                        'git log --name-only --format= BASE..HEAD',
                        'git diff --diff-filter=A --name-only BASE HEAD -- <LEDGER>',
                        'git merge-base --is-ancestor HEAD T'):
            with self.subTest(command=command):
                self.assertIn(command, self.text)


if __name__ == '__main__':
    unittest.main()
