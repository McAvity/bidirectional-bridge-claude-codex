#!/usr/bin/env python3
"""W19-04 model-free probes of the real clients: selection, reload and pilot env forwarding.

  A. claude  — the exact runner arguments (runtime `bridge-claude` + admitted store variant) load
               the stored workflow over an older personal `feature-workflow`; the entry text the
               model would see is the stored release with ROOT expanded to the store; resuming the
               same session with the next admitted release shows the new text (old text stays in
               history, hence the explicit ROOT/identity block of the round prompt).
  B. codex   — the repository marketplace installs the generated `feature-workflow`; the entry the
               model would see opens with the resolve bootstrap; the installed helper begins a
               feature and, after the plugin is removed (cache gone), resolve still serves it from
               the store.
  C. env     — the pilot's isolated bridge MCP block (pilot_env.py) forwards CLAUDE_CONFIG_DIR to
               the MCP server process (PILOT-ENV-01).

Same guarantees as probe_clients.py: local capturing stubs answer HTTP 400 (zero cost/tokens for
Claude, stub error for Codex), isolated profiles under the run root, personal profiles refused and
fingerprinted, raw captures outside Git, redacted output. No model runs.

  python3 tools/pilot/workflow-versioning/probe_selection.py [--out FILE]
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

import pilot_env  # noqa: E402
import probe_clients as P  # noqa: E402
import w19lib as W  # noqa: E402

L = W.L
REPO = W.REPO
LIB_SNIPPET = "import * as W from {lib};\nconst argv = process.argv.slice(1);\n{body}"


def node_lib(body: str, *args: str) -> object:
    code = LIB_SNIPPET.format(lib=json.dumps((REPO / "scripts/workflow-source/workflow-lib.mjs").as_uri()), body=body)
    out = subprocess.run(["node", "--input-type=module", "-e", code, *args], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def publish_bundles(root: Path, store: Path) -> dict:
    source = REPO / "plugins/feature-workflow-claude/bundle"
    return node_lib("""
