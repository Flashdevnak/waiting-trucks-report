import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { stageFrontend, stageWorker } from "./stage-dev-runtime.mjs";
import { patchPnoCrossViewFilterParity } from "./patch-pno-cross-view-filter-parity.mjs";

const staged = stageFrontend(readFileSync(new URL("../../ms.js", import.meta.url), "utf8"));
const functions = [
  "pnoV18TextValue", "pnoV18UniqueValues", "pnoV18FilterOption", "pnoV18ValidateFilter", "pnoV18DisplayBranch",
  "pnoPendingEvidenceLabel", "pnoV18TypeLabel", "pnoV18ParcelStatus", "pnoV18ParcelAction",
  "pnoV18ParcelFilterActive", "pnoV18ParcelFilterDataset", "pnoV18FilteredParcelEntries",
  "pnoV18VisibleParcelEntries", "pnoV18EnsureParcelFilterRows", "pnoV18PrepareCurrentFilters", "pnoV18Navigate",
  "pnoV18BagGroups", "pnoV18BagValue", "pnoV18BagLatest", "pnoV18BagSummary",
  "pnoV18FilteredBagGroups", "pnoV18FilterSummaryText", "pnoV18RenderCurrentFilteredView",
  "pnoV18RenderFilters", "pnoInboundLoad", "pnoV18Export", "pnoV18Copy", "pnoV18CopyLine",
  "pnoV18TsvCell", "pnoV18LineCell", "pnoV18AppendLineLimited",
  "pnoV18ActionClass", "pnoV18StatusClass",
  "pnoV18Load", "pnoV18LoadBags",
  "pnoV18LoadOwned", "pnoV18LoadBagsOwned", "pnoInboundLoadOwned",
  "pnoV18CopyOwned", "pnoV18CopyLineOwned", "pnoV18ExportOwned",
];
function extract(name) {
  const prefix = staged.includes(`async function ${name}(`) ? `async function ${name}(` : `function ${name}(`;
  const start = staged.indexOf(prefix), end = staged.indexOf("\n}\n", start) + 2;
  assert.ok(start >= 0 && end > start, `${name} exists in effective DEV runtime`);
  return staged.slice(start, end);
}

const rows = [
  { pno: "SYNTHETIC-A", backingNo: "SYNTHETIC-BAG-A", status: "รอ", lastAction: "รับ", lastActionAt: "2026-09-25T01:00:00Z", targetBranch: "BRANCH-A", scanEvidence: { classification: "SUSPECTED_SCAN_IN_GAP" } },
  { pno: "SYNTHETIC-B", backingNo: "SYNTHETIC-BAG-A", status: "รอ", lastAction: "ส่ง", lastActionAt: "2026-09-25T02:00:00Z", targetBranch: "BRANCH-A", scanEvidence: { classification: "CONFIRMED_SCAN_IN" } },
  { pno: "SYNTHETIC-C", backingNo: "SYNTHETIC-BAG-B", status: "เข้าแล้ว", lastAction: "ส่ง", lastActionAt: "2026-09-25T03:00:00Z", targetBranch: "BRANCH-B", scanEvidence: { classification: "INSUFFICIENT_HISTORY" } },
  { pno: "SYNTHETIC-D", backingNo: "", status: "รอ", lastAction: "รับ", lastActionAt: "2026-09-25T04:00:00Z", targetBranch: "", scanEvidence: { classification: "NOT_YET_SCAN_IN_STAGE" } },
].map((item) => ({ ...item, nextStoreName: item.targetBranch }));

function harness({ type = "total", all = rows, current = rows, total = all.length, fetchPage } = {}) {
  const nodes = new Map(), observed = { fetch: [], upstream: [], downloads: [], clip: "", gap: [], toast: [] };
  const clock = { now: Date.now() };
  const node = (key) => {
    if (!nodes.has(key)) nodes.set(key, {
      innerHTML: "", textContent: "", disabled: false,
      classList: { add() {}, remove() {} },
      querySelectorAll() { this.selects = [...this.innerHTML.matchAll(/<select[^>]*data-pno-v18-filter="([^"]+)"([^>]*)>/g)]
        .map((match) => ({ dataset: { pnoV18Filter: match[1] }, disabled: /\bdisabled\b/.test(match[2]), value: "", onchange: null })); return this.selects; },
      selects: [],
    });
    return nodes.get(key);
  };
  const state = {
    type, page: 1, rows: current, total, bagRows: type === "bag" ? all : null,
    filterRows: null, filterKey: "", filterAt: 0, filterPromise: null, filterError: "", filterProgress: "", filterForce: false,
    filterPage: 1, sourceRow: { proofId: "SYNTHETIC_PROOF", pnoNextStoreName: "NEXT-STORE" },
    filters: { status: "", action: "", hub: "", branch: "" }, selection: null, busy: false,
  };
  const context = vm.createContext({
    pnoV18State: state, state: { branch: "CURRENT-HUB" }, openPendingParcels() {}, pnoReadOnlyExplicitNoPrefetch: false,
    Date: class extends Date { static now() { return clock.now; } },
    PNO_V18_VIEW_CACHE_MS: 60 * 1000,
    nf: new Intl.NumberFormat("en-US"),
    esc: (v) => String(v ?? ""), el: node,
    pnoV18SourceRow: () => state.sourceRow,
    pnoV18LocatorKey: (row) => row?.proofId === "SYNTHETIC_PROOF" ? "SYNTHETIC_OCCURRENCE" : `OTHER|${row?.proofId}`,
    pnoV18PageCacheKey: (_row, sourceType, page) => `${sourceType}|${page}`,
    pnoV18ViewCache: new Map(), pnoV18BagCache: new Map(),
    pnoV18CacheGet: () => null, pnoV18CacheSet: (_map, _key, value) => value,
    pendingParcelRows: [],
    pnoV18Fetch: async (sourceType, page) => {
      observed.fetch.push([sourceType, page]);
      if (fetchPage) return fetchPage(sourceType, page, state);
      return { parcels: all.slice((page - 1) * 200, page * 200), total: all.length };
    },
    pnoV18SetActive() {}, pnoPendingRenderNote() {}, pnoInboundToggleActions() {},
    pnoV18RenderBagSummary() {},
    pnoV18RenderSummary() {},
    pnoV18ApplyPageResult(_type, result) {
      state.rows = result.parcels; state.total = result.total;
      vm.runInContext("pnoV18RenderFilters(); pnoV18RenderCurrentFilteredView()", context);
    },
    pnoV18RenderBags() { observed.bags = vm.runInContext("pnoV18FilteredBagGroups().map(([bag]) => bag)", context); },
    pnoV18RenderRows() { observed.parcels = vm.runInContext("pnoV18FilteredParcelEntries().map(({item}) => item.pno)", context); },
    pnoInboundRender(visible) { observed.gap = visible.map((r) => r.pno); },
    pnoV18UpdateFilterResult(shown, count) { observed.result = [shown, count]; },
    pnoV18WriteClipboard: async (content) => { observed.clip = content; return true; },
    toast: (content) => observed.toast.push(content),
    XLSX: { utils: {
      json_to_sheet: (v) => v, book_new: () => ({}), book_append_sheet: (_wb, values, name) => observed.downloads.push({ values, name }),
    }, writeFile() {} },
    setTimeout, console,
  });
  vm.runInContext(functions.map(extract).join("\n"), context);
  const runtimeEnd = staged.indexOf(extract("pnoLifecycleBindHandlers")) + extract("pnoLifecycleBindHandlers").length;
  vm.runInContext(staged.slice(staged.indexOf("const pnoLifecycle ="), runtimeEnd) + "\npnoLifecycleInvalidate(true);", context);
  return { state, observed, nodes, advance: (ms) => { clock.now += ms; },
    call: (expression) => vm.runInContext(expression, context),
    installActualRender: () => vm.runInContext(extract("pnoV18RenderRows"), context),
    installActualFetch: () => {
      context.browserPnoPage = async (_row, sourceType, page, force) => {
        observed.upstream.push([sourceType, page, force]);
        if (fetchPage) return fetchPage(sourceType, page, state);
        return { page, parcels: all.slice((page - 1) * 200, page * 200), total: all.length };
      };
      context.pnoPendingPropagatePositive = () => {};
      vm.runInContext([extract("pnoV18CacheGet"), extract("pnoV18CacheSet"), extract("pnoV18Fetch")].join("\n"), context);
      const effective = context.pnoV18Fetch;
      context.pnoV18Fetch = (...args) => { observed.fetch.push(args); return effective(...args); };
    },
    waitPrepared: async () => { if (state.filterPromise) await state.filterPromise; await new Promise(setImmediate); },
    select: async (key, value) => {
      vm.runInContext("pnoV18RenderFilters()", context);
      let element = node("pno-v18-filterbar").selects.find((item) => item.dataset.pnoV18Filter === key);
      assert.ok(element, `filter ${key} exists`);
      assert.equal(element.disabled, false, `filter ${key} is ready before interaction`);
      element.value = value;
      await element.onchange();
    } };
}

