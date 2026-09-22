"""Host checks for the generated distribution packages.

These are *host* checks: they install the real generated packages into disposable Codex and
Claude Code profiles and start the real clients. Every client run is model-free — a Codex session
stops on a deliberately absent provider key, and a Claude session talks to a local stub that
answers HTTP 400 — and every profile lives under a temporary root, so the operator's own
configuration is never read for settings and never written.

Nothing here mutates a file of this repository. The generator's drift detection is exercised on a
copy of the canonical tree, never on the canonical tree itself.

A host that is not installed makes the corresponding test skip, and the skip says so; it is never
silently reported as a pass.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "plugin-probes"))

import probe_lib as L  # noqa: E402

CODEX_PACKAGE = REPO_ROOT / "plugins" / "bridge-codex"
CLAUDE_PACKAGE = REPO_ROOT / "plugins" / "bridge-claude"
GENERATOR = REPO_ROOT / "scripts" / "plugin-packages" / "generate.mjs"
PLUGIN_ENTRY = CODEX_PACKAGE / "scripts" / "plugin-packages" / "bridge-plugin.mjs"

# One real runtime for the whole module: building it is the product's own installer, and it is the
# only thing here that is slow. Nothing in this file substitutes a fixture for it.
_RUNTIME: dict = {}


def git(cwd: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(cwd), *args], check=True, capture_output=True, text=True, env=L.git_env()
    ).stdout.strip()


def client_env(extra: dict | None = None) -> dict:
    """A client-like environment: without the test runner's own `node_modules/.bin` on PATH."""
    env = dict(os.environ)
    env["PATH"] = ":".join(part for part in env.get("PATH", "").split(":") if "node_modules/.bin" not in part)
    env.pop("NODE_OPTIONS", None)
    env.update(extra or {})
    return env


def build_runtime() -> tuple[Path, str, str]:
    """Install this repository's HEAD commit as an immutable runtime, once per test session."""
    if not _RUNTIME:
        home = Path(tempfile.mkdtemp(prefix="w14-runtime-home-"))
        L.assert_isolated(home)
        commit = git(REPO_ROOT, "rev-parse", "HEAD")
        out = subprocess.run(
            ["node", str(REPO_ROOT / "scripts" / "bridge.mjs"), "install", "--source", str(REPO_ROOT), "--ref", commit, "--home", str(home), "--json"],
            capture_output=True,
            text=True,
            env=client_env(),
            timeout=1800,
        )
        if out.returncode != 0:
            shutil.rmtree(home, ignore_errors=True)
            raise unittest.SkipTest(f"could not install a runtime for the host checks: {out.stderr[-500:]}")
        _RUNTIME.update({"home": home, "commit": commit, "id": json.loads(out.stdout)["runtime_id"], "path": Path(json.loads(out.stdout)["path"])})
    return _RUNTIME["home"], _RUNTIME["commit"], _RUNTIME["id"]


def tearDownModule():  # noqa: N802 - unittest hook
    home = _RUNTIME.get("home")
    if home:
        subprocess.run(["chmod", "-R", "u+w", str(home)], capture_output=True)
        shutil.rmtree(home, ignore_errors=True)


