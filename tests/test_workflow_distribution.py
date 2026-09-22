"""Checks of the generated feature-workflow packages (W17-02; contract 01-distribution.md).

Everything here reads the *actual* generated packages under `plugins/feature-workflow-*`, never a
candidate fixture. Static checks cover the six entries, their resources and references, the
verbatim wave16 `local-delivery.md` and the canonical reader. Behaviour checks run the packaged
reader and exchange helper from a copy outside the bridge checkout, with an empty bridge home and
no MCP server. Host checks install the repository marketplace into disposable Claude Code and Codex
profiles and read what each client lists — model-free: Claude talks to a local HTTP 400 stub and
must report zero usage; Codex renders `debug prompt-input` in a credential-free home. A missing
client makes its test skip, and the skip says so.
"""

from __future__ import annotations

import hashlib
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

PACKAGES = {
    "claude": REPO_ROOT / "plugins" / "feature-workflow-claude",
    "codex": REPO_ROOT / "plugins" / "feature-workflow-codex",
}
BRIDGE_PACKAGES = [REPO_ROOT / "plugins" / "bridge-codex", REPO_ROOT / "plugins" / "bridge-claude"]
SIX = ["feature-decide", "feature-design", "feature-exchange", "feature-execute", "feature-plan", "feature-review"]
QUALIFIED = sorted(f"feature-workflow:{skill}" for skill in SIX)
READER = REPO_ROOT / "scripts" / "workflow-source" / "select-source.mjs"
LOCAL_DELIVERY = "skills/feature-execute/references/local-delivery.md"
LINK = re.compile(r"\]\(([^)#\s]+)(?:#[^)]*)?\)")
ANCHORED = re.compile(r"(\$\{CLAUDE_PLUGIN_ROOT\}|<package>)(/[A-Za-z0-9_./-]+)")


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def git(cwd: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(cwd), *args], check=True, capture_output=True, text=True, env=L.git_env()).stdout.strip()


def make_repo(path: Path) -> Path:
    L.make_git_repo(path)
    return path


def unresolved_references(package: Path) -> list[dict]:
    bad = []
    for path in sorted(package.rglob("*")):
        if not path.is_file() or path.suffix not in {".md", ".yaml", ".yml"}:
            continue
        text = path.read_text()
        for match in LINK.finditer(text):
            target = match.group(1)
            if re.match(r"^[a-z]+:", target):
                continue
            resolved = Path(target.replace("${CLAUDE_PLUGIN_ROOT}", str(package)).replace("<package>", str(package)))
            if not resolved.is_absolute():
                resolved = (path.parent / resolved).resolve()
            if not resolved.exists():
                bad.append({"file": str(path.relative_to(package)), "target": target})
        for match in ANCHORED.finditer(text):
            target = (package / match.group(2).lstrip("/").rstrip(".")).resolve()
            if not target.exists():
                bad.append({"file": str(path.relative_to(package)), "target": match.group(0)})
    return bad


def run_reader(package: Path, cwd: Path, home: Path, *extra: str) -> tuple[int, dict]:
    env = dict(os.environ, CLAUDE_CODEX_BRIDGE_HOME=str(home))
    proc = subprocess.run(["node", str(package / "scripts" / "select-source.mjs"), "--cwd", str(cwd), *extra],
                          capture_output=True, text=True, env=env, timeout=120)
    return proc.returncode, (json.loads(proc.stdout) if proc.stdout.strip() else {"stderr": proc.stderr})


