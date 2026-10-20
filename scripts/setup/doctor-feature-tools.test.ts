import { describe, expect, it } from "vitest";
// @ts-expect-error JS source
import { missingRequiredFeatureTools } from "./doctor.mjs";

const base = ["bridge_feature_create", "bridge_feature_get", "bridge_feature_run",
  "bridge_feature_wait_user", "bridge_feature_answer_user", "bridge_feature_accept"];
const manifest = (schema: number) => ({compatibility:{state_schema_version:schema}});

describe("doctor feature capabilities", () => {
  it("accepts six named legacy capabilities on schema5", () => {
    expect(missingRequiredFeatureTools(base, manifest(5))).toEqual([]);
  });
  it("accepts seven schema6 capabilities and future additive tools", () => {
    expect(missingRequiredFeatureTools([...base,"bridge_feature_close"], manifest(6))).toEqual([]);
    expect(missingRequiredFeatureTools([...base,"bridge_feature_close","bridge_feature_extra"], manifest(7))).toEqual([]);
  });
  it("requires close from schema6 even if an unrelated tool keeps the expected count", () => {
    expect(missingRequiredFeatureTools(base, manifest(6))).toEqual(["bridge_feature_close"]);
    expect(missingRequiredFeatureTools([...base,"bridge_feature_extra"], manifest(6))).toEqual(["bridge_feature_close"]);
  });
  it.each(base)("rejects a missing base capability %s despite equal tool count", missing => {
    const replacement=base.filter(name=>name!==missing).concat("bridge_feature_extra");
    expect(missingRequiredFeatureTools(replacement, manifest(5))).toEqual([missing]);
    expect(missingRequiredFeatureTools([...replacement,"bridge_feature_close"], manifest(6))).toEqual([missing]);
  });
  it("does not treat duplicates or an absent tool list as capabilities", () => {
    expect(missingRequiredFeatureTools(Array(7).fill("bridge_feature_close"), manifest(6))).toEqual(base);
    expect(missingRequiredFeatureTools(undefined, manifest(5))).toEqual(base);
  });
});
