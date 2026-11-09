# Bridge 0.8.0 / workflow 1.0.0 release

Status: preparing, 2026-11-09. User authorization: [decision05](../features/F-W19-workflow-versioning/decisions/05.md).
Integration branch: feature-workflow. Release worktree: release/0.8.0.
Merged a301025 (F-W19) with 8540de7 (latest upgrade script); merge was conflict-free.
Keep upstream main, all historical evidence and active project pins unchanged.

Publish two separately versioned components in the existing McAvity marketplace.
Source commit precedes the distribution pin and workflow registry entry; tags will reference
the validated distribution commit. No npm publication, personal plugin refresh or runtime activation.
R19-N01 documentation contradictions corrected in one batch. No product logic correction.
R19-T01/T02 and real-agent pilot remain deferred. AC-04 NOT_TESTED, W19-06 partial;
publication is authorized separately from full behavioral acceptance.

Next: generate packages; validate; commit source; pin source/register workflow identity;
validate distribution; integrate/push; exact-SHA CI; annotated component tags and releases.

Source pinned: 5210fdbee712cebab431777b759a6532031f049c; workflow identity sha256:34ff737662b404b6409be2596a190318b27d2cbfa390351e2c7c22ea75c63396.
Both workflow variants have this identity; registry refers to the source commit.
Local source build, package equivalence and doc links PASS. Distribution validation pending.

First distribution33e455a: JS752 PASS/1skip; Python3 fixture failures; operator setup
also refused a reused public version. R19-P01 corrected in tests/private fixture generator
without changing runtime or workflow bytes. Release validation is repeated on corrected
distribution; no failing run is claimed PASS. Runtime install and41-tool handshake passed.
