import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createMsCriticalPathPhaseTrace, patchMsCriticalPathAdapter, patchMsCriticalPathWorker, patchMsCriticalPathFrontend } from './patch-ms-turso-critical-path-phase-v1.mjs';
import { planMsChanges, sameMsRouteCore, resolveCompletionTruth } from '../../worker/src/sync-policy.js';
import { createMsLateSettleTrace } from './patch-ms-turso-late-settle-v1.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-phase-'));
// Offline baseline uses the SAME accepted patch stack, omitting only this new
// final observer. No Git history/network dependency, no tracked input mutation.
const baselineRoot = path.join(dir, 'baseline');
fs.mkdirSync(baselineRoot);
for (const name of ['.github/dev-tools', 'cloudflare-browser-test/scripts', 'worker/scripts', 'worker/src']) fs.cpSync(path.join(root, name), path.join(baselineRoot, name), { recursive: true });
for (const file of fs.readdirSync(root).filter(file => /\.(html|css)$/.test(file) || file === 'ms.js')) {
  fs.copyFileSync(path.join(root, file), path.join(dir, file));
  fs.copyFileSync(path.join(root, file), path.join(baselineRoot, file));
}
const composerPath = path.join(baselineRoot, '.github/dev-tools/stage-dev-runtime.mjs');
let composer = fs.readFileSync(composerPath, 'utf8');
composer = composer.replace(/import \{ patchMsCriticalPathAdapter, patchMsCriticalPathWorker, patchMsCriticalPathFrontend \}[^\n]+\n/, '');
composer = composer.replace('  await writeFile(frontendTarget, patchMsCriticalPathFrontend(await readFile(frontendTarget, \"utf8\")), \"utf8\");\n', '');
composer = composer.replace('patchMsCriticalPathAdapter(patchMsTursoStallAdapterV1(adapter))', 'patchMsTursoStallAdapterV1(adapter)');
composer = composer.replace('patchMsCriticalPathWorker(patchMsTursoStallContainmentV1(await readFile(workerTarget, "utf8")))', 'patchMsTursoStallContainmentV1(await readFile(workerTarget, "utf8"))');
assert.doesNotMatch(composer, /patchMsCriticalPath/);
fs.writeFileSync(composerPath, composer);
fs.copyFileSync(path.join(root, 'worker/src/index.js'), path.join(dir, 'index.js'));
fs.copyFileSync(path.join(root, 'worker/src/index.js'), path.join(baselineRoot, 'index.js'));
for (const [script, target] of [[path.join(root, '.github/dev-tools/stage-dev-runtime.mjs'), dir], [composerPath, baselineRoot]])
  execFileSync(process.execPath, [script, path.join(target, 'ms.js'), path.join(target, 'index.js')], { stdio: 'pipe' });
