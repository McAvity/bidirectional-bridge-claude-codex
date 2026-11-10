// Read-only polling of the existing installer's plan. Apply remains a separate,
// freshly guarded step; no saved observation or plan is accepted as write authority.
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { performance } from "node:perf_hooks";

const RETRYABLE = new Set(["ACTIVE_SESSION", "ACTIVE_USE_UNKNOWN", "CLIENT_WORKSPACE_UNKNOWN"]);

export function readPlan(args, options) {
  if (args.includes("--yes")) throw new Error("wait only accepts a read-only plan");
  const result = spawnSync(process.execPath, [...args, "--json"], {
    ...options, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8",
    timeout: options.timeoutMs ?? 30_000, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.signal || ![0, 1].includes(result.status)) {
    throw Object.assign(new Error(`Plan observation failed: ${result.error?.message ?? result.signal ?? `exit ${result.status}`}; ${result.stderr?.trim() ?? ""}`),
      { signal: result.signal, exitCode: result.status });
  }
  let plan;
  try { plan = JSON.parse(result.stdout); } catch {
    throw new Error(`Plan did not return JSON; ${result.stderr.trim()}`);
  }
  if (!plan || typeof plan.ok !== "boolean" || plan.applied !== false ||
      !Array.isArray(plan.conflicts) || !Array.isArray(plan.refusals) ||
      (result.status === 0) !== plan.ok ||
      plan.ok && (plan.conflicts.length || plan.refusals.length)) {
    throw new Error(`Invalid plan observation${plan?.code ? `: ${plan.code}: ${plan.message}` : ""}`);
  }
  return plan;
}

export async function waitForPlan(args, { cwd, env, seconds, log = console.log,
  observe = readPlan, now = () => performance.now(), pause = sleep, intervalMs = 5000 } = {}) {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) throw new Error("--wait requires an integer from 1 to 3600 seconds");
  if (args.includes("--yes")) throw new Error("wait only accepts a read-only plan");
  const start = now(), deadline = start + seconds * 1000;
  let waited = false, lastReason = "no completed observation";
  while (true) {
    let plan;
    try {
      plan = observe(args, { cwd, env, timeoutMs: Math.max(1, Math.floor(Math.min(30000, deadline - now()))) });
    } catch (error) {
      if (!error.signal && ![130, 143].includes(error.exitCode) && now() >= deadline) {
        throw new Error(`WAIT_TIMEOUT after ${seconds}s for ${cwd}. Last observation: ${lastReason}. No project apply started.`);
      }
      throw error;
    }
    const reasons = [...plan.conflicts, ...plan.refusals]
      .map(r => `${r?.code ?? "UNKNOWN"}: ${r?.message ?? "no detail"}`).join("; ");
    // A slow final observation must not turn an expired wait into permission to apply.
    if (now() > deadline) throw new Error(`WAIT_TIMEOUT after ${seconds}s for ${cwd}. ${reasons || "Observation exceeded the deadline"}. No project apply started.`);
    if (plan.ok) {
      if (waited) log(`READY: ${cwd}; the installer will check the plan again before apply.`);
      return;
    }
    if (plan.conflicts.length || !plan.refusals.length || plan.refusals.some(r => !RETRYABLE.has(r?.code))) {
      throw new Error(`Plan refused; not waiting: ${reasons}. No project apply started.`);
    }
    lastReason = reasons;
    log(`WAIT ${Math.floor((now() - start) / 1000)}/${seconds}s | ${cwd} | ${reasons}`);
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error(`WAIT_TIMEOUT after ${seconds}s for ${cwd}. ${reasons}. No project apply started.`);
    waited = true;
    await pause(Math.min(intervalMs, remaining));
  }
}
