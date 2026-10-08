// Final DEV-only observer. Never consumes a response or starts asynchronous work.
export function createMsCriticalPathPhaseTrace(clock = () => 0) {
  const events = [], refreshEvents = [], starts = new Map();
  let sequence = 0;
  const origin = clock();
  const phases = new Set(('REFRESH_STARTED SOURCE_ACQUISITION_COMPLETED SOURCE_HASH_DECISION CLAIM_DECISION ROUTE_STATE_READ_COMPLETED ROUTE_BATCH_WRITE_COMPLETED AUDIT_STAGE_COMPLETED LIVE_CACHE_STAGE_COMPLETED CLAIM_FINISH_COMPLETED STATUS_STAGE_COMPLETED REFRESH_RESULT_ACCEPTED PUSH_PUBLISHED PIPELINE_SUBMITTED FETCH_STARTED RESPONSE_HEADERS_RECEIVED RESPONSE_PARSED PIPELINE_SETTLED_SUCCESS PIPELINE_SETTLED_ERROR LOCAL_DEADLINE_EXPIRED LOCAL_ABORT_REQUESTED LATE_SETTLE_SUCCESS LATE_SETTLE_ERROR BEGIN_SUBMITTED BEGIN_ACKNOWLEDGED STATEMENTS_SUBMITTED STATEMENTS_ACKNOWLEDGED COMMIT_SUBMITTED COMMIT_ACKNOWLEDGED ROLLBACK_SUBMITTED ROLLBACK_ACKNOWLEDGED TRANSACTION_OUTCOME_UNKNOWN DB_ACCOUNTING').split(' '));
  const refreshPhases = new Set(('REFRESH_STARTED SOURCE_ACQUISITION_COMPLETED SOURCE_HASH_DECISION CLAIM_DECISION ROUTE_STATE_READ_COMPLETED ROUTE_BATCH_WRITE_COMPLETED AUDIT_STAGE_COMPLETED LIVE_CACHE_STAGE_COMPLETED CLAIM_FINISH_COMPLETED STATUS_STAGE_COMPLETED REFRESH_RESULT_ACCEPTED PUSH_PUBLISHED').split(' '));
  const enums = {
    operationClass: 'ROUTE_STATE_READ ROUTE_BATCH_WRITE LIVE_CACHE_READ LIVE_CACHE_WRITE CLAIM_READ CLAIM_WRITE AUDIT_WRITE CREDENTIAL_DB_READ SETTINGS_DB_READ CONNECTION_STATUS_WRITE COMPLETION_HISTORY_READ OTHER_LIVE_DB',
    readOrWrite: 'READ WRITE TRANSACTION OTHER',
    errorOrigin: 'CURRENT_OPERATION_FAILURE INHERITED_RESULT NO_DB_ERROR UNKNOWN',
    pushReason: 'LEADER_REPLAY OPTIONAL_BUSTIME OPTIONAL_PREENTRY MAIN_REFRESH_COMPLETION OTHER_SAFE_REASON',
    status: 'synced degraded error reconnecting',
    outcome: 'SUCCESS ERROR UNKNOWN',
    scope: 'PIPELINE REFRESH SOCKET_SEND',
    errorCategory: 'ABORT NETWORK HTTP PROTOCOL CODED UNKNOWN',
  };
  const numbers = 'refreshInstanceId dbOperationId pipelineSequence attempt deadlineMs operationElapsedMs physicalAttemptElapsedMs cumulativeDbElapsedMs dbSpanElapsedMs activePipelines statementCount requestCount httpStatus lateAfterDeadlineMs lateSettleElapsedMs'.split(' ');
  function record(phase, input = {}) {
    if (!phases.has(phase)) return;
    const observedAtMs = Math.max(0, clock() - origin);
    const event = { phase, sequence: ++sequence, observedAtMs };
    if (/^[A-Z0-9_-]{1,24}$/.test(input.hub || '')) event.hub = input.hub;
    for (const key of numbers) if (Number.isFinite(input[key]) && input[key] >= 0) event[key] = input[key];
    for (const [key, values] of Object.entries(enums)) if (values.split(' ').includes(input[key])) event[key] = input[key];
    for (const key of ['transaction', 'timedOut', 'submitted', 'sourceCached', 'sourceMatch', 'claimAcquired', 'overlap']) if (typeof input[key] === 'boolean') event[key] = input[key];
    if (input.errorCode !== undefined) event.errorCode = input.errorCode === '' ? '' : input.errorCode === 'TURSO_LIVE_TIMEOUT' ? input.errorCode : 'OTHER_SAFE_ERROR';
    if (typeof input.acceptedSourceTimestamp === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(input.acceptedSourceTimestamp)) event.acceptedSourceTimestamp = input.acceptedSourceTimestamp;
    if (phase === 'REFRESH_STARTED' && Number.isFinite(event.refreshInstanceId)) {
      starts.set(event.refreshInstanceId, observedAtMs);
      if (starts.size > 64) starts.delete(starts.keys().next().value);
    }
    if (starts.has(event.refreshInstanceId)) event.refreshElapsedMs = Math.max(0, observedAtMs - starts.get(event.refreshInstanceId));
    const buffer = refreshPhases.has(phase) ? refreshEvents : events;
    buffer.push(event); if (buffer.length > 64) buffer.shift();
    return event;
  }
  return { record, snapshot: () => ({ name: 'MS_TURSO_CRITICAL_PATH_PHASE_V1',
    unobservable: ['RESPONSE_BODY_CONSUMED', 'NETWORK_CONNECT', 'REQUEST_UPLOAD', 'REMOTE_SQL_EXECUTION'],
    timingContract: 'FETCH_STARTED_TO_HEADERS_INCLUDES_NETWORK_AND_SERVER_WAIT; JSON_COMBINES_BODY_AND_PARSE; CUMULATIVE_DB_IS_SUMMED_PIPELINES; DB_SPAN_INCLUDES_GAPS; REFRESH_ELAPSED_IS_WALL; PUSH_IS_SOCKET_SEND_NOT_CLIENT_ACK',
    events: events.map(event => ({ ...event })), refreshEvents: refreshEvents.map(event => ({ ...event })) }) };
}

