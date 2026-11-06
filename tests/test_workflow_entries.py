"""W19-04: every workflow entry follows the recorded selection (contract 01-workflow-binding.md § 4.2).

From a pre-design draft through design/plan/execute/review/decide/exchange/flow, for both client
packages, standalone and pinned, a fresh plugin and a stale or older one, a store variant and a
legacy bundle: the entry is resolved from the lock and the store, never from the active plugin or
the latest release. Missing, corrupt and unknown states refuse with an actionable next step.
Model-free and host-free: the real packaged helper on real files; no client, MCP or network.

  python3 -m unittest tests/test_workflow_entries.py -v
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_workflow_bundle import PLUGINS, Workspace, git, lib, rmtree, sha  # noqa: E402

ENTRIES = ["feature-decide", "feature-design", "feature-exchange", "feature-execute", "feature-flow", "feature-plan", "feature-review"]


class Entries(Workspace):
    def resolve(self, script: Path, project: Path, *args: str) -> tuple[int, dict]:
        return self.helper(script, "resolve", *args, cwd=project)

    def test_every_entry_of_both_clients_follows_the_draft_then_the_final_lock(self):
        for client in ("claude", "codex"):
            with self.subTest(client=client):
                project = self.project(f"proj-{client}")
                script = self.plugin_copy(client, f"cache-{client}") / "scripts/workflow.mjs"
                code, answer = self.resolve(script, project, "--new")
                self.assertEqual((code, answer["code"]), (3, "SELECTION_REQUIRED"))
                code, begun = self.helper(script, "begin", cwd=project)
                token = begun["draft_token"]
                identity = begun["lock"]["workflow"]["identity"]
                for feature in (f"docs/features/.draft-{token}", "F-entries"):
                    if feature == "F-entries":
                        self.assertEqual(self.helper(script, "finalize", "--draft", token, "--feature-id", "F-entries", cwd=project)[1]["result"], "FINALIZED")
                    for entry in ENTRIES:
                        code, answer = self.resolve(script, project, "--feature", feature, "--entry", entry)
                        self.assertEqual((code, answer["source"], answer["code"]), (0, "bundle", "BOUND_BUNDLE"), (feature, entry, answer))
                        self.assertEqual(answer["bundle"]["identity"], identity)
                        skill = Path(answer["instructions"]["workflow_skills"]) / entry / "SKILL.md"
                        self.assertTrue(skill.is_file(), skill)
                        self.assertTrue(str(skill).startswith(str(lib("process.stdout.write(JSON.stringify(W.canonicalAnchor(argv[0])))", str(self.store)))))
                        self.assertIn(f"/{client}/skills/", str(skill))
                        self.assertTrue(answer["record"].startswith(f"INSTRUCTIONS=bundle:{answer['bundle']['workflow_id']} IDENTITY={identity}"))

    def test_store_variant_and_stale_or_older_plugins_resolve_to_the_locked_bundle(self):
        project = self.project()
        script = self.plugin_copy("codex") / "scripts/workflow.mjs"
        _, begun = self.helper(script, "begin", "--feature-id", "F-1", cwd=project)
        locked = begun["lock"]["workflow"]
        # The entry Claude would load from the store (`${CLAUDE_PLUGIN_ROOT}` = store variant).
        stored = self.store / locked["workflow_id"] / "claude" / "scripts/workflow.mjs"
        code, answer = self.resolve(stored, project, "--feature", "F-1", "--entry", "feature-plan")
        self.assertEqual((code, answer["code"], answer["entry"]["layout"], answer["entry"]["same_as_bound"]), (0, "BOUND_BUNDLE", "store", True))
        # A newer plugin is active now: the started feature keeps its release, nothing is adopted.
        src = self.source_copy()
        with (src / ".agents/skills/feature-plan/SKILL.md").open("a") as handle:
            handle.write("\nnewer workflow release\n")
        release = json.loads((src / "scripts/workflow-source/release.json").read_text())
        release["version"] = "1.0.1"
        (src / "scripts/workflow-source/release.json").write_text(json.dumps(release))
        self.assertEqual(self.generate(src, "--component", "workflow").returncode, 0)
        newer = src / "plugins/feature-workflow-codex/scripts/workflow.mjs"
        code, answer = self.resolve(newer, project, "--feature", "F-1", "--entry", "feature-plan")
        self.assertEqual((code, answer["bundle"]["identity"], answer["entry"]["version"], answer["entry"]["same_as_bound"]), (0, locked["identity"], "1.0.1", False))
        # A new feature from the newer entry selects the newer release; the old feature is unchanged.
        _, second = self.helper(newer, "begin", "--feature-id", "F-2", cwd=project)
        self.assertNotEqual(second["lock"]["workflow"]["identity"], locked["identity"])
        self.assertEqual(self.resolve(script, project, "--feature", "F-1")[1]["bundle"]["identity"], locked["identity"])
        # The plugin cache disappears (update/uninstall): the store keeps both features working offline.
        rmtree(self.root / "cache")
        self.assertEqual(self.resolve(stored, project, "--feature", "F-1")[1]["code"], "BOUND_BUNDLE")

    def test_refusals_are_actionable_and_never_fall_back(self):
        project = self.project()
        script = self.plugin_copy("claude") / "scripts/workflow.mjs"
        _, begun = self.helper(script, "begin", "--feature-id", "F-1", cwd=project)
        workflow_id = begun["lock"]["workflow"]["workflow_id"]
        code, answer = self.resolve(script, project, "--feature", "F-1", "--entry", "feature-unknown")
        self.assertEqual((code, answer["code"]), (3, "ENTRY_NOT_IN_BUNDLE"))
        damaged = self.store / workflow_id / "claude/skills/feature-plan/SKILL.md"
        damaged.parent.chmod(0o755)
        damaged.chmod(0o644)
        damaged.write_text("tampered\n")
        code, answer = self.resolve(script, project, "--feature", "F-1", "--entry", "feature-plan")
        self.assertEqual((code, answer["code"]), (3, "BUNDLE_CORRUPT"))
        self.assertIn("restore exactly", answer["next_step"])
        self.assertIsNone(answer["instructions"])
        code, restored = self.helper(script, "restore", "--identity", begun["lock"]["workflow"]["identity"], "--from", str(PLUGINS["claude"]))
        self.assertEqual(restored["result"], "RESTORED")
        self.assertEqual(self.resolve(script, project, "--feature", "F-1")[1]["code"], "BOUND_BUNDLE")
        rmtree(self.store)
        code, answer = self.resolve(script, project, "--feature", "F-1")
        self.assertEqual((code, answer["code"]), (3, "BUNDLE_MISSING"))
        (project / "docs/features/F-old").mkdir(parents=True)
        code, answer = self.resolve(script, project, "--feature", "F-old", "--entry", "feature-review")
        self.assertEqual((code, answer["code"]), (3, "SELECTION_REQUIRED"))
        self.assertIn("never assigned silently", answer["next_step"])
        # An entry without a bundle (an old plugin) cannot start a feature.
        old = self.root / "old-plugin"
        shutil.copytree(PLUGINS["claude"], old)
        rmtree(old / "bundle")
        code, answer = self.resolve(old / "scripts/workflow.mjs", project, "--new")
        self.assertEqual((code, answer["code"]), (3, "ENTRY_WITHOUT_BUNDLE"))

    def test_select_source_keeps_v1_and_answers_v2_for_a_feature(self):
        project = self.project()
        package = self.plugin_copy("codex")
        reader = package / "scripts/select-source.mjs"
        v1 = subprocess.run(["node", str(reader), "--cwd", str(project)], capture_output=True, text=True, env=self.env())
        self.assertEqual((v1.returncode, json.loads(v1.stdout)["format"]), (0, "feature-workflow.instruction-source/v1"))
        v2 = subprocess.run(["node", str(reader), "--cwd", str(project), "--new"], capture_output=True, text=True, env=self.env())
        self.assertEqual((v2.returncode, json.loads(v2.stdout)["format"], json.loads(v2.stdout)["code"]), (3, "feature-workflow.instruction-source/v2", "SELECTION_REQUIRED"))

    def test_a_legacy_bundle_resolves_with_its_old_rules_and_no_new_preamble(self):
        """A legacy-bound feature reads its old rule text; the ack comes from the current engine role."""
        project = self.project()
        bundle = self.root / "legacy-bundle"
        lib("""
