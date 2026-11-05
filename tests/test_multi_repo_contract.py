"""Feasibility probes of the F-W20 multi-repo contract, against real temporary Git repositories.

Source of the rules: docs/features/F-W20-multi-repo-execution/contracts/01-multi-repo.md (W20-01).
The functions below (`prepare_*`, `identity`, `validate_manifest`, `multi_receipt`, `reuse_proof`,
`integration_status`) are a test-local transcription of commands the contract publishes, not a
product helper: W20-02 decides whether a read-only helper ships. Every fixture is a disposable
synthetic repository under a fresh temporary directory; nothing touches a real child repository.

What these probes can show: how Git places, ignores, shares and loses data in the layouts the
contract allows, and that the receipt rules catch the failure classes they name. What they cannot
show: that a model follows the procedure, or how Claude Code resolves a symlinked `--add-dir`
(transport of argv and summary lines is in
claude/claude-side/src/adapters/multi-repo-contract.test.ts).

Run: python3 -m unittest discover -s tests -p 'test_multi_repo_contract.py' -v
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

FEATURE = 'F-X'
TASK = 'W-01'
TASK_DIR = f'.feature-repos/{FEATURE}'
LEDGER = f'docs/features/{FEATURE}/execution/{TASK}/01.md'
SIDECAR = f'docs/features/{FEATURE}/execution/{TASK}/01.repos.json'
LEDGER_DIR = f'docs/features/{FEATURE}/execution/{TASK}/'
PARENT_SCOPE = ['app/**', 'deps/sub', f'docs/features/{FEATURE}/execution/**']
DELIVERY = re.compile(r'^DELIVERY=local-v1 BASE=([0-9a-f]{40}) HEAD=([0-9a-f]{40}) LEDGER=(\S+) '
                      r'OUTCOME=(COMPLETE|PARTIAL) WORKTREE=(clean|dirty:(\d+))$')
REPOS = re.compile(r'^REPOS=(\S+) SHA256=([0-9a-f]{64})$')
PACKAGE = re.compile(r'^PACKAGE=(\S+) SHA256=([0-9a-f]{64}) PURPOSE=(\S+) RANGE=([0-9a-f]{40})\.\.([0-9a-f]{40}) LEDGER=(\S+)$')
SHA = re.compile(r'^(?:[0-9a-f]{40}|[0-9a-f]{64})$')
REPO_ID = re.compile(r'^[a-z0-9][a-z0-9._-]{0,63}$')
SUMMARY_MAX = 4000
BOUNDS = {'bytes': 65536, 'repos': 32, 'scope': 64, 'dirt': 200, 'path': 256, 'glob': 512}


def clean_env(home):
    env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
    env.update(HOME=str(home), GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull)
    return env


ENV = None  # set per test case; a fresh HOME keeps the operator's Git config out


def git(repo, *args, check=True):
    proc = subprocess.run(['git', '-c', 'user.email=probe@example.invalid', '-c', 'user.name=Probe',
                           '-c', 'init.defaultBranch=main', '-c', 'protocol.file.allow=always',
                           '-C', str(repo), *args], capture_output=True, text=True, env=ENV)
    if check and proc.returncode:
        raise AssertionError(f'git {args} failed: {proc.stderr}')
    return proc


def out(repo, *args):
    return git(repo, *args).stdout.strip()


def zlist(repo, *args):
    return [n for n in git(repo, *args).stdout.split('\0') if n]


def glob_re(glob):
    """Port of globToRegExp in shared/protocol/src/scope.ts (as in test_local_delivery.py)."""
    res, i = '', 0
    while i < len(glob):
        ch = glob[i]
        if ch == '*' and glob[i + 1:i + 2] == '*':
            j = i + 2 + (1 if glob[i + 2:i + 3] == '/' else 0)
            res = res[:-1] + '(?:/.*)?' if res.endswith('/') else res + '.*'
            i = j
            continue
        res += '[^/]*' if ch == '*' else '[^/]' if ch == '?' else re.escape(ch)
        i += 1
    return re.compile(f'^{res}$')


def matches(path, globs):
    return any(glob_re(g).match(path) for g in globs)


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def commit(repo, files, message):
    for rel, text in files.items():
        write(Path(repo) / rel, text)
    git(repo, 'add', '--', *files)
    git(repo, 'commit', '-q', '-m', message, '--', *files)
    return out(repo, 'rev-parse', 'HEAD')


def status_records(repo, ignored=False):
    extra = ['--ignored=matching'] if ignored else []
    return zlist(repo, 'status', '--porcelain=v1', '-z', '--untracked-files=all', *extra)


# --- procedure transcription -------------------------------------------------------------

def exclude_task_dir(parent):
    """Add exactly `/.feature-repos/<feature>/` to the file Git names; keep every other line."""
    rel = out(parent, 'rev-parse', '--git-path', 'info/exclude')
    path = Path(rel) if os.path.isabs(rel) else Path(parent) / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    before = path.read_text() if path.exists() else ''
    entry = f'/{TASK_DIR}/'
    if entry not in before.splitlines():
        path.write_text(before + ('' if before.endswith('\n') or not before else '\n') + entry + '\n')
    return path


def symlink_on_path(parent, alias):
    cur = Path(parent)
    for part in Path(alias).parts:
        cur = cur / part
        if cur.is_symlink():
            return str(cur.relative_to(parent))
    return None


def prepare_worktree(parent, source, repo_id, branch, base):
    alias = f'{TASK_DIR}/{repo_id}'
    target = Path(parent) / alias
    assert not target.exists() and not os.path.lexists(target), 'collision: alias exists'
    assert symlink_on_path(parent, TASK_DIR) is None
    target.parent.mkdir(parents=True, exist_ok=True)
    git(source, 'worktree', 'add', '-q', '-b', branch, str(target), base)
    return alias


def pick_branch(source, desired):
    """Parent's branch name by default; a taken name gets a recorded alternative, never reused."""
    for name in [desired, f'{desired}--{FEATURE}'] + [f'{desired}--{FEATURE}-{n}' for n in range(2, 10)]:
        if git(source, 'show-ref', '--verify', '--quiet', f'refs/heads/{name}', check=False).returncode:
            return name
    raise AssertionError('no free branch name')


