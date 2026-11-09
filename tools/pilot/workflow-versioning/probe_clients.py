#!/usr/bin/env python3
"""W19-01 model-free client probes (contract: docs/features/F-W19-workflow-versioning/contracts/01-workflow-binding.md § 11).

Questions, each answered by observing the real installed clients without inference:

  A. auth      — which subscription login path is supported inside an isolated profile, and is
                 the isolated profile logged in? (status commands only; no login is attempted)
  B. paths     — do CLAUDE_CONFIG_DIR / CODEX_HOME isolate plugin install, cache and session
                 storage? What are the effective paths? Are the personal profiles untouched?
  C. claude    — which entry text and package root does a session receive (`/plugin:entry`
                 expansion), and after a plugin update or an executor `--plugin-dir`, does
                 `--resume` of the *same* session show the new text, and what remains of the old?
  D. codex     — same for `$plugin:entry` and `codex exec resume <thread>`; does the update keep
                 the old cache version the history refers to?
  E. mcp-env   — does a Codex-launched MCP server (the bridge launcher's position) receive
                 CLAUDE_CONFIG_DIR, i.e. would a delegated Claude inherit the isolated profile?

Model-free by construction: Claude points ANTHROPIC_BASE_URL at a local capturing stub that
answers HTTP 400 and every result frame must report zero cost and tokens; Codex uses a provider
whose base_url is the same kind of local stub, and each turn must fail with the stub's own error
code. The stub stores the request body (the model-visible input) under the run root. Nothing is
forwarded. Profiles, marketplaces and projects live in a disposable run root; the personal
profiles are refused by `probe_lib.assert_isolated` and fingerprinted (metadata only) before and
after. Raw captures stay outside Git; only derived findings are emitted.

  python3 tools/pilot/workflow-versioning/probe_clients.py [--out FILE]

Exit code 0 means the probe ran; a `false` finding is a recorded client limitation, not a
probe failure. Exit 2 means a model-free guarantee was violated or a step could not run.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import w19lib as W  # noqa: E402

L = W.L
PLUGIN = "w19wf"
MARKET = "w19m"
ENTRY = "probe-entry"
MARKER = re.compile(r"W19-MARKER-([0-9.]+) root=([^\\\"\s]+)")
CODEX_MARKER = re.compile(r"W19-MARKER-([0-9.]+)")
CODEX_PATH = re.compile(r"<path>([^<]*?/skills/" + ENTRY + r"/SKILL\.md)</path>")
DESCRIPTION = re.compile(r"W19 probe entry ([0-9.]+)")


def rel(path: str | Path | None, root: Path) -> str | None:
    if path is None:
        return None
    text = str(path)
    return text.replace(str(root), "<run>") if text.startswith(str(root)) else text.replace(str(Path.home()), "<home>")


# ---------------------------------------------------------------------------
# synthetic plugins
# ---------------------------------------------------------------------------


def skill_text(version: str, client: str) -> str:
    root = "${CLAUDE_PLUGIN_ROOT}" if client == "claude" else "<package>"
    return (
        f"---\nname: {ENTRY}\ndescription: W19 probe entry {version}\n---\n\n"
        f"W19-MARKER-{version} root={root}\n"
    )


def claude_plugin(directory: Path, version: str) -> Path:
    if directory.exists():
        shutil.rmtree(directory)
    (directory / ".claude-plugin").mkdir(parents=True)
    (directory / "skills" / ENTRY).mkdir(parents=True)
    L.write_json(directory / ".claude-plugin" / "plugin.json", {
        "name": PLUGIN, "version": version, "description": "W19-01 probe plugin (model-free).",
        "author": {"name": "claude-codex-bridge"}, "license": "MIT",
    })
    (directory / "skills" / ENTRY / "SKILL.md").write_text(skill_text(version, "claude"))
    return directory


def claude_market(market: Path, version: str) -> None:
    claude_plugin(market / "plugins" / PLUGIN, version)
    L.write_json(market / ".claude-plugin" / "marketplace.json", {
        "name": MARKET, "owner": {"name": "claude-codex-bridge"},
        "plugins": [{"name": PLUGIN, "source": f"./plugins/{PLUGIN}", "version": version, "description": "probe"}],
    })


def codex_market(market: Path, version: str) -> None:
    directory = market / "plugins" / PLUGIN
    if directory.exists():
        shutil.rmtree(directory)
    (directory / ".codex-plugin").mkdir(parents=True)
    (directory / "skills" / ENTRY).mkdir(parents=True)
    L.write_json(directory / ".codex-plugin" / "plugin.json", L.codex_plugin_manifest(PLUGIN, version, mcp=False))
    (directory / "skills" / ENTRY / "SKILL.md").write_text(skill_text(version, "codex"))
    L.write_json(market / ".agents" / "plugins" / "marketplace.json", {
        "name": MARKET, "interface": {"displayName": "W19 probe marketplace"},
        "plugins": [{"name": PLUGIN, "source": {"source": "local", "path": f"./plugins/{PLUGIN}"},
                     "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"}, "category": "Productivity"}],
    })


# ---------------------------------------------------------------------------
# A. auth
# ---------------------------------------------------------------------------


def auth_probe(root: Path) -> dict:
    out: dict = {}
    cfg = root / "auth-claude-config"
    cfg.mkdir()
    proc = W.claude(["auth", "status", "--json"], cwd=root, config_dir=cfg, stub=None, timeout=60)
    try:
        status = json.loads(proc.stdout)
    except json.JSONDecodeError:
        status = {"unparsed": proc.stdout[-300:]}
    login_help = W.claude(["auth", "login", "--help"], cwd=root, config_dir=cfg, stub=None, timeout=60).stdout
    token_help = W.claude(["setup-token", "--help"], cwd=root, config_dir=cfg, stub=None, timeout=60).stdout
    out["claude"] = {
        "status_exit": proc.returncode,
        "logged_in": status.get("loggedIn"),
        "auth_method": status.get("authMethod"),
        "config_directory": rel(status.get("configDirectory"), root),
        "projects_directory": rel(status.get("projectsDirectory"), root),
        "supported_login_commands": {
            "auth login --claudeai (subscription, default)": "--claudeai" in login_help,
            "setup-token (long-lived subscription token)": "requires Claude subscription" in token_help,
        },
    }
    home = root / "auth-codex-home"
    home.mkdir()
    proc = W.codex(["login", "status"], cwd=root, codex_home=home, timeout=60)
    login_help = W.codex(["login", "--help"], cwd=root, codex_home=home, timeout=60).stdout
    out["codex"] = {
        "status_exit": proc.returncode,
        "status_text": (proc.stdout + proc.stderr).strip().splitlines()[-1:] or [],
        "supported_login_commands": {
            "login (browser, ChatGPT account)": "Manage login" in login_help,
            "login --device-auth": "--device-auth" in login_help,
        },
    }
    out["findings"] = {
        "claude_isolated_profile_logged_in": status.get("loggedIn") is True,
        "claude_status_reports_isolated_config_dir": status.get("configDirectory") == str(cfg),
        "codex_isolated_profile_logged_in": proc.returncode == 0,
        "no_login_attempted_and_no_credentials_copied": True,
    }
    return out


# ---------------------------------------------------------------------------
# C. Claude Code
# ---------------------------------------------------------------------------


def claude_turn(label: str, prompt: str, *, root: Path, project: Path, cfg: Path, stub: W.CaptureStub, extra: list[str]) -> dict:
    debug = root / f"claude-debug-{label}.log"
    mark = stub.mark()
    proc = W.claude(
        ["-p", prompt, "--output-format", "stream-json", "--verbose", "--max-turns", "1",
         "--permission-mode", "plan", "--debug-file", str(debug), *extra],
        cwd=project, config_dir=cfg, stub=stub,
    )
    events = W.stream_events(proc.stdout)
    init = next((e for e in events if e.get("type") == "system" and e.get("subtype") == "init"), {})
    result = next((e for e in reversed(events) if e.get("type") == "result"), {})
    requests = stub.since(mark)
    body = W.body_text(requests[0]) if requests else ""
    debug_text = debug.read_text(errors="replace") if debug.exists() else ""
    return {
        "case": label,
        "exit_code": proc.returncode,
        "spent_nothing": L.claude_spent_nothing(result),
        "requests_to_stub": len(requests),
        "session_id": result.get("session_id") or init.get("session_id"),
        "init_plugin_paths": [rel(p.get("path"), root) for p in init.get("plugins", []) if p.get("name") == PLUGIN],
        "entry_expansions_in_request": [{"version": v, "root": rel(r, root)} for v, r in MARKER.findall(body)],
        "entry_descriptions_in_request": DESCRIPTION.findall(body),
        "override_lines": sorted(set(re.findall(r'Plugin "[^"]+" from --plugin-dir overrides installed version', debug_text))),
        "request_sha256": hashlib.sha256(body.encode()).hexdigest() if body else None,
    }


def claude_probe(root: Path) -> dict:
    cfg = root / "claude-config"
    cfg.mkdir()
    project = root / "claude-project"
    L.make_git_repo(project)
    market = root / "claude-market"
    claude_market(market, "1.0.0")
    steps = []

    def plugin(*args: str) -> subprocess.CompletedProcess:
        proc = W.claude(["plugin", *args], cwd=project, config_dir=cfg, stub=None)
        steps.append({"command": ["claude", "plugin", *args[:2]], "exit_code": proc.returncode})
        return proc

    def listing() -> dict:
        for entry in json.loads(plugin("list", "--json").stdout or "[]"):
            if entry.get("id") == f"{PLUGIN}@{MARKET}":
                return {"version": entry.get("version"), "install_path": rel(entry.get("installPath"), root),
                        "read_from_folder": rel(entry.get("readFromFolder"), root)}
        return {}

    plugin("marketplace", "add", str(market))
    plugin("install", f"{PLUGIN}@{MARKET}")
    installed_a = listing()
    executor = claude_plugin(root / "bridge-home" / "workflows" / "probe-identity-c" / "claude", "3.0.0")
    cases = []
    with W.CaptureStub(root / "captures-claude") as stub:
        first = claude_turn("A-first", f"/{PLUGIN}:{ENTRY}", root=root, project=project, cfg=cfg, stub=stub, extra=[])
        cases.append(first)
        claude_market(market, "2.0.0")
        plugin("marketplace", "update", MARKET)
        plugin("update", f"{PLUGIN}@{MARKET}")
        installed_b = listing()
        sid = first["session_id"]
        cases.append(claude_turn("B-resume-same-session", f"/{PLUGIN}:{ENTRY}", root=root, project=project, cfg=cfg, stub=stub, extra=["--resume", sid]))
        cases.append(claude_turn("C-resume-with-executor-plugin-dir", f"/{PLUGIN}:{ENTRY}", root=root, project=project, cfg=cfg, stub=stub,
                                 extra=["--resume", sid, "--plugin-dir", str(executor)]))
        cases.append(claude_turn("D-resume-no-entry-invocation", "w19 probe: continue", root=root, project=project, cfg=cfg, stub=stub, extra=["--resume", sid]))
    transcripts = sorted(rel(p, root) for p in (cfg / "projects").glob("*/*.jsonl"))
    by = {c["case"]: c for c in cases}
    versions = lambda case: [e["version"] for e in by[case]["entry_expansions_in_request"]]  # noqa: E731
    return {
        "steps": steps,
        "installed_after_A": installed_a,
        "installed_after_update": installed_b,
        "cases": cases,
        "transcripts": transcripts,
        "findings": {
            "every_session_model_free": all(c["spent_nothing"] and c["requests_to_stub"] > 0 for c in cases),
            "install_and_cache_inside_isolated_config": str(installed_a.get("install_path", "")).startswith("<run>/claude-config/"),
            "local_directory_marketplace_served_from_source_folder": all(p.startswith("<run>/claude-market/") for p in by["A-first"]["init_plugin_paths"]),
            "entry_root_expanded_to_active_package": by["A-first"]["entry_expansions_in_request"][:1] == [{"version": "1.0.0", "root": by["A-first"]["init_plugin_paths"][0] if by["A-first"]["init_plugin_paths"] else None}],
            "resume_keeps_session_id": len({c["session_id"] for c in cases}) == 1,
            "transcripts_inside_isolated_config": bool(transcripts) and all(t.startswith("<run>/claude-config/projects/") for t in transcripts),
            "resume_after_update_shows_new_entry": versions("B-resume-same-session")[-1:] == ["2.0.0"],
            "resume_history_still_contains_old_entry_text": "1.0.0" in versions("B-resume-same-session"),
            "resume_plugin_dir_overrides_installed_plugin": versions("C-resume-with-executor-plugin-dir")[-1:] == ["3.0.0"]
            and bool(by["C-resume-with-executor-plugin-dir"]["override_lines"]),
            "resume_without_invocation_injects_no_new_entry_text": versions("D-resume-no-entry-invocation") == versions("C-resume-with-executor-plugin-dir"),
            # D runs with the installed 2.0.0 again (no --plugin-dir). The listing is a history of
            # deltas; a `false` here means the newest listing line still names 3.0.0 from case C,
            # i.e. the model-visible listing of a resumed session is not proof of the active set.
            "resume_listing_tail_matches_active_package": by["D-resume-no-entry-invocation"]["entry_descriptions_in_request"][-1:] == ["2.0.0"],
        },
    }


# ---------------------------------------------------------------------------
# D. Codex
# ---------------------------------------------------------------------------


def codex_turn(label: str, args: list[str], *, root: Path, project: Path, home: Path, stub: W.CaptureStub) -> dict:
    mark = stub.mark()
    proc = W.codex(args, cwd=project, codex_home=home, stub=stub)
    events = W.stream_events(proc.stdout)
    thread = next((e.get("thread_id") for e in events if e.get("type") == "thread.started"), None)
    failed = next((e for e in events if e.get("type") == "turn.failed"), {})
    requests = stub.since(mark)
    model_requests = [r for r in requests if r["path"].endswith("/responses")]
    body = W.body_text(model_requests[-1]) if model_requests else ""
    return {
        "case": label,
        "exit_code": proc.returncode,
        "turn_failed_on_stub": "w19_probe" in json.dumps(failed),
        "requests_to_stub": [{"method": r["method"], "path": r["path"]} for r in requests],
        "thread_id": thread,
        "entry_texts_in_request": CODEX_MARKER.findall(body),
        "entry_paths_in_request": [rel(p, root) for p in CODEX_PATH.findall(body.replace("\\n", "\n"))],
        "entry_descriptions_in_request": DESCRIPTION.findall(body),
        "request_sha256": hashlib.sha256(body.encode()).hexdigest() if body else None,
    }


def codex_probe(root: Path) -> dict:
    home = root / "codex-home"
    home.mkdir()
    project = root / "codex-project"
    L.make_git_repo(project)
    market = root / "codex-market"
    codex_market(market, "1.0.0")
    steps = []

    def run(*args: str) -> subprocess.CompletedProcess:
        proc = W.codex(list(args), cwd=project, codex_home=home)
        steps.append({"command": ["codex", *args[:3]], "exit_code": proc.returncode})
        return proc

    run("plugin", "marketplace", "add", str(market), "--json")
    added_a = json.loads(run("plugin", "add", f"{PLUGIN}@{MARKET}", "--json").stdout or "{}")
    cases = []
    error = {"error": {"message": "w19 probe stub", "type": "invalid_request_error", "code": "w19_probe"}}
    with W.CaptureStub(root / "captures-codex", error_body=error) as stub:
        base = ["--json", "--skip-git-repo-check", *W.codex_stub_config(stub)]
        first = codex_turn("A-first", ["exec", *base, f"${PLUGIN}:{ENTRY} w19 probe"], root=root, project=project, home=home, stub=stub)
        cases.append(first)
        codex_market(market, "2.0.0")
        added_b = json.loads(run("plugin", "add", f"{PLUGIN}@{MARKET}", "--json").stdout or "{}")
        old_cache_exists = Path(added_a.get("installedPath", "/nonexistent")).exists()
        tid = first["thread_id"] or "missing-thread"
        cases.append(codex_turn("B-resume-same-thread", ["exec", "resume", *base, tid, f"${PLUGIN}:{ENTRY} again"], root=root, project=project, home=home, stub=stub))
        cases.append(codex_turn("C-resume-no-entry-mention", ["exec", "resume", *base, tid, "w19 probe: continue"], root=root, project=project, home=home, stub=stub))
    sessions = sorted(rel(p, root) for p in (home / "sessions").rglob("*.jsonl"))
    by = {c["case"]: c for c in cases}
    return {
        "steps": steps,
        "installed_path_A": rel(added_a.get("installedPath"), root),
        "installed_path_B": rel(added_b.get("installedPath"), root),
        "old_cache_version_exists_after_update": old_cache_exists,
        "cases": cases,
        "session_files": sessions,
        "findings": {
            "every_turn_failed_on_local_stub": all(c["turn_failed_on_stub"] for c in cases),
            "install_and_cache_inside_isolated_home": str(added_a.get("installedPath", "")).startswith(str(home)),
            "sessions_inside_isolated_home": bool(sessions) and all(s.startswith("<run>/codex-home/sessions/") for s in sessions),
            "entry_mention_injects_text_and_absolute_path": by["A-first"]["entry_texts_in_request"] == ["1.0.0"]
            and any("/1.0.0/skills/" in p for p in by["A-first"]["entry_paths_in_request"]),
            "resume_keeps_thread_id": len({c["thread_id"] for c in cases}) == 1 and first["thread_id"] is not None,
            "resume_after_update_shows_new_entry": by["B-resume-same-thread"]["entry_texts_in_request"][-1:] == ["2.0.0"],
            "resume_history_still_contains_old_entry_text_and_path": "1.0.0" in by["B-resume-same-thread"]["entry_texts_in_request"]
            and any("/1.0.0/skills/" in p for p in by["B-resume-same-thread"]["entry_paths_in_request"]),
            "update_removes_cache_path_the_history_names": not old_cache_exists,
            "resume_without_mention_lists_current_version": by["C-resume-no-entry-mention"]["entry_descriptions_in_request"][-1:] == ["2.0.0"],
        },
    }


# ---------------------------------------------------------------------------
# E. MCP environment forwarding (bridge launcher position)
# ---------------------------------------------------------------------------


def mcp_env_probe(root: Path) -> dict:
    home = root / "codex-home-mcp"
    home.mkdir()
    project = root / "mcp-project"
    L.make_git_repo(project)
    isolated_claude = root / "pilot-claude-config"
    results = {}
    error = {"error": {"message": "w19 probe stub", "type": "invalid_request_error", "code": "w19_probe"}}
    with W.CaptureStub(root / "captures-mcp", error_body=error) as stub:
        for label, env_vars in (
            ("bridge-setup-env-vars", ["CLAUDE_CODEX_BRIDGE_HOME", "XDG_DATA_HOME"]),
            ("plus-CLAUDE_CONFIG_DIR", ["CLAUDE_CODEX_BRIDGE_HOME", "XDG_DATA_HOME", "CLAUDE_CONFIG_DIR"]),
        ):
            record = root / f"mcp-record-{label}.jsonl"
            record.write_text("")
            config = [
                "-c", "mcp_servers.w19rec.command=node",
                "-c", f'mcp_servers.w19rec.args=["{L.RECORDER}", "--record", "{record}"]',
                "-c", "mcp_servers.w19rec.env_vars=[" + ", ".join(f'"{v}"' for v in env_vars) + "]",
            ]
            env_home = root / "pilot-bridge-home"
            proc = subprocess.run(
                [L.codex_bin(), "exec", "--json", "--skip-git-repo-check", *W.codex_stub_config(stub), *config, "w19 probe: mcp env"],
                cwd=str(project), capture_output=True, text=True, timeout=180, stdin=subprocess.DEVNULL,
                env={**W.os.environ, "CODEX_HOME": str(home), W.CODEX_STUB_KEY_VAR: "w19-probe-not-a-real-key",
                     "CLAUDE_CONFIG_DIR": str(isolated_claude), "CLAUDE_CODEX_BRIDGE_HOME": str(env_home)},
            )
            start = L.record_start(L.read_record(record)) or {}
            env = start.get("env", {})
            results[label] = {
                "exit_code": proc.returncode,
                "server_started": bool(start),
                "CLAUDE_CONFIG_DIR": rel(env.get("CLAUDE_CONFIG_DIR"), root),
                "CLAUDE_CODEX_BRIDGE_HOME": rel(env.get("CLAUDE_CODEX_BRIDGE_HOME"), root),
                "HOME_present": "HOME" in env,
            }
    return {
        "cases": results,
        "findings": {
            "bridge_env_vars_alone_drop_CLAUDE_CONFIG_DIR": results["bridge-setup-env-vars"]["server_started"]
            and results["bridge-setup-env-vars"]["CLAUDE_CONFIG_DIR"] is None,
            "adding_env_var_forwards_isolated_claude_config": results["plus-CLAUDE_CONFIG_DIR"]["CLAUDE_CONFIG_DIR"] == "<run>/pilot-claude-config",
            "bridge_home_forwarded": results["bridge-setup-env-vars"]["CLAUDE_CODEX_BRIDGE_HOME"] == "<run>/pilot-bridge-home",
        },
    }


# ---------------------------------------------------------------------------


def pseudonymize(value):
    """Native session/thread ids of the disposable profiles are replaced by a short digest: the
    findings need equality only, and committed evidence carries no native identifiers."""
    if isinstance(value, dict):
        return {k: (f"<id:{hashlib.sha256(v.encode()).hexdigest()[:8]}>" if k in {"session_id", "thread_id"} and isinstance(v, str) and not v.startswith("<id:") else pseudonymize(v))
                for k, v in value.items()}
    if isinstance(value, list):
        return [pseudonymize(v) for v in value]
    return value


UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE)


def scrub_paths(value, home: str | None = None):
    """Remove identifiers that live inside *paths* (R19-C03): native session UUIDs in transcript and
    rollout file names, and the encoded home/run directory Claude uses as a project folder name
    (`/srv/u/x` → `-srv-u-x`). Structure (`<run>/claude-config/projects/<project>/<uuid>.jsonl`)
    is what the findings rely on, so it is kept."""
    home = home if home is not None else str(Path.home())
    encoded = home.replace("/", "-")
    if isinstance(value, dict):
        return {k: scrub_paths(v, home) for k, v in value.items()}
    if isinstance(value, list):
        return [scrub_paths(v, home) for v in value]
    if isinstance(value, str):
        text = UUID.sub("<uuid>", value)
        if encoded and encoded != "-":
            text = re.sub(re.escape(encoded) + r"[^/\"]*", "<encoded-project-path>", text)
        return text
    return value


def provenance() -> dict:
    here = Path(__file__).resolve().parent
    files = [here / "probe_clients.py", here / "w19lib.py", L.RECORDER, Path(L.__file__)]
    head = subprocess.run(["git", "-C", str(W.REPO), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    return {"head": head, "sha256": {str(p.relative_to(W.REPO)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path)
    parser.add_argument("--rescrub", type=Path, help="apply the current redaction to an existing result file in place")
    args = parser.parse_args()
    if args.rescrub:
        data = json.loads(args.rescrub.read_text())
        args.rescrub.write_text(json.dumps(scrub_paths(pseudonymize(data)), indent=2, sort_keys=True) + "\n")
        return 0
    root = W.run_root("clients")
    before = W.personal_profile_fingerprint()
    result: dict = {"probe": "w19-01-clients", "run_root": rel(root, root), "provenance": provenance(), "hosts": L.host_versions()}
    for name, fn in (("auth", auth_probe), ("claude", claude_probe), ("codex", codex_probe), ("mcp_env", mcp_env_probe)):
        try:
            result[name] = fn(root)
        except Exception as exc:  # recorded, never hidden
            result[name] = {"error": f"{type(exc).__name__}: {exc}"}
    after = W.personal_profile_fingerprint()
    result["personal_profiles_unchanged"] = before == after
    if before != after:
        result["personal_profile_changes"] = sorted(k for k in before if before[k] != after.get(k))
    result["raw_captures_outside_git"] = rel(root, Path("/nonexistent"))
    text = json.dumps(scrub_paths(L.redact(pseudonymize(result))), indent=2, sort_keys=True)
    print(text)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text + "\n")
    guarantees = [
        result.get("claude", {}).get("findings", {}).get("every_session_model_free"),
        result.get("codex", {}).get("findings", {}).get("every_turn_failed_on_local_stub"),
        result["personal_profiles_unchanged"],
    ]
    errors = [k for k in ("auth", "claude", "codex", "mcp_env") if "error" in result[k]]
    return 0 if all(g is True for g in guarantees) and not errors else 2


if __name__ == "__main__":
    sys.exit(main())
