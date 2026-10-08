import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import vm from 'node:vm';
import { createMsRouteSourcePageTimingTrace, patchMsRouteSourcePageTimingWorker, patchMsRouteSourcePageTimingFrontend, sanitizeMsRouteSourceTimingSnapshot } from './patch-ms-route-source-page-timing-v1.mjs';
import { createMsCriticalPathPhaseTrace } from './patch-ms-turso-critical-path-phase-v1.mjs';
import { createMsLateSettleTrace } from './patch-ms-turso-late-settle-v1.mjs';
import { createMsTursoProducerTrace } from './patch-ms-turso-timeout-producer-v1.mjs';

const root = new URL('../../', import.meta.url);
const staged = readFileSync(new URL('ms.js', root), 'utf8');
const temporary = mkdtempSync(join(tmpdir(), 'ms-route-timing-test-'));
for (const file of ['ms.js', 'ms.html', 'proof.html', 'ms-report.html', 'style.css']) copyFileSync(new URL(file, root), join(temporary, file));
copyFileSync(new URL('worker/src/index.js', root), join(temporary, 'index.js'));
execFileSync(process.execPath, [new URL('./stage-dev-runtime.mjs', import.meta.url).pathname, join(temporary, 'ms.js'), join(temporary, 'index.js')], { stdio: 'pipe' });
const stagedCurrent = readFileSync(join(temporary, 'index.js'), 'utf8');
const frontendCurrent = readFileSync(join(temporary, 'ms.js'), 'utf8');
process.on('exit', () => rmSync(temporary, { recursive: true, force: true }));
function fn(source, name) {
  const start = source.indexOf('async function ' + name + '(');
  assert.ok(start >= 0, name);
  const end = source.indexOf('\n}\n', start);
  assert.ok(end > start, name);
  return source.slice(start, end + 2);
}

function fixture({ pages = 1, errorPage = 0, timeoutPage = 0, parseMs = 17, fetchMs = 80, credentialMs = 35 } = {}) {
  let now = 0, requestCount = 0, dbCount = 0;
  const trace = createMsRouteSourcePageTimingTrace(() => now);
  const context = {
    URL, Math, Number, Array, Promise, Date,
    msRouteTimingTrace: trace,
    msRouteTimingSafe(fn) { try { return fn(); } catch { return null; } },
    MS_ROUTE_PAGE_CONCURRENCY: 1, MS_ROUTE_PAGE_BATCH_DELAY_MS: 120,
    msBrowserRequestHeaders: () => ({}),
    fetchWithTimeout: async url => {
      requestCount++;
      const page = Number(url.searchParams.get('pageNum'));
      now += fetchMs;
      if (page === timeoutPage) throw Object.assign(new Error('PRIVATE_URL_TOKEN'), { code: 'UPSTREAM_TIMEOUT' });
      return { ok: true, json: async () => { now += parseMs;
        if (page === errorPage) return { code: 429, message: 'PRIVATE_PERSON' };
        return { code: 1, data: { items: Array.from({ length: page === pages ? 1 : 100 }, () => ({ proofId: 'PRIVATE_PROOF' })), pagination: { total_count: (pages - 1) * 100 + 1 } } };
      } };
    },
    classifyMsRouteFailure: () => ({ code: 'MS_ROUTE_RATE_LIMIT', status: 429 }),
    fail(message, code) { throw Object.assign(new Error(message), { code }); },
    msRouteTimingCredential: async (owner, read) => {
      const started = trace.credentialStart();
      try { const result = await read(); trace.credentialEnd(owner, started); return result; }
      catch (e) { trace.credentialEnd(owner, started, e); throw e; }
    },
    msRouteTimingSource: async (owner, read) => {
      const started = trace.sourceStart();
      try { const rows = await read(); trace.sourceEnd(owner, started, rows); return rows; }
      catch (e) { trace.sourceEnd(owner, started, null, e); throw e; }
    },
    msRouteTimingHash: async (owner, calculate) => { const started = trace.hashStart();
      try { const value = await calculate(); trace.hashEnd(owner, started); return value; }
      catch (e) { trace.hashEnd(owner, started, e); throw e; } },
    msCredentialCache: new Map(), MS_CREDENTIAL_CACHE_MS: 600000,
    text: value => String(value || ''), decryptMs: async value => value,
    env: { DB: { prepare: () => ({ bind: () => ({ first: async () => { dbCount++; now += credentialMs;
      return { session_cipher: 'PRIVATE_TOKEN', device_cipher: 'PRIVATE_DEVICE' }; } }) }) } },
    setTimeout(callback, ms) { now += ms; callback(); },
  };
  vm.createContext(context);
  return { context, trace, get now() { return now; }, get requestCount() { return requestCount; }, get dbCount() { return dbCount; } };
}


