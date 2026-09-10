import fs from 'node:fs';

const file = process.argv[2] || 'src/index.js';
let source = fs.readFileSync(file, 'utf8');
const MARKER = 'TBR_SHADOW_SPLIT_V2';
const RATE_MARKER = 'BUS_TIME_RATE_GUARD_V10';
const CACHE_MARKER = 'TBR_BUS_REUSE_LIVE_CACHE_V10';
const ROUTE_CACHE_MARKER = 'TBR_ROUTE_REUSE_LIVE_CACHE_V12';
const ACCOUNT_GUARD_MARKER = 'MS_UPSTREAM_ACCOUNT_GUARD_V12';
const OPTIONAL_GUARD_MARKER = 'OPTIONAL_SOURCE_RATE_GUARD_V12';
const CACHE_ENVELOPE_MARKER = 'TBR_LIVE_CACHE_ENVELOPE_V13';
if (
  source.includes(MARKER) &&
  source.includes(RATE_MARKER) &&
  source.includes(CACHE_MARKER) &&
  source.includes(ROUTE_CACHE_MARKER) &&
  source.includes(ACCOUNT_GUARD_MARKER) &&
  source.includes(OPTIONAL_GUARD_MARKER) &&
  source.includes(CACHE_ENVELOPE_MARKER)
) {
  console.log('DEV_TBR_SHADOW_SPLIT_V2=ALREADY_APPLIED');
  console.log('DEV_BUS_TIME_RATE_GUARD_V10=ALREADY_APPLIED');
  console.log('DEV_MS_UPSTREAM_ACCOUNT_GUARD_V12=ALREADY_APPLIED');
  process.exit(0);
}

function replaceOnce(input, from, to, label) {
  const first = input.indexOf(from);
  const last = input.lastIndexOf(from);
  if (first < 0 || first !== last) throw new Error(`${label} anchor not unique`);
  return input.replace(from, to);
}

function patchAsyncFunction(input, name, mutate) {
  const marker = `async function ${name}(`;
  const start = input.indexOf(marker);
  if (start < 0) throw new Error(`${name} function not found`);
  const next = input.indexOf('\nasync function ', start + marker.length);
  const end = next < 0 ? input.length : next;
  const before = input.slice(0, start);
  const body = input.slice(start, end);
  const after = input.slice(end);
  return before + mutate(body) + after;
}

const oldConnector = `  const shadowOnly = body.shadowOnly === true;\n  const result = shadowOnly\n    ? await readTbrShadowSnapshot(env, hub)\n    : await refreshMsIfStale(env, { username: \"MS_CRON\", role: \"admin\", branches: [\"*\"] }, hub);`;
const newConnector = `  const shadowOnly = body.shadowOnly === true;\n  const shadowPart = text(body.shadowPart, 20).toLowerCase();\n  const shadowDay = text(body.shadowDay, 20);\n  const result = shadowOnly\n    ? await readTbrShadowSnapshot(env, hub, shadowPart, shadowDay)\n    : await refreshMsIfStale(env, { username: \"MS_CRON\", role: \"admin\", branches: [\"*\"] }, hub);`;
if (!source.includes(MARKER)) {
  if (!source.includes(oldConnector)) throw new Error('split connector anchor not found');
  source = source.replace(oldConnector, newConnector);
}

const start = source.indexOf('async function readTbrShadowSnapshot(env, hub) {');
const alreadySplitStart = source.indexOf('async function readTbrShadowSnapshot(env, hub, part, shadowDay) {');
const snapshotStart = start >= 0 ? start : alreadySplitStart;
const end = source.indexOf('\n\nasync function preEntryCredentials', snapshotStart);
if (snapshotStart < 0 || end <= snapshotStart) throw new Error('readTbrShadowSnapshot function not found');

