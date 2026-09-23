import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { stageFrontend } from "./stage-dev-runtime.mjs";
import { readSharedPnoPage } from "../../worker/.dev-runtime/src/index.js";

const staged = stageFrontend(readFileSync(new URL("../../ms.js", import.meta.url), "utf8"));
const worker = readFileSync(new URL("../../worker/.dev-runtime/src/index.js", import.meta.url), "utf8");
function section(start, end) {
  const from = staged.indexOf(start);
  const to = staged.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing staged section: ${start}`);
  return staged.slice(from, to);
}
const countSource = section("function pnoCountForType(", "// PNO_ROUND2_UI_V2");
const baseKeySource = section("function pnoBrowserBaseKey(", "function pnoBrowserPageKey(");
const locatorSource = section("function pnoV18LocatorKey(", "function pnoV18CacheGet(");
const pendingSource = section("function pnoPendingEvidenceLabel(", "function pnoV18ParcelAction(");
const rawSummarySource = section("function pnoOperationalRawSummary(", "function pnoOperationalKey(");
const modalSummarySource = section("function pnoV18RenderSummary(", "// PNO_INBOUND_SCAN_EVIDENCE_V1");
const modalNumberSource = section("function pnoV18Number(", "function pnoV18SourceRow(");
const renderRowsSource = section("function pnoV18RenderRows(", "function pnoV18ApplyPageResult(");

function makeUi() {
  const pnoV18State = { type: "no_entry", page: 1, total: 37, sourceValid: true, rows: [],
    filters: { status: "", action: "" }, filterRows: null };
  const row = { proofId: "TRIP", pnoSourceDay: "2026-09-24", pnoLineId: "LINE1",
    pnoStoreId: "BEFORE", pnoNextStoreId: "HERE", expectedParcels: 57,
    enteredParcels: 20, pendingParcels: 37 };
  const nodes = new Map();
  const el = (id) => {
    if (!nodes.has(id)) nodes.set(id, { innerHTML: "", textContent: "",
      classList: { toggle(name, hidden) { this.hidden = hidden; } } });
    return nodes.get(id);
  };
  const pnoV18ViewCache = new Map(), pnoBrowserCache = new Map();
  const nf = new Intl.NumberFormat("en-US");
  const pnoV18TextValue = (value, fallback = "-") => String(value || "").trim() || fallback;
  const pnoV18TypeLabel = (type) => type;
  const ui = new Function("deps", `const {pnoV18State, row, state, el, nf, pnoV18ViewCache,
    pnoBrowserCache, pnoV18TextValue, pnoV18TypeLabel} = deps;
    const pnoV18SourceRow = () => row;
    ${countSource}${baseKeySource}${locatorSource}${pendingSource}${rawSummarySource}
    ${modalNumberSource}${modalSummarySource}
    return {pnoCountForType, pnoBrowserBaseKey, pnoV18LocatorKey,
      pnoPendingPageReconciliation, pnoPendingEvidenceLabel, pnoPendingRenderNote,
      pnoPendingPropagatePositive, pnoV18ParcelStatus, pnoOperationalRawSummary,
      pnoV18RenderSummary};`)({ pnoV18State, row, state: { branch: "NE1" }, el, nf,
    pnoV18ViewCache, pnoBrowserCache, pnoV18TextValue, pnoV18TypeLabel });
  return { ...ui, row, nodes, el, pnoV18State, pnoV18ViewCache, pnoBrowserCache, nf };
}

test("provider no_entry Total and PreEntry aggregate remain separate from the current page", () => {
  const ui = makeUi();
  ui.pnoV18State.rows = Array.from({ length: 20 }, (_, index) => ({ pno: `P${index}`,
    scanEvidence: { classification: index < 19 ? "CONFIRMED_SCAN_IN" : "INSUFFICIENT_HISTORY" } }));
  ui.pnoPendingRenderNote();
  const note = ui.nodes.get("pno-pending-reconciliation").textContent;
  assert.match(note, /PreEntry 37/);
  assert.match(note, /no_entry 37/);
  assert.match(note, /เฉพาะหน้าที่ 1: 20 รายการ, ยืนยันสแกนเข้าแล้ว 19, ยังต้องตรวจสอบ 1/);
  assert.match(note, /ไม่ใช่ยอดคงเหลือใหม่/);
  assert.equal(ui.pnoPendingPageReconciliation(ui.pnoV18State.rows, 37, true).providerCandidates, 37);
  assert.equal(ui.pnoPendingPageReconciliation(ui.pnoV18State.rows, 37, false).providerCandidates, null);
  ui.pnoV18State.sourceValid = false;
  ui.pnoPendingRenderNote();
  assert.match(ui.nodes.get("pno-pending-reconciliation").textContent, /no_entry ไม่ทราบ/);
  assert.equal(ui.row.pendingParcels, 37);
});

test("confirmed candidates are explicitly scanned while downstream and vehicle arrival remain unresolved", () => {
  const ui = makeUi();
  const rows = [
    { pno: "CONFIRMED", status: "ยังไม่เข้า", lastAction: "สแกนเข้าคลัง",
      scanEvidence: { classification: "CONFIRMED_SCAN_IN" } },
    { pno: "DOWNSTREAM", status: "ยังไม่เข้า", lastAction: "ส่งออกคลัง",
      scanEvidence: { classification: "INSUFFICIENT_HISTORY" } },
    { pno: "VEHICLE", status: "ยังไม่เข้า", lastAction: "รถถึงคลัง",
      scanEvidence: { classification: "INSUFFICIENT_HISTORY" } },
    { pno: "GAP", scanEvidence: { classification: "SUSPECTED_SCAN_IN_GAP" } },
  ];
  ui.pnoV18State.rows = rows;
  assert.match(ui.pnoV18ParcelStatus(rows[0]), /ยืนยันสแกนเข้าคลังแล้ว/);
  assert.equal(ui.pnoV18ParcelStatus(rows[1]), "หลักฐานการสแกนเข้ายังไม่เพียงพอ");
  assert.equal(ui.pnoV18ParcelStatus(rows[2]), "หลักฐานการสแกนเข้ายังไม่เพียงพอ");
  assert.equal(ui.pnoV18ParcelStatus(rows[3]), "สงสัยหลุดสแกนเข้า");
  assert.equal(ui.pnoV18ParcelStatus(rows[0], "already"), "ยังไม่เข้า");
  const render = new Function("deps", `const {el, nf, pnoV18State, pnoV18ParcelStatus} = deps;
    const esc = (value) => String(value ?? "").replaceAll("<", "&lt;");
    const pnoV18FilteredParcelEntries = () => pnoV18State.rows.map((item, sourceIndex) => ({item, sourceIndex}));
    const pnoV18VisibleParcelEntries = pnoV18FilteredParcelEntries;
    const pnoV18ParcelFilterActive = () => false;
    const pnoV18UpdateFilterResult = () => {};
    const pnoV18ParcelAction = (item) => item.lastAction || "-";
    const pnoV18StatusClass = () => "";
    const pnoV18ActionClass = () => "";
    ${renderRowsSource}; return pnoV18RenderRows;`)({ el: ui.el, nf: ui.nf,
    pnoV18State: ui.pnoV18State, pnoV18ParcelStatus: ui.pnoV18ParcelStatus });
  render("no_entry", rows);
  const html = ui.nodes.get("pending-parcels-list").innerHTML;
  assert.match(html, /CONFIRMED[\s\S]*ยืนยันสแกนเข้าคลังแล้ว/);
  assert.match(html, /DOWNSTREAM[\s\S]*หลักฐานการสแกนเข้ายังไม่เพียงพอ/);
  assert.doesNotMatch(html, /ยังไม่เข้า<\/span>/);
});

test("count guards keep unknown distinct from authoritative zero", () => {
  const ui = makeUi();
  assert.equal(ui.pnoCountForType({ pendingParcels: null }, "no_entry"), null);
  assert.equal(ui.pnoCountForType({ pendingParcels: "" }, "no_entry"), null);
  assert.equal(ui.pnoCountForType({ pendingParcels: 0 }, "no_entry"), 0);
  const summary = ui.pnoOperationalRawSummary(ui.row);
  assert.deepEqual([summary.expected, summary.entered, summary.pending], [57, 20, 37]);
  ui.pnoV18RenderSummary();
  assert.match(ui.nodes.get("pno-v18-summary").innerHTML, /คงเหลือ[\s\S]*37/);
  assert.match(modalSummarySource, /pnoOperationalRawSummary\(row\)/);
  assert.match(staged, /const truth = pnoOperationalRawSummary\(row\);\s*const expected = truth.expected/);
});

test("both browser cache layers isolate segments and accept only matching positive anchors", () => {
  const ui = makeUi();
  const other = { ...ui.row, pnoLineId: "LINE2" };
  assert.notEqual(ui.pnoBrowserBaseKey(ui.row, "no_entry"), ui.pnoBrowserBaseKey(other, "no_entry"));
  assert.notEqual(ui.pnoBrowserBaseKey(ui.row, "no_entry"), ui.pnoBrowserBaseKey(ui.row, "already"));
  const target = { pno: "P", arrivalAnchorAt: "2026-09-24 03:00:00",
    scanEvidence: { classification: "INSUFFICIENT_HISTORY" } };
  const otherAnchor = structuredClone(target);
  otherAnchor.arrivalAnchorAt = "2026-09-24 04:00:00";
  const otherSegment = structuredClone(target);
  ui.pnoV18ViewCache.set(ui.pnoV18LocatorKey(ui.row) + "|no_entry|1",
    { value: { parcels: [target, otherAnchor] } });
  ui.pnoV18ViewCache.set(ui.pnoV18LocatorKey(other) + "|no_entry|1",
    { value: { parcels: [otherSegment] } });
  const browserTarget = structuredClone(target);
  ui.pnoBrowserCache.set("same", { baseKey: ui.pnoBrowserBaseKey(ui.row, "no_entry"),
    value: { parcels: [browserTarget] } });
  const accepted = { pno: "P", arrivalAnchorAt: target.arrivalAnchorAt,
    scanEvidence: { classification: "CONFIRMED_SCAN_IN" } };
  ui.pnoPendingPropagatePositive(ui.row, { parcels: [accepted] });
  assert.equal(target.scanEvidence.classification, "CONFIRMED_SCAN_IN");
  assert.equal(browserTarget.scanEvidence.classification, "CONFIRMED_SCAN_IN");
  assert.equal(otherAnchor.scanEvidence.classification, "INSUFFICIENT_HISTORY");
  assert.equal(otherSegment.scanEvidence.classification, "INSUFFICIENT_HISTORY");
});

test("modal never swaps a clicked occurrence for another row with the same proof", () => {
  const clicked = { id: "ROUTE-A", proofId: "SAME", pnoLineId: "LINE-A" };
  const other = { id: "ROUTE-B", proofId: "SAME", pnoLineId: "LINE-B" };
  const source = section("function pnoV18SourceRow()", "function pnoV18EnsureUi()");
  const find = new Function("pnoV18State", "state", `${source}; return pnoV18SourceRow;`)(
    { proofId: "SAME", sourceRow: clicked },
    { currentRows: [other], rows: [], archiveRows: [] });
  assert.equal(find(), clicked);
  const replaced = new Function("pnoV18State", "state", `${source}; return pnoV18SourceRow;`)(
    { proofId: "SAME", sourceRow: clicked },
    { currentRows: [{ ...other, id: "ROUTE-A" }], rows: [], archiveRows: [] });
  assert.equal(replaced(), null, "a reused route id with another line must fail closed");
});

class MemoryStorage {
  constructor() { this.values = new Map(); }
  async transaction(fn) { return fn(this); }
  async get(keys) { return new Map(keys.filter((key) => this.values.has(key)).map((key) => [key, this.values.get(key)])); }
  async put(values) { for (const [key, value] of Object.entries(values)) this.values.set(key, value); }
}

test("shared no_entry page recognizes its own scan and retains it after SEAL and SHIPMENT", async () => {
  const owner = { ctx: { storage: new MemoryStorage() } };
  const locator = { hub: "NE1", proofId: "PROOF", day: "2026-09-24", lineId: "LINE",
    storeId: "PREVIOUS", nextStoreId: "CURRENT", type: "no_entry", page: 1,
    count: 37, canReport: false, force: true };
  const base = { pno: "P1", store_id: "CURRENT", real_arrive_time: "2026-09-24 02:00:00" };
  let action = "ARRIVAL_WAREHOUSE_SCAN";
  let calls = 0;
  const deps = { readCredential: async () => ({}), now: () => Date.parse("2026-09-23T20:00:00Z"),
    fetchDetailPage: async () => { calls++;
      return { items: [{ ...base, LastAction: action, LastActionTime: action === "ARRIVAL_WAREHOUSE_SCAN"
        ? "2026-09-24 02:10:00" : "2026-09-24 02:20:00" }], total: 37, sourceValid: true };
    } };
  for (const next of ["ARRIVAL_WAREHOUSE_SCAN", "SEAL", "SHIPMENT_WAREHOUSE_SCAN"]) {
    action = next;
    const result = await readSharedPnoPage(owner, {}, locator, deps);
    assert.equal(result.type, "no_entry");
    assert.equal(result.total, 37);
    assert.equal(result.sourceValid, true);
    assert.equal(result.parcels[0].scanEvidence.classification, "CONFIRMED_SCAN_IN");
  }
  assert.equal(calls, 3);
  assert.doesNotMatch(worker, /CONFIRMED_MISSED_SCAN/);
  assert.doesNotMatch(section("function pnoPendingEvidenceLabel(", "function pnoV18ParcelAction("),
    /curl_pno|fetch\(|apiGet\(/);
});
