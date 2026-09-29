import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, chmodSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error dependency-free installer module
import { findActiveUse } from "./processes.mjs";
// @ts-expect-error dependency-free installer module
import { inspectCodexToml } from "./workspace.mjs";

const dirs: string[] = [];
const temp = () => { const p = realpathSync(mkdtempSync(join(tmpdir(), "bridge-process-"))); dirs.push(p); return p; };
afterEach(() => { for (const p of dirs.splice(0)) rmSync(p, { recursive: true, force: true }); });
const uid = process.getuid!();
const ok = (stdout: string) => ({ status: 0, stdout, stderr: "" });
function mac(root: string, options: { comm?: string; cwd?: string; paths?: string[]; args?: string; fail?: string; missing?: boolean; after?: string; stderr?: string; targetFiles?: string; targetIdentity?: string; targetExited?: boolean } = {}) {
  let snapshots = 0;
  const rows = `${uid} 100 /node\n${uid} 200 ${options.comm ?? "/bin/sleep"}\n`;
  const fields = `p100\0cnode\0\nfcwd\0n${root}\0\np200\0csleep\0\n` + (options.missing ? "" : `fcwd\0n${options.cwd ?? root}\0\n`) + (options.paths ?? []).map(p => `f3\0n${p}\0\n`).join("");
  return findActiveUse(root, { platform: "darwin", env: {}, selfPid: 100, execute: (command: string, args: string[]) => {
    if (command === options.fail) return { status: 1, stdout: "", stderr: "Operation not permitted" };
    if (command.endsWith("lsof")) return { ...ok(args.includes("-p") ? options.targetFiles ?? fields : fields), stderr: options.stderr ?? "" };
    if (args.includes("args=")) return ok(options.args ?? "node other.js");
    if (args.includes("-p")) {
      if (options.targetExited) return { status: 1, stdout: "", stderr: "" };
      return ok(options.targetIdentity ?? (options.after ?? rows).split("\n").filter(line => line.includes(` ${args[args.indexOf("-p") + 1]} `)).join("\n"));
    }
    return ok(++snapshots % 2 === 0 ? options.after ?? rows : rows);
  } });
}

