#!/usr/bin/env python3
"""F-W19 W19-06 real-model pilot: setup, preflight, snapshots, model-free checks, collector.

Operator-only. Nothing here starts a model, logs in or copies credentials. The pilot itself is run
by hand following OPERATOR.md; this tool prepares an isolated run directory, proves the isolation
before any paid step and turns the run's own records into evidence.

  pilot_w19.py setup     --dest RUN [--candidate REV] [--no-runtime]
  pilot_w19.py preflight --run RUN [--clients] [--json]
  pilot_w19.py snapshot  LABEL --run RUN
  pilot_w19.py checks    --run RUN --feature-project p1 --feature F-ID
  pilot_w19.py collect   --run RUN [--public FILE]

Reused, not re-implemented: the isolation guard and personal-profile fingerprint (w19lib /
probe_lib), the pilot's MCP env forwarding list (pilot_env), the shared Codex launcher and session
selection (common/astra.sh, codex_args, collect.codex_sessions/split_sessions), the product's own
generator, setup (`bridge-plugin.mjs setup`), workflow helper and status module. The run directory
and everything in it stays outside Git; `collect --public` writes the only shareable summary
(relative paths, digests of native ids, no transcript text).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import shutil
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "common"))

import pilot_env  # noqa: E402
import probe_selection  # noqa: E402  (personal_old_workflow)
import w19lib as W  # noqa: E402
import codex_args  # noqa: E402
import collect as C  # noqa: E402

L = W.L
REPO = W.REPO
FORMAT = "claude-codex-bridge.w19-pilot/v1"
MARKER = "W19-PILOT-WORKFLOW:"
PROJECTS = ("p1", "p2")
RELEASES = {"A": "0.0.0-pilot.a", "B": "0.0.0-pilot.b", "C": "0.0.0-pilot.c"}
# decision02 / work-items/W19-06: the approved model budget. One Claude round is the reserve.
BUDGET = {"claude_rounds": 6, "reserve_rounds": 1, "max_turns_per_round": 64, "round_deadline_min": 75,
          "mcp_timeout_min": 90, "model_minutes_total": 180, "astra_turns": 24}
# The only executor-side variables the pilot adds to the bridge server's forwarded set (PILOT-ENV-01).
FORWARD = [v for v in pilot_env.PILOT_MCP_ENV_VARS if v == "CLAUDE_CONFIG_DIR"]
ENTRY_SKILLS = ("feature-flow", "feature-design", "feature-plan", "feature-execute", "feature-review", "feature-decide", "feature-exchange")
RESULTS = C.RESULTS
# The first feature of each project's start order (agent input). p1's starts under release A; p2's
# first feature starts only after B is installed (AC-02).
FEATURES = {"p1": ("F-001-reset", "add `Counter.reset()`, which sets the value back to 0 and returns 0, with a unit test."),
            "p2": ("F-001-decrement", "add `Counter.decrement()`, which lowers the value by 1 and returns it, with a unit test.")}


# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------


def sh(*cmd, cwd=None, env=None, check=True):
    proc = subprocess.run([str(c) for c in cmd], cwd=cwd, env=env, capture_output=True, text=True)
    if check and proc.returncode:
        raise SystemExit(f"{' '.join(map(str, cmd))} failed ({proc.returncode}): {proc.stderr.strip()[-600:]}")
    return proc


def digest(value) -> str | None:
    return None if value is None else hashlib.sha256(str(value).encode()).hexdigest()[:12]


def tree_sha(root: Path) -> str:
    h = hashlib.sha256()
    for p in sorted(q for q in root.rglob("*") if q.is_file() and ".git" not in q.relative_to(root).parts):
        h.update(p.relative_to(root).as_posix().encode() + b"\0" + p.read_bytes() + b"\0")
    return h.hexdigest()


def paths(run: Path) -> dict:
    return {"run": run, "codex_home": run / "codex-home", "claude_config": run / "claude-config", "bridge_home": run / "bridge-home",
            "market": run / "market", "personal_market": run / "personal-market", "releases": run / "releases",
            "projects": run / "projects", "operator": run / "operator", "results": run / "operator-results", "logs": run / "logs"}


def isolated_env(run: Path, base: dict | None = None) -> dict:
    p = paths(run)
    env = dict(base if base is not None else os.environ)
    env.update({"CODEX_HOME": str(p["codex_home"]), "CLAUDE_CONFIG_DIR": str(p["claude_config"]),
                "CLAUDE_CODEX_BRIDGE_HOME": str(p["bridge_home"]), "PILOT_DIR": str(run), "PILOT_MCP_FORWARD": " ".join(FORWARD), "PILOT_MCP_APPROVE": "1"})
    for name in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_ACCESS_TOKEN", "XDG_DATA_HOME"):
        env.pop(name, None)
    return env


def relativize(value, run: Path):
    """Replace machine paths with <run>/<home>; used for every printed or public output."""
    if isinstance(value, dict):
        return {k: relativize(v, run) for k, v in value.items()}
    if isinstance(value, list):
        return [relativize(v, run) for v in value]
    if isinstance(value, str):
        return value.replace(str(run), "<run>").replace(str(REPO), "<checkout>").replace(str(Path.home()), "<home>")
    return value


def load_json(path: Path, default=None):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def node_json(code: str, *args: str, env=None) -> dict:
    proc = sh("node", "--input-type=module", "-e", code, *args, env=env)
    return json.loads(proc.stdout)


def helper(script: Path, *args: str, cwd: Path, env: dict) -> tuple[int, dict]:
    proc = subprocess.run(["node", str(script), *args, "--json"], cwd=cwd, env=env, capture_output=True, text=True)
    try:
        return proc.returncode, json.loads(proc.stdout)
    except ValueError:
        return proc.returncode, {"unparsed": True}


# ---------------------------------------------------------------------------
# setup
# ---------------------------------------------------------------------------

MARKER_TEXT = """

## Pilot release marker (F-W19 pilot only)

