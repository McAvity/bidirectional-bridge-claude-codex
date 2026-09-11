#!/usr/bin/env python3
"""Export feature evidence and stage document returns. Never changes repository files."""
import argparse
import hashlib
import json
import re
from pathlib import Path, PurePosixPath
import stat
import subprocess
import sys
import zipfile

MANIFEST = 'exchange-manifest.json'
MAX_BYTES = 50 * 1024 * 1024
MAX_FILES = 3000


def fail(message):
    raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def safe_path(value):
    if not isinstance(value, str) or not value or '\\' in value or '\x00' in value:
        fail('Invalid path')
    p = PurePosixPath(value)
    if p.is_absolute() or any(x in ('', '.', '..') for x in value.split('/')) or ':' in value:
        fail('Unsafe path: ' + value)
    return value


def local_path(root, name):
    safe_path(name)
    path = root / name
    if not path.resolve().is_relative_to(root.resolve()):
        fail('Path escapes root: ' + name)
    current = root
    for part in PurePosixPath(name).parts:
        current = current / part
        if current.is_symlink():
            fail('Symlink is not supported: ' + name)
    return path


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args], stderr=subprocess.PIPE)


def repo_root(value):
    return Path(git(Path(value), 'rev-parse', '--show-toplevel').decode().strip()).resolve()


def commit_id(value):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9a-f]{40}|[0-9a-f]{64}', value):
        fail('Invalid commit id in code_range: ' + repr(value))
    return value


def range_changes(root, base, head):
    """Name-status entries between two commits, in manifest form."""
    tokens = git(root, 'diff', '--name-status', '-z', '-M', base, head, '--').split(b'\0')
    changes, pos = [], 0
    while pos < len(tokens) and tokens[pos]:
        kind = tokens[pos].decode(); pos += 1
        old = tokens[pos].decode('utf-8'); pos += 1
        entry = {'status': kind, 'path': safe_path(old)}
        if kind.startswith(('R', 'C')):
            name = tokens[pos].decode('utf-8'); pos += 1
            entry = {'status': kind, 'old_path': safe_path(old), 'path': safe_path(name)}
        changes.append(entry)
    return changes


def encode(obj):
    return (json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True) + '\n').encode()


def archive_read(path):
    result = {}
    with zipfile.ZipFile(Path(path).expanduser()) as z:
        infos = z.infolist()
        if len(infos) > MAX_FILES or sum(i.file_size for i in infos) > MAX_BYTES:
            fail('Archive exceeds limits (3000 entries / 50 MiB)')
        for info in infos:
            name = info.filename.rstrip('/') if info.is_dir() else info.filename
            safe_path(name)
            if stat.S_ISLNK(info.external_attr >> 16):
                fail('Archive contains symlink: ' + name)
            if info.is_dir():
                continue
            if name in result:
                fail('Duplicate archive path: ' + name)
            result[name] = z.read(info)
    return result


