"""Shared helpers for the W14-01 model-free host probes.

Every probe runs against the installed Codex / Claude Code CLIs using *isolated*
profile directories under a disposable run root. The personal profiles
(`~/.codex`, `~/.claude`) are never read for configuration and never written:
`assert_isolated()` refuses to continue otherwise.

No probe performs model inference. The Codex probes make the first model request
fail locally on a missing provider API-key environment variable; the Claude
probes point `ANTHROPIC_BASE_URL` at a local stub that answers HTTP 400. Both
paths are asserted to report zero usage, and neither leaves the machine.
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import threading
import time
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
RECORDER = Path(__file__).resolve().parent / "recorder_mcp.mjs"

# Codex refuses to run the first model request without this variable; the run
# therefore stops after MCP startup and before any network call.
CODEX_FAKE_KEY_VAR = "W14_PROBE_ABSENT_API_KEY"


class ProbeSkipped(Exception):
    """A precondition of the probe is missing on this host."""


# --------------------------------------------------------------------------
# isolation
# --------------------------------------------------------------------------


def assert_isolated(*paths: Path) -> None:
    """Refuse to touch the user's real Codex/Claude profiles."""
    home = Path.home().resolve()
    forbidden = {home / ".codex", home / ".claude", home / ".config" / "claude"}
    for path in paths:
        resolved = Path(path).resolve()
        for bad in forbidden:
            if resolved == bad or bad in resolved.parents:
                raise SystemExit(f"probe refused: {resolved} is inside the personal profile {bad}")


def run_root(name: str) -> Path:
    base = Path(os.environ.get("W14_PROBE_ROOT", Path.home() / "tmp" / "w14-01-probes"))
    root = base / f"{name}-{time.strftime('%Y%m%d-%H%M%S')}-{os.getpid()}"
    assert_isolated(root)
    root.mkdir(parents=True, exist_ok=False)
    return root


# --------------------------------------------------------------------------
# host CLIs
# --------------------------------------------------------------------------


def codex_bin() -> str:
    found = shutil.which("codex")
    if not found:
        raise ProbeSkipped("codex CLI not found on PATH")
    return found


def claude_bin() -> str:
    found = shutil.which("claude")
    if not found:
        raise ProbeSkipped("claude CLI not found on PATH")
    return found


def host_versions() -> dict:
    versions = {}
    for label, resolver in (("codex", codex_bin), ("claude", claude_bin)):
        try:
            binary = resolver()
        except ProbeSkipped as exc:
            versions[label] = {"available": False, "detail": str(exc)}
            continue
        out = subprocess.run([binary, "--version"], capture_output=True, text=True, timeout=60)
        versions[label] = {
            "available": True,
            "path": binary,
            "version": out.stdout.strip() or out.stderr.strip(),
        }
    return versions


# --------------------------------------------------------------------------
# fixtures
# --------------------------------------------------------------------------


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def codex_plugin_manifest(name: str, version: str, *, mcp: bool) -> dict:
    manifest = {
        "name": name,
        "version": version,
        "description": "W14-01 feasibility probe plugin (model-free).",
        "author": {"name": "claude-codex-bridge"},
        "license": "MIT",
        "skills": "./skills/",
        "interface": {
            "displayName": "W14 Probe",
            "shortDescription": "W14-01 feasibility probe",
            "longDescription": "Disposable probe plugin used by the W14-01 host feasibility probes.",
            "developerName": "claude-codex-bridge",
            "category": "Productivity",
        },
    }
    if mcp:
        manifest["mcpServers"] = "./.mcp.json"
    return manifest


