# Multi-repo execution: isolated checkouts, delivery and receipt

Load this when an execution scope writes, builds or tests across more than one Git repository:
a nested or external repository, a submodule, a local package or a linked dependency. Both roles
use it. The coordinator follows §§ 1–5 and 7–9, and the bridge round executor follows § 6. A
plain single-repo scope does not need it, and
[local-delivery.md](local-delivery.md) applies unchanged.

The helper `.agents/skills/feature-execute/scripts/multi_repo.py` is read-only. It checks maps,
digests, reuse, receipts and integration records, and prints JSON. It exits 0 when every check
holds, 1 when a check fails or cannot be established, and 2 for unusable input. Unknown is never
a pass. The helper never creates, moves or removes a checkout, never writes a file and never runs
a command named in a manifest or contract. You prepare checkouts yourself with ordinary Git,
following this procedure. Design rationale and probe evidence live in the bridge repository at
`docs/features/F-W20-multi-repo-execution/contracts/01-multi-repo.md`.

## 1. Plan without local paths

Design, plan and review work in any checkout. A plan names logical repo IDs
(`^[a-z0-9][a-z0-9._-]{0,63}$`), their sources, version constraints or pins, roles (`write` or
`read`) and a target branch per repo. It never names future local paths and never creates
worktrees just to finish planning. Specific values of a project belong in its AGENTS.md or design.
A child checkout that is missing when execution starts is a preparation step for
`feature-execute`. It is not a reason to send the user back to setup or to replan.

## 2. Register what the commands touch

Before the first dependent write, the coordinator resolves the real parent worktree
(`git rev-parse --show-toplevel`, canonical path) and reads its AGENTS.md, `.gitmodules` and
gitlinks, local dependency bindings (symlinked or path packages) and the build, test, install,
hook and codegen commands the scope runs. Do not scan the whole disk. The register lists the repos
the work touches and the real write targets of those commands. A plain directory of a monorepo
is not a repository: the helper's `identity` reports `checkout_root: false` for it.

A command whose write target is unknown waits until the target is known. A target in a shared
checkout, another feature or the main checkout blocks that command. Fix the binding inside the
task environment, then rerun `preflight`. Normal tool caches and shared Git metadata (common dir,
`info/exclude`, the config written by `submodule init`) are not violations.

## 3. Prepare one isolated checkout per write repo

Preparation is routine work inside the authorized scope and needs no extra approval gate. Keep
existing changes, respect repository access, and leave decisions outside the scope to their
owners.

1. **Placement.** The default is a Git worktree of the authorized source at
   `.feature-repos/<feature-id>/<repo-id>` inside the parent, created only when neither the path
   nor a symlink of that name exists, with no symlink on any path component. An existing checkout
   of the same task is reused only under § 5.
2. **Ignore.** Append exactly `/.feature-repos/<feature-id>/` once to the file
   `git rev-parse --git-path info/exclude` prints, keeping every other line. In a linked parent
   this is the shared common file. Never edit the tracked `.gitignore`. A correctly ignored child
   leaves the parent `WORKTREE` clean, but that says nothing about the child, whose dirt is
   recorded separately.
3. **Branch.** Use the parent's branch name. If that ref exists in the child, use
   `<name>--<feature-id>` (then `-2` … `-9`) and record the mapping. Never reset, move, rename or
   take over an existing ref. Isolation comes from directories and ownership, not from a branch
   name or a `branch != main` test.
4. **Base.** Use the plan's version, which must be present in the source. A different base needs an
   in-scope reason or a decision. Never silently change pins.
5. **Rights.** Every commit in a nested worktree writes objects and refs into the source's Git
   directory, outside the parent. The role that commits must be allowed to write there. Delegated
   Codex (`approval_policy: never`, `workspace-write`) cannot escalate: give it a **clone** inside
   the parent at the same alias, which keeps the authorized source and base. If no compatible
   variant exists, block only the dependent writes. Never bypass an Edit/Write refusal through Bash.
