# Contract: additive distribution metadata for wave13 diagnostics (W14-01)

Status: **proposed**, revision 1, and **not merged**. Wave13 owns logging,
retention and incident export; this document proposes the smallest additive
surface wave14 needs from it and nothing else. Written on
`1f7d34f1d3bf1de15c2b9cef5b3b121f2c8c27c0`.

This baseline contains no accepted wave13 diagnose interface
([decision 01](../decisions/01.md)), so everything below is written against the
wave13 **plan** and the wave12 [setup layout](../../../setup-layout.md), and it
assumes nothing about wave13's current in-progress shape. If the executing wave13
has already chosen different names, wave13's names win and this proposal is
rewritten to match — it must not be treated as a merge or as a claim on wave13's
design.

Inputs (SHA-256):

| File | SHA-256 |
| --- | --- |
| `docs/plans/wave14.md` | `94d8813cc42600f1434ec8ac16e2b262dfe8d5e92a10a17799de4c9973810289` |
| `docs/setup-layout.md` | `cc0e3d4cc44f29dfd3188f39101324efe250b9c1daf9069263b6cf7511fdca2b` |
| `docs/features/F-W14-plugin-distribution/decisions/01.md` | `66c488ff60b7f9651104238df531cd5e2d8705ab62f5ca128389347b443439b0` |

## 1. Why anything is needed

Once a package can install the bridge, "which version is running" stops being
answerable from the worktree alone. AC-08 requires doctor and diagnose to
identify the installation and the versions actually in use, and the probes give
two concrete reasons this matters:

- A Codex plugin update **deletes** the previous cache version
  ([evidence Q3](../evidence/W14-01/README.md)). A report that only names a
  plugin version can describe a directory that no longer exists, so the report
  must also name the installed runtime, which survives.
- The delegated executor's instruction set comes from `--plugin-dir` pointing at
  the selected runtime ([evidence Q2](../evidence/W14-01/README.md)). A report
  that does not record that path cannot distinguish "the executor read the pinned
  instructions" from "the executor read whatever the user had installed".

## 2. Proposed additive surface

One optional object, added to whatever wave13 already emits. Every field is
nullable, and a consumer that does not understand the object ignores it.

```json
{
  "distribution": {
    "format": "claude-codex-bridge.distribution/v1",
    "integration_source": "plugin | project-config | unknown",
    "package": { "name": null, "version": null, "marketplace": null },
    "runtime": { "runtime_id": null, "commit": null, "source": "installed-runtime" },
    "instructions": { "set_sha256": null, "source_path": null },
    "executor": { "plugin_dir": null, "instructions_set_sha256": null },
    "pin": { "declared": null, "applied": null, "diverged": false }
  }
}
```

- `integration_source` — how the bridge server reached this session: a plugin, a
  project-scoped `[mcp_servers.bridge]` block, or undetermined. This is the field
  that makes a double-server or tool-name conflict legible.
- `package` — the distribution package that supplied the skills, when one did.
- `runtime` / `instructions` — read from `runtime-manifest.json`, whose
  `instructions.set_sha256` and `instructions.files[]` already exist in the
  wave12 layout. No new state source and no re-collection of host checks.
- `executor` — the `--plugin-dir` actually passed to the delegated `claude -p`
  and the hash of the instruction set found there.
- `pin` — the declaration's pin, the pin the worktree applied, and whether they
  diverge. `diverged: true` is the machine-readable form of the condition that
  must produce a named next step instead of a silent switch.

## 3. Rules this surface must obey

1. **Additive only.** No existing wave13 field changes meaning, no field is
   removed, and absence of the object is valid.
2. **Wave13 keeps ownership** of logging, rotation, retention, redaction and the
   incident export location. Wave14 contributes values; it does not add a log
   sink, a second state source, or a new file.
3. **No secrets.** Only identifiers, versions, hashes and paths under the user's
   own control. No tokens, no credentials, no transcript content, no argv of the
   model client.
4. **Reading is not binding.** Producing this object must never assign a manager,
   create domain state or mutate the worktree. A foreign-manager refusal stays a
   pure refusal, in logs as elsewhere.
5. **Null over guessing.** A runtime that did not export a field reports `null`,
   exactly as `runtime-manifest.json` already specifies. A report may not
   reconstruct a version from a directory name.

## 4. Consumption

`doctor` shows `integration_source`, the selected versions and the divergence
cause; it gains no new check that requires wave13. `diagnose` attaches the
object as-is. Nothing here changes billing, the global sandbox, the permission
policy, or the explicit project-trust and host-consent steps.

## 5. Status and next step

Proposed, unreviewed, unmerged, and dependent on wave13 landing first. The
concrete next step is a coordinator-level reconciliation with the executing
wave13 once its interface exists — not an implementation task in wave14.