def identity(parent, alias):
    """Realpath facts the contract records (in the bridge contract/checkpoint, never in Git)."""
    path = Path(parent) / alias
    real = os.path.realpath(path)
    parent_real = os.path.realpath(parent)
    top = os.path.realpath(out(path, 'rev-parse', '--show-toplevel'))
    return {
        'realpath': real,
        'physical_inside': symlink_on_path(parent, alias) is None and real.startswith(parent_real + os.sep),
        'toplevel': top,
        'checkout_root': top == real,
        'common_dir': os.path.realpath(Path(path) / out(path, 'rev-parse', '--git-common-dir')),
        'git_dir': out(path, 'rev-parse', '--absolute-git-dir'),
        'roots': sorted(out(path, 'rev-list', '--max-parents=0', 'HEAD').split()),
    }


def dirt_hashes(repo):
    """Start record: status records plus `git hash-object` (or `deleted`) of each dirty path."""
    recs, res = status_records(repo), {}
    for rec in recs:
        p = rec[3:]
        f = Path(repo) / p
        res[p] = out(repo, 'hash-object', '--', p) if f.is_file() else 'deleted'
    return res


def classify(repo, baseline, alias, scope):
    final = dirt_hashes(repo)
    classes = {}
    for p, h in final.items():
        full = f'{alias}/{p}' if alias else p
        if p in baseline:
            classes[full] = 'preexisting' if baseline[p] == h else ('overlap' if matches(full, scope) else 'preexisting')
        else:
            classes[full] = 'own' if matches(full, scope) else 'foreign'
    return classes


def ignored_digest(repo):
    """Digest of HEAD plus every status record including ignored files: a read-only dependency check."""
    h = hashlib.sha256(out(repo, 'rev-parse', 'HEAD').encode())
    for rec in sorted(status_records(repo, ignored=True)):
        p = Path(repo) / rec[3:]
        h.update(rec.encode() + b'\0')
        if p.is_file():
            h.update(p.read_bytes())
    return h.hexdigest()


def portable(value):
    return not (value.startswith('/') or '\\' in value or re.match(r'^[A-Za-z]:', value)
                or '..' in value.split('/') or '//' in value)


def validate_manifest(raw):
    """Bounded `multi-repo-v1` schema. Returns a list of errors; empty means well-formed."""
    errs = []
    if len(raw) > BOUNDS['bytes']:
        return [f'manifest exceeds {BOUNDS["bytes"]} bytes']
    try:
        m = json.loads(raw)
    except ValueError as e:
        return [f'not JSON: {e}']
    if not isinstance(m, dict) or set(m) - {'schema', 'feature', 'task', 'parent', 'repos', 'integration'}:
        return ['unknown or missing top-level keys']
    if m.get('schema') != 'multi-repo-v1':
        errs.append('schema must be multi-repo-v1')
    parent = m.get('parent', {})
    if set(parent) != {'base', 'scope'}:
        errs.append('parent carries exactly base and scope (no head: no self-hash cycle)')
    elif not SHA.match(str(parent['base'])):
        errs.append('parent.base not a full SHA')
    repos = m.get('repos')
    if not isinstance(repos, list) or not 1 <= len(repos) <= BOUNDS['repos']:
        return errs + ['repos must hold 1..32 entries']
    seen = set()
    allowed = {'id', 'role', 'kind', 'source', 'alias', 'branch', 'target', 'base', 'head', 'scope',
               'gitlink', 'dirt', 'digest'}
    for r in repos:
        if not isinstance(r, dict) or set(r) - allowed:
            errs.append(f'repo entry has unknown keys: {sorted(set(r) - allowed) if isinstance(r, dict) else r}')
            continue
        rid = r.get('id', '')
        if not REPO_ID.match(str(rid)) or rid in seen:
            errs.append(f'bad or duplicate id {rid!r}')
        seen.add(rid)
        alias = str(r.get('alias', ''))
        if not alias or len(alias) > BOUNDS['path'] or not portable(alias):
            errs.append(f'{rid}: alias must be a portable repo-relative path')
        if r.get('role') not in ('write', 'read') or r.get('kind') not in ('worktree', 'clone', 'submodule', 'existing'):
            errs.append(f'{rid}: bad role/kind')
        for key in ('base', 'head'):
            if not SHA.match(str(r.get(key, ''))):
                errs.append(f'{rid}: {key} not a full SHA')
        scope = r.get('scope', [])
        if r.get('role') == 'read':
            if scope or r.get('head') != r.get('base') or 'digest' not in r:
                errs.append(f'{rid}: read-only entry has no scope, head == base and a digest')
        else:
            if not r.get('branch') or not r.get('target') or not scope:
                errs.append(f'{rid}: write entry needs branch, target and scope')
            if len(scope) > BOUNDS['scope'] or any(len(g) > BOUNDS['glob'] or not portable(g)
                                                   or not g.startswith(alias + '/') for g in scope):
                errs.append(f'{rid}: scope globs must be portable and prefixed by the alias')
        dirt = r.get('dirt', {})
        if not isinstance(dirt, dict) or set(dirt) - {'baseline', 'final', 'more'} or \
                any(len(dirt.get(k, [])) > BOUNDS['dirt'] for k in ('baseline', 'final')):
            errs.append(f'{rid}: dirt is bounded baseline/final lists plus overflow count')
        if 'gitlink' in r and (r.get('kind') != 'submodule' or not portable(str(r['gitlink']))):
            errs.append(f'{rid}: gitlink only on a submodule entry')
        src = r.get('source', {})
        if not isinstance(src, dict) or set(src) - {'locator', 'roots'} or any(
                isinstance(v, str) and v.startswith('/') for v in src.values()):
            errs.append(f'{rid}: source is a portable locator and root commits')
    if 'integration' in m:
        tested = m['integration'].get('tested_set', {})
        if set(tested) != seen:
            errs.append('integration.tested_set must name every repo')
        for r in repos:
            if isinstance(r, dict) and tested.get(r.get('id')) != r.get('head'):
                errs.append(f'{r.get("id")}: tested version differs from delivered head')
    return errs


