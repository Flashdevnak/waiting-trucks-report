import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PNO_PASSIVE_LIMITS, pnoPassiveLocator, pnoPassiveLocators, registerPnoPassiveRoutes,
  runPnoPassiveCycle,
} from "../../worker/src/pno-passive-coverage.js";
import { observePnoEvidencePage, projectPnoEvidence } from "../../worker/src/pno-inbound-scan-evidence.js";

const root = new URL("../../", import.meta.url);
const stage = readFileSync(new URL("worker/.dev-runtime/src/index.js", root), "utf8");
const source = readFileSync(new URL("worker/src/pno-passive-coverage.js", root), "utf8");

function storage() {
  const data = new Map(); let alarm = null;
  return {
    async get(key) { return data.get(key); },
    async put(key, value) { data.set(key, structuredClone(value)); },
    async getAlarm() { return alarm; },
    async setAlarm(value) { alarm = value; },
    async transaction(fn) {
      return fn({
        async get(keys) { return new Map(keys.map((key) => [key, data.get(key)]).filter(([, value]) => value !== undefined)); },
        async put(values) { for (const [key, value] of Object.entries(values)) data.set(key, structuredClone(value)); },
      });
    },
    data,
    get alarm() { return alarm; },
  };
}

const row = (id = "A", overrides = {}) => ({
  attendanceType: "ปลายทาง", pnoEnabled: true, pnoDetailAvailable: true,
  pnoSegmentCount: 1, expectedParcels: 250, proofId: `PROOF-${id}`,
  pnoSourceDay: "2026-09-30", pnoLineId: "LINE", pnoStoreId: "SOURCE",
  pnoNextStoreId: "TARGET", ...overrides,
});

test("exact eligible source identity only; no fuzzy substitute or unknown segment", () => {
  assert.ok(pnoPassiveLocator(row(), "HUB"));
  for (const changes of [{ proofId: "", plate: "ABC" }, { pnoSegmentCount: 2 },
    { pnoStoreId: "" }, { pnoSourceDay: "" }, { pnoDetailAvailable: false },
    { attendanceType: "ต้นทาง" }, { queueCancelledAt: "now" }])
    assert.equal(pnoPassiveLocator(row("A", changes), "HUB"), null);
});

test("exact multi-drop segments register individually without an aggregate locator or raised quota", async () => {
  const segment = (id) => ({ proofId: "PROOF-M", pnoSourceDay: "2026-09-30",
    pnoLineId: `LINE-${id}`, pnoStoreId: "SOURCE", pnoNextStoreId: `DROP-${id}`,
    expectedParcels: 2, enteredParcels: 1, pendingParcels: 1 });
  const multi = row("M", { proofId: "PROOF-M", expectedParcels: 30,
    enteredParcels: 15, pendingParcels: 15,
    pnoDetailAvailable: true, pnoSegmentCount: 15,
    pnoSegments: Array.from({ length: 15 }, (_, i) => segment(i)) });
  assert.equal(pnoPassiveLocator(multi, "HUB"), null);
  assert.equal(pnoPassiveLocators(multi, "HUB").length, 15);
  assert.equal(pnoPassiveLocators({ ...multi, pnoSegments: multi.pnoSegments.slice(1) }, "HUB").length, 0);
  assert.equal(pnoPassiveLocators({ ...multi, pnoDetailAvailable: false }, "HUB").length, 0);
  assert.equal(pnoPassiveLocators({ ...multi, pendingParcels: 14 }, "HUB").length, 0);
  const st = storage(), owner = { ctx: { storage: st } }, at = 1_000_000;
  await registerPnoPassiveRoutes(owner, "HUB", [multi], at);
  assert.equal(st.data.get("pno-passive-coverage-v1").routes.length, 12);
  const visited = new Set();
  const read = async (_, __, locator) => {
    visited.add(locator.nextStoreId);
    return { sourceValid: true, total: 2, page: locator.page,
      sourceCountMismatch: false, parcels: [{ pno: locator.nextStoreId }] };
  };
  for (let cycle = 0; cycle < 18; cycle++) {
    const stamp = at + 1 + cycle * (PNO_PASSIVE_LIMITS.cadenceMs + 1);
    const result = await runPnoPassiveCycle(owner, {}, read, stamp);
    assert.ok(result.pages <= PNO_PASSIVE_LIMITS.maxPagesPerCycle);
    assert.ok(result.routes <= PNO_PASSIVE_LIMITS.maxRoutesPerCycle);
    await registerPnoPassiveRoutes(owner, "HUB", [multi], stamp + 2);
    assert.ok(st.data.get("pno-passive-coverage-v1").routes.length <= PNO_PASSIVE_LIMITS.maxCandidates);
  }
  assert.equal(visited.size, 15, "every exact segment eventually gets an existing budget slot: " + [...visited].join(","));
});

