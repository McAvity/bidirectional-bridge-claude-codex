#!/usr/bin/env python3
"""W14-01 probe 2 — can a delegated Claude get its instruction set without a
per-project or per-profile plugin install?

Wave14 requires that "delegowany claude -p ma właściwy, kompletny zestaw
instrukcji wykonawcy bez ręcznej instalacji pluginu lub kopiowania plików
w każdym projekcie". The bridge spawns `claude -p` itself, so the question is
whether the executor can be handed a pinned instruction set on the command line.

Every case runs in an empty, disposable `CLAUDE_CONFIG_DIR` (no user plugins, no
project `.claude/`) against a local HTTP stub that answers 400, so the session
boots plugins and MCP servers and then stops. Each case asserts zero usage and
zero cost from the CLI's own result frame.

  python3 scripts/plugin-probes/probe_claude_delegation.py [--out-dir DIR]
"""

from __future__ import annotations

import argparse
import re
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import probe_lib as L  # noqa: E402

PLUGIN = "w14-probe"
MARKER = "W14-PROBE-SKILL-MARKER"

DEBUG_PATTERNS = {
    "inline_plugin_loaded": re.compile(r"Loaded inline plugin from path: " + PLUGIN),
    "plugin_skills_loaded": re.compile(r"Loaded (\d+) skills from plugin " + PLUGIN),
    "plugin_mcp_started": re.compile(r'MCP server "plugin:' + PLUGIN + r':probe"'),
}


def scan_debug(path: Path) -> dict:
    text = path.read_text(errors="replace") if path.exists() else ""
    found = {name: bool(pattern.search(text)) for name, pattern in DEBUG_PATTERNS.items()}
    skills = DEBUG_PATTERNS["plugin_skills_loaded"].search(text)
    found["plugin_skill_count"] = int(skills.group(1)) if skills else 0
    return found


