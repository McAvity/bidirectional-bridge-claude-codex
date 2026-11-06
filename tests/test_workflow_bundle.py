"""W19-02: independent component generation, the dual-client workflow bundle, the immutable store
and the standalone helper (contract docs/features/F-W19-workflow-versioning/contracts/01-workflow-binding.md).

Model-free and host-free: real files in temporary directories, the real generator run on a copy
of the canonical sources, and the packaged helper run as a subprocess with an isolated
CLAUDE_CODEX_BRIDGE_HOME. No network, no MCP server, no client, no bridge database.

  python3 -m unittest tests/test_workflow_bundle.py -v
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "tools" / "pilot" / "workflow-versioning"))

import contract_fixtures as F  # noqa: E402
import contract_model as M  # noqa: E402

PLUGINS = {"claude": REPO_ROOT / "plugins" / "feature-workflow-claude", "codex": REPO_ROOT / "plugins" / "feature-workflow-codex"}
BRIDGE = {"claude": REPO_ROOT / "plugins" / "bridge-claude", "codex": REPO_ROOT / "plugins" / "bridge-codex"}
LIB = REPO_ROOT / "scripts" / "workflow-source" / "workflow-lib.mjs"
HELPER = REPO_ROOT / "scripts" / "workflow-source" / "workflow.mjs"
GENERATOR = "scripts/plugin-packages/generate.mjs"
SOURCE_COPY = [".agents", ".claude/skills", ".codex/skills", ".claude-plugin", "docs/features/README.md", "scripts", "plugins", "package.json"]


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def tree(root: Path) -> dict[str, str]:
    """Full inventory: every file with its digest and executable bit, links named as such."""
    out = {}
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root).as_posix()
        if path.is_symlink():
            out[rel] = "<symlink>"
        elif path.is_file():
            out[rel] = f"{sha(path)}:{'x' if path.stat().st_mode & 0o100 else '-'}"
    return out


def entries(root: Path, names: set[str]) -> dict[str, str]:
    out = {}
    for rel in (".agents/plugins/marketplace.json", ".claude-plugin/marketplace.json"):
        doc = json.loads((root / rel).read_text())
        for entry in doc["plugins"]:
            if entry["name"] in names:
                out[f"{rel}#{entry['name']}"] = json.dumps(entry, sort_keys=True)
    return out


def writable(root: Path) -> None:
    for path in [root, *root.rglob("*")]:
        if not path.is_symlink():
            path.chmod(path.stat().st_mode | stat.S_IWUSR)


def rmtree(root: Path) -> None:
    if root.exists():
        writable(root)
        shutil.rmtree(root, ignore_errors=True)


def git(cwd: Path, *args: str) -> str:
    env = dict(os.environ, GIT_CONFIG_GLOBAL="/dev/null", GIT_CONFIG_SYSTEM="/dev/null", GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@example.invalid",
               GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@example.invalid")
    return subprocess.run(["git", "-C", str(cwd), *args], check=True, capture_output=True, text=True, env=env).stdout.strip()


def lib(script: str, *args: str) -> dict:
    """Run a snippet against workflow-lib.mjs; the snippet prints one JSON value."""
    code = f"import * as W from {json.dumps(LIB.as_uri())};\nconst argv = process.argv.slice(1);\n{script}"
    proc = subprocess.run(["node", "--input-type=module", "-e", code, *args], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(proc.stderr)
    return json.loads(proc.stdout)


VERIFY = """try { const m = W.verifyBundle(argv[0], argv[1] || null); process.stdout.write(JSON.stringify({code: "OK", identity: m.identity})); }
catch (e) { process.stdout.write(JSON.stringify({code: e.code ?? "THROWN", detail: e.detail ?? String(e)})); }"""


class Workspace(unittest.TestCase):
    """A disposable root with an isolated bridge home."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="w19-02-"))
        self.addCleanup(rmtree, self.root)
        self.home = self.root / "bridge-home"
        self.store = self.home / "workflows"

    def env(self, **extra) -> dict:
        env = {k: v for k, v in os.environ.items() if not k.startswith(("CLAUDE_CODEX_BRIDGE", "XDG_DATA"))}
        env["CLAUDE_CODEX_BRIDGE_HOME"] = str(self.home)
        env.update(extra)
        return env

    def helper(self, script: Path, *args: str, cwd: Path | None = None) -> tuple[int, dict]:
        proc = subprocess.run(["node", str(script), *args], cwd=str(cwd or self.root), capture_output=True, text=True, env=self.env(), timeout=300)
        try:
            return proc.returncode, json.loads(proc.stdout)
        except json.JSONDecodeError:
            raise AssertionError(f"exit {proc.returncode}: {proc.stdout}\n{proc.stderr}")

    def project(self, name: str = "project") -> Path:
        path = self.root / name
        path.mkdir()
        git(path, "init", "-q", "-b", "main")
        return path

    def plugin_copy(self, client: str = "codex", name: str = "cache") -> Path:
        target = self.root / name / client / "feature-workflow"
        shutil.copytree(PLUGINS[client], target)
        return target

    def source_copy(self, name: str = "src") -> Path:
        target = self.root / name
        for rel in SOURCE_COPY:
            src = REPO_ROOT / rel
            dst = target / rel
            if src.is_dir():
                shutil.copytree(src, dst, ignore=shutil.ignore_patterns("node_modules", "__pycache__"))
            else:
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)
        (target / ".agents" / "plugins").mkdir(parents=True, exist_ok=True)
        shutil.copy2(REPO_ROOT / ".agents/plugins/marketplace.json", target / ".agents/plugins/marketplace.json")
        return target

    def generate(self, src: Path, *args: str) -> subprocess.CompletedProcess:
        return subprocess.run(["node", str(src / GENERATOR), *args], cwd=str(src), capture_output=True, text=True, timeout=300)


# ---------------------------------------------------------------------------


