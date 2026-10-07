import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createMsTursoProducerTrace } from './patch-ms-turso-timeout-producer-v1.mjs';
import { createMsLateSettleTrace, observeMsLateSettle, patchMsTursoLateSettleWorker, patchMsTursoLateSettleFrontend } from './patch-ms-turso-late-settle-v1.mjs';
const root = path.resolve(import.meta.dirname, '../..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-late-settle-'));
for (const file of fs.readdirSync(root).filter(file => /\.(html|css)$/.test(file) || file === 'ms.js')) fs.copyFileSync(path.join(root, file), path.join(dir, file));
fs.copyFileSync(path.join(root, 'worker/src/index.js'), path.join(dir, 'index.js'));
execFileSync(process.execPath, [path.join(root, '.github/dev-tools/stage-dev-runtime.mjs'), path.join(dir, 'ms.js'), path.join(dir, 'index.js')], { stdio: 'pipe' });
const worker = fs.readFileSync(path.join(dir, 'index.js'), 'utf8'), frontend = fs.readFileSync(path.join(dir, 'ms.js'), 'utf8');
execFileSync(process.execPath, ['--check', path.join(dir, 'index.js')]);
execFileSync(process.execPath, ['--check', path.join(dir, 'ms.js')]);
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
function fn(name) { const start = worker.indexOf('function ' + name + '('), rest = worker.slice(start); assert.ok(start >= 0); return rest.slice(0, rest.indexOf('\n}') + 2); }
function harness(dev = true, background = true) {
  let clock = 0, id = 0, calls = 0, rollbacks = 0;
  const timers = new Map(), tasks = [], pending = deferred(), rollback = deferred();
  const ctx = { AbortController, Date: class extends Date { static now() { return clock; } }, console: { warn() {} },
    setTimeout(fn, ms) { const key = ++id; timers.set(key, { fn, at: clock + ms, ms }); return key; }, clearTimeout(key) { timers.delete(key); } };
  vm.createContext(ctx);
  vm.runInContext(worker.slice(worker.indexOf('// MS_TURSO_TIMEOUT_PRODUCER_V1_WORKER')) + '\n' + fn('msLiveDbStage') + '\n' + fn('msTursoAvailability') + '\n' + fn('msLiveDatabaseEnv'), ctx);
  const env = { DEV_ACCEPTANCE_TELEMETRY: dev ? '1' : '0', DB: {
    _pipeline() { calls++; return pending.promise; }, _finishTransaction() { rollbacks++; return rollback.promise; }
  } };
  if (background) env.MS_BACKGROUND_WAIT = task => tasks.push(task);
  const advance = async ms => { clock += ms; for (const [key, timer] of [...timers]) if (timer.at <= clock) { timers.delete(key); timer.fn(); } await flush(); };
  const trace = () => JSON.parse(JSON.stringify(ctx.msProducerTraceEnvelope(env, 'NE1').msTursoLateSettleTrace || { events: [] }));
  const run = (sql, tolerate = false) => ctx.msProducerRefresh(env, 'NE1', async observed => {
    try { await ctx.msLiveDatabaseEnv(observed).DB._pipeline([{ type: 'execute', stmt: { sql, args: ['SECRET_BIND'] } }]); }
    catch (error) { if (!tolerate) return ctx.msProducerCaughtResult(observed, { status: 'degraded', errorCode: error.code }, error); }
    return { status: 'synced', errorCode: '' };
  });
  const push = result => ctx.msProducerPushEnvelope(env, 'NE1', 'MAIN_REFRESH_COMPLETION', result);
  return { ctx, env, tasks, timers, pending, rollback, advance, elapse: ms => { clock += ms; }, trace, run, push, calls: () => calls, rollbacks: () => rollbacks };
}
for (const [sql, operationClass, deadline, settle] of [
  ['SELECT * FROM ms_routes', 'ROUTE_STATE_READ', 2800, 3000],
  ['UPDATE ms_live_cache SET rows_json=?', 'LIVE_CACHE_WRITE', 2508, 5000],
]) test(`${operationClass}: same submitted promise late success, product timeout unchanged`, async () => {
  const h = harness();
  if (deadline === 2508) {
    let first = true; h.env.DB._pipeline = () => { if (first) { first = false; return Promise.resolve({}); } return h.pending.promise; };
    h.run = () => h.ctx.msProducerRefresh(h.env, 'NE1', async env => {
      const db = h.ctx.msLiveDatabaseEnv(env).DB;
      const a = db._pipeline([{type:'execute',stmt:{sql:'SELECT * FROM arbitrary'}}]); h.elapse(292); await a;
      try { await db._pipeline([{type:'execute',stmt:{sql}}]); } catch(error) { return h.ctx.msProducerCaughtResult(env,{status:'degraded',errorCode:error.code},error); }
    });
  }
  const task = h.run(sql); await flush(); await h.advance(deadline); const result = await task;
  assert.equal(result.errorCode, 'TURSO_LIVE_TIMEOUT'); h.push(result);
  assert.equal(h.trace().events[0].operationClass, operationClass); assert.equal(h.trace().events[0].deadlineMs, deadline);
  await h.advance(settle - deadline); h.pending.resolve({ privatePayload: 'SECRET' }); await flush();
  const event = h.trace().events.at(-1); assert.equal(event.eventType,'LATE_SETTLE_SUCCESS'); assert.equal(event.lateAfterDeadlineMs,settle-deadline); assert.equal(event.productDegraded,true);
  assert.equal(h.tasks.length,1); await Promise.all(h.tasks); assert.doesNotMatch(JSON.stringify(h.trace()),/SECRET/);
});
test('late rejection is closed/sanitized and cannot change product timeout', async () => {
  const h=harness(), task=h.run('SELECT * FROM ms_routes'); await flush(); await h.advance(2800); const result=await task;
  h.pending.reject(Object.assign(new Error('SECRET_URL token'),{code:'TOKEN_SECRET',status:503})); await flush();
  assert.equal(h.trace().events.at(-1).eventType,'LATE_SETTLE_ERROR'); assert.equal(h.trace().events.at(-1).errorCode,'OTHER_SAFE_ERROR'); assert.equal(h.trace().events.at(-1).status,503); assert.equal(h.trace().events.at(-1).errorCategory,'HTTP_ERROR'); assert.equal(result.errorCode,'TURSO_LIVE_TIMEOUT'); assert.equal(h.calls(),1);
});
test('never settling promise ends background lifetime after exactly 15 seconds', async () => {
  const h=harness(), task=h.run('SELECT * FROM ms_routes'); await flush(); await h.advance(2800); await task;
  await h.advance(14999); assert.equal(h.trace().events.length,1); await h.advance(1); await Promise.all(h.tasks);
  assert.equal(h.trace().events.at(-1).eventType,'LATE_SETTLE_WINDOW_EXPIRED'); h.pending.resolve({}); await flush(); assert.equal(h.trace().events.length,2);
});
test('normal predeadline success emits no late observation or background task', async () => {
  const h=harness(), task=h.run('SELECT * FROM ms_routes'); await flush(); await h.advance(100); h.pending.resolve({});
  assert.equal((await task).status,'synced'); assert.equal(h.trace().events.length,0); assert.equal(h.tasks.length,0);
});
test('transaction late success observes original rollback exactly once', async () => {
  const h=harness(), task=h.run('BEGIN; INSERT INTO ms_routes VALUES(?)'); await flush(); await h.advance(2800); await task;
  await h.advance(200); h.pending.resolve({ baton: 'PRIVATE' }); await flush(); assert.equal(h.rollbacks(),1);
  h.rollback.resolve({}); await flush(); await Promise.all(h.tasks);
  assert.equal(h.trace().events.at(-1).eventType,'TRANSACTION_LATE_ROLLBACK_RESULT'); assert.equal(h.trace().events.at(-1).rollbackOutcome,'SUCCESS'); assert.equal(h.trace().events[0].readOrWrite,'TRANSACTION'); assert.equal(h.calls(),1);
});
test('rollback error and stalled rollback remain bounded without second rollback', async () => {
  for (const fails of [true,false]) { const h=harness(),task=h.run('BEGIN; INSERT INTO ms_routes VALUES(?)'); await flush();await h.advance(2800);await task;h.pending.resolve({});await flush();
    if(fails) h.rollback.reject(new Error('SECRET')); else await h.advance(15000);await flush();await Promise.all(h.tasks);assert.equal(h.rollbacks(),1);
    assert.equal(h.trace().events.at(-1).eventType,fails?'TRANSACTION_LATE_ROLLBACK_RESULT':'LATE_SETTLE_WINDOW_EXPIRED'); }
});
test('CLAIM 921ms timeout can be tolerated; accepted synced is not degraded', async () => {
  const h=harness();let first=true;h.env.DB._pipeline=()=>{if(first){first=false;return Promise.resolve({});}return h.pending.promise;};
  const task=h.ctx.msProducerRefresh(h.env,'NE1',async env=>{const db=h.ctx.msLiveDatabaseEnv(env).DB;const a=db._pipeline([{type:'execute',stmt:{sql:'SELECT * FROM arbitrary'}}]);h.elapse(1879);await a;try{await db._pipeline([{type:'execute',stmt:{sql:'UPDATE ms_sync_claims SET status=?'}}]);}catch{}return{status:'synced',errorCode:''};});
  await flush();await h.advance(921);const result=await task;h.push(result);assert.equal(result.status,'synced');assert.equal(result.errorCode,'');assert.equal(h.trace().events[0].deadlineMs,921);assert.equal(h.trace().events[0].operationClass,'CLAIM_WRITE');assert.equal(h.trace().events[0].productDegraded,false);
  h.pending.resolve({});await flush();assert.equal(h.trace().events.at(-1).productDegraded,false);
});
test('existing eligible retry observes only physical attempt 2, never submits attempt 3', async () => {
  const h=harness();let calls=0;h.env.DB._pipeline=()=>{calls++;return calls===1?Promise.reject(Object.assign(new Error('safe'),{code:'TURSO_NETWORK_ERROR'})):h.pending.promise;};
  const task=h.run('SELECT * FROM ms_live_cache');await flush();await h.advance(2800);await task;assert.equal(calls,2);assert.equal(h.trace().events[0].attempt,2);
  h.pending.resolve({});await flush();assert.equal(calls,2);assert.equal(h.trace().events.at(-1).attempt,2);
});
test('missing background lifetime is explicit; no unsupported observer is installed', async()=>{
  const h=harness(true,false),task=h.run('SELECT * FROM ms_routes');await flush();await h.advance(2800);await task;
  assert.equal(h.trace().lifetime,'LATE_SETTLE_OBSERVATION_LIFETIME_UNAVAILABLE');assert.equal(h.trace().events.length,0);assert.equal(h.tasks.length,0);h.pending.resolve({});await flush();
});
test('DEV-only telemetry and no canonical/production contamination',async()=>{
  const h=harness(false),task=h.run('SELECT * FROM ms_routes');await flush();await h.advance(2800);await task;assert.equal(h.trace().events.length,0);assert.equal(h.tasks.length,0);
  for(const file of ['worker/src/index.js','ms.js','worker/wrangler.example.jsonc']) assert.doesNotMatch(fs.readFileSync(path.join(root,file),'utf8'),/MS_TURSO_LATE_SETTLE_V1/);
  assert.match(frontend,/location.hostname !== 'waiting-trucks-report-api-dev/);
});
test('closed projector sanitizes secrets, bounds 64 events and carries exact push correlation',()=>{
  const trace=createMsLateSettleTrace();for(let i=0;i<100;i++)trace.record('LOCAL_DEADLINE_EXPIRED',{hub:'NE1',refreshInstanceId:2,producerSequence:4,sql:'SECRET',url:'SECRET',message:'SECRET',token:'SECRET',errorCode:'SECRET'});
  trace.correlate(2,4,true,'CURRENT_OPERATION_FAILURE','MAIN_REFRESH_COMPLETION');const snapshot=trace.snapshot();assert.equal(snapshot.events.length,64);assert.equal(snapshot.events.at(-1).productDegraded,true);assert.doesNotMatch(JSON.stringify(snapshot),/SECRET/);
  trace.record('LATE_SETTLE_SUCCESS',{refreshInstanceId:2,producerSequence:4});assert.equal(trace.snapshot().events.at(-1).productDegraded,true);
});
test('patch composition order/idempotence, unchanged #765 budgets and acquisition boundaries',()=>{
  assert.equal(patchMsTursoLateSettleWorker(worker),worker);assert.equal(patchMsTursoLateSettleFrontend(frontend),frontend);assert.throws(()=>patchMsTursoLateSettleWorker('wrong'),/anchor mismatch/);
  assert.match(worker,/remainingBudget = 2800/);assert.match(worker,/routePersistenceBudget = 60_000/);assert.match(worker,/stage === "route_state_read" \|\| stage === "route_batch_write"/);assert.match(worker,/routeScoped\s*\? Math.min\(2800, routePersistenceBudget\)/);
  const implementation=fs.readFileSync(new URL('./patch-ms-turso-late-settle-v1.mjs',import.meta.url),'utf8');assert.doesNotMatch(implementation,/\bfetch\s*\(|\.prepare\s*\(|setInterval\s*\(|curl_pno|tbrProvenance|apiGet\s*\(/);
  assert.equal((worker.match(/database\._pipeline\(\.\.\.args\)/g)||[]).length,2);
  const stage=fs.readFileSync(new URL('./stage-dev-runtime.mjs',import.meta.url),'utf8');assert.match(stage,/patchMsTursoLateSettleWorker\(patchMsTursoTimeoutProducerWorker/);assert.match(stage,/patchMsTursoLateSettleFrontend\(patchMsTursoTimeoutProducerFrontend/);
});
test('existing DEV diagnostic copy surface exposes late events safely without requests', async () => {
  let requests=0,copies=0; const nodes=[];
  const ctx={location:{hostname:'waiting-trucks-report-api-dev.26nak-testdev.workers.dev'},performance:{now:()=>10},state:{auth:{token:'SECRET'},branch:'NE1'},
    document:{body:{append:node=>nodes.push(node)},getElementById:id=>nodes.find(n=>n.id===id),createElement:tag=>({tag,style:{},children:[],callbacks:{},append(...children){this.children.push(...children);},setAttribute(){},addEventListener(key,fn){this.callbacks[key]=fn;},querySelector(tag){return this.children.find(n=>n.tag===tag);},select(){}})},
    navigator:{clipboard:{writeText:async()=>{copies++;}}},handleRealtimeMessage:()=>7,applyLiveResult:()=>8,apiGet:async()=>{requests++;return {};},authUi:()=>9};
  const declaration = frontend.slice(frontend.indexOf('function msTursoProducerFrontend()'));
  vm.createContext(ctx);vm.runInContext(createMsTursoProducerTrace.toString() + '\n' + createMsLateSettleTrace.toString() + '\n' + declaration.slice(0, declaration.indexOf('\n}') + 2) + '\nmsTursoProducerFrontend();',ctx);
  const trace=createMsLateSettleTrace();trace.record('LOCAL_DEADLINE_EXPIRED',{hub:'NE1',dbOperationId:4,producerSequence:8,refreshInstanceId:2,deadlineMs:2800,transaction:false});
  trace.correlate(2,8,true,'CURRENT_OPERATION_FAILURE','MAIN_REFRESH_COMPLETION');trace.record('LATE_SETTLE_SUCCESS',{hub:'NE1',dbOperationId:4,producerSequence:8,refreshInstanceId:2,lateAfterDeadlineMs:200,token:'SECRET'});
  const envelope={msTursoLateSettleTrace:{...trace.snapshot(),lifetime:'AVAILABLE'},msTursoTimeoutProducerTrace:{name:'MS_TURSO_TIMEOUT_PRODUCER_V1',events:[]}};
  assert.equal(ctx.handleRealtimeMessage(JSON.stringify(envelope)),7);const snap=ctx.msTursoTimeoutProducerV1().lateSettle;
  assert.equal(snap.events.length,2);assert.equal(snap.events.at(-1).producerSequence,8);assert.equal(snap.events.at(-1).productDegraded,true);assert.equal(snap.events.at(-1).lateAfterDeadlineMs,200);
  assert.equal(ctx.handleRealtimeMessage(JSON.stringify({msTursoLateSettleTrace:{name:'MS_TURSO_LATE_SETTLE_V1',events:[null]}})),7);
  ctx.handleRealtimeMessage(JSON.stringify(envelope));
  assert.equal(nodes.length,1);nodes[0].open=true;nodes[0].callbacks.toggle();nodes[0].querySelector('button').callbacks.click();await flush();
  assert.equal(requests,0);assert.equal(copies,1);assert.doesNotMatch(nodes[0].querySelector('textarea').value,/SECRET/);
  envelope.msTursoLateSettleTrace.lifetime='LATE_SETTLE_OBSERVATION_LIFETIME_UNAVAILABLE';ctx.handleRealtimeMessage(JSON.stringify(envelope));assert.equal(ctx.msTursoTimeoutProducerV1().lateSettle.lifetime,envelope.msTursoLateSettleTrace.lifetime);
});