async function run(f, id = 1) {
  const x = f.context;
  vm.runInContext(fn(stagedCurrent, 'msCredentials') + '\n' + fn(stagedCurrent, 'readMsPage') + '\n' + fn(stagedCurrent, 'readMsRoutes'), x);
  const owner = f.trace.begin('NE1', id);
  const credentials = await x.msRouteTimingCredential(owner, () => x.msCredentials(x.env, 'NE1', owner));
  const rows = await x.msRouteTimingSource(owner, () => x.readMsRoutes(credentials, undefined, undefined, owner));
  if (!rows.routeSourceError) {
    await x.msRouteTimingHash(owner, async () => { x.hashCalls = (x.hashCalls || 0) + 1; return 'PRIVATE_HASH'; });
    f.trace.match(owner, true);
  }
  return rows;
}

test('one page: existing request and credential read, separately observed fetch/parse/hash and same-hash acceptance', async () => {
  const f = fixture(); await run(f); const r = f.trace.snapshot().records[0];
  assert.equal(f.requestCount, 1); assert.equal(f.dbCount, 1); assert.equal(f.context.hashCalls, 1);
  assert.equal(r.credential.cache, 'MISS'); assert.equal(r.credential.durationMs, 35);
  assert.equal(r.pages.length, 1); assert.equal(r.pages[0].fetchToHeadersMs, 80); assert.equal(r.pages[0].parseMs, 17);
  assert.equal(r.pages[0].durationMs, 97); assert.equal(r.sourceDurationMs, 97); assert.equal(r.totalItems, 1);
  assert.equal(r.acquisitionDurationMs, 132);
  assert.equal(r.pageCount, 1); assert.equal(r.reportedTotal, 1); assert.equal(r.hashDurationMs, 0);
  assert.equal(r.sourceMatch, true); assert.equal(r.outcome, 'SUCCESS');
});

test('three sequential pages retain existing pacing, count, freshness and credential cache hit', async () => {
  const f = fixture({ pages: 3 }); await run(f, 1); await run(f, 2);
  const [first, second] = f.trace.snapshot().records;
  assert.equal(f.requestCount, 6); assert.equal(f.dbCount, 1);
  assert.equal(second.credential.cache, 'HIT'); assert.equal(second.credential.durationMs, 0);
  assert.equal(first.pacingCount, 1); assert.equal(first.pacingDurationMs, 120);
  assert.equal(first.sourceDurationMs, 3 * 97 + 120);
  assert.equal(first.pageCount, 3); assert.equal(first.totalItems, 201);
  assert.deepEqual(Array.from(first.pages, p => p.page), [1, 2, 3]);
});

test('provider error and original timeout remain errors without retry or secret leakage', async () => {
  for (const option of [{ errorPage: 2 }, { timeoutPage: 2 }]) {
    const f = fixture({ pages: 3, ...option }); const rows = await run(f);
    assert.equal(f.requestCount, 2); assert.equal(f.dbCount, 1);
    assert.equal(f.trace.snapshot().records[0].outcome, 'ERROR');
    assert.equal(f.trace.snapshot().records[0].pages[1].errorCategory, option.timeoutPage ? 'UPSTREAM_TIMEOUT' : 'RATE_LIMIT');
    assert.ok(rows.routeSourceError);
    assert.doesNotMatch(JSON.stringify(f.trace.snapshot()), /PRIVATE_|session_cipher|device_cipher|url|query|proofId|sql/i);
  }
});

