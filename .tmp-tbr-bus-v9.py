from pathlib import Path

p=Path('cloudflare-browser-test/src/index.js')
s=p.read_text()

old_part = '''async function sendConnectorPart(env, hub, connectorToken, shadowPart) {
  return mainApiFetch(env, {
    action: "connectorSync",
    hub, connectorToken, shadowOnly: true, shadowPart,
  });
}'''
new_part = '''async function sendConnectorPart(env, hub, connectorToken, shadowPart, extraBody = {}) {
  return mainApiFetch(env, {
    action: "connectorSync",
    hub, connectorToken, shadowOnly: true, shadowPart, ...extraBody,
  });
}'''
if old_part not in s:
    raise SystemExit('sendConnectorPart anchor missing')
s=s.replace(old_part,new_part,1)

old_res = '''async function sendConnectorPartResilient(env, hub, connectorToken, part) {
  let attempts = 1;
  let response = await sendConnectorPart(env, hub, connectorToken, part);
  let payload = await connectorPartPayload(response);
  if (["routes", "bus"].includes(part) && [502, 503, 504].includes(response.status)) {
    await wait(450);
    attempts = 2;
    response = await sendConnectorPart(env, hub, connectorToken, part);
    payload = await connectorPartPayload(response);
  }
  return { response, payload, attempts };
}'''
new_res = '''async function sendConnectorPartResilient(env, hub, connectorToken, part, extraBody = {}) {
  let attempts = 1;
  let response = await sendConnectorPart(env, hub, connectorToken, part, extraBody);
  let payload = await connectorPartPayload(response);
  if (["routes", "bus"].includes(part) && [502, 503, 504].includes(response.status)) {
    await wait(450);
    attempts = 2;
    response = await sendConnectorPart(env, hub, connectorToken, part, extraBody);
    payload = await connectorPartPayload(response);
  }
  return { response, payload, attempts };
}'''
if old_res not in s:
    raise SystemExit('resilient anchor missing')
s=s.replace(old_res,new_res,1)

start=s.index('export async function sendConnectorSync(env, hub, connectorToken) {')
end=s.index('\n\nasync function syncConfiguredHubs', start)
replacement = '''// TBR_BUS_DAILY_SPLIT_V9: after midnight the operating window needs yesterday + today.
// Run one Bus day per DEV invocation so each Turso/Worker request stays inside the CPU budget.
// Upstream Bus polling cadence is unchanged; days are processed sequentially to avoid burst load.
function bangkokSourceDay(nowMs, offsetDays = 0) {
  const shifted = Number(nowMs) + 7 * 60 * 60 * 1000 + Number(offsetDays) * 86400000;
  return new Date(shifted).toISOString().slice(0, 10);
}

export function tbrBusSourceDays(nowMs = Date.now()) {
  const bangkokHour = new Date(Number(nowMs) + 7 * 60 * 60 * 1000).getUTCHours();
  return bangkokHour < 12
    ? [bangkokSourceDay(nowMs, -1), bangkokSourceDay(nowMs, 0)]
    : [bangkokSourceDay(nowMs, 0)];
}

function mergeTbrBusFeeds(results) {
  const merged = new Map();
  for (const result of results) {
    const feed = Array.isArray(result?.payload?.data?.tbrShadowFeed)
      ? result.payload.data.tbrShadowFeed : [];
    for (const item of feed) {
      const key = String(item?.proofId || "") || JSON.stringify(item || {});
      merged.set(key, item);
    }
  }
  return [...merged.values()];
}

export async function sendConnectorSync(env, hub, connectorToken, nowMs = Date.now()) {
  const routePromise = sendConnectorPartResilient(env, hub, connectorToken, "routes");
  const busDays = tbrBusSourceDays(nowMs);
  const busResults = [];
  for (const day of busDays) {
    busResults.push(await sendConnectorPartResilient(env, hub, connectorToken, "bus", { shadowDay: day }));
  }
  const routeResult = await routePromise;
  const routeResponse = routeResult.response, routePayload = routeResult.payload;
  let rows = [];
  let routeFallback = null;
  let routeSourceError = null;
  if (routeResponse.ok) {
    rows = Array.isArray(routePayload?.data?.rows) ? routePayload.data.rows : [];
    await refreshTbrRouteCache(env, hub, rows);
  } else {
    routeSourceError = connectorPartError("routes", routeResponse, routePayload);
    routeFallback = await readTbrRouteCache(env, hub);
    if (!routeFallback) return connectorPartFailure("routes", routeResponse, routePayload);
    rows = routeFallback.rows;
  }
  const busFailure = busResults.find((result) => !result.response.ok);
  if (busFailure) return connectorPartFailure("bus", busFailure.response, busFailure.payload);
  const tbrShadowFeed = mergeTbrBusFeeds(busResults);
  const pointReads = 2 * (
    Number(routeResult.attempts || 1) +
    busResults.reduce((sum, result) => sum + Number(result.attempts || 1), 0)
  );
  const currentSteadyStateReads = 2 * (1 + busDays.length);
  return new Response(JSON.stringify({
    ok: true,
    data: {
      status: routeFallback ? "shadow_readonly_split_route_fallback" : "shadow_readonly_split",
      syncedAt: new Date().toISOString(),
      changes: 0, rows, tbrShadowFeed,
      routeFallback: Boolean(routeFallback),
      routeFallbackAt: routeFallback?.lastSuccessAt || "",
      routeFallbackAgeSeconds: routeFallback?.ageSeconds ?? null,
      routeSourceError: routeSourceError ? { code: routeSourceError.code, message: routeSourceError.message } : null,
      shadowQuota: {
        mode: "SHADOW_READONLY_SPLIT_V2_BUS_DAILY_V9",
        normalTursoPointReadsPerCron: 4,
        currentSteadyStateTursoPointReadsPerCron: currentSteadyStateReads,
        earlyWindowTursoPointReadsPerCron: 6,
        busSourceDays: busDays.length,
        tursoPointReadsPerCron: pointReads, tursoWritesPerCron: 0,
        browserKvRouteCacheReadsPerCron: 1, browserKvRouteCacheWritesMaxPerDay: 288,
        routeTableReads: 0, routeTableWrites: 0,
        historyReads: 0, historyWrites: 0,
        liveCacheReads: 0, liveCacheWrites: 0, preEntryCalls: 0,
      },
    },
  }), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
}'''
s=s[:start]+replacement+s[end:]
p.write_text(s)

