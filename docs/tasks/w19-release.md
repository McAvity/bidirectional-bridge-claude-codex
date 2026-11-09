# Bridge 0.8.0 / workflow 1.0.0 release

Status: published, 2026-11-09. User authorization: [decision05](../features/F-W19-workflow-versioning/decisions/05.md).
Integration branch: feature-workflow. Release worktree: release/0.8.0.
Merged a301025 (F-W19) with 8540de7 (latest upgrade script); merge was conflict-free.
Keep upstream main, all historical evidence and active project pins unchanged.

Publish two separately versioned components in the existing McAvity marketplace.
Source commit precedes the distribution pin and workflow registry entry; tags will reference
the validated distribution commit. No npm publication, personal plugin refresh or runtime activation.
R19-N01 documentation contradictions corrected in one batch. No product logic correction.
R19-T01/T02 and real-agent pilot remain deferred. AC-04 NOT_TESTED, W19-06 partial;
publication is authorized separately from full behavioral acceptance.

Preparation sequence (completed below): generate packages; validate; commit source; pin source/register workflow identity;
validate distribution; integrate/push; exact-SHA CI; annotated component tags and releases.

Source pinned: 5210fdbee712cebab431777b759a6532031f049c; workflow identity sha256:34ff737662b404b6409be2596a190318b27d2cbfa390351e2c7c22ea75c63396.
Both workflow variants have this identity; registry refers to the source commit.
Local source build, package equivalence and doc links PASS. Distribution validation pending.

First distribution33e455a: JS752 PASS/1skip; Python3 fixture failures; operator setup
also refused a reused public version. R19-P01 corrected in tests/private fixture generator
without changing runtime or workflow bytes. Release validation is repeated on corrected
distribution; no failing run is claimed PASS. Runtime install and41-tool handshake passed.

## Published checkpoint

- Source5210fdbee712cebab431777b759a6532031f049c, runtime0.8.0-5210fdbee712.
- Distributione1f5feea3498e9952f65d93037ae8cf493f3321d, both annotated component tags.
- [Bridge0.8.0](https://github.com/McAvity/bidirectional-bridge-claude-codex/releases/tag/bridge-v0.8.0)
  and [workflow1.0.0](https://github.com/McAvity/bidirectional-bridge-claude-codex/releases/tag/workflow-v1.0.0)
  are published experimental prereleases, not drafts. No npm publication.
- [Exact-distribution CI42624893899](https://github.com/McAvity/bidirectional-bridge-claude-codex/actions/runs/42624893899):
  SUCCESS. JavaScript752PASS/1skip; Python242 run/5 host skips; pilot131 run/2 optional
  PTY skips. Install/build/packages/docs/protected observer also PASS.
- Local isolated Linux validation: JS752PASS/1skip on33e455a (unchanged product);
  final e1f5fee Python242PASS, pilot129PASS/2skip, workflow contract/operator27PASS,
  build/packages/docs/diff and clean checkout PASS. Local real CLI checks cover the
  host checks skipped in CI. No model login or calls.
- Fresh runtime installation and real stdio MCP handshake:41 tools including workflow
  binding, no manager claim or database created. No project activation.
- R19-P01 CLOSED: fixture candidates/private pilot versions no longer reuse published
  versions; registered-version refusal remains tested. R19-N01 CLOSED by the publication
  documentation batch. R19-T01/T02 remain OPEN with the deferred pilot.
- feature-workflow fast-forwarded and pushed. Tag-triggered duplicate CI does not replace
  the successful exact-SHA run above. No historical tag moved.

This project's selected runtime remains0.6.2-771e797a73d3. Personal plugins, credentials
and other projects were not modified. AC-04/model parts of02/03/06/08 remain NOT_TESTED;
W19-06 remains partial, no full feature_accept. Authorized experimental publication is
not a claim that the model pilot passed.

## Adoption on another machine

Refresh the existing claude-codex-bridge marketplace, update installed bridge plugins and
feature-workflow1.0.0, then use bridge-upgrade in the chosen worktree for engine0.8.0.
Follow the updater's close/apply/restart sequence and verify status/doctor. No source SHA,
local candidate branch or extra login profile is needed. Plugin refresh alone does not
activate a project runtime; upgrading the engine alone does not update coordinator skills.
Start a small new feature for evaluation. Existing features keep their recorded workflow
or require explicit legacy adoption; never silently choose latest. Future compatible
workflow-only releases need only a plugin refresh/client restart, not another engine upgrade.
