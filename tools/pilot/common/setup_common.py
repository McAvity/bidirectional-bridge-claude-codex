"""Shared setup helpers for pilot scenarios (operator-only).

Everything is resolved from this checkout: the bridge launcher, the workflow skills and the
using-bridge skills. Machine-specific values (node, claude, HOME, PATH) are discovered at setup time
and written only into the generated run directory, never into the repository.
"""
import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
LAUNCHER = ROOT / 'scripts/native-bridge-mcp.mjs'
BUILD_MARKER = ROOT / 'shared/control-plane/dist/feature-workflow.js'
WORKFLOW_SKILLS = ROOT / '.agents'
FEATURES_README = ROOT / 'docs/features/README.md'
USING_BRIDGE = {'codex': ROOT / '.codex/skills/using-bridge', 'claude': ROOT / '.claude/skills/using-bridge'}
MANAGER_GIT = ('astra-codex', 'astra-codex@pilot.invalid')
EXECUTOR_GIT = ('claude-executor', 'claude-executor@pilot.invalid')
SETUP_GIT = ('pilot-setup', 'pilot-setup@pilot.invalid')


def tree_hash(root):
    h = hashlib.sha256()
    for p in sorted(q for q in Path(root).rglob('*') if q.is_file() and '__pycache__' not in q.parts):
        h.update(p.relative_to(root).as_posix().encode() + b'\0' + p.read_bytes() + b'\0')
    return h.hexdigest()


def toml_str(value):
    return json.dumps(str(value))


def codex_config(repo, node, claude, title='Bridge pilot'):
    """Project-local MCP definition for the manager; astra.sh passes it as `-c` overrides."""
    path_dirs = [str(Path(node).parent), str(Path(claude).parent), '/usr/local/bin', '/usr/bin', '/bin']
    env = {
        'HOME': os.environ['HOME'],
        'PATH': os.pathsep.join(dict.fromkeys(path_dirs)),
        'LANG': os.environ.get('LANG', 'C.UTF-8'),
        'GIT_AUTHOR_NAME': EXECUTOR_GIT[0], 'GIT_AUTHOR_EMAIL': EXECUTOR_GIT[1],
        'GIT_COMMITTER_NAME': EXECUTOR_GIT[0], 'GIT_COMMITTER_EMAIL': EXECUTOR_GIT[1],
    }
    lines = [
        f'# {title} — bridge MCP for the Codex manager (Astra). Generated for this machine.',
        '# The executor (Claude) commits under its own git identity through the env below;',
        '# the manager commits with the repository identity.',
        '[mcp_servers.bridge]',
        f'command = {toml_str(node)}',
        'args = [' + ', '.join(toml_str(a) for a in [LAUNCHER, '--caller', 'codex', '--delegation', 'allow', '--workspace', repo]) + ']',
        f'cwd = {toml_str(repo)}',
        'required = true',
        'startup_timeout_sec = 30',
        'tool_timeout_sec = 1800',
        "# Bridge calls are authorized by the user's start order; no per-call human approval.",
        'default_tools_approval_mode = "approve"',
        '',
        '[mcp_servers.bridge.env]',
        *[f'{k} = {toml_str(v)}' for k, v in env.items()],
        '',
    ]
    return '\n'.join(lines)


def git(repo, *args, ident=None):
    pre = ['-c', f'user.name={ident[0]}', '-c', f'user.email={ident[1]}'] if ident else []
    return subprocess.run(['git', '-C', str(repo), *pre, *args], check=True, capture_output=True, text=True).stdout.strip()


def tools():
    """node and claude from PATH (a dry run puts its stand-in `claude` first on PATH)."""
    return shutil.which('node'), shutil.which('claude')
