// Launch gate of the dispatcher profile. Lives in the installed runtime, never in a project.
//
// The committed `.bridge-project/entry.mjs` calls `launch()` here. This module decides whether
// this worktree may serve the bridge at all, and then hands over to the runtime's own launcher
// **in this same process**:
//
//   - no child process, so there is no wrapper to leave behind. The client's SIGTERM, SIGINT or
//     stdin EOF reaches the real server directly and its existing close/detach behaviour is the
//     behaviour, unchanged (review W14-R2-04);
//   - every refusal happens before the server is imported, so a refused start opens no database,
//     takes no lease, claims no manager and writes nothing (review W14-R2-03).
//
// Nothing here duplicates the native identity guard: the workspace is passed to the launcher
// explicitly and absolutely, and the guard inside the runtime remains the authority.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canonical, run } from "../setup/common.mjs";
import { LAUNCHER, loadRuntimeAt, verifyRuntime } from "../setup/runtime.mjs";
import { LOCAL_DIR } from "../setup/common.mjs";
import { PROJECT_FORMAT, applyPlan, classifyNativeState, classifyPending, localPaths, planChange, readRecord, readSelection, resolveIdentity } from "../setup/workspace.mjs";
import { instructionPaths, status } from "./locate.mjs";
import { setPendingSelection } from "./pending-selection.mjs";

/** Resolved from the working directory the host gave us, never from `PWD`. */
export function resolveWorkspaceRoot(cwd) {
  const top = run("git", ["-C", cwd, "rev-parse", "--show-toplevel"]);
  if (top.status !== 0) return null;
  const root = top.stdout.trim();
  return root ? canonical(root) : null;
}

export class LaunchRefusal extends Error {
  constructor(code, message, nextStep) {
    super(message);
    this.code = code;
    this.nextStep = nextStep;
  }
}

const SETUP_STEP = "ask the bridge setup skill to set this worktree up; it never adopts state it did not write";

/**
 * Decide whether this worktree may launch, without launching. Pure: it reads and nothing else.
 *
 * `runtimePath` is the directory this module was loaded from, i.e. the runtime the project's pin
 * selected — the entry point resolved it, and this function checks that the pin, the manifest and
 * this worktree's own record all agree before anything starts.
 */