class GeneratedPackages(unittest.TestCase):
    """The committed packages, as the marketplace serves them."""

    def manifest(self, client: str) -> dict:
        return json.loads((PLUGINS[client] / "bundle" / "bundle.json").read_text())

    def test_both_workflow_packages_carry_the_same_complete_bundle(self):
        a, b = self.manifest("claude"), self.manifest("codex")
        self.assertEqual(a, b)
        self.assertEqual(tree(PLUGINS["claude"] / "bundle"), tree(PLUGINS["codex"] / "bundle"))
        self.assertEqual({f["path"].split("/", 1)[0] for f in a["files"]}, {"claude", "codex"})
        for client, package in PLUGINS.items():
            with self.subTest(client=client):
                self.assertEqual(lib(VERIFY, str(package / "bundle"))["code"], "OK")
                out = subprocess.run(["node", str(package / "scripts/workflow.mjs"), "verify-plugin"], capture_output=True, text=True)
                self.assertEqual(out.returncode, 0, out.stdout)
                self.assertEqual(json.loads(out.stdout)["client"], client)

    def test_package_root_equals_its_bundle_variant_byte_for_byte(self):
        for client, package in PLUGINS.items():
            with self.subTest(client=client):
                root = {k: v for k, v in tree(package).items() if not k.startswith("bundle/") and k != "GENERATED.json"}
                variant = {k.split("/", 2)[2]: v for k, v in tree(package).items() if k.startswith(f"bundle/{client}/")}
                self.assertEqual(root, variant)

    def test_the_bundle_is_not_recursive_and_holds_no_runtime_roles_or_release_metadata(self):
        """R19-C01: the registry and the release source are outside the hashed payload."""
        manifest = self.manifest("claude")
        for entry in manifest["files"]:
            inner = entry["path"].split("/", 1)[1]
            self.assertFalse(inner.startswith("bundle/") or inner == "GENERATED.json", entry["path"])
            self.assertFalse(re.match(r"skills/(using-bridge|bridge-upgrade|bridge)/", inner), entry["path"])
            self.assertNotIn(Path(inner).name, {"release.json", "releases.json"})
        for package in [*PLUGINS.values(), *BRIDGE.values()]:
            names = {p.name for p in package.rglob("*")}
            self.assertNotIn("releases.json", names)
        self.assertIsNone(manifest["source"]["commit"])  # no self-reference to the commit holding it

    def test_identity_is_reproducible_by_the_python_reference_model(self):
        manifest = M.verify_bundle(PLUGINS["codex"] / "bundle")
        self.assertEqual(M.bundle_identity(manifest), manifest["identity"])
        self.assertEqual(M.workflow_id(manifest["version"], manifest["identity"]), manifest["workflow_id"])

    def test_bridge_claude_is_role_only_and_versions_are_independent(self):
        claude = BRIDGE["claude"]
        self.assertEqual(sorted(p.name for p in (claude / "skills").iterdir()), ["bridge-upgrade", "using-bridge"])
        self.assertFalse((claude / "workflow").exists())
        for package in BRIDGE.values():
            marker = json.loads((package / "GENERATED.json").read_text())
            self.assertFalse(any(s.startswith(".agents/skills") or s == "docs/features/README.md" for s in marker["canonical_sources"]))
        bridge_version = json.loads((REPO_ROOT / "package.json").read_text())["version"]
        workflow_version = json.loads((REPO_ROOT / "scripts/workflow-source/release.json").read_text())["version"]
        market = {e["name"]: e for e in json.loads((REPO_ROOT / ".claude-plugin/marketplace.json").read_text())["plugins"]}
        self.assertEqual(market["bridge-claude"]["version"], bridge_version)
        self.assertEqual(market["feature-workflow"]["version"], workflow_version)
        for client, package in PLUGINS.items():
            manifest = json.loads((package / f".{client}-plugin" / "plugin.json").read_text())
            self.assertEqual(manifest["version"], workflow_version)
        for client, package in BRIDGE.items():
            self.assertEqual(json.loads((package / f".{client}-plugin" / "plugin.json").read_text())["version"], bridge_version)

    def test_helper_and_library_are_the_canonical_files(self):
        for client, package in PLUGINS.items():
            for name, source in (("workflow.mjs", HELPER), ("workflow-lib.mjs", LIB)):
                self.assertEqual(sha(package / "scripts" / name), sha(source), f"{client}/{name}")

    def test_component_checks_pass_on_the_repository(self):
        for component in ("all", "bridge", "workflow"):
            with self.subTest(component=component):
                out = subprocess.run(["node", str(REPO_ROOT / GENERATOR), "--check", "--component", component], capture_output=True, text=True, timeout=300)
                self.assertEqual(out.returncode, 0, out.stderr)

    def test_helper_uses_no_network_or_server_module(self):
        for path in (HELPER, LIB):
            text = path.read_text()
            modules = set(re.findall(r'from "([^"]+)"', text)) | set(re.findall(r'import\("([^"]+)"\)', text))
            self.assertLessEqual(modules, {"node:crypto", "node:fs", "node:os", "node:path", "node:url", "node:child_process", "./workflow-lib.mjs"}, path.name)
            self.assertNotRegex(text, r"\bfetch\(|node:(https?|net|tls|dgram|http2)\b|WebSocket")
        self.assertNotIn("spawnSync(", LIB.read_text())  # the library never starts a process


