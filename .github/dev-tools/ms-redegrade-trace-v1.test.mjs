import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createMsRedegradeTrace, patchMsRedegradeTraceFrontendFinal, patchMsRedegradeTraceWorker } from './patch-ms-redegrade-trace-v1.mjs';
import { stageFrontend } from './stage-dev-runtime.mjs';
const root = path.resolve(import.meta.dirname, '../..');
const canonical = fs.readFileSync(path.join(root, 'ms.js'), 'utf8');
const frontend = stageFrontend(canonical);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-redegrade-test-'));
for (const file of fs.readdirSync(root).filter(file => /\.(html|css)$/.test(file) || file === 'ms.js'))
  fs.copyFileSync(path.join(root, file), path.join(dir, file));
fs.copyFileSync(path.join(root, 'worker/src/index.js'), path.join(dir, 'index.js'));
execFileSync(process.execPath, [path.join(root, '.github/dev-tools/stage-dev-runtime.mjs'), path.join(dir, 'ms.js'), path.join(dir, 'index.js')], { timeout: 30000, stdio: 'pipe' });
const worker = fs.readFileSync(path.join(dir, 'index.js'), 'utf8');
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));

function frontHarness(host = 'waiting-trucks-report-api-dev.26nak-testdev.workers.dev', hub = 'NE1') {
  let renders = [], classifications = 0, apiCalls = 0;
  const state = { branch: hub, auth: { token: 'SECRET' }, msStatus: 'synced', msSnapshotDatabaseDegraded: false, lastSync: '2026-10-06T15:22:00.000Z', syncError: '' };
  const ctx = { state, location: { hostname: host }, performance: { now: () => 10 }, document: {}, realtimeSocket: null,
    handleRealtimeMessage(raw) { const payload = JSON.parse(raw); if (payload.type === 'snapshot') ctx.applyLiveResult(payload, true); },
    applyLiveResult(value) { state.msStatus = value.msStatus; state.syncError = value.syncError; state.msSnapshotDatabaseDegraded = ctx.msDatabaseSnapshotFailure(value); ctx.msTraceFlagTransition(); if (state.msSnapshotDatabaseDegraded) ctx.showMsDatabaseReadStatus(); else ctx.connection(true); return 'SAME_RESULT'; },
    msDatabaseSnapshotFailure(value) { classifications++; const code = value?.errorCode || value?.code || ''; return code === 'DB_SNAPSHOT_READ_ERROR' || code.startsWith('TURSO_'); },
    connection(ok) { renders.push(ok ? 'green' : 'offline'); return 7; }, showMsDatabaseReadStatus() { renders.push('db'); return 8; }, renderFreshness() { return 9; },
    apiGet: async () => { apiCalls++; return { msStatus: 'synced', syncError: '', errorCode: '' }; }, Error,
  };
  vm.createContext(ctx);
  vm.runInContext(frontend.slice(frontend.indexOf('// MS_REDEGRADE_TRACE_V1_FRONTEND')), ctx);
  return { ctx, state, renders, counters: () => ({ classifications, apiCalls }) };
}

function workerHarness(dev = true) {
  let reads = 0, fail = false;
  const env = { DEV_ACCEPTANCE_TELEMETRY: dev ? '1' : '0' };
  const ctx = { performance: { now: () => 20 }, hubSettingsCache: new Map(), hubSettingsActive: new Map(),
    readSettings: async () => { reads++; if (fail) throw Object.assign(new Error('SECRET exception'), { code: 'TURSO_HEAVY_READ_GUARD' }); return { msVehicleLimits: [] }; } };
  vm.createContext(ctx);
  vm.runInContext(worker.slice(worker.indexOf('// MS_REDEGRADE_TRACE_V1_WORKER')) + '\nglobalThis.envelope = msTraceEnvelope; globalThis.settings = msTraceSettingsRead;', ctx);
  return { ctx, env, reads: () => reads, fail: () => { fail = true; } };
}

