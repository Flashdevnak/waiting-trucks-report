import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { patchMsTursoStallContainmentV1, patchMsTursoStallAdapterV1 } from './patch-ms-turso-stall-containment-v1.mjs';
const root = path.resolve(import.meta.dirname, '../..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-stall-'));
for (const file of fs.readdirSync(root).filter(file => /\.(html|css)$/.test(file) || file === 'ms.js')) fs.copyFileSync(path.join(root,file),path.join(dir,file));
fs.copyFileSync(path.join(root,'worker/src/index.js'),path.join(dir,'index.js'));
execFileSync(process.execPath,[path.join(root,'.github/dev-tools/stage-dev-runtime.mjs'),path.join(dir,'ms.js'),path.join(dir,'index.js')],{stdio:'pipe'});
const worker=fs.readFileSync(path.join(dir,'index.js'),'utf8'),adapter=fs.readFileSync(path.join(dir,'turso-d1.js'),'utf8');
execFileSync(process.execPath,['--check',path.join(dir,'index.js')]);
execFileSync(process.execPath,['--check',path.join(dir,'turso-d1.js')]);
process.on('exit',()=>fs.rmSync(dir,{recursive:true,force:true}));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<100;i++)await Promise.resolve();};
function fn(name){const start=worker.indexOf('function '+name+'(');assert.ok(start>=0);const rest=worker.slice(start);return rest.slice(0,rest.indexOf('\n}')+2);}
function method(name){const start=worker.indexOf('  async '+name+'(');assert.ok(start>=0);const rest=worker.slice(start);return rest.slice(0,rest.indexOf('\n  }')+4);}
const sqlRequests=sql=>[{type:'execute',stmt:{sql,args:[]}}];
function harness(){
 let now=0,next=0,rollbacks=0;const timers=new Map(),calls=[],tasks=[];let behavior=()=> 'stall';
 const ctx={AbortController,URL,console:{warn(){},error(){}},Date:class extends Date{static now(){return now;}},
  setTimeout(fn,ms){const id=++next;timers.set(id,{fn,at:now+ms,ms});return id;},clearTimeout(id){timers.delete(id);},
  CENTRAL_LIMITS:{},LIMITS:['6W'],PAUSES:[],msTraceEnvelope:()=>({}),recentMsSync:new Map()};
 vm.createContext(ctx);
 vm.runInContext(adapter.replace(/export /g,'')+'\nglobalThis.Database=TursoD1Database;',ctx);
 vm.runInContext(worker.slice(worker.indexOf('// MS_TURSO_TIMEOUT_PRODUCER_V1_WORKER'))+'\n'+fn('msLiveDbStage')+'\n'+fn('msTursoAvailability')+'\n'+fn('msLiveDatabaseEnv'),ctx);
 const db=new ctx.Database({url:'https://mock.invalid',authToken:'synthetic',fetchImpl:(url,init)=>{
  const pending=deferred(),call={signal:init.signal,body:JSON.parse(init.body),pending,settled:false};calls.push(call);
  const type=behavior(call,calls.length);
  const response=payload=>({ok:true,status:200,json:async()=>payload||{results:[]}});
  call.resolve=payload=>{call.settled=true;pending.resolve(response(payload));};
  if(type==='fast')call.resolve();
  else if(type==='error')pending.reject(new TypeError('mock unavailable'));
  else if(type==='http')pending.resolve({ok:false,status:503,json:async()=>({message:'mock'})});
  else if(type!=='race')init.signal?.addEventListener('abort',()=>{call.settled=true;pending.reject(new DOMException('mock aborted','AbortError'));},{once:true});
  return pending.promise;
 }});
 db._finishTransaction=async()=>{rollbacks++;return{};};
 const env={DEV_ACCEPTANCE_TELEMETRY:'1',DB:db,MS_BACKGROUND_WAIT:task=>tasks.push(task)};
 const run=(sql,tolerate=false)=>ctx.msProducerRefresh(env,'NE1',async observed=>{
  try{await ctx.msLiveDatabaseEnv(observed).DB._pipeline(sqlRequests(sql));}
  catch(error){if(!tolerate)return ctx.msProducerCaughtResult(observed,{status:'degraded',errorCode:error.code},error);}
  return{status:'synced',errorCode:''};
 });
 const advance=async ms=>{now+=ms;for(const [id,timer]of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}await flush();};
 return{ctx,db,env,calls,timers,tasks,run,advance,elapse:ms=>{now+=ms;},setBehavior:fn=>{behavior=fn;},rollbacks:()=>rollbacks,
  trace:()=>JSON.parse(JSON.stringify(ctx.msProducerTraceEnvelope(env,'NE1'))),push:result=>ctx.msProducerPushEnvelope(env,'NE1','MAIN_REFRESH_COMPLETION',result)};
}
test('transport stall aborts the same submission, settles promptly and preserves timeout classification',async()=>{
 const h=harness(),task=h.run('SELECT * FROM ms_live_cache');await flush();assert.equal(h.calls.length,1);await h.advance(2800);
 const result=await task;h.push(result);assert.equal(result.errorCode,'TURSO_LIVE_TIMEOUT');assert.equal(h.calls[0].signal.aborted,true);assert.equal(h.calls[0].settled,true);assert.equal(h.calls.length,1);
 await Promise.all(h.tasks);const events=h.trace().msTursoLateSettleTrace.events;assert.deepEqual(events.map(e=>e.eventType),['LOCAL_DEADLINE_EXPIRED','LATE_SETTLE_ERROR']);assert.equal(events.at(-1).lateAfterDeadlineMs,0);
 assert.ok(!events.some(e=>e.eventType==='LATE_SETTLE_WINDOW_EXPIRED'));assert.equal(h.timers.size,0);assert.equal(h.trace().msTursoTimeoutProducerTrace.events.find(e=>e.producerKind==='SUBMITTED_DEADLINE_EXPIRED').operationClass,'LIVE_CACHE_READ');
});
test('fast DB success leaves signal active and diagnostic empty',async()=>{
 const h=harness();h.setBehavior(()=> 'fast');const result=await h.run('SELECT * FROM ms_routes');assert.equal(result.status,'synced');assert.equal(h.calls[0].signal.aborted,false);assert.equal(h.tasks.length,0);assert.equal(h.trace().msTursoLateSettleTrace.events.length,0);
});
test('eligible retry has two independent physical owners and one shared deadline',async()=>{
 const h=harness();h.setBehavior((call,n)=>{if(n===1)return'error';return'stall';});const task=h.run('SELECT * FROM ms_live_cache');await flush();assert.equal(h.calls.length,2);
 assert.notEqual(h.calls[0].signal,h.calls[1].signal);h.elapse(300);await h.advance(2500);assert.equal((await task).errorCode,'TURSO_LIVE_TIMEOUT');assert.equal(h.calls[0].signal.aborted,false);assert.equal(h.calls[1].signal.aborted,true);assert.equal(h.calls.length,2);
});
for(const sql of ['UPDATE ms_live_cache SET rows_json=?','BEGIN; INSERT INTO ms_routes VALUES(?)'])test('write/transaction abort, no retry or invented rollback: '+sql,async()=>{
 const h=harness(),task=h.run(sql);await flush();await h.advance(2800);assert.equal((await task).errorCode,'TURSO_LIVE_TIMEOUT');assert.equal(h.calls.length,1);assert.equal(h.calls[0].signal.aborted,true);assert.equal(h.rollbacks(),0);
});
test('late transaction response crossing abort boundary rolls back exactly once, never commits',async()=>{
 const h=harness();h.setBehavior(()=> 'race');const task=h.run('BEGIN; INSERT INTO ms_routes VALUES(?)');await flush();await h.advance(2800);await task;
 h.calls[0].resolve({results:[],baton:'synthetic'});await flush();await Promise.all(h.tasks);assert.equal(h.rollbacks(),1);assert.equal(h.calls.length,1);
});
test('CLAIM write timeout stays tolerated with healthy accepted push',async()=>{
 const h=harness(),task=h.run('UPDATE ms_sync_claims SET status=?',true);await flush();await h.advance(2800);const result=await task;h.push(result);
 assert.equal(result.status,'synced');assert.equal(result.errorCode,'');assert.equal(h.calls[0].signal.aborted,true);assert.equal(h.trace().msTursoLateSettleTrace.events.at(-1).productDegraded,false);
});
// Execute the real final refresh cache/sync block, mocking only external dependencies.
function sourceHarness(){
 const h=harness();const stats={cache:0,sync:0,bootstrap:0,claim:0,wait:0,publish:0,finishSuccess:0,finishFailure:0};let cache=null,failSync=false,claim=true;
 Object.assign(h.ctx,{MS_LIVE_CACHE_VERSION:'completion-v2',sha:async value=>value,canonicalMsSource:rows=>rows[0].hash,
  readMsLiveCache:async(env,branch,hash)=>{stats.cache++;return cache?{...cache,sourceMatch:cache.sourceHash===hash}:null;},
  acquireMsSyncClaim:async()=>{stats.claim++;return{acquired:claim};},finishMsSyncClaim:async(env,branch,owner,success)=>{stats[success?'finishSuccess':'finishFailure']++;},waitForMsSourceCache:async()=>{stats.wait++;return null;},
  syncMs:async({rows})=>{stats.sync++;if(failSync)throw new Error('mock sync failed');return{rows,syncedAt:'accepted',changes:1};},
  writeMsLiveCache:async()=>{stats.publish++;return{success:true};},thaiDay:()=> 'day',bootstrapCompletedToday:async()=>{stats.bootstrap++;return[];},mergeCompletedToday:()=>[],
  safeStatusWrite:async p=>p,markConnectionSuccess:async()=>{},msQueueFirstSourceRows:rows=>rows,attachPnoViewMetadata:rows=>rows,MS_SYNC_TTL:3000});
 const start=worker.indexOf('    const sourceHash = MS_LIVE_CACHE_VERSION');const rest=worker.slice(start);const end=rest.indexOf('    return result;');assert.ok(end>0);
 h.ctx.sourceEnv={};
 vm.runInContext('async function testSource(branch,mappedRows){const env=sourceEnv,busData=new Map(),tbrShadowFeed=[],supervisorSourceTelemetry={};\n'+rest.slice(0,end+'    return result;'.length)+'\n}',h.ctx);
 return{...h,stats,runSource:(hash,hub='NE1')=>h.ctx.testSource(hub,[{hash,completionObservedLive:true}]),setCache:value=>{cache=value;},fail:value=>{failSync=value;},claim:value=>{claim=value;},memory:()=>vm.runInContext('msAcceptedSource',h.ctx)};
}
test('20 warm same-hash cycles perform zero cache-validation reads or sync acquisitions',async()=>{
 const h=sourceHarness();await h.runSource('A');const before={...h.stats};for(let i=0;i<20;i++){const result=await h.runSource('A');assert.equal(result.changes,0);assert.equal(result.status,'synced');}
 assert.equal(h.stats.cache,before.cache);assert.equal(h.stats.sync,before.sync);assert.equal(h.stats.bootstrap,before.bootstrap);assert.equal(h.stats.claim,before.claim);
});
test('warm changed hash skips both cache reads and advances memory only after accepted sync',async()=>{
 const h=sourceHarness();await h.runSource('A');const reads=h.stats.cache;await h.runSource('B');assert.equal(h.stats.cache,reads);assert.equal(h.stats.sync,2);assert.equal(h.memory().get('NE1').sourceHash,'completion-v2:B');
});
test('cold cache hit reads once, seeds memory and next warm refresh reads zero',async()=>{
 const h=sourceHarness();h.setCache({sourceHash:'completion-v2:A',format:7,rows:[{hash:'A'}],completedDay:'day',completedRows:[]});await h.runSource('A');assert.equal(h.stats.cache,1);assert.equal(h.stats.sync,0);await h.runSource('A');assert.equal(h.stats.cache,1);
});
test('cold miss preserves reconstruction/sync path and accepted seed',async()=>{
 const h=sourceHarness();await h.runSource('A');assert.equal(h.stats.cache,1,'cold cache miss allows one cache read');assert.equal(h.stats.sync,1);assert.equal(h.stats.publish,1);assert.equal(h.stats.finishSuccess,1);assert.equal(h.memory().get('NE1').sourceHash,'completion-v2:A');
});
// Execute the final claim SQL unchanged in SQLite; only transport and time are mocked.
function claimHarness(t){
 const h=sourceHarness(),db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(fs.readFileSync(path.join(root,'worker/migrations/0008_ms_sync_claims.sql'),'utf8'));
 const now=Date.parse('2026-10-07T12:00:00Z');let token=0,beforeClaim=async()=>{};
 h.ctx.Date=class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 h.ctx.crypto={randomUUID:()=> 'synthetic-claim-'+(++token)};
 h.ctx.sourceEnv.DB={prepare(sql){
  return{bind(...values){
   return{async run(){const result=db.prepare(sql).run(...values);return{meta:{changes:Number(result.changes)}};}};
  }};
 }};
 vm.runInContext('const MS_SYNC_CLAIM_LEASE_MS = 75000;\nasync '+fn('acquireMsSyncClaim')+'\nasync '+fn('finishMsSyncClaim')+'\nasync '+fn('waitForMsSourceCache'),h.ctx);
 const acquire=h.ctx.acquireMsSyncClaim,finish=h.ctx.finishMsSyncClaim,wait=h.ctx.waitForMsSourceCache;
 h.ctx.acquireMsSyncClaim=async(...args)=>{h.stats.claim++;await beforeClaim();return acquire(...args);};
 h.ctx.finishMsSyncClaim=async(...args)=>{h.stats[args[3]?'finishSuccess':'finishFailure']++;return finish(...args);};
 h.ctx.waitForMsSourceCache=async(...args)=>{h.stats.wait++;return wait(...args);};
 const hash='completion-v2:A';
 return{...h,db,hash,beforeClaim:hook=>{beforeClaim=hook;},
  acquireOther:()=>acquire(h.ctx.sourceEnv,'NE1',hash),finishOther:owner=>finish(h.ctx.sourceEnv,'NE1',owner,true),
  publishOther:()=>h.setCache({sourceHash:hash,format:7,rows:[{hash:'A',publisher:'B'}],completedDay:'day',completedRows:[]}),
  state:()=>db.prepare('SELECT state FROM ms_sync_claims WHERE hub=?').get('NE1')?.state};
}
test('single cold owner reads once, syncs/publishes once and finishes DONE',async t=>{
 const h=claimHarness(t);await h.runSource('A');assert.equal(h.stats.cache,1);assert.equal(h.stats.sync,1);assert.equal(h.stats.publish,1);assert.equal(h.stats.finishSuccess,1);assert.equal(h.state(),'DONE');
});
test('concurrent ACTIVE owner denies ownership and preserves bounded non-owner wait',async t=>{
 const h=claimHarness(t),other=await h.acquireOther();assert.equal(other.acquired,true);
 const pending=h.runSource('A');await flush();assert.equal(h.stats.cache,1);assert.equal(h.stats.wait,1);assert.equal(h.stats.sync,0);
 for(let i=0;i<6;i++)await h.advance(100);await pending;
 assert.equal(h.stats.cache,7);assert.equal(h.stats.sync,0);assert.equal(h.stats.publish,0);assert.equal(h.stats.finishSuccess,0);assert.equal(h.state(),'ACTIVE');assert.equal(h.memory().size,0);
});
test('DONE same-hash publication between initial miss and claim cannot grant ownership',async t=>{
 const h=claimHarness(t);let denied=false;
 h.beforeClaim(async()=>{const other=await h.acquireOther();assert.equal(other.acquired,true);h.publishOther();await h.finishOther(other);assert.equal(h.state(),'DONE');});
 const pending=h.runSource('A');await flush();assert.equal(h.stats.wait,1);denied=h.stats.sync===0;await h.advance(100);const result=await pending;
 assert.equal(denied,true);assert.equal(result.rows[0].publisher,'B');assert.equal(h.stats.cache,2);assert.equal(h.stats.sync,0);assert.equal(h.stats.publish,0);assert.equal(h.stats.finishSuccess,0);assert.equal(h.memory().get('NE1').sourceHash,h.hash);
});
test('ACTIVE publisher completing during wait is observed without duplicate business writes',async t=>{
 const h=claimHarness(t),other=await h.acquireOther(),pending=h.runSource('A');await flush();
 assert.equal(h.stats.wait,1);await h.advance(100);assert.equal(h.stats.sync,0);
 h.publishOther();await h.finishOther(other);await h.advance(100);const result=await pending;
 assert.equal(result.rows[0].publisher,'B');assert.equal(h.stats.sync,0);assert.equal(h.stats.publish,0);assert.equal(h.stats.cache,3);assert.equal(h.state(),'DONE');
});
for(const prior of ['FAILED','EXPIRED_ACTIVE'])test('cold owner takes over '+prior+' without a post-claim cache read',async t=>{
 const h=claimHarness(t);dbSeed();
 function dbSeed(){h.db.prepare('INSERT INTO ms_sync_claims VALUES(?,?,?,?,?,?,?)').run('NE1',h.hash,'prior-token',prior==='FAILED'?'FAILED':'ACTIVE','2026-10-07T11:59:59.000Z','2026-10-07T11:58:00.000Z','');}
 await h.runSource('A');assert.equal(h.stats.cache,1);assert.equal(h.stats.sync,1);assert.equal(h.stats.publish,1);assert.equal(h.stats.finishSuccess,1);assert.equal(h.state(),'DONE');
});
test('claim lease, acquisition SQL, finish SQL and non-owner wait helpers are unchanged',()=>{
 const canonicalClaim=fs.readFileSync(new URL('./patch-ms-multiclient-dedupe.mjs',import.meta.url),'utf8');
 for(const name of ['acquireMsSyncClaim','finishMsSyncClaim','waitForMsSourceCache'])assert.ok(canonicalClaim.includes(fn(name)),'unchanged '+name);
 assert.match(worker,/MS_SYNC_CLAIM_LEASE_MS = 75000/);assert.match(worker,/const settled = acceptedSource \? null : await waitForMsSourceCache\(env, branch, sourceHash\)/);
 assert.match(worker,/const currentCache = cache;/);assert.doesNotMatch(worker,/const currentCache = .*readMsLiveCache/);
});
test('failed sync or unacquired claim never poisons accepted hash',async()=>{
 const h=sourceHarness();await h.runSource('A');h.fail(true);await assert.rejects(h.runSource('B'));assert.equal(h.memory().get('NE1').sourceHash,'completion-v2:A');h.fail(false);h.claim(false);await h.runSource('C');assert.equal(h.memory().get('NE1').sourceHash,'completion-v2:A');assert.equal(h.stats.wait,0);
});
test('accepted memory is HUB-canonical, bounded to 128 and rejects failed/partial results',async()=>{
 const h=sourceHarness();for(let i=0;i<200;i++)await h.runSource('A','H'+i);assert.equal(h.memory().size,128);
 h.ctx.msRememberAcceptedSource('BAD',{sourceHash:'B',rows:[]},{status:'degraded'});assert.equal(h.memory().has('BAD'),false);
 await h.runSource('A',' ne1 ');assert.equal(h.memory().has('NE1'),true);
});
function settingsHarness(remembered=true){
 const h=harness();vm.runInContext(worker.slice(worker.indexOf('// HUB_SETTINGS_CACHE_V1'),worker.indexOf('\nasync function saveSettings(')),h.ctx);
 // Mock only the adapter's query result mapping, retaining the real settings cache/read and live transport.
 let value='NEW';h.db.prepare=function(sql){const database=this;return{bind(){return this;},async all(){await database._pipeline(sqlRequests(sql));return{results:[{category:'ms_vehicle',setting_key:'6W',minutes:value}]};}};};
 vm.runInContext('class SettingsOwner {\n'+method('streamPayload')+'\n}\nglobalThis.SettingsOwner=SettingsOwner;',h.ctx);
 h.ctx.msTraceSettingsRead=(env,branch)=>h.ctx.readSettings(env,branch);h.ctx.msProducerLinkPayload=()=>{};
 const owner=new h.ctx.SettingsOwner();owner.env=h.env;owner.ctx={waitUntil:task=>h.tasks.push(task)};owner.refresh=async()=>({status:'synced',rows:[{id:'row'}],syncedAt:'source',errorCode:''});owner.lastSnapshotBranch='NE1';owner.lastSnapshotPayload={rows:[{id:'old'}],standards:remembered?[{type:'6W',minutes:'OLD'}]:null};
 return{...h,owner,value:v=>{value=v;},cache:(until=60000,v='CACHED')=>vm.runInContext('hubSettingsCache',h.ctx).set('NE1',{until,value:{msVehicleLimits:[{type:'6W',minutes:v}]}})};
}
test('warm settings cache hit has correct standards and no physical DB read',async()=>{
 const h=settingsHarness();h.cache();const p=await h.owner.streamPayload('NE1');assert.equal(p.standards[0].minutes,'CACHED');assert.equal(p.msStatus,'synced');assert.equal(h.calls.length,0);
});
test('expired warm settings stalls off critical path, aborts and never degrades snapshot',async()=>{
 const h=settingsHarness();const p=await h.owner.streamPayload('NE1');assert.equal(p.msStatus,'synced');assert.equal(p.errorCode,'');assert.equal(p.rows[0].id,'row');assert.equal(p.standards[0].minutes,'OLD');await flush();assert.equal(h.calls.length,1);
 await h.advance(2800);await Promise.all(h.tasks);const again=await h.owner.streamPayload('NE1');assert.equal(again.msStatus,'synced');assert.equal(again.standards[0].minutes,'OLD');assert.equal(h.calls[0].signal.aborted,true);assert.equal(h.calls.length,1);
});
test('warm successful settings refresh replaces standards only for subsequent snapshots',async()=>{
 const h=settingsHarness();h.setBehavior(()=> 'fast');const first=await h.owner.streamPayload('NE1');await flush();await Promise.all(h.tasks);assert.equal(first.standards[0].minutes,'OLD');const next=await h.owner.streamPayload('NE1');assert.equal(next.standards[0].minutes,'NEW');assert.equal(h.calls.length,1);
});
test('settings save invalidation allows next read; old in-flight settings cannot mask a save',async()=>{
 const h=settingsHarness();h.setBehavior(()=> 'fast');await h.owner.streamPayload('NE1');await flush();await Promise.all(h.tasks);h.ctx.invalidateHubSettings('NE1');h.value('SAVED');await h.owner.streamPayload('NE1');await flush();await Promise.all(h.tasks);assert.equal((await h.owner.streamPayload('NE1')).standards[0].minutes,'SAVED');assert.equal(h.calls.length,2);
 const race=settingsHarness();await race.owner.streamPayload('NE1');await flush();race.ctx.invalidateHubSettings('NE1');race.calls[0].resolve();await flush();assert.equal(race.owner.lastSnapshotPayload.standards[0].minutes,'OLD');race.setBehavior(()=> 'fast');race.value('SAVED');await race.owner.streamPayload('NE1');await flush();await Promise.all(race.tasks);assert.equal((await race.owner.streamPayload('NE1')).standards[0].minutes,'SAVED');
});
test('cold settings failure remains bounded and does not fabricate standards',async()=>{
 const h=settingsHarness(false);const task=h.owner.streamPayload('NE1');await flush();await h.advance(2800);const p=await task;assert.equal(p.msStatus,'degraded');assert.equal(p.errorCode,'TURSO_LIVE_TIMEOUT');assert.equal(p.standards,null);
});
test('background settings network/HTTP failures preserve healthy rows and coalesce refresh',async()=>{
 for(const kind of ['error','http']){const h=settingsHarness();h.setBehavior(()=>kind);await Promise.all([h.owner.streamPayload('NE1'),h.owner.streamPayload('NE1')]);await flush();await Promise.all(h.tasks);const p=await h.owner.streamPayload('NE1');assert.equal(p.msStatus,'synced');assert.equal(p.errorCode,'');assert.equal(p.standards[0].minutes,'OLD');assert.equal(h.calls.length,2);}
});
test('route budget, realtime cadence, diagnostics, staged adapter, D1 and no provider contracts remain',()=>{
 for(const marker of ['MS_TURSO_TIMEOUT_PRODUCER_V1','MS_TURSO_LATE_SETTLE_V1','MS_REDEGRADE_TRACE_V1'])assert.ok(worker.includes(marker));
 assert.match(worker,/remainingBudget = 2800/);assert.match(worker,/routePersistenceBudget = 60_000/);assert.match(worker,/routeScoped\s*\? Math.min\(2800, routePersistenceBudget\)/);assert.match(worker,/stage === "route_state_read" \|\| stage === "route_batch_write"/);assert.match(worker,/pollMs: 4000/);
 assert.equal(patchMsTursoStallContainmentV1(worker),worker);assert.equal(patchMsTursoStallAdapterV1(adapter),adapter);assert.throws(()=>patchMsTursoStallContainmentV1('wrong'),/anchor mismatch/);assert.throws(()=>patchMsTursoStallAdapterV1('wrong'),/anchor mismatch/);
 const canonical=fs.readFileSync(path.join(root,'worker/src/turso-d1.js'),'utf8');assert.doesNotMatch(canonical,/MS_TURSO_STALL_ADAPTER_V1/);assert.equal(canonical,execFileSync('git',['show','31c3e015c2d88a17bee87ed4932d5e37dd347aaa:worker/src/turso-d1.js'],{cwd:root,encoding:'utf8'}));assert.match(adapter,/body: JSON.stringify\(body\),\s*signal,/);
 const config=fs.readFileSync(path.join(root,'worker/wrangler.dev.jsonc'),'utf8');assert.match(config,/"DB_BACKEND": "turso"/);assert.doesNotMatch(config,/d1_databases/);
 const stage=fs.readFileSync(path.join(root,'.github/dev-tools/stage-dev-runtime.mjs'),'utf8');assert.ok(stage.lastIndexOf('patchMsTursoStallContainmentV1(await')>stage.lastIndexOf('patchMsTursoLateSettleWorker(patch'));
 const patch=fs.readFileSync(new URL('./patch-ms-turso-stall-containment-v1.mjs',import.meta.url),'utf8');assert.doesNotMatch(patch,/setInterval\s*\(|apiGet\s*\(|curl_pno|tbrProvenance|readMsRoutes\s*\(/);
});
test('abort failures/background tasks have no unhandled rejection or uncaught exception',async()=>{
 const errors=[];const rejected=e=>errors.push(e),uncaught=e=>errors.push(e);process.on('unhandledRejection',rejected);process.on('uncaughtException',uncaught);
 try{for(const sql of ['SELECT * FROM ms_live_cache','UPDATE ms_live_cache SET rows_json=?','BEGIN; INSERT INTO ms_routes VALUES(?)']){const h=harness(),t=h.run(sql);await flush();await h.advance(2800);await t;await Promise.all(h.tasks);}const s=settingsHarness();await s.owner.streamPayload('NE1');await flush();await s.advance(2800);await Promise.all(s.tasks);await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(errors,[]);}finally{process.off('unhandledRejection',rejected);process.off('uncaughtException',uncaught);}
});
