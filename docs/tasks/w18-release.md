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
