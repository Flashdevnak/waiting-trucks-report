import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PNO_SCAN_CLASSES, pnoEvidenceKeys } from "../../worker/src/pno-inbound-scan-evidence.js";
import { readSharedPnoPage, readSharedPnoExactHistory } from "../../worker/.dev-runtime/src/index.js";
import { stageFrontend } from "./stage-dev-runtime.mjs";

const locator = { hub: "NE1", proofId: "PROOF_A", day: "2026-09-24", lineId: "LINE_A",
  storeId: "SOURCE", nextStoreId: "CURRENT", type: "total", page: 1, count: 1, canReport: false };
const arrival = "2026-09-24 02:58:37";
const scan = "2026-09-24 03:12:14";
const downstream = "2026-09-24 03:17:54";
const now = Date.parse("2026-09-23T20:18:00.000Z");
const raw = { pno: "TEST_PNO_A", store_id: "CURRENT", real_arrive_time: arrival,
  LastAction: "SHIPMENT_WAREHOUSE_SCAN", LastActionTime: downstream };
function history(events = [
  ["ARRIVAL_GOODS_VAN_CHECK_SCAN", arrival, "CURRENT"],
  ["ARRIVAL_WAREHOUSE_SCAN", scan, "CURRENT"],
  ["SHIPMENT_WAREHOUSE_SCAN", downstream, "CURRENT"],
], pno = raw.pno) {
  return { code: 1, data: { result: { parcel_info: { pno }, parcel_routes: events.map(
    ([route_action, routed_at, store_id]) => ({ route_action, routed_at, store_id })) } } };
}
class MemoryStorage {
  constructor() { this.values = new Map(); this.writes = 0; this.queue = Promise.resolve(); }
  async transaction(callback) {
    const prior = this.queue;
    let release;
    this.queue = new Promise((resolve) => { release = resolve; });
    await prior;
    try { return await callback(this); } finally { release(); }
  }
  async get(keys) { return new Map(keys.filter((key) => this.values.has(key))
    .map((key) => [key, structuredClone(this.values.get(key))])); }
  async put(entries) { for (const [key, value] of Object.entries(entries)) {
    this.values.set(key, structuredClone(value)); this.writes += 1;
  } }
}
async function readyOwner(row = raw) {
  const owner = { ctx: { storage: new MemoryStorage() } };
  let pageCalls = 0;
  const page = await readSharedPnoPage(owner, {}, locator, {
    now: () => now, readCredential: async () => ({}),
    fetchDetailPage: async () => { pageCalls += 1; return { items: [row], total: 1, sourceValid: true }; },
  });
  return { owner, page, pageCalls };
}
const deps = (fetchHistory, time = now + 10_000) => ({ now: () => time,
  readCredential: async () => ({}), fetchHistory });

test("the saved WaybillDetail shape confirms an exact downstream occurrence and sticks after reopen", async () => {
  const { owner, page, pageCalls } = await readyOwner();
  assert.equal(pageCalls, 1);
  assert.equal(page.parcels[0].scanEvidence.reason, "MONITORING_STARTED_AFTER_ARRIVAL");
  assert.equal(page.parcels[0].store_id, undefined);
  assert.equal(page.historyRows, undefined);
  let calls = 0;
  const view = await readSharedPnoExactHistory(owner, {}, locator, raw.pno, arrival,
    deps(async () => { calls += 1; return history(); }));
  assert.equal(calls, 1);
  assert.equal(view.classification, PNO_SCAN_CLASSES.CONFIRMED);
  assert.equal(view.scanInEventAt, scan);
  assert.equal(view.scanInSource, "EXPLICIT_WAYBILL_HISTORY");
  assert.equal(page.parcels[0].scanEvidence.classification, PNO_SCAN_CLASSES.CONFIRMED);
  const reloadedPage = await readSharedPnoPage(owner, {}, locator, {
    now: () => now + 20_000, readCredential: async () => ({}),
    fetchDetailPage: async () => { throw Error("cached page expected"); },
  });
  assert.equal(reloadedPage.cacheState, "HIT");
  assert.equal(reloadedPage.parcels[0].scanEvidence.classification, PNO_SCAN_CLASSES.CONFIRMED);
  const second = await readSharedPnoExactHistory(owner, {}, locator, raw.pno, arrival,
    deps(async () => { throw Error("history must not be re-read"); }, now + 20_000));
  assert.equal(second.classification, PNO_SCAN_CLASSES.CONFIRMED);
  assert.equal(calls, 1);
  const reconstructed = await readSharedPnoPage(owner, {}, locator, {
    now: () => now + 70_000, readCredential: async () => ({}),
    fetchDetailPage: async () => ({ items: [raw], total: 1, sourceValid: true }),
  });
  assert.equal(reconstructed.parcels[0].scanEvidence.classification, PNO_SCAN_CLASSES.CONFIRMED);
  assert.equal(calls, 1);
  const key = await pnoEvidenceKeys(locator, raw);
  const saved = owner.ctx.storage.values.get(key.occurrence);
  assert.equal(saved.scanInEventAt, scan);
  assert.equal(saved.latestObservedAction, "SHIPMENT_WAREHOUSE_SCAN");
});

