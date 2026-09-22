# Wave17 integrated implementation review — 2026-09-22

Verdict: **REWORK (documentation only)**. Product code and tested integration satisfy the
agreed technical scope. Correct R03-01 before final delivery; R03-N1 is an evidence wording
correction. No product scope decision or additional model pilot is required.

Reviewer: Codex coordinator, independent of Claude executor, not of coordination.
Task `task_ndebvgqx8m`; exact clean delivered range
`9e7e9c0151d666146f6b8d51ee712f1c723c3a60..4038b851bb42ea88e25e0fc162de0f799d7d2005`.
Inputs: decision01, corrected contract and review02, brief/design, ledgers02–04/report,
actual source/tests/generated manifests and skills. Pinned operational workflow0.3.2 unchanged.

## Receipt and independent checks

Package integrity/exact base/head PASS, hash
`9ad1f8ecb3c7243045bb6bd942b17c48a0e3d00e43666f655c74d70ae2eef28c`.
All61 endpoint and every-commit paths match the round scope (--no-renames/-z); ancestry,
no merges, new ledgers, preserved coordinator records/W17-01 history and clean tree PASS.
Executor summary compressed generated trees as globs; exact paths were independently
enumerated from Git and package, not inferred from those summary globs.

Independently ran on delivered clean4038b85:
- packages:check PASS (all four trees/marketplaces match generator).
- Vitest real launcher plugin-dir, runner plugin-dir and delivery normalization:15/15 PASS.
- Python workflow distribution + local delivery:50/50 PASS, including isolated real host
  discovery and rename/add-revert/earlier-ledger receipt regressions.
- Probe fixtures:37/37 PASS on generated packages, including R02-01 pin-first cases.
- git diff --check PASS; repository docs/tools/check-doc-links.mjs reports exactly the two
  baseline wave16 absolute-path findings and no new problems (exit1, not a full-check PASS).

Retained full executor checks at2115018: npm ci/build; JS590, Python100 (0 skipped),
pilot140, probe37, packages PASS. Later report/ledger-only commits do not invalidate those
product checks. Python includes a real HEAD runtime installed in a disposable home, and
Claude zero-usage host loading with personal plugin override. No supervising runtime changed.

## Code/acceptance assessment

Read canonical selector, generator/preamble, manifests, launcher and runner diff, new TS/Python
checks, rewritten probe glue, host evidence, README/distribution docs and all task ledgers.
Generated instruction/helper trees are checked byte-for-byte by the generator and targeted
resource tests. No independent copies of source-selection logic or production receipt parser.
The operational local-delivery.md is verbatim; old0.3.2 retains its ZIP instructions.
R02-01 remains resolved in product: project pin classified first, mismatched runtime package
refused; no write/entrypoint execution in covered cases. One source generates both clients;
standalone requires no bridge runtime/MCP, delegated packages come from runtime, prior
pluginDir callers and old layouts remain compatible. Bridge-upgrade/installer remain intact.
AC01/02/03/05/06/07 technically supported; AC04 host namespace/migration supported, model
routing unverified by design. AC08 needs the table correction below. See existing report
for evidence mapping; no claim of model compliance, Git marketplace refresh or publication.

### R03-01 — required documentation correction: standalone exception contradicts hard refusal

Requirement AC-03/08, contract §4 and R02-01: PACKAGE_PIN_MISMATCH is a hard refusal even
with --standalone. docs/plugin-distribution.md source table says that correctly, then says
“any `none` above” with --standalone becomes plugin/EXPLICIT_STANDALONE. That explicitly
includes the preceding mismatch row and contradicts product behaviour and agreed contract.
Make the override row explicitly exclude PACKAGE_PIN_MISMATCH (as contract §4 does).
Do not relax code or tests. Clarify that no-declaration standalone also requires no bridge
traces, consistent with the existing legacy refusal. Validate links and agreement with the
existing selector tests; no full product-suite repetition needed for prose alone.

### R03-N1 — nonblocking evidence correction

W17-04 ledger01 says no documentation checker existed. In fact
`docs/tools/check-doc-links.mjs` is tracked and was run at base and head by the coordinator;
its two historical findings were included in the round contract. The result itself is
independently confirmed (no new problem), but the explanation is false. Preserve that ledger
as history; add a new correction ledger and amend the current report to name the actual
checker/exit1/baseline comparison. The supplemental probe may remain supplemental; do not
change a gate to hide historical findings. No old wave16 records should be edited.

Next: bounded documentation correction in the same Claude session, focused re-review, then
local handoff and user acceptance request under decision01. No open code finding remains.
