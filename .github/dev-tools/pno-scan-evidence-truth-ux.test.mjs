import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { observePnoSnapshot, observePnoEvidencePage, pnoIdentityDiagnostics } from '../../worker/src/pno-inbound-scan-evidence.js';
import { readSharedPnoPage, readCanonicalPnoPage } from '../../worker/.dev-runtime/src/index.js';

const root = new URL('../../', import.meta.url);
const front = readFileSync(new URL('worker/.dev-assets/ms.js', root), 'utf8');
const worker = readFileSync(new URL('worker/.dev-runtime/src/index.js', root), 'utf8');
const locator = { hub: 'TEST', proofId: 'FIXTURE-PROOF', day: '2026-10-02',
  lineId: 'FIXTURE-LINE', storeId: 'SOURCE', nextStoreId: 'TARGET', type: 'total', page: 1, count: 488 };
const at = '2026-10-02T03:21:00Z';
const before = '2026-10-02T02:50:00Z';
const row = (extra = {}) => ({ pno: 'FIXTURE-PNO', pack_no: 'FIXTURE-BACKING', store_id: 'TARGET',
  real_arrive_time: '2026-10-02 10:00:00', LastAction: 'SHIPMENT_WAREHOUSE_SCAN',
  LastAction_name: 'สแกนออกคลัง', LastActionTime: '2026-10-02 10:20:00', ...extra });
