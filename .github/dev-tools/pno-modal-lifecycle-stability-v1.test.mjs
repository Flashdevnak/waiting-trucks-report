import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { stageFrontend } from './stage-dev-runtime.mjs';
import { patchPnoModalLifecycleStabilityV1 } from './patch-pno-modal-lifecycle-stability-v1.mjs';
const canonical = readFileSync(new URL('../../ms.js', import.meta.url), 'utf8');
const staged = stageFrontend(canonical);
function fn(name) {
  const prefix = staged.includes(`async function ${name}(`) ? `async function ${name}(` : `function ${name}(`;
  const start = staged.indexOf(prefix), end = staged.indexOf('\n}\n', start) + 2;
  assert.ok(start >= 0 && end > start, name); return staged.slice(start, end);
}
const runtimeStart = staged.indexOf('const pnoLifecycle =');
const runtimeEnd = staged.indexOf(fn('pnoLifecycleBindHandlers')) + fn('pnoLifecycleBindHandlers').length;
const runtime = staged.slice(runtimeStart, runtimeEnd);
const names = ['pnoV18LoadOwned', 'pnoV18LoadBagsOwned', 'pnoInboundLoadOwned', 'pnoV18Fetch',
  'pnoV18CacheGet', 'pnoV18CacheSet', 'pnoV18ApplyPageResult', 'pnoV18EnsureParcelFilterRows',
  'pnoV18PrepareCurrentFilters', 'pnoV18ExportOwned', 'pnoV18CopyOwned', 'pnoV18CopyLineOwned',
  'pnoV18OpenPendingParcelsOwned', 'pnoV18ResolveOpenArgs'];
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const flush = async () => { for (let i=0;i<50;i++) await Promise.resolve(); };
function harness(fetch = async (row,type,page) => ({parcels:[{pno:row.proofId+'-'+type}],total:1,page,sourceValid:true})) {
  const nodes = new Map(), writes = [], toasts = [], calls = [], rendered = [];
  const buttons = [];
  const node = id => {
    if (!nodes.has(id)) {
      const n = {dataset:{},open:false,disabled:false,querySelector:()=>node('toolbar'),querySelectorAll:()=>buttons,
        classList:{add(v){writes.push([id,'add',v]);},remove(v){writes.push([id,'remove',v]);},toggle(){}},
        showModal(){this.open=true;},close(){this.open=false;this.onclose?.();}};
      for (const prop of ['textContent','innerHTML']) Object.defineProperty(n,prop,{get(){return this['_'+prop]||'';},set(v){writes.push([id,prop,v]);this['_'+prop]=v;}});
      nodes.set(id,n);
    } return nodes.get(id);
  };
  const data = {type:'total',page:1,rows:[],total:0,filters:{},sourceRow:null,busy:false};
  const ctx = vm.createContext({pnoV18State:data,pendingParcelRows:[],pnoReadOnlyExplicitNoPrefetch:false,
    PNO_V18_VIEW_CACHE_MS:60000,pnoV18ViewCache:new Map(),pnoV18BagCache:new Map(),
    state:{branch:'HUB',currentRows:[],rows:[]},el:node,nf:{format:String},esc:String,console,
    pnoV18SourceRow:()=>data.sourceRow,pnoV18LocatorKey:r=>r?.proofId+'|'+r?.pnoNextStoreId,
    pnoV18PageCacheKey:(r,t,p)=>r?.proofId+'|'+t+'|'+p,
    browserPnoPage:async (...args)=>{calls.push(args);return fetch(...args);},
    pnoV18ExactSegments:()=>null,pnoPendingPropagatePositive(){},pnoOperationalInboundEligible:()=>true,
    pnoReadOnlyDetailEligibility:()=>({available:true}),pnoOperationalResolve:async()=>{},pnoV18OpenMulti(){},
    pnoV18EnsureUi(){ctx.pnoLifecycleBindHandlers(node('pending-parcels-dialog'));},
    pnoInboundToggleActions(){},pnoPendingRenderNote(){},pnoV18SetActive:t=>rendered.push(['tab',t]),
    pnoV18RenderSummary(){},pnoV18RenderBagSummary(){},pnoV18RenderFilters(){},
    pnoV18RenderRows:t=>rendered.push(['rows',t,data.rows.map(r=>r.pno)]),
    pnoV18RenderBags:r=>rendered.push(['bag',r.map(r=>r.pno)]),
    pnoV18RenderCurrentFilteredView:()=>rendered.push([data.type,data.rows.map(r=>r.pno)]),
    pnoV18ParcelFilterActive:()=>false,pnoV18RenderUnionDiagnostic(){},
    pnoV18FilteredParcelEntries:r=>(r||data.rows).map(item=>({item})),
    pnoV18FilteredBagGroups:()=>[],pnoV18ParcelAction:r=>r.lastAction,pnoV18ParcelStatus:()=>'',pnoV18DisplayBranch:String,
    toast:(...a)=>toasts.push(a),XLSX:{utils:{json_to_sheet:x=>x,book_new:()=>({}),book_append_sheet(){}},writeFile(){}},
    render(){return 'main-render';},realtimeTick(){return 'main-realtime';},
  });
  vm.runInContext(names.map(fn).join('\n')+'\nopenPendingParcels = pnoV18OpenPendingParcelsOwned;\n'+runtime,ctx);
  const trip = proofId=>({proofId,pnoSourceDay:'2026-10-07',pnoLineId:'L',pnoStoreId:'S',pnoNextStoreId:'T',routeName:proofId});
  return {ctx,data,nodes,writes,toasts,calls,rendered,buttons,trip,
    open:(id='A')=>ctx.openPendingParcels(trip(id),'total',1),
    close(){node('pending-parcels-close').onclick();},
    lifecycle:()=>vm.runInContext('({...pnoLifecycle})',ctx),
    survive(){assert.equal(ctx.render(),'main-render');assert.equal(ctx.realtimeTick(),'main-realtime');}};
}

