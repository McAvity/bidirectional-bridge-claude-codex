"""The shipped read-only multi-repo helper, driven through its CLI against real temporary repositories.

Helper: .agents/skills/feature-execute/scripts/multi_repo.py (W20-02). Procedure:
.agents/skills/feature-execute/references/multi-repo.md. Contract:
docs/features/F-W20-multi-repo-execution/contracts/01-multi-repo.md.

Every repository is a disposable fixture in a fresh temporary directory; the fixture code prepares
checkouts with ordinary Git, as the procedure tells an agent to, and only then asks the helper.
These tests prove the helper's checks and its read-only behaviour, not that a model follows the
procedure. The W20-01 prototype probes stay in tests/test_multi_repo_contract.py.

Run: python3 -m unittest discover -s tests -p 'test_multi_repo.py' -v
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
HELPER = REPO_ROOT / '.agents/skills/feature-execute/scripts/multi_repo.py'
FEATURE, TASK = 'F-X', 'W-01'
TASK_DIR = f'.feature-repos/{FEATURE}'
LEDGER_DIR = f'docs/features/{FEATURE}/execution/{TASK}/'
LEDGER = LEDGER_DIR + '01.md'
SIDECAR = LEDGER_DIR + '01.repos.json'
PARENT_SCOPE = ['app/**', 'deps/sub', f'docs/features/{FEATURE}/execution/**']

ENV = None


def clean_env(home):
    env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
    env.update(HOME=str(home), GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull,
               GIT_AUTHOR_NAME='Probe', GIT_AUTHOR_EMAIL='probe@example.invalid',
               GIT_COMMITTER_NAME='Probe', GIT_COMMITTER_EMAIL='probe@example.invalid')
    return env


def git(repo, *args, check=True):
    p = subprocess.run(['git', '-c', 'init.defaultBranch=main', '-c', 'protocol.file.allow=always',
                        '-C', str(repo), *args], capture_output=True, text=True, env=ENV)
    if check and p.returncode:
        raise AssertionError(f'git {args} failed: {p.stderr}')
    return p


def out(repo, *args):
    return git(repo, *args).stdout.strip()


def write(path, text):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def commit(repo, files, message='change'):
    for rel, text in files.items():
        write(Path(repo) / rel, text)
    git(repo, 'add', '--', *files)
    git(repo, 'commit', '-q', '-m', message, '--', *files)
    return out(repo, 'rev-parse', 'HEAD')


def helper(*args, stdin=None, env=None):
    p = subprocess.run([sys.executable, '-I', str(HELPER), *args], capture_output=True, text=True,
                       env=env or ENV, input=stdin)
    try:
        data = json.loads(p.stdout)
    except ValueError:
        raise AssertionError(f'helper printed non-JSON (exit {p.returncode}): {p.stdout!r} {p.stderr!r}')
    return p.returncode, data


def snapshot(root):
    """Every file under root (repositories and their .git directories included) with bytes and mtime."""
    snap = {}
    for dirpath, dirnames, filenames in os.walk(root):
        for name in filenames + [d for d in dirnames if os.path.islink(os.path.join(dirpath, d))]:
            p = os.path.join(dirpath, name)
            st = os.lstat(p)
            data = os.readlink(p).encode() if os.path.islink(p) else open(p, 'rb').read()
            snap[os.path.relpath(p, root)] = (st.st_mtime_ns, hashlib.sha256(data).hexdigest())
    return snap


class World(unittest.TestCase):
    """Parent linked worktree + two child sources + one shared read-only dependency."""

    def setUp(self):
        global ENV
        self.root = Path(os.path.realpath(tempfile.mkdtemp(prefix='w20-helper-')))
        (self.root / 'home').mkdir()
        ENV = clean_env(self.root / 'home')
        self.work = self.root / 'work'  # contracts, records and summaries live outside every repo
        self.work.mkdir()
        self.src = {}
        for rid in ('child-a', 'child-b'):
            repo = self.root / 'sources' / rid
            repo.mkdir(parents=True)
            git(repo, 'init', '-q')
            commit(repo, {'src/main.txt': f'{rid}\n'}, f'{rid} base')
            self.src[rid] = repo
        self.dep = self.root / 'shared' / 'dep'
        self.dep.mkdir(parents=True)
        git(self.dep, 'init', '-q')
        commit(self.dep, {'.gitignore': 'dist/\n', 'lib.txt': 'dep\n'}, 'dep base')
        self.main = self.root / 'main'
        self.main.mkdir()
        git(self.main, 'init', '-q')
        commit(self.main, {'app/x.txt': 'x\n', 'docs/features/F-X/brief.md': 'brief\n'}, 'parent base')
        self.parent = self.root / 'wt-parent'
        git(self.main, 'worktree', 'add', '-q', '-b', 'design/x', str(self.parent))

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    # --- procedure steps an agent performs with ordinary Git --------------------------------

    def exclude(self):
        rel = out(self.parent, 'rev-parse', '--git-path', 'info/exclude')
        path = Path(rel) if os.path.isabs(rel) else self.parent / rel
        text = path.read_text() if path.exists() else ''
        if f'/{TASK_DIR}/' not in text.splitlines():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text + ('' if not text or text.endswith('\n') else '\n') + f'/{TASK_DIR}/\n')

    def worktree(self, rid, source, branch='design/x', base='HEAD'):
        alias = f'{TASK_DIR}/{rid}'
        (self.parent / TASK_DIR).mkdir(parents=True, exist_ok=True)
        git(source, 'worktree', 'add', '-q', '-b', branch, str(self.parent / alias), base)
        return alias

    def entry(self, rid, alias, role='write', kind='worktree', branch='design/x', **extra):
        path = self.parent / alias
        e = {'role': role, 'kind': kind, 'alias': alias, 'realpath': os.path.realpath(path),
             'base': out(path, 'rev-parse', 'HEAD')}
        if role == 'write':
            e.update(branch=branch, target='main', scope=[f'{alias}/src/**'], baseline={},
                     git_dir=os.path.realpath(out(path, 'rev-parse', '--absolute-git-dir')))
        e.update(extra)
        return e

    def contract(self, repos, **parent):
        c = {'schema': 'multi-repo-contract-v1', 'feature': FEATURE, 'task': TASK,
             'parent': {'root': str(self.parent), 'base': out(self.parent, 'rev-parse', 'HEAD'),
                        'scope': PARENT_SCOPE, 'ledger_dir': LEDGER_DIR, **parent},
             'repos': repos}
        return c

    def save(self, name, obj):
        path = self.work / name
        path.write_text(json.dumps(obj, indent=1))
        return str(path)

    def standard(self):
        """Prepared environment: two physical child worktrees, the shared dependency via alias."""
        self.exclude()
        repos = {r: self.entry(r, self.worktree(r, self.src[r])) for r in self.src}
        os.symlink(self.dep, self.parent / TASK_DIR / 'dep')
        rc, d = helper('digest', '--repo', str(self.dep))
        self.assertEqual(rc, 0, d)
        repos['dep'] = self.entry('dep', f'{TASK_DIR}/dep', role='read', kind='existing', digest=d['digest'])
        return self.contract(repos)


class ContractAndManifestValidation(World):
    def test_well_formed_contract_preflights(self):
        rc, res = helper('preflight', '--contract', self.save('c.json', self.standard()))
        self.assertEqual(rc, 0, res)
        self.assertTrue(res['ok'])
        self.assertEqual(sorted(res['repos']), ['child-a', 'child-b', 'dep'])

    def test_malformed_contracts_are_input_errors(self):
        c = self.standard()
        bad = {
            'not json': None,
            'absolute alias': ('child-a', 'alias', '/abs/child'),
            'dotdot alias': ('child-a', 'alias', '../child'),
            'scope outside alias': ('child-a', 'scope', ['app/**']),
            'scope wrong type': ('child-a', 'scope', 'src/**'),
            'relative realpath': ('child-a', 'realpath', 'rel/path'),
            'short sha': ('child-a', 'base', 'abc123'),
            'unknown key': ('child-a', 'command', 'rm -rf /'),
            'bad role': ('child-a', 'role', 'admin'),
            'gitlink on worktree': ('child-a', 'gitlink', 'deps/sub'),
            'baseline wrong type': ('child-a', 'baseline', ['x']),
            'binding escapes': ('child-a', 'bindings', ['../../etc']),
            'read digest short': ('dep', 'digest', 'abc'),
            'external flag not bool': ('child-a', 'external_access_verified', 'yes'),
        }
        for name, change in bad.items():
            with self.subTest(name):
                if change is None:
                    path = self.work / 'bad.json'
                    path.write_text('{not json')
                    rc, res = helper('preflight', '--contract', str(path))
                else:
                    cc = json.loads(json.dumps(c))
                    cc['repos'][change[0]][change[1]] = change[2]
                    rc, res = helper('preflight', '--contract', self.save('bad.json', cc))
                self.assertEqual(rc, 2, res)
                self.assertIn('error', res)
        for name, mutate in {
            'schema': lambda x: x.update(schema='v0'),
            'repos list': lambda x: x.update(repos=[]),
            'parent base': lambda x: x['parent'].update(base='HEAD'),
            'ledger dir': lambda x: x['parent'].update(ledger_dir='docs/x'),
            'package type': lambda x: x['parent'].update(package='yes'),
            'repo id': lambda x: x['repos'].update({'Bad ID': x['repos']['dep']}),
        }.items():
            with self.subTest(name):
                cc = json.loads(json.dumps(c))
                mutate(cc)
                self.assertEqual(helper('preflight', '--contract', self.save('bad.json', cc))[0], 2)
        big = self.work / 'big.json'
        big.write_text('{"x": "' + 'a' * 70000 + '"}')
        self.assertEqual(helper('preflight', '--contract', str(big))[0], 2)

    def manifest(self, **change):
        m = {'schema': 'multi-repo-v1', 'feature': FEATURE, 'task': TASK,
             'parent': {'base': 'c' * 40, 'scope': PARENT_SCOPE},
             'repos': [{'id': 'child-a', 'role': 'write', 'kind': 'worktree', 'alias': f'{TASK_DIR}/child-a',
                        'branch': 'design/x', 'target': 'main', 'base': 'a' * 40, 'head': 'b' * 40,
                        'scope': [f'{TASK_DIR}/child-a/src/**'], 'source': {'locator': 'example/a'},
                        'dirt': {'baseline': [], 'final': []}}]}
        for k, v in change.items():
            if k.startswith('repo_'):
                m['repos'][0][k[5:]] = v
            else:
                m[k] = v
        return m

    def check_manifest(self, m, raw=None):
        path = self.work / 'm.json'
        path.write_bytes(raw if raw is not None else json.dumps(m).encode())
        return helper('manifest', '--file', str(path))

    def test_manifest_validation(self):
        rc, res = self.check_manifest(self.manifest())
        self.assertEqual((rc, res['valid']), (0, True), res)
        bad = {
            'parent head (self-hash cycle)': self.manifest(parent={'base': 'c' * 40, 'scope': PARENT_SCOPE, 'head': 'd' * 40}),
            'repos not a list': self.manifest(repos={'child-a': {}}),
            'repo not an object': self.manifest(repos=['child-a']),
            'absolute alias': self.manifest(repo_alias='/home/u/child'),
            'scope not list': self.manifest(repo_scope='src/**'),
            'dirt class': self.manifest(repo_dirt={'final': [{'path': 'x', 'class': 'mine'}]}),
            'dirt path type': self.manifest(repo_dirt={'final': [{'path': 7}]}),
            'absolute locator': self.manifest(repo_source={'locator': '/srv/git/a'}),
            'read with scope': self.manifest(repo_role='read', repo_head='a' * 40, repo_digest='e' * 64),
            'tested set mismatch': self.manifest(integration={'tested_set': {'child-a': 'f' * 40}}),
            'checks not strings': self.manifest(integration={'tested_set': {'child-a': 'b' * 40}, 'checks': [{'run': 'x'}]}),
            'host path anywhere': self.manifest(repo_source={'locator': 'example/a', 'roots': ['/tmp/x']}),
            'unknown top key': self.manifest(extra=1),
        }
        for name, m in bad.items():
            with self.subTest(name):
                rc, res = self.check_manifest(m)
                self.assertEqual((rc, res['valid']), (1, False), res)
        self.assertEqual(self.check_manifest(None, raw=b'\xff\xfe')[0], 1)
        self.assertEqual(self.check_manifest(None, raw=b'{' + b' ' * 70000 + b'}')[0], 1)


class IdentityAndPreflight(World):
    def test_identity_ignores_inherited_git_selection(self):
        c = self.standard()
        env = dict(ENV, GIT_DIR=str(self.main / '.git'), GIT_WORK_TREE=str(self.main))
        rc, f = helper('identity', '--parent', str(self.parent), '--alias', f'{TASK_DIR}/child-a', env=env)
        self.assertEqual(rc, 0, f)
        self.assertEqual(f['realpath'], c['repos']['child-a']['realpath'])
        self.assertEqual(f['common_dir'], os.path.realpath(self.src['child-a'] / '.git'))
        self.assertTrue(f['inside_parent'] and f['checkout_root'])

    def test_plain_directory_is_not_a_repository(self):
        write(self.parent / 'app' / 'pkg' / 'a.txt', 'a\n')
        rc, f = helper('identity', '--parent', str(self.parent), '--alias', 'app/pkg')
        self.assertEqual(rc, 1)
        self.assertFalse(f['checkout_root'])

    def test_unignored_child_blocks(self):
        alias = self.worktree('child-a', self.src['child-a'])  # no info/exclude entry
        rc, res = helper('preflight', '--contract', self.save('c.json', self.contract({'child-a': self.entry('child-a', alias)})))
        self.assertEqual(rc, 1)
        self.assertIn('not ignored', ' '.join(res['repos']['child-a']['reasons']))

    def test_shared_common_dir_passes_symlink_alias_of_one_checkout_blocks(self):
        """R20-C01."""
        self.exclude()
        a = self.worktree('child-a', self.src['child-a'])
        a2 = self.worktree('child-a2', self.src['child-a'], branch=f'design/x--{FEATURE}')
        own = self.worktree('parent-docs', self.main, branch=f'design/x--{FEATURE}')
        repos = {'child-a': self.entry('child-a', a), 'child-a2': self.entry('child-a2', a2, branch=f'design/x--{FEATURE}'),
                 'parent-docs': self.entry('parent-docs', own, branch=f'design/x--{FEATURE}')}
        rc, res = helper('preflight', '--contract', self.save('c.json', self.contract(repos)))
        self.assertEqual(rc, 0, res)
        os.symlink(self.parent / a, self.parent / TASK_DIR / 'alias-a')
        repos['alias-a'] = self.entry('alias-a', f'{TASK_DIR}/alias-a')
        rc, res = helper('preflight', '--contract', self.save('c.json', self.contract(repos)))
        self.assertEqual(rc, 1)
        self.assertIn('same physical checkout as child-a', res['repos']['alias-a']['reasons'])
        self.assertIn('same physical checkout as alias-a', res['repos']['child-a']['reasons'])

    def test_external_alias_needs_recorded_verified_access(self):
        self.exclude()
        ext = self.root / 'external' / 'child-b'
        git(self.src['child-b'], 'worktree', 'add', '-q', '-b', 'design/x', str(ext))
        (self.parent / TASK_DIR).mkdir(parents=True)
        os.symlink(ext, self.parent / TASK_DIR / 'child-b')
        e = self.entry('child-b', f'{TASK_DIR}/child-b')
        rc, res = helper('preflight', '--contract', self.save('c.json', self.contract({'child-b': e})))
        self.assertEqual(rc, 1)
        self.assertIn('external alias without verified write access', ' '.join(res['repos']['child-b']['reasons']))
        e['external_access_verified'] = True
        rc, res = helper('preflight', '--contract', self.save('c.json', self.contract({'child-b': e})))
        self.assertEqual(rc, 0, res)

    def test_branch_base_and_replaced_checkout(self):
        self.exclude()
        alias = self.worktree('child-a', self.src['child-a'])
        e = self.entry('child-a', alias)
        for change, text in ((dict(branch='other'), 'not other'), (dict(base='e' * 40), 'base commit missing'),
                             (dict(git_dir='/elsewhere'), 'gitdir differs'), (dict(realpath='/elsewhere'), 'contract realpath')):
            with self.subTest(change):
                rc, res = helper('preflight', '--contract', self.save('c.json', self.contract({'child-a': {**e, **change}})))
                self.assertEqual(rc, 1)
                self.assertIn(text, ' '.join(res['repos']['child-a']['reasons']))

    def test_dependency_binding_into_shared_checkout_blocks_until_fixed_in_task(self):
        """AC-05: a correct worktree whose local package resolves into a foreign checkout is not ready."""
        c = self.standard()
        foreign = self.root / 'shared' / 'other-pkg'
        foreign.mkdir()
        child = self.parent / c['repos']['child-a']['alias']
        (child / 'node_modules').mkdir()
        os.symlink(foreign, child / 'node_modules' / 'pkg')
        os.symlink(self.parent / TASK_DIR / 'dep', child / 'node_modules' / 'dep')
        c['repos']['child-a']['bindings'] = ['node_modules/pkg', 'node_modules/dep']
        rc, res = helper('preflight', '--contract', self.save('c.json', c))
        self.assertEqual(rc, 1)
        r = res['repos']['child-a']
        self.assertEqual(r['bindings'], {'node_modules/pkg': 'foreign', 'node_modules/dep': 'read:dep'})
        self.assertIn('outside the task environment', ' '.join(r['reasons']))
        # Fixed inside the task: the package is now the task's own checkout of child-b.
        (child / 'node_modules' / 'pkg').unlink()
        os.symlink(self.parent / c['repos']['child-b']['alias'], child / 'node_modules' / 'pkg')
        rc, res = helper('preflight', '--contract', self.save('c.json', c))
        self.assertEqual(rc, 0, res)
        self.assertEqual(res['repos']['child-a']['bindings']['node_modules/pkg'], 'write:child-b')

    def test_read_only_dependency_moved_or_written(self):
        c = self.standard()
        write(self.dep / 'dist' / 'out.js', 'built\n')
        rc, res = helper('preflight', '--contract', self.save('c.json', c))
        self.assertEqual(rc, 1)
        self.assertIn('changed since the contract digest', ' '.join(res['repos']['dep']['reasons']))
        commit(self.dep, {'lib.txt': 'v2\n'})
        rc, res = helper('preflight', '--contract', self.save('c.json', c))
        self.assertIn('HEAD differs', ' '.join(res['repos']['dep']['reasons']))

    def test_submodule_entry_keeps_its_gitlink_tracked(self):
        git(self.main, 'submodule', 'add', '-q', str(self.src['child-a']), 'deps/sub')
        git(self.main, 'commit', '-q', '-m', 'sub')
        git(self.parent, 'merge', '-q', '--ff-only', 'main')
        git(self.parent, 'submodule', 'update', '--init', '-q')
        sub = self.parent / 'deps' / 'sub'
        git(sub, 'switch', '-q', '-c', f'design/x--{FEATURE}')
        e = self.entry('sub', 'deps/sub', kind='submodule', branch=f'design/x--{FEATURE}', gitlink='deps/sub',
                       scope=['deps/sub/src/**'])
        rc, res = helper('preflight', '--contract', self.save('c.json', self.contract({'sub': e})))
        self.assertEqual(rc, 0, res)
        self.assertEqual(res['repos']['sub']['facts']['git_dir'],
                         os.path.realpath(self.main / '.git' / 'worktrees' / 'wt-parent' / 'modules' / 'deps' / 'sub'))
        rc, res = helper('preflight', '--contract', self.save('c.json', self.contract({'sub': {**e, 'gitlink': 'deps/other'}})))
        self.assertEqual(rc, 1)


class DigestAndReuse(World):
    def test_digest_sees_ignored_rewrites_not_symlink_targets_and_is_bounded(self):
        """R20-C02."""
        write(self.dep / 'dist' / 'out.js', 'v1\n')
        outside = self.root / 'outside.txt'
        write(outside, 'o1\n')
        (self.dep / 'dist' / 'link').symlink_to(outside)
        d0 = helper('digest', '--repo', str(self.dep))[1]['digest']
        write(outside, 'o2\n')
        self.assertEqual(helper('digest', '--repo', str(self.dep))[1]['digest'], d0)
        write(self.dep / 'dist' / 'out.js', 'v2\n')
        self.assertNotEqual(helper('digest', '--repo', str(self.dep))[1]['digest'], d0)
        rc, res = helper('digest', '--repo', str(self.dep), '--max-files', '1')
        self.assertEqual((rc, res), (1, {'digest': None, 'observable': False}))

    def reuse_setup(self):
        self.exclude()
        alias = self.worktree('child-a', self.src['child-a'])
        e = self.entry('child-a', alias)
        c = self.save('c.json', self.contract({'child-a': e}))
        child = self.parent / alias
        write(child / 'notes.txt', 'user\n')
        f = helper('identity', '--parent', str(self.parent), '--alias', alias)[1]
        rec = {'kind': 'checkpoint', 'feature': FEATURE, 'repo': 'child-a', 'branch': 'design/x', 'branch_created': True,
               'base': e['base'], 'realroot': f['realpath'], 'git_dir': f['git_dir'],
               'initial_dirt': {'notes.txt': out(child, 'hash-object', '--', 'notes.txt')}}
        return c, child, rec, e

    def test_reuse_before_first_delivery_and_after(self):
        """R20-C03: checkpoint before delivery, interrupted attempt, lost checkpoint, delivered record."""
        c, child, rec, e = self.reuse_setup()
        rc, res = helper('reuse', '--contract', c, '--repo', 'child-a', '--record', self.save('r.json', rec))
        self.assertEqual((rc, res['decision']), (0, 'reuse'), res)
        self.assertEqual(res['inventory'], {'commits': [], 'dirt': {'notes.txt': 'preexisting'}})
        head = commit(child, {'src/a.txt': 'a\n'}, 'attempt 1')
        write(child / 'src' / 'wip.txt', 'wip\n')
        rc, res = helper('reuse', '--contract', c, '--repo', 'child-a', '--record', self.save('r.json', rec))
        self.assertEqual(res['inventory'], {'commits': [head], 'dirt': {'notes.txt': 'preexisting', 'src/wip.txt': 'attempt'}})
        for change, text in ((dict(git_dir='/x'), 'checkout replaced'), (dict(branch='other'), 'branch'),
                             (dict(branch_created=False), 'setup did not create')):
            with self.subTest(change):
                rc, res = helper('reuse', '--contract', c, '--repo', 'child-a', '--record', self.save('r.json', {**rec, **change}))
                self.assertEqual(rc, 1)
                self.assertIn(text, res['reason'])
        lost = {'kind': 'contract', 'feature': FEATURE, 'repo': 'child-a', 'branch': 'design/x', 'base': e['base'],
                'realroot': e['realpath']}
        rc, res = helper('reuse', '--contract', c, '--repo', 'child-a', '--record', self.save('r.json', lost))
        self.assertIn('ownership unresolved for 1 commit(s) and 2 dirty path(s)', res['reason'])
        rc, res = helper('reuse', '--contract', c, '--repo', 'child-a')
        self.assertIn('no checkpoint, contract or committed record', res['reason'])
        delivered = {'kind': 'delivered', 'feature': FEATURE, 'repo': 'child-a', 'branch': 'design/x',
                     'base': e['base'], 'head': head}
        self.assertEqual(helper('reuse', '--contract', c, '--repo', 'child-a', '--record', self.save('r.json', delivered))[0], 0)
        later = commit(child, {'src/b.txt': 'b\n'}, 'unknown')
        rc, res = helper('reuse', '--contract', c, '--repo', 'child-a', '--record', self.save('r.json', delivered))
        self.assertIn('1 unrecorded commit', res['reason'])
        delivered['later'] = [later]
        self.assertEqual(helper('reuse', '--contract', c, '--repo', 'child-a', '--record', self.save('r.json', delivered))[0], 0)
        self.assertEqual(helper('reuse', '--contract', c, '--repo', 'child-a', '--record', self.save('r.json', {'kind': 'guess'}))[0], 2)


class Delivers:
    """An executor's delivery (child commits, parent work, ledger + sidecar) and the coordinator receipt."""

    def deliver(self, mutate=None, evidence_extra=None, outcome='COMPLETE', worktree='clean', package=False,
                child_files=None):
        heads = {}
        for rid in sorted(r for r, e in self.c['repos'].items() if e['role'] == 'write'):
            path = self.parent / self.c['repos'][rid]['alias']
            heads[rid] = commit(path, (child_files or {}).get(rid, {'src/feature.txt': f'{rid}\n'}), f'{rid} work')
        commit(self.parent, {'app/x.txt': 'x2\n'}, 'parent work')
        repos = []
        for rid, e in sorted(self.c['repos'].items()):
            r = {'id': rid, 'role': e['role'], 'kind': e['kind'], 'alias': e['alias'], 'base': e['base'],
                 'source': {'locator': f'example/{rid}'}}
            if e['role'] == 'write':
                r.update(branch=e['branch'], target=e['target'], head=heads[rid], scope=e['scope'],
                         dirt={'baseline': [], 'final': []})
            else:
                r.update(head=e['base'], digest=e['digest'], dirt={})
            repos.append(r)
        m = {'schema': 'multi-repo-v1', 'feature': FEATURE, 'task': TASK,
             'parent': {'base': self.base, 'scope': PARENT_SCOPE}, 'repos': repos,
             'integration': {'tested_set': {r['id']: r['head'] for r in repos}, 'checks': ['npm test: exit 0']}}
        if mutate:
            mutate(m)
        raw = json.dumps(m, indent=1, sort_keys=True) + '\n'
        commit(self.parent, {LEDGER: '# ledger\n', SIDECAR: raw, **(evidence_extra or {})}, 'ledger and sidecar')
        head = out(self.parent, 'rev-parse', 'HEAD')
        lines = [f'DELIVERY=local-v1 BASE={self.base} HEAD={head} LEDGER={LEDGER} OUTCOME={outcome} WORKTREE={worktree}',
                 f'REPOS={SIDECAR} SHA256={hashlib.sha256(raw.encode()).hexdigest()}']
        if package:
            lines.append(f'PACKAGE=packages/F-X-r01.zip SHA256={"c" * 64} PURPOSE=implementation-review '
                         f'RANGE={self.base}..{head} LEDGER={LEDGER}')
        return '\n'.join(lines + ['Implemented W-01.']), heads

    def run_receipt(self, summary, contract=None):
        s = self.work / 'summary.txt'
        s.write_text(summary)
        return helper('receipt', '--contract', self.save('c.json', contract or self.c), '--summary', str(s))