This instruction set is pilot release {release}. In every brief, ledger, review or decision you
write for a feature, add exactly once the line `{marker} {token}`. Never copy it into code, commit
messages or another feature.
"""


def build_releases(run: Path, candidate: str) -> dict:
    """Generate releases A/B/C with the product generator from one archive of the candidate."""
    p = paths(run)
    tree = run / "build" / "src"
    tree.mkdir(parents=True)
    with subprocess.Popen(["git", "-C", str(REPO), "archive", "--format=tar", candidate], stdout=subprocess.PIPE) as src:
        subprocess.run(["tar", "-x", "-C", str(tree)], stdin=src.stdout, check=True)
    skills = {name: (tree / ".agents/skills" / name / "SKILL.md").read_text() for name in ENTRY_SKILLS}
    release_file = tree / "scripts/workflow-source/release.json"
    pristine = json.loads(release_file.read_text())
    out = {}
    for name, version in RELEASES.items():
        token = f"{name}-{secrets.token_hex(6)}"
        for skill, text in skills.items():
            (tree / ".agents/skills" / skill / "SKILL.md").write_text(text + MARKER_TEXT.format(release=name, marker=MARKER, token=token))
        release = json.loads(json.dumps(pristine))
        # Private synthetic versions cannot collide with the public release registry.
        release["version"], release["tag"] = version, f"workflow-v{version}"
        release["state"] = "candidate"
        if name == "C":  # needs a capability no runtime offers: must be refused before any work
            release["requires"]["bridge"]["capabilities"] = [*release["requires"]["bridge"]["capabilities"], "workflow.pilot-incompatible/v1"]
        release_file.write_text(json.dumps(release, indent=2) + "\n")
        sh("node", "scripts/plugin-packages/generate.mjs", "--component", "workflow", cwd=tree)
        target = p["releases"] / name
        target.mkdir(parents=True)
        for client in ("claude", "codex"):
            shutil.copytree(tree / f"plugins/feature-workflow-{client}", target / f"feature-workflow-{client}", copy_function=shutil.copy)
        for market_file in (".agents/plugins/marketplace.json", ".claude-plugin/marketplace.json"):
            (target / "marketplace").mkdir(exist_ok=True)
            (target / "marketplace" / market_file.replace("/", "__")).write_bytes((tree / market_file).read_bytes())
        bundle = load_json(target / "feature-workflow-codex/bundle/bundle.json")
        out[name] = {"version": version, "identity": bundle["identity"], "workflow_id": bundle["workflow_id"], "token": token}
    shutil.rmtree(run / "build")
    return out


def build_market(run: Path, releases: dict) -> dict:
    """A local marketplace repository: release A on main, release B on branch release-b.

    Clients install from it with their own commands (OPERATOR.md); "publishing" B is checking out
    that branch. The bridge packages are byte-identical in both commits (AC-01 input).
    """
    p = paths(run)
    market = p["market"]
    market.mkdir()
    env = L.git_env()
    sh("git", "init", "-q", "-b", "main", market, env=env)
    for client in ("claude", "codex"):
        shutil.copytree(REPO / f"plugins/bridge-{client}", market / f"plugins/bridge-{client}", copy_function=shutil.copy)
    commits = {}
    for name in ("A", "B"):
        if name == "B":
            sh("git", "-C", market, "checkout", "-q", "-b", "release-b", env=env)
        for client in ("claude", "codex"):
            target = market / f"plugins/feature-workflow-{client}"
            if target.exists():
                shutil.rmtree(target)
            # Content+mode copies (no timestamps): preserved times could hide an equal-size change from git.
            shutil.copytree(p["releases"] / name / f"feature-workflow-{client}", target, copy_function=shutil.copy)
        for market_file in (".agents/plugins/marketplace.json", ".claude-plugin/marketplace.json"):
            (market / market_file).parent.mkdir(parents=True, exist_ok=True)
            (market / market_file).write_bytes((p["releases"] / name / "marketplace" / market_file.replace("/", "__")).read_bytes())
        sh("git", "-C", market, "add", "-A", env=env)
        sh("git", "-C", market, "commit", "-qm", f"feature-workflow {releases[name]['version']} (pilot release {name})", env=env)
        commits[name] = sh("git", "-C", market, "rev-parse", "HEAD").stdout.strip()
        committed = json.loads(sh("git", "-C", market, "show", f"{commits[name]}:plugins/feature-workflow-codex/bundle/bundle.json").stdout)
        if committed["identity"] != releases[name]["identity"]:
            raise SystemExit(f"market commit of release {name} does not hold that release")
    sh("git", "-C", market, "checkout", "-q", "main", env=env)
    return commits


PROJECT_FILES = {
    "README.md": "# {name}: synthetic pilot project\n\nA tiny counter library used only by the F-W19 pilot.\n",
    "counter.py": "class Counter:\n    def __init__(self):\n        self.value = 0\n\n    def increment(self):\n        self.value += 1\n        return self.value\n",
    "test_counter.py": "import unittest\n\nfrom counter import Counter\n\n\nclass CounterTest(unittest.TestCase):\n    def test_increment(self):\n        self.assertEqual(Counter().increment(), 1)\n\n\nif __name__ == '__main__':\n    unittest.main()\n",
    "docs/features/README.md": "# Features\n\nFeature directories of this synthetic project.\n",
}


def build_projects(run: Path, candidate: str, *, runtime: bool) -> dict:
    p = paths(run)
    out = {}
    plugin = REPO / "plugins/bridge-codex/scripts/plugin-packages/bridge-plugin.mjs"
    for name in PROJECTS:
        project = p["projects"] / name
        project.mkdir(parents=True)
        for rel, text in PROJECT_FILES.items():
            (project / rel).parent.mkdir(parents=True, exist_ok=True)
            (project / rel).write_text(text.format(name=name))
        env = L.git_env()
        sh("git", "init", "-q", "-b", "main", project, env=env)
        sh("git", "-C", project, "config", "user.name", "astra-codex")
        sh("git", "-C", project, "config", "user.email", "astra-codex@pilot.invalid")
        sh("git", "-C", project, "add", "-A", env=env)
        sh("git", "-C", project, "commit", "-qm", f"{name}: synthetic pilot project", env=env)
        record = {"initial_commit": sh("git", "-C", project, "rev-parse", "HEAD").stdout.strip(), "runtime_setup": None}
        if runtime:
            # The product's own one-time setup: installs the candidate runtime into the isolated
            # bridge home (once) and pins it in the project. Nothing outside the run is written.
            proc = subprocess.run(["node", str(plugin), "setup", "--source", str(REPO), "--commit", candidate, "--yes", "--json"],
                                  cwd=project, env=isolated_env(run), capture_output=True, text=True)
            (p["logs"] / f"setup-{name}.log").write_text(proc.stdout + proc.stderr)
            if proc.returncode:
                codes = [r.get("code") for r in (load_json_text(proc.stdout).get("refusals") or [])]
                hint = (" — the host hides some process information; authorize the read-only observer with `sudo -v` in your terminal and rerun"
                        " with CLAUDE_CODEX_BRIDGE_PROCESS_INSPECTION=sudo in a new --dest (PILOT-HOST-01)") if "ACTIVE_USE_UNKNOWN" in codes else ""
                raise SystemExit(f"bridge setup of {name} refused {codes or proc.returncode}{hint}; see {p['logs'] / f'setup-{name}.log'}")
            sh("git", "-C", project, "add", "-A", env=env)
            sh("git", "-C", project, "commit", "-qm", f"{name}: enable the bridge (pinned candidate runtime)", env=env)
            record["runtime_setup"] = "pinned"
        out[name] = record
    return out


def write_env(run: Path) -> Path:
    env = isolated_env(run, base={})
    lines = ["# F-W19 pilot: source this in every operator shell of this run. Isolated profiles only.",
             *[f"export {k}={json.dumps(v)}" for k, v in env.items()],
             "unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL OPENAI_API_KEY OPENAI_BASE_URL CODEX_ACCESS_TOKEN XDG_DATA_HOME", ""]
    path = run / "env.sh"
    path.write_text("\n".join(lines))
    return path


def start_orders(run: Path) -> None:
    """Agent inputs: one start order per phase, filled with this run's project paths only."""
    p = paths(run)
    template = (HERE / "agent" / "START-ASTRA.template.md").read_text()
    for project in PROJECTS:
        feature_id, feature_text = FEATURES[project]
        text = (template.replace("{{PROJECT}}", project).replace("{{PROJECT_DIR}}", str(p["projects"] / project))
                .replace("{{FEATURE_ID}}", feature_id).replace("{{FEATURE_TEXT}}", feature_text))
        (run / f"START-ASTRA-{project}.md").write_text(text)