// The adapter retains only closed phase labels and indices, never SQL/parameters.
export function msPhaseRequestLabels(requests) {
  return (requests || []).map(request => {
    if (request?.type !== 'execute') return null;
    const sql = String(request.stmt?.sql || '');
    return /^\s*BEGIN\b/i.test(sql) ? 'BEGIN' : /^\s*COMMIT\b/i.test(sql) ? 'COMMIT' : /^\s*ROLLBACK\b/i.test(sql) ? 'ROLLBACK' : 'STATEMENTS';
  });
}
export function msPhaseTransportObserver(observer, requests) {
  if (typeof observer !== 'function') return () => {};
  const labels = msPhaseRequestLabels(requests);
  return (phase, input = {}) => {
    try {
    const emit = (name, safe) => { try { observer(name, safe); } catch {} };
    emit(phase, input);
    if (phase === 'PIPELINE_SUBMITTED') {
      for (const label of new Set(labels.filter(Boolean))) emit(label + '_SUBMITTED', {});
    }
    if (phase === 'PIPELINE_SETTLED_ERROR' && labels.some(label => label === 'BEGIN' || label === 'COMMIT' || label === 'ROLLBACK')) emit('TRANSACTION_OUTCOME_UNKNOWN', { outcome: 'UNKNOWN', transaction: true });
    if (phase === 'PIPELINE_SETTLED_SUCCESS') {
      // A parsed HTTP response is not itself a successful SQL acknowledgement.
      for (const label of new Set(labels.filter(Boolean))) {
        const indices = labels.flatMap((value, index) => value === label ? [index] : []);
        if (indices.every(index => input.results?.[index]?.type === 'ok')) emit(label + '_ACKNOWLEDGED', {});
      }
    }
    } catch { /* Diagnostic processing cannot replace a transport result. */ }
  };
}

