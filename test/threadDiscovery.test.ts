import { describe, expect, it } from "vitest";
import { mapWithConcurrency, relatedThreads } from "../src/threadDiscovery.js";
import { parseThreadList } from "../src/protocol.js";

describe("bounded discovery", () => {
  it("selects a full descendant tree independent of list order", () => {
    const threads = parseThreadList({ data: [
      {id:"grandchild", forkedFromId:"branch"}, {id:"other", forkedFromId:null},
      {id:"branch", forkedFromId:"root"}, {id:"root", forkedFromId:null},
    ]});
    expect(relatedThreads("root", threads).map(t=>t.id)).toEqual(["grandchild","branch","root"]);
  });
  it("retains the legacy prefix fallback when parent metadata is missing", () => {
    const threads = parseThreadList({data:[{id:"root",forkedFromId:null},{id:"legacy"}]});
    expect(threads[0]?.parentKnown).toBe(true);
    expect(threads[1]?.parentKnown).toBe(false);
    expect(relatedThreads("root",threads)).toBe(threads);
  });
  it("bounds concurrency and preserves input order", async () => {
    let active=0, maximum=0;
    const result = await mapWithConcurrency(Array.from({length:30},(_,i)=>i), 4, async i=> {
      maximum=Math.max(maximum,++active);
      await new Promise(resolve=>setTimeout(resolve,i%3)); active--; return i*2;
    });
    expect(maximum).toBe(4); expect(result).toEqual(Array.from({length:30},(_,i)=>i*2));
  });
  it("drains active work and stops scheduling after a failure", async () => {
    let drained=false; const calls:number[]=[];
    await expect(mapWithConcurrency([0,1,2,3],2,async i=>{
      calls.push(i);
      if(i===0) throw new Error("failed");
      await new Promise(resolve=>setTimeout(resolve,5)); drained=true; return i;
    })).rejects.toThrow("failed");
    expect(drained).toBe(true); expect(calls).toEqual([0,1]);
  });
  it("does not schedule remaining requests after cancellation", async()=>{
    const abort=new AbortController(); const calls:number[]=[];
    await expect(mapWithConcurrency([0,1,2],1,async i=>{
      calls.push(i); abort.abort(); return i;
    },abort.signal)).rejects.toThrow();
    expect(calls).toEqual([0]);
  });
});
