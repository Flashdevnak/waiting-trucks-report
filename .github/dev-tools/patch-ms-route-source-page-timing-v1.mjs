// DEV-only passive observer. It neither submits work nor retains provider data.
export function createMsRouteSourcePageTimingTrace(clock = () => 0) {
  const records = [];
  const active = new Set();
  const elapsed = start => Math.max(0, Math.round(clock() - start));
  const category = error => error?.code === 'UPSTREAM_TIMEOUT' ? 'UPSTREAM_TIMEOUT'
    : error?.code === 'MS_ROUTE_RATE_LIMIT' ? 'RATE_LIMIT'
    : error?.code === 'MS_SESSION_EXPIRED' || error?.code === 'MS_SESSION_HTTP_401' ? 'AUTH'
    : error?.code === 'MS_HTTP_ERROR' || error?.code === 'MS_ROUTE_SOURCE_ERROR' ? 'PROVIDER'
    : error?.code === 'MS_NOT_CONFIGURED' ? 'NOT_CONFIGURED'
    : error?.code === 'TURSO_LIVE_TIMEOUT' ? 'DB_TIMEOUT' : 'OTHER';
  const count = value => Number.isFinite(value) && value >= 0 ? Math.min(1_000_000, Math.floor(value)) : null;
  function begin(hub, refreshInstanceId) {
    if (!/^[A-Z0-9_-]{1,24}$/.test(hub || '') || !Number.isSafeInteger(refreshInstanceId) || active.size >= 8) return null;
    const record = { hub, refreshInstanceId, credential: { cache: 'UNKNOWN', durationMs: null, outcome: 'UNKNOWN' },
      pages: [], pageCount: null, reportedTotal: null, totalItems: null, pacingCount: 0, pacingDurationMs: 0,
      sourceDurationMs: null, acquisitionDurationMs: null, hashDurationMs: null, sourceMatch: null, outcome: 'UNKNOWN', errorCategory: null };
    const owner = { record, started: clock(), done: false }; active.add(owner); return owner;
  }
  function finish(owner, error) {
    if (!owner || owner.done) return;
    owner.done = true; active.delete(owner);
    owner.record.outcome = error ? 'ERROR' : 'SUCCESS';
    owner.record.errorCategory = error ? category(error) : null;
    records.push(owner.record); if (records.length > 8) records.shift();
  }
  function pageStart(owner, page) {
    if (!owner || owner.done || !Number.isInteger(page) || page < 1 || page > 20 || owner.record.pages.length >= 20) return null;
    const entry = { page, durationMs: null, fetchToHeadersMs: null, parseMs: null, items: null, outcome: 'UNKNOWN', errorCategory: null };
    owner.record.pages.push(entry);
    return { entry, started: clock(), fetched: null, parsing: null };
  }
  const snapshot = () => ({ name: 'MS_ROUTE_SOURCE_PAGE_TIMING_V1', maxRefreshes: 8, maxPages: 20,
    unobservable: ['NETWORK_CONNECT', 'REQUEST_UPLOAD', 'REMOTE_EXECUTION', 'BODY_CONSUMPTION_VS_JSON_PARSE'],
    records: records.map(r => ({ ...r, credential: { ...r.credential }, pages: r.pages.map(p => ({ ...p })) })) });
  return { begin, finish, snapshot,
    credentialCache(owner, cache) { if (owner && !owner.done) owner.record.credential.cache = cache === 'HIT' ? 'HIT' : 'MISS'; },
    credentialStart() { return clock(); },
    credentialEnd(owner, started, error) { if (!owner || owner.done) return; owner.record.credential.durationMs = elapsed(started);
      owner.record.credential.outcome = error ? 'ERROR' : 'SUCCESS'; if (error) finish(owner, error); },
    sourceStart() { return clock(); },
    sourceEnd(owner, started, rows, error) { if (!owner || owner.done) return; owner.record.sourceDurationMs = elapsed(started);
      owner.record.acquisitionDurationMs = elapsed(owner.started);
      owner.record.totalItems = Array.isArray(rows) ? count(rows.length) : null;
      if (error || rows?.routeSourceError) finish(owner, error || rows.routeSourceError); },
    pageStart, fetchStart(page) { if (page) page.fetched = clock(); },
    headers(page) { if (page?.fetched !== null && page) page.entry.fetchToHeadersMs = elapsed(page.fetched); if (page) page.parsing = clock(); },
    parsed(page) { if (page?.parsing !== null && page) page.entry.parseMs = elapsed(page.parsing); },
    pageItems(page, items) { if (page) page.entry.items = count(items?.length); },
    pageEnd(page, error) { if (!page) return; page.entry.durationMs = elapsed(page.started); page.entry.outcome = error ? 'ERROR' : 'SUCCESS';
      page.entry.errorCategory = error ? category(error) : null; },
    plan(owner, pages, total) { if (owner && !owner.done) { owner.record.pageCount = count(pages); owner.record.reportedTotal = count(total); } },
    pacingStart() { return clock(); },
    pacingEnd(owner, started) { if (!owner || owner.done) return; owner.record.pacingCount++;
      owner.record.pacingDurationMs += elapsed(started); },
    hashStart() { return clock(); },
    hashEnd(owner, started, error) { if (!owner || owner.done) return; owner.record.hashDurationMs = elapsed(started); if (error) finish(owner, error); },
    match(owner, match) { if (!owner || owner.done) return; owner.record.sourceMatch = Boolean(match); finish(owner, null); },
  };
}

