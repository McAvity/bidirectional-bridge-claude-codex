"""Operator-only hidden check: run owner acceptance cases against a textkit source tree.

Usage: python3 check_cases.py <src-dir> <cases.json>
Prints JSON {passed, failed, failures:[...]}; exit 0 always (evaluation evidence, not a gate).
Not given to Astra: it is used after the fact to record whether the seeded gap existed.
"""
import json
import os
import subprocess
import sys

src = os.path.abspath(sys.argv[1])
if len(sys.argv) < 3:
    sys.exit(__doc__)
cases_path = sys.argv[2]
probe = r'''
import json, sys
sys.path.insert(0, sys.argv[1])
case = json.loads(sys.argv[2])
try:
    from textkit.duration import format_duration, parse_duration
    if case["call"] == "parse_duration":
        out = parse_duration(case["input"])
    else:
        out = format_duration(case["seconds"], case["style"])
    print(json.dumps({"value": out}))
except ValueError as exc:
    print(json.dumps({"error": "ValueError", "message": str(exc)}))
except Exception as exc:
    print(json.dumps({"error": type(exc).__name__, "message": str(exc)}))
'''
results = {"src": src, "passed": 0, "failed": 0, "failures": []}
for case in json.load(open(cases_path))["cases"]:
    if case["call"] == "cli":
        env = dict(os.environ, PYTHONPATH=src)
        p = subprocess.run([sys.executable, "-m", "textkit", *case["args"]], capture_output=True, text=True, env=env)
        ok = p.returncode == case["expect_exit"] and ("expect_stdout" not in case or p.stdout.rstrip("\n") == case["expect_stdout"])
        got = {"exit": p.returncode, "stdout": p.stdout.rstrip("\n")}
    else:
        p = subprocess.run([sys.executable, "-c", probe, src, json.dumps(case)], capture_output=True, text=True)
        got = json.loads(p.stdout or '{"error": "probe failed"}')
        ok = got.get("error") == case["expect_error"] if "expect_error" in case else got.get("value") == case["expect"]
    results["passed" if ok else "failed"] += 1
    if not ok:
        results["failures"].append({"case": case, "got": got})
print(json.dumps(results, ensure_ascii=False, indent=1))
