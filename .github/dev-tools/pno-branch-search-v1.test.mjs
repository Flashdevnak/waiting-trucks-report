import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stageFrontend} from './stage-dev-runtime.mjs';
const canonical=fs.readFileSync(new URL('../../ms.js',import.meta.url),'utf8');
const staged=stageFrontend(canonical);
test('only four native selectors; no branch search input, count field or search listener',()=>{
  assert.doesNotMatch(staged,/PNO_BRANCH_SEARCH_V1: searchable|id="pno-v18-branch-search"|id="pno-v18-branch-count"|branchSearchQuery/);
  assert.match(staged,/pno-v18-filter-/);
  assert.equal(stageFrontend(staged),staged);
  assert.doesNotThrow(()=>new Function(staged));
});
test('all 170 branches remain selectable, scoped by selected HUB; raw values unchanged',()=>{
 const start=staged.indexOf('function pnoV18RenderFilters() {'),end=staged.indexOf('\n}\n',start)+2;
 assert.ok(start>=0&&end>start);
 const fn=staged.slice(start,end);
 const sel=new Map(['status','action','hub','branch'].map(k=>[k,{dataset:{pnoV18Filter:k},value:'',innerHTML:''}]));
 const bar={innerHTML:'',classList:{remove(){}},querySelectorAll(){return Array.from(sel.values())}};
 const reset={onclick:null};
 const elements={'pno-v18-filterbar':bar,'pno-v18-filter-result':{textContent:''},'pno-v18-filter-reset':reset};
 let updates=0;
 const own=Array.from({length:170},(_,i)=>({targetHub:'NE1',targetBranch:'(TH'+(1000+i)+') B'+String(i+1).padStart(3,'0')+'_BDC-สาขา '+(i+1),status:'รอ',lastAction:'รับ'}));
 const other={targetHub:'E1',targetBranch:'(THE1) OTHER_BDC-อีกฮับ',status:'รอ',lastAction:'รับ'};
 const pnoV18State={type:'total',filterRows:[...own,other],filterKey:'key|total',filterForce:false,filters:{status:'',action:'',hub:'NE1',branch:''},filterPage:2};
 const context={pnoV18State,el:k=>elements[k],pnoV18LocatorKey:()=> 'key',pnoV18SourceRow:()=>({}),pnoV18ParcelStatus:r=>r.status,pnoV18ParcelAction:r=>r.lastAction,
  pnoV18UniqueValues:xs=>[...new Set(xs)],pnoV18ValidateFilter:(v,arr)=>arr.includes(v)?v:'',
  pnoV18DisplayBranch:v=>String(v).replace(/^\(TH[^)]*\)\s*/i,''),esc:v=>String(v).replaceAll('&','&amp;').replaceAll('"','&quot;'),nf:new Intl.NumberFormat('th-TH'),
  pnoV18FilterOption:(v,selected)=>'<option value="'+v+'"'+(v===selected?' selected':'')+'>'+v+'</option>',pnoV18RenderCurrentFilteredView:()=>{updates++;}};
 vm.runInNewContext(fn+'\nthis.renderPNO=pnoV18RenderFilters',context);
 context.renderPNO();
 assert.match(bar.innerHTML,/B170_BDC-สาขา 170/);
 assert.doesNotMatch(bar.innerHTML,/OTHER_BDC-อีกฮับ/);
 assert.doesNotMatch(bar.innerHTML,/type="search"|branch-search|branch-count/);
 assert.equal((bar.innerHTML.match(/<option value="[^"]*B\d{3}_BDC-สาขา/g)||[]).length,170);
 sel.get('branch').value=own[169].targetBranch;sel.get('branch').onchange();
 assert.equal(pnoV18State.filters.branch,own[169].targetBranch);
 assert.equal(updates,1);
 sel.get('hub').value='E1';sel.get('hub').onchange();
 context.renderPNO();
 assert.match(bar.innerHTML,/OTHER_BDC-อีกฮับ/);
 assert.doesNotMatch(bar.innerHTML,/B170_BDC-สาขา 170/);
 assert.equal(pnoV18State.filters.branch,'');
});
