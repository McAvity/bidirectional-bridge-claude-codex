import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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


describe("safe distribution metadata reads", () => {
  it("refuses FIFO project metadata without blocking doctor", () => {
    const root = mkdtempSync(join(tmpdir(), "distribution-fifo-"));
    try {
      mkdirSync(join(root, ".bridge-project"));
      expect(spawnSync("mkfifo", [join(root, ".bridge-project/bridge.json")]).status).toBe(0);
      const doctor = new URL("../setup/doctor.mjs", import.meta.url).href;
      const script = `import { runDoctor } from ${JSON.stringify(doctor)};
        const report = await runDoctor({ workspace: ${JSON.stringify(root)}, home: ${JSON.stringify(join(root, "home"))},
          safeSubset: true, handshake: false, cliRuntime: { path: "/absent" } });
        if (report.distribution.pin.declared !== null) process.exit(2);`;
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
        encoding: "utf8", timeout: 15000,
        env: { ...process.env, PATH: "/usr/bin:/bin", HOME: root },
      });
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