const current = { worker: fs.readFileSync(path.join(dir, 'index.js'), 'utf8'), adapter: fs.readFileSync(path.join(dir, 'turso-d1.js'), 'utf8'), frontend: fs.readFileSync(path.join(dir, 'ms.js'), 'utf8') };
const baseline = { worker: fs.readFileSync(path.join(baselineRoot, 'index.js'), 'utf8'), adapter: fs.readFileSync(path.join(baselineRoot, 'turso-d1.js'), 'utf8'), frontend: fs.readFileSync(path.join(baselineRoot, 'ms.js'), 'utf8') };
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const requests = sql => [{ type: 'execute', stmt: { sql, args: ['PRIVATE_PARAMETER'] } }, { type: 'close' }];
function fn(worker, name) { const start = worker.indexOf('function ' + name + '('); assert.ok(start >= 0, name); const rest = worker.slice(start); return (worker.slice(start - 6, start) === 'async ' ? 'async ' : '') + rest.slice(0, rest.indexOf('\n}') + 2); }
function method(worker, name) { const start = worker.indexOf('  ' + name + '('); assert.ok(start >= 0, name); const rest = worker.slice(start); return rest.slice(0, rest.indexOf('\n  }') + 4); }
function harness(source = current, enabled = true) {
  let now = 0, timerId = 0, behavior = () => 'pending';
  const timers = new Map(), deadlines = [], calls = [], background = [], messages = [];
  const ctx = { AbortController, URL, console: { warn() {}, error() {} }, performance: { now: () => now },
    Date: class extends Date { static now() { return now; } },
    setTimeout(fn, ms) { const id = ++timerId; deadlines.push(ms); timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); }, recentMsSync: new Map(), msTraceEnvelope: () => ({}) };
  vm.createContext(ctx);
  vm.runInContext(source.adapter.replace(/export /g, '') + '\nglobalThis.Database = TursoD1Database;', ctx);
  vm.runInContext(source.worker.slice(source.worker.indexOf('// MS_TURSO_TIMEOUT_PRODUCER_V1_WORKER')) + '\n' + fn(source.worker, 'msLiveDbStage') + '\n' + fn(source.worker, 'msTursoAvailability') + '\n' + fn(source.worker, 'msLiveDatabaseEnv'), ctx);
  vm.runInContext('class Owner {\n' + method(source.worker, 'sendAcceptedSnapshot') + '\n}\nglobalThis.Owner=Owner;', ctx);
  const db = new ctx.Database({ url: 'https://mock.invalid', authToken: 'PRIVATE_TOKEN', fetchImpl: (url, init) => {
    const pending = deferred(), call = { body: JSON.parse(init.body), signal: init.signal, pending };
    call.resolve = (options = {}) => pending.resolve({ ok: options.status ? options.status < 400 : true, status: options.status || 200,
      json: async () => { if (options.parseError) throw new Error('PRIVATE_PARSE'); return options.payload || { baton: 'PRIVATE_BATON', results: call.body.requests.map(request => request.type === 'execute' ? { type: 'ok', response: { type: 'execute', result: { cols: [], rows: [], affected_row_count: 1 } } } : { type: 'ok' }) }; } });
    calls.push(call);
    const mode = behavior(call, calls.length);
    if (mode === 'fast') call.resolve();
    if (mode === 'network') pending.reject(new TypeError('PRIVATE_NETWORK'));
    if (mode !== 'ignoreAbort') init.signal?.addEventListener('abort', () => pending.reject(new DOMException('PRIVATE_ABORT', 'AbortError')), { once: true });
    return pending.promise;
  } });
  const env = { DEV_ACCEPTANCE_TELEMETRY: enabled ? '1' : '0', DB: db, MS_BACKGROUND_WAIT: task => background.push(task) };
  const run = action => ctx.msProducerRefresh(env, 'NE1', async observed => {
    try { await action(ctx.msLiveDatabaseEnv(observed).DB); return { status: 'synced', errorCode: '', rows: [], syncedAt: '2026-10-08T00:00:00.000Z' }; }
    catch (error) { return ctx.msProducerCaughtResult(observed, { status: 'degraded', errorCode: error.code, rows: [], syncedAt: '2026-10-07T00:00:00.000Z' }, error); }
  });
  const advance = async ms => { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } await flush(); };
  const trace = () => JSON.parse(JSON.stringify(ctx.msProducerTraceEnvelope(env, 'NE1').msTursoCriticalPathPhaseTrace || { events: [] }));
  const push = (result, reason = 'MAIN_REFRESH_COMPLETION', throws = false) => {
    const owner = new ctx.Owner(); owner.env = env; owner.lastResult = result; owner.lastSnapshotPayload = { rows: [], type: 'snapshot' };
    owner.ctx = { getWebSockets: () => [{ deserializeAttachment: () => ({ branch: 'NE1' }), send(raw) { if (throws) throw new Error('mock send'); messages.push(JSON.parse(raw)); } }] };
    ctx.msProducerCoordinator(env, 'NE1', result); owner.sendAcceptedSnapshot('NE1', reason);
  };
  return { ctx, env, db, calls, deadlines, timers, background, messages, run, advance, trace, push, behavior: value => { behavior = value; }, elapse: ms => { now += ms; } };
}
const allEvents = h => [...h.trace().events, ...(h.trace().refreshEvents || [])].sort((a, b) => a.sequence - b.sequence);
const phases = h => allEvents(h).map(event => event.phase);

