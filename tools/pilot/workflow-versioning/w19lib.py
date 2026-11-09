"""Shared helpers for the W19-01 model-free client probes.

Builds on `scripts/plugin-probes/probe_lib.py` (W14/W17): the same isolation guard and the same
"local endpoint that rejects every request" principle. Added here:

* capturing stubs for both clients. The Anthropic stub and an OpenAI-Responses stub record the
  request body the client *would* send to a model and then answer HTTP 400, so no inference runs.
  The body is the client's model-visible input, which is what the probes need to observe
  (which skill text and which package root a session is shown, before and after resume);
* a guard that fails a probe if any request reached anything but the local stub address;
* effective-path reporting relative to the disposable run root.

Raw captures stay under the run root (outside Git). Only derived, redacted findings are emitted.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(REPO / "scripts" / "plugin-probes"))

import probe_lib as L  # noqa: E402  (re-exported: assert_isolated, redact, git_env, ...)

PROBE_ROOT_ENV = "W19_PROBE_ROOT"
# Value of the provider key variable for the Codex stub provider. It is not a credential: the
# provider's base_url is the local stub, so the value never leaves the machine.
CODEX_STUB_KEY_VAR = "W19_PROBE_STUB_KEY"


def run_root(name: str) -> Path:
    base = Path(os.environ.get(PROBE_ROOT_ENV, Path.home() / "tmp" / "w19-01-probes"))
    root = base / f"{name}-{time.strftime('%Y%m%d-%H%M%S')}-{os.getpid()}"
    L.assert_isolated(root)
    root.mkdir(parents=True, exist_ok=False)
    return root


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def personal_profile_fingerprint() -> dict:
    """Metadata-only fingerprint of the personal profiles' plugin state (never reads content).

    Used to show that a probe did not touch the personal profiles: size and mtime of a few
    well-known files/directories, compared before and after the run.
    """
    home = Path.home()
    targets = [
        home / ".claude" / "plugins" / "installed_plugins.json",
        home / ".claude" / "plugins" / "known_marketplaces.json",
        home / ".claude" / "plugins" / "cache",
        home / ".claude" / "settings.json",
        home / ".claude.json",
        home / ".codex" / "config.toml",
        home / ".codex" / "plugins",
        home / ".codex" / "auth.json",
    ]
    out = {}
    for target in targets:
        try:
            stat = target.stat()
            out[str(target).replace(str(home), "<home>")] = {"size": stat.st_size, "mtime_ns": stat.st_mtime_ns}
        except FileNotFoundError:
            out[str(target).replace(str(home), "<home>")] = None
    return out


# ---------------------------------------------------------------------------
# capturing stubs
# ---------------------------------------------------------------------------


class _CaptureHandler(BaseHTTPRequestHandler):
    server_version = "w19-probe-stub"

    def _read_body(self) -> bytes:
        length = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(length) if length else b""

    def _record(self, body: bytes) -> None:
        stub: CaptureStub = self.server.stub  # type: ignore[attr-defined]
        stub.record(self.command, self.path, dict(self.headers), body)

    def _reject(self) -> None:
        stub: CaptureStub = self.server.stub  # type: ignore[attr-defined]
        payload = json.dumps(stub.error_body).encode()
        self.send_response(400)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):  # noqa: N802
        self._record(self._read_body())
        self._reject()

    def do_GET(self):  # noqa: N802
        self._record(b"")
        self._reject()

    def log_message(self, *args):  # silence
        pass


@dataclass
class CaptureStub:
    """Local endpoint that stores every request and answers HTTP 400; nothing is forwarded."""

    capture_dir: Path
    error_body: dict = field(default_factory=lambda: {"type": "error", "error": {"type": "invalid_request_error", "message": "w19 probe stub"}})
    port: int = 0
    requests: list = field(default_factory=list)
    _server: ThreadingHTTPServer | None = field(default=None, repr=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def __enter__(self) -> "CaptureStub":
        self.capture_dir.mkdir(parents=True, exist_ok=True)
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), _CaptureHandler)
        self._server.stub = self  # type: ignore[attr-defined]
        self.port = self._server.server_address[1]
        threading.Thread(target=self._server.serve_forever, daemon=True).start()
        return self

    def __exit__(self, *exc):
        if self._server:
            self._server.shutdown()
            self._server.server_close()

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def record(self, method: str, path: str, headers: dict, body: bytes) -> None:
        with self._lock:
            index = len(self.requests)
            file = self.capture_dir / f"{index:03d}.json"
            file.write_bytes(body or b"{}")
            safe_headers = {k: ("<redacted>" if k.lower() in {"authorization", "x-api-key", "cookie"} else v) for k, v in headers.items()}
            self.requests.append({"index": index, "method": method, "path": path, "headers": safe_headers, "file": str(file), "bytes": len(body)})

    def mark(self) -> int:
        with self._lock:
            return len(self.requests)

    def since(self, mark: int) -> list[dict]:
        with self._lock:
            return list(self.requests[mark:])


def body_text(entry: dict) -> str:
    return Path(entry["file"]).read_text(errors="replace")


# ---------------------------------------------------------------------------
# Claude Code
# ---------------------------------------------------------------------------


def claude_env(config_dir: Path, stub: CaptureStub | None) -> dict:
    L.assert_isolated(config_dir)
    env = dict(os.environ)
    env["CLAUDE_CONFIG_DIR"] = str(config_dir)
    env["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"] = "1"
    for name in ("ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"):
        env.pop(name, None)
    if stub is not None:
        env["ANTHROPIC_BASE_URL"] = stub.base_url
        env["ANTHROPIC_API_KEY"] = "w19-probe-not-a-real-key"
    return env


def claude(args: list[str], *, cwd: Path, config_dir: Path, stub: CaptureStub | None, timeout: int = 180) -> subprocess.CompletedProcess:
    return subprocess.run(
        [L.claude_bin(), *args], cwd=str(cwd), env=claude_env(config_dir, stub),
        capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL,
    )


def stream_events(stdout: str) -> list[dict]:
    events = []
    for line in stdout.splitlines():
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return events


# ---------------------------------------------------------------------------
# Codex
# ---------------------------------------------------------------------------


def codex_stub_config(stub: CaptureStub) -> list[str]:
    """A provider pointing at the local stub. Requests reach only 127.0.0.1 and get HTTP 400."""
    return [
        "-c", "model_providers.w19stub.name=w19stub",
        "-c", f"model_providers.w19stub.base_url={stub.base_url}/v1",
        "-c", "model_providers.w19stub.wire_api=responses",
        "-c", "model_providers.w19stub.request_max_retries=0",
        "-c", "model_providers.w19stub.stream_max_retries=0",
        "-c", f"model_providers.w19stub.env_key={CODEX_STUB_KEY_VAR}",
        "-c", "model_provider=w19stub",
        "-c", "model=w19-probe-model",
        "-c", "sandbox_mode=read-only",
        "-c", "approval_policy=never",
    ]


def codex(args: list[str], *, cwd: Path, codex_home: Path, stub: CaptureStub | None = None, timeout: int = 180) -> subprocess.CompletedProcess:
    L.assert_isolated(codex_home)
    env = dict(os.environ)
    env["CODEX_HOME"] = str(codex_home)
    for name in ("OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_ACCESS_TOKEN"):
        env.pop(name, None)
    if stub is not None:
        env[CODEX_STUB_KEY_VAR] = "w19-probe-not-a-real-key"
    return subprocess.run(
        [L.codex_bin(), *args], cwd=str(cwd), env=env,
        capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL,
    )
