// Final staged DEV composition only. No canonical asset or Production entrypoint imports this.
function replaceUnique(source, from, to) {
  if (source.indexOf(from) < 0 || source.indexOf(from) !== source.lastIndexOf(from))
    throw new Error('MS_REDEGRADE_TRACE_V1 anchor missing or ambiguous: ' + from.slice(0, 80));
  return source.replace(from, to);
}

// Only explicit safe fields cross the diagnostic boundary. Unknown codes are classes,
// not arbitrary error strings. onChange failures must never affect product processing.
export function createMsRedegradeTrace(enabled, clock, onChange = () => {}) {
  const events = [], pinned = new Set();
  const started = clock();
  let sequence = 0, firstSequence = null;
  const types = new Set(('TRACE_INIT BOOTSTRAP_RESULT HTTP_RESULT HTTP_ERROR SOCKET_CREATE SOCKET_OPEN SOCKET_MESSAGE_ERROR SOCKET_MESSAGE_SNAPSHOT SOCKET_ERROR SOCKET_CLOSE SOCKET_REPLACE ACCEPTED_PUSH LEADER_REPLAY SETTINGS_READ_START SETTINGS_READ_OK SETTINGS_READ_ERROR SNAPSHOT_READ_START SNAPSHOT_READ_OK SNAPSHOT_READ_ERROR CLASSIFIER_RESULT STATE_CHANGE RENDER_HEALTHY RENDER_DB_WARNING RENDER_OTHER STREAM_PAYLOAD').split(' '));
  const sources = new Set(('PAGE BROWSER_CACHE HTTP_BOOTSTRAP HTTP_REPORT HTTP_ERROR REALTIME_ERROR STREAM_SNAPSHOT ACCEPTED_PUSH LEADER_REPLAY SETTINGS_READ SNAPSHOT_READ FRONTEND RENDER SOCKET NONE').split(' '));
  const lookups = new Set(('LIVE_CACHE_HUB SETTINGS_HUB REMEMBERED_SNAPSHOT BROWSER_CACHE NONE OTHER_SAFE_CLASS').split(' '));
  const statuses = new Set(['synced', 'degraded', 'error', 'not_configured', 'connecting', '']);
  const codes = new Set(('DB_SNAPSHOT_READ_ERROR TURSO_LIVE_TIMEOUT TURSO_HEAVY_READ_GUARD TURSO_READS_BLOCKED TURSO_HTTP_ERROR TURSO_NETWORK_ERROR TURSO_PROTOCOL_ERROR TURSO_QUERY_ERROR TURSO_CONFIG_MISSING TURSO_BIND_INVALID TURSO_BATCH_INVALID TURSO_BATCH_ERROR TURSO_COMMIT_ERROR MS_STREAM_ERROR MS_ROUTE_ERROR MS_SYNC_FAILED MS_CREDENTIAL_ERROR INVALID_SESSION FORBIDDEN AUTH_PROVIDER_LIMIT AUTH_VERIFY_UNAVAILABLE REQUEST_TIMEOUT UPSTREAM_TIMEOUT NON_JSON_RESPONSE SERVER_ERROR').split(' '));
  const safeCode = value => {
    const code = String(value || '');
    return codes.has(code) ? code : code.startsWith('TURSO_') ? 'TURSO_OTHER' : code ? 'OTHER_ERROR' : '';
  };
  const errorClass = value => {
    const code = safeCode(value);
    return !code ? 'NONE' : code === 'DB_SNAPSHOT_READ_ERROR' ? code : code.startsWith('TURSO_') ? 'TURSO_ERROR' : code === 'MS_STREAM_ERROR' ? 'REALTIME_ERROR' : /AUTH|SESSION|FORBIDDEN/.test(code) ? 'AUTH_ERROR' : code === 'MS_ROUTE_ERROR' ? 'ROUTE_ERROR' : code.startsWith('MS_') ? 'SOURCE_ERROR' : 'UNKNOWN_ERROR';
  };
  const boolean = value => typeof value === 'boolean' ? value : null;
  const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const timestamp = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return '';
    return Number.isFinite(Date.parse(value)) ? value : '';
  };
  function record(eventType, data = {}) {
    if (!enabled) return null;
    try {
      if (!types.has(eventType)) return null;
      const hub = String(data.hub || '').toUpperCase();
      const errorCode = safeCode(data.errorCode);
      const event = {
        sequence: ++sequence, relativeMs: Math.max(0, Math.round(clock() - started)),
        eventType, eventSource: sources.has(data.eventSource) ? data.eventSource : 'NONE',
        hub: /^[A-Z][A-Z0-9_]{0,15}$/.test(hub) ? hub : '',
        socketInstanceId: integer(data.socketInstanceId), listenerInstanceId: integer(data.listenerInstanceId),
        msStatus: statuses.has(data.msStatus) ? data.msStatus : '', errorCode,
        syncErrorClass: errorClass(errorCode || (data.hasSyncError ? 'OTHER_ERROR' : '')),
        snapshotReadAttempted: boolean(data.snapshotReadAttempted), snapshotReadOk: boolean(data.snapshotReadOk),
        snapshotLookupClass: lookups.has(data.snapshotLookupClass) ? data.snapshotLookupClass : 'NONE',
        backendDatabaseFallback: boolean(data.backendDatabaseFallback), realtimeDatabaseFallback: boolean(data.realtimeDatabaseFallback),
        msSnapshotDatabaseDegradedBefore: boolean(data.msSnapshotDatabaseDegradedBefore),
        msSnapshotDatabaseDegradedAfter: boolean(data.msSnapshotDatabaseDegradedAfter),
        connectionStateBefore: ['HEALTHY', 'DB_WARNING', 'OTHER'].includes(data.connectionStateBefore) ? data.connectionStateBefore : 'OTHER',
        connectionStateAfter: ['HEALTHY', 'DB_WARNING', 'OTHER'].includes(data.connectionStateAfter) ? data.connectionStateAfter : 'OTHER',
        lastAcceptedSourceTimestamp: timestamp(data.lastAcceptedSourceTimestamp),
        renderedStatusClass: ['HEALTHY', 'DB_WARNING', 'OTHER'].includes(data.renderedStatusClass) ? data.renderedStatusClass : 'OTHER',
        classifierResult: boolean(data.classifierResult),
        backendSequence: integer(data.backendSequence), backendRelativeMs: integer(data.backendRelativeMs),
        settingsReadAttempted: boolean(data.settingsReadAttempted), settingsReadOk: boolean(data.settingsReadOk),
        settingsErrorCode: safeCode(data.settingsErrorCode),
        settingsReadClass: ['CACHE_HIT', 'IN_FLIGHT', 'READ', 'UNKNOWN'].includes(data.settingsReadClass) ? data.settingsReadClass : 'UNKNOWN',
      };
      if (firstSequence === null && event.msSnapshotDatabaseDegradedBefore === false && event.msSnapshotDatabaseDegradedAfter === true) {
        event.marker = 'FIRST_REDEGRADE';
        firstSequence = event.sequence;
        for (const previous of events.slice(-16)) pinned.add(previous.sequence);
        pinned.add(event.sequence);
      }
      events.push(event);
      if (events.length > 64) events.splice(events.findIndex(item => !pinned.has(item.sequence)), 1);
      try { onChange(); } catch {}
      return { ...event };
    } catch { return null; }
  }
  return { record, safeCode, errorClass, snapshot: () => ({ name: 'MS_REDEGRADE_TRACE_V1', maxEvents: 64, firstRedegradeSequence: firstSequence, events: events.map(event => ({ ...event })) }) };
}

