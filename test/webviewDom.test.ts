import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLaneLayout } from "../src/layout.js";
import { defaultDocument } from "../src/model.js";
import type { LearningNode, NavigatorViewState } from "../src/types.js";
const source=readFileSync("src/webview.ts","utf8");
const script=source.match(/<script nonce="\$\{nonce\}">([\s\S]*?)<\/script>/u)![1]!;
const windows:JSDOM[]=[];
afterEach(()=>windows.splice(0).forEach(dom=>dom.window.close()));
function node(id:string,parentNodeId:string|null):LearningNode {
 return {id,parentNodeId,threadId:id,turnId:id,title:id,createdAt:"2026-01-01",updatedAt:"2026-01-01",runtimeState:"completed",collapsed:false,navigationExact:true,waitingBranchCount:0,containingThreadIds:[id],terminalThreadIds:[id]};
}
function state():NavigatorViewState {
 const nodes=[node("root",null),node("a","root"),node("b","root"),node("c","a")];
 const document={...defaultDocument("test"),rootThreadId:"root",nodes,nodeActivity:{a:{visitCount:3,lastVisitedAt:null},c:{visitCount:2,lastVisitedAt:null},b:{visitCount:7,lastVisitedAt:null}}};
 return {tableVersion:1,document,layout:buildLaneLayout(nodes),selectedNodeId:null,selectedNodePreview:null,canUndo:false,canRedo:false,busy:false,compatibility:{checked:true,ok:true,extensionVersion:"test",appServerVersion:"test",message:null},transientMessage:null};
}
function setup() {
 const dom=new JSDOM('<div id="app"></div>',{runScripts:"outside-only",pretendToBeVisual:true});windows.push(dom);
 const win=dom.window as any; const post=vi.fn();
 win.acquireVsCodeApi=()=>({postMessage:post});win.ResizeObserver=class{observe(){}};
 win.CSS={escape:(v:string)=>v};win.requestAnimationFrame=(fn:()=>void)=>{fn();return 1;};
 win.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 win.HTMLDialogElement.prototype.close=function(){this.open=false;};
 win.eval(script);
 const send=(state:NavigatorViewState)=>win.dispatchEvent(new win.MessageEvent("message",{data:{type:"state",state}}));
 return {win,post,send,document:win.document as Document};
}
describe("webview runtime",()=>{
 it("shares background columns across depths and aggregates lane activity correctly",()=>{
  const ui=setup();ui.send(state());
  expect(ui.document.querySelectorAll(".lane-slot")).toHaveLength(2);
  expect(ui.document.querySelectorAll(".lane-row")).toHaveLength(3);
  expect([...ui.document.querySelectorAll(".lane-activity")].map(el=>el.textContent)).toEqual(["5 次访问","7 次访问"]);
  expect(ui.document.querySelectorAll(".node")).toHaveLength(4);
 });
 it("keeps table and cell identity, scroll, selection, and click handlers on status updates",()=>{
  const ui=setup();const first=state();ui.send(first);
  const table=ui.document.querySelector(".table-scroll")!;table.scrollTop=120;table.scrollLeft=30;
  const cell=ui.document.querySelector<HTMLElement>('[data-node-id="a"]')!;
  ui.send({...first,selectedNodeId:"a",busy:true,transientMessage:"Loading"});
  expect(ui.document.querySelector(".table-scroll")).toBe(table);
  expect(ui.document.querySelector('[data-node-id="a"]')).toBe(cell);
  expect(table.scrollTop).toBe(120);expect(table.scrollLeft).toBe(30);
  expect(cell.getAttribute("aria-selected")).toBe("true");expect(cell.tabIndex).toBe(0);
  cell.click();expect(ui.post).toHaveBeenLastCalledWith({type:"selectNode",nodeId:"a"});
 });
 it("rebuilds when structure changes and preserves frozen lanes",()=>{
  const ui=setup();const first=state();ui.send(first);const table=ui.document.querySelector(".table");
  ui.send({...first,tableVersion:2,document:{...first.document,frozenRootNodeIds:["a"]}});
  expect(ui.document.querySelector(".table")).not.toBe(table);
  expect(ui.document.querySelectorAll(".lane-slot.frozen")).toHaveLength(1);
  expect(ui.document.querySelectorAll(".node.frozen")).toHaveLength(2);
 });
 it("opens and dismisses previews without replacing the table",()=>{
  const ui=setup();const first=state();ui.send(first);const table=ui.document.querySelector(".table");
  const preview={nodeId:"a",label:null,question:"a",questionHtml:"<p>a</p>",answerHtml:"<p>answer</p>",answerState:"ready" as const,path:["root"],childCount:1,descendantCount:1,visitCount:0,lastVisitedAt:null,createdAt:"2026-01-01",updatedAt:"2026-01-01"};
  ui.send({...first,selectedNodeId:"a",selectedNodePreview:preview});
  expect(ui.document.querySelector<HTMLDialogElement>("dialog")?.open).toBe(true);
  expect(ui.document.querySelector(".table")).toBe(table);
  ui.document.querySelector<HTMLButtonElement>(".snapshot-close")!.click();
  ui.send({...first,selectedNodeId:"a",selectedNodePreview:preview,transientMessage:"updated"});
  expect(ui.document.querySelector<HTMLDialogElement>("dialog")?.open).not.toBe(true);
 });
});