export async function decide({ cwd, declaration, runtimePath }) {
  const root = resolveWorkspaceRoot(cwd);
  if (!root) {
    throw new LaunchRefusal("NOT_A_WORKTREE", `${cwd} is not inside a git worktree`, "start the client in a git worktree root");
  }
  if (declaration?.format !== PROJECT_FORMAT) {
    throw new LaunchRefusal("DECLARATION_INVALID", "the project declaration is not a recognised bridge declaration", SETUP_STEP);
  }
  if (declaration.enabled === false) {
    throw new LaunchRefusal("PROJECT_DISABLED", "the bridge is disabled for this project", "enable it in .bridge-project/bridge.json");
  }
  const declaredId = declaration.pinned?.runtime_id;
  const declaredCommit = declaration.pinned?.commit ?? null;

  let runtime;
  try {
    runtime = loadRuntimeAt(runtimePath, declaredId);
  } catch (error) {
    throw new LaunchRefusal("RUNTIME_UNUSABLE", `runtime ${declaredId}: ${error.message}`, SETUP_STEP);
  }
  const problems = verifyRuntime(runtime);
  if (problems.length > 0) {
    throw new LaunchRefusal("RUNTIME_INCOMPLETE", `runtime ${declaredId} is incomplete: ${problems.join("; ")}`, SETUP_STEP);
  }
  // The pin names a commit as well as an id; a runtime directory that answers to the id but was
  // built from another commit is a different instruction set and is refused, not used.
  if (declaredCommit && runtime.manifest.source.commit !== declaredCommit) {
    throw new LaunchRefusal(
      "PIN_COMMIT_MISMATCH",
      `the project pins commit ${declaredCommit} but runtime ${declaredId} was built from ${runtime.manifest.source.commit}`,
      SETUP_STEP,
    );
  }

  // Identity is resolved by the runtime's own code, so a copied or misdescribed worktree is
  // refused the same way the setup CLI refuses it.
  let identity;
  try {
    identity = await resolveIdentity(runtimePath, root);
  } catch (error) {
    throw new LaunchRefusal(error.code ?? "WORKSPACE_UNRESOLVED", error.message, error.nextStep ?? SETUP_STEP);
  }

  const record = readRecord(identity.root, identity);
  const selection = readSelection(identity.root);
  if (record.kind === "foreign") {
    throw new LaunchRefusal(
      "SETUP_RECORD_FOREIGN",
      `.bridge-runtime/install.json belongs to ${record.value.workspace.root}; this is a copy, not this worktree's setup`,
      "remove .bridge-runtime/ from this worktree after checking it, then set it up again; a copy is never adopted",
    );
  }
  if (record.kind === "invalid") {
    throw new LaunchRefusal("SETUP_RECORD_INVALID", `.bridge-runtime/install.json cannot be used: ${record.detail}`, "inspect the file; it is never rewritten automatically");
  }
  if (record.kind === "absent") {
    // One rule decides whether this worktree may finish preparing itself:
    //
    //   it may, when its local state is *explained* as this worktree's own and nothing
    //   contradicts that explanation.
    //
    // Explained means one of the two records this worktree writes about itself says so: the
    // selection journal (`classifyPending`) or the runtime's own state marker
    // (`classifyNativeState`). Contradicted means either of those names another worktree or cannot
    // be read, or `.bridge-runtime/current` exists as something other than a symlink.
    //
    // The bare existence of `.bridge-runtime/` is not a contradiction: an interrupted apply creates
    // that directory before it writes anything into it, and discarding valid native evidence just
    // because the directory exists is what left the pre-journal boundary unrecoverable
    // (review W14-R2-07). Unknown files inside it are neither evidence nor contradiction; the plan
    // never removes them.
    //
    // This waives nothing else. A foreign or invalid record, a pin mismatch, a symlinked managed
    // path, the native identity guard and the ordinary conflict rules all still apply, above and
    // inside `planChange`.
    const local = localPaths(identity.root);
    const journal = classifyPending(identity.root, identity, declaredId);
    const native = classifyNativeState(identity.root, identity);
    const explained = journal.kind === "own" || native.kind === "own";
    const contradicted =
      journal.kind === "foreign" ||
      journal.kind === "unexplained" ||
      native.kind === "foreign" ||
      native.kind === "unexplained" ||
      selection.kind === "not-symlink";
    const pristine = !existsSync(local.dir) && native.kind === "absent" && !explained;

    if (contradicted || (!pristine && !explained)) {
      const problem = [journal, native].find((state) => state.kind === "foreign" || state.kind === "unexplained");
      throw new LaunchRefusal(
        "SETUP_STATE_PARTIAL",
        problem
          ? `${identity.root} has partial state that is not this worktree's own: ${problem.detail}`
          : `${identity.root} has ${LOCAL_DIR}/ but no usable selection record and nothing that explains it`,
        problem?.kind === "foreign"
          ? "remove the copied state from this worktree after checking it; it is never adopted"
          : SETUP_STEP,
      );
    }

    return {
      root: identity.root,
      identity,
      runtime,
      pristine,
      resuming: explained,
      launcher: join(runtimePath, runtime.manifest.mcp?.launcher ?? LAUNCHER),
    };
  }
  const applied = record.value.runtime.id;
  if (applied !== declaredId) {
    throw new LaunchRefusal(
      "PIN_DIVERGED",
      `this worktree applied runtime ${applied} but the project declares ${declaredId}`,
      "run the bridge setup skill's update, which moves the declaration and the local selection together",
    );
  }
  if (selection.kind !== "ok" || selection.runtime.id !== declaredId) {
    throw new LaunchRefusal(
      "SELECTION_UNUSABLE",
      `.bridge-runtime/current does not select ${declaredId} (${selection.kind})`,
      SETUP_STEP,
    );
  }

  // The record can be valid while this worktree's own apply was interrupted after writing it —
  // the journal is removed last. Registering the materialiser lets the next authorised mutation
  // finish that apply instead of leaving `pending.json` behind forever (review W14-R2-07,
  // boundary after the record write).
  const unfinished = classifyPending(identity.root, identity, declaredId).kind === "own";
  return {
    root: identity.root,
    identity,
    runtime,
    pristine: false,
    resuming: unfinished,
    launcher: join(runtimePath, runtime.manifest.mcp?.launcher ?? LAUNCHER),
  };
}