test('unobservable timings stay explicit and malformed Worker fields are discarded at browser boundary', () => {
  const trace = createMsRouteSourcePageTimingTrace(() => 0);
  const a = trace.begin('NE1', 1); trace.sourceEnd(a, 0, []); trace.match(a, true);
  const safe = sanitizeMsRouteSourceTimingSnapshot({ ...trace.snapshot(), records: [{ ...trace.snapshot().records[0], token: 'PRIVATE_TOKEN', pages: [{ page: 1, sql: 'PRIVATE_SQL' }] }] }, 'NE1');
  assert.equal(safe.records[0].pages[0].fetchToHeadersMs, null);
  assert.ok(safe.unobservable.includes('BODY_CONSUMPTION_VS_JSON_PARSE'));
  assert.doesNotMatch(JSON.stringify(safe), /PRIVATE_|token|sql/i);
});

test('overlapping owners and bounded records never mix page data or grow either diagnostic ring', () => {
  const trace = createMsRouteSourcePageTimingTrace(() => 0);
  const a = trace.begin('NE1', 1), b = trace.begin('SW1', 2);
  const p = trace.pageStart(a, 1); trace.pageEnd(p); trace.sourceEnd(b, 0, []); trace.match(b, false);
  trace.sourceEnd(a, 0, []); trace.match(a, true);
  assert.equal(trace.snapshot().records[0].pages.length, 0);
  assert.equal(trace.snapshot().records[1].pages.length, 1);
  for (let id = 3; id <= 30; id++) { const owner = trace.begin('NE1', id); trace.match(owner, true); }
  assert.equal(trace.snapshot().records.length, 8);
  const owner = trace.begin('NE1', 31);
  for (let page = 1; page <= 40; page++) trace.pageStart(owner, page);
  trace.match(owner, true); assert.equal(trace.snapshot().records.at(-1).pages.length, 20);
  const active = Array.from({ length: 8 }, (_, n) => trace.begin('NE1', n + 50));
  assert.equal(trace.begin('NE1', 60), null);
  active.forEach(o => trace.match(o, true));
});

