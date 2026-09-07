import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIGIN = process.env.PROOF_DEV_ORIGIN || 'https://waiting-trucks-report-api-dev.26nak-testdev.workers.dev';
const EXPECTED_V16 = process.env.PROOF_V16_ASSET || 'proof-v16.js?v=20260907-05';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findChrome() {
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try {
      const path = execFileSync('bash', ['-lc', `command -v ${name}`], { encoding: 'utf8' }).trim();
      if (path) return path;
    } catch {}
  }
  throw new Error('Chrome/Chromium is required for the DEV responsive smoke gate');
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.seq = 0;
    this.pending = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
    };
  }

  send(method, params = {}, sessionId = '') {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  close() {
    this.ws?.close();
  }
}

async function launchChrome() {
  const port = 9337;
  const profile = await mkdtemp(join(tmpdir(), 'proof-v16-live-smoke-'));
  const child = spawn(findChrome(), [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let version = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Chrome exited before CDP was ready (${child.exitCode})`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        version = await response.json();
        break;
      }
    } catch {}
    await sleep(100);
  }
  if (!version?.webSocketDebuggerUrl) throw new Error('Chrome DevTools endpoint did not become ready');
  return { child, profile, version };
}

async function evaluate(cdp, sessionId, expression) {
  const response = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }, sessionId);
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'Browser evaluation failed');
  return response.result?.value;
}

async function waitForPage(cdp, sessionId, expectedUrl) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const state = await evaluate(cdp, sessionId, `({href:location.href,ready:document.readyState,v16:Boolean(window.__PROOF_V16_READY__)})`);
    if (state?.href?.startsWith(expectedUrl.split('?')[0]) && state.ready === 'complete' && state.v16) return;
    await sleep(100);
  }
  const state = await evaluate(cdp, sessionId, `({href:location.href,title:document.title,body:document.body?.innerText?.slice(0,240),ready:document.readyState,v16:Boolean(window.__PROOF_V16_READY__)})`);
  throw new Error(`Proof V16 did not become ready: ${JSON.stringify(state)}`);
}

const browserProbeExpression = `(() => {
  const rect = (element) => {
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return { x:box.x, y:box.y, width:box.width, height:box.height, right:box.right, bottom:box.bottom };
  };
  const css = (element) => element ? getComputedStyle(element) : null;
  const toolbar = document.querySelector('.proof-toolbar-v16');
  const search = document.querySelector('.proof-search-field-v16');
  const hub = document.querySelector('.proof-hub-field-v16');
  const day = document.querySelector('.proof-day-field-v16');
  const dayInput = document.querySelector('#day-filter');
  const quick = document.querySelector('#proof-quick-day-v16');
  const resources = performance.getEntriesByType('resource').map((entry) => entry.name);

  const fixture = document.createElement('div');
  fixture.id = 'proof-v16-responsive-smoke-fixture';
  fixture.style.cssText = 'position:absolute;left:0;top:0;width:100%;max-width:100%;opacity:0;pointer-events:none;z-index:-9999;overflow:hidden';
  fixture.innerHTML = \`
    <section class='proof-v15-lane' data-proof-lane='FD'>
      <section class='proof-v15-branch'>
        <div class='proof-v15-columns'><b>เส้นทาง</b><b>บาร์รถ</b><b>เวลา</b><b>คนขับ</b><b>บริษัทซัพและรถ</b><b>สถานะ</b></div>
        <article class='proof-v15-row is-ready'>
          <button class='proof-v15-route'><small>เส้นทาง</small><strong>NE1 TEST</strong><div class='proof-v15-tags'><span>FD</span></div></button>
          <div class='proof-v15-cell barcode'><small>บาร์รถ</small><strong>TEST</strong><span>เปิดใช้แล้ว</span></div>
          <div class='proof-v15-cell time'><small>เวลา</small><strong>ปล่อย 05:30</strong><span>Standby 03:30</span></div>
          <div class='proof-v15-cell driver'><small>คนขับและเบอร์โทร</small><strong>ทดสอบ UI</strong><span>0000000000</span></div>
          <div class='proof-v15-cell supplier'><small>บริษัทซัพและรถ</small><strong>ทดสอบ UI</strong><div class='proof-v15-vehicle'><span>ทะเบียน TEST</span><span>รถ 4WJ</span></div></div>
          <div class='proof-v15-status'><div><small>สถานะ</small><strong>เปิดบาร์โค้ดแล้ว</strong></div><div class='proof-v15-actions'></div></div>
        </article>
      </section>
    </section>
    <div class='proof-v15-editor'>
      <div class='proof-editor-route-box'>
        <div class='proof-v16-editor-hero'>
          <div class='proof-v16-editor-route-label'>เส้นทาง</div>
          <strong id='proof-editor-route'>NE1 TEST</strong>
          <div class='proof-v16-editor-status-row'><span class='proof-v16-editor-status is-state-2'>เปิดบาร์โค้ดแล้ว</span></div>
          <div class='proof-v16-editor-meta-grid'>
            <div class='proof-v16-editor-meta-card proof-v16-time-card'><small>เวลาเที่ยวรถ</small><div class='proof-v16-time-grid'><div class='proof-v16-time-item standby'><small>Standby</small><strong>03:30</strong></div><div class='proof-v16-time-item release'><small>ปล่อยรถ</small><strong>05:30</strong></div></div></div>
            <div class='proof-v16-editor-meta-card'><small>ผู้ใช้งาน</small><strong>ทดสอบ UI</strong></div>
          </div>
        </div>
      </div>
    </div>\`;
  document.body.appendChild(fixture);

  const row = fixture.querySelector('.proof-v15-row');
  const columns = fixture.querySelector('.proof-v15-columns');
  const cellLabel = fixture.querySelector('.proof-v15-cell > small:first-child');
  const status = fixture.querySelector('.proof-v15-status strong');
  const tag = fixture.querySelector('.proof-v15-tags span');
  const vehicle = fixture.querySelector('.proof-v15-vehicle span');
  const hero = fixture.querySelector('.proof-v16-editor-hero');
  const timeGrid = fixture.querySelector('.proof-v16-time-grid');

  const result = {
    v16Ready: window.__PROOF_V16_READY__ === true,
    viewportWidth: innerWidth,
    pageScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    toolbar: rect(toolbar),
    search: rect(search),
    hub: rect(hub),
    day: rect(day),
    controlHeights: [...(toolbar?.querySelectorAll('select,input') || [])].map((element) => Math.round(rect(element).height)),
    quickInsideDate: Boolean(dayInput?.closest('label')?.contains(quick)),
    quickCount: quick?.querySelectorAll('button').length || 0,
    quickLabels: [...(quick?.querySelectorAll('button strong') || [])].map((element) => element.textContent.trim()),
    quickButtons: [...(quick?.querySelectorAll('button') || [])].map(rect),
    hasV16Asset: resources.some((name) => name.includes('/${EXPECTED_V16}')),
    hasV17Asset: resources.some((name) => name.includes('/proof-v17')),
    columnsDisplay: css(columns)?.display || '',
    cellLabelDisplay: css(cellLabel)?.display || '',
    rowWidth: rect(row)?.width || 0,
    statusBackground: css(status)?.backgroundColor || '',
    tagBackground: css(tag)?.backgroundColor || '',
    vehicleBackground: css(vehicle)?.backgroundColor || '',
    heroWidth: rect(hero)?.width || 0,
    timeGridDisplay: css(timeGrid)?.display || '',
  };
  fixture.remove();
  return result;
})()`;

function assertCommon(name, result, width) {
  assert.equal(result.v16Ready, true, `${name}: V16 runtime marker missing`);
  assert.equal(result.viewportWidth, width, `${name}: viewport width mismatch`);
  assert.ok(result.pageScrollWidth <= width + 1, `${name}: document has horizontal overflow ${result.pageScrollWidth}/${width}`);
  assert.ok(result.bodyScrollWidth <= width + 1, `${name}: body has horizontal overflow ${result.bodyScrollWidth}/${width}`);
  assert.equal(result.quickInsideDate, true, `${name}: quick-date is detached from the date field`);
  assert.equal(result.quickCount, 3, `${name}: quick-date button count`);
  assert.deepEqual(result.quickLabels, ['เมื่อวาน', 'วันนี้', 'พรุ่งนี้'], `${name}: quick-date labels changed`);
  assert.ok(result.controlHeights.length >= 7, `${name}: toolbar controls missing`);
  assert.ok(result.controlHeights.every((height) => Math.abs(height - 40) <= 1), `${name}: toolbar controls must stay 40px: ${result.controlHeights}`);
  assert.equal(result.hasV16Asset, true, `${name}: expected V16 asset was not requested`);
  assert.equal(result.hasV17Asset, false, `${name}: V17 asset must never be requested`);
  assert.ok(result.toolbar && result.search && result.hub && result.day, `${name}: toolbar layout elements missing`);
  for (const box of [result.toolbar, result.search, result.hub, result.day]) {
    assert.ok(box.x >= -1 && box.right <= width + 1, `${name}: toolbar element leaves viewport: ${JSON.stringify(box)}`);
  }
  assert.notEqual(result.statusBackground, 'rgba(0, 0, 0, 0)', `${name}: status badge lost background contrast`);
  assert.notEqual(result.tagBackground, 'rgba(0, 0, 0, 0)', `${name}: route tag lost background contrast`);
  assert.notEqual(result.vehicleBackground, 'rgba(0, 0, 0, 0)', `${name}: vehicle badge lost background contrast`);
  assert.equal(result.timeGridDisplay, 'grid', `${name}: Hero A time split is not a grid`);
  assert.ok(result.heroWidth <= width + 1, `${name}: Hero A fixture overflows viewport`);
}

function assertViewport(name, result) {
  if (name === 'desktop') {
    assert.ok(Math.abs(result.search.y - result.hub.y) <= 2 && Math.abs(result.hub.y - result.day.y) <= 2, 'desktop: Search/HUB/Date are not top-aligned');
    assert.ok(result.search.x < result.hub.x && result.hub.x < result.day.x, 'desktop: expected Search > HUB > Date visual order');
    assert.equal(result.columnsDisplay, 'grid', 'desktop: column header should be visible');
    assert.equal(result.cellLabelDisplay, 'none', 'desktop: duplicate cell labels should be hidden');
  } else if (name === 'tablet') {
    assert.equal(result.columnsDisplay, 'none', 'tablet: compact table should hide the desktop header');
    assert.notEqual(result.cellLabelDisplay, 'none', 'tablet: compact table needs per-cell labels');
  } else {
    assert.equal(result.columnsDisplay, 'none', 'mobile: desktop table header should stay hidden');
    assert.notEqual(result.cellLabelDisplay, 'none', 'mobile: card cells need labels');
    assert.ok(result.quickButtons.every((box) => box.width >= 70 && box.height >= 30), `mobile: quick-date touch targets too small: ${JSON.stringify(result.quickButtons)}`);
  }
}

async function main() {
  const { child, profile, version } = await launchChrome();
  const cdp = new CdpClient(version.webSocketDebuggerUrl);
  try {
    await cdp.connect();
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Network.enable', {}, sessionId);
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);

    const viewports = [
      ['desktop', 1440, 1000, false],
      ['tablet', 1024, 900, false],
      ['mobile', 390, 844, true],
    ];

    for (const [name, width, height, mobile] of viewports) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, sessionId);
      const url = `${ORIGIN}/proof.html?responsiveSmoke=${Date.now()}-${name}`;
      await cdp.send('Page.navigate', { url }, sessionId);
      await waitForPage(cdp, sessionId, `${ORIGIN}/proof.html`);
      const result = await evaluate(cdp, sessionId, browserProbeExpression);
      assertCommon(name, result, width);
      assertViewport(name, result);
      console.log(`PROOF_V16_${name.toUpperCase()}_RESPONSIVE=PASS`);
      console.log(`PROOF_V16_${name.toUpperCase()}_OVERFLOW=${result.pageScrollWidth - width}`);
    }

    console.log('PROOF_V16_LIVE_ASSET=PASS');
    console.log('PROOF_V17_LIVE_REQUESTS=0');
    console.log('PROOF_V16_QUICK_DATE=PASS');
    console.log('PROOF_V16_TABLE_BADGES=PASS');
    console.log('PROOF_V16_HERO_A=PASS');
    console.log('MS_MUTATION_TESTED=NO');
    console.log('PRODUCTION_TOUCHED=NO');
  } finally {
    cdp.close();
    child.kill('SIGTERM');
    await sleep(300);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
