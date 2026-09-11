# Task: foreign commits between a round's delivery and its review

Status: proposed, not implemented. The manager loop
(`.agents/skills/feature-execute/references/bridge-loop.md`) is unchanged. Implementing this task
means changing that contract in its own reviewed change, with tests, and not together with tool
fixes.

## Problem

"Review each round" binds the review to the current `HEAD`:
- step 2: `feature_exchange.py verify … --expect-head HEAD`;
- step 3: `git diff --name-only <base>..HEAD` and `git status --porcelain`;
- step 5: a stale package or uncommitted in-scope work is a required finding for the next round,
  that is, for the executor.

The loop assumes the executor is the only writer of product code between delivery and review.
When someone else commits in that window (a teammate, the user, another tool), the contract has no
rule for it. It currently turns the drift into the executor's finding:

| Change after delivery, before review | What the checks show | What the contract does today |
|---|---|---|
| Commit by another author on top of the delivered head | `verify --expect-head HEAD` fails: the package head is not HEAD | "Stale package" becomes a finding for the next round, i.e. the executor must fix what someone else changed |
| Uncommitted change in the worktree | `verify` passes (it compares commit objects); `git status` shows the file | "Uncommitted in-scope work" becomes the executor's finding; tests run on the worktree test someone else's code as the delivery |
| Rewritten executor commit | `verify --expect-head HEAD` fails; the rewritten commit keeps the executor as author | Not a legitimate workflow; only the head binding detects it |

These behaviours were reproduced with the real `verify` on a real round package in throwaway
clones.

## Proposed rule

Separate two reviews and never attribute drift to the executor automatically.

1. **Delivery review (the round).**
   - Verify the package against the delivered SHA declared in the deliverable
     (`--expect-base <contract base> --expect-head <delivered head>`), not against `HEAD`.
   - Inspect `base..head` only and run the decisive checks on an export of the delivered head, not
     on the worktree.
   - The verdict is about the executor's delivery.
2. **Integration review (current HEAD), only when `HEAD` ≠ delivered head or the worktree is
   dirty.**
   - List `head..HEAD` with authors and the dirty paths.
   - Run the acceptance checks on the integrated `HEAD`.
   - A failure caused by drift is an integration finding that names the causing commits or paths.
     It is not a delivery finding.
3. **Routing.**
   - An integration finding within the authorized behaviour goes to a correction round whose
     contract base is the current `HEAD`. The contract names the causing change and says that
     agreed behaviour is being restored. No new consent is needed.
   - A foreign change that is itself a material decision (for example, a deliberate behaviour
     change by the user) goes to the user.
   - Uncommitted foreign work is never committed or discarded by the loop. The manager stops and
     asks.
4. **Never**
   - re-export or re-verify the executor's package against `HEAD`;
   - amend or rewrite executor commits;
   - count commits outside a round's declared range as that round's work.

## Acceptance for the change

- Scripted-executor scenarios for the three rows above. The coordinator:
  - records a delivery verdict and a separate integration finding;
  - never produces an executor finding for drift;
  - starts the correction round from the current `HEAD` for in-scope regressions.
- The manager loop text and the feature-review skill describe both reviews. Existing exchange
  tests stay green.
- The pilot collectors (`tools/pilot`) keep binding commits to rounds by declared package ranges.
  This already matches the proposal.
