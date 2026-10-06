// Instrument the final staged DEV runtime only. Canonical Worker/assets stay untouched.
function once(source, from, to) {
  if (!source.includes(from) || source.indexOf(from) !== source.lastIndexOf(from))
    throw new Error('MS_TURSO_TIMEOUT_PRODUCER_V1 missing/ambiguous anchor: ' + from.slice(0, 80));
  return source.replace(from, to);
}

// Explicit projection: no arbitrary errors, SQL, bindings, payloads or URLs survive.
export function createMsTursoProducerTrace(clock = () => 0) {
  const events = [], pinned = new Set();
  const started = clock();
  let sequence = 0, firstProducer = null, firstPush = null, firstProducerRuntime = null;
  const enums = {
    eventType: ['DB_ATTEMPT', 'TURSO_TIMEOUT_PRODUCED', 'REFRESH_RESULT', 'COORDINATOR_RESULT', 'OPTIONAL_MERGE', 'OPTIONAL_ACCEPT', 'ACCEPTED_PUSH_PROVENANCE'],
    operationClass: ['LIVE_CACHE_READ', 'LIVE_CACHE_WRITE', 'ROUTE_STATE_READ', 'ROUTE_BATCH_WRITE', 'CREDENTIAL_DB_READ', 'SETTINGS_DB_READ', 'CONNECTION_STATUS_WRITE', 'AUDIT_WRITE', 'COMPLETION_HISTORY_READ', 'CLAIM_READ', 'CLAIM_WRITE', 'OTHER_LIVE_DB'],
    readOrWrite: ['READ', 'WRITE', 'TRANSACTION', 'OTHER'],
    producerKind: ['LOCAL_DEADLINE_FACTORY', 'PREEXISTING_TURSO_CODE', 'BUDGET_EXHAUSTED_BEFORE_SUBMIT', 'SUBMITTED_DEADLINE_EXPIRED', 'OTHER_SAFE_CLASS'],
    producerClass: ['LOCAL_DEADLINE_FACTORY', 'PREEXISTING_TURSO_CODE', 'OTHER_SAFE_CLASS'],
    errorOrigin: ['CURRENT_OPERATION_FAILURE', 'INHERITED_RESULT', 'NO_DB_ERROR', 'UNKNOWN'],
    pushReason: ['MAIN_REFRESH_COMPLETION', 'OPTIONAL_PREENTRY', 'OPTIONAL_BUSTIME', 'LEADER_REPLAY', 'OTHER_SAFE_REASON'],
    optionalType: ['PREENTRY', 'BUSTIME', 'OTHER_OPTIONAL'],
    status: ['synced', 'degraded', 'error', 'not_configured', 'connecting', ''],
    failureStage: ['credential_db_read', 'live_cache_read', 'route_state_read', 'route_batch_write', 'audit_write', 'live_cache_write', 'connection_status_write', 'other_live_db'],
  };
  const numbers = ['runtimeInstanceId', 'refreshInstanceId', 'producerRefreshInstanceId', 'resultInstanceId', 'inputResultInstanceId', 'outputResultInstanceId', 'dbOperationId', 'producerSequence', 'timeoutProducerSequence', 'deadlineMs', 'remainingBeforeMs', 'pipelineSequence', 'pipelineElapsedMs', 'cumulativeDbElapsedMs', 'pipelineCount', 'statementCountTotal', 'attempt', 'requestCount', 'statementCount'];
  const num = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const code = value => value === 'TURSO_LIVE_TIMEOUT' ? value : value ? 'OTHER_SAFE_ERROR' : '';
  function dbTrace(value) {
    if (!value || typeof value !== 'object') return null;
    const out = {};
    for (const key of ['pipelineSequence', 'pipelineElapsedMs', 'cumulativeDbElapsedMs', 'remainingBeforeMs', 'pipelineCount', 'statementCountTotal']) out[key] = num(value[key]);
    out.failureStage = enums.failureStage.includes(value.failureStage) ? value.failureStage : 'other_live_db';
    out.transaction = typeof value.transaction === 'boolean' ? value.transaction : null;
    out.pipelines = Array.isArray(value.pipelines) ? value.pipelines.slice(-12).map(item => {
      const entry = { stage: enums.failureStage.includes(item?.stage) ? item.stage : 'other_live_db' };
      for (const key of ['sequence', 'startedOffsetMs', 'elapsedMs', 'cumulativeElapsedMs', 'remainingBeforeMs', 'remainingAfterMs', 'requestCount', 'statementCount']) entry[key] = num(item?.[key]);
      for (const key of ['transaction', 'submitted', 'timedOut']) entry[key] = typeof item?.[key] === 'boolean' ? item[key] : null;
      return entry;
    }) : [];
    return out;
  }
  function record(eventType, data = {}, backend = false) {
    try {
      if (!enums.eventType.includes(eventType)) return null;
      const hub = String(data.hub || '').toUpperCase();
      const eventSequence = backend && num(data.sequence) !== null ? data.sequence : sequence + 1;
      sequence = Math.max(sequence, eventSequence);
      const event = { sequence: eventSequence, runtimeInstanceId: num(started), relativeMs: backend && num(data.relativeMs) !== null ? data.relativeMs : Math.max(0, Math.round(clock() - started)), eventType,
        hub: /^[A-Z][A-Z0-9_]{0,15}$/.test(hub) ? hub : '' };
      for (const [key, values] of Object.entries(enums)) if (key !== 'eventType' && data[key] !== undefined) event[key] = values.includes(data[key]) ? data[key] : values.at(-1);
      for (const key of numbers) if (data[key] !== undefined) event[key] = num(data[key]);
      for (const key of ['submitted', 'timedOut', 'transaction', 'lineageInherited']) if (data[key] !== undefined) event[key] = typeof data[key] === 'boolean' ? data[key] : null;
      for (const key of ['errorCode', 'inputErrorCode', 'outputErrorCode']) if (data[key] !== undefined) event[key] = code(data[key]);
      if (data.lastAcceptedSourceTimestamp !== undefined) {
        const value = data.lastAcceptedSourceTimestamp;
        event.lastAcceptedSourceTimestamp = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) ? value : '';
      }
      if (data.dbTrace !== undefined) event.dbTrace = dbTrace(data.dbTrace);
      if (eventType === 'TURSO_TIMEOUT_PRODUCED' && firstProducer === null) {
        firstProducer = event.sequence; firstProducerRuntime = event.runtimeInstanceId; event.marker = 'FIRST_TURSO_TIMEOUT_PRODUCER'; pinned.add(event);
      }
      if (eventType === 'ACCEPTED_PUSH_PROVENANCE' && firstPush === null && event.timeoutProducerSequence === firstProducer && event.runtimeInstanceId === firstProducerRuntime && firstProducer !== null) {
        firstPush = event.sequence; event.marker = 'FIRST_CORRELATED_TIMEOUT_PUSH'; pinned.add(event);
      }
      events.push(event);
      if (events.length > 64) events.splice(events.findIndex(item => !pinned.has(item)), 1);
      return JSON.parse(JSON.stringify(event));
    } catch { return null; }
  }
  return { record, snapshot: () => ({ name: 'MS_TURSO_TIMEOUT_PRODUCER_V1', runtimeInstanceId: num(started), maxEvents: 64,
    firstProducerSequence: firstProducer, firstCorrelatedPushSequence: firstPush, events: JSON.parse(JSON.stringify(events)) }) };
}

