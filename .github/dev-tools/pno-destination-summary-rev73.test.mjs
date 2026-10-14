import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {stageFrontend,patchDevUiShellSource} from './stage-dev-runtime.mjs';
import {pnoDestinationAggregate as aggregate,pnoDestinationHub,pnoDestinationDisplayBranch,
 pnoDestinationMarkup,patchPnoDestinationSummary,PNO_DESTINATION_STYLE} from './patch-pno-destination-summary-rev73.mjs';
const canonical=fs.readFileSync(new URL('../../ms.js',import.meta.url),'utf8'),staged=stageFrontend(canonical);
const row=(pno,hub,branch,extra={})=>({pno,targetHub:hub,targetBranch:branch,nextStoreName:'NEXT_STORE_NOT_DESTINATION',status:'รอ',lastAction:'รับ',...extra});
const fixtures=[row('A','NE11','(TH1001)สาขาก'),row('B','10 NE11_HUB-ฮับอีสาน','(TH1001)สาขาก'),row('C','NE11','สาขาข'),
 row('D','E1','สาขาตะวันออก'),row('E','E1','สาขาตะวันออก'),row('F','NE12','สาขาที่อื่น'),row('G','','สาขาก'),row('H','NE11','')];
const plain=x=>JSON.parse(JSON.stringify(x));
function block(name){const a=staged.indexOf((staged.includes('async function '+name+'(')?'async ':'')+'function '+name+'('),b=staged.indexOf('\n}\n',a)+2;assert.ok(a>=0&&b>a,name);return staged.slice(a,b);}
function harness(all=fixtures,{runtime=true,sourceValid=true,fault=null}={}){
 const nodes=new Map(),order=['pno-v18-summary'];
 function node(id){if(!nodes.has(id))nodes.set(id,make(id));return nodes.get(id);}
 function make(id=''){const classes=new Set();return {id,innerHTML:'',textContent:'',hidden:false,classList:{contains:x=>classes.has(x),add:x=>classes.add(x),remove:x=>classes.delete(x)},setAttribute(){},insertAdjacentElement(where,e){assert.equal(where,'afterend');nodes.set(e.id,e);order.splice(order.indexOf(id)+1,0,e.id);},append(e){nodes.set(e.id,e);}};}
 const source={id:'ROUTE-NE11',hub:'NE11',proofId:'SYNTHETIC_PROOF',pnoSourceDay:'2026-10-13',pnoLineId:'LINE-A',pnoStoreId:'SOURCE',pnoNextStoreId:'NEXT',expectedParcels:10000,enteredParcels:200,pendingParcels:9800};
 const pno={sourceRow:source,proofId:source.proofId,day:source.pnoSourceDay,routeName:'เที่ยวทดสอบ',selection:null,segmentSignature:'',type:'total',total:all.length,rows:all.slice(0,200),filters:{status:'',action:'',hub:'',branch:''},filterRows:null,filterKey:'',filterPage:1,filterForce:false,filterError:'',filterProgress:'',force:false};
 const calls=[];
 const context=vm.createContext({state:{branch:'NE11',currentRows:[source],rows:[],archiveRows:[]},pnoV18State:pno,nf:new Intl.NumberFormat('th-TH'),
  el:id=>id.startsWith('pno-destination-summary')?(nodes.get(id)||null):node(id),document:{createElement:()=>make(),head:make()},esc:x=>String(x),pnoV18Number:x=>Number.isFinite(Number(x))?Number(x):null,
  pnoOperationalRawSummary:r=>({expected:r.expectedParcels,entered:r.enteredParcels,pending:r.pendingParcels}),
  pnoV18ParcelStatus:r=>r.status,pnoV18ParcelAction:r=>r.lastAction,
  pnoV18RenderFilters(){},pnoV18RenderCurrentFilteredView(){},pnoV18SetActive(){},resetPendingParcelModal(){},pnoV18OpenMulti:async()=>{},render(){},
  pnoV18Fetch:async(type,page)=>{calls.push([type,page]);if(fault==='throw')throw Error('SYNTHETIC_PAGE_ERROR');const start=(page-1)*200;const result={sourceValid,sourceCountMismatch:fault==='mismatch',total:all.length,page,parcels:all.slice(start,start+200)};if(fault==='omit-valid')delete result.sourceValid;return result;}});
 for(const n of ['pnoV18SourceRow','pnoV18LocatorKey','pnoV18FilteredParcelEntries','pnoV18EnsureParcelFilterRows','pnoV18RenderSummary','pnoV18FilterSummaryText','pnoV18DisplayBranch'])vm.runInContext(block(n),context);
 if(runtime){const a=staged.indexOf('// PNO_DESTINATION_SUMMARY_REV73:'),start=staged.indexOf('(function pnoDestinationRuntime',a),end=staged.indexOf('\n})();',start)+6;assert.ok(start>a&&end>start);vm.runInContext(staged.slice(a,end),context);}
 return {context,pno,calls,nodes,order,node,async complete(){await context.pnoV18EnsureParcelFilterRows();context.pnoV18RenderCurrentFilteredView();},html(){context.pnoV18RenderSummary();return node('pno-destination-summary').innerHTML;}};
}

