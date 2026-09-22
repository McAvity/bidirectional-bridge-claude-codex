#!/usr/bin/env python3
"""Documentation link check used by W17-04 (read-only).

For every tracked Markdown file of a revision: each relative Markdown link must resolve to a
tracked path (anchors and URLs are ignored), and no text may carry an absolute personal path
(`/home/<user>/`, `/Users/<user>/`); the looser `/home/` substring rule of earlier records is
reported alongside. Findings are reported per file and line; the check never
edits a document. Historical records are reported, not rewritten — compare against a base run.

  python3 scripts/plugin-probes/wave17_doc_links.py [--rev REV] [--prefix docs/] [--json]
"""

from __future__ import annotations

import argparse
import json
import posixpath
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
LINK = re.compile(r"(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
ABSOLUTE = re.compile(r"(?<![\w.<])/(?:home|Users)/[A-Za-z0-9._-]+/")
# The looser rule earlier wave records used: any `/home/` or `/Users/` substring. It also flags
# prose such as "workspace/home/target"; reported separately so both baselines compare exactly.
LOOSE = re.compile(r"/(?:home|Users)/")


def git(*args: str) -> str:
    return subprocess.run(["git", "-C", str(REPO), *args], check=True, capture_output=True, text=True).stdout


def check(rev: str, prefix: str = "") -> dict:
    tracked = set(git("ls-tree", "-r", "--name-only", rev).splitlines())
    directories = {posixpath.dirname(path) for path in tracked}
    while True:
        parents = {posixpath.dirname(d) for d in directories if d} - directories
        if not parents:
            break
        directories |= parents
    broken, absolute, loose = [], [], []
    markdown = sorted(path for path in tracked if path.endswith(".md") and path.startswith(prefix) and "node_modules/" not in path)
    for path in markdown:
        text = git("show", f"{rev}:{path}")
        in_fence = False
        for number, line in enumerate(text.splitlines(), 1):
            if line.lstrip().startswith("```"):
                in_fence = not in_fence
            for match in ABSOLUTE.finditer(line):
                absolute.append({"file": path, "line": number, "text": match.group(0)})
            if LOOSE.search(line):
                loose.append({"file": path, "line": number})
            if in_fence:
                continue
            for match in LINK.finditer(line):
                target = match.group(1).split("#", 1)[0]
                if not target or re.match(r"^[a-z][a-z0-9+.-]*:", target) or target.startswith("${") or "<" in target:
                    continue
                resolved = posixpath.normpath(posixpath.join(posixpath.dirname(path), target))
                if resolved.startswith("../") or (resolved not in tracked and resolved not in directories):
                    broken.append({"file": path, "line": number, "target": match.group(1)})
    return {"rev": git("rev-parse", rev).strip(), "markdown_files": len(markdown), "broken_links": broken, "absolute_paths": absolute, "loose_home_substrings": loose}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rev", default="HEAD")
    parser.add_argument("--prefix", default="", help="only Markdown files under this path prefix, e.g. docs/")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    report = check(args.rev, args.prefix)
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"{report['rev']}: {report['markdown_files']} Markdown files")
        for item in report["broken_links"]:
            print(f"  broken  {item['file']}:{item['line']}  {item['target']}")
        for item in report["absolute_paths"]:
            print(f"  absolute  {item['file']}:{item['line']}  {item['text']}")
        for item in report["loose_home_substrings"]:
            print(f"  loose /home/ substring  {item['file']}:{item['line']}")
    return 0 if not report["broken_links"] and not report["absolute_paths"] else 1


if __name__ == "__main__":
    sys.exit(main())