def per_repo_paths(repo, base, head):
    return set(zlist(repo, 'diff', '--no-renames', '--name-only', '-z', base, head)) | \
        set(zlist(repo, 'log', '--no-renames', '--name-only', '-z', '--format=', f'{base}..{head}'))


def multi_receipt(parent, summary, contract):
    """Coordinator receipt over every repository. Findings are strings; outcome conservative."""
    f, lines = [], summary.split('\n')
    d = DELIVERY.match(lines[0])
    if not d:
        return {'findings': ['no delivery line'], 'outcome': 'PARTIAL'}
    base, head, ledger, outcome, worktree = d.group(1, 2, 3, 4, 5)
    if base != contract['base']:
        f.append('parent BASE differs from contract')
    if git(parent, 'merge-base', '--is-ancestor', base, head, check=False).returncode:
        f.append('parent HEAD does not descend from BASE')
    rp = REPOS.match(lines[1]) if len(lines) > 1 else None
    if not rp:
        return {'findings': f + ['no REPOS line in a multi-repo contract'], 'outcome': 'PARTIAL'}
    if contract.get('package') and not (len(lines) > 2 and PACKAGE.match(lines[2])):
        f.append('contract requires a package: PACKAGE line must be third')
    sidecar, digest = rp.group(1, 2)
    if any(len(x) > SUMMARY_MAX for x in ['\n'.join(lines[:3])]):
        f.append('critical lines exceed the stored summary')
    parent_paths = per_repo_paths(parent, base, head)
    for p in sorted(parent_paths):
        if not matches(p, contract['parent_scope']):
            f.append(f'parent path outside scope: {p}')
    if ledger not in zlist(parent, 'diff', '--no-renames', '--diff-filter=A', '--name-only', '-z', base, head, '--', ledger):
        f.append('ledger not added in range')
    for c in out(parent, 'log', '--format=%H', f'{base}..{head}', '--', sidecar).split():
        touched = zlist(parent, 'show', '--no-renames', '--name-only', '-z', '--format=', c)
        if any(not t.startswith(LEDGER_DIR) for t in touched):
            f.append(f'sidecar commit {c[:12]} also changes non-evidence paths')
    raw = git(parent, 'show', f'{head}:{sidecar}', check=False)
    if raw.returncode:
        return {'findings': f + ['sidecar not in parent HEAD'], 'outcome': 'PARTIAL'}
    data = raw.stdout.encode()
    if hashlib.sha256(data).hexdigest() != digest:
        f.append('sidecar SHA256 mismatch')
    errs = validate_manifest(data)
    if errs:
        return {'findings': f + errs, 'outcome': 'PARTIAL'}
    m = json.loads(data)
    if (m['feature'], m['task'], m['parent']['base']) != (FEATURE, TASK, contract['base']):
        f.append('manifest feature/task/base differ from contract')
    ids = {r['id'] for r in m['repos']}
    for extra in sorted(ids - set(contract['repos'])):
        f.append(f'manifest repo outside contract: {extra}')
    for missing in sorted(set(contract['repos']) - ids):
        f.append(f'contract repo missing from manifest: {missing}')
    reals = {}
    partial = outcome == 'PARTIAL'
    for r in m['repos']:
        c = contract['repos'].get(r['id'])
        if not c:
            continue
        path = Path(parent) / r['alias']
        if r['alias'] != c['alias'] or not path.exists():
            f.append(f'{r["id"]}: alias differs from contract or missing')
            continue
        ident = identity(parent, r['alias'])
        if ident['realpath'] != c['realpath'] or not ident['checkout_root']:
            f.append(f'{r["id"]}: alias does not resolve to the contract checkout root')
        if ident['realpath'] in reals or ident['common_dir'] == os.path.realpath(Path(parent) / out(parent, 'rev-parse', '--git-common-dir')):
            f.append(f'{r["id"]}: same physical checkout/repository as {reals.get(ident["realpath"], "parent")}')
        reals[ident['realpath']] = r['id']
        actual = out(path, 'rev-parse', 'HEAD')
        if r['role'] == 'read':
            if r['head'] != c['base'] or actual != c['base'] or ignored_digest(path) != c['digest']:
                f.append(f'{r["id"]}: read-only dependency drift or write')
            continue
        if r['base'] != c['base']:
            f.append(f'{r["id"]}: base differs from contract')
        if git(path, 'cat-file', '-e', f'{r["head"]}^{{commit}}', check=False).returncode or \
                git(path, 'merge-base', '--is-ancestor', r['base'], r['head'], check=False).returncode:
            f.append(f'{r["id"]}: head missing or not descending from base')
            continue
        if out(path, 'rev-list', '--merges', f'{r["base"]}..{r["head"]}'):
            f.append(f'{r["id"]}: unexpected merge in range')
        for p in sorted(per_repo_paths(path, r['base'], r['head'])):
            if not matches(f'{r["alias"]}/{p}', c['scope']):
                f.append(f'{r["id"]}: path outside scope: {r["alias"]}/{p}')
        if actual != r['head']:
            f.append(f'{r["id"]}: checkout moved after delivery (integration drift, not attributed)')
        classes = classify(path, c.get('baseline', {}), r['alias'], c['scope'])
        bad = sorted(p for p, k in classes.items() if k in ('own', 'overlap'))
        if bad:
            partial = True
            if outcome == 'COMPLETE':
                f.append(f'{r["id"]}: own/overlap dirt in a COMPLETE delivery: {bad}')
        if sorted(classes) != sorted(x['path'] for x in r['dirt'].get('final', [])):
            f.append(f'{r["id"]}: manifest final dirt differs from the checkout')
        if r.get('gitlink'):
            pinned = out(parent, 'ls-tree', head, '--', r['gitlink']).split()
            if not pinned or pinned[2] != r['head']:
                f.append(f'{r["id"]}: parent gitlink does not pin the delivered head')
    parent_n = len(status_records(parent))
    if worktree != ('clean' if parent_n == 0 else f'dirty:{parent_n}'):
        f.append('parent WORKTREE misreported')
    return {'findings': f, 'outcome': 'PARTIAL' if partial or f else outcome}