def cmd_setup(args) -> int:
    run = Path(args.dest).expanduser().resolve()
    if run.exists():
        raise SystemExit(f"refusing: {run} exists; every pilot attempt uses a new directory")
    if run == REPO or REPO in run.parents:
        raise SystemExit("refusing: the run directory must be outside this checkout")
    L.assert_isolated(run)
    candidate = sh("git", "-C", REPO, "rev-parse", "--verify", f"{args.candidate}^{{commit}}").stdout.strip()
    p = paths(run)
    for key in ("codex_home", "claude_config", "bridge_home", "operator", "results", "logs"):
        p[key].mkdir(parents=True)
    fingerprint = W.personal_profile_fingerprint()
    releases = build_releases(run, candidate)
    market = build_market(run, releases)
    probe_selection.personal_old_workflow(p["personal_market"])
    projects = build_projects(run, candidate, runtime=not args.no_runtime)
    write_env(run)
    start_orders(run)
    setup = {"format": FORMAT, "created_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "candidate": candidate,
             "tools_commit": sh("git", "-C", REPO, "rev-parse", "HEAD").stdout.strip(),
             "releases": {k: {key: v[key] for key in ("version", "identity", "workflow_id")} | {"market_commit": market.get(k)} for k, v in releases.items()},
             "projects": projects, "budget": BUDGET, "forwarded": FORWARD, "runtime": not args.no_runtime}
    (p["operator"] / "setup.json").write_text(json.dumps(setup, indent=2) + "\n")
    # Operator-only: the per-release tokens prove which text a model actually read.
    (p["operator"] / "release-tokens.json").write_text(json.dumps({k: v["token"] for k, v in releases.items()}, indent=2) + "\n")
    (p["operator"] / "personal-fingerprint-before.json").write_text(json.dumps(fingerprint, indent=2) + "\n")
    print(json.dumps(relativize(setup, run), indent=2))
    return 0


# ---------------------------------------------------------------------------
# preflight
# ---------------------------------------------------------------------------


def runtime_of(run: Path, project: Path) -> dict:
    decl = load_json(project / ".bridge-project/bridge.json") or {}
    runtime_id = (decl.get("pinned") or {}).get("runtime_id")
    manifest = load_json(paths(run)["bridge_home"] / "runtimes" / str(runtime_id) / "runtime-manifest.json") if runtime_id else None
    return {"runtime_id": runtime_id, "installed": manifest is not None,
            "advertises_binding": bool(((manifest or {}).get("compatibility") or {}).get("workflow_binding"))}


def effective_mcp(run: Path, project: Path) -> dict:
    """The bridge definition astra.sh passes to Codex for this project (no client is started)."""
    try:
        args = launch_with_forward(project)
    except (OSError, KeyError, ValueError) as error:
        return {"error": type(error).__name__}
    values = dict(a.split("=", 1) for a in args)
    env_vars = json.loads(values.get("mcp_servers.bridge.env_vars", "[]"))
    return {"env_vars": env_vars, "dispatcher": ".bridge-project/entry.mjs" in values.get("mcp_servers.bridge.args", ""),
            "trusted": any(k.startswith("projects.") for k in values),
            "tools_approved": json.loads(values.get("mcp_servers.bridge.default_tools_approval_mode", "null")) == "approve"}


def client_checks(run: Path) -> list[dict]:
    """Model-free reads of the real clients under the isolated profiles (no login, no model)."""
    env = isolated_env(run)
    out = []
    claude = subprocess.run([L.claude_bin(), "auth", "status", "--json"], env=env, capture_output=True, text=True, timeout=60)
    status = load_json_text(claude.stdout)
    in_run = status.get("configDirectory") == str(paths(run)["claude_config"])
    out.append(check("PILOT-AUTH-01", "PASS" if status.get("loggedIn") is True and in_run else "PENDING",
                     "isolated Claude profile logged in through a supported subscription login" if status.get("loggedIn") else
                     "log in the isolated Claude profile (OPERATOR.md § 1); never copy credentials",
                     {"logged_in": status.get("loggedIn"), "auth_method": status.get("authMethod"), "config_dir_is_isolated": in_run}))
    codex = subprocess.run([L.codex_bin(), "login", "status"], env=env, capture_output=True, text=True, timeout=60)
    out.append(check("PILOT-AUTH-02", "PASS" if codex.returncode == 0 else "PENDING",
                     "isolated Codex profile logged in" if codex.returncode == 0 else "log in the isolated Codex profile (OPERATOR.md § 1)", {"exit": codex.returncode}))
    for project in PROJECTS:
        directory = paths(run)["projects"] / project
        try:
            overrides = [x for arg in launch_with_forward(directory) for x in ("-c", arg)]
        except (OSError, KeyError, ValueError) as error:
            out.append(check(f"P-MCP-{project}", "FAIL", "the project has no bridge definition (setup without runtime?)", {"error": type(error).__name__}))
            continue
        proc = subprocess.run([L.codex_bin(), *overrides, "mcp", "get", "bridge", "--json"], cwd=directory, env=env, capture_output=True, text=True, timeout=60)
        got = load_json_text(proc.stdout)
        forwarded = set(((got.get("transport") or got).get("env_vars")) or [])
        need = {"CLAUDE_CODEX_BRIDGE_HOME", *FORWARD}
        out.append(check(f"P-MCP-{project}", "PASS" if proc.returncode == 0 and need <= forwarded else "FAIL",
                         "Codex resolves the bridge server with the pilot's env forwarding", {"exit": proc.returncode, "env_vars": sorted(forwarded)}))
    entries = node_json("import {detectEntries} from %s; process.stdout.write(JSON.stringify(detectEntries({env: process.env})));"
                        % json.dumps((REPO / "scripts/setup/workflow-status.mjs").as_uri()), env=env)
    out.append(check("P-ENTRIES", "INFO", "workflow entry plugins installed in the isolated clients (configured, not loaded)",
                     {client: [{k: e.get(k) for k in ("plugin", "version", "bootstrap", "stale_feature_copies")} for e in rows] for client, rows in entries.items()}))
    return out