test("effective staging parses and stages destination HUB parent filter", () => {
  assert.doesNotThrow(() => new Function(staged));
  assert.equal(stageFrontend(staged), staged);
  assert.equal(patchPnoCrossViewFilterParity(staged), staged);
  assert.match(staged, /PNO_CROSS_VIEW_FILTER_PARITY_V1/);
  assert.match(extract("pnoV18RenderFilters"), /row\.targetHub/);
  for (const control of ["status", "action", "hub", "branch"])
    assert.match(extract("pnoV18RenderFilters"), new RegExp(`\\["${control}"`));
});

test("opening one 2466-row view automatically prepares 13 pages with passive progress and one ready selection", async () => {
  const all = Array.from({ length: 2466 }, (_, i) => ({ ...rows[0], pno: `SYNTHETIC-${i}` }));
  let releasePage2;
  const gate = new Promise((resolve) => { releasePage2 = resolve; });
  const h = harness({ all, current: all.slice(0, 200), fetchPage: async (_type, page) => {
    if (page === 2) await gate;
    return { page, total: all.length, parcels: all.slice((page - 1) * 200, page * 200) };
  } });
  h.installActualRender();
  const loading = h.call('pnoV18Load("total", 1)');
  await new Promise(setImmediate);
  assert.equal((h.nodes.get("pending-parcels-list").innerHTML.match(/<tr>/g) || []).length, 201,
    "first page is available while later pages prepare");
  assert.ok(h.state.filterPromise, "preparation started without interacting with any selector");
  assert.equal(h.state.filterRows, null);
  const selects = h.nodes.get("pno-v18-filterbar").selects;
  assert.equal(selects.length, 4);
  assert.ok(selects.every((item) => item.disabled && !item.onfocus && !item.onpointerdown));
  assert.match(h.nodes.get("pno-v18-filterbar").innerHTML, /กำลังเตรียมตัวกรอง…/);
  assert.doesNotMatch(h.nodes.get("pno-v18-filterbar").innerHTML, /เลือกเพื่อรวมข้อมูลทุกหน้า/);
  await new Promise(setImmediate);
  assert.match(h.nodes.get("pno-v18-filter-result").textContent, /2\/13 หน้า/);
  const active = h.state.filterPromise;
  h.call("pnoV18PrepareCurrentFilters(); pnoV18PrepareCurrentFilters(); pnoV18RenderFilters()");
  assert.equal(h.state.filterPromise, active, "one active preparation for the same authority");
  assert.match(h.nodes.get("pno-v18-filter-result").textContent, /2\/13 หน้า/, "rerender preserves progress");
  releasePage2();
  await loading;
  await h.waitPrepared();
  assert.match(h.nodes.get("pno-v18-filter-result").textContent, /ทั้งหมด 2,466/);
  assert.deepEqual(h.observed.fetch.map(([, page]) => page), [1, ...Array.from({ length: 13 }, (_, i) => i + 1)]);
  assert.equal(h.state.filterRows.length, 2466);
  assert.ok(h.nodes.get("pno-v18-filterbar").selects.every((item) => !item.disabled));
  assert.match(h.nodes.get("pno-v18-filterbar").innerHTML, /<option value="">ทั้งหมด<\/option>/);
  const acquired = h.observed.fetch.length;
  await h.select("action", "รับ");
  assert.equal(h.state.filters.action, "รับ", "first ready interaction performs the real filter");
  assert.equal(h.observed.fetch.length, acquired);
});

for (const total of [0, 200, 2466])
  test(`effective page cache reuses the already fetched first page for ${total} rows`, async () => {
    const all = Array.from({ length: total }, (_, i) => ({ ...rows[0], pno: `SYNTHETIC-${i}` }));
    const h = harness({ all, current: all.slice(0, 200) });
    h.installActualFetch();
    await h.call('pnoV18Load("total", 1)');
    await h.waitPrepared();
    const pages = Math.max(1, Math.ceil(total / 200));
    assert.equal(h.state.filterRows.length, total);
    assert.equal(h.observed.fetch.length, pages + 1, "initial page plus internal preparation page calls");
    assert.equal(h.observed.upstream.length, pages, "actual upstream pages each acquired once");
    assert.equal(h.observed.upstream.filter(([, page]) => page === 1).length, 1,
      "automatic preparation does not duplicate upstream page 1");
    assert.ok(h.nodes.get("pno-v18-filterbar").selects.every((item) => !item.disabled));
    h.call("pnoV18PrepareCurrentFilters()");
    assert.equal(h.observed.upstream.length, pages, "ready rerender has no second full acquisition");
    if (total === 0)
      assert.doesNotMatch(h.nodes.get("pno-v18-filterbar").innerHTML, /SYNTHETIC|เตรียมตัวกรอง/);
  });

