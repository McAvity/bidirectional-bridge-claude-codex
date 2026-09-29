# macOS setup compatibility

Scope: portable active-use detection, conservative refusal on uncertain reads,
Python TOML diagnostics, regression tests and supported immutable-runtime installation
for the requested external worktree. No availability feature edits or cache patches.

Branch/worktree: `fix/macos-setup`, `.worktrees/macos-setup`.
Bridge review unavailable: host exposes no bridge MCP and the source checkout's
pinned runtime is missing. Implementation and verification proceed locally.

Initial finding: active-use scanner only reads Linux `/proc`; all unknown reads
recommend Linux. Python TOML diagnostics collapse all execution failures together.
Validation: pending. Next: implement and validate platform-specific probes.

Implemented macOS ps/lsof coverage with bounded full-snapshot retries, unknown on
partial reads, Linux permission refusal and content-free process summaries.
Python diagnostics now separate missing executable/tomllib from execution failure.
Generated both bridge packages. Review caught and fixed bare dispatcher argv matching.

Initial verification: Node 24 build and 10 focused tests PASS; real macOS process
smoke PASS (idle, open state plus bridge, normal close, workspace with spaces).
Python suite: 100 tests, 8 optional host skips, PASS with Python 3.12/Node 24 and
canonical TMPDIR=/private/tmp, outside sandbox. Earlier attempts exposed system
Python 3.9 and sandbox/path assumptions. Full JS before committing used old HEAD
for installed-runtime tests and hit synchronous Vitest IPC starvation; add a yield
between installer test cases and rerun on committed sources. Pilot tooling has a
separate pre-existing /proc-dependent dry-run refusal on macOS; investigate baseline.
No paid models, external target writes, cache patches or publication yet.
