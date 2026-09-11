"""Codex launch helpers for bridge pilots (operator-only).

  python3 codex_args.py args <repo>             NUL-separated `-c key=value` args defining the bridge
                                                MCP server from <repo>/.codex/config.toml, plus a
                                                per-invocation trust override for <repo>
  python3 codex_args.py session <repo> [since]  unique top-level CLI session id whose cwd is <repo>
                                                (optionally started at/after ISO time `since`)
Nothing is written; ~/.codex is only read.
"""
import json
import sys
import tomllib
from pathlib import Path


def dotted(prefix, value, out):
    if isinstance(value, dict):
        for key, sub in value.items():
            dotted(f'{prefix}.{key}', sub, out)
    else:
        out.append(f'{prefix}={json.dumps(value)}')


def launch_args(repo):
    repo = Path(repo).resolve()
    config = tomllib.loads((repo / '.codex/config.toml').read_text())
    out = [f'projects."{repo}".trust_level="trusted"']
    dotted('mcp_servers.bridge', config['mcp_servers']['bridge'], out)
    return out


def sessions(repo):
    """Yield (timestamp, session_id, rollout_path) for Codex sessions started in <repo>."""
    repo = str(Path(repo).resolve())
    for path in Path.home().glob('.codex/sessions/*/*/*/rollout-*.jsonl'):
        try:
            with path.open(encoding='utf-8') as handle:
                first = json.loads(handle.readline())
        except (OSError, ValueError):
            continue
        meta = first.get('payload') or {}
        if first.get('type') == 'session_meta' and meta.get('cwd') == repo:
            yield meta.get('timestamp', ''), meta.get('id') or meta.get('session_id'), path


def is_manager_meta(meta):
    """Top-level interactive session (Astra). Shared with collect.py."""
    # source is immutable provenance: resuming guardian with Astra does not make it
    # the manager. Never select by newest timestamp or current model alone.
    return meta.get('source') == 'cli' and meta.get('originator') == 'codex-tui'


def manager_session(repo, since=''):
    found = []
    for timestamp, session_id, path in sessions(repo):
        if timestamp < since:
            continue
        with path.open(encoding='utf-8') as handle:
            meta = json.loads(handle.readline()).get('payload', {})
        if is_manager_meta(meta):
            found.append(session_id)
    if len(found) != 1:
        raise ValueError(f'expected exactly one top-level Astra CLI session, found {len(found)}; do not guess a session')
    return found[0]


def main():
    command, repo = sys.argv[1], sys.argv[2]
    if command == 'args':
        sys.stdout.write('\0'.join(a for arg in launch_args(repo) for a in ('-c', arg)))
    elif command == 'session':
        since = sys.argv[3] if len(sys.argv) > 3 else ''
        try:
            print(manager_session(repo, since))
        except ValueError as exc:
            sys.exit(str(exc))
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main()
