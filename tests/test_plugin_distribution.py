"""Host checks for the generated distribution packages and the project dispatcher.

These are *host* checks, not fixture checks: they install the real generated packages into
disposable Codex and Claude Code profiles and start the real clients. Every client run is
model-free — a Codex session stops on a deliberately absent provider key, and a Claude session
talks to a local stub that answers HTTP 400 — and every profile lives under a temporary root, so
the operator's own configuration is never read for settings and never written.

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


def git(cwd: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(cwd), *args], check=True, capture_output=True, text=True, env=L.git_env()
    ).stdout.strip()


def make_repo(path: Path) -> None:
    L.make_git_repo(path)


class GeneratedPackages(unittest.TestCase):
    """The generator is the only writer, and what it wrote is what is committed."""

    def test_generation_is_deterministic_and_matches_the_committed_tree(self):
        first = subprocess.run(
            ["node", str(GENERATOR), "--check", "--json"], capture_output=True, text=True, cwd=REPO_ROOT
        )
        report = json.loads(first.stdout)
        self.assertTrue(report["ok"], report)
        self.assertEqual(report["problems"], [])
        self.assertEqual(report["forbidden_references"], [])
        self.assertEqual(first.returncode, 0)

        # Deterministic: a second generation into a different directory has the same digest.
        second = subprocess.run(
            ["node", str(GENERATOR), "--check", "--json"], capture_output=True, text=True, cwd=REPO_ROOT
        )
        self.assertEqual(json.loads(second.stdout)["source_digest"], report["source_digest"])

    def test_editing_a_canonical_skill_without_regenerating_fails_the_check(self):
        skill = REPO_ROOT / ".agents" / "skills" / "feature-plan" / "SKILL.md"
        original = skill.read_bytes()
        try:
            skill.write_bytes(original + b"\nA canonical edit that was never regenerated.\n")
            out = subprocess.run(
                ["node", str(GENERATOR), "--check", "--json"], capture_output=True, text=True, cwd=REPO_ROOT
            )
            self.assertEqual(out.returncode, 1)
            self.assertFalse(json.loads(out.stdout)["ok"])
        finally:
            skill.write_bytes(original)
        self.assertEqual(
            subprocess.run(["node", str(GENERATOR), "--check"], capture_output=True, cwd=REPO_ROOT).returncode,
            0,
            "the canonical file was not restored",
        )

    def test_no_generated_file_points_back_into_a_bridge_checkout(self):
        for package in (CODEX_PACKAGE, CLAUDE_PACKAGE):
            for path in sorted(package.rglob("*")):
                if not path.is_file() or path.suffix not in {".md", ".yaml", ".yml", ".py", ".mjs"}:
                    continue
                text = path.read_text(errors="replace")
                for index in [m.start() for m in re.finditer(re.escape(".agents/skills/"), text)]:
                    anchor = text[max(0, index - 32) : index]
                    self.assertTrue(
                        "CLAUDE_PLUGIN_ROOT" in anchor or "<instructions.root>" in anchor,
                        f"{path.relative_to(REPO_ROOT)} still points into a bridge checkout",
                    )

    def test_the_codex_package_ships_no_workflow_copy(self):
        skills = sorted(p.name for p in (CODEX_PACKAGE / "skills").iterdir())
        self.assertEqual(skills, ["bridge"], "the manager entry must be thin")
        text = (CODEX_PACKAGE / "skills" / "bridge" / "SKILL.md").read_text()
        self.assertIn("instructions.root", text)
        for workflow in ("feature-plan", "feature-review", "feature-decide"):
            self.assertFalse((CODEX_PACKAGE / "skills" / workflow).exists())

    def test_the_claude_package_carries_the_whole_role_authority(self):
        skills = sorted(p.name for p in (CLAUDE_PACKAGE / "skills").iterdir())
        self.assertIn("using-bridge", skills)
        for workflow in ("feature-plan", "feature-execute", "feature-review", "feature-exchange"):
            self.assertIn(workflow, skills)
        # The exchange helper travels with the package and is referenced through the plugin root.
        self.assertTrue((CLAUDE_PACKAGE / "skills" / "feature-exchange" / "scripts" / "feature_exchange.py").is_file())
        self.assertIn(
            "${CLAUDE_PLUGIN_ROOT}/skills/feature-exchange/scripts/feature_exchange.py",
            (CLAUDE_PACKAGE / "skills" / "feature-execute" / "SKILL.md").read_text(),
        )

    def test_the_packages_carry_no_node_dependencies_to_install(self):
        # A marketplace must not be assumed to run npm install for us.
        for package in (CODEX_PACKAGE, CLAUDE_PACKAGE):
            self.assertFalse((package / "package.json").exists())
            self.assertFalse((package / "node_modules").exists())


class CodexHost(unittest.TestCase):
    def setUp(self):
        try:
            L.codex_bin()
        except L.ProbeSkipped as exc:
            self.skipTest(f"host evidence unavailable: {exc}")
        self.root = Path(tempfile.mkdtemp(prefix="w14-codex-host-"))
        L.assert_isolated(self.root)
        self.codex_home = self.root / "codex-home"
        self.codex_home.mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_the_repository_marketplace_installs_the_codex_package(self):
        added = L.run_codex(
            ["plugin", "marketplace", "add", str(REPO_ROOT), "--json"], cwd=self.root, codex_home=self.codex_home
        )
        self.assertEqual(added.returncode, 0, added.stderr)
        self.assertEqual(json.loads(added.stdout)["marketplaceName"], "claude-codex-bridge")

        installed = L.run_codex(
            ["plugin", "add", "bridge-codex@claude-codex-bridge", "--json"], cwd=self.root, codex_home=self.codex_home
        )
        self.assertEqual(installed.returncode, 0, installed.stderr)
        path = Path(json.loads(installed.stdout)["installedPath"])
        self.assertTrue((path / "skills" / "bridge" / "SKILL.md").is_file())
        self.assertTrue((path / "scripts" / "bridge-plugin.mjs").is_file())
        # The thin entry is the only skill the manager gets from the plugin.
        self.assertEqual(sorted(p.name for p in (path / "skills").iterdir()), ["bridge"])

    def test_the_installed_entry_runs_from_the_cache_and_reports_purely(self):
        L.run_codex(["plugin", "marketplace", "add", str(REPO_ROOT), "--json"], cwd=self.root, codex_home=self.codex_home)
        installed = L.run_codex(
            ["plugin", "add", "bridge-codex@claude-codex-bridge", "--json"], cwd=self.root, codex_home=self.codex_home
        )
        entry = Path(json.loads(installed.stdout)["installedPath"]) / "scripts" / "bridge-plugin.mjs"

        project = self.root / "a project"
        make_repo(project)
        before = sorted(str(p) for p in project.rglob("*"))
        out = subprocess.run(
            ["node", str(entry), "status", "--json"], cwd=str(project), capture_output=True, text=True
        )
        report = json.loads(out.stdout)
        self.assertEqual(report["state"], "not-enabled")
        self.assertEqual(report["workspace"]["root"], str(project.resolve()))
        self.assertTrue(report["reads_only"])
        self.assertEqual(sorted(str(p) for p in project.rglob("*")), before, "status must write nothing")

    def test_an_inherited_external_worktree_starts_the_dispatcher_on_the_right_root(self):
        """AC-03: an ordinary client start in an inherited worktree, with no preparation step."""
        project = self.root / "enabled project"
        make_repo(project)
        runtime = self._fake_runtime("0.2.0-aaaaaaaaaaaa")
        env = {"CLAUDE_CODEX_BRIDGE_HOME": str(self.root / "bridge-home")}
        prepared = subprocess.run(
            [
                "node",
                str(REPO_ROOT / "scripts" / "plugin-packages" / "bridge-plugin.mjs"),
                "prepare",
                "--yes",
                "--json",
                "--runtime",
                "0.2.0-aaaaaaaaaaaa",
            ],
            cwd=str(project),
            capture_output=True,
            text=True,
            env={**os.environ, **env},
        )
        self.assertEqual(prepared.returncode, 0, prepared.stderr)
        git(project, "add", "-A")
        git(project, "commit", "-qm", "enable bridge")

        external = self.root / "inherited worktree"
        git(project, "worktree", "add", "-q", "-b", "inherited", str(external))
        self.assertTrue((external / ".bridge-project" / "dispatch.mjs").is_file())
        self.assertFalse((external / ".bridge-runtime").exists())

        # Codex only reads a project config for a trusted project; that consent stays explicit.
        (self.codex_home / "config.toml").write_text(
            f'[projects."{external}"]\ntrust_level = "trusted"\n'
        )
        record = self.root / "dispatch-record.jsonl"
        (runtime / "scripts").mkdir(parents=True, exist_ok=True)
        (runtime / "scripts" / "native-bridge-mcp.mjs").write_text(
            "import { appendFileSync } from 'node:fs';\n"
            f"appendFileSync({json.dumps(str(record))}, JSON.stringify({{cwd: process.cwd(), argv: process.argv.slice(2)}}) + '\\n');\n"
            "process.stdin.on('data', () => {});\n"
        )

        proc = L.codex_session_start(external, self.codex_home, extra_env={**env, "PWD": str(self.root)})
        self.assertTrue(
            L.codex_turn_failed_without_request(proc), f"the probe session must stay model-free: {proc.stdout[-400:]}"
        )
        self.assertTrue(record.exists(), "the dispatcher did not hand over to the pinned runtime")
        handover = json.loads(record.read_text().splitlines()[0])
        # The worktree is passed explicitly and is this worktree, not the main checkout, even
        # though PWD deliberately named a different directory.
        self.assertIn("--workspace", handover["argv"])
        self.assertEqual(handover["argv"][handover["argv"].index("--workspace") + 1], str(external.resolve()))

    def _fake_runtime(self, runtime_id: str) -> Path:
        path = self.root / "bridge-home" / "runtimes" / runtime_id
        (path / "scripts").mkdir(parents=True)
        (path / "runtime-manifest.json").write_text(
            json.dumps(
                {
                    "format": "claude-codex-bridge.runtime/v1",
                    "runtime_id": runtime_id,
                    "source": {"commit": "a" * 40},
                    "compatibility": {},
                    "instructions": {"set_sha256": "b" * 64, "files": []},
                    "mcp": {"launcher": "scripts/native-bridge-mcp.mjs"},
                    "tree_sha256": "c" * 64,
                }
            )
        )
        (path / "scripts" / "native-bridge-mcp.mjs").write_text("process.stdin.on('data', () => {});\n")
        return path


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
        added = L.run_claude_plugin(["marketplace", "add", str(REPO_ROOT)], env=env)
        self.assertEqual(added["exit_code"], 0, added)
        installed = L.run_claude_plugin(
            ["install", "bridge-claude@claude-codex-bridge", "--json", "-y"], env=env
        )
        self.assertEqual(installed["exit_code"], 0, installed)
        cached = list((config / "plugins" / "cache").rglob("skills/feature-execute/SKILL.md"))
        self.assertTrue(cached, "the workflow skills were not installed")

    def test_a_delegated_executor_loads_the_package_with_no_install(self):
        """AC-04: the instruction set comes from the runtime, not from the operator's profile."""
        config = self.root / "empty-claude-config"
        config.mkdir()
        project = self.root / "a project"
        make_repo(project)
        debug = self.root / "claude-debug.log"
        with L.AnthropicStub() as stub:
            proc = L.run_claude_headless(
                "w14 check: no model call is expected to succeed",
                cwd=project,
                config_dir=config,
                stub=stub,
                extra_args=["--plugin-dir", str(CLAUDE_PACKAGE)],
                debug_file=debug,
            )
        result = L.claude_result(proc)
        self.assertTrue(L.claude_spent_nothing(result), result)
        text = debug.read_text(errors="replace")
        self.assertIn("Loaded inline plugin from path: bridge-claude", text)
        match = re.search(r"Loaded (\d+) skills from plugin bridge-claude", text)
        self.assertIsNotNone(match, "the plugin's skills were not loaded")
        self.assertGreaterEqual(int(match.group(1)), 6, "the executor must get the whole workflow")
        # Nothing was installed into the profile and nothing was copied into the project.
        self.assertFalse((config / "plugins" / "cache").exists())
        self.assertFalse((project / ".claude" / "skills").exists())
        self.assertFalse((project / ".agents").exists())


if __name__ == "__main__":
    unittest.main()