function once(source, before, after) {
  if (source.split(before).length !== 2) throw new Error('MS critical-path anchor mismatch: ' + before.slice(0, 100));
  return source.replace(before, after);
}
export function patchMsCriticalPathAdapter(source) {
  if (source.includes('// MS_TURSO_CRITICAL_PATH_PHASE_V1_ADAPTER')) return source;
  source = once(source, 'async _pipeline(requests, { baseUrl = this.url, baton, signal } = {}) {', 'async _pipeline(requests, { baseUrl = this.url, baton, signal, phaseObserver } = {}) {');
  source = once(source, '    this._assertConfigured();\n    const endpoint', '    this._assertConfigured();\n    const phase = msPhaseTransportObserver(phaseObserver, requests);\n    const phaseFetch = (endpoint, init) => {\n      // Arguments/body are already prepared; this is the existing fetch call.\n      phase("PIPELINE_SUBMITTED", { submitted: true });\n      phase("FETCH_STARTED");\n      return this.fetchImpl(endpoint, init);\n    };\n    const endpoint');
  source = once(source, '      response = await this.fetchImpl(endpoint, {', '      response = await phaseFetch(endpoint, {');
  source = once(source, '        signal,\n      });', '        signal,\n      });\n      phase("RESPONSE_HEADERS_RECEIVED", { httpStatus: response.status });');
  source = once(source, '      throw wrapError(error, "TURSO_NETWORK_ERROR");', '      phase("PIPELINE_SETTLED_ERROR", { outcome: "ERROR", errorCategory: error?.name === "AbortError" ? "ABORT" : "NETWORK" });\n      throw wrapError(error, "TURSO_NETWORK_ERROR");');
  source = once(source, '      payload = await response.json();', '      payload = await response.json();\n      phase("RESPONSE_PARSED");');
  source = once(source, '      throw tursoError(\n        "TURSO_PROTOCOL_ERROR",', '      phase("PIPELINE_SETTLED_ERROR", { outcome: "ERROR", errorCategory: "PROTOCOL" });\n      throw tursoError(\n        "TURSO_PROTOCOL_ERROR",');
  source = once(source, '      error.status = response.status;\n      throw error;', '      error.status = response.status;\n      phase("PIPELINE_SETTLED_ERROR", { outcome: "ERROR", errorCategory: "HTTP", httpStatus: response.status });\n      throw error;');
  source = once(source, '      throw tursoError("TURSO_PROTOCOL_ERROR", "Turso response is missing pipeline results");', '      phase("PIPELINE_SETTLED_ERROR", { outcome: "ERROR", errorCategory: "PROTOCOL" });\n      throw tursoError("TURSO_PROTOCOL_ERROR", "Turso response is missing pipeline results");');
  source = once(source, '    return payload;\n  }\n\n  _assertConfigured()', '    phase("PIPELINE_SETTLED_SUCCESS", { results: payload.results, outcome: payload.results.some(result => result?.type === "error") ? "ERROR" : "SUCCESS" });\n    if (typeof phaseObserver === "function") msPhasePayloadObservers.set(payload, phaseObserver);\n    return payload;\n  }\n\n  _assertConfigured()');
  source = once(source, '      { baseUrl, baton },', '      { baseUrl, baton, phaseObserver: msPhasePayloadObservers.get(openPipeline) },');
  return source + '\n// MS_TURSO_CRITICAL_PATH_PHASE_V1_ADAPTER\nconst msPhasePayloadObservers = new WeakMap();\n' + msPhaseRequestLabels.toString() + '\n' + msPhaseTransportObserver.toString() + '\n';
}