const A = W.storePublish(argv[1], argv[0]);
const src = W.verifyBundle(argv[0]);
const variants = { claude: W.readVariant(argv[0] + "/claude"), codex: W.readVariant(argv[0] + "/codex") };
variants.claude["skills/feature-plan/SKILL.md"] = { data: Buffer.from("---\\nname: feature-plan\\ndescription: B\\n---\\nW19-04-RELEASE-B feature-plan\\n"), mode: "644" };
const m = W.bundleManifest({ version: "1.0.1", requires: src.requires, variants, source: { commit: null } });
W.writeBundle(argv[2], m, variants);
const B = W.storePublish(argv[1], argv[2]);
process.stdout.write(JSON.stringify({ A: { ...A, version: src.version, store: W.canonicalAnchor(argv[1]) }, B: { ...B, version: "1.0.1" } }));
""", str(source), str(store), str(root / "bundle-B"))


def personal_old_workflow(market: Path) -> None:
    directory = market / "plugins" / "feature-workflow"
    (directory / ".claude-plugin").mkdir(parents=True)
    (directory / "skills" / "feature-plan").mkdir(parents=True)
    L.write_json(directory / ".claude-plugin" / "plugin.json", {"name": "feature-workflow", "version": "0.9.0", "description": "older personal copy", "author": {"name": "x"}, "license": "MIT"})
    (directory / "skills" / "feature-plan" / "SKILL.md").write_text("---\nname: feature-plan\ndescription: old personal\n---\nPERSONAL-OLD-WORKFLOW\n")
    L.write_json(market / ".claude-plugin" / "marketplace.json", {"name": "personal", "owner": {"name": "x"},
        "plugins": [{"name": "feature-workflow", "source": "./plugins/feature-workflow", "version": "0.9.0", "description": "old"}]})


def claude_probe(root: Path, bundles: dict) -> dict:
    cfg = root / "claude-config"
    cfg.mkdir()
    project = root / "claude-project"
    L.make_git_repo(project)
    market = root / "personal-market"
    personal_old_workflow(market)
    W.claude(["plugin", "marketplace", "add", str(market)], cwd=project, config_dir=cfg, stub=None)
    installed = W.claude(["plugin", "install", "feature-workflow@personal"], cwd=project, config_dir=cfg, stub=None).returncode
    store = Path(bundles["A"]["store"])
    role = REPO / "plugins" / "bridge-claude"
    cases = []
    with W.CaptureStub(root / "captures-claude") as stub:
        def turn(label: str, workflow_id: str, extra: list[str]) -> dict:
            debug = root / f"claude-debug-{label}.log"
            mark = stub.mark()
            client_root = store / workflow_id / "claude"
            proc = W.claude(["-p", "/feature-workflow:feature-plan", "--output-format", "stream-json", "--verbose", "--max-turns", "1",
                             "--permission-mode", "plan", "--debug-file", str(debug), "--plugin-dir", str(role), "--plugin-dir", str(client_root), *extra],
                            cwd=project, config_dir=cfg, stub=stub)
            events = W.stream_events(proc.stdout)
            init = next((e for e in events if e.get("type") == "system" and e.get("subtype") == "init"), {})
            result = next((e for e in reversed(events) if e.get("type") == "result"), {})
            body = W.body_text(stub.since(mark)[0]) if stub.since(mark) else ""
            plain = body.replace("\\n", "\n")
            return {
                "case": label,
                "spent_nothing": L.claude_spent_nothing(result),
                "session_id": result.get("session_id") or init.get("session_id"),
                "workflow_plugin_paths": [p.get("path") for p in init.get("plugins", []) if p.get("name") == "feature-workflow"],
                "bridge_plugin_paths": [p.get("path") for p in init.get("plugins", []) if p.get("name") == "bridge-claude"],
                "personal_text_in_request": "PERSONAL-OLD-WORKFLOW" in plain,
                "preamble_in_request": "Workflow selection — check first" in plain,
                "store_root_expanded": f"{client_root}/scripts/workflow.mjs" in plain,
                "release_b_text_in_request": "W19-04-RELEASE-B" in plain,
                "override_line": 'Plugin "feature-workflow" from --plugin-dir overrides installed version' in (debug.read_text(errors="replace") if debug.exists() else ""),
                "request_sha256": hashlib.sha256(body.encode()).hexdigest() if body else None,
            }
        first = turn("A-round", bundles["A"]["workflow_id"], [])
        cases.append(first)
        cases.append(turn("B-resume-same-session", bundles["B"]["workflow_id"], ["--resume", first["session_id"] or "missing"]))
    a, b = cases
    return {
        "personal_install_exit": installed,
        "cases": cases,
        "findings": {
            "model_free": all(c["spent_nothing"] for c in cases),
            "store_variant_overrides_personal_older_plugin": a["override_line"] and a["workflow_plugin_paths"] == [str(store / bundles["A"]["workflow_id"] / "claude")],
            "role_package_is_the_runtime_bridge_claude": a["bridge_plugin_paths"] == [str(role)],
            "entry_text_is_the_stored_release_with_store_root": a["preamble_in_request"] and a["store_root_expanded"] and not a["personal_text_in_request"],
            "resume_keeps_session": a["session_id"] is not None and a["session_id"] == b["session_id"],
            "resume_with_next_admitted_release_shows_it": b["release_b_text_in_request"] and b["workflow_plugin_paths"] == [str(store / bundles["B"]["workflow_id"] / "claude")],
            "earlier_release_text_remains_in_history": b["preamble_in_request"],
        },
    }


def codex_probe(root: Path, bridge_home: Path) -> dict:
    home = root / "codex-home"
    home.mkdir()
    project = root / "codex-project"
    L.make_git_repo(project)
    W.codex(["plugin", "marketplace", "add", str(REPO), "--json"], cwd=project, codex_home=home)
    added = W.codex(["plugin", "add", "feature-workflow@claude-codex-bridge", "--json"], cwd=project, codex_home=home)
    installed = Path(json.loads(added.stdout or "{}").get("installedPath", "/nonexistent"))
    error = {"error": {"message": "w19 probe stub", "type": "invalid_request_error", "code": "w19_probe"}}
    with W.CaptureStub(root / "captures-codex", error_body=error) as stub:
        proc = W.codex(["exec", "--json", "--skip-git-repo-check", *W.codex_stub_config(stub), "$feature-workflow:feature-plan w19-04 probe"], cwd=project, codex_home=home, stub=stub)
        body = W.body_text([r for r in stub.requests if r["path"].endswith("/responses")][-1]) if stub.requests else ""
    plain = body.replace("\\n", "\n")
    events = W.stream_events(proc.stdout)
    failed = next((e for e in events if e.get("type") == "turn.failed"), {})
    env = {**W.os.environ, "CLAUDE_CODEX_BRIDGE_HOME": str(bridge_home)}
    helper = installed / "scripts" / "workflow.mjs"
    begun = json.loads(subprocess.run(["node", str(helper), "begin", "--feature-id", "F-probe"], cwd=project, capture_output=True, text=True, env=env).stdout or "{}")
    workflow_id = begun.get("lock", {}).get("workflow", {}).get("workflow_id")
    removed = W.codex(["plugin", "remove", "feature-workflow@claude-codex-bridge"], cwd=project, codex_home=home).returncode
    stored = bridge_home / "workflows" / str(workflow_id) / "codex" / "scripts" / "workflow.mjs"
    after = json.loads(subprocess.run(["node", str(stored), "resolve", "--feature", "F-probe", "--entry", "feature-plan"], cwd=project, capture_output=True, text=True, env=env).stdout or "{}")
    return {
        "installed_path": str(installed),
        "begin_code": begun.get("code"),
        "remove_exit": removed,
        "resolve_after_remove": {"code": after.get("code"), "layout": (after.get("entry") or {}).get("layout")},
        "findings": {
            "turn_failed_on_local_stub": "w19_probe" in json.dumps(failed),
            "entry_opens_with_resolve_bootstrap": "Workflow selection — check first" in plain and "<package>/scripts/workflow.mjs" in plain and "resolve --feature <feature id" in plain,
            "entry_path_is_the_installed_cache": f"{installed}/skills/feature-plan/SKILL.md" in plain,
            "installed_helper_begins_a_feature": begun.get("code") == "BEGUN",
            "plugin_cache_removed": not installed.exists(),
            "store_serves_the_feature_after_cache_removal": after.get("code") == "BOUND_BUNDLE",
        },
    }


def env_probe(root: Path) -> dict:
    home = root / "codex-home-env"
    project = root / "env-project"
    L.make_git_repo(project)
    record = root / "mcp-record.jsonl"
    record.write_text("")
    block = pilot_env.render_bridge_block("node", [str(L.RECORDER), "--record", str(record)])
    pilot_env.write_pilot_config(home, block)
    isolated_claude = root / "pilot-claude-config"
    error = {"error": {"message": "w19 probe stub", "type": "invalid_request_error", "code": "w19_probe"}}
    with W.CaptureStub(root / "captures-env", error_body=error) as stub:
        subprocess.run([L.codex_bin(), "exec", "--json", "--skip-git-repo-check", *W.codex_stub_config(stub), "w19-04 env probe"],
                       cwd=str(project), capture_output=True, text=True, timeout=180, stdin=subprocess.DEVNULL,
                       env={**W.os.environ, "CODEX_HOME": str(home), W.CODEX_STUB_KEY_VAR: "w19-probe-not-a-real-key",
                            "CLAUDE_CONFIG_DIR": str(isolated_claude), "CLAUDE_CODEX_BRIDGE_HOME": str(root / "pilot-bridge-home")})
    start = L.record_start(L.read_record(record)) or {}
    seen = start.get("env", {})
    return {
        "block_env_vars": list(pilot_env.PILOT_MCP_ENV_VARS),
        "findings": {
            "server_started": bool(start),
            "claude_config_dir_forwarded": seen.get("CLAUDE_CONFIG_DIR") == str(isolated_claude),
            "bridge_home_forwarded": seen.get("CLAUDE_CODEX_BRIDGE_HOME") == str(root / "pilot-bridge-home"),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    root = W.run_root("selection")
    before = W.personal_profile_fingerprint()
    bridge_home = root / "bridge-home"
    bundles = publish_bundles(root, bridge_home / "workflows")
    result: dict = {"probe": "w19-04-selection", "hosts": L.host_versions(), "provenance": P.provenance(),
                    "bundles": {k: {"workflow_id": v["workflow_id"], "identity": v["identity"]} for k, v in bundles.items()}}
    for name, fn in (("claude", lambda: claude_probe(root, bundles)), ("codex", lambda: codex_probe(root, bridge_home)), ("env", lambda: env_probe(root))):
        try:
            result[name] = fn()
        except Exception as exc:  # recorded, never hidden
            result[name] = {"error": f"{type(exc).__name__}: {exc}"}
    result["personal_profiles_unchanged"] = W.personal_profile_fingerprint() == before
    text = json.dumps(P.scrub_paths(L.redact(P.pseudonymize(json.loads(json.dumps(result).replace(str(root), "<run>"))))), indent=2, sort_keys=True)
    print(text)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text + "\n")
    ok = (result.get("claude", {}).get("findings", {}).get("model_free") is True
          and result.get("codex", {}).get("findings", {}).get("turn_failed_on_local_stub") is True
          and result["personal_profiles_unchanged"] and not any("error" in result[k] for k in ("claude", "codex", "env")))
    return 0 if ok else 2


if __name__ == "__main__":
    sys.exit(main())
