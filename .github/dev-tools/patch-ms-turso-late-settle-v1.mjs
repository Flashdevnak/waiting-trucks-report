// DEV-only observation of already-submitted promises. No database acquisition.
export function createMsLateSettleTrace(clock = () => 0) {
  let sequence = 0;
  const events = [], correlations = new Map();
  const types = new Set(['LOCAL_DEADLINE_EXPIRED', 'LATE_SETTLE_SUCCESS', 'LATE_SETTLE_ERROR', 'LATE_SETTLE_WINDOW_EXPIRED', 'TRANSACTION_LATE_ROLLBACK_RESULT']);
  function record(eventType, input = {}) {
    if (!types.has(eventType)) return null;
    const event = { eventType, sequence: ++sequence };
    if (/^[A-Z0-9_-]{1,24}$/.test(input.hub || '')) event.hub = input.hub;
    for (const key of ['refreshInstanceId', 'dbOperationId', 'attempt', 'pipelineSequence', 'producerSequence', 'deadlineMs', 'elapsedAtDeadlineMs', 'lateSettleElapsedMs', 'lateAfterDeadlineMs']) {
      if (Number.isFinite(input[key]) && input[key] >= 0) event[key] = input[key];
    }
    if (Number.isInteger(input.status) && input.status >= 100 && input.status <= 599) event.status = input.status;
    if (['SUCCESS', 'ERROR', 'UNKNOWN'].includes(input.rollbackOutcome)) event.rollbackOutcome = input.rollbackOutcome;
    if (['HTTP_ERROR', 'CODED_ERROR', 'UNCLASSIFIED_ERROR'].includes(input.errorCategory)) event.errorCategory = input.errorCategory;
    for (const key of ['transaction', 'productDegraded', 'rollbackPending']) if (typeof input[key] === 'boolean') event[key] = input[key];
    const classes = ['ROUTE_STATE_READ', 'ROUTE_BATCH_WRITE', 'LIVE_CACHE_READ', 'LIVE_CACHE_WRITE', 'CLAIM_READ', 'CLAIM_WRITE', 'AUDIT_WRITE', 'CREDENTIAL_DB_READ', 'SETTINGS_DB_READ', 'CONNECTION_STATUS_WRITE', 'COMPLETION_HISTORY_READ', 'OTHER_LIVE_DB'];
    if (classes.includes(input.operationClass)) event.operationClass = input.operationClass;
    if (['READ', 'WRITE', 'TRANSACTION', 'OTHER'].includes(input.readOrWrite)) event.readOrWrite = input.readOrWrite;
    if (['CURRENT_OPERATION_FAILURE', 'NO_DB_ERROR', 'INHERITED_RESULT', 'UNKNOWN'].includes(input.errorOrigin)) event.errorOrigin = input.errorOrigin;
    if (input.pushReason === 'MAIN_REFRESH_COMPLETION') event.pushReason = input.pushReason;
    if (input.errorCode !== undefined) event.errorCode = input.errorCode === '' ? '' : input.errorCode === 'TURSO_LIVE_TIMEOUT' ? input.errorCode : 'OTHER_SAFE_ERROR';
    event.observedAtMs = Math.max(0, clock());
    const correlation = correlations.get(event.refreshInstanceId);
    if (correlation) Object.assign(event, { productDegraded: Boolean(correlation.degraded && event.producerSequence === correlation.producerSequence), errorOrigin: correlation.degraded && event.producerSequence === correlation.producerSequence ? 'CURRENT_OPERATION_FAILURE' : 'NO_DB_ERROR', pushReason: 'MAIN_REFRESH_COMPLETION' });
    events.push(event); if (events.length > 64) events.shift();
    return event;
  }
  return { record, correlate(refreshInstanceId, producerSequence, degraded, errorOrigin, pushReason) {
    if (pushReason !== 'MAIN_REFRESH_COMPLETION' || !Number.isFinite(refreshInstanceId)) return;
    degraded = Boolean(degraded && errorOrigin === 'CURRENT_OPERATION_FAILURE');
    correlations.set(refreshInstanceId, { producerSequence, degraded }); if (correlations.size > 64) correlations.delete(correlations.keys().next().value);
    for (const event of events) if (event.refreshInstanceId === refreshInstanceId) {
      event.productDegraded = Boolean(degraded && event.producerSequence === producerSequence);
      event.errorOrigin = event.productDegraded ? 'CURRENT_OPERATION_FAILURE' : 'NO_DB_ERROR';
      event.pushReason = pushReason;
    }
  }, snapshot: () => ({ name: 'MS_TURSO_LATE_SETTLE_V1', events: events.map(event => ({ ...event })) }) };
}

