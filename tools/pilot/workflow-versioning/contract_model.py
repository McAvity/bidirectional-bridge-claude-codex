"""Executable reference semantics of the W19-01 workflow-binding contract.

Contract: docs/features/F-W19-workflow-versioning/contracts/01-workflow-binding.md. Section
numbers below (§ n) refer to it.

This is a *reference model* for fixtures and contract tests, not the product. The product
helper (W19-02, Node), the bridge binding (W19-03, TypeScript/SQLite) and the bootstrap (W19-04)
must produce the same identities, verdicts and codes for the same inputs; the committed fixtures
are the shared examples. Standard library only, Python 3.11+.

Database state is simulated by a JSON document; filesystem steps use real files so the crash
points, symlink and traversal checks act on a real directory tree.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import stat
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

# ---------------------------------------------------------------------------
# § 2 formats and identities
# ---------------------------------------------------------------------------

RELEASE_FORMAT = "feature-workflow.release/v1"
BUNDLE_FORMAT = "feature-workflow.bundle/v1"
LOCK_FORMAT = "feature-workflow.lock/v1"
BINDING_FORMAT = "bridge.workflow-binding/v1"
LEGACY_PROFILE_FORMAT = "feature-workflow.legacy-profile/v1"
RESOLVE_FORMAT = "feature-workflow.instruction-source/v2"
COMPONENT = "feature-workflow"
CLIENTS = ("claude", "codex")
BUNDLE_MANIFEST = "bundle.json"
LOCK_NAME = "workflow.lock.json"
DRAFT_PREFIX = ".draft-"
# Paths a workflow bundle may never contain: runtime-owned roles and API instructions (§ 3.2).
RUNTIME_OWNED = ("skills/using-bridge/", "skills/bridge-upgrade/", "skills/bridge/")
# Capabilities defined by binding contract 1 (§ 5.2).
CAPABILITIES_V1 = (
    "feature.lifecycle/v1",
    "feature.close/v1",
    "round.recovery/v1",
    "round.report/v1",
    "workflow.binding/v1",
)


class ContractError(Exception):
    """A refusal with a stable code (§ 9)."""

    def __init__(self, code: str, detail: str = "", **data):
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.detail = detail
        self.data = data


def canonical_json(value) -> bytes:
    """Canonical serialization used for identities: sorted keys, no whitespace, UTF-8 (§ 2.1).

    Only strings, integers, booleans, null, arrays and objects are allowed; floats are refused
    so Node and Python serialize identically.
    """

    def check(item):
        if isinstance(item, float):
            raise ContractError("FORMAT_INVALID", "floats are not allowed in identity-bearing JSON")
        if isinstance(item, dict):
            for key, inner in item.items():
                if not isinstance(key, str):
                    raise ContractError("FORMAT_INVALID", "object keys must be strings")
                check(inner)
        elif isinstance(item, list):
            for inner in item:
                check(inner)

    check(value)
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def bundle_identity(manifest: dict) -> str:
    """`sha256:<hex>` over the identity-bearing fields only (§ 2.2); `source` is provenance."""
    body = {key: manifest[key] for key in ("format", "component", "kind", "version", "requires", "variants", "files", "legacy") if key in manifest}
    return "sha256:" + sha256_hex(canonical_json(body))


def workflow_id(version: str, identity: str) -> str:
    """Store directory name `<version>-<12 hex>` (§ 2.3); the full identity is always verified."""
    return f"{version}-{identity.split(':', 1)[1][:12]}"


def safe_relpath(path: str) -> bool:
    pure = PurePosixPath(path)
    return bool(path) and not pure.is_absolute() and ".." not in pure.parts and "\\" not in path and pure.as_posix() == path


def json_bytes(value) -> bytes:
    """Stable on-disk JSON: two-space indent, sorted keys, trailing newline."""
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")


# ---------------------------------------------------------------------------
# § 3 bundle build, verify, store
# ---------------------------------------------------------------------------


def build_bundle(directory: Path, *, version: str, requires: dict, variants: dict[str, dict[str, bytes]],
                 source: dict, kind: str = "release", legacy: dict | None = None) -> dict:
    """Write a bundle directory: `bundle.json` + `<client>/<files>` (§ 3.1)."""
    if directory.exists():
        shutil.rmtree(directory)
    directory.mkdir(parents=True)
    files = []
    for client in CLIENTS:
        for rel, data in sorted(variants[client].items()):
            if rel.startswith("bundle/") or rel == "GENERATED.json":
                raise ContractError("BUNDLE_RECURSIVE", f"{client}/{rel}")
            if any(rel.startswith(prefix) for prefix in RUNTIME_OWNED):
                raise ContractError("BUNDLE_RUNTIME_OWNED", f"{client}/{rel}")
            target = directory / client / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            mode = "755" if rel.endswith((".py", ".mjs")) else "644"
            os.chmod(target, int(mode, 8))
            files.append({"path": f"{client}/{rel}", "sha256": sha256_hex(data), "mode": mode})
    manifest = {
        "format": BUNDLE_FORMAT,
        "component": COMPONENT,
        "kind": kind,
        "version": version,
        "requires": requires,
        "variants": {client: {"root": client, "plugin_manifest": f".{client}-plugin/plugin.json"} for client in CLIENTS},
        "files": sorted(files, key=lambda f: f["path"].encode()),
        "source": source,
    }
    if legacy is not None:
        manifest["legacy"] = legacy
    manifest["identity"] = bundle_identity(manifest)
    manifest["workflow_id"] = workflow_id(version, manifest["identity"])
    (directory / BUNDLE_MANIFEST).write_bytes(json_bytes(manifest))
    return manifest


def verify_bundle(directory: Path, expected_identity: str | None = None) -> dict:
    """Full verification (§ 3.3). Returns the manifest or raises ContractError."""
    if directory.is_symlink() or not directory.is_dir():
        raise ContractError("BUNDLE_MISSING", str(directory.name))
    manifest_path = directory / BUNDLE_MANIFEST
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise ContractError("BUNDLE_MISSING", "bundle.json")
    try:
        manifest = json.loads(manifest_path.read_text("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise ContractError("BUNDLE_CORRUPT", f"bundle.json: {exc}") from exc
    if manifest.get("format") != BUNDLE_FORMAT:
        raise ContractError("FORMAT_UNSUPPORTED", str(manifest.get("format")))
    if bundle_identity(manifest) != manifest.get("identity"):
        raise ContractError("BUNDLE_CORRUPT", "identity does not match manifest content")
    if manifest.get("workflow_id") != workflow_id(manifest.get("version", ""), manifest["identity"]):
        raise ContractError("BUNDLE_CORRUPT", "workflow_id does not derive from version and identity")
    if expected_identity is not None and manifest["identity"] != expected_identity:
        raise ContractError("BUNDLE_IDENTITY_MISMATCH", manifest["identity"], expected=expected_identity)
    listed = {}
    for entry in manifest["files"]:
        path = entry["path"]
        if not safe_relpath(path) or path.split("/", 1)[0] not in CLIENTS:
            raise ContractError("BUNDLE_PATH_UNSAFE", path)
        inner = path.split("/", 1)[1]
        if inner.startswith("bundle/"):
            raise ContractError("BUNDLE_RECURSIVE", path)
        if any(inner.startswith(prefix) for prefix in RUNTIME_OWNED):
            raise ContractError("BUNDLE_RUNTIME_OWNED", path)
        listed[path] = entry
    actual = set()
    for current, dirs, names in os.walk(directory, followlinks=False):
        here = Path(current)
        for name in list(dirs) + names:
            full = here / name
            rel = full.relative_to(directory).as_posix()
            if full.is_symlink():
                raise ContractError("BUNDLE_SYMLINK", rel)
            if full.is_file() and rel != BUNDLE_MANIFEST:
                actual.add(rel)
    missing = sorted(set(listed) - actual)
    extra = sorted(actual - set(listed))
    if missing:
        raise ContractError("BUNDLE_INCOMPLETE", missing[0], missing=missing)
    if extra:
        raise ContractError("BUNDLE_EXTRA_FILES", extra[0], extra=extra)
    for path, entry in listed.items():
        if sha256_hex((directory / path).read_bytes()) != entry["sha256"]:
            raise ContractError("BUNDLE_CORRUPT", path)
    return manifest


def store_publish(store: Path, bundle_dir: Path, *, crash_before_rename: bool = False) -> str:
    """Copy a verified bundle into `<store>/<workflow_id>/` atomically (§ 3.4)."""
    manifest = verify_bundle(bundle_dir)
    target = store / manifest["workflow_id"]
    if target.exists() or target.is_symlink():
        existing = verify_bundle(target)  # raises on corruption: never overwritten silently
        if existing["identity"] != manifest["identity"]:
            raise ContractError("STORE_ID_COLLISION", manifest["workflow_id"])
        return manifest["workflow_id"]
    store.mkdir(parents=True, exist_ok=True)
    staging = store / f".staging-{manifest['workflow_id']}-{os.getpid()}"
    if staging.exists():
        shutil.rmtree(staging)
    shutil.copytree(bundle_dir, staging, symlinks=True)
    verify_bundle(staging, manifest["identity"])
    if crash_before_rename:
        return "CRASHED"
    os.rename(staging, target)
    for current, dirs, names in os.walk(target):
        for name in names:
            path = Path(current) / name
            path.chmod(path.stat().st_mode & ~(stat.S_IWUSR | stat.S_IWGRP | stat.S_IWOTH))
    return manifest["workflow_id"]


def store_sweep_staging(store: Path) -> list[str]:
    """Interrupted publications leave only `.staging-*`; they are never read as bundles."""
    removed = []
    for entry in sorted(store.glob(".staging-*")):
        shutil.rmtree(entry)
        removed.append(entry.name)
    return removed


# ---------------------------------------------------------------------------
# § 5 compatibility
# ---------------------------------------------------------------------------


def check_compatibility(requires: dict, runtime: dict | None, *, mode: str) -> list[dict]:
    """Problems that block dependent work (§ 5.3). `runtime` is the runtime's advertisement.

    mode: "standalone" ignores bridge requirements (§ 5.4); "bridge" applies them.
    """
    problems = []
    formats = requires.get("workflow_formats", {})
    for name, supported in (("lock", 1), ("bundle", 1)):
        if formats.get(name, supported) != supported:
            problems.append({"code": "FORMAT_UNSUPPORTED", "what": name, "required": formats.get(name), "supported": supported})
    if mode == "standalone":
        return problems
    bridge = requires.get("bridge", {})
    if runtime is None or "workflow_binding" not in runtime:
        problems.append({"code": "RUNTIME_WITHOUT_BINDING", "next_step": "one-time runtime upgrade to a runtime advertising workflow_binding"})
        return problems
    advert = runtime["workflow_binding"]
    contract = bridge.get("binding_contract")
    if contract not in advert.get("contracts", []):
        problems.append({"code": "BINDING_CONTRACT_UNSUPPORTED", "required": contract, "supported": advert.get("contracts", [])})
    missing = sorted(set(bridge.get("capabilities", [])) - set(advert.get("capabilities", [])))
    if missing:
        problems.append({"code": "CAPABILITY_MISSING", "missing": missing})
    for rule in bridge.get("known_incompatible", []):
        if runtime.get("package_version") in rule.get("versions", []):
            problems.append({"code": "RUNTIME_KNOWN_INCOMPATIBLE", "runtime": runtime.get("package_version"), "reason": rule.get("reason")})
    return problems


# ---------------------------------------------------------------------------
# § 4 lock, draft path and finalize
# ---------------------------------------------------------------------------


def new_lock(manifest: dict, *, origin: dict, at: str, draft_token: str | None, feature_id: str | None) -> dict:
    entry = {"generation": 1, "op": "begin", "version": manifest["version"], "identity": manifest["identity"], "origin": origin["kind"], "at": at}
    return {
        "format": LOCK_FORMAT,
        "feature": {"feature_id": feature_id, "draft_token": draft_token},
        "workflow": {"version": manifest["version"], "identity": manifest["identity"], "workflow_id": manifest["workflow_id"], "kind": manifest["kind"]},
        "generation": 1,
        "origin": origin,
        "history": [entry],
    }


FORBIDDEN_LOCK_KEYS = {"session_id", "native_thread_id", "thread_id", "path", "home", "approval", "consent", "state", "status", "phase", "user"}


def validate_lock(lock: dict) -> None:
    if lock.get("format") != LOCK_FORMAT:
        raise ContractError("LOCK_FORMAT_UNSUPPORTED", str(lock.get("format")))

    def walk(value, where):
        if isinstance(value, dict):
            for key, inner in value.items():
                if key in FORBIDDEN_LOCK_KEYS:
                    raise ContractError("LOCK_INVALID", f"forbidden key {where}{key}")
                walk(inner, f"{where}{key}.")
        elif isinstance(value, list):
            for inner in value:
                walk(inner, where)
        elif isinstance(value, str) and (value.startswith("/") or value.startswith("~")):
            raise ContractError("LOCK_INVALID", f"absolute path in {where.rstrip('.')}")

    walk(lock, "")
    history = lock.get("history", [])
    if not history or history[-1]["generation"] != lock["generation"] or history[-1]["identity"] != lock["workflow"]["identity"]:
        raise ContractError("LOCK_INVALID", "history head does not match the current selection")
    if [h["generation"] for h in history] != list(range(1, len(history) + 1)):
        raise ContractError("LOCK_INVALID", "generations must be 1..n without gaps")
    if workflow_id(lock["workflow"]["version"], lock["workflow"]["identity"]) != lock["workflow"]["workflow_id"]:
        raise ContractError("LOCK_INVALID", "workflow_id does not derive from identity")


def write_atomic(path: Path, data: bytes) -> None:
    temp = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    temp.write_bytes(data)
    os.replace(temp, path)


def read_lock(feature_dir: Path) -> dict | None:
    path = feature_dir / LOCK_NAME
    if not path.exists():
        return None
    try:
        lock = json.loads(path.read_text("utf-8"))
    except ValueError as exc:
        raise ContractError("LOCK_INVALID", str(exc)) from exc
    validate_lock(lock)
    return lock


def finalize_draft(features_root: Path, draft_token: str, feature_id: str, *, crash_after: str | None = None) -> dict:
    """Draft path → final feature id (§ 4.4). Idempotent; resumable after each crash point.

    Steps: (1) mark the draft lock with the final id, (2) rename the draft directory (or move the
    lock into an existing lock-less target that holds only design documents), (3) done.
    """
    draft = features_root / f"{DRAFT_PREFIX}{draft_token}"
    target = features_root / feature_id
    target_lock = read_lock(target) if target.is_dir() else None
    if target_lock is not None:
        if target_lock["feature"].get("draft_token") == draft_token and target_lock["feature"].get("feature_id") == feature_id:
            if draft.exists() and not any(draft.iterdir()):
                draft.rmdir()
            return {"result": "ALREADY_FINAL", "feature_dir": feature_id}
        raise ContractError("FEATURE_DIR_COLLISION", feature_id, reason="target already holds a different workflow lock")
    if not draft.is_dir():
        raise ContractError("DRAFT_MISSING", draft.name)
    lock = read_lock(draft)
    if lock is None:
        raise ContractError("DRAFT_MISSING", f"{draft.name}/{LOCK_NAME}")
    if lock["feature"]["feature_id"] not in (None, feature_id):
        raise ContractError("DRAFT_ALREADY_ASSIGNED", lock["feature"]["feature_id"])
    if lock["feature"]["feature_id"] is None:
        lock["feature"]["feature_id"] = feature_id
        write_atomic(draft / LOCK_NAME, json_bytes(lock))
    if crash_after == "mark":
        return {"result": "CRASHED", "after": "mark"}
    if target.exists():
        others = sorted(p.name for p in draft.iterdir() if p.name != LOCK_NAME)
        if others:
            raise ContractError("FEATURE_DIR_COLLISION", feature_id, reason="both directories hold documents", draft_files=others)
        os.replace(draft / LOCK_NAME, target / LOCK_NAME)
        if crash_after == "move":
            return {"result": "CRASHED", "after": "move"}
        draft.rmdir()
    else:
        os.rename(draft, target)
    return {"result": "FINALIZED", "feature_dir": feature_id}


# ---------------------------------------------------------------------------
# § 6 bind, attempts and switch (database simulated as a dict)
# ---------------------------------------------------------------------------


def bind(db: dict, feature_id: str, lock: dict, store: Path, runtime: dict, *, key: str, at: str) -> dict:
    feature = db["features"][feature_id]
    manifest = verify_bundle(store / lock["workflow"]["workflow_id"], lock["workflow"]["identity"])
    problems = check_compatibility(manifest["requires"], runtime, mode="bridge")
    if problems:
        raise ContractError(problems[0]["code"], "", problems=problems)
    existing = feature.get("workflow")
    if existing is not None:
        if existing["identity"] == lock["workflow"]["identity"] and existing["generation"] == lock["generation"]:
            return existing  # idempotent re-import
        raise ContractError("WORKFLOW_ALREADY_BOUND", existing["identity"])
    binding = {
        "format": BINDING_FORMAT,
        "identity": lock["workflow"]["identity"],
        "version": lock["workflow"]["version"],
        "workflow_id": lock["workflow"]["workflow_id"],
        "kind": lock["workflow"]["kind"],
        "generation": lock["generation"],
        "lock_sha256_at_bind": sha256_hex(json_bytes(lock)),
        "history": [{"generation": lock["generation"], "op": "bind", "identity": lock["workflow"]["identity"], "at": at, "idempotency_key": key}],
        "pending_switch": None,
    }
    feature["workflow"] = binding
    return binding


def reserve_attempt(db: dict, feature_id: str, task_id: str, store: Path, *, manager_ack: str | None, agent: str = "claude") -> dict:
    """Round reservation (§ 6.3): the attempt records identity and generation it runs with."""
    feature = db["features"][feature_id]
    binding = feature.get("workflow")
    if binding is None:
        raise ContractError("WORKFLOW_UNBOUND", feature_id)
    if binding["pending_switch"] is not None:
        raise ContractError("WORKFLOW_SWITCH_PENDING", binding["pending_switch"]["target_identity"])
    if agent != "claude":
        raise ContractError("WORKFLOW_EXECUTOR_UNSUPPORTED", agent)
    if manager_ack != binding["identity"]:
        raise ContractError("WORKFLOW_ACK_MISMATCH", str(manager_ack), bound=binding["identity"])
    verify_bundle(store / binding["workflow_id"], binding["identity"])
    attempt = {"task_id": task_id, "attempt": 1 + sum(1 for a in db["attempts"] if a["task_id"] == task_id),
               "workflow_identity": binding["identity"], "workflow_generation": binding["generation"], "outcome": None}
    db["attempts"].append(attempt)
    feature["active_task_id"] = task_id
    return attempt


def settle_attempt(db: dict, feature_id: str, attempt: dict, outcome: str) -> None:
    attempt["outcome"] = outcome
    db["features"][feature_id]["active_task_id"] = None


SWITCH_STEPS = ("intent", "commit", "project")


def switch(db: dict, feature_id: str, feature_dir: Path, store: Path, runtime: dict, *, target_identity: str,
           target_workflow_id: str, expected_generation: int, key: str, at: str, crash_after: str | None = None) -> dict:
    """Explicit switch (§ 7): verified bundle → durable intent → commit → lock projection."""
    feature = db["features"][feature_id]
    binding = feature.get("workflow")
    if binding is None:
        raise ContractError("WORKFLOW_UNBOUND", feature_id)
    pending = binding["pending_switch"]
    if pending is not None:
        if pending["idempotency_key"] != key:
            raise ContractError("WORKFLOW_SWITCH_PENDING", pending["target_identity"])
        return recover_switch(db, feature_id, feature_dir, at=at, crash_after=crash_after)
    for past in binding["history"]:
        if past.get("idempotency_key") == key and past["op"] == "switch":
            return {"result": "ALREADY_APPLIED", "generation": past["generation"]}
    if binding["generation"] != expected_generation:
        raise ContractError("WORKFLOW_GENERATION_CONFLICT", str(binding["generation"]), expected=expected_generation)
    if feature.get("active_task_id") is not None or any(a["outcome"] is None for a in db["attempts"] if a["workflow_identity"] == binding["identity"]):
        raise ContractError("WORKFLOW_SWITCH_ACTIVE_ATTEMPT", str(feature.get("active_task_id")))
    if feature.get("state") == "waiting_user":
        raise ContractError("WORKFLOW_SWITCH_WAITING_USER", feature_id)
    manifest = verify_bundle(store / target_workflow_id, target_identity)
    problems = check_compatibility(manifest["requires"], runtime, mode="bridge")
    if problems:
        raise ContractError(problems[0]["code"], "", problems=problems)
    binding["pending_switch"] = {
        "idempotency_key": key, "from_identity": binding["identity"], "from_generation": binding["generation"],
        "target_identity": target_identity, "target_workflow_id": target_workflow_id, "target_version": manifest["version"],
        "target_kind": manifest["kind"], "step": "intent", "at": at,
    }
    if crash_after == "intent":
        return {"result": "CRASHED", "after": "intent"}
    return recover_switch(db, feature_id, feature_dir, at=at, crash_after=crash_after)


def recover_switch(db: dict, feature_id: str, feature_dir: Path, *, at: str, crash_after: str | None = None) -> dict:
    """Completes a pending switch exactly once from whatever step was durable (§ 7.3)."""
    binding = db["features"][feature_id]["workflow"]
    pending = binding["pending_switch"]
    if pending is None:
        return {"result": "NOTHING_PENDING", "generation": binding["generation"]}
    if pending["step"] == "intent":
        binding.update({"identity": pending["target_identity"], "workflow_id": pending["target_workflow_id"],
                        "version": pending["target_version"], "kind": pending["target_kind"], "generation": pending["from_generation"] + 1})
        binding["history"].append({"generation": binding["generation"], "op": "switch", "identity": binding["identity"],
                                   "from_identity": pending["from_identity"], "at": at, "idempotency_key": pending["idempotency_key"]})
        pending["step"] = "commit"
        if crash_after == "commit":
            return {"result": "CRASHED", "after": "commit"}
    if pending["step"] == "commit":
        lock = read_lock(feature_dir)
        if lock["generation"] < binding["generation"]:
            lock["workflow"] = {"version": binding["version"], "identity": binding["identity"], "workflow_id": binding["workflow_id"], "kind": binding["kind"]}
            lock["generation"] = binding["generation"]
            lock["origin"] = {"kind": "switch", "from_identity": pending["from_identity"]}
            lock["history"].append({"generation": binding["generation"], "op": "switch", "version": binding["version"],
                                    "identity": binding["identity"], "origin": "switch", "at": at})
            write_atomic(feature_dir / LOCK_NAME, json_bytes(lock))
        if crash_after == "project":
            return {"result": "CRASHED", "after": "project"}
        binding["pending_switch"] = None
    return {"result": "SWITCHED", "generation": binding["generation"]}


def lock_db_state(db: dict, feature_id: str, feature_dir: Path) -> str:
    """Status classification (§ 8): read-only, never repairs."""
    binding = db["features"][feature_id].get("workflow")
    lock = read_lock(feature_dir)
    if binding is None:
        return "unbound-with-lock" if lock else "legacy-unbound"
    if binding["pending_switch"] is not None:
        return f"switch-pending:{binding['pending_switch']['step']}"
    if lock is None:
        return "lock-missing"
    if lock["generation"] == binding["generation"] and lock["workflow"]["identity"] == binding["identity"]:
        return "in-sync"
    if lock["generation"] < binding["generation"]:
        return "projection-behind"
    return "diverged"


# ---------------------------------------------------------------------------
# § 10 legacy
# ---------------------------------------------------------------------------

LEGACY_INCLUDE = (".agents/skills/feature-", "docs/features/README.md")
LEGACY_EXCLUDE_REASON = {
    ".codex/skills/using-bridge/": "runtime-owned role (served by the current runtime)",
    ".claude/skills/using-bridge/": "runtime-owned role (served by the current runtime)",
    "plugins/bridge-claude/": "bridge package (would override current roles by plugin name)",
    "plugins/bridge-codex/": "bridge package",
    "scripts/plugin-packages/skills/bridge-upgrade/": "runtime-owned upgrade skill",
}


def legacy_partition(runtime_files: list[dict]) -> dict:
    """Split an old runtime's instruction set into workflow-owned and runtime-owned (§ 10.2)."""
    included, excluded = [], []
    for entry in runtime_files:
        path = entry["path"]
        if path.startswith(LEGACY_INCLUDE[0]) or path == LEGACY_INCLUDE[1]:
            included.append(entry)
        else:
            reason = next((why for prefix, why in LEGACY_EXCLUDE_REASON.items() if path.startswith(prefix)), "not workflow-owned")
            excluded.append({"path": path, "reason": reason})
    return {"included": included, "excluded": excluded}


