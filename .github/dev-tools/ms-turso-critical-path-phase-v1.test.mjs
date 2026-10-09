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
// This suite isolates the phase observer from later DEV-only observers.
const currentRoot = path.join(dir, 'current');
fs.mkdirSync(currentRoot);
// Offline baseline uses the SAME accepted patch stack, omitting only this new
// final observer. No Git history/network dependency, no tracked input mutation.
const baselineRoot = path.join(dir, 'baseline');
fs.mkdirSync(baselineRoot);
for (const name of ['.github/dev-tools', 'cloudflare-browser-test/scripts', 'worker/scripts', 'worker/src'])
  for (const target of [currentRoot, baselineRoot]) fs.cpSync(path.join(root, name), path.join(target, name), { recursive: true });
for (const file of fs.readdirSync(root).filter(file => /\.(html|css)$/.test(file) || file === 'ms.js')) {
  for (const target of [currentRoot, baselineRoot]) fs.copyFileSync(path.join(root, file), path.join(target, file));
}
for (const target of [currentRoot, baselineRoot]) {
  const pathToComposer = path.join(target, '.github/dev-tools/stage-dev-runtime.mjs');
  let source = fs.readFileSync(pathToComposer, 'utf8');
  source = source.replace(/import \{ patchMsRouteSourcePageTimingWorker, patchMsRouteSourcePageTimingFrontend \}[^\n]+\n/, '');
  source = source.replace(/  \/\/ Observe the final DEV-only Route source path after the existing phase patch\.\n  await writeFile\(frontendTarget, patchMsRouteSourcePageTimingFrontend\(await readFile\(frontendTarget, "utf8"\)\), "utf8"\);\n  await writeFile\(workerTarget, patchMsRouteSourcePageTimingWorker\(await readFile\(workerTarget, "utf8"\)\), "utf8"\);\n/, '');
  assert.doesNotMatch(source, /patchMsRouteSourcePageTiming/);
  fs.writeFileSync(pathToComposer, source);
}
const composerPath = path.join(baselineRoot, '.github/dev-tools/stage-dev-runtime.mjs');
let composer = fs.readFileSync(composerPath, 'utf8');
composer = composer.replace(/import \{ patchMsCriticalPathAdapter, patchMsCriticalPathWorker, patchMsCriticalPathFrontend \}[^\n]+\n/, '');
composer = composer.replace('  await writeFile(frontendTarget, patchMsCriticalPathFrontend(await readFile(frontendTarget, \"utf8\")), \"utf8\");\n', '');
composer = composer.replace('patchMsCriticalPathAdapter(patchMsTursoStallAdapterV1(adapter))', 'patchMsTursoStallAdapterV1(adapter)');
composer = composer.replace('patchMsCriticalPathWorker(patchMsTursoStallContainmentV1(await readFile(workerTarget, "utf8")))', 'patchMsTursoStallContainmentV1(await readFile(workerTarget, "utf8"))');
assert.doesNotMatch(composer, /patchMsCriticalPath/);
fs.writeFileSync(composerPath, composer);
for (const target of [currentRoot, baselineRoot]) fs.copyFileSync(path.join(root, 'worker/src/index.js'), path.join(target, 'index.js'));
for (const [script, target] of [[path.join(currentRoot, '.github/dev-tools/stage-dev-runtime.mjs'), currentRoot], [composerPath, baselineRoot]])
  execFileSync(process.execPath, [script, path.join(target, 'ms.js'), path.join(target, 'index.js')], { stdio: 'pipe' });
const current = { worker: fs.readFileSync(path.join(currentRoot, 'index.js'), 'utf8'), adapter: fs.readFileSync(path.join(currentRoot, 'turso-d1.js'), 'utf8'), frontend: fs.readFileSync(path.join(currentRoot, 'ms.js'), 'utf8') };
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
  for (const name of ['index.js', 'turso-d1.js', 'ms.js']) execFileSync(process.execPath, ['--check', path.join(currentRoot, name)]);
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
  assert.match(current.frontend, /criticalPath: criticalPath\.snapshot\(\)/);
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

const phaseSnapshotCountPattern = /criticalPath: criticalPath\.snapshot\(\)/g;

