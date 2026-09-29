# Linux protected-process inspection

Branch: `fix/linux-process-inspection`, base d063613. User authorized an installer fix
and asked whether Linux should switch from `/proc` to `ps`. Scope: active-use
inspection, its packaged installer copies, tests and documentation. No running runtime
is rebuilt or selected. No model calls, release or push.

Decision: retain native Linux `/proc` and macOS `ps` + `lsof`. `ps` alone lacks
cwd/open-file evidence; Linux `lsof` cannot remove procfs permission checks. Do not
skip process names or treat EACCES as idle. Add explicit environment opt-in
`CLAUDE_CODEX_BRIDGE_PROCESS_INSPECTION=sudo` for a fresh read-only privileged
system-Python observer. The rest of setup remains unprivileged. Noninteractive
sudo, isolated Python imports, original UID filtering, PID/starttime checks,
request-bound bounded JSON and fail-closed responses preserve existing refusals.
No report-file override or daemon allowlist. Native and macOS defaults unchanged.

A bounded read-only design review independently confirmed the approach and identified
UID, PID-reuse, empty-argv and output-redaction cases. This is a design review,
not an independent implementation acceptance.

Implementation and packaged copies complete; bounded independent source review PASS
(no blocking findings). Privileged reader source is trusted installer code, not a
security boundary against malicious same-user edits; setup documentation states this.

Validation (Node 24 / Python 3.12):
- npm ci --ignore-scripts and build PASS; no dependency changes.
- Focused JS: 16 PASS; new real protected-process test SKIPPED locally (requires sudo).
- Observer Python: 13 PASS, including request/response and incomplete-observation tests.
- Full JS: 530 PASS, 76 FAIL, 6 SKIP. All 76 failures plus the dependent setup hook
  reproduce on untouched base d063613: identical 77 failure labels across the two
  affected installer suites, no new failure labels. Default native observation still
  refuses this host's protected processes; downstream missing setup causes cascades.
- Full Python before the final three observer protocol tests: 108 PASS / 2 FAIL;
  both distribution-host failures reproduce on base d063613 (setup refusal).
  All 13 final observer tests pass separately.
- Pilot tooling: 140/140 PASS. Packages, documentation links (215 files), diff PASS.
- Added opt-in real protected-process test to CI using its existing sudo-capable
  runner before isolated-user tests. CI not run here, no CI PASS claimed.
- Actual local sudo observation returns unknown without terminal authorization.
  Real privileged success and the user's project switch remain unverified.

Prepared a private stable corrected installer plus a checked apply/status/doctor
script outside the Git tree. Existing immutable runtimes, databases, pins and active
sessions were not changed.

Next: validate final change; prepare a stable corrected installer and checked
exit/apply script. User closes clients and authorizes observation in their own
terminal; no active runtime is switched by this session.