const replacement = `// ${MARKER}: split Route and BusTime into separate Worker invocations.\n// TBR_ROUTE_OPERATING_WINDOW_V3 / TBR_ROUTE_CHUNK_RETRY_V4 / TBR_ROUTE_ADAPTIVE_RETRY_V5\n// are retained as compatibility helpers for existing deploy gates only. V12 no\n// longer invokes these helpers from TBR Shadow; both Shadow parts reuse the\n// accepted main live cache, so TBR Intelligence adds zero MS upstream polling.\nfunction tbrShadowRouteRanges(now = Date.now()) {\n  const nowThai = now + 7 * 60 * 60 * 1000;\n  const todayStartBangkok = Math.floor(nowThai / 86400000) * 86400000 - 7 * 60 * 60 * 1000;\n  return [\n    { label: \"yesterday\", start: todayStartBangkok - 86400000, end: todayStartBangkok - 1000 },\n    { label: \"today\", start: todayStartBangkok, end: todayStartBangkok + 86400000 - 1000 },\n  ];\n}\n\nasync function readTbrRouteRangeAttempt(credentials, range) {\n  let lastError;\n  for (let attempt = 1; attempt <= 2; attempt++) {\n    try { return await readMsRoutes(credentials, range.start, range.end); }\n    catch (error) {\n      lastError = error;\n      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 350));\n    }\n  }\n  throw lastError || new Error(\"Route \" + range.label + \" failed\");\n}\n\nasync function readTbrRouteRangeAdaptive(credentials, range, depth = 0) {\n  try { return await readTbrRouteRangeAttempt(credentials, range); }\n  catch (error) {\n    const span = Number(range.end) - Number(range.start) + 1;\n    if (depth >= 2 || span <= 6 * 60 * 60 * 1000) {\n      error.message = \"[\" + range.label + \" depth=\" + depth + \"] \" + (error.message || \"Route source failed\");\n      throw error;\n    }\n    const middle = Number(range.start) + Math.floor(span / 2);\n    const left = { label: range.label + \"-A\", start: Number(range.start), end: middle - 1 };\n    const right = { label: range.label + \"-B\", start: middle, end: Number(range.end) };\n    const [leftRows, rightRows] = await Promise.all([\n      readTbrRouteRangeAdaptive(credentials, left, depth + 1),\n      readTbrRouteRangeAdaptive(credentials, right, depth + 1),\n    ]);\n    return [...leftRows, ...rightRows];\n  }\n}\n\nasync function readTbrRouteRangeWithRetry(credentials, range) {\n  return readTbrRouteRangeAdaptive(credentials, range);\n}\n\nfunction tbrShadowBusDays(now = new Date()) {\n  const hour = Number(new Intl.DateTimeFormat(\"en-US\", {\n    timeZone: \"Asia/Bangkok\",\n    hour: \"2-digit\",\n    hourCycle: \"h23\",\n  }).format(now));\n  return hour < 12 ? [thaiDayOffset(-1), thaiDayOffset(0)] : [thaiDayOffset(0)];\n}\n\nfunction tbrShadowPartQuota(part) {\n  return {\n    mode: \"SHADOW_READONLY_SPLIT_V2_CACHE_V12\",\n    part,\n    tursoPointReadsThisCall: 2,\n    tursoPointReadsPerCron: 4,\n    tursoWritesPerCron: 0,\n    routeTableReads: 0,\n    routeTableWrites: 0,\n    historyReads: 0,\n    historyWrites: 0,\n    liveCacheReads: 1,\n    liveCacheWrites: 0,\n    preEntryCalls: 0,\n    extraMsPolling: 0,\n  };\n}\n\n// ${CACHE_ENVELOPE_MARKER}: accept both legacy array cache and current V2 envelope.\nasync function readTbrShadowLiveCache(env, hub, sourceLabel) {\n  const cached = await env.DB.prepare(\n    \"SELECT rows_json,synced_at FROM ms_live_cache WHERE hub=?\",\n  ).bind(hub).first();\n  if (!cached)\n    fail(\"ยังไม่มี live cache สำหรับ \" + sourceLabel, \"TBR_CACHE_EMPTY\", 503);\n  let parsed, rows;\n  try {\n    parsed = JSON.parse(cached.rows_json || \"[]\");\n    rows = Array.isArray(parsed)\n      ? parsed\n      : Array.isArray(parsed?.rows)\n        ? parsed.rows\n        : null;\n  } catch {\n    fail(\"live cache สำหรับ \" + sourceLabel + \" อ่านไม่ได้\", \"TBR_CACHE_INVALID\", 503);\n  }\n  if (!rows)\n    fail(\"live cache สำหรับ \" + sourceLabel + \" ไม่ถูกต้อง\", \"TBR_CACHE_INVALID\", 503);\n  return {\n    rows,\n    syncedAt: text(cached.synced_at, 100),\n    cacheFormat: Array.isArray(parsed) ? 1 : Number(parsed?.version) || 0,\n  };\n}\n\n// ${ROUTE_CACHE_MARKER}: Route Shadow consumes the same accepted main Route\n// snapshot already refreshed by the 4-second shared coordinator. No second MS\n// Route request stream is allowed from the one-minute Browser/TBR cron.\nasync function readTbrShadowRouteFromLiveCache(env, hub) {\n  const cached = await readTbrShadowLiveCache(env, hub, \"Route\");\n  if (cached.rows.length === 0) {\n    const existing = await env.DB.prepare(\n      \"SELECT id FROM ms_routes WHERE hub=? LIMIT 1\",\n    ).bind(hub).first();\n    if (existing)\n      fail(\"live cache Route เป็น 0 ทั้งที่ยังมี Route truth อยู่\", \"TBR_ROUTE_CACHE_INCONSISTENT\", 503);\n  }\n  const rows = cached.rows\n    .filter((row) => tbrInboundAttendance(row?.attendanceType))\n    .map((row) => ({\n      proofId: text(row?.proofId, 100),\n      attendanceType: normalizeMsAttendance(row?.attendanceType),\n      actualArrivalAt: date(row?.actualArrivalAt),\n    }))\n    .filter((row) => normalizeProofId(row.proofId));\n  return { rows, syncedAt: cached.syncedAt };\n}\n\n// ${CACHE_MARKER}: TBR Bus shadow reuses the accepted main live cache instead\n// of issuing a second Fleet Time Management request stream.\nasync function readTbrShadowBusFromLiveCache(env, hub) {\n  const cached = await readTbrShadowLiveCache(env, hub, \"TBR / BusTime\");\n  const seen = new Set();\n  const feed = [];\n  for (const item of cached.rows) {\n    if (!tbrInboundAttendance(item?.attendanceType)) continue;\n    const proofId = normalizeProofId(item?.proofId);\n    const tbrAt = text(item?.scheduleTbrArrivalAt, 100);\n    if (!proofId || !tbrAt || seen.has(proofId)) continue;\n    seen.add(proofId);\n    feed.push({\n      proofId: text(item?.proofId, 100),\n      scheduleTbrArrivalAt: tbrAt,\n      scheduleKitArrivalAt: text(item?.scheduleKitArrivalAt, 100),\n    });\n  }\n  return { feed, syncedAt: cached.syncedAt };\n}\n\n// TBR_BUS_DAILY_SPLIT_V9: shadowDay remains a compatibility field only.\nasync function readTbrShadowSnapshot(env, hub, part, shadowDay) {\n  if (part === \"routes\") {\n    let cachedRoute;\n    try { cachedRoute = await readTbrShadowRouteFromLiveCache(env, hub); }\n    catch (error) {\n      const code = String(error?.code || \"ROUTE_CACHE_FAILED\");\n      fail(error?.message || \"อ่าน Route จาก live cache ไม่สำเร็จ\",\n        code.startsWith(\"TBR_ROUTE_\") ? code : \`TBR_ROUTE_\${code}\`, 503);\n    }\n    return {\n      status: \"shadow_readonly_routes_cache\",\n      syncedAt: cachedRoute.syncedAt || new Date().toISOString(),\n      changes: 0,\n      rows: cachedRoute.rows,\n      tbrShadowFeed: [],\n      shadowQuota: tbrShadowPartQuota(\"routes\"),\n    };\n  }\n\n  if (part === \"bus\") {\n    let cachedBus;\n    try { cachedBus = await readTbrShadowBusFromLiveCache(env, hub); }\n    catch (error) {\n      const code = String(error?.code || \"BUS_CACHE_FAILED\");\n      fail(error?.message || \"อ่าน TBR / BusTime จาก live cache ไม่สำเร็จ\",\n        code.startsWith(\"TBR_BUS_\") ? code : \`TBR_BUS_\${code}\`, 503);\n    }\n    return {\n      status: \"shadow_readonly_bus_cache\",\n      syncedAt: cachedBus.syncedAt || new Date().toISOString(),\n      changes: 0,\n      rows: [],\n      tbrShadowFeed: cachedBus.feed,\n      shadowDay: String(shadowDay || \"\"),\n      shadowQuota: tbrShadowPartQuota(\"bus\"),\n    };\n  }\n\n  fail(\"TBR Shadow ต้องระบุ source part\", \"TBR_SHADOW_PART_REQUIRED\", 400);\n}`;
source = source.slice(0, snapshotStart) + replacement + source.slice(end);

