# macOS setup compatibility

Scope: portable active-use detection, conservative refusal on uncertain reads,
Python TOML diagnostics, regression tests and supported immutable-runtime installation
for the requested external worktree. No availability feature edits or cache patches.

Branch/worktree: `fix/macos-setup`, `.worktrees/macos-setup`.
Bridge review unavailable: host exposes no bridge MCP and the source checkout's
pinned runtime is missing. Implementation and verification proceed locally.

Initial finding: active-use scanner only reads Linux `/proc`; all unknown reads
recommend Linux. Python TOML diagnostics collapse all execution failures together.
Validation: pending. Next: implement and validate platform-specific probes.

Implemented macOS ps/lsof coverage with bounded full-snapshot retries, unknown on
partial reads, Linux permission refusal and content-free process summaries.
Python diagnostics now separate missing executable/tomllib from execution failure.
Generated both bridge packages. Review caught and fixed bare dispatcher argv matching.

Initial verification: Node 24 build and 10 focused tests PASS; real macOS process
smoke PASS (idle, open state plus bridge, normal close, workspace with spaces).
Python suite: 100 tests, 8 optional host skips, PASS with Python 3.12/Node 24 and
canonical TMPDIR=/private/tmp, outside sandbox. Earlier attempts exposed system
Python 3.9 and sandbox/path assumptions. Full JS before committing used old HEAD
for installed-runtime tests and hit synchronous Vitest IPC starvation; add a yield
between installer test cases and rerun on committed sources. Pilot tooling has a
separate pre-existing /proc-dependent dry-run refusal on macOS; investigate baseline.
No paid models, external target writes, cache patches or publication yet.

Integration correction: requiring global process-list stability was too strict on
an active Mac. New/changed PIDs now receive targeted lsof plus identity rechecks;
only verified exits are ignored and surviving unreadable processes still refuse.
Added regression cases; 11 focused tests PASS. The initial installed candidate
was not applied. Stopped its obsolete JS run; validation resumes on corrected SHA.


Target setup applied with15d9d14; real handshake exposed a remaining doctor-only
Linux platform guard and Linux mount-table reader. Corrected Darwin platform and
mount inspection, retaining unknown for malformed/ambiguous tables and network
filesystem refusal. Review caught ambiguous ` on ` mount names; regression added.
Target needs a supported update to this final correction, then trust/restart.
Setup integration15d9d14:14/16 passed, two doctor-platform failures; Vitest IPC
starvation still required a short event-loop pause between synchronous cases.
Bridge-project test helper also relied on GNU realpath accepting a missing final
component; replaced it with equivalent portable Node filesystem handling.


Parallel integration exposed over-conservative handling of another bridge's
whitespace-containing workspace argument. The scanner now checks every possible
argument boundary, ignores it only if none can resolve to this workspace, and
still refuses ambiguity that can affect the target. Regression covers unrelated
space-containing paths and repeated workspace options. Focused12 PASS.
Final doctor on the requested worktree: macOS/APFS/config/active-use/handshake35
PASS; only project trust remains an error, plus the nonblocking Codex version warning.


Final integration timing: concurrent inherited bootstrap exceeded the test's3.5s
collection window on this host. Stop doing the process scan inside the native
mutation guard, where its result was already deliberately ignored; CLI checks
are unchanged. Give this concurrency test10s and require an actual response,
with both test processes cleaned in finally. Recheck native bootstrap/ownership.


## Final delivery — 2026-09-29

Product commits: `6ff95b0`, `15d9d14`, `79f1cac`, `f0db032`, `830dff4`.
Installed immutable runtime `0.4.1-830dff47b377`, source
`830dff47b3774658c6149f981407b81adb63c62a`, through source install and the
supported project update command. Requested external worktree reports `ready`;
macOS, APFS, Python 3.12, active-use check and MCP handshake (35 tools) pass.
Doctor still requires native Codex project trust; Codex 0.159 has a nonblocking
unverified-version warning. No manager claimed and no model delegation attempted.
External changes are only installer configuration (.gitignore, .bridge-project,
.codex), left uncommitted under that repository's task-attribution rules.
No availability feature edits, immutable runtime/cache patches or publication.

Validation on Node 24.14 / Python 3.12, with process tests outside sandbox:

- npm ci --ignore-scripts, build, generated package check and diff check pass.
- Setup integration: 16/16; process/platform/Python regressions: 12/12 pass.
- Full JS run: 598 pass, 4 fail out of 602. This is not a full green run.
  Concurrent bootstrap timing was corrected and targeted native bootstrap,
  exclusive manager ownership and ordinary CLI active-session refusal pass (3/3).
  Live WAL fixture now disables its writer's automatic checkpoint, preserving
  the main-file invariant being tested; targeted rerun passes (1/1). This final
  test-only adjustment does not change the installed runtime product code.
- Remaining JS failures: diagnostics ulimit write-refusal fixture and runner
  stderr-tail byte count. Both reproduce independently on pristine baseline
  d378e13 on this Mac; they are not fixed in this scope.
- Python suite: 92 pass, 8 optional host skips, 100 total.
- Pilot operator suite: 128 pass, 2 skips, 1 failure, 131 total. The tooling
  dry-run scoring failure includes its separate Linux /proc file-holder probe
  (and manager-turn criterion); production setup correction does not port that
  operator-only fixture. No real-agent pilot success is claimed.
- Real macOS synthetic process smoke passes: idle workspace, bridge plus open
  state descriptor, client-named process, normal exit, sandbox uncertainty and
  a workspace path containing spaces. No model invoked.
- Actual system Python 3.9 gives the specific missing-tomllib instruction;
  Homebrew Python 3.12 parses successfully; missing executable is distinguished.
- Independent bounded code review found no concrete false-idle or guard-bypass
  issue in final production changes; earlier dispatcher/mount findings were fixed.

Next: launch/restart Codex in the target with Node 24 and Homebrew Python 3.12 on
PATH and approve its native project-trust prompt. Review/merge this local source
branch before a general release; plugin marketplace/cache remains at 0.4.1.
Remaining baseline JS and operator pilot portability failures are separate work.


## Publication authorized — 2026-09-29

User requested merge to the default branch, publication and upgrade of this bridge
repository. Fix fast-forwarded into feature-workflow; preparing 0.4.2 in the isolated
release/macos-0.4.2 worktree. Existing main-checkout pin is 0.4.0-4ef8461996a2,
not installed locally; selection absent. Normal active-session checks will apply.
Next: pin release source, validate Linux CI, publish prerelease, refresh installed
Codex bridge plugin and prepare/apply this project's checked setup.


Release CI 36592810435 refused Linux setup with ACTIVE_USE_UNKNOWN: same-user
process information on the hosted runner could not be read. The production guard
remains conservative. CI now runs regression suites under a dedicated unprivileged
UID, separating test processes from hosted-runner infrastructure, and restores
checkout ownership for post-job actions. No model or credentials are passed to tests.
Next: validate isolated-user Linux CI before publishing.

CI 36593587176 confirmed runner-UID EACCES on cwd/fd access (35 unreadable
operations). The dedicated user then could not traverse the runner home directory to the source;
use an owned copy under /tmp instead. Checkout credentials are not persisted.
The source checkout stays owned by the runner; tests remain unprivileged.