export function msTursoProducerOperation(requests, transactionStage = '') {
  const statements = (Array.isArray(requests) ? requests : []).filter(item => item?.type === 'execute');
  // SQL is inspected synchronously to select closed classes, never retained/emitted.
  const sql = statements.map(item => String(item?.stmt?.sql || ''));
  const transaction = Boolean(transactionStage) || sql.some(value => /^\s*(?:BEGIN|COMMIT|ROLLBACK)\b/i.test(value));
  const reads = sql.length > 0 && sql.every(value => /^\s*(?:SELECT|EXPLAIN)\b/i.test(value));
  const writes = sql.some(value => /^\s*(?:insert|update|replace|delete)\b/i.test(value));
  const readOrWrite = transaction ? 'TRANSACTION' : reads ? 'READ' : writes ? 'WRITE' : 'OTHER';
  const joined = sql.join('\n');
  let operationClass = 'OTHER_LIVE_DB';
  if (/\bms_live_cache\b/i.test(joined)) operationClass = reads ? 'LIVE_CACHE_READ' : 'LIVE_CACHE_WRITE';
  else if (/\bhub_settings\b/i.test(joined) && reads) operationClass = 'SETTINGS_DB_READ';
  else if (/\bms_connections\b/i.test(joined)) operationClass = reads ? 'CREDENTIAL_DB_READ' : 'CONNECTION_STATUS_WRITE';
  else if (/\bms_sync_claims\b/i.test(joined)) operationClass = reads ? 'CLAIM_READ' : 'CLAIM_WRITE';
  else if (/\baudit_log\b/i.test(joined) && writes) operationClass = 'AUDIT_WRITE';
  else if (/\bms_route_history\b/i.test(joined) && reads && !/\bms_routes\b/i.test(joined)) operationClass = 'COMPLETION_HISTORY_READ';
  else if (/\bms_routes\b/i.test(joined) && reads) operationClass = 'ROUTE_STATE_READ';
  else if (/\bms_route_registry\b|\bms_route_history\b|\bms_routes\b/i.test(joined) && !reads || transactionStage === 'route_batch_write') operationClass = 'ROUTE_BATCH_WRITE';
  return { operationClass, readOrWrite };
}

