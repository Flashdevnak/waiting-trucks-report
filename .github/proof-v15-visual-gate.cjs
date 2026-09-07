const { chromium } = require('playwright');

const base = 'https://waiting-trucks-report-api-dev.26nak-testdev.workers.dev';
const bad = ['•', '→', '—'];
const rows = [
  {lineId:'L1',departureDate:'2026-09-07',lineName:'FD-4WJ-NE1-SNRR-20:30-BD-RO',lineType:1,lineTypeText:'Feeder',lineMode:1,lineModeText:'ปกติ',plateNumber:'ยข3434(นครราชสีมา)',plateTypeText:'4WJ',driver:'โกเมนทร์ ภิรมย์นาค',driverPhone:'0653762402',fleetId:'22',fleetName:'2KL (2K LOGISTICS)',proofId:'',proofState:1,proofStateText:'รอเปิดบาร์โค้ด',startTime:1230,plannedDepartureTime:1230,standbyTime:1170,detailReady:true,destinationCode:'SNRR',destinationName:'SNRR_SP-สุรนารายณ์'},
  {lineId:'L2',departureDate:'2026-09-07',lineName:'LH-6W7.2-NE1-BKKC-23:00-BD-31-RS1',lineType:2,lineTypeText:'LH',lineMode:1,lineModeText:'ปกติ',plateNumber:'712286(ขอนแก่น)',plateTypeText:'6W7.2',driver:'จอมฤทธิ์ กอนแก้ว',driverPhone:'0956205748',fleetId:'37',fleetName:'AMR (AMARA)',proofId:'NAK1TEST001',proofState:7,proofStateText:'ถึงสาขาต้นทางแล้ว',startTime:1380,plannedDepartureTime:1380,standbyTime:1140,detailReady:true,destinationCode:'BKKC',destinationName:'27 KKC_BHUB-ขอนแก่น'},
  {lineId:'L3',departureDate:'2026-09-07',lineName:'LH-6W5.5-NE1-NO1-23:00-BD-3-RO',lineType:2,lineTypeText:'LH',lineMode:1,lineModeText:'ปกติ',plateNumber:'2ฒม8477(กรุงเทพ)',plateTypeText:'6W5.5',driver:'',driverPhone:'',fleetId:'33',fleetName:'9SM (9 SAMUKKI)',proofId:'',proofState:1,proofStateText:'รอเปิดบาร์โค้ด',startTime:1380,plannedDepartureTime:1380,standbyTime:1260,detailReady:true,destinationCode:'NO1',destinationName:'26 NAK_BHUB-นครราชสีมา'}
];