test('final staging order, full composition and patch idempotence', () => {
  assert.equal(patchMsCriticalPathWorker(baseline.worker), current.worker);
  assert.equal(patchMsCriticalPathAdapter(baseline.adapter), current.adapter);
  assert.equal(patchMsCriticalPathFrontend(baseline.frontend), current.frontend);
  assert.equal(patchMsCriticalPathWorker(current.worker), current.worker);
  assert.equal(patchMsCriticalPathAdapter(current.adapter), current.adapter);
  assert.equal(patchMsCriticalPathFrontend(current.frontend), current.frontend);
  for (const name of ['index.js', 'turso-d1.js', 'ms.js']) execFileSync(process.execPath, ['--check', path.join(dir, name)]);
  assert.ok(current.worker.indexOf('// MS_TURSO_CRITICAL_PATH_PHASE_V1_WORKER') > current.worker.indexOf('// MS_TURSO_STALL_CONTAINMENT_V1'));
  assert.match(current.worker, /const routeScoped = stage === "route_state_read" \|\| stage === "route_batch_write"/);
  assert.match(current.worker, /let remainingBudget = 2800;[\s\S]*let routePersistenceBudget = 60_000/);
  assert.match(current.frontend, /pollMs:\s*4000/);
  assert.throws(() => patchMsCriticalPathWorker('unknown composition'), /anchor mismatch/);
});

for (const [name, sql] of [['read', 'SELECT * FROM ms_routes'], ['write', 'UPDATE ms_live_cache SET rows_json=?']]) test('successful ' + name + ' transport phases use one existing HTTP submission', async () => {
  const h = harness(); h.behavior(() => 'fast');
  const result = await h.run(db => db._pipeline(requests(sql))); h.push(result);
  assert.equal(result.status, 'synced'); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].signal.aborted, false);
  for (const phase of ['REFRESH_STARTED', 'PIPELINE_SUBMITTED', 'FETCH_STARTED', 'RESPONSE_HEADERS_RECEIVED', 'RESPONSE_PARSED', 'PIPELINE_SETTLED_SUCCESS', 'DB_ACCOUNTING', 'REFRESH_RESULT_ACCEPTED', 'PUSH_PUBLISHED']) assert.ok(phases(h).includes(phase), phase);
  assert.ok(!phases(h).includes('RESPONSE_BODY_CONSUMED'));
  assert.ok(h.trace().unobservable.includes('RESPONSE_BODY_CONSUMED'));
});

test('successful real adapter transaction acknowledges BEGIN/statements then COMMIT, in order', async () => {
  const h = harness(); h.behavior(() => 'fast');
  const result = await h.run(db => db.batch([db.prepare('UPDATE ms_routes SET value=?').bind('PRIVATE_PARAMETER')]));
  assert.equal(result.status, 'synced'); assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls.map(call => call.body.requests.filter(request => request.type === 'execute').map(request => request.stmt.sql)), [['BEGIN IMMEDIATE', 'UPDATE ms_routes SET value=?'], ['COMMIT']]);
  const p = phases(h); for (const phase of ['BEGIN_SUBMITTED', 'BEGIN_ACKNOWLEDGED', 'STATEMENTS_SUBMITTED', 'STATEMENTS_ACKNOWLEDGED', 'COMMIT_SUBMITTED', 'COMMIT_ACKNOWLEDGED']) assert.ok(p.includes(phase));
  assert.ok(p.indexOf('COMMIT_SUBMITTED') > p.indexOf('STATEMENTS_ACKNOWLEDGED')); assert.ok(!p.includes('ROLLBACK_ACKNOWLEDGED'));
});