export function patchMsTursoTimeoutProducerWorker(source) {
  if (source.includes('// MS_TURSO_TIMEOUT_PRODUCER_V1_WORKER')) return source;
  const start = source.indexOf('async function runMsRefresh(env, branch) {');
  const finish = source.indexOf('\nasync function ', start + 1);
  if (start < 0 || finish < 0) throw new Error('MS_TURSO_TIMEOUT_PRODUCER_V1 refresh boundary missing');
  let refresh = source.slice(start, finish);
  const closing = refresh.lastIndexOf('\n}');
  refresh = refresh.slice(0, closing) + '\n  });\n}' + refresh.slice(closing + 2);
  refresh = once(refresh, 'async function runMsRefresh(env, branch) {', 'async function runMsRefresh(env, branch) {\n  return msProducerRefresh(env, branch, async (env) => {');
  refresh = once(refresh, '      return { ...(accepted || {}), status: "degraded", changes: 0,', '      return msProducerCaughtResult(env, { ...(accepted || {}), status: "degraded", changes: 0,');
  refresh = once(refresh, 'error: "การอ่านหรือบันทึกข้อมูลภายในใช้เวลาถึงขีดจำกัด ระบบยังแสดงข้อมูลล่าสุดตามเวลาที่รับสำเร็จล่าสุด" };', 'error: "การอ่านหรือบันทึกข้อมูลภายในใช้เวลาถึงขีดจำกัด ระบบยังแสดงข้อมูลล่าสุดตามเวลาที่รับสำเร็จล่าสุด" }, error);');
  const caughtStart = refresh.indexOf('  } catch (error) {\n    const errorCode = String(error?.code || "");');
  if (caughtStart < 0) throw new Error('MS_TURSO_TIMEOUT_PRODUCER_V1 refresh catch missing');
  let caught = refresh.slice(caughtStart);
  const save = 'recentMsSync.set(branch, { until: Date.now() + MS_SYNC_TTL, result });';
  if (caught.split(save).length !== 4) throw new Error('MS_TURSO_TIMEOUT_PRODUCER_V1 expected three caught result saves');
  caught = caught.replaceAll(save, 'msProducerCaughtResult(env, result, error);\n        ' + save);
  refresh = refresh.slice(0, caughtStart) + caught;
  source = source.slice(0, start) + refresh + source.slice(finish);
  source = once(source, 'function msLiveDatabaseEnv(env) {', 'function msLiveDatabaseEnv(env, producerHub = "") {');
  source = once(source, '  const database = env.DB;\n  if (!database', '  const producerContext = msProducerContext(env) || msProducerDetachedContext(env, producerHub);\n  const database = env.DB;\n  if (!database');
  source = once(source, 'msTraceSettingsRead(msLiveDatabaseEnv(this.env), branch)', 'msTraceSettingsRead(msLiveDatabaseEnv(this.env, branch), branch)');
  source = once(source, '  db._pipeline = async function(...args) {\n    if (unavailable)', '  db._pipeline = async function(...args) {\n    const dbOperationId = msProducerOperationId(producerContext);\n    if (unavailable)');
  source = once(source, '    const stage = msLiveDbStage(requests, transactionStage);', '    const producerOperation = msTursoProducerOperation(requests, transactionStage);\n    let producerAttempt = 1;\n    const stage = msLiveDbStage(requests, transactionStage);');
  source = once(source, '      failure.dbTrace = record(true, false);', '      failure.dbTrace = record(true, false);\n      msProducerTimeout(producerContext, failure, { dbOperationId, ...producerOperation, producerKind: "BUDGET_EXHAUSTED_BEFORE_SUBMIT", producerClass: "LOCAL_DEADLINE_FACTORY", deadlineMs: Math.max(0, remaining), attempt: producerAttempt, submitted: false, timedOut: true, requestCount: requests.length, statementCount }, failure.dbTrace);');
  source = once(source, '    const pending = database._pipeline(...args);', '    msProducerAttempt(producerContext, dbOperationId, producerOperation, producerAttempt);\n    const pending = database._pipeline(...args);');
  source = once(source, '        return await Promise.race([database._pipeline(...args), deadline]);', '        producerAttempt = 2;\n        msProducerAttempt(producerContext, dbOperationId, producerOperation, producerAttempt);\n        return await Promise.race([database._pipeline(...args), deadline]);');
  source = once(source, '        producerAttempt = 2;', '        if (firstError?.code === "TURSO_LIVE_TIMEOUT") msProducerTimeout(producerContext, firstError, { dbOperationId, ...producerOperation, producerKind: "PREEXISTING_TURSO_CODE", producerClass: "PREEXISTING_TURSO_CODE", deadlineMs: Math.max(0, remaining), attempt: producerAttempt, submitted: true, timedOut: false, requestCount: requests.length, statementCount }, firstError.dbTrace || { failureStage: stage, pipelineSequence: sequence, pipelineElapsedMs: Math.max(0, Date.now() - started), cumulativeDbElapsedMs, remainingBeforeMs: Math.max(0, remaining), pipelineCount, statementCountTotal, transaction });\n        producerAttempt = 2;');
  source = once(source, '        caught.dbTrace = trace;', '        caught.dbTrace = trace;\n        msProducerTimeout(producerContext, caught, { dbOperationId, ...producerOperation, producerKind: expired ? "SUBMITTED_DEADLINE_EXPIRED" : "PREEXISTING_TURSO_CODE", producerClass: expired ? "LOCAL_DEADLINE_FACTORY" : "PREEXISTING_TURSO_CODE", deadlineMs: Math.max(0, remaining), attempt: producerAttempt, submitted: true, timedOut: expired, requestCount: requests.length, statementCount }, trace);');
  source = once(source, '  return new Proxy(env, { get: (target, key) => key === "DB" ? db : target[key] });', '  return msProducerCarryEnv(env, new Proxy(env, { get: (target, key) => key === "DB" ? db : target[key] }));');
  source = once(source, '      env.MS_OPTIONAL_ACCEPT?.();', '      env.MS_OPTIONAL_ACCEPT?.(name);');
  source = once(source, 'if (key === "MS_OPTIONAL_ACCEPT") return () => this.acceptOptional(branch);', 'if (key === "MS_OPTIONAL_ACCEPT") return (name) => this.acceptOptional(branch, name === "preEntry" ? "PREENTRY" : name === "busTime" ? "BUSTIME" : "OTHER_OPTIONAL");');
  source = once(source, '      this.acceptOptional(branch);\n      return Response.json(msSerializeOptionalMap(data));', '      this.acceptOptional(branch, "BUSTIME");\n      return Response.json(msSerializeOptionalMap(data));');
  source = once(source, '        result = this.lastResult;\n        this.lastSourceAt', '        result = this.lastResult;\n        msProducerCoordinator(this.env, branch, result);\n        this.lastSourceAt');
  source = once(source, '        this.sendAcceptedSnapshot(branch);', '        this.sendAcceptedSnapshot(branch, "MAIN_REFRESH_COMPLETION");');
  source = once(source, '  sendAcceptedSnapshot(branch) {', '  sendAcceptedSnapshot(branch, pushReason = "OTHER_SAFE_REASON") {');
  source = once(source, '  acceptOptional(branch) {\n    if (!Array.isArray(this.lastResult?.rows)) return;', '  acceptOptional(branch, optionalType = "OTHER_OPTIONAL") {\n    if (!Array.isArray(this.lastResult?.rows)) return;\n    msProducerOptionalAccept(this.env, branch, this.lastResult, optionalType);');
  source = once(source, '    this.sendAcceptedSnapshot(branch);\n  }\n\n  async refresh(', '    this.sendAcceptedSnapshot(branch, optionalType === "PREENTRY" ? "OPTIONAL_PREENTRY" : optionalType === "BUSTIME" ? "OPTIONAL_BUSTIME" : "OTHER_SAFE_REASON");\n  }\n\n  async refresh(');
  source = once(source, '  return { ...result, rows: msQueueFirstSourceRows(rows, bus, branch), tbrShadowFeed: msTbrShadowFeed(bus) };', '  return msProducerMergeResult(branch, result, { ...result, rows: msQueueFirstSourceRows(rows, bus, branch), tbrShadowFeed: msTbrShadowFeed(bus) });');
  source = once(source, '...msTraceEnvelope(this.env, branch, "ACCEPTED_PUSH", result)', '...msProducerPushEnvelope(this.env, branch, pushReason, result),\n      ...msTraceEnvelope(this.env, branch, "ACCEPTED_PUSH", result)');
  source = once(source, '...msTraceEnvelope(this.env, nextAttachment.branch, "LEADER_REPLAY", this.lastSnapshotPayload)', '...msProducerPushEnvelope(this.env, nextAttachment.branch, "LEADER_REPLAY", this.lastSnapshotPayload), ...msTraceEnvelope(this.env, nextAttachment.branch, "LEADER_REPLAY", this.lastSnapshotPayload)');
  source = once(source, '  return { msRedegradeTrace: {', '  return { ...msProducerTraceEnvelope(env, hub), msRedegradeTrace: {');
  // Payload references remain ephemeral; nothing is added to persisted result data.
  const sendStart = source.indexOf('  sendAcceptedSnapshot('), sendEnd = source.indexOf('\n  acceptOptional(', sendStart);
  const send = once(source.slice(sendStart, sendEnd), '    this.lastSnapshotPayload = payload;', '    msProducerLinkPayload(payload, result);\n    this.lastSnapshotPayload = payload;');
  source = source.slice(0, sendStart) + send + source.slice(sendEnd);
  source = once(source, '    Object.assign(payload, msTraceEnvelope(this.env, branch, "STREAM_SNAPSHOT", payload,', '    msProducerLinkPayload(payload, live);\n    Object.assign(payload, msTraceEnvelope(this.env, branch, "STREAM_SNAPSHOT", payload,');
  return source + '\n// MS_TURSO_TIMEOUT_PRODUCER_V1_WORKER\n' + createMsTursoProducerTrace.toString() + '\n' + msTursoProducerOperation.toString() + '\n' + workerRuntime;
}

