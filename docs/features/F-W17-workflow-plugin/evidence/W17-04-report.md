# W17 integrated delivery — acceptance evidence (W17-02–04)

Executor report for independent review; not a review verdict or user acceptance.
Corrected for [review 03](../reviews/03-implementation.md) R03-01 (source table in
`docs/plugin-distribution.md`) and R03-N1 (documentation checker provenance, below); see
[W17-04 ledger 02](../execution/W17-04/02.md).
Range `9e7e9c0151d666146f6b8d51ee712f1c723c3a60..` the W17-04 ledger commit. Code and docs
tested at `2115018896f6b6f251dc1bde2ea7fb80ae0cce41` (later commits add only this report and the
ledgers). Contract: [01-distribution.md](../contracts/01-distribution.md); authority:
[decision 01](../decisions/01.md); gate: [review 02](../reviews/02-contracts.md) PASS.

Host versions: Claude Code `2.1.280`, codex-cli `0.155.1`, Node `v24.15.0`, Python `3.12.3`.
Supervising runtime `0.3.2-34ecb8d45465` was only read, never rebuilt, edited or switched.

## Evidence kinds

- **Generated product**: `plugins/feature-workflow-{codex,claude}/`, both marketplaces, the
  canonical reader `scripts/workflow-source/select-source.mjs`, launcher and runner.
- **Real runtime**: HEAD installed by the product installer into a disposable home
  (`tests/test_plugin_distribution.py`, class `InstalledRuntimeWorkflow`).
- **Fixtures**: disposable runtimes built from Git commits `34ecb8d` (0.3.2, before wave16) and
  `a67aee7` (after wave16, with the generated workflow package overlaid as a W17-03 runtime
  ships it); launch binaries are stubs, so they prove selection, not a working bridge.
- **Hosts, model-free**: disposable `CLAUDE_CONFIG_DIR` / `CODEX_HOME`; Claude against a local
  HTTP 400 stub with zero reported cost and tokens; Codex via `debug prompt-input` in a
  credential-free home. Not a network capture.
- **Model behaviour**: none observed. No model pilot or smoke ran.

## Acceptance criteria

| AC | Result | Evidence |
| --- | --- | --- |
| AC-01 two manifests, one source | met | Both `claude-codex-bridge` marketplaces list `feature-workflow` from `./plugins/feature-workflow-{codex,claude}`; the generator builds them from `.agents/skills`, the guide, the reader and the preamble template; `npm run packages:check` PASS (drift gate over all four packages); `test_workflow_distribution` marketplace/manifest tests |
| AC-02 clean profile, six entries, standalone | met (host) | Repository marketplace in empty profiles: Claude and Codex list exactly six `feature-workflow:*` entries (`RepositoryMarketplaceHosts`); `claude plugin validate` PASS; packaged reader in a non-bridge repo with an empty bridge home answers `plugin`, writes nothing; no MCP server declared |
| AC-03 pinned runtime is the source; no hidden fallback | met (fixture + real runtime) | Pin-first matrix on the generated reader: old/new pins, missing runtime, commit mismatch, disabled, invalid, legacy, mismatch (`PACKAGE_PIN_MISMATCH` even with `--standalone`), 37 probe tests; real runtime: its workflow package answers `PINNED_RUNTIME` with the manifest's instruction digest; plugin update leaves a pinned answer unchanged |
| AC-04 coexistence, migration, explicit invocation | met for host listing; routing UNVERIFIED | Claude lists 12 qualified entries with legacy `bridge-claude`, six after `claude plugin disable`; Codex `bridge-codex` adds no `feature-*`; no bare plugin names; migration commands exit 0 in isolated profiles; docs describe explicit, user-run migration |
| AC-05 delegated Claude without personal install | met (real launcher + host) | Real launcher passes `--plugin-dir bridge-claude --plugin-dir feature-workflow-claude` (repo layout) and `bridge-claude` alone (older layout) — `scripts/native-bridge-mcp.plugin-dirs.test.ts`; real installed runtime's launcher returns both; delegated session with a personal install gets the runtime copies (override logged, zero usage) |
| AC-06 reproducible generation, portable references and helper | met | `generate.mjs --check`; every Markdown link and `${CLAUDE_PLUGIN_ROOT}` / `<package>` reference resolves inside each package; no checkout-relative reference; packaged helper exports and verifies a foreign repository from a copy outside the checkout with the installation-supplied guide; `local-delivery.md` byte-identical to the wave16 source in both packages |
| AC-07 read-only detection; update/remove non-destructive | met (fixture + host) | 18 + 19 fixture reads with path/SHA/mtime snapshots and an entry-point tripwire: no writes, entry never run; live read of this worktree unchanged; Claude update/uninstall and Codex add/remove leave fixture runtimes byte-identical |
| AC-08 docs and honest report | met after R03-01 | README install/migration/limits, `docs/plugin-distribution.md` workflow section (source table corrected: `--standalone` never waives `PACKAGE_PIN_MISMATCH`; standalone without a declaration also needs no bridge traces); this report separates host evidence from model behaviour |

