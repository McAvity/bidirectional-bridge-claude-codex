"""Host-free tests of the W19-01 contract fixtures and reference model.

  python3 -m unittest discover -s tools/pilot/workflow-versioning -v
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import contract_fixtures as F  # noqa: E402
import contract_model as M  # noqa: E402

# The contract's expected verdicts (contracts/01-workflow-binding.md § 12). A change here is a
# contract change, not a test fix.
EXPECTED = {
    "REL-01": "SAME_IDENTITY", "REL-02": "VERSION_REUSED", "REL-03": "BRIDGE_ENTRY_UNCHANGED",
    "STORE-01": "PUBLISHED", "STORE-02": "STORE_ID_COLLISION", "STORE-03": "RECOVERED", "STORE-04": "RESTORED",
    "BUNDLE-modified-file": "BUNDLE_CORRUPT", "BUNDLE-missing-file": "BUNDLE_INCOMPLETE", "BUNDLE-extra-file": "BUNDLE_EXTRA_FILES",
    "BUNDLE-symlink": "BUNDLE_SYMLINK", "BUNDLE-traversal": "BUNDLE_PATH_UNSAFE", "BUNDLE-recursive": "BUNDLE_RECURSIVE",
    "BUNDLE-runtime-owned": "BUNDLE_RUNTIME_OWNED", "BUNDLE-manifest-edited": "BUNDLE_CORRUPT", "BUNDLE-expected-identity": "BUNDLE_IDENTITY_MISMATCH",
    "COMPAT-01": "COMPATIBLE", "COMPAT-02": "RUNTIME_WITHOUT_BINDING", "COMPAT-03": "CAPABILITY_MISSING",
    "COMPAT-04": "BINDING_CONTRACT_UNSUPPORTED", "COMPAT-05": "COMPATIBLE", "COMPAT-06": "COMPATIBLE",
    "LOCK-01": "VALID", "LOCK-02": "LOCK_INVALID", "LOCK-03": "LOCK_INVALID", "LOCK-04": "LOCK_INVALID", "LOCK-05": "LOCK_INVALID",
    "DRAFT-01": "FINALIZED", "DRAFT-02a": "CRASHED", "DRAFT-02b": "FINALIZED", "DRAFT-02c": "ALREADY_FINAL",
    "DRAFT-03a": "CRASHED", "DRAFT-03b": "ALREADY_FINAL", "DRAFT-04": "FEATURE_DIR_COLLISION", "DRAFT-05": "FEATURE_DIR_COLLISION",
    "DRAFT-06": "DRAFT_ALREADY_ASSIGNED",
    "BIND-01": "RUNTIME_WITHOUT_BINDING", "RUN-01": "WORKFLOW_UNBOUND", "BIND-02": "BOUND", "BIND-03": "BOUND",
    "RUN-02": "WORKFLOW_ACK_MISMATCH", "RUN-03": "WORKFLOW_EXECUTOR_UNSUPPORTED", "RUN-04": "RESERVED",
    "SWITCH-01": "WORKFLOW_SWITCH_ACTIVE_ATTEMPT", "SWITCH-02": "WORKFLOW_GENERATION_CONFLICT", "SWITCH-03": "WORKFLOW_SWITCH_WAITING_USER",
    "SWITCH-crash-intent": "SWITCHED", "SWITCH-crash-commit": "SWITCHED", "SWITCH-crash-project": "SWITCHED",
    "SWITCH-04": "SWITCHED", "SWITCH-05": "WORKFLOW_SWITCH_PENDING", "STATUS-01": "PROJECTION_BEHIND", "SWITCH-06": "RESERVED",
    "LEGACY-01": "PARTITIONED", "LEGACY-02": "PROVEN", "LEGACY-03": "AMBIGUOUS", "LEGACY-04": "UNPROVEN",
    "LEGACY-05": "SOURCE_MISSING", "LEGACY-06": "PROVEN", "LEGACY-07": "UNPROVEN",
    "RESOLVE-01": "SELECTION_REQUIRED", "RESOLVE-02": "SELECTION_REQUIRED", "RESOLVE-03": "RUNTIME_WITHOUT_BINDING",
    "RESOLVE-04": "LEGACY_PINNED_RUNTIME", "RESOLVE-05": "LEGACY_BIND_REQUIRED", "RESOLVE-06": "LEGACY_AMBIGUOUS",
    "RESOLVE-07": "BOUND_BUNDLE", "RESOLVE-08": "BUNDLE_MISSING", "RESOLVE-09": "BUNDLE_CORRUPT", "RESOLVE-10": "BOUND_BUNDLE",
    "RESOLVE-11": "WORKFLOW_INCOMPATIBLE", "RESOLVE-12": "ENTRY_WITHOUT_BUNDLE", "RESOLVE-13": "RUNTIME_WITHOUT_BINDING",
    "RESOLVE-14": "SELECTION_REQUIRED",
}


class Fixtures(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix="w19-01-test-")
        cls.out = Path(cls.tmp.name) / "fixtures"
        F.generate(cls.out)
        cls.cases = {c["id"]: c for c in json.loads((cls.out / "cases.json").read_text())["cases"]}

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_committed_fixtures_reproduce_byte_for_byte(self):
        self.assertEqual(F.main(["--check"]), 0)

    def test_every_case_has_the_contract_verdict(self):
        self.assertEqual({k: v["outcome"] for k, v in self.cases.items()}, EXPECTED)

    def test_every_acceptance_criterion_has_an_example(self):
        covered = {ac for case in self.cases.values() for ac in case["ac"]}
        self.assertEqual(covered, {f"AC-{n:02d}" for n in range(1, 11)})

    def test_switch_completes_exactly_once_after_every_crash_point(self):
        for step in ("intent", "commit", "project"):
            detail = self.cases[f"SWITCH-crash-{step}"]["detail"]
            self.assertEqual(detail["switch_entries"], 1, step)
            self.assertEqual(detail["run_while_pending"], "WORKFLOW_SWITCH_PENDING", step)
            self.assertEqual(detail["replay"], "ALREADY_APPLIED", step)
            self.assertEqual(detail["final_status"], "in-sync", step)

    def test_legacy_snapshot_excludes_runtime_roles(self):
        detail = self.cases["LEGACY-01"]["detail"]
        self.assertTrue(all(p.startswith(".agents/skills/feature-") or p == "docs/features/README.md" for p in detail["included"]))
        self.assertIn(".claude/skills/using-bridge/SKILL.md", [e["path"] for e in detail["excluded"]])

    def test_examples_are_self_consistent(self):
        bundle = json.loads((self.out / "examples" / "bundle-A.json").read_text())
        self.assertEqual(M.bundle_identity(bundle), bundle["identity"])
        for name in ("lock-begin.json", "lock-final-after-switch.json"):
            M.validate_lock(json.loads((self.out / "examples" / name).read_text()))
        self.assertFalse(any(f["path"].split("/", 1)[1].startswith("bundle/") for f in bundle["files"]))

    def test_fixtures_contain_no_machine_paths(self):
        for path in self.out.rglob("*.json"):
            text = path.read_text()
            self.assertNotIn("/tmp/", text, path.name)
            self.assertNotIn(str(Path.home()), text, path.name)


class Model(unittest.TestCase):
    def test_canonical_json_refuses_floats(self):
        with self.assertRaises(M.ContractError):
            M.canonical_json({"a": 1.5})

    def test_identity_ignores_source_but_not_requires(self):
        base = {"format": M.BUNDLE_FORMAT, "component": M.COMPONENT, "kind": "release", "version": "1", "requires": {}, "variants": {}, "files": []}
        self.assertEqual(M.bundle_identity({**base, "source": {"commit": "a"}}), M.bundle_identity({**base, "source": {"commit": "b"}}))
        self.assertNotEqual(M.bundle_identity(base), M.bundle_identity({**base, "requires": {"bridge": {}}}))

    def test_unsafe_paths(self):
        for bad in ("/abs", "a/../b", "a\\b", "", "./a"):
            self.assertFalse(M.safe_relpath(bad), bad)
        self.assertTrue(M.safe_relpath("claude/skills/x/SKILL.md"))


if __name__ == "__main__":
    unittest.main()
