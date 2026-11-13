# Workflow 1.1.5 release

User authorized publication and requested Claude plugin update instructions on 2026-11-13.
Branch: `release/workflow-1.1.5`. Reviewed source:
`d11de438ce533865b716424282e57d0894852968`.
Bundle identity:
`sha256:9fe269b83273f2df8a3f10034d339f74343115e249ba49f91565158e61b01fb8`.

## Change and evidence

[Diagnosis and regression evidence](claude-plugin-in-use.md): Claude's cache-root
`.in_use/` directory falsely triggered `ENTRY_BUNDLE_CORRUPT` in 1.1.3 and 1.1.4.
The verifier now prunes only that actual Claude root directory before traversal.
Files/symlinks with that name, bundle contents, unexpected files elsewhere, changed
instructions and Codex package contents retain their existing checks.

Source bundle/entry tests passed 50/50, including seven marker regressions; independent
review found no blockers. New verifier accepted the unchanged installed 1.1.3 cache
with its marker present; the candidate resolver in the affected project reached ordinary
`SELECTION_REQUIRED`. Neither result claims a new live model/session run.

## Publication result

[Workflow 1.1.5](https://github.com/McAvity/bidirectional-bridge-claude-codex/releases/tag/workflow-v1.1.5)
published as a public experimental prerelease at 2026-11-13T07:19:42Z.
Immutable annotated tag `workflow-v1.1.5` resolves to distribution commit
`5b83953e9d9afd4d0b3d6651d4b98dc01879091a`; the registry retains the source commit above.
The marketplace integration branch advanced without force. No npm publication or
installation into the user's running clients. Bridge 0.8.2 bytes and feature locks remain unchanged.

[Exact-SHA CI 43383595353](https://github.com/McAvity/bidirectional-bridge-claude-codex/actions/runs/43383595353)
completed successfully before the tag/release: build, package equivalence and documentation
checks; protected observer 21 PASS; JavaScript 782 PASS / 2 skips across 56 files;
Python 333 cases OK / 6 skips; pilot tooling 131 cases OK / 2 skips.
Local build, package equivalence, documentation (327 files) and diff checks also passed.
Focused local bundle/entry validation is recorded above. This release does not claim a
new full macOS suite or live model run; earlier host-specific full-suite limitations remain
recorded in the [1.1.4 checkpoint](workflow-1.1.4-release.md).

Publication is complete. Next: user updates/reloads the Claude entry plugin using the
commands below and retries the originally blocked feature-design request.

## Claude update instructions

For the existing user-scoped installation, run in a normal terminal:

```sh
claude plugin marketplace update claude-codex-bridge
claude plugin update feature-workflow@claude-codex-bridge --scope user
claude plugin list
```

The installed workflow version should be 1.1.5. In the existing Claude session, run
`/reload-plugins`, then invoke the feature skill again. Starting a new Claude session
also loads the new version. A manual cache deletion/uninstall is unnecessary; retain
`.in_use` and stored feature bundles. This updates the entry plugin, not the workflow
lock of an existing feature or the project's Bridge runtime.

Commands were checked against the installed CLI help and the official
[plugin command reference](https://code.claude.com/docs/en/plugins/cli-reference#plugin-update),
including its [reload command](https://code.claude.com/docs/en/plugins/cli-reference#reload-plugins).