test('trace is inert outside DEV and canonical Production has no trace', () => {
  const trace = createMsRedegradeTrace(false, () => 0);
  assert.equal(trace.record('TRACE_INIT', { token: 'SECRET' }), null);
  assert.equal(trace.snapshot().events.length, 0);
  const h = frontHarness('production.example'); assert.equal(h.ctx.msRedegradeTraceV1, undefined);
  assert.equal(h.ctx.connection(true), 7); assert.deepEqual(h.renders, ['green']);
  assert.doesNotMatch(canonical, /MS_REDEGRADE_TRACE_V1/);
  const backend = workerHarness(false); assert.deepEqual(JSON.parse(JSON.stringify(backend.ctx.envelope(backend.env, 'NE1', 'STREAM_SNAPSHOT', {}))), {});
});

test('64-event ring preserves first transition and preceding events after sustained traffic', () => {
  let clock = 100; const trace = createMsRedegradeTrace(true, () => clock++);
  for (let n = 0; n < 20; n++) trace.record('TRACE_INIT');
  const first = trace.record('STATE_CHANGE', { msSnapshotDatabaseDegradedBefore: false, msSnapshotDatabaseDegradedAfter: true });
  for (let n = 0; n < 300; n++) trace.record('STATE_CHANGE', { msSnapshotDatabaseDegradedBefore: false, msSnapshotDatabaseDegradedAfter: true });
  const output = trace.snapshot(); assert.equal(output.events.length, 64);
  assert.equal(output.events.filter(event => event.marker === 'FIRST_REDEGRADE').length, 1);
  assert.equal(output.firstRedegradeSequence, first.sequence);
  assert.ok(output.events.some(event => event.sequence === first.sequence - 16));
  assert.ok(output.events.every(event => event.relativeMs >= 0));
  output.events[0].eventType = 'MUTATED'; assert.notEqual(trace.snapshot().events[0].eventType, 'MUTATED');
});

test('safe projection drops secrets, messages, rows and arbitrary codes', () => {
  const trace = createMsRedegradeTrace(true, () => 0);
  trace.record('HTTP_ERROR', { hub: 'NE1', errorCode: 'TURSO_SECRET_TOKEN', syncError: 'SECRET', rows: [{ token: 'SECRET' }], token: 'SECRET', sql: 'SECRET', lastAcceptedSourceTimestamp: 'SECRET', backendDatabaseFallback: 'SECRET' });
  const result = JSON.stringify(trace.snapshot()); assert.doesNotMatch(result, /SECRET|"rows"|"token"|"sql"|"syncError"/);
  assert.equal(trace.snapshot().events[0].errorCode, 'TURSO_OTHER');
  assert.equal(trace.snapshot().events[0].backendDatabaseFallback, null);
});

test('stable socket/listener identities distinguish simultaneous instances and replacements', () => {
  const h = frontHarness(), a = {}, b = {};
  h.ctx.msTraceSocket(a, 'SOCKET_CREATE'); h.ctx.msTraceSocket(a, 'SOCKET_OPEN'); h.ctx.msTraceSocket(b, 'SOCKET_CREATE'); h.ctx.msTraceSocket(a, 'SOCKET_CLOSE');
  const events = h.ctx.msRedegradeTraceV1().events.filter(event => event.eventSource === 'SOCKET');
  assert.equal(events[0].socketInstanceId, events[1].socketInstanceId);
  assert.equal(events[0].listenerInstanceId, events[3].listenerInstanceId);
  assert.notEqual(events[0].socketInstanceId, events[2].socketInstanceId);
  assert.notEqual(events[0].listenerInstanceId, events[2].listenerInstanceId);
});

