# Quiet waiting for delegated work

Implemented locally, 2026-09-23. User authorized a small instruction-only correction.
Base: de67a87. No runner/API change, release, runtime update or model pilot.

Problem: the feature loop explicitly instructed 60–120-second status polling, while
managers also inspected incomplete worker files and narrated them before delivery.

Change: using-bridge owns the waiting policy for both roles. Prefer pending calls or
completion notifications; no parallel status loop. If needed, poll known task/feature
status at most once per 10 minutes by default, honoring explicit user cadence.
No speculative reading/review of working files, diffs or transcripts. Review delivered
revisions. Concrete faults, blockers, deadlines, restarts and user questions permit
focused earlier checks. A client timeout gets one immediate reconciliation; running
work then returns to quiet waiting, without recovery or duplicate execution.
Short client wait calls and host-required communication do not authorize extra checks.
Feature execute/bridge-loop and both recovery references now agree; packages regenerated.

Validation: skill frontmatter (three skills), package generation/check, documentation
links and git diff check PASS. Compared changed waiting sections across both roles;
existing role-specific differences retained. No product code changed, no full suite needed.

Manual instruction walkthrough (not a model behaviour test):
- Pending MCP: await same call; no parallel polling or filesystem inspection.
- Asynchronous running task: status only after the default interval; no unchanged narration.
- Client timeout: immediate state read, then wait if running; no replacement task.
- Explicit BLOCKED/error or elapsed executor deadline: targeted diagnosis without waiting
  for the polling interval; recovery still requires its existing evidence and authority.
- User requests status: answer from known state or one justified current status read.
- User selects five minutes: use five instead of the ten-minute default.
- Completion: collect delivery and perform normal independent review at its revision.

These checks establish instruction consistency, not reduced token usage or model obedience.
Observe the next ordinary task after publication/upgrade; no additional paid pilot required.
Next: publish an instruction release and explicitly upgrade target projects when requested.
Current pinned0.4.0 remains unchanged; the user's direct instruction applies to live sessions.
