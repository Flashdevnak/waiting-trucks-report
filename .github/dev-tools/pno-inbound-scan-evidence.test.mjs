import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PNO_SCAN_CLASSES, matchPnoHistoryArrival, observePnoSnapshot,
  observePnoEvidencePage, reconcilePnoCachedPositive, ingestPnoExactHistory,
  pnoEvidenceKeys, projectPnoEvidence,
} from "../../worker/src/pno-inbound-scan-evidence.js";
import { stageFrontend, patchDevUiShellSource } from "./stage-dev-runtime.mjs";
import { readSharedPnoPage } from "../../worker/.dev-runtime/src/index.js";

const locator = Object.freeze({ hub: "NE1", proofId: "PROOF_A", day: "2026-09-24",
  lineId: "LINE_A", storeId: "STORE_BEFORE", nextStoreId: "STORE_CURRENT",
  type: "total", page: 1, canReport: false, count: 1 });
const arrival = "2026-09-24 02:58:37";
const scan = "2026-09-24 03:12:14";
const downstream = "2026-09-24 03:17:54";
const before = "2026-09-23T19:50:00.000Z";
const arrivedAt = "2026-09-23T19:58:37.000Z";
const scannedAt = "2026-09-23T20:12:20.000Z";
const departedAt = "2026-09-23T20:18:00.000Z";
function row(action, time, extra = {}) {
  return { pno: "TEST_PNO_A", store_id: "STORE_CURRENT",
    real_arrive_time: arrival, LastAction: action, LastAction_name: "ตัวอย่าง",
    LastActionTime: time, pack_no: "TEST_BAG", ...extra };
}
function history(pno = "TEST_PNO_A", events = [
  ["ARRIVAL_GOODS_VAN_CHECK_SCAN", arrival, "STORE_CURRENT"],
  ["ARRIVAL_WAREHOUSE_SCAN", scan, "STORE_CURRENT"],
  ["SHIPMENT_WAREHOUSE_SCAN", downstream, "STORE_CURRENT"],
]) {
  return { data: { result: { parcel_info: { pno }, parcel_routes: events.map(
    ([route_action, routed_at, store_id]) => ({ route_action, routed_at, store_id })) } } };
}
function legacyHistoryPositive(record) {
  return { ...record, scanInObserved: true, scanInAction: "ARRIVAL_WAREHOUSE_SCAN",
    scanInEventAt: scan, scanInObservedAt: scannedAt,
    scanInSource: "EXPLICIT_WAYBILL_HISTORY" };
}

class MemoryStorage {
  constructor() { this.values = new Map(); this.writes = 0; this.queue = Promise.resolve(); }
  async transaction(callback) {
    const previous = this.queue;
    let release;
    this.queue = new Promise((resolve) => { release = resolve; });
    await previous;
    try { return await callback(this); } finally { release(); }
  }
  async get(keys) {
    return new Map(keys.filter((key) => this.values.has(key)).map((key) => [key, this.values.get(key)]));
  }
  async put(entries) {
    for (const [key, value] of Object.entries(entries)) {
      this.values.set(key, structuredClone(value)); this.writes += 1;
    }
  }
}

test("paired detail and history require the exact vehicle arrival store and timestamp", () => {
  const r = row("SHIPMENT_WAREHOUSE_SCAN", downstream);
  assert.equal(matchPnoHistoryArrival(locator, r, [{ route_action: "ARRIVAL_GOODS_VAN_CHECK_SCAN",
    store_id: "STORE_CURRENT", routed_at: arrival }]), true);
  for (const event of [
    { route_action: "ARRIVAL_WAREHOUSE_SCAN", store_id: "STORE_CURRENT", routed_at: arrival },
    { route_action: "ARRIVAL_GOODS_VAN_CHECK_SCAN", store_id: "STORE_OLD", routed_at: arrival },
    { route_action: "ARRIVAL_GOODS_VAN_CHECK_SCAN", store_id: "STORE_CURRENT", routed_at: scan },
  ]) assert.equal(matchPnoHistoryArrival(locator, r, [event]), false);
  assert.equal(matchPnoHistoryArrival({ ...locator, nextStoreId: "OTHER" }, r,
    [{ route_action: "ARRIVAL_GOODS_VAN_CHECK_SCAN", store_id: "STORE_CURRENT", routed_at: arrival }]), false);
  assert.equal(matchPnoHistoryArrival(locator, row("DRIVER_SIGN", arrival,
    { real_arrive_time: "" }), [{ route_action: "DRIVER_SIGN",
    store_id: "STORE_CURRENT", routed_at: arrival }]), true);
});

test("PNO arrival actions establish the anchor without real_arrive_time, never a parcel scan", async () => {
  for (const action of ["DRIVER_SIGN", "ARRIVAL_GOODS_VAN_CHECK_SCAN"]) {
    const source = row(action, arrival, { real_arrive_time: "" });
    const result = observePnoSnapshot(null, locator, source, arrivedAt,
      { monitoringStartedAt: before });
    assert.equal(result.record.arrivalAnchorAt, arrival);
    assert.equal(result.record.arrivalStageObserved, true);
    assert.equal(result.record.downstreamObserved, false);
    assert.equal(result.record.scanInObserved, false);
    assert.equal(result.view.classification, PNO_SCAN_CLASSES.NOT_YET);
    assert.notEqual(result.view.reason, "ARRIVAL_ANCHOR_MISSING_OR_INVALID");
    const storage = new MemoryStorage();
    const [page] = await observePnoEvidencePage(storage, locator, [source], arrivedAt);
    assert.equal(page.classification, PNO_SCAN_CLASSES.NOT_YET);
  }
  const missingTarget = observePnoSnapshot(null, locator,
    row("DRIVER_SIGN", arrival, { real_arrive_time: "", store_id: "" }), arrivedAt);
  assert.equal(missingTarget.view.reason, "TARGET_STORE_MISSING");
});

test("earliest valid PNO arrival wins regardless of event order and never moves forward", () => {
  const elevenFiftyTwo = "2026-09-24 02:52:00";
  const elevenFiftyFive = "2026-09-24 02:55:00";
  const elevenFiftyNine = "2026-09-24 02:59:00";
  const realFirst = observePnoSnapshot(null, locator,
    row("DRIVER_SIGN", elevenFiftyNine, { real_arrive_time: elevenFiftyFive }), arrivedAt);
  assert.equal(realFirst.record.arrivalAnchorAt, elevenFiftyFive);
  const signFirst = observePnoSnapshot(null, locator,
    row("DRIVER_SIGN", elevenFiftyTwo, { real_arrive_time: elevenFiftyFive }), arrivedAt);
  assert.equal(signFirst.record.arrivalAnchorAt, elevenFiftyTwo);
  const later = observePnoSnapshot(signFirst.record, locator,
    row("ARRIVAL_GOODS_VAN_CHECK_SCAN", elevenFiftyFive,
      { real_arrive_time: elevenFiftyNine }), scannedAt);
  assert.equal(later.record.arrivalAnchorAt, elevenFiftyTwo);
  const refined = observePnoSnapshot(realFirst.record, locator,
    row("DRIVER_SIGN", elevenFiftyTwo, { real_arrive_time: elevenFiftyFive }), scannedAt);
  assert.equal(refined.record.arrivalAnchorAt, elevenFiftyTwo);
  assert.equal(refined.record.downstreamObserved, false);
});

