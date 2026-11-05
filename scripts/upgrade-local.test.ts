import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
// @ts-expect-error JS CLI
import { parseUpgradeArgs, planNeedsObserver, upgrade } from "./upgrade-local.mjs";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, {recursive:true,force:true})));
const temp = () => { const dir=mkdtempSync(join(tmpdir(),"bridge upgrade "));dirs.push(dir);return dir; };
function fixture() {
  const root=temp(), home=join(root,"bridge home"), workspace=join(root,"project with spaces");
  mkdirSync(join(root,"scripts/plugin-packages"),{recursive:true});
  mkdirSync(join(workspace,".bridge-project"),{recursive:true});
  writeFileSync(join(workspace,".bridge-project/bridge.json"),"{}");
  const commit="b".repeat(40), runtime={id:"new-runtime",manifest:{source:{commit}}};
  writeFileSync(join(root,"scripts/plugin-packages/release.json"),JSON.stringify({format:"claude-codex-bridge.release/v1",package_version:"9.0.0",pinned:{commit},repository:"https://example.invalid/bridge.git"}));
  let applied=false;
  const calls: any[]=[];
  const deps: any={source:root,env:{CLAUDE_CODEX_BRIDGE_HOME:home,CLAUDE_CODEX_BRIDGE_PROCESS_INSPECTION:"native",CODEX_SANDBOX:undefined},log:()=>{},
    platform:"linux",interactive:true,planNeedsObserver:()=>false,
    listRuntimes:()=>[runtime],
    status:()=>({state:"ready",workspace:{in_git_repository:true,root:workspace},declaration:{enabled:true},selection:{kind:"valid",runtime_id:applied?runtime.id:"old"},runtime:{commit}}),
    command:(program:string,args:string[],opts:any)=>{calls.push({program,args,opts});if(args.includes("--yes"))applied=true;},
  };
  return {root,home,workspace,commit,runtime,calls,deps,options:parseUpgradeArgs(["--yes",workspace])};
}

