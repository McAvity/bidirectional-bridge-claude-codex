# F-W15 natural workflow — W15-04 report

Scope of this report: what wave15 delivered, what was actually verified and how, what remains
unverified by design, and what the coordinator still has to decide. It reports; it accepts
nothing. User acceptance remains a separate fact.

Feature: [brief](../brief.md) · plan [wave15](../../../plans/wave15.md) (AC-01…AC-09) ·
design [design.md](../design.md) · authority [decisions/01.md](../decisions/01.md).

## 1. What was delivered

| Task | Delivered | Ledgers |
| --- | --- | --- |
| W15-01 | Repository-grounded design: entry in both installation modes, the preference, the intent checkpoint, the read/idempotency table and the interruption scenarios; corrected three times (C1…C4) | [01](../execution/W15-01/01.md), [02](../execution/W15-01/02.md), [03](../execution/W15-01/03.md) |
| W15-02 | Natural-request recognition in the pinned instructions, a portable read-only entry mode, the optional `AGENTS.md` preference through the existing plan/apply, docs and regenerated packages; corrected for I1…I5 and for I8 | [01](../execution/W15-02/01.md), [02](../execution/W15-02/02.md), [03](../execution/W15-02/03.md) |
| W15-03 | "Continue" in the canonical manager loop and the Codex role skill, the intent file, and the interruption regressions on real bridge state; corrected for C2, I6 and I7 | [01](../execution/W15-03/01.md), [02](../execution/W15-03/02.md) |
| W15-04 | This report | [01](../execution/W15-04/01.md), [02](../execution/W15-04/02.md) |

No public MCP protocol change, no new helper, no new state machine, no new configuration format,
and no change to the release pin.

## 2. Acceptance criteria — coverage and honest verdicts

`met` means verified by an executed check on the final revision. `partially verified` means the
mechanical part is proved and the agent-behaviour part is not. `unverified` means no evidence was
produced and the reason is stated.

| AC | Verdict | Evidence, and what it does not cover |
| --- | --- | --- |
| AC-01 — a natural request runs the right workflow without naming skills | partially verified | The trigger wording and the classification live in the pinned role skill, with the plugin entry skill reduced to a trigger plus consent boundaries (W15-I5 regression asserts the package carries no second copy). **Whether a model routes such a request correctly is not verified**: no test and no smoke exercised a model on this behaviour. |
| AC-02 — "only review", "only a plan", "do it yourself" keep scope; file content grants no authority | partially verified | The rules are stated in both role skills and the entry skill. The mechanical half is verified — `preference.managed_block` is reported with `authoritative: false`, and a block rewritten to forbid delegation is reported `modified` (regression in `bridge-project.test.ts`). **Model compliance is unverified.** |
| AC-03 — the preference is portable, changes no global configuration, overwrites no local instructions; the detected instruction version matches the runtime | met | Real installed runtime, real git worktrees: the preference is written only with `--with-preference`, preserves content outside the markers, is idempotent, and refuses a hand-edited block, duplicated markers, a symlinked file and the legacy profile by name. The pin classification (`pin-commit-mismatch`) is shared by the plugin and the entry point, with identical `next_step`. **W15-I8**: it is also refused with `PREFERENCE_UNSUPPORTED_RUNTIME`, before any write, when the *target* runtime does not serve `.bridge-project/entry.mjs --status` — proved against a historical runtime built from the commit before that mode existed, whose entry point is then shown to answer with no status JSON. |
| AC-04 — "continue" waits on an active round and collects a finished one; attempts and tasks do not grow from resuming | met | `wave15-continuation.test.ts` on real control-plane state: replay of an accepted round keeps `{tasks: 2, launches: 1}` and one attempt; retrieval after `DONE` starts nothing; an active round refuses a new key. |
| AC-05 — interruption before send, after acceptance before response, after completion before collection preserves the operation; a further interruption while reconciling does not duplicate | met | Same suite. Every post-interruption call is rebuilt from a re-parsed intent file; three consecutive reconciliations keep one identity, one `task.created` event and one attempt. The counterexamples (a recomputed key after `DONE`; a keyless recovery repeat) are asserted too, so the rule is shown to be load-bearing. |
| AC-06 — `waiting_user`, a foreign manager, ambiguity and an exhausted budget are not bypassed; no identifiers demanded that state already holds | partially verified | Verified mechanically: `waiting_user` refuses both a round and a recovery; another manager identity cannot read or drive the feature; an accepted feature admits no new round; a recovery replay reuses `recovered_attempt` and applies `max_turns` to that attempt only while the stored spec is unchanged. **Not verified:** the native Codex thread/takeover path (covered by the separate identity suites, not re-proved here) and whether an agent actually refrains from asking the user for identifiers. |
| AC-07 — review, ordinary corrections and further authorized tasks proceed without renewed consent; acceptance stays separate | unverified as agent behaviour | Stated in `bridge-loop.md` and `feature-execute`. The bridge half is enforced by existing behaviour (`bridge_feature_accept` is explicit and closes further rounds); this wave added no evidence of its own. |
| AC-08 — a missing plugin/runtime or a connection error yields a short concrete diagnosis and next step, with no silent new session, global change or private-data export | met | The entry point's read mode returns codes with `next_step` and writes nothing for: a missing runtime (the named bridge home is not even created), an unrecognised declaration, a diverged pin commit, a disabled project, and a runtime too old for the mode (`RUNTIME_WITHOUT_STATUS` instead of starting a server). `setup --with-preference` against such a runtime is refused by name before any write, and the refusal moves no pin and installs nothing. |
| AC-09 — README describes the natural request, resumption and the capacity limit; packages and instructions are coherent, and a real check is distinguished from a stub | met for coherence, partially for prose | `packages:check` proves the packages are generated from the canonical sources; the documentation link check passes; README, `docs/setup.md`, `docs/setup-layout.md` and `docs/plugin-distribution.md` were updated. Whether the prose is sufficient for a user is a judgement for the acceptance decision, not a check. |