const variants = {};
for (const client of W.CLIENTS) variants[client] = {
  [`.${client}-plugin/plugin.json`]: { data: Buffer.from(JSON.stringify({ name: "feature-workflow", version: "legacy-0.7.0-6ed9a4537e37" })), mode: "644" },
  "skills/feature-plan/SKILL.md": { data: Buffer.from("---\\nname: feature-plan\\ndescription: old\\n---\\nOLD RULES 0.7.0\\n"), mode: "644" },
  "workflow/README.md": { data: Buffer.from("old guide\\n"), mode: "644" },
};
const m = W.bundleManifest({ version: "legacy-0.7.0-6ed9a4537e37", kind: "legacy", requires: { workflow_formats: { bundle: 1, lock: 1 } }, variants,
  legacy: { runtime_id: "0.7.0-6ed9a4537e37", instructions_set_sha256: "8c05792ad75e7550eddc00c4ef26eb1c7096951e2be384508321e39bfb78a4ed" }, source: { commit: null } });
W.writeBundle(argv[0], m, variants);
W.storePublish(argv[1], argv[0]);
const dir = argv[2];
W.writeLock(dir, W.newLock(m, { origin: { kind: "legacy-bind", runtime_id: "0.7.0-6ed9a4537e37" }, at: "2026-11-06T00:00:00Z", featureId: "F-L" }));
process.stdout.write(JSON.stringify(m.identity));
""", str(bundle), str(self.store), str(self._feature_dir(project, "F-L")))
        script = self.plugin_copy("codex") / "scripts/workflow.mjs"
        code, answer = self.resolve(script, project, "--feature", "F-L", "--entry", "feature-plan")
        self.assertEqual((code, answer["code"], answer["bundle"]["kind"]), (0, "BOUND_BUNDLE", "legacy"))
        text = (Path(answer["instructions"]["workflow_skills"]) / "feature-plan" / "SKILL.md").read_text()
        self.assertIn("OLD RULES 0.7.0", text)
        self.assertNotIn("Workflow selection — check first", text)  # old rules are not rewritten
        code, answer = self.resolve(script, project, "--feature", "F-L", "--entry", "feature-review")
        self.assertEqual((code, answer["code"]), (3, "ENTRY_NOT_IN_BUNDLE"))  # no fallback to the plugin copy

    def _feature_dir(self, project: Path, name: str) -> Path:
        path = project / "docs/features" / name
        path.mkdir(parents=True, exist_ok=True)
        return path


class EngineRoles(unittest.TestCase):
    """The current engine roles carry the ack instruction a legacy rule set cannot know."""

    def test_both_roles_and_the_coordinator_loop_require_the_ack_on_every_round_and_recovery(self):
        for path in (REPO_ROOT / ".codex/skills/using-bridge/SKILL.md", REPO_ROOT / ".claude/skills/using-bridge/SKILL.md",
                     REPO_ROOT / ".agents/skills/feature-execute/references/bridge-loop.md"):
            text = path.read_text()
            with self.subTest(path=path.name):
                for needle in ("workflow_identity", "bridge_feature_run", "bridge_workflow_bind", "bridge_workflow_bind_legacy", "WORKFLOW_ACK_MISMATCH"):
                    self.assertIn(needle, text)
                self.assertIn("never", text.lower())
        executor = (REPO_ROOT / ".agents/skills/feature-execute/SKILL.md").read_text().split("## Bridge round executor", 1)[1]
        self.assertIn("`Workflow binding` block", executor)
        self.assertIn("ROOT/skills/", executor)
        self.assertIn("INSTRUCTIONS=bundle:", executor)


if __name__ == "__main__":
    unittest.main()