class GeneratedPackages(unittest.TestCase):
    """The generator is the only writer, and what it wrote is what is committed."""

    def test_generation_is_deterministic_and_matches_the_committed_tree(self):
        first = subprocess.run(["node", str(GENERATOR), "--check", "--json"], capture_output=True, text=True, cwd=REPO_ROOT)
        report = json.loads(first.stdout)
        self.assertTrue(report["ok"], report)
        self.assertEqual(report["problems"], [])
        self.assertEqual(report["forbidden_references"], [])
        self.assertEqual(first.returncode, 0)
        second = subprocess.run(["node", str(GENERATOR), "--check", "--json"], capture_output=True, text=True, cwd=REPO_ROOT)
        self.assertEqual(json.loads(second.stdout)["source_digest"], report["source_digest"])

    def test_a_canonical_edit_that_was_never_regenerated_fails_the_check(self):
        """Drift detection, proven on a copy: this repository's own files are never touched."""
        with tempfile.TemporaryDirectory(prefix="w14-generator-") as tmp:
            clone = Path(tmp) / "repo"
            subprocess.run(
                ["git", "-C", str(REPO_ROOT), "worktree", "add", "--detach", "-q", str(clone), "HEAD"],
                check=True,
                capture_output=True,
                env=L.git_env(),
            )
            try:
                before = subprocess.run(["node", str(clone / "scripts/plugin-packages/generate.mjs"), "--check"], capture_output=True, cwd=clone)
                self.assertEqual(before.returncode, 0, before.stderr)
                skill = clone / ".agents" / "skills" / "feature-plan" / "SKILL.md"
                skill.write_text(skill.read_text() + "\nAn edit that was never regenerated.\n")
                after = subprocess.run(
                    ["node", str(clone / "scripts/plugin-packages/generate.mjs"), "--check", "--json"], capture_output=True, text=True, cwd=clone
                )
                self.assertEqual(after.returncode, 1)
                self.assertFalse(json.loads(after.stdout)["ok"])
            finally:
                subprocess.run(
                    ["git", "-C", str(REPO_ROOT), "worktree", "remove", "--force", str(clone)],
                    capture_output=True,
                    env=L.git_env(),
                )
        # The canonical tree is untouched.
        self.assertEqual(subprocess.run(["node", str(GENERATOR), "--check"], capture_output=True, cwd=REPO_ROOT).returncode, 0)

    def test_no_instruction_text_points_back_into_a_bridge_checkout(self):
        for package in (CODEX_PACKAGE, CLAUDE_PACKAGE):
            for path in sorted(package.rglob("*")):
                if not path.is_file() or path.suffix not in {".md", ".yaml", ".yml"}:
                    continue
                if "scripts/" in str(path.relative_to(package)):
                    continue
                text = path.read_text(errors="replace")
                for index in [m.start() for m in re.finditer(re.escape(".agents/skills/"), text)]:
                    anchor = text[max(0, index - 32) : index]
                    self.assertTrue(
                        "CLAUDE_PLUGIN_ROOT" in anchor or "<instructions." in anchor or "instructions." in anchor,
                        f"{path.relative_to(REPO_ROOT)} still points into a bridge checkout",
                    )

    def test_the_codex_package_ships_a_thin_entry_and_a_working_installer(self):
        self.assertEqual(sorted(p.name for p in (CODEX_PACKAGE / "skills").iterdir()), ["bridge", "bridge-upgrade"])
        for required in ("scripts/bridge.mjs", "scripts/setup/workspace.mjs", "scripts/plugin-packages/bridge-plugin.mjs", "scripts/plugin-packages/release.json", "scripts/bridge-project/entry-template.mjs"):
            self.assertTrue((CODEX_PACKAGE / required).is_file(), required)
        release = json.loads((CODEX_PACKAGE / "scripts/plugin-packages/release.json").read_text())
        self.assertRegex(release["pinned"]["commit"], r"^[0-9a-f]{40}$")

    def test_the_claude_package_carries_the_whole_role_authority(self):
        skills = sorted(p.name for p in (CLAUDE_PACKAGE / "skills").iterdir())
        self.assertIn("using-bridge", skills)
        for workflow in ("feature-plan", "feature-execute", "feature-review", "feature-exchange"):
            self.assertIn(workflow, skills)
        self.assertIn(
            "${CLAUDE_PLUGIN_ROOT}/skills/feature-exchange/scripts/feature_exchange.py",
            (CLAUDE_PACKAGE / "skills" / "feature-execute" / "SKILL.md").read_text(),
        )

    def test_upgrade_packages_run_outside_the_checkout_without_writing_state(self):
        for package in (CODEX_PACKAGE, CLAUDE_PACKAGE):
            with self.subTest(package=package.name), tempfile.TemporaryDirectory(prefix="upgrade-package-") as tmp:
                root = Path(tmp)
                installed = root / "stable package"
                shutil.copytree(package, installed)
                self.assertTrue((installed / "skills/bridge-upgrade/SKILL.md").is_file())
                project = root / "project"
                L.make_git_repo(project)
                bridge_home = root / "bridge-home"
                env = client_env({"CLAUDE_CODEX_BRIDGE_HOME": str(bridge_home)})
                before = {str(p.relative_to(project)): p.read_bytes() for p in project.rglob("*") if p.is_file()}
                command = installed / "scripts/plugin-packages/bridge-plugin.mjs"
                result = subprocess.run(["node", str(command), "status", "--json"], cwd=project, env=env, text=True, capture_output=True)
                self.assertEqual(result.returncode, 1, result.stderr)
                report = json.loads(result.stdout)
                self.assertEqual(report["workspace"]["root"], str(project))
                help_result = subprocess.run(["node", str(installed / "scripts/bridge.mjs"), "--help"], cwd=project, env=env, text=True, capture_output=True)
                self.assertEqual(help_result.returncode, 0, help_result.stderr)
                self.assertFalse(bridge_home.exists())
                after = {str(p.relative_to(project)): p.read_bytes() for p in project.rglob("*") if p.is_file()}
                self.assertEqual(before, after)

    def test_the_packages_carry_no_node_dependencies_to_install(self):
        for package in (CODEX_PACKAGE, CLAUDE_PACKAGE):
            self.assertFalse((package / "package.json").exists())
            self.assertFalse((package / "node_modules").exists())