def launch_with_forward(project: Path) -> list[str]:
    """codex_args.launch_args with this pilot's PILOT_MCP_FORWARD / PILOT_MCP_APPROVE (as astra.sh sees them)."""
    pilot = {"PILOT_MCP_FORWARD": " ".join(FORWARD), "PILOT_MCP_APPROVE": "1"}
    saved = {k: os.environ.get(k) for k in pilot}
    os.environ.update(pilot)
    try:
        return codex_args.launch_args(project)
    finally:
        for key, value in saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def load_json_text(text: str) -> dict:
    try:
        value = json.loads(text)
        return value if isinstance(value, dict) else {}
    except ValueError:
        return {}


def check(cid: str, status: str, detail: str, data=None) -> dict:
    return {"id": cid, "status": status, "detail": detail, **({"data": data} if data is not None else {})}


def preflight(run: Path, *, clients: bool) -> dict:
    p = paths(run)
    setup = load_json(p["operator"] / "setup.json")
    if not setup or setup.get("format") != FORMAT:
        return {"format": FORMAT, "ready": False, "pilot": "NOT_TESTED", "checks": [check("P-SETUP", "FAIL", "not a pilot_w19 run directory")]}
    checks = []
    env = load_env(run)
    isolated = [env.get(k) == str(p[v]) for k, v in (("CODEX_HOME", "codex_home"), ("CLAUDE_CONFIG_DIR", "claude_config"), ("CLAUDE_CODEX_BRIDGE_HOME", "bridge_home"))]
    try:
        L.assert_isolated(*(Path(env[k]) for k in ("CODEX_HOME", "CLAUDE_CONFIG_DIR", "CLAUDE_CODEX_BRIDGE_HOME") if k in env))
        personal = False
    except SystemExit:
        personal = True
    checks.append(check("P-ISO-01", "PASS" if all(isolated) and not personal and REPO not in run.parents else "FAIL",
                        "env.sh points every client profile and the bridge home inside the run directory"))
    before = load_json(p["operator"] / "personal-fingerprint-before.json") or {}
    now = W.personal_profile_fingerprint()
    changed = sorted(k for k in now if now[k] != before.get(k))
    # A mis-isolated plugin install or marketplace change would show in the personal plugin state;
    # session state and token refreshes of the user's own running clients change other files.
    plugin_state = [k for k in changed if "/plugins" in k]
    checks.append(check("P-ISO-02", "FAIL" if plugin_state or not before else "PASS",
                        "personal Claude/Codex plugin state unchanged since setup (size/mtime only; content never read)",
                        {"plugin_state_changed": plugin_state, "other_personal_files_changed_by_own_use": [k for k in changed if k not in plugin_state]}))
    forwarded = env.get("PILOT_MCP_FORWARD", "").split()
    runtimes = {}
    for project in PROJECTS:
        directory = p["projects"] / project
        runtimes[project] = runtime_of(run, directory)
        mcp = effective_mcp(run, directory)
        need = {"CLAUDE_CODEX_BRIDGE_HOME", *FORWARD}
        checks.append(check(f"P-ENV-{project}", "PASS" if need <= set(mcp.get("env_vars", [])) and mcp.get("dispatcher") and set(FORWARD) <= set(forwarded) else "FAIL",
                            "the bridge server of this project forwards CLAUDE_CODEX_BRIDGE_HOME and CLAUDE_CONFIG_DIR (PILOT-ENV-01)", mcp))
    ids = {r["runtime_id"] for r in runtimes.values()}
    ok = len(ids) == 1 and None not in ids and all(r["installed"] and r["advertises_binding"] for r in runtimes.values())
    checks.append(check("P-RT-01", "PASS" if ok else "FAIL", "both projects pin the same installed runtime that advertises workflow binding", runtimes))
    market = p["market"]
    head = sh("git", "-C", market, "rev-parse", "HEAD", check=False).stdout.strip()
    rel = setup["releases"]
    bridge_same = sh("git", "-C", market, "diff", "--quiet", rel["A"]["market_commit"], rel["B"]["market_commit"], "--", "plugins/bridge-claude", "plugins/bridge-codex", check=False).returncode == 0
    distinct = len({r["identity"] for r in rel.values()}) == 3
    checks.append(check("P-REL-01", "PASS" if distinct and bridge_same else "FAIL", "releases A/B/C have distinct identities; bridge packages identical in A and B",
                        {k: {"version": v["version"], "workflow_id": v["workflow_id"]} for k, v in rel.items()} | {"market_at": "A" if head == rel["A"]["market_commit"] else "B" if head == rel["B"]["market_commit"] else "other"}))
    leaks = [str(f.relative_to(run)) for f in p["projects"].rglob("*") if f.is_file() and ".git" not in f.parts and any(t in f.read_text(errors="ignore") for t in tokens(run).values())]
    checks.append(check("P-CONTAM-01", "PASS" if not leaks else "FAIL", "no release token or operator material inside the projects", leaks or None))
    spent = budget_usage(run)
    checks.append(check("P-BUD-01", "PASS" if spent["claude_rounds"] == 0 and spent["astra_turns"] == 0 else "INFO",
                        "budget (decision02) and usage so far", {"limits": BUDGET, "used": spent}))
    if clients:
        checks.extend(client_checks(run))
    else:
        checks.append(check("PILOT-AUTH", "PENDING", "client and login checks not run (use --clients after logging in the isolated profiles)"))
    ready = all(c["status"] in ("PASS", "INFO") for c in checks)
    nxt = [] if ready else [c["id"] for c in checks if c["status"] in ("FAIL", "PENDING")]
    return {"format": FORMAT, "kind": "preflight", "ready": ready, "pilot": "NOT_TESTED", "blocking": nxt, "checks": checks}


