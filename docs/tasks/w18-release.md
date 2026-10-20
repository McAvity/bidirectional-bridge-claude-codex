# F-W18 release 0.5.0

Status: preparing, 2026-10-20. User authorized merge → version bump → push → CI →
release → project upgrades. F-W18 accepted in decision02, delivery ec856a7;
final product0bdf45c. Feature branch fast-forwarded to feature-workflow.

Version0.5.0 covers feature closure/schema6 and previously integrated Linux process
inspection correction. Package registry publication is not involved; experimental
GitHub prerelease and the existing marketplaces are the distribution channel.
Runtime source and release metadata use separate commits; published tags never move.

Validation and CI results, release URL, plugin refresh and per-project upgrade status
will be appended as they occur. Active clients must not be stopped or their supervising
runtime rebuilt. Prepared upgrades are not reported as applied.

## First CI — correction required

Push128790b started CI39405216813. Build, package/docs checks and the real privileged
process observer passed. Isolated-user JS exposed four doctor failures: the new close
operation makes seven feature tools, but doctor still required exactly six.
No release/tag/plugin refresh or project upgrade was performed. This was masked locally
by earlier host process-inspection refusals, not an accepted baseline defect.

Correction in progress: validate required named capabilities, requiring close for
schema6 while retaining schema5 checks. Add direct regressions and regenerate packages;
then repin runtime source, rerun CI and only publish on PASS. The initially installed
0.5.0-e95153d79522 preview remains immutable but will not be the released upgrade target.

## Doctor correction review — PASS

Executor12c4938 replaces an exact count with six required feature-tool names plus
close for schema>=6; schema5 remains supported. Coordinator independently inspected
the diff and ran42/42 tests (doctor capabilities, closure and schema compatibility).
Packages, links and diff-check PASS. This is the one release integration correction;
no product requirement changed. Released runtime source is now12c4938282b2222d65e2636ecf24ec3e921e4a99,
not the earlier immutable preview. Another full CI must pass before publication.

## Published — 2026-10-20

Experimental prerelease [v0.5.0](https://github.com/McAvity/bidirectional-bridge-claude-codex/releases/tag/v0.5.0)
at5ce0b54a47399b9cf42b65d1de83c46c224145bf. Runtime source12c4938282b2222d65e2636ecf24ec3e921e4a99.
[CI39406678418](https://github.com/McAvity/bidirectional-bridge-claude-codex/actions/runs/39406678418)
PASS: JS657PASS/1skip, Python113 tests/5skips, pilot131 tests/2skips;
real privileged process observer17/17. All required build/package/docs steps pass.
Local masked doctor regression corrected and independently checked before this run.
Published tag is immutable; no npm publication or real-model smoke.

Codex bridge-codex and feature-workflow plugins refreshed to0.5.0 via existing
marketplace CLI; Claude's existing user-scope feature-workflow refreshed to0.5.0.
No extra Claude bridge plugin installed. New immutable runtime0.5.0-12c4938282b2
installed alongside older versions. Old preview0.5.0-e95153d79522 is not the release target.

Project upgrade plans prepared for this checkout, personal-assistant2 and dnd5.
All refuse ACTIVE_USE_UNKNOWN on restricted host process metadata; no pins or local
selections changed. Noninteractive sudo requires operator terminal authorization.
A private stable copy of the actual updated marketplace installer and checked apply/
status/doctor script are outside Git. Script performs sudo-v for the fixed read-only
observer while keeping the installer unprivileged; respects active-client refusals,
preserves unrelated Git changes and makes consistent private SQLite backups before
client migration. Existing clients must exit normally, then apply and exact resume.

Historical bridge worktrees are not bulk-updated. External project changes are not
committed because their own workflow applies. This checkout's portable pin must be
committed after successful apply so new branches inherit0.5.0; current pin remains0.4.3
with the pre-existing local selection0.4.0 until that checked update completes.
No real project feature was accepted/rejected/cancelled by the release procedure.

Next checkpoint: verify applied per-project status/doctor, resume existing clients,
then commit this project's portable pin and check CI if a new push is made.
