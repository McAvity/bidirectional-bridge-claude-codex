#!/usr/bin/env python3
"""Run every W14-01 host probe and write one JSON result per probe.

  python3 scripts/plugin-probes/run_probes.py --out-dir docs/features/F-W14-plugin-distribution/evidence/W14-01/results

All probes are model-free and use disposable, isolated Codex/Claude profiles.
Exit code is 0 when every probe ran (a probe reporting a negative host capability
is a completed probe, not a failure) and 1 when a probe crashed.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROBES = [
    "probe_codex_mcp_cwd.py",
    "probe_claude_delegation.py",
    "probe_plugin_cache_update.py",
    "probe_missing_runtime_startup.py",
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", type=Path, required=True)
    args = parser.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)

    failed = []
    for probe in PROBES:
        print(f"== {probe}", file=sys.stderr, flush=True)
        proc = subprocess.run(
            [sys.executable, str(HERE / probe), "--out-dir", str(args.out_dir)],
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            failed.append(probe)
            print(proc.stderr[-4000:], file=sys.stderr)
    if failed:
        print(f"probes that crashed: {', '.join(failed)}", file=sys.stderr)
        return 1
    print(f"wrote {len(PROBES)} probe results to {args.out_dir}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