def load_env(run: Path) -> dict:
    out = {}
    for line in (run / "env.sh").read_text().splitlines():
        if line.startswith("export "):
            key, value = line[len("export "):].split("=", 1)
            out[key] = json.loads(value)
    return out


def tokens(run: Path) -> dict:
    return load_json(paths(run)["operator"] / "release-tokens.json", {}) or {}


def cmd_preflight(args) -> int:
    run = Path(args.run).resolve()
    result = relativize(preflight(run, clients=args.clients), run)
    (paths(run)["results"] / "preflight.json").write_text(json.dumps(result, indent=2) + "\n")
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        for c in result["checks"]:
            print(f"{c['status']:8} {c['id']:16} {c['detail']}")
        print("PREFLIGHT OK" if result["ready"] else f"PREFLIGHT NOT READY: {', '.join(result['blocking'])}")
    return 0 if result["ready"] else 1


# ---------------------------------------------------------------------------
# state: snapshots and the collector's own reads (all read-only)
# ---------------------------------------------------------------------------


def db_state(project: Path) -> dict:
    path = project / ".bridge/bridge.db"
    if not path.exists():
        return {"exists": False}
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    try:
        tables = {r[0] for r in db.execute("select name from sqlite_master where type='table'")}
        features = []
        for row in db.execute("select feature_id, json from features order by feature_id"):
            record = json.loads(row["json"])
            w = record.get("workflow") or {}
            features.append({"feature_id": row["feature_id"], "state": record.get("state"), "task_ids": record.get("task_ids", []),
                             "identity": w.get("identity"), "generation": w.get("generation"), "kind": w.get("kind"),
                             "history": [{"op": h.get("op"), "from": h.get("from_identity") or h.get("from"), "to": h.get("identity") or h.get("to"), "generation": h.get("generation")} for h in w.get("history", [])]})
        attempts = [dict(r) for r in db.execute("select task_id, attempt, agent, resumed_from_attempt, execution_handle, started_at, ended_at, outcome from task_attempts order by started_at")]
        admitted = {(r["task_id"], r["attempt"]): dict(r) for r in db.execute("select * from attempt_workflow")} if "attempt_workflow" in tables else {}
        telemetry = {(r["task_id"], r["attempt"]): json.loads(r["json"]) for r in db.execute("select task_id, attempt, json from attempt_telemetry")} if "attempt_telemetry" in tables else {}
        for a in attempts:
            key = (a["task_id"], a["attempt"])
            a["admitted_identity"] = (admitted.get(key) or {}).get("identity")
            a["admitted_generation"] = (admitted.get(key) or {}).get("generation")
            t = telemetry.get(key) or {}
            a["turn_count"], a["wall_duration_ms"] = t.get("turn_count"), t.get("wall_duration_ms")
            spec = db.execute("select spec_json from tasks where task_id=?", (a["task_id"],)).fetchone()
            a["feature_id"] = (json.loads(spec["spec_json"]).get("feature_id") if spec else None) or next((f["feature_id"] for f in features if a["task_id"] in f["task_ids"]), None)
        epochs = [dict(r) for r in db.execute("select epoch, native_thread_id, bound_at, ended_at from manager_epochs order by epoch")] if "manager_epochs" in tables else []
        return {"exists": True, "features": features, "attempts": attempts, "manager_epochs": epochs}
    finally:
        db.close()


def locks(project: Path) -> list[dict]:
    out = []
    root = project / "docs/features"
    for lock_path in sorted(root.glob("*/workflow.lock.json")) if root.exists() else []:
        lock = load_json(lock_path, {}) or {}
        out.append({"dir": lock_path.parent.name, "feature_id": (lock.get("feature") or {}).get("feature_id"),
                    "identity": (lock.get("workflow") or {}).get("identity"), "generation": lock.get("generation"),
                    "history": [h.get("op") for h in lock.get("history", [])]})
    return out


def markers(project: Path, toks: dict) -> list[dict]:
    """Release tokens written by agents: which instruction text a model actually followed."""
    by_token = {v: k for k, v in toks.items()}
    out = []
    root = project / "docs/features"
    for path in sorted(root.rglob("*.md")) if root.exists() else []:
        rel = path.relative_to(root)
        text = path.read_text(errors="ignore")
        for line in text.splitlines():
            if MARKER in line:
                value = line.split(MARKER, 1)[1].strip().strip("`").strip()
                out.append({"feature_dir": rel.parts[0], "file": rel.as_posix(), "role": "executor" if "execution" in rel.parts else "manager",
                            "release": by_token.get(value, "UNKNOWN"),
                            "first_commit_ms": first_commit_ms(project, path)})
    return out


def first_commit_ms(project: Path, path: Path) -> int | None:
    proc = sh("git", "-C", project, "log", "--diff-filter=A", "--format=%ct", "--", str(path.relative_to(project)), check=False)
    stamps = [int(x) for x in proc.stdout.split()]
    return min(stamps) * 1000 if stamps else None


def client_entries(run: Path) -> dict:
    try:
        return node_json("import {detectEntries} from %s; process.stdout.write(JSON.stringify(detectEntries({env: process.env})));"
                         % json.dumps((REPO / "scripts/setup/workflow-status.mjs").as_uri()), env=isolated_env(run))
    except SystemExit:
        return {"error": "UNREADABLE"}


def state(run: Path) -> dict:
    p = paths(run)
    toks = tokens(run)
    projects = {}
    for name in PROJECTS:
        project = p["projects"] / name
        projects[name] = {"head": sh("git", "-C", project, "rev-parse", "HEAD", check=False).stdout.strip(), "runtime": runtime_of(run, project),
                          "locks": locks(project), "db": db_state(project), "markers": markers(project, toks)}
    store = p["bridge_home"] / "workflows"
    return {"at_ms": int(time.time() * 1000), "projects": projects, "entries": client_entries(run),
            "store": sorted(x.name for x in store.iterdir() if x.is_dir() and not x.name.startswith(".")) if store.exists() else [],
            "market_head": sh("git", "-C", p["market"], "rev-parse", "HEAD", check=False).stdout.strip()}


def cmd_snapshot(args) -> int:
    run = Path(args.run).resolve()
    directory = paths(run)["results"] / "snapshots"
    directory.mkdir(parents=True, exist_ok=True)
    index = len(list(directory.glob("*.json")))
    snap = {"label": args.label, **state(run)}
    path = directory / f"{index:02d}-{args.label}.json"
    path.write_text(json.dumps(snap, indent=2) + "\n")
    with (paths(run)["logs"] / "operator.log").open("a") as log:
        log.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S%z')} snapshot {args.label}\n")
    print(f"snapshot {index:02d}-{args.label}")
    return 0


