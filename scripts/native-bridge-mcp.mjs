#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const launcherPath = fileURLToPath(import.meta.url);
export const nativeBridgeRepositoryRoot = resolve(dirname(launcherPath), "..");

const CALLERS = new Set(["codex", "claude"]);
const DELEGATION_POLICIES = new Set(["allow", "deny"]);

export const NATIVE_BRIDGE_HELP = `native-bridge-mcp — project-scoped neutral bridge MCP server

  --caller          codex | claude (required; bound for the process lifetime)
  --delegation      allow | deny (required; enforced server-side)
  --workspace       project root (default: current working directory)
  --db              shared SQLite path (default: <workspace>/.bridge/bridge.db)
  --adopt-legacy-state  bind an existing pre-isolation database to this worktree (one-shot)
  --adopt-reason    required with --adopt-legacy-state: recorded provenance (1..500 chars)
  --help            write this help to stderr and exit
`;

function valueAfter(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseNativeBridgeArgs(argv, cwd = process.cwd()) {
  let caller;
  let delegation;
  let workspaceRaw;
  let databaseRaw;
  let adoptLegacy = false;
  let adoptReason;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    switch (flag) {
      case "--caller":
        caller = valueAfter(argv, index, flag);
        index += 1;
        break;
      case "--delegation":
        delegation = valueAfter(argv, index, flag);
        index += 1;
        break;
      case "--workspace":
        workspaceRaw = valueAfter(argv, index, flag);
        index += 1;
        break;
      case "--db":
        databaseRaw = valueAfter(argv, index, flag);
        index += 1;
        break;
      case "--adopt-legacy-state":
        adoptLegacy = true;
        break;
      case "--adopt-reason":
        adoptReason = valueAfter(argv, index, flag);
        index += 1;
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        throw new Error(`unknown option: ${flag ?? "<empty>"}`);
    }
  }

  if (!help && !CALLERS.has(caller)) {
    throw new Error("--caller must be codex or claude");
  }
  if (!help && !DELEGATION_POLICIES.has(delegation)) {
    throw new Error("--delegation must be allow or deny");
  }
  if (!help && adoptLegacy && (!adoptReason || adoptReason.length > 500)) {
    // Adoption is a deliberate, evidenced operation, never a side effect of starting.
    throw new Error("--adopt-legacy-state requires --adopt-reason with 1..500 characters");
  }
  if (!help && !adoptLegacy && adoptReason) {
    throw new Error("--adopt-reason is only valid with --adopt-legacy-state");
  }

  const workspace = workspaceRaw ? resolve(cwd, workspaceRaw) : resolve(cwd);
  const databasePath = databaseRaw
    ? isAbsolute(databaseRaw)
      ? resolve(databaseRaw)
      : resolve(workspace, databaseRaw)
    : resolve(workspace, ".bridge", "bridge.db");

  return {
    caller,
    delegation,
    workspace,
    databasePath,
    databaseRaw,
    ...(adoptLegacy ? { adoptLegacy: { reason: adoptReason } } : {}),
    help,
  };
}

function redactedClaudeLog(line) {
  return line.replace(/session\s+\S+/iu, "session [redacted]");
}

/**
 * Source identity of the running code for the diagnostics log: the package version always, and
 * the installed runtime id when this process runs from an installed runtime. A development
 * checkout has no manifest, and the id is then reported as unknown (null) rather than guessed.
 */
export function readSourceIdentity(root = nativeBridgeRepositoryRoot) {
  const read = (path) => {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return null;
    }
  };
  const pkg = read(join(root, "package.json"));
  const manifest = read(join(root, "runtime-manifest.json"));
  return {
    packageVersion: typeof pkg?.version === "string" ? pkg.version : "unknown",
    runtimeId: typeof manifest?.runtime_id === "string" ? manifest.runtime_id : null,
  };
}

