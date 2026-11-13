// Target lifecycle business outcomes on actual integrated functions/observer/guard bytes.
// Legacy pnoLifecycle diagnostic object is not mocked into the new implementation.
import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {harness,trip,result,deferred,flush,extract,source} from './pno-final-contract-harness-v3.mjs';
for(const fail of [false,true])test('TARGET-A '+(fail?'old failure':'old success')+' cannot overwrite B or clear its busy flag',async()=>{
 const a=deferred(),b=deferred(),h=harness(r=>r.proofId==='A'?a.promise:b.promise),pa=h.open(trip('A'));await flush();const pb=h.open(trip('B'));await flush();assert.deepEqual(h.calls.map(x=>x.proof),['A','B']);const n=h.writes.length;
 if(fail)a.reject(Error('OLD_A'));else a.resolve(result(trip('A')));await pa;await flush();assert.equal(h.writes.length,n);assert.equal(h.data.proofId,'B');assert.equal(h.data.busy,true);b.resolve(result(trip('B')));await pb;await h.prepared();assert.equal(h.data.rows[0].pno,'B-total-0');assert.equal(h.toasts.length,0);
});
for(const view of ['bag','no_entry','scan_gap'])test('TARGET-B rapid views publish only latest '+view,async()=>{
 const held=deferred();let first=true;const h=harness((r,t,p)=>first?(first=false,held.promise):result(r,t,p));const open=h.open();await flush();h.node('tab-already').onclick();h.node('tab-'+view).onclick();held.resolve(result(trip()));await open;await h.prepared();assert.equal(h.calls.length,2);assert.equal(h.data.type,view);assert.ok(!h.calls.some(x=>x.type==='already'));
});
test('TARGET-C rapid pages keep only page3 with the original two total requests',async()=>{
 const a=deferred(),h=harness((r,t,p)=>p===1?a.promise:result(r,t,p,600)),open=h.open();await flush();const p2=h.ctx.pnoV18Load('total',2),p3=h.ctx.pnoV18Load('total',3);a.resolve(result(trip(),'total',1,600));await Promise.all([open,p2,p3]);await h.prepared();assert.deepEqual(h.calls.map(x=>x.page),[1,3]);assert.equal(h.data.page,3);
});
for(const reopen of [false,true])test('TARGET-D pending close'+(reopen?' and reopen':'' )+' refuses old data',async()=>{
 const old=deferred(),fresh=deferred();let n=0;const h=harness(()=>++n===1?old.promise:fresh.promise),p=h.open();await flush();h.close();const q=reopen?h.open():null;await flush();const writes=h.writes.length;old.resolve(result({...trip(),proofId:'OLD'}));await p;await flush();assert.equal(h.writes.length,writes);if(q){fresh.resolve(result(trip()));await q;await h.prepared();assert.equal(h.data.rows[0].pno,'A-total-0');}
});
for(const reopen of [false,true])test('TARGET-E 1772-row page3 stops A pages4-9 on '+(reopen?'B':'close'),async()=>{
 const held=deferred(),h=harness((r,t,p)=>r.proofId==='A'&&p===3?held.promise:result(r,t,p,r.proofId==='A'?1772:1));await h.open();await flush();assert.deepEqual(h.calls.map(x=>x.page),[1,2,3]);h.close();const b=reopen?h.open(trip('B')):null;held.resolve(result(trip(),'total',3,1772));if(b)await b;await h.prepared();assert.ok(!h.calls.some(x=>x.proof==='A'&&x.page>=4));
});
test('TARGET-F page5 failure plus error renderer failure stays local with no partial complete data',async()=>{
 const h=harness((r,t,p)=>{if(p===5)throw Error('page five');return result(r,t,p,1772);});let count=0;h.ctx.pnoV18RenderFilters=()=>{if(++count>1)throw Error('error renderer');};await assert.doesNotReject(()=>h.open());await h.prepared();assert.equal(h.data.filterRows,null);assert.ok(h.data.filterError);assert.equal(h.calls.length,5);assert.equal(h.data.busy,false);await flush();
});
for(const cached of [false,true])test('TARGET-G '+(cached?'cached':'fresh')+' render exception stays PNO-local',async()=>{
 const h=harness();await h.open();await h.prepared();if(!cached)h.ctx.pnoV18ViewCache.clear();h.ctx.pnoV18ApplyPageResult=()=>{throw Error('render');};const callsBefore=h.calls.length;await assert.doesNotReject(()=>h.ctx.pnoV18Load('total',1));assert.equal(h.calls.length-callsBefore,cached?0:1);assert.equal(h.data.busy,false);assert.ok(h.toasts.length||h.writes.some(x=>String(x[2]).includes('render')));
});
test('TARGET-H Export and dynamic filter/select/bag handlers contain errors',async()=>{
 const h=harness();await h.open();await h.prepared();h.ctx.XLSX.writeFile=()=>{throw Error('export');};await h.ctx.pnoV18Export();assert.equal(h.toasts.length,1);
 const nodes=[{onclick(){throw Error('filter reset');}},{onchange(){throw Error('filter change');}},{onclick(){throw Error('bag');}}];const dialog=h.node('pending-parcels-dialog'),query=dialog.querySelectorAll;dialog.querySelectorAll=s=>s==='button,select'?nodes:query.call(dialog,s);h.ctx.pnoIntegratedBindHandlers(dialog);for(const n of nodes)await (n.onclick||n.onchange)();assert.equal(h.toasts.length,4);assert.equal(h.data.busy,false);
});
test('TARGET-I repeated ensureUI does not acquire data or multiply bound handlers',async()=>{
 const h=harness();await h.open();await h.prepared();const calls=h.calls.length,dialog=h.node('pending-parcels-dialog'),native=dialog.close;for(let i=0;i<10;i++)h.ctx.pnoV18EnsureUi();assert.equal(dialog.close,native);assert.equal(h.calls.length,calls);
});
test('TARGET-J native queued close for A does not invalidate B during resolve',async()=>{
 const h=harness();await h.open();await h.prepared();const dialog=h.node('pending-parcels-dialog');dialog.close=function(){this.open=false;};h.ctx.pnoIntegratedBindHandlers(dialog);h.close();const held=deferred();h.ctx.pnoOperationalResolve=()=>held.promise;const b=h.open(trip('B'));await flush();const gen=h.data.asyncLifecycle.generation;dialog.onclose();assert.equal(h.data.asyncLifecycle.generation,gen);assert.equal(h.data.asyncLifecycle.open,true);held.resolve();await b;await h.prepared();assert.equal(h.data.rows[0].pno,'B-total-0');
});
test('TARGET-K clipboard/LINE/init errors and Escape remain PNO-local',async()=>{
 const h=harness();await h.open();await h.prepared();h.ctx.pnoV18WriteClipboard=async()=>{throw Error('clipboard');};await h.ctx.pnoV18Copy();await h.ctx.pnoV18CopyLine();assert.equal(h.toasts.length,2);h.node('pending-parcels-dialog').oncancel({preventDefault(){}});assert.equal(h.data.asyncLifecycle.open,false);h.ctx.pnoV18EnsureUi=()=>{throw Error('init');};await assert.doesNotReject(()=>h.open(trip('B')));assert.equal(h.toasts.length,3);
});
for(const view of ['bag','scan_gap'])test('TARGET-L pending '+view+' cannot publish into another open',async()=>{
 const old=deferred(),fresh=deferred(),h=harness(r=>r.proofId==='A'?old.promise:fresh.promise);const a=h.open(trip('A'),view);await flush();const b=h.open(trip('B'));await flush();const writes=h.writes.length;old.resolve(result(trip()));await a;await flush();assert.equal(h.writes.length,writes);fresh.resolve(result(trip('B')));await b;await h.prepared();assert.equal(h.data.proofId,'B');
});
test('TARGET-M existing main render/realtime and cache definitions remain unchanged from approved baseline',()=>{
 for(const n of ['render','realtimeTick','pnoV18CacheGet','pnoV18CacheSet','pnoV18PageCacheKey','pnoBrowserBaseKey','pnoBrowserPageKey'])assert.ok(extract(n).length>0);assert.equal(vm.runInNewContext(source.match(/PNO_V18_VIEW_CACHE_MS\s*=\s*([^;]+);/)[1]),60000);assert.doesNotMatch(extract('render')+extract('realtimeTick'),/pnoV18Load|pnoInboundLoad|browserPnoPage/);
});

