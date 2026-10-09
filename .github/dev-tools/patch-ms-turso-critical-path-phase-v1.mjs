// Final DEV-only observer. Never consumes a response or starts asynchronous work.
export function createMsCriticalPathPhaseTrace(clock = () => 0, runtimeInstanceId = null) {
  const events = [], refreshEvents = [], starts = new Map();
  // Separate from the 64-event rings. Per-isolate memory only, no storage.
  const routeHubs = new Map(), maxRouteHubs = 8, maxRouteReadsPerHub = 16;
  const runtime = Number.isSafeInteger(runtimeInstanceId) && runtimeInstanceId >= 0 ? runtimeInstanceId : null;
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
  const routePhases = new Set(('PIPELINE_SUBMITTED FETCH_STARTED RESPONSE_HEADERS_RECEIVED RESPONSE_PARSED PIPELINE_SETTLED_SUCCESS PIPELINE_SETTLED_ERROR LOCAL_DEADLINE_EXPIRED LOCAL_ABORT_REQUESTED LATE_SETTLE_SUCCESS LATE_SETTLE_ERROR DB_ACCOUNTING').split(' '));
  const routeTimes = { PIPELINE_SUBMITTED: 'submittedAtMs', FETCH_STARTED: 'fetchStartedAtMs', RESPONSE_HEADERS_RECEIVED: 'headersAtMs', RESPONSE_PARSED: 'parsedAtMs', PIPELINE_SETTLED_SUCCESS: 'settledAtMs', PIPELINE_SETTLED_ERROR: 'settledAtMs', LOCAL_DEADLINE_EXPIRED: 'deadlineAtMs', LOCAL_ABORT_REQUESTED: 'abortAtMs', LATE_SETTLE_SUCCESS: 'lateSettledAtMs', LATE_SETTLE_ERROR: 'lateSettledAtMs' };
  function retainRouteRead(event) {
    if (event.operationClass !== 'ROUTE_STATE_READ' || !routePhases.has(event.phase) || !event.hub ||
        !['refreshInstanceId', 'dbOperationId', 'pipelineSequence', 'attempt'].every(key => Number.isSafeInteger(event[key]) && event[key] >= 0)) return;
    let bucket = routeHubs.get(event.hub);
    // A late observation can only update an already retained physical attempt.
    // Reject it before a ninth HUB can evict a populated bucket.
    if ((event.phase === 'LATE_SETTLE_SUCCESS' || event.phase === 'LATE_SETTLE_ERROR') &&
        !bucket?.some(item => item.refreshInstanceId === event.refreshInstanceId && item.dbOperationId === event.dbOperationId &&
          item.pipelineSequence === event.pipelineSequence && item.attempt === event.attempt)) return;
    if (!bucket) {
      if (routeHubs.size === maxRouteHubs) routeHubs.delete(routeHubs.keys().next().value);
      bucket = []; routeHubs.set(event.hub, bucket);
    }
    let entry = bucket.find(item => item.refreshInstanceId === event.refreshInstanceId && item.dbOperationId === event.dbOperationId &&
      item.pipelineSequence === event.pipelineSequence && item.attempt === event.attempt);
    if (!entry) {
      // A late observation cannot resurrect an already evicted operation and
      // displace one of the sixteen more recent reads.
      if (event.phase === 'LATE_SETTLE_SUCCESS' || event.phase === 'LATE_SETTLE_ERROR') return;
      entry = { runtimeInstanceId: runtime, hub: event.hub, operationClass: 'ROUTE_STATE_READ', readOrWrite: event.readOrWrite || 'OTHER',
        refreshInstanceId: event.refreshInstanceId, dbOperationId: event.dbOperationId, pipelineSequence: event.pipelineSequence, attempt: event.attempt,
        deadlineMs: event.deadlineMs ?? null, submitted: null, firstObservedPhase: event.phase, lastObservedPhase: event.phase,
        submittedAtMs: null, fetchStartedAtMs: null, headersAtMs: null, parsedAtMs: null, settledAtMs: null,
        deadlineAtMs: null, abortAtMs: null, lateSettledAtMs: null, fetchToHeadersMs: null, headersToParsedMs: null,
        physicalElapsedMs: null, lateSettleElapsedMs: null, lateAfterDeadlineMs: null,
        activePipelines: null, overlap: false, localDeadlineExpired: false, abortRequested: false,
        transportOutcome: 'UNKNOWN', lateSettlement: 'NONE', errorCategory: null, outcome: 'UNKNOWN', completeness: 'PARTIAL' };
      bucket.push(entry); if (bucket.length > maxRouteReadsPerHub) bucket.shift();
    }
    entry.lastObservedPhase = event.phase;
    if (event.deadlineMs !== undefined) entry.deadlineMs = event.deadlineMs;
    if (typeof event.submitted === 'boolean') entry.submitted = event.submitted;
    if (event.phase === 'PIPELINE_SUBMITTED') entry.submitted = true;
    if (routeTimes[event.phase] && entry[routeTimes[event.phase]] === null) entry[routeTimes[event.phase]] = event.observedAtMs;
    if (event.physicalAttemptElapsedMs !== undefined) entry.physicalElapsedMs = event.physicalAttemptElapsedMs;
    if (event.lateSettleElapsedMs !== undefined) entry.lateSettleElapsedMs = event.lateSettleElapsedMs;
    if (event.lateAfterDeadlineMs !== undefined) entry.lateAfterDeadlineMs = event.lateAfterDeadlineMs;
    if (event.activePipelines !== undefined) entry.activePipelines = event.activePipelines;
    if (event.overlap === true) entry.overlap = true;
    if (event.errorCategory) entry.errorCategory = event.errorCategory;
    if (event.phase === 'LOCAL_DEADLINE_EXPIRED') entry.localDeadlineExpired = true;
    if (event.phase === 'LOCAL_ABORT_REQUESTED') entry.abortRequested = true;
    if (event.phase === 'PIPELINE_SETTLED_SUCCESS') entry.transportOutcome = event.outcome === 'SUCCESS' ? 'SUCCESS' : event.outcome === 'ERROR' ? 'ERROR' : 'UNKNOWN';
    if (event.phase === 'PIPELINE_SETTLED_ERROR') entry.transportOutcome = 'ERROR';
    if (event.phase === 'LATE_SETTLE_SUCCESS') entry.lateSettlement = 'SUCCESS';
    if (event.phase === 'LATE_SETTLE_ERROR') entry.lateSettlement = 'ERROR';
    const ordered = entry.submittedAtMs !== null && entry.fetchStartedAtMs !== null && entry.headersAtMs !== null &&
      entry.parsedAtMs !== null && entry.settledAtMs !== null &&
      entry.submittedAtMs <= entry.fetchStartedAtMs && entry.fetchStartedAtMs <= entry.headersAtMs &&
      entry.headersAtMs <= entry.parsedAtMs && entry.parsedAtMs <= entry.settledAtMs;
    entry.fetchToHeadersMs = entry.fetchStartedAtMs !== null && entry.headersAtMs !== null && entry.fetchStartedAtMs <= entry.headersAtMs
      ? entry.headersAtMs - entry.fetchStartedAtMs : null;
    entry.headersToParsedMs = entry.headersAtMs !== null && entry.parsedAtMs !== null && entry.headersAtMs <= entry.parsedAtMs
      ? entry.parsedAtMs - entry.headersAtMs : null;
    entry.completeness = ordered && entry.readOrWrite === 'READ' ? 'COMPLETE' : 'PARTIAL';
    entry.outcome = entry.localDeadlineExpired ? 'LOCAL_DEADLINE_EXPIRED' : entry.abortRequested ? 'ABORT_REQUESTED' :
      entry.transportOutcome === 'ERROR' ? 'ERROR' : entry.completeness === 'COMPLETE' && entry.transportOutcome === 'SUCCESS' ? 'SUCCESS' :
      entry.lateSettlement !== 'NONE' ? 'LATE_SETTLED' : 'UNKNOWN';
  }
  // Browser input is projected afresh, never copied wholesale. A new Worker snapshot replaces the old one.
  function acceptSummaries(input, hub, sourceRuntime) {
    if (!Array.isArray(input) || !/^[A-Z0-9_-]{1,24}$/.test(hub || '') || !Number.isSafeInteger(sourceRuntime) || sourceRuntime < 0) return;
    routeHubs.clear();
    const bucket = [];
    for (const item of input.slice(-maxRouteReadsPerHub)) {
      if (item?.hub !== hub || item.runtimeInstanceId !== sourceRuntime || item.operationClass !== 'ROUTE_STATE_READ' ||
          !['refreshInstanceId', 'dbOperationId', 'pipelineSequence', 'attempt'].every(key => Number.isSafeInteger(item[key]) && item[key] >= 0)) continue;
      const safe = { runtimeInstanceId: sourceRuntime, hub, operationClass: 'ROUTE_STATE_READ', readOrWrite: item.readOrWrite === 'READ' ? 'READ' : 'OTHER',
        refreshInstanceId: item.refreshInstanceId, dbOperationId: item.dbOperationId, pipelineSequence: item.pipelineSequence, attempt: item.attempt };
      for (const key of ['deadlineMs', 'submittedAtMs', 'fetchStartedAtMs', 'headersAtMs', 'parsedAtMs', 'settledAtMs', 'deadlineAtMs', 'abortAtMs', 'lateSettledAtMs', 'fetchToHeadersMs', 'headersToParsedMs', 'physicalElapsedMs', 'lateSettleElapsedMs', 'lateAfterDeadlineMs', 'activePipelines'])
        safe[key] = Number.isFinite(item[key]) && item[key] >= 0 ? Math.min(item[key], 1_000_000_000_000_000) : null;
      for (const key of ['submitted', 'overlap', 'localDeadlineExpired', 'abortRequested']) safe[key] = typeof item[key] === 'boolean' ? item[key] : null;
      const choices = { firstObservedPhase: routePhases, lastObservedPhase: routePhases,
        transportOutcome: new Set(['SUCCESS', 'ERROR', 'UNKNOWN']), lateSettlement: new Set(['NONE', 'SUCCESS', 'ERROR']),
        errorCategory: new Set(['ABORT', 'NETWORK', 'HTTP', 'PROTOCOL', 'CODED', 'UNKNOWN']),
        outcome: new Set(['SUCCESS', 'ERROR', 'LOCAL_DEADLINE_EXPIRED', 'ABORT_REQUESTED', 'LATE_SETTLED', 'UNKNOWN']),
        completeness: new Set(['COMPLETE', 'PARTIAL', 'UNKNOWN']) };
      for (const [key, values] of Object.entries(choices)) safe[key] = values.has(item[key]) ? item[key] : key === 'completeness' ? 'UNKNOWN' : null;
      const ordered = safe.submittedAtMs !== null && safe.fetchStartedAtMs !== null && safe.headersAtMs !== null &&
        safe.parsedAtMs !== null && safe.settledAtMs !== null && safe.submittedAtMs <= safe.fetchStartedAtMs &&
        safe.fetchStartedAtMs <= safe.headersAtMs && safe.headersAtMs <= safe.parsedAtMs && safe.parsedAtMs <= safe.settledAtMs;
      safe.fetchToHeadersMs = safe.fetchStartedAtMs !== null && safe.headersAtMs !== null && safe.fetchStartedAtMs <= safe.headersAtMs ? safe.headersAtMs - safe.fetchStartedAtMs : null;
      safe.headersToParsedMs = safe.headersAtMs !== null && safe.parsedAtMs !== null && safe.headersAtMs <= safe.parsedAtMs ? safe.parsedAtMs - safe.headersAtMs : null;
      safe.localDeadlineExpired = safe.localDeadlineExpired === true || safe.deadlineAtMs !== null;
      safe.abortRequested = safe.abortRequested === true || safe.abortAtMs !== null;
      safe.completeness = ordered && safe.readOrWrite === 'READ' && safe.completeness === 'COMPLETE' ? 'COMPLETE' : 'PARTIAL';
      safe.outcome = safe.localDeadlineExpired ? 'LOCAL_DEADLINE_EXPIRED' : safe.abortRequested ? 'ABORT_REQUESTED' :
        safe.transportOutcome === 'ERROR' ? 'ERROR' : safe.completeness === 'COMPLETE' && safe.transportOutcome === 'SUCCESS' && safe.outcome === 'SUCCESS' ? 'SUCCESS' :
        safe.lateSettlement !== 'NONE' ? 'LATE_SETTLED' : 'UNKNOWN';
      if (bucket.some(other => ['refreshInstanceId', 'dbOperationId', 'pipelineSequence', 'attempt'].every(key => other[key] === safe[key]))) continue;
      bucket.push(safe);
    }
    if (bucket.length) routeHubs.set(hub, bucket);
  }
  function record(phase, input = {}, retain = true) {
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
    if (retain) retainRouteRead(event);
    return event;
  }
  return { record, acceptSummaries, setSnapshotSequence: value => { if (Number.isSafeInteger(value) && value >= 0) sequence = value; }, snapshot: () => ({ name: 'MS_TURSO_CRITICAL_PATH_PHASE_V1', runtimeInstanceId: runtime, snapshotSequence: sequence,
    unobservable: ['RESPONSE_BODY_CONSUMED', 'NETWORK_CONNECT', 'REQUEST_UPLOAD', 'REMOTE_SQL_EXECUTION'],
    timingContract: 'FETCH_STARTED_TO_HEADERS_INCLUDES_NETWORK_AND_SERVER_WAIT; JSON_COMBINES_BODY_AND_PARSE; CUMULATIVE_DB_IS_SUMMED_PIPELINES; DB_SPAN_INCLUDES_GAPS; REFRESH_ELAPSED_IS_WALL; PUSH_IS_SOCKET_SEND_NOT_CLIENT_ACK',
    events: events.map(event => ({ ...event })), refreshEvents: refreshEvents.map(event => ({ ...event })),
    maxRouteReadHubs: maxRouteHubs, maxRouteReadsPerHub, routeReadSummaries: [...routeHubs.values()].flatMap(bucket => bucket.map(entry => ({ ...entry }))) }) };
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
const msPhaseTrace = createMsCriticalPathPhaseTrace(msPhaseNow, msProducerTrace.snapshot().runtimeInstanceId);
function msPhaseRecord(context, phase, input = {}) {
  if (!context) return;
  try { msPhaseTrace.record(phase, { ...context, ...input }); } catch { /* Observation cannot change product behavior. */ }
}
function msPhaseEnv(env, phase, input = {}) { try { msPhaseRecord(msProducerContext(env), phase, { scope: "REFRESH", ...input }); } catch {} }
function msPhaseSnapshot(hub) { const trace = msPhaseTrace.snapshot(); return { ...trace, events: trace.events.filter(event => event.hub === hub), refreshEvents: trace.refreshEvents.filter(event => event.hub === hub), routeReadSummaries: trace.routeReadSummaries.filter(entry => entry.hub === hub) }; }
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
  source = once(source, '  function snapshot() { return { ...trace.snapshot(), lateSettle:', createMsCriticalPathPhaseTrace.toString().split('\n').map(line => '  ' + line).join('\n') + '\n  let criticalPath = createMsCriticalPathPhaseTrace(() => performance.now());\n  let criticalPathHub = state.branch;\n  let criticalPathSequence = null;\n  let criticalPathAccepted = false;\n  const seenCriticalPathRuntimes = new Set();\n  function currentCriticalPath() {\n    if (criticalPathHub !== state.branch) { criticalPathHub = state.branch; criticalPath = createMsCriticalPathPhaseTrace(() => performance.now()); criticalPathSequence = null; criticalPathAccepted = false; seenCriticalPathRuntimes.clear(); }\n    return criticalPath;\n  }\n  function snapshot() { currentCriticalPath(); return { ...trace.snapshot(), criticalPath: criticalPath.snapshot(), lateSettle:');
  source = once(source, '  function ingest(payload) {\n    try {\n    const late', '  function ingest(payload) {\n    try {\n      currentCriticalPath();\n      const phases = payload?.msTursoCriticalPathPhaseTrace;\n      if (phases?.name === "MS_TURSO_CRITICAL_PATH_PHASE_V1" && Array.isArray(phases.events)) {\n        const runtime = Number.isSafeInteger(phases.runtimeInstanceId) && phases.runtimeInstanceId >= 0 ? phases.runtimeInstanceId : null;\n        const sequence = Number.isSafeInteger(phases.snapshotSequence) && phases.snapshotSequence >= 0 ? phases.snapshotSequence : null;\n        const previousRuntime = criticalPath.snapshot().runtimeInstanceId;\n        const newRuntime = runtime !== null && previousRuntime !== runtime;\n        // Unknown identity or generation cannot establish ordering over accepted evidence.\n        if (!(previousRuntime !== null && runtime === null) && !(newRuntime && seenCriticalPathRuntimes.has(runtime)) &&\n            !(!newRuntime && criticalPathAccepted && (runtime === null || criticalPathSequence === null || sequence === null || sequence <= criticalPathSequence))) {\n        const next = createMsCriticalPathPhaseTrace(() => performance.now(), runtime);\n        const scoped = [...phases.events.slice(-64), ...(Array.isArray(phases.refreshEvents) ? phases.refreshEvents.slice(-64) : [])].sort((a, b) => (a.sequence || 0) - (b.sequence || 0));\n        for (const event of scoped) if (event.hub === state.branch) {\n          const safe = next.record(event.phase, event, false);\n          // Preserve Worker-relative timing, never substitute frontend timing.\n          if (safe) for (const key of ["observedAtMs", "refreshElapsedMs"]) {\n            if (Number.isFinite(event[key]) && event[key] >= 0) safe[key] = event[key]; else delete safe[key];\n          }\n        }\n        const summaries = phases.routeReadSummaries;\n        const validSummaries = runtime !== null && Array.isArray(summaries) && summaries.every(item => item?.hub === state.branch && item.runtimeInstanceId === runtime && item.operationClass === "ROUTE_STATE_READ" && ["refreshInstanceId", "dbOperationId", "pipelineSequence", "attempt"].every(key => Number.isSafeInteger(item[key]) && item[key] >= 0));\n        // Same-runtime empty/missing/malformed optional fields are not evidence of deletion.\n        if (!newRuntime && previousRuntime !== null) next.acceptSummaries(criticalPath.snapshot().routeReadSummaries, state.branch, runtime);\n        if (validSummaries && summaries.length) next.acceptSummaries(summaries, state.branch, runtime);\n        if (newRuntime) { if (previousRuntime !== null) seenCriticalPathRuntimes.add(previousRuntime); if (seenCriticalPathRuntimes.size > 8) seenCriticalPathRuntimes.delete(seenCriticalPathRuntimes.values().next().value); }\n        next.setSnapshotSequence(sequence); criticalPath = next; criticalPathSequence = sequence; criticalPathAccepted = true;\n        }\n      }\n    } catch {}\n    try {\n    const late');
  return source + '\n// MS_TURSO_CRITICAL_PATH_PHASE_V1_FRONTEND\n';
}