def export(args):
    root = repo_root(args.repo)
    feature = safe_path(args.feature.rstrip('/'))
    if not feature.startswith('docs/features/') or len(PurePosixPath(feature).parts) != 3:
        fail('--feature must be docs/features/<feature-id>')
    directory = local_path(root, feature)
    if not directory.is_dir():
        fail('Feature directory does not exist')
    if args.head and not args.base:
        fail('--head requires --base')
    index_path = directory / 'feature.json'
    index = json.loads(index_path.read_text()) if index_path.exists() else {}
    if index and index.get('schema_version') != 1:
        fail('Unsupported feature.json schema')
    tasks = index.get('tasks', [])
    context = index.get('context_files', [])
    if not isinstance(tasks, list) or not isinstance(context, list):
        fail('tasks and context_files must be arrays')
    for task in tasks:
        safe_path(task)
        if not task.startswith('work-items/') or not task.endswith('.md'):
            fail('Task must be a Markdown path under work-items/: ' + task)
    blobs, records = {}, {}
    total = 0

    def add(name, data, source):
        nonlocal total
        safe_path(name)
        if name in blobs:
            if blobs[name] != data:
                fail('Different snapshots selected for ' + name)
            return
        total += len(data)
        if total > MAX_BYTES or len(blobs) >= MAX_FILES - 1:
            fail('Selected content exceeds 50 MiB / 2999 files; narrow context')
        blobs[name] = data
        records[name] = {'sha256': sha(data), 'size': len(data), 'source': source}

    selected = set(tasks + context + ['docs/features/README.md'])
    for p in directory.rglob('*'):
        if p.is_symlink():
            fail('Feature contains symlink: ' + str(p))
        if p.is_file():
            if p.name == '.DS_Store' or p.name.startswith('._'):
                continue
            if p.suffix.lower() == '.zip':
                fail('Move ZIP files outside the feature directory before export')
            selected.add(p.relative_to(root).as_posix())
    for name in sorted(selected):
        p = local_path(root, name)
        if not p.is_file():
            fail('Missing selected file: ' + name)
        if p.stat().st_size > MAX_BYTES:
            fail('Selected file exceeds size limit: ' + name)
        add(name, p.read_bytes(), 'worktree')
    current_head = git(root, 'rev-parse', 'HEAD').decode().strip()
    status = git(root, 'status', '--porcelain=v1', '-z', '--untracked-files=all')
    code_range = None
    changes = []
    if args.base:
        base = git(root, 'rev-parse', '--verify', args.base + '^{commit}').decode().strip()
        head = git(root, 'rev-parse', '--verify', (args.head or 'HEAD') + '^{commit}').decode().strip()
        code_range = {'base': base, 'head': head, 'includes_uncommitted_code': False}
        diff = git(root, 'diff', '--binary', '--full-index', base, head, '--')
        add('exchange/code.diff', diff, 'committed-range')
        changes = range_changes(root, base, head)
        for entry in changes:
            if entry['status'] != 'D':
                name = entry['path']
                # Separate namespace prevents mixing current docs with committed bytes.
                tree = git(root, 'ls-tree', head, '--', name).decode()
                if tree.startswith(('120000 ', '160000 ')):
                    entry['snapshot_omitted'] = 'symlink or submodule; see diff'
                    continue
                add('exchange/code/' + name, git(root, 'show', head + ':' + name), 'commit:' + head)
    manifest = {
        'schema_version': 1, 'purpose': args.purpose, 'feature': feature,
        'feature_id': index.get('feature_id', directory.name), 'tasks': tasks,
        'repository_head': current_head, 'worktree_dirty': bool(status),
        'document_source': 'current worktree bytes; hashes below identify the snapshot',
        'code_range': code_range, 'code_changes': changes,
        'limitations': ['Not a full repository. Unselected context is absent.',
                        'Tests and acceptance claims are not verified by this exporter.',
                        'Uncommitted product changes are not in the committed code diff.'],
        'files': records,
    }
    output = Path(args.output).expanduser().resolve()
    if output.is_relative_to(directory.resolve()):
        fail('Output ZIP must be outside the feature directory')
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr(MANIFEST, encode(manifest))
        for name, data in sorted(blobs.items()):
            z.writestr(name, data)
    print(json.dumps({'archive': str(output), 'files': len(blobs), 'bytes': total,
                      'code_range': code_range, 'worktree_dirty': bool(status)}, indent=2))


def checked_manifest(entries, label):
    """Validate an exported archive against its own manifest; return the manifest."""
    if MANIFEST not in entries:
        fail(label + ' ZIP must contain exchange-manifest.json')
    manifest = json.loads(entries[MANIFEST])
    if not isinstance(manifest, dict) or manifest.get('schema_version') != 1:
        fail('Unsupported manifest schema')
    records = manifest.get('files')
    if not isinstance(records, dict) or not isinstance(manifest.get('tasks'), list):
        fail('Malformed manifest: files must be an object and tasks an array')
    if set(entries) != set(records) | {MANIFEST}:
        fail(label + ' archive file list does not match manifest')
    for name, rec in records.items():
        if sha(entries[name]) != rec['sha256'] or len(entries[name]) != rec['size']:
            fail(label + ' archive content mismatch: ' + name)
    feature = safe_path(manifest['feature'])
    if not feature.startswith('docs/features/') or len(PurePosixPath(feature).parts) != 3:
        fail('Invalid feature root in manifest')
    for task in manifest['tasks']:
        if not task.startswith('work-items/') or not task.endswith('.md'):
            fail('Invalid registered task path')
    return manifest


def verify(args):
    root = repo_root(args.repo)
    archive = Path(args.archive).expanduser().resolve()
    entries = archive_read(archive)
    manifest = checked_manifest(entries, 'Exported')
    for key, expected in (('purpose', args.expect_purpose), ('feature', args.expect_feature)):
        if expected is not None and manifest[key] != expected.rstrip('/'):
            fail(f'Manifest {key} is {manifest[key]!r}, expected {expected!r}')
    code_range = manifest['code_range']
    for key, expected in (('head', args.expect_head), ('base', args.expect_base)):
        if expected is not None:
            commit = git(root, 'rev-parse', '--verify', expected + '^{commit}').decode().strip()
            if not code_range or code_range.get(key) != commit:
                fail(f'Manifest code_range {key} does not match --expect-{key} {commit}')
    matches = None
    if code_range:
        base, head = commit_id(code_range.get('base')), commit_id(code_range.get('head'))
        for commit in (base, head):
            if subprocess.run(['git', '-C', str(root), 'cat-file', '-e', commit + '^{commit}'],
                              capture_output=True).returncode:
                fail('Commit from code_range is absent in this repository: ' + commit)
        if entries.get('exchange/code.diff') != git(root, 'diff', '--binary', '--full-index', base, head, '--'):
            fail('exchange/code.diff does not match git diff of the declared code_range')
        declared = [{k: v for k, v in c.items() if k != 'snapshot_omitted'} for c in manifest['code_changes']]
        if declared != range_changes(root, base, head):
            fail('Manifest code_changes do not match git diff --name-status of the declared code_range')
        for change in manifest['code_changes']:
            if change['status'] == 'D' or 'snapshot_omitted' in change:
                continue
            name = 'exchange/code/' + change['path']
            if entries.get(name) != git(root, 'show', head + ':' + change['path']):
                fail('Code snapshot does not match declared head: ' + change['path'])
        matches = True
    documents = sorted(n for n in entries if n != MANIFEST and not n.startswith('exchange/'))
    changed, missing = [], []
    for name in documents:
        p = local_path(root, name)
        if not p.is_file():
            missing.append(name)
        elif p.read_bytes() != entries[name]:
            changed.append(name)
    print(json.dumps({
        'archive': str(archive), 'archive_sha256': sha(archive.read_bytes()), 'integrity': 'ok',
        'purpose': manifest['purpose'], 'feature': manifest['feature'], 'tasks': manifest['tasks'],
        'repository_head_at_export': manifest['repository_head'],
        'worktree_dirty_at_export': manifest['worktree_dirty'], 'code_range': code_range,
        'code_range_matches_repository': matches,
        'code_changes': len(manifest['code_changes']) if code_range else None,
        'documents': {'files': documents, 'changed': changed, 'missing': missing},
        'note': 'Integrity and provenance only. Not a review, test run or approval.',
    }, indent=2))


