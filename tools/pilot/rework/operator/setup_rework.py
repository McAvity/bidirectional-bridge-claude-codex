"""Create the isolated run directory for the rework test (operator-only tool).

Usage: python3 setup_rework.py --dest DIR
DIR must not exist and should be outside this checkout. Nothing outside DIR is modified.

Result (DIR/):
  repo/               git repo: agent/fixture (F-001-duration, T01 only) + this checkout's workflow
                      skills and using-bridge + .codex/config.toml pointing at this checkout's bridge
  exchange/           round packages
  acceptance-owner/   product-owner cases for Astra's own review (agent-facing control material)
  logs/               Codex turn notifications and launcher log
  START-ASTRA.txt     the start order for Astra with this run's paths (paste into the Codex TUI)
  SETUP.json          provenance: source hashes, initial commit, git identities
Operator evidence (snapshots, intervention records, collected evidence) goes to
DIR/operator-results/, created by the operator tools. No agent is started.
"""
import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REWORK = HERE.parent
sys.path.insert(0, str(REWORK.parent / 'common'))
import setup_common as base  # noqa: E402

AGENT = REWORK / 'agent'


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--dest', required=True)
    args = parser.parse_args()
    dest = Path(args.dest).resolve()
    if dest.exists():
        sys.exit(f'destination exists, refusing to overwrite: {dest}')
    if dest.is_relative_to(base.ROOT):
        sys.exit(f'choose a destination outside this checkout ({base.ROOT})')
    node, claude = base.tools()
    if not (node and claude and base.LAUNCHER.is_file()):
        sys.exit('node, claude or the bridge launcher is missing')
    if not base.BUILD_MARKER.is_file():
        sys.exit('the bridge is not built: run `npm ci --ignore-scripts && npm run build` in this checkout first')
    repo = dest / 'repo'
    shutil.copytree(AGENT / 'fixture', repo, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    shutil.copytree(base.WORKFLOW_SKILLS, repo / '.agents')
    shutil.copy2(base.FEATURES_README, repo / 'docs/features/README.md')
    shutil.copytree(base.USING_BRIDGE['codex'], repo / '.agents/skills/using-bridge')
    shutil.copytree(base.USING_BRIDGE['claude'], repo / '.claude/skills/using-bridge')
    (repo / '.codex').mkdir(exist_ok=True)
    (repo / '.codex/config.toml').write_text(base.codex_config(repo, node, claude, title='Rework test'))
    for sub in ('exchange', 'logs'):
        (dest / sub).mkdir()
    shutil.copytree(AGENT / 'owner-acceptance', dest / 'acceptance-owner')
    start = (AGENT / 'START-ASTRA.template.txt').read_text()
    (dest / 'START-ASTRA.txt').write_text(start.replace('{CASES}', str(dest / 'acceptance-owner/cases.json'))
                                          .replace('{EXCHANGE}', str(dest / 'exchange')))

    base.git(dest, 'init', '-q', '-b', 'main', str(repo))
    base.git(repo, 'config', 'user.name', base.MANAGER_GIT[0])
    base.git(repo, 'config', 'user.email', base.MANAGER_GIT[1])
    base.git(repo, 'add', '-A')
    base.git(repo, 'commit', '-q', '-m', 'textkit: F-001-duration plan, task and workflow', ident=base.SETUP_GIT)
    setup = {
        'dest': str(dest), 'repo': str(repo), 'feature_id': 'F-001-duration', 'scenario': 'rework',
        'initial_commit': base.git(repo, 'rev-parse', 'HEAD'),
        'tools_commit': base.git(base.ROOT, 'rev-parse', 'HEAD'),
        'fixture_sha256': base.tree_hash(AGENT / 'fixture'),
        'workflow_skills_sha256': base.tree_hash(base.WORKFLOW_SKILLS),
        'using_bridge_sha256': base.tree_hash(base.USING_BRIDGE['codex']),
        'owner_cases_sha256': hashlib.sha256((AGENT / 'owner-acceptance/cases.json').read_bytes()).hexdigest(),
        'bridge_launcher': str(base.LAUNCHER), 'node': node, 'claude': claude,
        'git_identities': {'manager': base.MANAGER_GIT[0], 'executor': base.EXECUTOR_GIT[0], 'setup': base.SETUP_GIT[0],
                           'teammate': 'pilot-teammate'},
    }
    (dest / 'SETUP.json').write_text(json.dumps(setup, indent=2) + '\n')
    print(json.dumps(setup, indent=2))


if __name__ == '__main__':
    main()
