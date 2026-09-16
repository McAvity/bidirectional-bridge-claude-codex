"""Host-independent checks of the W14-01 probe harness.

These are fixture checks, not host evidence: they verify that the probe
generators produce manifests and layouts matching the documented schemas, that
the isolation guard actually refuses the personal profiles, and that the
model-free assertions reject a run that did spend tokens. Host behaviour is
recorded only by the probes in `scripts/plugin-probes/`.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
PROBE_DIR = REPO_ROOT / "scripts" / "plugin-probes"
sys.path.insert(0, str(PROBE_DIR))

import probe_lib as L  # noqa: E402


class IsolationGuard(unittest.TestCase):
    def test_refuses_personal_codex_home(self):
        with self.assertRaises(SystemExit):
            L.assert_isolated(Path.home() / ".codex")

    def test_refuses_paths_inside_personal_claude_config(self):
        with self.assertRaises(SystemExit):
            L.assert_isolated(Path.home() / ".claude" / "plugins" / "cache")

    def test_allows_a_disposable_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            L.assert_isolated(Path(tmp) / "codex-home")

    def test_codex_env_removes_the_key_that_stops_the_model_request(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = L.codex_env(Path(tmp) / "codex-home")
        self.assertNotIn(L.CODEX_FAKE_KEY_VAR, env)
        self.assertTrue(env["CODEX_HOME"].endswith("codex-home"))


class CodexFixture(unittest.TestCase):
    def build(self, root: Path, **kwargs):
        return L.build_codex_marketplace(
            root,
            marketplace="w14probe",
            plugin="w14-probe",
            version="1.0.0",
            record_path=root / "record.jsonl",
            **kwargs,
        )

    def test_marketplace_manifest_matches_the_documented_shape(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.build(root)
            manifest = json.loads((root / ".agents" / "plugins" / "marketplace.json").read_text())
            self.assertEqual(manifest["name"], "w14probe")
            entry = manifest["plugins"][0]
            self.assertEqual(entry["source"], {"source": "local", "path": "./plugins/w14-probe"})
            self.assertEqual(entry["policy"]["installation"], "AVAILABLE")
            self.assertEqual(entry["policy"]["authentication"], "ON_INSTALL")
            self.assertIn("category", entry)

    def test_plugin_manifest_has_the_required_fields_and_no_placeholders(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.build(root)
            path = root / "plugins" / "w14-probe" / ".codex-plugin" / "plugin.json"
            manifest = json.loads(path.read_text())
            for field in ("name", "version", "description", "author", "interface"):
                self.assertIn(field, manifest)
            for field in ("displayName", "shortDescription", "longDescription", "developerName", "category"):
                self.assertIn(field, manifest["interface"])
            self.assertNotIn("hooks", manifest, "the Codex validator rejects `hooks`")
            self.assertNotIn("[TODO", path.read_text())

    def test_mcp_record_path_is_an_argument_not_an_environment_variable(self):
        # Codex starts plugin MCP servers with a stripped environment, so the
        # probe must not depend on one.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.build(root)
            mcp = json.loads((root / "plugins" / "w14-probe" / ".mcp.json").read_text())
            server = mcp["mcpServers"]["probe"]
            self.assertIn("--record", server["args"])
            self.assertNotIn("env", server)

    def test_env_vars_are_declared_only_when_requested(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.build(root)
            server = json.loads((root / "plugins" / "w14-probe" / ".mcp.json").read_text())["mcpServers"]["probe"]
            self.assertNotIn("env_vars", server)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.build(root, env_vars=["PWD"])
            server = json.loads((root / "plugins" / "w14-probe" / ".mcp.json").read_text())["mcpServers"]["probe"]
            self.assertEqual(server["env_vars"], ["PWD"])

    def test_manifest_omits_mcp_servers_when_no_companion_file_is_written(self):
        manifest = L.codex_plugin_manifest("w14-probe", "1.0.0", mcp=False)
        self.assertNotIn("mcpServers", manifest)


class ClaudeFixture(unittest.TestCase):
    def test_plugin_uses_the_documented_layout_and_plugin_root_variable(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "w14-probe"
            L.build_claude_plugin(root, plugin="w14-probe", version="1.0.0", record_path=Path(tmp) / "r.jsonl")
            manifest = json.loads((root / ".claude-plugin" / "plugin.json").read_text())
            self.assertEqual(manifest["name"], "w14-probe")
            self.assertTrue((root / "skills" / "probe-skill" / "SKILL.md").is_file())
            server = json.loads((root / ".mcp.json").read_text())["mcpServers"]["probe"]
            self.assertTrue(server["args"][0].startswith("${CLAUDE_PLUGIN_ROOT}"))

    def test_skill_frontmatter_carries_a_name_and_description(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "w14-probe"
            L.build_claude_plugin(root, plugin="w14-probe", version="2.0.0", record_path=None)
            text = (root / "skills" / "probe-skill" / "SKILL.md").read_text()
            self.assertTrue(text.startswith("---\n"))
            self.assertIn("name: probe-skill", text)
            self.assertIn("description:", text)
            self.assertIn("version:2.0.0", text)


class ModelFreeAssertions(unittest.TestCase):
    def test_claude_spent_nothing_accepts_a_stub_rejected_run(self):
        self.assertTrue(
            L.claude_spent_nothing(
                {
                    "total_cost_usd": 0,
                    "api_error_status": 400,
                    "usage": {"input_tokens": 0, "output_tokens": 0},
                }
            )
        )

    def test_claude_spent_nothing_rejects_a_run_that_used_tokens(self):
        self.assertFalse(
            L.claude_spent_nothing(
                {
                    "total_cost_usd": 0,
                    "api_error_status": 400,
                    "usage": {"input_tokens": 12, "output_tokens": 0},
                }
            )
        )

    def test_claude_spent_nothing_rejects_a_successful_call(self):
        self.assertFalse(
            L.claude_spent_nothing(
                {"total_cost_usd": 0.01, "usage": {"input_tokens": 0, "output_tokens": 0}}
            )
        )

    def test_codex_turn_failed_without_request_requires_the_absent_key(self):
        class Proc:
            stdout = json.dumps(
                {"type": "turn.failed", "error": {"message": f"Missing environment variable: `{L.CODEX_FAKE_KEY_VAR}`."}}
            )

        self.assertTrue(L.codex_turn_failed_without_request(Proc()))

        class Other:
            stdout = json.dumps({"type": "turn.failed", "error": {"message": "rate limited"}})

        self.assertFalse(L.codex_turn_failed_without_request(Other()))

    def test_offline_provider_config_points_nowhere_reachable(self):
        joined = " ".join(L.CODEX_OFFLINE_CONFIG)
        self.assertIn("base_url=http://127.0.0.1:1/v1", joined)
        self.assertIn("request_max_retries=0", joined)
        self.assertIn(f"env_key={L.CODEX_FAKE_KEY_VAR}", joined)



class Redaction(unittest.TestCase):
    def test_home_prefix_and_PATH_are_removed(self):
        payload = {
            "run_root": f"{Path.home()}/tmp/w14-01-probes/run",
            "cases": [{"env": {"PATH": "/a:/b:/c", "HOME": str(Path.home())}}],
        }
        redacted = L.redact(payload)
        self.assertNotIn(str(Path.home()), json.dumps(redacted))
        self.assertTrue(redacted["run_root"].startswith("<home>/"))
        self.assertEqual(redacted["cases"][0]["env"]["PATH"], "<redacted: 3 entries>")


class RecorderContract(unittest.TestCase):
    def test_recorder_answers_initialize_and_records_its_environment(self):
        with tempfile.TemporaryDirectory() as tmp:
            record = Path(tmp) / "record.jsonl"
            request = json.dumps(
                {"jsonrpc": "2.0", "id": 0, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}}
            )
            proc = subprocess.run(
                ["node", str(PROBE_DIR / "recorder_mcp.mjs"), "--record", str(record)],
                input=request + "\n",
                capture_output=True,
                text=True,
                timeout=60,
                cwd=tmp,
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            reply = json.loads(proc.stdout.strip().splitlines()[0])
            self.assertEqual(reply["id"], 0)
            self.assertEqual(reply["result"]["serverInfo"]["name"], "w14-probe-recorder")

            entries = L.read_record(record)
            start = L.record_start(entries)
            self.assertIsNotNone(start)
            self.assertEqual(Path(start["cwd"]).resolve(), Path(tmp).resolve())
            self.assertEqual(L.record_methods(entries), ["initialize"])

    def test_recorder_redacts_secret_looking_environment_names(self):
        with tempfile.TemporaryDirectory() as tmp:
            record = Path(tmp) / "record.jsonl"
            import os

            env = dict(os.environ)
            env.update({"W14_SAFE_VALUE": "keep", "W14_SECRET_TOKEN": "drop"})
            subprocess.run(
                ["node", str(PROBE_DIR / "recorder_mcp.mjs"), "--record", str(record)],
                input="",
                capture_output=True,
                text=True,
                timeout=60,
                cwd=tmp,
                env=env,
            )
            recorded = L.record_start(L.read_record(record))["env"]
            self.assertEqual(recorded.get("W14_SAFE_VALUE"), "keep")
            self.assertNotIn("W14_SECRET_TOKEN", recorded)


if __name__ == "__main__":
    unittest.main()
