import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { pnoBranchSearchChoices } from './patch-pno-branch-search-v1.mjs';
import { stageFrontend } from './stage-dev-runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const base = fs.readFileSync(path.join(root, 'ms.js'), 'utf8');
const built = stageFrontend(base);

const choices = Array.from({length: 130}, (_, i) => `(TH-${i+1}) B${String(i+1).padStart(3,'0')}_BDC-สาขา ${i+1}`);

test('large source is bounded, selected raw R-column remains visible', () => {
  const chosen = choices[120];
  const result = pnoBranchSearchChoices(choices, '', chosen);
  assert.equal(result.total, 130);
  assert.equal(result.matchCount, 130);
  assert.equal(result.visible.length, 16);
  assert.equal(result.visible.at(-1), chosen);
});

test('search supports code and Thai branch name without changing exact value', () => {
  const raw = '(THXXX) 2KAK_BDC-นครราชสีมา';
  const values = [raw, '(THXXX) 2XXX_BDC-มหาสารคาม'];
  assert.deepEqual(pnoBranchSearchChoices(values, '2kak', '').matches, [raw]);
  assert.deepEqual(pnoBranchSearchChoices(values, 'นครราช', '').matches, [raw]);
  assert.deepEqual(pnoBranchSearchChoices(values, 'ไม่มีสาขา', '').matches, []);
  assert.equal(pnoBranchSearchChoices(values, '2xxx', '').visible[0], values[1]);
});

test('published pipeline stages a searchable picker without mutating worker or provenance', () => {
  assert.match(built, /PNO_BRANCH_SEARCH_V1: searchable/);
  assert.match(built, /pno-v18-branch-search/);
  assert.match(built, /pnoV18State\.branchSearchQuery/);
  assert.match(built, /branchSearchType !== type/);
  assert.match(built, /if \(field === "hub"\) pnoV18State\.branchSearchQuery = ""/);
  assert.match(built, /filters\.branch = matches\[0\]/);
  assert.match(built, /String\(item\?\.targetBranch \|\| ""\)\.trim\(\) === branch/);
  assert.equal(stageFrontend(built), built, 'staging idempotence');
  assert.doesNotMatch(built.slice(built.indexOf('function pnoV18RenderFilters()'), built.indexOf('function pnoV18RenderRows(')), /fetch\(/);
});

test('runtime picker narrows on input and Enter chooses exact branch, hub cascade resets text', () => {
  const from = built.indexOf('function pnoV18RenderFilters() {');
  const to = built.indexOf('\n}\n', from) + 2;
  assert.ok(from >= 0 && to > from);
  const fn = built.slice(from, to);
  const selectMap = new Map([['status',{dataset:{pnoV18Filter:'status'},value:''}],['action',{dataset:{pnoV18Filter:'action'},value:''}],['hub',{dataset:{pnoV18Filter:'hub'},value:''}],['branch',{dataset:{pnoV18Filter:'branch'},value:'',innerHTML:'',focus(){}}]]);
  const search = {value:'',focus(){}};
  const count = {textContent:''};
  const bar = {innerHTML:'',classList:{remove(){}},querySelector(s){return s==='#pno-v18-branch-search'?search:s==='#pno-v18-filter-branch'?selectMap.get('branch'):s==='#pno-v18-branch-count'?count:null},querySelectorAll(){return Array.from(selectMap.values())}};
  const elements = {'pno-v18-filterbar':bar,'pno-v18-filter-result':{textContent:''},'pno-v18-filter-reset':{onclick:null}};
  const styleNodes=[];
  let renders=0;
  const state = {type:'total',filterRows:[{targetHub:'NE1',targetBranch:'(THX) 2AAA_BDC-โคราช',status:'x',lastAction:'x'},{targetHub:'NE1',targetBranch:'(THY) 2BBB_BDC-อุดร',status:'x',lastAction:'x'},{targetHub:'NE5',targetBranch:'(THZ) 3CCC_BDC-ระยอง',status:'x',lastAction:'x'}],filterKey:'key|total',filterForce:false,filters:{status:'',action:'',hub:'NE1',branch:''},branchSearchQuery:'',filterPage:3};
  const context={
    pnoV18State:state, el:k=>elements[k],document:{getElementById:id=>styleNodes.find(x=>x.id===id),createElement:()=>({}),head:{appendChild:x=>styleNodes.push(x)}},
    pnoV18LocatorKey:()=> 'key', pnoV18SourceRow:()=> ({}),
    pnoV18ParcelStatus:r=>r.status,pnoV18ParcelAction:r=>r.lastAction,
    pnoV18UniqueValues:xs=>[...new Set(xs)],pnoV18ValidateFilter:(v,arr)=>arr.includes(v)?v:'',
    pnoV18DisplayBranch:v=>String(v).replace(/^\(TH[^)]*\)\s*/i,''),
    pnoV18FilterOption:(v,selected)=>`<option value="${v}"${v===selected?' selected':''}>${v}</option>`,
    esc:v=>String(v).replaceAll('&','&amp;').replaceAll('"','&quot;'),nf:new Intl.NumberFormat('th-TH'),
    pnoV18RenderCurrentFilteredView:()=>renders++
  };
  vm.runInNewContext(pnoBranchSearchChoices.toString()+'\n'+fn+'\nthis.runFilter=pnoV18RenderFilters',context);
  context.runFilter();
  assert.match(bar.innerHTML,/ค้นหาสาขาปลายทาง/);
  assert.match(selectMap.get('branch').innerHTML,/2AAA_BDC-โคราช/);
  assert.doesNotMatch(selectMap.get('branch').innerHTML,/3CCC_BDC-ระยอง/,'hub cascade');
  search.value='อุดร';search.oninput();
  assert.equal(state.branchSearchQuery,'อุดร');
  assert.match(selectMap.get('branch').innerHTML,/2BBB_BDC-อุดร/);
  assert.doesNotMatch(selectMap.get('branch').innerHTML,/2AAA_BDC-โคราช/);
  assert.match(count.textContent,/1/);
  search.onkeydown({key:'Enter',preventDefault(){}});
  assert.equal(state.filters.branch,'(THY) 2BBB_BDC-อุดร','raw value not presentation');
  assert.equal(state.filterPage,1);
  assert.equal(renders,1);
  state.branchSearchQuery='abc';
  selectMap.get('hub').value='NE5';
  selectMap.get('hub').onchange();
  assert.equal(state.branchSearchQuery,'');
  assert.equal(state.filters.hub,'NE5');
});