def inspect_return(args):
    root = repo_root(args.repo)
    original, incoming = archive_read(args.original), archive_read(args.incoming)
    if MANIFEST not in original or MANIFEST not in incoming:
        fail('Both ZIPs must contain exchange-manifest.json')
    if incoming[MANIFEST] != original[MANIFEST]:
        fail('Incoming manifest differs from original; preserve original manifest unchanged')
    manifest = checked_manifest(original, 'Original')
    feature = manifest['feature']
    tasks = set(manifest['tasks'])
    stage = Path(args.staging).expanduser().resolve()
    if stage.is_relative_to(root) or stage.exists():
        fail('Staging must be a new directory outside the repository')
    report, pending = [], []
    for name, data in sorted(incoming.items()):
        if name == MANIFEST or original.get(name) == data:
            continue
        allowed = (name.startswith(feature + '/') and Path(name).suffix in ('.md', '.json')) or name in tasks
        if not allowed:
            fail('Changed/new path outside document return scope: ' + name)
        p = local_path(root, name)
        if p.exists() and not p.is_file():
            fail('Target is not a regular file: ' + name)
        current = p.read_bytes() if p.exists() else None
        base = original.get(name)
        classification = 'already-present' if current == data else ('apply' if current == base else 'conflict')
        report.append({'path': name, 'classification': classification,
                       'base_sha256': sha(base) if base is not None else None,
                       'local_sha256': sha(current) if current is not None else None,
                       'incoming_sha256': sha(data)})
        pending.append((name, data))
    stage.mkdir(parents=True)
    for name, data in pending:
        p = local_path(stage, name); p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(data)
    summary = {'feature': feature, 'changes': report, 'missing_files_mean_deletion': False,
               'original': str(Path(args.original).expanduser().resolve()), 'incoming': str(Path(args.incoming).expanduser().resolve()),
               'note': 'No repository files changed. Recheck local hashes before applying. Review semantic authority separately.'}
    (stage / 'return-report.json').write_bytes(encode(summary))
    print(json.dumps({'staging': str(stage), 'changes': len(report),
                      'conflicts': sum(r['classification'] == 'conflict' for r in report)}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    exp = sub.add_parser('export', help='Export current documents plus optional committed code range')
    exp.add_argument('--repo', default='.')
    exp.add_argument('--feature', required=True)
    exp.add_argument('--purpose', required=True, choices=['plan-review', 'contract-review', 'implementation-review', 'decision', 'corrections-review'])
    exp.add_argument('--output', required=True, help='New ZIP path under ~/tmp; ~ is expanded')
    exp.add_argument('--base')
    exp.add_argument('--head')
    exp.set_defaults(run=export)
    ver = sub.add_parser('verify', help='Check an exported ZIP against its manifest and this repository')
    ver.add_argument('--repo', default='.')
    ver.add_argument('--archive', required=True, help='Exported ZIP; ~ is expanded')
    ver.add_argument('--expect-purpose')
    ver.add_argument('--expect-feature')
    ver.add_argument('--expect-head', help='Commit the code_range head must resolve to')
    ver.add_argument('--expect-base', help='Commit the code_range base must resolve to')
    ver.set_defaults(run=verify)
    imp = sub.add_parser('inspect-return', help='Compare original/return/local and stage documents without applying')
    imp.add_argument('--repo', default='.')
    imp.add_argument('--original', required=True, help='Preserved original ZIP under ~/tmp; ~ is expanded')
    imp.add_argument('--incoming', required=True, help='Returned ZIP under ~/tmp; ~ is expanded')
    imp.add_argument('--staging', required=True, help='New staging directory under ~/tmp, outside repo; ~ is expanded')
    imp.set_defaults(run=inspect_return)
    args = parser.parse_args()
    try:
        args.run(args)
    except (ValueError, OSError, KeyError, TypeError, zipfile.BadZipFile, subprocess.CalledProcessError) as exc:
        print('feature-exchange: ' + str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