class IndependentGeneration(Workspace):
    """AC-01: one component's inputs never change the other's bytes (whole trees and entries)."""

    BRIDGE_PACKAGES = ("plugins/bridge-claude", "plugins/bridge-codex")
    WORKFLOW_PACKAGES = ("plugins/feature-workflow-claude", "plugins/feature-workflow-codex")

    def snap(self, src: Path) -> dict:
        return {
            "bridge": {p: tree(src / p) for p in self.BRIDGE_PACKAGES},
            "workflow": {p: tree(src / p) for p in self.WORKFLOW_PACKAGES},
            "bridge_entries": entries(src, {"bridge-claude", "bridge-codex"}),
            "workflow_entries": entries(src, {"feature-workflow"}),
            "identity": json.loads((src / self.WORKFLOW_PACKAGES[0] / "bundle/bundle.json").read_text())["identity"],
        }

    def regenerate(self, src: Path, *args: str) -> dict:
        out = self.generate(src, *args)
        self.assertEqual(out.returncode, 0, out.stderr)
        return self.snap(src)

    def test_a_copy_regenerates_the_committed_packages_exactly(self):
        src = self.source_copy()
        self.assertEqual(self.regenerate(src), self.snap(REPO_ROOT))

    def test_workflow_only_change_leaves_every_bridge_byte_unchanged(self):
        src = self.source_copy()
        before = self.regenerate(src)
        with (src / ".agents/skills/feature-plan/SKILL.md").open("a") as handle:
            handle.write("\nSynthetic workflow-only change.\n")
        after = self.regenerate(src)
        self.assertEqual(after["bridge"], before["bridge"])
        self.assertEqual(after["bridge_entries"], before["bridge_entries"])
        self.assertNotEqual(after["workflow"], before["workflow"])
        self.assertNotEqual(after["identity"], before["identity"])

    def test_bridge_only_change_leaves_the_workflow_and_its_identity_unchanged(self):
        src = self.source_copy()
        before = self.regenerate(src)
        with (src / ".claude/skills/using-bridge/SKILL.md").open("a") as handle:
            handle.write("\nSynthetic bridge-only change.\n")
        manifest = json.loads((src / "package.json").read_text())
        manifest["version"] = "9.9.9"
        (src / "package.json").write_text(json.dumps(manifest, indent=2) + "\n")
        after = self.regenerate(src)
        self.assertEqual(after["workflow"], before["workflow"])
        self.assertEqual(after["workflow_entries"], before["workflow_entries"])
        self.assertEqual(after["identity"], before["identity"])
        self.assertNotEqual(after["bridge"], before["bridge"])
        self.assertIn('"version": "9.9.9"', after["bridge_entries"][".claude-plugin/marketplace.json#bridge-claude"])

    def test_workflow_version_bump_leaves_the_bridge_unchanged(self):
        src = self.source_copy()
        before = self.regenerate(src)
        release = json.loads((src / "scripts/workflow-source/release.json").read_text())
        release["version"] = "1.0.1"
        (src / "scripts/workflow-source/release.json").write_text(json.dumps(release, indent=2) + "\n")
        after = self.regenerate(src)
        self.assertEqual(after["bridge"], before["bridge"])
        self.assertEqual(after["bridge_entries"], before["bridge_entries"])
        self.assertTrue(json.loads((src / self.WORKFLOW_PACKAGES[0] / "bundle/bundle.json").read_text())["workflow_id"].startswith("1.0.1-"))

    def test_component_write_keeps_the_other_component_and_its_entry_as_they_are(self):
        src = self.source_copy()
        before = self.regenerate(src)
        with (src / ".codex/skills/using-bridge/SKILL.md").open("a") as handle:
            handle.write("\nSynthetic stale bridge source.\n")
        after = self.regenerate(src, "--component", "workflow")
        self.assertEqual(after, before)  # bridge trees deliberately stale: not touched
        self.assertEqual(self.generate(src, "--check", "--component", "workflow").returncode, 0)
        self.assertNotEqual(self.generate(src, "--check", "--component", "bridge").returncode, 0)
        self.assertNotEqual(self.generate(src, "--check").returncode, 0)

    def test_the_identity_does_not_depend_on_the_checkout_path(self):
        a = self.regenerate(self.source_copy("a"))
        b = self.regenerate(self.source_copy("path with spaces"))
        self.assertEqual(a["identity"], b["identity"])
        self.assertEqual(a["workflow"], b["workflow"])

    def test_a_registered_version_with_other_bytes_is_refused(self):
        src = self.source_copy()
        identity = self.regenerate(src)["identity"]
        registry = src / "scripts/workflow-source/releases.json"
        registry.write_text(json.dumps({"format": "feature-workflow.releases/v1", "releases": [{"version": "1.0.0", "identity": identity, "commit": "0" * 40}]}) + "\n")
        self.assertEqual(self.generate(src, "--check").returncode, 0)
        before = self.snap(src)
        with (src / ".agents/skills/feature-plan/SKILL.md").open("a") as handle:
            handle.write("\nChanged after release.\n")
        out = self.generate(src)
        self.assertNotEqual(out.returncode, 0)
        self.assertIn("VERSION_REUSED", out.stderr)
        self.assertEqual(self.snap(src), before)  # refused before anything was written
        registry.write_text(json.dumps({"format": "feature-workflow.releases/v1", "releases": []}) + "\n")
        self.assertEqual(self.generate(src).returncode, 0)