def legacy_evidence(records: list[str], pin_runtime_id: str | None, installed: set[str]) -> dict:
    """Which old instruction set a lock-less feature followed (§ 10.3). Never guesses."""
    sets = sorted({line.split("SET=", 1)[1].split()[0] for line in records if line.startswith("INSTRUCTIONS=runtime:") and "SET=" in line})
    runtimes = sorted({line.split("runtime:", 1)[1].split()[0] for line in records if line.startswith("INSTRUCTIONS=runtime:")})
    if len(sets) > 1 or len(runtimes) > 1:
        return {"verdict": "AMBIGUOUS", "candidates": runtimes, "sets": sets, "next_step": "explicit user choice of one recorded runtime (bind_legacy with runtime_id)"}
    if not runtimes:
        if pin_runtime_id is None:
            return {"verdict": "UNPROVEN", "next_step": "no recorded instruction set and no pin; explicit user choice required"}
        runtimes = [pin_runtime_id]
        basis = "project pin before upgrade (no ledger record)"
    else:
        basis = "ledger INSTRUCTIONS record"
    runtime_id = runtimes[0]
    if runtime_id not in installed:
        return {"verdict": "SOURCE_MISSING", "runtime_id": runtime_id, "basis": basis,
                "next_step": f"reinstall exactly runtime {runtime_id} (setup install by pin); no newer set is substituted"}
    return {"verdict": "PROVEN", "runtime_id": runtime_id, "set_sha256": sets[0] if sets else None, "basis": basis}


