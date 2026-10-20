#!/usr/bin/env node
// Orchestration only: installation, planning, apply and doctor remain the existing CLI's job.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { bridgeHome, SetupError } from "./setup/common.mjs";
import { listRuntimes, installRuntime } from "./setup/runtime.mjs";
import { acquireSource, readRelease } from "./plugin-packages/acquire.mjs";
import { status } from "./bridge-project/locate.mjs";

const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HELP = `Usage: bash scripts/upgrade-local.sh [--yes] [--sudo-observer]
       [--codex-profile NAME] [--] [WORKTREE ...]

Target: scripts/plugin-packages/release.json in this checkout, not arbitrary HEAD.
Without WORKTREE, use the current directory's Git worktree. Without --yes, show
plans only; an absent runtime is reported without installing or fetching anything.
--yes installs the pinned runtime if needed, backs up existing SQLite state,
applies the checked setup/update, verifies its selection and runs doctor.
--sudo-observer explicitly enables the Linux read-only observer; --yes then runs
sudo -v. Never run the installer as root. macOS uses native ps/lsof.
Bridge home and Codex profile environment overrides are preserved.
Close affected Codex/Claude clients before applying; refusals stop the sequence.
This command does not refresh marketplace plugins, commit, push or restart clients.
`;

export function parseUpgradeArgs(argv, cwd = process.cwd()) {
  const options = { apply: false, sudoObserver: false, codexProfile: undefined, workspaces: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") { options.workspaces.push(...argv.slice(i + 1)); break; }
    if (arg === "--yes") options.apply = true;
    else if (arg === "--sudo-observer") options.sudoObserver = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--codex-profile") {
      const value = argv[++i];
      if (!value || !/^[a-zA-Z0-9_-]+$/u.test(value)) throw new Error("--codex-profile requires a plain profile name");
      options.codexProfile = value;
    } else if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
    else options.workspaces.push(arg);
  }
  if (!options.workspaces.length) options.workspaces.push(cwd);
  options.workspaces = [...new Set(options.workspaces.map(p => resolve(cwd, p)))];
  return options;
}

function command(program, args, options) {
  const result = spawnSync(program, args, { ...options, stdio: "inherit" });
  if (result.error || result.status !== 0) throw new Error(`${program} failed (${result.status ?? result.error?.message}); stopped, no automatic retry`);
}

// Private persistent SQLite snapshots, not raw DB/WAL copies. The CLI plan runs first.
const BACKUP = `
from pathlib import Path
import os,sqlite3,sys,tempfile
root=Path(sys.argv[1]); source=root/'.bridge/bridge.db'
if source.is_file():
    base=Path(sys.argv[2])/'backups'
    base.mkdir(mode=0o700,parents=True,exist_ok=True)
    if base.is_symlink(): raise RuntimeError('backup directory must not be a symlink')
    directory=Path(tempfile.mkdtemp(prefix='upgrade-',dir=base))
    target=directory/'bridge.db'
    fd=os.open(target,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600);os.close(fd)
    with sqlite3.connect(source.as_uri()+'?mode=ro',uri=True) as src:
        with sqlite3.connect(target) as dst: src.backup(dst)
    with sqlite3.connect(target.as_uri()+'?mode=ro',uri=True) as check:
        if check.execute('PRAGMA integrity_check').fetchone()[0]!='ok':
            raise RuntimeError('backup integrity check failed')
    print('Pre-migration SQLite backup:',target)
`;

export function upgradeAction(report, hasDeclaration) {
  if (report.declaration.enabled === false) throw new Error("project is disabled; an upgrade does not enable it");
  if (!["valid", "absent"].includes(report.selection.kind)) throw new Error(`invalid local setup: ${report.state}; use bridge-upgrade to diagnose it`);
  if (!hasDeclaration && report.selection.kind === "valid") return "legacy";
  return report.selection.kind === "valid" ? "update" : "setup";
}

