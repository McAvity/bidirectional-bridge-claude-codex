# Contract: distribution metadata (W14-01 proposal, W14-02 doctor implementation)

Status: **revision 3**. Two clearly separated parts:

- **§1–3 are implemented** as the bridge's own doctor metadata
  (`scripts/setup/distribution.mjs`, emitted by `bridge.mjs doctor --json`). This is AC-08's
  "doctor recognises the installation and versions" and nothing more.
- **§4 remains a proposal**, and joint integration is **deferred by `decisions/02.md` until
  wave13 is accepted**. Wave13 owns logging, retention, export, aliasing and any allowlist. **No
  diagnose integration is claimed, implied or merged**, and this round reads and changes no wave13
  file, worktree or runtime. Deferred is not PASS.

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

`decisions/02.md` fixes the *working* boundary from wave13's frozen exporter code and its own
review, without importing anything: `runDiagnose` projects doctor checks through a projector that
keeps `id`/`status`/`code`/aliased `summary`/`next_step` and **drops arbitrary top-level doctor
additions**. Therefore `doctor.distribution` on its own is explicitly *not* diagnose integration,
and this contract must not be read as claiming it is.

When wave13's interface is accepted, the smallest useful reconciliation is that its corrected
projector explicitly allowlists a small distribution object — preferring package name and version,
the canonical runtime id and commit, the instruction digest and the declared/applied pin, with
unknowns `null` and configured facts kept distinct from observed ones, which is exactly the shape
§1–3 already emits. Nothing is embedded verbatim or unvalidated. The remaining rules:

1. **Additive only.** No existing wave13 field changes meaning; absence of the object is valid.
2. **Wave13 owns the channel.** It decides retention, redaction, aliasing and where the export
   lands. Wave14 contributes values and adds no sink and no second state source.
3. **No secrets.** Identifiers, versions, hashes and location classes only.
4. **Reading is not binding.** Producing the object must never assign a manager, create domain
   state or mutate a worktree; a foreign-manager refusal stays a pure refusal in logs as elsewhere.
5. **Null over guessing.** A runtime that did not export a field reports `null`; a version is never
   reconstructed from a directory name.

The concrete next step is a coordinator-level reconciliation once wave13 is accepted — the user
deferred it, so it is an open item, not a passing check. Nothing in this round depends on it, and
no wave14 behaviour changes when it happens.