export function patchMsCriticalPathWorker(source) {
  if (source.includes('// MS_TURSO_CRITICAL_PATH_PHASE_V1_WORKER')) return source;
  source = once(source, '  msProducerEnvs.set(observed, context);\n  const result', '  msProducerEnvs.set(observed, context);\n  msPhaseRecord(context, "REFRESH_STARTED", { scope: "REFRESH" });\n  const result');
  source = once(source, '  if (meta) msProducerTrace.record("COORDINATOR_RESULT",', '  if (meta) msPhaseRecord(meta, "REFRESH_RESULT_ACCEPTED", { scope: "REFRESH", status: result.status, errorCode: result.errorCode || "", errorOrigin: meta.errorOrigin, acceptedSourceTimestamp: result.syncedAt || "" });\n  if (meta) msProducerTrace.record("COORDINATOR_RESULT",');
  source = once(source, 'return { msTursoLateSettleTrace: msLateSnapshot(hub),', 'return { msTursoCriticalPathPhaseTrace: msPhaseSnapshot(hub), msTursoLateSettleTrace: msLateSnapshot(hub),');
  source = once(source, '  const pipelines = [];\n  db._pipeline', '  const pipelines = [];\n  let phaseActivePipelines = 0;\n  let phaseDbStarted = null;\n  db._pipeline');
  source = once(source, '    const lateRollback = {};\n    let transportController;', '    const lateRollback = {};\n    const phaseInfo = { ...producerContext, ...producerOperation, dbOperationId, pipelineSequence: sequence, transaction: transaction || Boolean(transactionStage), deadlineMs: remaining };\n    const phaseStarted = msPhaseNow();\n    if (phaseDbStarted === null) phaseDbStarted = phaseStarted;\n    phaseActivePipelines += 1;\n    let transportController;');
  source = once(source, '      args[1] = { ...(args[1] || {}), signal: transportController.signal };', '      const phaseAttempt = producerAttempt, physicalStarted = msPhaseNow();\n      args[1] = { ...(args[1] || {}), signal: transportController.signal,\n        phaseObserver: producerContext ? (phase, safe) => msPhaseRecord(phaseInfo, phase, { ...safe, attempt: phaseAttempt, physicalAttemptElapsedMs: Math.max(0, msPhaseNow() - physicalStarted), operationElapsedMs: Math.max(0, msPhaseNow() - phaseStarted), activePipelines: phaseActivePipelines, overlap: phaseActivePipelines > 1 }) : undefined };');
  source = once(source, '          reject(timeoutError());\n          transportController.abort();', '          reject(timeoutError());\n          msPhaseRecord(producerContext && phaseInfo, "LOCAL_DEADLINE_EXPIRED", { attempt: producerAttempt, timedOut: true, operationElapsedMs: Math.max(0, msPhaseNow() - phaseStarted) });\n          if (transaction || transactionStage) msPhaseRecord(producerContext && phaseInfo, "TRANSACTION_OUTCOME_UNKNOWN", { outcome: "UNKNOWN" });\n          msPhaseRecord(producerContext && phaseInfo, "LOCAL_ABORT_REQUESTED", { attempt: producerAttempt });\n          transportController.abort();');
  source = once(source, '      clearTimeout(timer);\n      if (caught?.code', '      clearTimeout(timer);\n      phaseActivePipelines -= 1;\n      msPhaseRecord(producerContext && phaseInfo, "DB_ACCOUNTING", { scope: "PIPELINE", attempt: producerAttempt, timedOut: expired, operationElapsedMs: Math.max(0, msPhaseNow() - phaseStarted), cumulativeDbElapsedMs: trace.cumulativeDbElapsedMs, dbSpanElapsedMs: Math.max(0, msPhaseNow() - phaseDbStarted), activePipelines: phaseActivePipelines, outcome: caught ? "ERROR" : "SUCCESS" });\n      if (caught?.code');
  source = once(source, 'trace: msLateTrace, background:', 'trace: { record(type, safe) { const event = msLateTrace.record(type, safe); msPhaseLate(type, safe); return event; } }, background:');
  // Existing refresh awaits remain in place; synchronous observation only.
  source = once(source, '    const rows = await readMsRoutes(credentials);', '    const rows = await readMsRoutes(credentials);\n    msPhaseEnv(env, "SOURCE_ACQUISITION_COMPLETED", { outcome: rows.routeSourceError ? "ERROR" : "SUCCESS" });');
  source = once(source, '    let sync;\n    let syncClaim', '    msPhaseEnv(env, "SOURCE_HASH_DECISION", { sourceCached: Boolean(acceptedSource), sourceMatch: Boolean(cache?.sourceMatch) });\n    let sync;\n    let syncClaim');
  source = once(source, '      const claim = await acquireMsSyncClaim(env, branch, sourceHash);', '      const claim = await acquireMsSyncClaim(env, branch, sourceHash);\n      msPhaseEnv(env, "CLAIM_DECISION", { claimAcquired: Boolean(claim.acquired) });');
  source = once(source, '  const oldRows = oldRowsResult.results.map((persisted) => {', '  msPhaseEnv(env, "ROUTE_STATE_READ_COMPLETED", { outcome: "SUCCESS" });\n  const oldRows = oldRowsResult.results.map((persisted) => {');
  source = once(source, '      await env.DB.batch(batch);\n      batch = [];', '      await env.DB.batch(batch);\n      msPhaseEnv(env, "ROUTE_BATCH_WRITE_COMPLETED", { outcome: "SUCCESS" });\n      batch = [];');
  source = once(source, '  if (batch.length) await env.DB.batch(batch);', '  if (batch.length) {\n    await env.DB.batch(batch);\n    msPhaseEnv(env, "ROUTE_BATCH_WRITE_COMPLETED", { outcome: "SUCCESS" });\n  }');
  source = once(source, '`${seen.size} current / ${businessChanges} business changes`, actor.username);', '`${seen.size} current / ${businessChanges} business changes`, actor.username);\n      msPhaseEnv(env, "AUDIT_STAGE_COMPLETED", { outcome: "SUCCESS" });');
  source = once(source, '      console.error(JSON.stringify({ event: "ms_sync_audit_error",', '      msPhaseEnv(env, "AUDIT_STAGE_COMPLETED", { outcome: "ERROR", errorCode: error?.code || "OTHER_SAFE_ERROR" });\n      console.error(JSON.stringify({ event: "ms_sync_audit_error",');
  source = once(source, '              "ms_live_cache_write_error", branch);\n      } catch (error)', '              "ms_live_cache_write_error", branch);\n        msPhaseEnv(env, "LIVE_CACHE_STAGE_COMPLETED", { outcome: cacheWrite ? "SUCCESS" : "UNKNOWN" });\n      } catch (error)');
  source = once(source, '      "ms_connection_success_write_error",\n      branch,\n    );\n    const result', '      "ms_connection_success_write_error",\n      branch,\n    );\n    msPhaseEnv(env, "STATUS_STAGE_COMPLETED");\n    const result');
  // Observe the existing safeStatusWrite resolution without changing its result.
  // Claim finish is observed after existing caller awaits; its helper stays exact.
  for (const anchor of [
    '          await finishMsSyncClaim(env, branch, claim, true);',
    '            await finishMsSyncClaim(env, branch, claim, false);',
    '          await finishMsSyncClaim(env, branch, syncClaim, false);',
    '      await finishMsSyncClaim(env, branch, syncClaim, Boolean(cacheWrite));',
  ]) source = once(source, anchor, anchor + '\n' + anchor.match(/^\s*/)[0] + 'msPhaseEnv(env, "CLAIM_FINISH_COMPLETED");');
  const sendStart = source.indexOf('  sendAcceptedSnapshot('), sendEnd = source.indexOf('\n  acceptOptional(', sendStart);
  let send = source.slice(sendStart, sendEnd);
  send = once(send, 'try { socket.send(JSON.stringify(payload)); } catch {}', 'try { socket.send(JSON.stringify(payload)); msPhasePush(this.env, branch, result, pushReason); } catch {}');
  source = source.slice(0, sendStart) + send + source.slice(sendEnd);
  const replay = '      if (this.lastSnapshotPayload && this.lastSnapshotBranch === nextAttachment.branch)\n        next.send(JSON.stringify({ ...this.lastSnapshotPayload, ...msProducerPushEnvelope(this.env, nextAttachment.branch, "LEADER_REPLAY", this.lastSnapshotPayload), ...msTraceEnvelope(this.env, nextAttachment.branch, "LEADER_REPLAY", this.lastSnapshotPayload) }));';
  source = once(source, replay, replay.replace(')\n        next.send', ') {\n        next.send') + '\n        msPhasePush(this.env, nextAttachment.branch, this.lastSnapshotPayload, "LEADER_REPLAY");\n      }');
  return source + '\n// MS_TURSO_CRITICAL_PATH_PHASE_V1_WORKER\n' + createMsCriticalPathPhaseTrace.toString() + '\n' + workerRuntime;
}

