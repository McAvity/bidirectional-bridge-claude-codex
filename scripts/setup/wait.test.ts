import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error dependency-free installer
import { readPlan, waitForPlan } from "./wait.mjs";

const ready = { ok: true, applied: false, conflicts: [], refusals: [] };
const blocked = (code = "ACTIVE_SESSION") => ({...ready, ok:false, refusals:[{code,message:"pid 123 (client: codex)"}]});
function fixture(reports:any[]) {
  let time=0, calls=0;
  const logs:string[]=[], sleeps:number[]=[];
  const options={cwd:"/project with spaces",env:{},seconds:10, intervalMs:1000,
    observe:()=>{calls++;return reports.shift() ?? blocked();},now:()=>time,
    pause:async(ms:number)=>{sleeps.push(ms);time+=ms;},log:(s:string)=>logs.push(s)};
  return {options,logs,sleeps,calls:()=>calls,advance:(n:number)=>{time+=n;}};
}
describe("bounded read-only upgrade wait",()=>{
  it("rechecks transient blockers until ready and prints their actual causes",async()=>{
    const f=fixture([blocked(),blocked("CLIENT_WORKSPACE_UNKNOWN"),blocked("ACTIVE_USE_UNKNOWN"),ready]);
    await waitForPlan(["installer","update"],f.options);
    expect(f.calls()).toBe(4);expect(f.sleeps).toEqual([1000,1000,1000]);
    expect(f.logs.join("\n")).toContain("CLIENT_WORKSPACE_UNKNOWN");
    expect(f.logs.join("\n")).toContain("pid 123");
    expect(f.logs.at(-1)).toContain("READY");
  });
  it("returns immediately for a valid plan without sleeping",async()=>{
    const f=fixture([ready]);await waitForPlan(["installer"],f.options);
    expect(f.calls()).toBe(1);expect(f.sleeps).toEqual([]);
  });
  it("times out without apply and reports the remaining cause",async()=>{
    const f=fixture([]);
    await expect(waitForPlan(["installer"],f.options)).rejects.toThrow(/WAIT_TIMEOUT.*ACTIVE_SESSION/);
    expect(f.sleeps.reduce((a,b)=>a+b,0)).toBe(10000);
  });
  it("never accepts an observation returned after the deadline",async()=>{
    const f=fixture([]);f.options.observe=()=>{f.advance(10001);return ready;};
    await expect(waitForPlan(["installer"],f.options)).rejects.toThrow("WAIT_TIMEOUT");
  });
  it("reports timeout and the last cause when the final subprocess exceeds its budget",async()=>{
    const f=fixture([]);let calls=0;
    f.options.observe=()=>{if(++calls===1)return blocked("CLIENT_WORKSPACE_UNKNOWN");f.advance(10000);throw new Error("ETIMEDOUT");};
    await expect(waitForPlan(["installer"],f.options)).rejects.toThrow(/WAIT_TIMEOUT.*CLIENT_WORKSPACE_UNKNOWN/);
  });
  it("stops immediately on conflicts or mixed nontransient refusals",async()=>{
    for(const plan of [{...blocked(),conflicts:[{code:"FILE_MODIFIED",message:"edited"}]},blocked("RUNTIME_INCOMPLETE"),
      {...blocked(),refusals:[...blocked().refusals,{code:"SETUP_RECORD_FOREIGN"}]},{...blocked(),refusals:[]}]) {
      const f=fixture([plan]);await expect(waitForPlan(["installer"],f.options)).rejects.toThrow("not waiting");
      expect(f.calls()).toBe(1);expect(f.sleeps).toEqual([]);
    }
  });
  it("propagates interrupts without retrying",async()=>{
    const f=fixture([]);f.options.observe=()=>{throw Object.assign(new Error("interrupted"),{signal:"SIGINT"});};
    await expect(waitForPlan(["installer"],f.options)).rejects.toMatchObject({signal:"SIGINT"});
    expect(f.sleeps).toEqual([]);
  });
  it("rejects apply arguments and invalid wait bounds before reading",async()=>{
    for(const seconds of [0,-1,1.5,3601,NaN]) {
      const f=fixture([]);await expect(waitForPlan(["installer"],{...f.options,seconds})).rejects.toThrow("--wait");expect(f.calls()).toBe(0);
    }
    const f=fixture([]);await expect(waitForPlan(["installer","--yes"],f.options)).rejects.toThrow("read-only");
    expect(f.calls()).toBe(0);
  });
  it("runs a real plan with the monotonic clock's fractional remaining time",async()=>{
    const root=mkdtempSync(join(tmpdir(),"bridge clock ")),script=join(root,"plan.cjs");
    try {
      writeFileSync(script,`console.log(${JSON.stringify(JSON.stringify(ready))});`);
      await waitForPlan([script],{cwd:root,env:process.env,seconds:2,log:()=>{}});
    } finally {rmSync(root,{recursive:true,force:true});}
  });
  it("requires valid structured plan/exit pairs from the actual subprocess",()=>{
    const root=mkdtempSync(join(tmpdir(),"bridge wait ")),script=join(root,"plan.cjs");
    try {
      for(const [plan,exit,valid] of [[ready,0,true],[blocked(),1,true],[ready,1,false],
        [blocked(),0,false],[{...ready,applied:true},0,false],[{...ready,refusals:blocked().refusals},0,false],
        [{code:"RUNTIME_NOT_INSTALLED",message:"missing"},1,false],[null,1,false]] as const) {
        writeFileSync(script,`console.log(${JSON.stringify(JSON.stringify(plan))});process.exit(${exit});`);
        if(valid) expect(readPlan([script],{})).toEqual(plan);
        else expect(()=>readPlan([script],{})).toThrow();
      }
      writeFileSync(script,"console.log('not json');process.exit(1)");
      expect(()=>readPlan([script],{})).toThrow("JSON");
      expect(()=>readPlan([script,"--yes"],{})).toThrow("read-only");
    } finally {rmSync(root,{recursive:true,force:true});}
  });
});