# ---------------------------------------------------------------------------
# § 4.2 / § 10.4 resolve: which instruction set an entry follows
# ---------------------------------------------------------------------------


@dataclass
class ResolveInput:
    feature: str  # "new" | "locked" | "lockless"
    pin: str      # "none" | "binding-runtime" | "old-runtime" | "missing-runtime"
    lock_bundle: str = "present"   # for locked: "present" | "missing" | "corrupt"
    plugin_bundle: str = "valid"   # active entry's own bundle: "valid" | "absent" | "corrupt"
    standalone: bool = False
    legacy: str = "proven"         # for lockless: "proven" | "ambiguous" | "unproven" | "source-missing"
    compatible: bool = True


def resolve(inp: ResolveInput) -> dict:
    """Decision table of the bootstrap (§ 4.2, § 10.4). Pure; mirrors the fixtures."""
    if inp.plugin_bundle == "corrupt":
        return {"source": "none", "code": "ENTRY_BUNDLE_CORRUPT"}
    if inp.feature == "locked":
        if inp.lock_bundle == "missing":
            return {"source": "none", "code": "BUNDLE_MISSING", "next_step": "restore exactly the locked identity (workflow restore)"}
        if inp.lock_bundle == "corrupt":
            return {"source": "none", "code": "BUNDLE_CORRUPT", "next_step": "restore exactly the locked identity (workflow restore)"}
        if inp.pin == "old-runtime":  # a serving pin is never waived by --standalone (W17 rule)
            return {"source": "none", "code": "RUNTIME_WITHOUT_BINDING", "next_step": "one-time runtime upgrade; nothing is changed automatically"}
        if not inp.compatible and inp.pin == "binding-runtime" and not inp.standalone:
            return {"source": "none", "code": "WORKFLOW_INCOMPATIBLE"}
        return {"source": "bundle", "code": "BOUND_BUNDLE"}
    if inp.feature == "lockless":
        if inp.pin == "old-runtime":
            return {"source": "runtime", "code": "LEGACY_PINNED_RUNTIME", "note": "unchanged pre-binding path; no lock is created"}
        if inp.pin == "binding-runtime":
            if inp.legacy == "proven":
                return {"source": "none", "code": "LEGACY_BIND_REQUIRED", "next_step": "manager runs bind_legacy for the proven old set"}
            return {"source": "none", "code": {"ambiguous": "LEGACY_AMBIGUOUS", "unproven": "LEGACY_UNPROVEN", "source-missing": "LEGACY_SOURCE_MISSING"}[inp.legacy]}
        if inp.pin == "missing-runtime":
            return {"source": "none", "code": "RUNTIME_MISSING"}
        if inp.standalone or inp.pin == "none":
            return {"source": "none", "code": "SELECTION_REQUIRED", "next_step": "explicit begin/adopt for this existing feature; latest is never assigned silently"}
    # new feature
    if inp.plugin_bundle == "absent":
        return {"source": "none", "code": "ENTRY_WITHOUT_BUNDLE", "next_step": "update the feature-workflow plugin"}
    if inp.pin == "old-runtime":  # W19-02 clarification: --standalone does not waive a serving pin
        return {"source": "none", "code": "RUNTIME_WITHOUT_BINDING", "next_step": "one-time runtime upgrade; nothing is changed automatically"}
    if inp.pin == "missing-runtime" and not inp.standalone:
        return {"source": "none", "code": "RUNTIME_MISSING"}
    if not inp.compatible and inp.pin == "binding-runtime" and not inp.standalone:
        return {"source": "none", "code": "WORKFLOW_INCOMPATIBLE"}
    return {"source": "none", "code": "SELECTION_REQUIRED", "next_step": "run begin from this entry; it records the active entry's bundle"}