for (const failure of [false,true]) test(`A→B stale ${failure?'failure':'success'} and old finally cannot clear B`, async()=>{
  const a=deferred(),b=deferred();const h=harness(row=>row.proofId==='A'?a.promise:b.promise);
  const pa=h.open('A');await flush();const pb=h.open('B');await flush();
  assert.equal(h.calls.length,2);const before=JSON.stringify(h.data),writes=h.writes.length,owner=h.lifecycle().busyOwner;
  if(failure)a.reject(new Error('old A'));else a.resolve({parcels:[{pno:'A'}],total:1,page:1});
  await pa;assert.equal(JSON.stringify(h.data),before);assert.equal(h.writes.length,writes);
  assert.equal(h.lifecycle().busyOwner,owner);assert.equal(h.toasts.length,0);
  b.resolve({parcels:[{pno:'B'}],total:1,page:1});await pb;assert.equal(h.data.rows[0].pno,'B');h.survive();
});

for (const view of ['bag','no_entry','scan_gap']) test(`rapid TOTAL→ALREADY→${view}: initial + one latest load`,async()=>{
  const a=deferred();let first=true;const h=harness((row,type,page)=>{if(first){first=false;return a.promise;}return {parcels:[{pno:'LATEST-'+type}],total:1,page,sourceValid:true};});
  const p=h.open();await flush();await h.ctx.pnoV18Load('already',1);
  if(view==='bag') await h.ctx.pnoV18Load('no_entry',1);
  await (view==='bag'?h.ctx.pnoV18LoadBags():view==='scan_gap'?h.ctx.pnoInboundLoad(1):h.ctx.pnoV18Load(view,1));
  assert.equal(h.calls.length,1);a.resolve({parcels:[{pno:'OLD'}],total:1,page:1});await p;
  assert.equal(h.calls.length,2);assert.equal(h.data.type,view);
  assert.equal((view==='bag'?h.data.bagRows:h.data.rows)[0].pno,'LATEST-'+(view==='scan_gap'||view==='bag'?'total':view));
  assert.equal(h.rendered.some(r=>JSON.stringify(r).includes('OLD')),false);h.survive();
});