class Store(Workspace):
    """§ 3.3/3.4 on a real filesystem: verification, atomic publication, immutability, restore."""

    def setUp(self):
        super().setUp()
        self.bundle = PLUGINS["claude"] / "bundle"
        self.identity = json.loads((self.bundle / "bundle.json").read_text())["identity"]
        self.workflow_id = json.loads((self.bundle / "bundle.json").read_text())["workflow_id"]

    def publish(self, bundle: Path | None = None, **opts) -> dict:
        return lib("""try { process.stdout.write(JSON.stringify(W.storePublish(argv[0], argv[1], JSON.parse(argv[2])))); }
catch (e) { process.stdout.write(JSON.stringify({result: e.code, detail: e.detail})); }""", str(self.store), str(bundle or self.bundle), json.dumps(opts))

    def entry(self) -> dict:
        return lib("process.stdout.write(JSON.stringify(W.storeEntry(argv[0], argv[1]), (k, v) => k === 'manifest' ? undefined : v));", str(self.store), self.identity)

    def copy_bundle(self, name: str) -> Path:
        target = self.root / "work" / name
        shutil.copytree(self.bundle, target)
        return target

    def test_publication_is_verified_read_only_and_idempotent(self):
        self.assertEqual(self.publish()["result"], "PUBLISHED")
        target = self.store / self.workflow_id
        self.assertEqual(tree(target), tree(self.bundle))
        for path in [target, *target.rglob("*")]:
            self.assertEqual(path.stat().st_mode & 0o222, 0, path)
        with self.assertRaises(PermissionError):
            (target / "claude/workflow/README.md").write_text("x")
        self.assertEqual(self.publish()["result"], "ALREADY_PRESENT")
        self.assertEqual(self.entry()["state"], "verified")
        self.assertEqual([p.name for p in self.store.iterdir()], [self.workflow_id])

    def test_verification_refuses_every_damaged_shape(self):
        cases = {}

        def mutate(name, fn):
            work = self.copy_bundle(name)
            fn(work)
            cases[name] = lib(VERIFY, str(work))["code"]

        def edit_manifest(work, path):
            manifest = json.loads((work / "bundle.json").read_text())
            manifest["files"].append({"path": path, "sha256": "0" * 64, "mode": "644"})
            manifest["files"].sort(key=lambda f: f["path"].encode())
            manifest["identity"] = M.bundle_identity(manifest)
            manifest["workflow_id"] = M.workflow_id(manifest["version"], manifest["identity"])
            (work / "bundle.json").write_text(json.dumps(manifest))

        mutate("modified", lambda w: (w / "claude/skills/feature-plan/SKILL.md").write_text("tampered\n"))
        mutate("missing", lambda w: (w / "codex/workflow/README.md").unlink())
        mutate("extra", lambda w: (w / "claude/skills/feature-plan/extra.md").write_text("x\n"))
        mutate("symlink-file", lambda w: ((w / "claude/workflow/README.md").unlink(), os.symlink("/etc/hostname", w / "claude/workflow/README.md")))
        mutate("symlink-dir", lambda w: (shutil.rmtree(w / "codex/skills/feature-plan"), os.symlink(w / "claude/skills/feature-plan", w / "codex/skills/feature-plan")))
        mutate("traversal", lambda w: edit_manifest(w, "claude/../../outside.md"))
        mutate("recursive", lambda w: edit_manifest(w, "claude/bundle/bundle.json"))
        mutate("runtime-owned", lambda w: edit_manifest(w, "claude/skills/using-bridge/SKILL.md"))
        mutate("absolute", lambda w: edit_manifest(w, "/etc/passwd"))
        mutate("manifest-edited", lambda w: (w / "bundle.json").write_text((w / "bundle.json").read_text().replace('"binding_contract": 1', '"binding_contract": 2')))
        mutate("not-json", lambda w: (w / "bundle.json").write_text("{"))
        mutate("exec-bit-lost", lambda w: (w / "claude/scripts/workflow.mjs").chmod(0o644))
        self.assertEqual(cases, {
            "modified": "BUNDLE_CORRUPT", "missing": "BUNDLE_INCOMPLETE", "extra": "BUNDLE_EXTRA_FILES",
            "symlink-file": "BUNDLE_SYMLINK", "symlink-dir": "BUNDLE_SYMLINK", "traversal": "BUNDLE_PATH_UNSAFE",
            "recursive": "BUNDLE_RECURSIVE", "runtime-owned": "BUNDLE_RUNTIME_OWNED", "absolute": "BUNDLE_PATH_UNSAFE",
            "manifest-edited": "BUNDLE_CORRUPT", "not-json": "BUNDLE_CORRUPT", "exec-bit-lost": "BUNDLE_CORRUPT",
        })
        self.assertEqual(lib(VERIFY, str(self.bundle), "sha256:" + "0" * 64)["code"], "BUNDLE_IDENTITY_MISMATCH")
        self.assertEqual(lib(VERIFY, str(self.root / "absent"))["code"], "BUNDLE_MISSING")
        # A damaged source is refused before anything reaches the store.
        self.assertEqual(self.publish(self.root / "work" / "modified")["result"], "BUNDLE_CORRUPT")
        self.assertFalse(self.store.exists() and any(self.store.iterdir()))

    def test_an_interrupted_publication_is_invisible_and_retry_publishes(self):
        crashed = self.publish(failAfter="copy")
        self.assertEqual(crashed["result"], "CRASHED")
        self.assertEqual(self.entry()["state"], "missing")
        self.assertTrue(all(p.name.startswith(".staging-") for p in self.store.iterdir()))
        swept = lib("process.stdout.write(JSON.stringify(W.sweepStaging(argv[0])));", str(self.store))
        self.assertEqual((len(swept["removed"]), swept["skipped"]), (1, []))
        self.assertEqual(self.publish()["result"], "PUBLISHED")

    def test_another_valid_bundle_under_the_same_name_is_never_overwritten(self):
        other = self.root / "other-bundle"
        src = self.source_copy()
        with (src / ".agents/skills/feature-plan/SKILL.md").open("a") as handle:
            handle.write("\nother content\n")
        self.assertEqual(self.generate(src, "--component", "workflow").returncode, 0)
        shutil.copytree(src / "plugins/feature-workflow-claude/bundle", other)
        self.store.mkdir(parents=True)
        shutil.copytree(other, self.store / self.workflow_id)  # misplaced/prefix-collision entry
        before = tree(self.store)
        self.assertEqual(self.publish()["result"], "STORE_ID_COLLISION")
        code, answer = self.helper(HELPER, "restore", "--identity", self.identity, "--from", str(PLUGINS["claude"]))
        self.assertEqual((code, answer["code"]), (3, "STORE_ID_COLLISION"))
        self.assertEqual(tree(self.store), before)

    def test_restore_quarantines_a_damaged_entry_and_publishes_the_exact_identity(self):
        """R19-C04: no repair in place; the damaged bytes are preserved with a reason."""
        self.assertEqual(self.publish()["result"], "PUBLISHED")
        target = self.store / self.workflow_id
        damaged = target / "claude/skills/feature-plan/SKILL.md"
        damaged.parent.chmod(0o755)
        damaged.chmod(0o644)
        damaged.write_text("tampered on disk\n")
        damaged.chmod(0o444)
        damaged.parent.chmod(0o555)
        self.assertEqual(self.entry()["code"], "BUNDLE_CORRUPT")
        self.assertEqual(self.publish()["result"], "STORE_ENTRY_CORRUPT")  # publication does not repair
        wrong = self.root / "wrong"
        shutil.copytree(PLUGINS["codex"], wrong)
        (wrong / "bundle/claude/workflow/README.md").write_text("other\n")
        code, answer = self.helper(HELPER, "restore", "--identity", self.identity, "--from", str(wrong))
        self.assertEqual((code, answer["code"]), (3, "BUNDLE_CORRUPT"))  # a damaged source is refused first
        self.assertEqual(damaged.read_text(), "tampered on disk\n")
        code, answer = self.helper(HELPER, "restore", "--identity", self.identity, "--from", str(PLUGINS["codex"]))
        self.assertEqual((code, answer["result"]), (0, "RESTORED"), answer)
        quarantine = self.store / answer["quarantined"]["name"]
        self.assertTrue(quarantine.name.startswith(f".quarantine-{self.workflow_id}-"))
        self.assertEqual((quarantine / "claude/skills/feature-plan/SKILL.md").read_text(), "tampered on disk\n")
        sidecar = json.loads(Path(f"{quarantine}.json").read_text())
        self.assertEqual((sidecar["reason"], sidecar["identity"]), ("BUNDLE_CORRUPT", self.identity))
        self.assertEqual(self.entry()["state"], "verified")
        self.assertEqual(tree(target), tree(self.bundle))
        code, answer = self.helper(HELPER, "restore", "--identity", self.identity, "--from", str(PLUGINS["codex"]))
        self.assertEqual(answer["result"], "ALREADY_PRESENT")

    def test_restore_of_a_missing_entry_and_refusal_of_another_identity(self):
        code, answer = self.helper(HELPER, "restore", "--identity", "sha256:" + "1" * 64, "--from", str(PLUGINS["codex"]))
        self.assertEqual((code, answer["code"]), (3, "BUNDLE_IDENTITY_MISMATCH"))
        self.assertFalse(self.store.exists())
        code, answer = self.helper(HELPER, "restore", "--identity", self.identity, "--from", str(PLUGINS["codex"]))
        self.assertEqual((code, answer["result"], answer["quarantined"]), (0, "RESTORED", None))

    def test_restore_from_a_local_source_commit_regenerates_the_same_identity(self):
        src = self.source_copy()
        git(src, "init", "-q", "-b", "main")
        git(src, "add", "-A")
        git(src, "commit", "-qm", "synthetic source")
        commit = git(src, "rev-parse", "HEAD")
        code, answer = self.helper(HELPER, "restore", "--identity", self.identity, "--source", str(src), "--commit", commit)
        self.assertEqual((code, answer.get("result")), (0, "RESTORED"), answer)
        code, answer = self.helper(HELPER, "restore", "--identity", self.identity, "--source", "https://example.invalid/x.git", "--commit", commit)
        self.assertEqual((code, answer["code"]), (3, "RESTORE_SOURCE_UNSUPPORTED"))


