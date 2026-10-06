import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createMsTursoProducerTrace, msTursoProducerOperation, patchMsTursoTimeoutProducerWorker, patchMsTursoTimeoutProducerFrontend } from './patch-ms-turso-timeout-producer-v1.mjs';
import { stageFrontend } from './stage-dev-runtime.mjs';
import { patchMsRouteReadBudgetIsolationV1 } from './patch-ms-route-read-budget-isolation-v1.mjs';
const root = path.resolve(import.meta.dirname, '../..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-producer-test-'));
for (const file of fs.readdirSync(root).filter(file => /\.(html|css)$/.test(file) || file === 'ms.js')) fs.copyFileSync(path.join(root, file), path.join(dir, file));
fs.copyFileSync(path.join(root, 'worker/src/index.js'), path.join(dir, 'index.js'));
execFileSync(process.execPath, [path.join(root, '.github/dev-tools/stage-dev-runtime.mjs'), path.join(dir, 'ms.js'), path.join(dir, 'index.js')], { stdio: 'pipe', timeout: 30000 });
execFileSync(process.execPath, ['--check', path.join(dir, 'index.js')], { stdio: 'pipe' });
execFileSync(process.execPath, ['--check', path.join(dir, 'ms.js')], { stdio: 'pipe' });
const worker = fs.readFileSync(path.join(dir, 'index.js'), 'utf8');
const canonical = fs.readFileSync(path.join(root, 'ms.js'), 'utf8');
const frontend = stageFrontend(canonical);
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
function fn(name) { const start = worker.indexOf('function ' + name + '('); assert.ok(start >= 0); const rest = worker.slice(start); const end = rest.indexOf('\n}'); assert.ok(end > 0); return rest.slice(0, end + 2); }
function method(name) { const start = worker.indexOf('  ' + name + '('); assert.ok(start >= 0); const rest = worker.slice(start); const end = rest.indexOf('\n  }'); return rest.slice(0, end + 4); }
const helpers = worker.slice(worker.indexOf('// MS_TURSO_TIMEOUT_PRODUCER_V1_WORKER'));
const requests = (sql, args = ['SECRET_BIND']) => [{ type: 'execute', stmt: { sql, args } }];
const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
function harness(dev = true) {
  let clock = 100, calls = 0, nextTimer = 0;
  const timers = new Map(), messages = [];
  const ctx = { Date: class extends Date { static now() { return clock; } }, console: { warn() {}, error() {} },
    setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); },
    recentMsSync: new Map(), msOptionalData: () => new Map(), markAuxiliaryOccurrenceAmbiguity() {},
    normalizeProofId: value => value, normalizeMsAttendance: value => value, enrichMsRow: row => row,
    msQueueFirstSourceRows: rows => rows, msTbrShadowFeed: () => [] };
  vm.createContext(ctx);
  vm.runInContext(helpers + '\n' + fn('msLiveDbStage') + '\n' + fn('msTursoAvailability') + '\n' + fn('msLiveDatabaseEnv') + '\n' + fn('mergeMsOptionalResult'), ctx);
  ctx.msTraceEnvelope = (env, hub) => ctx.msProducerTraceEnvelope(env, hub);
  vm.runInContext('class Owner {\n' + method('sendAcceptedSnapshot') + '\n' + method('acceptOptional') + '\n}\nglobalThis.Owner = Owner;', ctx);
  const env = { DEV_ACCEPTANCE_TELEMETRY: dev ? '1' : '0', DB: { async _pipeline() { calls++; return { results: [] }; } } };
  const owner = new ctx.Owner(); owner.env = env; owner.recentUntil = 500;
  owner.ctx = { getWebSockets: () => [{ deserializeAttachment: () => ({ branch: owner.branch }), send: raw => messages.push(JSON.parse(raw)) }] };
  owner.lastSnapshotPayload = { type: 'snapshot', rows: [], lastSync: '', standards: [] };
  return { ctx, env, owner, messages, timers, clock: n => { clock += n; }, calls: () => calls,
    expire() { const timer = [...timers.values()].at(-1); assert.ok(timer); clock += timer.ms; timer.fn(); },
    trace: hub => JSON.parse(JSON.stringify(ctx.msProducerTraceEnvelope(env, hub).msTursoTimeoutProducerTrace || { events: [] })) };
}
const prior = { rows: [{ id: 'PRIVATE_ROW' }], syncedAt: '2026-10-06T16:59:53.560Z', status: 'synced' };
test('route budget isolation is staged, exact and idempotent', () => {
  assert.match(worker, /const routeScoped = stage === "route_state_read" \|\| stage === "route_batch_write"/);
  assert.match(worker, /if \(routeScoped\) routePersistenceBudget -=/);
  assert.equal(patchMsRouteReadBudgetIsolationV1(worker), worker);
  assert.throws(() => patchMsRouteReadBudgetIsolationV1('unrecognized source'), /anchor mismatch/);
});