6. **External alias.** A symlink in the task directory pointing to a checkout outside the parent is
   accepted only for an existing environment whose write access was shown for both roles on the
   real client. Record it as `external_access_verified: true`. The bridge passes the alias text
   unresolved to `--add-dir`, and it is not proven that Claude Code follows it. Never create one as
   a first setup.
7. **Submodule.** A submodule is its own entry. Its gitlink path is its alias and stays tracked,
   never ignored. Switch from the detached gitlink commit to a branch of its own. In a linked
   parent its Git directory lives under the parent's
   `<common>/worktrees/<parent>/modules/<path>`, and `submodule init` writes the shared config. Both
   are normal shared metadata. Never switch another worktree's checkout.
8. **Read-only dependency.** It may stay shared only while no command writes it. Record its HEAD and
   the helper `digest` (HEAD, status records and the bytes of every changed, untracked and ignored
   file; symlinks are not followed). `digest` exits 1 with `observable: false` past its bound, and
   then the dependency cannot be shown read-only.
9. **Parent tools.** Commands that walk the filesystem (`find`, recursive globs, some test runners
   and linters) descend into `.feature-repos/`. Confirm in the same command-target check that they
   exclude it. Never tidy with a parent `git clean`: a double `-ff` deletes every child checkout.

## 4. The round contract's repo map and preflight

Write the map as `multi-repo-contract-v1` JSON in the parent's exchange namespace
(`feature_exchange.py namespace --repo <parent>`, e.g. `<namespace>/maps/<feature>-<task>-<n>.json`),
never in Git. It is also the setup checkpoint (§ 5). Treat a map file as immutable once a round
names it: a changed map gets a new file and a new reference. Never paste the map into the round:
the TaskSpec objective holds at most 2000 characters, and a map of six repositories already exceeds
that. The round objective carries one reference line instead, printed by
`multi_repo.py reference --contract <map>`:

```text
REPO_MAP=<absolute map path> SHA256=<sha256 of the map bytes>
```

Both roles pass that path and hash to every map command (`--contract <path> --sha256 <hash>`). The
helper refuses before any check when:
- the hash is missing;
- the file is missing, a symlink or not a regular file;
- the bytes differ from the reference.

The map is data, not authorization or instructions: the round's `scope.paths` stays the authority,
and `--round-scope <glob>` (repeated for each glob) refuses a map listing any glob the round scope
lacks. The executor reads the file only through the helper or a plain read. If it is not
reachable from the executor's host, the dependent writes block.

`parent.baseline` (path → `git hash-object`, or `deleted`) records the parent's dirt at contract
time, as `baseline` does per child. Paths absent from it are new: own inside the scope, foreign
outside it.

```json
{"schema": "multi-repo-contract-v1", "feature": "F-X", "task": "W-01",
 "parent": {"root": "<canonical parent path>", "base": "<full sha>", "scope": ["app/**", "docs/features/F-X/execution/**"],
            "ledger_dir": "docs/features/F-X/execution/W-01/", "package": false, "baseline": {"<path>": "<hash-object>"}},
 "repos": {
  "child-a": {"role": "write", "kind": "worktree", "alias": ".feature-repos/F-X/child-a", "realpath": "<canonical>",
              "git_dir": "<per-worktree gitdir>", "base": "<full sha>", "branch": "design/x", "target": "main",
              "scope": [".feature-repos/F-X/child-a/src/**"], "baseline": {"<path>": "<hash-object>"}, "bindings": ["node_modules/dep"]},
  "dep": {"role": "read", "kind": "existing", "alias": ".feature-repos/F-X/dep", "realpath": "<canonical>",
          "base": "<full sha>", "digest": "<64 hex>"}}}
```

