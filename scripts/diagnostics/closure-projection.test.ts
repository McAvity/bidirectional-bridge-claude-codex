import { expect, it } from "vitest";
// @ts-expect-error JS module
import { projectRecord, FEATURE_SPEC, createAliases } from "./project.mjs";

it("exports terminal closure metadata without the private decision", () => {
  const out = projectRecord({feature_id:"F-test", state:"rejected", closure_outcome:"rejected",
    closed_at:1700000000000, coordinator_effect:"shared_preserved",
    closure:{reason:"PRIVATE-SENTINEL",decision_ref:"PRIVATE-SENTINEL",attribution:{native_thread_id:"PRIVATE-SENTINEL"}},
    reason:"PRIVATE-SENTINEL",decision_ref:"PRIVATE-SENTINEL"}, FEATURE_SPEC, createAliases());
  expect(out.state).toBe("rejected"); expect(out.closure_outcome).toBe("rejected");
  expect(out.coordinator_effect).toBe("shared_preserved"); expect(out.closed_at).toBeTruthy();
  expect(JSON.stringify(out)).not.toContain("PRIVATE-SENTINEL");
});
