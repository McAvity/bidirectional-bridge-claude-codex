/** F-W19 W19-03: MCP surface of workflow binding (status/bind/switch and the ack on run/resume). */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { AdapterHealth, DeliverableStatus, type AgentAdapter, type TaskSpec } from "@bridge/protocol";
import { ControlPlane, Orchestrator, loadWorkflowStore, type WorkflowStorePort } from "@bridge/control-plane";
import { TOOLS, runTool, type ToolContext } from "./tools.js";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const BUNDLE = join(REPO, "plugins/feature-workflow-claude/bundle");
const spec: TaskSpec = { objective: "deliver", scope: { paths: ["feature/**"] }, dependencies: [], expected_deliverable: "x", verification_criteria: ["ok"] };
let port: WorkflowStorePort;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lib: any;
beforeAll(async () => { port = await loadWorkflowStore(); lib = port.lib; });
const cleanup: (() => void)[] = [];
afterEach(() => { for (const f of cleanup.splice(0).reverse()) f(); });

function setup(binding: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "w19-03-tools-"));
  cleanup.push(() => { lib.makeWritable(dir); rmSync(dir, { recursive: true, force: true }); });
  const env = { ...process.env, CLAUDE_CODEX_BRIDGE_HOME: join(dir, "home") };
  const ws = join(dir, "ws");
  mkdirSync(join(ws, "docs/features/F-1"), { recursive: true });
  const cp = ControlPlane.open({ databasePath: join(dir, "bridge.db"), workspaceRoot: ws });
  cleanup.push(() => cp.close());
  const adapter: AgentAdapter = {
    info: { agent: "claude", implementation: "fixture", version: "1", capabilities: ["resume"], max_concurrency: 1 },
    async health() { return { status: AdapterHealth.READY, checked_at: Date.now() }; },
    async cancel() {},
    async invoke(i, ctx) {
      await ctx.saveExecutionHandle("s");
      return { task_id: i.task_id, agent: "claude", status: DeliverableStatus.COMPLETE, summary: "x", changed_scope: [], artifacts: [], commit_or_diff: null,
        verification_performed: ["t"], verification_results: [{ kind: "test", command: "t", passed: true, exit_code: 0, summary: "ok" }], remaining_risks: [],
        dependencies_unblocked: [], recommended_next_action: "review", at: Date.now() };
    },
  };
  cp.adapters.register(adapter);
  if (binding) cp.enableWorkflowBinding(port, { env });
  const manifest = lib.verifyBundle(BUNDLE);
  lib.storePublish(join(dir, "home/workflows"), BUNDLE);
  lib.writeLock(join(ws, "docs/features/F-1"), lib.newLock(manifest, { origin: { kind: "active-plugin", client: "codex", plugin_version: manifest.version }, at: "2026-11-06T00:00:00Z", featureId: "F-1" }));
  const parent = cp.tasks.create({ spec: { ...spec, scope: { paths: ["m/**"] } }, created_by: "codex" });
  cp.tasks.claim(parent.task_id, "codex");
  const ctx: ToolContext = { cp, orchestrator: new Orchestrator(cp), defaultAgent: "codex", delegationPolicy: "allow" };
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) throw new Error(`no tool ${name}`);
    const res = await runTool(tool, args, ctx);
    return { isError: res.isError ?? false, data: JSON.parse(res.content[0]!.text) };
  };
  return { cp, call, manifest, parent };
}

describe("workflow tools", () => {
  it("exposes the five workflow tools and the ack on run and both resume tools", () => {
    const names = TOOLS.map((t) => t.name);
    for (const name of ["bridge_workflow_status", "bridge_workflow_bind", "bridge_workflow_bind_legacy", "bridge_workflow_switch", "bridge_workflow_project"]) expect(names).toContain(name);
    for (const name of ["bridge_feature_run", "bridge_resume_task", "bridge_resume_delegated_task"]) {
      expect(Object.keys(TOOLS.find((t) => t.name === name)!.inputShape)).toContain("workflow_identity");
    }
    expect(TOOLS.find((t) => t.name === "bridge_workflow_status")!.klass).toBe("read");
  });

  it("reports not-configured honestly and refuses binding operations without a store", async () => {
    const t = setup(false);
    expect((await t.call("bridge_workflow_status")).data).toMatchObject({ runtime: { binding: "not-configured", schema_version: 7 } });
    const bind = await t.call("bridge_workflow_bind", { feature_id: "F-1", lock_path: "docs/features/F-1/workflow.lock.json", expected_identity: t.manifest.identity, idempotency_key: "b" });
    expect(bind.isError).toBe(true);
    expect(bind.data.error.code).toBe("UNIMPLEMENTED");
  });

  it("binds through MCP, refuses a missing or malformed ack and admits the bound identity", async () => {
    const t = setup(true);
    await t.call("bridge_feature_create", { feature_id: "F-1", parent_task_id: t.parent.task_id });
    const bound = await t.call("bridge_workflow_bind", { feature_id: "F-1", lock_path: "docs/features/F-1/workflow.lock.json", expected_identity: t.manifest.identity, idempotency_key: "b" });
    expect(bound.data).toMatchObject({ result: "BOUND", generation: 1 });
    const run = (extra: Record<string, unknown>, key: string) => t.call("bridge_feature_run", { feature_id: "F-1", spec, deadline_ms: 5000, idempotency_key: key, ...extra });
    const missing = await run({}, "r0");
    expect(missing.data.error).toMatchObject({ code: "WORKFLOW_REFUSED", details: { reason: "workflow_ack_required" } });
    expect((await run({ workflow_identity: "not-an-identity" }, "r1")).isError).toBe(true);
    const ok = await run({ workflow_identity: t.manifest.identity }, "r2");
    expect(ok.isError, JSON.stringify(ok.data)).toBe(false);
    expect(ok.data.task.state).toBe("DONE");
    const status = (await t.call("bridge_workflow_status", { feature_id: "F-1" })).data;
    expect(status).toMatchObject({ lock_state: "in-sync", bundle: "verified", latest_task_attempts: [{ attempt: 0, identity: t.manifest.identity, generation: 1 }] });
    const sw = await t.call("bridge_workflow_switch", { feature_id: "F-1", target_identity: t.manifest.identity, expected_generation: 1, idempotency_key: "s" });
    expect(sw.data.error).toMatchObject({ code: "WORKFLOW_REFUSED", details: { reason: "workflow_already_selected" } });
  });
});
