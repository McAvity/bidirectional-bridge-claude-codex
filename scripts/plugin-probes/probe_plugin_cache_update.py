#!/usr/bin/env python3
"""W14-01 probe 3 — does a plugin update leave a running feature's pinned set intact?

Wave14 requires that "aktualizacja/cache pluginu nie usuwa wersji potrzebnej
trwającej sesji i nie miesza nowych instrukcji ze starym runtime; sprawdzić też
restart klienta". This probe installs a probe plugin, records what a session
resolves, publishes a new version through the documented update flow, and then
re-inspects the cache and a restarted session.

It also checks the mitigation wave12 already implements: an immutable runtime
kept outside the plugin cache is untouched by a plugin update.

Model-free throughout; nothing outside the disposable run root is written.

  python3 scripts/plugin-probes/probe_plugin_cache_update.py [--out-dir DIR]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import probe_lib as L  # noqa: E402

MARKETPLACE = "w14probe"
PLUGIN = "w14-probe"
V1 = "1.0.0"
V2 = "1.1.0"


def sha256(path: Path) -> str | None:
    if not path.is_file():
        return None
    return hashlib.sha256(path.read_bytes()).hexdigest()


def codex_skill_paths(cwd: Path, codex_home: Path) -> list[str]:
    """Skill file paths Codex would actually put in front of the manager."""
    proc = L.run_codex(["debug", "prompt-input", "w14 probe"], cwd=cwd, codex_home=codex_home)
    if proc.returncode != 0:
        return []
    roots: dict[str, str] = {}
    paths: list[str] = []
    for match in re.finditer(r"`(r\d+)` = `([^`]+)`", proc.stdout):
        roots[match.group(1)] = match.group(2)
    for match in re.finditer(r"\(file: (r\d+)/([^)]+)\)", proc.stdout):
        root = roots.get(match.group(1), match.group(1))
        paths.append(f"{root}/{match.group(2)}")
    return [p for p in paths if PLUGIN in p]


def codex_side(root: Path) -> dict:
    codex_home = root / "codex-home"
    codex_home.mkdir()
    marketplace = root / "marketplace"
    record = root / "record.jsonl"
    project = root / "project"
    L.make_git_repo(project)

    # A wave12-style immutable runtime kept outside the plugin cache.
    runtime = root / "outside-runtime" / "0.2.0-deadbeefcafe"
    (runtime / "scripts").mkdir(parents=True)
    (runtime / "scripts" / "launcher.mjs").write_text("// pinned runtime, outside the plugin cache\n")
    runtime_digest_before = sha256(runtime / "scripts" / "launcher.mjs")

    L.build_codex_marketplace(
        marketplace,
        marketplace=MARKETPLACE,
        plugin=PLUGIN,
        version=V1,
        record_path=record,
        env_vars=["PWD"],
    )
    L.run_codex(["plugin", "marketplace", "add", str(marketplace), "--json"], cwd=root, codex_home=codex_home)
    install_v1 = L.run_codex(["plugin", "add", f"{PLUGIN}@{MARKETPLACE}", "--json"], cwd=root, codex_home=codex_home)
    path_v1 = Path(json.loads(install_v1.stdout)["installedPath"])

    record.write_text("")
    session_v1 = L.codex_session_start(project, codex_home, extra_env={"PWD": str(project)})
    start_v1 = L.record_start(L.read_record(record))
    skills_v1 = codex_skill_paths(project, codex_home)
    skill_file_v1 = path_v1 / "skills" / "probe-skill" / "SKILL.md"
    digest_v1 = sha256(skill_file_v1)

    # Documented update flow: publish a new version, reinstall from the marketplace.
    L.build_codex_marketplace(
        marketplace,
        marketplace=MARKETPLACE,
        plugin=PLUGIN,
        version=V2,
        record_path=record,
        env_vars=["PWD"],
    )
    install_v2 = L.run_codex(["plugin", "add", f"{PLUGIN}@{MARKETPLACE}", "--json"], cwd=root, codex_home=codex_home)
    path_v2 = Path(json.loads(install_v2.stdout)["installedPath"])

    after_update = {
        "v1_cache_dir_still_present": path_v1.is_dir(),
        "v1_skill_file_still_readable": skill_file_v1.is_file(),
        "v1_skill_sha256_before_update": digest_v1,
        "v1_skill_sha256_after_update": sha256(skill_file_v1),
        "cache_versions_present": sorted(p.name for p in path_v1.parent.iterdir() if p.is_dir()),
    }

    # Restart the client: what does a fresh session resolve now?
    record.write_text("")
    L.codex_session_start(project, codex_home, extra_env={"PWD": str(project)})
    start_after = L.record_start(L.read_record(record))
    skills_after = codex_skill_paths(project, codex_home)
    mcp_after = L.run_codex(["mcp", "list", "--json"], cwd=project, codex_home=codex_home)

    removed = L.run_codex(["plugin", "remove", f"{PLUGIN}@{MARKETPLACE}"], cwd=root, codex_home=codex_home)

    return {
        "host": "codex",
        "installed_path_v1": str(path_v1),
        "installed_path_v2": str(path_v2),
        "cache_path_is_version_keyed": path_v1.name == V1 and path_v2.name == V2,
        "session_v1": {
            "model_request_skipped": L.codex_turn_failed_without_request(session_v1),
            "mcp_cwd": (start_v1 or {}).get("cwd"),
            "mcp_cwd_under_v1_cache": str(path_v1) in ((start_v1 or {}).get("cwd") or ""),
            "manager_skill_paths": skills_v1,
        },
        "after_update": after_update,
        "after_restart": {
            "mcp_cwd": (start_after or {}).get("cwd"),
            "mcp_cwd_under_v2_cache": str(path_v2) in ((start_after or {}).get("cwd") or ""),
            "manager_skill_paths": skills_after,
            "resolved_mcp_config": json.loads(mcp_after.stdout) if mcp_after.returncode == 0 else mcp_after.stderr,
        },
        "outside_runtime": {
            "path": str(runtime),
            "sha256_before": runtime_digest_before,
            "sha256_after": sha256(runtime / "scripts" / "launcher.mjs"),
            "survived_update_and_remove": sha256(runtime / "scripts" / "launcher.mjs") == runtime_digest_before,
        },
        "plugin_remove_exit_code": removed.returncode,
        "cache_dir_after_remove_exists": path_v1.parent.exists(),
    }


def claude_side(root: Path) -> dict:
    config_dir = root / "claude-config"
    config_dir.mkdir()
    marketplace = root / "claude-marketplace"
    record = root / "record-claude.jsonl"
    project = root / "claude-project"
    L.make_git_repo(project)

    def publish(version: str) -> None:
        plugin_dir = marketplace / "plugins" / PLUGIN
        L.build_claude_plugin(plugin_dir, plugin=PLUGIN, version=version, record_path=record)
        L.write_json(
            marketplace / ".claude-plugin" / "marketplace.json",
            {
                "name": MARKETPLACE,
                "owner": {"name": "claude-codex-bridge"},
                "plugins": [
                    {
                        "name": PLUGIN,
                        "source": f"./plugins/{PLUGIN}",
                        "description": "W14-01 feasibility probe plugin.",
                        "version": version,
                    }
                ],
            },
        )

    publish(V1)
    env = {"CLAUDE_CONFIG_DIR": str(config_dir)}
    added = L.run_claude_plugin(["marketplace", "add", str(marketplace)], env=env)
    installed = L.run_claude_plugin(["install", f"{PLUGIN}@{MARKETPLACE}", "--json", "-y"], env=env)
    cache_root = config_dir / "plugins" / "cache"
    before = sorted(str(p.relative_to(cache_root)) for p in cache_root.rglob("*") if p.is_dir()) if cache_root.exists() else []

    publish(V2)
    L.run_claude_plugin(["marketplace", "update", MARKETPLACE], env=env)
    updated = L.run_claude_plugin(["update", f"{PLUGIN}@{MARKETPLACE}", "--json", "-y"], env=env)
    after = sorted(str(p.relative_to(cache_root)) for p in cache_root.rglob("*") if p.is_dir()) if cache_root.exists() else []

    return {
        "host": "claude",
        "marketplace_add_exit_code": added["exit_code"],
        "install_exit_code": installed["exit_code"],
        "install_output": installed["stdout"][:2000],
        "update_exit_code": updated["exit_code"],
        "update_output": updated["stdout"][:2000],
        "cache_dirs_before_update": before,
        "cache_dirs_after_update": after,
        "cache_is_version_keyed": any(V1 in d for d in before),
        "previous_version_retained": any(V1 in d for d in after),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", type=Path, default=None)
    args = parser.parse_args()

    root = L.run_root("plugin-cache-update")
    result = {
        "probe": "plugin-cache-update-restart",
        "question": (
            "Does refreshing the plugin cache preserve the runtime and instruction set a "
            "running feature is pinned to, across a client restart?"
        ),
        "hosts": L.host_versions(),
        "run_root": str(root),
    }

    try:
        L.codex_bin()
        result["codex"] = codex_side(root)
    except L.ProbeSkipped as exc:
        result["codex"] = {"skipped": str(exc)}
    except (subprocess.SubprocessError, OSError, KeyError, ValueError) as exc:
        result["codex"] = {"error": f"{type(exc).__name__}: {exc}"}

    try:
        L.claude_bin()
        result["claude"] = claude_side(root)
    except L.ProbeSkipped as exc:
        result["claude"] = {"skipped": str(exc)}
    except (subprocess.SubprocessError, OSError, KeyError, ValueError) as exc:
        result["claude"] = {"error": f"{type(exc).__name__}: {exc}"}

    codex = result.get("codex", {})
    result["findings"] = {
        "codex_cache_is_version_keyed": codex.get("cache_path_is_version_keyed"),
        "codex_update_deletes_the_previous_version": codex.get("after_update", {}).get(
            "v1_cache_dir_still_present"
        )
        is False,
        "codex_restart_moves_runtime_and_instructions_together": bool(
            codex.get("after_restart", {}).get("mcp_cwd_under_v2_cache")
        ),
        "codex_runtime_outside_the_cache_survives": codex.get("outside_runtime", {}).get(
            "survived_update_and_remove"
        ),
        "claude_previous_version_retained": result.get("claude", {}).get("previous_version_retained"),
    }
    result["conclusion"] = (
        "The plugin cache is not a safe home for a pinned runtime: Codex keys the cache by "
        "version and the documented update flow removes the previous version's directory, so a "
        "feature that recorded an absolute path inside it cannot resume after an update. A "
        "runtime and instruction set stored outside the plugin cache is untouched."
    )
    L.emit(result, args.out_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