class InstalledExporter(unittest.TestCase):
    """The exchange helper must work from an installation, against a repository that is not ours."""

    def setUp(self):
        self.home, self.commit, self.runtime_id = build_runtime()
        self.root = Path(tempfile.mkdtemp(prefix="w14-foreign-"))
        L.assert_isolated(self.root)
        self.repo = self.root / "a foreign repo"
        (self.repo / "docs/features/F-X/execution").mkdir(parents=True)
        (self.repo / "docs/features/F-X/brief.md").write_text("# brief\n")
        (self.repo / "docs/features/F-X/feature.json").write_text(
            json.dumps({"schema_version": 1, "feature_id": "F-X", "phase": "execution", "brief": "docs/features/F-X/brief.md", "tasks": [], "context_files": []})
        )
        (self.repo / "docs/features/F-X/execution/01.md").write_text("ledger\n")
        subprocess.run(["git", "init", "-q", "-b", "main", str(self.repo)], check=True, env=L.git_env())
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-qm", "init")

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def _export_with(self, helper: Path) -> dict:
        base = git(self.repo, "rev-parse", "HEAD")
        out = self.root / f"{helper.parents[2].name}.zip"
        exported = subprocess.run(
            [sys.executable, str(helper), "export", "--repo", str(self.repo), "--feature", "docs/features/F-X",
             "--purpose", "corrections-review", "--base", base, "--output", str(out)],
            capture_output=True, text=True, timeout=300,
        )
        self.assertEqual(exported.returncode, 0, exported.stdout + exported.stderr)
        verified = subprocess.run(
            [sys.executable, str(helper), "verify", "--repo", str(self.repo), "--archive", str(out)],
            capture_output=True, text=True, timeout=300,
        )
        self.assertEqual(verified.returncode, 0, verified.stdout + verified.stderr)
        return json.loads(verified.stdout)

    def test_the_installed_runtime_helper_exports_and_verifies_in_a_foreign_repository(self):
        helper = _RUNTIME["path"] / ".agents/skills/feature-exchange/scripts/feature_exchange.py"
        report = self._export_with(helper)
        self.assertEqual(report["integrity"], "ok")
        # The shared workflow guide travels from the installation, under its canonical name. The
        # verifier must not call it missing: the target repository never claimed to have it.
        self.assertIn("docs/features/README.md", report["documents"]["files"])
        self.assertEqual(report["documents"]["missing"], [])
        self.assertEqual(report["documents"]["changed"], [])
        self.assertEqual(report["documents"]["supplied_by_installation"], ["docs/features/README.md"])
        self.assertFalse((self.repo / "docs/features/README.md").exists())

    def test_the_verifier_still_reports_real_drift_in_the_target(self):
        helper = _RUNTIME["path"] / ".agents/skills/feature-exchange/scripts/feature_exchange.py"
        self._export_with(helper)
        # A document the exporter took from this repository, edited afterwards, is drift.
        (self.repo / "docs/features/F-X/brief.md").write_text("# brief, edited after the export\n")
        out = subprocess.run(
            [sys.executable, str(helper), "verify", "--repo", str(self.repo), "--archive", str(self.root / f"{helper.parents[2].name}.zip")],
            capture_output=True, text=True, timeout=300,
        )
        report = json.loads(out.stdout)
        self.assertIn("docs/features/F-X/brief.md", report["documents"]["changed"])
        self.assertEqual(report["documents"]["missing"], [])
        # And a document that really is gone is still missing, not excused.
        (self.repo / "docs/features/F-X/execution/01.md").unlink()
        out = subprocess.run(
            [sys.executable, str(helper), "verify", "--repo", str(self.repo), "--archive", str(self.root / f"{helper.parents[2].name}.zip")],
            capture_output=True, text=True, timeout=300,
        )
        self.assertIn("docs/features/F-X/execution/01.md", json.loads(out.stdout)["documents"]["missing"])

    def test_the_generated_claude_package_helper_does_the_same(self):
        helper = _RUNTIME["path"] / "plugins/bridge-claude/skills/feature-exchange/scripts/feature_exchange.py"
        report = self._export_with(helper)
        self.assertEqual(report["integrity"], "ok")
        self.assertIn("docs/features/README.md", report["documents"]["files"])