test('proven incident: route read preserves general budget and healthy accepted push', async () => {
  const h = harness(), submitted = [], deadlines = [];
  const plan = [
    ['SELECT * FROM ms_live_cache', 497, 2800], ['SELECT * FROM arbitrary', 74, 2303],
    ['SELECT * FROM ms_live_cache', 23, 2229], ['SELECT * FROM arbitrary', 46, 2206],
    ['SELECT * FROM ms_routes', 2187, 2800],
    ['BEGIN; INSERT INTO ms_routes VALUES(?)', 66, 2800], ['COMMIT', 37, 2800],
    ['INSERT INTO audit_log VALUES(?)', 10, 2160],
    ['UPDATE ms_live_cache SET rows_json=?', 10, 2150],
    ['UPDATE ms_sync_claims SET status=?', 10, 2140],
  ];
  h.env.DB._pipeline = async req => { submitted.push(req[0].stmt.sql); h.clock(plan[submitted.length - 1][1]); return {}; };
  const result = await h.ctx.msProducerRefresh(h.env, 'NE1', async env => {
    const live = h.ctx.msLiveDatabaseEnv(env);
    for (const [sql] of plan) {
      const pending = live.DB._pipeline(requests(sql));
      deadlines.push([...h.timers.values()].at(-1).ms);
      await pending;
    }
    return { ...prior, errorCode: '' };
  });
  assert.deepEqual(deadlines, plan.map(row => row[2]));
  assert.deepEqual(submitted, plan.map(row => row[0]));
  h.owner.branch = 'NE1'; h.owner.lastResult = result;
  h.owner.sendAcceptedSnapshot('NE1', 'MAIN_REFRESH_COMPLETION');
  assert.equal(h.messages.at(-1).msStatus, 'synced');
  assert.equal(h.messages.at(-1).errorCode, '');
  assert.equal(h.trace('NE1').events.some(e => e.eventType === 'TURSO_TIMEOUT_PRODUCED'), false);
  assert.equal(h.trace('NE1').events.at(-1).errorOrigin, 'NO_DB_ERROR');
});

test('route read deadline remains 2800 and producer remains truthful', async () => {
  const h = harness(); h.env.DB._pipeline = () => new Promise(() => {});
  const task = h.ctx.msProducerRefresh(h.env, 'NE1', async env => {
    try { await h.ctx.msLiveDatabaseEnv(env).DB._pipeline(requests('SELECT * FROM ms_routes')); }
    catch(error) { return h.ctx.msProducerCaughtResult(env, { ...prior, status: 'degraded', errorCode: error.code }, error); }
  });
  await flush(); h.expire(); const result = await task;
  assert.equal(result.errorCode, 'TURSO_LIVE_TIMEOUT');
  const trace = h.trace('NE1'), p = trace.events.find(e => e.eventType === 'TURSO_TIMEOUT_PRODUCED');
  assert.equal(p.operationClass, 'ROUTE_STATE_READ'); assert.equal(p.readOrWrite, 'READ');
  assert.equal(p.deadlineMs, 2800); assert.equal(p.submitted, true); assert.equal(p.timedOut, true);
  assert.equal(p.producerKind, 'SUBMITTED_DEADLINE_EXPIRED');
  assert.equal(trace.events.at(-1).errorOrigin, 'CURRENT_OPERATION_FAILURE');
});