def build_codex_marketplace(
    root: Path,
    *,
    marketplace: str,
    plugin: str,
    version: str,
    record_path: Path | None,
    env_vars: list[str] | None = None,
    skill_marker: str = "W14-PROBE-SKILL-MARKER",
) -> Path:
    """Create a local Codex marketplace containing one probe plugin."""
    plugin_dir = root / "plugins" / plugin
    (plugin_dir / ".codex-plugin").mkdir(parents=True, exist_ok=True)
    (plugin_dir / "skills" / "probe-skill").mkdir(parents=True, exist_ok=True)

    write_json(
        root / ".agents" / "plugins" / "marketplace.json",
        {
            "name": marketplace,
            "interface": {"displayName": "W14 probe marketplace"},
            "plugins": [
                {
                    "name": plugin,
                    "source": {"source": "local", "path": f"./plugins/{plugin}"},
                    "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"},
                    "category": "Productivity",
                }
            ],
        },
    )
    write_json(
        plugin_dir / ".codex-plugin" / "plugin.json",
        codex_plugin_manifest(plugin, version, mcp=record_path is not None),
    )
    (plugin_dir / "skills" / "probe-skill" / "SKILL.md").write_text(
        "---\n"
        "name: probe-skill\n"
        "description: Probe skill proving plugin skill discovery for W14-01.\n"
        "---\n\n"
        f"{skill_marker}\nversion:{version}\n"
    )
    if record_path is not None:
        shutil.copy2(RECORDER, plugin_dir / "recorder_mcp.mjs")
        server: dict = {
            "command": "node",
            "args": ["./recorder_mcp.mjs", "--record", str(record_path)],
            "cwd": ".",
        }
        if env_vars:
            server["env_vars"] = env_vars
        write_json(plugin_dir / ".mcp.json", {"mcpServers": {"probe": server}})
    return root


def build_claude_plugin(
    plugin_dir: Path,
    *,
    plugin: str,
    version: str,
    record_path: Path | None,
    skill_marker: str = "W14-PROBE-SKILL-MARKER",
) -> Path:
    (plugin_dir / ".claude-plugin").mkdir(parents=True, exist_ok=True)
    (plugin_dir / "skills" / "probe-skill").mkdir(parents=True, exist_ok=True)
    manifest = {
        "name": plugin,
        "version": version,
        "description": "W14-01 feasibility probe plugin (model-free).",
        "author": {"name": "claude-codex-bridge"},
        "license": "MIT",
    }
    if record_path is not None:
        manifest["mcpServers"] = "./.mcp.json"
    write_json(plugin_dir / ".claude-plugin" / "plugin.json", manifest)
    (plugin_dir / "skills" / "probe-skill" / "SKILL.md").write_text(
        "---\n"
        "name: probe-skill\n"
        "description: Probe skill proving plugin skill discovery for W14-01.\n"
        "---\n\n"
        f"{skill_marker}\nversion:{version}\n"
    )
    if record_path is not None:
        shutil.copy2(RECORDER, plugin_dir / "recorder_mcp.mjs")
        write_json(
            plugin_dir / ".mcp.json",
            {
                "mcpServers": {
                    "probe": {
                        "command": "node",
                        "args": [
                            "${CLAUDE_PLUGIN_ROOT}/recorder_mcp.mjs",
                            "--record",
                            str(record_path),
                        ],
                    }
                }
            },
        )
    return plugin_dir


