import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import {stageFrontend} from './stage-dev-runtime.mjs';
import {pnoDestinationAggregate} from './patch-pno-destination-summary-rev73.mjs';
import {pnoDestinationTableMarkup, PNO_DESTINATION_UX_STYLE, patchPnoDestinationTablesStability} from './patch-pno-destination-tables-stability-v1.mjs';
const raw=fs.readFileSync(new URL('../../ms.js',import.meta.url),'utf8');
const staged=stageFrontend(raw);
function dataset(n=8){return Array.from({length:n},(_,i)=>({pno:'PNO'+i,targetHub:i%3===0?'E1':'NE11',targetBranch:i%2?'(TH1199)สาขาบี':'(TH1100)สาขาเอ',status:'รอ',lastAction:'รับ'}));}
function harness(all=dataset()){
 const nodes=new Map(),writes=new Map(),calls=[];
 function make(id=''){let html='';const flags=new Set();return {id,get innerHTML(){return html},set innerHTML(v){writes.set(id,(writes.get(id)||0)+1);html=v},hidden:false,textContent:'',classList:{contains:x=>flags.has(x),add:x=>flags.add(x),remove:x=>flags.delete(x)},setAttribute(){},insertAdjacentElement(w,e){nodes.set(e.id,e)},append(e){nodes.set(e.id,e)}};}
 function el(id){if(id==='pno-destination-summary'||id==='pno-destination-summary-style')return nodes.get(id)||null; if(!nodes.has(id))nodes.set(id,make(id));return nodes.get(id);}
 el('pno-v18-summary');
 const row={id:'SYNTHETIC',proofId:'PROOF',pnoSourceDay:'2026-10-14',pnoLineId:'L1',pnoStoreId:'S',pnoNextStoreId:'NEXT',expectedParcels:2803,enteredParcels:1800,pendingParcels:1003};
 const pno={sourceRow:row,type:'total',proofId:row.proofId,day:row.pnoSourceDay,routeName:'ROUTE',total:all.length,rows:all.slice(0,200),filters:{status:'',action:'',hub:'',branch:''},filterRows:null,filterKey:'',filterForce:false,filterError:'',filterProgress:'',filterPromise:null,page:1,filterPage:1,selection:null,force:false};
 const ctx=vm.createContext({pnoV18State:pno,state:{branch:'NE11'},nf:new Intl.NumberFormat('th-TH'),el,document:{createElement:()=>make(),head:make('head')},
  pnoV18SourceRow:()=>pno.sourceRow,
  pnoV18FilterSummaryText:()=>pno.filters.hub||pno.filters.branch||'',
  pnoV18FilteredParcelEntries:(rows)=> (rows||pno.filterRows||pno.rows).filter(x=>!pno.filters.hub||x.targetHub===pno.filters.hub).map(item=>({item})),
  pnoV18RenderSummary(){},pnoV18RenderFilters(){},pnoV18RenderCurrentFilteredView(){},pnoV18SetActive(){},resetPendingParcelModal(){},pnoV18OpenMulti:async()=>{},render(){},
  pnoV18Fetch:async(type,page)=>{calls.push([type,page]);return {sourceValid:true,sourceCountMismatch:false,total:all.length,page,parcels:all.slice((page-1)*200,page*200)}}});
 const extract=(name)=>{const a=staged.indexOf('function '+name+'('),b=staged.indexOf('\n}\n',a)+2;assert.ok(a>=0&&b>a,name);return staged.slice(a,b)};
 vm.runInContext(extract('pnoV18LocatorKey'),ctx);
 const a=staged.indexOf('// PNO_DESTINATION_SUMMARY_REV73:'),b=staged.indexOf('\n})();',a)+6;
 assert.ok(a>=0&&b>a);vm.runInContext(staged.slice(a,b),ctx);
 return {ctx,pno,el,writes,calls,async load(){pno.filterKey=ctx.pnoV18LocatorKey(row)+'|total';for(let page=1;page<=Math.max(1,Math.ceil(all.length/200));page++){await ctx.pnoV18Fetch('total',page);}pno.filterRows=all;ctx.pnoV18RenderSummary();},html:()=>{ctx.pnoV18RenderSummary();return el('pno-destination-summary').innerHTML}};
}
test('both HUB and branch destinations are symmetric, ranked tabular rows with count and percentage',()=>{
 const s=pnoDestinationAggregate(dataset(), 'NE11');
 const html=pnoDestinationTableMarkup(s,'ขอบเขต');
 assert.equal((html.match(/<table class="pno-destination-table">/g)||[]).length,2);
 assert.equal((html.match(/<th scope="col">จำนวน \(ชิ้น\)<\/th>/g)||[]).length,2);
 assert.equal((html.match(/<th scope="col">สัดส่วน<\/th>/g)||[]).length,2);
 assert.match(html,/ฮับปลายทางอื่น/);assert.match(html,/สาขาปลายทางใน HUB ของเรา/);
 assert.match(html,/pno-destination-table-scroll/);assert.match(html,/รวมพัสดุตามขอบเขตและตัวกรองนี้/);
 assert.match(PNO_DESTINATION_UX_STYLE,/position:sticky/);assert.match(PNO_DESTINATION_UX_STYLE,/max-height:292px/);
 assert.match(PNO_DESTINATION_UX_STYLE,/max-width:820px/);
});
test('all 90 HUB groups and 150 branches remain present in markup, none truncated',()=>{
 const rows=Array.from({length:150},(_,i)=>({pno:'B'+i,targetHub:'NE11',targetBranch:'สาขา'+i})).concat(Array.from({length:90},(_,i)=>({pno:'H'+i,targetHub:'H'+i,targetBranch:'other'})));
 const result=pnoDestinationAggregate(rows,'NE11');
 const html=pnoDestinationTableMarkup(result,'full');
 assert.equal(result.own.length,150);assert.equal(result.other.length,90);
 assert.equal((html.match(/class="pno-destination-name"/g)||[]).length,240);
 assert.equal(result.ownTotal+result.otherTotal+result.unclassified,result.total);
});
test('HTML stays escaped and incomplete never fabricates counts',()=>{
 const bad=pnoDestinationAggregate([{pno:'x',targetHub:'NE11',targetBranch:'<img onerror="boom">'}],'NE11');
 const html=pnoDestinationTableMarkup(bad,'<script>');
 assert.doesNotMatch(html,/<img|<script>/);assert.match(html,/&lt;script&gt;/);
 const loading=pnoDestinationTableMarkup(pnoDestinationAggregate(null,'NE11',false),'scope','กำลังตรวจข้อมูล');
 assert.doesNotMatch(loading,/<table/);assert.match(loading,/กำลังตรวจข้อมูล/);
});
test('staged patch is idempotent, keeps all-page fetch and Worker runtime untouched',()=>{
 assert.equal(stageFrontend(staged),staged);
 assert.equal(patchPnoDestinationTablesStability(staged),staged);
 new Function(staged);
 assert.equal((staged.match(/function pnoDestinationMarkup\(/g)||[]).length,1);
 assert.match(staged,/if \(panel.innerHTML !== markup\) panel.innerHTML = markup/);
 assert.doesNotMatch(PNO_DESTINATION_UX_STYLE,/fetch\(|setInterval|SQL/);
});
test('same-scope redraw does not replace DOM or lose table scroll',async()=>{
 const h=harness();await h.load();const html=h.html();
 const writes=h.writes.get('pno-destination-summary');
 for(let i=0;i<20;i++)h.ctx.render();
 assert.equal(h.writes.get('pno-destination-summary'),writes);
 assert.equal(h.html(),html);
 assert.equal(h.calls.length,1);
});
test('temporary same-scope refresh keeps verified snapshot clearly labeled, no stale across filters',async()=>{
 const h=harness();await h.load();
 h.pno.filterRows=null;h.pno.filterForce=true;
 assert.match(h.html(),/ข้อมูลล่าสุดที่ยืนยันครบแล้ว/);
 assert.match(h.html(),/ไม่ใช่ยอดสด/);
 h.pno.filters.hub='E1';
 assert.doesNotMatch(h.html(),/ข้อมูลล่าสุดที่ยืนยันครบแล้ว/);
 assert.doesNotMatch(h.html(),/<table class="pno-destination-table">/);
 assert.equal(h.calls.length,1);
});
test('changed trip/count, invalid coverage, errors and modal reset never reuse prior totals',async()=>{
 const h=harness();await h.load();
 h.pno.sourceRow={...h.pno.sourceRow,enteredParcels:1801};
 assert.doesNotMatch(h.html(),/<table class="pno-destination-table">/);
 assert.match(h.html(),/เปิดรายการนี้ใหม่/);
 h.pno.sourceRow={...h.pno.sourceRow,enteredParcels:1800};
 h.pno.filterError='incomplete';assert.doesNotMatch(h.html(),/<table class="pno-destination-table">/);
 h.pno.filterError='';h.ctx.resetPendingParcelModal();
 assert.doesNotMatch(h.html(),/<table class="pno-destination-table">/);
});
