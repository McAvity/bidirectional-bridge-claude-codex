# Contract: distribution metadata (W14-01 proposal, W14-02 doctor implementation)

Status: **revision 2**. Two clearly separated parts:

- **§1–3 are implemented** as the bridge's own doctor metadata
  (`scripts/setup/distribution.mjs`, emitted by `bridge.mjs doctor --json`). This is AC-08's
  "doctor recognises the installation and versions" and nothing more.
- **§4 remains a proposal** for wave13's diagnose report. Wave13 owns logging, retention, export,
  aliasing and any allowlist; it is absent from this baseline, so **no diagnose integration is
  claimed, implied or merged**. If the executing wave13 has chosen different names, wave13's names
  win and this section is rewritten to match.

Revision 1 was returned by `reviews/01-contracts.md` as W14-R1-04: it emitted raw
`instructions.source_path` and `executor.plugin_dir`, and reported a statically configured value
as the executor that actually ran. Both are corrected below.

## 1. Privacy: locations are classes and digests, never paths

`locationOf(path)` returns

```json
{ "location": "installed-runtime | worktree | plugin-cache | user-home | other",
  "sha256": "<digest of the path string>", "depth": 7 }
```

and **no field of the metadata ever contains a path**. The class answers the question a reader
actually has — is this the immutable installation, the project, or a plugin cache? — while the
digest lets two reports be compared without disclosing a directory layout. A doctor run in this
repository was checked against its own output: the emitted block contains no absolute path.

This is deliberately the smallest safe shape, not a competing redaction scheme. Wave13 stays
authoritative for aliasing and for whatever allowlist it defines; this block is expected to pass
through it, not around it.

## 2. Configured is not observed

```json
"executor": {
  "configured_plugin_dir":     { "location": "installed-runtime", "sha256": "…" },
  "configured_package_version": "0.2.0",
  "observed_plugin_dir":        null,
  "observed_package_version":   null,
  "observed_at":                null
}
```

`configured_*` is what static configuration would use. `observed_*` may only be filled from
something that actually ran — an attempt record or a live handshake — and stays `null` otherwise.
The implementation takes observations through a separate `observed` argument and never copies a
configured value into an observed field. A doctor run that delegated nothing therefore reports
`null`, which is honest, rather than restating its own configuration as a measurement.

## 3. Divergence is tri-state

`pin.diverged` is `true`, `false`, or **`null` when it could not be determined** — for example
when the project declares no pin, or the worktree has no selection record yet. Revision 1 showed
an undetermined divergence as `false`, which reads as "they agree". The implemented rule is
`declared === null || applied === null ? null : declared !== applied`.

`integration_source` is one of `project-dispatcher`, `project-config` (a worktree still on the
wave12 per-worktree launcher) or `unknown`. It is never `plugin` for the bridge server, because
W14-01 measured that a plugin-hosted MCP server cannot learn its workspace on Codex 0.154.0.

## 4. Proposed for wave13 — not implemented, not merged

When wave13's diagnose interface exists, the smallest useful reconciliation is that a diagnose
report may embed the object of §1–3 verbatim under a `distribution` key, subject to wave13's own
rules:

1. **Additive only.** No existing wave13 field changes meaning; absence of the object is valid.
2. **Wave13 owns the channel.** It decides retention, redaction, aliasing and where the export
   lands. Wave14 contributes values and adds no sink and no second state source.
3. **No secrets.** Identifiers, versions, hashes and location classes only.
4. **Reading is not binding.** Producing the object must never assign a manager, create domain
   state or mutate a worktree; a foreign-manager refusal stays a pure refusal in logs as elsewhere.
5. **Null over guessing.** A runtime that did not export a field reports `null`; a version is never
   reconstructed from a directory name.

The concrete next step is a coordinator-level reconciliation with the executing wave13 once its
interface exists. Nothing in this round depends on it.
