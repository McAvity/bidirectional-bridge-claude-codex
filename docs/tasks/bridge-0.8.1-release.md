# Bridge 0.8.1 release

Status: published, 2026-11-09. User explicitly authorized publication of a new version
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

Source SHA, distribution SHA, runtime smoke, review and CI results are recorded
below. The main checkout's local runtime-pin edit stays separate.

## Versioned source

Source: `fd473c5643e32f827806d2e6d619ad58f4b505aa` (0.8.1).
Local `npm ci --ignore-scripts`, build, packages equivalence and 277-file documentation
check PASS. Workflow packages/registry have no diff from the prior release.
The distribution pin selects this source. Independent review, runtime smoke
and exact-distribution CI passed before publication.

## Candidate verification

Independent read-only review of distribution `b13c1df` found no blockers: version/pin
consistency, unchanged workflow 1.0.0 bytes and registry, preservation of historical tags,
package equivalence and bounded claims passed. A cosmetic handoff typo was corrected.

Fresh installation of source `fd473c5643e32f827806d2e6d619ad58f4b505aa` in a temporary
home produced runtime `0.8.1-fd473c5643e3` with `codex_conversation_cwd: true`. The public
Codex plugin prepared a synthetic project with no explicit cwd. Real stdio MCP served
41 tools in that project and its inherited Git worktree; server info and manager status
confirmed caller=codex, delegation=allow and each canonical workspace root. No model
turn, manager claim or database creation; inherited reads did not materialize local setup.

The reviewed metadata and runtime bytes are unchanged by this documentation checkpoint.
The real Codex 0.167.0 startup acceptance also passed both cases with different server
and conversation directories, including inherited space paths; no model or personal login.

## Published checkpoint

- [Experimental release](https://github.com/McAvity/bidirectional-bridge-claude-codex/releases/tag/bridge-v0.8.1), published 2026-11-09.
- Annotated immutable tag `bridge-v0.8.1` points to distribution
  `ffd7063f5b32ad28401304086cd9e6f80d0bc4ff`; source remains
  `fd473c5643e32f827806d2e6d619ad58f4b505aa`.
- [Exact-SHA CI 42679569016](https://github.com/McAvity/bidirectional-bridge-claude-codex/actions/runs/42679569016)
  SUCCESS: build, package equivalence, docs, protected process observer 20 PASS;
  JavaScript 762 PASS / 2 skipped; Python 243 total / 5 skipped (238 PASS);
  pilot tooling 131 total / 2 skipped (129 PASS). No model pilot.
- `feature-workflow` fast-forwarded and pushed with the tag atomically. Remote release
  is public (not draft), marked prerelease; remote tag target and source availability verified.
- Installed runtime 0.8.0 and the main checkout's local project-pin change are preserved;
  pin bytes verified unchanged. Workflow packages and registry remain 1.0.0 unchanged.

Publication is complete. This documentation checkpoint follows the immutable release tag.
Next optional operator action: refresh the bridge plugin and use checked `bridge-upgrade`
in the intended project, then verify live server info and manager workspace after restart.
No active runtime was rebuilt or switched.
