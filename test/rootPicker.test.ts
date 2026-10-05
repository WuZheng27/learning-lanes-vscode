import { beforeEach, describe, expect, it, vi } from "vitest";
const ui=vi.hoisted(()=>({picker:null as any}));
vi.mock("vscode",()=>({window:{createQuickPick:()=>ui.picker}}));
import { pickRootThread } from "../src/rootPicker.js";
import { parseThreadList } from "../src/protocol.js";
const roots=parseThreadList({data:[{id:"root",forkedFromId:null,name:"Root"}]});
let accept:()=>void, hide:()=>void;
beforeEach(()=>{
  ui.picker={items:[],activeItems:[],selectedItems:[],show:vi.fn(),dispose:vi.fn(),onDidAccept:(fn:()=>void)=>{accept=fn;return {dispose:vi.fn()};},onDidHide:(fn:()=>void)=>{hide=fn;return {dispose:vi.fn()};}};
});
describe("progressive root picker",()=>{
  it("shows cached roots before refresh finishes and allows immediate selection",async()=>{
    let signal:AbortSignal|undefined;
    const picked=pickRootThread(roots,async(_update,s)=>{signal=s;return new Promise(()=>{});},null,"/workspace",new Set());
    expect(ui.picker.show).toHaveBeenCalled(); expect(ui.picker.items).toHaveLength(1); expect(ui.picker.busy).toBe(true);
    ui.picker.selectedItems=[ui.picker.items[0]];accept();
    expect((await picked)?.thread.id).toBe("root"); expect(signal?.aborted).toBe(true);
  });
  it("ignores late refresh results after cancellation",async()=>{
    let update:(threads:typeof roots)=>void=()=>{};
    const picked=pickRootThread([],async fn=>{update=fn;return new Promise(()=>{});},null,"/workspace",new Set());
    hide(); expect(await picked).toBeUndefined(); update(roots);
    expect(ui.picker.items).toEqual([]); expect(ui.picker.dispose).toHaveBeenCalledTimes(1);
  });
  it("shows completed results and clears loading state",async()=>{
    const picked=pickRootThread([],async()=>roots,null,"/workspace",new Set());
    await Promise.resolve(); expect(ui.picker.items).toHaveLength(1); expect(ui.picker.busy).toBe(false);
    hide(); await picked;
  });
});