describe("portable upgrade orchestration", () => {
  it("defaults to the caller's directory and preserves spaces and profile arguments", () => {
    expect(parseUpgradeArgs([],"/project with spaces")).toMatchObject({apply:false,workspaces:["/project with spaces"]});
    expect(parseUpgradeArgs(["--codex-profile","laptop","--","-project"],"/tmp")).toMatchObject({codexProfile:"laptop",workspaces:["/tmp/-project"]});
    expect(()=>parseUpgradeArgs(["--codex-profile"])).toThrow();
    expect(()=>parseUpgradeArgs(["--force"])).toThrow();
  });
  it("a missing-runtime plan creates neither a bridge home nor project files", async () => {
    const f=fixture();f.deps.listRuntimes=()=>[];
    const before=readdirSync(f.workspace,{recursive:true});
    await upgrade({...f.options,apply:false},f.deps);
    expect(f.calls).toEqual([]);expect(existsSync(f.home)).toBe(false);
    expect(readdirSync(f.workspace,{recursive:true})).toEqual(before);
  });
  it("an installed-runtime plan cannot authenticate sudo, back up or apply", async () => {
    const f=fixture();await upgrade({...f.options,apply:false,sudoObserver:true}, {...f.deps,platform:"linux"});
    expect(f.calls).toHaveLength(1);expect(f.calls[0].args).not.toContain("--yes");
    expect(f.calls[0].args).toContain(f.runtime.id);
  });
  it("a refused guard stops before backup, apply and later projects", async () => {
    const f=fixture();f.deps.command=()=>{throw new Error("ACTIVE_SESSION");};
    await expect(upgrade(f.options,f.deps)).rejects.toThrow("ACTIVE_SESSION");
    expect(existsSync(f.home)).toBe(false);
  });
  it("applies the exact release pin, verifies it and forwards the selected profile", async () => {
    const f=fixture();await upgrade({...f.options,codexProfile:"laptop"},f.deps);
    expect(f.calls.map(c=>c.program==="python3"?c.args[0]:c.args[1])).toEqual(["update","-c","update","doctor"]);
    expect(f.calls[2].args).toContain("--yes");
    expect(f.calls[3].args.slice(-2)).toEqual(["--codex-profile","laptop"]);
    expect(f.calls[0].opts.cwd).toBe(f.workspace);
    expect(f.calls[0].opts.env.CLAUDE_CODEX_BRIDGE_HOME).toBe(f.home);
  });
  it("a failed receipt stops before doctor", async () => {
    const f=fixture(),inspect=f.deps.status;
    f.deps.status=()=>({...inspect(),selection:{kind:"valid",runtime_id:"wrong"}});
    await expect(upgrade(f.options,f.deps)).rejects.toThrow("verification failed");
    expect(f.calls.some(c=>c.args.includes("doctor"))).toBe(false);
  });
  it("builds the descriptor commit through existing acquisition and installation", async () => {
    const f=fixture();f.deps.listRuntimes=()=>[];
    let acquired:any,installed:any;
    f.deps.acquireSource=(a:any)=>{acquired=a;return {repository:f.root,commit:f.commit};};
    f.deps.installRuntime=(a:any)=>{installed=a;return {runtime:f.runtime};};
    await upgrade(f.options,f.deps);
    expect(acquired.commit).toBe(f.commit);expect(installed.ref).toBe(f.commit);
    expect(installed.home).toBe(f.home);
  });
  it("does not silently enable a disabled project or repair a foreign record", async () => {
    const f=fixture(),original=f.deps.status;
    f.deps.status=()=>({...original(),declaration:{enabled:false}});
    await expect(upgrade(f.options,f.deps)).rejects.toThrow("disabled");
    f.deps.status=()=>({...original(),selection:{kind:"foreign"}});
    await expect(upgrade(f.options,f.deps)).rejects.toThrow("invalid local setup");
    expect(f.calls).toEqual([]);
  });
  it("uses checked setup for inherited worktrees and preserves legacy layouts", async () => {
    const f=fixture(),inspect=f.deps.status;
    f.deps.status=()=>({...inspect(),selection:{kind:"absent"}});
    await upgrade({...f.options,apply:false},f.deps);
    expect(f.calls[0].args[1]).toBe("setup");
    rmSync(join(f.workspace,".bridge-project"),{recursive:true});
    f.calls.length=0;f.deps.status=inspect;
    await upgrade({...f.options,apply:false},f.deps);
    expect(f.calls[0].args[0]).toBe(join(f.root,"scripts/bridge.mjs"));
    expect(f.calls[0].args).toContain("--workspace");
  });
  it("sudo observer is explicit, Linux-only, and authenticates before applying", async () => {
    const f=fixture();
    await expect(upgrade({...f.options,sudoObserver:true},{...f.deps,platform:"darwin"})).rejects.toThrow("only for Linux");
    expect(f.calls).toEqual([]);
    await upgrade({...f.options,sudoObserver:true},{...f.deps,platform:"linux"});
    expect(f.calls[0]).toMatchObject({program:"sudo",args:["-v"]});
    expect(f.calls[1].opts.env.CLAUDE_CODEX_BRIDGE_PROCESS_INSPECTION).toBe("sudo");
  });
  it("automatically authenticates after an unknown native plan, then rechecks before backup/apply", async () => {
    const f=fixture(), run=f.deps.command;
    f.deps.planNeedsObserver=()=>true;
    f.deps.command=(program:string,args:string[],opts:any)=>{
      run(program,args,{...opts,env:{...opts.env}});
      if(program===process.execPath && args[1]==="update" && opts.env.CLAUDE_CODEX_BRIDGE_PROCESS_INSPECTION!=="sudo") throw new Error("plan refused");
    };
    await upgrade(f.options,f.deps);
    expect(f.calls.map(c=>c.program==="sudo"?"sudo":c.program==="python3"?"backup":c.args[1])).toEqual(["update","sudo","update","backup","update","doctor"]);
    expect(f.calls[0].opts.env.CLAUDE_CODEX_BRIDGE_PROCESS_INSPECTION).toBe("native");
    expect(f.calls[1].args).toEqual(["-v"]);
    expect(f.calls[2].opts.env.CLAUDE_CODEX_BRIDGE_PROCESS_INSPECTION).toBe("sudo");
    expect(f.calls.filter(c=>c.args.includes("--yes"))).toHaveLength(1);
  });
  it("keeps refusals after sudo and never retries a mutation", async () => {
    for(const failAt of ["privileged-plan","apply"]) {
      const f=fixture(), run=f.deps.command;f.deps.planNeedsObserver=()=>true;
      f.deps.command=(program:string,args:string[],opts:any)=>{
        run(program,args,opts);
        if(program===process.execPath && args[1]==="update" &&
          (opts.env.CLAUDE_CODEX_BRIDGE_PROCESS_INSPECTION!=="sudo" || failAt==="privileged-plan" || args.includes("--yes"))) throw new Error("guard refused");
      };
      await expect(upgrade(f.options,f.deps)).rejects.toThrow("guard refused");
      expect(f.calls.filter(c=>c.program==="sudo")).toHaveLength(1);
      expect(f.calls.filter(c=>c.args.includes("--yes"))).toHaveLength(failAt==="apply"?1:0);
      expect(f.calls.some(c=>c.args.includes("doctor"))).toBe(false);
    }
  });
  it("cannot escalate a plan, macOS or sandbox refusal", async () => {
    for(const variant of ["plan","mac","sandbox","invalid-mode"]) {
      const f=fixture();f.deps.planNeedsObserver=()=>{throw new Error("unexpected probe");};
      f.deps.command=(program:string)=>{f.calls.push({program});throw new Error("original refusal");};
      if(variant==="mac")f.deps.platform="darwin";
      if(variant==="sandbox")f.deps.env.CODEX_SANDBOX="restricted";
      if(variant==="invalid-mode")f.deps.env.CLAUDE_CODEX_BRIDGE_PROCESS_INSPECTION="invalid";
      await expect(upgrade({...f.options,apply:variant!=="plan"},f.deps)).rejects.toThrow("original refusal");
      expect(f.calls).toHaveLength(1);expect(f.calls[0].program).toBe(process.execPath);
    }
  });
  it("uses noninteractive authorization without a terminal and stops if it fails", async () => {
    const f=fixture();f.deps.interactive=false;f.deps.planNeedsObserver=()=>true;
    f.deps.command=(program:string,args:string[])=>{f.calls.push({program,args});throw new Error(program==="sudo"?"sudo denied":"plan refused");};
    await expect(upgrade(f.options,f.deps)).rejects.toThrow("sudo denied");
    expect(f.calls).toHaveLength(2);expect(f.calls[1]).toEqual({program:"sudo",args:["-n","-v"]});
  });
  it("does not diagnose or authenticate after an interrupted plan", async () => {
    for(const detail of [{signal:"SIGINT"},{exitCode:130},{exitCode:143}]) {
      const f=fixture();f.deps.planNeedsObserver=()=>{throw new Error("unexpected probe");};
      f.deps.command=()=>{throw Object.assign(new Error("interrupted"),detail);};
      await expect(upgrade(f.options,f.deps)).rejects.toThrow("interrupted");
    }
  });
  it("recognizes only structured unknown-use refusals from a failing read-only plan", () => {
    const dir=temp(), script=join(dir,"fake-plan.cjs");
    for(const [report,exit,expected] of [
      [{applied:false,refusals:[{code:"ACTIVE_USE_UNKNOWN"}]},1,true],
      [{applied:false,refusals:[{code:"ACTIVE_SESSION"}]},1,false],
      [{applied:false,refusals:[{code:"ACTIVE_USE_UNKNOWN"},{code:"CONFIG_CONFLICT"}]},1,false],
      [{applied:true,refusals:[{code:"ACTIVE_USE_UNKNOWN"}]},1,false],
      [{applied:false,refusals:[{code:"ACTIVE_USE_UNKNOWN"}]},0,false],
      [{message:"ACTIVE_USE_UNKNOWN"},1,false],
      [null,1,false],
    ] as const) {
      writeFileSync(script,`console.log(${JSON.stringify(JSON.stringify(report))});process.exit(${exit});`);
      expect(planNeedsObserver([script],{})).toBe(expected);
    }
    writeFileSync(script,"console.log('not JSON ACTIVE_USE_UNKNOWN');process.exit(1)");
    expect(planNeedsObserver([script],{})).toBe(false);
    expect(planNeedsObserver([script,"--yes"],{})).toBe(false);
  });
  it("makes an exclusive private SQLite backup that includes committed WAL data", async () => {
    const f=fixture();mkdirSync(join(f.workspace,".bridge"));
    const db=new DatabaseSync(join(f.workspace,".bridge/bridge.db"));
    try {
      db.exec("PRAGMA journal_mode=WAL; CREATE TABLE synthetic(value TEXT); INSERT INTO synthetic VALUES('kept');");
      const fake=f.deps.command;
      f.deps.command=(program:string,args:string[],opts:any)=>{
        if(program==="python3")execFileSync(program,args,{env:opts.env});
        else fake(program,args,opts);
      };
      await upgrade(f.options,f.deps);
      const base=join(f.home,"backups"),directory=join(base,readdirSync(base)[0]!);
      expect(statSync(directory).mode&0o777).toBe(0o700);
      const file=join(directory,"bridge.db");expect(statSync(file).mode&0o777).toBe(0o600);
      const backup=new DatabaseSync(file,{readOnly:true});
      try{expect(backup.prepare("SELECT value FROM synthetic").get()).toMatchObject({value:"kept"});}finally{backup.close();}
      expect(db.prepare("SELECT value FROM synthetic").get()).toMatchObject({value:"kept"});
    }finally{db.close();}
  });
});