class Helper(Workspace):
    """§ 4: begin before the brief, draft → id, resolve, explicit adopt and standalone switch."""

    def fake_runtime(self, runtime_id: str, *, binding: bool) -> Path:
        path = self.home / "runtimes" / runtime_id
        (path / "scripts/bridge-project").mkdir(parents=True)
        (path / ".agents/skills").mkdir(parents=True)
        compat = {"state_schema_version": 7 if binding else 6}
        if binding:
            compat["workflow_binding"] = {"contracts": [1], "capabilities": ["feature.lifecycle/v1", "feature.close/v1", "round.recovery/v1", "round.report/v1", "workflow.binding/v1"]}
        # The instruction-set digest of the real 0.7.0 runtime for that id; any other id gets a
        # synthetic one. The resolver confirms proven ledger evidence against it (R19-I04).
        set_sha = "8c05792ad75e7550eddc00c4ef26eb1c7096951e2be384508321e39bfb78a4ed" if runtime_id == "0.7.0-6ed9a4537e37" else hashlib.sha256(runtime_id.encode()).hexdigest()
        (path / "runtime-manifest.json").write_text(json.dumps({"format": "claude-codex-bridge.runtime/v1", "runtime_id": runtime_id, "package_version": runtime_id.split("-")[0],
                                                                "compatibility": compat, "instructions": {"set_sha256": set_sha, "files": []}}))
        (path / "scripts/bridge-project/locate.mjs").write_text(
            "export function status(cwd, env) { return { home: env.CLAUDE_CODEX_BRIDGE_HOME, state: 'ready', runtime: { commit: '" + "0" * 40 + "' },\n"
            f"  instructions: {{ workflow_skills: {json.dumps(str(path / '.agents/skills'))}, set_sha256: 'synthetic' }}, next_step: null }}; }}\n"
            "export function instructionPaths() { return {}; }\n")
        return path

    def pin(self, project: Path, runtime_id: str) -> None:
        (project / ".bridge-project").mkdir()
        (project / ".bridge-project/bridge.json").write_text(json.dumps({"format": "claude-codex-bridge.project/v1", "enabled": True, "pinned": {"runtime_id": runtime_id, "commit": "0" * 40}}))

    def files(self, *roots: Path) -> dict:
        out = {}
        for root in roots:
            if root.exists():
                out.update({str(p): (sha(p) if p.is_file() else "<dir>") for p in root.rglob("*") if ".git" not in p.relative_to(root).parts})
        return out

    def test_standalone_lifecycle_begin_finalize_resolve(self):
        project = self.project()
        plugin = self.plugin_copy("codex")
        script = plugin / "scripts/workflow.mjs"
        before = self.files(project, self.home)
        code, answer = self.helper(script, "resolve", "--new", cwd=project)
        self.assertEqual((code, answer["code"], answer["project"]["pin"]), (3, "SELECTION_REQUIRED", "none"))
        self.assertEqual(self.files(project, self.home), before)  # resolve is a pure read
        code, begun = self.helper(script, "begin", cwd=project)
        self.assertEqual((code, begun["code"], begun["store"]), (0, "BEGUN", "PUBLISHED"))
        token = begun["draft_token"]
        lock = json.loads((project / f"docs/features/.draft-{token}/workflow.lock.json").read_text())
        M.validate_lock(lock)  # the reference model accepts the Node-written lock
        self.assertEqual((lock["origin"]["kind"], lock["origin"]["client"], lock["feature"]), ("active-plugin", "codex", {"feature_id": None, "draft_token": token}))
        self.assertNotIn(str(self.root), json.dumps(lock))
        # The plugin cache disappears (update/uninstall); the store keeps the feature working offline.
        rmtree(self.root / "cache")
        code, answer = self.helper(HELPER, "resolve", "--feature", f"docs/features/.draft-{token}", "--entry", "feature-plan", "--package-root", str(self.store / lock["workflow"]["workflow_id"] / "codex"), cwd=project)
        self.assertEqual((code, answer["source"], answer["code"]), (0, "bundle", "BOUND_BUNDLE"), answer)
        self.assertEqual(Path(answer["instructions"]["workflow_skills"]), self.store / lock["workflow"]["workflow_id"] / "codex" / "skills")
        self.assertEqual(answer["record"], f"INSTRUCTIONS=bundle:{lock['workflow']['workflow_id']} IDENTITY={lock['workflow']['identity']} GENERATION=1")
        stored = self.store / lock["workflow"]["workflow_id"] / "codex/scripts/workflow.mjs"
        code, answer = self.helper(stored, "resolve", "--feature", f"docs/features/.draft-{token}", "--entry", "feature-nonexistent", cwd=project)
        self.assertEqual((code, answer["code"]), (3, "ENTRY_NOT_IN_BUNDLE"))
        code, answer = self.helper(stored, "finalize", "--draft", token, "--feature-id", "F-001-search", cwd=project)
        self.assertEqual(answer["result"], "FINALIZED")
        code, answer = self.helper(stored, "finalize", "--draft", token, "--feature-id", "F-001-search", cwd=project)
        self.assertEqual(answer["result"], "ALREADY_FINAL")
        code, answer = self.helper(stored, "resolve", "--feature", "F-001-search", cwd=project)
        self.assertEqual((code, answer["code"], answer["feature"]["feature_id"]), (0, "BOUND_BUNDLE", "F-001-search"))

    def test_begin_with_an_id_draft_collision_and_lock_never_replaced(self):
        project = self.project()
        script = self.plugin_copy("claude") / "scripts/workflow.mjs"
        code, answer = self.helper(script, "begin", "--feature-id", "F-002-x", cwd=project)
        self.assertEqual((code, answer["code"], answer["lock"]["feature"]["feature_id"]), (0, "BEGUN", "F-002-x"))
        lock_bytes = (project / "docs/features/F-002-x/workflow.lock.json").read_bytes()
        code, answer = self.helper(script, "begin", "--feature-id", "F-002-x", cwd=project)
        self.assertEqual((code, answer["code"]), (3, "LOCK_EXISTS"))
        code, draft = self.helper(script, "begin", cwd=project)
        code, answer = self.helper(script, "finalize", "--draft", draft["draft_token"], "--feature-id", "F-002-x", cwd=project)
        self.assertEqual((code, answer["code"]), (3, "FEATURE_DIR_COLLISION"))
        self.assertEqual((project / "docs/features/F-002-x/workflow.lock.json").read_bytes(), lock_bytes)

    def test_draft_finalize_resumes_after_each_crash_point(self):
        project = self.project()
        script = self.plugin_copy("claude") / "scripts/workflow.mjs"
        for point in ("mark", "move"):
            with self.subTest(point=point):
                _, draft = self.helper(script, "begin", cwd=project)
                token = draft["draft_token"]
                target = f"F-crash-{point}"
                (project / "docs/features" / target).mkdir()
                (project / "docs/features" / target / "brief.md").write_text("synthetic brief\n")
                crashed = lib("process.stdout.write(JSON.stringify(W.finalizeDraft(argv[0], argv[1], argv[2], {failAfter: argv[3]})));",
                              str(project / "docs/features"), token, target, point)
                self.assertEqual(crashed["result"], "CRASHED")
                _, answer = self.helper(script, "finalize", "--draft", token, "--feature-id", target, cwd=project)
                self.assertIn(answer["result"], {"FINALIZED", "ALREADY_FINAL"})
                self.assertFalse((project / f"docs/features/.draft-{token}").exists())
                final = json.loads((project / "docs/features" / target / "workflow.lock.json").read_text())
                self.assertEqual(final["feature"], {"feature_id": target, "draft_token": token})
                self.assertEqual((project / "docs/features" / target / "brief.md").read_text(), "synthetic brief\n")

    def test_standalone_switch_and_explicit_adopt(self):
        project = self.project()
        script = self.plugin_copy("claude") / "scripts/workflow.mjs"
        _, begun = self.helper(script, "begin", "--feature-id", "F-003-y", cwd=project)
        src = self.source_copy()
        with (src / ".agents/skills/feature-plan/SKILL.md").open("a") as handle:
            handle.write("\nworkflow B\n")
        release = json.loads((src / "scripts/workflow-source/release.json").read_text())
        release["version"] = "1.0.1"
        (src / "scripts/workflow-source/release.json").write_text(json.dumps(release))
        self.assertEqual(self.generate(src, "--component", "workflow").returncode, 0)
        plugin_b = src / "plugins/feature-workflow-claude"
        identity_b = json.loads((plugin_b / "bundle/bundle.json").read_text())["identity"]
        code, answer = self.helper(script, "switch", "--feature", "F-003-y", "--to", identity_b, "--expected-generation", "0", "--from", str(plugin_b), cwd=project)
        self.assertEqual((code, answer["code"]), (3, "WORKFLOW_GENERATION_CONFLICT"))
        code, answer = self.helper(script, "switch", "--feature", "F-003-y", "--to", identity_b, "--expected-generation", "1", "--from", str(plugin_b), cwd=project)
        self.assertEqual((code, answer["code"], answer["generation"]), (0, "SWITCHED", 2), answer)
        lock = M.validate_lock(json.loads((project / "docs/features/F-003-y/workflow.lock.json").read_text())) or json.loads((project / "docs/features/F-003-y/workflow.lock.json").read_text())
        self.assertEqual([h["op"] for h in lock["history"]], ["begin", "switch"])
        self.assertEqual(lock["history"][0]["identity"], begun["lock"]["workflow"]["identity"])
        code, answer = self.helper(script, "switch", "--feature", "F-003-y", "--to", identity_b, "--expected-generation", "1", cwd=project)
        self.assertEqual((code, answer["code"]), (3, "WORKFLOW_GENERATION_CONFLICT"))  # replay of a stale request
        (project / "docs/features/F-old").mkdir(parents=True)
        (project / "docs/features/F-old/brief.md").write_text("existing feature\n")
        code, answer = self.helper(script, "resolve", "--feature", "F-old", cwd=project)
        self.assertEqual((code, answer["code"]), (3, "SELECTION_REQUIRED"))
        code, answer = self.helper(script, "adopt", "--feature", "F-old", cwd=project)
        self.assertEqual((code, answer["code"]), (3, "EXPLICIT_CHOICE_REQUIRED"))
        self.assertFalse((project / "docs/features/F-old/workflow.lock.json").exists())
        code, answer = self.helper(script, "adopt", "--feature", "F-old", "--explicit", cwd=project)
        self.assertEqual((code, answer["code"], answer["lock"]["origin"]["kind"]), (0, "ADOPTED", "adopt"))

    def test_new_plugin_with_an_old_pin_keeps_old_features_and_refuses_new_ones(self):
        """Contract § 10.4 / AC-07: the separate old-pin branch, nothing created, nothing adopted."""
        self.fake_runtime("0.7.0-6ed9a4537e37", binding=False)
        project = self.project()
        self.pin(project, "0.7.0-6ed9a4537e37")
        (project / "docs/features/F-legacy").mkdir(parents=True)
        (project / "docs/features/F-legacy/brief.md").write_text("pre-binding feature\n")
        script = self.plugin_copy("codex") / "scripts/workflow.mjs"
        before = self.files(project, self.home)
        code, answer = self.helper(script, "resolve", "--feature", "F-legacy", cwd=project)
        self.assertEqual((code, answer["source"], answer["code"]), (0, "runtime", "LEGACY_PINNED_RUNTIME"), answer)
        self.assertTrue(answer["record"].startswith("INSTRUCTIONS=runtime:0.7.0-6ed9a4537e37"))
        code, answer = self.helper(script, "resolve", "--new", cwd=project)
        self.assertEqual((code, answer["code"]), (3, "RUNTIME_WITHOUT_BINDING"))
        code, answer = self.helper(script, "begin", cwd=project)
        self.assertEqual((code, answer["code"]), (3, "RUNTIME_WITHOUT_BINDING"))
        code, answer = self.helper(script, "switch", "--feature", "F-legacy", "--to", "sha256:" + "0" * 64, "--expected-generation", "1", cwd=project)
        self.assertEqual((code, answer["code"]), (3, "SWITCH_REQUIRES_BRIDGE"))
        code, answer = self.helper(script, "begin", "--standalone", cwd=project)
        self.assertEqual((code, answer["code"]), (3, "RUNTIME_WITHOUT_BINDING"))  # a serving pin is not waived
        self.assertEqual(self.files(project, self.home), before)

    def test_binding_runtime_legacy_evidence_and_compatibility(self):
        self.fake_runtime("0.8.0-aaaaaaaaaaaa", binding=True)
        self.fake_runtime("0.7.0-6ed9a4537e37", binding=False)
        project = self.project()
        self.pin(project, "0.8.0-aaaaaaaaaaaa")
        script = self.plugin_copy("codex") / "scripts/workflow.mjs"
        code, answer = self.helper(script, "resolve", "--new", cwd=project)
        self.assertEqual((code, answer["code"], answer["project"]["workflow_binding"]), (3, "SELECTION_REQUIRED", True))
        cases = {
            "F-proven": ["INSTRUCTIONS=runtime:0.7.0-6ed9a4537e37 SET=8c05792ad75e"],
            "F-ambiguous": ["INSTRUCTIONS=runtime:0.7.0-6ed9a4537e37 SET=aaaa", "INSTRUCTIONS=runtime:0.6.2-771e797a73d3 SET=bbbb"],
            "F-unproven": [],
            "F-missing": ["INSTRUCTIONS=runtime:0.6.2-771e797a73d3 SET=cccc"],
        }
        for name, records in cases.items():
            ledger = project / "docs/features" / name / "execution/W-01"
            ledger.mkdir(parents=True)
            (ledger / "01.md").write_text("\n".join(f"Record: `{r}`" for r in records) + "\n")
        expected = {"F-proven": "LEGACY_BIND_REQUIRED", "F-ambiguous": "LEGACY_AMBIGUOUS", "F-unproven": "LEGACY_UNPROVEN", "F-missing": "LEGACY_SOURCE_MISSING"}
        self.assertEqual({n: self.helper(script, "resolve", "--feature", n, cwd=project)[1]["code"] for n in cases}, expected)
        # A runtime that lacks a required capability blocks dependent work before anything is written.
        manifest = self.home / "runtimes/0.8.0-aaaaaaaaaaaa/runtime-manifest.json"
        data = json.loads(manifest.read_text())
        data["compatibility"]["workflow_binding"]["capabilities"].remove("feature.close/v1")
        manifest.write_text(json.dumps(data))
        code, answer = self.helper(script, "begin", cwd=project)
        self.assertEqual((code, answer["code"]), (3, "WORKFLOW_INCOMPATIBLE"))
        self.assertEqual(answer["resolve"]["problems"][0], {"code": "CAPABILITY_MISSING", "missing": ["feature.close/v1"]})
        self.assertFalse(self.store.exists())


