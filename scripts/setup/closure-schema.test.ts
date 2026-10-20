import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { SqliteStateStore } from "@bridge/control-plane";
// @ts-expect-error JS source
import { compatibilityRefusals } from "./workspace.mjs";

it("update/rollback compatibility refuses schema5 target after schema6 without modifying state", () => {
  const root=mkdtempSync(join(tmpdir(),"bridge-closure-rollback-"));
  try {
    mkdirSync(join(root,".bridge"));
    const path=join(root,".bridge","bridge.db");
    const store=new SqliteStateStore({path}); store.close();
    const target={id:"synthetic-old-runtime",manifest:{compatibility:{state_schema_version:5}}};
    expect(compatibilityRefusals(target,root)).toEqual([expect.objectContaining({code:"STATE_SCHEMA_NEWER"})]);
    const read=new SqliteStateStore({path,mode:"readonly"}); expect(read.schemaVersion()).toBe(6); read.close();
  } finally {rmSync(root,{recursive:true,force:true});}
});
