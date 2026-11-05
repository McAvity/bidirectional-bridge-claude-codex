# F-W20 multi-repo execution contract (W20-01)

Status: proposed by W20-01; a local technical gate for W20-02/03 once an independent local
contract review releases it. It is not user acceptance. Authority:
[decision 03](../decisions/03.md) (whole scope W20-01…03), which carries
[decision 02](../decisions/02.md) including O1…O4; plan [design](../design.md) and
[brief](../brief.md) (SHA-256 `ae8bca34…33ebdc7d`), [plan review](../reviews/01-plan.md)
(R20-P01 resolved, P02…P06 adopted). Revised for R20-C01…C03 of
coordinator review 02 (`reviews/02-execution.md`) (§§ 2.6, 4, 5, 8, 12). Code inspected at base `d4fd6b44`; the runner, launcher
and scope sources are unchanged since `771e797a`.

No runtime, MCP, schema, database, adapter or helper change. Everything below works with the
current bridge; § 15 lists what the probes prove and what stays an unverified client behaviour.
A plain single-repo round keeps `local-v1` exactly as
[local-delivery](../../../../.agents/skills/feature-execute/references/local-delivery.md) states (§ 12).

## 1. Terms

- **Parent**: the worktree the coordinator runs in and the bridge `workspace_root`. Its Git root
  is the delivery line's repository.
- **Repo entry**: one logical repository touched by the round, with a stable **repo ID**
  (`^[a-z0-9][a-z0-9._-]{0,63}$`) from the plan. A plain directory of the parent is never an
  entry: its `git rev-parse --show-toplevel` is the parent (probe `plain_directory`).