q=Path('cloudflare-browser-test/scripts/patch-dev-tbr-shadow-split-v2.mjs')
t=q.read_text()
anchor='const shadowPart = text(body.shadowPart, 20).toLowerCase();\\n  const result = shadowOnly\\n    ? await readTbrShadowSnapshot(env, hub, shadowPart)'
repl='const shadowPart = text(body.shadowPart, 20).toLowerCase();\\n  const shadowDay = text(body.shadowDay, 20);\\n  const result = shadowOnly\\n    ? await readTbrShadowSnapshot(env, hub, shadowPart, shadowDay)'
if anchor not in t:
    raise SystemExit('split connector target missing')
t=t.replace(anchor,repl,1)

anchor='async function readTbrShadowSnapshot(env, hub, part) {\\n'
repl='// TBR_BUS_DAILY_SPLIT_V9: one requested Bangkok Bus day per DEV invocation prevents midnight two-day CPU overflow.\\nasync function readTbrShadowSnapshot(env, hub, part, shadowDay) {\\n'
if anchor not in t:
    raise SystemExit('split snapshot header missing')
t=t.replace(anchor,repl,1)

anchor='      busData = await readTbrShadowBusData(env, hub, tbrShadowBusDays());\\n'
repl='      const requestedBusDay = String(shadowDay || "");\\n      const busDays = requestedBusDay && Number.isFinite(Date.parse(requestedBusDay + "T00:00:00+07:00")) ? [requestedBusDay] : tbrShadowBusDays();\\n      busData = await readTbrShadowBusData(env, hub, busDays);\\n'
if anchor not in t:
    raise SystemExit('split bus read target missing')
t=t.replace(anchor,repl,1)

anchor='      status: "shadow_readonly_bus",\\n      syncedAt: new Date().toISOString(),'
repl='      status: requestedBusDay ? "shadow_readonly_bus_day" : "shadow_readonly_bus",\\n      shadowDay: requestedBusDay || "",\\n      syncedAt: new Date().toISOString(),'
if anchor not in t:
    raise SystemExit('split bus status target missing')
t=t.replace(anchor,repl,1)
q.write_text(t)

