import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { parseMsHar } from './patch-ms-resilience-v1.mjs';
import { TursoD1Database } from '../../worker/src/turso-d1.js';
import { appendOriginManifestFrontend } from '../../worker/src/origin-manifest-v1.js';

const root = path.resolve(import.meta.dirname, '../..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-resilience-test-'));
for (const file of fs.readdirSync(root).filter((file) => /\.(html|css)$/.test(file) || file === 'ms.js'))
  fs.copyFileSync(path.join(root, file), path.join(dir, file));
fs.copyFileSync(path.join(root, 'worker/src/index.js'), path.join(dir, 'index.js'));
execFileSync(process.execPath, [path.join(root, '.github/dev-tools/stage-dev-runtime.mjs'), path.join(dir, 'ms.js'), path.join(dir, 'index.js')], { timeout: 30_000, stdio: 'pipe' });
const worker = fs.readFileSync(path.join(dir, 'index.js'), 'utf8');
const frontend = fs.readFileSync(path.join(dir, 'ms.js'), 'utf8');
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
function between(source, begin, end) {
  const start = source.indexOf(begin), finish = source.indexOf(end, start + begin.length);
  assert.ok(start >= 0 && finish > start, begin);
  return source.slice(start, finish);
}
const helpers = worker.slice(worker.indexOf('const msOptionalAccepted = new Map();'));
const refresh = between(worker, 'async function runMsRefresh(', '\nasync function ');
const coordinator = between(worker, 'export class MsRefreshCoordinator', '\n// MS_CRON_LIVE_REFRESH_V1').replace('export class', 'class');
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };

function liveHarness() {
  let routeCalls = 0, dbReads = 0, statusWrites = 0;
  const bus = deferred(), pre = deferred(), route = deferred(), background = [], messages = [];
  const prior = { id: 'r1', proofId: 'p1', attendanceType: 'ปลายทาง', unloadingState: 1, scheduleTbrArrivalAt: '', expectedParcels: 5 };
  const context = {
    Map, Set, Promise, Date, Error, TypeError, Proxy, Object, Array, Number, String,
    setTimeout, clearTimeout, console: { error() {}, warn() {} },
    MS_SYNC_TTL: 3000, MS_LIVE_CACHE_VERSION: 'completion-v2', MS_REPAIR_POLICY_VERSION: 6,
    MS_REALTIME_SOURCE_MIN_MS: 3000, MS_CRON_ACTIVE_SKIP_MS: 45000,
    MS_ROUTE_QUOTA_GUARD_KEY: 'quota', recentMsSync: new Map(), busTimeRouteHints: new Map(),
    OriginManifestCoordinator: class {},
    msCredentials: async () => ({}),
    readMsRoutes: async () => { routeCalls++; return route.promise; },
    readPreEntryCounts: () => pre.promise, readBusTimeData: () => bus.promise,
    liveSourceDays: () => ['2026-10-02'], mapMsRow: (row) => ({ ...row }),
    markAuxiliaryOccurrenceAmbiguity() {}, supervisorRefreshSourceTelemetry: () => ({}),
    msTbrShadowFeed: () => [], normalizeProofId: (value) => value,
    normalizeMsAttendance: (value) => value, text: (value) => String(value || ''), date: (value) => value,
    enrichMsRow: (row, parcels, busData) => ({ ...row,
      ...(parcels.get(row.proofId) || {}), ...(busData.get(row.proofId) || {}) }),
    msQueueFirstSourceRows: (rows) => rows, attachPnoViewMetadata: (rows) => rows,
    holdTransientEmptyMsSource: async () => null, sha: async () => 'hash', canonicalMsSource: () => 'rows',
    readMsLiveCache: async () => { dbReads++; return { sourceMatch: true, format: 7, rows: [prior], completedDay: 'today', completedRows: [], syncedAt: 'old' }; },
    thaiDay: () => 'today', mergeCompletedToday: () => [],
    safeStatusWrite: async (promise) => promise,
    markConnectionSuccess: async () => { statusWrites++; }, markConnectionError: async () => { statusWrites++; },
    registerPnoPassiveRoutes: async () => {},
  };
  vm.createContext(context);
  vm.runInContext(helpers + '\n' + refresh + '\n' + coordinator + '\nglobalThis.Coordinator = MsRefreshCoordinator;', context);
  const storage = new Map();
  const socket = { deserializeAttachment: () => ({ branch: 'NE1' }), send: (message) => messages.push(JSON.parse(message)) };
  const ctx = { storage: { get: async (key) => storage.get(key), put: async (key, value) => storage.set(key, value), delete: async (key) => storage.delete(key) },
    blockConcurrencyWhile: (fn) => background.push(fn()), waitUntil: (task) => background.push(task), getWebSockets: () => [socket] };
  const owner = new context.Coordinator(ctx, {});
  owner.loadRepairState = async () => {};
  owner.recordRepairResult = async () => {};
  owner.repairView = () => ({});
  owner.publishSupervisorSnapshot = async () => {};
  owner.lastSnapshotPayload = { type: 'snapshot', standards: [], lastSync: 'old', rows: [prior] };
  owner.lastSnapshotBranch = 'NE1';
  return { context, owner, bus, pre, route, messages, prior,
    stats: () => ({ routeCalls, dbReads, statusWrites }),
    background, routeSuccess: () => route.resolve([prior]) };
}

