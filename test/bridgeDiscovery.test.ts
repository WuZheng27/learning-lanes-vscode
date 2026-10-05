import { beforeEach, describe, expect, it, vi } from "vitest";
const rpc=vi.hoisted(()=>vi.fn());
vi.mock("vscode",()=>({}));
vi.mock("../src/appServerClient.js",()=>({AppServerClient:class {
  start=vi.fn(async()=>{}); request=rpc; dispose=vi.fn();
}}));
import { CodexBridge } from "../src/codexBridge.js";
function bridge() {
  const bridge=new CodexBridge("test");
  vi.spyOn(bridge,"checkCompatibility").mockResolvedValue({extensionVersion:"test",appServerVersion:"test",executable:"mock",sidebarViewId:"mock"});
  return bridge;
}
beforeEach(()=>{rpc.mockReset();});
describe("metadata-first bridge",()=>{
  it("does not hydrate authoritative root metadata and streams each page",async()=>{
    rpc.mockImplementation(async(method,params)=>{
      expect(method).toBe("thread/list");
      return params.cursor ? {data:[{id:"second",forkedFromId:null}]} : {data:[{id:"first",forkedFromId:null},{id:"branch",forkedFromId:"first"}],nextCursor:"next"};
    });
    const client=bridge(); const update=vi.fn();
    expect((await client.listAllRootThreads(update)).map(t=>t.id)).toEqual(["first","second"]);
    expect(update.mock.calls.map(c=>c[0].map((t:{id:string})=>t.id))).toEqual([["first"],["first","second"]]);
    expect(client.cachedRootThreads).toHaveLength(2); expect(rpc).toHaveBeenCalledTimes(2);
  });
  it("hydrates unknown ancestry without turns, caches it, and excludes unrelated roots",async()=>{
    rpc.mockImplementation(async(method,params)=>method==="thread/list" ? {data:[{id:"root"},{id:"branch"},{id:"other"}]} : {thread:{id:params.threadId,forkedFromId:params.threadId==="branch"?"root":null}});
    const client=bridge();
    expect((await client.listRelatedThreads("root","/workspace")).map(t=>t.id)).toEqual(["root","branch"]);
    await client.listRelatedThreads("root","/workspace");
    const reads=rpc.mock.calls.filter(c=>c[0]==="thread/read");
    expect(reads).toHaveLength(3); expect(reads.every(c=>c[1].includeTurns===false)).toBe(true);
  });
  it("keeps legacy candidates if a summary fails instead of dropping branches",async()=>{
    rpc.mockImplementation(async(method)=>{if(method==="thread/list")return {data:[{id:"root",forkedFromId:null},{id:"unknown"}]};throw new Error("old backend");});
    expect(await bridge().listRelatedThreads("root","/workspace")).toHaveLength(2);
  });
  it("stops pagination when a root picker is closed",async()=>{
    rpc.mockResolvedValue({data:[{id:"root",forkedFromId:null}],nextCursor:"next"});
    const abort=new AbortController();
    await expect(bridge().listAllRootThreads(()=>abort.abort(),abort.signal)).rejects.toThrow();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