r=Path('cloudflare-browser-test/scripts/tbr-bus-retry.test.mjs')
u=r.read_text()
anchor='const response = await sendConnectorSync({ STATE: new KV(), DEV_API }, "NE1", "connector-token");'
repl='const response = await sendConnectorSync({ STATE: new KV(), DEV_API }, "NE1", "connector-token", Date.parse("2026-09-05T08:00:00Z"));'
if anchor not in u:
    raise SystemExit('bus retry test call missing')
r.write_text(u.replace(anchor,repl,1))

test=Path('cloudflare-browser-test/scripts/tbr-bus-daily-split.test.mjs')
test.write_text('''import fs from "node:fs";
import { sendConnectorSync, tbrBusSourceDays } from "../src/index.js";

class KV {
  constructor() { this.m = new Map(); }
  async get(key) { return this.m.get(key) ?? null; }
  async put(key, value) { this.m.set(key, value); }
}
const make = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

const early = Date.parse("2026-09-05T18:30:00Z");
const expectedDays = ["2026-09-05", "2026-09-06"];
if (JSON.stringify(tbrBusSourceDays(early)) !== JSON.stringify(expectedDays))
  throw new Error(`early Bus source days wrong: ${JSON.stringify(tbrBusSourceDays(early))}`);

const busDays = [];
let busActive = 0, maxBusActive = 0;
const DEV_API = {
  fetch: async (request) => {
    const body = await request.json();
    if (body.shadowPart === "routes") {
      return make({ ok: true, data: { rows: [{ proofId: "ROUTE-1", attendanceType: "ปลายทาง", actualArrivalAt: "" }] } });
    }
    if (body.shadowPart !== "bus") return make({ ok: false }, 400);
    busDays.push(body.shadowDay);
    busActive += 1;
    maxBusActive = Math.max(maxBusActive, busActive);
    await new Promise((resolve) => setTimeout(resolve, 8));
    busActive -= 1;
    return make({ ok: true, data: { tbrShadowFeed: [{ proofId: `BUS-${body.shadowDay}`, scheduleTbrArrivalAt: `${body.shadowDay}T01:00:00+07:00` }] } });
  },
};

const response = await sendConnectorSync({ STATE: new KV(), DEV_API }, "NE1", "connector-token", early);
const payload = await response.json();
if (!response.ok) throw new Error("daily Bus split failed");
if (JSON.stringify(busDays) !== JSON.stringify(expectedDays)) throw new Error(`Bus day calls wrong: ${JSON.stringify(busDays)}`);
if (maxBusActive !== 1) throw new Error(`Bus day calls must be sequential; max active=${maxBusActive}`);
if (payload?.data?.tbrShadowFeed?.length !== 2) throw new Error("daily Bus feeds were not merged");
if (payload?.data?.shadowQuota?.normalTursoPointReadsPerCron !== 4) throw new Error("single-day baseline changed");
if (payload?.data?.shadowQuota?.currentSteadyStateTursoPointReadsPerCron !== 6) throw new Error("early two-day steady-state accounting must be 6 point reads");
if (payload?.data?.shadowQuota?.tursoPointReadsPerCron !== 6) throw new Error("actual early read accounting must be 6 without retries");
if (payload?.data?.shadowQuota?.tursoWritesPerCron !== 0) throw new Error("daily split must keep Turso writes at zero");
const split = fs.readFileSync(new URL("./patch-dev-tbr-shadow-split-v2.mjs", import.meta.url), "utf8");
for (const marker of ["TBR_BUS_DAILY_SPLIT_V9", "shadowDay", "readTbrShadowSnapshot(env, hub, shadowPart, shadowDay)"])
  if (!split.includes(marker)) throw new Error(`DEV split patch missing ${marker}`);
console.log("TBR_BUS_DAILY_SPLIT_V9=PASS");
console.log("TBR_BUS_SOURCE_DAYS=2");
console.log("TBR_BUS_MAX_DAY_CONCURRENCY=1");
console.log("TBR_SINGLE_DAY_POINT_READS=4");
console.log("TBR_EARLY_WINDOW_POINT_READS=6");
console.log("TBR_TURSO_WRITES=0");
''')

pkg=Path('cloudflare-browser-test/package.json')
v=pkg.read_text()
anchor='node scripts/tbr-bus-retry.test.mjs && wrangler deploy --dry-run'
repl='node scripts/tbr-bus-retry.test.mjs && node scripts/tbr-bus-daily-split.test.mjs && wrangler deploy --dry-run'
if anchor not in v:
    raise SystemExit('package check target missing')
pkg.write_text(v.replace(anchor,repl,1))
