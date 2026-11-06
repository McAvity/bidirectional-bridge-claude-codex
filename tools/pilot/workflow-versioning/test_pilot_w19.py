"""W19-06 pilot tooling: setup, preflight and collector, with synthetic data only.

No client, login, model or runtime install: `setup --no-runtime` builds the releases and projects;
the collector is fed a fabricated bridge database, Codex rollouts and snapshots that mirror what
the real run records. A precondition that did not happen must be NOT_TESTED, a substitute session
FAIL, and nothing private may reach the printed or public output.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import pilot_w19 as P  # noqa: E402

GIT = {**os.environ, "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_SYSTEM": "/dev/null",
       "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@x.invalid", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@x.invalid"}
DAY = 1_800_000_000_000  # synthetic epoch ms


class Run(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="w19-06-pilot-"))
        cls.rd = cls.tmp / "run"
        with contextlib.redirect_stdout(io.StringIO()):
            P.main(["setup", "--dest", str(cls.rd), "--no-runtime"])
        cls.setup = json.loads((cls.rd / "operator/setup.json").read_text())
        cls.tokens = json.loads((cls.rd / "operator/release-tokens.json").read_text())

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)


class Setup(Run):
    def test_isolated_layout_and_env(self):
        env = P.load_env(self.rd)
        for key, sub in (("CODEX_HOME", "codex-home"), ("CLAUDE_CONFIG_DIR", "claude-config"), ("CLAUDE_CODEX_BRIDGE_HOME", "bridge-home")):
            self.assertEqual(env[key], str(self.rd / sub))
        self.assertEqual(env["PILOT_MCP_FORWARD"], "CLAUDE_CONFIG_DIR")
        self.assertIn("unset ANTHROPIC_API_KEY", (self.rd / "env.sh").read_text())  # no credential is carried over

    def test_refuses_existing_checkout_and_personal_destinations(self):
        for dest in (self.rd, P.REPO / "pilot-run", Path.home() / ".codex" / "pilot-run"):
            with self.subTest(dest=dest), self.assertRaises(SystemExit):
                P.main(["setup", "--dest", str(dest), "--no-runtime"])
        self.assertFalse((P.REPO / "pilot-run").exists())

    def test_releases_are_distinct_and_only_carry_their_own_token(self):
        identities = {v["identity"] for v in self.setup["releases"].values()}
        self.assertEqual(len(identities), 3)
        self.assertEqual([self.setup["releases"][k]["version"] for k in "ABC"], ["1.0.0", "1.0.1", "1.0.2"])
        for name, token in self.tokens.items():
            for other in "ABC":
                text = (self.rd / f"releases/{other}/feature-workflow-claude/bundle/claude/skills/feature-execute/SKILL.md").read_text()
                self.assertEqual(token in text, other == name)
        for name in "ABC":
            for client in ("claude", "codex"):
                root = self.rd / f"releases/{name}/feature-workflow-{client}"
                out = subprocess.run(["node", root / "scripts/workflow.mjs", "verify-plugin", "--root", root, "--json"], capture_output=True, text=True)
                self.assertEqual(json.loads(out.stdout)["ok"], True, (name, client))  # the client installs a package that verifies
        bundle_c = json.loads((self.rd / "releases/C/feature-workflow-codex/bundle/bundle.json").read_text())
        self.assertIn("workflow.pilot-incompatible/v1", bundle_c["requires"]["bridge"]["capabilities"])

    def test_market_has_a_then_b_with_unchanged_bridge_packages(self):
        market = self.rd / "market"
        a, b = self.setup["releases"]["A"]["market_commit"], self.setup["releases"]["B"]["market_commit"]
        self.assertEqual(subprocess.run(["git", "-C", market, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip(), a)
        changed = subprocess.run(["git", "-C", market, "diff", "--name-only", a, b], capture_output=True, text=True).stdout.split()
        self.assertTrue(changed and all(p.startswith(("plugins/feature-workflow-", ".agents/plugins/", ".claude-plugin/")) for p in changed), changed)
        claude_market = json.loads(subprocess.run(["git", "-C", market, "show", f"{b}:.claude-plugin/marketplace.json"], capture_output=True, text=True).stdout)
        self.assertEqual({p["name"]: p["version"] for p in claude_market["plugins"]}["feature-workflow"], "1.0.1")

    def test_agent_inputs_hold_no_operator_material(self):
        for project in P.PROJECTS:
            order = (self.rd / f"START-ASTRA-{project}.md").read_text()
            self.assertIn(P.FEATURES[project][0], order)
            self.assertNotIn("{{", order)
            for token in self.tokens.values():
                self.assertNotIn(token, order)
        self.assertNotIn("token", json.dumps(self.setup))


class EnvForwarding(Run):
    def test_real_dispatcher_block_gains_claude_config_dir_only_for_the_pilot(self):
        project = self.rd / "projects/p1"
        block = subprocess.run(["node", "--input-type=module", "-e",
                                "import {renderCodexBlock} from %s; process.stdout.write(renderCodexBlock({}, 'dispatcher'));"
                                % json.dumps((P.REPO / "scripts/setup/workspace.mjs").as_uri())], capture_output=True, text=True, check=True).stdout
        (project / ".codex").mkdir(exist_ok=True)
        (project / ".codex/config.toml").write_text(block)
        try:
            mcp = P.effective_mcp(self.rd, project)
            self.assertTrue(mcp["dispatcher"] and mcp["trusted"] and mcp["tools_approved"])
            self.assertEqual(mcp["env_vars"], ["CLAUDE_CODEX_BRIDGE_HOME", "XDG_DATA_HOME", "CLAUDE_CONFIG_DIR"])
            with mock.patch.dict(os.environ, {}, clear=False):
                os.environ.pop("PILOT_MCP_FORWARD", None)
                os.environ.pop("PILOT_MCP_APPROVE", None)
                plain = dict(a.split("=", 1) for a in P.codex_args.launch_args(project))
            self.assertEqual(json.loads(plain["mcp_servers.bridge.env_vars"]), ["CLAUDE_CODEX_BRIDGE_HOME", "XDG_DATA_HOME"])  # other pilots unchanged
            self.assertNotIn("mcp_servers.bridge.default_tools_approval_mode", plain)
        finally:
            shutil.rmtree(project / ".codex")


class Preflight(Run):
    def test_not_ready_without_runtime_and_never_claims_the_pilot(self):
        result = P.relativize(P.preflight(self.rd, clients=False), self.rd)
        self.assertFalse(result["ready"])
        self.assertEqual(result["pilot"], "NOT_TESTED")
        status = {c["id"]: c["status"] for c in result["checks"]}
        self.assertEqual((status["P-ISO-01"], status["P-ISO-02"], status["P-REL-01"], status["P-CONTAM-01"]), ("PASS", "PASS", "PASS", "PASS"))
        self.assertEqual((status["P-RT-01"], status["PILOT-AUTH"]), ("FAIL", "PENDING"))
        text = json.dumps(result)
        self.assertNotIn(str(self.rd), text)
        self.assertNotIn(str(Path.home()), text)

    def test_an_env_pointing_at_a_personal_profile_fails_isolation(self):
        env_file = self.rd / "env.sh"
        saved = env_file.read_text()
        try:
            env_file.write_text(saved.replace(json.dumps(str(self.rd / "codex-home")), json.dumps(str(Path.home() / ".codex"))))
            status = {c["id"]: c["status"] for c in P.preflight(self.rd, clients=False)["checks"]}
            self.assertEqual(status["P-ISO-01"], "FAIL")
        finally:
            env_file.write_text(saved)

    def test_a_release_token_inside_a_project_is_contamination(self):
        leak = self.rd / "projects/p2/NOTES.md"
        leak.write_text(self.tokens["A"])
        try:
            status = {c["id"]: c["status"] for c in P.preflight(self.rd, clients=False)["checks"]}
            self.assertEqual(status["P-CONTAM-01"], "FAIL")
        finally:
            leak.unlink()


SCHEMA = """
CREATE TABLE features (feature_id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE tasks (task_id TEXT PRIMARY KEY, spec_json TEXT NOT NULL, state TEXT);
CREATE TABLE task_attempts (task_id TEXT, attempt INTEGER, agent TEXT, resumed_from_attempt INTEGER, execution_handle TEXT,
  started_at INTEGER, updated_at INTEGER, ended_at INTEGER, outcome TEXT);
CREATE TABLE attempt_workflow (task_id TEXT, attempt INTEGER, feature_id TEXT, identity TEXT, workflow_id TEXT, generation INTEGER, kind TEXT, admitted_at INTEGER);
CREATE TABLE attempt_telemetry (task_id TEXT, attempt INTEGER, run_id TEXT, agent TEXT, json TEXT);
CREATE TABLE manager_epochs (epoch INTEGER, native_thread_id TEXT, bound_at INTEGER, ended_at INTEGER);
"""


class Collector(unittest.TestCase):
    """A fabricated complete run: A→B update, cache removal, new features, explicit switch."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="w19-06-collect-"))
        self.rd = self.tmp / "run"
        with contextlib.redirect_stdout(io.StringIO()):
            P.main(["setup", "--dest", str(self.rd), "--no-runtime"])
        self.setup = json.loads((self.rd / "operator/setup.json").read_text())
        self.tokens = json.loads((self.rd / "operator/release-tokens.json").read_text())
        self.ident = {k: v["identity"] for k, v in self.setup["releases"].items()}
        # name → (project, lock release, generation, history, rounds[(task, start_offset_min, handle, admitted release, generation, ledger release)], manager release)
        self.features = {
            "F-001-reset": ("p1", "B", 2, [("bind", "A", 1), ("switch", "B", 2)],
                            [("t1", 10, "claude-1", "A", 1, "A"), ("t2", 60, "claude-1", "A", 1, "A"), ("t3", 100, "claude-1", "B", 2, "B")], "A"),
            "F-002-new": ("p1", "B", 1, [("bind", "B", 1)], [("t4", 80, "claude-2", "B", 1, "B")], "B"),
            "F-001-decrement": ("p2", "B", 1, [("bind", "B", 1)], [("t5", 70, "claude-3", "B", 1, "B")], "B"),
        }
        self.locked_at = {"F-001-reset": 0, "F-002-new": 75, "F-001-decrement": 65}

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def commit(self, project: Path, rel: str, text: str, minute: int):
        path = project / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        stamp = f"@{(DAY + minute * 60000) // 1000} +0000"
        subprocess.run(["git", "-C", project, "add", rel], check=True, env=GIT)
        subprocess.run(["git", "-C", project, "commit", "-qm", rel], check=True, env={**GIT, "GIT_COMMITTER_DATE": stamp, "GIT_AUTHOR_DATE": stamp})

    def fabricate(self, *, handles=None):
        dbs = {}
        for name, (project_name, lock_rel, gen, history, rounds, manager_rel) in self.features.items():
            project = self.rd / "projects" / project_name
            (project / ".bridge").mkdir(exist_ok=True)
            if project_name not in dbs:
                dbs[project_name] = sqlite3.connect(project / ".bridge/bridge.db")
                dbs[project_name].executescript(SCHEMA)
                dbs[project_name].execute("insert into manager_epochs values (1, ?, ?, null)", (f"thread-{project_name}", DAY))
            db = dbs[project_name]
            lock = {"feature": {"feature_id": name}, "workflow": {"identity": self.ident[lock_rel]}, "generation": gen, "history": [{"op": op} for op, _, _ in history]}
            self.commit(project, f"docs/features/{name}/brief.md", f"brief\n{P.MARKER} {self.tokens[manager_rel]}\n", self.locked_at[name] + 1)
            (project / f"docs/features/{name}/workflow.lock.json").write_text(json.dumps(lock))
            binding = {"identity": self.ident[lock_rel], "generation": gen, "kind": "release",
                       "history": [{"op": op, "identity": self.ident[rel], "generation": g} for op, rel, g in history]}
            db.execute("insert into features values (?, ?)", (name, json.dumps({"state": "awaiting_review", "task_ids": [r[0] for r in rounds], "workflow": binding})))
            for task, start, handle, admitted, agen, ledger in rounds:
                handle = (handles or {}).get(task, handle)
                at = DAY + start * 60000
                db.execute("insert into tasks values (?, ?, 'done')", (task, json.dumps({"objective": "x"})))
                db.execute("insert into task_attempts values (?, 0, 'claude', null, ?, ?, ?, ?, 'completed')", (task, handle, at, at + 600000, at + 600000))
                db.execute("insert into attempt_workflow values (?, 0, ?, ?, 'x', ?, 'release', ?)", (task, name, self.ident[admitted], agen, at))
                db.execute("insert into attempt_telemetry values (?, 0, 'r', 'claude', ?)", (task, json.dumps({"turn_count": 20, "wall_duration_ms": 600000})))
                self.commit(project, f"docs/features/{name}/execution/{task}/01.md", f"ledger\n{P.MARKER} `{self.tokens[ledger]}`\n", start + 5)
        for db in dbs.values():
            db.commit()
            db.close()
        sessions = self.rd / "codex-home/sessions/2026/11/06"
        sessions.mkdir(parents=True)
        for project_name in P.PROJECTS:
            rows = [{"type": "session_meta", "payload": {"id": f"astra-{project_name}", "cwd": str(self.rd / "projects" / project_name), "source": "cli",
                                                         "originator": "codex-tui", "timestamp": "2026-11-06T00:00:00Z"}}]
            for minute in (0, 60, 95):
                rows.append({"timestamp": P.time.strftime("%Y-%m-%dT%H:%M:%SZ", P.time.gmtime((DAY + minute * 60000) / 1000)), "type": "event_msg", "payload": {"type": "task_started"}})
                rows.append({"timestamp": P.time.strftime("%Y-%m-%dT%H:%M:%SZ", P.time.gmtime((DAY + (minute + 20) * 60000) / 1000)), "type": "event_msg", "payload": {"type": "task_complete"}})
            (sessions / f"rollout-{project_name}.jsonl").write_text("\n".join(json.dumps(r) for r in rows) + "\n")

    def snapshots(self):
        directory = self.rd / "operator-results/snapshots"
        directory.mkdir(parents=True)
        b_head = self.setup["releases"]["B"]["market_commit"]
        a_lock = [{"feature_id": "F-001-reset", "identity": self.ident["A"], "generation": 1}]
        empty = {"runtime": {"runtime_id": None}, "locks": []}
        plans = [
            ("started", 0, {"claude": [{"plugin": "feature-workflow", "marketplace": "personal", "version": "0.9.0"}], "codex": [{"plugin": "feature-workflow", "version": "1.0.0"}]}, {"p1": a_lock, "p2": []}, None),
            ("updated-b", 50, {"claude": [{"plugin": "feature-workflow", "marketplace": "personal", "version": "0.9.0"}], "codex": [{"plugin": "feature-workflow", "version": "1.0.1"}]}, {"p1": a_lock, "p2": []}, b_head),
            ("cache-removed", 55, {"claude": [], "codex": [{"plugin": "feature-workflow", "version": "1.0.1"}]}, {"p1": a_lock, "p2": []}, b_head),
            ("claude-updated", 200, {"claude": [{"plugin": "feature-workflow", "marketplace": "claude-codex-bridge", "version": "1.0.1"}], "codex": [{"plugin": "feature-workflow", "version": "1.0.1"}]}, None, b_head),
        ]
        for index, (label, minute, entries, lock_map, head) in enumerate(plans):
            projects = {n: {**empty, "locks": (lock_map or {}).get(n, [])} for n in P.PROJECTS}
            if lock_map is None:
                projects = {n: {**empty, "locks": P.locks(self.rd / "projects" / n)} for n in P.PROJECTS}
            snap = {"label": label, "at_ms": DAY + minute * 60000, "projects": projects, "entries": entries, "market_head": head or self.setup["releases"]["A"]["market_commit"]}
            (directory / f"{index:02d}-{label}.json").write_text(json.dumps(snap))
        (self.rd / "operator-results/checks.json").write_text(json.dumps({"checks": [
            {"id": "CHK-INCOMPATIBLE", "status": "PASS", "detail": "x"}, {"id": "CHK-RESTORE", "status": "PASS", "detail": "x"}, {"id": "CHK-STANDALONE", "status": "PASS", "detail": "x"}]}))

    def collect(self):
        public = self.tmp / "public.json"
        with contextlib.redirect_stdout(io.StringIO()):
            P.main(["collect", "--run", str(self.rd), "--public", str(public)])
        return json.loads(public.read_text())

    def test_nothing_run_is_not_tested(self):
        result = self.collect()
        self.assertEqual(result["overall"], "NOT_TESTED")
        self.assertTrue(all(c["result"] == "NOT_TESTED" for c in result["cases"]), [(c["id"], c["result"]) for c in result["cases"]])
        self.assertEqual(result["budget"]["used"]["claude_rounds"], 0)

    def test_complete_synthetic_run_passes_every_layer_with_continuity_and_budget(self):
        self.fabricate()
        self.snapshots()
        with mock.patch.object(P, "runtime_of", return_value={"runtime_id": "0.7.0-x", "installed": True, "advertises_binding": True}):
            # snapshots were written with a null pin; the final state must agree with them
            for f in (self.rd / "operator-results/snapshots").glob("*.json"):
                snap = json.loads(f.read_text())
                for n in P.PROJECTS:
                    snap["projects"][n]["runtime"] = {"runtime_id": "0.7.0-x"}
                f.write_text(json.dumps(snap))
            result = self.collect()
        cases = {c["id"]: c for c in result["cases"]}
        self.assertEqual({k: v["result"] for k, v in cases.items()}, {k: "PASS" for k in cases}, json.dumps(result, indent=1)[:4000])
        used = result["budget"]["used"]
        self.assertEqual((used["claude_rounds"], used["astra_turns"], used["exceeded"]), (5, 6, []))
        self.assertEqual(cases["C06"]["data"]["p1/F-001-reset"]["claude_sessions"], 1)
        text = json.dumps(result)
        for secret in ("claude-1", "astra-p1", "thread-p1", str(self.rd), *self.tokens.values()):
            self.assertNotIn(secret, text)

    def test_a_substitute_claude_session_after_the_switch_fails(self):
        self.fabricate(handles={"t3": "claude-substitute"})
        self.snapshots()
        cases = {c["id"]: c["result"] for c in self.collect()["cases"]}
        self.assertEqual(cases["C06"], "FAIL")
        self.assertEqual(self.collect()["overall"], "FAIL")

    def test_a_round_that_followed_the_wrong_release_fails_and_budget_overrun_is_reported(self):
        self.features["F-001-reset"][4][1] = ("t2", 60, "claude-1", "A", 1, "B")  # read B text while bound to A
        self.fabricate()
        self.snapshots()
        db = sqlite3.connect(self.rd / "projects/p1/.bridge/bridge.db")
        db.execute("update attempt_telemetry set json=? where task_id='t1'", (json.dumps({"turn_count": 70}),))
        db.commit()
        db.close()
        result = self.collect()
        cases = {c["id"]: c["result"] for c in result["cases"]}
        self.assertEqual((cases["C03"], cases["C04"]), ("FAIL", "FAIL"))
        self.assertIn("max_turns_per_round", result["budget"]["used"]["exceeded"])


if __name__ == "__main__":
    unittest.main()