test('exact final DEV composition preserves cadence, timeout and source-truth locks', () => {
  assert.match(frontend, /pollMs: 4000/);
  assert.match(worker, /PREENTRY_SOURCE_TTL_MS = 60 \* 1000/);
  assert.match(worker, /UPSTREAM_FETCH_TIMEOUT_MS = 9000/);
  assert.doesNotMatch(refresh, /await Promise\.all/);
  assert.match(refresh, /startMsOptionalRefresh/);
  assert.match(worker, /MS_OPTIONAL_NONBLOCKING_V1/);
  assert.match(fs.readFileSync(path.join(root, 'ms-v4.css'), 'utf8'), /#fff0d6/);
});

for (const name of ['busTime', 'preEntry']) test(`slow ${name} cannot delay Route publication and its completion broadcasts without another Route read`, async () => {
  const h = liveHarness();
  const task = h.owner.refresh('NE1');
  await flush();
  h.routeSuccess();
  const accepted = await task;
  assert.equal(accepted.status, 'synced');
  assert.equal(h.stats().routeCalls, 1);
  assert.ok(h.messages.length > 0);
  const before = h.messages.length;
  const fields = name === 'busTime' ? { scheduleTbrArrivalAt: 'fresh-tbr' } : { expectedParcels: 10 };
  h[name === 'busTime' ? 'bus' : 'pre'].resolve(new Map([['p1', fields]]));
  await flush();
  assert.ok(h.messages.length > before);
  const row = h.messages.at(-1).rows[0];
  assert.equal(row[Object.keys(fields)[0]], Object.values(fields)[0]);
  assert.equal(h.stats().routeCalls, 1);
  assert.equal(h.messages.at(-1).lastSync, accepted.syncedAt);
});

test('100 active Route viewers receive accepted rows immediately and exactly one completion replaces/broadcasts them', async () => {
  const h = liveHarness();
  h.owner.lastResult = { rows: [h.prior], syncedAt: 'original' };
  const pending = h.owner.refresh('NE1');
  await flush();
  assert.equal(h.stats().routeCalls, 1);
  const results = await Promise.all(Array.from({ length: 100 }, () => h.owner.refresh('NE1')));
  assert.ok(results.every((item) => item.syncedAt === 'original'));
  assert.equal(h.stats().routeCalls, 1);
  h.routeSuccess(); await pending;
  assert.equal(h.owner.active, null);
  assert.equal(h.messages.at(-1).msStatus, 'synced');
});

test('optional completion merges onto latest Route lifecycle and never revives a removed identity', async () => {
  const h = liveHarness();
  const task = h.owner.refresh('NE1'); await flush(); h.routeSuccess(); await task;
  h.owner.lastResult = { ...h.owner.lastResult, rows: [{ id: 'r2', proofId: 'p2', unloadingState: 2 }] };
  h.bus.resolve(new Map([['p1', { unloadingState: 0, scheduleTbrArrivalAt: 'old-identity' }]]));
  await flush();
  assert.equal(h.owner.lastResult.rows.length, 1);
  assert.equal(h.owner.lastResult.rows[0].id, 'r2');
  assert.equal(h.owner.lastResult.rows[0].unloadingState, 2);
});

for (const kind of ['failed', 'partial', 'ambiguous']) test(`optional ${kind} evidence preserves accepted enrichment`, async () => {
  const h = liveHarness();
  h.prior.scheduleTbrArrivalAt = 'accepted';
  const task = h.owner.refresh('NE1'); await flush(); h.routeSuccess(); await task;
  const data = new Map([['p1', { expectedParcels: 0, scheduleTbrArrivalAt: '' }]]);
  if (kind === 'failed') data.sourceFailed = true;
  if (kind === 'partial') data.partialProofs = new Set(['p1']);
  if (kind === 'ambiguous') data.ambiguousKeys = new Set(['P:p1|A:ปลายทาง']);
  h[kind === 'partial' ? 'pre' : 'bus'].resolve(data); await flush();
  assert.equal(h.owner.lastResult.rows[0].scheduleTbrArrivalAt, 'accepted');
  assert.equal(h.owner.lastResult.rows[0].expectedParcels, 5);
});

for (const status of [500, 502, 503, 504, 524]) test(`JSON Turso HTTP ${status} has status metadata and uses accepted continuity with no second read/write`, async () => {
  const db = new TursoD1Database({ url: 'https://db.invalid', authToken: 'mock', fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'unavailable' } }), { status }) });
  let error;
  try { await db.prepare('SELECT 1').all(); } catch (value) { error = value; }
  assert.equal(error.code, 'TURSO_HTTP_ERROR'); assert.equal(error.status, status);
  const h = liveHarness();
  const old = { rows: [h.prior], syncedAt: 'original' };
  h.context.recentMsSync.set('NE1', { result: old });
  let reads = 0;
  h.context.msCredentials = async () => { reads++; throw error; };
  const result = await h.context.runMsRefresh({}, 'NE1');
  assert.equal(result.status, 'degraded'); assert.equal(result.syncedAt, 'original');
  assert.equal(reads, 1); assert.equal(h.stats().dbReads, 0); assert.equal(h.stats().statusWrites, 0);
});