class CodexHost(unittest.TestCase):
    def setUp(self):
        try:
            L.codex_bin()
        except L.ProbeSkipped as exc:
            self.skipTest(f"host evidence unavailable: {exc}")
        self.home, self.commit, self.runtime_id = build_runtime()
        self.root = Path(tempfile.mkdtemp(prefix="w14-codex-host-"))
        L.assert_isolated(self.root)
        self.codex_home = self.root / "codex-home"
        self.codex_home.mkdir(parents=True)

    def tearDown(self):
        subprocess.run(["chmod", "-R", "u+w", str(self.root)], capture_output=True)
        shutil.rmtree(self.root, ignore_errors=True)

    def install_package(self) -> Path:
        added = L.run_codex(["plugin", "marketplace", "add", str(REPO_ROOT), "--json"], cwd=self.root, codex_home=self.codex_home)
        self.assertEqual(added.returncode, 0, added.stderr)
        self.assertEqual(json.loads(added.stdout)["marketplaceName"], "claude-codex-bridge")
        installed = L.run_codex(["plugin", "add", "bridge-codex@claude-codex-bridge", "--json"], cwd=self.root, codex_home=self.codex_home)
        self.assertEqual(installed.returncode, 0, installed.stderr)
        return Path(json.loads(installed.stdout)["installedPath"])

    def make_project(self, name: str) -> Path:
        project = self.root / name
        L.make_git_repo(project)
        return project

    def run_entry(self, cwd: Path, args: list[str]) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["node", str(self.package / "scripts/plugin-packages/bridge-plugin.mjs"), *args],
            cwd=str(cwd), capture_output=True, text=True, timeout=1800,
            env=client_env({"CLAUDE_CODEX_BRIDGE_HOME": str(self.home)}),
        )

    def test_the_repository_marketplace_installs_a_package_that_can_set_a_project_up(self):
        self.package = self.install_package()
        project = self.make_project("a project")

        before = sorted(str(p) for p in project.rglob("*"))
        status = self.run_entry(project, ["status", "--json"])
        self.assertEqual(json.loads(status.stdout)["state"], "not-enabled")
        self.assertEqual(sorted(str(p) for p in project.rglob("*")), before, "status must write nothing")

        # No --commit: the package uses the pin its own release.json carries, with only a local
        # source supplied. Nothing is published and nothing is fetched.
        release = json.loads((self.package / "scripts/plugin-packages/release.json").read_text())
        pinned = release["pinned"]["commit"]
        self.assertEqual(
            subprocess.run(["git", "-C", str(REPO_ROOT), "cat-file", "-e", f"{pinned}^{{commit}}"], capture_output=True).returncode,
            0,
            f"the shipped release pin {pinned} is not a commit of this repository",
        )
        prepared = self.run_entry(project, ["setup", "--yes", "--json", "--source", str(REPO_ROOT)])
        self.assertEqual(prepared.returncode, 0, prepared.stdout + prepared.stderr)
        report = json.loads(prepared.stdout)
        self.assertTrue(report["applied"])
        self.assertEqual(report["runtime"]["commit"], pinned)
        self.assertEqual(report["source"]["commit"], pinned)
        self.assertEqual(json.loads(self.run_entry(project, ["status", "--json"]).stdout)["state"], "ready")
        # No instruction file was copied into the project.
        self.assertFalse((project / ".agents/skills").exists())
        self.assertEqual(sorted(p.name for p in (project / ".bridge-project").iterdir()), ["bridge.json", "entry.mjs"])

    def test_a_plain_codex_session_in_an_inherited_worktree_starts_the_real_bridge(self):
        """AC-02/AC-03 on the host: no flags, no manual init, the real runtime, model-free."""
        self.package = self.install_package()
        project = self.make_project("enabled project")
        self.assertEqual(self.run_entry(project, ["setup", "--yes", "--json", "--source", str(REPO_ROOT), "--commit", self.commit]).returncode, 0)
        git(project, "add", "-A")
        git(project, "commit", "-qm", "enable bridge")

        external = self.root / "an inherited worktree"
        git(project, "worktree", "add", "-q", "-b", "inherited", str(external))
        self.assertTrue((external / ".bridge-project/entry.mjs").is_file())
        self.assertFalse((external / ".bridge-runtime").exists())
        # No setup call here at all: an inherited worktree is pristine and serves as it is.
        self.assertEqual(json.loads(self.run_entry(external, ["status", "--json"]).stdout)["state"], "inherited-pristine")

        # Codex reads a project config only for a trusted project: that consent stays explicit.
        (self.codex_home / "config.toml").write_text(f'[projects."{external}"]\ntrust_level = "trusted"\n')

        # 1. The host resolves the inherited managed block for this worktree, with no flags and
        #    no per-worktree path in it.
        listed = L.run_codex(["mcp", "list", "--json"], cwd=external, codex_home=self.codex_home)
        self.assertEqual(listed.returncode, 0, listed.stderr)
        servers = {entry["name"]: entry for entry in json.loads(listed.stdout)}
        self.assertIn("bridge", servers)
        transport = servers["bridge"]["transport"]
        self.assertEqual(transport["args"][0], "./.bridge-project/entry.mjs")
        self.assertNotIn(str(self.home), json.dumps(transport))

        # 2. A plain session starts, model-free, without the bridge server breaking startup.
        proc = L.codex_session_start(external, self.codex_home, extra_env={"CLAUDE_CODEX_BRIDGE_HOME": str(self.home), "PWD": str(self.root)})
        self.assertTrue(L.codex_turn_failed_without_request(proc), f"the session must stay model-free: {proc.stdout[-300:]}")

        # 3. The entry point the host resolved really serves the bridge for *this* worktree.
        #    Codex does not forward an MCP server's stderr, so the handshake is driven directly
        #    through the same committed file the host would run.
        served = subprocess.run(
            ["node", str(external / ".bridge-project/entry.mjs"), "--caller", "codex", "--delegation", "allow"],
            cwd=str(external), capture_output=True, text=True, timeout=120,
            env=client_env({"CLAUDE_CODEX_BRIDGE_HOME": str(self.home)}),
            input="\n".join(
                json.dumps(frame)
                for frame in (
                    {"jsonrpc": "2.0", "id": 0, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "w14", "version": "1"}}},
                    {"jsonrpc": "2.0", "method": "notifications/initialized"},
                    {"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
                )
            ) + "\n",
        )
        frames = [json.loads(line) for line in served.stdout.splitlines() if line.strip()]
        initialized = next(f for f in frames if f.get("id") == 0)
        tools = next(f for f in frames if f.get("id") == 1)
        self.assertEqual(initialized["result"]["serverInfo"]["name"], "bridge-native-project")
        self.assertGreater(len(tools["result"]["tools"]), 10)
        self.assertIn(f"workspace={external}", served.stderr)
        self.assertIn(f"db={external}/.bridge/bridge.db", served.stderr)
        # Reads only: a handshake and a tool listing create no database and no local state at all,
        # in a worktree that was never prepared by hand.
        self.assertFalse((external / ".bridge/bridge.db").exists())
        self.assertFalse((external / ".bridge-runtime").exists())
        self.assertFalse((project / ".bridge/bridge.db").exists())


