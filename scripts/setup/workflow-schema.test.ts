/** F-W19 W19-03: schema 7 downgrade refusal and doctor's workflow-binding capability check. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { SqliteStateStore, WORKFLOW_BINDING_ADVERTISEMENT } from "@bridge/control-plane";
// @ts-expect-error JS source
import { compatibilityRefusals } from "./workspace.mjs";
// @ts-expect-error JS source
import { missingRequiredFeatureTools } from "./doctor.mjs";

it("refuses a schema-6 runtime for a schema-7 (binding) database without touching it", () => {
  const root = mkdtempSync(join(tmpdir(), "bridge-w19-schema-"));
  try {
    mkdirSync(join(root, ".bridge"));
    const path = join(root, ".bridge", "bridge.db");
    new SqliteStateStore({ path }).close();
    const before = readFileSync(path);
    const old = { id: "0.7.0-6ed9a4537e37", manifest: { compatibility: { state_schema_version: 6 } } };
    expect(compatibilityRefusals(old, root)).toEqual([expect.objectContaining({ code: "STATE_SCHEMA_NEWER" })]);
    expect(compatibilityRefusals({ id: "this", manifest: { compatibility: { state_schema_version: 7 } } }, root)).toEqual([]);
    expect(readFileSync(path).equals(before)).toBe(true);
    // A schema-6 build refuses the file itself as well (schema_unsupported), so a binding is never ignored.
    expect(SqliteStateStore.schemaVersionSupported).toBe(7);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("requires the workflow tools only from a runtime that advertises workflow binding", () => {
  const base = ["bridge_feature_create", "bridge_feature_get", "bridge_feature_run", "bridge_feature_wait_user", "bridge_feature_answer_user", "bridge_feature_accept", "bridge_feature_close"];
  const workflow = ["bridge_workflow_status", "bridge_workflow_bind", "bridge_workflow_bind_legacy", "bridge_workflow_switch", "bridge_workflow_project"];
  const advertised = { compatibility: { state_schema_version: 7, workflow_binding: { ...WORKFLOW_BINDING_ADVERTISEMENT } } };
  expect(missingRequiredFeatureTools(base, advertised)).toEqual(workflow);
  expect(missingRequiredFeatureTools([...base, ...workflow], advertised)).toEqual([]);
  expect(missingRequiredFeatureTools(base, { compatibility: { state_schema_version: 7 } })).toEqual([]);
  expect(WORKFLOW_BINDING_ADVERTISEMENT.capabilities).toContain("workflow.binding/v1");
});
