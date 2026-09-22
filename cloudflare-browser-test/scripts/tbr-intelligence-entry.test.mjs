import assert from "node:assert/strict";
import fs from "node:fs";
import {
  projectTbrDiagnosticRollup,
  updateTbrDiagnosticRollup,
} from "../src/tbr-diagnostic-rollup.js";
import worker, {
  TBR_INTELLIGENCE_ENTRY_POLICY,
  intelligenceForShadow,
} from "../src/tbr-intelligence-entry.js";

class KV {
  constructor() { this.map = new Map(); this.puts = 0; this.gets = 0; this.lists = 0; }
  async get(key) { this.gets += 1; return this.map.get(key) ?? null; }
  async put(key, value) { this.puts += 1; this.map.set(key, value); }
  async delete(key) { this.map.delete(key); }
  async list({ prefix = "" } = {}) {
    this.lists += 1;
    return { keys: [...this.map.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })) };
  }
}

for (const [key, expected] of Object.entries({
  stableEntrypoint: true, reconcileMinutes: 0, extraMsPolling: 0,
  tursoWrites: 0, otherPersistentWrites: 0, queueAuthority: false,
  providerAuthority: false, freshnessAuthority: false, completenessAuthority: false,
  lifecycleAuthority: false, historyAuthority: false, businessDayAuthority: false,
  enrichmentScheduler: false, providerScheduler: false,
})) assert.equal(TBR_INTELLIGENCE_ENTRY_POLICY[key], expected, key);

const config = fs.readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
assert.ok(config.includes('"main": "src/tbr-intelligence-entry.js"'));
const source = fs.readFileSync(new URL("../src/tbr-intelligence-entry.js", import.meta.url), "utf8");
assert.doesNotMatch(source, /reconcileConfiguredIntelligence|updateTbrIntelligence|STATE\.put/);

const NOW = Date.parse("2026-09-21T12:00:00.000Z");
const shadow = {
  version: 2, hub: "NE1",
  startedAt: "2026-09-20T00:00:00.000Z",
  updatedAt: "2026-09-21T11:59:00.000Z",
  healthUpdatedAt: "2026-09-21T11:59:00.000Z",
  sourceAvailable: true, observerStatus: "LIVE", routeFallback: false,
  records: [{
    id: "stable1", status: "confirmed", tbrAt: "2026-09-20T10:00:00.000Z",
    confirmedAt: "2026-09-20T10:01:00.000Z", routeActualArrivalAt: "2026-09-20T10:01:00.000Z",
    routeSeen: true, attendanceType: "ปลายทาง", leadMinutes: 1,
  }],
};
const persistedRollup = updateTbrDiagnosticRollup(
  null,
  { stable1: shadow.records[0] },
  { now: NOW, sourceAvailable: true, routeFallback: false },
);
shadow.diagnosticRollup = projectTbrDiagnosticRollup(persistedRollup, NOW);
const directState = new KV();
const direct = await intelligenceForShadow({ STATE: directState }, "NE1", shadow, NOW);
assert.equal(direct.rolling14.candidates, 1);
assert.equal(direct.readiness.status, "SHADOW_COVERAGE_INCOMPLETE");
assert.equal(direct.otherPersistentWrites, 0);
assert.equal(directState.gets, 0);
assert.equal(directState.puts, 0);

const STATE = new KV();
STATE.map.set("hubs", JSON.stringify(["NE1"]));
STATE.map.set("shadow:tbr:v1:NE1", JSON.stringify({
  ...shadow,
  diagnosticRollup: persistedRollup,
  records: { stable1: shadow.records[0] },
}));
const env = { STATE };
for (const viewers of [1, 10, 100]) {
  const writesBefore = STATE.puts;
  for (let index = 0; index < viewers; index += 1) {
    const response = await worker.fetch(new Request("https://test.invalid/api/tbr-intelligence?hub=NE1"), env);
    assert.equal(response.status, 200);
    const report = await response.json();
    assert.equal(report.otherPersistentWrites, 0);
    assert.equal(report.providerUpstreamCalls, 0);
  }
  assert.equal(STATE.puts, writesBefore, `${viewers} Intelligence viewers must write zero persistence`);
}

console.log("TBR_INTELLIGENCE_STABLE_ENTRY_REC05=PASS");
console.log("TBR_INTELLIGENCE_STABLE_VIEWERS_1_10_100_PROVIDER_CALLS=0");
console.log("TBR_INTELLIGENCE_STABLE_VIEWERS_1_10_100_PERSISTENT_WRITES=0");
