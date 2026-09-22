# W17-01 contract review — 2026-09-22

Verdict: **REWORK**. One required correction (R02-01) before W17-02. Names,
package layout, host evidence and compatibility direction otherwise fit the brief.
Correction is authorized by decision01; no product/user decision needed.

Reviewer: Codex coordinator, independent of Claude executor, not coordination.
Task `task_dk60b1h0c8`; range `a67aee78234ac60444d9dec18ea65f20cbdd241c..92770a4f25c7b46d7126caafac5cc3072931b392`.
Reviewed exact delivered tree (clean HEAD), contract, prototype reader, fixture/test sources,
host evidence and ledger. Operational workflow: pinned0.3.2-34ecb8d45465.

Receipt: package integrity and exact base/head PASS, SHA-256
`f7496c7d784b531677efd7e0b415b47ca4f2f7c68bec977efda7bc2e2e2c6782`.
Seven paths in endpoint and every-commit no-renames/NUL history match scope;
coordinator files untouched, new ledger present, no merges or worktree dirt.
Manager contract mistakenly named unsupported purpose `implementation`; executor correctly
used the pinned helper's `implementation-review`. Accepted as routine spelling correction,
not a change of scope or a reason to re-export unchanged evidence.

### R02-01 — required: package location overrides the project pin

Requirement: AC-03; design source matrix says a valid project pin is authoritative and
conflicts must not silently select another instruction version. Contract §4 instead grants
`RUNTIME_PACKAGE` unconditional priority. Prototype selectSource returns before reading
the declaration whenever packageRuntime sees a path beneath home/runtimes/<id>.

Observed reproduction on delivered SHA: build_fixtures in a temporary home, invoke the
reader from this worktree (pin0.3.2-34ecb8d45465) with --package-root pointing beneath
fixture runtime0.3.3-a67aee78234a. It exits0 with RUNTIME_PACKAGE/new local-delivery,
declaration=null and SET=unknown, without checking the old pin. The supplied package path
need not even exist. Placement is not proof of delegation or of the current project's pin.
The same early return bypasses missing/disabled/conflicting project state.

Correct the contract and prototype, retain one authoritative selection path and use the
runtime's existing classifier. Simplest option: remove the package-location shortcut;
resolve a declared pin first and refuse a package/runtime mismatch where necessary.
Do not invent delegation identity from a path. Keep a valid matching delegated package
working without personal installation. Add distinct old/new runtime regression cases for
matching/mismatched runtime packages and unresolved pins, with read-only checks.
Do not relax old ZIP requirements or create a new runtime/backend API.

Retain existing host evidence as historical candidate evidence; append new correction
results and a new W17-01 ledger. Do not repeat model-free host discovery unless the fix
changes it. No model pilots. Re-review only the correction and related source-selection cases.

Nonblocking notes: qualify all public entries; document explicit legacy disable/uninstall;
W17-03 must test actual generated packages and real launcher arguments, not only candidate
fixture layout. Runtime upgrades remain bridge-owned. Model natural routing/compliance is
UNVERIFIED, not a gate authorized for model smoke here.
