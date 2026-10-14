import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stageFrontend} from './stage-dev-runtime.mjs';
import {PNO_MOBILE_MODAL_STYLE, patchPnoMobileModalScope} from './patch-pno-mobile-modal-scope-v1.mjs';
const canonical=fs.readFileSync(new URL('../../ms.js',import.meta.url),'utf8');
const staged=stageFrontend(canonical);
function harness(){
  const dialog={open:false};let liveRow=null;const appended=[];const sources=[];
  const pno={sourceRow:null,proofId:'',type:'total'};
  const app={branch:'NE1'};
  const ctx=vm.createContext({
    pnoV18State:pno,state:app,el(id){return id==='pending-parcels-dialog'?dialog:null},
    pnoV18SourceRow(){return liveRow},
    pnoV18LocatorKey(row){return [app.branch,row?.proofId,row?.enteredParcels,row?.pendingParcels].join('|')},
    pnoDestinationMarkup(){return '<table>verified</table>'},
    openPendingParcels(row){sources.push(row);pno.sourceRow=row;pno.proofId=row.proofId;dialog.open=true;return Promise.resolve(true)},
    document:{getElementById(){return null},createElement(){return {id:'',textContent:''}},head:{append(n){appended.push(n)}}},
  });
  const start=staged.indexOf('(function pnoMobileModalScopeV1(){');
  assert.ok(start>0);
  const block=staged.slice(start,staged.indexOf('\n})();',start)+6);
  vm.runInContext('const PNO_MOBILE_MODAL_SCOPE_STYLE = '+JSON.stringify(PNO_MOBILE_MODAL_STYLE)+';'+block,ctx);
  return{ctx,pno,app,dialog,sources,appended,setLive(row){liveRow=row}};
}
test('staged guard is idempotent and does not alter canonical page, APIs or Worker',()=>{
  assert.equal(stageFrontend(staged),staged);
  assert.equal(patchPnoMobileModalScope(staged),staged);
  assert.equal((staged.match(/PNO_MOBILE_MODAL_SCOPE_V1: applied/g)||[]).length,1);
  new Function(staged);
  assert.doesNotMatch(PNO_MOBILE_MODAL_STYLE,/fetch\(|setInterval|XMLHttpRequest|sql/i);
});
test('mobile layout uses one stacked filter column, full-width selects and unbroken buttons',()=>{
  assert.match(PNO_MOBILE_MODAL_STYLE,/max-width:720px/);
  assert.match(PNO_MOBILE_MODAL_STYLE,/pno-v18-filterbar:not\(\.hidden\).*grid-template-columns:minmax\(0,1fr\)/);
  assert.doesNotMatch(PNO_MOBILE_MODAL_STYLE,/pno-v18-branch-search/);
  assert.match(PNO_MOBILE_MODAL_STYLE,/min-width:1020px/);
  assert.match(PNO_MOBILE_MODAL_STYLE,/min-width:721px/);
  assert.match(PNO_MOBILE_MODAL_STYLE,/max-width:none!important/);
  assert.match(PNO_MOBILE_MODAL_STYLE,/pno-v18-filter-reset\{grid-column:1\/-1/);
  assert.match(PNO_MOBILE_MODAL_STYLE,/pno-v18-actions.*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(PNO_MOBILE_MODAL_STYLE,/max-width:380px/);
});
test('same opened occurrence remains pinned across live-row count updates, without another request',async()=>{
  const h=harness(),old={proofId:'PROOF_A',enteredParcels:1190,pendingParcels:1386,expectedParcels:2576};
  h.setLive(old);await h.ctx.openPendingParcels(old);
  assert.equal(h.ctx.pnoV18SourceRow().enteredParcels,1190);
  old.enteredParcels=1195; // even in-place background mutation must not clear shown data
  h.setLive({...old});
  assert.equal(h.ctx.pnoV18SourceRow().enteredParcels,1190);
  assert.equal(h.sources.length,1);
  assert.equal(h.appended.length,1);
  h.dialog.open=false;
  assert.equal(h.ctx.pnoV18SourceRow().enteredParcels,1195);
});
test('changed live counts retain verified table with explicit non-live label',async()=>{
 const h=harness();const old={proofId:'A',pnoSourceDay:'2026-10-15',pnoLineId:'L1',pnoStoreId:'S',pnoNextStoreId:'NEXT',enteredParcels:1190,pendingParcels:1386};
 h.setLive(old);await h.ctx.openPendingParcels(old);
 const summary={status:'COMPLETE'};
 assert.equal(h.ctx.pnoDestinationMarkup(summary,'scope',''),'<table>verified</table>');
 h.setLive({...old,enteredParcels:1191,pendingParcels:1385});
 const output=h.ctx.pnoDestinationMarkup(summary,'scope','');
 assert.match(output,/verified<\/table>/);
 assert.match(output,/ยอดรถในตารางหลักเปลี่ยนแล้ว/);
 assert.match(output,/เปิดรายการอีกครั้ง/);
});
test('hub switch cannot reuse previous occurrence; reopening uses new row only',async()=>{
  const h=harness();await h.ctx.openPendingParcels({proofId:'A',enteredParcels:1});
  h.app.branch='E1';h.setLive({proofId:'E',enteredParcels:25});
  assert.equal(h.ctx.pnoV18SourceRow().enteredParcels,25);
  await h.ctx.openPendingParcels({proofId:'E',enteredParcels:25});
  assert.equal(h.ctx.pnoV18SourceRow().enteredParcels,25);
});
test('missing optional modal script remains inert for independent diagnostic harness',()=>{
 const start=staged.indexOf('(function pnoMobileModalScopeV1(){');const script=staged.slice(start,staged.indexOf('\n})();',start)+6);
 const ctx=vm.createContext({});assert.doesNotThrow(()=>vm.runInContext(script,ctx));
});