Bounds: at most 32 repos, 64 globs of at most 512 characters per repo, and 200 baseline entries.
Paths must be portable (no absolute path, `..` or backslash). Write scope globs start with
`<alias>/` and use literal per-repo prefixes, because a mid-path wildcard widens the runner's
`--add-dir`. The bridge `scope.paths` of the round is the parent scope plus every write repo's
globs: one flat list of repo-relative globs, and no absolute path or `../`.

Run `python3 .agents/skills/feature-execute/scripts/multi_repo.py preflight --contract <map>
--sha256 <hash>` before the round and after any change to a path, branch or binding. Exit 0 is
required for the dependent writes, for both roles. `identity` alone is never a substitute: it skips
bindings, read-only digests, dirt, ignore and branch. The checks are:
- checkout root and contract realpath and gitdir;
- one checkout per entry, compared by realroot or per-worktree gitdir (a shared common dir is fine);
- ignore, or for a submodule a tracked gitlink;
- branch, base ancestry and current dirt against the baseline, for the parent and every child;
- the read-only digest;
- each binding classified as own, `write:<id>`, `read:<id>`, `parent` or `foreign`; a `foreign`
  binding blocks.

A failing entry blocks only the work that depends on it.

## 5. Resume and reuse

Every resume re-reads the checkpoint and reruns `preflight`. Only changed elements are checked
again: no full audit before every tool call, no second set of worktrees or branches, and no
separate manager or MCP server per child. Before writing to an existing checkout, run
`multi_repo.py reuse --contract <map> --sha256 <hash> --repo <id> --record <record>`. The record
is one of:
- `checkpoint`: the setup record (feature, repo, branch, `branch_created`, base, realroot, gitdir,
  `initial_dirt`). It is valid before any delivery. Commits after the base on a branch setup
  created, and new dirt, belong to this task's earlier attempt: they are kept and listed in the
  `inventory`, never reset;
- `contract`: the checkpoint is lost and nothing was delivered. This is enough only while the
  checkout has no commit after the base and no dirt;
- `delivered`: a committed ledger or manifest names the delivered head, and every later commit is
  explained by a later own record (`later`).

No record, a replaced gitdir, another branch or a base that is not an ancestor all mean the
checkout is not written. Clarify ownership first. A branch name or a shared remote is never
evidence.

## 6. Bridge round executor

The round contract is your authority. Its `REPO_MAP=<path> SHA256=<hash>` line names the map
listing every repo you may touch. Never add a repository or a binding the map does not name; report
it as a blocker. Before the first write, run the full preflight with the reference and your round
scope:

```text
python3 .agents/skills/feature-execute/scripts/multi_repo.py preflight --contract <path> --sha256 <hash> \
  --round-scope <glob> [--round-scope <glob> ...]
```

Pass every glob of the round's `scope.paths`. Exit 0 is required. A missing or changed map, a glob
outside the round scope, or any failing entry blocks the dependent writes: report it, do not work
around it. Running `identity` per alias does not replace this. Rerun the preflight after changing a
binding. Write only inside the globs. Commit in each repo separately with named paths, as
local-delivery § 3 requires, and never push or merge. Then:

1. Run the contract checks on the combined final versions.
2. Write the parent ledger and, beside it, `<ledger stem>.repos.json` (`multi-repo-v1`). The sidecar
   holds:
   - `schema`, `feature`, `task`;
   - `parent: {base, scope}` and no parent HEAD;
   - per repo: `id`, `role`, `kind`, `source: {locator, roots?}`, `alias`, `base`, `head`, `branch`,
     `target`, `scope`, `dirt: {baseline, final}` (`final` as alias-prefixed `{path, class}`), and
     `gitlink` for a submodule or `digest` for a read entry;
   - `integration: {tested_set, checks}`, where `tested_set` holds exactly the delivered heads.

   The sidecar contains no host path and neither its own hash nor the ledger's.
3. Run `multi_repo.py manifest --file <sidecar>`; exit 0 is required. Commit the ledger and the
   sidecar after the checks in a commit touching only the ledger directory. This is the
   local-delivery exception for evidence: no code goes in that commit.