export async function runNativeBridge(args) {
  if (args.help) {
    process.stderr.write(NATIVE_BRIDGE_HELP);
    return null;
  }
  if (!CALLERS.has(args.caller) || !DELEGATION_POLICIES.has(args.delegation)) {
    throw new Error("native bridge requires validated startup identity and delegation policy");
  }
  if (!statSync(args.workspace).isDirectory()) {
    throw new Error(`workspace is not a directory: ${args.workspace}`);
  }

  const controlPlane = await import(new URL("../shared/control-plane/dist/index.js", import.meta.url).href);
  // Canonical worktree identity. Resolution reads the filesystem and Git only: startup creates
  // no directory, database, marker or lock (contract section 4.2).
  const workspace = controlPlane.resolveWorkspaceIdentity(args.workspace);
  const databasePath = controlPlane.resolveDatabasePath(
    workspace,
    args.databaseRaw ?? undefined,
  );

  const [core, claudeSide, codexSide] = await Promise.all([
    import(new URL("../shared/mcp-server-core/dist/index.js", import.meta.url).href),
    import(new URL("../claude/claude-side/dist/index.js", import.meta.url).href),
    import(new URL("../codex/codex-side/dist/index.js", import.meta.url).href),
  ]);

  const log = (line) => core.stderrLog(`[bridge-native:${args.caller}] ${line}`);
  // The executor package generated from this runtime's own canonical skills. It ships inside the
  // runtime, so a plugin cache refresh cannot take it away from a round already under way.
  const executorPackage = new URL("../plugins/bridge-claude", import.meta.url);
  const executorPackagePath = existsSync(fileURLToPath(new URL("./.claude-plugin/plugin.json", `${executorPackage.href}/`)))
    ? fileURLToPath(executorPackage)
    : undefined;

  const claudeRunner = new claudeSide.ClaudeCodeRunner({
    permissionMode: "acceptEdits",
    ...(executorPackagePath ? { pluginDir: executorPackagePath } : {}),
    // ClaudeCodeRunner owns the protected opus/high profile and conservative bounded
    // default. A validated TaskSpec.max_turns may raise or lower only the turn ceiling.
    // Delegated Claude runs are non-interactive, so permission prompts cannot be answered.
    // Use Claude Code's documented allowlist instead of bypassPermissions. Read/Edit/Write
    // remain project-confined by Claude Code; the task contract and lease bound the scope.
    allowedTools: ["Read", "Edit", "Write", "Bash"],
    log: (line) => log(redactedClaudeLog(line)),
  });
  const claudeAdapter = new claudeSide.ClaudeAdapter({
    runner: claudeRunner,
    agent: "claude",
  });

  // App Server is the already-proven Codex path that exposes per-thread token events.
  // The certified official-codex-cli-mcp adapter remains available in codex-side; native
  // bridge composition selects App Server only so delegated attempts keep benchmark-grade
  // telemetry rather than introducing a second telemetry subsystem.
  const codexClient = new codexSide.CodexAppServerProcessClient({ cwd: args.workspace });
  const codexAdapter = new codexSide.CodexAdapter({
    client: codexClient,
    implementation: "official-codex-app-server",
    approval_policy: "never",
    sandbox: "workspace-write",
  });

  // Automatic local diagnostics logging (wave13 §1). It is created here, with the process, but
  // writes nothing until the identity guard authorizes an operation on this worktree.
  const source = readSourceIdentity();
  const instanceId = `inst_${randomBytes(8).toString("hex")}`;
  const logger = new controlPlane.DiagnosticsLogger({
    instanceId,
    role: args.caller,
    packageVersion: source.packageVersion,
    runtimeId: source.runtimeId,
    config: controlPlane.readDiagnosticsLogConfig(process.env),
    warn: (line) => core.stderrLog(line),
  });

  const adapters = [claudeAdapter, codexAdapter];
  // A worktree inherited from an enabled project starts pristine: the launch gate registered what
  // its first mutating call must write, and nothing has been written yet.
  const { takePendingSelection } = await import(new URL("./bridge-project/pending-selection.mjs", import.meta.url).href);
  const materialiseSelection = takePendingSelection();

  const server = new core.BridgeMcpServer({
    workspaceRoot: workspace.root,
    ...(materialiseSelection ? { beforeFirstMutation: materialiseSelection } : {}),
    workspace,
    databasePath,
    ...(args.adoptLegacy ? { adoptLegacy: args.adoptLegacy } : {}),
    agent: args.caller,
    delegationPolicy: args.delegation,
    adapters,
    serverName: "bridge-native-project",
    instanceId,
    logger,
    onWarning: (message, details) => {
      log(`warning: ${message}`);
      // The control plane's warnings are authored strings (today: the SQLite journal fallback),
      // so the clamped message is safe to keep; its structured details are not copied.
      logger.record({
        op: "process",
        event: "warning",
        outcome: "error",
        phase: "runtime",
        details: {
          message,
          requested: details?.requested ?? null,
          actual: details?.actual ?? null,
        },
      });
    },
  });

  log(
    `caller=${args.caller} delegation=${args.delegation} workspace=${workspace.root} ` +
      `kind=${workspace.kind} db=${databasePath} instance=${server.identity?.instanceId ?? "n/a"}`,
  );
  return core.serve({
    server,
    label: `bridge-native-${args.caller}`,
    adapters,
    log,
  });
}

async function main() {
  const args = parseNativeBridgeArgs(process.argv.slice(2));
  await runNativeBridge(args);
}

function canonicalPath(path) {
  try {
    return realpathSync(resolve(path));
  } catch {
    return resolve(path);
  }
}

const invokedPath = process.argv[1] ? canonicalPath(process.argv[1]) : "";
if (invokedPath === canonicalPath(launcherPath)) {
  main().catch((error) => {
    // A refused workspace is a normal, actionable outcome: print the code and remedy, not a stack.
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : null;
    const details = error && typeof error === "object" && "details" in error ? error.details : undefined;
    const reason = details && typeof details === "object" && "reason" in details ? String(details.reason) : null;
    process.stderr.write(
      code
        ? `[bridge-native] fatal: ${code}${reason ? ` (${reason})` : ""}: ${error.message}\n`
        : `[bridge-native] fatal: ${error instanceof Error ? error.stack : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
