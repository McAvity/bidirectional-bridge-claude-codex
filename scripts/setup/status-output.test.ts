import { describe, expect, it } from "vitest";
// @ts-expect-error JS CLI
import { statusLabel } from "./common.mjs";
// @ts-expect-error JS CLI
import { formatDoctor } from "./doctor.mjs";

const terminal = { stream: { isTTY: true }, env: {} };
describe("terminal status output", () => {
  it("colors ok, warning and error labels", () => {
    expect(statusLabel("OK", "ok", terminal)).toBe("\x1b[32mOK\x1b[0m");
    expect(statusLabel("WARN", "warn", terminal)).toBe("\x1b[33mWARN\x1b[0m");
    expect(statusLabel("ERROR", "error", terminal)).toBe("\x1b[31mERROR\x1b[0m");
  });
  it("keeps redirected, NO_COLOR and dumb-terminal output plain", () => {
    for (const options of [
      { stream: {}, env: {} },
      { stream: { isTTY: true }, env: { NO_COLOR: "" } },
      { stream: { isTTY: true }, env: { TERM: "dumb" } },
    ]) expect(statusLabel("WARN", "warn", options)).toBe("WARN");
  });
  it("preserves doctor facts, alignment and machine data regardless of coloring", () => {
    const report = { workspace: "/synthetic", status: "problems", checks: [
      { id: "runtime", status: "ok", code: "OK", summary: "selected" },
      { id: "codex", status: "warn", code: "UNVERIFIED", summary: "version" },
      { id: "project", status: "error", code: "UNTRUSTED", summary: "trust required", next_step: "select profile" },
      { id: "active_use", status: "unknown", code: "UNKNOWN", summary: "unavailable" },
    ] };
    const before = JSON.stringify(report);
    const colored = formatDoctor(report, terminal);
    const plain = formatDoctor(report, { stream: {}, env: {} });
    expect(colored).toContain("\x1b[31mproblems\x1b[0m");
    expect(colored).toContain("\x1b[31merror  \x1b[0m");
    expect(colored).toContain("\x1b[33munknown\x1b[0m");
    expect(colored.replace(/\x1b\[[0-9;]*m/g, "")).toBe(plain);
    expect(plain).not.toContain("\x1b");
    expect(JSON.stringify(report)).toBe(before);
  });
});