/**
 * Write this worktree's own selection, the first time a call would mutate.
 *
 * It is the ordinary wave12 `init` plan: the same ownership hashes, symlink refusal, copied-record
 * refusal, `mcp_servers.bridge` conflict rules, active-use check and resumable journal. This
 * process is excluded from the active-use check by `findActiveUse`'s own `selfPid` rule, and a
 * client sitting in the worktree is not a blocking kind for `init`.
 *
 * A refusal here refuses the mutating call: the worktree is left exactly as it was.
 */
export function materialiseSelection({ home, identity, runtime }) {
  return () => {
    // Recompute under the call: another process may have prepared this worktree meanwhile. A
    // valid record is not enough to stop here — an apply interrupted after writing the record
    // still has its own journal to finish, and `planChange` picks that up as `plan.pending`.
    const settled =
      readRecord(identity.root, identity).kind === "valid" &&
      classifyPending(identity.root, identity, runtime.id).kind !== "own";
    if (settled) return;
    // `insideGuardedMutation`: the native identity guard has already authorised exactly one caller
    // for this worktree, so its own other processes must not veto it through the process scan.
    const plan = planChange({
      action: "init",
      home,
      identity,
      target: runtime,
      profile: "dispatcher",
      insideGuardedMutation: true,
    });
    if (!plan.ok) {
      const first = plan.refusals[0] ?? plan.conflicts[0];
      throw new BridgeSelectionRefused(
        first?.code ?? "SETUP_REFUSED",
        `this worktree could not take its own bridge selection: ${first?.message ?? "refused"}`,
        first?.nextStep ?? SETUP_STEP,
      );
    }
    if (plan.changed) applyPlan(plan);
  };
}

/** Refusal raised inside a mutating call, so the call fails and nothing is written. */
export class BridgeSelectionRefused extends Error {
  constructor(code, message, nextStep) {
    super(`${code}: ${message}${nextStep ? ` (next: ${nextStep})` : ""}`);
    this.code = code;
    this.nextStep = nextStep;
  }
}

function parse(argv) {
  const out = { caller: "codex", delegation: "allow", read: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--caller") out.caller = argv[index + 1];
    else if (argv[index] === "--delegation") out.delegation = argv[index + 1];
    else if (READ_FLAGS.has(argv[index])) out.read = true;
  }
  return out;
}

/** Flags that ask the entry point to report instead of serving. Shared with the entry template. */
export const READ_FLAGS = new Set(["--status", "--instructions"]);

/**
 * Read-only report of this worktree, resolved from the pin alone (W15-C1).
 *
 * The project entry point is committed and inherited through Git, so it is the one thing a
 * worktree always has. A worktree that never ran setup has no `.bridge-runtime/current` and no
 * plugin may be installed at all, yet a manager still has to learn which instruction set this
 * project's pin selects. This function answers exactly that, and nothing else:
 *
 *   - it is pure. It resolves no identity, opens no database, takes no lease, claims no manager
 *     and writes nothing, in any state;
 *   - it derives the instruction paths from the runtime directory this module was loaded from,
 *     which the pin already selected, never from the local selection symlink;
 *   - it is not an installer. It reports what is missing and the next step; it repairs nothing.
 */