for (const status of [400, 401, 403]) test(`Turso HTTP ${status} is not transient availability`, async () => {
  const h = liveHarness();
  assert.equal(h.context.msTursoAvailability({ code: 'TURSO_HTTP_ERROR', status }), false);
});

for (const error of [
  { code: 'TURSO_NETWORK_ERROR', message: 'network' },
  { code: 'TURSO_PROTOCOL_ERROR', message: 'Turso returned an unreadable response (502)' },
]) test(`${error.code} continuity preserves original timestamp`, async () => {
  const h = liveHarness(); h.context.msCredentials = async () => { throw error; };
  h.context.recentMsSync.set('NE1', { result: { rows: [h.prior], syncedAt: 'original' } });
  const result = await h.context.runMsRefresh({}, 'NE1');
  assert.equal(result.syncedAt, 'original'); assert.equal(result.status, 'degraded');
  assert.equal(h.stats().dbReads, 0); assert.equal(h.stats().statusWrites, 0);
});

test('live Turso deadline is 2800ms, blocks subsequent work after timeout and leaves administrative adapter unchanged', async () => {
  const h = liveHarness(); let timer, timeoutMs, calls = 0;
  h.context.setTimeout = (fn, ms) => { timer = fn; timeoutMs = ms; return 1; };
  h.context.clearTimeout = () => {};
  const database = { _pipeline: () => { calls++; return new Promise(() => {}); } };
  const env = h.context.msLiveDatabaseEnv({ DB: database });
  const requests = [{ type: 'execute', stmt: { sql: 'SELECT 1' } }];
  const task = env.DB._pipeline(requests);
  assert.ok(timeoutMs <= 2800 && timeoutMs > 0 && timeoutMs < 4000);
  timer(); await assert.rejects(task, { code: 'TURSO_LIVE_TIMEOUT' });
  await assert.rejects(env.DB._pipeline(requests), { code: 'TURSO_LIVE_TIMEOUT' });
  await assert.rejects(env.DB._pipeline([{ type: 'execute', stmt: { sql: 'UPDATE status SET x=1' } }]), { code: 'TURSO_LIVE_TIMEOUT' });
  assert.equal(calls, 1);
  database._pipeline(requests); assert.equal(calls, 2);
});

const liveSql = {
  credential_db_read: 'SELECT session_cipher,device_cipher FROM ms_connections WHERE hub=?',
  live_cache_read: 'SELECT source_hash,rows_json FROM ms_live_cache WHERE hub=?',
  route_state_read: 'SELECT * FROM ms_routes WHERE hub=?',
  route_batch_write: 'INSERT OR REPLACE INTO ms_routes(id,hub) VALUES(?,?)',
  audit_write: 'INSERT INTO audit_log(timestamp,action) VALUES(?,?)',
  live_cache_write: 'INSERT INTO ms_live_cache(hub,source_hash) VALUES(?,?)',
  connection_status_write: "UPDATE ms_connections SET last_success_at=?,last_error='' WHERE hub=?",
};
const execute = (sql, args = []) => [{ type: 'execute', stmt: { sql, args } }, { type: 'close' }];

for (const [stage, sql] of Object.entries(liveSql)) {
  test('live DB timeout trace identifies ' + stage + ' from SQL without values', async () => {
    const h = liveHarness();
    let expire;
    h.context.setTimeout = (fn) => { expire = fn; return 1; };
    h.context.clearTimeout = () => {};
    const db = { _pipeline: () => new Promise(() => {}) };
    const env = h.context.msLiveDatabaseEnv({ DB: db });
    const task = env.DB._pipeline(execute(sql, ['SECRET_SESSION', 'PRIVATE_DRIVER']));
    expire();
    await assert.rejects(task, (error) => {
      assert.equal(error.code, 'TURSO_LIVE_TIMEOUT');
      assert.equal(error.dbTrace.failureStage, stage);
      assert.equal(error.dbTrace.pipelineSequence, 1);
      assert.equal(error.dbTrace.statementCountTotal, 1);
      assert.equal(error.dbTrace.pipelines.length, 1);
      assert.equal(error.dbTrace.pipelines[0].timedOut, true);
      assert.doesNotMatch(JSON.stringify(error.dbTrace), /SECRET_SESSION|PRIVATE_DRIVER|SELECT|INSERT|UPDATE/);
      return true;
    });
  });
}

