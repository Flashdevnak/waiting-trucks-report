import fs from 'node:fs';

const file = process.argv[2] || 'src/index.js';
let source = fs.readFileSync(file, 'utf8');
const MARKER = 'TBR_SHADOW_SPLIT_V2';
if (source.includes(MARKER)) {
  console.log('DEV_TBR_SHADOW_SPLIT_V2=ALREADY_APPLIED');
  process.exit(0);
}

const oldConnector = `  const shadowOnly = body.shadowOnly === true;\n  const result = shadowOnly\n    ? await readTbrShadowSnapshot(env, hub)\n    : await refreshMsIfStale(env, { username: \"MS_CRON\", role: \"admin\", branches: [\"*\"] }, hub);`;
const newConnector = `  const shadowOnly = body.shadowOnly === true;\n  const shadowPart = text(body.shadowPart, 20).toLowerCase();\n  const result = shadowOnly\n    ? await readTbrShadowSnapshot(env, hub, shadowPart)\n    : await refreshMsIfStale(env, { username: \"MS_CRON\", role: \"admin\", branches: [\"*\"] }, hub);`;
if (!source.includes(oldConnector)) throw new Error('split connector anchor not found');
source = source.replace(oldConnector, newConnector);

const start = source.indexOf('async function readTbrShadowSnapshot(env, hub) {');
const end = source.indexOf('\n\nasync function preEntryCredentials', start);
if (start < 0 || end <= start) throw new Error('readTbrShadowSnapshot function not found');

const replacement = `// ${MARKER}: split Route and BusTime into separate Worker invocations so each\n// stays comfortably below Cloudflare outbound subrequest limits as daily data grows.\nfunction tbrShadowRouteRange(now = Date.now()) {\n  return {\n    start: now - 13 * 60 * 60 * 1000,\n    end: now + 2 * 60 * 60 * 1000,\n  };\n}\n\nfunction tbrShadowBusDays(now = new Date()) {\n  const hour = Number(new Intl.DateTimeFormat(\"en-US\", {\n    timeZone: \"Asia/Bangkok\",\n    hour: \"2-digit\",\n    hourCycle: \"h23\",\n  }).format(now));\n  return hour < 12 ? [thaiDayOffset(-1), thaiDayOffset(0)] : [thaiDayOffset(0)];\n}\n\nfunction tbrShadowPartQuota(part) {\n  return {\n    mode: \"SHADOW_READONLY_SPLIT_V2\",\n    part,\n    tursoPointReadsThisCall: 2,\n    tursoPointReadsPerCron: 4,\n    tursoWritesPerCron: 0,\n    routeTableReads: 0,\n    routeTableWrites: 0,\n    historyReads: 0,\n    historyWrites: 0,\n    liveCacheReads: 0,\n    liveCacheWrites: 0,\n    preEntryCalls: 0,\n  };\n}\n\nasync function readTbrShadowSnapshot(env, hub, part) {\n  if (part === \"routes\") {\n    let rawRoutes;\n    try {\n      const credentials = await msCredentials(env, hub);\n      if (!credentials)\n        fail(\`HUB \${hub} ยังไม่ได้อัปเดตเซสชัน MS\`, \"TBR_ROUTE_MS_NOT_CONFIGURED\", 503);\n      const range = tbrShadowRouteRange();\n      rawRoutes = await readMsRoutes(credentials, range.start, range.end);\n    } catch (error) {\n      const code = String(error?.code || \"ROUTE_SOURCE_FAILED\");\n      fail(error?.message || \"อ่าน Route สำหรับ TBR Shadow ไม่สำเร็จ\",\n        code.startsWith(\"TBR_ROUTE_\") ? code : \`TBR_ROUTE_\${code}\`, 503);\n    }\n    const rows = rawRoutes\n      .map(mapMsRow)\n      .filter((row) => tbrInboundAttendance(row.attendanceType))\n      .map((row) => ({\n        proofId: text(row.proofId, 100),\n        attendanceType: normalizeMsAttendance(row.attendanceType),\n        actualArrivalAt: date(row.actualArrivalAt),\n      }))\n      .filter((row) => normalizeProofId(row.proofId));\n    return {\n      status: \"shadow_readonly_routes\",\n      syncedAt: new Date().toISOString(),\n      changes: 0,\n      rows,\n      tbrShadowFeed: [],\n      shadowQuota: tbrShadowPartQuota(\"routes\"),\n    };\n  }\n\n  if (part === \"bus\") {\n    let busData;\n    try {\n      busData = await readTbrShadowBusData(env, hub, tbrShadowBusDays());\n    } catch (error) {\n      const code = String(error?.code || \"BUS_SOURCE_FAILED\");\n      fail(error?.message || \"อ่าน TBR / BusTime ไม่สำเร็จ\",\n        code.startsWith(\"TBR_BUS_\") ? code : \`TBR_BUS_\${code}\`, 503);\n    }\n    return {\n      status: \"shadow_readonly_bus\",\n      syncedAt: new Date().toISOString(),\n      changes: 0,\n      rows: [],\n      tbrShadowFeed: msTbrShadowFeed(busData),\n      shadowQuota: tbrShadowPartQuota(\"bus\"),\n    };\n  }\n\n  fail(\"TBR Shadow ต้องระบุ source part\", \"TBR_SHADOW_PART_REQUIRED\", 400);\n}`;
source = source.slice(0, start) + replacement + source.slice(end);

fs.writeFileSync(file, source);
console.log('DEV_TBR_SHADOW_SPLIT_V2=PASS');
