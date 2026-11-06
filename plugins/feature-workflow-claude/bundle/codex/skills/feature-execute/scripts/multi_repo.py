#!/usr/bin/env python3
"""Read-only multi-repo checks for feature-execute (F-W20, contract 01-multi-repo).

Subcommands print one JSON document and exit 0 when every check holds, 1 when a check fails
or cannot be established (unknown is never a pass), and 2 for unusable input. The helper never
writes a file, never changes Git state (status runs without optional locks), never creates,
moves or removes a checkout, and never executes a command named in a manifest or contract:
those are data. It prepares nothing; the agent prepares checkouts with ordinary Git following
references/multi-repo.md and uses this helper to check the result.

The repo map is passed by reference: `preflight`, `reuse` and `receipt` refuse a map without the
`--sha256` the round contract names, a map whose bytes differ, and a map that is not a regular
file. The map is data, never authorization: with `--round-scope` every glob it lists must already
be in the round's own scope.

  reference  print the short `REPO_MAP=<path> SHA256=<hash>` line a round contract carries
  identity   facts about one alias: realroot, per-worktree gitdir, common dir, branch, HEAD
  preflight  check a round contract's repo map before dependent writes
  digest     bounded byte digest of a read-only dependency (ignored files included)
  reuse      decide whether an existing checkout may be reused from a record
  manifest   validate a multi-repo-v1 evidence sidecar
  receipt    coordinator receipt of a multi-repo delivery against the contract and Git
  integration  status of a dependency-first integration record, verified against Git
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path, PurePosixPath

CONTRACT_SCHEMA = 'multi-repo-contract-v1'
MANIFEST_SCHEMA = 'multi-repo-v1'
INTEGRATION_SCHEMA = 'multi-repo-integration-v1'
SUMMARY_MAX = 4000
BOUNDS = {'json_bytes': 65536, 'repos': 32, 'scope': 64, 'dirt': 200, 'path': 256, 'glob': 512,
          'bindings': 64, 'digest_files': 10000, 'digest_bytes': 256 << 20}
SHA_RE = re.compile(r'^(?:[0-9a-f]{40}|[0-9a-f]{64})$')
HEX64_RE = re.compile(r'^[0-9a-f]{64}$')
ID_RE = re.compile(r'^[a-z0-9][a-z0-9._-]{0,63}$')
DELIVERY_RE = re.compile(r'^DELIVERY=local-v1 BASE=([0-9a-f]{40}|[0-9a-f]{64}) HEAD=([0-9a-f]{40}|[0-9a-f]{64}) '
                         r'LEDGER=(\S+) OUTCOME=(COMPLETE|PARTIAL) WORKTREE=(clean|dirty:(\d+))$')
REPOS_RE = re.compile(r'^REPOS=(\S+) SHA256=([0-9a-f]{64})$')
PACKAGE_RE = re.compile(r'^PACKAGE=(\S+) SHA256=([0-9a-f]{64}) PURPOSE=(\S+) RANGE=(\S+)\.\.(\S+) LEDGER=(\S+)$')
DIRT_CLASSES = ('preexisting', 'own', 'overlap', 'foreign', 'attempt')
GIT_SELECTION_ENV = ('GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
                     'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE')


class InputError(Exception):
    """Unusable input: exit 2."""


# --- Git -------------------------------------------------------------------------------------

def git_env():
    """Without inherited repository selection (as feature_exchange.py) and without optional locks,
    so `git status` never refreshes an index: every Git call here is a read."""
    env = {k: v for k, v in os.environ.items() if k not in GIT_SELECTION_ENV}
    env['GIT_OPTIONAL_LOCKS'] = '0'
    return env


def git(cwd, *args):
    return subprocess.run(['git', '--no-optional-locks', '-C', str(cwd), *args], capture_output=True, env=git_env())


def git_out(cwd, *args):
    p = git(cwd, *args)
    if p.returncode:
        raise GitError(f'git {" ".join(args[:3])} failed in {cwd}: {p.stderr.decode(errors="replace").strip()}')
    return p.stdout.decode('utf-8', errors='surrogateescape')


class GitError(Exception):
    pass


def git_ok(cwd, *args):
    return git(cwd, *args).returncode == 0


def zsplit(text):
    return [x for x in text.split('\0') if x]


def is_commit(cwd, sha):
    return git_ok(cwd, 'cat-file', '-e', f'{sha}^{{commit}}')


def is_ancestor(cwd, a, b):
    return git_ok(cwd, 'merge-base', '--is-ancestor', a, b)


def status_entries(repo):
    """`status --porcelain=v1 -z --untracked-files=all`, rename/copy records keep both paths."""
    fields = git_out(repo, 'status', '--porcelain=v1', '-z', '--untracked-files=all').split('\0')
    out, i = [], 0
    while i < len(fields):
        rec = fields[i]
        i += 1
        if not rec:
            continue
        xy, path = rec[:2], rec[3:]
        orig = None
        if 'R' in xy or 'C' in xy:
            orig = fields[i] if i < len(fields) else None
            i += 1
        out.append({'xy': xy, 'path': path, 'orig': orig})
    return out


def path_bytes_id(root, rel):
    f = Path(root) / rel
    if f.is_symlink():
        return 'symlink:' + hashlib.sha256(os.readlink(f).encode('utf-8', 'surrogateescape')).hexdigest()
    if f.is_file():
        return git_out(root, 'hash-object', '--', rel).strip()
    if f.is_dir():
        return 'dir'
    return 'deleted'


def dirt_record(repo):
    """Start/final record: path -> `git hash-object` (or deleted/dir/symlink:<sha256>)."""
    rec = {}
    for e in status_entries(repo):
        for p in (e['path'], e['orig']):
            if p:
                rec[p] = path_bytes_id(repo, p)
    return rec


# --- paths and globs (scope.ts semantics) -----------------------------------------------------

def portable(value, limit=BOUNDS['path']):
    if not isinstance(value, str) or not value or len(value) > limit or '\\' in value or '\0' in value:
        return False
    if value.startswith('/') or re.match(r'^[A-Za-z]:', value):
        return False
    parts = value.rstrip('/').split('/')
    return all(p not in ('', '.', '..') for p in parts)


def glob_re(glob):
    """Port of globToRegExp in shared/protocol/src/scope.ts."""
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


def symlink_component(parent, alias):
    cur = Path(parent)
    for part in PurePosixPath(alias).parts:
        cur = cur / part
        if cur.is_symlink():
            return str(cur.relative_to(parent))
    return None


def real(p):
    return os.path.realpath(p)


def inside(child, root):
    return child == root or child.startswith(root.rstrip(os.sep) + os.sep)


# --- schemas ------------------------------------------------------------------------------------

def _keys(obj, allowed, required, where, errs):
    if not isinstance(obj, dict):
        errs.append(f'{where}: must be an object')
        return False
    extra = sorted(set(obj) - set(allowed))
    missing = sorted(set(required) - set(obj))
    if extra:
        errs.append(f'{where}: unknown keys {extra}')
    if missing:
        errs.append(f'{where}: missing keys {missing}')
    return not extra and not missing


def _sha(v, where, errs):
    if not isinstance(v, str) or not SHA_RE.match(v):
        errs.append(f'{where}: not a full lowercase SHA')


def _globs(v, where, errs, prefix=None, required=True):
    if not isinstance(v, list) or (required and not v) or len(v) > BOUNDS['scope']:
        errs.append(f'{where}: 1..{BOUNDS["scope"]} globs required' if required else f'{where}: list of globs')
        return
    for g in v:
        if not portable(g, BOUNDS['glob']):
            errs.append(f'{where}: non-portable glob {g!r}')
        elif prefix and not g.startswith(prefix.rstrip('/') + '/'):
            errs.append(f'{where}: glob {g!r} is not under alias {prefix!r}')


def validate_contract(c):
    """`multi-repo-contract-v1`: the coordinator's repo map (bridge contract/checkpoint, not Git)."""
    errs = []
    if not _keys(c, ('schema', 'feature', 'task', 'parent', 'repos'), ('schema', 'feature', 'task', 'parent', 'repos'),
                 'contract', errs):
        return errs
    if c['schema'] != CONTRACT_SCHEMA:
        errs.append(f'contract: schema must be {CONTRACT_SCHEMA}')
    for k in ('feature', 'task'):
        if not isinstance(c[k], str) or not re.match(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$', c[k]):
            errs.append(f'contract.{k}: invalid id')
    p = c['parent']
    if _keys(p, ('root', 'base', 'scope', 'ledger_dir', 'package', 'baseline'), ('root', 'base', 'scope', 'ledger_dir'),
             'contract.parent', errs):
        _baseline(p.get('baseline', {}), 'contract.parent.baseline', errs)
        if not isinstance(p['root'], str) or not os.path.isabs(p['root']):
            errs.append('contract.parent.root: absolute path required')
        _sha(p['base'], 'contract.parent.base', errs)
        _globs(p['scope'], 'contract.parent.scope', errs)
        if not portable(p['ledger_dir']) or not p['ledger_dir'].endswith('/'):
            errs.append('contract.parent.ledger_dir: portable directory ending in /')
        if 'package' in p and not isinstance(p['package'], bool):
            errs.append('contract.parent.package: boolean')
    repos = c['repos']
    if not isinstance(repos, dict) or not 1 <= len(repos) <= BOUNDS['repos']:
        errs.append(f'contract.repos: 1..{BOUNDS["repos"]} entries')
        return errs
    common = ('role', 'kind', 'alias', 'realpath', 'git_dir', 'base')
    for rid, e in repos.items():
        w = f'contract.repos.{rid}'
        if not isinstance(rid, str) or not ID_RE.match(rid) or rid == 'parent':
            errs.append(f'{w}: invalid repo id')
        role = e.get('role') if isinstance(e, dict) else None
        if role == 'write':
            ok = _keys(e, common + ('branch', 'target', 'scope', 'baseline', 'gitlink', 'external_access_verified',
                                    'bindings'), ('role', 'kind', 'alias', 'realpath', 'base', 'branch', 'target',
                                                  'scope'), w, errs)
        elif role == 'read':
            ok = _keys(e, common + ('digest', 'bindings'), ('role', 'kind', 'alias', 'realpath', 'base'), w, errs)
        else:
            errs.append(f'{w}: role must be write or read')
            continue
        if not ok:
            continue
        if e['kind'] not in ('worktree', 'clone', 'submodule', 'existing'):
            errs.append(f'{w}.kind: invalid')
        if not portable(e['alias']):
            errs.append(f'{w}.alias: portable parent-relative path required')
        for k in ('realpath', 'git_dir'):
            if k in e and (not isinstance(e[k], str) or not os.path.isabs(e[k])):
                errs.append(f'{w}.{k}: absolute path required')
        _sha(e['base'], f'{w}.base', errs)
        if role == 'write':
            for k in ('branch', 'target'):
                if not isinstance(e[k], str) or not e[k] or len(e[k]) > 255 or not git_ref_ok(e[k]):
                    errs.append(f'{w}.{k}: invalid branch name')
            _globs(e['scope'], f'{w}.scope', errs, prefix=e['alias'] if portable(e['alias']) else None)
            _baseline(e.get('baseline', {}), f'{w}.baseline', errs)
            if 'external_access_verified' in e and not isinstance(e['external_access_verified'], bool):
                errs.append(f'{w}.external_access_verified: boolean')
            if 'gitlink' in e and (e['kind'] != 'submodule' or not portable(e['gitlink'])):
                errs.append(f'{w}.gitlink: portable path, submodule only')
            if e['kind'] == 'submodule' and 'gitlink' not in e:
                errs.append(f'{w}.gitlink: required for a submodule')
        else:
            if 'digest' in e and (not isinstance(e['digest'], str) or not HEX64_RE.match(e['digest'])):
                errs.append(f'{w}.digest: 64 hex')
        bl = e.get('bindings', [])
        if not isinstance(bl, list) or len(bl) > BOUNDS['bindings'] or any(not portable(x) for x in bl):
            errs.append(f'{w}.bindings: list of portable paths relative to the alias')
    return errs


def _baseline(b, where, errs):
    if not isinstance(b, dict) or len(b) > BOUNDS['dirt'] or any(
            not isinstance(k, str) or not portable(k) or not isinstance(v, str) for k, v in b.items()):
        errs.append(f'{where}: object portable path -> hash, at most {BOUNDS["dirt"]}')


def git_ref_ok(name):
    return bool(re.match(r'^[A-Za-z0-9._/-]+$', name)) and '..' not in name and not name.startswith(('-', '/')) \
        and not name.endswith(('/', '.lock')) and '//' not in name


def validate_manifest(raw):
    """`multi-repo-v1` sidecar. Returns (errors, manifest or None)."""
    if len(raw) > BOUNDS['json_bytes']:
        return [f'manifest exceeds {BOUNDS["json_bytes"]} bytes'], None
    try:
        m = json.loads(raw.decode('utf-8'))
    except (UnicodeDecodeError, ValueError) as e:
        return [f'manifest is not UTF-8 JSON: {e}'], None
    errs = []
    if not _keys(m, ('schema', 'feature', 'task', 'parent', 'repos', 'integration'),
                 ('schema', 'feature', 'task', 'parent', 'repos'), 'manifest', errs):
        return errs, None
    if m['schema'] != MANIFEST_SCHEMA:
        errs.append(f'manifest.schema must be {MANIFEST_SCHEMA}')
    for k in ('feature', 'task'):
        if not isinstance(m[k], str):
            errs.append(f'manifest.{k}: string')
    if _keys(m['parent'], ('base', 'scope'), ('base', 'scope'), 'manifest.parent (no head: no self-hash cycle)', errs):
        _sha(m['parent']['base'], 'manifest.parent.base', errs)
        _globs(m['parent']['scope'], 'manifest.parent.scope', errs)
    repos = m['repos']
    if not isinstance(repos, list) or not 1 <= len(repos) <= BOUNDS['repos']:
        return errs + [f'manifest.repos: 1..{BOUNDS["repos"]} entries'], None
    seen = set()
    allowed = ('id', 'role', 'kind', 'source', 'alias', 'branch', 'target', 'base', 'head', 'scope', 'gitlink',
               'dirt', 'digest')
    for i, r in enumerate(repos):
        w = f'manifest.repos[{i}]'
        if not _keys(r, allowed, ('id', 'role', 'kind', 'alias', 'base', 'head'), w, errs):
            continue
        if not isinstance(r['id'], str) or not ID_RE.match(r['id']) or r['id'] in seen:
            errs.append(f'{w}.id: invalid or duplicate')
        seen.add(r['id'])
        if r['role'] not in ('write', 'read') or r['kind'] not in ('worktree', 'clone', 'submodule', 'existing'):
            errs.append(f'{w}: invalid role/kind')
        if not portable(r['alias']):
            errs.append(f'{w}.alias: portable path required')
        _sha(r['base'], f'{w}.base', errs)
        _sha(r['head'], f'{w}.head', errs)
        if r['role'] == 'read':
            if r.get('scope') or r['head'] != r['base'] or not isinstance(r.get('digest'), str) \
                    or not HEX64_RE.match(r.get('digest', '')):
                errs.append(f'{w}: read entry has no scope, head == base and a 64-hex digest')
        elif r['role'] == 'write':
            for k in ('branch', 'target'):
                if not isinstance(r.get(k), str) or not r.get(k):
                    errs.append(f'{w}.{k}: required for write')
            _globs(r.get('scope'), f'{w}.scope', errs, prefix=r['alias'] if portable(r['alias']) else None)
        if 'gitlink' in r and (r['kind'] != 'submodule' or not portable(r['gitlink'])):
            errs.append(f'{w}.gitlink: submodule only, portable')
        src = r.get('source', {})
        if not _keys(src, ('locator', 'roots'), (), f'{w}.source', errs) or any(
                not isinstance(v, (str, list)) or (isinstance(v, str) and (v.startswith('/') or '\\' in v))
                for v in src.values()):
            errs.append(f'{w}.source: portable locator and root commits')
        dirt = r.get('dirt', {})
        if _keys(dirt, ('baseline', 'final', 'more'), (), f'{w}.dirt', errs):
            for k in ('baseline', 'final'):
                lst = dirt.get(k, [])
                if not isinstance(lst, list) or len(lst) > BOUNDS['dirt']:
                    errs.append(f'{w}.dirt.{k}: at most {BOUNDS["dirt"]} entries')
                    continue
                for d in lst:
                    if not isinstance(d, dict) or not isinstance(d.get('path'), str) or not portable(d['path']) or \
                            set(d) - {'path', 'class'} or ('class' in d and d['class'] not in DIRT_CLASSES):
                        errs.append(f'{w}.dirt.{k}: entries are {{path, class}}')
            if 'more' in dirt and (not isinstance(dirt['more'], int) or dirt['more'] < 0):
                errs.append(f'{w}.dirt.more: non-negative integer')
    if 'integration' in m:
        it = m['integration']
        if _keys(it, ('tested_set', 'checks'), ('tested_set',), 'manifest.integration', errs):
            ts = it['tested_set']
            if not isinstance(ts, dict) or set(ts) != seen:
                errs.append('manifest.integration.tested_set must name every repo')
            else:
                for r in repos:
                    if isinstance(r, dict) and ts.get(r.get('id')) != r.get('head'):
                        errs.append(f'{r.get("id")}: tested version differs from delivered head')
            if not isinstance(it.get('checks', []), list) or any(not isinstance(x, str) for x in it.get('checks', [])):
                errs.append('manifest.integration.checks: list of strings (recorded, never executed)')
    for s in iter_strings(m):
        if s.startswith('/') or re.match(r'^[A-Za-z]:\\', s):
            errs.append('manifest: absolute host path is not portable')
            break
    return errs, (m if not errs else None)


def iter_strings(o):
    if isinstance(o, str):
        yield o
    elif isinstance(o, dict):
        for k, v in o.items():
            yield k
            yield from iter_strings(v)
    elif isinstance(o, list):
        for v in o:
            yield from iter_strings(v)


# --- facts ----------------------------------------------------------------------------------------

def identity(parent, alias):
    path = Path(parent) / alias
    facts = {'alias': alias, 'exists': os.path.lexists(path), 'symlink_component': symlink_component(parent, alias),
             'realpath': real(path)}
    facts['inside_parent'] = facts['symlink_component'] is None and inside(facts['realpath'], real(parent)) and \
        facts['realpath'] != real(parent)
    if not path.is_dir():
        facts['error'] = 'alias is not an existing directory'
        return facts
    try:
        facts['toplevel'] = real(git_out(path, 'rev-parse', '--show-toplevel').strip())
        facts['git_dir'] = real(git_out(path, 'rev-parse', '--absolute-git-dir').strip())
        common = git_out(path, 'rev-parse', '--git-common-dir').strip()
        facts['common_dir'] = real(common if os.path.isabs(common) else path / common)
        facts['branch'] = git(path, 'symbolic-ref', '-q', '--short', 'HEAD').stdout.decode().strip() or None
        facts['head'] = git_out(path, 'rev-parse', 'HEAD').strip()
    except GitError as e:
        facts['error'] = str(e)
        return facts
    facts['checkout_root'] = facts['toplevel'] == facts['realpath']
    return facts


def parent_identity(root):
    return {'realpath': real(root), 'git_dir': real(git_out(root, 'rev-parse', '--absolute-git-dir').strip())}


def clashes(rid, idents, pfacts):
    """Every other entry, and the parent, that is the same checkout as `rid` (order-independent)."""
    me = idents[rid]
    out = ['parent'] if pfacts and same_checkout(pfacts, me) else []
    out += sorted(k for k, v in idents.items() if k != rid and 'error' not in v and same_checkout(v, me))
    return out


def same_checkout(a, b):
    """One checkout = same realroot or same per-worktree gitdir. A shared common dir is not."""
    return a['realpath'] == b['realpath'] or (a.get('git_dir') is not None and a.get('git_dir') == b.get('git_dir'))


def digest(repo, max_files=BOUNDS['digest_files'], max_bytes=BOUNDS['digest_bytes']):
    """HEAD, status records and the bytes of every changed, untracked and ignored file, enumerated
    per file; symlinks contribute their target text, never followed. None: bound exceeded."""
    root = Path(repo)
    h = hashlib.sha256(git_out(repo, 'rev-parse', 'HEAD').strip().encode() + b'\0')
    entries = status_entries(repo)
    paths = set()
    for e in sorted(entries, key=lambda x: (x['path'], x['xy'])):
        h.update(f'{e["xy"]} {e["path"]} {e["orig"] or ""}'.encode('utf-8', 'surrogateescape') + b'\0')
        paths.add(e['path'])
    paths |= set(zsplit(git_out(repo, 'ls-files', '-z', '--others', '--exclude-standard')))
    paths |= set(zsplit(git_out(repo, 'ls-files', '-z', '--others', '--ignored', '--exclude-standard')))
    if len(paths) > max_files:
        return None
    total = 0
    for rel in sorted(paths):
        f = root / rel
        h.update(rel.encode('utf-8', 'surrogateescape') + b'\0')
        if f.is_symlink():
            h.update(b'L' + os.readlink(f).encode('utf-8', 'surrogateescape') + b'\0')
        elif f.is_file():
            size = f.stat().st_size
            total += size
            if total > max_bytes:
                return None
            h.update(b'F' + str(size).encode() + b'\0')
            with open(f, 'rb') as fh:
                for chunk in iter(lambda: fh.read(1 << 20), b''):
                    h.update(chunk)
        else:
            h.update(b'D' if f.is_dir() else b'-')
    return h.hexdigest()


def classify(final, baseline, alias, scope):
    """local-delivery § 3.4 per repo, by path and bytes. Paths are reported alias-prefixed."""
    out = {}
    for p, h in final.items():
        full = f'{alias}/{p}' if alias else p
        if p in baseline:
            out[full] = 'preexisting' if baseline[p] == h else ('overlap' if matches(full, scope) else 'preexisting')
        else:
            out[full] = 'own' if matches(full, scope) else 'foreign'
    return out


def range_paths(repo, base, head):
    return set(zsplit(git_out(repo, 'diff', '--no-renames', '--name-only', '-z', base, head))) | \
        set(zsplit(git_out(repo, 'log', '--no-renames', '--name-only', '-z', '--format=', f'{base}..{head}')))


# --- preflight -------------------------------------------------------------------------------------

def preflight(c):
    parent = c['parent']['root']
    result = {'ok': True, 'parent': {}, 'repos': {}}
    pfacts = None
    if not Path(parent).is_dir() or real(parent) != parent:
        result['parent']['reasons'] = ['parent root is not an existing canonical directory']
    else:
        try:
            pfacts = parent_identity(parent)
            if real(git_out(parent, 'rev-parse', '--show-toplevel').strip()) != parent:
                result['parent']['reasons'] = ['parent root is not its checkout root']
            elif not is_commit(parent, c['parent']['base']):
                result['parent']['reasons'] = ['parent base commit missing']
        except GitError as e:
            result['parent']['reasons'] = [str(e)]
    result['parent'].setdefault('reasons', [])
    if pfacts:
        now = dirt_record(parent)
        base = c['parent'].get('baseline', {})
        result['parent']['dirt'] = now
        changed = sorted(x for x in set(now) | set(base) if now.get(x) != base.get(x))
        if changed:
            result['parent']['notes'] = [f'parent dirt differs from the contract baseline: {changed[:20]}']
    reads = {rid: e for rid, e in c['repos'].items() if e['role'] == 'read'}
    idents = {rid: identity(parent, e['alias']) for rid, e in c['repos'].items()}
    for rid, e in sorted(c['repos'].items()):
        reasons, notes = [], []
        f = idents[rid]
        entry = {'facts': f, 'reasons': reasons, 'notes': notes}
        result['repos'][rid] = entry
        if 'error' in f or not f.get('checkout_root'):
            reasons.append(f.get('error') or 'alias is not a checkout root (plain directory or nested path)')
            continue
        if f['realpath'] != e['realpath']:
            reasons.append('alias does not resolve to the contract realpath')
        if 'git_dir' in e and f['git_dir'] != e['git_dir']:
            reasons.append('per-worktree gitdir differs from the contract (checkout replaced)')
        reasons.extend(f'same physical checkout as {k}' for k in clashes(rid, idents, pfacts))
        if e['role'] == 'write':
            if not f['inside_parent']:
                if not e.get('external_access_verified'):
                    reasons.append('external alias without verified write access for both roles: '
                                   'use a physical checkout inside the parent')
                else:
                    notes.append('external alias: access recorded as verified; lease remains textual')
            elif e['kind'] == 'submodule':
                stage = git_out(parent, 'ls-files', '-s', '--', e['gitlink']).split()
                if not stage or stage[0] != '160000':
                    reasons.append('submodule gitlink is not tracked in the parent')
                if git_ok(parent, 'check-ignore', '-q', '--no-index', '--', e['gitlink']):
                    reasons.append('submodule gitlink is ignored')
                if e['gitlink'] != e['alias']:
                    reasons.append('submodule alias must be its gitlink path')
            else:
                if not git_ok(parent, 'check-ignore', '-q', '--no-index', '--', e['alias'] + '/'):
                    reasons.append('child checkout is not ignored by the parent (add the task directory to '
                                   'info/exclude)')
            if f['branch'] != e['branch']:
                reasons.append(f'checkout is on {f["branch"] or "a detached HEAD"}, not {e["branch"]}')
            if not is_commit(f['realpath'], e['base']):
                reasons.append('base commit missing in the checkout')
            elif not is_ancestor(f['realpath'], e['base'], 'HEAD'):
                reasons.append('base is not an ancestor of HEAD')
            now = dirt_record(f['realpath'])
            base = e.get('baseline', {})
            changed = sorted(p for p in set(now) | set(base) if now.get(p) != base.get(p))
            entry['dirt'] = now
            if changed:
                notes.append(f'dirt differs from the contract baseline: {changed[:20]}')
            commits = git_out(f['realpath'], 'rev-list', f'{e["base"]}..HEAD').split() \
                if is_commit(f['realpath'], e['base']) else []
            entry['commits_after_base'] = len(commits)
        else:
            if f['head'] != e['base']:
                reasons.append('read-only dependency HEAD differs from the contract base')
            d = digest(f['realpath'])
            entry['digest'] = d
            if d is None:
                reasons.append('read-only dependency not fully observable (digest bound exceeded)')
            elif 'digest' in e and d != e['digest']:
                reasons.append('read-only dependency changed since the contract digest')
            elif 'digest' not in e:
                notes.append('record this digest in the contract')
        entry['bindings'] = {}
        for b in e.get('bindings', []):
            target = real(Path(f['realpath']) / b)
            owner = next((k for k, v in c['repos'].items() if inside(target, real(v['realpath']))), None)
            if not os.path.exists(target):
                kind = 'missing'
                reasons.append(f'binding {b} does not resolve')
            elif owner == rid:
                kind = 'own'
            elif owner in reads:
                kind = f'read:{owner}'
                notes.append(f'binding {b} resolves into read-only {owner}: commands must not write there')
            elif owner:
                kind = f'write:{owner}'
            elif pfacts and inside(target, pfacts['realpath']):
                kind = 'parent'
            else:
                kind = 'foreign'
                reasons.append(f'binding {b} resolves outside the task environment: fix the binding '
                               'inside the task or block dependent commands')
            entry['bindings'][b] = kind
    result['ok'] = not result['parent']['reasons'] and all(not r['reasons'] for r in result['repos'].values())
    return result


# --- reuse -------------------------------------------------------------------------------------------

def reuse(c, rid, record):
    """record['kind']: checkpoint | contract | delivered (contract § 4)."""
    e = c['repos'].get(rid)
    if not e:
        raise InputError(f'repo {rid} is not in the contract')
    if not record:
        return {'decision': 'blocked', 'reason': 'no checkpoint, contract or committed record '
                                                  '(a branch name alone proves nothing)'}
    kind = record.get('kind')
    need = {'checkpoint': ('feature', 'repo', 'branch', 'base', 'realroot', 'git_dir', 'branch_created',
                           'initial_dirt'),
            'contract': ('feature', 'repo', 'branch', 'base', 'realroot'),
            'delivered': ('feature', 'repo', 'branch', 'base', 'head')}.get(kind)
    if need is None:
        raise InputError('record.kind must be checkpoint, contract or delivered')
    missing = [k for k in need if k not in record]
    if missing:
        raise InputError(f'record misses {missing}')
    f = identity(c['parent']['root'], e['alias'])
    blocked = lambda why: {'decision': 'blocked', 'reason': why, 'facts': f}  # noqa: E731
    if 'error' in f or not f.get('checkout_root'):
        return blocked('alias is not an existing checkout root')
    if f['realpath'] != e['realpath'] or record.get('realroot', f['realpath']) != f['realpath']:
        return blocked('checkout path changed; rerun placement checks')
    if 'git_dir' in record and record['git_dir'] != f['git_dir']:
        return blocked('gitdir differs from the checkpoint (checkout replaced)')
    if record['feature'] != c['feature'] or record['repo'] != rid or f['branch'] != record['branch']:
        return blocked('feature, repo or branch differs from the record')
    if not is_commit(f['realpath'], record['base']) or not is_ancestor(f['realpath'], record['base'], 'HEAD'):
        return blocked('recorded base is not an ancestor')
    commits = git_out(f['realpath'], 'rev-list', '--reverse', f'{record["base"]}..HEAD').split()
    if kind == 'checkpoint':
        if commits and not record['branch_created']:
            return blocked(f'{len(commits)} unrecorded commit(s) after the base on a branch setup did not create')
        init = record['initial_dirt']
        dirt = {p: ('preexisting' if init.get(p) == h else 'overlap') if p in init else 'attempt'
                for p, h in dirt_record(f['realpath']).items()}
        return {'decision': 'reuse', 'inventory': {'commits': commits, 'dirt': dirt}, 'facts': f}
    if kind == 'contract':
        dirty = dirt_record(f['realpath'])
        if commits or dirty:
            return blocked(f'checkpoint lost; ownership unresolved for {len(commits)} commit(s) and '
                           f'{len(dirty)} dirty path(s)')
        return {'decision': 'reuse', 'inventory': {'commits': [], 'dirt': {}}, 'facts': f}
    if not is_commit(f['realpath'], record['head']) or not is_ancestor(f['realpath'], record['head'], 'HEAD'):
        return blocked('recorded head is not an ancestor')
    later = set(record.get('later', []))
    unexplained = [x for x in git_out(f['realpath'], 'rev-list', f'{record["head"]}..HEAD').split()
                   if x not in later]
    if unexplained:
        return blocked(f'{len(unexplained)} unrecorded commit(s) after the recorded head')
    return {'decision': 'reuse', 'inventory': {'commits': commits, 'dirt': {}}, 'facts': f}


# --- receipt ---------------------------------------------------------------------------------------------

def check_receipt(c, summary):
    """Coordinator receipt (contract § 12 + local-delivery § 4 for the parent)."""
    parent = c['parent']['root']
    F = []
    res = {'outcome': 'PARTIAL', 'claimed': None, 'findings': F, 'repos': {}}
    lines = summary.split('\n')
    d = DELIVERY_RE.match(lines[0])
    if not d:
        F.append('line 1 is not a local-v1 delivery line')
        return res
    base, head, ledger, outcome, worktree = d.group(1, 2, 3, 4, 5)
    res['claimed'] = outcome
    if len('\n'.join(lines[:3 if c['parent'].get('package') else 2])) > SUMMARY_MAX:
        F.append('critical lines exceed the stored summary')
    if base != c['parent']['base']:
        F.append('parent BASE differs from the contract')
    if not is_commit(parent, head):
        F.append('parent HEAD missing')
        return res
    if not is_ancestor(parent, base, head):
        F.append('parent HEAD does not descend from BASE')
        return res
    if git_out(parent, 'rev-list', '--merges', f'{base}..{head}').strip():
        F.append('unexpected merge in the parent range')
    ldir = c['parent']['ledger_dir']
    for p in sorted(range_paths(parent, base, head)):
        if not matches(p, c['parent']['scope']):
            F.append(f'parent path outside scope: {p}')
    if not ledger.startswith(ldir) or ledger not in zsplit(git_out(parent, 'diff', '--no-renames', '--diff-filter=A',
                                                                  '--name-only', '-z', base, head, '--', ledger)):
        F.append('ledger not added in range under the contract ledger directory')
    earlier = set(zsplit(git_out(parent, 'ls-tree', '-r', '-z', '--name-only', base, '--', ldir)))
    touched = set(zsplit(git_out(parent, 'log', '--no-renames', '--name-only', '-z', '--format=', f'{base}..{head}',
                                 '--', ldir)))
    if earlier & touched:
        F.append(f'earlier ledger touched: {sorted(earlier & touched)}')
    # R20-E01: the parent's own uncommitted work counts like a child's (local-delivery § 3.4).
    pclasses = classify(dirt_record(parent), c['parent'].get('baseline', {}), '', c['parent']['scope'])
    res['parent'] = {'dirt': pclasses}
    pbad = sorted(x for x, k in pclasses.items() if k in ('own', 'overlap'))
    if pbad and outcome == 'COMPLETE':
        F.append(f'parent: own/overlap dirt in a COMPLETE delivery: {pbad[:20]}')
    rp = REPOS_RE.match(lines[1]) if len(lines) > 1 else None
    if not rp:
        F.append('line 2 is not a REPOS line in a multi-repo contract')
        return res
    if c['parent'].get('package') and not (len(lines) > 2 and PACKAGE_RE.match(lines[2])):
        F.append('the contract requires a package: line 3 must be PACKAGE')
    sidecar, digest_claim = rp.group(1, 2)
    if not portable(sidecar) or not sidecar.startswith(ldir):
        F.append('sidecar path must be portable and inside the ledger directory')
        return res
    for commit in git_out(parent, 'log', '--format=%H', f'{base}..{head}', '--', sidecar).split():
        names = zsplit(git_out(parent, 'show', '--no-renames', '--name-only', '-z', '--format=', commit))
        if any(not n.startswith(ldir) for n in names):
            F.append(f'sidecar commit {commit[:12]} also changes non-evidence paths')
    shown = git(parent, 'show', f'{head}:{sidecar}')
    if shown.returncode:
        F.append('sidecar not in parent HEAD')
        return res
    raw = shown.stdout
    if hashlib.sha256(raw).hexdigest() != digest_claim:
        F.append('sidecar SHA256 mismatch')
    errs, m = validate_manifest(raw)
    if errs:
        F.extend(errs)
        return res
    if (m['feature'], m['task'], m['parent']['base']) != (c['feature'], c['task'], c['parent']['base']):
        F.append('manifest feature, task or parent base differ from the contract')
    ids = {r['id'] for r in m['repos']}
    F.extend(f'manifest repo outside contract: {x}' for x in sorted(ids - set(c['repos'])))
    F.extend(f'contract repo missing from manifest: {x}' for x in sorted(set(c['repos']) - ids))
    pfacts = parent_identity(parent)
    idents = {r['id']: identity(parent, c['repos'][r['id']]['alias']) for r in m['repos'] if r['id'] in c['repos']}
    partial = outcome == 'PARTIAL' or bool(pbad)
    for r in m['repos']:
        e = c['repos'].get(r['id'])
        if not e:
            continue
        rid = r['id']
        rep = {'findings': []}
        res['repos'][rid] = rep
        fr = rep['findings']
        if r['alias'] != e['alias'] or r['role'] != e['role'] or r['kind'] != e['kind']:
            fr.append('alias, role or kind differs from the contract')
            continue
        f = idents[rid]
        rep['facts'] = f
        if 'error' in f or not f.get('checkout_root') or f['realpath'] != e['realpath']:
            fr.append('alias does not resolve to the contract checkout root')
            continue
        if 'git_dir' in e and f['git_dir'] != e['git_dir']:
            fr.append('per-worktree gitdir differs from the contract')
        fr.extend(f'same physical checkout as {k}' for k in clashes(rid, idents, pfacts))
        if r['role'] == 'read':
            now = digest(f['realpath'])
            if 'digest' not in e:
                fr.append('contract records no digest for the read-only dependency')
            elif now is None:
                fr.append('read-only dependency not fully observable')
            elif r['head'] != e['base'] or f['head'] != e['base'] or now != e['digest'] or r['digest'] != e['digest']:
                fr.append('read-only dependency drift or write')
            continue
        if r['base'] != e['base'] or r['branch'] != e['branch'] or r['target'] != e['target']:
            fr.append('base, branch or target differs from the contract')
        if r['scope'] != e['scope']:
            fr.append('manifest scope differs from the contract')
        if not is_commit(f['realpath'], r['head']) or not is_ancestor(f['realpath'], e['base'], r['head']):
            fr.append('head missing or not descending from the contract base')
            continue
        if git_out(f['realpath'], 'rev-list', '--merges', f'{e["base"]}..{r["head"]}').strip():
            fr.append('unexpected merge in range')
        for p in sorted(range_paths(f['realpath'], e['base'], r['head'])):
            if not matches(f'{e["alias"]}/{p}', e['scope']):
                fr.append(f'path outside scope: {e["alias"]}/{p}')
        if f['branch'] != e['branch']:
            fr.append('checkout is not on the contract branch')
        if f['head'] != r['head']:
            rep['drift'] = f'checkout HEAD {f["head"][:12]} differs from delivered head (integration drift, ' \
                           'not attributed)'
        classes = classify(dirt_record(f['realpath']), e.get('baseline', {}), e['alias'], e['scope'])
        rep['dirt'] = classes
        bad = sorted(p for p, k in classes.items() if k in ('own', 'overlap'))
        if bad:
            partial = True
            if outcome == 'COMPLETE':
                fr.append(f'own/overlap dirt in a COMPLETE delivery: {bad[:20]}')
        listed = sorted(x['path'] for x in r.get('dirt', {}).get('final', []))
        if len(classes) <= BOUNDS['dirt'] and listed != sorted(classes):
            fr.append('manifest final dirt differs from the checkout')
        if e['kind'] == 'submodule':
            pinned = git_out(parent, 'ls-tree', '-z', head, '--', e['gitlink']).split()
            if len(pinned) < 3 or pinned[2] != r['head']:
                fr.append('parent gitlink at HEAD does not pin the delivered head')
    for rid, rep in res['repos'].items():
        F.extend(f'{rid}: {x}' for x in rep['findings'])
    n = len(status_entries(parent))
    if worktree != ('clean' if n == 0 else f'dirty:{n}'):
        F.append(f'parent WORKTREE misreported (actual {"clean" if n == 0 else f"dirty:{n}"})')
    res['outcome'] = 'PARTIAL' if partial or F else outcome
    return res


# --- integration ---------------------------------------------------------------------------------------

def integration(record):
    errs = []
    if not _keys(record, ('schema', 'order', 'repos', 'pins'), ('schema', 'order', 'repos'), 'integration', errs):
        raise InputError('; '.join(errs))
    if record['schema'] != INTEGRATION_SCHEMA or not isinstance(record['order'], list) or \
            not isinstance(record['repos'], dict) or set(record['order']) != set(record['repos']):
        raise InputError('integration: schema, order and repos must agree')
    out = {'status': 'COMPLETE', 'next': None, 'repos': {}, 'findings': []}
    for rid in record['order']:
        e = record['repos'][rid]
        if not _keys(e, ('path', 'target', 'delivered', 'state', 'integrated'), ('path', 'target', 'delivered', 'state'),
                     f'integration.repos.{rid}', errs) or e['state'] not in ('pending', 'merged', 'failed'):
            raise InputError('; '.join(errs) or f'integration.repos.{rid}.state invalid')
        st = {'state': e['state']}
        out['repos'][rid] = st
        if e['state'] != 'merged':
            if out['next'] is None:
                out['next'] = rid
            continue
        p = e['path']
        integ = e.get('integrated')
        if not integ or not is_commit(p, integ):
            out['findings'].append(f'{rid}: integrated commit missing')
        elif not is_ancestor(p, e['delivered'], integ):
            out['findings'].append(f'{rid}: integrated commit does not contain the delivered head')
        elif not is_ancestor(p, integ, e['target']):
            out['findings'].append(f'{rid}: integrated commit is not on target {e["target"]}')
        else:
            st['verified'] = True
            st['retest_required'] = integ != e['delivered']
    for pin in record.get('pins', []):
        owner = record['repos'].get('parent')
        tgt = record['repos'].get(pin.get('repo'))
        if not owner or not tgt or owner['state'] != 'merged' or tgt['state'] != 'merged':
            out['next'] = out['next'] or f'pin {pin.get("path")}'
            continue
        tree = git_out(owner['path'], 'ls-tree', '-z', owner['integrated'], '--', pin['path']).split()
        if len(tree) < 3 or tree[2] != tgt['integrated']:
            out['findings'].append(f'pin {pin["path"]} does not name the integrated {pin["repo"]} commit')
    if out['next'] or out['findings']:
        out['status'] = 'PARTIAL'
    return out


# --- CLI -------------------------------------------------------------------------------------------------

def load_json(path):
    try:
        data = Path(path).read_bytes() if path != '-' else sys.stdin.buffer.read()
    except OSError as e:
        raise InputError(f'cannot read {path}: {e.strerror}')
    if len(data) > BOUNDS['json_bytes']:
        raise InputError(f'{path}: larger than {BOUNDS["json_bytes"]} bytes')
    try:
        return json.loads(data.decode('utf-8'))
    except (UnicodeDecodeError, ValueError) as e:
        raise InputError(f'{path}: not UTF-8 JSON: {e}')


def read_map(path, sha=None, required=True):
    """The map file named by the round contract's `REPO_MAP=<path> SHA256=<hash>` reference."""
    if required and not sha:
        raise InputError('the map is passed by reference: give --sha256 from the round contract\'s '
                         'REPO_MAP=<path> SHA256=<hash> line')
    if sha is not None and not HEX64_RE.match(sha):
        raise InputError('--sha256 must be 64 lowercase hex')
    try:
        st = os.lstat(path)
    except OSError as e:
        raise InputError(f'map {path} is not readable: {e.strerror}')
    import stat as _stat
    if not _stat.S_ISREG(st.st_mode):
        raise InputError(f'map {path} must be a regular file, not a symlink or directory')
    if st.st_size > BOUNDS['json_bytes']:
        raise InputError(f'map {path} is larger than {BOUNDS["json_bytes"]} bytes')
    data = Path(path).read_bytes()
    digest_now = hashlib.sha256(data).hexdigest()
    if sha is not None and digest_now != sha:
        raise InputError(f'map {path} does not match the reference SHA256 (refusing before any check)')
    try:
        c = json.loads(data.decode('utf-8'))
    except (UnicodeDecodeError, ValueError) as e:
        raise InputError(f'{path}: not UTF-8 JSON: {e}')
    errs = validate_contract(c)
    if errs:
        raise InputError('invalid contract: ' + '; '.join(errs[:20]))
    return c, digest_now


def load_contract(path, sha, round_scope=None):
    c, digest_now = read_map(path, sha)
    if round_scope is not None:
        listed = list(c['parent']['scope']) + [g for e in c['repos'].values() for g in e.get('scope', [])]
        missing = [g for g in listed if g not in round_scope]
        if missing:
            raise InputError(f'map globs not in the round scope (the map is not authorization): {missing[:20]}')
    return c, {'path': os.path.abspath(path), 'sha256': digest_now}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)
    s = sub.add_parser('reference')
    s.add_argument('--contract', required=True)
    s = sub.add_parser('identity')
    s.add_argument('--parent', required=True)
    s.add_argument('--alias', required=True)
    s = sub.add_parser('preflight')
    s.add_argument('--contract', required=True)
    s.add_argument('--sha256')
    s.add_argument('--round-scope', action='append', help='a glob of the round scope.paths; repeat for each')
    s = sub.add_parser('digest')
    s.add_argument('--repo', required=True)
    s.add_argument('--max-files', type=int, default=BOUNDS['digest_files'])
    s.add_argument('--max-bytes', type=int, default=BOUNDS['digest_bytes'])
    s = sub.add_parser('reuse')
    s.add_argument('--contract', required=True)
    s.add_argument('--sha256')
    s.add_argument('--repo', required=True)
    s.add_argument('--record', help='record JSON; omit when no record exists')
    s = sub.add_parser('manifest')
    s.add_argument('--file', required=True)
    s = sub.add_parser('receipt')
    s.add_argument('--contract', required=True)
    s.add_argument('--sha256')
    s.add_argument('--summary', required=True, help='file holding the stored summary, - for stdin')
    s = sub.add_parser('integration')
    s.add_argument('--record', required=True)
    a = ap.parse_args(argv)
    try:
        if a.cmd == 'reference':
            _, digest_now = read_map(a.contract, required=False)
            path = os.path.abspath(a.contract)
            if any(ch.isspace() for ch in path):
                raise InputError('the map path must not contain whitespace')
            out = {'line': f'REPO_MAP={path} SHA256={digest_now}', 'path': path, 'sha256': digest_now}
            ok = True
        elif a.cmd == 'identity':
            if not portable(a.alias):
                raise InputError('alias must be a portable parent-relative path')
            out = identity(real(a.parent), a.alias)
            ok = 'error' not in out and out.get('checkout_root', False)
        elif a.cmd == 'preflight':
            c, ref = load_contract(a.contract, a.sha256, a.round_scope)
            out = preflight(c)
            out['map'] = ref
            ok = out['ok']
        elif a.cmd == 'digest':
            if not Path(a.repo).is_dir():
                raise InputError('repository directory required')
            d = digest(a.repo, a.max_files, a.max_bytes)
            out = {'digest': d, 'observable': d is not None}
            ok = d is not None
        elif a.cmd == 'reuse':
            c, ref = load_contract(a.contract, a.sha256)
            out = reuse(c, a.repo, load_json(a.record) if a.record else None)
            out['map'] = ref
            ok = out['decision'] == 'reuse'
        elif a.cmd == 'manifest':
            try:
                raw = Path(a.file).read_bytes()
            except OSError as e:
                raise InputError(f'cannot read {a.file}: {e.strerror}')
            errs, _ = validate_manifest(raw)
            out = {'valid': not errs, 'errors': errs, 'sha256': hashlib.sha256(raw).hexdigest()}
            ok = not errs
        elif a.cmd == 'receipt':
            c, ref = load_contract(a.contract, a.sha256)
            try:
                summary = (Path(a.summary).read_bytes() if a.summary != '-' else sys.stdin.buffer.read()).decode('utf-8')
            except (OSError, UnicodeDecodeError) as e:
                raise InputError(f'cannot read summary: {e}')
            out = check_receipt(c, summary)
            out['map'] = ref
            ok = not out['findings']
        else:
            out = integration(load_json(a.record))
            ok = out['status'] == 'COMPLETE'
    except InputError as e:
        print(json.dumps({'error': str(e)}), file=sys.stdout)
        return 2
    except GitError as e:
        print(json.dumps({'error': str(e), 'unknown': True}), file=sys.stdout)
        return 1
    print(json.dumps(out, indent=1, sort_keys=True))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