test('submitted read deadline truth, same signal abort, current failure and truthful late error', async () => {
  const h = harness(), pending = h.run(db => db._pipeline(requests('SELECT * FROM ms_routes'))); await flush(); await h.advance(2800);
  const result = await pending; h.push(result); await Promise.all(h.background);
  assert.equal(result.errorCode, 'TURSO_LIVE_TIMEOUT'); assert.equal(result.syncedAt, '2026-10-07T00:00:00.000Z');
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].signal.aborted, true);
  assert.ok(phases(h).includes('LOCAL_DEADLINE_EXPIRED')); assert.ok(phases(h).includes('LOCAL_ABORT_REQUESTED')); assert.ok(phases(h).includes('LATE_SETTLE_ERROR'));
  const push = allEvents(h).find(event => event.phase === 'PUSH_PUBLISHED'); assert.equal(push.errorOrigin, 'CURRENT_OPERATION_FAILURE'); assert.equal(push.acceptedSourceTimestamp, result.syncedAt);
});

test('transaction local deadline never proves commit or rollback; late success triggers only existing rollback', async () => {
  const h = harness(); h.behavior(() => 'ignoreAbort');
  const pending = h.run(db => db.batch([db.prepare('UPDATE ms_routes SET value=?')])); await flush(); await h.advance(2800); await pending;
  assert.equal(h.calls.length, 1); assert.ok(phases(h).includes('TRANSACTION_OUTCOME_UNKNOWN'));
  assert.ok(!phases(h).includes('COMMIT_ACKNOWLEDGED')); assert.ok(!phases(h).includes('ROLLBACK_ACKNOWLEDGED'));
  h.calls[0].resolve(); await flush(); assert.equal(h.calls.length, 2); assert.equal(h.calls[1].body.requests[0].stmt.sql, 'ROLLBACK');
  assert.ok(phases(h).includes('LATE_SETTLE_SUCCESS')); assert.ok(phases(h).includes('ROLLBACK_SUBMITTED')); assert.ok(!phases(h).includes('ROLLBACK_ACKNOWLEDGED'));
  h.calls[1].resolve(); await flush(); await Promise.all(h.background); assert.ok(phases(h).includes('ROLLBACK_ACKNOWLEDGED')); assert.ok(!phases(h).includes('COMMIT_SUBMITTED'));
});

test('COMMIT timeout after BEGIN acknowledgement remains UNKNOWN, with no rollback fabrication', async () => {
  const h = harness(); h.behavior((call, n) => n === 1 ? 'fast' : 'pending');
  const pending = h.run(db => db.batch([db.prepare('UPDATE ms_routes SET value=?')])); await flush(); await h.advance(2800);
  assert.equal((await pending).errorCode, 'TURSO_LIVE_TIMEOUT'); await Promise.all(h.background);
  assert.equal(h.calls.length, 2); assert.ok(phases(h).includes('COMMIT_SUBMITTED')); assert.ok(!phases(h).includes('COMMIT_ACKNOWLEDGED'));
  assert.ok(phases(h).includes('TRANSACTION_OUTCOME_UNKNOWN')); assert.ok(!phases(h).includes('ROLLBACK_ACKNOWLEDGED'));
});

test('parsed SQL failure is not statements acknowledgement; real error rollback remains unchanged', async () => {
  const h = harness(), pending = h.run(db => db.batch([db.prepare('UPDATE ms_routes SET value=?')])); await flush();
  h.calls[0].resolve({ payload: { baton: 'PRIVATE_BATON', results: [{ type: 'ok' }, { type: 'error', error: { message: 'PRIVATE_SQL_ERROR' } }] } }); await flush();
  assert.equal(h.calls.length, 2); assert.equal(h.calls[1].body.requests[0].stmt.sql, 'ROLLBACK');
  h.calls[1].resolve(); const result = await pending;
  assert.equal(result.status, 'degraded'); assert.ok(phases(h).includes('ROLLBACK_ACKNOWLEDGED')); assert.ok(!phases(h).includes('STATEMENTS_ACKNOWLEDGED')); assert.ok(!phases(h).includes('COMMIT_SUBMITTED'));
});

