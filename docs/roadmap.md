# Next release plan

The first milestone is a self-contained public fork with the upstream history,
MIT notices, source skills, build instructions and repeatable local tests. This branch
establishes that baseline. Private pilot logs and user transcripts are not release inputs.

Next work is split into reviewable branches and worktrees:

1. **Session and workspace isolation.** Bind each feature to its manager session,
   worktree and worker session. One active manager per worktree for the initial
   supported mode. Never resume a guardian/approval session as the manager, and
   never pick a session solely by newest timestamp. Test two concurrent feature
   worktrees and restart one without affecting the other.
2. **Diagnostics.** Correlated events, version/configuration metadata without secrets,
   bounded log retention and a consistent database snapshot. Export one feature's
   diagnostics without invoking a worker. Full transcripts are optional and require
   inspection before sharing.
3. **Simple setup.** Versioned installation, project-local MCP and skill setup,
   preflight/doctor, safe updates and normal `codex` startup. Preserve existing
   settings and user changes. Avoid manually applied historical patches.
4. **Acceptance.** Verify install from a clean clone, parallel features, precise
   resume, diagnostics after a controlled failure and update without lost state.
   Incorporate the separate review/correction pilot after its results are reviewed.
5. **Dependency maintenance.** The imported lockfile has known npm audit findings;
   resolve and test them before promoting a stable release. At bootstrap,
   `npm audit --omit=dev` reports two moderate and one high finding. The unchanged
   upstream dependency baseline is not a security certification.

Development of the bridge must use a separate stable bridge build to run agents;
workers must not modify the runtime currently supervising their own tasks.
Orphan-process supervision, waking a closed manager and `/goal` remain outside
this release plan. Merge integration and shared test resources need coordination
across worktrees even when file writes are isolated.

---

## Historical upstream roadmap

# Roadmap

The project is experimental, pre-1.0, and under active development. Nothing on this page is a
commitment or a date; see [release-policy.md](release-policy.md) for what stability does and
does not mean here.

## Current phase: experimental dogfooding

The repository is published so the design and its evidence can be inspected. Development
continues to be driven by real local use rather than by feature breadth:

```text
real project usage
-> passive telemetry
-> issue discovery
-> bridge tuning
-> later controlled benchmark
```

Dogfooding should favor bounded, useful project tasks. It should record runtime-reported
worker telemetry and concrete failures without adding synthetic benchmark infrastructure.

## Near term

- Use the bridge in real local development and collect actionable issues.
- Tighten lifecycle, recovery, adapter, and documentation behavior when dogfooding exposes a
  reproducible defect.
- Keep proof artifacts minimal, redacted, and local-first.
- Maintain deterministic tests and the closed certification manifest.

## Later controlled benchmark

Plan and run comparable Claude-alone, Codex-alone, and bridged tasks only after the
dogfooding phase supplies stable scenarios and an accepted cost budget. The future harness
must define task equivalence, success criteria, repetitions, failure handling, and token/cost
semantics before execution.

Controlled benchmarking is planned but has not been completed. Until then the project makes
no claim of superiority, token savings, economic efficiency, or benchmark advantage.

## Not a current goal

Production deployment, multi-machine coordination, a supervision UI, autonomous model
routing, quota balancing, and automatic Git merging remain outside this experimental
checkpoint. The bridge does not attempt to route work to the "better" model automatically,
and no such routing has been shown to be optimal.