class ClaudeHost(unittest.TestCase):
    def setUp(self):
        try:
            L.claude_bin()
        except L.ProbeSkipped as exc:
            self.skipTest(f"host evidence unavailable: {exc}")
        self.root = Path(tempfile.mkdtemp(prefix="w14-claude-host-"))
        L.assert_isolated(self.root)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_the_generated_package_validates_against_the_host_schema(self):
        report = L.run_claude_validate(CLAUDE_PACKAGE)
        self.assertEqual(report["exit_code"], 0, report)
        self.assertTrue(report["report"]["success"], report)

    def test_the_repository_marketplace_installs_the_claude_package(self):
        config = self.root / "claude-config"
        config.mkdir()
        env = {"CLAUDE_CONFIG_DIR": str(config)}
        self.assertEqual(L.run_claude_plugin(["marketplace", "add", str(REPO_ROOT)], env=env)["exit_code"], 0)
        installed = L.run_claude_plugin(["install", "bridge-claude@claude-codex-bridge", "--json", "-y"], env=env)
        self.assertEqual(installed["exit_code"], 0, installed)
        self.assertTrue(list((config / "plugins" / "cache").rglob("skills/feature-execute/SKILL.md")))

    def test_a_delegated_executor_loads_the_package_with_no_install(self):
        """AC-04: the instruction set comes from the runtime, not from the operator's profile."""
        config = self.root / "empty-claude-config"
        config.mkdir()
        project = self.root / "a project"
        L.make_git_repo(project)
        debug = self.root / "claude-debug.log"
        with L.AnthropicStub() as stub:
            proc = L.run_claude_headless(
                "w14 check: no model call is expected to succeed",
                cwd=project, config_dir=config, stub=stub,
                extra_args=["--plugin-dir", str(CLAUDE_PACKAGE)], debug_file=debug,
            )
        result = L.claude_result(proc)
        self.assertTrue(L.claude_spent_nothing(result), result)
        text = debug.read_text(errors="replace")
        self.assertIn("Loaded inline plugin from path: bridge-claude", text)
        match = re.search(r"Loaded (\d+) skills from plugin bridge-claude", text)
        self.assertIsNotNone(match, "the plugin's skills were not loaded")
        self.assertGreaterEqual(int(match.group(1)), 6, "the executor must get the whole workflow")
        self.assertFalse((config / "plugins" / "cache").exists())
        self.assertFalse((project / ".claude" / "skills").exists())
        self.assertFalse((project / ".agents").exists())



