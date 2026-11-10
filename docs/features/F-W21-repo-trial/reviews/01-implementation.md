# W21-T01 independent review

Code verdict: **PASS** at f50dc9a8cd2b683d348a8180e8881aec65b0ba89.
Trial protocol verdict: **BLOCKED**; final round receipt is `blocked`, not accepted.
The fixture delivers exact stderr and retains exit 3/framing. The report shortened a
required command, and the coordinator exited the worker before checking receipt success.
No replacement worker or fabricated receipt was used. Final feature acceptance remains
with the user. Preserve private state; further protocol recovery needs explicit direction.

## Inputs and independence

Reviewer is the coordinating Codex session, independent of the Claude executor's
implementation, but responsible for coordination. Brief/design/decision01/task at
7f0e215e0ac59d35328429e4a2c5ac416fa1ad34; delivered range
7f0e215e0ac59d35328429e4a2c5ac416fa1ad34..f50dc9a8cd2b683d348a8180e8881aec65b0ba89.

INSTRUCTIONS=bundle:1.1.0-2205a80f5109 IDENTITY=sha256:2205a80f5109effb2596b021a4dc7738c86a9803db6fe93071f4cbf170a386eb GENERATION=1

Contract SHA256 902cd97dd0ba873ad1ea06de7c8f1f46004c4a2e428e2ea02c10258da139d897.
Private contracts/reports/history are preserved outside tracked evidence. No session or
account identifiers, raw transcripts or machine paths are included here.

## Git receipt and code

Correlation (feature/task/round/workflow), exact BASE, existing HEAD, ancestry and absence
of merge commits verified. Endpoint and every commit touch only the fixture and newly
added execution/W21-T01/01.md. No earlier ledger existed in that directory. Report scope
matches Git. Start and delivered status clean; actual worktree HEAD equals delivery.
One executor commit, no integration drift at review. Test file and production code unchanged.

The functional change replaces `process.exit(3)` with `process.exitCode = 3` only in
noresult; natural event-loop completion lets queued writes drain. No timer is active
in this branch. Other branches retain behavior. Existing total-byte and tail assertions
are preserved. Comments explain asynchronous macOS pipe writes.

## Independent validation

Tests ran on a clean `git archive` of delivered HEAD, with only installed node_modules
linked from this worktree. Node 24.14.0, Python 3.12, TMPDIR=/private/tmp.
All three exact commands from the immutable contract were rerun (no placeholder execution):

- `npm test -- claude/claude-side/src/adapters/claude-code-runner.evidence.test.ts`: 8/8 PASS.
- Direct Python subprocess: exact equality of all 100001 stderr bytes, TAIL-MARK,
  exit 3, exactly one stdout init frame and no result frame: PASS.
- `npm test -- claude/claude-side/src/adapters/claude-code-runner.test.ts`: 64/64 PASS.

Preparation independently reproduced 65536/100001 bytes and missing tail directly on
Node 24, and runner failure on Node 25. Worker reports repeated red/green runner checks;
review does not require those repeats to replace the independent checks above.
No full repository suite claim. Build passed in preparation; no production changes.

## Findings

**R01-01 — acceptance blocker, protocol/evidence.** Report verification_results uses
`python3.12 -c '<contract direct noresult fixture check>'` instead of the frozen command.
The helper compares command strings exactly and refused `accepted` with
`REPORT_NOT_ACCEPTABLE`. Independently passing the actual check does not repair worker
report correlation. Required resolution for protocol success: an authorized executor
correction of its report and a valid accepted receipt, respecting session/state limits.
Do not rewrite this report as coordinator or silently claim accepted. Final disposition
in this run: receipt `blocked`, evidence preserved, correction not performed.

**R01-02 — acceptance blocker, coordination.** The coordinator invoked `/exit` in the
same shell after the receipt helper, without stopping on helper failure. Its extraction
of the failed helper response also raised KeyError. Consequently the owned worker stopped
normally before report correction. Stopped state is confirmed (`prompt_input_exit`).
This is a coordinator error, not hcom delivering to the wrong worker. No automatic
replacement/resume is allowed by this MVP. No code correction required; record the
partial trial and require explicit continuation direction before any recovery.

**R01-N01 — nonblocking observation.** Worker saw a hang-mode deadline test fail once
in about 15 full-file runs; six isolated base runs passed. The changed functional branch
is noresult only; independent final tests pass. A pre-existing timing flake is plausible,
but not established by a reproduced base failure. Preserve this uncertainty; no unrelated
fix and no general all-green/reliability claim.

## Coverage and recommendation

Exact stderr, exit/framing, bounded committed fixture delivery and independent review:
met. Single session/one dispatch, normal owned-worker stop, budget: met. Accepted hcom
receipt and completed end-to-end trial: unmet. Do not mark the feature accepted.
The code is ready for user review; the workflow trial remains partial/blocked.
