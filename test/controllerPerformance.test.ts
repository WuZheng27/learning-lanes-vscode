import { afterEach, describe, expect, it, vi } from "vitest";
const ui=vi.hoisted(()=>({focused:false,pick:vi.fn()}));
vi.mock("vscode",()=>({
 EventEmitter:class {event=()=>({dispose(){}});fire(){}dispose(){}},
 window:{state:{get focused(){return ui.focused;}},showErrorMessage:vi.fn(),showInformationMessage:vi.fn()},
}));
vi.mock("../src/rootPicker.js",()=>({pickRootThread:ui.pick}));
import { NavigatorController } from "../src/controller.js";
import { defaultDocument } from "../src/model.js";
import { parseThreadSnapshot, parseThreadList } from "../src/protocol.js";
import type { CodexBridge } from "../src/codexBridge.js";
import type { LearningStore } from "../src/store.js";
import type { WorkspaceFolder } from "vscode";
const controllers:NavigatorController[]=[];
afterEach(()=>{controllers.splice(0).forEach(c=>c.dispose());ui.focused=false;ui.pick.mockReset();});
async function setup() {
 const snapshots=Object.fromEntries(["a","b"].map(id=>[id,parseThreadSnapshot({thread:{id,cwd:"/workspace",forkedFromId:null,updatedAt:1,createdAt:1,turns:[{id:`turn-${id}`,status:"completed",items:[]}]}})]));
 const bridge={resolveRootThread:vi.fn(async (id:string)=>id),checkCompatibility:vi.fn(async()=>({extensionVersion:"test",appServerVersion:"test"})),
  readThread:vi.fn(async(id:string)=>snapshots[id]!),listRelatedThreads:vi.fn(async(id:string)=>parseThreadList({data:[snapshots[id]]})),
  cachedRootThreads:[],openSidebarThread:vi.fn(async()=>{}),dispose:vi.fn()};
 const store={read:vi.fn(async()=>({...defaultDocument("test"),rootThreadId:"a"})),write:vi.fn(async()=>{})};
 const controller=await NavigatorController.create(bridge as unknown as CodexBridge,store as unknown as LearningStore,{uri:{fsPath:"/workspace"}} as WorkspaceFolder);
 controllers.push(controller); return {controller,bridge,store,snapshots};
}
describe("controller performance and switching",()=>{
 it("opens the normalized official root before waiting for complete branch discovery",async()=>{
  const {controller,bridge,snapshots}=await setup();
  bridge.resolveRootThread.mockResolvedValue("b");
  ui.pick.mockResolvedValueOnce({thread:snapshots.a});
  let finish:(value:ReturnType<typeof parseThreadList>)=>void=()=>{};
  bridge.listRelatedThreads.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=controller.selectRoot();
  await vi.waitFor(()=>expect(bridge.listRelatedThreads).toHaveBeenCalled());
  expect(bridge.openSidebarThread).toHaveBeenCalledWith("b");
  expect(controller.getState().document.rootThreadId).toBe("b");
  expect(controller.getState().busy).toBe(true);
  finish(parseThreadList({data:[snapshots.b]}));
  await pending;
  expect(controller.getState().document.nodes.map(node=>node.id)).toEqual(["turn-b"]);
  expect(controller.getState().busy).toBe(false);
 });
 it("repairs a descendant root saved by 0.8.1 while retaining navigator metadata",async()=>{
  const {controller,bridge,store}=await setup();
  bridge.resolveRootThread.mockResolvedValue("b");
  await controller.sync();
  expect(controller.getState().document.rootThreadId).toBe("b");
  expect(controller.getState().document.nodes.map(node=>node.id)).toEqual(["turn-b"]);
  expect(store.write.mock.calls.length).toBeGreaterThan(0);
 });

 it("reuses snapshots and layout on unchanged sync and node selection",async()=>{
  const {controller,bridge}=await setup();await controller.sync();const state=controller.getState();
  await controller.sync(); expect(bridge.readThread).toHaveBeenCalledTimes(1);
  expect(controller.getState().layout).toBe(state.layout);
  controller.selectNode("turn-a");expect(controller.getState().layout).toBe(state.layout);
  expect(controller.getState().tableVersion).toBe(state.tableVersion);
 });
 it("reuses validated snapshots across A to B to A",async()=>{
  const {controller,bridge,snapshots}=await setup();await controller.sync();
  ui.pick.mockResolvedValueOnce({thread:snapshots.b}).mockResolvedValueOnce({thread:snapshots.a});
  await controller.selectRoot();await controller.selectRoot();
  expect(bridge.readThread.mock.calls.map(c=>c[0])).toEqual(["a","b"]);
  expect(controller.getState().document.nodes.map(n=>n.id)).toEqual(["turn-a"]);
 });
 it("discards an old background sync completing after root selection",async()=>{
  const {controller,bridge,snapshots}=await setup();
  let release:(v:NonNullable<typeof snapshots.a>)=>void=()=>{};
  bridge.readThread.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
  ui.focused=true;controller.setNavigatorVisible(true);await vi.waitFor(()=>expect(bridge.readThread).toHaveBeenCalledTimes(1));
  ui.pick.mockResolvedValueOnce({thread:snapshots.b});await controller.selectRoot();
  release(snapshots.a!);await new Promise(resolve=>setTimeout(resolve,0));
  expect(controller.getState().document.rootThreadId).toBe("b");
  expect(controller.getState().document.nodes.map(n=>n.id)).toEqual(["turn-b"]);
 });
});