export function patchMsRedegradeTraceFrontend(source) {
  if (source.includes('// MS_REDEGRADE_TRACE_V1_FRONTEND')) return source;
  // Observe immediately after existing assignments, without replacing their values.
  const flag = /    state\.msSnapshotDatabaseDegraded = msDatabaseSnapshotFailure\(payload\);|  state\.msSnapshotDatabaseDegraded = msDatabaseSnapshotFailure\(result\);|      state\.msSnapshotDatabaseDegraded = true;/g;
  let count = 0;
  source = source.replace(flag, match => { count++; return match + '\n  if (typeof msTraceFlagTransition === "function") msTraceFlagTransition();'; });
  if (count !== 3) throw new Error('MS_REDEGRADE_TRACE_V1 expected three flag assignments, got ' + count);
  source = replaceUnique(source, '    realtimeSocket = socket;', '    realtimeSocket = socket;\n    msTraceSocket(socket, "SOCKET_CREATE");');
  source = replaceUnique(source, '    socket.onopen = () => {', '    socket.onopen = () => {\n      msTraceSocket(socket, "SOCKET_OPEN");');
  source = replaceUnique(source, '    socket.onerror = () => {};', '    socket.onerror = () => { msTraceSocket(socket, "SOCKET_ERROR"); };');
  source = replaceUnique(source, '    socket.onclose = () => {', '    socket.onclose = () => {\n      msTraceSocket(socket, "SOCKET_CLOSE");');
  source = replaceUnique(source, '  if (!socket) return;\n  try {\n    socket.onopen = null;', '  if (!socket) return;\n  msTraceSocket(socket, "SOCKET_REPLACE");\n  try {\n    socket.onopen = null;');
  return source + '\n// MS_REDEGRADE_TRACE_V1_FRONTEND\n' + createMsRedegradeTrace.toString() + '\n' + frontendRuntime.toString() + '\nfrontendRuntime();\n';
}