describe("portable active-use inspection", () => {
  it("accepts a fresh idle macOS workspace", () => expect(mac(temp())).toMatchObject({ supported: true, entries: [] }));
  it("detects clients and arbitrary open state holders with spaces in paths", () => {
    const root = temp();
    expect(mac(root, { comm: "/Applications/Codex.app/codex", paths: [`${root}/.bridge/state with spaces.db`] })).toMatchObject({ supported: true, entries: [{ pid: 200, kinds: ["client", "state-open"], command: "codex" }] });
  });
  it("detects a bridge with cwd elsewhere and explicit workspace without printing prompts", () => {
    const root = temp();
    const result = mac(root, { comm: "/node", cwd: tmpdir(), args: `node /runtime/native-bridge-mcp.mjs --secret PRIVATE --workspace ${root}` });
    expect(result).toMatchObject({ supported: true, entries: [{ kinds: ["bridge-mcp"], command: "node" }] });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
  it("detects dispatcher and bare launcher arguments", () => {
    const root = temp();
    for (const args of ["node .bridge-project/entry.mjs --caller codex", "node native-bridge-mcp.mjs --workspace ."]) {
      expect(mac(root, { comm: "/node", args })).toMatchObject({ supported: true, entries: [{ kinds: expect.arrayContaining(["bridge-mcp"]) }] });
    }
  });
  it("does not guess flattened argv boundaries", () => expect(mac(temp(), { comm: "/node", cwd: tmpdir(), args: "node /native-bridge-mcp.mjs --workspace /some spaced path" }).supported).toBe(false));
  it("distinguishes unsupported systems and sandbox restrictions", () => {
    expect(findActiveUse(temp(), { platform: "win32", env: {} }).reason).toContain("not supported");
    expect(findActiveUse(temp(), { platform: "darwin", env: { CODEX_SANDBOX: "seatbelt" } }).reason).toContain("sandbox");
    expect(mac(temp(), { fail: "/bin/ps" }).reason).toContain("macOS ps");
    expect(mac(temp(), { fail: "/usr/sbin/lsof" }).supported).toBe(false);
  });
  it("refuses partial inspection, lsof warnings and new processes", () => {
    expect(mac(temp(), { missing: true }).supported).toBe(false);
    expect(mac(temp(), { stderr: "warning: cannot stat" }).supported).toBe(false);
    expect(mac(temp(), { after: `${uid} 100 /node\n${uid} 300 /claude\n` }).supported).toBe(false);
  });
  it("inspects new processes individually and detects a new state holder", () => {
    const root = temp();
    const after = `${uid} 100 /node\n${uid} 300 /bin/sleep\n`;
    const fields = `p300\0csleep\0\nfcwd\0n${root}\0\n`;
    expect(mac(root, { after, targetFiles: fields })).toMatchObject({ supported: true, entries: [] });
    expect(mac(root, { after, targetFiles: fields + `f3\0n${root}/.bridge/db\0\n` })).toMatchObject({ supported: true, entries: [{ pid: 300, kinds: ["state-open"] }] });
    expect(mac(root, { after, targetExited: true })).toMatchObject({ supported: true, entries: [] });
    expect(mac(root, { after, targetFiles: fields, targetIdentity: `${uid} 300 /claude\n` }).supported).toBe(false);
  });
  it("allows a process that exited between snapshots", () => expect(mac(temp(), { missing: true, after: `${uid} 100 /node\n` }).supported).toBe(true));
  it("retains Linux cwd, launcher and state-file detection", () => {
    const root = temp(), proc = temp(), pid = join(proc, "200");
    mkdirSync(join(pid, "fd"), { recursive: true });
    writeFileSync(join(pid, "comm"), "codex\n");
    writeFileSync(join(pid, "cmdline"), `node\0/runtime/native-bridge-mcp.mjs\0--workspace\0${root}\0`);
    symlinkSync(root, join(pid, "cwd"));
    symlinkSync(`${root}/.bridge/db`, join(pid, "fd", "3"));
    expect(findActiveUse(root, { platform: "linux", proc, env: {}, selfPid: 100 })).toMatchObject({ supported: true, entries: [{ kinds: ["bridge-mcp", "client", "state-open"] }] });
    expect(findActiveUse(root, { platform: "linux", proc: join(proc, "absent"), env: {} }).supported).toBe(false);
    if (uid !== 0) {
      chmodSync(join(pid, "cmdline"), 0);
      try { expect(findActiveUse(root, { platform: "linux", proc, env: {} }).supported).toBe(false); }
      finally { chmodSync(join(pid, "cmdline"), 0o600); }
    }
  });
});

describe("Python TOML diagnostic", () => {
  const inspect = (result: object) => inspectCodexToml("", {}, () => ({ stdout: "", stderr: "", ...result }));
  it("separates a missing executable, missing tomllib and execution denial", () => {
    expect(inspect({ error: { code: "ENOENT" } }).detail).toContain("not found on PATH");
    expect(inspect({ status: 3 }).detail).toContain("has no tomllib");
    expect(inspect({ error: { code: "EPERM" } }).detail).toContain("EPERM");
    expect(inspect({ status: 4, stdout: "bad TOML" })).toEqual({ status: "invalid", detail: "bad TOML" });
    expect(inspect({ status: 0, stdout: "null" })).toEqual({ status: "parsed", bridge: null });
  });
});


describe("macOS mount inspection", () => {
  it("selects the longest matching mount, retaining network types for doctor refusal", async () => {
    const { filesystemOf } = await import("./doctor.mjs");
    const execute = () => ok("/dev/disk on / (apfs, local)\nserver:/ on /Volumes/Shared Files (nfs, mounted by test)\n");
    expect(filesystemOf("/some/project", { platform: "darwin", execute })).toEqual({ mountPoint: "/", fstype: "apfs" });
    expect(filesystemOf("/Volumes/Shared Files/project", { platform: "darwin", execute })).toEqual({ mountPoint: "/Volumes/Shared Files", fstype: "nfs" });
    expect(filesystemOf("/Volumes/Work on NAS/project", { platform: "darwin", execute: () => ok("/dev/disk on / (apfs, local)\nserver:/share on /Volumes/Work on NAS (smbfs, mounted by test)\n") })).toBeNull();
    expect(filesystemOf("/project", { platform: "darwin", execute: () => ok("truncated") })).toBeNull();
    expect(filesystemOf("/project", { platform: "darwin", execute: () => ({ ...ok(""), status: 1 }) })).toBeNull();
  });
});