def reuse_proof(parent, record, alias, contract_real):
    """Minimal reuse evidence: a committed record plus the checkout's own Git facts."""
    if not record:
        return 'blocked: no committed record (a branch name alone proves nothing)'
    path = Path(parent) / alias
    if not path.exists() or os.path.realpath(path) != contract_real:
        return 'blocked: checkout path changed; rerun placement checks'
    if record['feature'] != FEATURE or out(path, 'symbolic-ref', '--short', 'HEAD') != record['branch']:
        return 'blocked: feature or branch differs from the record'
    if git(path, 'merge-base', '--is-ancestor', record['base'], 'HEAD', check=False).returncode:
        return 'blocked: recorded base is not an ancestor'
    if git(path, 'merge-base', '--is-ancestor', record['head'], 'HEAD', check=False).returncode:
        return 'blocked: recorded head is not an ancestor'
    unexplained = [c for c in out(path, 'rev-list', f'{record["head"]}..HEAD').split()
                   if c not in record.get('later', [])]
    if unexplained:
        return f'blocked: {len(unexplained)} unrecorded commit(s) after the recorded head'
    return 'reuse'


def integration_status(record, order):
    """Dependency-first integration: per-repo state; COMPLETE only if all merged and pins match."""
    for rid in order:
        if record[rid]['state'] != 'merged':
            return {'status': 'PARTIAL', 'next': rid}
    for pin in record.get('pins', []):
        if pin['pinned'] != record[pin['repo']]['integrated']:
            return {'status': 'PARTIAL', 'next': f'update pin {pin["path"]}'}
    return {'status': 'COMPLETE', 'next': None}


# --- fixtures ----------------------------------------------------------------------------

class World(unittest.TestCase):
    def setUp(self):
        global ENV
        self.root = Path(os.path.realpath(tempfile.mkdtemp(prefix='w20-multi-')))
        ENV = clean_env(self.root / 'home')
        (self.root / 'home').mkdir()
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
        self.parent_base0 = commit(self.main, {'app/x.txt': 'x\n'}, 'parent base')
        self.parent = self.root / 'wt-parent'
        git(self.main, 'worktree', 'add', '-q', '-b', 'design/x', str(self.parent))

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)


class PlacementAndIgnoreTests(World):
    def test_exclude_is_shared_metadata_and_keeps_existing_entries(self):
        common_exclude = self.main / '.git' / 'info' / 'exclude'
        write(common_exclude, '# user entry\n*.local\n')
        path = exclude_task_dir(self.parent)
        self.assertEqual(os.path.realpath(path), os.path.realpath(common_exclude))
        exclude_task_dir(self.parent)  # idempotent on resume
        self.assertEqual(common_exclude.read_text(), f'# user entry\n*.local\n/{TASK_DIR}/\n')
        self.assertEqual(out(self.parent, 'diff', '--name-only'), '')  # tracked .gitignore untouched

    def test_physical_child_is_ignored_parent_clean_child_dirt_separate(self):
        exclude_task_dir(self.parent)
        base = out(self.src['child-a'], 'rev-parse', 'HEAD')
        alias = prepare_worktree(self.parent, self.src['child-a'], 'child-a', 'design/x', base)
        self.assertIn(f'/{TASK_DIR}/', out(self.parent, 'check-ignore', '-v', f'{alias}/src/main.txt'))
        write(self.parent / alias / 'src' / 'wip.txt', 'unfinished\n')
        # O4: the parent is clean while the child is not; the two dirt records stay separate.
        self.assertEqual(status_records(self.parent), [])
        self.assertEqual(status_records(self.parent / alias), ['?? src/wip.txt'])
        ident = identity(self.parent, alias)
        self.assertTrue(ident['physical_inside'] and ident['checkout_root'])
        self.assertEqual(ident['common_dir'], os.path.realpath(self.src['child-a'] / '.git'))

    def test_plain_directory_is_not_a_repository(self):
        write(self.parent / 'app' / 'pkg' / 'a.txt', 'a\n')
        ident = identity(self.parent, 'app/pkg')
        self.assertFalse(ident['checkout_root'])  # toplevel is the parent: monorepo dir, not repo

    def test_external_alias_and_two_paths_to_one_checkout(self):
        exclude_task_dir(self.parent)
        external = self.root / 'external' / 'child-b'
        git(self.src['child-b'], 'worktree', 'add', '-q', '-b', 'design/x', str(external))
        (self.parent / TASK_DIR).mkdir(parents=True)
        os.symlink(external, self.parent / TASK_DIR / 'child-b')
        os.symlink(external, self.parent / TASK_DIR / 'other')
        a, b = identity(self.parent, f'{TASK_DIR}/child-b'), identity(self.parent, f'{TASK_DIR}/other')
        self.assertFalse(a['physical_inside'])
        self.assertEqual(symlink_on_path(self.parent, f'{TASK_DIR}/child-b'), f'{TASK_DIR}/child-b')
        self.assertEqual(a['realpath'], b['realpath'])  # textual globs differ; physical target is one
        self.assertEqual(status_records(self.parent), [])
        with self.assertRaises(AssertionError):
            prepare_worktree(self.parent, self.src['child-a'], 'child-b', 'x', 'HEAD')  # alias collision

    def test_symlink_component_above_alias_is_detected(self):
        exclude_task_dir(self.parent)
        real = self.root / 'elsewhere'
        real.mkdir()
        (self.parent / '.feature-repos').mkdir()
        os.symlink(real, self.parent / TASK_DIR)
        self.assertEqual(symlink_on_path(self.parent, f'{TASK_DIR}/child-a'), TASK_DIR)
        with self.assertRaises(AssertionError):
            prepare_worktree(self.parent, self.src['child-a'], 'child-a', 'design/x', 'HEAD')


