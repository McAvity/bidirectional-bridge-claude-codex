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
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canonical, run } from "../setup/common.mjs";
import { LAUNCHER, loadRuntimeAt, verifyRuntime } from "../setup/runtime.mjs";
import { LOCAL_DIR } from "../setup/common.mjs";
import { PROJECT_FORMAT, applyPlan, localPaths, planChange, readRecord, readSelection, resolveIdentity } from "../setup/workspace.mjs";
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

  // A worktree inherited from an enabled project is *pristine*: the committed declaration and
  // entry point are there, and none of its own local state is, because local state is never
  // inherited. Such a worktree may serve reads immediately; its selection is materialised by the
  // first call that actually mutates (see `materialiseSelection`). Any other absence — a selection
  // without a record, or a state directory without either — is partial state and is refused.
  const local = localPaths(identity.root);
  const pristine =
    !existsSync(local.dir) && !existsSync(join(identity.root, ".bridge"));

  const record = readRecord(identity.root, identity);
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
    if (!pristine) {
      throw new LaunchRefusal(
        "SETUP_STATE_PARTIAL",
        `${identity.root} has ${LOCAL_DIR}/ or .bridge/ but no usable selection record`,
        SETUP_STEP,
      );
    }
    return {
      root: identity.root,
      identity,
      runtime,
      pristine: true,
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
  const selection = readSelection(identity.root);
  if (selection.kind !== "ok" || selection.runtime.id !== declaredId) {
    throw new LaunchRefusal(
      "SELECTION_UNUSABLE",
      `.bridge-runtime/current does not select ${declaredId} (${selection.kind})`,
      SETUP_STEP,
    );
  }

  return {
    root: identity.root,
    identity,
    runtime,
    pristine: false,
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
    // Recompute under the call: another process may have prepared this worktree meanwhile.
    if (readRecord(identity.root, identity).kind === "valid") return;
    const plan = planChange({ action: "init", home, identity, target: runtime, profile: "dispatcher" });
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
  const out = { caller: "codex", delegation: "allow" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--caller") out.caller = argv[index + 1];
    else if (argv[index] === "--delegation") out.delegation = argv[index + 1];
  }
  return out;
}

/**
 * Hand this process to the runtime's launcher.
 *
 * `process.argv` is rewritten because the launcher parses it; the workspace is absolute and
 * explicit, so nothing is inferred from the environment. The import happens last, after every
 * refusal, and this function never returns while the server runs.
 */
export async function launch({ cwd = process.cwd(), argv = [], declaration, runtimePath = defaultRuntimePath() } = {}) {
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
  if (decision.pristine) {
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
  // Never `.pathname`: an installed runtime may sit under a path containing spaces.
  return fileURLToPath(new URL("../..", import.meta.url));
}

export { existsSync, readFileSync };