test('route read and batch share bounded 60000 pool while general pool stays available', async () => {
  const h = harness(); h.env.DB._pipeline = async () => { h.clock(2000); return {}; };
  await h.ctx.msProducerRefresh(h.env, 'NE1', async env => {
    const live = h.ctx.msLiveDatabaseEnv(env);
    for (let i = 0; i < 30; i++) await live.DB._pipeline(requests(i % 2 ? 'INSERT INTO ms_routes VALUES(?)' : 'SELECT * FROM ms_routes'));
    // General work still submits after the route pool alone reaches zero.
    await live.DB._pipeline(requests('INSERT INTO audit_log VALUES(?)'));
    await assert.rejects(live.DB._pipeline(requests('SELECT * FROM ms_routes')), error => error.code === 'TURSO_LIVE_TIMEOUT');
    return { ...prior };
  });
  const p = h.trace('NE1').events.find(e => e.eventType === 'TURSO_TIMEOUT_PRODUCED');
  assert.equal(p.operationClass, 'ROUTE_STATE_READ'); assert.equal(p.submitted, false);
  assert.equal(p.producerKind, 'BUDGET_EXHAUSTED_BEFORE_SUBMIT'); assert.equal(p.deadlineMs, 0);
});
async function failedRefresh(h, hub = 'NE1', mode = 'deadline') {
  h.owner.branch = hub;
  const task = h.ctx.msProducerRefresh(h.env, hub, async env => {
    const live = h.ctx.msLiveDatabaseEnv(env);
    await live.DB._pipeline(requests('SELECT rows_json FROM ms_live_cache WHERE hub=?'));
    live.DB._pipeline; // Access alone performs no operation.
    const original = h.env.DB._pipeline;
    h.env.DB._pipeline = mode === 'preexisting' ? async () => { throw Object.assign(new Error('SECRET_ERROR'), { code: 'TURSO_LIVE_TIMEOUT' }); } : () => new Promise(() => {});
    try { await live.DB._pipeline(requests('UPDATE ms_live_cache SET rows_json=? WHERE hub=?')); }
    catch (error) { return h.ctx.msProducerCaughtResult(live, { ...prior, status: 'degraded', errorCode: error.code, dbTrace: error.dbTrace }, error); }
    finally { h.env.DB._pipeline = original; }
  });
  await flush(); if (mode === 'deadline') h.expire();
  return task;
}

for (const hub of ['NE1', 'EA2', 'FUTURE_A']) test(`${hub}: successful cache read then WRITE timeout correlates through refresh/coordinator/accepted push`, async () => {
  const h = harness(), result = await failedRefresh(h, hub);
  h.owner.lastResult = h.ctx.mergeMsOptionalResult(hub, result); h.ctx.msProducerCoordinator(h.env, hub, h.owner.lastResult);
  h.owner.sendAcceptedSnapshot(hub, 'MAIN_REFRESH_COMPLETION');
  const trace = h.trace(hub), producer = trace.events.find(e => e.eventType === 'TURSO_TIMEOUT_PRODUCED'), refresh = trace.events.find(e => e.eventType === 'REFRESH_RESULT'), push = trace.events.at(-1);
  assert.equal(producer.operationClass, 'LIVE_CACHE_WRITE'); assert.equal(producer.readOrWrite, 'WRITE');
  assert.equal(producer.dbOperationId, 2); assert.equal(producer.refreshInstanceId, 1);
  assert.equal(producer.producerKind, 'SUBMITTED_DEADLINE_EXPIRED'); assert.equal(producer.producerClass, 'LOCAL_DEADLINE_FACTORY');
  assert.equal(producer.submitted, true); assert.equal(producer.timedOut, true); assert.equal(producer.attempt, 1); assert.equal(producer.deadlineMs, 2800);
  assert.equal(refresh.producerSequence, producer.sequence); assert.equal(refresh.errorOrigin, 'CURRENT_OPERATION_FAILURE');
  assert.equal(push.timeoutProducerSequence, producer.sequence); assert.equal(push.dbOperationId, producer.dbOperationId);
  assert.equal(push.refreshInstanceId, refresh.refreshInstanceId); assert.equal(push.pushReason, 'MAIN_REFRESH_COMPLETION');
  assert.equal(push.errorOrigin, 'CURRENT_OPERATION_FAILURE'); assert.equal(push.resultInstanceId, refresh.resultInstanceId + 1);
  assert.equal(trace.firstCorrelatedPushSequence, push.sequence);
  assert.equal(h.messages[0].errorCode, 'TURSO_LIVE_TIMEOUT'); assert.equal(h.messages[0].lastSync, prior.syncedAt);
  assert.equal(h.calls(), 1); assert.equal(h.messages[0].rows[0].id, 'PRIVATE_ROW');
  assert.doesNotMatch(JSON.stringify(trace), /SECRET|PRIVATE_ROW|UPDATE|SELECT|rows_json/);
});

for (const [sql, readOrWrite, operationClass] of [
  ['SELECT * FROM ms_live_cache', 'READ', 'LIVE_CACHE_READ'],
  ['UPDATE ms_live_cache SET source_hash=?', 'WRITE', 'LIVE_CACHE_WRITE'],
  ['SELECT * FROM ms_connections', 'READ', 'CREDENTIAL_DB_READ'],
  ['SELECT * FROM hub_settings', 'READ', 'SETTINGS_DB_READ'],
  ['UPDATE ms_connections SET last_error=?', 'WRITE', 'CONNECTION_STATUS_WRITE'],
  ['INSERT INTO audit_log VALUES(?)', 'WRITE', 'AUDIT_WRITE'],
  ['SELECT * FROM ms_routes', 'READ', 'ROUTE_STATE_READ'],
  ['SELECT * FROM ms_route_history', 'READ', 'COMPLETION_HISTORY_READ'],
  ['UPDATE ms_sync_claims SET status=?', 'WRITE', 'CLAIM_WRITE'],
]) test(`actual request class ${operationClass}/${readOrWrite}`, () => assert.deepEqual(msTursoProducerOperation(requests(sql)), { readOrWrite, operationClass }));

