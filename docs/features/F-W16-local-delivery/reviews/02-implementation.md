# Wave16 implementation review

## W16-02 — 2026-09-19 — PASS for instruction implementation

Codex coordinator independently reviewed Claude task `task_sf6qj1hpp8`, range
`3fd34f7106eadc93bda8c4a0227f49d3d87445fd..1b52d63b8502037817ba0481502daaca2da728e4`.
W16-03 and combined validation remain required; no model-behaviour PASS or acceptance.

Read all canonical changed instructions and the shipped local-delivery resource,
compared guide/README/roles, and inspected the generated paths. The operational
contract ships with feature-execute; sibling links resolve without development docs.
Package verified against full base/head: hash
`5765e4ae3245e70d363db78eee5b889ee37536dabed2b0fced5f6fd37b855d9e`, integrity ok.
Range has23 paths, all in contract scope; coordinator records unchanged, tree clean.
Manager reran packages:check (digest68f7d8fa101a), relative Markdown links (67/67)
and range diff --check: PASS. Executor reports distribution15/exchange29 PASS;
manager full integration tests follow W16-03.

The instructions remove mandatory local and final ZIPs, retain optional transport,
legacy open contracts and independent review, preserve standalone execute and
user acceptance. W15 intent/replay logic and namespace are retained; no production
API, generator, release pin, state machine or supervising runtime change.
Foreign dirt classification refines the agreed no-misattribution requirement.

W16-03 test inputs (not new product decisions): preserve normalization tests,
exercise a claimed PARTIAL without blocker (adapter may return COMPLETE: receipt
must detect mismatch), deletion/staged dirt and own-vs-preexisting distinctions,
invalid base/head, out-of-scope commits including reverted changes, later HEAD drift,
no-code result, optional exchange and existing session/replay regressions.
Tests of procedural Git checks demonstrate mechanics, not model compliance.
If these expose ambiguous instructions, clarify within the accepted contract and
record the precise finding; do not add a production helper without demonstrated need.

Next: W16-03 under existing authorization, then independent review and full integration.


## W16-03 integration review — 2026-09-19 — REWORK

Reviewed task `task_fe3862d430`, attempts0/1, delivered range
`d4e8b7b18631ec61789c6391399d0e747c81e900..1f28b310a87189d534c3af519f1d3176abd1369f`.
Attempt0 ended early while waiting for background checks; bridge honestly recorded
PARTIAL/BLOCKED with no verification. Same-task recovery completed, preserving
attempt01 ledger. No replacement session/task or runtime change.

Package verify PASS (hash `dab1ba7e98c46e800aad231d4719311cb5092ef9141e1d551239d6733c093080`),
14 paths within scope; clean tree; range diff check PASS. Read both new test files,
scripted CLI fixture, instruction corrections F1–F5 and evidence report. Those
clarifications are supported by concrete tests and remain in scope. Executor full
validation: npm ci/build, JS582, Python77, pilot140, packages/links PASS. Manager
read the JS full-suite terminal summary; independent focused reruns follow the fix.
The model-free/behavioural distinction is retained; no smoke is required here.

### R02-01 — required correction: rename hides the out-of-scope source

Requirement: AC-02/03, every changed path must be checked and scope violations
must not produce false PASS. Evidence: on delivered code the manager used the
real temporary repo from `tests/test_local_delivery.py` DeliveryCase, ran
`git mv lib/other.py app/other.py`, added the new ledger and committed. Scope is
`app/**` plus execution ledgers. `git diff --name-status BASE HEAD` shows
`R100 lib/other.py app/other.py`, but the published `--name-only` endpoint and
per-commit commands show only `app/other.py` plus the ledger. `receipt(...)`
returned no findings and effective COMPLETE. Deleting the out-of-scope source is
therefore hidden by Git rename detection. This is an observed acceptance blocker,
not a hypothetical risk. Related ledger rename checks share the same class.

Correction: use path enumeration that includes both sides (e.g. explicit
`--no-renames` for endpoint and per-commit path checks, consistently including
ledger addition/deletion checks), with path-safe parsing. Add regression for
outside→inside rename and earlier-ledger rename; retain normal in-scope rename
and add/revert coverage. Fix published instructions and test transcription,
regenerate plugins, add a correction ledger and update the evidence report.
Keep production API/state machine and historical contract/ledgers unchanged.
Use existing whole-wave authority; no user decision needed.

Nonblocking test fidelity note: `LEDGER=none` is permitted only for an explicitly
read-only contract with unchanged head. The current test-local receipt checks
only unchanged head, although its default scope allows writes. Make that fixture
condition explicit rather than implying the predicate alone implements the rule.

Next: one bounded correction round in the same Claude feature session, then
focused re-review of R02-01 and related paths. Full JS/pilot results remain valid
if their source inputs are unchanged; do not rerun slow unrelated suites by habit.
