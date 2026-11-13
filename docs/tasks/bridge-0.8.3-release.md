# Bridge 0.8.3 — local coordinator closure

User authorized the correction and publication on 2026-11-13. Branch:
`fix/feature-cancel-local-work`. Scope: support cancellation/rejection after completed
native coordinator work without weakening executor settlement or altering project data.

## Cause and correction

Closure scanned all coordinator descendants as adapter executions. A direct child
created, owned and completed locally by the manager has a legitimate COMPLETE delivery
and verification but no adapter attempt. Earlier engines incorrectly refused closure.

The exception requires a direct manager-created/owned child, DONE, attempt zero, no
attempt rows, no membership in the feature round list, no delegation event, and a
matching COMPLETE delivery with nonempty all-passing verification. Open attempts and
held leases are rejected first. Other descendant/lineage checks remain unchanged.
No attempt, acceptance, or task result is fabricated; code/history remain untouched.
Cancelled features cannot run again, and their released slot can serve a replacement.

## Validation and publication progress

Local Node 24 build, package equivalence, documentation and 139/139 focused
closure/workflow/recovery tests pass (45 closure cases, including 14 new regressions).
Independent review found no production blockers; test fixture setup errors found during
development were corrected before the passing run. On a disposable private snapshot of
the affected project's database, the candidate cancelled the feature, preserved child
task/attempt/delivery history and released its slot. The original database was opened
read-only; the snapshot was removed and no private data was committed.

Exact-distribution CI must succeed before an immutable `bridge-v0.8.3` tag and
experimental GitHub release. Installed-runtime verification follows the source commit.
No npm publication. Workflow stays 1.1.5 with unchanged bundle identity and locks.
No live project database is changed by this release work; no paid model is required.

## Adoption

Update the Bridge plugin and use `bridge-upgrade` in the affected project to select
runtime 0.8.3. Follow its installed-runtime updater and client restart instructions.
After confirming live MCP workspace/runtime, retry `bridge_feature_close` with the
recorded cancellation decision and stable idempotency key. This runtime fix cannot be
activated by merely updating workflow skills. Accepted partial results remain historical;
unfinished scope is cancelled, without merging, deleting or reverting source changes.

## Initial release validation and fixture correction

Initial source `175f5d13ba2e0bf90b91c4cc5e40029181bb9149`, distribution `def9d01`:
isolated runtime install, manifest, compiled closure and standalone MCP (41 tools,
correct caller/delegation/workspace, no database created) passed. Running Vitest inside
the immutable installed tree was refused because its config loader writes a cache;
compiled API/MCP checks were used without changing runtime permissions.

CI 43456438980 passed JavaScript but failed two Python trial-preparer tests before pilot
tests. Their fixtures copied this checkout's deliberately older project pin, so the new
release pin guard fired before the transport/lock guard under test. The fixture now
aligns only its disposable project pin with its release, with a separate explicit drift
refusal test. Production preparation and the real project pin are unchanged. All six
focused preparer tests pass. A new source/distribution will include this fixture correction;
no tag or release was published from the failed distribution.

## Final pinned source

Source `91ae998c8891b4f0ee8f19e8ea33d03184212007`; runtime `0.8.3-91ae998c8891`.
Distribution metadata is regenerated to this source; workflow bytes remain unchanged.