test('rapid pager keeps only latest requested page',async()=>{
  const a=deferred();let first=true;const h=harness((r,t,page)=>first?(first=false,a.promise):({parcels:[{pno:'PAGE-'+page}],total:600,page}));
  // Disable automatic filter aggregation only for this pager-specific fixture.
  h.ctx.pnoV18PrepareCurrentFilters=()=>{};
  const p=h.open();await flush();h.ctx.pnoV18Load('total',2);h.ctx.pnoV18Load('total',3);
  a.resolve({parcels:[],total:600,page:1});await p;assert.equal(h.data.page,3);assert.equal(h.calls.length,2);assert.equal(h.data.rows[0].pno,'PAGE-3');
});

for(const reopen of [false,true]) test(`close pending load${reopen?' then reopen same trip':''}`,async()=>{
  const old=deferred(),fresh=deferred();let n=0;const h=harness(()=>++n===1?old.promise:fresh.promise);
  const p=h.open();await flush();const g=h.lifecycle().open;h.close();let q;
  if(reopen){q=h.open();await flush();assert.ok(h.lifecycle().open>g);}
  const before=JSON.stringify(h.data),writes=h.writes.length;old.resolve({parcels:[{pno:'OLD'}],total:1,page:1});await p;
  assert.equal(JSON.stringify(h.data),before);assert.equal(h.writes.length,writes);
  if(q){fresh.resolve({parcels:[{pno:'NEW'}],total:1,page:1});await q;}h.survive();
});

for(const reopen of [false,true]) test(`1772-row filter page 3 pending → ${reopen?'B opens':'close'} stops pages 4–9`,async()=>{
  const page3=deferred();const h=harness((row,type,page)=>{
    if(row.proofId==='A'&&page===3)return page3.promise;
    const total=row.proofId==='A'?1772:1;
    return {parcels:Array.from({length:Math.min(200,total-(page-1)*200)},(_,i)=>({pno:row.proofId+'-'+((page-1)*200+i)})),total,page,sourceValid:true};
  });
  const p=h.open();await flush();assert.deepEqual(h.calls.map(c=>c[2]),[1,2,3]);h.close();let q;
  if(reopen){q=h.open('B');await q;}
  const before=JSON.stringify(h.data),writes=h.writes.length;
  page3.resolve({parcels:Array.from({length:200},(_,i)=>({pno:'A-'+(400+i)})),total:1772,page:3});await p;
  assert.equal(JSON.stringify(h.data),before);assert.equal(h.writes.length,writes);
  assert.equal(h.calls.some(c=>c[0].proofId==='A'&&c[2]>=4),false);h.survive();
});

test('filter page 5 failure never exposes partial complete rows; error renderer failure is contained',async()=>{
  const h=harness((row,type,page)=>{if(page===5)throw new Error('page five');return {parcels:Array.from({length:200},(_,i)=>({pno:page+'-'+i})),total:1772,page};});
  let renders=0;h.ctx.pnoV18RenderFilters=()=>{if(++renders>1)throw new Error('error render');};
  await h.open();assert.equal(h.data.filterRows,null);assert.match(h.data.filterError,/ไม่สำเร็จ/);
  assert.equal(h.lifecycle().busyOwner,null);assert.equal(h.calls.length,5);h.survive();
});