test('cumulative fast pipelines identify the exact later timeout and bound trace to twelve entries', async () => {
  const h = liveHarness();
  let clock = 0;
  h.context.Date = class extends Date { static now() { return clock; } };
  h.context.setTimeout = () => 1;
  h.context.clearTimeout = () => {};
  const db = { _pipeline: async () => { clock += 200; return { results: [] }; } };
  const env = h.context.msLiveDatabaseEnv({ DB: db });
  for (let i = 0; i < 14; i++) await env.DB._pipeline(execute(liveSql.live_cache_read));
  await assert.rejects(env.DB._pipeline(execute(liveSql.connection_status_write)), (error) => {
    assert.equal(error.code, 'TURSO_LIVE_TIMEOUT');
    assert.equal(error.dbTrace.failureStage, 'connection_status_write');
    assert.equal(error.dbTrace.pipelineCount, 15);
    assert.equal(error.dbTrace.statementCountTotal, 15);
    assert.equal(error.dbTrace.pipelines.length, 12);
    assert.equal(error.dbTrace.pipelines[0].sequence, 4);
    return true;
  });
});

test('timed-out Route transaction keeps the existing late rollback behavior and stage', async () => {
  const h = liveHarness();
  let expire, resolvePipeline, rollback = 0;
  h.context.setTimeout = (fn) => { expire = fn; return 1; };
  h.context.clearTimeout = () => {};
  const db = {
    _pipeline: () => new Promise((resolve) => { resolvePipeline = resolve; }),
    _finishTransaction: async (_payload, command) => { if (command === 'ROLLBACK') rollback++; },
  };
  const env = h.context.msLiveDatabaseEnv({ DB: db });
  const task = env.DB._pipeline([
    { type: 'execute', stmt: { sql: 'BEGIN IMMEDIATE' } },
    { type: 'execute', stmt: { sql: 'INSERT INTO ms_route_history VALUES(?)', args: ['PRIVATE'] } },
  ]);
  expire();
  await assert.rejects(task, (error) => {
    assert.equal(error.dbTrace.failureStage, 'route_batch_write');
    assert.equal(error.dbTrace.transaction, true);
    return true;
  });
  resolvePipeline({ baton: 'opaque', results: [] });
  await flush();
  assert.equal(rollback, 1);
});

test('credential timeout reaches repair outcome without an extra DB read', async () => {
  const h = liveHarness();
  const dbTrace = { failureStage: 'credential_db_read', pipelineSequence: 1 };
  h.context.msCredentials = async () => { throw Object.assign(new Error('deadline'), { code: 'TURSO_LIVE_TIMEOUT', dbTrace }); };
  const result = await h.context.runMsRefresh({}, 'NE1');
  assert.equal(result.status, 'degraded');
  assert.equal(result.errorCode, 'TURSO_LIVE_TIMEOUT');
  assert.equal(result.dbTrace, dbTrace);
  assert.equal(h.stats().dbReads, 0);
});

test('cache timeout reaches repair outcome while preserving accepted timestamp', async () => {
  const h = liveHarness();
  const dbTrace = { failureStage: 'live_cache_read', pipelineSequence: 2 };
  h.context.recentMsSync.set('NE1', { result: { rows: [h.prior], syncedAt: 'genuine-old' } });
  h.context.readMsLiveCache = async () => { throw Object.assign(new Error('deadline'), { code: 'TURSO_LIVE_TIMEOUT', dbTrace }); };
  const task = h.context.runMsRefresh({}, 'NE1');
  await flush(); h.routeSuccess();
  const result = await task;
  assert.equal(result.status, 'degraded');
  assert.equal(result.syncedAt, 'genuine-old');
  assert.equal(result.dbTrace, dbTrace);
  assert.equal(result.errorCode, 'TURSO_LIVE_TIMEOUT');
});

test('administrative database adapter remains independent of the scoped live deadline', async () => {
  const h = liveHarness(); let timers = 0;
  h.context.setTimeout = () => { timers++; };
  const database = { _pipeline: async () => 'transaction-finished' };
  h.context.msLiveDatabaseEnv({ DB: database });
  assert.equal(await database._pipeline([{ type: 'execute', stmt: { sql: 'BEGIN' } }]), 'transaction-finished');
  assert.equal(timers, 0);
});

for (const raw of ['{"log":{"entries":[', '{', 'null', '{}', '{"log":{"entries":{}}}']) test(`malformed HAR (${raw.length} chars) has stable local guidance`, () => {
  assert.throws(() => parseMsHar(raw), (error) => error.code === 'LOCAL_HAR_INVALID' &&
    error.message === 'ไฟล์ HAR ไม่สมบูรณ์หรือบันทึกมาไม่ครบ กรุณาบันทึก HAR ใหม่' && !/JSON|position|Unterminated/.test(error.message));
});