test("stable occurrence migrates an accepted legacy scan when earlier PNO arrival is learned", async () => {
  const storage = new MemoryStorage();
  const positive = row("ARRIVAL_WAREHOUSE_SCAN", scan);
  const key = await pnoEvidenceKeys(locator, positive);
  const legacyRecord = legacyHistoryPositive(
    observePnoSnapshot(null, locator, positive, scannedAt).record);
  storage.values.set(key.legacyOccurrence, structuredClone(legacyRecord));
  storage.values.set(key.base, { monitoringStartedAt: scannedAt, activeAnchor: arrival });
  const earlier = "2026-09-24 02:52:00";
  const driver = row("DRIVER_SIGN", earlier, { real_arrive_time: "" });
  const driverKey = await pnoEvidenceKeys(locator, driver);
  assert.equal(driverKey.occurrence, key.occurrence);
  const [view] = await observePnoEvidencePage(storage, locator, [driver], departedAt);
  assert.equal(view.classification, PNO_SCAN_CLASSES.CONFIRMED);
  assert.equal(storage.values.get(key.occurrence).arrivalAnchorAt, earlier);
  assert.equal(storage.values.get(key.occurrence).scanInEventAt, scan);
  assert.equal(storage.values.get(key.base).activeAnchor, earlier);
  assert.equal(storage.values.get(key.legacyOccurrence).scanInObserved, true,
    "legacy record remains readable without a destructive migration");
  const [downstreamView] = await observePnoEvidencePage(storage, locator,
    [row("SHIPMENT_WAREHOUSE_SCAN", downstream, { real_arrive_time: "" })], departedAt);
  assert.equal(downstreamView.classification, PNO_SCAN_CLASSES.CONFIRMED);
  assert.equal(storage.values.get(key.occurrence).arrivalAnchorAt, earlier);
  const cached = { sourceValid: true, parcels: [{ pno: positive.pno,
    arrivalAnchorAt: "", scanEvidence: { classification: PNO_SCAN_CLASSES.INSUFFICIENT } }] };
  await reconcilePnoCachedPositive(storage, locator, cached);
  assert.equal(cached.parcels[0].scanEvidence.classification, PNO_SCAN_CLASSES.CONFIRMED);
});

test("a persisted exact-identity arrival survives a later row without real_arrive_time", async () => {
  const storage = new MemoryStorage();
  const key = await pnoEvidenceKeys(locator, row("DRIVER_SIGN", arrival));
  storage.values.set(key.base, { monitoringStartedAt: arrivedAt, activeAnchor: arrival });
  const [view] = await observePnoEvidencePage(storage, locator,
    [row("SHIPMENT_WAREHOUSE_SCAN", downstream, { real_arrive_time: "" })], departedAt);
  assert.equal(view.classification, PNO_SCAN_CLASSES.INSUFFICIENT);
  assert.notEqual(view.reason, "ARRIVAL_ANCHOR_MISSING_OR_INVALID");
  assert.equal(storage.values.get(key.occurrence).arrivalAnchorAt, arrival);
  const other = await observePnoEvidencePage(storage, { ...locator, lineId: "OTHER_LINE" },
    [row("SHIPMENT_WAREHOUSE_SCAN", downstream, { real_arrive_time: "" })], departedAt);
  assert.equal(other[0].reason, "ARRIVAL_ANCHOR_MISSING_OR_INVALID");
});

test("owner late-observation sequence must not accuse a parcel whose scan was missed by monitoring", async () => {
  const storage = new MemoryStorage();
  const caseLocator = { ...locator, day: "2026-09-30" };
  const current = row("SHIPMENT_WAREHOUSE_SCAN", "2026-09-30 01:21:36", {
    real_arrive_time: "2026-09-30 00:42:48",
  });
  // Provider reality: vehicle arrival, warehouse scan-in, then scan-out. The
  // application first observes only the later current snapshot.
  const supplied = history("TEST_PNO_A", [
    ["ARRIVAL_GOODS_VAN_CHECK_SCAN", "2026-09-30 00:42:48", "STORE_CURRENT"],
    ["ARRIVAL_WAREHOUSE_SCAN", "2026-09-30 01:10:28", "STORE_CURRENT"],
    ["SHIPMENT_WAREHOUSE_SCAN", "2026-09-30 01:21:36", "STORE_CURRENT"],
  ]);
  const observedAt = "2026-09-29T18:22:00.000Z";
  const [first] = await observePnoEvidencePage(storage, caseLocator, [current], observedAt);
  assert.deepEqual(first, { classification: PNO_SCAN_CLASSES.INSUFFICIENT,
    reason: "LATE_START_SCAN_STATE_UNKNOWN" });
  const accepted = await ingestPnoExactHistory(storage, caseLocator, current, supplied, observedAt);
  assert.equal(accepted.classification, PNO_SCAN_CLASSES.CONFIRMED);
  assert.equal(accepted.scanInEventAt, "2026-09-30 01:10:28");
});

test("already supplied PNO history matches either arrival action without borrowing another round", async () => {
  const storage = new MemoryStorage();
  const earlier = "2026-09-24 02:52:00";
  const current = row("SHIPMENT_WAREHOUSE_SCAN", downstream);
  const supplied = history("TEST_PNO_A", [
    ["DRIVER_SIGN", earlier, "STORE_CURRENT"],
    ["ARRIVAL_GOODS_VAN_CHECK_SCAN", arrival, "STORE_CURRENT"],
    ["ARRIVAL_WAREHOUSE_SCAN", scan, "STORE_CURRENT"],
    ["SHIPMENT_WAREHOUSE_SCAN", downstream, "STORE_CURRENT"],
  ]);
  const accepted = await ingestPnoExactHistory(storage, locator, current, supplied, departedAt);
  assert.equal(accepted.classification, PNO_SCAN_CLASSES.CONFIRMED);
  const key = await pnoEvidenceKeys(locator, current);
  assert.equal(storage.values.get(key.occurrence).arrivalAnchorAt, arrival,
    "an unbound older history row has no proof/line identity");
  assert.equal(storage.values.get(key.occurrence).scanInEventAt, scan);
  assert.equal((await observePnoEvidencePage(storage, locator,
    [row("SHIPMENT_WAREHOUSE_SCAN", downstream, { real_arrive_time: "" })], departedAt))[0]
    .classification, PNO_SCAN_CLASSES.CONFIRMED);
});

test("legacy exact-history positive remains sticky, while a late-start row begins unknown", async () => {
  const storage = new MemoryStorage();
  const current = row("SHIPMENT_WAREHOUSE_SCAN", downstream);
  assert.equal((await observePnoEvidencePage(storage, locator, [current], departedAt))[0].classification,
    PNO_SCAN_CLASSES.INSUFFICIENT);
  const accepted = await ingestPnoExactHistory(storage, locator, current, history(),
    "2026-09-23T20:19:00.000Z");
  assert.equal(accepted.classification, PNO_SCAN_CLASSES.CONFIRMED);
  assert.equal(accepted.scanInEventAt, scan);
  assert.equal(accepted.scanInObservedAt, "2026-09-23T20:19:00.000Z");
  assert.equal(accepted.scanInSource, "EXPLICIT_WAYBILL_HISTORY");
  const reloaded = new MemoryStorage();
  reloaded.values = new Map([...storage.values].map(([key, value]) => [key, structuredClone(value)]));
  assert.equal((await observePnoEvidencePage(reloaded, locator,
    [row("SEAL", "2026-09-24 03:20:00")], "2026-09-23T20:21:00.000Z"))[0]
    .classification, PNO_SCAN_CLASSES.CONFIRMED);
  const key = await pnoEvidenceKeys(locator, current);
  const stored = reloaded.values.get(key.occurrence);
  assert.equal(stored.scanInEventAt, scan);
  assert.equal(stored.scanInObservedAt, "2026-09-23T20:19:00.000Z");
  assert.equal(stored.latestObservedAction, "SEAL");
  assert.deepEqual(Object.keys(stored).filter((name) => /route|parcel_info|phone|staff/i.test(name)), []);
});