test('transaction is explicit, including commit continuation; history READ is not misreported as WRITE', () => {
  assert.equal(msTursoProducerOperation([...requests('BEGIN'), ...requests('INSERT INTO ms_routes VALUES(?)')]).readOrWrite, 'TRANSACTION');
  assert.deepEqual(msTursoProducerOperation(requests('COMMIT'), 'route_batch_write'), { readOrWrite: 'TRANSACTION', operationClass: 'ROUTE_BATCH_WRITE' });
  assert.equal(msTursoProducerOperation(requests('SELECT * FROM ms_route_history')).readOrWrite, 'READ');
});

test('budget exhausted before submission records submitted=false and adds no DB call', async () => {
  const h = harness(); h.env.DB._pipeline = async () => { h.clock(1400); return {}; };
  await h.ctx.msProducerRefresh(h.env, 'NE1', async env => {
    const live = h.ctx.msLiveDatabaseEnv(env);
    await live.DB._pipeline(requests('SELECT * FROM ms_live_cache'));
    await live.DB._pipeline(requests('SELECT * FROM ms_live_cache'));
    try { await live.DB._pipeline(requests('UPDATE ms_connections SET last_error=?')); }
    catch(error) { return h.ctx.msProducerCaughtResult(live, { ...prior, status: 'degraded', errorCode: error.code }, error); }
  });
  const p = h.trace('NE1').events.find(e => e.eventType === 'TURSO_TIMEOUT_PRODUCED');
  assert.equal(p.producerKind, 'BUDGET_EXHAUSTED_BEFORE_SUBMIT'); assert.equal(p.submitted, false); assert.equal(p.deadlineMs, 0); assert.equal(p.pipelineSequence, 3);
});

test('preexisting adapter timeout is distinguishable from local timer', async () => {
  const h = harness(); await failedRefresh(h, 'NE1', 'preexisting');
  const p = h.trace('NE1').events.find(e => e.eventType === 'TURSO_TIMEOUT_PRODUCED');
  assert.equal(p.producerKind, 'PREEXISTING_TURSO_CODE'); assert.equal(p.producerClass, 'PREEXISTING_TURSO_CODE'); assert.equal(p.timedOut, false);
});

test('eligible retry records attempt 1 and 2 under unchanged timer and operation identity', async () => {
  const h = harness(); let attempts = 0;
  h.env.DB._pipeline = () => { attempts++; return Promise.reject(Object.assign(new Error('SECRET'), { code: attempts === 1 ? 'TURSO_NETWORK_ERROR' : 'TURSO_LIVE_TIMEOUT' })); };
  await h.ctx.msProducerRefresh(h.env, 'NE1', async env => {
    const live = h.ctx.msLiveDatabaseEnv(env);
    try { await live.DB._pipeline(requests('SELECT * FROM ms_live_cache')); }
    catch(error) { return h.ctx.msProducerCaughtResult(live, { ...prior, status: 'degraded', errorCode: error.code }, error); }
  });
  const events = h.trace('NE1').events, attemptsSeen = events.filter(e => e.eventType === 'DB_ATTEMPT'), p = events.find(e => e.eventType === 'TURSO_TIMEOUT_PRODUCED');
  assert.equal(attempts, 2); assert.deepEqual(attemptsSeen.map(e => e.attempt), [1, 2]); assert.equal(attemptsSeen[0].dbOperationId, attemptsSeen[1].dbOperationId); assert.equal(p.attempt, 2); assert.equal(p.deadlineMs, 2800);
});

test('first preexisting timeout remains observable even when eligible retry succeeds', async () => {
  const h = harness(); let calls = 0;
  h.env.DB._pipeline = async () => { if (++calls === 1) throw Object.assign(new Error('SECRET'), {code:'TURSO_LIVE_TIMEOUT'}); return {}; };
  const result = await h.ctx.msProducerRefresh(h.env, 'NE1', async env => { await h.ctx.msLiveDatabaseEnv(env).DB._pipeline(requests('SELECT * FROM ms_live_cache')); return {...prior}; });
  const events = h.trace('NE1').events;
  assert.equal(events.find(e => e.eventType === 'TURSO_TIMEOUT_PRODUCED').attempt, 1);
  assert.equal(events.at(-1).errorOrigin, 'NO_DB_ERROR'); assert.equal(events.at(-1).producerSequence, undefined); assert.equal(result.errorCode, undefined);
});

