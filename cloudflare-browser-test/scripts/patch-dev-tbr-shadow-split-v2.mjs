import fs from 'node:fs';

const file = process.argv[2] || 'src/index.js';
let source = fs.readFileSync(file, 'utf8');
const MARKER = 'TBR_SHADOW_SPLIT_V2';
const RATE_MARKER = 'BUS_TIME_RATE_GUARD_V10';
const CACHE_MARKER = 'TBR_BUS_REUSE_LIVE_CACHE_V10';
if (source.includes(MARKER) && source.includes(RATE_MARKER) && source.includes(CACHE_MARKER)) {
  console.log('DEV_TBR_SHADOW_SPLIT_V2=ALREADY_APPLIED');
  console.log('DEV_BUS_TIME_RATE_GUARD_V10=ALREADY_APPLIED');
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

const replacement = `// ${MARKER}: split Route and BusTime into separate Worker invocations so each\n// stays comfortably below Cloudflare outbound subrequest limits as daily data grows.\n// TBR_ROUTE_OPERATING_WINDOW_V3: keep yesterday + today coverage.\n// TBR_ROUTE_CHUNK_RETRY_V4: compatibility checkpoint retained for existing deploy gates.\n// TBR_ROUTE_ADAPTIVE_RETRY_V5: normal mode stays one request per Bangkok day.\n// Only a failed range is retried and recursively split to 12h/6h windows, so\n// transient or oversized Route responses do not blank the whole Shadow source.\nfunction tbrShadowRouteRanges(now = Date.now()) {\n  const nowThai = now + 7 * 60 * 60 * 1000;\n  const todayStartBangkok = Math.floor(nowThai / 86400000) * 86400000 - 7 * 60 * 60 * 1000;\n  return [\n    { label: \"yesterday\", start: todayStartBangkok - 86400000, end: todayStartBangkok - 1000 },\n    { label: \"today\", start: todayStartBangkok, end: todayStartBangkok + 86400000 - 1000 },\n  ];\n}\n\nasync function readTbrRouteRangeAttempt(credentials, range) {\n  let lastError;\n  for (let attempt = 1; attempt <= 2; attempt++) {\n    try { return await readMsRoutes(credentials, range.start, range.end); }\n    catch (error) {\n      lastError = error;\n      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 350));\n    }\n  }\n  throw lastError || new Error(\"Route \" + range.label + \" failed\");\n}\n\nasync function readTbrRouteRangeAdaptive(credentials, range, depth = 0) {\n  try { return await readTbrRouteRangeAttempt(credentials, range); }\n  catch (error) {\n    const span = Number(range.end) - Number(range.start) + 1;\n    if (depth >= 2 || span <= 6 * 60 * 60 * 1000) {\n      error.message = \"[\" + range.label + \" depth=\" + depth + \"] \" + (error.message || \"Route source failed\");\n      throw error;\n    }\n    const middle = Number(range.start) + Math.floor(span / 2);\n    const left = { label: range.label + \"-A\", start: Number(range.start), end: middle - 1 };\n    const right = { label: range.label + \"-B\", start: middle, end: Number(range.end) };\n    const [leftRows, rightRows] = await Promise.all([\n      readTbrRouteRangeAdaptive(credentials, left, depth + 1),\n      readTbrRouteRangeAdaptive(credentials, right, depth + 1),\n    ]);\n    return [...leftRows, ...rightRows];\n  }\n}\n\nasync function readTbrRouteRangeWithRetry(credentials, range) {\n  return readTbrRouteRangeAdaptive(credentials, range);\n}\n\nfunction tbrShadowBusDays(now = new Date()) {\n  const hour = Number(new Intl.DateTimeFormat(\"en-US\", {\n    timeZone: \"Asia/Bangkok\",\n    hour: \"2-digit\",\n    hourCycle: \"h23\",\n  }).format(now));\n  return hour < 12 ? [thaiDayOffset(-1), thaiDayOffset(0)] : [thaiDayOffset(0)];\n}\n\nfunction tbrShadowPartQuota(part) {\n  return {\n    mode: \"SHADOW_READONLY_SPLIT_V2\",\n    part,\n    tursoPointReadsThisCall: 2,\n    tursoPointReadsPerCron: 4,\n    tursoWritesPerCron: 0,\n    routeTableReads: 0,\n    routeTableWrites: 0,\n    historyReads: 0,\n    historyWrites: 0,\n    liveCacheReads: part === \"bus\" ? 1 : 0,\n    liveCacheWrites: 0,\n    preEntryCalls: 0,\n  };\n}\n\n// ${CACHE_MARKER}: TBR Bus shadow reuses the accepted main live cache instead\n// of issuing a second Fleet Time Management request stream. This keeps the\n// shadow path read-only while preserving the existing 1-minute Browser cron.\nasync function readTbrShadowBusFromLiveCache(env, hub) {\n  const cached = await env.DB.prepare(\n    \"SELECT rows_json,synced_at FROM ms_live_cache WHERE hub=?\",\n  ).bind(hub).first();\n  if (!cached)\n    fail(\"ยังไม่มี live cache สำหรับ TBR / BusTime\", \"TBR_BUS_CACHE_EMPTY\", 503);\n  let rows;\n  try { rows = JSON.parse(cached.rows_json || \"[]\"); }\n  catch { fail(\"live cache สำหรับ TBR / BusTime อ่านไม่ได้\", \"TBR_BUS_CACHE_INVALID\", 503); }\n  if (!Array.isArray(rows))\n    fail(\"live cache สำหรับ TBR / BusTime ไม่ถูกต้อง\", \"TBR_BUS_CACHE_INVALID\", 503);\n  const seen = new Set();\n  const feed = [];\n  for (const item of rows) {\n    if (!tbrInboundAttendance(item?.attendanceType)) continue;\n    const proofId = normalizeProofId(item?.proofId);\n    const tbrAt = text(item?.scheduleTbrArrivalAt, 100);\n    if (!proofId || !tbrAt || seen.has(proofId)) continue;\n    seen.add(proofId);\n    feed.push({\n      proofId: text(item?.proofId, 100),\n      scheduleTbrArrivalAt: tbrAt,\n      scheduleKitArrivalAt: text(item?.scheduleKitArrivalAt, 100),\n    });\n  }\n  return { feed, syncedAt: text(cached.synced_at, 100) };\n}\n\n// TBR_BUS_DAILY_SPLIT_V9: Browser may still request one Bangkok day per DEV\n// invocation, but Bus data now comes from the shared main live cache. shadowDay\n// remains part of the compatibility contract and no longer creates MS reads.\nasync function readTbrShadowSnapshot(env, hub, part, shadowDay) {\n  if (part === \"routes\") {\n    let rawRoutes;\n    try {\n      const credentials = await msCredentials(env, hub);\n      if (!credentials)\n        fail(\`HUB \${hub} ยังไม่ได้อัปเดตเซสชัน MS\`, \"TBR_ROUTE_MS_NOT_CONFIGURED\", 503);\n      rawRoutes = [];\n      for (const range of tbrShadowRouteRanges()) {\n        const chunk = await readTbrRouteRangeWithRetry(credentials, range);\n        rawRoutes.push(...chunk);\n      }\n    } catch (error) {\n      const code = String(error?.code || \"ROUTE_SOURCE_FAILED\");\n      fail(error?.message || \"อ่าน Route สำหรับ TBR Shadow ไม่สำเร็จ\",\n        code.startsWith(\"TBR_ROUTE_\") ? code : \`TBR_ROUTE_\${code}\`, 503);\n    }\n    const rows = rawRoutes\n      .map(mapMsRow)\n      .filter((row) => tbrInboundAttendance(row.attendanceType))\n      .map((row) => ({\n        proofId: text(row.proofId, 100),\n        attendanceType: normalizeMsAttendance(row.attendanceType),\n        actualArrivalAt: date(row.actualArrivalAt),\n      }))\n      .filter((row) => normalizeProofId(row.proofId));\n    return {\n      status: \"shadow_readonly_routes\",\n      syncedAt: new Date().toISOString(),\n      changes: 0,\n      rows,\n      tbrShadowFeed: [],\n      shadowQuota: tbrShadowPartQuota(\"routes\"),\n    };\n  }\n\n  if (part === \"bus\") {\n    let cachedBus;\n    try { cachedBus = await readTbrShadowBusFromLiveCache(env, hub); }\n    catch (error) {\n      const code = String(error?.code || \"BUS_CACHE_FAILED\");\n      fail(error?.message || \"อ่าน TBR / BusTime จาก live cache ไม่สำเร็จ\",\n        code.startsWith(\"TBR_BUS_\") ? code : \`TBR_BUS_\${code}\`, 503);\n    }\n    return {\n      status: \"shadow_readonly_bus_cache\",\n      syncedAt: cachedBus.syncedAt || new Date().toISOString(),\n      changes: 0,\n      rows: [],\n      tbrShadowFeed: cachedBus.feed,\n      shadowDay: String(shadowDay || \"\"),\n      shadowQuota: tbrShadowPartQuota(\"bus\"),\n    };\n  }\n\n  fail(\"TBR Shadow ต้องระบุ source part\", \"TBR_SHADOW_PART_REQUIRED\", 400);\n}`;
source = source.slice(0, snapshotStart) + replacement + source.slice(end);

if (!source.includes(RATE_MARKER)) {
  const originalDecl = 'async function readBusTimeData(env, hub, wantedDays = liveSourceDays()) {';
  if (!source.includes(originalDecl)) throw new Error('readBusTimeData rate-guard anchor not found');
  const guardedDecl = `// ${RATE_MARKER}: Fleet Time is enrichment, not the 4-second Route truth.\n// Keep Route polling unchanged while coalescing BusTime to at most one source\n// read per HUB/day-set per minute. Failed reads never replace the last success.\nconst BUS_TIME_SOURCE_TTL_MS = 60 * 1000;\nconst BUS_TIME_PAGE_CONCURRENCY = 1;\nconst BUS_TIME_PAGE_BATCH_DELAY_MS = 120;\nconst busTimeSourceCache = new Map();\nconst busTimeSourceActive = new Map();\n\nfunction busTimeSourceKey(hub, wantedDays) {\n  return String(hub || \"\").toUpperCase() + \"|\" + (Array.isArray(wantedDays) ? wantedDays.join(\",\") : \"\");\n}\n\nasync function readBusTimeData(env, hub, wantedDays = liveSourceDays()) {\n  const key = busTimeSourceKey(hub, wantedDays);\n  const now = Date.now();\n  const cached = busTimeSourceCache.get(key);\n  if (cached && cached.until > now) return cached.data;\n  if (busTimeSourceActive.has(key)) return busTimeSourceActive.get(key);\n  const task = readBusTimeDataFresh(env, hub, wantedDays)\n    .then((data) => {\n      if (data instanceof Map && data.sourceFailed !== true)\n        busTimeSourceCache.set(key, { until: Date.now() + BUS_TIME_SOURCE_TTL_MS, data });\n      return data;\n    })\n    .finally(() => busTimeSourceActive.delete(key));\n  busTimeSourceActive.set(key, task);\n  return task;\n}\n\nasync function readBusTimeDataFresh(env, hub, wantedDays = liveSourceDays()) {`;
  source = source.replace(originalDecl, guardedDecl);

  source = patchAsyncFunction(source, 'readBusTimeDataFresh', (body) => {
    const oldPages = `      if (pages > 1) {\n        const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, index) =>\n          readBusPage(credentials, index + 2, day)));\n        rest.forEach((result) => rows.push(...result.items));\n      }`;
    const newPages = `      if (pages > 1) {\n        const remainingPages = Array.from({ length: pages - 1 }, (_, index) => index + 2);\n        for (let offset = 0; offset < remainingPages.length; offset += BUS_TIME_PAGE_CONCURRENCY) {\n          const pageBatch = remainingPages.slice(offset, offset + BUS_TIME_PAGE_CONCURRENCY);\n          const results = await Promise.all(pageBatch.map((page) => readBusPage(credentials, page, day)));\n          results.forEach((result) => rows.push(...result.items));\n          if (offset + BUS_TIME_PAGE_CONCURRENCY < remainingPages.length)\n            await new Promise((resolve) => setTimeout(resolve, BUS_TIME_PAGE_BATCH_DELAY_MS));\n        }\n      }`;
    if (!body.includes(oldPages)) throw new Error('readBusTimeData pagination anchor not found');
    return body.replace(oldPages, newPages);
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
    // Current source owns the shared JSON/HTTP classification. Preserve it
    // instead of replacing it with this older DEV-only duplicate.
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

fs.writeFileSync(file, source);
console.log('DEV_TBR_SHADOW_SPLIT_V2=PASS');
console.log('DEV_TBR_ROUTE_OPERATING_WINDOW_V3=PASS');
console.log('DEV_TBR_ROUTE_CHUNK_RETRY_V4=PASS');
console.log('DEV_TBR_ROUTE_ADAPTIVE_RETRY_V5=PASS');
console.log('TBR_BUS_DAILY_SPLIT_V9=PASS');
console.log('TBR_BUS_REUSE_LIVE_CACHE_V10=PASS');
console.log('BUS_TIME_RATE_GUARD_V10=PASS');
