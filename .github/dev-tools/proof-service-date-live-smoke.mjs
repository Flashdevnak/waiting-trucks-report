import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIGIN = process.env.PROOF_DEV_ORIGIN || 'https://waiting-trucks-report-api-dev.26nak-testdev.workers.dev';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function bangkokDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function addDays(day, offset) {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + offset, 12)).toISOString().slice(0, 10);
}

function chromePath() {
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try {
      const value = execFileSync('bash', ['-lc', `command -v ${name}`], { encoding: 'utf8' }).trim();
      if (value) return value;
    } catch {}
  }
  throw new Error('Chrome/Chromium not found');
}

class CDP {
  constructor(url) { this.url = url; this.seq = 0; this.pending = new Map(); this.events = []; }
  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    this.ws.onmessage = event => {
      const message = JSON.parse(event.data);
      if (!message.id) { this.events.push(message); return; }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result);
    };
  }
  send(method, params = {}, sessionId = '') {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  close() { this.ws?.close(); }
}

async function launch() {
  const port = 9341;
  const profile = await mkdtemp(join(tmpdir(), 'proof-service-date-smoke-'));
  const child = spawn(chromePath(), [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-extensions',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let version;
  for (let i = 0; i < 100; i += 1) {
    if (child.exitCode !== null) throw new Error(`Chrome exited before CDP ready (${child.exitCode})`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) { version = await response.json(); break; }
    } catch {}
    await sleep(100);
  }
  if (!version?.webSocketDebuggerUrl) throw new Error('Chrome DevTools endpoint not ready');
  return { child, profile, version };
}

async function evaluate(cdp, sessionId, expression) {
  const reply = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.text || 'Browser evaluate failed');
  return reply.result?.value;
}

async function waitProofCore(cdp, sessionId) {
  for (let i = 0; i < 160; i += 1) {
    const state = await evaluate(cdp, sessionId, `({
      ready:document.readyState,
      day:window.ProofV2?.state?.day||'',
      input:document.getElementById('day-filter')?.value||'',
      serviceDateCore:typeof window.ProofV2?.requestedServiceDay==='function'
    })`);
    if (state.ready === 'complete' && state.day && state.input && state.serviceDateCore) return state;
    await sleep(100);
  }
  throw new Error(`Proof service-date core not ready: ${JSON.stringify(await evaluate(cdp, sessionId, '({href:location.href,day:window.ProofV2?.state?.day||"",input:document.getElementById("day-filter")?.value||"",core:typeof window.ProofV2?.requestedServiceDay})'))}`);
}

async function main() {
  const today = bangkokDay();
  const prior = addDays(today, -1);
  const cases = [
    ['DEFAULT_CURRENT', '', today],
    ['EXPLICIT_CURRENT', `date=${today}`, today],
    ['EXPLICIT_PRIOR', `date=${prior}`, prior],
    ['INVALID_FALLBACK', 'date=2026-02-30', today],
  ];

  const { child, profile, version } = await launch();
  const cdp = new CDP(version.webSocketDebuggerUrl);
  try {
    await cdp.connect();
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Network.enable', {}, sessionId);
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
    await cdp.send('Network.setBypassServiceWorker', { bypass: true }, sessionId);

    for (const [name, query, expected] of cases) {
      const suffix = [query, `serviceDateSmoke=${Date.now()}-${name}`].filter(Boolean).join('&');
      await cdp.send('Page.navigate', { url: `${ORIGIN}/proof.html?${suffix}` }, sessionId);
      const state = await waitProofCore(cdp, sessionId);
      const browser = await evaluate(cdp, sessionId, `({
        href:location.href,
        search:location.search,
        dateParam:new URLSearchParams(location.search).get('date')||'',
        requested:window.ProofV2.requestedServiceDay(),
        day:window.ProofV2.state.day,
        input:document.getElementById('day-filter').value
      })`);
      assert.equal(browser.day, expected, `${name}: state day mismatch`);
      assert.equal(browser.input, expected, `${name}: date input mismatch`);
      if (name.startsWith('EXPLICIT_')) {
        assert.equal(browser.dateParam, expected, `${name}: URL date changed`);
        assert.equal(browser.requested, expected, `${name}: requested service date changed`);
      }
      if (name === 'DEFAULT_CURRENT') assert.equal(browser.requested, '', `${name}: default must not invent a service date`);
      if (name === 'INVALID_FALLBACK') {
        assert.equal(browser.dateParam, '2026-02-30', `${name}: diagnostic URL date unexpectedly rewritten`);
        assert.equal(browser.requested, '', `${name}: invalid date must be rejected`);
      }
      console.log(`PROOF_SERVICE_DATE_${name}=PASS`);
    }

    const mutationMethods = cdp.events
      .filter(event => event.method === 'Network.requestWillBeSent')
      .map(event => event.params?.request?.method)
      .filter(method => method && !['GET', 'HEAD', 'OPTIONS'].includes(method));
    assert.deepEqual(mutationMethods, [], 'Proof date smoke emitted a mutation HTTP method');
    console.log(`PROOF_SERVICE_DATE_BANGKOK_CURRENT=${today}`);
    console.log(`PROOF_SERVICE_DATE_PRIOR=${prior}`);
    console.log('PROOF_SERVICE_DATE_BROWSER_MUTATIONS=0');
    console.log('MS_MUTATION_TESTED=NO');
    console.log('PRODUCTION_TOUCHED=NO');
  } finally {
    cdp.close();
    child.kill('SIGTERM');
    await sleep(300);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
