import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PNO_SCAN_CLASSES, matchPnoHistoryArrival, observePnoSnapshot,
  observePnoEvidencePage, pnoEvidenceKeys, projectPnoEvidence,
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
});

test("vehicle arrival is not parcel scan-in, while the matched scan is positive", () => {
  const first = observePnoSnapshot(null, locator, row("ARRIVAL_GOODS_VAN_CHECK_SCAN", arrival),
    arrivedAt, { monitoringStartedAt: before, coverageComplete: true });
  assert.equal(first.record.arrivalStageObserved, true);
  assert.equal(first.record.scanInObserved, false);
  assert.notEqual(first.view.classification, PNO_SCAN_CLASSES.CONFIRMED);
  const positive = observePnoSnapshot(first.record, locator, row("ARRIVAL_WAREHOUSE_SCAN", scan),
    scannedAt, { coverageComplete: true });
  assert.equal(positive.view.classification, PNO_SCAN_CLASSES.CONFIRMED);
  assert.equal(positive.record.scanInEventAt, scan);
  assert.equal(positive.record.scanInSource, "FOLLOWSTART_LIST_SNAPSHOT");
});

test("scan-in survives later outbound and multiple subsequent snapshots", () => {
  let state = observePnoSnapshot(null, locator, row("ARRIVAL_WAREHOUSE_SCAN", scan), scannedAt).record;
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

test("older positive arrival evidence does not regress the latest downstream action", () => {
  const later = observePnoSnapshot(null, locator,
    row("SHIPMENT_WAREHOUSE_SCAN", downstream), departedAt).record;
  const positive = observePnoSnapshot(later, locator,
    row("ARRIVAL_WAREHOUSE_SCAN", scan), "2026-09-23T20:19:00.000Z");
  assert.equal(positive.view.classification, PNO_SCAN_CLASSES.CONFIRMED);
  assert.equal(positive.record.latestObservedAction, "SHIPMENT_WAREHOUSE_SCAN");
  assert.equal(positive.record.latestObservedActionAt, downstream);
});

test("gap remains a suspicion only with attested local coverage and early monitoring", () => {
  const first = observePnoSnapshot(null, locator, row("ARRIVAL_GOODS_VAN_CHECK_SCAN", arrival),
    arrivedAt, { monitoringStartedAt: before, coverageComplete: true });
  const gap = observePnoSnapshot(first.record, locator, row("SHIPMENT_WAREHOUSE_SCAN", downstream),
    departedAt, { coverageComplete: true });
  assert.equal(gap.view.classification, PNO_SCAN_CLASSES.SUSPECTED);
  assert.equal(gap.record.scanInObserved, false);
  const missingInterval = observePnoSnapshot(first.record, locator,
    row("SHIPMENT_WAREHOUSE_SCAN", downstream), departedAt);
  assert.equal(missingInterval.view.classification, PNO_SCAN_CLASSES.INSUFFICIENT);
  assert.equal(missingInterval.record.coverageState, "UNKNOWN");
});

test("late monitoring and missing arrival anchor fail closed", () => {
  const late = observePnoSnapshot(null, locator, row("SHIPMENT_WAREHOUSE_SCAN", downstream), departedAt,
    { coverageComplete: true });
  assert.equal(late.view.classification, PNO_SCAN_CLASSES.INSUFFICIENT);
  assert.equal(late.record.coverageState, "LATE_START");
  const missing = observePnoSnapshot(null, locator,
    row("ARRIVAL_WAREHOUSE_SCAN", scan, { real_arrive_time: "" }), scannedAt);
  assert.equal(missing.changed, false);
  assert.equal(missing.view.classification, PNO_SCAN_CLASSES.INSUFFICIENT);
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

test("same PNO same store with another arrival, and same PNO different HUB, use distinct keys", async () => {
  const a = await pnoEvidenceKeys(locator, row("ARRIVAL_WAREHOUSE_SCAN", scan));
  const b = await pnoEvidenceKeys(locator,
    row("SHIPMENT_WAREHOUSE_SCAN", "2026-09-25 03:17:54", { real_arrive_time: "2026-09-25 02:58:37" }));
  const c = await pnoEvidenceKeys({ ...locator, hub: "NE2" }, row("ARRIVAL_WAREHOUSE_SCAN", scan));
  assert.notEqual(a.occurrence, b.occurrence);
  assert.notEqual(a.occurrence, c.occurrence);
  const storage = new MemoryStorage();
  assert.equal((await observePnoEvidencePage(storage, locator,
    [row("ARRIVAL_WAREHOUSE_SCAN", scan)], scannedAt))[0].classification, PNO_SCAN_CLASSES.CONFIRMED);
  assert.equal((await observePnoEvidencePage(storage, locator,
    [row("SHIPMENT_WAREHOUSE_SCAN", "2026-09-25 03:17:54",
      { real_arrive_time: "2026-09-25 02:58:37" })], "2026-09-24T20:18:00.000Z"))[0]
    .classification, PNO_SCAN_CLASSES.INSUFFICIENT);
  assert.equal((await observePnoEvidencePage(storage, { ...locator, hub: "NE2" },
    [row("SHIPMENT_WAREHOUSE_SCAN", downstream)], departedAt))[0].classification,
    PNO_SCAN_CLASSES.INSUFFICIENT);
});

test("invalid store, unknown action, malformed timestamps and duplicates do not overwrite facts", async () => {
  const storage = new MemoryStorage();
  const positive = row("ARRIVAL_WAREHOUSE_SCAN", scan);
  await observePnoEvidencePage(storage, locator, [positive], scannedAt);
  const count = storage.writes;
  const duplicate = await observePnoEvidencePage(storage, locator, [positive], scannedAt);
  assert.equal(duplicate[0].classification, PNO_SCAN_CLASSES.CONFIRMED);
  assert.equal(storage.writes, count);
  for (const invalid of [
    row("ARRIVAL_WAREHOUSE_SCAN", scan, { store_id: "STORE_OTHER" }),
    row("UNKNOWN_ACTION", downstream),
    row("ARRIVAL_WAREHOUSE_SCAN", "BAD_TIMESTAMP"),
  ]) {
    const output = await observePnoEvidencePage(storage, locator, [invalid], departedAt);
    assert.equal(output[0].classification, PNO_SCAN_CLASSES.INSUFFICIENT);
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

test("as-of reads do not reveal scan-in before evidence acquisition", () => {
  const accepted = observePnoSnapshot(null, locator,
    row("ARRIVAL_WAREHOUSE_SCAN", scan), scannedAt, { monitoringStartedAt: before }).record;
  assert.notEqual(projectPnoEvidence(accepted, { asOf: "2026-09-23T20:12:19Z" }).classification,
    PNO_SCAN_CLASSES.CONFIRMED);
  assert.equal(projectPnoEvidence(accepted, { asOf: scannedAt }).classification,
    PNO_SCAN_CLASSES.CONFIRMED);
});

test("one, ten and one hundred viewers share a single route detail request", async () => {
  for (const viewers of [1, 10, 100]) {
    const owner = { ctx: { storage: new MemoryStorage() } };
    let calls = 0;
    const deps = { now: () => Date.parse(scannedAt), readCredential: async () => ({}),
      fetchDetailPage: async () => { calls += 1; return { items: [row("ARRIVAL_WAREHOUSE_SCAN", scan)],
        total: 1, sourceValid: true }; } };
    const pages = await Promise.all(Array.from({ length: viewers }, () =>
      readSharedPnoPage(owner, {}, locator, deps)));
    assert.equal(calls, 1);
    assert.ok(pages.every((page) => page.parcels[0].scanEvidence.classification === PNO_SCAN_CLASSES.CONFIRMED));
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
  const positive = await readSharedPnoPage(owner, {}, locator, deps);
  assert.equal(positive.parcels[0].scanEvidence.classification, PNO_SCAN_CLASSES.CONFIRMED);
  const cached = await readSharedPnoPage(owner, {}, { ...locator, type: "no_entry" }, deps);
  assert.equal(cached.cacheState, "HIT");
  assert.equal(cached.parcels[0].scanEvidence.classification, PNO_SCAN_CLASSES.CONFIRMED);
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
  const after = await readSharedPnoPage(owner, {}, { ...locator, type: "no_entry" }, deps);
  assert.equal(after.parcels[0].scanEvidence.classification, PNO_SCAN_CLASSES.CONFIRMED);
  const key = await pnoEvidenceKeys(locator, row("ARRIVAL_WAREHOUSE_SCAN", scan));
  assert.equal(owner.ctx.storage.values.get(key.occurrence).scanInObserved, true);
});

test("new tab follows Backing, shows only suspected/insufficient, and renders without history traffic", () => {
  const staged = stageFrontend(readFileSync(new URL("../../ms.js", import.meta.url), "utf8"));
  assert.match(staged, /data-pno-v18-type="bag">แบ็กกิ้ง<\/button>' \+\s*'<button type="button" data-pno-v18-type="scan_gap">หลุดสแกนเข้า/);
  assert.match(staged, /else if \(type === "scan_gap"\) void pnoInboundLoad\(1\)/);
  assert.match(staged, /const result = await pnoV18Fetch\("total", pnoV18State\.page\)/);
  const load = staged.slice(staged.indexOf("async function pnoInboundLoad(page) {"), staged.indexOf("function pnoV18SetActive(type)"));
  assert.doesNotMatch(load, /await pnoV18EnsureParcelFilterRows\(\)/);
  assert.match(load, /pnoV18RenderFilters\(\)/);
  assert.doesNotMatch(load, /pnoInboundToggleActions\(true\)|pno-v18-filterbar"\)\.classList\.add\("hidden"\)/);
  const start = staged.indexOf("function pnoInboundRender(rows) {");
  const end = staged.indexOf("async function pnoInboundLoad(page) {", start);
  const renderSource = staged.slice(start, end);
  assert.doesNotMatch(renderSource, /curl_pno|fetch\(|apiGet\(/);
  const list = { innerHTML: "" };
  const esc = (value) => String(value).replaceAll("<", "&lt;");
  const render = new Function("el", "esc", `${renderSource}; return pnoInboundRender;`)(() => list, esc);
  render([
    { pno: "SUSPECT", scanEvidence: { classification: PNO_SCAN_CLASSES.SUSPECTED, reason: "OBSERVED" } },
    { pno: "UNKNOWN", scanEvidence: { classification: PNO_SCAN_CLASSES.INSUFFICIENT, reason: "LATE" } },
    { pno: "SCANNED", scanEvidence: { classification: PNO_SCAN_CLASSES.CONFIRMED } },
    { pno: "PENDING", scanEvidence: { classification: PNO_SCAN_CLASSES.NOT_YET } },
  ]);
  assert.match(list.innerHTML, /สงสัยหลุดสแกนเข้า/);
  assert.match(list.innerHTML, /ประวัติไม่เพียงพอ/);
  assert.doesNotMatch(list.innerHTML, /SCANNED|PENDING/);
  assert.match(list.innerHTML, /SUSPECT|UNKNOWN/);
  assert.doesNotThrow(() => new Function(staged));
  const stagedWorker = readFileSync(new URL("../../worker/.dev-runtime/src/index.js", import.meta.url), "utf8");
  assert.match(stagedWorker, /json\.data\.DataList\.length <= PNO_PAGE_SIZE/);
  assert.match(stagedWorker, /json\.data\.DataList\.length <= Number\(json\.data\.Total\)/);
  const html = patchDevUiShellSource(readFileSync(new URL("../../ms.html", import.meta.url), "utf8"), "ms.html");
  assert.match(html, /ms\.js\?v=20260924-pno-pending-reconcile-v1/);
});