test('in-band snapshot retains valid timing across unrelated payloads and clears on HUB switch', async () => {
  const phase = createMsCriticalPathPhaseTrace(() => 0);
  const late = createMsLateSettleTrace();
  phase.record('LOCAL_DEADLINE_EXPIRED', { hub: 'NE1', refreshInstanceId: 1 });
  late.record('LOCAL_DEADLINE_EXPIRED', { hub: 'NE1', refreshInstanceId: 1 });
  const ctx = {
    state: { branch: 'NE1' }, location: { hostname: 'waiting-trucks-report-api-dev.26nak-testdev.workers.dev' },
    performance: { now: () => 0 }, document: { body: { append() {} }, getElementById: () => null,
      createElement: tag => ({ tag, style: {}, children: [], append(...children) { this.children.push(...children); },
        setAttribute() {}, addEventListener() {}, querySelector() { return null; } }) },
    handleRealtimeMessage: () => 'original', applyLiveResult: () => 'original', apiGet: async () => ({ status: 'synced' }), authUi: () => 'original',
  };
  const declaration = frontendCurrent.slice(frontendCurrent.indexOf('function msTursoProducerFrontend()'));
  vm.createContext(ctx);
  vm.runInContext([createMsTursoProducerTrace, createMsLateSettleTrace, createMsCriticalPathPhaseTrace, sanitizeMsRouteSourceTimingSnapshot]
    .map(fn => fn.toString()).join('\n') + '\n' + declaration.slice(0, declaration.indexOf('\n}') + 2) + '\nmsTursoProducerFrontend();', ctx);
  const safe = { name: 'MS_ROUTE_SOURCE_PAGE_TIMING_V1', records: [
    { hub: 'NE1', refreshInstanceId: 17, sourceDurationMs: 97, token: 'PRIVATE_TOKEN', pages: [{ page: 1, fetchToHeadersMs: 80, sql: 'PRIVATE_SQL' }] },
    { hub: 'SW1', refreshInstanceId: 18, sourceDurationMs: 99, pages: [] },
  ] };
  assert.equal(ctx.handleRealtimeMessage(JSON.stringify({ msRouteSourcePageTimingTrace: safe })), 'original');
  const exported = ctx.msTursoTimeoutProducerV1();
  assert.equal(exported.routeSourceTiming.records.length, 1);
  assert.equal(exported.routeSourceTiming.records[0].sourceDurationMs, 97);
  assert.doesNotMatch(JSON.stringify(exported), /PRIVATE_|SW1/);
  assert.equal(exported.routeSourceTiming.name, 'MS_ROUTE_SOURCE_PAGE_TIMING_V1');
  assert.equal(exported.criticalPath.name, 'MS_TURSO_CRITICAL_PATH_PHASE_V1');
  assert.ok(exported.lateSettle);
  assert.equal(ctx.handleRealtimeMessage(JSON.stringify({ status: 'synced' })), 'original');
  assert.equal(ctx.msTursoTimeoutProducerV1().routeSourceTiming.records.length, 1);
  assert.equal(ctx.applyLiveResult({ status: 'synced' }), 'original');
  assert.equal(ctx.msTursoTimeoutProducerV1().routeSourceTiming.records.length, 1);
  await ctx.apiGet('mockResponseWithoutTrace');
  assert.equal(ctx.msTursoTimeoutProducerV1().routeSourceTiming.records.length, 1);
  for (const malformed of [null, {}, { name: 'WRONG', records: [] }, { name: 'MS_ROUTE_SOURCE_PAGE_TIMING_V1', records: null }]) {
    ctx.handleRealtimeMessage(JSON.stringify({ msRouteSourcePageTimingTrace: malformed }));
    assert.equal(ctx.msTursoTimeoutProducerV1().routeSourceTiming.records.length, 1);
  }
  ctx.state.branch = 'SW1';
  assert.equal(ctx.msTursoTimeoutProducerV1().routeSourceTiming.records.length, 0);
  ctx.handleRealtimeMessage(JSON.stringify({ status: 'synced' }));
  assert.equal(ctx.msTursoTimeoutProducerV1().routeSourceTiming.records.length, 0);
  ctx.handleRealtimeMessage(JSON.stringify({ msRouteSourcePageTimingTrace: safe }));
  assert.equal(ctx.msTursoTimeoutProducerV1().routeSourceTiming.records[0].hub, 'SW1');
  assert.doesNotMatch(JSON.stringify(ctx.msTursoTimeoutProducerV1().routeSourceTiming), /NE1|PRIVATE_/);
  assert.equal(phase.snapshot().events.length, 1);
  assert.equal(late.snapshot().events.length, 1);
});

test('staging is idempotent, follows critical path, preserves late settle and changes no request contract', () => {
  assert.equal(patchMsRouteSourcePageTimingWorker(stagedCurrent), stagedCurrent);
  assert.equal(patchMsRouteSourcePageTimingFrontend(frontendCurrent), frontendCurrent);
  for (const marker of ['MS_TURSO_CRITICAL_PATH_PHASE_V1_WORKER', 'MS_TURSO_LATE_SETTLE_V1']) assert.match(stagedCurrent, new RegExp(marker));
  assert.match(stagedCurrent, /msRouteSourcePageTimingTrace: msRouteTimingSnapshot\(hub\)/);
  assert.match(frontendCurrent, /routeSourceTiming: currentMsRouteSourceTiming\(\), lateSettle:/);
  assert.match(stagedCurrent, /MS_ROUTE_PAGE_CONCURRENCY = 1/);
  assert.match(stagedCurrent, /MS_ROUTE_PAGE_BATCH_DELAY_MS = 120/);
  assert.match(stagedCurrent, /UPSTREAM_FETCH_TIMEOUT_MS = 9000/);
  assert.equal((stagedCurrent.match(/fetchWithTimeout\(url, \{ headers: msBrowserRequestHeaders\(credentials\) \}\)/g) || []).length,
    1);
});