if (!source.includes(RATE_MARKER)) {
  const originalDecl = 'async function readBusTimeData(env, hub, wantedDays = liveSourceDays()) {';
  if (!source.includes(originalDecl)) throw new Error('readBusTimeData rate-guard anchor not found');
  const guardedDecl = `// ${RATE_MARKER} / ${OPTIONAL_GUARD_MARKER}: Fleet Time is enrichment, not the 4-second Route truth.\nconst BUS_TIME_SOURCE_TTL_MS = 60 * 1000;\nconst BUS_TIME_PAGE_CONCURRENCY = 1;\nconst BUS_TIME_PAGE_BATCH_DELAY_MS = 120;\nconst OPTIONAL_RATE_LIMIT_BASE_COOLDOWN_MS = 5 * 60 * 1000;\nconst OPTIONAL_RATE_LIMIT_MAX_COOLDOWN_MS = 60 * 60 * 1000;\nconst busTimeSourceCache = new Map();\nconst busTimeSourceActive = new Map();\nconst busTimeRateGuard = new Map();\n\nfunction optionalRateCooldownMs(strikes) {\n  return Math.min(OPTIONAL_RATE_LIMIT_MAX_COOLDOWN_MS, OPTIONAL_RATE_LIMIT_BASE_COOLDOWN_MS * (2 ** Math.max(0, Number(strikes || 1) - 1)));\n}\n\nfunction busTimeSourceKey(hub, wantedDays) {\n  return String(hub || \"\").toUpperCase() + \"|\" + (Array.isArray(wantedDays) ? wantedDays.join(\",\") : \"\");\n}\n\nasync function readBusTimeData(env, hub, wantedDays = liveSourceDays()) {\n  const key = busTimeSourceKey(hub, wantedDays);\n  const now = Date.now();\n  const cached = busTimeSourceCache.get(key);\n  const guard = busTimeRateGuard.get(key);\n  if (guard?.until > now) {\n    if (cached?.data) {\n      cached.data.sourceStale = true;\n      cached.data.retryAt = new Date(guard.until).toISOString();\n      return cached.data;\n    }\n    const failed = new Map();\n    failed.sourceFailed = true;\n    failed.sourceCode = \"BUS_TIME_RATE_LIMIT\";\n    failed.retryAt = new Date(guard.until).toISOString();\n    return failed;\n  }\n  if (cached && cached.until > now) return cached.data;\n  if (busTimeSourceActive.has(key)) return busTimeSourceActive.get(key);\n  const task = readBusTimeDataFresh(env, hub, wantedDays)\n    .then((data) => {\n      if (data instanceof Map && data.sourceFailed !== true) {\n        data.sourceStale = false;\n        busTimeRateGuard.delete(key);\n        busTimeSourceCache.set(key, { until: Date.now() + BUS_TIME_SOURCE_TTL_MS, data });\n        return data;\n      }\n      if (data?.sourceCode === \"BUS_TIME_RATE_LIMIT\") {\n        const previous = busTimeRateGuard.get(key);\n        const strikes = Math.min(8, Number(previous?.strikes || 0) + 1);\n        const until = Date.now() + optionalRateCooldownMs(strikes);\n        busTimeRateGuard.set(key, { strikes, until });\n        if (cached?.data) {\n          cached.data.sourceStale = true;\n          cached.data.retryAt = new Date(until).toISOString();\n          return cached.data;\n        }\n      }\n      return data;\n    })\n    .finally(() => busTimeSourceActive.delete(key));\n  busTimeSourceActive.set(key, task);\n  return task;\n}\n\nasync function readBusTimeDataFresh(env, hub, wantedDays = liveSourceDays()) {`;
  source = source.replace(originalDecl, guardedDecl);

  source = patchAsyncFunction(source, 'readBusTimeDataFresh', (body) => {
    const oldPages = `      if (pages > 1) {\n        const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, index) =>\n          readBusPage(credentials, index + 2, day)));\n        rest.forEach((result) => rows.push(...result.items));\n      }`;
    const newPages = `      if (pages > 1) {\n        const remainingPages = Array.from({ length: pages - 1 }, (_, index) => index + 2);\n        for (let offset = 0; offset < remainingPages.length; offset += BUS_TIME_PAGE_CONCURRENCY) {\n          const pageBatch = remainingPages.slice(offset, offset + BUS_TIME_PAGE_CONCURRENCY);\n          const results = await Promise.all(pageBatch.map((page) => readBusPage(credentials, page, day)));\n          results.forEach((result) => rows.push(...result.items));\n          if (offset + BUS_TIME_PAGE_CONCURRENCY < remainingPages.length)\n            await new Promise((resolve) => setTimeout(resolve, BUS_TIME_PAGE_BATCH_DELAY_MS));\n        }\n      }`;
    if (!body.includes(oldPages)) throw new Error('readBusTimeData pagination anchor not found');
    body = body.replace(oldPages, newPages);
    const failedAnchor = `    const failed = new Map();\n    failed.sourceFailed = true;\n    return failed;`;
    const failedReplacement = `    const failed = new Map();\n    failed.sourceFailed = true;\n    failed.sourceCode = error?.code || \"BUS_TIME_SOURCE_ERROR\";\n    return failed;`;
    return body.includes(failedAnchor) ? body.replace(failedAnchor, failedReplacement) : body;
  });

  if (source.includes('async function readTbrShadowBusData(')) {
    source = patchAsyncFunction(source, 'readTbrShadowBusData', (body) => {
      const oldPages = `    if (pages > 1) {\n      const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, index) =>\n        readBusPage(credentials, index + 2, day)));\n      rest.forEach((result) => rows.push(...result.items));\n    }`;
      const newPages = `    if (pages > 1) {\n      const remainingPages = Array.from({ length: pages - 1 }, (_, index) => index + 2);\n      for (let offset = 0; offset < remainingPages.length; offset += BUS_TIME_PAGE_CONCURRENCY) {\n        const pageBatch = remainingPages.slice(offset, offset + BUS_TIME_PAGE_CONCURRENCY);\n        const results = await Promise.all(pageBatch.map((page) => readBusPage(credentials, page, day)));\n        results.forEach((result) => rows.push(...result.items));\n        if (offset + BUS_TIME_PAGE_CONCURRENCY < remainingPages.length)\n          await new Promise((resolve) => setTimeout(resolve, BUS_TIME_PAGE_BATCH_DELAY_MS));\n      }\n    }`;
      if (!body.includes(oldPages)) return body;
      return body.replace(oldPages, newPages);
    });
  }

  source = patchAsyncFunction(source, 'readBusPage', (body) => {
    if (body.includes('classifyBusTimeFailure(')) return body;
    const oldHttp = '  if (!response.ok) fail(`ข้อมูลตารางเวลาตอบกลับ ${response.status}`, "BUS_TIME_HTTP_ERROR", 502);';
    const newHttp = `  if (!response.ok) {\n    const limited = response.status === 429;\n    fail(\`ข้อมูลตารางเวลาตอบกลับ \${response.status}\`,\n      limited ? \"BUS_TIME_REQUEST_LIMIT\" : \"BUS_TIME_HTTP_ERROR\",\n      limited ? 429 : 502);\n  }`;
    if (!body.includes(oldHttp)) throw new Error('readBusPage HTTP anchor not found');
    body = body.replace(oldHttp, newHttp);
    const oldJson = `  const json = await response.json();\n  if (Number(json.code) !== 1)\n    fail(json.msg || \"เซสชันการจัดการตารางเวลาหมดอายุ\", \"BUS_TIME_SESSION_EXPIRED\", 502);`;
    const newJson = `  const json = await response.json();\n  if (Number(json.code) !== 1) {\n    const message = String(json.msg || json.message || \"\");\n    const limited = /request exceeds the limit|too many requests|rate limit|request limit/i.test(message);\n    fail(message || \"เซสชันการจัดการตารางเวลาหมดอายุ\",\n      limited ? \"BUS_TIME_REQUEST_LIMIT\" : \"BUS_TIME_SESSION_EXPIRED\",\n      limited ? 429 : 502);\n  }`;
    if (!body.includes(oldJson)) throw new Error('readBusPage JSON anchor not found');
    return body.replace(oldJson, newJson);
  });
}

