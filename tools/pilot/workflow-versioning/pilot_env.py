"""PILOT-ENV-01: the isolated Codex configuration a W19-06 pilot uses for the bridge MCP block.

The setup's own block forwards only CLAUDE_CODEX_BRIDGE_HOME and XDG_DATA_HOME (W19-01 probe E),
so a Claude delegated by the bridge would fall back to the personal profile. A pilot writes this
block into its *isolated* CODEX_HOME/config.toml instead; the personal configuration is never
touched. `render_bridge_block` is pure; `write_pilot_config` refuses any path inside a personal
profile.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import w19lib as W  # noqa: E402

PILOT_MCP_ENV_VARS = ("CLAUDE_CODEX_BRIDGE_HOME", "XDG_DATA_HOME", "CLAUDE_CONFIG_DIR")


def toml_string(value: str) -> str:
    return json.dumps(value)


def render_bridge_block(command: str, args: list[str], *, name: str = "bridge", startup_timeout_sec: int = 30, tool_timeout_sec: int = 5400) -> str:
    """The `[mcp_servers.<name>]` block with the pilot's env forwarding."""
    return "\n".join([
        f"[mcp_servers.{name}]",
        f"command = {toml_string(command)}",
        f"args = [{', '.join(toml_string(a) for a in args)}]",
        f"env_vars = [{', '.join(toml_string(v) for v in PILOT_MCP_ENV_VARS)}]",
        f"startup_timeout_sec = {startup_timeout_sec}",
        f"tool_timeout_sec = {tool_timeout_sec}",
        "",
    ])


def write_pilot_config(codex_home: Path, block: str) -> Path:
    """Write the block into an isolated CODEX_HOME (refuses the personal profiles)."""
    W.L.assert_isolated(codex_home)
    codex_home.mkdir(parents=True, exist_ok=True)
    path = codex_home / "config.toml"
    existing = path.read_text() if path.exists() else ""
    if "[mcp_servers.bridge]" in existing:
        raise SystemExit(f"refusing to overwrite an existing bridge block in {path}")
    path.write_text(existing + ("\n" if existing and not existing.endswith("\n") else "") + block)
    return path
