# Claude plugin liveness marker false corruption

2026-11-13. User reported that Claude feature-design refuses the active workflow entry
with `ENTRY_BUNDLE_CORRUPT`, including after a plugin reinstall.
Branch: `fix/claude-plugin-in-use`, based on published checkpoint `ec82147`.

## Diagnosis

Read-only verification of the installed Claude workflow 1.1.3 reports only the host
cache-root `.in_use/<pid>` marker as `not in bundle`; all payload and bundle checks
otherwise pass. A disposable copy of published workflow 1.1.4 with a synthetic marker
reproduces the same error. `resolve --new --standalone` also refuses that copy:
own-entry integrity is checked before project/standalone instruction selection.

The marker is client-owned cache metadata, not an instruction file. Reinstalling the
same verifier does not fix the cause; deleting live markers or rewriting pinned bundle
bytes would be the wrong repair. No installed cache, marker, project pin or feature was
changed during this diagnosis. The real project's new-feature resolver remained read-only.

## Correction

`walkEntries` has an optional exact root-directory pruning list, empty by default.
Only `verifyPlugin` for Claude supplies `.in_use`. Pruning occurs before recursive
enumeration so transient or unreadable marker contents are not traversed. A root file
or symlink with that name remains an error. Nested lookalikes, other extra files,
missing/modified instruction files, all Codex package files and the complete immutable
bundle keep their existing checks. Existing feature locks are not rebound.

The change is prepared as candidate workflow 1.1.5 because 1.1.4 is already published
and immutable. Both client packages are regenerated from the canonical helper; identity:
`sha256:9fe269b83273f2df8a3f10034d339f74343115e249ba49f91565158e61b01fb8`.
Bridge 0.8.2 package bytes are unchanged. No publication or client activation performed.

## Validation

- The new marker regression fails on published 1.1.4 with the expected precise path.
- New metadata regressions: 7/7 PASS with Node 24 and canonical macOS TMPDIR.
- Independent read-only review: no blockers; 29/29 synthetic tests covering metadata,
  generated packages, new/existing feature resolution, managed paths and reference model.
- Full bundle/entry regression run: 50/50 PASS with Node 24, including all seven new
  metadata tests (`PYTHONPATH=tests python3 -m unittest test_workflow_bundle test_workflow_entries -v`).
- Package source equivalence, documentation (326 files) and diff checks PASS.
- New canonical verifier accepts the unchanged installed 1.1.3 plugin with its marker
  still present: `VERIFIED`, same original identity.
- Candidate packaged resolver in the actual affected project returns `SELECTION_REQUIRED`
  and the ordinary `begin` next step, not corruption. It recognizes the existing 0.8.1
  binding runtime; no runtime upgrade or standalone bypass is necessary for this fix.

No live Claude session/model was started. As with the earlier workflow checks, the test
environment uses `TMPDIR=/private/tmp` to avoid the existing macOS path-alias main-entry
issue; that separate issue is not claimed fixed here. Raw installed-cache observations
remain outside committed evidence; regression fixtures are synthetic.

## Next step

Publish 1.1.5 through the normal exact-SHA release checks when authorized, then update the
Claude workflow plugin and reload its entry. Reinstalling the current public 1.1.4 alone
cannot fix this issue. Existing locks/store contents and `.in_use` markers should be kept.