function frontendRuntime() {
  // Defense in depth in addition to DEV-only staging. This surface is hidden until auth.
  if (typeof location === 'undefined' || location.hostname !== 'waiting-trucks-report-api-dev.26nak-testdev.workers.dev') return;
  const ids = new WeakMap(), seenBackend = new Set();
  let socketCounter = 0, listenerCounter = 0, scope = null, lastClassified = null;
  let observedFlag = Boolean(state.msSnapshotDatabaseDegraded), rendered = 'OTHER';
  const trace = createMsRedegradeTrace(true, () => performance.now(), surface);
  function current(extra = {}) {
    const identity = realtimeSocket ? ids.get(realtimeSocket) : null;
    return { hub: state.branch, socketInstanceId: identity?.socketInstanceId ?? null,
      listenerInstanceId: identity?.listenerInstanceId ?? null, msStatus: state.msStatus,
      errorCode: scope?.errorCode || '', hasSyncError: Boolean(state.syncError),
      backendDatabaseFallback: scope?.backendDatabaseFallback ?? null,
      realtimeDatabaseFallback: scope?.realtimeDatabaseFallback ?? null,
      msSnapshotDatabaseDegradedBefore: Boolean(state.msSnapshotDatabaseDegraded),
      msSnapshotDatabaseDegradedAfter: Boolean(state.msSnapshotDatabaseDegraded),
      connectionStateBefore: rendered, connectionStateAfter: rendered,
      lastAcceptedSourceTimestamp: state.lastSync, renderedStatusClass: rendered,
      eventSource: scope?.eventSource || 'FRONTEND', ...extra };
  }
  function surface() {
    if (typeof document?.createElement !== 'function' || !document.body) return;
    let card = document.getElementById('ms-redegrade-trace-v1');
    if (!card) {
      card = document.createElement('details'); card.id = 'ms-redegrade-trace-v1';
      const title = document.createElement('summary'); title.textContent = 'DEV diagnostic · MS_REDEGRADE_TRACE_V1';
      const text = document.createElement('textarea'); text.readOnly = true; text.rows = 10;
      text.setAttribute('aria-label', 'MS_REDEGRADE_TRACE_V1 readonly JSON');
      text.style.width = '100%'; card.append(title, text); document.body.append(card);
      card.addEventListener('toggle', () => surface());
    }
    card.hidden = !state.auth;
    if (state.auth && card.open) card.querySelector('textarea').value = JSON.stringify(trace.snapshot(), null, 2);
    if (!state.auth) card.querySelector('textarea').value = '';
  }
  function ingest(payload) {
    const envelope = payload?.msRedegradeTrace;
    if (envelope?.name !== 'MS_REDEGRADE_TRACE_V1' || !Array.isArray(envelope.events)) return;
    for (const event of envelope.events.slice(-64)) {
      if (event.hub !== state.branch) continue;
      const key = [event.sequence, event.relativeMs, event.eventType, event.hub].join(':');
      if (seenBackend.has(key)) continue;
      seenBackend.add(key); if (seenBackend.size > 64) seenBackend.delete(seenBackend.values().next().value);
      trace.record(event.eventType, { ...event, backendSequence: event.sequence, backendRelativeMs: event.relativeMs });
    }
  }
  function within(eventSource, payload, callback) {
    const previous = scope;
    scope = { eventSource, errorCode: trace.safeCode(payload?.errorCode || payload?.code),
      backendDatabaseFallback: typeof payload?.backendDatabaseFallback === 'boolean' ? payload.backendDatabaseFallback : null,
      realtimeDatabaseFallback: typeof payload?.realtimeDatabaseFallback === 'boolean' ? payload.realtimeDatabaseFallback : null };
    try { return callback(); } finally { scope = previous; }
  }
  // These observers do not set any product flag, error, cache, transport or timer.
  globalThis.msTraceFlagTransition = () => {
    trace.record('STATE_CHANGE', current({ msSnapshotDatabaseDegradedBefore: observedFlag,
      errorCode: scope?.errorCode || lastClassified?.errorCode, eventSource: scope?.eventSource || lastClassified?.eventSource || 'FRONTEND' }));
    observedFlag = Boolean(state.msSnapshotDatabaseDegraded);
  };
  globalThis.msTraceSocket = (socket, eventType) => {
    if (!ids.has(socket)) ids.set(socket, { socketInstanceId: ++socketCounter, listenerInstanceId: ++listenerCounter });
    trace.record(eventType, current({ ...ids.get(socket), eventSource: 'SOCKET' }));
  };
  const originalClassifier = msDatabaseSnapshotFailure;
  msDatabaseSnapshotFailure = function(value) {
    const result = originalClassifier(value);
    lastClassified = { errorCode: trace.safeCode(value?.errorCode || value?.code), eventSource: scope?.eventSource || (value instanceof Error ? 'HTTP_ERROR' : 'FRONTEND') };
    trace.record('CLASSIFIER_RESULT', current({ errorCode: value?.errorCode || value?.code,
      classifierResult: result, eventSource: scope?.eventSource || (value instanceof Error ? 'HTTP_ERROR' : 'FRONTEND') }));
    return result;
  };
  const originalMessage = handleRealtimeMessage;
  handleRealtimeMessage = function(raw) {
    let payload; try { payload = JSON.parse(String(raw || '{}')); } catch { return originalMessage(raw); }
    ingest(payload);
    const source = ['ACCEPTED_PUSH', 'LEADER_REPLAY', 'STREAM_SNAPSHOT'].includes(payload?.msRedegradeTrace?.eventSource)
      ? payload.msRedegradeTrace.eventSource : 'REALTIME_ERROR';
    return within(source, payload, () => {
      if (payload?.type === 'snapshot' || payload?.type === 'error')
        trace.record(payload.type === 'snapshot' ? 'SOCKET_MESSAGE_SNAPSHOT' : 'SOCKET_MESSAGE_ERROR', current());
      return originalMessage(raw);
    });
  };
  const originalApply = applyLiveResult;
  applyLiveResult = function(result, fromStream = false) {
    ingest(result);
    return within(scope?.eventSource || (fromStream ? 'BROWSER_CACHE' : 'HTTP_REPORT'), result, () => originalApply(result, fromStream));
  };
  const originalApi = apiGet;
  apiGet = async function(action, params) {
    if (!['msRoutes', 'msRoutesSnapshot'].includes(action)) return originalApi(action, params);
    try {
      const result = await originalApi(action, params); ingest(result);
      within(action === 'msRoutesSnapshot' ? 'HTTP_BOOTSTRAP' : 'HTTP_REPORT', result, () =>
        trace.record(action === 'msRoutesSnapshot' ? 'BOOTSTRAP_RESULT' : 'HTTP_RESULT', current()));
      return result;
    } catch (error) {
      within('HTTP_ERROR', error, () => trace.record('HTTP_ERROR', current())); throw error;
    }
  };
  const originalConnection = connection;
  connection = function(ok) {
    if (observedFlag !== Boolean(state.msSnapshotDatabaseDegraded)) globalThis.msTraceFlagTransition();
    const result = originalConnection(ok), before = rendered;
    rendered = ok ? 'HEALTHY' : 'OTHER';
    trace.record(ok ? 'RENDER_HEALTHY' : 'RENDER_OTHER', current({ connectionStateBefore: before }));
    return result;
  };
  const originalWarning = showMsDatabaseReadStatus;
  showMsDatabaseReadStatus = function() {
    const result = originalWarning(), before = rendered; rendered = 'DB_WARNING';
    trace.record('RENDER_DB_WARNING', current({ connectionStateBefore: before })); return result;
  };
  if (typeof authUi === "function") {
    const originalAuthUi = authUi;
    authUi = function() { const result = originalAuthUi(); surface(); return result; };
  }
  const originalFreshness = renderFreshness;
  renderFreshness = function() {
    const result = originalFreshness(); trace.record('RENDER_OTHER', current()); return result;
  };
  globalThis.msRedegradeTraceV1 = () => trace.snapshot();
  trace.record('TRACE_INIT', current({ eventSource: 'PAGE' }));
}

