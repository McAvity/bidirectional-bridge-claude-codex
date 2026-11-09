Start order — synthetic project {{PROJECT}} (F-W19 pilot)

You are the manager of the synthetic project in {{PROJECT_DIR}}. Work as you normally would with
the installed feature-workflow plugin and the project's bridge. The user agreed the brief below and
approves the execution gate now, for this one feature only; the final acceptance stays with the
user.

Feature {{FEATURE_ID}}: {{FEATURE_TEXT}}

1. Start the feature through the workflow entry (`$feature-flow`, or `$feature-design` with the
   agreed brief above), so that the entry selects and records the feature's workflow; create the
   bridge feature, bind its workflow and commit the lock as the workflow describes.
2. Delegate exactly one implementation round to Claude through the bridge (max_turns 64) and
   review it locally.
3. Stop after that round. Report: the feature id, the workflow version and identity you follow
   (from the entry's resolve), the round outcome. Do not ask for acceptance and start no further
   round until the user asks.

Rules: stay in this one session, never start a fresh or substitute session; do not change plugins,
the runtime, the pin or any configuration; if anything is refused, report the exact code and stop.