def make_git_repo(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    env = git_env()
    subprocess.run(["git", "init", "-q", "-b", "main", str(path)], check=True, env=env)
    (path / "README.md").write_text("w14 probe repository\n")
    subprocess.run(["git", "-C", str(path), "add", "-A"], check=True, env=env)
    subprocess.run(["git", "-C", str(path), "commit", "-qm", "init"], check=True, env=env)


def add_git_worktree(repo: Path, worktree: Path, branch: str) -> None:
    subprocess.run(
        ["git", "-C", str(repo), "worktree", "add", "-q", "-b", branch, str(worktree)],
        check=True,
        env=git_env(),
    )


def git_env() -> dict:
    env = dict(os.environ)
    env.update(
        {
            "GIT_CONFIG_GLOBAL": "/dev/null",
            "GIT_CONFIG_SYSTEM": "/dev/null",
            "GIT_AUTHOR_NAME": "w14 probe",
            "GIT_AUTHOR_EMAIL": "probe@example.invalid",
            "GIT_COMMITTER_NAME": "w14 probe",
            "GIT_COMMITTER_EMAIL": "probe@example.invalid",
        }
    )
    return env


# --------------------------------------------------------------------------
# model-free host runs
# --------------------------------------------------------------------------


CODEX_OFFLINE_CONFIG = [
    "-c",
    "model_providers.w14probe.name=w14probe",
    "-c",
    "model_providers.w14probe.base_url=http://127.0.0.1:1/v1",
    "-c",
    "model_providers.w14probe.wire_api=responses",
    "-c",
    "model_providers.w14probe.request_max_retries=0",
    "-c",
    "model_providers.w14probe.stream_max_retries=0",
    "-c",
    f"model_providers.w14probe.env_key={CODEX_FAKE_KEY_VAR}",
    "-c",
    "model_provider=w14probe",
    "-c",
    "sandbox_mode=read-only",
]


def codex_env(codex_home: Path, extra: dict | None = None, *, drop: list[str] | None = None) -> dict:
    assert_isolated(codex_home)
    env = dict(os.environ)
    env["CODEX_HOME"] = str(codex_home)
    env.pop(CODEX_FAKE_KEY_VAR, None)  # the missing key is what stops the model request
    for name in drop or []:
        env.pop(name, None)
    env.update(extra or {})
    return env


def run_codex(
    args: list[str],
    *,
    cwd: Path,
    codex_home: Path,
    timeout: int = 120,
    drop_env: list[str] | None = None,
    extra_env: dict | None = None,
):
    return subprocess.run(
        [codex_bin(), *args],
        cwd=str(cwd),
        env=codex_env(codex_home, extra_env, drop=drop_env),
        capture_output=True,
        text=True,
        timeout=timeout,
        stdin=subprocess.DEVNULL,
    )


def codex_session_start(
    cwd: Path,
    codex_home: Path,
    extra_args: list[str] | None = None,
    *,
    drop_env: list[str] | None = None,
    extra_env: dict | None = None,
):
    """Start one Codex session far enough to boot MCP servers, with no model call.

    The turn fails immediately on the missing provider key, so no request is
    ever sent. Returns the CompletedProcess for evidence.
    """
    args = [
        "exec",
        "--skip-git-repo-check",
        "--json",
        *CODEX_OFFLINE_CONFIG,
        *(extra_args or []),
        "w14 probe: no model call is expected to succeed",
    ]
    return run_codex(args, cwd=cwd, codex_home=codex_home, drop_env=drop_env, extra_env=extra_env)


def codex_turn_failed_without_request(proc: subprocess.CompletedProcess) -> bool:
    """True when the run stopped on the absent API key, i.e. nothing was sent."""
    for line in proc.stdout.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") == "turn.failed":
            message = str(event.get("error", {}).get("message", ""))
            return CODEX_FAKE_KEY_VAR in message
    return False


class _StubHandler(BaseHTTPRequestHandler):
    def _respond(self):
        body = b'{"type":"error","error":{"type":"invalid_request_error","message":"w14 probe stub"}}'
        self.send_response(400)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_POST = _respond
    do_GET = _respond

    def log_message(self, *args):  # silence
        pass


@dataclass
class AnthropicStub:
    """Local HTTP endpoint that rejects every request, so no model ever runs."""

    port: int = 0
    _server: HTTPServer | None = field(default=None, repr=False)
    _thread: threading.Thread | None = field(default=None, repr=False)

    def __enter__(self) -> "AnthropicStub":
        self._server = HTTPServer(("127.0.0.1", 0), _StubHandler)
        self.port = self._server.server_address[1]
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *exc):
        if self._server:
            self._server.shutdown()
            self._server.server_close()

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}"