const workerRuntime = String.raw`
function msPhaseNow() { try { return typeof performance !== "undefined" ? performance.now() : Date.now(); } catch { return Date.now(); } }
const msPhaseTrace = createMsCriticalPathPhaseTrace(msPhaseNow);
function msPhaseRecord(context, phase, input = {}) {
  if (!context) return;
  try { msPhaseTrace.record(phase, { ...context, ...input }); } catch { /* Observation cannot change product behavior. */ }
}
function msPhaseEnv(env, phase, input = {}) { try { msPhaseRecord(msProducerContext(env), phase, { scope: "REFRESH", ...input }); } catch {} }
function msPhaseSnapshot(hub) { const trace = msPhaseTrace.snapshot(); return { ...trace, events: trace.events.filter(event => event.hub === hub), refreshEvents: trace.refreshEvents.filter(event => event.hub === hub) }; }
function msPhaseLate(type, safe) {
  if (type === "LATE_SETTLE_SUCCESS" || type === "LATE_SETTLE_ERROR") msPhaseRecord(safe, type, safe);
  // Promise fulfillment alone is not a Hrana rollback acknowledgement.
  if (type === "TRANSACTION_LATE_ROLLBACK_RESULT" && safe.rollbackOutcome !== "SUCCESS") msPhaseRecord(safe, "TRANSACTION_OUTCOME_UNKNOWN", { outcome: "UNKNOWN" });
}
function msPhasePush(env, hub, result, pushReason) {
  if (!msProducerEnabled(env)) return;
  try {
    const meta = msProducerResults.get(result);
    msPhaseRecord({ ...meta, hub }, "PUSH_PUBLISHED", { scope: "SOCKET_SEND", pushReason, status: result?.status || result?.msStatus || "", errorCode: result?.errorCode || "", errorOrigin: meta?.producerSequence && pushReason !== "MAIN_REFRESH_COMPLETION" ? "INHERITED_RESULT" : meta?.errorOrigin || (result?.errorCode ? "UNKNOWN" : "NO_DB_ERROR"), acceptedSourceTimestamp: result?.syncedAt || result?.lastSync || "" });
  } catch {}
}
`;