class GeneratedWorkflowPackages(unittest.TestCase):
    def test_both_marketplaces_offer_the_workflow_plugin_from_its_package(self):
        codex = json.loads((REPO_ROOT / ".agents/plugins/marketplace.json").read_text())
        claude = json.loads((REPO_ROOT / ".claude-plugin/marketplace.json").read_text())
        self.assertEqual({p["name"]: p["source"]["path"] for p in codex["plugins"]},
                         {"bridge-codex": "./plugins/bridge-codex", "feature-workflow": "./plugins/feature-workflow-codex"})
        self.assertEqual({p["name"]: p["source"] for p in claude["plugins"]},
                         {"bridge-claude": "./plugins/bridge-claude", "feature-workflow": "./plugins/feature-workflow-claude"})
        self.assertEqual(codex["name"], "claude-codex-bridge")
        self.assertEqual(claude["name"], "claude-codex-bridge")

    def test_manifests_name_the_plugin_feature_workflow_and_declare_no_server(self):
        for client, package in PACKAGES.items():
            with self.subTest(client=client):
                manifest = json.loads((package / f".{client}-plugin" / "plugin.json").read_text())
                self.assertEqual(manifest["name"], "feature-workflow")
                self.assertEqual(manifest["skills"], "./skills/")
                self.assertNotIn("mcpServers", manifest)
                self.assertFalse((package / ".mcp.json").exists())
                marker = json.loads((package / "GENERATED.json").read_text())
                self.assertEqual(marker["plugin"], "feature-workflow")
                for entry in marker["files"]:
                    self.assertEqual(sha(package / entry["path"]), entry["sha256"], entry["path"])

    def test_six_entries_each_open_with_the_source_preamble(self):
        for client, package in PACKAGES.items():
            reader = '${CLAUDE_PLUGIN_ROOT}/scripts/select-source.mjs' if client == "claude" else "<package>/scripts/select-source.mjs"
            self.assertEqual(sorted(p.name for p in (package / "skills").iterdir()), SIX)
            for skill in SIX:
                with self.subTest(client=client, skill=skill):
                    text = (package / "skills" / skill / "SKILL.md").read_text()
                    front, body = text.split("\n---\n", 1)
                    self.assertIn(f"name: {skill}", front)
                    self.assertTrue(body.lstrip().startswith("> **Instruction source — check first.**"))
                    self.assertIn(f"`feature-workflow:{skill}`", body)
                    self.assertIn(reader, body)
                    self.assertIn(f"<instructions.workflow_skills>/{skill}/SKILL.md", body)

    def test_the_bridge_packages_keep_their_role_and_installer_and_no_preamble(self):
        codex, claude = BRIDGE_PACKAGES
        self.assertEqual(sorted(p.name for p in (codex / "skills").iterdir()), ["bridge", "bridge-upgrade"])
        self.assertTrue((claude / "skills" / "bridge-upgrade" / "SKILL.md").is_file())
        for package in BRIDGE_PACKAGES:
            self.assertTrue((package / "scripts" / "bridge.mjs").is_file())
            self.assertTrue((package / "scripts" / "plugin-packages" / "bridge-plugin.mjs").is_file())
        # The executor package keeps the canonical skills: the runtime must never point onward.
        for skill in SIX:
            self.assertNotIn("Instruction source — check first", (claude / "skills" / skill / "SKILL.md").read_text())

    def test_workflow_packages_carry_no_installer_upgrade_role_or_receipt_helper(self):
        for client, package in PACKAGES.items():
            with self.subTest(client=client):
                files = sorted(str(p.relative_to(package)) for p in package.rglob("*") if p.is_file())
                self.assertEqual([f for f in files if f.startswith("scripts/")], ["scripts/select-source.mjs"])
                for forbidden in ("bridge-upgrade", "using-bridge", "bridge.mjs", "package.json", "node_modules"):
                    self.assertFalse(any(forbidden in f for f in files), forbidden)
                for path in package.rglob("*.py"):
                    self.assertNotRegex(path.read_text(), r"def\s+receipt\s*\(")
                self.assertFalse(any("test_local_delivery" in f for f in files))

    def test_reader_is_the_canonical_file_byte_for_byte(self):
        for package in PACKAGES.values():
            self.assertEqual(sha(package / "scripts" / "select-source.mjs"), sha(READER))

    def test_local_delivery_is_the_verbatim_wave16_resource(self):
        source = REPO_ROOT / ".agents" / "skills" / "feature-execute" / "references" / "local-delivery.md"
        text = source.read_text()
        # The rules packaging must never weaken (review R02-01 of wave16 and the final contract).
        for rule in (
            "git diff --no-renames --name-only -z BASE HEAD",
            "git log --no-renames --name-only -z --format= BASE..HEAD",
            "catches add-then-revert",
            "`--no-renames` is required",
            "git status --porcelain=v1 -z --untracked-files=all",
            "`preexisting`",
            "`overlap`",
            "`foreign`",
            "`OUTCOME=PARTIAL` always comes with a non-null `blocker`",
            "DELIVERY=local-v1",
        ):
            self.assertIn(rule, text)
        for client, package in PACKAGES.items():
            with self.subTest(client=client):
                self.assertEqual(sha(package / LOCAL_DELIVERY), sha(source))
                self.assertIn("[local-delivery.md](local-delivery.md)", (package / "skills/feature-execute/references/bridge-loop.md").read_text())

    def test_every_reference_resolves_inside_its_package(self):
        for client, package in PACKAGES.items():
            with self.subTest(client=client):
                self.assertEqual(unresolved_references(package), [])
                scan = subprocess.run(
                    ["node", "--input-type=module", "-e",
                     f"import {{ scanForbidden }} from {json.dumps((REPO_ROOT / 'scripts/plugin-packages/generate.mjs').as_uri())};"
                     "process.stdout.write(JSON.stringify(scanForbidden(process.argv[1])));", str(package)],
                    capture_output=True, text=True, check=True)
                self.assertEqual(json.loads(scan.stdout), [])

    def test_codex_metadata_qualifies_the_entry_it_mentions(self):
        for skill in SIX:
            metadata = PACKAGES["codex"] / "skills" / skill / "agents" / "openai.yaml"
            text = metadata.read_text()
            self.assertNotRegex(text, r"\$feature-(design|plan|execute|review|decide|exchange)\b")