for(const cached of [false,true]) test(`${cached?'cached':'fresh'} render failure is local and releases owner`,async()=>{
  const h=harness();if(cached)h.ctx.pnoV18ViewCache.set('A|total|1',{at:Date.now(),value:{parcels:[{pno:'CACHE'}],total:1}});
  h.ctx.pnoV18ApplyPageResult=()=>{throw new Error('render');};
  await h.open();assert.equal(h.lifecycle().busyOwner,null);assert.equal(h.data.busy,false);
  assert.ok(h.toasts.length||h.writes.some(w=>String(w[2]).includes('render')));assert.equal(h.calls.length,cached?0:1);h.survive();
});

test('Export rejection and synchronous filter/reset/bag errors terminate locally',async()=>{
  const h=harness();await h.open();h.ctx.pnoV18EnsureParcelFilterRows=async()=>{throw new Error('export');};
  await h.ctx.pnoV18Export();assert.ok(h.toasts.length);
  const reset={onclick(){throw new Error('filter reset');}},select={onchange(){throw new Error('filter change');}},bag={onclick(){throw new Error('bag');}};
  h.buttons.push(reset,select,bag);h.ctx.pnoLifecycleBindHandlers(h.nodes.get('pending-parcels-dialog'));
  await reset.onclick();await select.onchange();await bag.onclick();assert.equal(h.toasts.length,4);h.survive();
});