class Receipt(Delivers, World):
    def setUp(self):
        super().setUp()
        self.c = self.standard()
        self.base = self.c['parent']['base']

    def test_complete_delivery_passes(self):
        self.c['parent']['package'] = True
        summary, heads = self.deliver(package=True)
        rc, res = self.run_receipt(summary)
        self.assertEqual((rc, res['outcome'], res['findings']), (0, 'COMPLETE', []))
        self.assertNotIn(out(self.parent, 'rev-parse', 'HEAD'), out(self.parent, 'show', f'HEAD:{SIDECAR}'))

    def test_clean_parent_dirty_child_is_partial(self):
        summary, _ = self.deliver()
        write(self.parent / self.c['repos']['child-b']['alias'] / 'src' / 'wip.txt', 'unfinished\n')
        rc, res = self.run_receipt(summary)
        self.assertEqual(out(self.parent, 'status', '--porcelain'), '')
        self.assertEqual((rc, res['outcome']), (1, 'PARTIAL'))
        self.assertIn(f'child-b: own/overlap dirt in a COMPLETE delivery: [\'{TASK_DIR}/child-b/src/wip.txt\']', res['findings'])

    def test_per_commit_scope_catches_add_then_revert_in_child(self):
        child = self.parent / self.c['repos']['child-a']['alias']
        commit(child, {'README.md': 'outside\n'}, 'outside scope')
        git(child, 'rm', '-q', '--', 'README.md')
        git(child, 'commit', '-q', '-m', 'revert')
        summary, _ = self.deliver()
        rc, res = self.run_receipt(summary)
        self.assertIn(f'child-a: path outside scope: {TASK_DIR}/child-a/README.md', res['findings'])

    def test_manifest_problems(self):
        cases = {
            'outside contract': (lambda m: m['repos'][0].update(id='child-z') or m['integration']['tested_set'].update(
                {'child-z': m['integration']['tested_set'].pop('child-a')}), 'manifest repo outside contract: child-z'),
            'parent head': (lambda m: m['parent'].update(head='a' * 40), 'no self-hash cycle'),
            'tested set': (lambda m: m['integration']['tested_set'].update({'child-a': 'b' * 40}),
                           'child-a: tested version differs from delivered head'),
            'foreign head': (lambda m: m['repos'][0].update(head=out(self.src['child-b'], 'rev-parse', 'HEAD')) or
                             m['integration']['tested_set'].update({'child-a': m['repos'][0]['head']}),
                             'child-a: head missing or not descending from the contract base'),
            'scope widened': (lambda m: m['repos'][0].update(scope=[f'{TASK_DIR}/child-a/**']),
                              'child-a: manifest scope differs from the contract'),
        }
        for name, (mutate, finding) in cases.items():
            with self.subTest(name):
                self.tearDown()
                self.setUp()
                summary, _ = self.deliver(mutate=mutate)
                rc, res = self.run_receipt(summary)
                self.assertEqual(rc, 1)
                self.assertTrue(any(finding in f for f in res['findings']), res['findings'])

    def test_transport_problems(self):
        summary, _ = self.deliver()
        lines = summary.split('\n')
        rc, res = self.run_receipt(lines[0])
        self.assertIn('line 2 is not a REPOS line in a multi-repo contract', res['findings'])
        bad = summary.replace(lines[1].split('SHA256=')[1], '0' * 64)
        self.assertIn('sidecar SHA256 mismatch', self.run_receipt(bad)[1]['findings'])
        self.c['parent']['package'] = True
        self.assertIn('the contract requires a package: line 3 must be PACKAGE', self.run_receipt(summary)[1]['findings'])
        self.c['parent']['package'] = False
        wrong = summary.replace('WORKTREE=clean', 'WORKTREE=dirty:2')
        self.assertTrue(any('WORKTREE misreported' in f for f in self.run_receipt(wrong)[1]['findings']))
        self.assertEqual(self.run_receipt('no delivery line')[1]['findings'], ['line 1 is not a local-v1 delivery line'])

    def test_sidecar_commit_with_code_and_earlier_ledger(self):
        commit(self.parent, {LEDGER_DIR + '00.md': 'earlier\n'}, 'earlier ledger')
        self.base = self.c['parent']['base'] = out(self.parent, 'rev-parse', 'HEAD')
        commit(self.parent, {LEDGER_DIR + '00.md': 'edited\n'}, 'edit earlier ledger')
        summary, _ = self.deliver(evidence_extra={'app/late.txt': 'late\n'})
        f = self.run_receipt(summary)[1]['findings']
        self.assertTrue(any('also changes non-evidence paths' in x for x in f), f)
        self.assertIn(f"earlier ledger touched: ['{LEDGER_DIR}00.md']", f)

    def test_read_only_dependency_written_after_contract(self):
        summary, _ = self.deliver()
        write(self.dep / 'dist' / 'out.js', 'written by a child build\n')
        self.assertIn('dep: read-only dependency drift or write', self.run_receipt(summary)[1]['findings'])

    def test_child_drift_after_delivery_is_reported_not_attributed(self):
        summary, _ = self.deliver()
        commit(self.parent / self.c['repos']['child-a']['alias'], {'src/later.txt': 'later\n'}, 'later')
        rc, res = self.run_receipt(summary)
        self.assertEqual((rc, res['findings']), (0, []))
        self.assertIn('integration drift', res['repos']['child-a']['drift'])

    def test_preexisting_child_dirt_is_not_attributed(self):
        child = self.parent / self.c['repos']['child-a']['alias']
        write(child / 'notes.txt', 'user\n')
        self.c['repos']['child-a']['baseline'] = {'notes.txt': out(child, 'hash-object', '--', 'notes.txt')}
        summary, _ = self.deliver(mutate=lambda m: m['repos'][0]['dirt'].update(
            final=[{'path': f'{TASK_DIR}/child-a/notes.txt', 'class': 'preexisting'}]))
        rc, res = self.run_receipt(summary)
        self.assertEqual((rc, res['findings']), (0, []), res)
        self.assertEqual(res['repos']['child-a']['dirt'], {f'{TASK_DIR}/child-a/notes.txt': 'preexisting'})