test("history ingestion requires the exact PNO, locator, target store and vehicle-arrival anchor", async () => {
  const current = row("SHIPMENT_WAREHOUSE_SCAN", downstream);
  for (const [otherLocator, otherRow, supplied] of [
    [locator, current, history("OTHER_PNO")],
    [{ ...locator, nextStoreId: "OTHER_STORE" }, current, history()],
    [locator, { ...current, real_arrive_time: "" }, history()],
    [locator, { ...current, real_arrive_time: "2026-09-25 02:58:37" }, history()],
    [locator, current, history("TEST_PNO_A", [
      ["ARRIVAL_GOODS_VAN_CHECK_SCAN", arrival, "OTHER_STORE"],
      ["ARRIVAL_WAREHOUSE_SCAN", scan, "STORE_CURRENT"]])],
    [locator, current, history("TEST_PNO_A", [
      ["ARRIVAL_GOODS_VAN_CHECK_SCAN", "2026-09-24 02:58:38", "STORE_CURRENT"],
      ["ARRIVAL_WAREHOUSE_SCAN", scan, "STORE_CURRENT"]])],
  ]) {
    const storage = new MemoryStorage();
    assert.equal((await ingestPnoExactHistory(storage, otherLocator, otherRow, supplied,
      departedAt)).classification, PNO_SCAN_CLASSES.INSUFFICIENT);
    assert.equal(storage.writes, 0);
  }
});

test("other-HUB, absent, vehicle-only, out-of-window or malformed scan history cannot confirm", async () => {
  const current = row("SHIPMENT_WAREHOUSE_SCAN", downstream);
  for (const event of [
    ["ARRIVAL_WAREHOUSE_SCAN", scan, "STORE_OLD"],
    ["ARRIVAL_GOODS_VAN_CHECK_SCAN", scan, "STORE_CURRENT"],
    ["ARRIVAL_WAREHOUSE_SCAN", "2026-09-24 02:57:00", "STORE_CURRENT"],
    ["ARRIVAL_WAREHOUSE_SCAN", "2026-09-24 03:19:00", "STORE_CURRENT"],
    ["ARRIVAL_WAREHOUSE_SCAN", "bad", "STORE_CURRENT"],
  ]) {
    const storage = new MemoryStorage();
    const supplied = history("TEST_PNO_A", [
      ["ARRIVAL_GOODS_VAN_CHECK_SCAN", arrival, "STORE_CURRENT"], event]);
    assert.equal((await ingestPnoExactHistory(storage, locator, current, supplied,
      departedAt)).classification, PNO_SCAN_CLASSES.INSUFFICIENT);
    assert.equal(storage.writes, 0);
  }
});

