# W14 review 01 — feasibility and proposed contracts

## Executive summary
REWORK for proposed product contract; useful model-free feasibility evidence retained.
Codex coordinator reviewed Claude task `task_cct6fr9gkc`, independent of execution, not coordination.
Reviewed range `1f7d34f1d3bf1de15c2b9cef5b3b121f2c8c27c0..c95820467dc6b120dfca0e42eefc473309c1c931`.
No new user product decision is needed for corrections restoring the authorized plan.
Continue with corrected technical design and eligible implementation; wave13 interface stays proposed.

## Evidence
Round archive F-W14-round-1-resumed.zip verified against base and HEAD: integrity ok, 18 changes, clean export; SHA-256 `4e84ff8c2c8d2706a166b7d1cd30efda2ddf2cd58be4cf1b1f87bc624b735e8e`.
Scope and coordinator-record exclusions passed. Independent 19 Python fixture tests passed; whitespace passed.
Independently reran `W14_PROBE_ROOT=/tmp/wave14-review-probes python3 scripts/plugin-probes/probe_codex_mcp_cwd.py --out-dir /tmp/wave14-review-results`: exit 0, eight actual Codex 0.154.0 startup cases, all model requests stopped locally. All recorded findings true. This proves the measured channels fail; it does not prove every possible architecture impossible.
Inspected Claude stub routing, recorder, cache-update script and committed results. Cache survival of an outside-runtime fixture is not proof of running-feature pinning. No full JS validation or product behavior is claimed.
Coordinator fetched current official docs: https://learn.chatgpt.com/docs/plugins and linked packaging page https://developers.openai.com/plugins/build/plugins ; executor inability to fetch is no longer a global access blocker.

## Required findings

### W14-R1-01 — Full instructions still copied to projects
Requirement: wave14 section 3, generic skills/helpers/runtime delivered outside target code; manager instructions correspond to pin (AC-04/05).
Evidence: contract 01 section 2.4 invokes wave12 init including instruction-set copies, while section 2.6 promises thin pinned entry skills. Those paths conflict.
Disposition: required contract/implementation correction. Keep general instructions and exporter in immutable installation, thin entry dispatches to the selected set, preserve project overrides. Do not ship both latest full workflow and pinned workflow to the manager. Generated references must resolve outside target repo.

### W14-R1-02 — Fresh-worktree startup remains unsolved
Requirement: goal 3 and AC-03: open ordinary Codex in inherited external worktree, request feature, automatic preparation without manual init.
Evidence: contract 01 section 2.4 requires every worktree to start missing MCP, run setup, then restart; no automatic working bootstrap path is evidenced. Rejecting all late binding solely because tools/list_changed was untested is premature: static tool catalog or portable project launcher can avoid that dependency.
Disposition: required technical correction in existing authority. Measure simplest viable path. Candidate: small portable project MCP declaration starts a machine-installed dispatcher (outside cache), resolves real cwd/git root and authoritative project pin without requiring per-worktree symlink; first authorized use prepares local selection, while handshake/read stays pure. Alternative static-catalog plugin facade with explicit validated workspace binding is allowed if simpler and guards preserved. Do not use inherited PWD or bypass native identity guard. No added restart for each inherited worktree. Initial project enablement may expose a host-required restart honestly. Probe actual TUI startup model-free if relying on it.

### W14-R1-03 — Journal is not a concurrency proof
Requirement: AC-06, two simultaneous first uses safe; no foreign mutation.
Evidence: contract section 2.4 claims existing pending.json/backup journal already covers concurrent writes without a race test or exclusive claim proof.
Disposition: required implementation evidence. Use existing setup guarantees where valid; serialize bootstrap with exclusive ownership and revalidate before writes. Test concurrent setup, interrupted setup, symlinks and copied records; pure handshake/read and foreign refusal must preserve all local state.

### W14-R1-04 — Diagnostics proposal needs privacy and source precision
Requirement: AC-08 plus wave13 allowlist/aliases; distinguish known configuration from actual execution.
Evidence: metadata proposal sends raw instructions.source_path/executor.plugin_dir as-is, and claims actual executor selection from a static report. Paths may expose private data; unknown divergence is shown as false in example.
Disposition: required proposed-interface correction. Prefer safe identifiers/hashes and nullable observed values; leave wave13 aliasing/allowlist authoritative. Configured versus observed executor identity must be explicit. Reconcile before integration; no wave13 edits or merger implied.

## Routing and coverage
W14-01 probes are useful and complete; proposals need corrections above. AC-01–09 product delivery remains unverified. W14-02 can correct these ordinary design choices and implement packages/bootstrap under decision 01, without new user approval. Wave13 dependent diagnose integration remains gated; independent work proceeds. No model pilots, personal config edits, push, merge or deployment.