class IntegrationStatus(World):
    def test_interrupted_dependency_first_merge_and_pins(self):
        a = self.src['child-a']
        git(a, 'switch', '-q', '-c', 'design/x')
        delivered = commit(a, {'src/f.txt': 'f\n'})
        git(a, 'switch', '-q', 'main')
        commit(a, {'src/m.txt': 'm\n'})
        git(self.main, 'submodule', 'add', '-q', str(a), 'deps/a')
        git(self.main, 'commit', '-q', '-m', 'pin a')
        rec = {'schema': 'multi-repo-integration-v1', 'order': ['child-a', 'parent'],
               'repos': {'child-a': {'path': str(a), 'target': 'main', 'delivered': delivered, 'state': 'pending'},
                         'parent': {'path': str(self.main), 'target': 'main', 'delivered': out(self.main, 'rev-parse', 'HEAD'),
                                    'state': 'pending'}},
               'pins': [{'path': 'deps/a', 'repo': 'child-a'}]}
        rc, res = helper('integration', '--record', self.save('i.json', rec))
        self.assertEqual((rc, res['status'], res['next']), (1, 'PARTIAL', 'child-a'))
        git(a, 'merge', '-q', '--no-edit', 'design/x')
        rec['repos']['child-a'].update(state='merged', integrated=out(a, 'rev-parse', 'HEAD'))
        rc, res = helper('integration', '--record', self.save('i.json', rec))
        self.assertEqual(res['next'], 'parent')
        self.assertTrue(res['repos']['child-a']['retest_required'])  # non-FF merge: new SHA, retest
        rec['repos']['parent'].update(state='merged', integrated=out(self.main, 'rev-parse', 'HEAD'))
        rc, res = helper('integration', '--record', self.save('i.json', rec))
        self.assertEqual(rc, 1)
        self.assertIn('pin deps/a does not name the integrated child-a commit', res['findings'])
        git(self.main / 'deps' / 'a', 'fetch', '-q', 'origin')
        git(self.main / 'deps' / 'a', 'checkout', '-q', rec['repos']['child-a']['integrated'])
        git(self.main, 'add', '--', 'deps/a')
        git(self.main, 'commit', '-q', '-m', 'update pin')
        rec['repos']['parent']['integrated'] = out(self.main, 'rev-parse', 'HEAD')
        rc, res = helper('integration', '--record', self.save('i.json', rec))
        self.assertEqual((rc, res['status'], res['findings']), (0, 'COMPLETE', []))
        git(a, 'switch', '-q', 'design/x')
        stray = commit(a, {'src/stray.txt': 's\n'}, 'not merged')
        rec['repos']['child-a'].update(delivered=stray, integrated=stray)  # never merged into main
        self.assertIn('child-a: integrated commit is not on target main',
                      helper('integration', '--record', self.save('i.json', rec))[1]['findings'])


