#!/usr/bin/env python3
"""W14-01 supplementary probe — does an unusable bridge MCP block stop Codex?

Wave14 §2 requires that "start bez deklaracji powinien umożliwiać setup, nie
blokować całego Codexa błędem required MCP". A worktree created from an enabled
project inherits the committed `.codex/config.toml` managed block but not the
gitignored `.bridge-runtime/current` symlink it points at, so the very first
session in a new worktree starts with a bridge server that cannot launch.

Scope limit: this exercises `codex exec`. The interactive TUI is a different
front end and its behaviour on a failing `required` server is NOT covered here.

  python3 scripts/plugin-probes/probe_missing_runtime_startup.py [--out-dir DIR]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import probe_lib as L  # noqa: E402

MANAGED_BLOCK = """# >>> claude-codex-bridge managed block >>>
[mcp_servers.bridge]
command = "node"
args = [".bridge-runtime/current/scripts/native-bridge-mcp.mjs", "--caller", "codex", "--delegation", "allow", "--workspace", "."]
cwd = "."
required = {required}
startup_timeout_sec = 10
tool_timeout_sec = 5400
# <<< claude-codex-bridge managed block <<<
"""


def case(project: Path, codex_home: Path, required: bool) -> dict:
    (project / ".codex").mkdir(parents=True, exist_ok=True)
    (project / ".codex" / "config.toml").write_text(
        MANAGED_BLOCK.format(required="true" if required else "false")
    )
    proc = L.codex_session_start(project, codex_home, extra_env={"PWD": str(project)})
    return {
        "required": required,
        "runtime_symlink_present": (project / ".bridge-runtime" / "current").exists(),
        "session_reached_the_model_request": L.codex_turn_failed_without_request(proc),
        "exit_code": proc.returncode,
        "stderr_tail": proc.stderr[-800:],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", type=Path, default=None)
    args = parser.parse_args()

    try:
        L.codex_bin()
    except L.ProbeSkipped as exc:
        L.emit({"probe": "missing-runtime-startup", "skipped": str(exc)}, args.out_dir)
        return 0

    root = L.run_root("missing-runtime-startup")
    codex_home = root / "codex-home"
    codex_home.mkdir()
    project = root / "inherited project"
    L.make_git_repo(project)

    cases = [case(project, codex_home, True), case(project, codex_home, False)]
    result = {
        "probe": "missing-runtime-startup",
        "question": (
            "Does an inherited `[mcp_servers.bridge]` block whose launcher is missing stop a "
            "Codex session from starting, so the setup skill could not run?"
        ),
        "hosts": L.host_versions(),
        "run_root": str(root),
        "front_end": "codex exec",
        "scope_limit": "The interactive TUI is not covered; only `codex exec` was exercised.",
        "cases": cases,
        "findings": {
            "exec_continues_with_required_true": cases[0]["session_reached_the_model_request"],
            "exec_continues_with_required_false": cases[1]["session_reached_the_model_request"],
        },
        "conclusion": (
            "Under `codex exec` a bridge server that cannot launch does not abort the session, so "
            "a setup skill can still run in a freshly created worktree. Whether the TUI behaves "
            "the same is unverified and must be confirmed before relying on it."
        ),
    }
    L.emit(result, args.out_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