test('an empty/malformed success result does not fabricate transaction acknowledgements', async () => {
  const h = harness(), pending = h.run(db => db._pipeline(requests('BEGIN IMMEDIATE'))); await flush(); h.calls[0].resolve({ payload: { results: [] } }); await pending;
  assert.ok(phases(h).includes('BEGIN_SUBMITTED')); assert.ok(!phases(h).includes('BEGIN_ACKNOWLEDGED'));
  h.ctx.msPhaseLate('TRANSACTION_LATE_ROLLBACK_RESULT', { hub: 'NE1', rollbackOutcome: 'SUCCESS' });
  assert.ok(!phases(h).includes('ROLLBACK_ACKNOWLEDGED'));
});

test('optional inherited failure and leader replay never create a new timeout producer', async () => {
  const h = harness(), pending = h.run(db => db._pipeline(requests('SELECT * FROM ms_routes'))); await flush(); await h.advance(2800);
  const result = await pending; h.push(result); await Promise.all(h.background);
  const before = h.ctx.msProducerTraceEnvelope(h.env, 'NE1').msTursoTimeoutProducerTrace.events.filter(event => event.eventType === 'TURSO_TIMEOUT_PRODUCED').length;
  for (const reason of ['OPTIONAL_BUSTIME', 'OPTIONAL_PREENTRY', 'LEADER_REPLAY']) h.push(result, reason);
  const after = h.ctx.msProducerTraceEnvelope(h.env, 'NE1').msTursoTimeoutProducerTrace.events.filter(event => event.eventType === 'TURSO_TIMEOUT_PRODUCED').length;
  assert.equal(before, 1); assert.equal(after, before);
  for (const event of allEvents(h).filter(event => event.phase === 'PUSH_PUBLISHED' && event.pushReason !== 'MAIN_REFRESH_COMPLETION')) assert.equal(event.errorOrigin, 'INHERITED_RESULT');
  h.push(result, 'MAIN_REFRESH_COMPLETION', true);
  assert.equal(allEvents(h).filter(event => event.phase === 'PUSH_PUBLISHED').length, 4, 'failed socket send cannot be published');
});

test('overlapping pipelines preserve independent timings and distinguish cumulative time from wall span', async () => {
  const h = harness(); const pending = h.run(async db => { const a = db._pipeline(requests('SELECT * FROM arbitrary')); h.elapse(20); const b = db._pipeline(requests('SELECT * FROM ms_routes')); await Promise.all([a, b]); });
  await flush(); h.elapse(80); h.calls[0].resolve(); await flush(); h.elapse(20); h.calls[1].resolve(); await pending;
  const entries = h.trace().events.filter(event => event.phase === 'DB_ACCOUNTING');
  assert.deepEqual(entries.map(event => event.operationElapsedMs), [100, 100]); assert.equal(entries.at(-1).cumulativeDbElapsedMs, 200); assert.equal(entries.at(-1).dbSpanElapsedMs, 120); assert.equal(entries.at(-1).refreshElapsedMs, 120);
  assert.ok(h.trace().events.some(event => event.overlap === true)); assert.notEqual(entries[0].dbOperationId, entries[1].dbOperationId);
});

test('bounded ring, monotonic relative time and closed sanitization omit all sensitive fields', () => {
  let now = 1000; const trace = createMsCriticalPathPhaseTrace(() => now);
  for (let i = 0; i < 180; i++) { now += 1; trace.record('REFRESH_STARTED', { hub: 'NE1', refreshInstanceId: i, sql: 'PRIVATE_SQL', args: ['PRIVATE_BIND'], rows: ['PRIVATE_PERSON'], proofId: 'PRIVATE_PROOF', token: 'PRIVATE_TOKEN', status: 'PRIVATE_STATUS', errorCode: 'PRIVATE_ERROR', acceptedSourceTimestamp: 'PRIVATE_TIMESTAMP' }); }
  assert.equal(trace.snapshot().refreshEvents.length, 64); assert.equal(trace.snapshot().refreshEvents.at(-1).observedAtMs, 180);
  for (let i = 0; i < 180; i++) trace.record('FETCH_STARTED', { hub: 'NE1' });
  assert.equal(trace.snapshot().events.length, 64); assert.equal(trace.snapshot().refreshEvents.length, 64);
  assert.doesNotMatch(JSON.stringify(trace.snapshot()), /PRIVATE_|sql|proofId|token/);
  trace.record('UNKNOWN_PHASE', { secret: 'PRIVATE_SECRET' }); assert.equal(trace.snapshot().events.length, 64);
});