class ReadOnly(World):
    def test_no_command_writes_anything(self):
        c = self.standard()
        cp = self.save('c.json', c)
        child = self.parent / c['repos']['child-a']['alias']
        write(child / 'src' / 'dirty.txt', 'x\n')  # an index refresh would be tempted here
        write(self.dep / 'dist' / 'out.js', 'v\n')
        os.utime(self.parent / 'app' / 'x.txt', None)
        rec = self.save('r.json', {'kind': 'contract', 'feature': FEATURE, 'repo': 'child-a', 'branch': 'design/x',
                                   'base': c['repos']['child-a']['base'], 'realroot': c['repos']['child-a']['realpath']})
        summary = self.work / 's.txt'
        summary.write_text('DELIVERY=local-v1 BASE=' + c['parent']['base'] + ' HEAD=' + c['parent']['base'] +
                           f' LEDGER={LEDGER} OUTCOME=COMPLETE WORKTREE=clean\nREPOS={SIDECAR} SHA256=' + '0' * 64)
        before = snapshot(self.root)
        for args in (['preflight', '--contract', cp], ['digest', '--repo', str(self.dep)],
                     ['identity', '--parent', str(self.parent), '--alias', c['repos']['child-a']['alias']],
                     ['reuse', '--contract', cp, '--repo', 'child-a', '--record', rec],
                     ['receipt', '--contract', cp, '--summary', str(summary)]):
            helper(*args)
        self.assertEqual(snapshot(self.root), before)