class GitdirAndLifetimeTests(World):
    def test_worktree_commits_write_outside_parent_clone_keeps_them_inside(self):
        """O2: a nested worktree writes refs/objects to the source gitdir outside the parent."""
        exclude_task_dir(self.parent)
        src = self.src['child-a']
        before = {p for p in (src / '.git').rglob('*')}
        alias = prepare_worktree(self.parent, src, 'child-a', 'design/x', 'HEAD')
        commit(self.parent / alias, {'src/new.txt': 'n\n'}, 'child work')
        added = {str(p.relative_to(src / '.git')) for p in (src / '.git').rglob('*')} - \
            {str(p.relative_to(src / '.git')) for p in before}
        self.assertIn('worktrees/child-a/gitdir', added)
        self.assertIn('refs/heads/design/x', added)
        self.assertTrue(any(a.startswith('objects/') for a in added))
        clone = self.parent / TASK_DIR / 'child-b'
        git(self.parent, 'clone', '-q', str(self.src['child-b']), str(clone))
        before_b = {p for p in (self.src['child-b'] / '.git').rglob('*')}
        commit(clone, {'src/new.txt': 'n\n'}, 'clone work')
        self.assertEqual({p for p in (self.src['child-b'] / '.git').rglob('*')}, before_b)
        self.assertTrue(identity(self.parent, f'{TASK_DIR}/child-b')['common_dir'].startswith(str(self.parent)))

    def test_removing_parent_loses_clone_history_and_child_dirt(self):
        """O1: the in-parent clone lives and dies with the parent worktree."""
        exclude_task_dir(self.parent)
        alias = prepare_worktree(self.parent, self.src['child-a'], 'child-a', 'design/x', 'HEAD')
        wt_head = commit(self.parent / alias, {'src/w.txt': 'w\n'}, 'worktree work')
        write(self.parent / alias / 'src' / 'wip.txt', 'uncommitted\n')
        clone = self.parent / TASK_DIR / 'child-b'
        git(self.parent, 'clone', '-q', str(self.src['child-b']), str(clone))
        clone_head = commit(clone, {'src/c.txt': 'c\n'}, 'clone work')
        unpushed = out(clone, 'rev-list', '--branches', '--not', '--remotes')
        self.assertEqual(unpushed, clone_head)  # the handoff check that must precede any removal
        self.assertEqual(git(self.main, 'worktree', 'remove', str(self.parent)).returncode, 0)
        self.assertFalse(self.parent.exists())
        self.assertNotEqual(git(self.src['child-b'], 'cat-file', '-e', f'{clone_head}^{{commit}}', check=False).returncode, 0)
        self.assertEqual(git(self.src['child-a'], 'cat-file', '-e', f'{wt_head}^{{commit}}').returncode, 0)
        self.assertIn('prunable', out(self.src['child-a'], 'worktree', 'list', '--porcelain'))

    def test_submodule_gitdir_and_shared_config_in_linked_parent(self):
        """P06: where Git keeps a submodule of a linked parent and what init writes."""
        commit(self.src['child-a'], {'src/second.txt': 's\n'}, 'second')
        git(self.main, 'submodule', 'add', '-q', str(self.src['child-a']), 'deps/sub')
        git(self.main, 'commit', '-q', '-m', 'add submodule')
        fresh = self.root / 'fresh'
        git(self.root, 'clone', '-q', str(self.main), str(fresh))  # submodule declared, not initialised
        common_cfg = fresh / '.git' / 'config'
        before = common_cfg.read_text()
        linked = self.root / 'fresh-wt'
        git(fresh, 'worktree', 'add', '-q', '-b', 'design/x', str(linked))
        git(linked, 'submodule', 'update', '--init', '-q')
        after = common_cfg.read_text()
        self.assertNotIn('submodule "deps/sub"', before)
        self.assertIn('submodule "deps/sub"', after)  # init writes the shared config
        gitdir = out(linked / 'deps' / 'sub', 'rev-parse', '--absolute-git-dir')
        self.assertEqual(os.path.realpath(gitdir), os.path.realpath(fresh / '.git' / 'worktrees' / 'fresh-wt' / 'modules' / 'deps' / 'sub'))
        self.assertFalse((fresh / 'deps' / 'sub' / 'src').exists())  # main checkout not populated
        self.assertEqual(git(linked / 'deps' / 'sub', 'symbolic-ref', '-q', 'HEAD', check=False).returncode, 1)  # detached
        git(linked / 'deps' / 'sub', 'switch', '-q', '-c', 'design/x--F-X')
        head = commit(linked / 'deps' / 'sub', {'src/feature.txt': 'f\n'}, 'sub work')
        # The gitlink is tracked, never ignored: it is a separate parent scope entry.
        self.assertEqual(status_records(linked), [' M deps/sub'])
        self.assertNotEqual(git(linked, 'check-ignore', '-q', 'deps/sub', check=False).returncode, 0)
        git(linked, 'add', '--', 'deps/sub')
        git(linked, 'commit', '-q', '-m', 'pin', '--', 'deps/sub')
        self.assertEqual(out(linked, 'ls-tree', 'HEAD', '--', 'deps/sub').split()[2], head)
        self.assertEqual(status_records(fresh), [])  # other worktree untouched


class ParentToolsAndDependencyTests(World):
    def test_parent_filesystem_walk_sees_nested_checkout_git_enumeration_does_not(self):
        """O3: commands that walk the filesystem descend into .feature-repos; git-tracked ones do not."""
        exclude_task_dir(self.parent)
        alias = prepare_worktree(self.parent, self.src['child-a'], 'child-a', 'design/x', 'HEAD')
        walked = [str(p.relative_to(self.parent)) for p in self.parent.rglob('*.txt')]
        self.assertIn(f'{alias}/src/main.txt', walked)
        self.assertNotIn(f'{alias}/src/main.txt', zlist(self.parent, 'ls-files', '-z'))
        self.assertEqual(git(self.parent, 'grep', '-q', 'child-a', check=False).returncode, 1)
        # Parent `git clean`: one -f skips nested repositories but deletes loose task files;
        # a double -ff deletes the whole task directory with every child checkout. Dry runs only.
        write(self.parent / TASK_DIR / 'checkpoint.json', '{}\n')
        single = out(self.parent, 'clean', '-ndX')
        self.assertIn(f'Would skip repository {alias}', single)
        self.assertIn(f'Would remove {TASK_DIR}/checkpoint.json', single)
        self.assertIn('Would remove .feature-repos/', out(self.parent, 'clean', '-nffdX').splitlines())

    def test_build_through_symlinked_dependency_writes_shared_checkout(self):
        """AC-05: a correct child worktree with a dependency link into a shared checkout is not ready."""
        exclude_task_dir(self.parent)
        alias = prepare_worktree(self.parent, self.src['child-a'], 'child-a', 'design/x', 'HEAD')
        child = self.parent / alias
        (child / 'node_modules').mkdir()
        os.symlink(self.dep, child / 'node_modules' / 'dep')
        digest = ignored_digest(self.dep)
        self.assertEqual(os.path.realpath(child / 'node_modules' / 'dep'), str(self.dep))  # write target outside task
        write(child / 'node_modules' / 'dep' / 'dist' / 'out.js', 'built\n')  # "build" output, ignored in dep
        self.assertEqual(status_records(self.dep), [])  # default status is blind to the write
        self.assertIn('!! dist/', status_records(self.dep, ignored=True))
        self.assertNotEqual(ignored_digest(self.dep), digest)

    def test_read_only_dependency_untouched_keeps_digest(self):
        digest = ignored_digest(self.dep)
        (self.dep / 'lib.txt').read_text()
        self.assertEqual(ignored_digest(self.dep), digest)