export function patchMsCriticalPathFrontend(source) {
  if (source.includes('// MS_TURSO_CRITICAL_PATH_PHASE_V1_FRONTEND')) return source;
  source = once(source, '  function snapshot() { return { ...trace.snapshot(), lateSettle:', createMsCriticalPathPhaseTrace.toString().split('\n').map(line => '  ' + line).join('\n') + '\n  let criticalPath = createMsCriticalPathPhaseTrace(() => performance.now());\n  function snapshot() { return { ...trace.snapshot(), criticalPath: criticalPath.snapshot(), lateSettle:');
  source = once(source, '  function ingest(payload) {\n    try {\n    const late', '  function ingest(payload) {\n    try {\n      const phases = payload?.msTursoCriticalPathPhaseTrace;\n      if (phases?.name === "MS_TURSO_CRITICAL_PATH_PHASE_V1" && Array.isArray(phases.events)) {\n        criticalPath = createMsCriticalPathPhaseTrace(() => performance.now());\n        const scoped = [...phases.events.slice(-64), ...(Array.isArray(phases.refreshEvents) ? phases.refreshEvents.slice(-64) : [])].sort((a, b) => (a.sequence || 0) - (b.sequence || 0));\n        for (const event of scoped) if (event.hub === state.branch) {\n          const safe = criticalPath.record(event.phase, event);\n          // Preserve Worker-relative timing, never substitute frontend timing.\n          if (safe) for (const key of ["observedAtMs", "refreshElapsedMs"]) {\n            if (Number.isFinite(event[key]) && event[key] >= 0) safe[key] = event[key]; else delete safe[key];\n          }\n        }\n      }\n    } catch {}\n    try {\n    const late');
  return source + '\n// MS_TURSO_CRITICAL_PATH_PHASE_V1_FRONTEND\n';
}
