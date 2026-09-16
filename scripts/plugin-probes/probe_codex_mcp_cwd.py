#!/usr/bin/env python3
"""W14-01 probe 1 — does a Codex plugin MCP server learn the project directory?

Wave14 requires that "plugin MCP otrzymuje właściwy katalog projektu/worktree,
także przy zewnętrznych worktree Herdr, ścieżkach ze spacjami i uruchomieniu
z podkatalogu". This probe installs a disposable plugin whose only MCP server is
the recorder, starts a real Codex session in each layout, and records what the
server process actually receives.

Model-free: every session stops on a missing provider API key before any request
is sent. Nothing outside the disposable run root is written.

  python3 scripts/plugin-probes/probe_codex_mcp_cwd.py [--out-dir DIR]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import probe_lib as L  # noqa: E402

MARKETPLACE = "w14probe"
PLUGIN = "w14-probe"


def initialize_params(entries: list[dict]):
    for entry in entries:
        if entry.get("ev") == "in" and entry.get("msg", {}).get("method") == "initialize":
            return entry["msg"].get("params")
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", type=Path, default=None)
    args = parser.parse_args()

    try:
        L.codex_bin()
    except L.ProbeSkipped as exc:
        L.emit({"probe": "codex-plugin-mcp-cwd", "skipped": str(exc)}, args.out_dir)
        return 0

    root = L.run_root("codex-mcp-cwd")
    codex_home = root / "codex-home"
    codex_home.mkdir()
    marketplace = root / "marketplace"

    plain = root / "plain-project"
    spaced = root / "project with spaces"
    L.make_git_repo(plain)
    L.make_git_repo(spaced)
    (spaced / "sub dir").mkdir()
    external = root / "herdr-like" / "external worktree"
    external.parent.mkdir(parents=True, exist_ok=True)
    L.add_git_worktree(plain, external, "w14-probe-worktree")

    version_counter = {"n": 0}

    def install(record: Path, env_vars: list[str] | None) -> str | None:
        """Rebuild the probe plugin at a fresh version and install it."""
        version_counter["n"] += 1
        L.build_codex_marketplace(
            marketplace,
            marketplace=MARKETPLACE,
            plugin=PLUGIN,
            version=f"0.{version_counter['n']}.0",
            record_path=record,
            env_vars=env_vars,
        )
        out = L.run_codex(
            ["plugin", "add", f"{PLUGIN}@{MARKETPLACE}", "--json"], cwd=root, codex_home=codex_home
        )
        if out.returncode != 0:
            return None
        return json.loads(out.stdout).get("installedPath")

    # The marketplace root must be registered once; the first build seeds it.
    L.build_codex_marketplace(
        marketplace,
        marketplace=MARKETPLACE,
        plugin=PLUGIN,
        version="0.0.1",
        record_path=root / "seed.jsonl",
    )
    added = L.run_codex(
        ["plugin", "marketplace", "add", str(marketplace), "--json"], cwd=root, codex_home=codex_home
    )

    # `parent_pwd` models how the client was launched: a shell exports PWD equal
    # to its own working directory; a launcher that spawns Codex directly does
    # not update PWD at all, and "stale" models a launcher that inherited the
    # PWD of some other checkout.
    matrix = [
        # (case, env_vars, launch cwd, workspace root the bridge must reach, parent PWD, extra)
        ("default-manifest/no-env_vars", None, plain, plain, "shell", {}),
        ("env_vars-PWD/plain-root", ["PWD"], plain, plain, "shell", {}),
        ("env_vars-PWD/path-with-spaces", ["PWD"], spaced, spaced, "shell", {}),
        ("env_vars-PWD/subdirectory", ["PWD"], spaced / "sub dir", spaced, "shell", {}),
        ("env_vars-PWD/external-git-worktree", ["PWD"], external, external, "shell", {}),
        (
            "env_vars-PWD/--cd-elsewhere",
            ["PWD"],
            spaced / "sub dir",
            plain,
            "shell",
            {"extra_args": ["-C", str(plain)]},
        ),
        ("env_vars-PWD/PWD-unset-in-parent", ["PWD"], plain, plain, "unset", {}),
        ("env_vars-PWD/PWD-stale-from-other-repo", ["PWD"], plain, plain, str(L.REPO_ROOT), {}),
    ]

    cases = []
    installed_paths = []
    for name, env_vars, cwd, expect, parent_pwd, extra in matrix:
        record = root / f"record-{name.replace('/', '__')}.jsonl"
        installed_paths.append(install(record, env_vars))
        record.write_text("")
        if parent_pwd == "shell":
            extra_env, drop_env = {"PWD": str(cwd)}, None
        elif parent_pwd == "unset":
            extra_env, drop_env = None, ["PWD"]
        else:
            extra_env, drop_env = {"PWD": parent_pwd}, None
        proc = L.codex_session_start(
            cwd,
            codex_home,
            extra.get("extra_args"),
            drop_env=drop_env,
            extra_env=extra_env,
        )
        entries = L.read_record(record)
        start = L.record_start(entries)
        env = (start or {}).get("env", {})
        pwd = env.get("PWD")
        observed_root = L.git_toplevel(pwd) if pwd else None
        cases.append(
            {
                "case": name,
                "declared_env_vars": env_vars,
                "parent_PWD": parent_pwd,
                "launch_cwd": str(cwd),
                "expected_workspace_root": str(expect),
                "model_request_skipped": L.codex_turn_failed_without_request(proc),
                "codex_exit_code": proc.returncode,
                "server_started": start is not None,
                "server_cwd": (start or {}).get("cwd"),
                "server_cwd_is_project": (start or {}).get("cwd") == str(cwd),
                "server_argv": (start or {}).get("argv"),
                "forwarded_env_names": sorted(env),
                "forwarded_PWD": pwd,
                "workspace_root_from_PWD": observed_root,
                "workspace_root_matches_expected": observed_root == str(expect.resolve()),
                "mcp_methods": L.record_methods(entries),
                "initialize_params": initialize_params(entries),
            }
        )

    mcp_list = L.run_codex(["mcp", "list", "--json"], cwd=plain, codex_home=codex_home)
    by_case = {c["case"]: c for c in cases}

    result = {
        "probe": "codex-plugin-mcp-cwd",
        "question": "Does a Codex plugin MCP server receive the project/worktree directory?",
        "hosts": L.host_versions(),
        "run_root": str(root),
        "marketplace_added": added.returncode == 0,
        "installed_paths": installed_paths,
        "resolved_mcp_config": json.loads(mcp_list.stdout) if mcp_list.returncode == 0 else mcp_list.stderr,
        "cases": cases,
        "findings": {
            "every_session_was_model_free": all(c["model_request_skipped"] for c in cases),
            "server_cwd_is_never_the_project": all(
                c["server_started"] and not c["server_cwd_is_project"] for c in cases
            ),
            "env_is_stripped_without_env_vars": "PWD"
            not in set(by_case["default-manifest/no-env_vars"]["forwarded_env_names"]),
            "env_vars_PWD_forwards_the_parent_PWD_verbatim": all(
                by_case[name]["forwarded_PWD"] == by_case[name]["launch_cwd"]
                for name in (
                    "env_vars-PWD/plain-root",
                    "env_vars-PWD/path-with-spaces",
                    "env_vars-PWD/subdirectory",
                    "env_vars-PWD/external-git-worktree",
                )
            ),
            "workspace_root_recoverable_only_when_parent_PWD_is_the_worktree": all(
                by_case[name]["workspace_root_matches_expected"]
                for name in (
                    "env_vars-PWD/plain-root",
                    "env_vars-PWD/path-with-spaces",
                    "env_vars-PWD/subdirectory",
                    "env_vars-PWD/external-git-worktree",
                )
            ),
            "PWD_diverges_from_codex_working_root_with_--cd": by_case["env_vars-PWD/--cd-elsewhere"][
                "workspace_root_matches_expected"
            ]
            is False,
            "PWD_absent_when_parent_does_not_export_it": by_case["env_vars-PWD/PWD-unset-in-parent"][
                "forwarded_PWD"
            ]
            is None,
            "stale_parent_PWD_points_at_a_foreign_repository": by_case[
                "env_vars-PWD/PWD-stale-from-other-repo"
            ]["workspace_root_from_PWD"]
            not in (None, str(plain.resolve())),
            "mcp_initialize_carries_no_roots_capability": all(
                "roots" not in ((c.get("initialize_params") or {}).get("capabilities") or {})
                for c in cases
                if c.get("initialize_params")
            ),
        },
        "conclusion": (
            "Codex 0.154.0 gives a plugin-declared MCP server no supported channel for the "
            "project or worktree directory: cwd resolves inside the version-pinned plugin cache, "
            "the environment is stripped to an allowlist, `env_vars` only re-exports whatever the "
            "parent process had, and the MCP initialize handshake advertises no roots capability."
        ),
    }
    L.emit(result, args.out_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