test("explicit refresh fetches one new page 1 and prepares one new authority", async () => {
  const all = Array.from({ length: 401 }, (_, i) => ({ ...rows[0], pno: `SYNTHETIC-${i}` }));
  const h = harness({ all, current: all.slice(0, 200) });
  h.installActualFetch();
  await h.call('pnoV18Load("total", 1)');
  await h.waitPrepared();
  assert.deepEqual(h.observed.upstream.map(([, page]) => page), [1, 2, 3]);
  Object.assign(h.state, { force: true, filterForce: true, filterRows: null,
    filterKey: "", filterError: "", filterProgress: "" });
  await h.call('pnoV18Load("total", 1)');
  await h.waitPrepared();
  assert.deepEqual(h.observed.upstream.map(([, page]) => page), [1, 2, 3, 1, 2, 3]);
  assert.equal(h.observed.upstream.filter(([, page]) => page === 1).length, 2,
    "each baseline cycle has exactly one upstream page-1 acquisition");
});

test("automatic middle-page failure leaves first page visible and never retries from selectors", async () => {
  const all = Array.from({ length: 5000 }, (_, i) => ({ ...rows[0], pno: `SYNTHETIC-${i}` }));
  const h = harness({ all, current: all.slice(0, 200), fetchPage: (_type, page) => {
    if (page === 17) throw new Error("synthetic page failure");
    return { page, total: all.length, parcels: all.slice((page - 1) * 200, page * 200) };
  } });
  h.installActualRender();
  await h.call('pnoV18Load("total", 1)');
  if (h.state.filterPromise) await h.state.filterPromise.catch(() => {});
  await new Promise(setImmediate);
  assert.equal(h.state.filterRows, null);
  assert.equal((h.nodes.get("pending-parcels-list").innerHTML.match(/<tr>/g) || []).length, 201);
  assert.match(h.nodes.get("pno-v18-filter-result").textContent, /เตรียมตัวกรองทุกหน้าไม่สำเร็จ/);
  assert.ok(h.nodes.get("pno-v18-filterbar").selects.every((item) => item.disabled));
  const acquired = h.observed.fetch.length;
  for (const element of h.nodes.get("pno-v18-filterbar").selects) {
    assert.equal(element.onfocus, undefined);
    assert.equal(element.onpointerdown, undefined);
    element.onchange();
  }
  h.call("pnoV18PrepareCurrentFilters()");
  assert.equal(h.observed.fetch.length, acquired);
  assert.equal(h.observed.toast.length, 0);
});

test("locator change after opening prepares only the new exact occurrence", async () => {
  const tripA = Array.from({ length: 401 }, (_, i) => ({ ...rows[0], pno: `A-${i}`, lastAction: "A" }));
  const tripB = Array.from({ length: 201 }, (_, i) => ({ ...rows[0], pno: `B-${i}`, lastAction: "B" }));
  const h = harness({ all: tripA, current: tripA.slice(0, 200), fetchPage: (_type, page, state) => {
    const dataset = state.sourceRow.proofId === "TRIP-B" ? tripB : tripA;
    return { page, total: dataset.length, parcels: dataset.slice((page - 1) * 200, page * 200) };
  } });
  await h.call('pnoV18Load("total", 1)');
  await h.waitPrepared();
  assert.equal(h.state.filterRows.length, 401);
  h.state.sourceRow = { proofId: "TRIP-B", pnoSourceDay: "2026-09-29" };
  h.state.filterRows = null; h.state.filterKey = ""; h.state.filterError = "";
  await h.call('pnoV18Load("total", 1)');
  await h.waitPrepared();
  assert.equal(h.state.filterRows.length, 201);
  assert.ok(h.state.filterRows.every((row) => row.pno.startsWith("B-")));
  assert.doesNotMatch(h.nodes.get("pno-v18-filterbar").innerHTML, />A</);
  assert.match(h.nodes.get("pno-v18-filterbar").innerHTML, />B</);
});

for (const scenario of ["missing PNO", "page identity mismatch", "reported total change", "locator changes mid-acquisition"]) {
  test(`automatic preparation fails closed on ${scenario}`, async () => {
    const all = Array.from({ length: 401 }, (_, i) => ({ ...rows[0], pno: `SYNTHETIC-${i}` }));
    const h = harness({ all, current: all.slice(0, 200), fetchPage: (_type, page, state) => {
      if (page === 2 && scenario === "locator changes mid-acquisition")
        state.sourceRow = { proofId: "OTHER" };
      const parcels = all.slice((page - 1) * 200, page * 200).map((row) => ({ ...row }));
      if (page === 2 && scenario === "missing PNO") parcels[0].pno = "";
      return { page: page === 2 && scenario === "page identity mismatch" ? 3 : page,
        total: page === 2 && scenario === "reported total change" ? 402 : all.length, parcels };
    } });
    await h.call('pnoV18Load("total", 1)');
    if (h.state.filterPromise) await h.state.filterPromise.catch(() => {});
    await new Promise(setImmediate);
    assert.equal(h.state.filterRows, null);
    assert.ok(h.state.filterError || scenario === "locator changes mid-acquisition");
    assert.equal(h.observed.fetch.length, 3);
  });
}