def snapshots(run: Path) -> list[dict]:
    directory = paths(run)["results"] / "snapshots"
    return [load_json(f) for f in sorted(directory.glob("*.json"))] if directory.exists() else []


# ---------------------------------------------------------------------------
# model-free checks: incompatible release, exact offline restore, standalone
# ---------------------------------------------------------------------------


def cmd_checks(args) -> int:
    run = Path(args.run).resolve()
    p = paths(run)
    env = isolated_env(run)
    project = p["projects"] / args.feature_project
    out = {"format": FORMAT, "kind": "checks", "at_ms": int(time.time() * 1000), "checks": []}
    add = lambda cid, ok, detail, data=None: out["checks"].append(check(cid, "PASS" if ok else "FAIL", detail, data))  # noqa: E731
    # AC-05: release C needs a capability the pinned runtime lacks → refused before any write.
    script_c = p["releases"] / "C/feature-workflow-codex/scripts/workflow.mjs"
    before = (tree_sha(project), sorted(x.name for x in (p["bridge_home"] / "workflows").iterdir()) if (p["bridge_home"] / "workflows").exists() else [])
    code_r, res = helper(script_c, "resolve", "--new", cwd=project, env=env)
    code_b, beg = helper(script_c, "begin", cwd=project, env=env)
    after = (tree_sha(project), sorted(x.name for x in (p["bridge_home"] / "workflows").iterdir()) if (p["bridge_home"] / "workflows").exists() else [])
    add("CHK-INCOMPATIBLE", code_r == 3 and res.get("code") == "WORKFLOW_INCOMPATIBLE" and code_b == 3 and beg.get("code") == "WORKFLOW_INCOMPATIBLE" and before == after,
        "an incompatible release is refused by resolve and begin with a named diagnosis and no write", {"resolve": res.get("code"), "begin": beg.get("code"), "unchanged": before == after})
    # AC-08: exact offline restore of the feature's bound release from that release's package.
    lock = load_json(project / "docs/features" / args.feature / "workflow.lock.json", {}) or {}
    identity = (lock.get("workflow") or {}).get("identity")
    release = next((k for k, v in load_json(p["operator"] / "setup.json")["releases"].items() if v["identity"] == identity), None)
    script = p["releases"] / str(release) / "feature-workflow-codex/scripts/workflow.mjs"
    if identity and release:
        entry = p["bridge_home"] / "workflows" / lock["workflow"]["workflow_id"]
        original = tree_sha(entry)
        backup = p["results"] / "store-backup" / entry.name
        backup.parent.mkdir(parents=True, exist_ok=True)
        sh("chmod", "-R", "u+w", entry.parent)
        shutil.move(str(entry), str(backup))
        code1, r1 = helper(script, "resolve", "--feature", args.feature, cwd=project, env=env)
        code2, r2 = helper(script, "restore", "--identity", identity, "--from", str(p["releases"] / release / "feature-workflow-codex"), cwd=project, env=env)
        code3, r3 = helper(script, "resolve", "--feature", args.feature, cwd=project, env=env)
        add("CHK-RESTORE", r1.get("code") == "BUNDLE_MISSING" and code2 == 0 and r3.get("code") == "BOUND_BUNDLE" and tree_sha(entry) == original,
            "a missing store copy is detected and restored exactly (same tree) from the package of that identity, without network",
            {"missing": r1.get("code"), "restore_exit": code2, "after": r3.get("code"), "identical": tree_sha(entry) == original if entry.exists() else False})
    else:
        out["checks"].append(check("CHK-RESTORE", "NOT_TESTED", "the named feature has no lock of a pilot release"))
    # AC-10: standalone, no bridge pin and no MCP: begin, resolve from the store.
    standalone = run / "standalone"
    if not standalone.exists():
        L.make_git_repo(standalone)
    script_b = p["releases"] / "B/feature-workflow-codex/scripts/workflow.mjs"
    s1, a1 = helper(script_b, "resolve", "--new", cwd=standalone, env=env)
    s2, a2 = helper(script_b, "begin", cwd=standalone, env=env)
    s3, a3 = helper(p["bridge_home"] / "workflows" / load_json(p["operator"] / "setup.json")["releases"]["B"]["workflow_id"] / "codex/scripts/workflow.mjs",
                    "resolve", "--feature", a2.get("feature_dir", "missing"), cwd=standalone, env=env)
    add("CHK-STANDALONE", (a1.get("project") or {}).get("pin") == "none" and a2.get("code") == "BEGUN" and a3.get("code") == "BOUND_BUNDLE",
        "without a pin or MCP the workflow begins a feature and serves it from the store", {"resolve_new": a1.get("code"), "begin": a2.get("code"), "resolve": a3.get("code")})
    (p["results"] / "checks.json").write_text(json.dumps(relativize(out, run), indent=2) + "\n")
    for c in out["checks"]:
        print(f"{c['status']:10} {c['id']:18} {c['detail']}")
    return 0 if all(c["status"] == "PASS" for c in out["checks"]) else 1


# ---------------------------------------------------------------------------
# collector
# ---------------------------------------------------------------------------


def union_minutes(intervals: list[tuple[int, int]]) -> float:
    total, end = 0, None
    for a, b in sorted(i for i in intervals if i[0] is not None and i[1] is not None):
        if end is None or a > end:
            total += b - a
            end = b
        elif b > end:
            total += b - end
            end = b
    return round(total / 60000, 1)


def manager_sessions(run: Path, project: Path) -> dict:
    saved = os.environ.get("CODEX_HOME")
    os.environ["CODEX_HOME"] = str(paths(run)["codex_home"])
    try:
        split = C.split_sessions(C.codex_sessions(project))
    finally:
        if saved is None:
            os.environ.pop("CODEX_HOME", None)
        else:
            os.environ["CODEX_HOME"] = saved
    manager = split["manager"]
    intervals, start = [], None
    for event in (manager or {}).get("turn_events", []):
        if event["type"] == "started":
            start = C.ts_ms(event["at"])
        elif start is not None:
            intervals.append((start, C.ts_ms(event["at"])))
            start = None
    return {"status": split["status"], "session": manager["session_id"] if manager else None, "candidates": len(split["candidates"]),
            "turns": (manager or {}).get("turns_started", 0), "intervals": intervals}


