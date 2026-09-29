// CI-only, content-free diagnosis of Linux process visibility. Never prints argv,
// environments, cwd targets or file-descriptor targets; not part of the installer.
import { readdirSync, statSync, readFileSync, readlinkSync } from "node:fs";
import { findActiveUse } from "./processes.mjs";
const uid = process.getuid();
const failures = [];
for (const pid of readdirSync("/proc").filter((name) => /^\d+$/.test(name))) {
  if (Number(pid) === process.pid) continue;
  const base = `/proc/${pid}`;
  let owner;
  try { owner = statSync(base).uid; } catch { continue; }
  if (owner !== uid) continue;
  const check = (operation, fn) => {
    try { return fn(); } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ESRCH") {
        failures.push({ pid: Number(pid), uid: owner, operation, errno: error.code });
      }
      return null;
    }
  };
  const cmdline = check("cmdline", () => readFileSync(`${base}/cmdline`));
  if (!cmdline?.length) continue;
  check("cwd", () => readlinkSync(`${base}/cwd`));
  const descriptors = check("fd-list", () => readdirSync(`${base}/fd`));
  for (const fd of descriptors ?? []) check("fd-link", () => readlinkSync(`${base}/fd/${fd}`));
}
const result = findActiveUse(process.cwd());
console.log(JSON.stringify({ uid, failures, supported: result.supported, unreadable: result.unreadable ?? null }));
if (process.argv.includes("--require-readable") && !result.supported) process.exitCode = 1;
