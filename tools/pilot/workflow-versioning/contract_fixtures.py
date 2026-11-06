#!/usr/bin/env python3
"""Generate or check the W19-01 synthetic contract fixtures (model-free, no clients, no network).

  python3 tools/pilot/workflow-versioning/contract_fixtures.py            write fixtures/
  python3 tools/pilot/workflow-versioning/contract_fixtures.py --check    exit 1 if fixtures/ differ

Every fixture is produced by `contract_model.py` from synthetic inputs defined here, inside a
temporary directory; the committed files contain no machine paths, timestamps of the run or real
instruction text. `fixtures/cases.json` lists each scenario with its acceptance criterion and the
observed outcome code; `fixtures/examples/` holds one example document per format (§ 2–§ 10).
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import contract_model as M  # noqa: E402

HERE = Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures"
AT = "2026-11-06T00:00:00Z"
SOURCE = {"repository": "https://example.invalid/synthetic.git", "commit": "0" * 40}

REQUIRES = {
    "workflow_formats": {"bundle": 1, "lock": 1},
    "bridge": {
        "binding_contract": 1,
        "capabilities": ["feature.lifecycle/v1", "feature.close/v1", "round.recovery/v1", "round.report/v1", "workflow.binding/v1"],
        "known_incompatible": [],
    },
    "standalone": {"node": ">=22.13.0", "python": ">=3.11"},
}
RUNTIME_BINDING = {"package_version": "0.8.0", "workflow_binding": {"contracts": [1], "capabilities": list(M.CAPABILITIES_V1)}}
RUNTIME_OLD = {"package_version": "0.7.0"}  # no workflow_binding advertisement
RUNTIME_NO_CLOSE = {"package_version": "0.8.0", "workflow_binding": {"contracts": [1], "capabilities": [c for c in M.CAPABILITIES_V1 if c != "feature.close/v1"]}}
RUNTIME_CONTRACT2 = {"package_version": "0.9.0", "workflow_binding": {"contracts": [2], "capabilities": list(M.CAPABILITIES_V1)}}


def variants(label: str, extra: str = "") -> dict[str, dict[str, bytes]]:
    """Synthetic client variants: two entries, a guide and a helper per client."""
    out = {}
    for client in M.CLIENTS:
        manifest = {"name": "feature-workflow", "version": label, "description": "synthetic", "skills": "./skills/"}
        files = {
            f".{client}-plugin/plugin.json": M.json_bytes(manifest),
            "skills/feature-plan/SKILL.md": f"---\nname: feature-plan\ndescription: synthetic {label}\n---\nSYNTHETIC-PLAN {label} {client}{extra}\n".encode(),
            "skills/feature-execute/SKILL.md": f"---\nname: feature-execute\ndescription: synthetic {label}\n---\nSYNTHETIC-EXECUTE {label} {client}\n".encode(),
            "skills/feature-execute/scripts/multi_repo.py": b"# synthetic helper\n",
            "workflow/README.md": f"synthetic guide {label}\n".encode(),
            "scripts/select-source.mjs": b"// synthetic bootstrap\n",
        }
        out[client] = files
    return out


class Recorder:
    def __init__(self):
        self.cases = []

    def case(self, case_id: str, ac: list[str], scenario: str, fn):
        try:
            outcome = fn()
            code = outcome.get("result") or outcome.get("code") or "OK"
            detail = {k: v for k, v in outcome.items() if k not in {"result", "code"}}
        except M.ContractError as exc:
            code, detail = exc.code, {k: v for k, v in exc.data.items() if k in {"missing", "problems", "expected", "bound", "reason", "draft_files", "extra"}}
        self.cases.append({"id": case_id, "ac": ac, "scenario": scenario, "outcome": code, **({"detail": detail} if detail else {})})
        return code


def rel_names(paths):
    return sorted(p.name for p in paths)


def generate(out: Path) -> None:
    if out.exists():
        shutil.rmtree(out)
    (out / "examples").mkdir(parents=True)
    rec = Recorder()
    with tempfile.TemporaryDirectory(prefix="w19-01-fixtures-") as tmp:
        root = Path(tmp)
        store = root / "bridge-home" / "workflows"
        a = M.build_bundle(root / "build" / "A", version="1.0.0", requires=REQUIRES, variants=variants("1.0.0"), source=SOURCE)
        b = M.build_bundle(root / "build" / "B", version="1.0.1", requires=REQUIRES, variants=variants("1.0.1", " text-only fix"), source=SOURCE)
        rebuilt = M.build_bundle(root / "build" / "A2", version="1.0.0", requires=REQUIRES, variants=variants("1.0.0"),
                                 source={"repository": SOURCE["repository"], "commit": "1" * 40})
        reused = M.build_bundle(root / "build" / "A3", version="1.0.0", requires=REQUIRES, variants=variants("1.0.0", " changed"), source=SOURCE)

        # ---- § 2/§ 3 release, identity, bundle, store -------------------------------------
        rec.case("REL-01", ["AC-01"], "identity is content-only: same files from another commit give the same identity",
                 lambda: {"code": "SAME_IDENTITY" if rebuilt["identity"] == a["identity"] else "DIFFERENT"})
        rec.case("REL-02", ["AC-01"], "same version number with different bytes is a different identity; release registry refuses it",
                 lambda: release_registry_check([{"version": "1.0.0", "identity": a["identity"]}], reused))
        rec.case("REL-03", ["AC-01"], "workflow-only release: the bridge marketplace entry is unchanged, only the workflow entry differs",
                 lambda: marketplace_entries(split_marketplaces()))
        rec.case("STORE-01", ["AC-03", "AC-08"], "publish A into the store; republish is idempotent",
                 lambda: {"code": "PUBLISHED", "first": M.store_publish(store, root / "build" / "A"), "again": M.store_publish(store, root / "build" / "A")})
        M.store_publish(store, root / "build" / "B")

        def corrupt(kind):
            work = root / "neg" / kind
            shutil.copytree(root / "build" / "A", work)
            if kind == "modified-file":
                (work / "claude/skills/feature-plan/SKILL.md").write_text("tampered\n")
            elif kind == "missing-file":
                (work / "codex/workflow/README.md").unlink()
            elif kind == "extra-file":
                (work / "claude/skills/feature-plan/extra.md").write_text("x\n")
            elif kind == "symlink":
                target = work / "claude/skills/feature-plan/SKILL.md"
                target.unlink()
                os.symlink("/etc/hostname", target)
            elif kind in {"traversal", "recursive", "runtime-owned"}:
                manifest = json.loads((work / "bundle.json").read_text())
                path = {"traversal": "claude/../../outside.md", "recursive": "claude/bundle/bundle.json", "runtime-owned": "claude/skills/using-bridge/SKILL.md"}[kind]
                manifest["files"].append({"path": path, "sha256": "0" * 64, "mode": "644"})
                manifest["files"].sort(key=lambda f: f["path"].encode())
                manifest["identity"] = M.bundle_identity(manifest)
                manifest["workflow_id"] = M.workflow_id(manifest["version"], manifest["identity"])
                (work / "bundle.json").write_bytes(M.json_bytes(manifest))
            elif kind == "manifest-edited":
                manifest = json.loads((work / "bundle.json").read_text())
                manifest["requires"]["bridge"]["capabilities"] = []
                (work / "bundle.json").write_bytes(M.json_bytes(manifest))
            return M.verify_bundle(work)

        for kind in ("modified-file", "missing-file", "extra-file", "symlink", "traversal", "recursive", "runtime-owned", "manifest-edited"):
            rec.case(f"BUNDLE-{kind}", ["AC-08"], f"verification refuses a bundle with {kind}", lambda kind=kind: corrupt(kind))
        rec.case("BUNDLE-expected-identity", ["AC-08"], "store entry whose identity differs from the lock is refused",
                 lambda: M.verify_bundle(store / a["workflow_id"], b["identity"]))

        def collision():
            # A valid but different bundle already occupies the directory name A would use
            # (a 12-hex prefix collision or a misplaced entry): publication must not overwrite it.
            other_store = root / "collide-store"
            shutil.copytree(root / "build" / "B", other_store / a["workflow_id"])
            return M.store_publish(other_store, root / "build" / "A")

        rec.case("STORE-02", ["AC-08"], "store directory exists with a different identity: no overwrite", collision)

        def interrupted():
            s2 = root / "store-interrupted"
            first = M.store_publish(s2, root / "build" / "A", crash_before_rename=True)
            visible = sorted(p.name for p in s2.iterdir() if not p.name.startswith(".staging-"))
            swept = M.store_sweep_staging(s2)
            again = M.store_publish(s2, root / "build" / "A")
            return {"result": "RECOVERED", "first": first, "visible_after_crash": visible, "swept": len(swept), "again": again == a["workflow_id"]}

        rec.case("STORE-03", ["AC-08"], "publication interrupted before rename leaves no visible bundle; retry publishes", interrupted)

        def offline_restore():
            cache = root / "plugin-cache" / "feature-workflow" / "1.0.0" / "bundle"
            shutil.copytree(root / "build" / "A", cache)
            shutil.rmtree(store / a["workflow_id"], ignore_errors=False)
            missing = resolve_store(store, a)
            M.store_publish(store, cache)
            shutil.rmtree(root / "plugin-cache")
            return {"result": "RESTORED", "before": missing, "after": resolve_store(store, a)}

        rec.case("STORE-04", ["AC-03", "AC-08"], "store copy deleted → BUNDLE_MISSING; restore from a plugin bundle of the same identity; then cache deleted and store still serves", offline_restore)

        # ---- § 5 compatibility -----------------------------------------------------------
        for cid, runtime, mode, scenario in (
            ("COMPAT-01", RUNTIME_BINDING, "bridge", "binding runtime, all capabilities"),
            ("COMPAT-02", RUNTIME_OLD, "bridge", "runtime without workflow_binding (e.g. 0.7.0)"),
            ("COMPAT-03", RUNTIME_NO_CLOSE, "bridge", "runtime missing one required capability"),
            ("COMPAT-04", RUNTIME_CONTRACT2, "bridge", "runtime supports only binding contract 2"),
            ("COMPAT-05", RUNTIME_OLD, "standalone", "standalone ignores bridge requirements"),
        ):
            rec.case(cid, ["AC-05", "AC-10"] if mode == "standalone" else ["AC-05"], scenario,
                     lambda runtime=runtime, mode=mode: compat_outcome(M.check_compatibility(a["requires"], runtime, mode=mode)))
        rec.case("COMPAT-06", ["AC-05"], "text-only patch B on the unchanged runtime passes",
                 lambda: compat_outcome(M.check_compatibility(b["requires"], RUNTIME_BINDING, mode="bridge")))

        # ---- § 4 lock and draft ----------------------------------------------------------
        features = root / "repo" / "docs" / "features"

        def begin(token):
            draft = features / f"{M.DRAFT_PREFIX}{token}"
            draft.mkdir(parents=True)
            lock = M.new_lock(a, origin={"kind": "active-plugin", "client": "codex", "plugin_version": "1.0.0"}, at=AT, draft_token=token, feature_id=None)
            M.write_atomic(draft / M.LOCK_NAME, M.json_bytes(lock))
            return lock

        lock_begin = begin("a1b2c3d4")
        rec.case("LOCK-01", ["AC-08"], "lock before brief/index validates", lambda: (M.validate_lock(lock_begin), {"code": "VALID"})[1])
        for cid, mutate, scenario in (
            ("LOCK-02", lambda l: l["origin"].__setitem__("session_id", "x"), "lock with a native session id"),
            ("LOCK-03", lambda l: l["origin"].__setitem__("plugin_root", "/home/u/.codex/plugins/cache"), "lock with an absolute personal path"),
            ("LOCK-04", lambda l: l.__setitem__("status", "running"), "lock with a lifecycle status"),
            ("LOCK-05", lambda l: l.__setitem__("generation", 2), "generation without matching history"),
        ):
            def run(mutate=mutate):
                bad = json.loads(json.dumps(lock_begin))
                mutate(bad)
                M.validate_lock(bad)
                return {"code": "VALID"}
            rec.case(cid, ["AC-08"], scenario, run)

        rec.case("DRAFT-01", ["AC-08"], "draft → final id, no target", lambda: M.finalize_draft(features, "a1b2c3d4", "F-001-search"))
        begin("e5f6a7b8")
        rec.case("DRAFT-02a", ["AC-08"], "crash after marking the draft lock", lambda: M.finalize_draft(features, "e5f6a7b8", "F-002-x", crash_after="mark"))
        rec.case("DRAFT-02b", ["AC-08"], "rerun after crash completes", lambda: M.finalize_draft(features, "e5f6a7b8", "F-002-x"))
        rec.case("DRAFT-02c", ["AC-08"], "rerun after completion is idempotent", lambda: M.finalize_draft(features, "e5f6a7b8", "F-002-x"))
        begin("c0ffee00")
        (features / "F-003-y").mkdir()
        (features / "F-003-y" / "brief.md").write_text("synthetic brief\n")
        rec.case("DRAFT-03a", ["AC-08"], "target holds only the brief: lock moved in; crash after move", lambda: M.finalize_draft(features, "c0ffee00", "F-003-y", crash_after="move"))
        rec.case("DRAFT-03b", ["AC-08"], "rerun after crash after move", lambda: M.finalize_draft(features, "c0ffee00", "F-003-y"))
        begin("deadbeef")
        rec.case("DRAFT-04", ["AC-08"], "target already holds a different lock", lambda: M.finalize_draft(features, "deadbeef", "F-001-search"))
        begin("0badf00d")
        (features / f"{M.DRAFT_PREFIX}0badf00d" / "brief.md").write_text("draft brief\n")
        (features / "F-004-z").mkdir()
        (features / "F-004-z" / "design.md").write_text("other\n")
        rec.case("DRAFT-05", ["AC-08"], "both directories hold documents", lambda: M.finalize_draft(features, "0badf00d", "F-004-z"))
        rec.case("DRAFT-06", ["AC-08"], "the same draft cannot be assigned a second id", lambda: (M.finalize_draft(features, "0badf00d", "F-005-w", crash_after="mark"), M.finalize_draft(features, "0badf00d", "F-006-v"))[1])

        # ---- § 6 bind and attempts -------------------------------------------------------
        fdir = features / "F-001-search"
        lock = M.read_lock(fdir)
        db = {"features": {"F-001-search": {"feature_id": "F-001-search", "state": "ready", "active_task_id": None}}, "attempts": []}
        rec.case("BIND-01", ["AC-05"], "bind refused on a runtime without binding", lambda: M.bind(db, "F-001-search", lock, store, RUNTIME_OLD, key="k-bind", at=AT))
        rec.case("RUN-01", ["AC-07", "AC-08"], "round on an unbound feature is refused", lambda: M.reserve_attempt(db, "F-001-search", "t1", store, manager_ack=a["identity"]))
        binding_doc = M.bind(db, "F-001-search", lock, store, RUNTIME_BINDING, key="k-bind", at=AT)
        rec.case("BIND-02", ["AC-08"], "bind imports the verified lock", lambda: {"code": "BOUND", "generation": binding_doc["generation"]})
        rec.case("BIND-03", ["AC-08"], "repeated bind is idempotent", lambda: {"code": "BOUND", "same": M.bind(db, "F-001-search", lock, store, RUNTIME_BINDING, key="k-bind", at=AT) is binding_doc})
        rec.case("RUN-02", ["AC-04", "AC-06"], "manager acknowledges a different identity", lambda: M.reserve_attempt(db, "F-001-search", "t1", store, manager_ack=b["identity"]))
        rec.case("RUN-03", ["AC-04"], "Codex executor under a binding is refused", lambda: M.reserve_attempt(db, "F-001-search", "t1", store, manager_ack=a["identity"], agent="codex"))
        attempt = M.reserve_attempt(db, "F-001-search", "t1", store, manager_ack=a["identity"])
        rec.case("RUN-04", ["AC-03", "AC-04"], "attempt records identity and generation", lambda: {"code": "RESERVED", "identity_is_A": attempt["workflow_identity"] == a["identity"], "generation": attempt["workflow_generation"]})

        # ---- § 7 switch ------------------------------------------------------------------
        def sw(key, gen=1, crash=None, target=b):
            return M.switch(db, "F-001-search", fdir, store, RUNTIME_BINDING, target_identity=target["identity"], target_workflow_id=target["workflow_id"],
                            expected_generation=gen, key=key, at=AT, crash_after=crash)

        rec.case("SWITCH-01", ["AC-06"], "switch while the attempt is active: refused, nothing changes",
                 lambda: sw("k-sw1"))
        no_effect = db["features"]["F-001-search"]["workflow"]["pending_switch"] is None and M.read_lock(fdir)["generation"] == 1
        M.settle_attempt(db, "F-001-search", attempt, "COMPLETE")
        rec.case("SWITCH-02", ["AC-06"], "stale expected generation", lambda: sw("k-sw2", gen=0))
        db["features"]["F-001-search"]["state"] = "waiting_user"
        rec.case("SWITCH-03", ["AC-06"], "switch while waiting for the user", lambda: sw("k-sw3"))
        db["features"]["F-001-search"]["state"] = "ready"
        states = {}
        for step in ("intent", "commit", "project"):
            # fresh copy per crash point
            db_c = json.loads(json.dumps(db))
            fdir_c = root / f"crash-{step}"
            shutil.copytree(fdir, fdir_c)
            first = M.switch(db_c, "F-001-search", fdir_c, store, RUNTIME_BINDING, target_identity=b["identity"], target_workflow_id=b["workflow_id"],
                             expected_generation=1, key="k-sw", at=AT, crash_after=step)
            states[step] = M.lock_db_state(db_c, "F-001-search", fdir_c)
            blocked = None
            try:
                M.reserve_attempt(db_c, "F-001-search", "t2", store, manager_ack=b["identity"])
            except M.ContractError as exc:
                blocked = exc.code
            again = M.switch(db_c, "F-001-search", fdir_c, store, RUNTIME_BINDING, target_identity=b["identity"], target_workflow_id=b["workflow_id"],
                             expected_generation=1, key="k-sw", at=AT)
            replay = M.switch(db_c, "F-001-search", fdir_c, store, RUNTIME_BINDING, target_identity=b["identity"], target_workflow_id=b["workflow_id"],
                              expected_generation=1, key="k-sw", at=AT)
            history = db_c["features"]["F-001-search"]["workflow"]["history"]
            rec.case(f"SWITCH-crash-{step}", ["AC-06"], f"crash after {step}: status, run blocked, retry completes exactly once",
                     lambda first=first, step=step, blocked=blocked, again=again, replay=replay, history=history, fdir_c=fdir_c, db_c=db_c: {
                         "result": again["result"], "crashed": first["result"], "status_after_crash": states[step], "run_while_pending": blocked,
                         "replay": replay["result"], "switch_entries": sum(1 for h in history if h["op"] == "switch"),
                         "final_status": M.lock_db_state(db_c, "F-001-search", fdir_c)})
        rec.case("SWITCH-04", ["AC-06"], "full switch A→B keeps feature/task ids and appends history",
                 lambda: switch_full(db, fdir, sw, a, b))
        rec.case("SWITCH-05", ["AC-06"], "a second key while a switch is pending is refused",
                 lambda: pending_refusal(db, fdir, store, a, b))
        rec.case("STATUS-01", ["AC-09"], "lock edited by hand to an older generation is reported, never repaired",
                 lambda: projection_behind(db, fdir))
        rec.case("SWITCH-06", ["AC-06", "AC-04"], "first round after the switch must acknowledge B",
                 lambda: {"code": "RESERVED", "identity_is_B": M.reserve_attempt(db, "F-001-search", "t3", store, manager_ack=b["identity"])["workflow_identity"] == b["identity"]})

        # ---- § 10 legacy -----------------------------------------------------------------
        old_files = [{"path": p, "sha256": "1" * 64} for p in (
            ".agents/skills/feature-execute/SKILL.md", ".agents/skills/feature-execute/references/local-delivery.md",
            ".agents/skills/feature-exchange/scripts/feature_exchange.py", ".claude/skills/using-bridge/SKILL.md",
            ".codex/skills/using-bridge/SKILL.md", "docs/features/README.md")]
        part = M.legacy_partition(old_files)
        rec.case("LEGACY-01", ["AC-07"], "legacy snapshot takes only workflow-owned files; roles stay with the current runtime",
                 lambda: {"code": "PARTITIONED", "included": [e["path"] for e in part["included"]], "excluded": part["excluded"]})
        installed = {"0.7.0-6ed9a4537e37", "0.6.2-771e797a73d3"}
        for cid, records, pin, inst, scenario in (
            ("LEGACY-02", ["INSTRUCTIONS=runtime:0.7.0-6ed9a4537e37 SET=8c05792ad75e"], "0.8.0-aaaaaaaaaaaa", installed, "ledger record proves the old set"),
            ("LEGACY-03", ["INSTRUCTIONS=runtime:0.6.2-771e797a73d3 SET=aaaa", "INSTRUCTIONS=runtime:0.7.0-6ed9a4537e37 SET=bbbb"], "0.8.0-aaaaaaaaaaaa", installed, "ambiguous history (pin moved during the feature)"),
            ("LEGACY-04", [], None, installed, "no record and no pin"),
            ("LEGACY-05", ["INSTRUCTIONS=runtime:0.7.0-6ed9a4537e37 SET=8c05792ad75e"], "0.8.0-aaaaaaaaaaaa", {"0.6.2-771e797a73d3"}, "interrupted upgrade: old runtime removed"),
            ("LEGACY-06", [], "0.7.0-6ed9a4537e37", installed, "no ledger record: pin before upgrade is the basis"),
            ("LEGACY-07", ["INSTRUCTIONS=plugin:feature-workflow@0.7.0 DIGEST=abcd"], None, installed, "only a standalone plugin record: unproven, never latest"),
        ):
            rec.case(cid, ["AC-07"], scenario, lambda records=records, pin=pin, inst=inst: {"code": M.legacy_evidence(records, pin, inst)["verdict"], **{k: v for k, v in M.legacy_evidence(records, pin, inst).items() if k != "verdict"}})

        # ---- § 4.2 / § 10.4 resolve matrix ------------------------------------------------
        matrix = [
            ("RESOLVE-01", ["AC-02"], "new feature, binding runtime", M.ResolveInput("new", "binding-runtime")),
            ("RESOLVE-02", ["AC-10"], "new feature, no bridge (standalone)", M.ResolveInput("new", "none")),
            ("RESOLVE-03", ["AC-07"], "new plugin + old pin: NEW feature", M.ResolveInput("new", "old-runtime")),
            ("RESOLVE-04", ["AC-07"], "new plugin + old pin: EXISTING lock-less feature", M.ResolveInput("lockless", "old-runtime")),
            ("RESOLVE-05", ["AC-07"], "existing lock-less feature after one-time upgrade, proven set", M.ResolveInput("lockless", "binding-runtime")),
            ("RESOLVE-06", ["AC-07"], "existing lock-less feature, ambiguous history", M.ResolveInput("lockless", "binding-runtime", legacy="ambiguous")),
            ("RESOLVE-07", ["AC-03"], "locked feature, bundle present", M.ResolveInput("locked", "binding-runtime")),
            ("RESOLVE-08", ["AC-08"], "locked feature, bundle missing", M.ResolveInput("locked", "binding-runtime", lock_bundle="missing")),
            ("RESOLVE-09", ["AC-08"], "locked feature, bundle corrupt", M.ResolveInput("locked", "binding-runtime", lock_bundle="corrupt")),
            ("RESOLVE-10", ["AC-10"], "locked feature, standalone", M.ResolveInput("locked", "none", standalone=True)),
            ("RESOLVE-11", ["AC-05"], "new feature, incompatible workflow", M.ResolveInput("new", "binding-runtime", compatible=False)),
            ("RESOLVE-12", ["AC-02"], "new feature from an old plugin without bundle", M.ResolveInput("new", "binding-runtime", plugin_bundle="absent")),
            ("RESOLVE-13", ["AC-07"], "locked feature after the pin was downgraded to a runtime without binding", M.ResolveInput("locked", "old-runtime")),
            ("RESOLVE-14", ["AC-10"], "existing lock-less standalone feature", M.ResolveInput("lockless", "none", standalone=True)),
        ]
        for cid, ac, scenario, inp in matrix:
            rec.case(cid, ac, scenario, lambda inp=inp: M.resolve(inp))

        # ---- examples ---------------------------------------------------------------------
        examples = {
            "release.json": {"format": M.RELEASE_FORMAT, "component": M.COMPONENT, "version": "1.0.0", "tag": "workflow-v1.0.0", "requires": REQUIRES,
                             "notes": ["Source, not generated. The generator reads version/requires from here."]},
            "releases.json": {"format": "feature-workflow.releases/v1", "releases": [{"version": "1.0.0", "identity": a["identity"], "commit": SOURCE["commit"]},
                                                                                    {"version": "1.0.1", "identity": b["identity"], "commit": SOURCE["commit"]}]},
            "bundle-A.json": json.loads((root / "build" / "A" / "bundle.json").read_text()),
            "lock-begin.json": lock_begin,
            "lock-final-after-switch.json": M.read_lock(fdir),
            "binding-after-switch.json": db["features"]["F-001-search"]["workflow"],
            "attempts.json": db["attempts"],
            "runtime-advertisement.json": {"format": "claude-codex-bridge.runtime/v1 (excerpt)", "compatibility": {"state_schema_version": 7, "workflow_binding": RUNTIME_BINDING["workflow_binding"]}},
            "legacy-profile.json": {
                "format": M.LEGACY_PROFILE_FORMAT, "runtime_id": "0.7.0-6ed9a4537e37", "runtime_commit": "6ed9a4537e376165aa72bbd5a52cb0c41988a90a",
                "instructions_set_sha256": "8c05792ad75e7550eddc00c4ef26eb1c7096951e2be384508321e39bfb78a4ed",
                "workflow_files": "only paths under .agents/skills/feature-* and docs/features/README.md, hashes from the runtime manifest",
                "adapter": {"name": "legacy-adapter/v1", "sha256": "<sha256 of the adapter source that generated the client variants>"},
                "requires": {"workflow_formats": {"bundle": 1, "lock": 1}, "bridge": {"binding_contract": 1, "capabilities": ["feature.lifecycle/v1", "feature.close/v1", "round.recovery/v1", "round.report/v1"], "known_incompatible": []}},
                "declared_by": "bridge runtime legacy-profile table (synthetic example)",
            },
            "resolve-bound.json": resolve_example(a),
        }
        for name, value in examples.items():
            (out / "examples" / name).write_bytes(M.json_bytes(value))
        assert no_effect, "SWITCH-01 must not change anything"
    (out / "cases.json").write_bytes(M.json_bytes({"format": "w19-01.contract-cases/v1", "cases": rec.cases}))


# ---------------------------------------------------------------------------
# helpers producing case outcomes
# ---------------------------------------------------------------------------


def release_registry_check(registry: list[dict], manifest: dict) -> dict:
    for entry in registry:
        if entry["version"] == manifest["version"] and entry["identity"] != manifest["identity"]:
            raise M.ContractError("VERSION_REUSED", manifest["version"])
    return {"code": "NEW_RELEASE"}


def split_marketplaces():
    before = {"plugins": [{"name": "bridge-claude", "source": "./plugins/bridge-claude", "version": "0.8.0"},
                          {"name": "feature-workflow", "source": "./plugins/feature-workflow-claude", "version": "1.0.0"}]}
    after = {"plugins": [{"name": "bridge-claude", "source": "./plugins/bridge-claude", "version": "0.8.0"},
                         {"name": "feature-workflow", "source": "./plugins/feature-workflow-claude", "version": "1.0.1"}]}
    return before, after


def marketplace_entries(pair):
    before, after = pair
    entry = lambda doc, name: next(p for p in doc["plugins"] if p["name"] == name)  # noqa: E731
    return {"code": "BRIDGE_ENTRY_UNCHANGED" if M.canonical_json(entry(before, "bridge-claude")) == M.canonical_json(entry(after, "bridge-claude")) else "CHANGED",
            "workflow_entry_changed": entry(before, "feature-workflow") != entry(after, "feature-workflow")}


def compat_outcome(problems):
    return {"code": "COMPATIBLE"} if not problems else {"code": problems[0]["code"], "problems": problems}


def resolve_store(store: Path, manifest: dict) -> str:
    try:
        M.verify_bundle(store / manifest["workflow_id"], manifest["identity"])
        return "BOUND_BUNDLE"
    except M.ContractError as exc:
        return exc.code


def switch_full(db, fdir, sw, a, b):
    result = sw("k-sw-final")
    feature = db["features"]["F-001-search"]
    return {"result": result["result"], "generation": feature["workflow"]["generation"], "lock_generation": M.read_lock(fdir)["generation"],
            "history_ops": [h["op"] for h in feature["workflow"]["history"]], "feature_id": feature["feature_id"],
            "attempt_t1_still_A": db["attempts"][0]["workflow_identity"] == a["identity"], "status": M.lock_db_state(db, "F-001-search", fdir)}


def pending_refusal(db, fdir, store, a, b):
    db_c = json.loads(json.dumps(db))
    fdir_c = fdir.parent / "pending-copy"
    shutil.copytree(fdir, fdir_c)
    M.switch(db_c, "F-001-search", fdir_c, store, RUNTIME_BINDING, target_identity=a["identity"], target_workflow_id=a["workflow_id"],
             expected_generation=2, key="k-back", at=AT, crash_after="intent")
    return M.switch(db_c, "F-001-search", fdir_c, store, RUNTIME_BINDING, target_identity=a["identity"], target_workflow_id=a["workflow_id"],
                    expected_generation=2, key="k-other", at=AT)


def projection_behind(db, fdir):
    copy = fdir.parent / "behind-copy"
    shutil.copytree(fdir, copy)
    lock = json.loads((copy / M.LOCK_NAME).read_text())
    lock["history"] = lock["history"][:1]
    lock["generation"] = 1
    first = lock["history"][0]
    lock["workflow"] = {"version": first["version"], "identity": first["identity"], "workflow_id": M.workflow_id(first["version"], first["identity"]), "kind": "release"}
    (copy / M.LOCK_NAME).write_bytes(M.json_bytes(lock))
    before = (copy / M.LOCK_NAME).read_bytes()
    state = M.lock_db_state(db, "F-001-search", copy)
    return {"code": state.upper().replace("-", "_"), "file_unchanged_by_status": (copy / M.LOCK_NAME).read_bytes() == before}


def resolve_example(a):
    return {
        "format": M.RESOLVE_FORMAT, "reads_only": True, "source": "bundle", "code": "BOUND_BUNDLE",
        "feature": {"feature_id": "F-001-search", "lock": "docs/features/F-001-search/workflow.lock.json", "generation": 2},
        "bundle": {"version": a["version"], "identity": a["identity"], "workflow_id": a["workflow_id"], "root": "<bridge-home>/workflows/" + a["workflow_id"],
                   "client_root": "<bridge-home>/workflows/" + a["workflow_id"] + "/codex", "verified": "full"},
        "entry": {"plugin": "feature-workflow", "version": "1.0.1", "identity": "<identity of the active plugin's own bundle>", "same_as_bound": False},
        "instructions": {"workflow_skills": "<client_root>/skills", "guide": "<client_root>/workflow/README.md",
                         "exchange_helper": "<client_root>/skills/feature-exchange/scripts/feature_exchange.py"},
        "record": f"INSTRUCTIONS=bundle:{a['workflow_id']} IDENTITY={a['identity']} GENERATION=2",
        "next_step": None,
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    if not args.check:
        generate(FIXTURES)
        print(f"wrote {FIXTURES.relative_to(HERE.parents[2])}")
        return 0
    with tempfile.TemporaryDirectory(prefix="w19-01-check-") as tmp:
        fresh = Path(tmp) / "fixtures"
        generate(fresh)
        problems = []
        want = {p.relative_to(fresh).as_posix(): p.read_bytes() for p in fresh.rglob("*") if p.is_file()}
        have = {p.relative_to(FIXTURES).as_posix(): p.read_bytes() for p in FIXTURES.rglob("*") if p.is_file()} if FIXTURES.exists() else {}
        for name in sorted(set(want) | set(have)):
            if want.get(name) != have.get(name):
                problems.append(name)
        if problems:
            print("fixtures differ from a fresh generation: " + ", ".join(problems), file=sys.stderr)
            return 1
        print(f"fixtures reproduce byte-for-byte ({len(want)} files)")
        return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