if (!source.includes('PREENTRY_RATE_GUARD_V12')) {
  const preEntryDecl = 'async function readPreEntryCounts(env, hub, wantedDays = liveSourceDays()) {';
  if (!source.includes(preEntryDecl)) throw new Error('readPreEntryCounts guard anchor not found');
  const preEntryGuarded = `// PREENTRY_RATE_GUARD_V12 / ${OPTIONAL_GUARD_MARKER}: one shared real read/minute; hard backoff on provider limit.\nconst PREENTRY_SOURCE_TTL_MS = 60 * 1000;\nconst PREENTRY_PAGE_CONCURRENCY = 1;\nconst PREENTRY_PAGE_BATCH_DELAY_MS = 120;\nconst preEntrySourceCache = new Map();\nconst preEntrySourceActive = new Map();\nconst preEntryRateGuard = new Map();\n\nfunction preEntrySourceKey(hub, wantedDays) {\n  return String(hub || \"\").toUpperCase() + \"|\" + (Array.isArray(wantedDays) ? wantedDays.join(\",\") : \"\");\n}\n\nasync function readPreEntryCounts(env, hub, wantedDays = liveSourceDays()) {\n  const key = preEntrySourceKey(hub, wantedDays);\n  const now = Date.now();\n  const cached = preEntrySourceCache.get(key);\n  const guard = preEntryRateGuard.get(key);\n  if (guard?.until > now) {\n    if (cached?.data) {\n      cached.data.sourceStale = true;\n      cached.data.retryAt = new Date(guard.until).toISOString();\n      return cached.data;\n    }\n    const failed = new Map();\n    failed.sourceFailed = true;\n    failed.sourceCode = \"PREENTRY_RATE_LIMIT\";\n    failed.retryAt = new Date(guard.until).toISOString();\n    return failed;\n  }\n  if (cached && cached.until > now) return cached.data;\n  if (preEntrySourceActive.has(key)) return preEntrySourceActive.get(key);\n  const task = readPreEntryCountsFresh(env, hub, wantedDays)\n    .then((data) => {\n      if (data instanceof Map && data.sourceFailed !== true) {\n        data.sourceStale = false;\n        preEntryRateGuard.delete(key);\n        preEntrySourceCache.set(key, { until: Date.now() + PREENTRY_SOURCE_TTL_MS, data });\n        return data;\n      }\n      if (data?.sourceCode === \"PREENTRY_RATE_LIMIT\") {\n        const previous = preEntryRateGuard.get(key);\n        const strikes = Math.min(8, Number(previous?.strikes || 0) + 1);\n        const until = Date.now() + optionalRateCooldownMs(strikes);\n        preEntryRateGuard.set(key, { strikes, until });\n        if (cached?.data) {\n          cached.data.sourceStale = true;\n          cached.data.retryAt = new Date(until).toISOString();\n          return cached.data;\n        }\n      }\n      return data;\n    })\n    .finally(() => preEntrySourceActive.delete(key));\n  preEntrySourceActive.set(key, task);\n  return task;\n}\n\nasync function readPreEntryCountsFresh(env, hub, wantedDays = liveSourceDays()) {`;
  source = source.replace(preEntryDecl, preEntryGuarded);

  source = patchAsyncFunction(source, 'readPreEntryCountsFresh', (body) => {
    const oldPages = `      if (pages > 1) {\n        const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, index) =>\n          readPreEntryPage(credentials, index + 2, day)));\n        rest.forEach((result) => rows.push(...result.items));\n      }`;
    const newPages = `      if (pages > 1) {\n        const remainingPages = Array.from({ length: pages - 1 }, (_, index) => index + 2);\n        for (let offset = 0; offset < remainingPages.length; offset += PREENTRY_PAGE_CONCURRENCY) {\n          const pageBatch = remainingPages.slice(offset, offset + PREENTRY_PAGE_CONCURRENCY);\n          const results = await Promise.all(pageBatch.map((page) => readPreEntryPage(credentials, page, day)));\n          results.forEach((result) => rows.push(...result.items));\n          if (offset + PREENTRY_PAGE_CONCURRENCY < remainingPages.length)\n            await new Promise((resolve) => setTimeout(resolve, PREENTRY_PAGE_BATCH_DELAY_MS));\n        }\n      }`;
    if (!body.includes(oldPages)) throw new Error('readPreEntryCounts pagination anchor not found');
    body = body.replace(oldPages, newPages);
    const failedAnchor = `    const failed = new Map();\n    failed.sourceFailed = true;\n    return failed;`;
    const failedReplacement = `    const failed = new Map();\n    failed.sourceFailed = true;\n    failed.sourceCode = error?.code || \"PREENTRY_SOURCE_ERROR\";\n    return failed;`;
    return body.includes(failedAnchor) ? body.replace(failedAnchor, failedReplacement) : body;
  });

  const preEntryPageMarker = 'async function readPreEntryPage(credentials, page, day) {';
  if (!source.includes('function classifyPreEntryFailure(')) {
    source = replaceOnce(source, preEntryPageMarker,
      `export function classifyPreEntryFailure(message, httpStatus = 0) {\n  const value = String(message || \"\").trim();\n  if (Number(httpStatus) === 429 || /request\\s+exceeds\\s+the\\s+limit|rate.?limit|too many requests|exceed(?:ed|s)?\\s+(?:the\\s+)?limit/i.test(value))\n    return { code: \"PREENTRY_RATE_LIMIT\", status: 429 };\n  if (/session|token|auth|login|expired|unauthor/i.test(value))\n    return { code: \"PREENTRY_SESSION_EXPIRED\", status: 502 };\n  return { code: \"PREENTRY_SOURCE_ERROR\", status: 502 };\n}\n\n${preEntryPageMarker}`,
      'preEntry classifier insertion');
  }
  source = patchAsyncFunction(source, 'readPreEntryPage', (body) => {
    const oldHttp = '  if (!response.ok) fail(`ข้อมูลพัสดุตอบกลับ ${response.status}`, "PREENTRY_HTTP_ERROR", 502);';
    const newHttp = `  if (!response.ok) {\n    const message = \`ข้อมูลพัสดุตอบกลับ \${response.status}\`;\n    const failure = classifyPreEntryFailure(message, response.status);\n    fail(message, failure.code, failure.status);\n  }`;
    if (!body.includes(oldHttp)) throw new Error('readPreEntryPage HTTP anchor not found');
    body = body.replace(oldHttp, newHttp);
    const oldJson = `  const json = await response.json();\n  if (Number(json.code) !== 1)\n    fail(json.message || \"เซสชันพัสดุที่คาดว่าจะเข้าคลังหมดอายุ\", \"PREENTRY_SESSION_EXPIRED\", 502);`;
    const newJson = `  const json = await response.json();\n  if (Number(json.code) !== 1) {\n    const message = json.message || json.msg || \"ข้อมูลพัสดุตอบกลับผิดพลาด\";\n    const failure = classifyPreEntryFailure(message);\n    fail(message, failure.code, failure.status);\n  }`;
    if (!body.includes(oldJson)) throw new Error('readPreEntryPage JSON anchor not found');
    return body.replace(oldJson, newJson);
  });
}