for (const hub of ['NE1', 'EA2', 'FUTURE_A']) test(`${hub}: accepted push then settings-error stream records first re-degrade without changing truth`, async () => {
  const h = frontHarness(undefined, hub), backend = workerHarness();
  const accepted = { type: 'snapshot', msStatus: 'synced', syncError: '', errorCode: '', rows: [{ secret: 'SECRET' }], ...backend.ctx.envelope(backend.env, hub, 'ACCEPTED_PUSH', { status: 'synced' }) };
  h.ctx.handleRealtimeMessage(JSON.stringify(accepted));
  backend.fail(); await assert.rejects(backend.ctx.settings(backend.env, hub), { code: 'TURSO_HEAVY_READ_GUARD' });
  const degraded = { type: 'snapshot', msStatus: 'degraded', errorCode: 'TURSO_HEAVY_READ_GUARD', syncError: 'SECRET', rows: accepted.rows,
    ...backend.ctx.envelope(backend.env, hub, 'STREAM_SNAPSHOT', { msStatus: 'degraded', errorCode: 'TURSO_HEAVY_READ_GUARD' }) };
  h.ctx.handleRealtimeMessage(JSON.stringify(degraded));
  const output = h.ctx.msRedegradeTraceV1(), first = output.events.find(event => event.marker === 'FIRST_REDEGRADE');
  assert.equal(first.eventSource, 'STREAM_SNAPSHOT'); assert.equal(first.errorCode, 'TURSO_HEAVY_READ_GUARD');
  assert.equal(first.msSnapshotDatabaseDegradedBefore, false); assert.equal(first.msSnapshotDatabaseDegradedAfter, true);
  assert.ok(output.events.some(event => event.eventType === 'SETTINGS_READ_ERROR' && event.snapshotReadOk === false));
  assert.ok(output.events.some(event => event.eventType === 'ACCEPTED_PUSH'));
  assert.equal(first.backendDatabaseFallback, null); assert.equal(first.realtimeDatabaseFallback, null);
  assert.equal(h.state.msSnapshotDatabaseDegraded, true); assert.deepEqual(h.renders, ['green', 'db']);
  assert.doesNotMatch(JSON.stringify(output), /SECRET/); assert.equal(backend.reads(), 1);
  h.ctx.handleRealtimeMessage(JSON.stringify(degraded)); assert.equal(h.ctx.msRedegradeTraceV1().firstRedegradeSequence, first.sequence);
  h.ctx.handleRealtimeMessage(JSON.stringify(accepted)); assert.equal(h.state.msSnapshotDatabaseDegraded, false); assert.equal(h.renders.at(-1), 'green');
});

test('HTTP result/error observation uses only original request and preserves return/throw', async () => {
  const h = frontHarness(); const result = await h.ctx.apiGet('msRoutes', { branch: 'NE1' });
  assert.equal(result.msStatus, 'synced'); assert.equal(h.counters().apiCalls, 1);
  assert.ok(h.ctx.msRedegradeTraceV1().events.some(event => event.eventType === 'HTTP_RESULT'));
  assert.equal(h.ctx.connection(false), 7); assert.equal(h.ctx.renderFreshness(), 9); assert.equal(h.ctx.showMsDatabaseReadStatus(), 8);
});