class Scenarios(Delivers, World):
    """W20-03: the accepted scenarios end to end, with the helper CLI and ordinary Git only.

    The fixture plays the agent: it prepares checkouts with Git as the procedure says, commits as an
    executor would, and asks the helper. No model runs; this proves the procedure's checks, not that
    an agent performs them (no real-agent pilot was part of this scope).
    """

    def prepared(self):
        self.c = self.standard()
        self.base = self.c['parent']['base']

    def test_documents_on_main_new_parent_without_child_then_routine_preparation(self):
        """AC-01/AC-10: the plan lives in the parent; the child appears only at execute."""
        self.assertFalse((self.parent / '.feature-repos').exists())
        self.assertEqual(out(self.parent, 'ls-files', 'docs/features/F-X'), 'docs/features/F-X/brief.md')
        rc, f = helper('identity', '--parent', str(self.parent), '--alias', f'{TASK_DIR}/child-a')
        self.assertEqual(rc, 1)  # absent child: a preparation step, not a user question
        self.prepared()
        rc, res = helper('preflight', '--contract', self.save('c.json', self.c))
        self.assertEqual(rc, 0, res)
        self.assertEqual(out(self.parent, 'status', '--porcelain=v1', '--untracked-files=all'), '')

    def test_clone_fallback_keeps_its_history_inside_the_parent(self):
        """O2 fallback: a clone at the alias; its gitdir is inside the parent."""
        self.exclude()
        alias = f'{TASK_DIR}/child-a'
        git(self.root, 'clone', '-q', str(self.src['child-a']), str(self.parent / alias))
        git(self.parent / alias, 'switch', '-q', '-c', 'design/x')
        e = self.entry('child-a', alias, kind='clone')
        rc, res = helper('preflight', '--contract', self.save('c.json', self.contract({'child-a': e})))
        self.assertEqual(rc, 0, res)
        self.assertTrue(res['repos']['child-a']['facts']['common_dir'].startswith(str(self.parent)))
        head = commit(self.parent / alias, {'src/c.txt': 'c\n'})
        self.assertEqual(out(self.parent / alias, 'rev-list', '--branches', '--not', '--remotes'), head)  # handoff list (O1)

    def test_branch_collision_and_foreign_dirt_are_preserved(self):
        """AC-03."""
        src = self.src['child-a']
        foreign = commit(src, {'src/other.txt': 'o\n'}, 'other work')
        git(src, 'branch', 'design/x', foreign)
        write(src / 'src' / 'uncommitted.txt', 'someone else\n')
        self.assertEqual(git(src, 'show-ref', '--verify', '--quiet', 'refs/heads/design/x', check=False).returncode, 0)
        self.exclude()
        alias = self.worktree('child-a', src, branch=f'design/x--{FEATURE}', base='HEAD~1')
        rc, res = helper('preflight', '--contract', self.save('c.json', self.contract(
            {'child-a': self.entry('child-a', alias, branch=f'design/x--{FEATURE}')})))
        self.assertEqual(rc, 0, res)
        self.assertEqual(out(src, 'rev-parse', 'design/x'), foreign)
        self.assertEqual((src / 'src' / 'uncommitted.txt').read_text(), 'someone else\n')

    def test_alias_to_a_shared_checkout_blocks_writes(self):
        """AC-04: a path into the user's shared checkout is detected before any write."""
        self.exclude()
        (self.parent / TASK_DIR).mkdir(parents=True)
        os.symlink(self.src['child-a'], self.parent / TASK_DIR / 'child-a')  # the shared main checkout
        e = self.entry('child-a', f'{TASK_DIR}/child-a', branch='main')
        rc, res = helper('preflight', '--contract', self.save('c.json', self.contract({'child-a': e})))
        self.assertEqual(rc, 1)
        self.assertIn('external alias without verified write access', ' '.join(res['repos']['child-a']['reasons']))

    def test_resume_without_drift_reuses_and_with_drift_rechecks(self):
        """AC-07: no second set of worktrees; a changed branch or binding is checked again."""
        self.prepared()
        cp = self.save('c.json', self.c)
        e = self.c['repos']['child-a']
        rec = self.save('r.json', {'kind': 'checkpoint', 'feature': FEATURE, 'repo': 'child-a', 'branch': 'design/x',
                                   'branch_created': True, 'base': e['base'], 'realroot': e['realpath'],
                                   'git_dir': e['git_dir'], 'initial_dirt': {}})
        worktrees = out(self.src['child-a'], 'worktree', 'list', '--porcelain').count('worktree ')
        for _ in range(2):
            self.assertEqual(helper('reuse', '--contract', cp, '--repo', 'child-a', '--record', rec)[0], 0)
            self.assertEqual(helper('preflight', '--contract', cp)[0], 0)
        self.assertEqual(out(self.src['child-a'], 'worktree', 'list', '--porcelain').count('worktree '), worktrees)
        child = self.parent / e['alias']
        git(child, 'switch', '-q', '-c', 'someone-else')
        self.assertEqual(helper('reuse', '--contract', cp, '--repo', 'child-a', '--record', rec)[0], 1)
        self.assertEqual(helper('preflight', '--contract', cp)[0], 1)
        git(child, 'switch', '-q', 'design/x')
        (child / 'node_modules').mkdir()
        os.symlink(self.src['child-b'], child / 'node_modules' / 'b')  # binding drift into a shared checkout
        self.c['repos']['child-a']['bindings'] = ['node_modules/b']
        rc, res = helper('preflight', '--contract', self.save('c.json', self.c))
        self.assertEqual(rc, 1)
        self.assertEqual(res['repos']['child-a']['bindings'], {'node_modules/b': 'foreign'})

    def test_missing_child_manifest(self):
        self.prepared()
        summary, _ = self.deliver()
        bad = summary.replace(SIDECAR, LEDGER_DIR + '02.repos.json')
        rc, res = self.run_receipt(bad)
        self.assertEqual(rc, 1)
        self.assertIn('sidecar not in parent HEAD', res['findings'])

    def test_local_integration_before_merge_needs_no_merge(self):
        """AC-08/AC-09: the delivered set is tested and received on feature branches only."""
        self.prepared()
        targets = {r: out(self.src[r], 'rev-parse', 'main') for r in self.src}
        summary, heads = self.deliver()
        rc, res = self.run_receipt(summary)
        self.assertEqual((rc, res['outcome']), (0, 'COMPLETE'), res)
        self.assertEqual({r: out(self.src[r], 'rev-parse', 'main') for r in self.src}, targets)
        m = json.loads(out(self.parent, 'show', f'HEAD:{SIDECAR}'))
        self.assertEqual({k: v for k, v in m['integration']['tested_set'].items() if k in heads}, heads)

    def test_full_flow_through_interrupted_merge_and_retest(self):
        """AC-09: dependency-first merge, interruption, continuation, retest of new SHAs."""
        self.prepared()
        summary, heads = self.deliver()
        self.assertEqual(self.run_receipt(summary)[0], 0)
        for r in self.src:
            commit(self.src[r], {'src/concurrent.txt': 'c\n'}, 'concurrent main work')  # forces non-FF
        rec = {'schema': 'multi-repo-integration-v1', 'order': ['child-a', 'child-b'],
               'repos': {r: {'path': str(self.src[r]), 'target': 'main', 'delivered': heads[r], 'state': 'pending'}
                         for r in self.src}}
        git(self.src['child-a'], 'merge', '-q', '--no-edit', heads['child-a'])
        rec['repos']['child-a'].update(state='merged', integrated=out(self.src['child-a'], 'rev-parse', 'HEAD'))
        rc, res = helper('integration', '--record', self.save('i.json', rec))
        self.assertEqual((rc, res['status'], res['next']), (1, 'PARTIAL', 'child-b'))  # interrupted: visible
        merged_a = out(self.src['child-a'], 'rev-parse', 'main')
        git(self.src['child-b'], 'merge', '-q', '--no-edit', heads['child-b'])
        rec['repos']['child-b'].update(state='merged', integrated=out(self.src['child-b'], 'rev-parse', 'HEAD'))
        rc, res = helper('integration', '--record', self.save('i.json', rec))
        self.assertEqual((rc, res['status']), (0, 'COMPLETE'), res)
        self.assertTrue(all(res['repos'][r]['retest_required'] for r in self.src))
        self.assertEqual(out(self.src['child-a'], 'rev-parse', 'main'), merged_a)  # continuation did not redo child-a

    def test_shared_metadata_and_caches_are_not_violations(self):
        self.prepared()
        cache = self.root / 'home' / '.cache' / 'tool'
        write(cache / 'blob', 'cached\n')
        child = self.parent / self.c['repos']['child-a']['alias']
        (child / '.cache-link').symlink_to(cache)
        git(child, 'config', '--local', 'core.abbrev', '12')  # common config of the source: shared metadata
        excl = Path(out(self.parent, 'rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'))
        self.assertEqual(os.path.realpath(excl), os.path.realpath(self.main / '.git' / 'info' / 'exclude'))
        rc, res = helper('preflight', '--contract', self.save('c.json', self.c))
        self.assertEqual(rc, 0, res)

    def test_external_zip_covers_only_the_parent(self):
        """AC-10: an exchange archive never packs ignored child checkouts."""
        self.prepared()
        archive = self.work / 'parent.zip'
        exporter = REPO_ROOT / '.agents/skills/feature-exchange/scripts/feature_exchange.py'
        p = subprocess.run([sys.executable, '-I', str(exporter), 'export', '--repo', str(self.parent), '--feature',
                            'docs/features/F-X', '--purpose', 'plan-review', '--output', str(archive)],
                           capture_output=True, text=True, env=ENV)
        self.assertEqual(p.returncode, 0, p.stderr)
        import zipfile
        names = zipfile.ZipFile(archive).namelist()
        self.assertFalse(any('.feature-repos' in n or n.startswith('src/') for n in names), names)


if __name__ == '__main__':
    unittest.main()