export function describe({ cwd = process.cwd(), declaration, runtimePath = defaultRuntimePath(), env = process.env } = {}) {
  const report = status(cwd, env);
  const declaredId = declaration?.pinned?.runtime_id ?? null;
  const declaredCommit = declaration?.pinned?.commit ?? null;
  let runtime = null;
  let problem = null;
  try {
    runtime = loadRuntimeAt(runtimePath, declaredId ?? undefined);
    const problems = verifyRuntime(runtime);
    if (problems.length > 0) problem = { code: "RUNTIME_INCOMPLETE", detail: problems.join("; ") };
    else if (declaredCommit && runtime.manifest.source.commit !== declaredCommit) {
      problem = {
        code: "PIN_COMMIT_MISMATCH",
        detail: `the project pins commit ${declaredCommit} but this runtime was built from ${runtime.manifest.source.commit}`,
      };
    }
  } catch (error) {
    problem = { code: "RUNTIME_UNUSABLE", detail: error.message };
  }
  return {
    format: "claude-codex-bridge.project-entry/v1",
    ok: problem === null,
    // `status` classifies the worktree; `inherited-pristine` is a usable state, not an error.
    state: problem ? problem.code.toLowerCase() : report.state,
    workspace: report.workspace,
    declaration: report.declaration,
    runtime: problem
      ? { state: problem.code, runtime_id: declaredId, commit: null, path: runtimePath, detail: problem.detail }
      : { state: "ok", runtime_id: runtime.id, commit: runtime.manifest.source.commit, path: runtime.path, detail: null },
    selection: report.selection,
    preference: report.preference,
    instructions: problem ? null : instructionPaths(runtime),
    next_step: problem ? SETUP_STEP : nextStep(report.state),
    reads_only: true,
  };
}

/** What a manager should do about a worktree in this state. Never a repair performed for them. */
function nextStep(state) {
  if (state === "ready" || state === "inherited-pristine") return null;
  if (state === "not-enabled") return "this project has no bridge declaration; ask the bridge setup skill to enable it";
  if (state === "project-disabled") return "the bridge is disabled for this project in .bridge-project/bridge.json";
  return SETUP_STEP;
}

/**
 * Hand this process to the runtime's launcher.
 *
 * `process.argv` is rewritten because the launcher parses it; the workspace is absolute and
 * explicit, so nothing is inferred from the environment. The import happens last, after every
 * refusal, and this function never returns while the server runs.
 */
export async function launch({ cwd = process.cwd(), argv = [], declaration, runtimePath = defaultRuntimePath() } = {}) {
  // The read-only mode answers before the launch gate: a refused worktree must still be able to
  // say which instructions its pin selects, and reporting must never reserve or repair anything.
  if (parse(argv).read) {
    const report = describe({ cwd, declaration, runtimePath });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
    return { launched: false, report };
  }
  let decision;
  try {
    decision = await decide({ cwd, declaration, runtimePath });
  } catch (error) {
    if (error instanceof LaunchRefusal) {
      process.stderr.write(`claude-codex-bridge: ${error.code}: ${error.message}\n  next: ${error.nextStep}\n`);
      process.exitCode = 1;
      return { launched: false, refusal: { code: error.code, message: error.message, next_step: error.nextStep } };
    }
    throw error;
  }
  const options = parse(argv);
  if (decision.pristine || decision.resuming) {
    // Registered, not run: the handshake and every read still write nothing.
    setPendingSelection(
      materialiseSelection({ home: runtimeHome(runtimePath), identity: decision.identity, runtime: decision.runtime }),
    );
  }
  process.argv = [
    process.argv[0],
    decision.launcher,
    "--caller",
    options.caller,
    "--delegation",
    options.delegation,
    "--workspace",
    decision.root,
  ];
  process.chdir(decision.root);
  await import(pathToFileURL(decision.launcher).href);
  return { launched: true, workspace: decision.root, runtime_id: decision.runtime.id };
}

/** `<home>` of an installed runtime at `<home>/runtimes/<id>`. */
function runtimeHome(runtimePath) {
  return join(runtimePath, "..", "..");
}

function defaultRuntimePath() {
  // Never `.pathname`: an installed runtime may sit under a path containing spaces. `resolve`
  // drops the trailing separator a directory URL carries, so a reported path compares equal to
  // the runtime path every other reader uses.
  return resolve(fileURLToPath(new URL("../..", import.meta.url)));
}

export { existsSync, readFileSync };