for (const optionalType of ['PREENTRY', 'BUSTIME']) test(`${optionalType}: optional completion re-pushes inherited lineage, never a new producer`, async () => {
  const h = harness(), result = await failedRefresh(h); h.owner.branch = 'NE1'; h.owner.lastResult = result;
  const producer = h.trace('NE1').events.find(e => e.eventType === 'TURSO_TIMEOUT_PRODUCED');
  h.owner.acceptOptional('NE1', optionalType);
  const events = h.trace('NE1').events, merge = events.find(e => e.eventType === 'OPTIONAL_MERGE'), push = events.at(-1);
  assert.equal(events.filter(e => e.eventType === 'TURSO_TIMEOUT_PRODUCED').length, 1);
  assert.notEqual(merge.inputResultInstanceId, merge.outputResultInstanceId); assert.equal(merge.timeoutProducerSequence, producer.sequence);
  assert.equal(push.pushReason, optionalType === 'PREENTRY' ? 'OPTIONAL_PREENTRY' : 'OPTIONAL_BUSTIME'); assert.equal(push.errorOrigin, 'INHERITED_RESULT');
  assert.equal(push.timeoutProducerSequence, producer.sequence); assert.equal(h.messages.at(-1).errorCode, 'TURSO_LIVE_TIMEOUT');
});

test('healthy replacement plus optional completion clears old lineage and product error normally', async () => {
  const h = harness(); h.owner.branch = 'NE1'; h.owner.lastResult = await failedRefresh(h);
  h.owner.sendAcceptedSnapshot('NE1', 'MAIN_REFRESH_COMPLETION');
  const healthy = await h.ctx.msProducerRefresh(h.env, 'NE1', async () => ({ ...prior }));
  h.owner.lastResult = healthy; h.owner.sendAcceptedSnapshot('NE1', 'MAIN_REFRESH_COMPLETION'); h.owner.acceptOptional('NE1', 'BUSTIME');
  const trace = h.trace('NE1'), push = trace.events.at(-1);
  assert.equal(push.refreshInstanceId, 2); assert.equal(push.errorOrigin, 'NO_DB_ERROR'); assert.equal(push.timeoutProducerSequence, undefined);
  assert.equal(push.dbOperationId, undefined); assert.equal(h.messages.at(-1).errorCode, ''); assert.equal(h.messages.at(-1).msStatus, 'synced');
  assert.equal(trace.events.filter(e => e.eventType === 'TURSO_TIMEOUT_PRODUCED').length, 1);
  assert.equal(Object.getOwnPropertySymbols(healthy).length, 0); assert.deepEqual(healthy, prior);
});

test('latched wrapper rethrow retains original producer; no duplicate creation or new DB call', async () => {
  const h = harness(); let actual = 0;
  h.env.DB._pipeline = async () => { actual++; throw Object.assign(new Error('SECRET'), {code:'TURSO_LIVE_TIMEOUT'}); };
  await h.ctx.msProducerRefresh(h.env, 'NE1', async env => {
    const live = h.ctx.msLiveDatabaseEnv(env); let first;
    try { await live.DB._pipeline(requests('UPDATE ms_live_cache SET rows_json=?')); } catch(e) { first=e; }
    try { await live.DB._pipeline(requests('SELECT * FROM ms_connections')); } catch(e) { assert.equal(e, first); return h.ctx.msProducerCaughtResult(live,{...prior,status:'degraded',errorCode:e.code},e); }
  });
  assert.equal(actual,1); assert.equal(h.trace('NE1').events.filter(e=>e.eventType==='TURSO_TIMEOUT_PRODUCED').length,1);
  assert.equal(h.trace('NE1').events.at(-1).operationClass,'LIVE_CACHE_WRITE');
});

test('bounded 64-event buffer pins first producer and its first correlated push once', () => {
  let clock = 0; const trace = createMsTursoProducerTrace(() => clock++);
  const first = trace.record('TURSO_TIMEOUT_PRODUCED', { hub: 'NE1' });
  const push = trace.record('ACCEPTED_PUSH_PROVENANCE', { hub: 'NE1', timeoutProducerSequence: first.sequence });
  for (let i = 0; i < 250; i++) trace.record('TURSO_TIMEOUT_PRODUCED', { hub:'NE1' });
  const output = trace.snapshot(); assert.equal(output.events.length,64); assert.equal(output.firstProducerSequence,first.sequence); assert.equal(output.firstCorrelatedPushSequence,push.sequence);
  assert.equal(output.events.filter(e=>e.marker==='FIRST_TURSO_TIMEOUT_PRODUCER').length,1); assert.equal(output.events.filter(e=>e.marker==='FIRST_CORRELATED_TIMEOUT_PUSH').length,1);
  output.events[0].hub='MUTATED'; assert.equal(trace.snapshot().events[0].hub,'NE1');
});