test('all shared HAR save paths parse locally before any save/refresh; LH Manifest uses the same DEV parser', async () => {
  const save = between(frontend, 'async function saveMsConnection(', '\nfunction ');
  assert.ok(save.indexOf('parseMsHar(await file.text())') < save.indexOf('await apiPost('));
  const proof = between(frontend, 'async function saveProofHarConnection(', '\n// ');
  assert.ok(proof.indexOf('parseMsHar(await file.text())') < proof.indexOf('await apiPost('));
  const appended = await (await appendOriginManifestFrontend(new Response(frontend))).text();
  assert.doesNotMatch(appended, /JSON\.parse\(await file\.text\(\)\)/);
  assert.equal((appended.match(/parseMsHar\(await file.text\(\)\)/g) || []).length, 3);
  for (const type of ['Route', 'PreEntry', 'BusTime', 'HBI']) assert.deepEqual(parseMsHar(JSON.stringify({ log: { entries: [{ type }] } })).log.entries, [{ type }]);
});

function harSaveHarness(raw, source) {
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, { value: id === 'ms-har-hub' ? 'NE1' : '', textContent: '',
      classList: { add() {}, remove() {} }, files: [{ size: raw.length, text: async () => raw }] });
    return nodes.get(id);
  };
  const calls = [], health = { connected: true, credential: 'existing', lastSuccessAt: 'original' };
  let refreshes = 0, providerCalls = 0, observations = 0;
  const context = { URL, Set, JSON, String, Number, Array, Object, Error,
    atob, parseMsHar, el: node, document: { getElementById: node },
    state: { branch: 'NE1', health }, nf: new Intl.NumberFormat('en-US'),
    apiPost: async (action, body) => { calls.push({ action, body }); return { total: 1, seedCount: 1 }; },
    loadData: async () => { refreshes++; }, loadMsConnectionStatus: async () => {},
    loadManifestStatus: async () => {}, toast() {}, clearPnoBrowserCacheForHub() {}, resetPendingParcelModal() {},
    reportMsConnectionObservation: async () => { observations++; }, loadMsConnectionObservedError: async () => {},
    msConnectionDisplayError: (error) => error.message, fetch: () => { providerCalls++; throw new Error('unexpected provider call'); },
  };
  vm.createContext(context);
  const save = between(frontend, 'async function saveMsConnection(', '\nfunction exportCurrent(');
  const proof = between(frontend, 'async function saveProofHarConnection(', '\nfunction pnoV18ResolveOpenArgs(');
  const busHelpers = between(frontend, 'function harResponseJson(', '\nasync function saveMsConnection(');
  vm.runInContext(save + '\n' + proof + '\n' + busHelpers, context);
  return { context, node, health, calls, stats: () => ({ refreshes, providerCalls, observations }),
    save: async () => {
      const button = { disabled: false };
      if (source === 'proof') await context.saveProofHarConnection(button);
      else await context.saveMsConnection(source, button);
      assert.equal(button.disabled, false);
    } };
}

for (const source of ['routes', 'preEntry', 'busTime', 'hbiPhotos', 'proof']) test(`${source}: truncated HAR executes zero saves, providers, refreshes and preserves connection health`, async () => {
  const h = harSaveHarness('{"log":{"entries":[', source), previous = structuredClone(h.health);
  await h.save();
  assert.equal(h.calls.length, 0); assert.deepEqual(h.stats(), { refreshes: 0, providerCalls: 0, observations: 0 });
  assert.deepEqual(h.health, previous);
  assert.equal(h.node('ms-connection-error').textContent, 'ไฟล์ HAR ไม่สมบูรณ์หรือบันทึกมาไม่ครบ กรุณาบันทึก HAR ใหม่');
});

const mockHeaders = [{ name: 'x-fle-session-id', value: 'mock-session' }, { name: 'x-device-id', value: 'mock-device' }];
const validEntries = {
  routes: { request: { url: 'https://ms-api.flashexpress.com/gw/nws/staff/ms/store/line/task', headers: mockHeaders }, response: { status: 200 } },
  preEntry: { request: { url: 'https://fbi.flashexpress.com/api/route/route_followstart?auth=mock&fbid=mock&time=mock' }, response: { status: 200 } },
  busTime: { request: { url: 'https://fbi.flashexpress.com/api/fleet_time/getList?auth=mock&fbid=mock&time=mock' }, response: { status: 200, content: { text: JSON.stringify({ code: 1, data: { dataList: [{ proof_id: [{ value: 'p1' }], next_store_info: [{ value: 'NE1' }, { value: 'ปลายทาง' }], fleet_sign_info: [{ value: '2026-10-02T00:00:00Z' }] }] } }) } } },
  hbiPhotos: { request: { method: 'GET', url: 'https://hbi-common.flashexpress.com/api/fleet/loadInfoList?auth=mock&fbid=mock&time=mock&webSign=hbi' }, response: { status: 200, content: { text: '{"code":1}' } } },
};
for (const source of Object.keys(validEntries)) test(`${source}: valid HAR preserves its save API and successful seed behavior`, async () => {
  const h = harSaveHarness(JSON.stringify({ log: { entries: [validEntries[source]] } }), source);
  await h.save(); assert.equal(h.calls.length, 1); assert.equal(h.stats().providerCalls, 0);
  assert.equal(h.calls[0].action, { routes: 'saveMsConnection', preEntry: 'saveMsPreEntryConnection', busTime: 'saveMsBusConnection', hbiPhotos: 'saveMsHbiConnection' }[source]);
  if (source === 'busTime') assert.equal(h.calls[0].body.seedItems[0].fleet_sign_info[0].value, '2026-10-02T00:00:00Z');
});