test("an incomplete or mismatched exact locator fails before a provider request", async () => {
  const { owner } = await readyOwner();
  let calls = 0;
  const injected = deps(async () => { calls += 1; return history(); });
  for (const [badLocator, pno, anchor] of [
    [{ ...locator, lineId: "" }, raw.pno, arrival],
    [{ ...locator, nextStoreId: "OTHER" }, raw.pno, arrival],
    [{ ...locator, proofId: "OTHER" }, raw.pno, arrival],
    [locator, "OTHER_PNO", arrival],
    [locator, raw.pno, "2026-09-25 02:58:37"],
    [locator, raw.pno, ""],
  ]) await assert.rejects(readSharedPnoExactHistory(owner, {}, badLocator, pno, anchor, injected));
  assert.equal(calls, 0);
});

test("concurrent duplicate explicit checks share one exact provider request", async () => {
  const { owner } = await readyOwner();
  let calls = 0;
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const injected = deps(async () => { calls += 1; return pending; });
  const first = readSharedPnoExactHistory(owner, {}, locator, raw.pno, arrival, injected);
  const second = readSharedPnoExactHistory(owner, {}, locator, raw.pno, arrival, injected);
  await Promise.resolve();
  finish(history());
  const results = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.ok(results.every((view) => view.classification === PNO_SCAN_CLASSES.CONFIRMED));
});

test("negative, wrong-store, wrong-anchor, vehicle-only, malformed and capped histories fail closed", async () => {
  const cases = [
    history([["ARRIVAL_GOODS_VAN_CHECK_SCAN", arrival, "CURRENT"]]),
    history([["ARRIVAL_GOODS_VAN_CHECK_SCAN", arrival, "CURRENT"],
      ["ARRIVAL_WAREHOUSE_SCAN", scan, "OLD"]]),
    history([["ARRIVAL_GOODS_VAN_CHECK_SCAN", "2026-09-24 02:58:38", "CURRENT"],
      ["ARRIVAL_WAREHOUSE_SCAN", scan, "CURRENT"]]),
    history(undefined, "OTHER_PNO"),
    { code: 1, data: { result: { parcel_info: { pno: raw.pno }, parcel_routes: null } } },
    history(Array.from({ length: 501 }, () => ["ARRIVAL_WAREHOUSE_SCAN", scan, "CURRENT"])),
  ];
  for (const response of cases) {
    const { owner } = await readyOwner();
    let calls = 0;
    const view = await readSharedPnoExactHistory(owner, {}, locator, raw.pno, arrival,
      deps(async () => { calls += 1; return response; }));
    assert.equal(calls, 1);
    assert.equal(view.classification, PNO_SCAN_CLASSES.INSUFFICIENT);
    assert.equal(owner.pnoPageCache.values().next().value.value.parcels[0].scanEvidence.classification,
      PNO_SCAN_CLASSES.INSUFFICIENT);
    const key = await pnoEvidenceKeys(locator, raw);
    assert.equal(owner.ctx.storage.values.get(key.occurrence)?.scanInObserved, false);
  }
});