// Whitelist again at the browser boundary; a Worker envelope is never trusted wholesale.
export function sanitizeMsRouteSourceTimingSnapshot(value, hub) {
  const empty = { name: 'MS_ROUTE_SOURCE_PAGE_TIMING_V1', maxRefreshes: 8, maxPages: 20,
    unobservable: ['NETWORK_CONNECT', 'REQUEST_UPLOAD', 'REMOTE_EXECUTION', 'BODY_CONSUMPTION_VS_JSON_PARSE'], records: [] };
  if (value?.name !== empty.name || !Array.isArray(value.records)) return empty;
  const number = n => Number.isFinite(n) && n >= 0 ? Math.min(1_000_000, n) : null;
  const choice = (v, values, fallback = null) => values.includes(v) ? v : fallback;
  for (const r of value.records.slice(-8)) {
    if (r?.hub !== hub || !Number.isSafeInteger(r.refreshInstanceId)) continue;
    empty.records.push({ hub, refreshInstanceId: r.refreshInstanceId,
      credential: { cache: choice(r.credential?.cache, ['HIT', 'MISS', 'UNKNOWN'], 'UNKNOWN'),
        durationMs: number(r.credential?.durationMs), outcome: choice(r.credential?.outcome, ['SUCCESS', 'ERROR', 'UNKNOWN'], 'UNKNOWN') },
      pages: (Array.isArray(r.pages) ? r.pages : []).slice(0, 20).map(p => ({
        page: number(p.page), durationMs: number(p.durationMs), fetchToHeadersMs: number(p.fetchToHeadersMs),
        parseMs: number(p.parseMs), items: number(p.items), outcome: choice(p.outcome, ['SUCCESS', 'ERROR', 'UNKNOWN'], 'UNKNOWN'),
        errorCategory: choice(p.errorCategory, ['UPSTREAM_TIMEOUT', 'RATE_LIMIT', 'AUTH', 'PROVIDER', 'NOT_CONFIGURED', 'DB_TIMEOUT', 'OTHER']) })),
      pageCount: number(r.pageCount), reportedTotal: number(r.reportedTotal), totalItems: number(r.totalItems),
      pacingCount: number(r.pacingCount), pacingDurationMs: number(r.pacingDurationMs),
      sourceDurationMs: number(r.sourceDurationMs), acquisitionDurationMs: number(r.acquisitionDurationMs), hashDurationMs: number(r.hashDurationMs),
      sourceMatch: typeof r.sourceMatch === 'boolean' ? r.sourceMatch : null,
      outcome: choice(r.outcome, ['SUCCESS', 'ERROR', 'UNKNOWN'], 'UNKNOWN'),
      errorCategory: choice(r.errorCategory, ['UPSTREAM_TIMEOUT', 'RATE_LIMIT', 'AUTH', 'PROVIDER', 'NOT_CONFIGURED', 'DB_TIMEOUT', 'OTHER']) });
  }
  return empty;
}

function once(source, before, after) {
  if (source.split(before).length !== 2) throw new Error('Route timing anchor mismatch: ' + before.slice(0, 90));
  return source.replace(before, after);
}