def budget_usage(run: Path) -> dict:
    p = paths(run)
    rounds, turns_over, deadline_over, intervals, astra = 0, [], [], [], 0
    for name in PROJECTS:
        project = p["projects"] / name
        db = db_state(project) if project.exists() else {"exists": False}
        for a in db.get("attempts", []) if db.get("exists") else []:
            if a["agent"] != "claude":
                continue
            rounds += 1
            if (a["turn_count"] or 0) > BUDGET["max_turns_per_round"]:
                turns_over.append(digest(a["task_id"]))
            if a["ended_at"] and a["ended_at"] - a["started_at"] > BUDGET["round_deadline_min"] * 60000:
                deadline_over.append(digest(a["task_id"]))
            intervals.append((a["started_at"], a["ended_at"] or int(time.time() * 1000)))
        if project.exists() and paths(run)["codex_home"].exists():
            m = manager_sessions(run, project)
            astra += m["turns"]
            intervals.extend(m["intervals"])
    used = {"claude_rounds": rounds, "astra_turns": astra, "model_minutes": union_minutes(intervals),
            "rounds_over_turn_limit": turns_over, "rounds_over_deadline": deadline_over}
    used["exceeded"] = [k for k, ok in (("claude_rounds", rounds <= BUDGET["claude_rounds"]), ("astra_turns", astra <= BUDGET["astra_turns"]),
                                         ("model_minutes", used["model_minutes"] <= BUDGET["model_minutes_total"]),
                                         ("max_turns_per_round", not turns_over), ("round_deadline", not deadline_over)) if not ok]
    return used


def evaluate(run: Path, snaps: list[dict], final: dict, checks: dict | None) -> list[dict]:
    """Cases from the run's own records.

    A case is PASS only when three layers agree: configured (lock and binding), admitted
    (attempt_workflow) and followed (the release token an agent wrote itself, which only the text of
    that release contains). A precondition that did not happen is NOT_TESTED, never PASS.
    """
    setup = load_json(paths(run)["operator"] / "setup.json")
    ident = {k: v["identity"] for k, v in setup["releases"].items()}
    release_of = {v: k for k, v in ident.items()}
    cases = []

    def case(cid, ac, result, detail, data=None):
        cases.append({"id": cid, "ac": ac, "result": result, "detail": detail, **({"data": data} if data is not None else {})})

    def worst(results):
        order = {"FAIL": 0, "INFRA": 1, "NOT_TESTED": 2, "PASS": 3}
        return min(results, key=lambda r: order.get(r, 0)) if results else "NOT_TESTED"

    labels = [s["label"] for s in snaps]
    ub = labels.index("updated-b") if "updated-b" in labels else None
    removed = snaps[labels.index("cache-removed")] if "cache-removed" in labels else None
    features = {(n, f["feature_id"]): f for n in PROJECTS for f in (final["projects"][n]["db"].get("features") or [])}
    attempts = sorted((dict(a, project=n) for n in PROJECTS for a in (final["projects"][n]["db"].get("attempts") or []) if a["agent"] == "claude"), key=lambda a: a["started_at"])
    marks = [dict(m, project=n) for n in PROJECTS for m in final["projects"][n]["markers"]]
    switches = switch_time(final)
    first_lock = {}
    for index, snap in enumerate([*snaps, final]):
        for n in PROJECTS:
            for lock in snap["projects"][n]["locks"]:
                first_lock.setdefault((n, lock["feature_id"]), (index, release_of.get(lock["identity"], "UNKNOWN")))

    def window(n, fid, since=0, until=10 ** 15):
        f = features.get((n, fid)) or {}
        mine = [a for a in attempts if a["project"] == n and a["feature_id"] == fid and since <= a["started_at"] < until]
        followed = [m for m in marks if m["project"] == n and m["feature_dir"] == fid and since <= (m["first_commit_ms"] or 0) < until]
        return {"bound_now": release_of.get(f.get("identity"), None), "admitted": sorted({release_of.get(a["admitted_identity"], "UNKNOWN") for a in mine}),
                "followed": sorted({f"{m['role']}:{m['release']}" for m in followed}), "attempts": len(mine)}

    def verdict(w, release):
        if not w["attempts"] or not any(x.startswith("executor:") for x in w["followed"]):
            return "NOT_TESTED"
        return "PASS" if w["admitted"] == [release] and all(x.endswith(f":{release}") for x in w["followed"]) else "FAIL"

    # C01 — only the workflow changed: B in both clients, same engine pin, same bridge packages.
    pins = {s["projects"][n]["runtime"]["runtime_id"] for s in [*snaps, final] for n in PROJECTS}
    claude_updated = snaps[labels.index("claude-updated")] if "claude-updated" in labels else None
    if ub is None or claude_updated is None:
        case("C01", "AC-01", "NOT_TESTED", "needs the `updated-b` (Codex) and `claude-updated` (Claude) snapshots of the client updates")
    else:
        def versions(snap, client):
            return sorted({e.get("version") for e in (snap["entries"].get(client) or []) if e.get("plugin") == "feature-workflow" and e.get("marketplace") != "personal"})
        seen = {"codex": versions(snaps[ub], "codex"), "claude": versions(claude_updated, "claude")}
        ok = len(pins) == 1 and snaps[ub]["market_head"] == setup["releases"]["B"]["market_commit"] and all(RELEASES["B"] in v for v in seen.values())
        case("C01", "AC-01", "PASS" if ok else "FAIL", "B installed and updated through each client's own commands, same runtime pin, bridge packages unchanged (P-REL-01)",
             {"feature_workflow_versions_after_update": seen, "runtime_pins": len(pins)})
    # C02 — features begun after the update select B, in both prepared projects.
    after = [k for k, (index, _) in first_lock.items() if ub is not None and index >= ub]
    if not after:
        case("C02", "AC-02", "NOT_TESTED", "no feature was begun after release B was installed")
    else:
        per = {f"{n}/{fid}": window(n, fid, until=switches.get((n, fid), 10 ** 15)) | {"locked_with": first_lock[(n, fid)][1]} for n, fid in after}
        res = [verdict(w, "B") if w["locked_with"] == "B" else "FAIL" for w in per.values()]
        both = {n for n, _ in after} == set(PROJECTS)
        case("C02", "AC-02", worst(res) if both or "FAIL" in res else "NOT_TESTED", "a feature begun after the update selects B in each prepared project", per)
    # C03 — a feature begun under A keeps A after the update, cache removal and restart.
    before = [k for k, (index, rel) in first_lock.items() if rel == "A" and ub is not None and index < ub]
    if not before or removed is None:
        case("C03", "AC-03", "NOT_TESTED", "needs a feature begun under A and a `cache-removed` snapshot before its next round")
    else:
        per = {f"{n}/{fid}": window(n, fid, removed["at_ms"], switches.get((n, fid), 10 ** 15)) for n, fid in before}
        case("C03", "AC-03", worst([verdict(w, "A") for w in per.values()]), "rounds after the cache removal (and before any explicit switch) follow A", per)
    # C04 — manager and Claude follow the same selected release; personal executor plugin older and absent.
    states = {s["label"]: personal_state(s) for s in snaps}

    def selected_at(n, fid, t):
        initial = first_lock.get((n, fid), (0, "UNKNOWN"))[1]
        return "B" if (n, fid) in switches and t >= switches[(n, fid)] else initial

    mismatched = [f"{m['project']}/{m['file']}" for m in marks if m["release"] != selected_at(m["project"], m["feature_dir"], m["first_commit_ms"] or 0)]
    roles = {m["role"] for m in marks}
    if not marks:
        case("C04", "AC-04", "NOT_TESTED", "no release token was written by any agent")
    else:
        result = "FAIL" if mismatched else "PASS" if roles == {"manager", "executor"} and {"older", "absent"} <= set(states.values()) else "NOT_TESTED"
        case("C04", "AC-04", result, "every token written by the manager and by Claude matches the release selected at that time; personal executor plugin seen older and absent",
             {"personal_executor_plugin_by_snapshot": states, "mismatched_files": mismatched, "roles_seen": sorted(roles)})
    # C06 — explicit switch A→B in the same native manager thread and the same Claude session.
    if not switches:
        case("C06", "AC-06", "NOT_TESTED", "no explicit switch was recorded")
    else:
        per, res = {}, []
        for (n, fid), at in switches.items():
            mine = [a for a in attempts if a["project"] == n and a["feature_id"] == fid]
            handles = {a["execution_handle"] for a in mine if a["execution_handle"]}
            threads = {e["native_thread_id"] for e in final["projects"][n]["db"].get("manager_epochs") or []}
            post = window(n, fid, at)
            w = {"rounds_before": len([a for a in mine if a["started_at"] < at]), "rounds_after": post["attempts"], "admitted_after": post["admitted"],
                 "followed_after": post["followed"], "claude_sessions": len(handles), "manager_threads": len(threads)}
            per[f"{n}/{fid}"] = w
            if not w["rounds_before"] or not w["rounds_after"]:
                res.append("NOT_TESTED")
            elif len(handles) != 1 or len(threads) != 1:
                res.append("FAIL")  # a substitute session is never acceptable
            else:
                res.append(verdict(post, "B"))
        case("C06", "AC-06", worst(res), "explicit switch A→B with one Claude session and one manager thread before and after", per)
    # C05 / C08 / C10 — the run's model-free product checks.
    for cid, ac, key in (("C05", "AC-05", "CHK-INCOMPATIBLE"), ("C08", "AC-08", "CHK-RESTORE"), ("C10", "AC-10", "CHK-STANDALONE")):
        found = next((c for c in (checks or {}).get("checks", []) if c["id"] == key), None)
        case(cid, ac, found["status"] if found else "NOT_TESTED", (found or {}).get("detail", f"`checks` not run ({key})"))
    # Manager continuity: one top-level native session per project, never a substitute.
    for n in PROJECTS:
        m = manager_sessions(run, paths(run)["projects"] / n)
        case(f"S-{n}", "AC-04/06", {"missing": "NOT_TESTED", "selected": "PASS"}.get(m["status"], "FAIL"),
             "one native manager session for the project (resumed after restarts, never replaced)",
             {"status": m["status"], "candidates": m["candidates"], "session": digest(m.get("session"))})
    return cases