const workerRuntime = String.raw`
const msProducerTrace = createMsTursoProducerTrace(() => Date.now());
const msProducerEnvs = new WeakMap(), msProducerErrors = new WeakMap(), msProducerResults = new WeakMap();
let msProducerRefreshCounter = 0, msProducerResultCounter = 0, msProducerOperationCounter = 0;
function msProducerEnabled(env) { return env?.DEV_ACCEPTANCE_TELEMETRY === "1"; }
function msProducerContext(env) { return msProducerEnabled(env) ? msProducerEnvs.get(env) || null : null; }
function msProducerDetachedContext(env, hub) { return msProducerEnabled(env) ? { hub, refreshInstanceId: null } : null; }
function msProducerCarryEnv(from, to) { const context = msProducerContext(from); if (context) msProducerEnvs.set(to, context); return to; }
function msProducerOperationId(context) { return context ? ++msProducerOperationCounter : null; }
function msProducerAttempt(context, dbOperationId, operation, attempt) {
  if (context) msProducerTrace.record("DB_ATTEMPT", { ...context, ...operation, dbOperationId, attempt });
}
function msProducerTimeout(context, error, operation, dbTrace) {
  if (!context || error?.code !== "TURSO_LIVE_TIMEOUT" || msProducerErrors.has(error)) return;
  const event = msProducerTrace.record("TURSO_TIMEOUT_PRODUCED", { ...context, ...operation, dbTrace,
    pipelineSequence: dbTrace?.pipelineSequence, pipelineElapsedMs: dbTrace?.pipelineElapsedMs,
    cumulativeDbElapsedMs: dbTrace?.cumulativeDbElapsedMs, remainingBeforeMs: dbTrace?.remainingBeforeMs,
    transaction: dbTrace?.transaction, errorCode: error.code });
  if (event) msProducerErrors.set(error, { ...event, producerSequence: event.sequence, producerRefreshInstanceId: context.refreshInstanceId });
}
function msProducerResult(result, context, producer = null, origin = null) {
  if (!result || typeof result !== "object" || !context) return null;
  let meta = msProducerResults.get(result);
  if (!meta) { meta = { hub: context.hub, refreshInstanceId: context.refreshInstanceId, resultInstanceId: ++msProducerResultCounter }; msProducerResults.set(result, meta); }
  if (producer && result.errorCode === "TURSO_LIVE_TIMEOUT") Object.assign(meta, { producerSequence: producer.producerSequence,
    producerRefreshInstanceId: producer.producerRefreshInstanceId, dbOperationId: producer.dbOperationId,
    operationClass: producer.operationClass, readOrWrite: producer.readOrWrite, errorOrigin: origin || "CURRENT_OPERATION_FAILURE" });
  else if (!result.errorCode) meta.errorOrigin = "NO_DB_ERROR";
  else if (!meta.errorOrigin) meta.errorOrigin = "UNKNOWN";
  return meta;
}
function msProducerCaughtResult(env, result, error) {
  const context = msProducerContext(env), producer = error && msProducerErrors.get(error);
  msProducerResult(result, context, producer, producer ? producer.producerRefreshInstanceId === context?.refreshInstanceId ? "CURRENT_OPERATION_FAILURE" : "INHERITED_RESULT" : "UNKNOWN");
  return result;
}
async function msProducerRefresh(env, branch, run) {
  if (!msProducerEnabled(env)) return run(env);
  const context = { hub: branch, refreshInstanceId: ++msProducerRefreshCounter };
  const observed = new Proxy(env, { get: (target, key) => target[key] });
  msProducerEnvs.set(observed, context);
  const result = await run(observed);
  const previous = result && msProducerResults.get(result);
  const meta = msProducerResult(result, context);
  if (previous && previous.refreshInstanceId !== context.refreshInstanceId && result.errorCode === "TURSO_LIVE_TIMEOUT") meta.errorOrigin = "INHERITED_RESULT";
  if (meta) msProducerTrace.record("REFRESH_RESULT", { ...meta, status: result.status, errorCode: result.errorCode || "",
    lastAcceptedSourceTimestamp: result.syncedAt || "" });
  return result;
}
function msProducerMergeResult(branch, input, output) {
  const meta = msProducerResults.get(input);
  if (!meta || !output || typeof output !== "object") return output;
  const next = { ...meta, resultInstanceId: ++msProducerResultCounter };
  msProducerResults.set(output, next);
  msProducerTrace.record("OPTIONAL_MERGE", { ...next, hub: branch, inputResultInstanceId: meta.resultInstanceId,
    outputResultInstanceId: next.resultInstanceId, inputErrorCode: input.errorCode || "", outputErrorCode: output.errorCode || "",
    timeoutProducerSequence: next.producerSequence, lineageInherited: Boolean(next.producerSequence) });
  return output;
}
function msProducerCoordinator(env, hub, result) {
  if (!msProducerEnabled(env)) return;
  const meta = msProducerResults.get(result);
  if (meta) msProducerTrace.record("COORDINATOR_RESULT", { ...meta, hub, status: result.status, errorCode: result.errorCode || "" });
}
function msProducerOptionalAccept(env, hub, result, optionalType) {
  if (!msProducerEnabled(env)) return;
  msProducerTrace.record("OPTIONAL_ACCEPT", { ...msProducerResults.get(result), hub, optionalType,
    errorCode: result.errorCode || "", timeoutProducerSequence: msProducerResults.get(result)?.producerSequence });
}
function msProducerLinkPayload(payload, result) { const meta = result && msProducerResults.get(result); if (meta) msProducerResults.set(payload, meta); }
function msProducerPushEnvelope(env, hub, pushReason, result) {
  if (!msProducerEnabled(env)) return {};
  const meta = msProducerResults.get(result);
  msProducerTrace.record("ACCEPTED_PUSH_PROVENANCE", { ...meta, hub, pushReason,
    status: result?.status || result?.msStatus || "", errorCode: result?.errorCode || "",
    errorOrigin: meta?.producerSequence && pushReason !== "MAIN_REFRESH_COMPLETION" ? "INHERITED_RESULT" : meta?.errorOrigin || (result?.errorCode ? "UNKNOWN" : "NO_DB_ERROR"),
    timeoutProducerSequence: meta?.producerSequence, lastAcceptedSourceTimestamp: result?.syncedAt || result?.lastSync || "" });
  return {};
}
function msProducerTraceEnvelope(env, hub) {
  if (!msProducerEnabled(env)) return {};
  const trace = msProducerTrace.snapshot();
  return { msTursoTimeoutProducerTrace: { ...trace, events: trace.events.filter(event => event.hub === hub) } };
}
`;