test('TARGET-N contract-v3 final staging order/idempotence/cache keys/MS lock preserved',async()=>{
 const {readFileSync}=await import('node:fs');const{stageFrontend}=await import('./stage-dev-runtime.mjs');const{patchPnoCrossOpenBoundedV1}=await import('./patch-pno-cross-open-bounded-v1.mjs');
 assert.equal(patchPnoCrossOpenBoundedV1(source),source);assert.equal(stageFrontend(source),source);assert.doesNotThrow(()=>new Function(source));
 const composer=readFileSync(new URL('./stage-dev-runtime.mjs',import.meta.url),'utf8');const order=['output = patchPnoAsyncLifecycle(output);','output = patchPnoQrExcelLocal009(output);','output = patchPnoQrClosure009R(output);','output = patchPnoQrRelease009R2(output);','output = patchPnoIntegratedTargetBoundary(output);','output = patchPnoTruckQrHeaderV1(output);','output = patchPnoTruckQrOwnerIntegrationV1(output);','output = patchPnoCrossOpenBoundedV1(output);'];const positions=order.map(x=>composer.indexOf(x));assert.ok(positions.every(x=>x>0));assert.deepEqual(positions,positions.slice().sort((a,b)=>a-b));assert.match(composer,/patchMsRouteReadBudgetIsolationV1/);assert.match(extract('pnoV18CacheGet'),/Date\.now\(\) - entry\.at >= PNO_V18_VIEW_CACHE_MS/);assert.match(extract('pnoV18CacheSet'),/map\.size >= limit && !map\.has\(key\)/);assert.match(extract('pnoV18PageCacheKey'),/pnoV18LocatorKey\(row\).*String\(type/);const helper=readFileSync(new URL('./patch-pno-cross-open-bounded-v1.mjs',import.meta.url),'utf8');assert.doesNotMatch(helper,/setInterval\s*\(|setTimeout\s*\(|\bfetch\s*\(|pnoBrowserCache\.(?:clear|delete|set)/);
});
test('TARGET-O contract-v3 actual main render/realtime remain unchanged and perform zero detail requests',async()=>{
 const{readFileSync}=await import('node:fs');const{createHash}=await import('node:crypto');const pins=JSON.parse(readFileSync(new URL('./pno-pre-dev003-function-pins.json',import.meta.url))).functions;for(const name of ['render','realtimeTick','pnoV18CacheGet','pnoV18CacheSet','pnoV18PageCacheKey','pnoBrowserBaseKey','pnoBrowserPageKey'])assert.equal(createHash('sha256').update(extract(name)).digest('hex'),pins[name],name);
 let acquisitions=0,mainRenders=0,refreshes=0;const n={classList:{add(){},remove(){}}};const ctx=vm.createContext({state:{auth:{token:'synthetic'},rows:[{}],summary:'all',queue:'all'},el:()=>n,metrics(){},renderFreshness(){},filteredRows:()=>[{}],renderFilterSummary(){},renderRowsProgressively(){mainRenders++;},empty(){},pnoDetailDiagRender(){},resetLowerDailyViewOnBangkokDayChange(){},document:{hidden:false},ensureRealtimeTransport:()=>true,realtimeSocket:{readyState:1},sendForegroundRefresh(){refreshes++;return true;},browserPnoPage(){acquisitions++;},apiGet(){acquisitions++;}});vm.runInContext(extract('render')+'\n'+extract('realtimeTick'),ctx);for(let i=0;i<15;i++){ctx.render();ctx.realtimeTick();}assert.equal(mainRenders,15);assert.equal(refreshes,15);assert.equal(acquisitions,0);
});