class ManagedPaths(Workspace):
    """R19-I01: bounded feature ids and no redirected managed write path, refused before any side effect."""

    def setUp(self):
        super().setUp()
        self.external = self.root / "external"
        (self.external / "keep").mkdir(parents=True)
        (self.external / "keep" / "data.txt").write_text("unrelated data\n")
        self.script = self.plugin_copy("claude") / "scripts/workflow.mjs"

    def snapshot(self) -> dict:
        return {str(p.relative_to(self.root)): (sha(p) if p.is_file() and not p.is_symlink() else ("<link>" if p.is_symlink() else "<dir>"))
                for p in sorted(self.root.rglob("*")) if "cache" not in p.relative_to(self.root).parts and ".git" not in p.parts}

    def refused(self, project: Path, *args: str) -> str:
        before = self.snapshot()
        code, answer = self.helper(self.script, *args, cwd=project)
        self.assertEqual(code, 3, answer)
        self.assertEqual(self.snapshot(), before, f"{args} changed the filesystem")
        return answer["code"]

    def test_symlinked_features_root_is_refused_for_every_operation(self):
        project = self.project()
        (project / "docs").mkdir()
        os.symlink(self.external, project / "docs/features")
        (self.external / "F-x").mkdir()
        (self.external / ".draft-0badf00d").mkdir()
        for args in (("begin", "--feature-id", "F-test"), ("begin",), ("adopt", "--feature", "F-x", "--explicit"),
                     ("resolve", "--feature", "F-x"), ("switch", "--feature", "F-x", "--to", "sha256:" + "0" * 64, "--expected-generation", "1"),
                     ("finalize", "--draft", "0badf00d", "--feature-id", "F-final")):
            with self.subTest(args=args):
                self.assertEqual(self.refused(project, *args), "PATH_REDIRECTED")
        self.assertFalse(self.store.exists())  # refused before the store was touched

    def test_symlinked_docs_and_feature_directories_are_refused(self):
        project = self.project()
        os.symlink(self.external, project / "docs")
        self.assertEqual(self.refused(project, "begin", "--feature-id", "F-a"), "PATH_REDIRECTED")
        os.unlink(project / "docs")
        (project / "docs/features").mkdir(parents=True)
        os.symlink(self.external / "keep", project / "docs/features/F-link")
        for args in (("begin", "--feature-id", "F-link"), ("adopt", "--feature", "F-link", "--explicit"), ("resolve", "--feature", "F-link"),
                     ("resolve", "--feature", "docs/features/F-link")):
            with self.subTest(args=args):
                self.assertEqual(self.refused(project, *args), "PATH_REDIRECTED")

    def test_a_symlinked_lock_is_never_written_through(self):
        project = self.project()
        (project / "docs/features/F-lock").mkdir(parents=True)
        os.symlink(self.external / "keep" / "data.txt", project / "docs/features/F-lock/workflow.lock.json")
        self.assertEqual(self.refused(project, "adopt", "--feature", "F-lock", "--explicit"), "LOCK_INVALID")
        self.assertEqual(self.refused(project, "begin", "--feature-id", "F-lock"), "LOCK_INVALID")
        self.assertEqual((self.external / "keep" / "data.txt").read_text(), "unrelated data\n")

    def test_feature_ids_and_paths_are_bounded(self):
        project = self.project()
        for bad in ("../../../outside", "..", "a/b", "/abs/path", ".hidden", "a..b", "x" * 200, "", "-lead", "F x"):
            with self.subTest(begin=bad):
                self.assertEqual(self.refused(project, "begin", "--feature-id", bad), "FEATURE_ID_INVALID")
        _, draft = self.helper(self.script, "begin", cwd=project)
        for bad in ("../outside", "..", "a/b", ".draft-0badf00d"):
            with self.subTest(finalize=bad):
                self.assertEqual(self.refused(project, "finalize", "--draft", draft["draft_token"], "--feature-id", bad), "FEATURE_ID_INVALID")
        for bad in ("../../outside", str(self.external), "docs/F-x", "docs/features/F-x/sub"):
            with self.subTest(feature=bad):
                self.assertEqual(self.refused(project, "resolve", "--feature", bad), "FEATURE_PATH_OUTSIDE")
        self.assertFalse(any(self.root.glob("outside*")))

    def test_redirected_store_entries_and_staging_are_refused(self):
        project = self.project()
        (self.home).mkdir()
        os.symlink(self.external, self.store)
        for args in (("begin",), ("restore", "--identity", "sha256:" + "0" * 64, "--from", str(PLUGINS["claude"])), ("sweep-staging",),
                     ("verify", "--identity", "sha256:" + "0" * 64)):
            with self.subTest(args=args):
                self.assertEqual(self.refused(project, *args), "PATH_REDIRECTED")
        self.assertFalse((project / "docs").exists())  # begin refused before creating the draft
        os.unlink(self.store)
        self.store.mkdir()
        manifest = json.loads((PLUGINS["claude"] / "bundle/bundle.json").read_text())
        shutil.copytree(PLUGINS["claude"] / "bundle", self.external / "bundle-copy")
        os.symlink(self.external / "bundle-copy", self.store / manifest["workflow_id"])
        os.symlink(self.external / "keep", self.store / ".staging-evil")
        before = self.snapshot()
        code, answer = self.helper(HELPER, "restore", "--identity", manifest["identity"], "--from", str(PLUGINS["claude"]))
        self.assertEqual((code, answer["code"]), (3, "PATH_REDIRECTED"))
        code, answer = self.helper(HELPER, "sweep-staging")
        self.assertEqual((code, answer["removed"], answer["skipped"]), (0, [], [".staging-evil"]))
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(lib("try { W.storePublish(argv[0], argv[1]); process.stdout.write('\"PUBLISHED\"'); } catch (e) { process.stdout.write(JSON.stringify(e.code)); }",
                             str(self.store), str(PLUGINS["claude"] / "bundle")), "BUNDLE_SYMLINK")
        self.assertEqual(self.snapshot(), before)

    def test_links_above_the_trust_anchors_are_allowed(self):
        """An external bridge home and a project reached through a linked parent (macOS /tmp) work."""
        real_home = self.root / "real-home"
        real_home.mkdir()
        os.symlink(real_home, self.home)  # explicit home given through a link: allowed by design
        real_parent = self.root / "private"
        real_parent.mkdir()
        project = real_parent / "proj"
        project.mkdir()
        git(project, "init", "-q", "-b", "main")
        os.symlink(real_parent, self.root / "tmp")
        via_link = self.root / "tmp" / "proj"
        code, begun = self.helper(self.script, "begin", "--feature-id", "F-ok", cwd=via_link)
        self.assertEqual((code, begun["code"]), (0, "BEGUN"), begun)
        self.assertTrue((project / "docs/features/F-ok/workflow.lock.json").is_file())
        self.assertTrue((real_home / "workflows" / begun["lock"]["workflow"]["workflow_id"]).is_dir())
        for feature in ("F-ok", str(via_link / "docs/features/F-ok"), str(project / "docs/features/F-ok"), "docs/features/F-ok"):
            with self.subTest(feature=feature):
                code, answer = self.helper(self.script, "resolve", "--feature", feature, cwd=via_link)
                self.assertEqual((code, answer["code"]), (0, "BOUND_BUNDLE"), answer)