test('late live transaction response is rolled back rather than committed after the deadline', async () => {
  const h = liveHarness(), pending = deferred(); let timer, rolledBack = 0;
  h.context.setTimeout = (fn) => { timer = fn; return 1; }; h.context.clearTimeout = () => {};
  const env = h.context.msLiveDatabaseEnv({ DB: { _pipeline: () => pending.promise,
    _finishTransaction: async (_payload, command) => { assert.equal(command, 'ROLLBACK'); rolledBack++; } } });
  const task = env.DB._pipeline([{ type: 'execute', stmt: { sql: 'BEGIN IMMEDIATE' } }]);
  timer(); await assert.rejects(task, { code: 'TURSO_LIVE_TIMEOUT' });
  pending.resolve({ baton: 'mock' }); await flush(); assert.equal(rolledBack, 1);
});

test('automatic BusTime calls from worker isolates use the existing per-HUB coordinator; Map metadata survives transport', async () => {
  const h = liveHarness(); let calls = 0;
  h.context.Request = Request; h.context.encodeURIComponent = encodeURIComponent;
  h.context.msCoordinatorIdentity = (hub) => hub + ':runtime-v2';
  const map = Object.assign(new Map([['p1', { scheduleTbrArrivalAt: 'accepted' }]]), { sourceFailed: false, ambiguousKeys: new Set(['x']) });
  const env = { MS_REFRESH_COORDINATOR: { idFromName: (key) => { assert.equal(key, 'NE1:runtime-v2'); return key; }, get: () => ({ fetch: async (request) => {
    calls++; assert.ok(request.url.includes('/optional-bus?branch=NE1'));
    return Response.json(h.context.msSerializeOptionalMap(map));
  } }) } };
  const result = await h.context.msSharedBusRequest(env, 'NE1', { days: ['2026-10-02'] });
  assert.equal(calls, 1); assert.equal(result.get('p1').scheduleTbrArrivalAt, 'accepted');
  assert.ok(result.ambiguousKeys.has('x')); assert.equal(result.sourceFailed, false);
  assert.match(worker, /env\.MS_REFRESH_COORDINATOR && !env\.BUS_TIME_SLOT_STORE/);
});

class Node {
  constructor(html = '') { this.html = html; this.children = []; this.classList = { add() {}, remove() {}, toggle() {} }; this.value = ''; this.clears = 0; }
  set innerHTML(value) { this.clears++; this.html = value; this.children = []; }
  get innerHTML() { return this.html; }
  insertBefore(node, before) { node.remove(); const index = before ? this.children.indexOf(before) : this.children.length; this.children.splice(index, 0, node); node.parent = this; }
  remove() { if (this.parent) { const index = this.parent.children.indexOf(this); this.parent.children.splice(index, 1); this.parent = null; } }
  replaceWith(node) { const parent = this.parent; if (parent) { const index = parent.children.indexOf(this); parent.children[index] = node; node.parent = parent; this.parent = null; } }
}
function renderHarness(mobile = false, source = frontend) {
  const table = new Node(), cards = new Node(), select = new Node(), frames = [];
  let recreated = 0;
  for (const target of [table, cards]) target.insertAdjacentHTML = (_position, html) => {
    for (const fragment of html.match(/<(tr|article)>[\s\S]*?<\/\1>/g) || []) {
      recreated++; target.insertBefore(new Node(fragment), null);
    }
  };
  const context = { Map, Set, String, Math,
    rowRenderGeneration: 0, isPhoneDesktopSiteLayout: () => false, useMobileCardLayout: () => mobile,
    el: (id) => id === 'table-body' ? table : id === 'mobile-cards' ? cards : select,
    tableRow: (row) => `<tr>${row.id}:${row.value}</tr>`, card: (row) => `<article>${row.id}:${row.value}</article>`,
    esc: (value) => value,
    document: { documentElement: new Node(), createRange: () => ({ selectNodeContents() {}, createContextualFragment: (html) => { recreated++; return { firstElementChild: new Node(html) }; } }) },
    requestAnimationFrame: (fn) => frames.push(fn),
  };
  vm.createContext(context);
  vm.runInContext(between(source, 'function renderRowsProgressively(', '\nfunction completedTodayDatasetKey(') + '\n' + between(source, 'function setOptions(', '\nfunction '), context);
  return { context, table, cards, select, target: mobile ? cards : table,
    render(rows) { context.renderRowsProgressively(rows); while (frames.length) frames.shift()(); },
    recreated: () => recreated, frames };
}