test("desktop table and responsive cards preserve the visible page while selectors are disabled", async () => {
  const all = Array.from({ length: 201 }, (_, i) => ({ ...rows[0], pno: `SYNTHETIC-${i}` }));
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const h = harness({ all, current: all.slice(0, 200), fetchPage: async (_type, page) => {
    if (page === 2) await gate;
    return { page, total: all.length, parcels: all.slice((page - 1) * 200, page * 200) };
  } });
  h.installActualRender();
  const loading = h.call('pnoV18Load("total", 1)');
  await new Promise(setImmediate);
  const list = h.nodes.get("pending-parcels-list").innerHTML;
  assert.equal((list.match(/<tr>/g) || []).length, 201);
  assert.equal((list.match(/class="pno-v18-mobile-card /g) || []).length, 200);
  assert.match(list, /pno-v18-desktop/);
  assert.match(list, /pno-v18-mobile/);
  assert.ok(h.nodes.get("pno-v18-filterbar").selects.every((item) => item.disabled));
  assert.match(staged, /pno-v18-filterbar\{[^}]*flex-wrap:wrap/);
  release();
  await loading;
  await h.waitPrepared();
  assert.ok(h.nodes.get("pno-v18-filterbar").selects.every((item) => !item.disabled));
});

for (const [type, status, expected] of [
  ["total", "รอ", ["SYNTHETIC-A", "SYNTHETIC-B", "SYNTHETIC-D"]],
  ["already", "เข้าแล้ว", ["SYNTHETIC-C"]],
  ["no_entry", "หลุดสแกนเข้า", ["SYNTHETIC-A"]],
  ["scan_gap", "ข้อมูลสแกนเข้ายังไม่พร้อม", ["SYNTHETIC-C"]],
]) test(`${type}: shared status filter respects view-specific status`, () => {
  const h = harness({ type }); h.state.filters.status = status;
  assert.deepEqual([...h.call("pnoV18FilteredParcelEntries().map(({item}) => item.pno)")], expected);
});

test("latest action, destination HUB and raw destination branch are independent predicates", () => {
  const h = harness(); h.state.filters.action = "ส่ง"; h.state.filters.branch = "BRANCH-B";
  assert.deepEqual([...h.call("pnoV18FilteredParcelEntries().map(({item}) => item.pno)")], ["SYNTHETIC-C"]);
  assert.match(extract("pnoV18FilteredParcelEntries"), /item\?\.targetBranch/);
  assert.match(extract("pnoV18FilteredParcelEntries"), /item\?\.targetHub/);
  assert.doesNotMatch(extract("pnoV18FilteredParcelEntries"), /nextStoreName/);
  assert.match(readFileSync(new URL("./patch-pno-segment-destination-truth.mjs", import.meta.url), "utf8"),
    /targetBranch: text\(row\.ticket_delivery_store_name/);
});

test("complete dataset cascades destination HUB into raw delivery branch identity", async () => {
  const all = [
    { ...rows[0], pno: "A1", targetHub: "HUB-A", targetBranch: "(TH01) สาขาเดียวกัน" },
    { ...rows[0], pno: "B1", targetHub: "HUB-B", targetBranch: "(TH02) สาขาเดียวกัน" },
  ];
  const h = harness({ all, current: all.slice(0, 1) });
  h.state.filterRows = all;
  h.state.filterKey = "SYNTHETIC_OCCURRENCE|total";
  h.call("pnoV18RenderFilters()");
  assert.match(h.nodes.get("pno-v18-filterbar").innerHTML, /value="\(TH01\) สาขาเดียวกัน">สาขาเดียวกัน/);
  assert.match(h.nodes.get("pno-v18-filterbar").innerHTML, /value="\(TH02\) สาขาเดียวกัน">สาขาเดียวกัน/);
  await h.select("hub", "HUB-A");
  assert.deepEqual([...h.call("pnoV18FilteredParcelEntries().map(({item}) => item.pno)")], ["A1"]);
  const options = h.nodes.get("pno-v18-filterbar").innerHTML;
  assert.match(options, /\(TH01\) สาขาเดียวกัน/);
  assert.doesNotMatch(options, /\(TH02\) สาขาเดียวกัน/);
  await h.select("branch", "(TH01) สาขาเดียวกัน");
  await h.select("hub", "HUB-B");
  assert.equal(h.state.filters.branch, "", "stale child selection clears on parent change");
  assert.deepEqual([...h.call("pnoV18FilteredParcelEntries().map(({item}) => item.pno)")], ["B1"]);
});

test("changing HUB retains a selected raw branch when it belongs to both HUBs", async () => {
  const all = [
    { ...rows[0], pno: "A1", targetHub: "HUB-A", targetBranch: "(TH01) SAME" },
    { ...rows[0], pno: "B1", targetHub: "HUB-B", targetBranch: "(TH01) SAME" },
  ];
  const h = harness({ all, current: all.slice(0, 1) });
  h.state.filterRows = all;
  h.state.filterKey = "SYNTHETIC_OCCURRENCE|total";
  h.call("pnoV18RenderFilters()");
  await h.select("hub", "HUB-A");
  await h.select("branch", "(TH01) SAME");
  await h.select("hub", "HUB-B");
  assert.equal(h.state.filters.branch, "(TH01) SAME");
  assert.deepEqual([...h.call("pnoV18FilteredParcelEntries().map(({item}) => item.pno)")], ["B1"]);
});

test("bag filters use grouped status, latest action and next-store name", () => {
  const h = harness({ type: "bag" }); h.state.filters.action = "ส่ง";
  assert.deepEqual([...h.call("pnoV18FilteredBagGroups().map(([bag]) => bag)")], ["SYNTHETIC-BAG-A", "SYNTHETIC-BAG-B"]);
  h.state.filters.branch = "BRANCH-B";
  assert.deepEqual([...h.call("pnoV18FilteredBagGroups().map(([bag]) => bag)")], ["SYNTHETIC-BAG-B"]);
  h.state.filters.status = "เข้าแล้ว";
  assert.deepEqual([...h.call("pnoV18FilteredBagGroups().map(([bag]) => bag)")], ["SYNTHETIC-BAG-B"]);
});

for (const type of ["total", "already", "no_entry", "bag", "scan_gap"])
  test(`${type}: shared filter bar is visible with identical control categories`, () => {
    const h = harness({ type }); h.call("pnoV18RenderFilters()");
    const markup = h.nodes.get("pno-v18-filterbar").innerHTML;
    for (const label of ["สถานะ", "การดำเนินการล่าสุด",
      type === "bag" ? "ชื่อสาขาต่อไป" : "สาขาปลายทาง", ...(type === "bag" ? [] : ["HUB ปลายทาง"])])
      assert.ok(markup.includes(label), label);
    assert.doesNotMatch(markup, /HUB ถัดไป|HUBปลายทาง/);
    assert.equal((markup.match(/data-pno-v18-filter=/g) || []).length, type === "bag" ? 3 : 4);
    assert.equal(h.observed.fetch.length, 0, "rendering controls never reads another page");
  });

for (const from of ["total", "already", "no_entry", "bag", "scan_gap"])
  for (const to of ["total", "already", "no_entry", "bag", "scan_gap"].filter((type) => type !== from))
    test(`${from} → ${to}: switching tabs clears filters and prepares only the opened view`, async () => {
      const h = harness({ type: from });
      Object.assign(h.state.filters, { status: "รอ", action: "รับ", branch: "BRANCH-A" });
      h.state.filterRows = rows;
      h.state.filterKey = `SYNTHETIC_OCCURRENCE|${from}`;
      h.state.filterAt = Date.now();
      await h.call(to === "scan_gap" ? "pnoInboundLoad(1)"
        : to === "bag" ? "pnoV18LoadBags()" : `pnoV18Load("${to}", 1)`);
      await h.waitPrepared();
      assert.deepEqual(h.state.filters, { status: "", action: "", hub: "", branch: "" });
      assert.equal(to === "bag" ? h.state.filterRows : h.state.filterRows?.length, to === "bag" ? null : rows.length);
      assert.deepEqual(h.observed.fetch.map(([sourceType, page]) => [sourceType, page]),
        to === "bag" ? [["total", 1]] : [[to === "scan_gap" ? "total" : to, 1], [to === "scan_gap" ? "total" : to, 1]],
        "only the explicitly selected view prepares");
      assert.equal(h.observed.toast.length, 0);
    });

test("reset clears all common fields and rerenders without a hidden restriction", () => {
  const h = harness(); Object.assign(h.state.filters, { status: "รอ", action: "รับ", branch: "BRANCH-A" });
  h.call("pnoV18RenderFilters()"); h.nodes.get("pno-v18-filter-reset").onclick();
  assert.deepEqual(h.state.filters, { status: "", action: "", hub: "", branch: "" });
  assert.deepEqual(h.observed.parcels, rows.map((r) => r.pno));
});

test("modal reopening resets shared selections", () => {
  const opener = staged.slice(staged.indexOf("openPendingParcels = async function pnoV18OpenPendingParcels"));
  for (const key of ["status", "action", "branch"])
    assert.match(opener, new RegExp(`pnoV18State\\.filters\\.${key} = ""`));
});

test("filter option population uses full already loaded dataset and avoids extra requests", () => {
  const h = harness({ current: [rows[0]], all: rows }); h.state.filterRows = rows;
  h.state.filterKey = "SYNTHETIC_OCCURRENCE|total"; h.state.filterAt = Date.now();
  h.call("pnoV18RenderFilters()");
  assert.match(h.nodes.get("pno-v18-filterbar").innerHTML, /BRANCH-B/);
  assert.equal(h.observed.fetch.length, 0);
});

test("explicit parcel filter loads existing bounded pages and paginates filtered results", async () => {
  const big = Array.from({ length: 450 }, (_, i) => ({ ...rows[i % 2 ? 2 : 0], pno: `SYNTHETIC-${i}` }));
  const h = harness({ current: big.slice(0, 200), all: big }); h.state.filters.status = "รอ";
  await h.call("pnoV18EnsureParcelFilterRows()");
  assert.deepEqual(h.observed.fetch.map(([, page]) => page), [1, 2, 3]);
  assert.equal(h.call("pnoV18FilteredParcelEntries().length"), 225);
  assert.equal(h.call("pnoV18VisibleParcelEntries().length"), 200);
  h.state.filterPage = 2;
  assert.equal(h.call("pnoV18VisibleParcelEntries().length"), 25);
});

test("scan-gap opens page 1 then prepares its mapped total source automatically", async () => {
  const all = Array.from({ length: 201 }, (_, i) => ({ ...rows[i === 0 || i === 200 ? 0 : 1], pno: `SYNTHETIC-${i}` }));
  const h = harness({ type: "total", current: all.slice(0, 200), all });
  await h.call("pnoInboundLoad(1)");
  assert.equal(h.state.type, "scan_gap");
  await h.waitPrepared();
  assert.deepEqual(h.observed.fetch.map(([, page]) => page), [1, 1, 2]);
  assert.equal(h.state.filterRows.length, 201);
  assert.deepEqual(Array.from(h.observed.gap), ["SYNTHETIC-0", "SYNTHETIC-200"]);
  assert.match(h.nodes.get("pno-v18-page").textContent, /ผลกรอง หน้า 1 \/ 1/);
  await h.select("branch", "BRANCH-A");
  assert.deepEqual(h.observed.fetch.map(([, page]) => page), [1, 1, 2]);
  assert.deepEqual(Array.from(h.observed.gap), ["SYNTHETIC-0", "SYNTHETIC-200"]);
  assert.deepEqual(Array.from(h.observed.result), [2, 2]);
  assert.match(h.nodes.get("pno-v18-page").textContent, /ผลกรอง หน้า 1 \/ 1/);
});

test("scan-gap page navigation follows filtered rows, not provider total", () => {
  const many = Array.from({ length: 205 }, (_, i) => ({ ...rows[0], pno: `SYNTHETIC-${i}` }));
  const h = harness({ type: "scan_gap", all: many });
  h.state.filterRows = many;
  h.state.filterKey = "SYNTHETIC_OCCURRENCE|scan_gap"; h.state.filterAt = Date.now();
  h.state.filters.status = "หลุดสแกนเข้า";
  h.call("pnoV18Navigate(1)");
  assert.equal(h.state.filterPage, 2);
  assert.equal(h.observed.gap.length, 5);
  assert.deepEqual(h.observed.result, [5, 205]);
  assert.equal(h.observed.fetch.length, 0);
});

test("bag copy and export contain the same filtered grouped rows", async () => {
  const h = harness({ type: "bag" }); h.state.filters.branch = "BRANCH-B";
  await h.call("pnoV18Copy()"); await h.call("pnoV18Export()");
  assert.match(h.observed.clip, /SYNTHETIC-BAG-B/);
  assert.doesNotMatch(h.observed.clip, /SYNTHETIC-BAG-A/);
  assert.equal(h.observed.downloads[0].values.length, 1);
  assert.equal(h.observed.downloads[0].values[0]["เลขถุงแบ็กกิ้ง"], "SYNTHETIC-BAG-B");
  assert.equal(h.observed.downloads[0].values[0]["จำนวนพัสดุ"], 1);
  assert.equal(h.observed.downloads[0].values[0]["ชื่อสาขาต่อไป"], "BRANCH-B");
  assert.match(h.observed.clip, /ชื่อสาขาต่อไป/);
  assert.equal(h.observed.fetch.length, 0);
});

test("parcel copy and export use active full-dataset filter", async () => {
  const h = harness(); h.state.filters.branch = "BRANCH-B";
  await h.call("pnoV18EnsureParcelFilterRows()");
  await h.call("pnoV18Copy()"); await h.call("pnoV18Export()");
  assert.match(h.observed.clip, /SYNTHETIC-C/);
  assert.doesNotMatch(h.observed.clip, /SYNTHETIC-A/);
  assert.deepEqual(Array.from(h.observed.downloads[0].values, (v) => v.PNO), ["SYNTHETIC-C"]);
  assert.equal(h.observed.downloads[0].values[0]["สาขาปลายทาง"], "BRANCH-B");
  assert.match(h.observed.clip, /สาขาปลายทาง/);
});

test("scan-gap export contains only filtered evidence membership", async () => {
  const h = harness({ type: "scan_gap" }); h.state.filters.branch = "BRANCH-A";
  await h.call("pnoV18Export()");
  assert.equal(h.observed.downloads[0].name, "หลักฐานสแกนเข้า");
  assert.deepEqual(Array.from(h.observed.downloads[0].values, (v) => v.PNO), ["SYNTHETIC-A"]);
  assert.equal(h.observed.downloads[0].values[0]["สถานะหลักฐานสแกนเข้า"], "หลุดสแกนเข้า");
  assert.ok("เหตุผล" in h.observed.downloads[0].values[0]);
  assert.deepEqual(h.observed.fetch.map(([type, page]) => [type, page]), [["total", 1]]);
});

test("scan-gap copy uses only classified, branch-filtered evidence rows", async () => {
  const h = harness({ type: "scan_gap" }); h.state.filters.action = "ส่ง";
  await h.call("pnoV18Copy()");
  assert.match(h.observed.clip, /SYNTHETIC-C/);
  assert.doesNotMatch(h.observed.clip, /SYNTHETIC-A|SYNTHETIC-B|SYNTHETIC-D/);
});

test("unfiltered parcel export includes all bounded pages without changing visible page", async () => {
  const big = Array.from({ length: 205 }, (_, i) => ({ ...rows[0], pno: `SYNTHETIC-${i}` }));
  const h = harness({ current: big.slice(0, 200), all: big });
  await h.call("pnoV18Copy()");
  assert.equal(h.observed.fetch.length, 0, "Copy uses only the materialized page");
  assert.equal(h.observed.clip.split("\n").length, 201);
  await h.call("pnoV18Export()");
  assert.deepEqual(h.observed.fetch.map(([, page]) => page), [1, 2]);
  assert.equal(h.observed.downloads[0].values.length, 205);
  assert.equal(h.state.rows.length, 200);
});

test("LINE copy reads filtered rows and grouped bag summary", async () => {
  const h = harness({ type: "bag" }); h.state.filters.branch = "BRANCH-B";
  h.call("pnoV18LineHeader = () => ['SYNTHETIC HEADER']");
  await h.call("pnoV18CopyLine()");
  assert.match(h.observed.clip, /SYNTHETIC-BAG-B/);
  assert.doesNotMatch(h.observed.clip, /SYNTHETIC-BAG-A/);
  assert.match(h.observed.clip, /BRANCH-B/);
});

test("view lifecycle prepares filters; selector events never acquire pages", () => {
  const load = extract("pnoV18LoadOwned");
  assert.doesNotMatch(load, /await pnoV18EnsureParcelFilterRows\(\)/);
  assert.match(load, /await pnoV18PrepareCurrentFilters\(owner\)/);
  assert.doesNotMatch(extract("pnoV18RenderFilters"), /onfocus|onpointerdown|pnoV18EnsureParcelFilterRows/);
});

test("traffic: modal open prepares once; Copy, LINE Copy and Export reuse authority", async () => {
  const all = Array.from({ length: 401 }, (_, i) => ({ ...rows[0], pno: `SYNTHETIC-${i}` }));
  const h = harness({ all, current: all.slice(0, 200) });
  await h.call('pnoV18Load("total", 1)');
  await h.waitPrepared();
  assert.deepEqual(h.observed.fetch.map(([, page]) => page), [1, 1, 2, 3]);
  h.call("pnoV18RenderFilters()");
  assert.equal(h.observed.fetch.length, 4);
  await h.call("pnoV18Copy()");
  assert.equal(h.observed.fetch.length, 4);
  assert.equal(h.observed.clip.split("\n").length, 402, "Copy uses the complete current authority");
  h.call("pnoV18LineHeader = () => ['SYNTHETIC HEADER']");
  await h.call("pnoV18CopyLine()");
  assert.equal(h.observed.fetch.length, 4);
  await h.call("pnoV18Export()");
  assert.deepEqual(h.observed.fetch.map(([, page]) => page), [1, 1, 2, 3]);
  assert.equal(h.observed.downloads[0].values.length, 401);
});

for (const [key, value] of [["status", "รอ"], ["action", "รับ"], ["branch", "BRANCH-A"]])
  test(`traffic: first ready ${key} selection adds no acquisition`, async () => {
    const all = Array.from({ length: 401 }, (_, i) => ({ ...rows[0], pno: `SYNTHETIC-${i}` }));
    const h = harness({ all, current: all.slice(0, 200) });
    await h.call('pnoV18Load("total", 1)');
    await h.waitPrepared();
    await h.select(key, value);
    assert.deepEqual(h.observed.fetch.map(([type, page]) => [type, page]),
      [["total", 1], ["total", 1], ["total", 2], ["total", 3]]);
    assert.equal(h.call("pnoV18FilteredParcelEntries().length"), 401);
    const acquired = h.observed.fetch.length;
    await h.call("pnoV18Copy()");
    h.call("pnoV18LineHeader = () => ['SYNTHETIC HEADER']");
    await h.call("pnoV18CopyLine()");
    await h.call("pnoV18Export()");
    assert.equal(h.observed.fetch.length, acquired, "Copy, LINE Copy and Export reuse materialized rows");
  });

test("traffic: scan-gap prepares mapped source and navigates locally after readiness", async () => {
  const all = Array.from({ length: 401 }, (_, i) => ({ ...rows[0], pno: `SYNTHETIC-${i}` }));
  const h = harness({ type: "total", all, current: all.slice(0, 200) });
  await h.call("pnoInboundLoad(1)");
  await h.waitPrepared();
  assert.deepEqual(h.observed.fetch.map(([, page]) => page), [1, 1, 2, 3]);
  h.call("pnoV18Navigate(1)");
  assert.deepEqual(h.observed.fetch.map(([, page]) => page), [1, 1, 2, 3]);
  assert.match(h.nodes.get("pno-v18-page").textContent, /ผลกรอง หน้า 2 \/ 3/);
  await h.call("pnoV18Copy()");
  h.call("pnoV18LineHeader = () => ['SYNTHETIC HEADER']");
  await h.call("pnoV18CopyLine()");
  assert.equal(h.observed.fetch.length, 4);
  assert.equal(h.observed.clip.includes("SYNTHETIC-0"), true, "Copy uses prepared source");
  await h.select("status", "หลุดสแกนเข้า");
  assert.deepEqual(h.observed.fetch.map(([, page]) => page), [1, 1, 2, 3]);
  assert.deepEqual(Array.from(h.observed.result), [200, 401]);
  h.call("pnoV18Navigate(1)");
  assert.deepEqual(Array.from(h.observed.result), [200, 401]);
  assert.match(h.nodes.get("pno-v18-page").textContent, /ผลกรอง หน้า 2 \/ 3/);
  const acquired = h.observed.fetch.length;
  await h.call("pnoV18Copy()");
  await h.call("pnoV18CopyLine()");
  await h.call("pnoV18Export()");
  assert.equal(h.observed.fetch.length, acquired);
  assert.equal(h.observed.downloads[0].values.length, 401);
});

test("traffic: leaving and reopening scan-gap isolates type authority", async () => {
  const all = Array.from({ length: 401 }, (_, i) => ({ ...rows[0], pno: `SYNTHETIC-${i}` }));
  const h = harness({ type: "total", all, current: all.slice(0, 200) });
  await h.call("pnoInboundLoad(1)");
  await h.waitPrepared();
  const firstKey = h.state.filterKey;
  await h.call('pnoV18Load("total", 1)');
  await h.waitPrepared();
  assert.notEqual(h.state.filterKey, firstKey);
  await h.call("pnoInboundLoad(1)");
  await h.waitPrepared();
  assert.equal(h.state.filterKey, firstKey);
  assert.equal(h.state.filterRows.length, 401);
  assert.deepEqual(h.observed.fetch.map(([, page]) => page), [1, 1, 2, 3, 1, 1, 2, 3, 1, 1, 2, 3]);
});

for (const [key, value] of [["status", "หลุดสแกนเข้า"], ["action", "รับ"], ["branch", "BRANCH-A"]])
  test(`traffic: scan-gap ${key} selection reuses automatic authority`, async () => {
    const all = Array.from({ length: 201 }, (_, i) => ({ ...rows[0], pno: `SYNTHETIC-${i}` }));
    const h = harness({ type: "total", all, current: all.slice(0, 200) });
    await h.call("pnoInboundLoad(1)");
    await h.waitPrepared();
    assert.equal(h.observed.fetch.length, 3);
    await h.select(key, value);
    assert.deepEqual(h.observed.fetch.map(([type, page]) => [type, page]),
      [["total", 1], ["total", 1], ["total", 2]]);
    assert.deepEqual(Array.from(h.observed.result), [200, 201]);
    const acquired = h.observed.fetch.length;
    await h.call("pnoV18Copy()");
    await h.call("pnoV18Export()");
    assert.equal(h.observed.fetch.length, acquired);
    assert.equal(h.observed.downloads[0].values.length, 201);
  });

test("traffic: unfiltered scan-gap Export uses the parent's bounded page budget", async () => {
  const all = Array.from({ length: 401 }, (_, i) => ({ ...rows[0], pno: `SYNTHETIC-${i}` }));
  const h = harness({ type: "total", all, current: all.slice(0, 200) });
  await h.call("pnoInboundLoad(1)");
  await h.waitPrepared();
  assert.equal(h.observed.fetch.length, 4);
  await h.call("pnoV18Export()");
  assert.deepEqual(h.observed.fetch.map(([type, page]) => [type, page]),
    [["total", 1], ["total", 1], ["total", 2], ["total", 3]]);
  assert.equal(h.observed.downloads[0].values.length, 401);
});

test("traffic: bag opening keeps the existing full-page budget, Copy and Export remain local", async () => {
  const all = Array.from({ length: 401 }, (_, i) => ({ ...rows[0], pno: `SYNTHETIC-${i}` }));
  const h = harness({ type: "total", all, current: all.slice(0, 200) });
  await h.call("pnoV18LoadBags()");
  assert.deepEqual(h.observed.fetch.map(([type, page]) => [type, page]),
    [["total", 1], ["total", 2], ["total", 3]]);
  const acquired = h.observed.fetch.length;
  await h.call("pnoV18Copy()");
  h.call("pnoV18LineHeader = () => ['SYNTHETIC HEADER']");
  await h.call("pnoV18CopyLine()");
  await h.call("pnoV18Export()");
  assert.equal(h.observed.fetch.length, acquired);
  assert.equal(h.observed.downloads[0].values[0]["จำนวนพัสดุ"], 401);
});

test("no automatic curl_pno, background timer or provider acquisition added by patch", () => {
  const patch = readFileSync(new URL("./patch-pno-cross-view-filter-parity.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(patch, /curl_pno|setInterval\(|new WebSocket\(|EventSource\(/);
  assert.match(extract("pnoV18EnsureParcelFilterRows"), /await pnoV18Fetch\(sourceType, page, owner\)/);
  assert.doesNotMatch(extract("pnoV18RenderFilters"), /pnoV18Fetch\(/);
});

test("tab membership and scan-in persistence remain upstream-owned", () => {
  const patch = readFileSync(new URL("./patch-pno-cross-view-filter-parity.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(patch, /scanInObserved|arrivalAnchorAt|pnoSegmentCount|pnoDetailAvailable|observePnoSnapshot/);
  assert.match(extract("pnoV18FilteredParcelEntries"), /SUSPECTED_SCAN_IN_GAP.*INSUFFICIENT_HISTORY/);
  assert.match(staged, /PNO_NEXT_STORE_SEMANTICS_V3/);
});

for (const total of [200, 201, 1000, 4000, 5000, 5037]) {
  test(`all-page filter acquires exactly ${total} rows through provider-reported total`, async () => {
    const all = Array.from({ length: total }, (_, i) => ({
      pno: `SYNTHETIC-${i}`, status: i % 2 ? "MATCH" : "OTHER",
      lastAction: i === total - 1 ? "LAST-PAGE" : "EARLY", targetBranch: "BRANCH",
    }));
    const h = harness({ all, current: all.slice(0, 200) });
    await h.call("pnoV18EnsureParcelFilterRows()");
    assert.equal(h.state.filterRows.length, total);
    assert.deepEqual(h.observed.fetch.map(([, page]) => page),
      Array.from({ length: Math.ceil(total / 200) }, (_, i) => i + 1));
    h.state.filters.action = "LAST-PAGE";
    assert.deepEqual([...h.call("pnoV18FilteredParcelEntries().map(({item}) => item.pno)")],
      [`SYNTHETIC-${total - 1}`]);
  });
}

test("automatic preparation exposes page-25-only options before first latest-action interaction", async () => {
  const all = Array.from({ length: 5000 }, (_, i) => ({ pno: `SYNTHETIC-${i}`,
    status: "READY", lastAction: i === 0 ? "A" : i === 1 ? "B" :
      i === 200 ? "C" : i === 1800 ? "D" : i === 4999 ? "E" : "A",
    targetBranch: i === 4999 ? "LAST-BRANCH" : "FIRST-BRANCH" }));
  const h = harness({ all, current: all.slice(0, 200) });
  await h.call('pnoV18Load("total", 1)');
  await h.waitPrepared();
  assert.equal(h.observed.fetch.length, 26);
  assert.doesNotMatch(h.nodes.get("pno-v18-filterbar").innerHTML, /เลือกเพื่อรวมข้อมูลทุกหน้า/);
  await h.select("action", "E");
  const options = h.nodes.get("pno-v18-filterbar").innerHTML;
  for (const action of ["A", "B", "C", "D", "E"]) assert.match(options, new RegExp(`>${action}<`));
  assert.match(options, /LAST-BRANCH/);
  assert.equal(h.observed.fetch.length, 26);
  assert.deepEqual([...h.call("pnoV18FilteredParcelEntries().map(({item}) => item.pno)")], ["SYNTHETIC-4999"]);
  await h.select("status", "READY");
  await h.select("branch", "LAST-BRANCH");
  assert.equal(h.observed.fetch.length, 26, "switching all three filters reuses the assembled pages");
  assert.equal(h.call("pnoV18FilteredParcelEntries().length"), 1);
});

test("materialized global options survive view-cache TTL while selected filter and pager remain active", async () => {
  const all = Array.from({ length: 401 }, (_, i) => ({ pno: `SYNTHETIC-${i}`,
    status: i < 301 ? "READY" : "OTHER", lastAction: i < 301 ? "SCAN_OUT" : "OTHER",
    targetBranch: i < 301 ? "BRANCH-A" : "BRANCH-B" }));
  const h = harness({ all, current: all.slice(0, 200) });
  h.installActualRender();
  await h.call('pnoV18Load("total", 1)');
  await h.waitPrepared();
  await h.select("action", "SCAN_OUT");
  assert.equal(h.observed.fetch.length, 4);
  assert.equal(h.call("pnoV18FilteredParcelEntries().length"), 301);
  h.advance(60_001);
  h.call("pnoV18RenderFilters(); pnoV18RenderCurrentFilteredView()");
  const options = h.nodes.get("pno-v18-filterbar").innerHTML;
  assert.match(options, />SCAN_OUT</);
  assert.match(options, />READY</);
  assert.match(options, />BRANCH-A</);
  assert.doesNotMatch(options, /เลือกเพื่อรวมข้อมูลทุกหน้า/);
  assert.equal(h.state.filters.action, "SCAN_OUT");
  assert.equal(h.call("pnoV18VisibleParcelEntries().length"), 200);
  assert.match(h.nodes.get("pno-v18-page").textContent, /1 \/ 2/);
  await h.select("status", "READY");
  await h.select("branch", "BRANCH-A");
  assert.equal(h.observed.fetch.length, 4, "same locator reuses materialized rows after view TTL");
  assert.equal(h.call("pnoV18FilteredParcelEntries().length"), 301);
  h.call("pnoV18Navigate(1)");
  assert.equal(h.call("pnoV18VisibleParcelEntries().length"), 101);
  assert.match(h.nodes.get("pno-v18-page").textContent, /2 \/ 2/);
  h.nodes.get("pno-v18-filter-reset").onclick();
  assert.equal(h.call("pnoV18FilteredParcelEntries().length"), 401);
  assert.match(h.nodes.get("pno-v18-filterbar").innerHTML, />SCAN_OUT</);
  assert.equal(h.observed.fetch.length, 4);
});

test("5000 source, 843 matches and 200-row display have separate truthful counts", async () => {
  const all = Array.from({ length: 5000 }, (_, i) => ({ pno: `SYNTHETIC-${i}`,
    status: i < 843 ? "MATCH" : "OTHER", lastAction: "ACTION", targetBranch: "BRANCH" }));
  const h = harness({ all, current: all.slice(0, 200) });
  h.installActualRender();
  await h.call('pnoV18Load("total", 1)');
  await h.waitPrepared();
  await h.select("status", "MATCH");
  assert.equal(h.call("pnoV18FilteredParcelEntries().length"), 843);
  assert.equal(h.call("pnoV18VisibleParcelEntries().length"), 200);
  assert.match(h.nodes.get("pno-v18-page").textContent, /1 \/ 5/);
  assert.match(h.nodes.get("pno-v18-filter-result").textContent,
    /ทั้งหมด 5,000 · ผลกรอง 843 · แสดงหน้านี้ 200/);
  h.call("pnoV18Navigate(4)");
  assert.equal(h.state.filterPage, 5);
  assert.equal(h.call("pnoV18VisibleParcelEntries().length"), 43);
  assert.match(h.nodes.get("pno-v18-filter-result").textContent, /แสดงหน้านี้ 43/);
  await h.call("pnoV18Copy()");
  assert.match(h.observed.clip, /SYNTHETIC-0/);
  assert.match(h.observed.clip, /SYNTHETIC-842/);
  h.call("pnoV18LineHeader = () => ['SYNTHETIC HEADER']");
  await h.call("pnoV18CopyLine()");
  assert.match(h.observed.clip, /ยังมีอีก/);
  await h.call("pnoV18Export()");
  assert.equal(h.observed.downloads[0].values.length, 843);
  assert.equal(h.observed.fetch.length, 26);
});

test("locator change and explicit refresh invalidate assembled filter authority", async () => {
  const tripA = Array.from({ length: 5000 }, (_, i) => ({ pno: `A-${i}`, lastAction: "A", targetBranch: "A" }));
  const tripB = Array.from({ length: 600 }, (_, i) => ({ pno: `B-${i}`, lastAction: "B", targetBranch: "B" }));
  const h = harness({ all: tripA, current: tripA.slice(0, 200), fetchPage: (_type, page, state) => {
    const dataset = state.sourceRow.proofId === "TRIP-B" ? tripB : tripA;
    return { total: dataset.length, page, parcels: dataset.slice((page - 1) * 200, page * 200) };
  }});
  await h.call("pnoV18EnsureParcelFilterRows()");
  assert.equal(h.observed.fetch.length, 25);
  h.state.sourceRow = { proofId: "TRIP-B", pnoSourceDay: "2026-09-29" };
  await h.call("pnoV18EnsureParcelFilterRows()");
  assert.equal(h.state.filterRows.length, 600);
  assert.ok(h.state.filterRows.every((row) => row.pno.startsWith("B-")));
  h.call("pnoV18RenderFilters()");
  assert.doesNotMatch(h.nodes.get("pno-v18-filterbar").innerHTML, />A</);
  assert.equal(h.observed.fetch.length, 28);
  h.state.filterForce = true;
  await h.call("pnoV18EnsureParcelFilterRows()");
  assert.equal(h.observed.fetch.length, 31);
});

test("partial middle-page failure or overlapping PNO never yields global complete", async () => {
  const all = Array.from({ length: 5000 }, (_, i) => ({ pno: `SYNTHETIC-${i}` }));
  const failure = harness({ all, current: all.slice(0, 200), fetchPage: (_type, page) => {
    if (page === 17) throw new Error("synthetic page failure");
    return { total: all.length, page, parcels: all.slice((page - 1) * 200, page * 200) };
  }});
  await assert.rejects(failure.call("pnoV18EnsureParcelFilterRows()"), /synthetic page failure/);
  assert.equal(failure.state.filterRows, null);
  assert.match(failure.nodes.get("pno-v18-filter-result").textContent, /ยังไม่แสดงผลกรองทั้งชุด/);
  const overlap = Array.from({ length: 201 }, (_, i) => ({ pno: `SYNTHETIC-${i}` }));
  overlap[200].pno = overlap[0].pno;
  const duplicate = harness({ all: overlap, current: overlap.slice(0, 200) });
  await assert.rejects(duplicate.call("pnoV18EnsureParcelFilterRows()"), /ข้ามหน้าซ้ำ/);
  assert.equal(duplicate.state.filterRows, null);
});

test("staged DEV Worker accepts provider detail page 26 without changing endpoint or page size", () => {
  const worker = stageWorker(readFileSync(new URL("../../worker/src/index.js", import.meta.url), "utf8"));
  const normalize = worker.slice(worker.indexOf("function normalizePnoLocator"), worker.indexOf("function validatePnoLocator"));
  assert.match(normalize, /Number\.isSafeInteger\(requestedPage\)/);
  assert.doesNotMatch(normalize, /Math\.min\(20/);
  const context = vm.createContext({
    normalizeProofId: (value) => String(value || ""),
    PNO_VALID_TYPES: new Set(["total"]),
    text: (value) => String(value || ""),
  });
  vm.runInContext(normalize, context);
  assert.equal(vm.runInContext('normalizePnoLocator({page: 26, type: "total"}, "HUB").page', context), 26);
  assert.match(worker, /route_followstart_list/);
  assert.match(worker, /page_size: String\(PNO_PAGE_SIZE\)/);
  assert.match(worker, /const PNO_PAGE_SIZE = 200/);
  assert.doesNotMatch(readFileSync(new URL("./patch-pno-all-page-filter-truth.mjs", import.meta.url), "utf8"),
    /curl_pno|pno\/history|setInterval\(|setTimeout\(/);
});