## Old pin vs new resources (W17-02/03 wave16 inputs)

- Runtime 0.3.2 (`34ecb8d`) has no `local-delivery.md`; a project pinned to it is answered with
  that runtime's instructions and keeps its ZIP rounds. This delivery round itself followed them.
- The generated packages carry the final wave16 `local-delivery.md` verbatim (sha256 prefix
  `58504b2e`), including `--no-renames -z` diff/history checks, add-then-revert, dirt classes and
  `OUTCOME=PARTIAL` with a blocker. No production receipt helper is packaged
  (`tests/test_local_delivery.py:receipt()` remains test-only; its regressions pass).

## Checks on `2115018`

| Command | Result |
| --- | --- |
| `npm ci --ignore-scripts` | exit 0 |
| `npm run build` | exit 0 |
| `npm test` | exit 0; 40 files, 590 tests |
| `python3 -m unittest discover -s tests -v` | exit 0; 100 tests, 0 skipped (host tests ran) |
| `python3 -m unittest discover -s tools/pilot/tests -v` | exit 0; 140 tests |
| `python3 -m unittest discover -s tests/plugin-probes -v` | exit 0; 37 tests |
| `npm run packages:check` | exit 0 |
| `python3 scripts/plugin-probes/wave17_probe_distribution.py --out …/W17-03-host-probes.json` (at `d533651`) | exit 0; all fixture, Claude and Codex findings true |
| `node docs/tools/check-doc-links.mjs` (the repository's tracked documentation gate) | exit 1 at base `9e7e9c0`, at `b093faf` and at the correction head: exactly the same two historical wave16 findings, no new problem (below) |
| `python3 scripts/plugin-probes/wave17_doc_links.py` (supplemental, W17-04) | no broken links; findings identical to base |

## Historical documentation findings (reported separately)

The documentation gate is the tracked `docs/tools/check-doc-links.mjs` (relative links, anchors,
absolute filesystem paths over README, CONTRIBUTING, CHANGELOG and `docs/`). It was run on full-tree
extracts of each revision and exits 1 at the implementation base `9e7e9c0`, at the correction base
`b093faf` and at the correction head, each time with exactly these two problems, both in wave16
records that were not edited:

- `docs/features/F-W16-local-delivery/execution/W16-01/01.md:57` — absolute filesystem path;
- `docs/plans/wave16-progress.md:113` — absolute filesystem path by the gate's rule (the line's
  prose names a workspace and home target).

Exit 1 is therefore the recorded baseline, not a full-check PASS, and the gate was not changed.
The coordinator independently ran the same gate at base and head with the same result. The
supplemental `scripts/plugin-probes/wave17_doc_links.py` (tracked-file view per revision) finds no
broken link and the same two lines under its looser rule. An earlier version of this section and
W17-04 ledger 01 said no checker existed; that was wrong (R03-N1) and is corrected in ledger 02.

## Residual limits (UNVERIFIED, not claimed)

- Which entry a model picks from a natural request when several are listed.
- Whether a model runs the preamble's reader and follows its answer, or a round contract over a
  personally installed copy (pre-W17 runtimes such as 0.3.2 still show a personal
  `feature-workflow` beside `bridge-claude:*`).
- Codex `$feature-workflow:<skill>` composer syntax and plugin-root expansion in Codex skill text
  (the packages avoid relying on it; `<package>` is defined in each entry).
- Git-hosted marketplace refresh (local marketplaces were used) and any published release: the
  release descriptor still pins `34ecb8d`; publishing and moving pins are separate actions.
