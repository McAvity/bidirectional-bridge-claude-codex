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