for (const mobile of [false, true]) {
  const label = mobile ? 'mobile' : 'desktop';
  test(`${label}: unchanged 4-second snapshot has zero full clears and zero recreated nodes`, () => {
    const h = renderHarness(mobile), rows = Array.from({ length: 100 }, (_, i) => ({ id: String(i), value: i }));
    h.render(rows); const original = [...h.target.children], created = h.recreated();
    h.render(structuredClone(rows));
    assert.equal(h.table.clears, 0); assert.equal(h.cards.clears, 0);
    assert.equal(h.recreated(), created); assert.deepEqual(h.target.children, original);
  });
  test(`${label}: one changed row patches one identity without a full rebuild`, () => {
    const h = renderHarness(mobile), rows = [{ id: '1', value: 1 }, { id: '2', value: 2 }];
    h.render(rows); const unchanged = h.target.children[0];
    h.render([rows[0], { ...rows[1], value: 3 }]);
    assert.equal(h.recreated(), 3); assert.equal(h.target.children[0], unchanged);
    assert.equal(h.target.clears, 0);
  });
  test(`${label}: insertion, removal and filter reordering preserve the list root and retained nodes`, () => {
    const h = renderHarness(mobile), rows = [{ id: '1', value: 1 }, { id: '2', value: 2 }];
    h.render(rows); const one = h.target.children[0];
    h.render([rows[1], rows[0], { id: '3', value: 3 }]);
    assert.equal(h.target.children[1], one); assert.equal(h.recreated(), 3);
    h.render([rows[0]]); assert.equal(h.target.children.length, 1); assert.equal(h.target.children[0], one);
    assert.equal(h.target.clears, 0);
  });
  test(`${label}: initial progressive batch remains bounded and a newer snapshot cancels stale pumps`, () => {
    const h = renderHarness(mobile), rows = Array.from({ length: 300 }, (_, i) => ({ id: String(i), value: i }));
    h.context.renderRowsProgressively(rows);
    assert.equal(h.target.children.length, mobile ? 32 : 64);
    h.render([rows[299]]); assert.equal(h.target.children.length, 1);
    assert.ok(h.target.children[0].html.includes('299'));
  });
}

test('filter options change only with the option set; existing selection survives routine snapshots', () => {
  const h = renderHarness();
  assert.equal(h.context.setOptions('attendance-filter', ['A', 'B'], 'B'), 'B');
  const writes = h.select.clears;
  assert.equal(h.context.setOptions('attendance-filter', ['B', 'A', 'A'], 'B'), 'B');
  assert.equal(h.select.clears, writes); assert.equal(h.select.value, 'B');
  h.context.setOptions('attendance-filter', ['B', 'C'], 'B'); assert.equal(h.select.clears, writes + 1);
  assert.equal(h.context.setOptions('attendance-filter', ['C'], 'B'), 'all');
});

test('unchanged four-filter snapshots avoid all option rewrites and changed metrics update only their own value', () => {
  const nodes = new Map(), node = (id) => { if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id); };
  function run(source) {
    nodes.clear();
    const context = { state: { rows: [{ attendanceType: 'A', routeAttribute: 'X', region: 'R', routeType: 'T' }],
      attendance: 'all', attribute: 'all', region: 'all', route: 'all' }, Set, String, el: node, esc: (value) => value,
      normalizeAttendance: (value) => value };
    vm.createContext(context);
    vm.runInContext(between(source, 'function fillFilters(', '\nfunction fillBranches(') + '\n' + between(source, 'function setOptions(', '\nfunction '), context);
    context.fillFilters(); const before = [...nodes.values()].reduce((total, item) => total + item.clears, 0);
    context.fillFilters(); return [...nodes.values()].reduce((total, item) => total + item.clears, 0) - before;
  }
  assert.equal(run(fs.readFileSync(path.join(root, 'ms.js'), 'utf8')), 4);
  assert.equal(run(frontend), 0);
  let writes = 0, text = '';
  const metric = { get textContent() { return text; }, set textContent(value) { text = value; writes++; } };
  const context = { el: () => metric, nf: new Intl.NumberFormat('en-US') };
  vm.createContext(context); vm.runInContext(between(frontend, 'function setMetric(', '\nfunction planCell('), context);
  context.setMetric('metric-total', 5); context.setMetric('metric-total', 5); assert.equal(writes, 1);
  context.setMetric('metric-total', 6); assert.equal(writes, 2); assert.equal(text, '6');
});