test('settings and snapshot outcomes, leader replay and live cache boundaries compose exactly', () => {
  assert.match(worker, /msTraceRead\(env, branch, "SNAPSHOT_READ", "LIVE_CACHE_HUB"/);
  assert.match(worker, /msTraceReadEvent\(env, hub, "SNAPSHOT_READ_ERROR"/);
  assert.match(worker, /msTraceEnvelope\(this.env, nextAttachment.branch, "LEADER_REPLAY"/);
  assert.match(worker, /msTraceEnvelope\(this.env, branch, "ACCEPTED_PUSH"/);
  assert.match(worker, /msTraceEnvelope\(this.env, branch, "STREAM_SNAPSHOT"/);
  assert.equal(patchMsRedegradeTraceWorker(worker), worker);
  assert.equal(patchMsRedegradeTraceFrontendFinal(frontend), frontend);
  assert.match(worker, /pollMs: 4000/); assert.match(frontend, /else connection\(true\)/);
});

test('diagnostic code owns zero network, provider, history, storage writes or timers', () => {
  const code = frontend.slice(frontend.indexOf('// MS_REDEGRADE_TRACE_V1_FRONTEND')) + worker.slice(worker.indexOf('// MS_REDEGRADE_TRACE_V1_WORKER'));
  assert.doesNotMatch(code, /\bfetch\s*\(|new WebSocket\s*\(|setInterval\s*\(|setTimeout\s*\(|\.DB\.prepare\s*\(|\.storage\.(put|delete)\s*\(|localStorage|sessionStorage|apiPost\s*\(|curl_pno|msPno|tbrProvenance|INSERT|UPDATE|DELETE FROM/);
});

test('authenticated readonly surface hides and clears its displayed copy on logout', () => {
  const h = frontHarness();
  const nodes = [];
  h.ctx.document = {
    body: { append: node => nodes.push(node) },
    getElementById: id => nodes.find(node => node.id === id),
    createElement: tag => ({ tag, style: {}, children: [], callbacks: {},
      append(...children) { this.children.push(...children); }, setAttribute() {},
      addEventListener(name, fn) { this.callbacks[name] = fn; },
      querySelector(tag) { return this.children.find(node => node.tag === tag); } }),
  };
  h.ctx.connection(true);
  const card = nodes[0]; assert.equal(card.hidden, false); card.open = true; card.callbacks.toggle();
  assert.equal(card.querySelector('textarea').readOnly, true);
  assert.match(card.querySelector('textarea').value, /MS_REDEGRADE_TRACE_V1/);
  assert.doesNotMatch(card.querySelector('textarea').value, /SECRET/);
  h.state.auth = null; h.ctx.connection(false);
  assert.equal(card.hidden, true); assert.equal(card.querySelector('textarea').value, '');
});

test('settings success, missing snapshot and error are distinct and diagnostic never retries', async () => {
  const h = workerHarness(); const value = await h.ctx.settings(h.env, 'NE1');
  assert.deepEqual(JSON.parse(JSON.stringify(value)), { msVehicleLimits: [] });
  assert.equal(h.reads(), 1);
  vm.runInContext('globalThis.observeRead = msTraceRead;', h.ctx);
  assert.equal(await h.ctx.observeRead(h.env, 'NE1', 'SNAPSHOT_READ', 'LIVE_CACHE_HUB', async () => null), null);
  const error = Object.assign(new Error('SECRET'), { code: 'TURSO_LIVE_TIMEOUT' });
  await assert.rejects(h.ctx.observeRead(h.env, 'NE1', 'SNAPSHOT_READ', 'LIVE_CACHE_HUB', async () => { throw error; }), found => found === error);
  const events = h.ctx.envelope(h.env, 'NE1', 'STREAM_SNAPSHOT', {}).msRedegradeTrace.events;
  assert.ok(events.some(event => event.eventType === 'SETTINGS_READ_OK' && event.snapshotReadOk === true));
  assert.ok(events.some(event => event.eventType === 'SNAPSHOT_READ_OK' && event.snapshotReadOk === false));
  assert.ok(events.some(event => event.eventType === 'SNAPSHOT_READ_ERROR' && event.errorCode === 'TURSO_LIVE_TIMEOUT'));
  assert.doesNotMatch(JSON.stringify(events), /SECRET/);
});

test('render/classifier instrumentation preserves flag, syncError, accepted time and status', () => {
  const h = frontHarness(); const original = JSON.stringify(h.state);
  assert.equal(h.ctx.msDatabaseSnapshotFailure({ errorCode: 'TURSO_LIVE_TIMEOUT', message: 'SECRET' }), true);
  assert.equal(h.ctx.msDatabaseSnapshotFailure({ errorCode: 'MS_STREAM_ERROR', code: 'TURSO_LIVE_TIMEOUT' }), false);
  h.ctx.connection(true); h.ctx.showMsDatabaseReadStatus(); h.ctx.renderFreshness();
  assert.equal(JSON.stringify(h.state), original);
  assert.equal(h.ctx.msRedegradeTraceV1().firstRedegradeSequence, null);
  assert.ok(h.ctx.msRedegradeTraceV1().events.some(event => event.eventType === 'RENDER_HEALTHY'));
  assert.ok(h.ctx.msRedegradeTraceV1().events.some(event => event.eventType === 'RENDER_DB_WARNING'));
});

test('payload metadata remains HUB-scoped; absent authoritative fallback flags remain null', () => {
  const h = workerHarness();
  h.ctx.envelope(h.env, 'EA2', 'ACCEPTED_PUSH', { status: 'synced' });
  const envelope = h.ctx.envelope(h.env, 'NE1', 'STREAM_SNAPSHOT', { msStatus: 'degraded' }, { settingsReadAttempted: true, settingsReadOk: false, settingsErrorCode: 'TURSO_LIVE_TIMEOUT' });
  assert.ok(envelope.msRedegradeTrace.events.every(event => event.hub === 'NE1'));
  const last = envelope.msRedegradeTrace.events.at(-1);
  assert.equal(last.settingsReadOk, false); assert.equal(last.settingsErrorCode, 'TURSO_LIVE_TIMEOUT');
  assert.equal(last.backendDatabaseFallback, null); assert.equal(last.realtimeDatabaseFallback, null);
  assert.match(worker, /\.first\(\)\),\s*msTraceSettingsRead\(env, branch\)/);
});