// Outside DEV the injected assignment observers must remain harmless.
const inertFrontend = '\nfunction msTraceFlagTransition() {}\nfunction msTraceSocket() {}\n';

export function patchMsRedegradeTraceWorker(source) {
  if (source.includes('// MS_REDEGRADE_TRACE_V1_WORKER')) return source;
  const start = source.indexOf('async function readMsLiveCache(');
  const end = source.indexOf('\nasync function writeMsLiveCache(', start);
  if (start < 0 || end < start) throw new Error('MS_REDEGRADE_TRACE_V1 cache boundary missing');
  let cache = source.slice(start, end);
  cache = replaceUnique(cache, '  try {', '  msTraceReadEvent(env, hub, "SNAPSHOT_READ_START", "LIVE_CACHE_HUB");\n  try {');
  cache = replaceUnique(cache, '    if (!row) return null;', '    if (!row) { msTraceReadEvent(env, hub, "SNAPSHOT_READ_OK", "LIVE_CACHE_HUB", false); return null; }');
  cache = replaceUnique(cache, '    if (!rows) return null;', '    if (!rows) { msTraceReadEvent(env, hub, "SNAPSHOT_READ_ERROR", "LIVE_CACHE_HUB", false); return null; }');
  cache = replaceUnique(cache, '    return {', '    msTraceReadEvent(env, hub, "SNAPSHOT_READ_OK", "LIVE_CACHE_HUB", true);\n    return {');
  cache = replaceUnique(cache, '  } catch (error) {', '  } catch (error) {\n    msTraceReadEvent(env, hub, "SNAPSHOT_READ_ERROR", "LIVE_CACHE_HUB", false, error?.code);');
  source = source.slice(0, start) + cache + source.slice(end);
  source = replaceUnique(source, '      settings = await readSettings(msLiveDatabaseEnv(this.env), branch);', '      settings = await msTraceSettingsRead(msLiveDatabaseEnv(this.env), branch);');
  // Existing settings calls inside these two report paths only.
  for (const action of ['msRoutesSnapshot', 'msRoutes']) {
    const begin = source.indexOf('  if (action === "' + action + '") {');
    const finish = source.indexOf('\n  if (action === ', begin + 1);
    const block = source.slice(begin, finish);
    source = source.slice(0, begin) + replaceUnique(block, 'readSettings(env, branch)', 'msTraceSettingsRead(env, branch)') + source.slice(finish);
  }
  source = replaceUnique(source, '      rows: snapshot.rows,', '      ...msTraceEnvelope(env, branch, "HTTP_BOOTSTRAP", snapshot),\n      rows: snapshot.rows,');
  source = replaceUnique(source, '      msStatus: live.status,', '      ...msTraceEnvelope(env, branch, "HTTP_REPORT", live),\n      msStatus: live.status,');
  source = replaceUnique(source, '    this.lastSnapshotPayload = payload;\n    this.lastSnapshotBranch = branch;\n    return payload;', '    Object.assign(payload, msTraceEnvelope(this.env, branch, "STREAM_SNAPSHOT", payload, { settingsReadAttempted: true, settingsReadOk: !readError, settingsErrorCode: readError?.code || (readError ? "DB_SNAPSHOT_READ_ERROR" : "") }));\n    this.lastSnapshotPayload = payload;\n    this.lastSnapshotBranch = branch;\n    return payload;');
  source = replaceUnique(source, '      syncError: result.error || "", errorCode: result.errorCode || "" };', '      syncError: result.error || "", errorCode: result.errorCode || "",\n      ...msTraceEnvelope(this.env, branch, "ACCEPTED_PUSH", result) };');
  source = replaceUnique(source, '        next.send(JSON.stringify(this.lastSnapshotPayload));', '        next.send(JSON.stringify({ ...this.lastSnapshotPayload, ...msTraceEnvelope(this.env, nextAttachment.branch, "LEADER_REPLAY", this.lastSnapshotPayload) }));');
  // Wrap only the already-existing bootstrap cache query, not a new read.
  source = replaceUnique(source, '    const [cache, settings] = await Promise.all([\n      env.DB.prepare(', '    const [cache, settings] = await Promise.all([\n      msTraceRead(env, branch, "SNAPSHOT_READ", "LIVE_CACHE_HUB", () => env.DB.prepare(');
  source = replaceUnique(source, '        .first(),\n      msTraceSettingsRead(env, branch),\n    ]);', '        .first()),\n      msTraceSettingsRead(env, branch),\n    ]);');
  return source + '\n// MS_REDEGRADE_TRACE_V1_WORKER\n' + createMsRedegradeTrace.toString() + '\n' + workerRuntime;
}