def run_claude_headless(
    prompt: str,
    *,
    cwd: Path,
    config_dir: Path,
    stub: AnthropicStub,
    extra_args: list[str] | None = None,
    debug_file: Path | None = None,
    timeout: int = 120,
):
    """One `claude -p` session that boots plugins and MCP, then fails on HTTP 400."""
    assert_isolated(config_dir)
    env = dict(os.environ)
    env.update(
        {
            "CLAUDE_CONFIG_DIR": str(config_dir),
            "ANTHROPIC_BASE_URL": stub.base_url,
            "ANTHROPIC_API_KEY": "w14-probe-not-a-real-key",
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
        }
    )
    for name in ("ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"):
        env.pop(name, None)
    args = [
        claude_bin(),
        "-p",
        prompt,
        "--permission-mode",
        "plan",
        "--max-turns",
        "1",
        "--output-format",
        "json",
        *(extra_args or []),
    ]
    if debug_file:
        args += ["--debug-file", str(debug_file)]
    return subprocess.run(
        args,
        cwd=str(cwd),
        env=env,
        capture_output=True,
        text=True,
        timeout=timeout,
        stdin=subprocess.DEVNULL,
    )


def claude_result(proc: subprocess.CompletedProcess) -> dict:
    for line in reversed(proc.stdout.splitlines()):
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if payload.get("type") == "result":
            return payload
    return {}


def run_claude_plugin(args: list[str], *, env: dict | None = None, timeout: int = 180) -> dict:
    """Run `claude plugin ...` against an isolated config directory."""
    child_env = dict(os.environ)
    child_env.update(env or {})
    config_dir = child_env.get("CLAUDE_CONFIG_DIR")
    if config_dir:
        assert_isolated(Path(config_dir))
    proc = subprocess.run(
        [claude_bin(), "plugin", *args],
        capture_output=True,
        text=True,
        timeout=timeout,
        env=child_env,
        stdin=subprocess.DEVNULL,
    )
    return {"exit_code": proc.returncode, "stdout": proc.stdout, "stderr": proc.stderr}


def run_claude_validate(path: Path, *, strict: bool = False) -> dict:
    """`claude plugin validate` — a model-free manifest check against the host schema."""
    args = [claude_bin(), "plugin", "validate", str(path), "--json"]
    if strict:
        args.append("--strict")
    proc = subprocess.run(args, capture_output=True, text=True, timeout=120)
    try:
        report = json.loads(proc.stdout)
    except json.JSONDecodeError:
        report = {"stdout": proc.stdout, "stderr": proc.stderr}
    return {"exit_code": proc.returncode, "strict": strict, "report": report}


def claude_spent_nothing(result: dict) -> bool:
    usage = result.get("usage", {})
    return (
        result.get("total_cost_usd") == 0
        and usage.get("input_tokens", 0) == 0
        and usage.get("output_tokens", 0) == 0
        and result.get("api_error_status") == 400
    )


# --------------------------------------------------------------------------
# recorder output
# --------------------------------------------------------------------------


def read_record(path: Path) -> list[dict]:
    if not path.exists():
        return []
    entries = []
    for line in path.read_text().splitlines():
        if line.strip():
            entries.append(json.loads(line))
    return entries


def record_start(entries: list[dict]) -> dict | None:
    for entry in entries:
        if entry.get("ev") == "start":
            return entry
    return None


def record_methods(entries: list[dict]) -> list[str]:
    return [e["msg"].get("method") for e in entries if e.get("ev") == "in" and "msg" in e]


def git_toplevel(path: str | Path) -> str | None:
    try:
        out = subprocess.run(
            ["git", "-C", str(path), "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            timeout=60,
            env=git_env(),
        )
    except OSError:
        return None
    return out.stdout.strip() or None


# --------------------------------------------------------------------------
# result reporting
# --------------------------------------------------------------------------


def redact(value):
    """Keep committed evidence free of the operator's home path and PATH contents.

    Structure and relative layout are what the probes prove; the absolute home
    prefix and the machine's PATH are personal configuration.
    """
    home = str(Path.home())
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            if key == "PATH" and isinstance(item, str):
                out[key] = f"<redacted: {len(item.split(os.pathsep))} entries>"
            else:
                out[key] = redact(item)
        return out
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, str):
        return value.replace(home, "<home>")
    return value


def emit(result: dict, out_dir: Path | None) -> None:
    text = json.dumps(redact(result), indent=2, sort_keys=True)
    print(text)
    if out_dir:
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / f"{result['probe']}.json").write_text(text + "\n")