test("multi-drop candidates share one per-HUB alarm fairly with a normal vehicle", async () => {
  const segments = Array.from({ length: 5 }, (_, index) => ({
    proofId: "MULTI", pnoSourceDay: "2026-09-30", pnoLineId: `LINE-${index}`,
    pnoStoreId: "SOURCE", pnoNextStoreId: `DROP-${index}`,
    expectedParcels: 1, enteredParcels: 0, pendingParcels: 1,
  }));
  const multi = row("M", { proofId: "MULTI", expectedParcels: 5,
    enteredParcels: 0, pendingParcels: 5,
    pnoSegmentCount: 5, pnoSegments: segments });
  const normal = row("NORMAL", { expectedParcels: 1 });
  const st = storage(), owner = { ctx: { storage: st } }, at = 1_000_000;
  await registerPnoPassiveRoutes(owner, "HUB", [multi, normal], at);
  assert.equal(st.data.get("pno-passive-coverage-v1").routes.length, 6);
  const seen = new Set();
  const read = async (_, __, locator) => {
    seen.add(locator.proofId);
    return { sourceValid: true, sourceCountMismatch: false, total: 1,
      page: 1, parcels: [{ pno: locator.nextStoreId }] };
  };
  for (let index = 0; index < 3; index++) {
    const result = await runPnoPassiveCycle(owner, {}, read,
      at + 1 + index * (PNO_PASSIVE_LIMITS.cadenceMs + 1));
    assert.ok(result.routes <= 2 && result.pages <= 4);
  }
  assert.ok(seen.has("MULTI") && seen.has("PROOF-NORMAL"));
  assert.equal(PNO_PASSIVE_LIMITS.maxConcurrency, 1);
});

test("per-HUB alarm observes bounded pages, coalesces registration, respects cadence and expiry", async () => {
  const st = storage(), owner = { ctx: { storage: st } }, at = 1_000_000;
  const many = Array.from({ length: 15 }, (_, n) => row(String(n)));
  await Promise.all([registerPnoPassiveRoutes(owner, "HUB", many, at),
    registerPnoPassiveRoutes(owner, "HUB", many, at)]);
  assert.equal(st.data.get("pno-passive-coverage-v1").routes.length, PNO_PASSIVE_LIMITS.maxCandidates);
  assert.equal(st.alarm, at + 1);
  const calls = [];
  const read = async (_, __, locator) => {
    calls.push([locator.proofId, locator.page]);
    return { sourceValid: true, sourceCountMismatch: false, total: 250,
      page: locator.page, parcels: [{ pno: "PARCEL" }] };
  };
  const first = await Promise.all([runPnoPassiveCycle(owner, {}, read, at + 1),
    runPnoPassiveCycle(owner, {}, read, at + 1)]);
  assert.deepEqual(first.map((entry) => entry.pages), [4, 0]);
  assert.equal(calls.length, 4);
  assert.equal(new Set(calls.map(([proof]) => proof)).size, 2);
  assert.equal(await registerPnoPassiveRoutes(owner, "HUB", many, at + 5), 12);
  const early = await runPnoPassiveCycle(owner, {}, read, at + 60_000);
  assert.equal(early.pages, 0);
  const later = await runPnoPassiveCycle(owner, {}, read, at + 120_002);
  assert.equal(later.pages, 4); // Other eligible routes, never the same two.
  assert.notEqual(calls[4][0], calls[0][0]);
  assert.equal(st.alarm, at + 120_002 + PNO_PASSIVE_LIMITS.cadenceMs);
  const expired = await runPnoPassiveCycle(owner, {}, read, at + PNO_PASSIVE_LIMITS.lifecycleMs + 1);
  assert.equal(expired.pages, 0);
  assert.ok(st.data.get("pno-passive-coverage-v1").routes.every((item) => item.expired));
});

test("errors consume request budget and back off without retry or positive rewrite", async () => {
  const st = storage(), owner = { ctx: { storage: st } }, at = 1_000_000;
  await registerPnoPassiveRoutes(owner, "HUB", [row("A"), row("B"), row("C")], at);
  let attempts = 0;
  const fail = async () => { attempts++; throw new Error("provider unavailable"); };
  const result = await runPnoPassiveCycle(owner, {}, fail, at + 1);
  assert.deepEqual(result, { routes: 2, pages: 2, errors: 2 });
  assert.equal(attempts, 2);
  await runPnoPassiveCycle(owner, {}, fail, at + 2);
  assert.equal(attempts, 2); // No second cycle while one is already running.
  await runPnoPassiveCycle(owner, {}, fail, at + 120_002);
  assert.equal(attempts, 3); // Third route only; prior failures back off.
  await runPnoPassiveCycle(owner, {}, fail, at + 120_003);
  assert.equal(attempts, 3);
});