class BranchAndReuseTests(World):
    def test_branch_collision_picks_new_name_and_keeps_foreign_branch(self):
        src = self.src['child-a']
        git(src, 'branch', 'design/x')
        foreign = commit(src, {'src/other.txt': 'o\n'}, 'other work')  # on main; move ref to it
        git(src, 'branch', '-f', 'design/x', foreign)
        name = pick_branch(src, 'design/x')
        self.assertEqual(name, f'design/x--{FEATURE}')
        exclude_task_dir(self.parent)
        prepare_worktree(self.parent, src, 'child-a', name, 'HEAD~1')
        self.assertEqual(out(src, 'rev-parse', 'design/x'), foreign)

    def test_reuse_requires_record_ancestry_and_no_unrecorded_commits(self):
        exclude_task_dir(self.parent)
        src = self.src['child-a']
        base = out(src, 'rev-parse', 'HEAD')
        alias = prepare_worktree(self.parent, src, 'child-a', 'design/x', base)
        child = self.parent / alias
        head = commit(child, {'src/a.txt': 'a\n'}, 'own')
        real = os.path.realpath(child)
        rec = {'feature': FEATURE, 'branch': 'design/x', 'base': base, 'head': head}
        self.assertEqual(reuse_proof(self.parent, rec, alias, real), 'reuse')
        self.assertIn('no committed record', reuse_proof(self.parent, None, alias, real))
        self.assertIn('feature or branch', reuse_proof(self.parent, {**rec, 'feature': 'F-Y'}, alias, real))
        later = commit(child, {'src/b.txt': 'b\n'}, 'unknown')
        self.assertIn('1 unrecorded', reuse_proof(self.parent, rec, alias, real))
        self.assertEqual(reuse_proof(self.parent, {**rec, 'later': [later]}, alias, real), 'reuse')
        self.assertIn('path changed', reuse_proof(self.parent, rec, alias, real + '-moved'))

    def test_same_branch_name_from_other_base_is_not_reuse(self):
        src = self.src['child-b']
        orphan_base = out(src, 'rev-parse', 'HEAD')
        git(src, 'switch', '-q', '--orphan', 'design/x')
        commit(src, {'z.txt': 'z\n'}, 'unrelated history')
        git(src, 'switch', '-q', 'main')
        exclude_task_dir(self.parent)
        (self.parent / TASK_DIR).mkdir(parents=True)
        git(src, 'worktree', 'add', '-q', str(self.parent / TASK_DIR / 'child-b'), 'design/x')
        alias = f'{TASK_DIR}/child-b'
        rec = {'feature': FEATURE, 'branch': 'design/x', 'base': orphan_base, 'head': orphan_base}
        self.assertIn('base is not an ancestor', reuse_proof(self.parent, rec, alias, os.path.realpath(self.parent / alias)))


