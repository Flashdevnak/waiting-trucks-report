import assert from "node:assert/strict";
import fs from "node:fs";
import worker, { TBR_INTELLIGENCE_ENTRY_POLICY } from "../src/tbr-intelligence-entry.js";

class KV {
  constructor() { this.map = new Map(); this.puts = 0; }
  async get(key) { return this.map.get(key) ?? null; }
  async put(key, value) { this.puts += 1; this.map.set(key, value); }
  async delete(key) { this.map.delete(key); }
}

assert.equal(TBR_INTELLIGENCE_ENTRY_POLICY.stableEntrypoint, true);
assert.equal(TBR_INTELLIGENCE_ENTRY_POLICY.extraMsPolling, 0);
assert.equal(TBR_INTELLIGENCE_ENTRY_POLICY.tursoWrites, 0);
assert.equal(TBR_INTELLIGENCE_ENTRY_POLICY.queueAuthority, false);
assert.equal(TBR_INTELLIGENCE_ENTRY_POLICY.actualArrivalAuthority, "ROUTE");
assert.equal(TBR_INTELLIGENCE_ENTRY_POLICY.reconcileMinutes, 5);

const config = fs.readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
assert.ok(
  config.includes('"main": "src/tbr-intelligence-gated-entry.js"'),
  "Wrangler must use the health-gated stable Intelligence wrapper",
);
const gatedSource = fs.readFileSync(new URL("../src/tbr-intelligence-gated-entry.js", import.meta.url), "utf8");
assert.ok(gatedSource.includes('import intelligenceEntry from "./tbr-intelligence-entry.js"'));
assert.ok(gatedSource.includes("TBR_INTELLIGENCE_PIGGYBACK_GATE_V1"));
assert.ok(gatedSource.includes("extraMsPolling: 0"));
assert.ok(gatedSource.includes("tursoReads: 0"));
assert.ok(gatedSource.includes("tursoWrites: 0"));
const source = fs.readFileSync(new URL("../src/tbr-intelligence-entry.js", import.meta.url), "utf8");
for (const marker of [
  "TBR_INTELLIGENCE_STABLE_ENTRY_V3",
  "intelligenceForShadow",
  "reconcileConfiguredIntelligence",
  "extraMsPolling: 0",
  'actualArrivalAuthority: "ROUTE"',
]) assert.ok(source.includes(marker), `missing stable entrypoint marker ${marker}`);

const STATE = new KV();
await STATE.put("shadow:tbr:v1:NE1", JSON.stringify({
  version: 2,
  hub: "NE1",
  startedAt: "2026-09-07T15:00:00.000Z",
  updatedAt: "2026-09-07T19:00:00.000Z",
  healthUpdatedAt: "2026-09-07T19:00:00.000Z",
  lastAttemptAt: "2026-09-07T19:00:00.000Z",
  lastObservedAt: "2026-09-07T19:00:00.000Z",
  sourceAvailable: true,
  feedCount: 1,
  rowCount: 1,
  lastSkip: "",
  shadowQuota: { mode: "SHADOW_READONLY_SPLIT_V2", tursoPointReadsPerCron: 4, tursoWritesPerCron: 0 },
  routeFallback: false,
  routeFallbackAt: "",
  routeSourceError: null,
  records: {
    stable1: {
      status: "confirmed",
      tbrAt: "2026-09-07T19:05:58.000Z",
      kitAt: "",
      firstSeenAt: "2026-09-07T19:05:59.000Z",
      confirmedAt: "2026-09-07T19:06:44.404Z",
      expiredAt: "",
      routeActualArrivalAt: "2026-09-07T19:06:44.404Z",
      routeSeen: true,
      attendanceType: "ปลายทาง",
      leadMinutes: 1
    }
  }
}));
const env = { STATE };
const before = STATE.puts;
const firstResponse = await worker.fetch(new Request("https://test.invalid/api/tbr-intelligence?hub=NE1"), env);
const first = await firstResponse.json();
assert.equal(firstResponse.status, 200);
assert.equal(first.rolling14.candidates, 1);
assert.equal(first.rolling14.confirmed, 1);
assert.equal(first.rolling14.resolved, 1);
assert.equal(first.rolling14.confirmationRate, 100);
assert.equal(first.queueAuthority, false);
assert.equal(first.actualArrivalAuthority, "ROUTE");
assert.equal(first.tursoReads, 0);
assert.equal(first.tursoWrites, 0);
assert.equal(STATE.puts, before + 1, "stable entrypoint bootstrap must write Intelligence once");

const afterBootstrap = STATE.puts;
const secondResponse = await worker.fetch(new Request("https://test.invalid/api/tbr-intelligence?hub=NE1"), env);
const second = await secondResponse.json();
assert.equal(second.rolling14.candidates, 1);
assert.equal(STATE.puts, afterBootstrap, "repeat stable entrypoint reads must not write");

const pageResponse = await worker.fetch(new Request("https://test.invalid/shadow-tbr?hub=NE1"), env);
const html = await pageResponse.text();
assert.equal(pageResponse.status, 200);
assert.ok(html.includes("TBR Intelligence"));
assert.ok(html.includes("กำลังเก็บข้อมูล"));
assert.ok(!html.includes("SHADOW_COLLECTING</b>"));
assert.ok(!html.includes("2026-09-07T19:05:58.000Z"));
assert.ok(html.includes("08/09/2026 02:05:58"), "stable entrypoint must render Bangkok time");
assert.ok(html.includes("ตัวอย่าง 14 วัน<b>1</b>"));

console.log("TBR_INTELLIGENCE_STABLE_ENTRY_V3=PASS");
console.log("TBR_INTELLIGENCE_HEALTH_GATE_WRAPPER=PASS");
console.log("TBR_INTELLIGENCE_STABLE_BOOTSTRAP=PASS");
console.log("TBR_INTELLIGENCE_STABLE_REPEAT_READ_WRITES=0");
console.log("TBR_INTELLIGENCE_STABLE_EXTRA_MS_POLLING=0");
console.log("TBR_INTELLIGENCE_STABLE_TURSO_WRITES=0");
console.log("TBR_INTELLIGENCE_STABLE_QUEUE_AUTHORITY=0");