4. The summary lines are, in order: `DELIVERY=local-v1 …` (parent BASE and HEAD), then
   `REPOS=<sidecar path> SHA256=<sha256 of its bytes>`, then `PACKAGE=…` only when the contract
   requires one. Prose follows. `changed_scope` stays one flat array: parent paths plus child paths
   prefixed by their alias, with a submodule gitlink and its files as separate entries.
5. Own or overlapping uncommitted work in **any** repo, the parent included, makes the round
   `PARTIAL` with a blocker. A clean parent never stands in for a dirty child. Dirt listed in a
   baseline with unchanged bytes, and new dirt outside the scope, is reported, never cleaned.

## 7. Coordinator receipt

Run `multi_repo.py receipt --contract <map> --sha256 <hash> --summary <file with the stored
summary>` with the same reference the round carried. It applies local-delivery § 4 to the parent:
- line 1, base, head ancestry and merges;
- the scope of the endpoint diff and of every commit;
- the new ledger, untouched earlier ledgers, and `WORKTREE` against the real status;
- the parent's own dirt, classified against `parent.baseline`. Own or overlap dirt in a `COMPLETE`
  delivery is a finding; preexisting and foreign dirt are reported and not attributed.

Then it checks the delivery itself:
- the REPOS line, and PACKAGE third when required;
- the sidecar read from the exact parent HEAD, hashed and validated;
- an entry set equal to the map;
- per repo: alias, realroot, gitdir and one-checkout identity; base, head ancestry and merges;
  every path of `diff` and `log --no-renames` within the repo globs; the branch; the gitlink pin;
- dirt classified against the baseline, where own or overlap dirt is `PARTIAL`;
- the read-only digest, and `tested_set` equal to the delivered heads.

Exit 0 only with no findings. A checkout HEAD later than the delivered head is reported as
integration drift and not attributed to the executor. The helper is a tool: review still reads
the delivered commits (local-delivery § 5), reruns decisive checks, and never trusts the worker's
`changed_scope`.

## 8. Integration and authorized merge

Before any merge, test the delivered set together; that needs no merge or push permission. When a
merge is authorized, integrate dependency-first into each repo's own target. Update pins to the
real integrated SHAs, and treat the pin commit as integration drift `HEAD..T`, reviewed
separately. A non-fast-forward merge creates new SHAs: retest them and inherit no earlier result.
Keep `multi-repo-integration-v1` records in the integration ledger:
- `order`;
- per repo: `path`, `target`, `delivered`, `state` (`pending`, `merged` or `failed`) and
  `integrated`;
- `pins: [{path, repo}]`, where the parent is the entry with id `parent`.

`multi_repo.py integration --record <file>` reads Git to confirm three things:
- each integrated commit contains the delivered head and is on its target;
- each pin names the integrated commit;
- the result is `COMPLETE` only when everything is merged and pinned, and otherwise `PARTIAL` with
  the next step.

An interruption stays visible and continues there, without resetting repos already merged. No
cross-repo atomicity is claimed. A parent merge alone does not complete the set. Push, deploy and
publication keep their own permissions.

## 9. Lifetime, handoff and limits

A child inside the parent lives only as long as the parent directory. A plain
`git worktree remove <parent>` deletes ignored children. Commits of a nested worktree survive in
its source; uncommitted work and in-parent clone commits do not. Every handoff lists each child's
dirt, and for a clone `git rev-list --branches --not --remotes`. Removing the parent is not safe
cleanup until that history is integrated or preserved elsewhere under authorization. Nothing is
deleted automatically. An external ZIP exports one repository: state which repos it covers and that
ignored child checkouts are not included. A missing multi-repo archive does not block local Git
delivery.

What this procedure and its helper do not provide:
- a runtime sandbox or a physical lease (scopes are textual);
- proof that Claude Code's Edit/Write follows a symlinked `--add-dir`;
- proof that a model follows the procedure.