class ReceiptTests(World):
    """A full multi-repo delivery: parent + two writable children + one read-only dependency."""

    def setUp(self):
        super().setUp()
        exclude_task_dir(self.parent)
        self.base = out(self.parent, 'rev-parse', 'HEAD')
        self.cbase = {r: out(self.src[r], 'rev-parse', 'HEAD') for r in self.src}
        self.alias = {r: prepare_worktree(self.parent, self.src[r], r, 'design/x', self.cbase[r]) for r in self.src}
        os.symlink(self.dep, self.parent / TASK_DIR / 'dep')
        self.digest = ignored_digest(self.dep)
        self.dep_head = out(self.dep, 'rev-parse', 'HEAD')
        self.contract = {'base': self.base, 'parent_scope': PARENT_SCOPE, 'repos': {
            r: {'alias': self.alias[r], 'realpath': os.path.realpath(self.parent / self.alias[r]),
                'base': self.cbase[r], 'scope': [f'{self.alias[r]}/src/**'], 'baseline': {}} for r in self.src}}
        self.contract['repos']['dep'] = {'alias': f'{TASK_DIR}/dep', 'realpath': str(self.dep),
                                         'base': self.dep_head, 'digest': self.digest}

    def deliver(self, mutate=None, evidence_extra=None, outcome='COMPLETE', worktree='clean', package=False):
        heads = {r: commit(self.parent / self.alias[r], {'src/feature.txt': f'{r}\n'}, f'{r} feature') for r in self.src}
        commit(self.parent, {'app/x.txt': 'x2\n'}, 'parent work')
        manifest = {'schema': 'multi-repo-v1', 'feature': FEATURE, 'task': TASK,
                    'parent': {'base': self.base, 'scope': PARENT_SCOPE},
                    'repos': [{'id': r, 'role': 'write', 'kind': 'worktree',
                               'source': {'locator': f'example/{r}', 'roots': [self.cbase[r]]},
                               'alias': self.alias[r], 'branch': 'design/x', 'target': 'main',
                               'base': self.cbase[r], 'head': heads[r], 'scope': [f'{self.alias[r]}/src/**'],
                               'dirt': {'baseline': [], 'final': []}} for r in sorted(self.src)] +
                             [{'id': 'dep', 'role': 'read', 'kind': 'existing', 'alias': f'{TASK_DIR}/dep',
                               'source': {'locator': 'example/dep'}, 'base': self.dep_head, 'head': self.dep_head,
                               'digest': self.digest, 'dirt': {}}],
                    'integration': {'tested_set': {**heads, 'dep': self.dep_head}, 'checks': ['npm test: 0']}}
        if mutate:
            mutate(manifest)
        raw = json.dumps(manifest, indent=1, sort_keys=True) + '\n'
        commit(self.parent, {LEDGER: '# ledger\n', SIDECAR: raw, **(evidence_extra or {})}, 'ledger and evidence sidecar')
        head = out(self.parent, 'rev-parse', 'HEAD')
        digest = hashlib.sha256(raw.encode()).hexdigest()
        lines = [f'DELIVERY=local-v1 BASE={self.base} HEAD={head} LEDGER={LEDGER} OUTCOME={outcome} WORKTREE={worktree}',
                 f'REPOS={SIDECAR} SHA256={digest}']
        if package:
            lines.append(f'PACKAGE=pkg/F-X-r01.zip SHA256={"c" * 64} PURPOSE=implementation-review RANGE={self.base}..{head} LEDGER={LEDGER}')
        return '\n'.join(lines + ['Implemented W-01 across three repositories.']), heads

    def test_complete_delivery_passes_and_has_no_self_hash_cycle(self):
        summary, heads = self.deliver(package=True)
        self.contract['package'] = True
        res = multi_receipt(self.parent, summary, self.contract)
        self.assertEqual(res, {'findings': [], 'outcome': 'COMPLETE'})
        head = summary.split('\n')[0].split('HEAD=')[1].split()[0]
        sidecar = out(self.parent, 'show', f'HEAD:{SIDECAR}')
        self.assertNotIn(head, sidecar)  # parent HEAD lives only in line 1
        self.assertLessEqual(len('\n'.join(summary.split('\n')[:3])), SUMMARY_MAX)
        changed = sorted(zlist(self.parent, 'diff', '--name-only', '-z', self.base, head) +
                         [f'{self.alias[r]}/{p}' for r in self.src
                          for p in zlist(self.parent / self.alias[r], 'diff', '--name-only', '-z', self.cbase[r], heads[r])])
        self.assertEqual(changed, sorted(['app/x.txt', LEDGER, SIDECAR, f'{self.alias["child-a"]}/src/feature.txt',
                                          f'{self.alias["child-b"]}/src/feature.txt']))  # flat changed_scope

    def test_clean_parent_does_not_mask_child_dirt(self):
        summary, _ = self.deliver()
        write(self.parent / self.alias['child-b'] / 'src' / 'wip.txt', 'unfinished\n')
        res = multi_receipt(self.parent, summary, self.contract)
        self.assertEqual(status_records(self.parent), [])
        self.assertEqual(res['outcome'], 'PARTIAL')
        self.assertTrue(any('own/overlap dirt in a COMPLETE' in x for x in res['findings']))

    def test_preexisting_child_dirt_is_reported_not_attributed(self):
        write(self.parent / self.alias['child-a'] / 'notes.txt', 'user\n')
        self.contract['repos']['child-a']['baseline'] = dirt_hashes(self.parent / self.alias['child-a'])

        def m(x):
            x['repos'][0]['dirt'] = {'baseline': [{'path': f'{self.alias["child-a"]}/notes.txt'}],
                                     'final': [{'path': f'{self.alias["child-a"]}/notes.txt', 'class': 'preexisting'}]}
        summary, _ = self.deliver(mutate=m)
        self.assertEqual(multi_receipt(self.parent, summary, self.contract)['findings'], [])

    def test_manifest_outside_contract_and_missing_repo(self):
        def m(x):
            x['repos'][1]['id'] = 'child-z'
            x['integration']['tested_set']['child-z'] = x['integration']['tested_set'].pop('child-b')
        summary, _ = self.deliver(mutate=m)
        f = multi_receipt(self.parent, summary, self.contract)['findings']
        self.assertIn('manifest repo outside contract: child-z', f)
        self.assertIn('contract repo missing from manifest: child-b', f)

    def test_sidecar_hash_mismatch_and_tampered_head(self):
        summary, _ = self.deliver()
        bad = re.sub(r'SHA256=[0-9a-f]{64}', 'SHA256=' + '0' * 64, summary, count=1)
        self.assertIn('sidecar SHA256 mismatch', multi_receipt(self.parent, bad, self.contract)['findings'])
        f = multi_receipt(self.parent, summary.split('\n')[0], self.contract)['findings']
        self.assertEqual(f, ['no REPOS line in a multi-repo contract'])

    def test_parent_head_field_in_manifest_is_rejected(self):
        summary, _ = self.deliver(mutate=lambda x: x['parent'].update(head='a' * 40))
        self.assertIn('parent carries exactly base and scope (no head: no self-hash cycle)',
                      multi_receipt(self.parent, summary, self.contract)['findings'])

    def test_sidecar_commit_with_code_after_checks_is_a_finding(self):
        # An executor bundling code into the post-check evidence commit.
        summary, _ = self.deliver(evidence_extra={'app/late.txt': 'late\n'})
        self.assertTrue(any('also changes non-evidence paths' in x
                            for x in multi_receipt(self.parent, summary, self.contract)['findings']))

    def test_child_path_outside_scope_and_drift_after_delivery(self):
        summary, _ = self.deliver()
        child = self.parent / self.alias['child-a']
        commit(child, {'README.md': 'later\n'}, 'post-delivery change')
        f = multi_receipt(self.parent, summary, self.contract)['findings']
        self.assertIn('child-a: checkout moved after delivery (integration drift, not attributed)', f)
        self.assertFalse(any('path outside scope' in x for x in f))  # the reviewed range is base..head
        self.contract['repos']['child-b']['scope'] = [f'{self.alias["child-b"]}/docs/**']
        f = multi_receipt(self.parent, summary, self.contract)['findings']
        self.assertIn(f'child-b: path outside scope: {self.alias["child-b"]}/src/feature.txt', f)

    def test_read_only_dependency_drift_is_caught(self):
        summary, _ = self.deliver()
        write(self.dep / 'dist' / 'out.js', 'built by a child command\n')
        self.assertIn('dep: read-only dependency drift or write', multi_receipt(self.parent, summary, self.contract)['findings'])

    def test_alias_collision_two_ids_one_checkout(self):
        summary, _ = self.deliver(mutate=lambda x: x['repos'][2].update(alias=self.alias['child-a'], digest='0' * 64))
        self.contract['repos']['dep']['alias'] = self.alias['child-a']
        self.contract['repos']['dep']['realpath'] = self.contract['repos']['child-a']['realpath']
        f = multi_receipt(self.parent, summary, self.contract)['findings']
        self.assertTrue(any('same physical checkout' in x for x in f))

    def test_tested_set_must_match_delivered_heads(self):
        summary, _ = self.deliver(mutate=lambda x: x['integration']['tested_set'].update({'child-a': 'b' * 40}))
        self.assertIn('child-a: tested version differs from delivered head',
                      multi_receipt(self.parent, summary, self.contract)['findings'])