test('initialization and main realtime do not acquire detail or multiply handlers/observers',async()=>{
  const h=harness(),button={onclick(){}};h.buttons.push(button);
  for(let i=0;i<10;i++){h.ctx.pnoV18EnsureUi();h.survive();}
  const handler=button.onclick,close=h.nodes.get('pending-parcels-dialog').close;
  for(let i=0;i<10;i++)h.ctx.pnoV18EnsureUi();assert.equal(button.onclick,handler);
  assert.equal(h.nodes.get('pending-parcels-dialog').close,close);
  assert.equal(h.calls.length,0);assert.doesNotMatch(runtime,/setInterval|setTimeout|IntersectionObserver|MutationObserver|apiGet|fetch\(/);
});

test('final-stage order, idempotence, cache TTL/keys unchanged and MS lock intact',()=>{
  assert.equal(patchPnoModalLifecycleStabilityV1(staged),staged);assert.equal(stageFrontend(staged),staged);
  assert.doesNotThrow(()=>new Function(staged));
  const composer=readFileSync(new URL('./stage-dev-runtime.mjs',import.meta.url),'utf8');
  assert.ok(composer.indexOf('output = patchPnoModalLifecycleStabilityV1(output)')>composer.indexOf('output = patchPnoSegmentDestinationFrontend(output)'));
  assert.match(composer,/patchMsRouteReadBudgetIsolationV1/);
  assert.match(staged,/const PNO_V18_VIEW_CACHE_MS = 60 \* 1000/);
  assert.match(fn('pnoV18CacheGet'), /Date\.now\(\) - entry\.at >= PNO_V18_VIEW_CACHE_MS/);
  assert.match(fn('pnoV18CacheSet'), /map\.size >= limit && !map\.has\(key\)/);
  assert.match(fn('pnoV18PageCacheKey'), /pnoV18LocatorKey\(row\).*String\(type/);
  const patch=readFileSync(new URL('./patch-pno-modal-lifecycle-stability-v1.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(patch, /transform\(source, 'pnoV18Cache|pnoBrowserCache\.(?:clear|delete|set)/);
  assert.doesNotMatch(canonical,/PNO_MODAL_LIFECYCLE_STABILITY_V1/);
});


for (const view of ['bag','scan_gap']) test(`${view} pending owner cannot apply after another open`, async()=>{
  const pending=deferred();let held=false;
  const h=harness((row,type,page)=>{
    if(row.proofId==='A' && held) return pending.promise;
    return {parcels:[{pno:row.proofId}],total:1,page,sourceValid:true};
  });
  await h.open('A');h.ctx.pnoV18ViewCache.clear();held=true;
  const old=view==='bag'?h.ctx.pnoV18LoadBags():h.ctx.pnoInboundLoad(1);await flush();
  await h.open('B');const before=JSON.stringify(h.data),writes=h.writes.length;
  pending.resolve({parcels:[{pno:'OLD'}],total:1,page:1,sourceValid:true});await old;
  assert.equal(JSON.stringify(h.data),before);assert.equal(h.writes.length,writes);h.survive();
});

test('copy and LINE async rejection, open pre-try error and Escape close are local',async()=>{
  const h=harness();await h.open();h.ctx.pnoV18WriteClipboard=async()=>{throw new Error('clipboard');};
  await h.ctx.pnoV18Copy();await h.ctx.pnoV18CopyLine();assert.equal(h.toasts.length,2);
  const generation=h.lifecycle().open;h.nodes.get('pending-parcels-dialog').oncancel();
  assert.ok(h.lifecycle().open>generation);assert.equal(h.lifecycle().active,false);
  h.ctx.pnoV18EnsureUi=()=>{throw new Error('open render');};await h.open('B');
  assert.equal(h.toasts.length,3);assert.equal(h.lifecycle().busyOwner,null);h.survive();
});

test('actual main render/realtime functions and cache contracts are untouched, with zero detail I/O',()=>{
  // Skip this one patch while composing the same accepted DEV stack for comparison.
  const before=stageFrontend(canonical+'\n// PNO_MODAL_LIFECYCLE_STABILITY_V1');
  function block(source,name){const start=source.indexOf('function '+name+'(');return source.slice(start,source.indexOf('\n}\n',start)+2);}
  for(const name of ['render','realtimeTick','pnoV18CacheGet','pnoV18CacheSet','pnoV18PageCacheKey','pnoBrowserBaseKey','pnoBrowserPageKey'])
    assert.equal(block(staged,name),block(before,name),name);
  let acquisitions=0,mainRenders=0,refreshes=0;
  const n={classList:{add(){},remove(){}}};
  const ctx=vm.createContext({state:{auth:{token:'synthetic'},rows:[{}],summary:'all',queue:'all'},
    el:()=>n,metrics(){},renderFreshness(){},filteredRows:()=>[{}],renderFilterSummary(){},
    renderRowsProgressively(){mainRenders++;},empty(){},pnoDetailDiagRender(){},resetLowerDailyViewOnBangkokDayChange(){},
    document:{hidden:false},ensureRealtimeTransport:()=>true,realtimeSocket:{readyState:1},
    sendForegroundRefresh(){refreshes++;return true;},browserPnoPage(){acquisitions++;},apiGet(){acquisitions++;}});
  vm.runInContext(block(staged,'render')+'\n'+block(staged,'realtimeTick'),ctx);
  for(let i=0;i<15;i++){ctx.render();ctx.realtimeTick();}
  assert.equal(mainRenders,15);assert.equal(refreshes,15);assert.equal(acquisitions,0);
  assert.doesNotMatch(block(staged,'render')+block(staged,'realtimeTick'),/pnoV18Load|pnoInboundLoad|browserPnoPage/);
});


test('queued native close from A cannot invalidate B before B shows its dialog',async()=>{
  const h=harness();await h.open('A');const dialog=h.nodes.get('pending-parcels-dialog');
  // Rebind around a controlled native close which queues, rather than immediately fires, close.
  dialog.close=function(){this.open=false;};h.ctx.pnoLifecycleBindHandlers(dialog);
  h.close();assert.equal(h.lifecycle().active,false);
  const resolveSource=deferred();h.ctx.pnoOperationalResolve=()=>resolveSource.promise;
  const b=h.open('B');await flush();const owner=h.lifecycle().open;
  assert.equal(dialog.open,false);dialog.onclose();
  assert.equal(h.lifecycle().active,true);assert.equal(h.lifecycle().open,owner);
  resolveSource.resolve();await b;assert.equal(h.data.rows[0].pno,'B-total');h.survive();
});