test('existing in-band diagnostic copy sanitizes HUBs and preserves Worker-relative times; non-DEV is inert', () => {
  const suffix = current.frontend.slice(current.frontend.indexOf('// MS_TURSO_TIMEOUT_PRODUCER_V1_FRONTEND'), current.frontend.indexOf('// MS_TURSO_LATE_SETTLE_V1_FRONTEND')) + '\n' + createMsLateSettleTrace.toString() + '\n' + createMsCriticalPathPhaseTrace.toString();
  assert.equal((current.frontend.match(/globalThis\.msTursoTimeoutProducerV1 = snapshot/g) || []).length, 1);
  assert.equal((current.frontend.match(/msTursoProducerFrontend\(\);/g) || []).length, 1);
  assert.equal((current.frontend.match(phaseSnapshotCountPattern) || []).length, 1);
  for (const hostname of ['waiting-trucks-report-api-dev.26nak-testdev.workers.dev', 'production.invalid']) {
    let originalCalls = 0;
    const ctx = { location: { hostname }, performance: { now: () => 999999 }, state: { branch: 'NE1', auth: true }, document: {},
      handleRealtimeMessage() { originalCalls++; }, applyLiveResult() {}, apiGet: async () => ({}), authUi() {} };
    vm.createContext(ctx); vm.runInContext(suffix, ctx);
    if (hostname !== 'production.invalid') {
      const initial = JSON.parse(JSON.stringify(ctx.msTursoTimeoutProducerV1()));
      assert.match(ctx.msTursoTimeoutProducerV1.toString(), /criticalPath: criticalPath\.snapshot\(\)/);
      assert.equal(initial.criticalPath.name, 'MS_TURSO_CRITICAL_PATH_PHASE_V1');
      assert.equal(initial.criticalPath.events.length, 0);
      assert.equal(initial.criticalPath.refreshEvents.length, 0);
      assert.equal(initial.lateSettle.name, 'MS_TURSO_LATE_SETTLE_V1');
    }
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

// Retained Route reads are tested with a synthetic clock. They do not submit
// physical requests; transport parity is also exercised by the harness above.
function routeFixture() {
  let now = 0;
  const trace = createMsCriticalPathPhaseTrace(() => now, 773);
  const emit = (phase, offset, overrides = {}) => {
    now = offset;
    return trace.record(phase, { hub: 'NE1', operationClass: 'ROUTE_STATE_READ', readOrWrite: 'READ',
      refreshInstanceId: 23, dbOperationId: 47, pipelineSequence: 3, attempt: 1,
      deadlineMs: 2800, physicalAttemptElapsedMs: offset, ...overrides });
  };
  return { trace, emit, snapshot: () => trace.snapshot().routeReadSummaries };
}

test('retained normal Route read preserves each relative phase and a complete success', () => {
  const f = routeFixture();
  f.emit('PIPELINE_SUBMITTED', 10, { submitted: true }); f.emit('FETCH_STARTED', 12);
  f.emit('RESPONSE_HEADERS_RECEIVED', 112, { httpStatus: 200 }); f.emit('RESPONSE_PARSED', 130);
  f.emit('PIPELINE_SETTLED_SUCCESS', 135, { outcome: 'SUCCESS' });
  const [r] = f.snapshot();
  assert.equal(f.snapshot().length, 1); assert.equal(r.runtimeInstanceId, 773);
  assert.deepEqual([r.submittedAtMs, r.fetchStartedAtMs, r.headersAtMs, r.parsedAtMs, r.settledAtMs], [10, 12, 112, 130, 135]);
  assert.deepEqual([r.fetchToHeadersMs, r.headersToParsedMs, r.deadlineMs], [100, 18, 2800]);
  assert.equal(r.completeness, 'COMPLETE'); assert.equal(r.outcome, 'SUCCESS'); assert.equal(r.submitted, true);
  assert.equal(f.trace.snapshot().events.length, 5);
});

test('deadline before headers retains local timeout and abort without remote inference', () => {
  const f = routeFixture(); f.emit('PIPELINE_SUBMITTED', 1); f.emit('FETCH_STARTED', 2);
  f.emit('LOCAL_DEADLINE_EXPIRED', 2800, { timedOut: true }); f.emit('LOCAL_ABORT_REQUESTED', 2800);
  const [r] = f.snapshot();
  assert.equal(r.outcome, 'LOCAL_DEADLINE_EXPIRED'); assert.equal(r.completeness, 'PARTIAL');
  assert.equal(r.headersAtMs, null); assert.equal(r.parsedAtMs, null); assert.equal(r.transportOutcome, 'UNKNOWN');
  assert.equal(r.abortRequested, true); assert.equal(r.lateSettlement, 'NONE');
});

test('headers before timeout are observed while absent parse stays absent', () => {
  const f = routeFixture(); f.emit('PIPELINE_SUBMITTED', 1); f.emit('FETCH_STARTED', 2);
  f.emit('RESPONSE_HEADERS_RECEIVED', 50); f.emit('LOCAL_DEADLINE_EXPIRED', 2800);
  const [r] = f.snapshot();
  assert.equal(r.headersAtMs, 50); assert.equal(r.fetchToHeadersMs, 48);
  assert.equal(r.parsedAtMs, null); assert.equal(r.headersToParsedMs, null);
  assert.equal(r.outcome, 'LOCAL_DEADLINE_EXPIRED');
});

test('late settlement is a separate observation and cannot erase the timeout', () => {
  const f = routeFixture(); f.emit('PIPELINE_SUBMITTED', 1); f.emit('FETCH_STARTED', 2);
  f.emit('LOCAL_DEADLINE_EXPIRED', 2800); f.emit('LOCAL_ABORT_REQUESTED', 2800);
  f.emit('LATE_SETTLE_SUCCESS', 3100, { lateSettleElapsedMs: 3099, lateAfterDeadlineMs: 300 }); const [r] = f.snapshot();
  assert.equal(r.outcome, 'LOCAL_DEADLINE_EXPIRED'); assert.equal(r.lateSettlement, 'SUCCESS');
  assert.equal(r.lateSettledAtMs, 3100); assert.equal(r.transportOutcome, 'UNKNOWN');
  assert.equal(r.lateSettleElapsedMs, 3099); assert.equal(r.lateAfterDeadlineMs, 300);
  assert.equal(JSON.stringify(r).includes('COMMIT_ACKNOWLEDGED'), false);
});

test('independent Route summary survives eviction of more than 64 ordinary raw events', () => {
  const f = routeFixture(); f.emit('PIPELINE_SUBMITTED', 1); f.emit('FETCH_STARTED', 2);
  f.emit('LOCAL_DEADLINE_EXPIRED', 2800);
  for (let i = 0; i < 80; i++) f.emit('FETCH_STARTED', 2801 + i, { operationClass: 'OTHER_LIVE_DB', dbOperationId: 100 + i });
  assert.equal(f.trace.snapshot().events.length, 64);
  assert.equal(f.trace.snapshot().events.some(e => e.dbOperationId === 47), false);
  assert.equal(f.snapshot().length, 1); assert.equal(f.snapshot()[0].outcome, 'LOCAL_DEADLINE_EXPIRED');
});

test('late event for an evicted Route read cannot displace newer retained reads', () => {
  const f = routeFixture();
  for (let id = 0; id < 17; id++) f.emit('PIPELINE_SUBMITTED', id, { dbOperationId: id });
  f.emit('LATE_SETTLE_SUCCESS', 99, { dbOperationId: 0 });
  assert.deepEqual(f.snapshot().map(r => r.dbOperationId), Array.from({ length: 16 }, (_, i) => i + 1));
});

test('overlapping operations and separate attempts never mix timings or outcomes', () => {
  const f = routeFixture();
  f.emit('PIPELINE_SUBMITTED', 1, { activePipelines: 1 });
  f.emit('PIPELINE_SUBMITTED', 3, { dbOperationId: 48, activePipelines: 2, overlap: true });
  f.emit('FETCH_STARTED', 5, { dbOperationId: 48, activePipelines: 2, overlap: true });
  f.emit('LOCAL_DEADLINE_EXPIRED', 9, { dbOperationId: 47 });
  f.emit('PIPELINE_SETTLED_ERROR', 10, { dbOperationId: 48, errorCategory: 'NETWORK' });
  f.emit('PIPELINE_SUBMITTED', 11, { dbOperationId: 48, attempt: 2, overlap: true });
  const [a, b, retry] = f.snapshot();
  assert.deepEqual([a.dbOperationId, b.dbOperationId, retry.dbOperationId], [47, 48, 48]);
  assert.deepEqual([a.outcome, b.outcome, retry.outcome], ['LOCAL_DEADLINE_EXPIRED', 'ERROR', 'UNKNOWN']);
  assert.equal(a.overlap, false); assert.equal(b.overlap, true); assert.equal(retry.attempt, 2);
  assert.equal(a.fetchStartedAtMs, null); assert.equal(b.fetchStartedAtMs, 5);
});

test('eight HUB buckets with sixteen reads each evict deterministically and filter snapshot by HUB', () => {
  const f = routeFixture();
  for (let i = 0; i < 19; i++) f.emit('PIPELINE_SUBMITTED', i, { dbOperationId: i });
  assert.equal(f.snapshot().length, 16); assert.deepEqual(f.snapshot().map(x => x.dbOperationId), Array.from({ length: 16 }, (_, i) => i + 3));
  for (let hub = 1; hub <= 8; hub++) f.emit('PIPELINE_SUBMITTED', 20 + hub, { hub: `H${hub}`, dbOperationId: hub });
  const all = f.trace.snapshot().routeReadSummaries;
  assert.equal(f.trace.snapshot().maxRouteReadHubs, 8); assert.equal(f.trace.snapshot().maxRouteReadsPerHub, 16);
  assert.equal(all.some(x => x.hub === 'NE1'), false); assert.equal(all.length, 8);
  const h2 = all.filter(x => x.hub === 'H2'); assert.equal(h2.length, 1); assert.equal(h2[0].dbOperationId, 2);
});

test('missing, out-of-order and SQL-error phases cannot be a complete success', () => {
  const f = routeFixture();
  f.emit('RESPONSE_PARSED', 3); f.emit('RESPONSE_HEADERS_RECEIVED', 4);
  f.emit('PIPELINE_SETTLED_SUCCESS', 5, { outcome: 'SUCCESS' });
  let r = f.snapshot()[0]; assert.equal(r.completeness, 'PARTIAL'); assert.equal(r.outcome, 'UNKNOWN');
  assert.equal(r.headersToParsedMs, null); assert.equal(r.fetchToHeadersMs, null);
  f.emit('PIPELINE_SUBMITTED', 6, { dbOperationId: 48 }); f.emit('FETCH_STARTED', 7, { dbOperationId: 48 });
  f.emit('RESPONSE_HEADERS_RECEIVED', 8, { dbOperationId: 48 }); f.emit('RESPONSE_PARSED', 9, { dbOperationId: 48 });
  f.emit('PIPELINE_SETTLED_SUCCESS', 10, { dbOperationId: 48, outcome: 'ERROR' });
  r = f.snapshot()[1]; assert.equal(r.transportOutcome, 'ERROR'); assert.equal(r.outcome, 'ERROR');
});

test('closed projection drops injected secrets and rejects cross-HUB, cross-runtime or malformed summaries', () => {
  const f = routeFixture(); f.emit('PIPELINE_SUBMITTED', 1, { sql: 'PRIVATE_SQL', token: 'PRIVATE_TOKEN', proofId: 'PRIVATE_PROOF', customer: 'PRIVATE_CUSTOMER' });
  const input = f.snapshot()[0]; const browser = createMsCriticalPathPhaseTrace(() => 0, 773);
  browser.acceptSummaries([{ ...input, sql: 'PRIVATE_SQL', proofId: 'PRIVATE_PROOF', token: 'PRIVATE_TOKEN', customer: 'PRIVATE_CUSTOMER' },
    { ...input, hub: 'SW1', dbOperationId: 99 }, { ...input, runtimeInstanceId: 774, dbOperationId: 100 },
    { ...input, dbOperationId: -1 }], 'NE1', 773);
  assert.equal(browser.snapshot().routeReadSummaries.length, 1);
  assert.doesNotMatch(JSON.stringify(browser.snapshot()), /PRIVATE_|"proofId"|"customer"|"token"|"sql"/i);
  const invalid = createMsCriticalPathPhaseTrace(() => 0, 773);
  invalid.acceptSummaries([{ ...input, outcome: 'SUCCESS' }], 'NE1', 773);
  assert.equal(invalid.snapshot().routeReadSummaries[0].outcome, 'UNKNOWN');
  const contradictory = createMsCriticalPathPhaseTrace(() => 0, 773);
  contradictory.acceptSummaries([{ ...input, submittedAtMs: 10, fetchStartedAtMs: 12, headersAtMs: 30,
    parsedAtMs: 20, settledAtMs: 40, completeness: 'COMPLETE', transportOutcome: 'SUCCESS', outcome: 'SUCCESS',
    headersToParsedMs: 100 }], 'NE1', 773);
  assert.equal(contradictory.snapshot().routeReadSummaries[0].completeness, 'PARTIAL');
  assert.equal(contradictory.snapshot().routeReadSummaries[0].outcome, 'UNKNOWN');
  assert.equal(contradictory.snapshot().routeReadSummaries[0].headersToParsedMs, null);
});

test('diagnostic observer failure cannot replace a successful physical operation', async () => {
  const h = harness(); h.behavior(() => 'fast');
  vm.runInContext('msPhaseTrace.record = () => { throw new Error("PRIVATE_DIAGNOSTIC"); }', h.ctx);
  const result = await h.run(db => db._pipeline(requests('SELECT * FROM ms_routes')));
  assert.equal(result.status, 'synced'); assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].signal.aborted, false); assert.deepEqual(h.deadlines, [2800]);
});

test('staged Worker summary export, latest frontend snapshot and non-DEV guard remain isolated', () => {
  assert.match(current.worker, /routeReadSummaries: trace\.routeReadSummaries\.filter\(entry => entry\.hub === hub\)/);
  assert.match(current.frontend, /next\.acceptSummaries\(summaries, state\.branch, runtime\)/);
  assert.equal((current.frontend.match(/globalThis\.msTursoTimeoutProducerV1 = snapshot/g) || []).length, 1);
  assert.match(current.frontend, /pollMs:\s*4000/);
  assert.match(current.frontend, /location\.hostname !== 'waiting-trucks-report-api-dev\.26nak-testdev\.workers\.dev'/);
});

test('actual in-band frontend retains Worker summary after raw-ring eviction and unrelated payloads, then clears on HUB and runtime change', () => {
  const f = routeFixture(); f.emit('PIPELINE_SUBMITTED', 10); f.emit('FETCH_STARTED', 12);
  f.emit('LOCAL_DEADLINE_EXPIRED', 2800);
  for (let i = 0; i < 80; i++) f.emit('FETCH_STARTED', 2801 + i, { operationClass: 'OTHER_LIVE_DB', dbOperationId: i + 100 });
  const suffix = current.frontend.slice(current.frontend.indexOf('// MS_TURSO_TIMEOUT_PRODUCER_V1_FRONTEND'), current.frontend.indexOf('// MS_TURSO_LATE_SETTLE_V1_FRONTEND')) + '\n' + createMsLateSettleTrace.toString() + '\n' + createMsCriticalPathPhaseTrace.toString();
  const ctx = { location: { hostname: 'waiting-trucks-report-api-dev.26nak-testdev.workers.dev' },
    performance: { now: () => 10_000 }, state: { branch: 'NE1', auth: true }, document: {},
    handleRealtimeMessage() {}, applyLiveResult() {}, apiGet: async () => ({}), authUi() {} };
  vm.createContext(ctx); vm.runInContext(suffix, ctx);
  const send = value => ctx.handleRealtimeMessage(JSON.stringify(value));
  send({ msTursoCriticalPathPhaseTrace: f.trace.snapshot() });
  const read = () => JSON.parse(JSON.stringify(ctx.msTursoTimeoutProducerV1().criticalPath));
  assert.equal(read().routeReadSummaries.length, 1); assert.equal(read().routeReadSummaries[0].outcome, 'LOCAL_DEADLINE_EXPIRED');
  assert.equal(read().events.some(e => e.dbOperationId === 47), false);
  send({ status: 'synced' });
  assert.equal(read().routeReadSummaries.length, 1);
  send({ msTursoCriticalPathPhaseTrace: { name: 'MALFORMED', events: [] } });
  assert.equal(read().routeReadSummaries.length, 1);
  ctx.state.branch = 'SW1'; assert.equal(read().routeReadSummaries.length, 0);
  ctx.state.branch = 'NE1'; assert.equal(read().routeReadSummaries.length, 0);
  send({ msTursoCriticalPathPhaseTrace: f.trace.snapshot() }); assert.equal(read().routeReadSummaries.length, 1);
  send({ msTursoCriticalPathPhaseTrace: { ...f.trace.snapshot(), runtimeInstanceId: 774, routeReadSummaries: [] } });
  assert.equal(read().runtimeInstanceId, 774); assert.equal(read().routeReadSummaries.length, 0);
});

function frontendSummaryFixture() {
  const suffix = current.frontend.slice(current.frontend.indexOf('// MS_TURSO_TIMEOUT_PRODUCER_V1_FRONTEND'), current.frontend.indexOf('// MS_TURSO_LATE_SETTLE_V1_FRONTEND')) + '\n' + createMsLateSettleTrace.toString() + '\n' + createMsCriticalPathPhaseTrace.toString();
  const ctx = { location: { hostname: 'waiting-trucks-report-api-dev.26nak-testdev.workers.dev' },
    performance: { now: () => 10_000 }, state: { branch: 'NE1', auth: true }, document: {},
    handleRealtimeMessage() {}, applyLiveResult() {}, apiGet: async () => ({}), authUi() {} };
  vm.createContext(ctx); vm.runInContext(suffix, ctx);
  return { ctx, send: value => ctx.handleRealtimeMessage(JSON.stringify(value)),
    read: () => JSON.parse(JSON.stringify(ctx.msTursoTimeoutProducerV1().criticalPath)) };
}

test('reproduces stale same-runtime snapshot dropping the second retained Route Read', () => {
  const f = routeFixture(); const ui = frontendSummaryFixture();
  f.emit('PIPELINE_SUBMITTED', 1); const older = f.trace.snapshot();
  f.emit('PIPELINE_SUBMITTED', 2, { dbOperationId: 48 }); const newer = f.trace.snapshot();
  ui.send({ msTursoCriticalPathPhaseTrace: newer });
  assert.equal(ui.read().routeReadSummaries.length, 2);
  ui.send({ msTursoCriticalPathPhaseTrace: older });
  assert.equal(ui.read().routeReadSummaries.length, 2);
});

test('reproduces missing or malformed summaries erasing accepted evidence', () => {
  const f = routeFixture(); const ui = frontendSummaryFixture();
  f.emit('PIPELINE_SUBMITTED', 1); ui.send({ msTursoCriticalPathPhaseTrace: f.trace.snapshot() });
  f.emit('FETCH_STARTED', 2, { operationClass: 'OTHER_LIVE_DB' });
  const noSummaries = { ...f.trace.snapshot() }; delete noSummaries.routeReadSummaries;
  ui.send({ msTursoCriticalPathPhaseTrace: noSummaries });
  assert.equal(ui.read().routeReadSummaries.length, 1);
  f.emit('FETCH_STARTED', 3, { operationClass: 'OTHER_LIVE_DB' });
  ui.send({ msTursoCriticalPathPhaseTrace: { ...f.trace.snapshot(), routeReadSummaries: {} } });
  assert.equal(ui.read().routeReadSummaries.length, 1);
});

test('newer snapshot advances once; duplicate, older, and explicit same-runtime empty cannot erase it', () => {
  const f = routeFixture(), ui = frontendSummaryFixture();
  f.emit('PIPELINE_SUBMITTED', 1); const first = f.trace.snapshot();
  ui.send({ msTursoCriticalPathPhaseTrace: first });
  f.emit('PIPELINE_SUBMITTED', 2, { dbOperationId: 48 }); const second = f.trace.snapshot();
  ui.send({ msTursoCriticalPathPhaseTrace: second });
  assert.deepEqual(ui.read().routeReadSummaries.map(x => x.dbOperationId), [47, 48]);
  ui.send({ msTursoCriticalPathPhaseTrace: second });
  ui.send({ msTursoCriticalPathPhaseTrace: first });
  assert.deepEqual(ui.read().routeReadSummaries.map(x => x.dbOperationId), [47, 48]);
  f.emit('FETCH_STARTED', 3, { operationClass: 'OTHER_LIVE_DB' });
  ui.send({ msTursoCriticalPathPhaseTrace: { ...f.trace.snapshot(), routeReadSummaries: [] } });
  assert.deepEqual(ui.read().routeReadSummaries.map(x => x.dbOperationId), [47, 48]);
  assert.equal(ui.read().snapshotSequence, 3);
});

test('known new runtime clears old summaries; delayed prior runtime and unknown identity cannot merge or erase', () => {
  const f = routeFixture(), ui = frontendSummaryFixture();
  f.emit('PIPELINE_SUBMITTED', 1); const old = f.trace.snapshot();
  ui.send({ msTursoCriticalPathPhaseTrace: old });
  ui.send({ msTursoCriticalPathPhaseTrace: { ...old, runtimeInstanceId: 774, routeReadSummaries: [], snapshotSequence: 0 } });
  assert.equal(ui.read().runtimeInstanceId, 774);
  assert.equal(ui.read().routeReadSummaries.length, 0);
  ui.send({ msTursoCriticalPathPhaseTrace: old });
  ui.send({ msTursoCriticalPathPhaseTrace: { ...old, runtimeInstanceId: null, snapshotSequence: 100 } });
  assert.equal(ui.read().runtimeInstanceId, 774);
  assert.equal(ui.read().routeReadSummaries.length, 0);
  assert.equal(ui.read().snapshotSequence, 0);
});

test('unknown runtime does not fabricate summary generation or leak a different HUB', () => {
  const f = routeFixture(), ui = frontendSummaryFixture();
  f.emit('PIPELINE_SUBMITTED', 1); const old = f.trace.snapshot();
  ui.send({ msTursoCriticalPathPhaseTrace: { ...old, runtimeInstanceId: null } });
  assert.equal(ui.read().routeReadSummaries.length, 0);
  f.emit('FETCH_STARTED', 2, { operationClass: 'OTHER_LIVE_DB' });
  ui.send({ msTursoCriticalPathPhaseTrace: { ...f.trace.snapshot(), runtimeInstanceId: null } });
  assert.equal(ui.read().snapshotSequence, 1, 'unknown origin cannot order another unknown origin');
  ui.send({ msTursoCriticalPathPhaseTrace: old });
  assert.equal(ui.read().routeReadSummaries.length, 1);
  ui.ctx.state.branch = 'SW1'; assert.equal(ui.read().routeReadSummaries.length, 0);
  ui.send({ msTursoCriticalPathPhaseTrace: old });
  assert.equal(ui.read().routeReadSummaries.length, 0);
  ui.ctx.state.branch = 'NE1'; assert.equal(ui.read().routeReadSummaries.length, 0);
});

test('valid newer partial envelope retains old Route Read while refreshing raw phase events', () => {
  const f = routeFixture(), ui = frontendSummaryFixture();
  f.emit('PIPELINE_SUBMITTED', 1); ui.send({ msTursoCriticalPathPhaseTrace: f.trace.snapshot() });
  f.emit('FETCH_STARTED', 2, { operationClass: 'OTHER_LIVE_DB' });
  const partial = f.trace.snapshot(); delete partial.routeReadSummaries;
  ui.send({ msTursoCriticalPathPhaseTrace: partial });
  assert.equal(ui.read().routeReadSummaries.length, 1);
  assert.equal(ui.read().snapshotSequence, 2);
  assert.equal(ui.read().events.length, 2);
  f.emit('FETCH_STARTED', 3, { operationClass: 'OTHER_LIVE_DB' });
  ui.send({ msTursoCriticalPathPhaseTrace: { ...f.trace.snapshot(), routeReadSummaries: [{ hub: 'NE1', runtimeInstanceId: 773 }] } });
  assert.equal(ui.read().routeReadSummaries.length, 1);
});

function populatedHubFixture() {
  let tick = 0;
  const trace = createMsCriticalPathPhaseTrace(() => ++tick, 773);
  const emit = (hub, phase, extra = {}) => trace.record(phase, { hub, operationClass: 'ROUTE_STATE_READ',
    readOrWrite: 'READ', refreshInstanceId: 23, dbOperationId: 47, pipelineSequence: 3, attempt: 1, ...extra });
  for (let i = 1; i <= 8; i++) emit(`H${i}`, 'PIPELINE_SUBMITTED');
  return { trace, emit };
}

test('unmatched ninth-HUB late event cannot evict eight populated Route Read buckets', () => {
  const { trace, emit } = populatedHubFixture();
  const before = trace.snapshot().routeReadSummaries;
  assert.equal(before.length, 8);
  emit('H9', 'LATE_SETTLE_ERROR');
  const after = trace.snapshot();
  assert.deepEqual(after.routeReadSummaries, before);
  assert.equal(after.maxRouteReadHubs, 8);
});

test('both unmatched late outcomes leave all eight populated HUB buckets intact', () => {
  for (const phase of ['LATE_SETTLE_SUCCESS', 'LATE_SETTLE_ERROR']) {
    const { trace, emit } = populatedHubFixture();
    const before = trace.snapshot().routeReadSummaries;
    emit('H9', phase);
    assert.deepEqual(trace.snapshot().routeReadSummaries, before, phase);
    assert.equal(trace.snapshot().events.at(-1).phase, phase, 'ordinary phase observation remains');
  }
});

test('matching late event updates only its retained physical attempt without fabricating remote outcome', () => {
  const { trace, emit } = populatedHubFixture();
  emit('H3', 'LOCAL_DEADLINE_EXPIRED'); emit('H3', 'LOCAL_ABORT_REQUESTED');
  const before = trace.snapshot().routeReadSummaries;
  emit('H3', 'LATE_SETTLE_ERROR');
  const after = trace.snapshot().routeReadSummaries;
  assert.equal(after.length, 8);
  assert.equal(after.find(x => x.hub === 'H3').lateSettlement, 'ERROR');
  assert.equal(after.find(x => x.hub === 'H3').outcome, 'LOCAL_DEADLINE_EXPIRED');
  assert.deepEqual(after.filter(x => x.hub !== 'H3'), before.filter(x => x.hub !== 'H3'));
});

test('same-HUB wrong operation or physical attempt cannot update a retained summary', () => {
  const { trace, emit } = populatedHubFixture();
  const before = trace.snapshot().routeReadSummaries;
  emit('H3', 'LATE_SETTLE_ERROR', { dbOperationId: 48 });
  emit('H3', 'LATE_SETTLE_SUCCESS', { attempt: 2 });
  assert.deepEqual(trace.snapshot().routeReadSummaries, before);
});

test('a valid ninth-HUB Route Read still evicts the oldest HUB deterministically', () => {
  const { trace, emit } = populatedHubFixture();
  emit('H9', 'PIPELINE_SUBMITTED');
  const rows = trace.snapshot().routeReadSummaries;
  assert.equal(rows.length, 8);
  assert.deepEqual(rows.map(x => x.hub), ['H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'H9']);
});

test('incomplete late metadata neither guesses a match nor allocates a HUB bucket', () => {
  const { trace, emit } = populatedHubFixture();
  const before = trace.snapshot().routeReadSummaries;
  for (const extra of [{ dbOperationId: -1 }, { pipelineSequence: undefined }, { attempt: undefined }])
    emit('H9', 'LATE_SETTLE_ERROR', extra);
  assert.deepEqual(trace.snapshot().routeReadSummaries, before);
});

test('late observations cannot displace summaries after raw ring eviction', () => {
  const { trace, emit } = populatedHubFixture();
  for (let i = 0; i < 80; i++) emit('H8', 'FETCH_STARTED', { operationClass: 'OTHER_LIVE_DB', dbOperationId: 100 + i });
  const before = trace.snapshot().routeReadSummaries;
  assert.equal(trace.snapshot().events.length, 64);
  emit('H9', 'LATE_SETTLE_ERROR');
  assert.deepEqual(trace.snapshot().routeReadSummaries, before);
});

test('the two frontend snapshot assertions require a literal dot', () => {
  assert.equal((current.frontend.match(phaseSnapshotCountPattern) || []).length, 1);
  assert.equal(('criticalPath: criticalPath.snapshot()'.match(phaseSnapshotCountPattern) || []).length, 1);
  for (const replacement of ['X', '-', ' ', '0'])
    assert.equal((`criticalPath: criticalPath${replacement}snapshot()`.match(phaseSnapshotCountPattern) || []).length, 0);
  assert.equal((ctxSnapshotFunctionSource().match(phaseSnapshotCountPattern) || []).length, 1);
});

function ctxSnapshotFunctionSource() {
  const { ctx } = frontendSummaryFixture();
  return ctx.msTursoTimeoutProducerV1.toString();
}