class ReferenceModelAgreement(Workspace):
    """The Node library and the W19-01 Python reference model give the same verdicts."""

    def test_identity_verification_and_compatibility_agree(self):
        variants = F.variants("1.0.0")
        a = M.build_bundle(self.root / "A", version="1.0.0", requires=F.REQUIRES, variants=variants, source=F.SOURCE)
        self.assertEqual(lib(VERIFY, str(self.root / "A"))["identity"], a["identity"])
        fixture = json.loads((REPO_ROOT / "tools/pilot/workflow-versioning/fixtures/examples/bundle-A.json").read_text())
        self.assertEqual(lib("process.stdout.write(JSON.stringify(W.bundleIdentity(JSON.parse(argv[0]))));", json.dumps(fixture)), fixture["identity"])
        for kind in ("modified", "missing", "extra", "symlink"):
            work = self.root / f"neg-{kind}"
            shutil.copytree(self.root / "A", work)
            if kind == "modified":
                (work / "claude/skills/feature-plan/SKILL.md").write_text("x\n")
            elif kind == "missing":
                (work / "codex/workflow/README.md").unlink()
            elif kind == "extra":
                (work / "codex/extra.md").write_text("x\n")
            else:
                (work / "claude/workflow/README.md").unlink()
                os.symlink("/etc/hostname", work / "claude/workflow/README.md")
            try:
                M.verify_bundle(work)
                model = "OK"
            except M.ContractError as exc:
                model = exc.code
            self.assertEqual(lib(VERIFY, str(work))["code"], model, kind)
        for runtime in (F.RUNTIME_BINDING, F.RUNTIME_OLD, F.RUNTIME_NO_CLOSE, F.RUNTIME_CONTRACT2):
            for mode in ("bridge", "standalone"):
                node = lib("process.stdout.write(JSON.stringify(W.checkCompatibility(JSON.parse(argv[0]), JSON.parse(argv[1]), {mode: argv[2]})));",
                           json.dumps(F.REQUIRES), json.dumps(runtime), mode)
                self.assertEqual(node, M.check_compatibility(F.REQUIRES, runtime, mode=mode), (runtime, mode))
        for name in ("lock-begin.json", "lock-final-after-switch.json"):
            text = (REPO_ROOT / "tools/pilot/workflow-versioning/fixtures/examples" / name).read_text()
            self.assertEqual(lib("W.validateLock(JSON.parse(argv[0])); process.stdout.write('true');", text), True)
        bad = json.loads((REPO_ROOT / "tools/pilot/workflow-versioning/fixtures/examples/lock-begin.json").read_text())
        bad["origin"]["session_id"] = "x"
        self.assertEqual(lib("try { W.validateLock(JSON.parse(argv[0])); process.stdout.write('\"VALID\"'); } catch (e) { process.stdout.write(JSON.stringify(e.code)); }", json.dumps(bad)), "LOCK_INVALID")


if __name__ == "__main__":
    unittest.main()