function assert(value, message) { if (!value) throw new Error(message); }
function detail(row) {
  return {lineId:row.lineId,departureDate:row.departureDate,lineName:row.lineName,proofState:1,proofStateText:'รอเปิดบาร์โค้ด',proofId:'',fleetId:'33',fleetName:'9SM (9 SAMUKKI)',originName:'02 NE1_HUB-นครราชสีมา',track:'NE1 NO1',plateId:'284471',plateNumber:'2ฒม8477(กรุงเทพ)',plateType:203,plateTypeText:'6W5.5',fmsDriverId:'',driver:'',driverPhone:'',plannedDepartureText:'23:00',policy:{plateEditable:true,driverEditable:true,plateReason:'',driverReason:''}};
}
async function openReady(browser, viewport) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  let ready = false, last = '';
  for (let i = 0; i < 4; i++) {
    try {
      const response = await page.goto(`${base}/proof.html?v15gate=${Date.now()}-${i}`, {waitUntil:'domcontentloaded', timeout:15000});
      last = `HTTP ${response?.status()}`;
      if (response?.ok()) {
        await page.waitForFunction(() => window.__PROOF_V15_READY__ === true, {timeout:5000});
        ready = true;
        break;
      }
    } catch (error) { last = String(error); }
    await page.waitForTimeout(2500);
  }
  assert(ready, `Proof V15 not ready on DEV: ${last}`);
  assert(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  return page;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await openReady(browser, {width:1680, height:950});
    const mutations = [];
    page.on('request', request => {
      if (request.method() !== 'GET' && /\/api\/proof\//.test(request.url())) mutations.push({method:request.method(), url:request.url()});
    });
    await page.evaluate(data => {
      const P = window.ProofV2;
      P.state.profile = {name:'DEV QA',canPrint:true,canCreateProof:true,canCancelCar:false};
      P.state.branch = 'NE1';
      P.state.rows = data;
      const host = document.createElement('div');
      host.id = 'proof-v15-gate';
      host.style.margin = '20px';
      document.body.appendChild(host);
      host.innerHTML = P.groupedHtml(data);
    }, rows);
    const desktop = await page.evaluate(chars => {
      const host = document.getElementById('proof-v15-gate');
      const tableRows = [...host.querySelectorAll('.proof-v15-row')];
      const heads = [...host.querySelectorAll('.proof-v15-columns b')];
      const buttons = [...host.querySelectorAll('.proof-v15-actions .btn')];
      return {
        rowCount: tableRows.length,
        bodyW: document.documentElement.scrollWidth,
        viewport: innerWidth,
        overflow: tableRows.some(x => x.scrollWidth > x.clientWidth + 2),
        headWrap: heads.some(x => getComputedStyle(x).whiteSpace !== 'nowrap' || x.scrollHeight > x.clientHeight + 2),
        buttonWrap: buttons.some(x => getComputedStyle(x).whiteSpace !== 'nowrap' || x.scrollHeight > x.clientHeight + 2),
        suppliers: ['2KL (2K LOGISTICS)','AMR (AMARA)','9SM (9 SAMUKKI)'].every(x => host.textContent.includes(x)),
        bad: chars.filter(x => host.textContent.includes(x))
      };
    }, bad);
    assert(desktop.rowCount === 3, `desktop rows ${JSON.stringify(desktop)}`);
    assert(desktop.bodyW <= desktop.viewport + 2 && !desktop.overflow, `desktop overflow ${JSON.stringify(desktop)}`);
    assert(!desktop.headWrap && !desktop.buttonWrap, `desktop wrapping ${JSON.stringify(desktop)}`);
    assert(desktop.suppliers, `supplier missing ${JSON.stringify(desktop)}`);
    assert(desktop.bad.length === 0, `visible separators ${JSON.stringify(desktop)}`);

    await page.evaluate(d => {
      const P = window.ProofV2;
      P.openEditor(P.state.rows[2], d);
      const plates = Array.from({length:6}, (_,i) => ({id:String(100+i),plateNumber:`2ฒม84${77+i}(กรุงเทพ)`,plateTypeText:'6W5.5'}));
      const drivers = Array.from({length:6}, (_,i) => ({id:String(200+i),name:`คนขับทดสอบ ${i+1}`,phone:`08100000${String(i).padStart(2,'0')}`,auditStateText:i%2?'พร้อมใช้งาน':''}));
      P.renderEditorSearchItems('plate', document.getElementById('proof-editor-plate-results'), plates, '8477');
      P.renderEditorSearchItems('driver', document.getElementById('proof-editor-driver-results'), drivers, 'คนขับ');
    }, detail(rows[2]));
    await page.waitForSelector('#proof-editor-dialog[open]', {timeout:5000});
    const modal = await page.evaluate(chars => {
      const d = document.getElementById('proof-editor-dialog');
      const card = d.querySelector('.proof-editor-card');
      const r = d.getBoundingClientRect();
      const visible = list => { const lr=list.getBoundingClientRect(); return [...list.querySelectorAll('.proof-option')].filter(el => { const x=el.getBoundingClientRect(); return Math.min(x.bottom,lr.bottom)-Math.max(x.top,lr.top)>30; }).length; };
      const plate = document.getElementById('proof-editor-plate-results');
      const driver = document.getElementById('proof-editor-driver-results');
      return {title:d.querySelector('h2')?.textContent||'',center:Math.abs((r.left+r.right)/2-innerWidth/2),right:r.right,viewport:innerWidth,overflow:card.scrollWidth>card.clientWidth+2,plateVisible:visible(plate),driverVisible:visible(driver),plateH:plate.clientHeight,driverH:driver.clientHeight,bad:chars.filter(x=>d.textContent.includes(x))};
    }, bad);
    assert(modal.title === 'ตรวจข้อมูลก่อนปริ้นบาร์รถ', `modal title ${JSON.stringify(modal)}`);
    assert(modal.center < 4 && modal.right <= modal.viewport + 1 && !modal.overflow, `modal geometry ${JSON.stringify(modal)}`);
    assert(modal.plateVisible >= 3 && modal.driverVisible >= 3 && modal.plateH >= 170 && modal.driverH >= 170, `selector cramped ${JSON.stringify(modal)}`);
    assert(modal.bad.length === 0, `modal separators ${JSON.stringify(modal)}`);
    await page.evaluate(() => window.ProofV2.closeEditor());
    assert(mutations.length === 0, `mutation request detected ${JSON.stringify(mutations)}`);

    const mobile = await openReady(browser, {width:390, height:844});
    await mobile.evaluate(({data,d}) => {
      const P = window.ProofV2;
      P.state.profile={name:'DEV QA',canPrint:true,canCreateProof:true,canCancelCar:false};
      P.state.branch='NE1'; P.state.rows=data;
      const host=document.createElement('div'); host.id='proof-v15-mobile'; document.body.appendChild(host); host.innerHTML=P.groupedHtml(data);
      P.openEditor(data[2],d);
      P.renderEditorSearchItems('plate',document.getElementById('proof-editor-plate-results'),Array.from({length:5},(_,i)=>({id:String(300+i),plateNumber:`847${i}(กรุงเทพ)`,plateTypeText:'6W5.5'})),'847');
    }, {data:rows,d:detail(rows[2])});
    await mobile.waitForSelector('#proof-editor-dialog[open]', {timeout:5000});
    const m = await mobile.evaluate(chars => {
      const d=document.getElementById('proof-editor-dialog'), card=d.querySelector('.proof-editor-card'), list=document.getElementById('proof-editor-plate-results');
      return {bodyW:document.documentElement.scrollWidth,viewport:innerWidth,dialogW:d.getBoundingClientRect().width,overflow:card.scrollWidth>card.clientWidth+2,listH:list.clientHeight,bad:chars.filter(x=>d.textContent.includes(x))};
    }, bad);
    assert(m.bodyW <= m.viewport + 2 && m.dialogW <= m.viewport && !m.overflow, `mobile overflow ${JSON.stringify(m)}`);
    assert(m.listH >= 150 && m.bad.length === 0, `mobile selector/copy ${JSON.stringify(m)}`);

    console.log('PROOF_V15_LIVE_UI=PASS');
    console.log('DESKTOP_GRID_SINGLE_LINE=PASS');
    console.log('SUPPLIER_VISIBLE_FROM_ROW=PASS');
    console.log('SELECTOR_MULTI_ITEM_VISIBLE=PASS');
    console.log('MODAL_CENTERED=PASS');
    console.log('MOBILE_MODAL=PASS');
    console.log('VISIBLE_BULLET_DASH_ARROW=0');
    console.log('CANCELLATION_ENABLED=NO');
    console.log('MS_MUTATION_TESTED=NO');
    console.log('PRODUCTION_TOUCHED=NO');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