test("observed exact positive remains sticky; overwritten action and other arrival are not gap proof", async () => {
  const st = storage();
  const locator = { hub: "HUB", proofId: "PROOF", day: "2026-09-30",
    lineId: "LINE", storeId: "SOURCE", nextStoreId: "TARGET" };
  const parcel = (anchor, action, time) => ({ pno: "PARCEL",
    real_arrive_time: anchor, store_id: "TARGET", LastAction: action, LastActionTime: time });
  const anchor = "2026-09-30 10:00:00";
  const positive = await observePnoEvidencePage(st, locator,
    [parcel(anchor, "ARRIVAL_WAREHOUSE_SCAN", "2026-09-30 10:01:00")], "2026-09-30T03:01:01Z");
  assert.equal(positive[0].classification, "CONFIRMED_SCAN_IN");
  const downstream = await observePnoEvidencePage(st, locator,
    [parcel(anchor, "SHIPMENT_WAREHOUSE_SCAN", "2026-09-30 10:02:00")], "2026-09-30T03:02:01Z");
  assert.equal(downstream[0].classification, "CONFIRMED_SCAN_IN");
  const other = await observePnoEvidencePage(st, locator,
    [parcel("2026-09-30 11:00:00", "SHIPMENT_WAREHOUSE_SCAN", "2026-09-30 11:02:00")], "2026-09-30T04:02:01Z");
  assert.equal(other[0].classification, "INSUFFICIENT_HISTORY");
  assert.equal(projectPnoEvidence({ monitoringStartedAt: "2026-09-30T02:00:00Z",
    lastObservedAt: "2026-09-30T04:00:00Z", monitoringBeforeArrival: true,
    downstreamObserved: true, scanInObserved: false, coverageState: "PARTIAL_LOCAL" }).classification,
  "INSUFFICIENT_HISTORY");
});

test("multi-drop positive scan evidence cannot cross exact segment identity", async () => {
  const st = storage();
  const base = { hub: "HUB", proofId: "MULTI", day: "2026-09-30",
    storeId: "SOURCE", nextStoreId: "TARGET" };
  const parcel = { pno: "SAME-PNO", real_arrive_time: "2026-09-30 10:00:00",
    store_id: "TARGET", LastAction: "ARRIVAL_WAREHOUSE_SCAN",
    LastActionTime: "2026-09-30 10:01:00" };
  const a = await observePnoEvidencePage(st, { ...base, lineId: "LINE-A" },
    [parcel], "2026-09-30T03:01:01Z");
  const b = await observePnoEvidencePage(st, { ...base, lineId: "LINE-B" },
    [{ ...parcel, LastAction: "SHIPMENT_WAREHOUSE_SCAN", LastActionTime: "2026-09-30 10:02:00" }],
    "2026-09-30T03:02:01Z");
  assert.equal(a[0].classification, "CONFIRMED_SCAN_IN");
  assert.equal(b[0].classification, "INSUFFICIENT_HISTORY");
});

test("staged coordinator registers on accepted refresh, uses alarm, and leaves ordinary detail hook intact", () => {
  assert.match(stage, /PNO_PASSIVE_COVERAGE_V1/);
  assert.match(stage, /async alarm\(\) \{\s*await runPnoPassiveCycle/);
  assert.match(stage, /result\?\.status === "synced"[\s\S]*?registerPnoPassiveRoutes/);
  assert.equal((stage.match(/observePnoEvidencePage\(/g) || []).length, 1);
  assert.doesNotMatch(source, /curl_pno|\/pno\/history|WaybillDetail|fetch\(/);
  assert.doesNotMatch(source, /COMPLETE_LOCAL/);
  assert.equal(PNO_PASSIVE_LIMITS.maxConcurrency, 1);
  assert.ok(PNO_PASSIVE_LIMITS.cadenceMs >= 60_000);
  assert.equal(PNO_PASSIVE_LIMITS.maxRoutesPerCycle * PNO_PASSIVE_LIMITS.maxPagesPerRoute,
    PNO_PASSIVE_LIMITS.maxPagesPerCycle);
});

test("passive alarm delegates acquisition through normal pendingParcels canonical authority", () => {
  const normal = stage.match(/async function pendingParcels\([\s\S]*?\n}\n/);
  const alarm = stage.match(/async alarm\(\) \{[\s\S]*?\n  }/);
  assert.ok(normal && alarm);
  assert.match(normal[0], /readCanonicalPnoPage\(env, locator\)/);
  assert.match(alarm[0], /readCanonicalPnoPage\(env, locator\)/);
  assert.doesNotMatch(alarm[0], /readSharedPnoPage\(this/);
});