export async function upgrade(options, dependencies = {}) {
  const env = { ...process.env, ...dependencies.env };
  const source = dependencies.source ?? SOURCE;
  const run = dependencies.command ?? command;
  const inspect = dependencies.status ?? status;
  const getRuntimes = dependencies.listRuntimes ?? listRuntimes;
  const install = dependencies.installRuntime ?? installRuntime;
  const acquire = dependencies.acquireSource ?? acquireSource;
  const out = dependencies.log ?? console.log;
  const platform = dependencies.platform ?? process.platform;
  const release = readRelease(join(source, "scripts/plugin-packages/release.json"));
  const commit = release.pinned.commit;
  const home = bridgeHome(env);
  if (options.apply && process.getuid?.() === 0) throw new Error("run as your regular user, never sudo the installer");
  if (options.sudoObserver) {
    if (platform !== "linux") throw new Error("--sudo-observer is only for Linux; macOS uses ps/lsof");
    env.CLAUDE_CODEX_BRIDGE_PROCESS_INSPECTION = "sudo";
  }
  const projects = [...new Map(options.workspaces.map(path => {
    const report = inspect(path, env);
    if (!report.workspace.in_git_repository) throw new Error(`not a Git worktree: ${path}`);
    const workspace = report.workspace.root;
    return [workspace, { workspace, action: upgradeAction(report, existsSync(join(workspace, ".bridge-project/bridge.json"))) }];
  })).values()];
  out(`Target: ${release.package_version}, commit ${commit}`);
  let runtime = getRuntimes(home).find(r => !r.error && r.manifest?.source.commit === commit);
  if (!runtime && !options.apply) {
    out("Plan only: the pinned runtime would be installed; no build, fetch or project writes performed.");
    for (const p of projects) out(`${p.action}: ${p.workspace}`);
    return;
  }
  if (options.apply && platform === "linux" && env.CLAUDE_CODEX_BRIDGE_PROCESS_INSPECTION === "sudo") {
    run("sudo", ["-v"], { env });
  }
  if (!runtime) {
    const local = spawnSync("git", ["-C", source, "cat-file", "-e", `${commit}^{commit}`], { env, stdio: "ignore" }).status === 0;
    const acquired = acquire({ home, commit, repository: release.repository, source: local ? source : null, env });
    runtime = install({ source: acquired.repository, ref: commit, home, env }).runtime;
  }
  const cli = join(source, "scripts/bridge.mjs");
  const plugin = join(source, "scripts/plugin-packages/bridge-plugin.mjs");
  for (const project of projects) {
    const { workspace, action } = project;
    const args = action === "legacy"
      ? [cli, "update", "--workspace", workspace, "--runtime", runtime.id, "--home", home]
      : [plugin, action, "--to", runtime.id, "--home", home];
    // Both phases use the existing guard; apply checks again after backup and any race.
    run(process.execPath, args, { cwd: workspace, env });
    if (!options.apply) continue;
    run("python3", ["-c", BACKUP, workspace, home], { env });
    run(process.execPath, [...args, "--yes"], { cwd: workspace, env });
    const after = inspect(workspace, env);
    if (after.selection.runtime_id !== runtime.id || (action !== "legacy" &&
        (after.state !== "ready" || after.runtime.commit !== commit))) {
      throw new Error(`runtime selection verification failed for ${workspace}`);
    }
    const doctor = [cli, "doctor", "--workspace", workspace, "--home", home];
    if (options.codexProfile) doctor.push("--codex-profile", options.codexProfile);
    run(process.execPath, doctor, { cwd: workspace, env });
    out(`Verified ${workspace}: ${runtime.id}`);
  }
  if (options.apply) out("Restart affected clients to load the new runtime and skills. Review project pin changes before committing.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseUpgradeArgs(process.argv.slice(2));
    if (options.help) console.log(HELP);
    else await upgrade(options);
  } catch (error) {
    console.error(error instanceof SetupError ? `${error.code}: ${error.message}` : error.message);
    process.exitCode = 1;
  }
}
