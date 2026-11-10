"""The trial entry must refuse selection drift before any installation or restore."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[1]
FEATURE = "docs/features/F-W21-repo-trial"


class TrialPrepareTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="hcom-prepare-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "checkout"
        self.root.mkdir()
        # Real bundle/reader; no hcom, account, installed runtime or model required.
        for directory in ("scripts/setup", "plugins/feature-workflow-codex"):
            shutil.copytree(REPO / directory, self.root / directory)
        for name in ("scripts/prepare-hcom-trial.mjs", ".bridge-project/bridge.json",
                     "scripts/plugin-packages/release.json", f"{FEATURE}/workflow.lock.json",
                     f"{FEATURE}/feature.json"):
            dest = self.root / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(REPO / name, dest)
        self.store = Path(self.temp.name) / "private-store"

    def change(self, name, change):
        path = self.root / name
        value = json.loads(path.read_text())
        change(value)
        path.write_text(json.dumps(value))

    def refuse(self, expected, cwd=None):
        before = {str(p.relative_to(self.root)): p.read_bytes()
                  for p in self.root.rglob("*") if p.is_file()}
        result = subprocess.run(
            ["node", str(self.root / "scripts/prepare-hcom-trial.mjs")],
            cwd=cwd or self.root, capture_output=True, text=True,
            env={**os.environ, "CLAUDE_CODEX_BRIDGE_HOME": str(self.store)}, timeout=30)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn(expected, result.stderr)
        self.assertFalse(self.store.exists(), "refusal must precede installation/restore")
        after = {str(p.relative_to(self.root)): p.read_bytes()
                 for p in self.root.rglob("*") if p.is_file()}
        self.assertEqual(before, after)

    def test_wrong_worktree_does_not_prepare_script_checkout(self):
        self.refuse("from this worktree root", cwd=self.root.parent)

    def test_disabled_project_is_not_silently_reenabled(self):
        self.change(".bridge-project/bridge.json", lambda x: x.update(enabled=False))
        self.refuse("Project pin differs")

    def test_changed_transport_is_not_silently_reselected(self):
        self.change(f"{FEATURE}/feature.json", lambda x: x["execution"].update(transport="bridge"))
        self.refuse("Trial identity or transport differs")

    def test_lock_mismatch_does_not_install_or_switch(self):
        self.change(f"{FEATURE}/workflow.lock.json",
                    lambda x: x["workflow"].update(identity="sha256:" + "0" * 64))
        self.refuse("Committed lock does not match")


if __name__ == "__main__":
    unittest.main()