export function patchMsRouteSourcePageTimingWorker(source) {
  if (source.includes('// MS_ROUTE_SOURCE_PAGE_TIMING_V1_WORKER')) return source;
  source = once(source, '  env = msLiveDatabaseEnv(env);\n  let credentials = null;',
    '  env = msLiveDatabaseEnv(env);\n  const routeTiming = msRouteTimingBegin(env, branch);\n  let routeSourceStarted = null;\n  let credentials = null;');
  source = once(source, '    credentials = await msCredentials(env, branch);',
    '    credentials = await msCredentials(env, branch, routeTiming);');
  source = once(source, '  try {\n    credentials = await msCredentials(env, branch, routeTiming);\n  } catch (error) {',
    '  const credentialStarted = msRouteTimingSafe(() => msRouteTimingTrace.credentialStart());\n  try {\n    credentials = await msCredentials(env, branch, routeTiming);\n    msRouteTimingSafe(() => msRouteTimingTrace.credentialEnd(routeTiming, credentialStarted));\n  } catch (error) {\n    msRouteTimingSafe(() => msRouteTimingTrace.credentialEnd(routeTiming, credentialStarted, error));');
  source = once(source, '    const rows = await readMsRoutes(credentials);\n    msPhaseEnv(env, "SOURCE_ACQUISITION_COMPLETED",',
    '    routeSourceStarted = msRouteTimingSafe(() => msRouteTimingTrace.sourceStart());\n    const rows = await readMsRoutes(credentials, undefined, undefined, routeTiming);\n    msRouteTimingSafe(() => msRouteTimingTrace.sourceEnd(routeTiming, routeSourceStarted, rows));\n    routeSourceStarted = null;\n    msPhaseEnv(env, "SOURCE_ACQUISITION_COMPLETED",');
  source = once(source, '    const sourceHash = MS_LIVE_CACHE_VERSION + ":" + await sha(canonicalMsSource(mappedRows));',
    '    const routeHashStarted = msRouteTimingSafe(() => msRouteTimingTrace.hashStart());\n    const sourceHash = MS_LIVE_CACHE_VERSION + ":" + await sha(canonicalMsSource(mappedRows));\n    msRouteTimingSafe(() => msRouteTimingTrace.hashEnd(routeTiming, routeHashStarted));');
  source = once(source, '    msPhaseEnv(env, "SOURCE_HASH_DECISION", { sourceCached: Boolean(acceptedSource), sourceMatch: Boolean(cache?.sourceMatch) });',
    '    msPhaseEnv(env, "SOURCE_HASH_DECISION", { sourceCached: Boolean(acceptedSource), sourceMatch: Boolean(cache?.sourceMatch) });\n    msRouteTimingSafe(() => msRouteTimingTrace.match(routeTiming, Boolean(cache?.sourceMatch)));');
  source = once(source, '    if (transientEmptyHold) {\n      const result',
    '    if (transientEmptyHold) {\n      msRouteTimingSafe(() => msRouteTimingTrace.finish(routeTiming, null));\n      const result');
  source = once(source, '  } catch (error) {\n    const errorCode = String(error?.code || "");',
    '  } catch (error) {\n    if (routeSourceStarted !== null) msRouteTimingSafe(() => msRouteTimingTrace.sourceEnd(routeTiming, routeSourceStarted, null, error));\n    msRouteTimingSafe(() => msRouteTimingTrace.finish(routeTiming, error));\n    const errorCode = String(error?.code || "");');
  source = once(source, 'async function msCredentials(env, hub) {\n  const key', 'async function msCredentials(env, hub, routeTiming) {\n  const key');
  source = once(source, '  if (cached?.until > Date.now()) return cached.value;\n  const row',
    '  if (cached?.until > Date.now()) { msRouteTimingSafe(() => msRouteTimingTrace.credentialCache(routeTiming, "HIT")); return cached.value; }\n  msRouteTimingSafe(() => msRouteTimingTrace.credentialCache(routeTiming, "MISS"));\n  const row');
  source = once(source, 'async function readMsRoutes(credentials, wantedStart, wantedEnd) {',
    'async function readMsRoutes(credentials, wantedStart, wantedEnd, routeTiming) {');
  source = once(source, '  const first = await readMsPage(credentials, 1, start, end),',
    '  const first = await readMsPage(credentials, 1, start, end, routeTiming),');
  source = once(source, '  if (pages > 1) {\n    const remainingPages',
    '  msRouteTimingSafe(() => msRouteTimingTrace.plan(routeTiming, pages, first.total));\n  if (pages > 1) {\n    const remainingPages');
  source = once(source, '        readMsPage(credentials, page, start, end)));',
    '        readMsPage(credentials, page, start, end, routeTiming)));');
  source = once(source, '        await new Promise((resolve) => setTimeout(resolve, MS_ROUTE_PAGE_BATCH_DELAY_MS));',
    '        { const waitStarted = msRouteTimingSafe(() => msRouteTimingTrace.pacingStart());\n          await new Promise((resolve) => setTimeout(resolve, MS_ROUTE_PAGE_BATCH_DELAY_MS));\n          msRouteTimingSafe(() => msRouteTimingTrace.pacingEnd(routeTiming, waitStarted)); }');
  source = once(source, 'async function readMsPage(credentials, page, start, end) {\n  const url',
    'async function readMsPage(credentials, page, start, end, routeTiming) {\n  const pageTiming = msRouteTimingSafe(() => msRouteTimingTrace.pageStart(routeTiming, page));\n  let pageError = null;\n  try {\n  const url');
  source = once(source, '  const response = await fetchWithTimeout(url, { headers: msBrowserRequestHeaders(credentials) });\n  if (!response.ok)',
    '  msRouteTimingSafe(() => msRouteTimingTrace.fetchStart(pageTiming));\n  const response = await fetchWithTimeout(url, { headers: msBrowserRequestHeaders(credentials) });\n  msRouteTimingSafe(() => msRouteTimingTrace.headers(pageTiming));\n  if (!response.ok)');
  source = once(source, '  const json = await response.json();\n  if (json.code !== 1)',
    '  const json = await response.json();\n  msRouteTimingSafe(() => msRouteTimingTrace.parsed(pageTiming));\n  if (json.code !== 1)');
  const start = source.indexOf('async function readMsPage(credentials, page, start, end, routeTiming) {');
  const end = source.indexOf('\nasync function saveMsConnection(', start);
  if (start < 0 || end < 0) throw new Error('Route page function boundary missing');
  let pageSource = source.slice(start, end);
  pageSource = once(pageSource, '  return {\n    items: Array.isArray(json.data?.items) ? json.data.items : [],\n    total: Number(json.data?.pagination?.total_count) || 0,\n  };\n}',
    '  const result = {\n    items: Array.isArray(json.data?.items) ? json.data.items : [],\n    total: Number(json.data?.pagination?.total_count) || 0,\n  };\n  msRouteTimingSafe(() => msRouteTimingTrace.pageItems(pageTiming, result.items, result.total));\n  return result;\n  } catch (error) { pageError = error; throw error; }\n  finally { msRouteTimingSafe(() => msRouteTimingTrace.pageEnd(pageTiming, pageError)); }\n}');
  source = source.slice(0, start) + pageSource + source.slice(end);
  source = once(source, 'return { msTursoCriticalPathPhaseTrace: msPhaseSnapshot(hub),',
    'return { msRouteSourcePageTimingTrace: msRouteTimingSnapshot(hub), msTursoCriticalPathPhaseTrace: msPhaseSnapshot(hub),');
  return source + '\n// MS_ROUTE_SOURCE_PAGE_TIMING_V1_WORKER\n' + createMsRouteSourcePageTimingTrace.toString() + '\n' + sanitizeMsRouteSourceTimingSnapshot.toString() + '\n' + runtime;
}

