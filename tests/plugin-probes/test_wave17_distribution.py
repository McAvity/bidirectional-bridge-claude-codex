"""Host-independent checks of the W17-01 source reader and fixtures.

Fixture checks, not host evidence: they run no Claude/Codex CLI and no model. Since W17-02 the
newer packages are the generated plugins/feature-workflow-*. They pin the
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


FIXTURE_COMMITS = commit_available(P.OLD_COMMIT) and commit_available(P.NEW_COMMIT)
_MATRIX: dict = {}


def shared_matrix() -> dict:
    """Build the fixture runtimes and run the reader matrix once for every class below."""
    if not _MATRIX:
        with tempfile.TemporaryDirectory(prefix="w17-01-test-") as tmp:
            root = Path(tmp)
            fx = P.build_fixtures(root)
            _MATRIX.update(P.source_matrix(root, fx))
            _MATRIX["actual_packages"] = fx["actual"]
    return _MATRIX


@unittest.skipUnless(FIXTURE_COMMITS, "fixture commits are not in this clone's history")
class SourceSelection(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.matrix = shared_matrix()
        cls.by = {(c["case"], c["explicit_standalone"]): c for c in cls.matrix["cases"]}

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


@unittest.skipUnless(FIXTURE_COMMITS, "fixture commits are not in this clone's history")
class RuntimePackageNeverOutranksThePin(unittest.TestCase):
    """Review R02-01: package location is compared with a resolved pin, never used instead of it."""

    @classmethod
    def setUpClass(cls):
        cls.cases = shared_matrix()["runtime_package_cases"]
        cls.by = {(c["case"], c["explicit_standalone"]): c for c in cls.cases}

    def test_every_runtime_package_case_matches_the_contract(self):
        wrong = [(c["case"], c["explicit_standalone"], c.get("source"), c.get("code")) for c in self.cases if not c["as_expected"]]
        self.assertEqual(wrong, [])

    def test_matching_delegated_package_selects_the_declared_runtime(self):
        for case, runtime_id, delivery in (
            ("matching/old-pin+old-runtime-package", P.OLD_ID, False),
            ("matching/new-pin+new-runtime-package", P.NEW_ID, True),
        ):
            for standalone in (False, True):
                with self.subTest(case=case, standalone=standalone):
                    hit = self.by[(case, standalone)]
                    self.assertEqual((hit["source"], hit["code"]), ("runtime", "PINNED_RUNTIME"))
                    self.assertTrue(hit["record"].startswith(f"INSTRUCTIONS=runtime:{runtime_id} SET="))
                    self.assertNotIn("SET=unknown", hit["record"])
                    self.assertIs(hit["package_matches_pin"], True)
                    self.assertIs(hit["local_delivery_present"], delivery)

    def test_old_pin_with_new_package_is_refused_not_upgraded(self):
        for case in ("mismatch/old-pin+new-runtime-package", "mismatch/new-pin+old-runtime-package"):
            for standalone in (False, True):
                with self.subTest(case=case, standalone=standalone):
                    hit = self.by[(case, standalone)]
                    self.assertEqual((hit["source"], hit["code"], hit["exit_code"]), ("none", "PACKAGE_PIN_MISMATCH", 3))
                    self.assertFalse(hit["local_delivery_present"])

    def test_unresolved_pins_are_classified_before_package_location(self):
        for case in (c for c, s in self.by if c.startswith("unresolved/") and not s):
            with self.subTest(case=case):
                refused = self.by[(case, False)]
                self.assertEqual((refused["source"], refused["exit_code"]), ("none", 3))
                self.assertTrue(refused["record"].startswith("INSTRUCTIONS=none "))
                self.assertEqual(self.by[(case, True)]["code"], "EXPLICIT_STANDALONE")

    def test_same_id_package_does_not_hide_a_commit_mismatch(self):
        hit = self.by[("unresolved/commit-mismatch+same-id-runtime-package", False)]
        self.assertEqual((hit["source"], hit["code"]), ("none", "PIN_UNRESOLVED"))
        self.assertEqual(hit["package_inside_runtime"], P.OLD_ID)

    def test_a_path_that_only_names_a_runtime_is_rejected(self):
        ghost = self.by[("nonexistent-package-root-beneath-runtime", False)]
        self.assertEqual(ghost["exit_code"], 1)
        self.assertTrue(ghost["stdout_empty"])

    def test_the_generated_packages_and_the_runtime_shipped_reader_answer(self):
        # Since W17-02 the matrix runs the generated plugins/feature-workflow-*, and a W17-03-shaped
        # runtime answers through the reader of the workflow package it ships.
        self.assertTrue(shared_matrix()["actual_packages"])
        shipped = [c for c in self.cases if c.get("package_inside_runtime") == P.NEW_ID]
        self.assertTrue(shipped)
        for case in shipped:
            self.assertEqual(case["reader"], "package's own")
            self.assertTrue(case["package_root"].endswith("plugins/feature-workflow-claude"))

    def test_runtime_package_reads_write_nothing(self):
        self.assertEqual([c["case"] for c in self.cases if c["writes"]], [])
        self.assertFalse(any(c["entry_tripwire_fired"] for c in self.cases))


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