test('NE11: every own branch plus every external HUB and unclassified reconcile',()=>{const a=aggregate(fixtures,'NE11');assert.equal(a.status,'COMPLETE');assert.deepEqual(a.own.map(x=>[x.identity,x.count]),[['(TH1001)สาขาก',2],['สาขาข',1]]);assert.deepEqual(a.other.map(x=>[x.identity,x.count]),[['E1',2],['NE12',1]]);assert.equal(a.ownTotal+a.otherTotal+a.unclassified,a.total);assert.equal(a.total,8);});
test('E1: own branches change, NE11 becomes external without disappearing',()=>{const a=aggregate(fixtures,'E1');assert.equal(a.ownTotal,2);assert.equal(a.own[0].label,'สาขาตะวันออก');assert.equal(a.other.find(x=>x.identity==='NE11').count,4);assert.equal(a.unclassified,1);assert.equal(a.total,8);});
test('HUB identity uses destination code only, NE1 does not match NE11',()=>{assert.equal(aggregate([row('P','NE11','หนึ่ง')],'NE1').otherTotal,1);assert.equal(pnoDestinationHub('21 BPL_BHUB-บางพลี').code,'BPL');for(const value of ['',null,{},'UNKNOWN','สาขา NE11','NE11-extra'])assert.equal(pnoDestinationHub(value),null);});
test('never use next-store or operational fallback to classify unknown destination',()=>{const a=aggregate([row('A','','สาขา',{nextStoreName:'NE11',operationalMatchHub:'NE11'})],'NE11');assert.equal(a.unclassified,1);assert.equal(a.ownTotal,0);});
test('descending counts and Thai-aware deterministic ties',()=>{const a=aggregate([row('1','NE11','ข'),row('2','NE11','ก'),row('3','NE11','มาก'),row('4','NE11','มาก'),row('5','NE12','x'),row('6','E1','y')],'NE11');assert.equal(a.own[0].label,'มาก');assert.deepEqual(a.own.slice(1).map(x=>x.label),['ก','ข']);assert.deepEqual(a.other.map(x=>x.identity),['E1','NE12']);});
test('display cleanup is cosmetic, retains raw filter identity and distinct branches',()=>{const a=aggregate([row('A','NE11','(TH1001)ชื่อเดียว'),row('B','NE11','(TH1002)ชื่อเดียว')],'NE11');assert.equal(a.own.length,2);assert.notEqual(a.own[0].label,a.own[1].label);assert.equal(pnoDestinationDisplayBranch('(TH1001)สาขาไทย'),'สาขาไทย');assert.equal(pnoDestinationDisplayBranch('สาขา(ข้อมูลวงเล็บ)'),'สาขา(ข้อมูลวงเล็บ)');assert.equal(pnoDestinationDisplayBranch('(OTHER)สาขา'),'(OTHER)สาขา');});
test('one source list row is one parcel; do not multiply bags or invented quantities',()=>{const a=aggregate([row('A','NE11','ก',{quantity:99,parcel_count:100,backingNo:'BAG'}),row('B','NE11','ก',{quantity:0})],'NE11');assert.equal(a.total,2);assert.equal(a.ownTotal,2);});
test('pure aggregation never deduplicates distinct occurrences by PNO alone',()=>{assert.equal(aggregate([row('SAME','NE11','ก',{occurrence:'A'}),row('SAME','NE11','ก',{occurrence:'B'})],'NE11').ownTotal,2);});
test('incomplete/malformed inputs never fabricate exact zero',()=>{for(const a of [aggregate([],null),aggregate(null,'NE11'),aggregate([], 'NE11',false),aggregate([null],'NE11'),aggregate([{targetHub:'NE11'}],'NE11')])assert.equal(a.total,null);assert.equal(aggregate([],'NE11').total,0);});
test('markup has two separate sections, unknown row and exact subtotal accounting',()=>{const html=pnoDestinationMarkup(aggregate(fixtures,'NE11'),'scope');assert.match(html,/สาขาปลายทางใน HUB ของเรา · NE11/);assert.match(html,/ฮับปลายทางอื่น/);assert.match(html,/รวมส่งสาขาภายใน NE11/);assert.match(html,/รวมฮับปลายทางอื่น/);assert.match(html,/ไม่สามารถจำแนกปลายทางได้/);assert.match(html,/8 ชิ้น/);});
test('safe escaped Thai/HTML display; no provider value executes as markup',()=>{const h=pnoDestinationMarkup(aggregate([row('A','NE11','<img onerror="secret">')],'NE11'),'<script>');assert.doesNotMatch(h,/<img|<script>/);assert.match(h,/&lt;img/);});
test('composed patch idempotent and existing card/all-page/filter functions intact',()=>{assert.equal(stageFrontend(staged),staged);assert.equal(patchPnoDestinationSummary(staged),staged);const baselineHashes={"pnoV18EnsureParcelFilterRows": "8e3e3d5022c306feae2c9dae72d73b8c03078b423b481b67c80bf9fd366b6e15", "pnoV18FilteredParcelEntries": "0d08868877aa1dc82e9223c6717471d9b2b205e95a87a1e536f2bf9275f23786", "pnoV18RenderSummary": "fe995976ea4713db0ce1cbfcb9e4c2265b1b9baa024aae9280bbd1ffc291b15b"};for(const [n,sha] of Object.entries(baselineHashes))assert.equal(createHash('sha256').update(block(n)).digest('hex'),sha,n);assert.equal(createHash('sha256').update(block('pnoV18RenderFilters')).digest('hex'),'36638dca1f713958cfb2403a2127ba519dee947dbaef7399c15c1c3edc8c7fae','REV86 member-first four-selector contract; separate changed-function lock');assert.doesNotThrow(()=>new Function(staged));});
test('DEV summary release uses an exact distinct version; canonical HTML remains unchanged',()=>{const html=fs.readFileSync(new URL('../../ms.html',import.meta.url),'utf8');assert.match(patchDevUiShellSource(html,'ms.html'),/ms\.js\?v=20261014-rev98-pno-only-delivery-v1/);assert.doesNotMatch(html,/pno-destination-summary-rev73/);});
test('CSS provides mobile stacking, stable numeric columns and comfortable fonts',()=>{assert.match(PNO_DESTINATION_STYLE,/max-width:640px/);assert.match(PNO_DESTINATION_STYLE,/grid-template-columns:1fr/);assert.match(PNO_DESTINATION_STYLE,/minmax\(0,1fr\) auto/);assert.match(PNO_DESTINATION_STYLE,/tabular-nums/);assert.match(PNO_DESTINATION_STYLE,/font-size:18px/);});
test('actual runtime: summary directly after count card, denominator stays PreEntry',async()=>{const h=harness();h.context.pnoV18RenderSummary();const card=h.node('pno-v18-summary').innerHTML;await h.complete();assert.equal(h.node('pno-v18-summary').innerHTML,card);assert.deepEqual(h.order.slice(0,2),['pno-v18-summary','pno-destination-summary']);assert.match(h.html(),/ยอดนี้แยกจากยอด PreEntry/);assert.match(h.html(),/8 ชิ้น/);assert.match(card,/10,000/);});
test('actual original all-page pipeline: 4,205 rows over 22 pages, no acquisition added',async()=>{const all=Array.from({length:4205},(_,i)=>row('P'+i,i%2?'E1':'NE11','สาขาก'));const plainHarness=harness(all,{runtime:false}),h=harness(all);await plainHarness.complete();await h.complete();assert.deepEqual(h.calls,plainHarness.calls);assert.equal(h.calls.length,22);assert.match(h.html(),/4,205 ชิ้น/);assert.equal(h.pno.filterRows.length,4205);});
test('global status/branch/HUB filters use all rows, not visible page; raw values survive',async()=>{const h=harness();await h.complete();const optionsBefore=fixtures.map(x=>x.targetBranch);h.pno.filters.hub='NE11';h.pno.filters.branch='(TH1001)สาขาก';h.context.pnoV18RenderCurrentFilteredView();assert.match(h.html(),/1 ชิ้น/);h.pno.filters.hub='';h.context.pnoV18RenderCurrentFilteredView();assert.match(h.html(),/2 ชิ้น/);assert.deepEqual(fixtures.map(x=>x.targetBranch),optionsBefore);assert.equal(h.calls.length,1);h.pno.filters.branch='';h.pno.filters.hub='';h.pno.filters.status='not-present';assert.match(h.html(),/0 ชิ้น/);assert.equal(h.calls.length,1);});
test('HUB switch has no stale totals and same dataset regrouping is dynamic',async()=>{const h=harness();await h.complete();h.context.state.branch='E1';h.context.render();assert.doesNotMatch(h.node('pno-destination-summary').innerHTML,/รวมส่งสาขาภายใน NE11/);assert.match(h.node('pno-destination-summary').innerHTML,/ยังไม่แสดงยอด/);h.pno.filterRows=null;h.pno.filterKey='';await h.complete();const html=h.html();assert.match(html,/สาขาปลายทางใน HUB ของเรา · E1/);assert.match(html,/NE11/);});
test('trip/day/line/category changes invalidate old coverage; no PNO-only cross-occurrence match',async()=>{const h=harness();await h.complete();h.pno.sourceRow={...h.pno.sourceRow,id:'NEW',pnoLineId:'LINE-B'};h.context.state.currentRows=[];h.context.render();assert.match(h.html(),/ยังไม่แสดงยอด/);h.pno.type='already';assert.match(h.html(),/ยังไม่แสดงยอด/);});
test('missing/invalid source flag or count mismatch withholds exact totals',async()=>{for(const options of [{sourceValid:false},{fault:'mismatch'}]){const h=harness(fixtures,options);await h.complete();assert.match(h.html(),/ข้อมูลต้นทางไม่สมบูรณ์/);assert.doesNotMatch(h.html(),/รวมฮับปลายทางอื่น/);}});
test('loading/error/incomplete states, no partial-page totals or hidden zeros',async()=>{const h=harness(Array.from({length:250},(_,i)=>row('P'+i,'NE11','ก')));assert.match(h.html(),/กำลังเตรียมข้อมูลทุกหน้า/);h.pno.filterError='incomplete';assert.match(h.html(),/ข้อมูลปลายทางไม่ครบ/);h.pno.filterError='';h.pno.filterRows=fixtures;h.pno.filterKey=h.context.pnoV18LocatorKey(h.pno.sourceRow)+'|total';assert.match(h.html(),/ยังไม่แสดงยอด/);});
test('cross-page overlap is rejected by existing pipeline, never silently deduplicated',async()=>{const all=Array.from({length:201},(_,i)=>row(i===200?'P0':'P'+i,'NE11','ก'));const h=harness(all);await assert.rejects(h.complete());assert.equal(h.pno.filterRows,null);assert.doesNotMatch(h.html(),/รวมส่งสาขาภายใน/);});
test('scan-gap category and existing filters remain authoritative',async()=>{const all=fixtures.map((r,i)=>({...r,scanEvidence:{classification:i===0?'SUSPECTED_SCAN_IN_GAP':'CONFIRMED_SCAN_IN'}}));const h=harness(all);h.pno.type='scan_gap';await h.complete();assert.match(h.html(),/รายการตรวจสแกนเข้า/);assert.match(h.html(),/1 ชิ้น/);assert.equal(h.calls[0][0],'total');});
test('bag view is explicitly outside package-list summary, no extra fetch',async()=>{const h=harness();await h.complete();const n=h.calls.length;h.pno.type='bag';assert.match(h.html(),/เลือกแท็บรายการพัสดุ/);assert.equal(h.calls.length,n);});
test('observer/render failures cannot alter existing fetch value or throw semantics',async()=>{const h=harness();h.context.document.createElement=()=>{throw Error('SYNTHETIC_UI_ERROR')};const r=await h.context.pnoV18Fetch('total',1);assert.equal(r.total,8);assert.equal(h.calls.length,1);const bad=harness(fixtures,{fault:'throw'});await assert.rejects(bad.context.pnoV18Fetch('total',1),/SYNTHETIC_PAGE_ERROR/);assert.equal(bad.calls.length,1);});
test('reset clears retained summary evidence, current-source network behavior unchanged',async()=>{const h=harness();await h.complete();h.context.resetPendingParcelModal();assert.match(h.html(),/ยังไม่แสดงยอด/);assert.equal(h.calls.length,1);});
test('no new endpoint, timer, fetch API, polling or all-page button introduced',()=>{const added=staged.slice(staged.indexOf('// PNO_DESTINATION_SUMMARY_REV73:'));const runtime=added.slice(0,added.indexOf('\n})();')+6);assert.doesNotMatch(runtime,/\bfetch\s*\(|setInterval\s*\(|setTimeout\s*\(|XMLHttpRequest|\.DB\.|\/api\?/);assert.doesNotMatch(runtime,/เลือกเพื่อรวมข้อมูลทุกหน้า|onclick|<button/);});
test('selected segment, union and chooser retain exact scope without hidden stale totals',async()=>{const h=harness();await h.complete();h.pno.sourceRow.pnoSegments=[{...h.pno.sourceRow},{...h.pno.sourceRow,pnoNextStoreId:'DROP-2'}];h.pno.selection=1;h.pno.segmentSignature='changed';assert.match(h.html(),/ยังไม่แสดงยอด/);h.pno.filterRows=null;h.pno.filterKey='';await h.complete();assert.match(h.html(),/จุดส่ง 2/);h.pno.selection='union';assert.match(h.html(),/ยังไม่แสดงยอด/);h.pno.filterRows=null;h.pno.filterKey='';await h.complete();assert.match(h.html(),/รวมจุดส่งทั้งคัน/);h.node('pno-v18-summary').classList.add('hidden');h.context.render();assert.equal(h.node('pno-destination-summary').hidden,true);});
test('accepted all-page cache reused on filter changes without repeated page requests',async()=>{const h=harness(Array.from({length:501},(_,i)=>row('P'+i,i%3?'NE11':'E1','สาขาก')));await h.complete();const n=h.calls.length;h.pno.filters.action='รับ';await h.complete();assert.equal(h.calls.length,n);assert.match(h.html(),/501 ชิ้น/);});
test('all external HUBs are retained, never silently capped by display or current HUB',()=>{const rows=Array.from({length:36},(_,i)=>row('P'+i,'H'+i,'สาขา'+i));const a=aggregate(rows,'NE11');assert.equal(a.other.length,36);assert.equal(a.otherTotal,36);assert.equal(a.total,36);});
test('complete empty provider dataset is authoritative zero, not an incomplete page',async()=>{const h=harness([]);await h.complete();assert.match(h.html(),/รวมพัสดุตามขอบเขตและตัวกรองนี้ <b>0 ชิ้น/);assert.equal(h.calls.length,1);});
test('missing optional source-valid metadata fails closed without changing returned data',async()=>{const h=harness(fixtures,{fault:'omit-valid'});await h.complete();assert.match(h.html(),/ข้อมูลต้นทางไม่สมบูรณ์/);assert.doesNotMatch(h.html(),/รวมฮับปลายทางอื่น/);assert.equal(h.calls.length,1);});

// REV74: publication preparation verifies the actual DEV delivery checks;
// all requests below are synthetic VM calls, never live transport.
const releaseScript='ms.js?v=20261014-rev98-pno-only-delivery-v1';
const workflowSource=fs.readFileSync(new URL('../workflows/deploy-worker-dev.yml',import.meta.url),'utf8');
const serviceWorkerSource=fs.readFileSync(new URL('../../sw.js',import.meta.url),'utf8');
// REV98: smoke must validate the actual two-stage delivered file, not only stageFrontend().
function composeDelivery(){
 const root=path.resolve(import.meta.dirname,'../..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'rev98-delivery-'));
 try {
  for(const name of fs.readdirSync(root))if(/\.(?:html|js|css|svg)$/.test(name))fs.copyFileSync(path.join(root,name),path.join(temp,name));
  fs.cpSync(path.join(root,'worker/src'),path.join(temp,'src'),{recursive:true});
  execFileSync(process.execPath,[path.join(root,'.github/dev-tools/stage-dev-runtime.mjs'),path.join(temp,'ms.js'),path.join(temp,'src/index.js')],{stdio:'pipe'});
  execFileSync(process.execPath,[path.join(root,'.github/dev-tools/patch-dev-origin-manifest-session-v2.mjs'),path.join(temp,'ms.js'),path.join(temp,'src/origin-manifest-v1.js')],{stdio:'pipe'});
  return fs.readFileSync(path.join(temp,'ms.js'),'utf8');
 } finally {fs.rmSync(temp,{recursive:true,force:true});}
}
const delivered=composeDelivery();
function releaseSmoke(){
 const start=workflowSource.indexOf("          const msScript='");
 const end=workflowSource.indexOf("\n          if(!ms.includes('การเชื่อมต่อ MS",start);
 const feature=workflowSource.split('\n').find(line=>line.includes("throw new Error('live PNO destination summary implementation missing')"));
 assert.ok(start>=0&&end>start&&feature,'actual workflow smoke checks exist');
 const compiled=new Function('ms','get','createHash','return (async()=>{'+workflowSource.slice(start,end)+'\nreturn msJs;})();');
 return (ms,get)=>compiled(ms,get,createHash);
}
function serviceWorkerHarness(rejectFirst=false){
 const handlers={},calls=[];
 vm.runInNewContext(serviceWorkerSource,{self:{addEventListener:(n,fn)=>{handlers[n]=fn},skipWaiting(){},clients:{claim(){}}},location:{origin:'https://offline.invalid'},URL,
  fetch:async(...args)=>{calls.push(args);if(rejectFirst&&calls.length===1)throw Error('SYNTHETIC_NETWORK_FAILURE');return {synthetic:true};}});
 return {handlers,calls};
}
test('REV74 release changes only DEV script reference; old aliases and canonical Production stay separate',()=>{
 const canonical=fs.readFileSync(new URL('../../ms.html',import.meta.url),'utf8');
 const dev=patchDevUiShellSource(canonical,'ms.html');
 assert.ok(dev.includes('src="'+releaseScript+'"'));
 assert.equal((dev.match(/src="ms\.js\?v=/g)||[]).length,1);
 assert.doesNotMatch(dev,/src="ms\.js\?v=20261009-ms-route-source-page-timing-v1/);
 assert.doesNotMatch(canonical,/pno-destination-summary-rev74/);
 const historical=canonical.replace(/src="ms\.js\?[^"]*"/,'src="ms.js?v=20261009-ms-route-source-page-timing-v1"');
 assert.ok(patchDevUiShellSource(historical,'ms.html').includes('src="'+releaseScript+'"'));
 assert.ok(workflowSource.includes("const msScript='"+releaseScript+"';"));
});
test('REV74 actual smoke fragment gets exactly versioned asset and validates summary code',async()=>{
 const calls=[],html=patchDevUiShellSource(fs.readFileSync(new URL('../../ms.html',import.meta.url),'utf8'),'ms.html');
 const result=await releaseSmoke()(html,async name=>{calls.push(name);return delivered;});
 assert.equal(result,delivered);assert.deepEqual(calls,[releaseScript]);
});
test('REV74 smoke fails closed on old HTML and missing summary implementation',async()=>{
 const smoke=releaseSmoke();let calls=0;
 await assert.rejects(smoke('<script src="ms.js?v=20261009-ms-route-source-page-timing-v1"></script>',async()=>{calls++;return delivered;}),/script URL missing/);
 assert.equal(calls,0);
 for(const missing of ['// PNO_DESTINATION_SUMMARY_REV73:','function pnoDestinationAggregate(',"card.insertAdjacentElement('afterend', panel)"])
  await assert.rejects(smoke('<script src="'+releaseScript+'"></script>',async()=>delivered.replace(missing,'REMOVED_FOR_TEST')),/implementation missing/);
});
const deliveryHtml='<script src="'+releaseScript+'"></script>';
test('REV98 unique version and full actual composed bytes match strict local predeploy/postdeploy digests',()=>{
 const hash=createHash('sha256').update(delivered,'utf8').digest('hex');
 assert.equal(hash,'7866a1b31de1f6bce79e24a488a0a0fe1fc25c9efe3eb4ae9f889d37cc351ea4');
 assert.equal((workflowSource.match(new RegExp(hash,'g'))||[]).length,2);
 assert.match(workflowSource,/staged PNO isolated asset integrity mismatch/);
 assert.match(workflowSource,/live PNO isolated asset integrity mismatch/);
 assert.ok(workflowSource.indexOf('staged PNO isolated asset integrity mismatch')<workflowSource.indexOf('npx wrangler deploy'));
});
test('REV98 missing script URL fails before any asset fetch',async()=>{
 let calls=0;await assert.rejects(releaseSmoke()('<html>no script</html>',async()=>{calls++;return delivered;}),/script URL missing/);assert.equal(calls,0);
});
test('REV98 prior combined URL is rejected even with the correct isolated body',async()=>{
 let calls=0;await assert.rejects(releaseSmoke()('<script src="ms.js?v=20261014-rev89-pno-contract-closure"></script>',async()=>{calls++;return delivered;}),/script URL missing/);assert.equal(calls,0);
});
test('REV98 wrong fetched asset retaining every PNO marker is rejected with exactly one request',async()=>{
 let calls=0;await assert.rejects(releaseSmoke()(deliveryHtml,async name=>{assert.equal(name,releaseScript);calls++;return delivered+'\n// WRONG_FETCHED_ASSET';}),/asset integrity mismatch/);assert.equal(calls,1);
});
test('REV98 modified implementation with all markers retained cannot pass',async()=>{
 const bad=delivered.replace('own.get(branch).count++; ownTotal++;','own.get(branch).count++; ownTotal+=2;');assert.notEqual(bad,delivered);
 await assert.rejects(releaseSmoke()(deliveryHtml,async()=>bad),/asset integrity mismatch/);
});
test('REV98 incomplete implementation retaining marker/function/placement is rejected',async()=>{
 const bad=delivered.replace('group.count++; otherTotal++;','/* INCOMPLETE_OTHER_HUB_COUNT */');assert.notEqual(bad,delivered);
 await assert.rejects(releaseSmoke()(deliveryHtml,async()=>bad),/asset integrity mismatch/);
});
test('REV98 stageFrontend-only asset is rejected; full CLI composition is mandatory',async()=>{
 assert.notEqual(staged,delivered);await assert.rejects(releaseSmoke()(deliveryHtml,async()=>staged),/asset integrity mismatch/);
});
test('REV74 real service worker preserves release version and no-store request contract',async()=>{
 const h=serviceWorkerHarness(),request={url:'https://offline.invalid/'+releaseScript,method:'GET',credentials:'same-origin',headers:{synthetic:'only'}};let pending;
 h.handlers.fetch({request,respondWith:value=>{pending=value;}});await pending;
 assert.equal(h.calls.length,1);const [url,options]=h.calls[0];
 assert.equal(new URL(url).searchParams.get('v'),'20261014-rev98-pno-only-delivery-v1');
 assert.equal(new URL(url).searchParams.get('__fresh'),'20260911-02-mobile-schedule-status');
 assert.equal(options.cache,'no-store');assert.equal(options.credentials,request.credentials);assert.equal(options.headers,request.headers);
});
test('REV74 unchanged SW fallback retains exact release request, ignores other origins and POST',async()=>{
 const h=serviceWorkerHarness(true),request={url:'https://offline.invalid/'+releaseScript,method:'GET',credentials:'same-origin',headers:{}};let pending;
 h.handlers.fetch({request,respondWith:value=>{pending=value;}});await pending;
 assert.equal(h.calls.length,2);assert.equal(h.calls[1][0],request);
 const inert=serviceWorkerHarness();
 for(const request of [{url:'https://other.invalid/'+releaseScript,method:'GET'},{url:'https://offline.invalid/'+releaseScript,method:'POST'}])
  inert.handlers.fetch({request,respondWith(){assert.fail('noneligible request intercepted');}});
 assert.equal(inert.calls.length,0);
});
test('REV74 preserves exact reviewed feature bytes and mandatory diagnostic smoke guards',()=>{
 const patch=fs.readFileSync(new URL('./patch-pno-destination-summary-rev73.mjs',import.meta.url));
 assert.equal(createHash('sha256').update(patch).digest('hex'),'422f2c4bdf7c9940f9b11649645253e5ccdf1495e7a5f25d8f0a2fa212383da3');
 assert.ok(staged.includes('PNO_SEGMENT_DESTINATION_FRONTEND_V1'));
 for(const marker of ['MS_TURSO_CRITICAL_PATH_PHASE_V1_FRONTEND','MS_ROUTE_SOURCE_PAGE_TIMING_V1_FRONTEND','MS_TURSO_LATE_SETTLE_V1_FRONTEND','criticalPath: criticalPath.snapshot()','routeSourceTiming: currentMsRouteSourceTiming()','lateSettle:'])assert.ok(workflowSource.includes(marker));
});