function extract(source, name) {
  const prefix = source.includes(`async function ${name}(`) ? `async function ${name}(` : `function ${name}(`;
  const start = source.indexOf(prefix), end = source.indexOf('\n}\n', start) + 2;
  assert.ok(start >= 0 && end > start, name);
  return source.slice(start, end);
}
class Storage {
  constructor() { this.data = new Map(); this.writes = 0; }
  async transaction(fn) { return fn(this); }
  async get(keys) { return new Map(keys.filter(k => this.data.has(k)).map(k => [k, this.data.get(k)])); }
  async put(values) { for (const [k, v] of Object.entries(values)) { this.data.set(k, structuredClone(v)); this.writes++; } }
}
function ui() {
  const list = { innerHTML: '' };
  const esc = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  const render = new Function('el', 'esc', `${extract(front, 'pnoV18ParcelAction')}\n${extract(front, 'pnoInboundRender')}\nreturn pnoInboundRender;`)(() => list, esc);
  return rows => { render(rows); return list.innerHTML; };
}
const validations = [
  ['ARRIVAL_ANCHOR_MISSING_OR_INVALID', { real_arrive_time: '' }],
  ['ARRIVAL_ANCHOR_MISSING_OR_INVALID', { real_arrive_time: '2026-02-30 10:00:00' }],
  ['LAST_ACTION_TIME_MISSING_OR_INVALID', { LastActionTime: '' }],
  ['LAST_ACTION_TIME_MISSING_OR_INVALID', { LastActionTime: 'invalid' }],
  ['LAST_ACTION_CODE_MISSING_OR_UNSUPPORTED', { LastAction: '' }],
  ['LAST_ACTION_CODE_MISSING_OR_UNSUPPORTED', { LastAction: 'UNSUPPORTED_TEST_ACTION' }],
  ['TARGET_STORE_MISSING', { store_id: '' }],
  ['TARGET_STORE_MISMATCH', { store_id: 'OTHER' }],
  ['LAST_ACTION_BEFORE_ARRIVAL', { LastActionTime: '2026-10-02 09:59:59' }],
];
for (const [reason, changes] of validations) {
  test(`unknown truth and specific reason: ${reason} ${JSON.stringify(changes)}`, () => {
    const out = observePnoSnapshot(null, locator, row(changes), at);
    assert.equal(out.changed, false);
    assert.equal(out.view.classification, 'INSUFFICIENT_HISTORY');
    assert.equal(out.view.reason, reason);
    assert.notEqual(out.view.reason, 'OCCURRENCE_OR_SOURCE_INVALID');
    const html = ui()([{ pno: 'FIXTURE', scanEvidence: out.view }]);
    assert.doesNotMatch(html, new RegExp(reason));
    assert.match(html, /ยังตรวจสแกนเข้าไม่ได้/);
  });
}
for (const field of ['hub', 'proofId', 'day', 'lineId', 'sourceStoreId', 'targetStoreId', 'pno']) {
  test(`identity diagnostic names only the missing ${field}`, () => {
    const l = { ...locator }, r = row();
    if (field === 'pno') r.pno = '';
    else l[{sourceStoreId:'storeId',targetStoreId:'nextStoreId'}[field] || field] = '';
    const out = observePnoSnapshot(null, l, r, at);
    assert.equal(out.view.classification, 'INSUFFICIENT_HISTORY');
    assert.equal(out.view.reason, 'IDENTITY_INCOMPLETE');
    assert.deepEqual(out.view.identityIssues, [{ field, issue: 'MISSING' }]);
    assert.doesNotMatch(JSON.stringify(out.view), /FIXTURE-PROOF|SOURCE|TARGET|FIXTURE-PNO/);
  });
}
test('invalid identity date and invalid observedAt stay specific; multiple failures are retained', async () => {
  assert.deepEqual(pnoIdentityDiagnostics({ ...locator, day: 'invalid' }, row()), [{ field: 'day', issue: 'INVALID' }]);
  const out = observePnoSnapshot(null, locator, row(), 'invalid');
  assert.equal(out.view.reason, 'OBSERVED_AT_INVALID');
  assert.equal(out.view.classification, 'INSUFFICIENT_HISTORY');
  const multi = observePnoSnapshot(null, { ...locator, proofId: '' }, row({ LastAction: '', LastActionTime: '' }), 'invalid');
  assert.deepEqual(multi.view.validationReasons, ['IDENTITY_INCOMPLETE', 'LAST_ACTION_TIME_MISSING_OR_INVALID',
    'LAST_ACTION_CODE_MISSING_OR_UNSUPPORTED', 'OBSERVED_AT_INVALID']);
  const st = new Storage();
  const [view] = await observePnoEvidencePage(st, locator,
    [row({ real_arrive_time: '', store_id: 'SOURCE' })], 'invalid');
  assert.equal(view.classification, 'INSUFFICIENT_HISTORY');
  assert.ok(view.validationReasons.includes('OBSERVED_AT_INVALID'));
  assert.equal(st.writes, 0);
});
test('exact positive is sticky on weaker later data; another occurrence cannot borrow it', async () => {
  const positive = observePnoSnapshot(null, locator, row({ LastAction: 'ARRIVAL_WAREHOUSE_SCAN' }), at);
  assert.equal(positive.view.classification, 'CONFIRMED_SCAN_IN');
  for (const [, changes] of validations.filter(([, c]) => !('real_arrive_time' in c))) {
    const weak = observePnoSnapshot(positive.record, locator, row(changes), at);
    assert.equal(weak.view.classification, 'CONFIRMED_SCAN_IN');
    assert.equal(weak.view.observationIssue.classification, 'INSUFFICIENT_HISTORY');
    assert.equal(weak.changed, false);
    assert.deepEqual(weak.record, positive.record);
  }
  for (const [l, r] of [[{...locator, lineId:'OTHER'}, row()], [locator,row({pno:'OTHER'})],
    [{...locator, day:'2026-10-03'},row({real_arrive_time:'2026-10-03 11:00:00', LastActionTime:'2026-10-03 11:20:00'})]]) {
    const out = observePnoSnapshot(positive.record, l, r, at);
    assert.equal(out.view.classification, 'INSUFFICIENT_HISTORY');
    assert.equal(out.view.reason, 'OCCURRENCE_MISMATCH');
    assert.equal(out.changed, false);
  }
  const st = new Storage();
  await observePnoEvidencePage(st, locator, [row({LastAction:'ARRIVAL_WAREHOUSE_SCAN'})], at);
  const writes = st.writes;
  const [weak] = await observePnoEvidencePage(st, locator, [row({LastAction:''})], at);
  assert.equal(weak.classification, 'CONFIRMED_SCAN_IN');
  assert.equal(st.writes, writes);
});
test('only complete pre-arrival window plus downstream without positive supports a gap', () => {
  const gap = observePnoSnapshot(null, locator, row(), at, { monitoringStartedAt: before, coverageComplete:true });
  assert.equal(gap.view.classification, 'SUSPECTED_SCAN_IN_GAP');
  assert.equal(observePnoSnapshot(null, locator, row(), at, {coverageComplete:true}).view.classification, 'INSUFFICIENT_HISTORY');
  assert.equal(observePnoSnapshot(null, locator, row(), at, {monitoringStartedAt:before}).view.classification, 'INSUFFICIENT_HISTORY');
  const arrival = observePnoSnapshot(null, locator, row({LastAction:'ARRIVAL_GOODS_VAN_CHECK_SCAN',LastActionTime:'2026-10-02 10:00:00'}), at,
    {monitoringStartedAt:before,coverageComplete:true});
  assert.equal(arrival.view.classification,'NOT_YET_SCAN_IN_STAGE');
});
async function sharedProviderPage(rows) {
  const observed = { calls:0, locator:null };
  // Execute the actual DataList normalization with a mocked provider boundary.
  const read = vm.runInNewContext(`(${extract(worker, 'readPendingParcelPage')})`, {
    URL, PNO_PAGE_SIZE:200, fail: (...args) => { throw new Error(args.join(' ')); },
    fetch: async url => { observed.calls++; return {ok:true,json:async()=>({code:1,data:{DataList:rows,Total:488}})}; },
  });
  const owner = {ctx:{storage:new Storage()}};
  const deps = {now:()=>Date.parse(at),readCredential:async()=>({}),
    fetchDetailPage: async (credentials,l) => { observed.locator = l; return read(credentials,l); }};
  const page = await readSharedPnoPage(owner, {}, locator, deps);
  await readSharedPnoPage(owner, {}, locator, deps);
  assert.equal(observed.calls,1,'diagnostics and cache reconciliation add no request');
  return {page, observed};
}
test('actual normalized provider row preserves action name/code/time/anchor/store/backing and locator', async () => {
  const {page,observed} = await sharedProviderPage([row()]);
  const p = page.parcels[0];
  assert.equal(p.lastAction,'สแกนออกคลัง');
  assert.equal(p.lastActionCode,row().LastAction);
  assert.equal(p.lastActionAt,row().LastActionTime);
  assert.equal(p.arrivalAnchorAt,row().real_arrive_time);
  assert.equal(p.evidenceStoreId,row().store_id);
  assert.equal(p.backingNo,row().pack_no);
  assert.equal(p.scanEvidence.reason,'LATE_START_SCAN_STATE_UNKNOWN');
  for (const key of ['hub','proofId','day','lineId','storeId','nextStoreId']) assert.equal(observed.locator[key],locator[key]);
  assert.deepEqual([page.lineId,page.sourceStoreId,page.targetStoreId],['FIXTURE-LINE','SOURCE','TARGET']);
  assert.match(ui()(page.parcels), /สแกนออกคลัง/);
  const {page:codeOnly}=await sharedProviderPage([row({LastAction_name:''})]);
  assert.match(ui()(codeOnly.parcels),/สแกนออกคลัง/);
  const {page:absent}=await sharedProviderPage([row({LastAction_name:'',LastAction:''})]);
  assert.equal(absent.parcels[0].scanEvidence.reason,'LAST_ACTION_CODE_MISSING_OR_UNSUPPORTED');
  assert.match(ui()(absent.parcels),/การดำเนินการล่าสุดยังไม่พร้อม/);
});
test('canonical shared page passes exact locator identity through its internal request', async () => {
  let received;
  const value=await readCanonicalPnoPage({MS_REFRESH_COORDINATOR:{idFromName:h=>h,get:()=>({fetch:async req=>{
    received=new URL(req.url); return Response.json({parcels:[]});
  }})}},locator);
  for(const key of ['proofId','day','lineId','storeId','nextStoreId']) assert.equal(received.searchParams.get(key),locator[key]);
  assert.equal(received.searchParams.get('branch'),locator.hub);
  assert.deepEqual(value,{parcels:[]});
});
test('owner 488 / 150 / 338 with 324 unresolved filter results and current 200: compact zero and Thai reason summary', async () => {
  const fixtures=Array.from({length:200},(_,i)=>row({pno:`SYNTHETIC-${i}`,LastAction:'',LastAction_name:''}));
  const {page}=await sharedProviderPage(fixtures);
  assert.equal(page.total,488);
  assert.equal(page.parcels.length,200);
  assert.ok(page.parcels.every(p=>p.scanEvidence.classification==='INSUFFICIENT_HISTORY'));
  const html=ui()(page.parcels);
  assert.match(html,/เฉพาะหน้านี้: ยืนยันว่าหลุดสแกนเข้า 0 · ยังตรวจสแกนเข้าไม่ได้ 200/);
  assert.match(html,/ยังไม่พบรายการที่ยืนยันว่าเป็นหลุดสแกนเข้าในหน้านี้/);
  assert.match(html,/<li>สถานะการดำเนินการล่าสุดยังไม่พร้อม <strong>200<\/strong><\/li>/);
  assert.match(html,/เฉพาะรายการที่โหลดในหน้านี้ ไม่ใช่ยอดคงเหลือทั้งหมด/);
  assert.doesNotMatch(html,/data-pno-evidence-section="suspected"|empty-state|OCCURRENCE_OR_SOURCE_INVALID|LAST_ACTION_CODE|INSUFFICIENT_HISTORY/);
  assert.equal((html.match(/<tr>/g)||[]).length,201,'one nonempty unknown desktop table');
  assert.equal((html.match(/<article /g)||[]).length,200,'mobile shows the same unknown cases');
  const nodes=new Map(); const state={type:'scan_gap',total:488,filterRows:Array.from({length:488}),filterPage:1,page:1,
    sourceRow:{expectedParcels:488,enteredParcels:150,pendingParcels:338}};
  const context={pnoV18State:state,nf:new Intl.NumberFormat('en-US'),
    el:id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',disabled:false,classList:{remove(){}}});return nodes.get(id);},
    pnoV18FilteredParcelEntries:()=>Array.from({length:324},()=>({item:page.parcels[0]})),
    pnoV18VisibleParcelEntries:()=>page.parcels.map(item=>({item})),pnoInboundRender:()=>{},pnoV18UpdateFilterResult:()=>{}};
  vm.runInNewContext(extract(front,'pnoV18RenderCurrentFilteredView')+';pnoV18RenderCurrentFilteredView()',context);
  assert.equal(nodes.get('pno-v18-filter-result').textContent,'ข้อมูลพัสดุผู้ให้บริการ 488 · รายการตรวจสแกนเข้าตามตัวกรอง 324 · แสดงหน้านี้ 200');
  assert.deepEqual([state.sourceRow.expectedParcels,state.sourceRow.enteredParcels,state.sourceRow.pendingParcels],[488,150,338]);
});
test('groups never mix; summary counts describe actual current rows and Thai mapping covers closed reasons', () => {
  const html=ui()([
    {pno:'GAP',scanEvidence:{classification:'SUSPECTED_SCAN_IN_GAP',reason:'SCAN_IN_STATE_ABSENT_AT_REQUIRED_STAGE'}},
    {pno:'UNKNOWN-A',scanEvidence:{classification:'INSUFFICIENT_HISTORY',reason:'TARGET_STORE_MISMATCH'}},
    {pno:'UNKNOWN-B',scanEvidence:{classification:'INSUFFICIENT_HISTORY',reason:'TARGET_STORE_MISMATCH'}},
    {pno:'UNKNOWN-C',scanEvidence:{classification:'INSUFFICIENT_HISTORY',reason:'IDENTITY_INCOMPLETE',identityIssues:[{field:'lineId',issue:'MISSING'}]}},
    {pno:'POSITIVE',scanEvidence:{classification:'CONFIRMED_SCAN_IN'}},
    {pno:'BEFORE',scanEvidence:{classification:'NOT_YET_SCAN_IN_STAGE'}},
  ]);
  const [gap,unknown]=html.split('data-pno-evidence-section="suspected"')[1].split('data-pno-evidence-section="insufficient"');
  assert.match(gap,/GAP/); assert.doesNotMatch(gap,/UNKNOWN/);
  assert.match(unknown,/UNKNOWN-A/); assert.doesNotMatch(unknown,/>GAP</);
  assert.match(html,/<li>ข้อมูลพัสดุยังไม่ตรงกับสาขาของเที่ยวนี้ <strong>2<\/strong><\/li>/);
  assert.match(html,/ข้อมูลระบุเที่ยว\/สาขายังไม่ครบ \(ยังไม่พร้อม: สายรถ\)/);
  assert.doesNotMatch(html,/POSITIVE|BEFORE|TARGET_STORE_MISMATCH|IDENTITY_INCOMPLETE|SCAN_IN_STATE_ABSENT/);
  for(const reason of ['OCCURRENCE_OR_SOURCE_INVALID','FUTURE_REASON','EVIDENCE_STORAGE_UNAVAILABLE','OCCURRENCE_MISMATCH','OBSERVATION_WINDOW_NOT_COVERED']) {
    const render=ui(), r=[{pno:'FIXTURE',scanEvidence:{classification:'INSUFFICIENT_HISTORY',reason}}];
    assert.equal(render(r),render(r));
    assert.doesNotMatch(render(r),new RegExp(reason));
  }
});
test('effective DEV evidence rendering is local only and staging keeps source raw fields', () => {
  const render=extract(front,'pnoInboundRender');
  assert.doesNotMatch(render,/fetch\(|apiGet\(|curl_pno|history|setInterval|setTimeout/);
  assert.doesNotMatch(front,/data-pno-history|pnoExactHistoryCheck|\/pno\/history/);
  assert.match(worker,/items:[\s\S]*?\.map\(\(item\) => \(\{ \.\.\.item, __pnoCanReport/);
  assert.doesNotMatch(readFileSync(new URL('worker/src/pno-inbound-scan-evidence.js',root),'utf8'),/OCCURRENCE_OR_SOURCE_INVALID|fetch\(/);
  assert.doesNotThrow(()=>new Function(front));
});