async function scenario(source, enabled, kind) {
  const h = harness(source, enabled);
  h.behavior((call, n) => kind === 'retry' && n === 1 ? 'network' : kind === 'timeout' || kind === 'transaction-timeout' ? 'pending' : 'fast');
  const pending = h.run(db => kind.startsWith('transaction') ? db.batch([db.prepare('UPDATE ms_routes SET value=?').bind('PRIVATE_PARAMETER')]) : db._pipeline(requests(kind === 'write' ? 'UPDATE ms_live_cache SET rows_json=?' : 'SELECT * FROM ms_routes')));
  await flush(); if (kind.includes('timeout')) await h.advance(2800); const result = await pending; h.push(result); await Promise.all(h.background);
  return { bodies: h.calls.map(call => call.body), aborted: h.calls.map(call => Boolean(call.signal?.aborted)), distinctSignals: new Set(h.calls.map(call => call.signal)).size, deadlines: h.deadlines, result: JSON.parse(JSON.stringify(result)), timers: h.timers.size, diagnostics: phases(h) };
}
for (const kind of ['read', 'write', 'transaction', 'retry', 'timeout', 'transaction-timeout']) test('baseline/on/off physical submissions, bodies, deadlines, retry, signal and result parity: ' + kind, async () => {
  const base = await scenario(baseline, true, kind), on = await scenario(current, true, kind), off = await scenario(current, false, kind);
  const product = ({ diagnostics, ...value }) => value;
  assert.deepEqual(product(on), product(base));
  // Disabled previous diagnostics have no late-settle observation timer either.
  assert.deepEqual({ ...product(off), deadlines: off.deadlines.filter(ms => ms !== 15000) }, { ...product(base), deadlines: base.deadlines.filter(ms => ms !== 15000) });
  assert.equal(off.diagnostics.length, 0); assert.ok(on.diagnostics.length > 0);
  assert.equal(on.bodies.length, kind === 'transaction' || kind === 'retry' ? 2 : 1);
});

test('diagnostic callback exceptions cannot change adapter response or submit twice', async () => {
  const h = harness(); h.behavior(() => 'fast');
  const result = await h.db._pipeline(requests('SELECT 1'), { phaseObserver() { throw new Error('observer failed'); } });
  assert.equal(result.results.length, 2); assert.equal(h.calls.length, 1);
});

