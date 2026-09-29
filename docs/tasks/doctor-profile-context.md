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