export function observeMsLateSettle(pending, metadata, rollback, hooks) {
  if (typeof hooks.background !== 'function') return 'LATE_SETTLE_OBSERVATION_LIFETIME_UNAVAILABLE';
  const deadlineAt = hooks.now();
  const info = { ...metadata };
  let closed = false, settled = false, rollbackPending = false, timer, finish;
  const task = new Promise(resolve => { finish = resolve; });
  const end = () => { if (closed) return; closed = true; hooks.clearTimeout(timer); finish(); };
  const timing = () => ({ ...info, lateSettleElapsedMs: Math.max(0, hooks.now() - metadata.started), lateAfterDeadlineMs: Math.max(0, hooks.now() - deadlineAt) });
  hooks.trace.record('LOCAL_DEADLINE_EXPIRED', info);
  timer = hooks.setTimeout(() => {
    if (!closed && rollbackPending) hooks.trace.record('TRANSACTION_LATE_ROLLBACK_RESULT', { ...timing(), rollbackOutcome: 'UNKNOWN' });
    if (!closed) hooks.trace.record('LATE_SETTLE_WINDOW_EXPIRED', { ...timing(), rollbackPending });
    end();
  }, 15_000);
  rollback.observe = promise => {
    rollbackPending = true;
    Promise.resolve(promise).then(() => {
      if (!closed) hooks.trace.record('TRANSACTION_LATE_ROLLBACK_RESULT', { ...timing(), errorCode: '', rollbackOutcome: 'SUCCESS' });
      rollbackPending = false; if (settled) end();
    }, error => {
      if (!closed) hooks.trace.record('TRANSACTION_LATE_ROLLBACK_RESULT', { ...timing(), errorCode: error?.code || 'OTHER_SAFE_ERROR', rollbackOutcome: 'ERROR', status: error?.status, errorCategory: Number.isInteger(error?.status) ? 'HTTP_ERROR' : error?.code ? 'CODED_ERROR' : 'UNCLASSIFIED_ERROR' });
      rollbackPending = false; if (settled) end();
    }).catch(() => end());
  };
  Promise.resolve(pending).then(() => {
    if (closed) return;
    settled = true; hooks.trace.record('LATE_SETTLE_SUCCESS', { ...timing(), errorCode: '' });
    if (!rollbackPending) end();
  }, error => {
    if (closed) return;
    settled = true; hooks.trace.record('LATE_SETTLE_ERROR', { ...timing(), errorCode: error?.code || 'OTHER_SAFE_ERROR', status: error?.status, errorCategory: Number.isInteger(error?.status) ? 'HTTP_ERROR' : error?.code ? 'CODED_ERROR' : 'UNCLASSIFIED_ERROR' }); end();
  }).catch(() => end());
  try { hooks.background(task); } catch { end(); return 'LATE_SETTLE_OBSERVATION_LIFETIME_UNAVAILABLE'; }
  return 'OBSERVING';
}