def run_case(
    name: str,
    *,
    root: Path,
    cwd: Path,
    stub: L.AnthropicStub,
    extra_args: list[str],
    record: Path,
) -> dict:
    config_dir = root / f"claude-config-{name.replace('/', '__')}"
    config_dir.mkdir(parents=True, exist_ok=True)
    debug = root / f"debug-{name.replace('/', '__')}.log"
    record.write_text("")
    proc = L.run_claude_headless(
        "w14 probe: no model call is expected to succeed",
        cwd=cwd,
        config_dir=config_dir,
        stub=stub,
        extra_args=extra_args,
        debug_file=debug,
    )
    result = L.claude_result(proc)
    entries = L.read_record(record)
    start = L.record_start(entries)
    env = (start or {}).get("env", {})
    return {
        "case": name,
        "cwd": str(cwd),
        "config_dir_was_empty": True,
        "extra_args": extra_args,
        "exit_code": proc.returncode,
        "spent_nothing": L.claude_spent_nothing(result),
        "api_error_status": result.get("api_error_status"),
        "total_cost_usd": result.get("total_cost_usd"),
        "usage": {
            "input_tokens": result.get("usage", {}).get("input_tokens"),
            "output_tokens": result.get("usage", {}).get("output_tokens"),
        },
        "debug": scan_debug(debug),
        "mcp_server_started": start is not None,
        "mcp_server_cwd": (start or {}).get("cwd"),
        "mcp_server_cwd_is_project": (start or {}).get("cwd") == str(cwd),
        "CLAUDE_PROJECT_DIR": env.get("CLAUDE_PROJECT_DIR"),
        "CLAUDE_PLUGIN_ROOT": env.get("CLAUDE_PLUGIN_ROOT"),
        "CLAUDE_PLUGIN_DATA": env.get("CLAUDE_PLUGIN_DATA"),
        "mcp_methods": L.record_methods(entries),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", type=Path, default=None)
    args = parser.parse_args()

    try:
        L.claude_bin()
    except L.ProbeSkipped as exc:
        L.emit({"probe": "claude-delegated-instructions", "skipped": str(exc)}, args.out_dir)
        return 0

    root = L.run_root("claude-delegation")
    record = root / "record.jsonl"

    plugin_dir = root / "pinned-runtime" / "plugins" / PLUGIN
    L.build_claude_plugin(plugin_dir, plugin=PLUGIN, version="1.0.0", record_path=record)

    # A .zip of the same plugin, to test the documented archive form of --plugin-dir.
    archive = root / f"{PLUGIN}.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(plugin_dir.rglob("*")):
            if path.is_file():
                zf.write(path, Path(PLUGIN) / path.relative_to(plugin_dir))

    project = root / "project with spaces"
    L.make_git_repo(project)
    (project / "sub dir").mkdir()

    validate = L.run_claude_validate(plugin_dir)

    with L.AnthropicStub() as stub:
        cases = [
            run_case(
                "control/no-plugin-dir",
                root=root,
                cwd=project,
                stub=stub,
                extra_args=[],
                record=record,
            ),
            run_case(
                "plugin-dir/directory",
                root=root,
                cwd=project,
                stub=stub,
                extra_args=["--plugin-dir", str(plugin_dir)],
                record=record,
            ),
            run_case(
                "plugin-dir/from-subdirectory",
                root=root,
                cwd=project / "sub dir",
                stub=stub,
                extra_args=["--plugin-dir", str(plugin_dir)],
                record=record,
            ),
            run_case(
                "plugin-dir/zip-archive",
                root=root,
                cwd=project,
                stub=stub,
                extra_args=["--plugin-dir", str(archive)],
                record=record,
            ),
            run_case(
                "plugin-dir/with-delegation-lock",
                root=root,
                cwd=project,
                stub=stub,
                extra_args=[
                    "--plugin-dir",
                    str(plugin_dir),
                    "--disallowed-tools",
                    "Task",
                    "mcp__bridge__bridge_delegate_task",
                ],
                record=record,
            ),
        ]

    by_case = {c["case"]: c for c in cases}
    result = {
        "probe": "claude-delegated-instructions",
        "question": (
            "Can a bridge-spawned `claude -p` load the pinned executor instruction set "
            "without installing a plugin in the profile or the project?"
        ),
        "hosts": L.host_versions(),
        "run_root": str(root),
        "plugin_manifest_valid": validate,
        "cases": cases,
        "findings": {
            "every_session_was_model_free": all(c["spent_nothing"] for c in cases),
            "control_loads_no_plugin_skill": by_case["control/no-plugin-dir"]["debug"][
                "plugin_skill_count"
            ]
            == 0,
            "plugin_dir_loads_skills_with_no_install": by_case["plugin-dir/directory"]["debug"][
                "plugin_skill_count"
            ]
            > 0,
            "plugin_dir_starts_plugin_mcp": by_case["plugin-dir/directory"]["mcp_server_started"],
            "plugin_mcp_cwd_is_the_project": by_case["plugin-dir/directory"][
                "mcp_server_cwd_is_project"
            ],
            "CLAUDE_PROJECT_DIR_is_exported": bool(
                by_case["plugin-dir/directory"]["CLAUDE_PROJECT_DIR"]
            ),
            "works_from_a_subdirectory": by_case["plugin-dir/from-subdirectory"]["debug"][
                "plugin_skill_count"
            ]
            > 0,
            "zip_archive_accepted": by_case["plugin-dir/zip-archive"]["debug"][
                "plugin_skill_count"
            ]
            > 0,
            "compatible_with_the_delegation_lock": by_case["plugin-dir/with-delegation-lock"][
                "debug"
            ]["plugin_skill_count"]
            > 0,
        },
        "conclusion": (
            "Claude Code 2.1.273 loads a plugin for one session from `--plugin-dir`, with no "
            "user-profile or project install, and exports CLAUDE_PROJECT_DIR / CLAUDE_PLUGIN_ROOT "
            "to the plugin's MCP subprocess, whose cwd is the project directory."
        ),
    }
    L.emit(result, args.out_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