class ManifestBoundsTests(unittest.TestCase):
    def entry(self, **kw):
        e = {'id': 'child-a', 'role': 'write', 'kind': 'worktree', 'alias': f'{TASK_DIR}/child-a',
             'branch': 'b', 'target': 'main', 'base': 'a' * 40, 'head': 'b' * 40,
             'scope': [f'{TASK_DIR}/child-a/**'], 'source': {'locator': 'example/a'}, 'dirt': {}}
        e.update(kw)
        return e

    def doc(self, repos, **kw):
        d = {'schema': 'multi-repo-v1', 'feature': FEATURE, 'task': TASK,
             'parent': {'base': 'c' * 40, 'scope': PARENT_SCOPE}, 'repos': repos}
        d.update(kw)
        return json.dumps(d).encode()

    def test_well_formed(self):
        self.assertEqual(validate_manifest(self.doc([self.entry()])), [])

    def test_bounds_and_portability(self):
        cases = {
            'absolute alias': self.entry(alias='/home/u/child'),
            'dotdot alias': self.entry(alias='../child'),
            'scope outside alias': self.entry(scope=['app/**']),
            'unknown key': self.entry(realpath='/tmp/x'),
            'short sha': self.entry(head='abc'),
            'read with scope': self.entry(role='read', head='a' * 40, digest='d'),
            'gitlink on worktree': self.entry(gitlink='deps/sub'),
            'absolute source': self.entry(source={'locator': '/srv/git/a'}),
        }
        for name, e in cases.items():
            with self.subTest(name):
                self.assertNotEqual(validate_manifest(self.doc([e])), [])
        self.assertNotEqual(validate_manifest(self.doc([self.entry(id=f'r{i}') for i in range(33)])), [])
        self.assertNotEqual(validate_manifest(self.doc([self.entry(), self.entry()])), [])
        self.assertNotEqual(validate_manifest(b'{' + b' ' * 70000 + b'}'), [])
        self.assertNotEqual(validate_manifest(self.doc([self.entry()], extra=1)), [])

    def test_summary_lines_fit_worst_case(self):
        path = 'docs/features/' + 'f' * 120 + '/execution/' + 't' * 40 + '/99.repos.json'
        delivery = f'DELIVERY=local-v1 BASE={"a" * 40} HEAD={"b" * 40} LEDGER={path[:-11]}.md OUTCOME=COMPLETE WORKTREE=dirty:99999'
        repos = f'REPOS={path} SHA256={"c" * 64}'
        package = f'PACKAGE={"p" * 512} SHA256={"d" * 64} PURPOSE=implementation-review RANGE={"a" * 40}..{"b" * 40} LEDGER={path[:-11]}.md'
        self.assertLessEqual(len('\n'.join([delivery, repos, package])), 1600)  # < 4000 with room for prose
        self.assertTrue(REPOS.match(repos) and PACKAGE.match(package) and DELIVERY.match(delivery))


class PartialIntegrationTests(World):
    def test_dependency_first_interrupted_merge_stays_partial_and_resumes(self):
        a, b = self.src['child-a'], self.src['child-b']
        for repo in (a, b):
            git(repo, 'switch', '-q', '-c', 'design/x')
            commit(repo, {'src/f.txt': 'f\n'}, 'feature')
            git(repo, 'switch', '-q', 'main')
            commit(repo, {'src/main2.txt': 'm\n'}, 'concurrent main work')  # forces a non-FF merge
        delivered_a = out(a, 'rev-parse', 'design/x')
        order = ['child-a', 'child-b', 'parent']
        rec = {r: {'state': 'pending', 'integrated': None} for r in order}
        git(a, 'merge', '-q', '--no-edit', 'design/x')
        rec['child-a'] = {'state': 'merged', 'integrated': out(a, 'rev-parse', 'HEAD')}
        self.assertNotEqual(rec['child-a']['integrated'], delivered_a)  # new SHA: retest, not inherit
        # interruption here: child-b not merged
        self.assertEqual(integration_status(rec, order), {'status': 'PARTIAL', 'next': 'child-b'})
        main_a = out(a, 'rev-parse', 'main')
        git(b, 'merge', '-q', '--no-edit', 'design/x')
        rec['child-b'] = {'state': 'merged', 'integrated': out(b, 'rev-parse', 'HEAD')}
        rec['parent'] = {'state': 'merged', 'integrated': out(self.main, 'rev-parse', 'HEAD')}
        rec['pins'] = [{'path': 'deps/child-a', 'repo': 'child-a', 'pinned': delivered_a}]
        self.assertEqual(integration_status(rec, order)['status'], 'PARTIAL')  # pin still names delivered SHA
        rec['pins'][0]['pinned'] = rec['child-a']['integrated']
        self.assertEqual(integration_status(rec, order), {'status': 'COMPLETE', 'next': None})
        self.assertEqual(out(a, 'rev-parse', 'main'), main_a)  # resume did not redo/reset child-a


if __name__ == '__main__':
    unittest.main()