export function patchMsTursoTimeoutProducerFrontend(source) {
  if (source.includes('// MS_TURSO_TIMEOUT_PRODUCER_V1_FRONTEND')) return source;
  return source + '\n// MS_TURSO_TIMEOUT_PRODUCER_V1_FRONTEND\n' + createMsTursoProducerTrace.toString() + '\n' + frontendDeclaration + '\nmsTursoProducerFrontend();\n';
}

function frontendRuntime() {
  if (typeof location === 'undefined' || location.hostname !== 'waiting-trucks-report-api-dev.26nak-testdev.workers.dev') return;
  const trace = createMsTursoProducerTrace(() => performance.now()), seen = new Set();
  function snapshot() { return trace.snapshot(); }
  function surface() {
    try {
    if (typeof document?.createElement !== 'function' || !document.body) return;
    let card = document.getElementById('ms-turso-timeout-producer-v1');
    if (!card) {
      card = document.createElement('details'); card.id = 'ms-turso-timeout-producer-v1';
      const title = document.createElement('summary'); title.textContent = 'DEV diagnostic · MS_TURSO_TIMEOUT_PRODUCER_V1';
      const area = document.createElement('textarea'); area.readOnly = true; area.rows = 10;
      area.setAttribute('aria-label', 'MS_TURSO_TIMEOUT_PRODUCER_V1 readonly JSON'); area.style.width = '100%';
      const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copy JSON';
      copy.addEventListener('click', () => {
        area.value = JSON.stringify(snapshot(), null, 2);
        if (globalThis.navigator?.clipboard?.writeText) globalThis.navigator.clipboard.writeText(area.value).catch(() => {});
        else { area.select(); document.execCommand?.('copy'); }
      });
      card.append(title, area, copy); document.body.append(card);
      card.addEventListener('toggle', surface);
    }
    card.hidden = !state.auth;
    if (state.auth && card.open) card.querySelector('textarea').value = JSON.stringify(snapshot(), null, 2);
    if (!state.auth) card.querySelector('textarea').value = '';
    } catch { /* A failed diagnostic surface cannot interrupt product processing. */ }
  }
  function ingest(payload) {
    const envelope = payload?.msTursoTimeoutProducerTrace;
    if (envelope?.name !== 'MS_TURSO_TIMEOUT_PRODUCER_V1' || !Array.isArray(envelope.events)) return;
    for (const event of envelope.events.slice(0, 64)) {
      if (event.hub !== state.branch) continue;
      const key = [event.runtimeInstanceId, event.hub, event.sequence, event.relativeMs, event.eventType].join(':');
      if (seen.has(key)) continue;
      seen.add(key); if (seen.size > 64) seen.delete(seen.values().next().value);
      // Preserve backend sequence for lineage; sanitize with the same closed projector.
      trace.record(event.eventType, event, true);
    }
    surface();
  }
  const originalMessage = handleRealtimeMessage;
  handleRealtimeMessage = function(raw) { let payload; try { payload = JSON.parse(String(raw || '{}')); } catch {} ingest(payload); return originalMessage(raw); };
  const originalApply = applyLiveResult;
  applyLiveResult = function(result, fromStream = false) { ingest(result); return originalApply(result, fromStream); };
  const originalApi = apiGet;
  apiGet = async function(action, params) { const result = await originalApi(action, params); ingest(result); return result; };
  if (typeof authUi === 'function') { const originalAuth = authUi; authUi = function() { const result = originalAuth(); surface(); return result; }; }
  globalThis.msTursoTimeoutProducerV1 = snapshot;
  surface();
}

// Keep the generated function name explicit and isolated from the older frontendRuntime.
const frontendDeclaration = frontendRuntime.toString().replace('function frontendRuntime()', 'function msTursoProducerFrontend()');
