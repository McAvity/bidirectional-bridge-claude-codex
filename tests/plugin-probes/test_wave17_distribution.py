"""Host-independent checks of the W17-01 source reader and fixtures.

Fixture checks, not host evidence: they run no Claude/Codex CLI and no model. They pin the
contracted source-selection matrix (docs/features/F-W17-workflow-plugin/contracts/
01-distribution.md § 4) against two genuinely different instruction sets — the pre-wave16 pin
34ecb8d and the wave17 base — and check that every read leaves the fixture trees untouched.
Host discovery, namespace and collision behaviour are recorded only by
scripts/plugin-probes/wave17_probe_distribution.py.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
PROBE_DIR = REPO_ROOT / "scripts" / "plugin-probes"
sys.path.insert(0, str(PROBE_DIR))

import wave17_probe_distribution as P  # noqa: E402


def commit_available(commit: str) -> bool:
    out = subprocess.run(["git", "-C", str(REPO_ROOT), "cat-file", "-e", f"{commit}^{{commit}}"], capture_output=True)
    return out.returncode == 0


@unittest.skipUnless(
    commit_available(P.OLD_COMMIT) and commit_available(P.NEW_COMMIT),
    "fixture commits are not in this clone's history",
)
class SourceSelection(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory(prefix="w17-01-test-")
        cls.root = Path(cls._tmp.name)
        cls.fx = P.build_fixtures(cls.root)
        cls.matrix = P.source_matrix(cls.root, cls.fx)
        cls.by = {(c["case"], c["explicit_standalone"]): c for c in cls.matrix["cases"]}

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def test_every_case_matches_the_contract(self):
        wrong = [(c["case"], c["explicit_standalone"], c["source"], c["code"]) for c in self.matrix["cases"] if not c["as_expected"]]
        self.assertEqual(wrong, [])

    def test_reads_write_nothing_and_never_run_the_project_entry(self):
        self.assertEqual([c["case"] for c in self.matrix["cases"] if c["writes"]], [])
        self.assertFalse(any(c["entry_tripwire_fired"] for c in self.matrix["cases"]))

    def test_old_pin_keeps_its_zip_era_instructions(self):
        old = self.by[("pinned-old-0.3.2", False)]
        self.assertEqual(old["source"], "runtime")
        self.assertTrue(old["record"].startswith(f"INSTRUCTIONS=runtime:{P.OLD_ID} "))
        self.assertFalse(old["local_delivery_present"])

    def test_new_pin_and_standalone_carry_local_delivery(self):
        self.assertTrue(self.by[("pinned-new", False)]["local_delivery_present"])
        self.assertTrue(self.by[("no-bridge", False)]["local_delivery_present"])

    def test_a_valid_pin_wins_over_an_explicit_standalone_request(self):
        self.assertEqual(self.by[("pinned-old-0.3.2", True)]["source"], "runtime")

    def test_broken_pins_refuse_without_fallback(self):
        for case in ("pin-runtime-missing", "pin-commit-mismatch", "declaration-invalid", "project-disabled", "legacy-layout"):
            with self.subTest(case=case):
                refused = self.by[(case, False)]
                self.assertEqual(refused["source"], "none")
                self.assertEqual(refused["exit_code"], 3)
                self.assertTrue(refused["next_step"])
                scoped = self.by[(case, True)]
                self.assertEqual((scoped["source"], scoped["code"]), ("plugin", "EXPLICIT_STANDALONE"))

    def test_plugin_version_does_not_change_a_pinned_answer(self):
        agreement = self.matrix["plugin_update_agreement"]
        self.assertEqual(agreement["pinned_old_via_old_package"], agreement["pinned_old_via_new_package"])
        self.assertFalse(agreement["standalone_via_old_package_local_delivery"])
        self.assertTrue(agreement["standalone_via_new_package_local_delivery"])

    def test_a_package_inside_a_runtime_is_that_runtime(self):
        self.assertEqual(self.matrix["runtime_package"]["code"], "RUNTIME_PACKAGE")
        self.assertIn(P.NEW_ID, self.matrix["runtime_package"]["record"])


@unittest.skipUnless(commit_available(P.NEW_COMMIT), "fixture commit is not in this clone's history")
class CandidatePackages(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory(prefix="w17-01-pkg-")
        cls.root = Path(cls._tmp.name)
        for client in ("claude", "codex"):
            P.node_json(str(P.FIXTURES), "package", str(cls.root / "packages" / f"{client}-new"),
                        "--client", client, "--commit", P.NEW_COMMIT, "--version", "0.3.3")

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def test_six_entries_references_and_helper_resolve_inside_each_package(self):
        for client in ("claude", "codex"):
            with self.subTest(client=client):
                package = self.root / "packages" / f"{client}-new"
                names = sorted(p.name for p in (package / "skills").iterdir() if (p / "SKILL.md").is_file())
                self.assertEqual(names, sorted(P.SIX))
                self.assertTrue((package / P.LOCAL_DELIVERY).is_file())
                self.assertEqual(P.link_check(package)["unresolved"], [])
                self.assertEqual(P.forbidden_references(package), [])

    def test_exchange_helper_runs_outside_a_bridge_checkout(self):
        result = P.helper_outside_checkout(self.root, self.root / "packages" / "codex-new")
        self.assertEqual((result["export_exit"], result["verify_exit"], result["integrity"]), (0, 0, "ok"))


class Isolation(unittest.TestCase):
    def test_run_root_refuses_a_personal_profile(self):
        old = os.environ.get("W17_PROBE_ROOT")
        os.environ["W17_PROBE_ROOT"] = str(Path.home() / ".claude" / "w17")
        try:
            with self.assertRaises(SystemExit):
                P.run_root()
        finally:
            if old is None:
                os.environ.pop("W17_PROBE_ROOT", None)
            else:
                os.environ["W17_PROBE_ROOT"] = old


if __name__ == "__main__":
    unittest.main()
