#!/usr/bin/env python3
"""W17-01 host probes for the separate feature-workflow plugin (model-free).

Questions (contract: docs/features/F-W17-workflow-plugin/contracts/01-distribution.md):

  A. source selection — which instruction set does a workflow skill follow in a project with no
     bridge, an old (pre-wave16, ZIP) pin, a new (wave16 local-v1) pin, a missing/conflicting pin
     or a legacy layout; and is that read free of writes?
  B. packages — do candidate packages carry all six entries, their references, local-delivery.md
     where the source has it, and an exchange helper that works outside a bridge checkout?
  C. Claude Code — discovery and namespace of the six entries, collision with the legacy
     bridge-claude plugin, disabling it, `--plugin-dir` delegation with and without a personal
     install, update and uninstall.
  D. Codex — discovery and namespace, coexistence with bridge-codex and repo-local skills, update
     and uninstall.

Every instruction set is extracted from a Git commit: pre-wave16 pin 34ecb8d (runtime
0.3.2-34ecb8d45465) versus the wave17 base, so the selection tests never pass on identical files.
Profiles, marketplaces, runtimes and projects live in a disposable run root; `probe_lib`
refuses the personal profiles. Claude sessions hit a local HTTP 400 stub and assert zero usage;
Codex uses `debug prompt-input`, which renders the prompt without contacting a model.

Observed host facts are recorded as such. Whether a model *chooses* the right entry from what
the host shows it is not observable here and is reported as UNVERIFIED.

  python3 scripts/plugin-probes/wave17_probe_distribution.py [--out FILE] [--no-hosts]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import probe_lib as L  # noqa: E402

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
FIXTURES = HERE / "wave17_fixtures.mjs"
READER = HERE / "wave17_select_source.mjs"

OLD_COMMIT = "34ecb8d4546543743228f2397b2a16ed10885e31"
OLD_ID = "0.3.2-34ecb8d45465"
NEW_COMMIT = "a67aee78234ac60444d9dec18ea65f20cbdd241c"
NEW_ID = "0.3.3-a67aee78234a"
MARKETPLACE = "claude-codex-bridge"
WORKFLOW = "feature-workflow"
SIX = ["feature-design", "feature-plan", "feature-execute", "feature-review", "feature-decide", "feature-exchange"]
LOCAL_DELIVERY = "skills/feature-execute/references/local-delivery.md"


def run_root() -> Path:
    base = Path(os.environ.get("W17_PROBE_ROOT", Path.home() / "tmp" / "w17-01-probes"))
    root = base / f"run-{time.strftime('%Y%m%d-%H%M%S')}-{os.getpid()}"
    L.assert_isolated(root)
    root.mkdir(parents=True, exist_ok=False)
    return root


def node(*args: str, env: dict | None = None, cwd: Path | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(["node", *args], capture_output=True, text=True, timeout=300, env=env, cwd=cwd)


def node_json(*args: str) -> dict:
    proc = node(*args)
    if proc.returncode != 0:
        raise RuntimeError(f"node {' '.join(args)} failed: {proc.stderr}")
    return json.loads(proc.stdout)


def tree_snapshot(*roots: Path) -> dict:
    """path -> (sha256, mtime_ns, mode) for every file and directory; symlinks by target."""
    out: dict[str, list] = {}
    for root in roots:
        if not root.exists():
            out[str(root)] = ["<absent>"]
            continue
        for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
            dirnames.sort()
            base = Path(dirpath)
            out[str(base)] = ["dir", base.stat().st_mtime_ns]
            for name in sorted(filenames):
                path = base / name
                if path.is_symlink():
                    out[str(path)] = ["link", os.readlink(path)]
                    continue
                stat = path.stat()
                out[str(path)] = [hashlib.sha256(path.read_bytes()).hexdigest(), stat.st_mtime_ns, stat.st_mode]
    return out


def snapshot_diff(before: dict, after: dict) -> list[str]:
    keys = set(before) | set(after)
    return sorted(k for k in keys if before.get(k) != after.get(k))


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------


def git(repo: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(repo), *args], check=True, env=L.git_env(), capture_output=True)


def make_project(root: Path, name: str, declaration: dict | str | None = None, extra: dict | None = None) -> Path:
    project = root / "projects" / name
    L.make_git_repo(project)
    if declaration is not None:
        path = project / ".bridge-project" / "bridge.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(declaration if isinstance(declaration, str) else json.dumps(declaration, indent=2) + "\n")
        # A tripwire in place of the project entry point: the reader must never execute it.
        (project / ".bridge-project" / "entry.mjs").write_text(
            'import { writeFileSync } from "node:fs";\n'
            'writeFileSync(new URL("./TRIPWIRE-ENTRY-EXECUTED", import.meta.url), "executed\\n");\n'
        )
    for rel, text in (extra or {}).items():
        target = project / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
    if declaration is not None or extra:
        git(project, "add", "-A")
        git(project, "commit", "-qm", "fixture")
    return project


def declaration(runtime_id: str, commit: str, enabled: bool = True) -> dict:
    return {"format": "claude-codex-bridge.project/v1", "enabled": enabled, "pinned": {"runtime_id": runtime_id, "commit": commit}}


def build_fixtures(root: Path) -> dict:
    home = root / "bridge-home"
    runtimes = {
        "old": node_json(str(FIXTURES), "runtime", str(home), "--commit", OLD_COMMIT, "--id", OLD_ID),
        "new": node_json(str(FIXTURES), "runtime", str(home), "--commit", NEW_COMMIT, "--id", NEW_ID),
    }
    packages = {}
    for client in ("claude", "codex"):
        for label, commit, version in (("old", OLD_COMMIT, "0.3.2"), ("new", NEW_COMMIT, "0.3.3")):
            dest = root / "packages" / f"{client}-{label}"
            packages[f"{client}-{label}"] = node_json(
                str(FIXTURES), "package", str(dest), "--client", client, "--commit", commit, "--version", version
            )
    return {"home": home, "runtimes": runtimes, "packages": packages}


# ---------------------------------------------------------------------------
# A. source selection
# ---------------------------------------------------------------------------


def select(cwd: Path, package_root: Path, home: Path, *, standalone: bool = False, via_reader: bool = False) -> dict:
    """Run a package's own reader, or (`via_reader`) this checkout's reader with `--package-root`."""
    env = dict(os.environ)
    env["CLAUDE_CODEX_BRIDGE_HOME"] = str(home)
    if via_reader:
        args = [str(READER), "--cwd", str(cwd), "--package-root", str(package_root)]
    else:
        args = [str(package_root / "scripts" / "select-source.mjs"), "--cwd", str(cwd)]
    if standalone:
        args.append("--standalone")
    proc = node(*args, env=env)
    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError:
        payload = {"stdout": proc.stdout, "stderr": proc.stderr}
    payload["exit_code"] = proc.returncode
    return payload


def source_matrix(root: Path, fx: dict) -> dict:
    home = fx["home"]
    pkg = root / "packages" / "claude-new"
    not_git = root / "projects" / "not-a-worktree"
    not_git.mkdir(parents=True)
    projects = {
        "no-bridge": make_project(root, "no-bridge"),
        "not-a-worktree": not_git,
        "pinned-old-0.3.2": make_project(root, "pinned-old", declaration(OLD_ID, OLD_COMMIT)),
        "pinned-new": make_project(root, "pinned-new", declaration(NEW_ID, NEW_COMMIT)),
        "pin-runtime-missing": make_project(root, "pin-missing", declaration("0.9.9-000000000000", "0" * 40)),
        "pin-commit-mismatch": make_project(root, "pin-mismatch", declaration(OLD_ID, NEW_COMMIT)),
        "declaration-invalid": make_project(root, "declaration-invalid", "{not json\n"),
        "project-disabled": make_project(root, "project-disabled", declaration(NEW_ID, NEW_COMMIT, enabled=False)),
        "legacy-layout": make_project(root, "legacy-layout", extra={".bridge-runtime/install.json": "{}\n"}),
    }
    expected = {
        "no-bridge": ("plugin", "STANDALONE_NO_BRIDGE"),
        "not-a-worktree": ("plugin", "STANDALONE_NO_WORKTREE"),
        "pinned-old-0.3.2": ("runtime", "PINNED_RUNTIME"),
        "pinned-new": ("runtime", "PINNED_RUNTIME"),
        "pin-runtime-missing": ("none", "RUNTIME_MISSING"),
        "pin-commit-mismatch": ("none", "PIN_UNRESOLVED"),
        "declaration-invalid": ("none", "DECLARATION_INVALID"),
        "project-disabled": ("none", "PROJECT_DISABLED"),
        "legacy-layout": ("none", "LEGACY_LAYOUT"),
    }
    cases = []
    for name, project in projects.items():
        for standalone in (False, True):
            before = tree_snapshot(project, home, pkg)
            result = select(project, pkg, home, standalone=standalone)
            after = tree_snapshot(project, home, pkg)
            want_source, want_code = expected[name]
            if standalone and want_source == "none":
                want_source, want_code = "plugin", "EXPLICIT_STANDALONE"
            instructions = result.get("instructions") or {}
            cases.append(
                {
                    "case": name,
                    "explicit_standalone": standalone,
                    "source": result.get("source"),
                    "code": result.get("code"),
                    "pin_state": result.get("pin_state") or (result.get("runtime") or {}).get("state"),
                    "pin_not_used": result.get("pin_not_used"),
                    "record": result.get("record"),
                    "workflow_skills": instructions.get("workflow_skills"),
                    "local_delivery_present": bool(instructions.get("local_delivery")),
                    "next_step": result.get("next_step"),
                    "exit_code": result["exit_code"],
                    "expected": [want_source, want_code],
                    "as_expected": [result.get("source"), result.get("code")] == [want_source, want_code],
                    "writes": snapshot_diff(before, after),
                    "entry_tripwire_fired": (project / ".bridge-project" / "TRIPWIRE-ENTRY-EXECUTED").exists(),
                }
            )

    runtime_package = runtime_package_matrix(root, home, projects)

    # Plugin update does not change a pinned project's answer: reader of the *old* package and of
    # the *new* package agree on the pin, and differ only for standalone use.
    old_pkg = root / "packages" / "claude-old"
    agreement = {
        "pinned_old_via_old_package": select(projects["pinned-old-0.3.2"], old_pkg, home).get("record"),
        "pinned_old_via_new_package": select(projects["pinned-old-0.3.2"], pkg, home).get("record"),
        "standalone_via_old_package_local_delivery": bool(
            (select(projects["no-bridge"], old_pkg, home).get("instructions") or {}).get("local_delivery")
        ),
        "standalone_via_new_package_local_delivery": bool(
            (select(projects["no-bridge"], pkg, home).get("instructions") or {}).get("local_delivery")
        ),
    }
    return {
        "cases": cases,
        "runtime_package_cases": runtime_package,
        "plugin_update_agreement": agreement,
        "projects": {k: str(v) for k, v in projects.items()},
    }


def runtime_package_matrix(root: Path, home: Path, projects: dict) -> list[dict]:
    """R02-01 regression: a package lying inside an installed runtime never outranks the pin.

    The package root is the executor package a runtime hands a delegated Claude
    (`<home>/runtimes/<id>/plugins/bridge-claude`). Location is compared with the project pin only
    after the pinned runtime's own classifier answered; it never selects a runtime by itself.
    """
    old_pkg = home / "runtimes" / OLD_ID / "plugins" / "bridge-claude"
    new_pkg = home / "runtimes" / NEW_ID / "plugins" / "bridge-claude"
    scoped = ("plugin", "EXPLICIT_STANDALONE")
    mismatch = ("none", "PACKAGE_PIN_MISMATCH")
    # (case, project, package root, expected, expected with --standalone, expected local-delivery)
    plan = [
        ("matching/old-pin+old-runtime-package", "pinned-old-0.3.2", old_pkg, ("runtime", "PINNED_RUNTIME"), ("runtime", "PINNED_RUNTIME"), False),
        ("matching/new-pin+new-runtime-package", "pinned-new", new_pkg, ("runtime", "PINNED_RUNTIME"), ("runtime", "PINNED_RUNTIME"), True),
        ("mismatch/old-pin+new-runtime-package", "pinned-old-0.3.2", new_pkg, mismatch, mismatch, None),
        ("mismatch/new-pin+old-runtime-package", "pinned-new", old_pkg, mismatch, mismatch, None),
        ("unresolved/runtime-missing+new-runtime-package", "pin-runtime-missing", new_pkg, ("none", "RUNTIME_MISSING"), scoped, None),
        ("unresolved/commit-mismatch+same-id-runtime-package", "pin-commit-mismatch", old_pkg, ("none", "PIN_UNRESOLVED"), scoped, None),
        ("unresolved/project-disabled+new-runtime-package", "project-disabled", new_pkg, ("none", "PROJECT_DISABLED"), scoped, None),
        ("unresolved/legacy-layout+new-runtime-package", "legacy-layout", new_pkg, ("none", "LEGACY_LAYOUT"), scoped, None),
        ("no-bridge+new-runtime-package", "no-bridge", new_pkg, ("plugin", "STANDALONE_NO_BRIDGE"), ("plugin", "STANDALONE_NO_BRIDGE"), None),
    ]
    cases = []
    for name, project_key, package, want, want_scoped, want_delivery in plan:
        project = Path(projects[project_key])
        for standalone in (False, True):
            before = tree_snapshot(project, home)
            result = select(project, package, home, standalone=standalone, via_reader=True)
            after = tree_snapshot(project, home)
            expected = want_scoped if standalone else want
            delivery = bool((result.get("instructions") or {}).get("local_delivery"))
            ok = [result.get("source"), result.get("code")] == list(expected)
            if want_delivery is not None and result.get("source") == "runtime":
                ok = ok and delivery is want_delivery
            cases.append(
                {
                    "case": name,
                    "explicit_standalone": standalone,
                    "project": project_key,
                    "package_inside_runtime": (result.get("package") or {}).get("inside_runtime"),
                    "declared_runtime": (result.get("declaration") or {}).get("runtime_id"),
                    "source": result.get("source"),
                    "code": result.get("code"),
                    "record": result.get("record"),
                    "package_matches_pin": result.get("package_matches_pin"),
                    "local_delivery_present": delivery,
                    "next_step": result.get("next_step"),
                    "exit_code": result["exit_code"],
                    "expected": list(expected),
                    "as_expected": ok,
                    "writes": snapshot_diff(before, after),
                    "entry_tripwire_fired": (project / ".bridge-project" / "TRIPWIRE-ENTRY-EXECUTED").exists(),
                }
            )
    # A path that merely *names* a runtime is not a package: the reader refuses to answer.
    ghost = home / "runtimes" / NEW_ID / "does" / "not" / "exist"
    proc = node(str(READER), "--cwd", str(projects["pinned-old-0.3.2"]), "--package-root", str(ghost),
                env={**os.environ, "CLAUDE_CODEX_BRIDGE_HOME": str(home)})
    cases.append(
        {
            "case": "nonexistent-package-root-beneath-runtime",
            "explicit_standalone": False,
            "exit_code": proc.returncode,
            "stdout_empty": proc.stdout.strip() == "",
            "expected": ["reader-error", "exit 1"],
            "as_expected": proc.returncode == 1 and proc.stdout.strip() == "",
            "writes": [],
            "entry_tripwire_fired": False,
        }
    )
    return cases


def live_worktree_read() -> dict:
    """The reader against this actual worktree and the real bridge home — read-only observation."""
    watched = [REPO / ".bridge-project", REPO / ".bridge-runtime"]
    if not (REPO / ".bridge-project" / "bridge.json").exists():
        return {"available": False, "detail": "this checkout carries no .bridge-project declaration"}
    before = tree_snapshot(*watched)
    env = {k: v for k, v in os.environ.items() if k != "CLAUDE_CODEX_BRIDGE_HOME"}
    proc = node(str(READER), "--cwd", str(REPO), "--package-root", str(REPO / "plugins" / "bridge-claude"), env=env)
    after = tree_snapshot(*watched)
    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {"available": True, "exit_code": proc.returncode, "stderr": proc.stderr[-2000:]}
    return {
        "available": True,
        "exit_code": proc.returncode,
        "source": payload.get("source"),
        "code": payload.get("code"),
        "pin": payload.get("declaration"),
        "runtime_state": (payload.get("runtime") or {}).get("state"),
        "record": payload.get("record"),
        "local_delivery_present": bool((payload.get("instructions") or {}).get("local_delivery")),
        "writes_in_bridge_project_and_runtime_selection": snapshot_diff(before, after),
        "note": ".bridge/ (the live database of the supervising runtime) is not snapshotted; the reader never opens it",
    }


# ---------------------------------------------------------------------------
# B. package static checks
# ---------------------------------------------------------------------------

LINK = re.compile(r"\]\(([^)#\s]+)(?:#[^)]*)?\)")
ANCHORED = re.compile(r"(\$\{CLAUDE_PLUGIN_ROOT\}|<package>)(/[A-Za-z0-9_./-]+)")


def link_check(package: Path) -> dict:
    unresolved, checked = [], 0
    for path in sorted(package.rglob("*")):
        if path.suffix not in {".md", ".yaml", ".yml"} or not path.is_file():
            continue
        text = path.read_text()
        for match in LINK.finditer(text):
            target = match.group(1)
            if re.match(r"^[a-z]+:", target):
                continue
            checked += 1
            resolved = Path(target.replace("${CLAUDE_PLUGIN_ROOT}", str(package)).replace("<package>", str(package)))
            if not resolved.is_absolute():
                resolved = (path.parent / resolved).resolve()
            if not resolved.exists():
                unresolved.append({"file": str(path.relative_to(package)), "target": target})
        for match in ANCHORED.finditer(text):
            checked += 1
            target = (package / match.group(2).lstrip("/").rstrip(".")).resolve()
            if not target.exists():
                unresolved.append({"file": str(path.relative_to(package)), "target": match.group(0)})
    return {"checked": checked, "unresolved": unresolved}


def forbidden_references(package: Path) -> list:
    script = (
        "import { scanForbidden } from %s; process.stdout.write(JSON.stringify(scanForbidden(process.argv[1])));"
        % json.dumps((REPO / "scripts" / "plugin-packages" / "generate.mjs").as_uri())
    )
    proc = subprocess.run(["node", "--input-type=module", "-e", script, str(package)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        return [{"error": proc.stderr[-500:]}]
    # generate.mjs knows the Claude anchor; the Codex candidate anchors to `<package>`.
    return [item for item in json.loads(proc.stdout) if "<package>" not in item.get("reference", "")]


def helper_outside_checkout(root: Path, package: Path) -> dict:
    repo = root / "projects" / f"exchange-target-{package.name}"
    L.make_git_repo(repo)
    (repo / "docs" / "features" / "F-X").mkdir(parents=True)
    (repo / "docs" / "features" / "F-X" / "brief.md").write_text("# F-X synthetic brief\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "brief")
    helper = package / "skills" / "feature-exchange" / "scripts" / "feature_exchange.py"
    archive = root / f"exchange-{package.name}.zip"
    export = subprocess.run(
        [sys.executable, str(helper), "export", "--repo", str(repo), "--feature", "docs/features/F-X", "--purpose", "plan-review", "--output", str(archive)],
        capture_output=True, text=True, timeout=120,
    )
    verify = subprocess.run(
        [sys.executable, str(helper), "verify", "--repo", str(repo), "--archive", str(archive), "--expect-feature", "docs/features/F-X", "--expect-purpose", "plan-review"],
        capture_output=True, text=True, timeout=120,
    )
    try:
        report = json.loads(verify.stdout)
    except json.JSONDecodeError:
        report = {}
    return {
        "export_exit": export.returncode,
        "verify_exit": verify.returncode,
        "integrity": report.get("integrity"),
        "guide_supplied_by_installation": report.get("documents", {}).get("supplied_by_installation"),
        "stderr": (export.stderr + verify.stderr)[-500:],
    }


def package_checks(root: Path) -> dict:
    out = {}
    for name in ("claude-new", "codex-new", "claude-old", "codex-old"):
        package = root / "packages" / name
        skills = sorted(p.name for p in (package / "skills").iterdir() if (p / "SKILL.md").is_file())
        out[name] = {
            "entries": skills,
            "six_entries": skills == sorted(SIX),
            "local_delivery_present": (package / LOCAL_DELIVERY).is_file(),
            "exchange_helper_present": (package / "skills/feature-exchange/scripts/feature_exchange.py").is_file(),
            "reader_present": (package / "scripts/select-source.mjs").is_file(),
            "links": link_check(package),
            "checkout_relative_references": forbidden_references(package),
        }
    for name in ("claude-new", "codex-new"):
        out[name]["exchange_helper_outside_checkout"] = helper_outside_checkout(root, root / "packages" / name)
    return out


# ---------------------------------------------------------------------------
# C. Claude Code
# ---------------------------------------------------------------------------


def claude_marketplace(root: Path, workflow_package: Path) -> Path:
    market = root / "claude-marketplace"
    if market.exists():
        shutil.rmtree(market)
    (market / "plugins").mkdir(parents=True)
    shutil.copytree(REPO / "plugins" / "bridge-claude", market / "plugins" / "bridge-claude")
    shutil.copytree(workflow_package, market / "plugins" / "feature-workflow-claude")
    version = json.loads((workflow_package / "GENERATED.json").read_text())["version"]
    L.write_json(
        market / ".claude-plugin" / "marketplace.json",
        {
            "name": MARKETPLACE,
            "owner": {"name": "claude-codex-bridge"},
            "description": "W17-01 probe marketplace",
            "plugins": [
                {"name": "bridge-claude", "source": "./plugins/bridge-claude", "description": "legacy bridge-claude", "version": "0.3.2"},
                {"name": WORKFLOW, "source": "./plugins/feature-workflow-claude", "description": "feature workflow", "version": version},
            ],
        },
    )
    return market


def claude_session(label: str, root: Path, cwd: Path, config: Path, stub, extra: list[str]) -> dict:
    debug = root / f"claude-debug-{label}.log"
    proc = L.run_claude_headless(
        "w17-01 probe: no model call is expected to succeed",
        cwd=cwd, config_dir=config, stub=stub,
        extra_args=["--output-format", "stream-json", "--verbose", *extra],
        debug_file=debug,
    )
    init, result = {}, {}
    for line in proc.stdout.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") == "system" and event.get("subtype") == "init":
            init = event
        if event.get("type") == "result":
            result = event
    skills = init.get("skills", [])
    feature = sorted(s for s in skills if re.search(r"(^|:)feature-(design|plan|execute|review|decide|exchange)$", s))
    debug_text = debug.read_text(errors="replace") if debug.exists() else ""
    return {
        "case": label,
        "exit_code": proc.returncode,
        "spent_nothing": L.claude_spent_nothing(result),
        "claude_code_version": init.get("claude_code_version"),
        "feature_entries": feature,
        "bare_feature_entries": [s for s in feature if ":" not in s],
        "plugins": [{"name": p.get("name"), "source": p.get("source"), "version": p.get("version"), "path": p.get("path")} for p in init.get("plugins", [])],
        "override_lines": sorted(set(re.findall(r'Plugin "[^"]+" from --plugin-dir overrides installed version', debug_text))),
    }


def claude_side(root: Path, fx: dict) -> dict:
    try:
        L.claude_bin()
    except L.ProbeSkipped as exc:
        return {"available": False, "detail": str(exc)}
    home = fx["home"]
    runtimes_before = tree_snapshot(home / "runtimes")
    config = root / "claude-config"
    config.mkdir()
    env = {"CLAUDE_CONFIG_DIR": str(config)}
    project = make_project(root, "claude-host")
    steps: list[dict] = []

    def plugin(*args: str) -> dict:
        out = L.run_claude_plugin(list(args), env=env)
        steps.append({"command": ["claude", "plugin", *args], "exit_code": out["exit_code"], "stderr": out["stderr"][-400:]})
        return out

    validate = {
        name: L.run_claude_validate(root / "packages" / name)["exit_code"] for name in ("claude-new", "claude-old")
    }
    market = claude_marketplace(root, root / "packages" / "claude-old")
    old_runtime_pkg = home / "runtimes" / OLD_ID / "plugins" / "bridge-claude"
    new_runtime_bridge = home / "runtimes" / NEW_ID / "plugins" / "bridge-claude"
    # New-runtime shape proposed by the contract: the runtime also ships the workflow package.
    new_runtime_workflow = root / "new-runtime-shape" / "feature-workflow-claude"
    shutil.copytree(root / "packages" / "claude-new", new_runtime_workflow)

    cases = []
    with L.AnthropicStub() as stub:
        cases.append(claude_session("control-empty-profile", root, project, config, stub, []))
        cases.append(claude_session("delegated-no-personal-install/old-runtime", root, project, config, stub, ["--plugin-dir", str(old_runtime_pkg)]))
        plugin("marketplace", "add", str(market))
        plugin("install", f"{WORKFLOW}@{MARKETPLACE}")
        cases.append(claude_session("workflow-only", root, project, config, stub, []))
        plugin("install", f"bridge-claude@{MARKETPLACE}")
        cases.append(claude_session("workflow+legacy-bridge-claude", root, project, config, stub, []))
        cases.append(claude_session("delegated-old-runtime+personal-workflow+legacy", root, project, config, stub, ["--plugin-dir", str(old_runtime_pkg)]))
        cases.append(claude_session(
            "delegated-new-runtime-shape+personal-workflow+legacy", root, project, config, stub,
            ["--plugin-dir", str(new_runtime_bridge), "--plugin-dir", str(new_runtime_workflow)],
        ))
        plugin("disable", f"bridge-claude@{MARKETPLACE}")
        cases.append(claude_session("workflow+legacy-disabled", root, project, config, stub, []))
        listed_before_update = json.loads(plugin("list", "--json")["stdout"] or "[]")
        # Update: publish the post-wave16 package under the same name and refresh.
        claude_marketplace(root, root / "packages" / "claude-new")
        plugin("marketplace", "update", MARKETPLACE)
        update = plugin("update", f"{WORKFLOW}@{MARKETPLACE}")
        listed_after_update = json.loads(plugin("list", "--json")["stdout"] or "[]")
        cases.append(claude_session("workflow-after-update", root, project, config, stub, []))
        plugin("uninstall", f"{WORKFLOW}@{MARKETPLACE}")
        plugin("uninstall", f"bridge-claude@{MARKETPLACE}")
        cases.append(claude_session("after-uninstall", root, project, config, stub, []))

    def installed(listing: list, plugin_id: str) -> dict:
        for entry in listing:
            if entry.get("id") == plugin_id:
                path = Path(entry.get("installPath", ""))
                return {"version": entry.get("version"), "enabled": entry.get("enabled"), "local_delivery_present": (path / LOCAL_DELIVERY).is_file()}
        return {}

    by = {c["case"]: c for c in cases}
    qualified = sorted(f"{WORKFLOW}:{s}" for s in SIX)
    legacy = sorted(f"bridge-claude:{s}" for s in SIX)
    return {
        "available": True,
        "plugin_validate_exit": validate,
        "steps": steps,
        "cases": cases,
        "installed_before_update": installed(listed_before_update, f"{WORKFLOW}@{MARKETPLACE}"),
        "installed_after_update": installed(listed_after_update, f"{WORKFLOW}@{MARKETPLACE}"),
        "update_exit": update["exit_code"],
        "runtimes_unchanged": snapshot_diff(runtimes_before, tree_snapshot(home / "runtimes")) == [],
        "findings": {
            "every_session_was_model_free": all(c["spent_nothing"] for c in cases),
            "control_has_no_feature_entry": by["control-empty-profile"]["feature_entries"] == [],
            "workflow_only_exposes_six_qualified_entries": by["workflow-only"]["feature_entries"] == qualified,
            "no_bare_feature_entry_in_any_case": all(c["bare_feature_entries"] == [] for c in cases),
            "legacy_and_workflow_both_listed": by["workflow+legacy-bridge-claude"]["feature_entries"] == sorted(qualified + legacy),
            "disabling_legacy_leaves_only_workflow": by["workflow+legacy-disabled"]["feature_entries"] == qualified,
            "delegated_without_personal_install_gets_runtime_entries": by["delegated-no-personal-install/old-runtime"]["feature_entries"] == legacy,
            "runtime_plugin_dir_overrides_personal_bridge_claude": any(
                "bridge-claude" in line for line in by["delegated-old-runtime+personal-workflow+legacy"]["override_lines"]
            ),
            "old_runtime_delegation_also_sees_personal_workflow":by["delegated-old-runtime+personal-workflow+legacy"]["feature_entries"] == sorted(qualified + legacy),
            "new_runtime_shape_overrides_personal_workflow": any(
                p["name"] == WORKFLOW and p["path"] == str(new_runtime_workflow)
                for p in by["delegated-new-runtime-shape+personal-workflow+legacy"]["plugins"]
            ) and len(by["delegated-new-runtime-shape+personal-workflow+legacy"]["override_lines"]) >= 1,
            "update_replaces_standalone_resources_with_local_delivery": installed(listed_after_update, f"{WORKFLOW}@{MARKETPLACE}").get("local_delivery_present") is True
            and installed(listed_before_update, f"{WORKFLOW}@{MARKETPLACE}").get("local_delivery_present") is False,
            "uninstall_removes_entries": by["after-uninstall"]["feature_entries"] == [],
        },
    }


# ---------------------------------------------------------------------------
# D. Codex
# ---------------------------------------------------------------------------


def codex_marketplace(root: Path, workflow_package: Path) -> Path:
    market = root / "codex-marketplace"
    if market.exists():
        shutil.rmtree(market)
    (market / "plugins").mkdir(parents=True)
    shutil.copytree(REPO / "plugins" / "bridge-codex", market / "plugins" / "bridge-codex")
    shutil.copytree(workflow_package, market / "plugins" / "feature-workflow-codex")
    L.write_json(
        market / ".agents" / "plugins" / "marketplace.json",
        {
            "name": MARKETPLACE,
            "interface": {"displayName": "W17-01 probe marketplace"},
            "plugins": [
                {"name": name, "source": {"source": "local", "path": f"./plugins/{directory}"},
                 "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"}, "category": "Productivity"}
                for name, directory in (("bridge-codex", "bridge-codex"), (WORKFLOW, "feature-workflow-codex"))
            ],
        },
    )
    return market


def codex_skills(cwd: Path, codex_home: Path) -> dict:
    proc = L.run_codex(["debug", "prompt-input", "w17-01 probe"], cwd=cwd, codex_home=codex_home)
    roots = dict(re.findall(r"`(r\d+)` = `([^`]+)`", proc.stdout))
    entries = []
    for name, root_id, rel in re.findall(r"- ([A-Za-z0-9_.:-]+): [^\n]*?\(file: (r\d+)/([^)]+)\)", proc.stdout.replace("\\n", "\n")):
        entries.append({"name": name, "file": f"{roots.get(root_id, root_id)}/{rel}"})
    return {"exit_code": proc.returncode, "entries": entries}


def codex_side(root: Path, fx: dict) -> dict:
    try:
        L.codex_bin()
    except L.ProbeSkipped as exc:
        return {"available": False, "detail": str(exc)}
    home = fx["home"]
    runtimes_before = tree_snapshot(home / "runtimes")
    codex_home = root / "codex-home"
    codex_home.mkdir()
    project = make_project(root, "codex-host")
    repo_local = make_project(
        root, "codex-repo-local-skills",
        extra={".agents/skills/feature-execute/SKILL.md": "---\nname: feature-execute\ndescription: repo-local development copy\n---\nrepo-local\n"},
    )
    steps: list[dict] = []

    def codex(*args: str, cwd: Path = root):
        proc = L.run_codex(list(args), cwd=cwd, codex_home=codex_home)
        steps.append({"command": ["codex", *args], "exit_code": proc.returncode, "stderr": proc.stderr[-400:]})
        return proc

    def feature(listing: dict) -> list[str]:
        return sorted(e["name"] for e in listing["entries"] if re.search(r"(^|:)feature-(design|plan|execute|review|decide|exchange)$", e["name"]))

    def named(listing: dict, prefix: str) -> list[str]:
        return sorted(e["name"] for e in listing["entries"] if e["name"].startswith(prefix))

    cases = {}
    cases["control"] = codex_skills(project, codex_home)
    market = codex_marketplace(root, root / "packages" / "codex-old")
    codex("plugin", "marketplace", "add", str(market), "--json")
    add_old = codex("plugin", "add", f"{WORKFLOW}@{MARKETPLACE}", "--json")
    path_old = Path(json.loads(add_old.stdout)["installedPath"]) if add_old.returncode == 0 else None
    cases["workflow-only"] = codex_skills(project, codex_home)
    codex("plugin", "add", f"bridge-codex@{MARKETPLACE}", "--json")
    cases["workflow+bridge-codex"] = codex_skills(project, codex_home)
    cases["workflow+repo-local-skills"] = codex_skills(repo_local, codex_home)
    old_resources = bool(path_old and (path_old / LOCAL_DELIVERY).is_file())
    codex_marketplace(root, root / "packages" / "codex-new")
    add_new = codex("plugin", "add", f"{WORKFLOW}@{MARKETPLACE}", "--json")
    path_new = Path(json.loads(add_new.stdout)["installedPath"]) if add_new.returncode == 0 else None
    cases["workflow-after-update"] = codex_skills(project, codex_home)
    cache_after_update = sorted(p.name for p in path_new.parent.iterdir()) if path_new else []
    new_resources = bool(path_new and (path_new / LOCAL_DELIVERY).is_file())
    codex("plugin", "remove", f"{WORKFLOW}@{MARKETPLACE}")
    codex("plugin", "remove", f"bridge-codex@{MARKETPLACE}")
    cases["after-remove"] = codex_skills(project, codex_home)

    qualified = sorted(f"{WORKFLOW}:{s}" for s in SIX)
    summary = {name: {"exit_code": c["exit_code"], "feature_entries": feature(c), "bridge_entries": named(c, "bridge-codex:"),
                      "workflow_files": sorted({str(Path(e["file"]).parent.parent) for e in c["entries"] if e["name"].startswith(f"{WORKFLOW}:")})}
               for name, c in cases.items()}
    return {
        "available": True,
        "steps": steps,
        "cases": summary,
        "installed_path_old": str(path_old) if path_old else None,
        "installed_path_new": str(path_new) if path_new else None,
        "cache_versions_after_update": cache_after_update,
        "runtimes_unchanged": snapshot_diff(runtimes_before, tree_snapshot(home / "runtimes")) == [],
        "method": (
            "`codex debug prompt-input` renders the model-visible prompt (CLI help text); the isolated "
            "CODEX_HOME holds no credentials, so no model request could be authenticated. Not a network capture."
        ),
        "findings": {
            "control_has_no_feature_entry": summary["control"]["feature_entries"] == [],
            "workflow_only_exposes_six_qualified_entries": summary["workflow-only"]["feature_entries"] == qualified,
            "bridge_codex_adds_no_feature_entry": summary["workflow+bridge-codex"]["feature_entries"] == qualified
            and summary["workflow+bridge-codex"]["bridge_entries"] == ["bridge-codex:bridge", "bridge-codex:bridge-upgrade"],
            "repo_local_skill_listed_bare_beside_plugin": summary["workflow+repo-local-skills"]["feature_entries"] == sorted(qualified + ["feature-execute"]),
            "update_serves_new_resources": new_resources and not old_resources,
            "remove_deletes_plugin_cache": bool(path_new) and not path_new.exists(),
            "update_drops_previous_cache_version": cache_after_update == ["0.3.3"],
            "remove_removes_entries": summary["after-remove"]["feature_entries"] == [],
        },
    }


# ---------------------------------------------------------------------------


def provenance() -> dict:
    """Which bytes produced this result: the commit and whether the probe sources differ from it."""
    def out(*args: str) -> str:
        return subprocess.run(["git", "-C", str(REPO), *args], capture_output=True, text=True).stdout.strip()

    sources = [READER, FIXTURES, Path(__file__).resolve()]
    rel = [str(path.relative_to(REPO)) for path in sources]
    return {
        "head": out("rev-parse", "HEAD"),
        "probe_sources_uncommitted": out("status", "--porcelain=v1", "--", *rel) != "",
        "sha256": {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in zip(rel, sources)},
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=None, help="write the redacted JSON result here")
    parser.add_argument("--no-hosts", action="store_true", help="skip the Claude/Codex host cases")
    args = parser.parse_args()

    root = run_root()
    fx = build_fixtures(root)
    matrix = source_matrix(root, fx)
    result = {
        "probe": "w17-01-distribution",
        "evidence_kind": (
            "fixture-only: source selection on disposable fixture runtimes/projects and one read-only "
            "live worktree read; no Claude/Codex host case and no model ran"
            if args.no_hosts
            else "fixtures plus model-free host cases in disposable profiles; no model ran"
        ),
        "provenance": provenance(),
        "base": NEW_COMMIT,
        "old_pin": {"runtime_id": OLD_ID, "commit": OLD_COMMIT},
        "new_fixture_runtime": {"runtime_id": NEW_ID, "commit": NEW_COMMIT},
        "hosts": L.host_versions(),
        "node": subprocess.run(["node", "--version"], capture_output=True, text=True).stdout.strip(),
        "run_root": str(root),
        "fixtures": {"runtimes": fx["runtimes"], "packages": fx["packages"]},
        "source_selection": matrix,
        "live_worktree_read": live_worktree_read(),
        "packages": package_checks(root),
        "claude": {"available": False, "detail": "--no-hosts"} if args.no_hosts else claude_side(root, fx),
        "codex": {"available": False, "detail": "--no-hosts"} if args.no_hosts else codex_side(root, fx),
        "unverified": [
            "Which entry a model chooses from a natural-language request when several are listed.",
            "Whether a model follows the source reader's answer or a round contract over a personally installed copy.",
            "Codex `$feature-workflow:<skill>` mention syntax in the interactive composer (only the listed name is observed).",
            "Expansion of any plugin-root variable in Codex skill text (none is documented; the candidate uses <package>).",
        ],
    }
    every = matrix["cases"] + matrix["runtime_package_cases"]
    matrix_ok = all(c["as_expected"] and not c["writes"] and not c["entry_tripwire_fired"] for c in matrix["cases"])
    package_cases = matrix["runtime_package_cases"]
    result["findings"] = {
        "source_matrix_as_contracted": matrix_ok,
        "runtime_package_cases_as_contracted": all(
            c["as_expected"] and not c["writes"] and not c["entry_tripwire_fired"] for c in package_cases
        ),
        "matching_runtime_package_selects_declared_runtime": all(
            c["source"] == "runtime" and c["record"].startswith(f"INSTRUCTIONS=runtime:{c['declared_runtime']} ")
            and c["package_matches_pin"] is True
            for c in package_cases if c["case"].startswith("matching/")
        ),
        "mismatched_runtime_package_refused_even_when_standalone": all(
            c["source"] == "none" and c["code"] == "PACKAGE_PIN_MISMATCH" for c in package_cases if c["case"].startswith("mismatch/")
        ),
        "unresolved_pin_never_answered_by_package_location": all(
            c["source"] != "runtime" for c in package_cases if c["case"].startswith("unresolved/")
        ),
        "source_reads_wrote_nothing": all(not c["writes"] for c in every),
        "project_entry_never_executed": not any(c["entry_tripwire_fired"] for c in every),
        "old_pin_keeps_zip_era_instructions": next(
            c for c in matrix["cases"] if c["case"] == "pinned-old-0.3.2" and not c["explicit_standalone"]
        )["local_delivery_present"] is False,
        "new_pin_and_standalone_carry_local_delivery": all(
            c["local_delivery_present"] for c in matrix["cases"]
            if c["case"] in {"pinned-new", "no-bridge"} and not c["explicit_standalone"]
        ),
        "plugin_version_does_not_change_pinned_answer": matrix["plugin_update_agreement"]["pinned_old_via_old_package"]
        == matrix["plugin_update_agreement"]["pinned_old_via_new_package"],
    }
    text = json.dumps(L.redact(result), indent=2, sort_keys=True)
    print(text)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
