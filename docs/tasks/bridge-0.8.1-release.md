# Bridge 0.8.1 release

Status: preparing, 2026-11-09. User explicitly authorized publication of a new version
after the startup fixes. Release worktree: `release/0.8.1`; integration: `feature-workflow`.
Implementation reviewed and committed through `77a8b5f`; see
[startup evidence](codex-daemon-startup.md). Existing upstream history and MIT notices stay intact.

Scope: Bridge engine and both bridge plugins 0.8.1, published as an experimental
GitHub prerelease `bridge-v0.8.1`. Feature-workflow remains 1.0.0 with unchanged bytes
and identity. No npm publication, personal plugin refresh or active-runtime replacement.

Sequence: commit versioned sources; pin that full commit in distribution metadata;
regenerate and verify packages; independently review publication metadata/claims;
install the pinned runtime in a temporary home and probe MCP without a model or
manager claim; integrate/push; require exact-distribution CI before tagging/publishing.

Prior validation: 243 Python tests passed; 47 startup/process/upgrade cases passed
with 1 optional Linux skip; final setup and affected historical-runtime/rollback
integration cases 37 passed. The implementation report records three macOS baseline
failures reproduced on pre-change source. Linux exact-SHA CI is the release gate;
no failing local run is relabelled PASS. Native Codex 0.167 startup was verified,
not a persisted-resume or model pilot.

Source SHA, distribution SHA, runtime smoke, review and CI results will be recorded
below as each completes. The main checkout's local runtime-pin edit stays separate.

## Versioned source

Source: `fd473c5643e32f827806d2e6d619ad58f4b505aa` (0.8.1).
Local `npm ci --ignore-scripts`, build, packages equivalence and 277-file documentation
check PASS. Workflow packages/registry have no diff from the prior release.
The distribution pin now selects this source; independent review, runtime smoke
and exact-distribution CI follow before publication.