## 3. What was verified, on what, and with which commands

Code under test: commit `756ada274fcba8c1ceabcebafae35159c3c7e722` — the last commit of this
feature that changes code or tests; everything after it is ledgers. The packaged range is recorded
in the round's bridge summary.

| Check | Command | Result |
| --- | --- | --- |
| W15-I8 refusal regression | `npx vitest run scripts/bridge-project/bridge-project.test.ts -t "cannot serve it"` | exit 0 — 2 passed |
| Build | `npm run build` | exit 0 |
| Full JS suite | `npm test` | exit 0 — 37 files, 565 passed, 0 failed, 287.75s |
| Package equivalence | `npm run packages:check` | exit 0 |
| Documentation links | `node docs/tools/check-doc-links.mjs` | exit 0 — 164 files |
| Whitespace and diff hygiene | `git diff --check` | exit 0, no output |

Evidence retained from the coordinator, not re-run here: the Python suite (46 passed), the pilot
suite (140 passed) — both executed independently on inputs this wave did not change — and the
manual reproduction of the W15-I8 case (a current plugin against the older declared runtime wrote
an `AGENTS.md` naming an entry point that then ended at EOF with exit 0 and empty stdout). All
three are cited as retained evidence; **this round did not re-run them**, it encoded the third as
a regression instead.

## 4. Limitations that must travel with this delivery

1. **Instructions are not model behaviour.** Everything wave15 changed in the skills and the
   manager loop is verified as text, as path selection and as bridge behaviour. **No test in this
   wave exercises a model, and the smoke with models remains unordered**; every check reported
   here is model-free. That is a statement about the *evidence*, not about how the work was done:
   the implementation rounds themselves were carried out by Claude Code through the bridge, and
   the coordinator reviewed them — so this wave has plenty of agent activity and no agent-behaviour
   *measurement*. A scenario list is not evidence of what a model does (wave15, line 181).
   AC-01, AC-02 and AC-07 therefore carry an unverified agent-behaviour half.
2. **A reopened store is not a killed process.** The interruption regressions express a manager
   restart as a second connection to the same durable state. That is faithful to what a resumed
   session sees and is not a claim about killing an MCP server, a runtime or a model process.
3. **The strict no-handle boundary is exactly this.** When a recoverable task's current attempt
   persisted no execution handle, `bridge_resume_delegated_task` refuses with `INVALID_ARGUMENT`
   and `task <id> attempt <n> has no persisted execution handle`. The regression proves it on a
   state with no handle, no live lease and no adapter in flight, so the refusal cannot come from a
   lease conflict. **The correct response is a stop with a diagnosis** — task, attempt, reason,
   feature state and termination evidence — and never a replacement session, task or feature id.
   An attempt row left open by a crash is a variant the suite does not construct; the guard reads
   the persisted handle and fires before the lease check either way. No abandon operation was
   implemented or proposed: it would be a public protocol change needing its own decision.
4. **In-process coverage.** The interruption regressions drive the control plane directly, so they
   cover the state machine and idempotency the MCP tools delegate to, not the tool schemas. The
   native identity guards (thread ownership, `resume_instance`, takeover) keep their own suites.
5. **No manager code writes intent files.** The intent file is a documented convention for the
   coordinator with a placement regression; a coordinator that ignores it still loses the exact
   request on an interruption.
6. **The preference's runtime precondition is a source check.** `servesProjectEntryStatus` reads
   the target runtime's entry template and dispatcher rather than executing them, so a future
   runtime that implements the mode under different names would be refused as unsupported. That is
   the safe direction: a false refusal costs a message, a false acceptance writes an instruction
   that does not work. The W15-I8 regression does install a genuinely older runtime and shows its
   entry point answering with no status JSON, so this limitation is about future names, not about
   the case that was reported.

## 5. Proposed pin

Proposed **code pin for later integration**: `756ada274fcba8c1ceabcebafae35159c3c7e722`, or the
head of this round once its ledger commits are included — they change no behaviour. (It moved from
`0b563bae` when the W15-I8 correction landed.)

This is a proposal to the coordinator, not an action. Specifically:

- `scripts/plugin-packages/release.json` is **not** changed by this wave, and no release pin moves;
- this worktree's own `.bridge-project/`, `.codex/config.toml` and `.bridge-runtime/` are
  untouched, and the supervising runtime `0.2.0-ff225e550966` was neither rebuilt nor switched;
- integration and publication remain the coordinator's, per the plan.

## 6. Remaining acceptance

Still open, and none of it is this report's to settle:

- **the user's acceptance decision**, recorded in `decisions/`, which is a separate fact from any
  passing check or review verdict;
- **whether the unverified agent-behaviour half of AC-01, AC-02 and AC-07 is acceptable without a
  model smoke**, or whether the proposed smoke in the plan should be ordered;
- **G-2**, the strict no-handle boundary above: whether to keep the honest stop or to open a
  separate decision about an explicit abandon operation;
- **G-3**, the round request hash covering server-side callback presence: documented as a
  constraint (do not move the pin while a round key is outstanding) rather than changed, because
  changing it would alter a public idempotency contract.