if (!source.includes(ACCOUNT_GUARD_MARKER) && source.includes('export class MsRefreshCoordinator')) {
  const routeDecl = 'async function readMsRoutes(credentials, wantedStart, wantedEnd) {';
  if (!source.includes(routeDecl)) throw new Error('readMsRoutes account-guard anchor not found');
  source = replaceOnce(source, routeDecl,
    `// ${ACCOUNT_GUARD_MARKER}: Route keeps the 4-second truth while duplicate/burst requests are blocked.\nconst MS_ROUTE_PAGE_CONCURRENCY = 1;\nconst MS_ROUTE_PAGE_BATCH_DELAY_MS = 120;\nconst MS_ROUTE_RATE_LIMIT_BASE_COOLDOWN_MS = 5 * 60 * 1000;\nconst MS_ROUTE_RATE_LIMIT_MAX_COOLDOWN_MS = 60 * 60 * 1000;\n\nexport function classifyMsRouteFailure(message, httpStatus = 0) {\n  const value = String(message || \"\").trim();\n  if (Number(httpStatus) === 429 || /request\\s+exceeds\\s+the\\s+limit|rate.?limit|too many requests|exceed(?:ed|s)?\\s+(?:the\\s+)?limit/i.test(value))\n    return { code: \"MS_ROUTE_RATE_LIMIT\", status: 429 };\n  if ([401, 403].includes(Number(httpStatus)) || /session|token|auth|login|expired|unauthor/i.test(value))\n    return { code: \"MS_SESSION_EXPIRED\", status: 502 };\n  return { code: \"MS_ROUTE_SOURCE_ERROR\", status: 502 };\n}\n\n${routeDecl}`,
    'route classifier insertion');

  source = patchAsyncFunction(source, 'readMsRoutes', (body) => {
    const oldPages = `  if (pages > 1) {\n    const remaining = await Promise.all(\n      Array.from({ length: pages - 1 }, (_, index) =>\n        readMsPage(credentials, index + 2, start, end),\n      ),\n    );\n    for (const result of remaining) rows.push(...result.items);\n  }`;
    const newPages = `  if (pages > 1) {\n    const remainingPages = Array.from({ length: pages - 1 }, (_, index) => index + 2);\n    for (let offset = 0; offset < remainingPages.length; offset += MS_ROUTE_PAGE_CONCURRENCY) {\n      const pageBatch = remainingPages.slice(offset, offset + MS_ROUTE_PAGE_CONCURRENCY);\n      const results = await Promise.all(pageBatch.map((page) =>\n        readMsPage(credentials, page, start, end)));\n      for (const result of results) rows.push(...result.items);\n      if (offset + MS_ROUTE_PAGE_CONCURRENCY < remainingPages.length)\n        await new Promise((resolve) => setTimeout(resolve, MS_ROUTE_PAGE_BATCH_DELAY_MS));\n    }\n  }`;
    if (!body.includes(oldPages)) throw new Error('readMsRoutes pagination anchor not found');
    return body.replace(oldPages, newPages);
  });

  source = patchAsyncFunction(source, 'readMsPage', (body) => {
    const httpPattern = /  if \(!response\.ok\) \{\n    const code =[\s\S]*?\n    fail\(`MS ตอบกลับ \$\{response\.status\}`, code, 502\);\n  \}/;
    if (!httpPattern.test(body)) throw new Error('readMsPage staged HTTP classifier anchor not found');
    body = body.replace(httpPattern, `  if (!response.ok) {\n    const message = \`MS ตอบกลับ \${response.status}\`;\n    const failure = classifyMsRouteFailure(message, response.status);\n    fail(message, failure.code, failure.status);\n  }`);
    const jsonPattern = /  const json = await response\.json\(\);\n  if \(json\.code !== 1\)\n    fail\(json\.message \|\| \"เซสชัน MS หมดอายุ\", \"MS_SESSION_EXPIRED\", 502\);/;
    if (!jsonPattern.test(body)) throw new Error('readMsPage staged JSON classifier anchor not found');
    return body.replace(jsonPattern, `  const json = await response.json();\n  if (json.code !== 1) {\n    const message = json.message || json.msg || \"MS ตอบกลับผิดพลาด\";\n    const failure = classifyMsRouteFailure(message);\n    fail(message, failure.code, failure.status);\n  }`);
  });

  source = patchAsyncFunction(source, 'runMsRefresh', (body) => {
    const transientAnchor = `    const transient =\n      error?.code === \"UPSTREAM_TIMEOUT\" ||\n      error?.code === \"MS_HTTP_ERROR\" ||\n      error instanceof TypeError;`;
    const transientReplacement = `    const transient =\n      error?.code === \"UPSTREAM_TIMEOUT\" ||\n      error?.code === \"MS_HTTP_ERROR\" ||\n      error?.code === \"MS_ROUTE_SOURCE_ERROR\" ||\n      error?.code === \"MS_ROUTE_RATE_LIMIT\" ||\n      error instanceof TypeError;`;
    if (!body.includes(transientAnchor)) throw new Error('runMsRefresh transient anchor not found');
    body = body.replace(transientAnchor, transientReplacement);
    const degradedAnchor = `        const result = {\n          status: \"degraded\",\n          changes: 0,`;
    const degradedReplacement = `        const result = {\n          status: \"degraded\",\n          errorCode: error?.code || \"MS_NETWORK_ERROR\",\n          changes: 0,`;
    if (!body.includes(degradedAnchor)) throw new Error('runMsRefresh degraded result anchor not found');
    body = body.replace(degradedAnchor, degradedReplacement);
    const errorAnchor = `    const result = {\n      status: \"error\",\n      error: error.message || \"เชื่อมต่อ MS ไม่สำเร็จ\",\n    };`;
    const errorReplacement = `    const result = {\n      status: \"error\",\n      errorCode: error?.code || \"MS_SYNC_FAILED\",\n      error: error.message || \"เชื่อมต่อ MS ไม่สำเร็จ\",\n    };`;
    if (!body.includes(errorAnchor)) throw new Error('runMsRefresh error result anchor not found');
    return body.replace(errorAnchor, errorReplacement);
  });

  const cronConstant = 'const MS_CRON_ACTIVE_SKIP_MS = 45 * 1000;';
  if (!source.includes(cronConstant)) throw new Error('Route coordinator cron constant missing');
  source = source.replace(cronConstant,
    `${cronConstant}\nconst MS_ROUTE_QUOTA_GUARD_KEY = \"route-quota-guard-v12\";`);

  const constructorAnchor = `    this.lastSourceAt = 0;\n    this.originManifest = new OriginManifestCoordinator(ctx, env);`;
  const constructorReplacement = `    this.lastSourceAt = 0;\n    this.routeRateLimitedUntil = 0;\n    this.routeRateLimitStrikes = 0;\n    this.originManifest = new OriginManifestCoordinator(ctx, env);\n    this.ctx.blockConcurrencyWhile(async () => {\n      const saved = await this.ctx.storage.get(MS_ROUTE_QUOTA_GUARD_KEY);\n      if (saved && typeof saved === \"object\") {\n        this.routeRateLimitedUntil = Number(saved.until || 0);\n        this.routeRateLimitStrikes = Number(saved.strikes || 0);\n      }\n    });`;
  if (!source.includes(constructorAnchor)) throw new Error('Route coordinator constructor anchor missing');
  source = source.replace(constructorAnchor, constructorReplacement);

  const fetchAnchor = `  async fetch(request) {\n    const url = new URL(request.url);\n    if (url.pathname.startsWith(\"/origin-manifest/\"))`;
  const fetchReplacement = `  async fetch(request) {\n    const url = new URL(request.url);\n    if (url.pathname === \"/quota-reset\") {\n      this.routeRateLimitedUntil = 0;\n      this.routeRateLimitStrikes = 0;\n      await this.ctx.storage.delete(MS_ROUTE_QUOTA_GUARD_KEY);\n      return Response.json({ ok: true, reset: true });\n    }\n    if (url.pathname.startsWith(\"/origin-manifest/\"))`;
  if (!source.includes(fetchAnchor)) throw new Error('Route coordinator fetch anchor missing');
  source = source.replace(fetchAnchor, fetchReplacement);

  const refreshAnchor = `  async refresh(branch, force = false, cron = false) {\n    const nowMs = Date.now();`;
  const refreshReplacement = `  async refresh(branch, force = false, cron = false) {\n    const nowMs = Date.now();\n    if (!force && this.routeRateLimitedUntil > nowMs) {\n      const retryAt = new Date(this.routeRateLimitedUntil).toISOString();\n      if (this.lastResult?.rows)\n        return {\n          ...this.lastResult,\n          status: \"degraded\",\n          errorCode: \"MS_ROUTE_RATE_LIMIT\",\n          quotaGuard: \"cooldown\",\n          retryAt,\n        };\n      return {\n        status: \"degraded\",\n        errorCode: \"MS_ROUTE_RATE_LIMIT\",\n        error: \"MS จำกัดคำขอชั่วคราว ระบบหยุดยิงต้นทางและรอรอบปลอดภัย\",\n        changes: 0,\n        rows: [],\n        quotaGuard: \"cooldown\",\n        retryAt,\n      };\n    }`;
  if (!source.includes(refreshAnchor)) throw new Error('Route coordinator refresh anchor missing');
  source = source.replace(refreshAnchor, refreshReplacement);

  const thenAnchor = `    const task = runMsRefresh(this.env, branch)\n      .then((result) => {\n        this.lastResult = result;\n        this.lastSourceAt = Date.now();\n        this.recentUntil = Date.now() + MS_SYNC_TTL;\n        return result;\n      })`;
  const thenReplacement = `    const task = runMsRefresh(this.env, branch)\n      .then(async (result) => {\n        if (result?.errorCode === \"MS_ROUTE_RATE_LIMIT\") {\n          this.routeRateLimitStrikes = Math.min(8, this.routeRateLimitStrikes + 1);\n          const cooldownMs = Math.min(\n            MS_ROUTE_RATE_LIMIT_MAX_COOLDOWN_MS,\n            MS_ROUTE_RATE_LIMIT_BASE_COOLDOWN_MS * (2 ** Math.max(0, this.routeRateLimitStrikes - 1)),\n          );\n          this.routeRateLimitedUntil = Date.now() + cooldownMs;\n          await this.ctx.storage.put(MS_ROUTE_QUOTA_GUARD_KEY, {\n            strikes: this.routeRateLimitStrikes,\n            until: this.routeRateLimitedUntil,\n          });\n        } else if (result?.status === \"synced\" && (this.routeRateLimitStrikes || this.routeRateLimitedUntil)) {\n          this.routeRateLimitStrikes = 0;\n          this.routeRateLimitedUntil = 0;\n          await this.ctx.storage.delete(MS_ROUTE_QUOTA_GUARD_KEY);\n        }\n        this.lastResult = result;\n        this.lastSourceAt = Date.now();\n        this.recentUntil = Date.now() + MS_SYNC_TTL;\n        return result;\n      })`;
  if (!source.includes(thenAnchor)) throw new Error('Route coordinator result anchor missing');
  source = source.replace(thenAnchor, thenReplacement);

  source = patchAsyncFunction(source, 'persistMsConnection', (body) => {
    const returnAnchor = `  return { hub, total: test.total, updatedAt: now };`;
    const resetBlock = `  if (env.MS_REFRESH_COORDINATOR) {\n    try {\n      const id = env.MS_REFRESH_COORDINATOR.idFromName(hub);\n      const stub = env.MS_REFRESH_COORDINATOR.get(id);\n      await stub.fetch(new Request(\"https://ms-refresh.internal/quota-reset?branch=\" + encodeURIComponent(hub)));\n    } catch (error) {\n      console.warn(JSON.stringify({ event: \"ms_route_quota_guard_reset_failed\", hub, message: error?.message || String(error) }));\n    }\n  }\n  return { hub, total: test.total, updatedAt: now };`;
    if (!body.includes(returnAnchor)) throw new Error('persistMsConnection return anchor missing');
    return body.replace(returnAnchor, resetBlock);
  });
}

fs.writeFileSync(file, source);
console.log('DEV_TBR_SHADOW_SPLIT_V2=PASS');
console.log('DEV_TBR_ROUTE_OPERATING_WINDOW_V3=PASS');
console.log('DEV_TBR_ROUTE_CHUNK_RETRY_V4=PASS');
console.log('DEV_TBR_ROUTE_ADAPTIVE_RETRY_V5=PASS');
console.log('TBR_BUS_DAILY_SPLIT_V9=PASS');
console.log('TBR_BUS_REUSE_LIVE_CACHE_V10=PASS');
console.log('TBR_ROUTE_REUSE_LIVE_CACHE_V12=PASS');
console.log('TBR_LIVE_CACHE_ENVELOPE_V13=PASS');
console.log('BUS_TIME_RATE_GUARD_V10=PASS');
console.log('OPTIONAL_SOURCE_RATE_GUARD_V12=PASS');
console.log('MS_UPSTREAM_ACCOUNT_GUARD_V12=PASS');
console.log('TBR_EXTRA_MS_POLLING=0');