test('refresh phases are at existing awaits; SQL/claim helpers and scheduling remain byte-identical', () => {
  for (const name of ['acquireMsSyncClaim', 'finishMsSyncClaim', 'waitForMsSourceCache']) assert.equal(fn(current.worker, name), fn(baseline.worker, name));
  for (const name of ['refresh', 'streamPayload']) {
    const find = source => { const start = source.indexOf('  async ' + name + '('); const rest = source.slice(start); return rest.slice(0, rest.indexOf('\n  }') + 4); };
    if (name === 'refresh') {
      const expected = find(baseline.worker);
      assert.equal(find(current.worker), expected, 'leader/follower/backoff coordinator unchanged');
    } else assert.equal(find(current.worker), find(baseline.worker));
  }
  assert.equal((current.worker.match(/await /g) || []).length, (baseline.worker.match(/await /g) || []).length);
  assert.equal((current.worker.match(/setTimeout\(/g) || []).length, (baseline.worker.match(/setTimeout\(/g) || []).length);
  for (const phase of ['SOURCE_ACQUISITION_COMPLETED', 'SOURCE_HASH_DECISION', 'CLAIM_DECISION', 'ROUTE_BATCH_WRITE_COMPLETED', 'AUDIT_STAGE_COMPLETED', 'LIVE_CACHE_STAGE_COMPLETED', 'CLAIM_FINISH_COMPLETED', 'STATUS_STAGE_COMPLETED']) assert.match(current.worker, new RegExp('msPhaseEnv\\(env, "' + phase + '"'));
  assert.doesNotMatch(current.adapter, /response\.text\(|getReader\(|\.clone\(/);
  assert.equal((current.adapter.match(/await /g) || []).length, (baseline.adapter.match(/await /g) || []).length);
  assert.match(current.frontend, /criticalPath: criticalPath.snapshot\(\)/);
  assert.match(current.frontend, /if \(event.hub === state.branch\)/);
});

test('actual refresh/sync paths record only executed source, claim, route, audit, cache and status phases', async () => {
  const h = harness(); h.behavior(() => 'fast');
  Object.assign(h.ctx, {
    crypto: { randomUUID: () => 'SYNTHETIC_ID' },
    planMsChanges, sameMsRouteCore, resolveCompletionTruth,
    msCredentials: async () => ({ mock: true }), busTimeRouteHints: new Map(), startMsOptionalRefresh() {},
    readMsRoutes: async () => { h.elapse(10); return [{ proofId: 'PRIVATE_PROOF', attendanceType: 'origin', estimatedDepartureAt: '2026-10-08' }]; },
    msOptionalData: () => new Map(), mapMsRow: row => row, enrichMsRow: row => row, markAuxiliaryOccurrenceAmbiguity() {},
    msTbrShadowFeed: () => [], supervisorRefreshSourceTelemetry: () => ({}),
    normalizeProofId: value => value, normalizeMsAttendance: value => value,
    text: value => String(value ?? ''), date: value => value || '', phone: value => value || '', numberOrNull: value => value == null ? null : Number(value),
    access: () => true, fail: message => { throw new Error(message); }, output: row => row,
    resolveUnloadingStartTruth: () => ({ at: '', observedAt: '', source: 'UNKNOWN' }),
    ensureMsCompletionRepair: async () => {}, holdTransientEmptyMsSource: async () => null,
    MS_LIVE_CACHE_VERSION: 'completion-v2', sha: async value => value, canonicalMsSource: () => 'PRIVATE_HASH', readMsLiveCache: async () => null,
    thaiDay: () => '2026-10-08', bootstrapCompletedToday: async () => [], mergeCompletedToday: () => [],
    audit: async env => { await env.DB.prepare('INSERT INTO audit_log VALUES(?)').bind('PRIVATE_AUDIT').run(); },
    writeMsLiveCache: async env => env.DB.prepare('UPDATE ms_live_cache SET rows_json=?').bind('PRIVATE_ROWS').run(),
    markConnectionSuccess: async env => env.DB.prepare('UPDATE ms_connections SET status=?').bind('PRIVATE_STATUS').run(),
    safeStatusWrite: async promise => { try { return await promise; } catch { return null; } },
    msQueueFirstSourceRows: rows => rows, attachPnoViewMetadata: rows => rows, MS_SYNC_TTL: 3000,
  });
  vm.runInContext(fn(current.worker, 'acquireMsSyncClaim') + '\n' + fn(current.worker, 'finishMsSyncClaim') + '\n' + fn(current.worker, 'syncMs') + '\n' + fn(current.worker, 'runMsRefresh') + '\nconst MS_SYNC_CLAIM_LEASE_MS = 75000;', h.ctx);
  const result = await h.ctx.runMsRefresh(h.env, 'NE1'); h.push(result);
  assert.equal(result.status, 'synced');
  const p = phases(h);
  for (const phase of ['SOURCE_ACQUISITION_COMPLETED', 'SOURCE_HASH_DECISION', 'CLAIM_DECISION', 'ROUTE_STATE_READ_COMPLETED', 'ROUTE_BATCH_WRITE_COMPLETED', 'AUDIT_STAGE_COMPLETED', 'LIVE_CACHE_STAGE_COMPLETED', 'CLAIM_FINISH_COMPLETED', 'STATUS_STAGE_COMPLETED']) assert.ok(p.includes(phase), phase);
  assert.ok(p.indexOf('COMMIT_ACKNOWLEDGED') < p.indexOf('ROUTE_BATCH_WRITE_COMPLETED'));
  assert.doesNotMatch(JSON.stringify(h.trace()), /PRIVATE_|SYNTHETIC_ID/);
  // The warm same-hash branch performs no claim, route write, audit or cache write.
  const before = allEvents(h).at(-1).sequence;
  const warm = await h.ctx.runMsRefresh(h.env, 'NE1'); h.push(warm);
  const warmEvents = allEvents(h).filter(event => event.sequence > before);
  assert.equal(warm.status, 'synced');
  assert.ok(warmEvents.find(event => event.phase === 'SOURCE_HASH_DECISION')?.sourceCached);
  for (const phase of ['CLAIM_DECISION', 'ROUTE_BATCH_WRITE_COMPLETED', 'AUDIT_STAGE_COMPLETED', 'LIVE_CACHE_STAGE_COMPLETED', 'CLAIM_FINISH_COMPLETED']) assert.ok(!warmEvents.some(event => event.phase === phase), phase + ' did not execute');
});

test('existing in-band diagnostic copy sanitizes HUBs and preserves Worker-relative times; non-DEV is inert', () => {
  const suffix = current.frontend.slice(current.frontend.indexOf('// MS_TURSO_TIMEOUT_PRODUCER_V1_FRONTEND'), current.frontend.indexOf('// MS_TURSO_LATE_SETTLE_V1_FRONTEND')) + '\n' + createMsLateSettleTrace.toString() + '\n' + createMsCriticalPathPhaseTrace.toString();
  for (const hostname of ['waiting-trucks-report-api-dev.26nak-testdev.workers.dev', 'production.invalid']) {
    let originalCalls = 0;
    const ctx = { location: { hostname }, performance: { now: () => 999999 }, state: { branch: 'NE1', auth: true }, document: {},
      handleRealtimeMessage() { originalCalls++; }, applyLiveResult() {}, apiGet: async () => ({}), authUi() {} };
    vm.createContext(ctx); vm.runInContext(suffix, ctx);
    ctx.handleRealtimeMessage(JSON.stringify({ msTursoCriticalPathPhaseTrace: { name: 'MS_TURSO_CRITICAL_PATH_PHASE_V1', events: [
      { phase: 'REFRESH_STARTED', hub: 'NE1', refreshInstanceId: 1, observedAtMs: 15, refreshElapsedMs: 0, proofId: 'PRIVATE_PROOF' },
      { phase: 'PIPELINE_SUBMITTED', hub: 'NE1', observedAtMs: 18, refreshElapsedMs: 3, token: 'PRIVATE_TOKEN' },
      { phase: 'PIPELINE_SUBMITTED', hub: 'OTHER_HUB', sql: 'PRIVATE_SQL' },
    ] } }));
    assert.equal(originalCalls, 1);
    if (hostname === 'production.invalid') assert.equal(ctx.msTursoTimeoutProducerV1, undefined);
    else {
      const trace = JSON.parse(JSON.stringify(ctx.msTursoTimeoutProducerV1().criticalPath));
      const events = [...trace.events, ...trace.refreshEvents].sort((a, b) => a.observedAtMs - b.observedAtMs);
      assert.equal(events.length, 2); assert.deepEqual(events.map(event => event.observedAtMs), [15, 18]);
      assert.deepEqual(events.map(event => event.refreshElapsedMs), [0, 3]);
      assert.doesNotMatch(JSON.stringify(trace), /PRIVATE_|OTHER_HUB|999999/);
    }
  }
});