def switch_time(final: dict) -> dict:
    """(project, feature) → start of the first attempt admitted with the switched generation."""
    out = {}
    for n in PROJECTS:
        db = final["projects"][n]["db"]
        for f in db.get("features") or []:
            gens = [h["generation"] or 0 for h in f["history"] if h["op"] == "switch"]
            if gens:
                post = [a["started_at"] for a in db.get("attempts") or [] if a["feature_id"] == f["feature_id"] and a["admitted_generation"] == max(gens)]
                out[(n, f["feature_id"])] = min(post) if post else 10 ** 15
    return out


def personal_state(snap: dict) -> str:
    """The personal (isolated) Claude executor's own feature-workflow plugin at a snapshot."""
    claude = [e for e in (snap.get("entries") or {}).get("claude") or [] if e.get("plugin") == "feature-workflow"]
    if not claude:
        return "absent"
    return "older" if all(e.get("version") not in RELEASES.values() for e in claude) else "current"


def cmd_collect(args) -> int:
    run = Path(args.run).resolve()
    snaps = snapshots(run)
    final = {"label": "final", **state(run)}
    checks = load_json(paths(run)["results"] / "checks.json")
    cases = evaluate(run, snaps, final, checks)
    usage = budget_usage(run)
    order = {"FAIL": 0, "INFRA": 1, "NOT_TESTED": 2, "N/A": 3, "PASS": 4}
    overall = min((c["result"] for c in cases), key=lambda r: order.get(r, 0)) if cases else "NOT_TESTED"
    if usage["exceeded"] and overall == "PASS":
        overall = "FAIL"
    result = {"format": FORMAT, "kind": "result", "overall": overall, "budget": {"limits": BUDGET, "used": usage},
              "snapshots": [s["label"] for s in snaps], "cases": cases,
              "layers": {"configured": "lock and bridge binding", "admitted": "attempt_workflow per attempt",
                         "followed": "release token written by the agent itself (only a model run produces it)"}}
    (paths(run)["results"] / "result.json").write_text(json.dumps(relativize(result, run), indent=2) + "\n")
    if args.public:
        public = relativize(result, run)
        Path(args.public).write_text(json.dumps(public, indent=2) + "\n")
    print(json.dumps({"overall": overall, "cases": {c["id"]: c["result"] for c in cases}, "budget_exceeded": usage["exceeded"]}, indent=2))
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    s = sub.add_parser("setup")
    s.add_argument("--dest", required=True)
    s.add_argument("--candidate", default="HEAD")
    s.add_argument("--no-runtime", action="store_true", help="skip the runtime install and pin (tooling tests only)")
    s = sub.add_parser("preflight")
    s.add_argument("--run", required=True)
    s.add_argument("--clients", action="store_true")
    s.add_argument("--json", action="store_true")
    s = sub.add_parser("snapshot")
    s.add_argument("label")
    s.add_argument("--run", required=True)
    s = sub.add_parser("checks")
    s.add_argument("--run", required=True)
    s.add_argument("--feature-project", default="p1", choices=PROJECTS)
    s.add_argument("--feature", required=True)
    s = sub.add_parser("collect")
    s.add_argument("--run", required=True)
    s.add_argument("--public")
    args = parser.parse_args(argv)
    return {"setup": cmd_setup, "preflight": cmd_preflight, "snapshot": cmd_snapshot, "checks": cmd_checks, "collect": cmd_collect}[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
