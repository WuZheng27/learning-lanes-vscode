const {chromium}=require('playwright');const fs=require('node:fs');const assert=require('node:assert/strict');
const repo=process.cwd();
const baseline=process.argv.includes('--baseline');
fs.mkdirSync(repo+'/dist',{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
 const page=await browser.newPage({viewport:{width:1400,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const source=fs.readFileSync(repo+'/src/webview.ts','utf8');
 let html=source.slice(source.indexOf('<!doctype html>'),source.lastIndexOf('</html>')+7).replace(/<meta[^>]*Content-Security-Policy[^>]*>/g,'').replaceAll('${nonce}','test');
 html=html.replace('<div id="app"></div>','<div id="app"></div><script>window.sent=[];window.acquireVsCodeApi=()=>({postMessage:m=>window.sent.push(m)});</script>');
 html=html.replace('<style>', '<style>:root {--vscode-editor-background:#1e1e1e;--vscode-foreground:#ddd;--vscode-font-size:13px;--vscode-panel-border:#555;--vscode-button-secondaryBackground:#333;--vscode-button-secondaryForeground:#ddd;--vscode-charts-blue:#409aff;--vscode-focusBorder:#409aff;--vscode-descriptionForeground:#aaa;}');
 await page.setContent(html);
 const result=await page.evaluate(async()=>{
 const lanes=300,depth=100;const nodes=[];const rows=Array.from({length:depth},()=>Array(lanes).fill(null));
 const make=(id,parentNodeId)=>({id,parentNodeId,threadId:id,turnId:id,title:id,runtimeState:'completed',navigationExact:true,collapsed:false,createdAt:'2026-01-01',updatedAt:'2026-01-01',containingThreadIds:[id],terminalThreadIds:[id],waitingBranchCount:0});
 const root=make('root',null);nodes.push(root);rows[0][0]={node:root,lane:0,depth:0,columnSpan:lanes};
 const keys=[];for(let i=0;i<lanes;i++){const n=make('leaf-'+i,'root');nodes.push(n);keys.push(n.id);rows[1][i]={node:n,lane:i,depth:1,columnSpan:1};}
 let parent='leaf-0';for(let d=2;d<depth;d++){const n=make('deep-'+d,parent);nodes.push(n);rows[d][0]={node:n,lane:0,depth:d,columnSpan:1};parent=n.id;}keys[0]=parent;
 const state={tableVersion:1,document:{rootThreadId:'root',nodes,nodeLabels:{},nodeActivity:{},frozenRootNodeIds:[],temporaryForks:[],preferences:{fontScale:1,tableScale:.85,autoFit:true,defaultColumnWidth:210,defaultRowHeight:88,columnWidths:{},rowHeights:{},textMode:'wrap'}},layout:{rows,laneCount:lanes,laneKeys:keys},busy:false,canUndo:false,canRedo:false,selectedNodeId:null,selectedNodePreview:null,compatibility:{ok:true,checked:true,extensionVersion:'test',appServerVersion:'test'}};
 const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 const start=performance.now();window.dispatchEvent(new MessageEvent('message',{data:{type:'state',state}}));await frame();
 const firstFrameMs=performance.now()-start;const table=document.querySelector('.table-scroll');const node=document.querySelector('[data-node-id="leaf-0"]');table.scrollLeft=100;table.scrollTop=100;
 const before=node;const update=performance.now();window.dispatchEvent(new MessageEvent('message',{data:{type:'state',state:{...state,selectedNodeId:'leaf-0',busy:true}}}));await frame();
 const updateFrameMs=performance.now()-update;
 const rootRect=document.querySelector('[data-node-id="root"]').getBoundingClientRect();const a=node.getBoundingClientRect();const b=document.querySelector('[data-node-id="leaf-1"]').getBoundingClientRect();
 node.click();
 return {firstFrameMs,updateFrameMs,nodes:document.querySelectorAll('.node').length,backgrounds:document.querySelectorAll('.lane-slot').length,tableReused:table===document.querySelector('.table-scroll'),cellReused:before===document.querySelector('[data-node-id="leaf-0"]'),scrollLeft:table.scrollLeft,scrollTop:table.scrollTop,siblingSameRow:Math.abs(a.top-b.top)<1,parentAbove:rootRect.top<a.top,parentSpans:rootRect.width>a.width*200,clickSent:window.sent.at(-1)?.type==='selectNode'};
 });
 if (!baseline) {
 assert.equal(result.backgrounds,300);assert.equal(result.nodes,399);for(const k of ['tableReused','cellReused','siblingSameRow','parentAbove','parentSpans','clickSent'])assert.equal(result[k],true,k);assert.equal(result.scrollTop,100);assert.equal(result.scrollLeft,100);assert.deepEqual(errors,[]);
 }
 await page.screenshot({path:repo+'/dist/browser-smoke.png'});console.log(JSON.stringify({ok:true,...result,errors},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