const runtime = String.raw`
const msRouteTimingTrace = createMsRouteSourcePageTimingTrace(() => msPhaseNow());
function msRouteTimingSafe(fn) { try { return fn(); } catch { return null; } }
function msRouteTimingBegin(env, branch) {
  return msRouteTimingSafe(() => { const context = msProducerContext(env); return msRouteTimingTrace.begin(branch, context?.refreshInstanceId); });
}
function msRouteTimingSnapshot(hub) { return sanitizeMsRouteSourceTimingSnapshot(msRouteTimingTrace.snapshot(), hub); }
`;

export function patchMsRouteSourcePageTimingFrontend(source) {
  if (source.includes('// MS_ROUTE_SOURCE_PAGE_TIMING_V1_FRONTEND')) return source;
  source = once(source, '  let criticalPath = createMsCriticalPathPhaseTrace(() => performance.now());',
    '  let criticalPath = createMsCriticalPathPhaseTrace(() => performance.now());\n  let routeSourceTimingHub = state.branch;\n  let routeSourceTiming = sanitizeMsRouteSourceTimingSnapshot(null, routeSourceTimingHub);\n  function currentMsRouteSourceTiming() {\n    if (routeSourceTimingHub !== state.branch) {\n      routeSourceTimingHub = state.branch;\n      routeSourceTiming = sanitizeMsRouteSourceTimingSnapshot(null, routeSourceTimingHub);\n    }\n    return routeSourceTiming;\n  }');
  source = once(source, 'criticalPath: criticalPath.snapshot(), lateSettle:',
    'criticalPath: criticalPath.snapshot(), routeSourceTiming: currentMsRouteSourceTiming(), lateSettle:');
  source = once(source, '      const phases = payload?.msTursoCriticalPathPhaseTrace;',
    '      currentMsRouteSourceTiming();\n      const routeTimingEnvelope = payload?.msRouteSourcePageTimingTrace;\n      if (routeTimingEnvelope?.name === "MS_ROUTE_SOURCE_PAGE_TIMING_V1" && Array.isArray(routeTimingEnvelope.records))\n        routeSourceTiming = sanitizeMsRouteSourceTimingSnapshot(routeTimingEnvelope, routeSourceTimingHub);\n      const phases = payload?.msTursoCriticalPathPhaseTrace;');
  return source + '\n// MS_ROUTE_SOURCE_PAGE_TIMING_V1_FRONTEND\n' + sanitizeMsRouteSourceTimingSnapshot.toString() + '\n';
}