class OutsideTheCheckout(unittest.TestCase):
    """The packages work from a copy far from any bridge checkout, with no runtime and no MCP."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="w17-02-outside-"))
        self.addCleanup(shutil.rmtree, self.root, True)
        self.home = self.root / "empty-bridge-home"
        self.home.mkdir()

    def copy(self, client: str) -> Path:
        target = self.root / "cache" / client / "feature-workflow"
        shutil.copytree(PACKAGES[client], target)
        return target

    def test_standalone_selects_the_package_and_writes_nothing(self):
        project = make_repo(self.root / "project")
        for client in PACKAGES:
            with self.subTest(client=client):
                package = self.copy(client)
                before = {p: sha(p) for p in project.rglob("*") if p.is_file() and ".git" not in p.parts}
                code, answer = run_reader(package, project, self.home)
                self.assertEqual((code, answer["source"], answer["code"]), (0, "plugin", "STANDALONE_NO_BRIDGE"))
                self.assertEqual(Path(answer["instructions"]["local_delivery"]), package / LOCAL_DELIVERY)
                self.assertTrue(answer["record"].startswith("INSTRUCTIONS=plugin:feature-workflow@"))
                self.assertNotIn("unknown", answer["record"])
                self.assertEqual(before, {p: sha(p) for p in project.rglob("*") if p.is_file() and ".git" not in p.parts})
                self.assertEqual(list(self.home.iterdir()), [])

    def test_a_pin_without_its_runtime_is_refused_not_served_from_the_package(self):
        project = make_repo(self.root / "pinned")
        (project / ".bridge-project").mkdir()
        (project / ".bridge-project" / "bridge.json").write_text(json.dumps(
            {"format": "claude-codex-bridge.project/v1", "enabled": True,
             "pinned": {"runtime_id": "0.3.2-34ecb8d45465", "commit": "34ecb8d4546543743228f2397b2a16ed10885e31"}}))
        package = self.copy("claude")
        code, answer = run_reader(package, project, self.home)
        self.assertEqual((code, answer["source"], answer["code"]), (3, "none", "RUNTIME_MISSING"))
        code, answer = run_reader(package, project, self.home, "--standalone")
        self.assertEqual((code, answer["code"], answer["pin_not_used"]), (0, "EXPLICIT_STANDALONE", "RUNTIME_MISSING"))

    def test_the_packaged_exchange_helper_exports_and_verifies_a_foreign_repository(self):
        repo = make_repo(self.root / "foreign")
        (repo / "docs" / "features" / "F-X").mkdir(parents=True)
        (repo / "docs" / "features" / "F-X" / "brief.md").write_text("# F-X synthetic brief\n")
        git(repo, "add", "-A")
        git(repo, "commit", "-qm", "brief")
        for client in PACKAGES:
            with self.subTest(client=client):
                helper = self.copy(client) / "skills" / "feature-exchange" / "scripts" / "feature_exchange.py"
                archive = self.root / f"{client}.zip"
                export = subprocess.run([sys.executable, str(helper), "export", "--repo", str(repo), "--feature", "docs/features/F-X",
                                         "--purpose", "plan-review", "--output", str(archive)], capture_output=True, text=True)
                self.assertEqual(export.returncode, 0, export.stderr)
                verify = subprocess.run([sys.executable, str(helper), "verify", "--repo", str(repo), "--archive", str(archive),
                                         "--expect-feature", "docs/features/F-X", "--expect-purpose", "plan-review"],
                                        capture_output=True, text=True)
                self.assertEqual(verify.returncode, 0, verify.stderr)
                report = json.loads(verify.stdout)
                self.assertEqual(report["integrity"], "ok")
                self.assertIn("docs/features/README.md", report["documents"]["supplied_by_installation"])
                shutil.rmtree(self.root / "cache" / client)
        self.assertEqual(git(repo, "status", "--porcelain"), "")


class RepositoryMarketplaceHosts(unittest.TestCase):
    """The repository marketplace, installed into disposable profiles; no model turn."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="w17-02-hosts-"))
        self.addCleanup(shutil.rmtree, self.root, True)
        L.assert_isolated(self.root)
        self.project = make_repo(self.root / "project")

    def test_claude_lists_exactly_the_six_qualified_entries(self):
        try:
            L.claude_bin()
        except L.ProbeSkipped as exc:
            self.skipTest(str(exc))
        config = self.root / "claude-config"
        config.mkdir()
        env = {"CLAUDE_CONFIG_DIR": str(config)}
        self.assertEqual(L.run_claude_plugin(["marketplace", "add", str(REPO_ROOT)], env=env)["exit_code"], 0)
        self.assertEqual(L.run_claude_plugin(["install", "feature-workflow@claude-codex-bridge"], env=env)["exit_code"], 0)
        self.assertEqual(L.run_claude_validate(PACKAGES["claude"])["exit_code"], 0)
        with L.AnthropicStub() as stub:
            proc = L.run_claude_headless("w17-02 probe", cwd=self.project, config_dir=config, stub=stub,
                                         extra_args=["--output-format", "stream-json", "--verbose"])
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
        feature = sorted(s for s in init.get("skills", []) if re.search(r"(^|:)feature-[a-z]+$", s))
        self.assertEqual(feature, QUALIFIED)

    def test_codex_lists_exactly_the_six_qualified_entries(self):
        try:
            L.codex_bin()
        except L.ProbeSkipped as exc:
            self.skipTest(str(exc))
        codex_home = self.root / "codex-home"
        codex_home.mkdir()
        added = L.run_codex(["plugin", "marketplace", "add", str(REPO_ROOT), "--json"], cwd=self.root, codex_home=codex_home)
        self.assertEqual(added.returncode, 0, added.stderr)
        installed = L.run_codex(["plugin", "add", "feature-workflow@claude-codex-bridge", "--json"], cwd=self.root, codex_home=codex_home)
        self.assertEqual(installed.returncode, 0, installed.stderr)
        rendered = L.run_codex(["debug", "prompt-input", "w17-02 probe"], cwd=self.project, codex_home=codex_home)
        self.assertEqual(rendered.returncode, 0, rendered.stderr)
        names = sorted(set(re.findall(r"- ((?:[a-z-]+:)?feature-[a-z]+): ", rendered.stdout.replace("\\n", "\n"))))
        self.assertEqual(names, QUALIFIED)


if __name__ == "__main__":
    unittest.main()
