import assert from "node:assert/strict";
import fs from "node:fs";
import {
  projectTbrDiagnosticRollup,
  updateTbrDiagnosticRollup,
} from "../src/tbr-diagnostic-rollup.js";
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
  constructor() { this.gets = 0; this.puts = 0; }
  async get() { this.gets += 1; return null; }
  async put() { this.puts += 1; }
}

const NOW = Date.parse("2026-09-21T12:00:00.000Z");
const STATE = new KV();
const env = { STATE };
const shadow = {
  hub: "NE1",
  startedAt: "2026-09-20T00:00:00.000Z",
  updatedAt: "2026-09-21T11:59:00.000Z",
  healthUpdatedAt: "2026-09-21T11:59:00.000Z",
  observerStatus: "LIVE",
  sourceAvailable: true,
  routeFallback: false,
  records: [
    { id: "aaa", status: "confirmed", tbrAt: "2026-09-20T10:00:00.000Z", confirmedAt: "2026-09-20T10:08:00.000Z", routeActualArrivalAt: "2026-09-20T10:08:00.000Z", leadMinutes: 8 },
    { id: "bbb", status: "confirmed", tbrAt: "2026-09-20T11:00:00.000Z", confirmedAt: "2026-09-20T11:15:00.000Z", routeActualArrivalAt: "2026-09-20T11:15:00.000Z", leadMinutes: 15 },
    { id: "ccc", status: "expired", tbrAt: "2026-09-20T12:00:00.000Z", expiredAt: "2026-09-21T00:01:00.000Z", leadMinutes: null },
    { id: "ddd", status: "pending", tbrAt: "2026-09-20T13:00:00.000Z", leadMinutes: null },
    { id: "outside", status: "confirmed", tbrAt: "2026-09-07T10:00:00.000Z", confirmedAt: "2026-09-07T10:01:00.000Z", routeActualArrivalAt: "2026-09-07T10:01:00.000Z", leadMinutes: 1 },
  ],
};
shadow.diagnosticRollup = projectTbrDiagnosticRollup(updateTbrDiagnosticRollup(
  null,
  Object.fromEntries(shadow.records.map((record) => [record.id, record])),
  { now: NOW, sourceAvailable: true, routeFallback: false },
), NOW);

for (const [key, expected] of Object.entries({
  extraMsPolling: 0, tursoWrites: 0, otherPersistentWrites: 0,
  queueAuthority: false, providerAuthority: false, freshnessAuthority: false,
  completenessAuthority: false, lifecycleAuthority: false, historyAuthority: false,
  businessDayAuthority: false, enrichmentScheduler: false, providerScheduler: false,
})) assert.equal(TBR_INTELLIGENCE_POLICY[key], expected, key);

assert.equal(shouldCheckpointTbrIntelligence(NOW), false);
assert.equal(shouldAttemptTbrAutoRepair(NOW), false);
assert.equal(shouldUpdateTbrIntelligence({ sourceChanged: true }, NOW), false);

const before = structuredClone(shadow);
const report = await updateTbrIntelligence(env, "NE1", shadow, {}, {}, { now: NOW });
assert.deepEqual(shadow, before, "Intelligence cannot mutate canonical/shared input");
assert.equal(report.rolling14.candidates, 4, "fixed now keeps only the production 14-day window");
assert.equal(report.rolling14.confirmed, 2);
assert.equal(report.rolling14.expired, 1);
assert.equal(report.rolling14.resolved, 3);
assert.equal(report.rolling14.confirmationRate, 66.7);
assert.equal(report.rolling14.p50LeadMinutes, 8);
assert.equal(report.rolling14.p90LeadMinutes, 15);
assert.equal(report.coverage.coverageState, "INCOMPLETE");
assert.equal(report.readiness.status, "SHADOW_COVERAGE_INCOMPLETE");
assert.equal(report.readiness.advisoryAllowedNow, false);
assert.equal(report.persistence, "NONE");
assert.equal(report.providerUpstreamCalls, 0);
assert.equal(report.routeUpstreamCalls, 0);
assert.equal(report.preEntryUpstreamCalls, 0);
assert.equal(report.otherPersistentWrites, 0);
assert.equal(report.canonicalActualArrival, "ROUTE_READ_ONLY");
assert.equal(STATE.gets, 0);
assert.equal(STATE.puts, 0);

for (let index = 0; index < 100; index += 1)
  await readTbrIntelligenceReport(env, "NE1", shadow, NOW);
assert.equal(STATE.gets, 0, "1/10/100 viewers cannot read Intelligence persistence");
assert.equal(STATE.puts, 0, "1/10/100 viewers cannot write Intelligence persistence");

const repair = await recordTbrRepairEvent(env, "NE1", "connector_reregister", NOW);
assert.equal(repair.persisted, false);
assert.equal(STATE.puts, 0);

const html = await (await tbrIntelligencePage(shadow, report)).text();
for (const marker of ["TBR Intelligence", "Read-only Advisory", "Diagnostic / Quota Guard", "Intelligence persistent writes", "Persistence", "14-day coverage INCOMPLETE"]) {
  assert.ok(html.includes(marker), `missing page marker ${marker}`);
}

const source = fs.readFileSync(new URL("../src/tbr-intelligence.js", import.meta.url), "utf8");
assert.doesNotMatch(source, /STATE\.put|env\.STATE\.put|storage\.put/);
assert.match(source, /otherPersistentWrites: 0/);
assert.match(source, /providerAuthority: false/);

console.log("TBR_INTELLIGENCE_REC05_READ_ONLY=PASS");
console.log("TBR_INTELLIGENCE_FIXED_NOW=2026-09-21T12:00:00.000Z");
console.log("TBR_INTELLIGENCE_2026_09_07_OUTSIDE_WINDOW=PASS");
console.log("TBR_INTELLIGENCE_VIEWERS_1_10_100_PROVIDER_CALLS=0");
console.log("TBR_INTELLIGENCE_VIEWERS_1_10_100_PERSISTENT_WRITES=0");
