# Doctor: explicit Codex profile context

Scope: `bridge.mjs doctor` queries Codex in an explicitly chosen CLI context and reads trust
from that context only. Branch/worktree: `fix/doctor-profile-context`,
`.worktrees/doctor-profile`, base `4367467`. No version bump, release, runtime rebuild or
launcher change; the supervising 0.4.2 runtime is untouched.

Problem: an interactive shell function may add `--profile <name>` to `codex`; doctor's own
`codex` subprocess does not see shell functions, so without `--codex-profile` it checked the
default configuration and reported `CODEX_PROJECT_UNTRUSTED` although the running client loaded
the bridge. Trust fallback also treated any `trusted` entry in any read file as decisive, so a
base `trusted` hid the selected profile's own `untrusted`.

Change:

- Selection: `--codex-profile` > `CLAUDE_CODEX_BRIDGE_CODEX_PROFILE` > default (no profile).
  Empty or malformed explicit values (Codex accepts letters, digits, `_`, `-`) are
  `CODEX_PROFILE_INVALID` before Codex runs; never a silent fallback. No hostname logic, no
  globbing or merging of other profiles.
- The same profile goes to `codex mcp get` and the trust fallback. Report field
  `codex_context {profile, source}`, text line `codex context: …`, context in each
  `codex_project` summary and details; help text and [setup](../setup.md#codex-context) updated.
- Trust layering: `<name>.config.toml` over `config.toml` per path; worktree entry before main
  repository entry. A legacy `[profiles.<name>]` table counts as an existing profile without a
  separate file. Malformed selected profile file, Codex refusing the profile (e.g. Codex 0.159
  rejects legacy tables and bad names), or a profile with neither file nor table are
  `CODEX_PROFILE_INVALID` / `CODEX_PROFILE_NOT_FOUND`, not project errors.
- `CODEX_PROJECT_UNTRUSTED` now says the result applies to the queried CLI context, may differ
  from a session started with another profile, and names the flag/environment remedy.

Codex 0.159 behaviour observed with a synthetic temporary `CODEX_HOME` (no user
configuration read): missing profile file is accepted silently; legacy table and invalid names
are refused. Plugin copies regenerated with `npm run packages`.

Validation: see the delivery summary of this commit (Node 24.14, Python 3.12). Reproduction:
the new synthetic tests fail 5/6 against the previous `doctor.mjs` (legacy-table compatibility
case passes both ways).

Risks: Codex's exact trust resolution between worktree and main-repository entries is inferred,
not specified; malformed or unreadable base configuration leaves trust unknown
(`CODEX_CONFIG_NOT_LOADED` with `malformed_files`). Real-host verification with the user's
profile is left to the user/manager.


Manager review after attempt completion:

Claude created commit 31370d3, but bridge attempt task_p6ddajbzx3 ended TIMEOUT at
its 30-minute deadline without a structured deliverable or recorded verifications.
No replacement worker or recovery attempt was started. Manager reviewed the committed
revision and independently verified all six new profile cases, build, packages and
documentation checks. Real-host environment-selected profile gave doctor status OK
and a 35-tool MCP handshake. This is useful implementation evidence, not a successful
completed bridge delegation.

Review found a missing case: a successful CLI server query could hide malformed
selected configuration. A synthetic reproduction returned codex_project OK with a
broken selected profile. Correction refuses an unverifiable selected context even
when the query succeeds; expanded regression covers malformed profile and base files.
The untrusted diagnostic now refers to effective trust, including explicit overrides.
Final regression verification follows; active runtime and personal launcher unchanged.


Final manager validation (Node 24.14 / Python 3.12, macOS, process tests outside sandbox):

- `npx vitest run scripts/setup/setup.test.ts scripts/setup/processes.test.ts`:
  34/34 pass, two files, 242.02 seconds. Includes six profile cases, expanded
  malformed-config success-response coverage and existing setup/process protection.
- `npm run build`, `node scripts/plugin-packages/generate.mjs --check`,
  `node docs/tools/check-doc-links.mjs`, `git diff --check`: PASS.
- Independent synthetic malformed-profile reproduction now returns
  CODEX_PROFILE_INVALID (before correction it returned OK).
- Real-host explicit environment profile: doctor status OK, context source
  environment, selected project MCP configuration OK, handshake 35 tools.
- No full repository suite rerun claimed for this change; the relevant setup and
  process suites and build/distribution/documentation gates passed.

Implementation is reviewed and committed locally on fix/doctor-profile-context.
Next: merge/release through the ordinary workflow when requested, then update the
runtime and explicitly propagate a launcher's selected profile through the documented
environment variable. Default/no-profile machines need no extra setting. Personal
launcher, active runtime and marketplace cache are unchanged. The timed-out child
remains FAILED in bridge state; successful implementation review does not relabel
its incomplete protocol delivery as a completed delegated run.


Publication authorized: user requested release and runtime update. Preparing 0.4.3
in release/doctor-profile-0.4.3. Current project's selected runtime is 0.4.2; keep
it unchanged while its client is active. Next: CI, publish, refresh plugin, install
an immutable runtime and prepare checked deferred update with explicit profile.


## Release 0.4.3 published — 2026-09-29

User authorized release and runtime upgrade. Merged into feature-workflow; annotated
tag/GitHub prerelease v0.4.3 at d356c81cb242cecc40321e3aa03d163e388f3df1.
Runtime source a2cc94209132fa1768ef3aec77115483eac67968.
CI 36606993418 PASS: 41 files / 608 JS tests, 100 Python tests (5 skips), 131 pilot
tooling tests (2 skips). Installed immutable runtime 0.4.3-a2cc94209132 and refreshed
the existing Codex bridge plugin through its CLI to 0.4.3. No Claude marketplace
bridge plugin was installed; the runtime contains its executor package.

New runtime fresh synthetic setup/status PASS; profile source environment is reported
and MCP handshake discovers 35 tools. Synthetic repo remains untrusted as expected;
no model invocation is claimed. Old runtime and active project selection remain intact.
Private stable copy of the refreshed plugin verified against exact release pin;
deferred update script syntax checked. It runs normal update checks, status and
profile-aware doctor, then optionally resumes the exact native manager session
identified by bridge_manager_status, preserving profile environment in that session.
No setup/update apply was attempted while the current client uses the project.
Next: close affected clients, run the prepared script with --resume, then verify
selected 0.4.3 and manager continuity. No personal launcher or trust file was edited.
