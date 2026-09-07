import assert from "node:assert/strict";
import fs from "node:fs";
import {
  TBR_INTELLIGENCE_POLICY,
  readTbrIntelligenceReport,
  recordTbrRepairEvent,
  shouldAttemptTbrAutoRepair,
  shouldCheckpointTbrIntelligence,
  shouldUpdateTbrIntelligence,
  tbrIntelligencePage,
  updateTbrIntelligence,
} from "../src/tbr-intelligence.js";

class KV {
  constructor() { this.map = new Map(); this.puts = 0; this.gets = 0; }
  async get(key) { this.gets += 1; return this.map.get(key) ?? null; }
  async put(key, value) { this.puts += 1; this.map.set(key, value); }
}

const STATE = new KV();
const env = { STATE };
const base = Date.parse("2026-09-08T00:00:00+07:00");
const shadow = {
  hub: "NE1",
  observerStatus: "LIVE",
  sourceAvailable: true,
  routeFallback: false,
  records: [
    { id: "aaa", status: "confirmed", tbrAt: "2026-09-07T23:40:00+07:00", confirmedAt: "2026-09-07T23:48:00+07:00", routeActualArrivalAt: "2026-09-07T23:48:00+07:00", leadMinutes: 8 },
    { id: "bbb", status: "confirmed", tbrAt: "2026-09-07T23:30:00+07:00", confirmedAt: "2026-09-07T23:45:00+07:00", routeActualArrivalAt: "2026-09-07T23:45:00+07:00", leadMinutes: 15 },
    { id: "ccc", status: "expired", tbrAt: "2026-09-07T12:00:00+07:00", expiredAt: "2026-09-08T00:01:00+07:00", leadMinutes: null },
    { id: "ddd", status: "pending", tbrAt: "2026-09-07T23:55:00+07:00", leadMinutes: null },
  ],
};

assert.equal(TBR_INTELLIGENCE_POLICY.extraMsPolling, 0);
assert.equal(TBR_INTELLIGENCE_POLICY.tursoWrites, 0);
assert.equal(TBR_INTELLIGENCE_POLICY.queueAuthority, false);
const stagedIndex = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
for (const marker of [
  "TBR_INTELLIGENCE_V1",
  'url.pathname === "/api/tbr-intelligence"',
  'shouldAttemptTbrAutoRepair()',
  'recordTbrRepairEvent(env, hub, "connector_bootstrap")',
  'updateTbrIntelligence(env, hub, shadowReport',
]) assert.ok(stagedIndex.includes(marker), `missing staged index marker ${marker}`);
assert.ok(!stagedIndex.includes('TBR_QUEUE_AUTHORITY_ENABLED'), "TBR queue authority must remain disabled");
assert.equal(shouldCheckpointTbrIntelligence(base), true);
assert.equal(shouldCheckpointTbrIntelligence(base + 15 * 60000), false);
assert.equal(shouldCheckpointTbrIntelligence(base + 30 * 60000), true);
assert.equal(shouldAttemptTbrAutoRepair(base), true);
assert.equal(shouldAttemptTbrAutoRepair(base + 60000), false);
assert.equal(shouldAttemptTbrAutoRepair(base + 5 * 60000), true);
assert.equal(shouldUpdateTbrIntelligence({}, base + 15 * 60000), false);
assert.equal(shouldUpdateTbrIntelligence({ sourceChanged: true }, base + 15 * 60000), true);

await updateTbrIntelligence(env, "NE1", shadow, { sourceChanged: true }, { routeFallback: false }, { now: base });
let report = await readTbrIntelligenceReport(env, "NE1", shadow, base);
assert.equal(report.rolling14.candidates, 4);
assert.equal(report.rolling14.confirmed, 2);
assert.equal(report.rolling14.expired, 1);
assert.equal(report.rolling14.resolved, 3);
assert.equal(report.rolling14.confirmationRate, 66.7);
assert.equal(report.rolling14.p50LeadMinutes, 8);
assert.equal(report.rolling14.p90LeadMinutes, 15);
assert.equal(report.queueAuthority, false);
assert.equal(report.actualArrivalAuthority, "ROUTE");
assert.equal(report.selfHealing.maxScheduledIntelligenceWritesPerDayPerHub, 48);

await updateTbrIntelligence(env, "NE1", shadow, {}, {}, { now: base + 30 * 60000 });
report = await readTbrIntelligenceReport(env, "NE1", shadow, base + 30 * 60000);
assert.equal(report.rolling14.candidates, 4);
assert.equal(report.rolling14.confirmed, 2);
assert.equal(report.rolling14.expired, 1);
assert.equal(report.rolling14.health.live, 30);

const resolved = structuredClone(shadow);
resolved.records[3] = {
  ...resolved.records[3],
  status: "confirmed",
  confirmedAt: "2026-09-08T00:40:00+07:00",
  routeActualArrivalAt: "2026-09-08T00:40:00+07:00",
  leadMinutes: 45,
};
await updateTbrIntelligence(env, "NE1", resolved, {}, {}, { now: base + 45 * 60000 });
report = await readTbrIntelligenceReport(env, "NE1", resolved, base + 45 * 60000);
assert.equal(report.rolling14.candidates, 4);
assert.equal(report.rolling14.confirmed, 3);
assert.equal(report.rolling14.resolved, 4);
assert.equal(report.rolling14.p95LeadMinutes, 45);

const degraded = { ...resolved, routeFallback: true, sourceAvailable: true, observerStatus: "LIVE" };
await updateTbrIntelligence(env, "NE1", degraded, { routeFallbackChanged: true }, { routeFallback: true, routeSourceError: { code: "TBR_ROUTES_HTTP_503" } }, { now: base + 60 * 60000 });
await updateTbrIntelligence(env, "NE1", resolved, { routeFallbackChanged: true }, {}, { now: base + 90 * 60000 });
report = await readTbrIntelligenceReport(env, "NE1", resolved, base + 90 * 60000);
assert.equal(report.rolling14.routeFallbackEvents, 1);
assert.equal(report.rolling14.health.fallback, 30);
assert.equal(report.readiness.queueAuthority, false);

await recordTbrRepairEvent(env, "NE1", "connector_reregister", base + 91 * 60000);
report = await readTbrIntelligenceReport(env, "NE1", resolved, base + 91 * 60000);
assert.equal(report.selfHealing.repairEvents, 1);
assert.equal(report.selfHealing.lastRepairAction, "connector_reregister");

const html = await (await tbrIntelligencePage(resolved, report)).text();
for (const marker of ["TBR Intelligence", "TBR Shadow Test", "Queue authority OFF", "Self-healing / Quota Guard"]) {
  assert.ok(html.includes(marker), `missing page marker ${marker}`);
}

assert.ok(STATE.puts <= 6, `unexpected test KV write count ${STATE.puts}`);
console.log("TBR_INTELLIGENCE_V1=PASS");
console.log("TBR_INTELLIGENCE_DEDUPE=PASS");
console.log("TBR_INTELLIGENCE_HEALTH_ROLLUP=PASS");
console.log("TBR_INTELLIGENCE_SELF_HEAL=PASS");
console.log("TBR_INTELLIGENCE_PERIODIC_WRITES_MAX_PER_HUB_DAY=48");
console.log("TBR_INTELLIGENCE_EXTRA_MS_POLLING=0");
console.log("TBR_INTELLIGENCE_TURSO_WRITES=0");
console.log("TBR_INTELLIGENCE_QUEUE_AUTHORITY=0");