const workerRuntime = String.raw`
const msRedegradeBackendTrace = createMsRedegradeTrace(true, () => globalThis.performance?.now?.() ?? 0);
function msTraceEnabled(env) { return env?.DEV_ACCEPTANCE_TELEMETRY === "1"; }
async function msTraceRead(env, hub, source, lookup, read, settingsReadClass = "UNKNOWN") {
  if (!msTraceEnabled(env)) return read();
  const fields = { hub, eventSource: source, snapshotLookupClass: lookup, snapshotReadAttempted: true, settingsReadClass };
  msRedegradeBackendTrace.record(source + "_START", fields);
  try {
    const result = await read();
    msRedegradeBackendTrace.record(source + "_OK", { ...fields, snapshotReadOk: result != null });
    return result;
  } catch (error) {
    msRedegradeBackendTrace.record(source + "_ERROR", { ...fields, snapshotReadOk: false, errorCode: error?.code });
    throw error;
  }
}
function msTraceReadEvent(env, hub, eventType, lookup, ok = null, code = "") {
  if (!msTraceEnabled(env)) return;
  msRedegradeBackendTrace.record(eventType, { hub, eventSource: "SNAPSHOT_READ", snapshotLookupClass: lookup,
    snapshotReadAttempted: true, snapshotReadOk: ok, errorCode: code });
}
async function msTraceSettingsRead(env, branch) {
  if (!msTraceEnabled(env)) return readSettings(env, branch);
  const key = String(branch || "").toUpperCase();
  const settingsReadClass = hubSettingsCache.get(key)?.until > Date.now() ? "CACHE_HIT" : hubSettingsActive.has(key) ? "IN_FLIGHT" : "READ";
  return msTraceRead(env, branch, "SETTINGS_READ", "SETTINGS_HUB", () => readSettings(env, branch), settingsReadClass);
}
function msTraceEnvelope(env, hub, eventSource, value, outcome = {}) {
  if (!msTraceEnabled(env)) return {};
  const eventType = eventSource === "ACCEPTED_PUSH" || eventSource === "LEADER_REPLAY" ? eventSource : eventSource === "HTTP_BOOTSTRAP" ? "BOOTSTRAP_RESULT" : eventSource === "HTTP_REPORT" ? "HTTP_RESULT" : "STREAM_PAYLOAD";
  msRedegradeBackendTrace.record(eventType, { hub, eventSource, msStatus: value?.msStatus || value?.status,
    errorCode: value?.errorCode || value?.code, hasSyncError: Boolean(value?.syncError || value?.error),
    lastAcceptedSourceTimestamp: value?.lastSync || value?.syncedAt, ...outcome });
  return { msRedegradeTrace: { ...msRedegradeBackendTrace.snapshot(), eventSource,
    events: msRedegradeBackendTrace.snapshot().events.filter(event => event.hub === hub).slice(-16) } };
}
`;

// The declarations precede runtime installation; hoisted calls stay inert on non-DEV hosts.
export function patchMsRedegradeTraceFrontendFinal(source) {
  const patched = patchMsRedegradeTraceFrontend(source);
  if (patched === source) return source;
  return patched.replace('\nfrontendRuntime();\n', inertFrontend + '\nfrontendRuntime();\n');
}