- **Role**: `write` (the round commits there) or `read` (a dependency the round's commands use).
- **Kind**: `worktree` (default), `clone`, `submodule`, `existing` (an earlier checkout reused).
- **Task directory**: `.feature-repos/<feature-id>/` in the parent; a child's default **alias**
  is `.feature-repos/<feature-id>/<repo-id>`. An alias is a parent-relative path the scope and
  `changed_scope` use; its **realpath** is where the bytes live.
- **Checkout root**: `realpath(alias)` equals `realpath(git -C alias rev-parse --show-toplevel)`.

## 2. Placement and ignore

1. Default for a write entry: a Git worktree of the authorized source, physically inside the
   parent at its alias, no symlink on any path component (`symlink_on_path`), created only when
   neither the alias nor a symlink of that name exists (`lexists`). Collision with a file, an ID or
   another environment blocks that entry; it is never overwritten.
2. Ignore: add exactly `/.feature-repos/<feature-id>/` to the file printed by
   `git rev-parse --git-path info/exclude` (in a linked parent it is the common
   `info/exclude`, shared metadata), appending once and keeping every other line. The tracked
   `.gitignore` is not changed. Confirm with `git check-ignore -v <alias>/<file>`.
3. **O4.** A correctly ignored task directory produces no parent status record, so the parent's
   `WORKTREE` can be `clean` while a child is dirty. Parent `WORKTREE` and each child's dirt are
   separate facts (§ 9); a clean parent never stands in for a child.
4. Fallback **clone** inside the parent at the same alias when the executor cannot write the
   source gitdir (§ 3). It keeps the authorized source/base and never replaces existing work.
5. **External alias**: an existing checkout outside the parent, reached by a symlink alias in the
   task directory. Allowed only for an existing environment and only after both roles' write access
   was shown on the real client (§ 3); otherwise that entry blocks. It is never created as the first
   setup and an external environment is not moved silently.
6. **One checkout** means the same realroot (`realpath` of the checkout root) or the same
   per-worktree gitdir (`git rev-parse --absolute-git-dir`). Two entries, or an entry and the
   parent, that are one checkout are a finding that blocks the dependent writes. A shared
   **common dir** is not: Git worktrees of one repository, including worktrees of the parent's own
   repository, share objects, refs and config by design, and each has its own realroot, gitdir and
   branch (Git refuses one branch in two worktrees). Each entry records its branch and binding; the
   receipt checks the checkout is on it (R20-C01, probes `worktrees_sharing_a_common_dir…`,
   `symlink_alias_to_another_entry…`). Scope globs and leases are textual and cannot see a second
   alias of one checkout (TS probe `two aliases`).
7. The task directory holds only child checkouts. Checkpoints live in the per-worktree exchange
   namespace (§ 8): a parent `git clean -fdX` skips nested repositories but deletes loose files
   there, and `git clean -ffdX` deletes the whole task directory with every child checkout.

## 3. Permissions (R20-P01, O2)

| Actor | Real limit | Consequence |
| --- | --- | --- |
| Claude round executor | runner `--permission-mode acceptEdits`, `--allowed-tools Read Edit Write Bash` (native-bridge-mcp.mjs 182, 190); one `--add-dir` per literal scope prefix, parent-relative, cwd = parent (claude-code-runner.ts 678–686, 719) | Edit/Write inside the parent work. The alias text is passed unresolved; whether Claude Code follows a symlinked `--add-dir` outside the project is **not proven** and an external alias is not a passed path. A mid-path wildcard (`.feature-repos/F/*/src/**`) widens `--add-dir` to `.feature-repos/F`: per-repo scopes use literal prefixes. |
| Any executor committing in a nested **worktree** | each commit writes objects and refs into the source's common gitdir **outside the parent**; `worktree add` writes `worktrees/<name>/` there (probe `worktree_commits_write_outside`) | The executor role that commits needs write access to that gitdir. A Bash `git` command is the normal way for Claude; no sandbox is disabled for it. |
| Delegated Codex | `approval_policy: "never"`, `sandbox: "workspace-write"` (native-bridge-mcp.mjs 206–207) | It cannot escalate. If it is the writing executor, the entry is a clone inside the parent, whose gitdir is inside; otherwise the dependent writes block. |
| Coordinator / manager | its own client sandbox and writable roots | `worktree add` writes the source gitdir; with no right to do so, choose the clone. |

An Edit/Write refusal is never bypassed through Bash. Missing every compatible variant blocks only
the dependent writes; that is a host limit, not a new product gate.

## 4. Branches, bases and reuse (R20-P04)

- Default branch name: the parent's branch. If `refs/heads/<name>` exists in the child, use
  `<name>--<feature-id>` (then `-2`…`-9`) and record the mapping; the existing ref is never reset,
  moved, renamed or taken over (probe `branch_collision`). The target branch is set per repo.
- The base is the plan's version, present in the source (`rev-parse --verify <base>^{commit}`).
  An old review SHA is not an identity for other bytes; a change of base needs an in-scope reason or
  a decision.
- **Reuse** of an existing checkout always needs current Git to confirm a record: the alias still
  resolves to the recorded realroot and is a checkout root, it is on the recorded branch, and the
  recorded base is an ancestor of its `HEAD`. A branch name, the same remote or an unrelated history
  with the same name is never evidence. The record is one of (R20-C03):
  1. **Setup checkpoint** (§ 7), valid before and after any delivery: feature, repo ID, branch and
     whether setup created it, base, realroot, per-worktree gitdir and initial dirt with
     `hash-object` values. A different gitdir means the checkout was replaced: blocked. Commits after
     the base on a branch setup created, and dirt not in the initial record, belong to this task's
     earlier, undelivered attempts: they are kept and inventoried (`resume_inventory`: commits,
     dirt as `preexisting`/`overlap`/`attempt`), never reset or cleaned, and the resumed attempt
     delivers or discloses them. On a branch setup did not create, commits after the base are
     unrecorded: blocked.
  2. **Lost checkpoint, nothing delivered yet**: the bridge round contract still names alias,
     realroot, base and branch. It suffices only while the checkout has no commit after the base and
     no dirt; otherwise ownership is unresolved and the checkout is not written until clarified.
  3. **After a delivery**: a committed ledger/manifest naming the delivered head; that head is an
     ancestor of `HEAD` and every later commit is explained by a later own record.

  With no checkpoint, contract or committed record the checkout is not written; ownership is
  clarified first (probes `ResumeBeforeDeliveryTests`, `reuse_requires…`, `same_branch_name…`).

## 5. Commands, dependencies and parent tools (AC-05, O3)

Before a build/test/install/hook/codegen command runs, its write targets are established from its
configuration, including symlinked or local packages (`realpath` of each link). A target in a shared
checkout, another feature or the main checkout blocks that command; the binding is fixed inside the
task environment. A command whose target is unknown waits until it is known. Normal tool caches and
shared Git metadata are not violations.

- A **read** dependency may stay shared only while no command writes it. Its evidence is a digest
  taken before and after: HEAD, the `git status --porcelain=v1 -z --untracked-files=all` records,
  and every changed, untracked and ignored file enumerated one by one
  (`git ls-files -z --others --exclude-standard`, and the same with `--ignored`) with its size and
  bytes. A symlink contributes its target text and is never followed. Plain `git status` is blind to
  writes into ignored outputs such as `dist/`, and `--ignored=matching` only reports `!! dist/`, so
  a rewrite of an existing ignored file needs the per-file bytes (R20-C02, probes
  `rewrite_of_existing_ignored_file…`, `nested_ignored_file_and_symlink…`). The observation is
  bounded (probe defaults: 10 000 files, 256 MiB); beyond the bound there is no digest, and a
  dependency without a complete observation is not shown read-only: no PASS.
- **O3.** Parent tools that walk the filesystem (`find`, recursive globbing, some test runners and
  linters) descend into `.feature-repos/`; Git enumeration (`git ls-files`, `git grep`) does not.
  The same command-target check confirms each parent command excludes the task directory, or the
  command runs with an explicit exclusion; a parent `git clean` is never used to tidy (§ 2.7).

## 6. Submodules (R20-P06)

- A submodule is its own repo entry (`kind: submodule`, `gitlink: <parent path>`). Its gitlink stays
  tracked, never ignored; the gitlink change is a separate parent `changed_scope` entry.
- Observed (Git 2.43): in a linked parent, `submodule update --init` places the submodule gitdir in
  `<parent common dir>/worktrees/<parent worktree>/modules/<path>` and writes
  `submodule.<name>.url/active` into the **common** config. Both are normal shared metadata. The
  main checkout's submodule directory stays unpopulated and its status unchanged.
- The submodule starts detached at the gitlink; the round creates its own branch (§ 4) and never
  switches another worktree's checkout or edits other worktrees' config entries.

## 7. Ledger, local map and portability

The existing ledger holds the logical map: repo ID, role, kind, source locator, alias, branch,
target, base, bindings and conclusions. Absolute realpaths, host paths and owner facts live in an
ignored checkpoint in the parent's exchange namespace (`feature_exchange.py namespace`), without
secrets and without a second task status. The bridge round contract (not in Git) repeats alias,
verified realpath, base, scope and baseline dirt per repo so the receipt has its own reference.

## 8. Resume

Each resume reads the checkpoint and re-checks realroot, gitdir, branch, identity (root commits,
source) and bindings; only changed elements repeat their checks. A setup checkpoint alone permits
reuse before the first delivery (§ 4). A missing checkpoint is rebuilt from the round contract or a
committed record under § 4, never by cloning a second set; without either evidence the dependent
writes block. No full audit before every tool call; no new worktree or branch for the same task.

## 9. Manifest `multi-repo-v1` (bounded)

A JSON file committed next to the new parent ledger: `<ledger stem>.repos.json`. UTF-8, at most
64 KiB, unknown keys rejected. No absolute path, `..`, backslash or drive letter in any path.

| Field | Rule |
| --- | --- |
| `schema` | `"multi-repo-v1"` |
| `feature`, `task` | the contract's feature and task IDs |
| `parent` | exactly `{base, scope}`: contract base (full SHA) and parent globs. **No parent head.** |
| `repos[]` | 1…32 entries, unique `id` |
| `repos[].role`, `kind` | `write`/`read`; `worktree`/`clone`/`submodule`/`existing` |
| `repos[].source` | `{locator, roots?}`: portable locator from the plan, optional root commits |
| `repos[].alias` | portable, ≤ 256 chars |
| `repos[].base`, `head` | full SHA (40 or 64 hex). `read`: `head == base`, no scope, `digest` required |
| `repos[].branch`, `target` | required for `write` |
| `repos[].scope` | `write`: 1…64 globs, each ≤ 512 chars, each prefixed by `<alias>/` |
| `repos[].gitlink` | only for `kind: submodule` |
| `repos[].dirt` | `{baseline[], final[], more?}`, each list ≤ 200 `{path, class}`; overflow counted in `more`, full list in the ledger |
| `integration` | optional `{tested_set: {<id>: <sha>}, checks[]}`; `tested_set` names every entry and equals its `head` |

The manifest contains neither the parent HEAD nor its own hash nor the ledger's hash, so no
self-hash cycle exists. Parent HEAD comes only from line 1; the manifest hash only from line 2.
A manifest is evidence, never authorization of a path or command.

## 10. Summary transport

```text
DELIVERY=local-v1 BASE=<parent base> HEAD=<parent head> LEDGER=<path> OUTCOME=<COMPLETE|PARTIAL> WORKTREE=<clean|dirty:N>
REPOS=<parent-relative manifest path> SHA256=<64 hex>
PACKAGE=<path> SHA256=<hash> PURPOSE=<purpose> RANGE=<base>..<head> LEDGER=<path>   (only when the contract requires a ZIP)
<prose>
```

Line order is fixed: DELIVERY, REPOS, PACKAGE; single-repo keeps DELIVERY, PACKAGE. The stored
summary keeps 4000 characters (claude-code-runner.ts 204); a worst-case three-line header within
the path bounds is under 1600 characters. Prose is truncated, never a critical line or hash; a path
too long for that budget is a planning error. `changed_scope` stays a flat array (schemas.ts 349):
parent paths plus child paths prefixed by their alias; a submodule's gitlink and its files are
separate entries. The receipt never trusts that list.

## 11. Post-check evidence sidecar (R20-P02)

The local-delivery exception "only the ledger may be committed after the checks" covers the
manifest too. Every commit in `BASE..HEAD` touching the manifest touches only paths under the
round's ledger directory; a commit bundling code with it is a finding (probe `sidecar_commit_with_code`).
The manifest's heads and `tested_set` are the versions the checks ran on.

## 12. Receipt per repo

The coordinator applies local-delivery § 4 to the parent, then:

1. Parse line 2 against § 10; missing in a multi-repo contract means no delivery (PARTIAL). With a
   required package, line 3 is PACKAGE.
2. Read the manifest from the exact parent HEAD (`git show <HEAD>:<path>`), hash it, validate § 9.
   Feature, task and parent base equal the contract.
3. The entry set equals the contract: an extra ID is "manifest repo outside contract", a missing
   one an incomplete delivery.
4. Per entry: alias equals the contract; realpath equals the contract realpath and is a checkout
   root; no two entries, and no entry with the parent, share a realroot or per-worktree gitdir
   (§ 2.6). A shared common dir is allowed. A `write` checkout is on its manifest branch.
5. `write`: base equals contract; head exists and descends from base; no merges unless allowed;
   every path of `diff --no-renames --name-only -z base head` and of
   `log --no-renames --name-only -z --format= base..head`, prefixed by the alias, matches the
   repo scope; final status classified against the contract baseline as in local-delivery § 3.4.
   Own or overlap dirt in any repo makes the effective outcome PARTIAL; preexisting and foreign dirt
   are reported, not attributed. The manifest's final dirt list equals the checkout.
6. A checkout `HEAD` later than the delivered head is integration drift, reviewed separately and
   not attributed to the executor; the reviewed range stays `base..head`.
7. `read`: contract base, manifest head and actual HEAD agree and the § 5 digest is unchanged;
   otherwise "read-only dependency drift or write". A digest beyond the bound is "not fully
   observable", also a finding.
8. `submodule`: the parent gitlink at HEAD (`ls-tree`) pins the delivered child head.
9. `integration.tested_set` equals the delivered heads; checks on other versions do not count.

Dispositions follow local-delivery § 6 per repo. A COMPLETE line with any per-repo finding is
effective PARTIAL. The probe transcription is `multi_receipt` in the test file (§ 15).

## 13. Integration, partial merge and lifetime (R20-P05, O1)

- Before any merge, test a compatible set of delivered heads together. Merge is a separate
  authorization; review needs none.
- Authorized merges go dependency-first per repo target. A non-fast-forward merge creates new SHAs:
  the integrated set is retested and earlier results are not inherited. Pins are updated to the
  integrated SHAs; that pin commit is integration drift `HEAD..T`, reviewed separately.
- The integration ledger records per repo `pending`/`merged`/`failed` with the integrated SHA. The
  whole set is COMPLETE only when every repo is merged and every pin equals its integrated SHA;
  an interruption leaves PARTIAL with the next repo named, and resume continues there without
  resetting merged repos (probe `dependency_first_interrupted_merge`). No atomicity is claimed.
- **O1.** A child inside the parent lives as long as the parent directory. Probed: plain
  `git worktree remove <parent>` succeeds with an ignored task directory and deletes it. A nested
  worktree's commits survive in the source (its metadata becomes `prunable`), but its uncommitted
  work is lost; an in-parent clone loses commits that exist nowhere else. Handoffs list per child
  `git rev-list --branches --not --remotes` (clone) and child dirt, and state that removing the
  parent is not safe cleanup until that history is integrated or preserved elsewhere under
  authorization. Nothing is deleted automatically.
- Push and deploy stay separate permissions. A ZIP states which repos it covers; ignored child
  checkouts are not packed.

## 14. Single-repo fallback

With no child entry, there is no REPOS line and no manifest; local-delivery applies unchanged,
including DELIVERY, PACKAGE order. A multi-repo contract says so explicitly; the executor never
adds a repo the contract does not name.

## 15. Evidence and limits

| Probe | File | What it shows |
| --- | --- | --- |
| Placement, exclude, O4, plain dir, external alias, symlink component | `tests/test_multi_repo_contract.py` `PlacementAndIgnoreTests` | §§ 1–2 |
| Gitdir writes outside parent, O1 removal, submodule gitdir/config | `GitdirAndLifetimeTests` | §§ 3, 6, 13 |
| O3 walkers vs Git, `git clean`, dependency write, read-only digest | `ParentToolsAndDependencyTests` | §§ 2.7, 5 |
| Ignored-directory rewrite, nested files, symlink text, bound (R20-C02) | `IgnoredDigestTests` | § 5 |
| Reuse after setup, interrupted attempt, replaced checkout, lost checkpoint (R20-C03) | `ResumeBeforeDeliveryTests` | §§ 4, 8 |
| Branch collision, reuse evidence | `BranchAndReuseTests` | § 4 |
| Receipt: complete, child dirt, preexisting, outside contract, hash, no head, sidecar commit, scope, drift, read-only, alias collision, shared common dir (R20-C01), tested set | `ReceiptTests` | §§ 2.6, 9–12 |
| Manifest bounds, worst-case header | `ManifestBoundsTests` | §§ 9–10 |
| Partial integration | `PartialIntegrationTests` | § 13 |
| Runner argv, textual scope, line transport, flat `changed_scope` | `claude/claude-side/src/adapters/multi-repo-contract.test.ts` | §§ 2.6, 3, 10 |

Commands, versions and results are in the W20-01 ledgers [01](../execution/W20-01/01.md) and
[02](../execution/W20-01/02.md) (R20-C01…C03). Limits:
the probes use synthetic repositories and a scripted CLI; they prove Git behaviour, receipt rules
and bridge transport, not that a model follows the procedure, and not Claude Code's symlink
handling for `--add-dir`. The receipt and validator are test transcriptions; W20-02 decides
whether a read-only helper ships and links the canonical procedure from both roles.