function once(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) throw new Error('MS late-settle anchor mismatch: ' + anchor.slice(0, 80));
  return source.replace(anchor, replacement);
}
export function patchMsTursoLateSettleWorker(source) {
  if (source.includes('// MS_TURSO_LATE_SETTLE_V1_WORKER')) return source;
  source = once(source, '    const pending = database._pipeline(...args);', '    const lateRollback = {};\n    let latePending = database._pipeline(...args);\n    const pending = latePending;');
  source = once(source, 'if (expired) database._finishTransaction(payload, "ROLLBACK").catch(() => {});', 'if (expired) {\n        const rollback = database._finishTransaction(payload, "ROLLBACK");\n        try { lateRollback.observe?.(rollback); } catch {}\n        rollback.catch(() => {});\n      }');
  source = once(source, 'return await Promise.race([database._pipeline(...args), deadline]);', 'latePending = database._pipeline(...args);\n        return await Promise.race([latePending, deadline]);');
  const anchor = '        console.warn(JSON.stringify({ event: "ms_live_db_timeout", ...trace }));';
  source = once(source, anchor, '        if (expired && producerContext) msLateObserve(env, latePending, lateRollback, { ...producerContext, ...producerOperation, dbOperationId, attempt: producerAttempt, pipelineSequence: sequence, producerSequence: msProducerErrors.get(caught)?.producerSequence, transaction, deadlineMs: remaining, elapsedAtDeadlineMs: trace.pipelineElapsedMs, started });\n' + anchor);
  source = once(source, '  return { msTursoTimeoutProducerTrace: { ...trace, events: trace.events.filter(event => event.hub === hub) } };', '  return { msTursoLateSettleTrace: msLateSnapshot(hub), msTursoTimeoutProducerTrace: { ...trace, events: trace.events.filter(event => event.hub === hub) } };');
  source = once(source, '  const meta = msProducerResults.get(result);\n  msProducerTrace.record("ACCEPTED_PUSH_PROVENANCE"', '  const meta = msProducerResults.get(result);\n  msLateTrace.correlate(meta?.refreshInstanceId, meta?.producerSequence, result?.errorCode === "TURSO_LIVE_TIMEOUT" && (result?.status || result?.msStatus) === "degraded", meta?.errorOrigin, pushReason);\n  msProducerTrace.record("ACCEPTED_PUSH_PROVENANCE"');
  return source + '\n// MS_TURSO_LATE_SETTLE_V1_WORKER\n' + createMsLateSettleTrace.toString() + '\n' + observeMsLateSettle.toString() + String.raw`
const msLateTrace = createMsLateSettleTrace(() => Date.now());
const msLateUnavailable = new Set();
function msLateObserve(env, pending, rollback, metadata) {
  try {
    const result = observeMsLateSettle(pending, metadata, rollback, { now: () => Date.now(), setTimeout, clearTimeout, trace: msLateTrace, background: typeof env.MS_BACKGROUND_WAIT === "function" ? task => env.MS_BACKGROUND_WAIT(task) : null });
    if (result === "LATE_SETTLE_OBSERVATION_LIFETIME_UNAVAILABLE") { msLateUnavailable.add(metadata.hub); if (msLateUnavailable.size > 64) msLateUnavailable.delete(msLateUnavailable.values().next().value); }
  } catch { /* Diagnostic failure must not alter product timeout handling. */ }
}
function msLateSnapshot(hub) {
  const trace = msLateTrace.snapshot();
  return { ...trace, events: trace.events.filter(event => event.hub === hub), lifetime: msLateUnavailable.has(hub) ? "LATE_SETTLE_OBSERVATION_LIFETIME_UNAVAILABLE" : "AVAILABLE" };
}
`;
}
export function patchMsTursoLateSettleFrontend(source) {
  if (source.includes('// MS_TURSO_LATE_SETTLE_V1_FRONTEND')) return source;
  source = once(source, '  function snapshot() { return trace.snapshot(); }', '  let lateTrace = createMsLateSettleTrace(() => performance.now()), lateLifetime = "NOT_OBSERVED";\n  function snapshot() { return { ...trace.snapshot(), lateSettle: { ...lateTrace.snapshot(), lifetime: lateLifetime } }; }');
  source = once(source, '  function ingest(payload) {\n    const envelope = payload?.msTursoTimeoutProducerTrace;', '  function ingest(payload) {\n    try {\n    const late = payload?.msTursoLateSettleTrace;\n    if (late?.name === "MS_TURSO_LATE_SETTLE_V1" && Array.isArray(late.events)) {\n      lateTrace = createMsLateSettleTrace(() => performance.now());\n      lateLifetime = late.lifetime === "LATE_SETTLE_OBSERVATION_LIFETIME_UNAVAILABLE" ? late.lifetime : "AVAILABLE";\n      for (const event of late.events.slice(-64)) if (event.hub === state.branch) lateTrace.record(event.eventType, event);\n    }\n    } catch {}\n    const envelope = payload?.msTursoTimeoutProducerTrace;');
  return source + '\n// MS_TURSO_LATE_SETTLE_V1_FRONTEND\n' + createMsLateSettleTrace.toString() + '\n';
}