test('safe projector drops SQL/bindings/rows/secrets/messages/stacks/URLs and unknown enums', () => {
  const trace = createMsTursoProducerTrace(); trace.record('TURSO_TIMEOUT_PRODUCED', { hub:'NE1', sql:'SECRET_SQL',args:['SECRET_BIND'],rows:[{phone:'SECRET_PHONE'}],authorization:'SECRET',message:'SECRET_ERROR',stack:'SECRET_STACK',url:'SECRET_URL',operationClass:'SECRET',producerKind:'SECRET',errorCode:'SECRET',lastAcceptedSourceTimestamp:'SECRET',dbTrace:{ failureStage:'SECRET',sql:'SECRET',pipelines:[{stage:'SECRET',rows:['SECRET'],sql:'SECRET'}] } });
  const json=JSON.stringify(trace.snapshot()); assert.doesNotMatch(json,/SECRET|"sql"|"args"|"rows"|"message"|"stack"|"url"|"authorization"/);
});

test('non-DEV Worker is inert, leaves serialization unchanged, canonical source has no diagnostic', async () => {
  const h=harness(false); const result=await h.ctx.msProducerRefresh(h.env,'NE1',async env=>{ await h.ctx.msLiveDatabaseEnv(env).DB._pipeline(requests('SELECT * FROM ms_live_cache')); return {...prior}; });
  h.owner.branch='NE1'; h.owner.lastResult=result; h.owner.acceptOptional('NE1','PREENTRY');
  assert.equal(h.calls(),1); assert.equal(h.trace('NE1').events.length,0); assert.equal(h.messages.at(-1).msTursoTimeoutProducerTrace,undefined);
  assert.doesNotMatch(canonical,/MS_TURSO_TIMEOUT_PRODUCER_V1/); assert.doesNotMatch(fs.readFileSync(path.join(root,'worker/src/index.js'),'utf8'),/MS_TURSO_TIMEOUT_PRODUCER_V1/);
});