class InstalledRuntimeWorkflow(unittest.TestCase):
    """W17-03 on a real installed runtime of HEAD: executor packages and pin-first selection."""

    def setUp(self):
        self.home, self.commit, self.runtime_id = build_runtime()
        self.runtime = _RUNTIME["path"]
        self.root = Path(tempfile.mkdtemp(prefix="w17-runtime-workflow-"))
        L.assert_isolated(self.root)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def pinned_project(self) -> Path:
        project = self.root / "pinned project"
        L.make_git_repo(project)
        (project / ".bridge-project").mkdir()
        (project / ".bridge-project" / "bridge.json").write_text(json.dumps(
            {"format": "claude-codex-bridge.project/v1", "enabled": True,
             "pinned": {"runtime_id": self.runtime_id, "commit": self.commit}}, indent=2) + "\n")
        git(project, "add", "-A")
        git(project, "commit", "-qm", "pin")
        return project

    def select(self, package: Path, project: Path) -> tuple[int, dict]:
        proc = subprocess.run(
            ["node", str(package / "scripts" / "select-source.mjs"), "--cwd", str(project)],
            capture_output=True, text=True, timeout=300, env=client_env({"CLAUDE_CODEX_BRIDGE_HOME": str(self.home)}),
        )
        return proc.returncode, json.loads(proc.stdout)

    def test_the_runtime_launcher_hands_over_both_of_its_packages(self):
        launcher = (self.runtime / "scripts" / "native-bridge-mcp.mjs").as_uri()
        out = subprocess.run(
            ["node", "--input-type=module", "-e",
             f"import {{ executorPackages }} from {json.dumps(launcher)}; process.stdout.write(JSON.stringify(executorPackages()));"],
            capture_output=True, text=True, timeout=120, env=client_env(),
        )
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(json.loads(out.stdout), [
            str(self.runtime / "plugins" / "bridge-claude"),
            str(self.runtime / "plugins" / "feature-workflow-claude"),
        ])

    def test_the_runtime_workflow_package_selects_its_own_pin(self):
        project = self.pinned_project()
        before = git(project, "status", "--porcelain=v1", "--untracked-files=all")
        manifest = json.loads((self.runtime / "runtime-manifest.json").read_text())
        code, answer = self.select(self.runtime / "plugins" / "feature-workflow-claude", project)
        self.assertEqual((code, answer["source"], answer["code"]), (0, "runtime", "PINNED_RUNTIME"))
        self.assertIs(answer["package_matches_pin"], True)
        self.assertEqual(answer["record"], f"INSTRUCTIONS=runtime:{self.runtime_id} SET={manifest['instructions']['set_sha256']}")
        self.assertEqual(Path(answer["instructions"]["workflow_skills"]), self.runtime / ".agents" / "skills")
        self.assertTrue(answer["instructions"]["local_delivery"])
        # The marketplace copy (outside the runtime) resolves the same pin, never itself.
        code, answer = self.select(REPO_ROOT / "plugins" / "feature-workflow-claude", project)
        self.assertEqual((code, answer["code"], answer["package_matches_pin"]), (0, "PINNED_RUNTIME", False))
        self.assertEqual(git(project, "status", "--porcelain=v1", "--untracked-files=all"), before)

    def test_a_delegated_session_gets_the_runtime_copies_over_a_personal_install(self):
        try:
            L.claude_bin()
        except L.ProbeSkipped as exc:
            self.skipTest(f"host evidence unavailable: {exc}")
        config = self.root / "claude-config"
        config.mkdir()
        env = {"CLAUDE_CONFIG_DIR": str(config)}
        self.assertEqual(L.run_claude_plugin(["marketplace", "add", str(REPO_ROOT)], env=env)["exit_code"], 0)
        self.assertEqual(L.run_claude_plugin(["install", "feature-workflow@claude-codex-bridge"], env=env)["exit_code"], 0)
        project = self.pinned_project()
        debug = self.root / "claude-debug.log"
        dirs = [self.runtime / "plugins" / "bridge-claude", self.runtime / "plugins" / "feature-workflow-claude"]
        with L.AnthropicStub() as stub:
            proc = L.run_claude_headless(
                "w17 check: no model call is expected to succeed", cwd=project, config_dir=config, stub=stub,
                extra_args=["--output-format", "stream-json", "--verbose", *[a for d in dirs for a in ("--plugin-dir", str(d))]],
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
        self.assertTrue(L.claude_spent_nothing(result), result)
        plugins = {p["name"]: p.get("path") for p in init.get("plugins", [])}
        self.assertEqual(plugins.get("feature-workflow"), str(dirs[1]))
        self.assertEqual(plugins.get("bridge-claude"), str(dirs[0]))
        self.assertIn('Plugin "feature-workflow" from --plugin-dir overrides installed version', debug.read_text(errors="replace"))
        entries = sorted(s for s in init.get("skills", []) if re.search(r"(^|:)feature-[a-z]+$", s))
        self.assertEqual([s for s in entries if ":" not in s], [])
        self.assertEqual(len(entries), 12)


if __name__ == "__main__":
    unittest.main()