test("history cannot cross occurrence, segment or HUB and does not add acquisition", async () => {
  const storage = new MemoryStorage();
  const current = row("SHIPMENT_WAREHOUSE_SCAN", downstream);
  await ingestPnoExactHistory(storage, locator, current, history(), departedAt);
  for (const [otherLocator, otherRow] of [
    [{ ...locator, day: "2026-09-25" }, row("SHIPMENT_WAREHOUSE_SCAN", "2026-09-25 03:17:54",
      { real_arrive_time: "2026-09-25 02:58:37" })],
    [{ ...locator, lineId: "OTHER_LINE" }, current],
    [{ ...locator, hub: "OTHER_HUB" }, current],
  ]) {
    const view = await observePnoEvidencePage(storage, otherLocator, [otherRow], departedAt);
    assert.notEqual(view[0].classification, PNO_SCAN_CLASSES.CONFIRMED);
  }
  const source = readFileSync(new URL("../../worker/src/pno-inbound-scan-evidence.js", import.meta.url), "utf8");
  const ingest = source.slice(source.indexOf("export async function ingestPnoExactHistory"));
  assert.doesNotMatch(ingest, /\bfetch\s*\(|curl_pno|setInterval|setTimeout|WebSocket|EventSource/);
  assert.doesNotMatch(source, /CONFIRMED_MISSED_SCAN/);
});

test("malformed later history cannot erase a prior positive or reveal it before acquisition", async () => {
  const storage = new MemoryStorage();
  const current = row("SHIPMENT_WAREHOUSE_SCAN", downstream);
  const observedAt = "2026-09-23T20:19:00.000Z";
  await ingestPnoExactHistory(storage, locator, current, history(), observedAt);
  const key = await pnoEvidenceKeys(locator, current);
  const original = structuredClone(storage.values.get(key.occurrence));
  assert.notEqual(projectPnoEvidence(original, { asOf: "2026-09-23T20:18:59.000Z" })
    .classification, PNO_SCAN_CLASSES.CONFIRMED);
  const writes = storage.writes;
  assert.equal((await ingestPnoExactHistory(storage, locator, current,
    { data: { result: { parcel_info: { pno: "TEST_PNO_A" }, parcel_routes: null } } },
    "2026-09-23T20:22:00.000Z")).classification, PNO_SCAN_CLASSES.INSUFFICIENT);
  assert.equal(storage.writes, writes);
  assert.deepEqual(storage.values.get(key.occurrence), original);
});

test("vehicle arrival is not parcel scan-in and a snapshot scan has unresolved location", () => {
  const first = observePnoSnapshot(null, locator, row("ARRIVAL_GOODS_VAN_CHECK_SCAN", arrival),
    arrivedAt, { monitoringStartedAt: before, coverageComplete: true });
  assert.equal(first.record.arrivalStageObserved, true);
  assert.equal(first.record.scanInObserved, false);
  assert.notEqual(first.view.classification, PNO_SCAN_CLASSES.CONFIRMED);
  const positive = observePnoSnapshot(first.record, locator, row("ARRIVAL_WAREHOUSE_SCAN", scan),
    scannedAt, { coverageComplete: true });
  assert.deepEqual(positive.view, { classification: PNO_SCAN_CLASSES.INSUFFICIENT,
    reason: "LOCATION_OR_OCCURRENCE_UNRESOLVED" });
  assert.equal(positive.record.scanInObserved, false);
  assert.equal(positive.record.scanInLocationUnresolvedAt, scannedAt);
  assert.equal(positive.record.latestObservedAction, "ARRIVAL_WAREHOUSE_SCAN");
});

test("ambiguous snapshot cannot become a gap from location uncertainty or later sorting", () => {
  const first = observePnoSnapshot(null, locator, row("DRIVER_SIGN", arrival), arrivedAt,
    { monitoringStartedAt: before, coverageComplete: true });
  const ambiguous = observePnoSnapshot(first.record, locator,
    row("ARRIVAL_WAREHOUSE_SCAN", scan), scannedAt, { coverageComplete: true });
  assert.equal(ambiguous.view.reason, "LOCATION_OR_OCCURRENCE_UNRESOLVED");
  assert.equal(ambiguous.record.scanInObserved, false);
  const later = observePnoSnapshot(ambiguous.record, locator,
    row("SHIPMENT_WAREHOUSE_SCAN", downstream), departedAt, { coverageComplete: true });
  assert.equal(later.view.reason, "LOCATION_OR_OCCURRENCE_UNRESOLVED");
  const sorting = observePnoSnapshot(later.record, locator,
    row("SORTING", "2026-09-24 03:20:00"), "2026-09-23T20:20:01Z");
  assert.notEqual(sorting.view.classification, PNO_SCAN_CLASSES.CONFIRMED);
  assert.equal(sorting.record.scanInObserved, false);
});

test("legacy snapshot and unknown positives are readable but cannot confirm or leak", async () => {
  const storage = new MemoryStorage();
  const legacy = legacyHistoryPositive(observePnoSnapshot(null, locator,
    row("ARRIVAL_WAREHOUSE_SCAN", scan), scannedAt).record);
  for (const source of ["FOLLOWSTART_LIST_SNAPSHOT", "UNKNOWN", null]) {
    const key = await pnoEvidenceKeys(locator, row("ARRIVAL_WAREHOUSE_SCAN", scan));
    const unsafe = { ...legacy, scanInSource: source };
    storage.values.set(key.legacyOccurrence, structuredClone(unsafe));
    const [view] = await observePnoEvidencePage(storage, locator,
      [row("SHIPMENT_WAREHOUSE_SCAN", downstream)], departedAt);
    assert.deepEqual(view, { classification: PNO_SCAN_CLASSES.INSUFFICIENT,
      reason: "LOCATION_OR_OCCURRENCE_UNRESOLVED" });
    assert.deepEqual(storage.values.get(key.legacyOccurrence), unsafe,
      "legacy record is not deleted or rewritten");
    const cached = { sourceValid: true, parcels: [{ pno: "TEST_PNO_A",
      arrivalAnchorAt: arrival, scanEvidence: { classification: PNO_SCAN_CLASSES.INSUFFICIENT } }] };
    await reconcilePnoCachedPositive(storage, locator, cached);
    assert.equal(cached.parcels[0].scanEvidence.classification, PNO_SCAN_CLASSES.INSUFFICIENT);
    cached.parcels[0].scanEvidence = { classification: PNO_SCAN_CLASSES.CONFIRMED };
    await reconcilePnoCachedPositive(storage, locator, cached);
    assert.equal(cached.parcels[0].scanEvidence.reason, "LOCATION_OR_OCCURRENCE_UNRESOLVED",
      "an older cached positive must not bypass the legacy provenance guard");
    storage.values.delete(key.occurrence);
  }
  const missingObservedAt = { ...legacyHistoryPositive(observePnoSnapshot(null, locator,
    row("SHIPMENT_WAREHOUSE_SCAN", downstream), departedAt).record),
    scanInSource: null, scanInObservedAt: null,
    monitoringBeforeArrival: true, coverageState: "COMPLETE_LOCAL" };
  assert.equal(projectPnoEvidence(missingObservedAt).reason,
    "LOCATION_OR_OCCURRENCE_UNRESOLVED");
});

test("trusted event location upgrades an ambiguous snapshot and retains exact sticky provenance", async () => {
  const storage = new MemoryStorage();
  const current = row("SHIPMENT_WAREHOUSE_SCAN", downstream);
  const key = await pnoEvidenceKeys(locator, current);
  const [ambiguous] = await observePnoEvidencePage(storage, locator,
    [row("ARRIVAL_WAREHOUSE_SCAN", scan)], scannedAt);
  assert.equal(ambiguous.reason, "LOCATION_OR_OCCURRENCE_UNRESOLVED");
  const accepted = await ingestPnoExactHistory(storage, locator, current, history(), departedAt);
  assert.equal(accepted.classification, PNO_SCAN_CLASSES.CONFIRMED);
  const saved = storage.values.get(key.occurrence);
  assert.equal(saved.scanInStoreId, locator.nextStoreId);
  assert.equal(saved.scanInSource, "EXPLICIT_WAYBILL_HISTORY");
  assert.equal(saved.scanInAction, "ARRIVAL_WAREHOUSE_SCAN");
  assert.equal(saved.scanInEventAt, scan);
  assert.deepEqual(Object.keys(saved.occurrence),
    ["hub", "proofId", "day", "lineId", "sourceStoreId", "targetStoreId", "pno"]);
  assert.equal(projectPnoEvidence({ ...saved, scanInStoreId: "OTHER_STORE" }).reason,
    "LOCATION_OR_OCCURRENCE_UNRESOLVED");
  const later = observePnoSnapshot(saved, locator,
    row("ARRIVAL_WAREHOUSE_SCAN", "2026-09-24 03:20:00"),
    "2026-09-23T20:20:01Z");
  assert.equal(later.view.classification, PNO_SCAN_CLASSES.CONFIRMED);
  assert.equal(later.record.scanInEventAt, scan);
  const sorting = observePnoSnapshot(later.record, locator,
    row("SORTING", "2026-09-24 03:21:00"), "2026-09-23T20:21:01Z");
  assert.equal(sorting.view.classification, PNO_SCAN_CLASSES.CONFIRMED);
});

test("untrusted legacy positive upgrades only after matched event-level history", async () => {
  const storage = new MemoryStorage();
  const current = row("SHIPMENT_WAREHOUSE_SCAN", downstream);
  const key = await pnoEvidenceKeys(locator, current);
  storage.values.set(key.occurrence, { ...legacyHistoryPositive(
    observePnoSnapshot(null, locator, current, departedAt).record),
    scanInSource: "FOLLOWSTART_LIST_SNAPSHOT" });
  assert.equal(projectPnoEvidence(storage.values.get(key.occurrence)).reason,
    "LOCATION_OR_OCCURRENCE_UNRESOLVED");
  const denied = await ingestPnoExactHistory(storage, locator, current,
    history("TEST_PNO_A", [
      ["ARRIVAL_GOODS_VAN_CHECK_SCAN", arrival, "STORE_CURRENT"],
      ["ARRIVAL_WAREHOUSE_SCAN", scan, "DOWNSTREAM_HUB"],
    ]), departedAt);
  assert.notEqual(denied.classification, PNO_SCAN_CLASSES.CONFIRMED);
  const noLocation = await ingestPnoExactHistory(storage, locator, current,
    history("TEST_PNO_A", [
      ["ARRIVAL_GOODS_VAN_CHECK_SCAN", arrival, "STORE_CURRENT"],
      ["ARRIVAL_WAREHOUSE_SCAN", scan, ""],
    ]), departedAt);
  assert.notEqual(noLocation.classification, PNO_SCAN_CLASSES.CONFIRMED);
  assert.equal(storage.values.get(key.occurrence).scanInSource, "FOLLOWSTART_LIST_SNAPSHOT");
  const accepted = await ingestPnoExactHistory(storage, locator, current, history(), departedAt);
  assert.equal(accepted.classification, PNO_SCAN_CLASSES.CONFIRMED);
  assert.equal(storage.values.get(key.occurrence).scanInStoreId, "STORE_CURRENT");
});

test("classification and cached reconciliation contain no network or history acquisition", () => {
  const source = readFileSync(new URL("../../worker/src/pno-inbound-scan-evidence.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(|\bapiGet\s*\(|curl_pno|setInterval|WebSocket|EventSource/);
  assert.match(source, /scanInStoreId = targetStore/);
  assert.match(source, /LOCATION_OR_OCCURRENCE_UNRESOLVED/);
});

test("trusted scan-in survives later outbound and multiple subsequent snapshots", () => {
  let state = legacyHistoryPositive(
    observePnoSnapshot(null, locator, row("ARRIVAL_WAREHOUSE_SCAN", scan), scannedAt).record);
  for (const [action, time, acquired] of [
    ["SHIPMENT_WAREHOUSE_SCAN", downstream, departedAt],
    ["SEAL", "2026-09-24 03:20:00", "2026-09-23T20:20:01.000Z"],
    ["RECEIVED", "2026-09-24 03:22:00", "2026-09-23T20:22:01.000Z"],
  ]) {
    const next = observePnoSnapshot(state, locator, row(action, time), acquired);
    assert.equal(next.view.classification, PNO_SCAN_CLASSES.CONFIRMED);
    assert.equal(next.record.scanInEventAt, scan);
    assert.equal(next.record.scanInObservedAt, scannedAt);
    state = next.record;
  }
});

test("older ambiguous scan does not regress the latest downstream action", () => {
  const later = observePnoSnapshot(null, locator,
    row("SHIPMENT_WAREHOUSE_SCAN", downstream), departedAt).record;
  const positive = observePnoSnapshot(later, locator,
    row("ARRIVAL_WAREHOUSE_SCAN", scan), "2026-09-23T20:19:00.000Z");
  assert.equal(positive.view.classification, PNO_SCAN_CLASSES.INSUFFICIENT);
  assert.equal(positive.view.reason, "LOCATION_OR_OCCURRENCE_UNRESOLVED");
  assert.equal(positive.record.latestObservedAction, "SHIPMENT_WAREHOUSE_SCAN");
  assert.equal(positive.record.latestObservedActionAt, downstream);
});

test("only continuous pre-arrival monitoring through downstream can support a gap", () => {
  const first = observePnoSnapshot(null, locator, row("ARRIVAL_GOODS_VAN_CHECK_SCAN", arrival),
    arrivedAt, { monitoringStartedAt: before, coverageComplete: true });
  const gap = observePnoSnapshot(first.record, locator, row("SHIPMENT_WAREHOUSE_SCAN", downstream),
    departedAt, { coverageComplete: true });
  assert.equal(gap.view.classification, PNO_SCAN_CLASSES.SUSPECTED);
  assert.equal(gap.record.scanInObserved, false);
  const missingInterval = observePnoSnapshot(first.record, locator,
    row("SHIPMENT_WAREHOUSE_SCAN", downstream), departedAt);
  assert.equal(missingInterval.view.classification, PNO_SCAN_CLASSES.INSUFFICIENT);
  assert.equal(missingInterval.view.reason, "OBSERVATION_WINDOW_NOT_COVERED");
  assert.equal(missingInterval.record.coverageState, "UNKNOWN");
  assert.equal(first.view.classification, PNO_SCAN_CLASSES.NOT_YET);
});

test("late monitoring cannot claim coverage; invalid arrival anchor remains technical unknown", () => {
  const late = observePnoSnapshot(null, locator, row("SHIPMENT_WAREHOUSE_SCAN", downstream), departedAt,
    { coverageComplete: true });
  assert.equal(late.view.classification, PNO_SCAN_CLASSES.INSUFFICIENT);
  assert.equal(late.view.reason, "LATE_START_SCAN_STATE_UNKNOWN");
  assert.equal(late.record.coverageState, "LATE_START");
  const missing = observePnoSnapshot(null, locator,
    row("ARRIVAL_WAREHOUSE_SCAN", scan, { real_arrive_time: "" }), scannedAt);
  assert.equal(missing.changed, false);
  assert.equal(missing.view.classification, PNO_SCAN_CLASSES.INSUFFICIENT);
});

test("previously persisted negative records reproject safely without a migration", () => {
  const base = { monitoringStartedAt: departedAt, lastObservedAt: departedAt,
    arrivalStageObserved: false, downstreamObserved: true, scanInObserved: false };
  assert.deepEqual(projectPnoEvidence({ ...base, coverageState: "LATE_START", monitoringBeforeArrival: false }),
    { classification: PNO_SCAN_CLASSES.INSUFFICIENT, reason: "LATE_START_SCAN_STATE_UNKNOWN" });
  assert.deepEqual(projectPnoEvidence({ ...base, coverageState: "UNKNOWN", monitoringBeforeArrival: true }),
    { classification: PNO_SCAN_CLASSES.INSUFFICIENT, reason: "OBSERVATION_WINDOW_NOT_COVERED" });
  assert.equal(projectPnoEvidence({ ...base, coverageState: "COMPLETE_LOCAL", monitoringBeforeArrival: false })
    .classification, PNO_SCAN_CLASSES.INSUFFICIENT);
});

test("a cached legacy late-start occurrence reprojects unknown on its next ordinary page read", async () => {
  const storage = new MemoryStorage();
  const current = row("SHIPMENT_WAREHOUSE_SCAN", downstream);
  const key = await pnoEvidenceKeys(locator, current);
  storage.values.set(key.legacyOccurrence, { arrivalAnchorAt: arrival, monitoringStartedAt: departedAt,
    monitoringBeforeArrival: false, lastObservedAt: departedAt,
    latestObservedAction: "SHIPMENT_WAREHOUSE_SCAN", latestObservedActionAt: downstream,
    downstreamObserved: true, scanInObserved: false, coverageState: "LATE_START" });
  const [view] = await observePnoEvidencePage(storage, locator, [current], departedAt);
  assert.deepEqual(view, { classification: PNO_SCAN_CLASSES.INSUFFICIENT,
    reason: "LATE_START_SCAN_STATE_UNKNOWN" });
  assert.equal(storage.writes, 2, "legacy state is copied to the stable occurrence and base");
  assert.equal(storage.values.get(key.occurrence).arrivalAnchorAt, arrival);
});

test("vehicle arrival is not a gap, unverified downstream stays unknown, pre-arrival stays NOT_YET", async () => {
  const storage = new MemoryStorage();
  const pre = await observePnoEvidencePage(storage, locator, [row("RECEIVED",
    "2026-09-24 02:30:00", { real_arrive_time: "", store_id: "STORE_BEFORE" })], before);
  assert.equal(pre[0].classification, PNO_SCAN_CLASSES.NOT_YET);
  for (const [action, time] of [
    ["ARRIVAL_GOODS_VAN_CHECK_SCAN", arrival], ["SEAL", "2026-09-24 03:20:00"],
    ["RECEIVED", "2026-09-24 03:22:00"],
  ]) {
    const observed = observePnoSnapshot(null, locator, row(action, time), departedAt);
    assert.equal(observed.view.classification, action === "ARRIVAL_GOODS_VAN_CHECK_SCAN"
      ? PNO_SCAN_CLASSES.NOT_YET : PNO_SCAN_CLASSES.INSUFFICIENT);
    assert.equal(observed.record.scanInObserved, false);
  }
});

test("pre-arrival monitoring rejects unrelated store and malformed event time", async () => {
  const storage = new MemoryStorage();
  for (const invalid of [
    row("RECEIVED", "2026-09-24 02:30:00", { real_arrive_time: "", store_id: "STORE_OTHER" }),
    row("RECEIVED", "invalid", { real_arrive_time: "", store_id: "STORE_BEFORE" }),
  ]) {
    const view = await observePnoEvidencePage(storage, locator, [invalid], before);
    assert.equal(view[0].classification, PNO_SCAN_CLASSES.INSUFFICIENT);
  }
  assert.equal(storage.writes, 0);
});

test("positively verified pre-arrival stage stays distinct from a suspected gap", () => {
  const view = projectPnoEvidence({ monitoringStartedAt: before, lastObservedAt: arrivedAt,
    preArrivalStageObserved: true, arrivalStageObserved: false, downstreamObserved: false,
    coverageState: "UNKNOWN", scanInObserved: false });
  assert.equal(view.classification, PNO_SCAN_CLASSES.NOT_YET);
  const unknown = projectPnoEvidence({ monitoringStartedAt: before, lastObservedAt: arrivedAt,
    preArrivalStageObserved: false, arrivalStageObserved: false, downstreamObserved: false,
    coverageState: "UNKNOWN", scanInObserved: false });
  assert.equal(unknown.classification, PNO_SCAN_CLASSES.INSUFFICIENT);
});

test("arrival refinement keeps one key; a distinct day or HUB keeps isolated keys", async () => {
  const a = await pnoEvidenceKeys(locator, row("ARRIVAL_WAREHOUSE_SCAN", scan));
  const b = await pnoEvidenceKeys(locator,
    row("SHIPMENT_WAREHOUSE_SCAN", "2026-09-25 03:17:54", { real_arrive_time: "2026-09-25 02:58:37" }));
  const c = await pnoEvidenceKeys({ ...locator, hub: "NE2" }, row("ARRIVAL_WAREHOUSE_SCAN", scan));
  assert.equal(a.occurrence, b.occurrence);
  const nextDay = await pnoEvidenceKeys({ ...locator, day: "2026-09-25" },
    row("SHIPMENT_WAREHOUSE_SCAN", "2026-09-25 03:17:54",
      { real_arrive_time: "2026-09-25 02:58:37" }));
  assert.notEqual(a.occurrence, nextDay.occurrence);
  assert.notEqual(a.occurrence, c.occurrence);
  const storage = new MemoryStorage();
  const current = row("SHIPMENT_WAREHOUSE_SCAN", downstream);
  assert.equal((await ingestPnoExactHistory(storage, locator, current, history(),
    departedAt)).classification, PNO_SCAN_CLASSES.CONFIRMED);
  assert.equal((await observePnoEvidencePage(storage, { ...locator, day: "2026-09-25" },
    [row("SHIPMENT_WAREHOUSE_SCAN", "2026-09-25 03:17:54",
      { real_arrive_time: "2026-09-25 02:58:37" })], "2026-09-24T20:18:00.000Z"))[0]
    .classification, PNO_SCAN_CLASSES.INSUFFICIENT);
  assert.equal((await observePnoEvidencePage(storage, { ...locator, hub: "NE2" },
    [row("SHIPMENT_WAREHOUSE_SCAN", downstream)], departedAt))[0].classification,
    PNO_SCAN_CLASSES.INSUFFICIENT);
});

test("every exact identity component isolates remembered positive scan state", async () => {
  const storage = new MemoryStorage();
  await ingestPnoExactHistory(storage, locator,
    row("SHIPMENT_WAREHOUSE_SCAN", downstream), history(), departedAt);
  const variants = [
    [{ ...locator, hub: "NE2" }, row("SHIPMENT_WAREHOUSE_SCAN", downstream)],
    [{ ...locator, proofId: "PROOF_B" }, row("SHIPMENT_WAREHOUSE_SCAN", downstream)],
    [{ ...locator, day: "2026-09-25" }, row("SHIPMENT_WAREHOUSE_SCAN", downstream)],
    [{ ...locator, lineId: "LINE_B" }, row("SHIPMENT_WAREHOUSE_SCAN", downstream)],
    [{ ...locator, storeId: "OTHER_SOURCE" }, row("SHIPMENT_WAREHOUSE_SCAN", downstream)],
    [{ ...locator, nextStoreId: "OTHER_TARGET" },
      row("SHIPMENT_WAREHOUSE_SCAN", downstream, { store_id: "OTHER_TARGET" })],
    [locator, row("SHIPMENT_WAREHOUSE_SCAN", downstream, { pno: "TEST_PNO_B" })],
  ];
  for (const [otherLocator, otherRow, observedAt = departedAt] of variants) {
    const [view] = await observePnoEvidencePage(storage, otherLocator, [otherRow], observedAt);
    assert.notEqual(view.classification, PNO_SCAN_CLASSES.CONFIRMED);
  }
});

test("invalid store, unknown action, malformed timestamps and duplicates do not overwrite facts", async () => {
  const storage = new MemoryStorage();
  const positive = row("ARRIVAL_WAREHOUSE_SCAN", scan);
  await ingestPnoExactHistory(storage, locator,
    row("SHIPMENT_WAREHOUSE_SCAN", downstream), history(), departedAt);
  const duplicate = await observePnoEvidencePage(storage, locator, [positive], scannedAt);
  assert.equal(duplicate[0].classification, PNO_SCAN_CLASSES.CONFIRMED);
  const count = storage.writes;
  const acceptedKey = await pnoEvidenceKeys(locator, positive);
  assert.equal(storage.values.get(acceptedKey.occurrence).scanInSource, "EXPLICIT_WAYBILL_HISTORY");
  for (const invalid of [
    row("ARRIVAL_WAREHOUSE_SCAN", scan, { store_id: "STORE_OTHER" }),
    row("UNKNOWN_ACTION", downstream),
    row("ARRIVAL_WAREHOUSE_SCAN", "BAD_TIMESTAMP"),
  ]) {
    const output = await observePnoEvidencePage(storage, locator, [invalid], departedAt);
    assert.equal(output[0].classification, PNO_SCAN_CLASSES.CONFIRMED);
    assert.equal(output[0].observationIssue.classification, PNO_SCAN_CLASSES.INSUFFICIENT);
    assert.equal(storage.writes, count);
  }
});

test("provider failure and malformed response preserve accepted evidence", async () => {
  const storage = new MemoryStorage();
  const accepted = row("ARRIVAL_WAREHOUSE_SCAN", scan);
  await observePnoEvidencePage(storage, locator, [accepted], scannedAt);
  const originalWrites = storage.writes;
  const owner = { ctx: { storage } };
  await assert.rejects(readSharedPnoPage(owner, {}, { ...locator, force: true }, {
    readCredential: async () => ({}), fetchDetailPage: async () => { throw Error("provider unavailable"); },
  }));
  assert.equal(storage.writes, originalWrites);
  const invalid = await readSharedPnoPage(owner, {}, { ...locator, force: true }, {
    readCredential: async () => ({}),
    fetchDetailPage: async () => ({ items: [row("SHIPMENT_WAREHOUSE_SCAN", downstream)], total: 1, sourceValid: false }),
  });
  assert.equal(invalid.parcels[0].scanEvidence.classification, PNO_SCAN_CLASSES.INSUFFICIENT);
  assert.equal(storage.writes, originalWrites);
});

test("storage failure yields technical unknown rather than a fabricated scan gap", async () => {
  const owner = { ctx: { storage: { transaction: async () => { throw Error("storage unavailable"); } } } };
  const page = await readSharedPnoPage(owner, {}, locator, {
    now: () => Date.parse(departedAt), readCredential: async () => ({}),
    fetchDetailPage: async () => ({ items: [row("SHIPMENT_WAREHOUSE_SCAN", downstream)],
      total: 1, sourceValid: true }),
  });
  assert.equal(page.parcels[0].scanEvidence.classification, PNO_SCAN_CLASSES.INSUFFICIENT);
  assert.equal(page.parcels[0].scanEvidence.reason, "EVIDENCE_STORAGE_UNAVAILABLE");
});

test("as-of reads do not reveal scan-in before evidence acquisition", () => {
  const accepted = legacyHistoryPositive(observePnoSnapshot(null, locator,
    row("ARRIVAL_WAREHOUSE_SCAN", scan), scannedAt, { monitoringStartedAt: before }).record);
  assert.notEqual(projectPnoEvidence(accepted, { asOf: "2026-09-23T20:12:19Z" }).classification,
    PNO_SCAN_CLASSES.CONFIRMED);
  assert.equal(projectPnoEvidence(accepted, { asOf: scannedAt }).classification,
    PNO_SCAN_CLASSES.CONFIRMED);
});

test("one, ten and one hundred viewers share a single ambiguous detail request", async () => {
  for (const viewers of [1, 10, 100]) {
    const owner = { ctx: { storage: new MemoryStorage() } };
    let calls = 0;
    const deps = { now: () => Date.parse(scannedAt), readCredential: async () => ({}),
      fetchDetailPage: async () => { calls += 1; return { items: [row("ARRIVAL_WAREHOUSE_SCAN", scan)],
        total: 1, sourceValid: true }; } };
    const pages = await Promise.all(Array.from({ length: viewers }, () =>
      readSharedPnoPage(owner, {}, locator, deps)));
    assert.equal(calls, 1);
    assert.ok(pages.every((page) => page.parcels[0].scanEvidence.reason ===
      "LOCATION_OR_OCCURRENCE_UNRESOLVED"));
  }
});

test("a positive fact refreshes another tab's cached negative projection", async () => {
  const owner = { ctx: { storage: new MemoryStorage() } };
  const deps = { now: () => Date.parse(departedAt), readCredential: async () => ({}),
    fetchDetailPage: async (_credentials, request) => ({ items: [request.type === "total"
      ? row("ARRIVAL_WAREHOUSE_SCAN", scan) : row("SHIPMENT_WAREHOUSE_SCAN", downstream)],
    total: 1, sourceValid: true }) };
  const negative = await readSharedPnoPage(owner, {}, { ...locator, type: "no_entry" }, deps);
  assert.equal(negative.parcels[0].scanEvidence.classification, PNO_SCAN_CLASSES.INSUFFICIENT);
  await ingestPnoExactHistory(owner.ctx.storage, locator,
    row("SHIPMENT_WAREHOUSE_SCAN", downstream), history(), departedAt);
  const positive = await readSharedPnoPage(owner, {}, locator, deps);
  assert.equal(positive.parcels[0].scanEvidence.classification, PNO_SCAN_CLASSES.CONFIRMED);
  const cached = await readSharedPnoPage(owner, {}, { ...locator, type: "no_entry" }, deps);
  assert.equal(cached.cacheState, "HIT");
  assert.equal(cached.parcels[0].scanEvidence.classification, PNO_SCAN_CLASSES.CONFIRMED);
});

test("late-start downstream, then an accepted exact scan-in, remains confirmed across owners and cached reopen", async () => {
  const storage = new MemoryStorage();
  const lateLocator = { ...locator, day: "2026-09-30" };
  const anchor = "2026-09-30 00:38:48";
  const scanAt = "2026-09-30 01:07:28";
  const downstreamAt = "2026-09-30 01:13:27";
  const observedAt = "2026-09-29T18:15:00.000Z";
  const source = (action, time) => row(action, time, { real_arrive_time: anchor });
  const staleOwner = { ctx: { storage } };
  const freshOwner = { ctx: { storage } };
  let upstreamCalls = 0;
  const deps = { now: () => Date.parse(observedAt), readCredential: async () => ({}),
    fetchDetailPage: async () => { upstreamCalls += 1; return {
      items: [source("SHIPMENT_WAREHOUSE_SCAN", downstreamAt)], total: 1, sourceValid: true,
    }; } };
  const unknown = await readSharedPnoPage(staleOwner, {}, lateLocator, deps);
  assert.deepEqual(unknown.parcels[0].scanEvidence, { classification: PNO_SCAN_CLASSES.INSUFFICIENT,
    reason: "LATE_START_SCAN_STATE_UNKNOWN" });
  // A snapshot cannot identify the scan location; the already supplied
  // event-level history can, without a new provider request in this reducer.
  const [ambiguous] = await observePnoEvidencePage(storage, lateLocator,
    [source("ARRIVAL_WAREHOUSE_SCAN", scanAt)], observedAt);
  assert.equal(ambiguous.reason, "LOCATION_OR_OCCURRENCE_UNRESOLVED");
  const positive = await ingestPnoExactHistory(storage, lateLocator,
    source("SHIPMENT_WAREHOUSE_SCAN", downstreamAt), history("TEST_PNO_A", [
      ["ARRIVAL_GOODS_VAN_CHECK_SCAN", anchor, "STORE_CURRENT"],
      ["ARRIVAL_WAREHOUSE_SCAN", scanAt, "STORE_CURRENT"],
      ["SHIPMENT_WAREHOUSE_SCAN", downstreamAt, "STORE_CURRENT"],
    ]), observedAt);
  assert.equal(positive.classification, PNO_SCAN_CLASSES.CONFIRMED);
  const [later] = await observePnoEvidencePage(storage, lateLocator,
    [source("SHIPMENT_WAREHOUSE_SCAN", downstreamAt)], observedAt);
  assert.equal(later.classification, PNO_SCAN_CLASSES.CONFIRMED);
  const reopened = await readSharedPnoPage(staleOwner, {}, lateLocator, deps);
  assert.equal(reopened.cacheState, "HIT");
  assert.equal(reopened.parcels[0].scanEvidence.classification, PNO_SCAN_CLASSES.CONFIRMED);
  assert.equal(upstreamCalls, 1, "cached reconciliation adds no provider request");
  const otherLine = await readSharedPnoPage(freshOwner, {},
    { ...lateLocator, lineId: "ANOTHER_LINE" }, deps);
  assert.equal(otherLine.parcels[0].scanEvidence.classification, PNO_SCAN_CLASSES.INSUFFICIENT);
  const otherDay = await readSharedPnoPage(freshOwner, {},
    { ...lateLocator, day: "2026-10-01", page: 2 }, { ...deps, fetchDetailPage: async () => ({
      items: [row("SHIPMENT_WAREHOUSE_SCAN", "2026-09-30 02:13:27",
        { real_arrive_time: "2026-09-30 01:38:48" })], total: 1, sourceValid: true,
    }) });
  assert.equal(otherDay.parcels[0].scanEvidence.classification, PNO_SCAN_CLASSES.INSUFFICIENT);
});

test("cached positive projection cannot cross a route segment", async () => {
  const owner = { ctx: { storage: new MemoryStorage() } };
  const deps = { now: () => Date.parse(departedAt), readCredential: async () => ({}),
    fetchDetailPage: async (_credentials, request) => ({
      items: [row(request.lineId === "OTHER_LINE" ? "SHIPMENT_WAREHOUSE_SCAN" :
        "ARRIVAL_WAREHOUSE_SCAN", request.lineId === "OTHER_LINE" ? downstream : scan)],
      total: 1, sourceValid: true,
    }) };
  const other = { ...locator, lineId: "OTHER_LINE" };
  assert.equal((await readSharedPnoPage(owner, {}, other, deps)).parcels[0].scanEvidence.classification,
    PNO_SCAN_CLASSES.INSUFFICIENT);
  await ingestPnoExactHistory(owner.ctx.storage, locator,
    row("SHIPMENT_WAREHOUSE_SCAN", downstream), history(), departedAt);
  assert.equal((await readSharedPnoPage(owner, {}, locator, deps)).parcels[0].scanEvidence.classification,
    PNO_SCAN_CLASSES.CONFIRMED);
  assert.equal((await readSharedPnoPage(owner, {}, other, deps)).parcels[0].scanEvidence.classification,
    PNO_SCAN_CLASSES.INSUFFICIENT);
});

test("concurrent detail tabs cannot erase a positive event", async () => {
  const owner = { ctx: { storage: new MemoryStorage() } };
  const deps = { now: () => Date.parse(departedAt), readCredential: async () => ({}),
    fetchDetailPage: async (_credentials, request) => ({ items: [request.type === "total"
      ? row("ARRIVAL_WAREHOUSE_SCAN", scan) : row("SHIPMENT_WAREHOUSE_SCAN", downstream)],
    total: 1, sourceValid: true }) };
  await Promise.all([
    readSharedPnoPage(owner, {}, { ...locator, type: "no_entry" }, deps),
    readSharedPnoPage(owner, {}, locator, deps),
  ]);
  await ingestPnoExactHistory(owner.ctx.storage, locator,
    row("SHIPMENT_WAREHOUSE_SCAN", downstream), history(), departedAt);
  const after = await readSharedPnoPage(owner, {}, { ...locator, type: "no_entry" }, deps);
  assert.equal(after.parcels[0].scanEvidence.classification, PNO_SCAN_CLASSES.CONFIRMED);
  const key = await pnoEvidenceKeys(locator, row("ARRIVAL_WAREHOUSE_SCAN", scan));
  assert.equal(owner.ctx.storage.values.get(key.occurrence).scanInObserved, true);
});

test("scan-gap tab shows gaps and technical unknowns without history controls", () => {
  const staged = stageFrontend(readFileSync(new URL("../../ms.js", import.meta.url), "utf8"));
  assert.match(staged, /data-pno-v18-type="bag">แบ็กกิ้ง<\/button>' \+\s*'<button type="button" data-pno-v18-type="scan_gap">หลักฐานสแกนเข้า/);
  assert.match(staged, /else if \(type === "scan_gap"\) void pnoInboundLoad\(1\)/);
  assert.match(staged, /const result = await pnoV18Fetch\("total", pnoV18State\.page\)/);
  const load = staged.slice(staged.indexOf("async function pnoInboundLoad(page) {"), staged.indexOf("function pnoV18SetActive(type)"));
  assert.doesNotMatch(load, /await pnoV18EnsureParcelFilterRows\(\)/);
  assert.match(load, /pnoV18RenderFilters\(\)/);
  assert.doesNotMatch(load, /pnoInboundToggleActions\(true\)|pno-v18-filterbar"\)\.classList\.add\("hidden"\)/);
  const start = staged.indexOf("function pnoInboundRender(rows) {");
  const end = staged.indexOf("async function pnoInboundLoad(page) {", start);
  const actionStart = staged.indexOf("function pnoV18ParcelAction(");
  const actionEnd = staged.indexOf("\n}\n", actionStart) + 2;
  const renderSource = staged.slice(actionStart, actionEnd) + "\n" + staged.slice(start, end);
  assert.doesNotMatch(renderSource, /curl_pno|fetch\(|apiGet\(/);
  const list = { innerHTML: "" };
  const esc = (value) => String(value).replaceAll("<", "&lt;");
  const render = new Function("el", "esc", `${renderSource}; return pnoInboundRender;`)(
    () => list, esc);
  render([
    { pno: "SUSPECT", scanEvidence: { classification: PNO_SCAN_CLASSES.SUSPECTED, reason: "OBSERVED" } },
    { pno: "UNKNOWN", scanEvidence: { classification: PNO_SCAN_CLASSES.INSUFFICIENT, reason: "LATE" } },
    { pno: "SCANNED", scanEvidence: { classification: PNO_SCAN_CLASSES.CONFIRMED } },
    { pno: "PENDING", scanEvidence: { classification: PNO_SCAN_CLASSES.NOT_YET } },
  ]);
  assert.match(list.innerHTML, /หลุดสแกนเข้า/);
  assert.match(list.innerHTML, /ยังตรวจสแกนเข้าไม่ได้/);
  assert.match(list.innerHTML, /เฉพาะหน้านี้: ยืนยันว่าหลุดสแกนเข้า 1 · ยังตรวจสแกนเข้าไม่ได้ 1/);
  assert.doesNotMatch(list.innerHTML, /ตรวจประวัติ|data-pno-history|สงสัยหลุดสแกนเข้า/);
  assert.doesNotMatch(list.innerHTML, /SCANNED|PENDING/);
  assert.match(list.innerHTML, /SUSPECT|UNKNOWN/);
  assert.match(list.innerHTML, /data-pno-evidence-section="suspected"[\s\S]*SUSPECT/);
  assert.match(list.innerHTML, /data-pno-evidence-section="insufficient"[\s\S]*UNKNOWN/);
  const gapSection = list.innerHTML.split('data-pno-evidence-section="suspected"')[1]
    .split('data-pno-evidence-section="insufficient"')[0];
  assert.doesNotMatch(gapSection, /UNKNOWN/);
  render([
    { pno: "UNKNOWN_A", scanEvidence: { classification: PNO_SCAN_CLASSES.INSUFFICIENT } },
    { pno: "UNKNOWN_B", scanEvidence: { classification: PNO_SCAN_CLASSES.INSUFFICIENT } },
  ]);
  assert.match(list.innerHTML, /เฉพาะหน้านี้: ยืนยันว่าหลุดสแกนเข้า 0 · ยังตรวจสแกนเข้าไม่ได้ 2/);
  assert.match(list.innerHTML, /data-pno-evidence-zero="true"/);
  assert.doesNotMatch(list.innerHTML, /data-pno-evidence-section="suspected"/);
  assert.doesNotThrow(() => new Function(staged));
  const stagedWorker = readFileSync(new URL("../../worker/.dev-runtime/src/index.js", import.meta.url), "utf8");
  assert.match(stagedWorker, /json\.data\.DataList\.length <= PNO_PAGE_SIZE/);
  assert.match(stagedWorker, /json\.data\.DataList\.length <= Number\(json\.data\.Total\)/);
  const html = patchDevUiShellSource(readFileSync(new URL("../../ms.html", import.meta.url), "utf8"), "ms.html");
  assert.match(html, /ms\.js\?v=20261003-pno-operational-truth-v1/);
});
