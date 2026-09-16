import { describe, expect, it } from "vitest";
import { createAliases, projectDistribution } from "./project.mjs";

describe("distribution export privacy boundary", () => {
  it("retains unknowns, separates configured facts and drops arbitrary nested fields", () => {
    const projected = projectDistribution({
      format: "claude-codex-bridge.distribution/v1", integration_source: "project-dispatcher",
      package: { name: "bridge-claude", version: "0.2.0", secret: "PRIVATE" },
      runtime: { runtime_id: "0.2.0-abcdef123456", path: "/private/path" },
      executor: { configured_package_version: "0.2.0", observed_package_version: null, argv: "PRIVATE" },
      pin: { declared: "0.2.0-abcdef123456", applied: null, diverged: null },
      notes: ["PRIVATE"],
    }, createAliases());
    expect(projected.pin.diverged).toBeNull();
    expect(projected.executor.observed_package_version).toBeNull();
    expect(projected.executor.configured_package_version).toBe("0.2.0");
    expect(JSON.stringify(projected)).not.toMatch(/PRIVATE|private\/path/);
  });
  it("does not export credentials or arbitrary values through version and location fields", () => {
    const secret = "sk-ant-SECRETSECRETSECRETSECRET1234";
    const out = projectDistribution({ format: "claude-codex-bridge.distribution/v1",
      integration_source: secret, package: { name: secret, version: secret },
      executor: { observed_plugin_dir: { location: secret, sha256: secret, depth: secret } },
      pin: { declared: secret, diverged: "false" },
    }, createAliases());
    expect(JSON.stringify(out)).not.toContain(secret);
    expect(out.integration_source).toBe("unknown");
    expect(out.pin.diverged).toBe("invalid");
    expect(projectDistribution(undefined, createAliases())).toBeNull();
  });
});