test("provider failure cannot erase a stored positive", async () => {
  const { owner } = await readyOwner();
  await readSharedPnoExactHistory(owner, {}, locator, raw.pno, arrival, deps(async () => history()));
  const key = await pnoEvidenceKeys(locator, raw);
  const saved = structuredClone(owner.ctx.storage.values.get(key.occurrence));
  const view = await readSharedPnoExactHistory(owner, {}, locator, raw.pno, arrival,
    deps(async () => { throw Error("provider unavailable"); }));
  assert.equal(view.classification, PNO_SCAN_CLASSES.CONFIRMED);
  assert.deepEqual(owner.ctx.storage.values.get(key.occurrence), saved);
});

test("staged runtime has only a click-bound history action, no scan-gap history fan-out", () => {
  const front = stageFrontend(readFileSync(new URL("../../ms.js", import.meta.url), "utf8"));
  const worker = readFileSync(new URL("../../worker/.dev-runtime/src/index.js", import.meta.url), "utf8");
  assert.match(front, /button\[data-pno-history\]/);
  assert.match(front, /data-pno-history="1"/);
  assert.match(front, /apiGetOnce\("pendingPnoHistory"/);
  assert.equal((front.match(/apiGetOnce\("pendingPnoHistory"/g) || []).length, 1);
  assert.match(worker, /if \(action === "pendingPnoHistory"\)/);
  assert.match(worker, /if \(!access\(hub, actor\)\) fail\("ไม่มีสิทธิ์ดูข้อมูล HUB นี้"/);
  assert.match(worker, /await ingestPnoExactHistory\(/);
  assert.match(worker, /url:?.*\/api\/route\/curl_pno|new URL\("https:\/\/fbi\.flashexpress\.com\/api\/route\/curl_pno"\)/);
  assert.match(worker, /type: "waybillDetail", pno, f: "pnodetail"/);
  const load = front.slice(front.indexOf("async function pnoInboundLoad(page) {"),
    front.indexOf("function pnoV18SetActive(type)"));
  assert.doesNotMatch(load, /pendingPnoHistory|curl_pno/);
  assert.doesNotMatch(load, /pnoExactHistoryNotice\s*=/);
  const render = front.slice(front.indexOf("function pnoInboundRender(rows) {"),
    front.indexOf("async function pnoInboundLoad(page) {"));
  assert.doesNotMatch(render, /apiGet\(|fetch\(/);
  assert.doesNotMatch(front, /CONFIRMED_MISSED_SCAN/);
  assert.doesNotMatch(worker.slice(worker.indexOf("export async function readSharedPnoExactHistory"),
    worker.indexOf("export function pnoDiagnostics")), /setInterval|setTimeout|Promise\.all\(/);
});

test("rendering one, ten or one hundred scan-gap rows performs no history request", () => {
  const front = stageFrontend(readFileSync(new URL("../../ms.js", import.meta.url), "utf8"));
  const renderer = front.slice(front.indexOf("function pnoInboundRender(rows) {"),
    front.indexOf("async function pnoInboundLoad(page) {"));
  const list = { innerHTML: "", contains: () => true };
  let calls = 0;
  const render = new Function("el", "esc", "pnoExactHistoryNoticeHtml", "pnoV18SourceRow",
    "pnoExactHistoryKey", "pnoExactHistoryActive", "pnoExactHistoryChecked",
    "pnoExactHistoryLocatorReady", "pnoExactHistoryMatches", "pnoExactHistoryCheck", `${renderer}; return pnoInboundRender;`)(
    () => list, (value) => String(value), () => "", () => ({}), () => "key",
    new Set(), new Set(), () => true, () => [{}], () => { calls += 1; });
  for (const n of [1, 10, 100]) {
    render(Array.from({ length: n }, (_, i) => ({ pno: `TEST_${i}`, arrivalAnchorAt: arrival,
      scanEvidence: { classification: PNO_SCAN_CLASSES.INSUFFICIENT } })));
    assert.equal((list.innerHTML.match(/data-pno-history="1"/g) || []).length, 2 * n);
    assert.equal(calls, 0);
  }
});

test("the default provider reader emits the saved WaybillDetail GET contract once without live traffic", async () => {
  const worker = readFileSync(new URL("../../worker/.dev-runtime/src/index.js", import.meta.url), "utf8");
  const method = worker.slice(worker.indexOf("async function readExactPnoHistory(credentials, pno) {"),
    worker.indexOf("export function pnoDiagnostics(owner)"));
  let calls = 0;
  const reader = new Function("fetch", "fail", method + "; return readExactPnoHistory;")(
    async (url, options) => {
      calls += 1;
      assert.equal(url.pathname, "/api/route/curl_pno");
      assert.deepEqual([...url.searchParams.keys()].sort(), ["lang", "auth", "fbid", "time",
        "_from", "nonce", "referer", "iv", "type", "pno", "f"].sort());
      assert.equal(url.searchParams.get("type"), "waybillDetail");
      assert.equal(url.searchParams.get("pno"), raw.pno);
      assert.equal(url.searchParams.get("f"), "pnodetail");
      assert.equal(options.headers["BI-PLATFORM"], "pc");
      return { ok: true, json: async () => history() };
    },
    () => { throw Error("unexpected provider failure"); });
  const syntheticCredentials = Object.fromEntries(["lang", "auth", "fbid", "time",
    "_from", "nonce", "referer", "iv"].map((key) => [key, "TEST_VALUE"]));
  const result = await reader(syntheticCredentials, raw.pno);
  assert.equal(calls, 1);
  assert.equal(result.data.result.parcel_info.pno, raw.pno);
});

test("one explicit UI check coalesces double click and refreshes the exact scan-gap row", async () => {
  const front = stageFrontend(readFileSync(new URL("../../ms.js", import.meta.url), "utf8"));
  const helpers = front.slice(front.indexOf("const pnoExactHistoryActive = new Set();"),
    front.indexOf("function pnoInboundRender(rows) {"));
  const source = { proofId: "PROOF_A", pnoSourceDay: "2026-09-24", pnoLineId: "LINE_A",
    pnoStoreId: "SOURCE", pnoNextStoreId: "CURRENT", pnoCanReport: false };
  const item = { pno: raw.pno, arrivalAnchorAt: arrival,
    scanEvidence: { classification: PNO_SCAN_CLASSES.INSUFFICIENT } };
  const state = { sourceRow: source, type: "scan_gap", page: 1, rows: [item] };
  let calls = 0;
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const scope = new Function("apiGetOnce", "pnoV18State", "pnoV18SourceRow", "pnoReadOnlyDetailEligibility",
    "state", "pnoV18LocatorKey", "pnoCountForType", "pnoPendingPropagatePositive", "pnoInboundRender", "esc",
    helpers + "return { check: pnoExactHistoryCheck, ready: pnoExactHistoryLocatorReady };")(
    async () => { calls += 1; return pending; }, state, () => source, () => ({ available: true }),
    { branch: "NE1" }, (row) => JSON.stringify([row?.proofId, row?.pnoLineId]), () => 1,
    () => {}, () => {}, (s) => s);
  assert.equal(scope.ready(source), true);
  assert.equal(scope.ready({ ...source, pnoNextStoreId: "" }), false);
  const first = scope.check(raw.pno, arrival);
  const second = scope.check(raw.pno, arrival);
  assert.equal(calls, 1);
  finish({ classification: PNO_SCAN_CLASSES.CONFIRMED, scanInEventAt: scan });
  await Promise.all([first, second]);
  assert.equal(item.scanEvidence.classification, PNO_SCAN_CLASSES.CONFIRMED);
  await scope.check(raw.pno, arrival);
  assert.equal(calls, 1);
});

test("apiGetOnce preserves the DEV action contract with one fetch on every outcome", async () => {
  const source = readFileSync(new URL("../../ms.js", import.meta.url), "utf8");
  const once = source.slice(source.indexOf("async function apiGetOnce(action, params = {}) {"),
    source.indexOf("function openMsConnection()"));
  assert.match(once, /const response = await fetch\(url,/);
  assert.doesNotMatch(once, /for\s*\(|while\s*\(|retry|attempt/i);
  for (const scenario of ["success", "400", "409", "500", "timeout", "nonJSON", "network"]) {
    let calls = 0;
    let invalidations = 0;
    let timerCleared = 0;
    const get = new Function("CONFIG", "state", "fetch", "AbortController", "setTimeout",
      "clearTimeout", "invalidateSession", once + "; return apiGetOnce;")(
      { apiUrl: "https://example.invalid/api", requestTimeoutMs: 2000 },
      { auth: { token: "TEST_TOKEN" } },
      async (url, options) => {
        calls += 1;
        assert.equal(url.searchParams.get("action"), "pendingPnoHistory");
        assert.equal(url.searchParams.get("token"), "TEST_TOKEN");
        assert.equal(url.searchParams.get("proofId"), "PROOF_A");
        assert.equal(options.cache, "no-store");
        if (scenario === "timeout") {
          assert.equal(options.signal.aborted, true);
          throw Object.assign(new Error("aborted"), { name: "AbortError" });
        }
        if (scenario === "network") throw new TypeError("network offline");
        const status = ["400", "409", "500"].includes(scenario) ? Number(scenario) : 200;
        const payload = scenario === "nonJSON" ? "<html>bad gateway</html>" :
          scenario === "success" ? JSON.stringify({ ok: true, data: { classification: "CONFIRMED_SCAN_IN" } }) :
            JSON.stringify({ ok: false, code: scenario === "409" ? "INVALID_SESSION" : "ERROR",
              message: "test failure" });
        return { ok: status === 200, status, text: async () => payload };
      },
      AbortController,
      (fn) => { if (scenario === "timeout") fn(); return 1; },
      () => { timerCleared += 1; },
      () => { invalidations += 1; });
    if (scenario === "success") assert.equal((await get("pendingPnoHistory", { proofId: "PROOF_A" }))
      .classification, "CONFIRMED_SCAN_IN");
    else await assert.rejects(get("pendingPnoHistory", { proofId: "PROOF_A" }));
    assert.equal(calls, 1, scenario);
    assert.equal(timerCleared, 1, scenario);
    assert.equal(invalidations, scenario === "409" ? 1 : 0, scenario);
  }
});

function exactHistoryUiHarness(response) {
  const front = stageFrontend(readFileSync(new URL("../../ms.js", import.meta.url), "utf8"));
  const helpers = front.slice(front.indexOf("const pnoExactHistoryActive = new Set();"),
    front.indexOf("function pnoInboundRender(rows) {"));
  const renderer = front.slice(front.indexOf("function pnoInboundRender(rows) {"),
    front.indexOf("async function pnoInboundLoad(page) {"));
  const source = { proofId: "PROOF_A", pnoSourceDay: "2026-09-24", pnoLineId: "LINE_A",
    pnoStoreId: "SOURCE", pnoNextStoreId: "CURRENT", pnoCanReport: false };
  const item = { pno: raw.pno, arrivalAnchorAt: arrival,
    scanEvidence: { classification: PNO_SCAN_CLASSES.INSUFFICIENT } };
  const state = { sourceRow: source, type: "scan_gap", page: 1, rows: [item], busy: false,
    filters: { status: "", action: "", branch: "" } };
  const app = { branch: "NE1" };
  const list = { innerHTML: "", contains: () => true, classList: { add() {}, remove() {} } };
  const nodes = new Map([["pending-parcels-list", list]]);
  const el = (id) => {
    if (!nodes.has(id)) nodes.set(id, { textContent: "", classList: { add() {}, remove() {} } });
    return nodes.get(id);
  };
  let requests = 0;
  const get = async () => { requests += 1; if (response instanceof Error) throw response; return response; };
  const scope = new Function("apiGetOnce", "pnoV18State", "pnoV18SourceRow",
    "pnoReadOnlyDetailEligibility", "state", "pnoV18LocatorKey", "pnoCountForType",
    "pnoPendingPropagatePositive", "el", "esc", helpers + renderer +
      "return { check: pnoExactHistoryCheck, render: pnoInboundRender, notice: pnoExactHistoryNoticeHtml };")(
      get, state, () => state.sourceRow, () => ({ available: true }), app,
      (row) => JSON.stringify([row?.proofId, row?.pnoSourceDay, row?.pnoLineId,
        row?.pnoStoreId, row?.pnoNextStoreId]), () => 1, () => {},
      el, (value) => String(value ?? ""));
  const buttons = () => [...list.innerHTML.matchAll(/<button[^>]+data-pno-history="1"[^>]*>/g)]
    .map(([tag]) => tag);
  return { front, scope, source, item, state, app, list, el, buttons, requests: () => requests };
}

test("render eligibility and handler share the unique insufficient row guard", async () => {
  const ui = exactHistoryUiHarness({ classification: PNO_SCAN_CLASSES.CONFIRMED });
  ui.scope.render(ui.state.rows);
  assert.equal(ui.buttons().length, 2);
  assert.ok(ui.buttons().every((tag) => !tag.includes(" disabled")));
  ui.state.rows.push({ ...ui.item, scanEvidence: { ...ui.item.scanEvidence } });
  ui.scope.render(ui.state.rows);
  assert.ok(ui.buttons().every((tag) => tag.includes(" disabled")));
  await ui.scope.check(raw.pno, arrival);
  assert.equal(ui.requests(), 0);
  ui.state.rows.pop();
  ui.item.scanEvidence = { classification: PNO_SCAN_CLASSES.CONFIRMED };
  ui.scope.render(ui.state.rows);
  assert.equal(ui.buttons().length, 0);
  assert.equal(ui.requests(), 0);
});

test("settled notices survive same-occurrence reload and reopen but never cross occurrences", async () => {
  for (const [response, expected] of [
    [{ classification: PNO_SCAN_CLASSES.CONFIRMED, scanInAction: "ARRIVAL_WAREHOUSE_SCAN",
      scanInSource: "EXPLICIT_WAYBILL_HISTORY", scanInEventAt: scan }, "ยืนยันสแกนเข้าคลังแล้ว"],
    [{ classification: PNO_SCAN_CLASSES.INSUFFICIENT }, "ตรวจประวัติแล้ว แต่หลักฐาน"],
    [new Error("test network error"), "ตรวจประวัติไม่สำเร็จ"],
  ]) {
    const ui = exactHistoryUiHarness(response);
    await ui.scope.check(raw.pno, arrival);
    assert.equal(ui.requests(), 1);
    assert.match(ui.scope.notice(), new RegExp(expected));
    ui.scope.render(ui.state.rows);
    assert.match(ui.list.innerHTML, new RegExp(expected));
    const loadStart = ui.front.indexOf("async function pnoInboundLoad(page) {");
    const load = ui.front.slice(loadStart, ui.front.indexOf("\n}\n", loadStart) + 3);
    assert.doesNotMatch(load, /pnoExactHistoryNotice\s*=/);
    const reload = new Function("pnoV18State", "pnoPendingRenderNote", "pnoV18SetActive",
      "pnoInboundToggleActions", "el", "pnoV18Fetch", "pnoV18RenderFilters",
      "pnoV18RenderCurrentFilteredView", load + "; return pnoInboundLoad;")(
      ui.state, () => {}, () => {}, () => {}, ui.el,
      async () => ({ parcels: ui.state.rows, total: ui.state.rows.length }),
      () => {}, () => ui.scope.render(ui.state.rows));
    await reload(1);
    assert.equal(ui.requests(), 1);
    assert.match(ui.list.innerHTML, new RegExp(expected));
    ui.scope.render(ui.state.rows); // same occurrence after modal close/reopen
    assert.equal(ui.requests(), 1);
    assert.match(ui.list.innerHTML, new RegExp(expected));
    ui.state.sourceRow = { ...ui.source, proofId: "DIFFERENT_PROOF" };
    ui.scope.render(ui.state.rows);
    assert.doesNotMatch(ui.list.innerHTML, new RegExp(expected));
  }
});

test("a result settling after navigation remains bound to the clicked occurrence", async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const ui = exactHistoryUiHarness(pending);
  const check = ui.scope.check(raw.pno, arrival);
  ui.app.branch = "OTHER_HUB";
  ui.state.sourceRow = { ...ui.source, proofId: "OTHER_PROOF" };
  finish({ classification: PNO_SCAN_CLASSES.INSUFFICIENT });
  await check;
  assert.equal(ui.requests(), 1);
  assert.equal(ui.scope.notice(), "");
  ui.app.branch = "NE1";
  ui.state.sourceRow = ui.source;
  assert.match(ui.scope.notice(), /ตรวจประวัติแล้ว แต่หลักฐาน/);
});