test('branch selector options and selection stay stable during equivalent HTTP snapshots', () => {
  const select = new Node(), context = { Set, state: { branch: 'NE1' }, el: () => select, esc: (value) => value };
  vm.createContext(context); vm.runInContext(between(frontend, 'function fillBranches(', '\nfunction setOptions('), context);
  context.fillBranches(['NE1', 'EA1']); context.fillBranches(['EA1', 'NE1']);
  assert.equal(select.clears, 1); assert.equal(select.value, 'NE1');
});

test('operation counters compare exact baseline list rendering with incremental DEV rendering', () => {
  const baseline = fs.readFileSync(path.join(root, 'ms.js'), 'utf8');
  const rows = Array.from({ length: 100 }, (_, index) => ({ id: String(index), value: index }));
  const before = renderHarness(false, baseline), after = renderHarness(false);
  before.render(rows); after.render(rows);
  const oldNodes = before.recreated(), newNodes = after.recreated();
  before.render(rows); after.render(rows);
  const result = { before: { tableClears: before.table.clears - 1, mobileClears: before.cards.clears - 1, recreated: before.recreated() - oldNodes },
    after: { tableClears: after.table.clears, mobileClears: after.cards.clears, recreated: after.recreated() - newNodes } };
  assert.deepEqual(result, { before: { tableClears: 1, mobileClears: 1, recreated: 100 }, after: { tableClears: 0, mobileClears: 0, recreated: 0 } });
});

test('summary controls, counts and handler identities remain stable during routine numeric updates', () => {
  function buttonsFromHtml(html) {
    return [...html.matchAll(/<button[^>]*class="([^"]*)"[^>]*data-summary-status="([^"]*)"[^>]*>([\s\S]*?)<\/button>/g)].map((match) => ({
      className: match[1], dataset: { summaryStatus: match[2] }, labels: Object.fromEntries(['span', 'strong'].map((tag) => [tag, { textContent: match[3].match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>'))?.[1] || '' }])),
      querySelector(tag) { return this.labels[tag]; },
    }));
  }
  const rootNode = { writes: 0, classList: { remove() {} },
    set innerHTML(html) { this.writes++; this.buttons = buttonsFromHtml(html); },
    querySelectorAll() { return this.buttons; },
    querySelector(selector) { return this.buttons.find((button) => selector.includes('"' + button.dataset.summaryStatus + '"')); } };
  const context = { Object, Number, nf: new Intl.NumberFormat('en-US'),
    el: () => rootNode, state: { currentRows: [{ unloadingState: 0 }], summary: 'all', cancelledToday: 0 },
    matchesOvertimeContext: () => true, matchesCompletedContext: () => true,
    completedTodayDatasetRows: () => [], completedTodayOvertimeRows: () => [], expired12hCurrentRows: () => [],
    queueInfo: () => ({ active: true }), inboundOperationalStage: (row) => row.unloadingState === 1 ? 'unloading' : 'waiting',
    isOrigin: () => false, isCancelledToday: () => false, isDestination: () => true, isDrop: () => false,
    render() {}, document: { createElement: () => ({ set innerHTML(html) { this.content = { querySelectorAll: () => buttonsFromHtml(html) }; } }) },
  };
  vm.createContext(context);
  vm.runInContext(between(frontend, 'function renderFilterSummary(', '\nasync function applyMetricFilter(') + '\n' +
    between(frontend, 'function updateMsSummary(', '\n// TBR_PROVENANCE_DEV_UI_V1'), context);
  context.renderFilterSummary(context.state.currentRows);
  const nodes = [...rootNode.buttons], handlers = nodes.map((node) => node.onclick);
  context.renderFilterSummary(context.state.currentRows);
  assert.equal(rootNode.writes, 1);
  context.state.currentRows[0].unloadingState = 1;
  context.renderFilterSummary(context.state.currentRows);
  assert.equal(rootNode.writes, 1); assert.deepEqual(rootNode.buttons, nodes);
  assert.deepEqual(rootNode.buttons.map((node) => node.onclick), handlers);
  assert.equal(rootNode.buttons.find((node) => node.dataset.summaryStatus === 'unloading').querySelector('strong').textContent, '1');
  assert.equal(rootNode.buttons.find((node) => node.dataset.summaryStatus === 'waiting').querySelector('strong').textContent, '0');
});

test('search input and scroll state are outside keyed reconciliation and summary listeners bind only once', () => {
  const renderer = between(frontend, 'function renderRowsProgressively(', '\nfunction completedTodayDatasetKey(');
  assert.doesNotMatch(renderer, /search-input|scrollTop|scrollTo|tableBody.innerHTML|mobileCards.innerHTML/);
  const summary = between(frontend, 'function renderFilterSummary(', '\nasync function applyMetricFilter(');
  assert.ok(summary.indexOf('updateMsSummary') < summary.indexOf('button.onclick'));
  assert.match(frontend, /before\.textContent !== after\.textContent/);
});
