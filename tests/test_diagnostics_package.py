"""The diagnostics package is a real ZIP, not one this repository can only read itself.

`scripts/diagnostics/zip.mjs` writes stored entries by hand, so the only honest proof that a
package can be opened by whoever receives it is opening one with an independent implementation.
This test writes a package with the Node writer and reads it back with Python's `zipfile`.
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
WRITER = REPO / "scripts" / "diagnostics" / "zip.mjs"


class DiagnosticsPackageFormat(unittest.TestCase):
    def test_node_written_package_is_readable_by_zipfile(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "package.zip"
            entries = {
                "diagnostics-manifest.json": json.dumps({"format": "claude-codex-bridge.diagnostics/v1"}),
                "records/events.json": "[]\n",
                "timeline.md": "# Incident timeline\n\nunicode: zażółć gęślą jaźń\n",
            }
            script = (
                "const { writeZip } = await import(process.argv[1]);"
                "const entries = JSON.parse(process.argv[3]);"
                "const written = writeZip(process.argv[2],"
                " Object.entries(entries).map(([name, data]) => ({ name, data })));"
                "process.stdout.write(JSON.stringify(written));"
            )
            result = subprocess.run(
                ["node", "--input-type=module", "-e", script, str(WRITER), str(archive), json.dumps(entries)],
                capture_output=True,
                text=True,
                timeout=60,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            written = json.loads(result.stdout)

            self.assertEqual(archive.stat().st_size, written["bytes"])
            self.assertEqual(oct(archive.stat().st_mode & 0o777), oct(0o600))

            with zipfile.ZipFile(archive) as package:
                self.assertIsNone(package.testzip(), "every entry must pass its CRC")
                self.assertEqual(sorted(package.namelist()), sorted(entries))
                for name, content in entries.items():
                    self.assertEqual(package.read(name).decode("utf-8"), content)
                for info in package.infolist():
                    self.assertEqual(info.compress_type, zipfile.ZIP_STORED)
                    self.assertFalse(info.is_dir())
                    self.assertFalse(name.startswith("/"))

    def test_unsafe_entry_names_are_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "unsafe.zip"
            script = (
                "const { writeZip } = await import(process.argv[1]);"
                "try { writeZip(process.argv[2], [{ name: process.argv[3], data: 'x' }]); }"
                "catch (error) { process.stdout.write(error.message); process.exit(3); }"
            )
            for name in ["../escape.json", "/absolute.json", "a/../../b.json"]:
                result = subprocess.run(
                    ["node", "--input-type=module", "-e", script, str(WRITER), str(archive), name],
                    capture_output=True,
                    text=True,
                    timeout=60,
                )
                self.assertEqual(result.returncode, 3, f"{name}: {result.stdout} {result.stderr}")
                self.assertIn("unsafe", result.stdout)
                self.assertFalse(archive.exists(), "a refused entry must not leave a package behind")


class ExchangeNamespaceAgreement(unittest.TestCase):
    """The exporter and the exchange tooling must resolve the same namespace.

    `bridge.mjs diagnose` publishes into the worktree's exchange namespace, which
    `feature_exchange.py` also owns. Review R2-02 asked for one canonical resolver rather than a
    second implementation; this checks that the JavaScript one agrees with the Python one on a
    real Git worktree — this repository.
    """

    def test_javascript_and_python_agree_on_this_worktree(self):
        exchange = REPO / ".agents" / "skills" / "feature-exchange" / "scripts" / "feature_exchange.py"
        expected = json.loads(
            subprocess.run(
                [sys.executable, str(exchange), "namespace", "--repo", str(REPO)],
                capture_output=True,
                text=True,
                timeout=60,
                check=True,
            ).stdout
        )
        script = (
            "const { resolveWorkspaceIdentity, exchangeNamespace } = await import(process.argv[1]);"
            "const identity = resolveWorkspaceIdentity(process.argv[2]);"
            "process.stdout.write(JSON.stringify(exchangeNamespace(identity)));"
        )
        control_plane = REPO / "shared" / "control-plane" / "dist" / "index.js"
        if not control_plane.exists():
            self.skipTest("the control plane is not built; run npm run build first")
        actual = subprocess.run(
            ["node", "--input-type=module", "-e", script, str(control_plane), str(REPO)],
            capture_output=True,
            text=True,
            timeout=60,
            env={**os.environ, "HOME": os.environ.get("HOME", "")},
        )
        self.assertEqual(actual.returncode, 0, actual.stderr)
        resolved = json.loads(actual.stdout)
        for key in ("workspace_key", "namespace", "packages", "incoming", "staging"):
            self.assertEqual(resolved[key], expected[key], key)


if __name__ == "__main__":
    unittest.main()