test('diagnostic-only helpers have no I/O, timer, storage, provider or acquisition path', () => {
  const code=helpers+frontend.slice(frontend.indexOf('// MS_TURSO_TIMEOUT_PRODUCER_V1_FRONTEND'));
  assert.doesNotMatch(code,/\bfetch\s*\(|new WebSocket\s*\(|setInterval\s*\(|setTimeout\s*\(|\.DB\.prepare\s*\(|\.storage\.(put|delete)\s*\(|localStorage|sessionStorage|apiPost\s*\(|curl_pno|msPno|tbrProvenance/);
  assert.match(worker,/remainingBudget = 2800/); assert.match(worker,/routePersistenceBudget = 60_000/); assert.match(worker,/remaining - \(Date.now\(\) - started\) < 200/);
  assert.match(worker,/env\.MS_OPTIONAL_ACCEPT\?\.\(name\)/); assert.match(worker,/sendAcceptedSnapshot\(branch, "MAIN_REFRESH_COMPLETION"\)/);
});

test('final composer is idempotent and retains old diagnostic and generic staging', () => {
  assert.equal(patchMsTursoTimeoutProducerWorker(worker),worker); assert.equal(patchMsTursoTimeoutProducerFrontend(frontend),frontend); assert.equal(stageFrontend(frontend),frontend);
  assert.match(worker,/MS_REDEGRADE_TRACE_V1_WORKER/); assert.match(frontend,/MS_REDEGRADE_TRACE_V1_FRONTEND/);
  assert.match(frontend,/DEV diagnostic · MS_TURSO_TIMEOUT_PRODUCER_V1/); assert.match(worker,/msTursoTimeoutProducerTrace/);
  assert.match(worker,/pollMs: 4000/);
});

function frontHarness(host='waiting-trucks-report-api-dev.26nak-testdev.workers.dev') {
  let requests=0, copies=0; const nodes=[];
  const ctx={location:{hostname:host},performance:{now:()=>10},state:{auth:{token:'SECRET'},branch:'NE1'},
    document:{body:{append:node=>nodes.push(node)},getElementById:id=>nodes.find(n=>n.id===id),createElement:tag=>({tag,style:{},children:[],callbacks:{},append(...children){this.children.push(...children);},setAttribute(){},addEventListener(key,fn){this.callbacks[key]=fn;},querySelector(tag){return this.children.find(n=>n.tag===tag);},select(){}})},
    navigator:{clipboard:{writeText:async()=>{copies++;}}},handleRealtimeMessage:()=>7,applyLiveResult:()=>8,apiGet:async()=>{requests++;return {};},authUi:()=>9};
  vm.createContext(ctx); vm.runInContext(frontend.slice(frontend.indexOf('// MS_TURSO_TIMEOUT_PRODUCER_V1_FRONTEND')),ctx);
  return {ctx,nodes,counts:()=>({requests,copies})};
}

test('owner readonly collapsed card and Copy JSON perform no request; backend IDs survive ingestion', async () => {
  const h=frontHarness(); const card=h.nodes[0]; assert.equal(card.tag,'details'); assert.equal(Boolean(card.open),false); assert.equal(card.hidden,false);
  const trace=createMsTursoProducerTrace(()=>100); for(let i=0;i<5;i++)trace.record('DB_ATTEMPT',{hub:'EA2'});
  const producer=trace.record('TURSO_TIMEOUT_PRODUCED',{hub:'NE1',dbOperationId:4,refreshInstanceId:2,errorCode:'TURSO_LIVE_TIMEOUT'});
  trace.record('ACCEPTED_PUSH_PROVENANCE',{hub:'NE1',timeoutProducerSequence:producer.sequence,errorCode:'TURSO_LIVE_TIMEOUT'});
  assert.equal(h.ctx.handleRealtimeMessage(JSON.stringify({msTursoTimeoutProducerTrace:trace.snapshot()})),7);
  const snap=h.ctx.msTursoTimeoutProducerV1(); assert.equal(snap.firstProducerSequence,producer.sequence); assert.equal(snap.events.at(-1).timeoutProducerSequence,producer.sequence); assert.equal(snap.firstCorrelatedPushSequence,trace.snapshot().firstCorrelatedPushSequence);
  card.open=true; card.callbacks.toggle(); assert.equal(card.querySelector('textarea').readOnly,true); assert.doesNotMatch(card.querySelector('textarea').value,/SECRET/);
  card.querySelector('button').callbacks.click(); await flush(); assert.deepEqual(h.counts(),{requests:0,copies:1});
  h.ctx.state.auth=null; h.ctx.authUi(); assert.equal(card.hidden,true); assert.equal(card.querySelector('textarea').value,'');
});

test('non-DEV frontend does not create panel or wrap application handlers', () => {
  const h=frontHarness('production.example'); assert.equal(h.nodes.length,0); assert.equal(h.ctx.msTursoTimeoutProducerV1,undefined); assert.equal(h.ctx.handleRealtimeMessage(''),7);
});

test('actual staged runMsRefresh credential catch retains exact operation provenance', async () => {
  const h=harness(); h.ctx.recentMsSync.set('NE1',{result:{...prior}});
  h.env.DB._pipeline=async()=>{throw Object.assign(new Error('SECRET'),{code:'TURSO_LIVE_TIMEOUT'});};
  h.ctx.msCredentials=async env=>env.DB._pipeline(requests('SELECT * FROM ms_connections WHERE hub=?'));
  vm.runInContext('async '+fn('runMsRefresh'),h.ctx);
  const result=await h.ctx.runMsRefresh(h.env,'NE1');
  const trace=h.trace('NE1'),producer=trace.events.filter(e=>e.eventType==='TURSO_TIMEOUT_PRODUCED').at(-1),refresh=trace.events.at(-1);
  assert.equal(result.status,'degraded'); assert.equal(result.syncedAt,prior.syncedAt);
  assert.equal(producer.operationClass,'CREDENTIAL_DB_READ'); assert.equal(refresh.producerSequence,producer.sequence);
  assert.equal(refresh.errorOrigin,'CURRENT_OPERATION_FAILURE'); assert.equal(refresh.resultInstanceId,1);
});

test('actual staged runMsRefresh main catch correlates two successful cache reads and current WRITE timeout', async () => {
  const h=harness(); let reads=0;
  h.ctx.recentMsSync.set('NE1',{result:{...prior}});
  Object.assign(h.ctx,{
    MS_SYNC_TTL:3000,MS_LIVE_CACHE_VERSION:'completion-v2',busTimeRouteHints:new Map(),
    msCredentials:async()=>({}),readMsRoutes:async()=>[{id:'PRIVATE_ROW',proofId:'PRIVATE_PROOF'}],
    startMsOptionalRefresh(){},mapMsRow:row=>row,supervisorRefreshSourceTelemetry:()=>({}),
    text:value=>String(value||''),date:value=>value,holdTransientEmptyMsSource:async()=>null,
    sha:async()=> 'hash',canonicalMsSource:()=> 'source',thaiDay:()=> 'today',
    readMsLiveCache:async env=>{reads++;await env.DB._pipeline(requests('SELECT * FROM ms_live_cache WHERE hub=?'));return {sourceMatch:false,format:7,completedDay:'today',completedRows:[],rows:prior.rows};},
    acquireMsSyncClaim:async()=>({acquired:true}),finishMsSyncClaim:async()=>{},
    syncMs:async(body,actor,env)=>env.DB._pipeline(requests('UPDATE ms_routes SET source_updated_at=? WHERE hub=?')),
  });
  let actual=0; h.env.DB._pipeline=()=>{actual++;return actual<=2?Promise.resolve({}):new Promise(()=>{});};
  vm.runInContext('async '+fn('runMsRefresh'),h.ctx);
  const task=h.ctx.runMsRefresh(h.env,'NE1');await flush();h.expire();const result=await task;
  assert.equal(reads,2);assert.equal(actual,3);assert.equal(result.status,'degraded');assert.equal(result.syncedAt,prior.syncedAt);
  const trace=h.trace('NE1'),producer=trace.events.filter(e=>e.eventType==='TURSO_TIMEOUT_PRODUCED').at(-1),refresh=trace.events.at(-1);
  assert.equal(producer.operationClass,'ROUTE_BATCH_WRITE');assert.equal(producer.readOrWrite,'WRITE');assert.equal(producer.dbOperationId,3);
  assert.equal(refresh.producerSequence,producer.sequence);assert.equal(refresh.errorOrigin,'CURRENT_OPERATION_FAILURE');
  h.owner.branch='NE1';h.owner.lastResult=h.ctx.mergeMsOptionalResult('NE1',result);h.owner.sendAcceptedSnapshot('NE1','MAIN_REFRESH_COMPLETION');
  assert.equal(h.trace('NE1').events.at(-1).timeoutProducerSequence,producer.sequence);
});

test('already-existing standalone settings pipeline is observable with HUB and no invented refresh ID', async () => {
  const h=harness();h.env.DB._pipeline=()=>new Promise(()=>{});
  const task=h.ctx.msLiveDatabaseEnv(h.env,'EA2').DB._pipeline(requests('SELECT * FROM hub_settings WHERE hub=?'));
  h.expire();await assert.rejects(task,{code:'TURSO_LIVE_TIMEOUT'});
  const producer=h.trace('EA2').events.find(e=>e.eventType==='TURSO_TIMEOUT_PRODUCED');
  assert.equal(producer.operationClass,'SETTINGS_DB_READ');assert.equal(producer.readOrWrite,'READ');assert.equal(producer.refreshInstanceId,null);assert.equal(producer.hub,'EA2');
});

test('error object owned by an older refresh is labeled inherited, never current by assumption', async () => {
  const h=harness();const shared=Object.assign(new Error('SECRET'),{code:'TURSO_LIVE_TIMEOUT'});
  h.env.DB._pipeline=async()=>{throw shared;};
  const run=async env=>{const live=h.ctx.msLiveDatabaseEnv(env);try{await live.DB._pipeline(requests('UPDATE ms_live_cache SET rows_json=?'));}catch(error){return h.ctx.msProducerCaughtResult(live,{...prior,status:'degraded',errorCode:error.code},error);}};
  await h.ctx.msProducerRefresh(h.env,'NE1',run);await h.ctx.msProducerRefresh(h.env,'NE1',run);
  const events=h.trace('NE1').events;assert.equal(events.filter(e=>e.eventType==='TURSO_TIMEOUT_PRODUCED').length,1);
  assert.equal(events.at(-1).refreshInstanceId,2);assert.equal(events.at(-1).producerRefreshInstanceId,1);assert.equal(events.at(-1).errorOrigin,'INHERITED_RESULT');
});

test('diagnostic DOM failure cannot interrupt existing message or authentication handlers', () => {
  const h=frontHarness();h.ctx.document.getElementById=()=>{throw new Error('DOM_UNAVAILABLE');};
  const trace=createMsTursoProducerTrace();trace.record('TURSO_TIMEOUT_PRODUCED',{hub:'NE1'});
  assert.equal(h.ctx.handleRealtimeMessage(JSON.stringify({msTursoTimeoutProducerTrace:trace.snapshot()})),7);
  assert.equal(h.ctx.authUi(),9);
});
