import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { stageFrontend } from "./stage-dev-runtime.mjs";
import { patchPnoCrossViewFilterParity } from "./patch-pno-cross-view-filter-parity.mjs";

const staged = stageFrontend(readFileSync(new URL("../../ms.js", import.meta.url), "utf8"));
const functions = [
  "pnoV18TextValue", "pnoV18UniqueValues", "pnoV18FilterOption", "pnoV18ValidateFilter",
  "pnoPendingEvidenceLabel", "pnoV18TypeLabel", "pnoV18ParcelStatus", "pnoV18ParcelAction",
  "pnoV18ParcelFilterActive", "pnoV18ParcelFilterDataset", "pnoV18FilteredParcelEntries",
  "pnoV18VisibleParcelEntries", "pnoV18EnsureParcelFilterRows", "pnoV18Navigate",
  "pnoV18BagGroups", "pnoV18BagValue", "pnoV18BagLatest", "pnoV18BagSummary",
  "pnoV18FilteredBagGroups", "pnoV18FilterSummaryText", "pnoV18RenderCurrentFilteredView",
  "pnoV18RenderFilters", "pnoInboundLoad", "pnoV18Export", "pnoV18Copy", "pnoV18CopyLine",
  "pnoV18TsvCell", "pnoV18LineCell", "pnoV18AppendLineLimited",
  "pnoV18Load", "pnoV18LoadBags",
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
];

function harness({ type = "total", all = rows, current = rows, total = all.length } = {}) {
  const nodes = new Map(), observed = { fetch: [], downloads: [], clip: "", gap: [], toast: [] };
  const node = (key) => {
    if (!nodes.has(key)) nodes.set(key, {
      innerHTML: "", textContent: "", disabled: false,
      classList: { add() {}, remove() {} },
      querySelectorAll() { this.selects = [...this.innerHTML.matchAll(/data-pno-v18-filter="([^"]+)"/g)]
        .map((match) => ({ dataset: { pnoV18Filter: match[1] }, value: "", onchange: null })); return this.selects; },
      selects: [],
    });
    return nodes.get(key);
  };
  const state = {
    type, page: 1, rows: current, total, bagRows: type === "bag" ? all : null,
    filterRows: null, filterKey: "",
    filterPage: 1, sourceRow: { proofId: "SYNTHETIC_PROOF", pnoNextStoreName: "NEXT-STORE" },
    filters: { status: "", action: "", branch: "" }, busy: false,
  };
  const context = vm.createContext({
    pnoV18State: state, state: { branch: "CURRENT-HUB" },
    nf: new Intl.NumberFormat("en-US"),
    esc: (v) => String(v ?? ""), el: node,
    pnoV18SourceRow: () => state.sourceRow,
    pnoV18LocatorKey: () => "SYNTHETIC_OCCURRENCE",
    pnoV18PageCacheKey: (_row, sourceType, page) => `${sourceType}|${page}`,
    pnoV18ViewCache: new Map(), pnoV18BagCache: new Map(),
    pnoV18CacheGet: () => null, pnoV18CacheSet: (_map, _key, value) => value,
    pendingParcelRows: [],
    pnoV18Fetch: async (sourceType, page) => {
      observed.fetch.push([sourceType, page]);
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
  return { state, observed, nodes, call: (expression) => vm.runInContext(expression, context),
    select: async (key, value) => {
      vm.runInContext("pnoV18RenderFilters()", context);
      const element = node("pno-v18-filterbar").selects.find((item) => item.dataset.pnoV18Filter === key);
      assert.ok(element, `filter ${key} exists`);
      element.value = value;
      await element.onchange();
    } };
}

test("effective staging parses, is idempotent and has three shared controls without a HUB filter", () => {
  assert.doesNotThrow(() => new Function(staged));
  assert.equal(stageFrontend(staged), staged);
  assert.equal(patchPnoCrossViewFilterParity(staged), staged);
  assert.match(staged, /PNO_CROSS_VIEW_FILTER_PARITY_V1/);
  assert.doesNotMatch(extract("pnoV18RenderFilters"), /bagHub|targetHub|pnoNextStoreName/);
  for (const control of ["status", "action", "branch"])
    assert.match(extract("pnoV18RenderFilters"), new RegExp(`\\["${control}"`));
});

for (const [type, status, expected] of [
  ["total", "รอ", ["SYNTHETIC-A", "SYNTHETIC-B", "SYNTHETIC-D"]],
  ["already", "เข้าแล้ว", ["SYNTHETIC-C"]],
  ["no_entry", "สงสัยหลุดสแกนเข้า", ["SYNTHETIC-A"]],
  ["scan_gap", "ประวัติไม่เพียงพอ", ["SYNTHETIC-C"]],
]) test(`${type}: shared status filter respects view-specific status`, () => {
  const h = harness({ type }); h.state.filters.status = status;
  assert.deepEqual([...h.call("pnoV18FilteredParcelEntries().map(({item}) => item.pno)")], expected);
});

test("latest action and delivery branch are independent predicates", () => {
  const h = harness(); h.state.filters.action = "ส่ง"; h.state.filters.branch = "BRANCH-B";
  assert.deepEqual([...h.call("pnoV18FilteredParcelEntries().map(({item}) => item.pno)")], ["SYNTHETIC-C"]);
  assert.match(extract("pnoV18FilteredParcelEntries"), /item\?\.targetBranch/);
  assert.doesNotMatch(extract("pnoV18FilteredParcelEntries"), /targetHub|nextStoreName/);
  assert.match(readFileSync(new URL("./patch-pno-next-branch-truth.mjs", import.meta.url), "utf8"),
    /targetBranch: cleanStoreName\(row\.ticket_delivery_store_name\)/);
});

test("bag filters use grouped status, latest action and delivery branch", () => {
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
    for (const label of ["สถานะ", "การดำเนินการล่าสุด", "สาขาปลายทาง"])
      assert.ok(markup.includes(label), label);
    assert.doesNotMatch(markup, /HUB ถัดไป|HUBปลายทาง/);
    assert.equal((markup.match(/data-pno-v18-filter=/g) || []).length, 3);
    assert.equal(h.observed.fetch.length, 0, "rendering controls never reads another page");
  });

for (const from of ["total", "already", "no_entry", "bag", "scan_gap"])
  for (const to of ["total", "already", "no_entry", "bag", "scan_gap"].filter((type) => type !== from))
    test(`${from} → ${to}: switching tabs clears filters and loads no extra pages`, async () => {
      const h = harness({ type: from });
      Object.assign(h.state.filters, { status: "รอ", action: "รับ", branch: "BRANCH-A" });
      h.state.filterRows = rows;
      h.state.filterKey = `SYNTHETIC_OCCURRENCE|${from}`;
      await h.call(to === "scan_gap" ? "pnoInboundLoad(1)"
        : to === "bag" ? "pnoV18LoadBags()" : `pnoV18Load("${to}", 1)`);
      assert.deepEqual(h.state.filters, { status: "", action: "", branch: "" });
      assert.equal(h.state.filterRows, null);
      assert.equal(h.observed.fetch.length, 1, "only parent-equivalent first page");
      assert.equal(h.observed.toast.length, 0);
    });

test("reset clears all common fields and rerenders without a hidden restriction", () => {
  const h = harness(); Object.assign(h.state.filters, { status: "รอ", action: "รับ", branch: "BRANCH-A" });
  h.call("pnoV18RenderFilters()"); h.nodes.get("pno-v18-filter-reset").onclick();
  assert.deepEqual(h.state.filters, { status: "", action: "", branch: "" });
  assert.deepEqual(h.observed.parcels, rows.map((r) => r.pno));
});

test("modal reopening resets shared selections", () => {
  const opener = staged.slice(staged.indexOf("openPendingParcels = async function pnoV18OpenPendingParcels"));
  for (const key of ["status", "action", "branch"])
    assert.match(opener, new RegExp(`pnoV18State\\.filters\\.${key} = ""`));
});

test("filter option population uses full already loaded dataset and avoids extra requests", () => {
  const h = harness({ current: [rows[0]], all: rows }); h.state.filterRows = rows;
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

test("scan-gap opens one source page; explicit filter loads bounded pages before local pager", async () => {
  const all = Array.from({ length: 201 }, (_, i) => ({ ...rows[i === 0 || i === 200 ? 0 : 1], pno: `SYNTHETIC-${i}` }));
  const h = harness({ type: "total", current: all.slice(0, 200), all });
  await h.call("pnoInboundLoad(1)");
  assert.equal(h.state.type, "scan_gap");
  assert.deepEqual(h.observed.fetch.map(([, page]) => page), [1]);
  assert.equal(h.state.filterRows, null);
  assert.deepEqual(Array.from(h.observed.gap), ["SYNTHETIC-0"]);
  assert.match(h.nodes.get("pno-v18-page").textContent, /หน้าข้อมูลต้นทาง 1 \/ 2/);
  assert.match(h.nodes.get("pno-v18-filter-result").textContent, /หลักฐานในหน้านี้ 1/);
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
  h.state.filters.status = "สงสัยหลุดสแกนเข้า";
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
  assert.equal(h.observed.fetch.length, 0);
});

test("parcel copy and export use active full-dataset filter", async () => {
  const h = harness(); h.state.filters.branch = "BRANCH-B";
  await h.call("pnoV18EnsureParcelFilterRows()");
  await h.call("pnoV18Copy()"); await h.call("pnoV18Export()");
  assert.match(h.observed.clip, /SYNTHETIC-C/);
  assert.doesNotMatch(h.observed.clip, /SYNTHETIC-A/);
  assert.deepEqual(Array.from(h.observed.downloads[0].values, (v) => v.PNO), ["SYNTHETIC-C"]);
});

test("scan-gap export contains only filtered evidence membership", async () => {
  const h = harness({ type: "scan_gap" }); h.state.filters.branch = "BRANCH-A";
  await h.call("pnoV18Export()");
  assert.equal(h.observed.downloads[0].name, "หลักฐานสแกนเข้า");
  assert.deepEqual(Array.from(h.observed.downloads[0].values, (v) => v.PNO), ["SYNTHETIC-A"]);
  assert.equal(h.observed.downloads[0].values[0]["สถานะหลักฐานสแกนเข้า"], "สงสัยหลุดสแกนเข้า");
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
});

test("ordinary tabs do not auto-load every page without an active filter", () => {
  const load = staged.slice(staged.indexOf("async function pnoV18Load(type, page)"), staged.indexOf("function pnoV18BagGroups"));
  assert.doesNotMatch(load, /await pnoV18EnsureParcelFilterRows\(\)/);
});

test("traffic: modal open, ordinary Copy, LINE Copy and Export have the parent's request budget", async () => {
  const all = Array.from({ length: 401 }, (_, i) => ({ ...rows[0], pno: `SYNTHETIC-${i}` }));
  const h = harness({ all, current: all.slice(0, 200) });
  await h.call('pnoV18Load("total", 1)');
  assert.deepEqual(h.observed.fetch, [["total", 1]]);
  h.call("pnoV18RenderFilters()");
  assert.equal(h.observed.fetch.length, 1);
  await h.call("pnoV18Copy()");
  assert.equal(h.observed.fetch.length, 1);
  assert.equal(h.observed.clip.split("\n").length, 201, "ordinary Copy uses the loaded page");
  h.call("pnoV18LineHeader = () => ['SYNTHETIC HEADER']");
  await h.call("pnoV18CopyLine()");
  assert.equal(h.observed.fetch.length, 1);
  await h.call("pnoV18Export()");
  assert.deepEqual(h.observed.fetch.map(([, page]) => page), [1, 1, 2, 3]);
  assert.equal(h.observed.downloads[0].values.length, 401);
});

for (const [key, value] of [["status", "รอ"], ["action", "รับ"], ["branch", "BRANCH-A"]])
  test(`traffic: explicit ${key} selection loads only the existing bounded pages`, async () => {
    const all = Array.from({ length: 401 }, (_, i) => ({ ...rows[0], pno: `SYNTHETIC-${i}` }));
    const h = harness({ all, current: all.slice(0, 200) });
    await h.call('pnoV18Load("total", 1)');
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

test("traffic: scan-gap remains page-by-page until an explicit filter action", async () => {
  const all = Array.from({ length: 401 }, (_, i) => ({ ...rows[0], pno: `SYNTHETIC-${i}` }));
  const h = harness({ type: "total", all, current: all.slice(0, 200) });
  await h.call("pnoInboundLoad(1)");
  assert.deepEqual(h.observed.fetch, [["total", 1]]);
  h.call("pnoV18Navigate(1)");
  await new Promise(setImmediate);
  assert.deepEqual(h.observed.fetch, [["total", 1], ["total", 2]]);
  assert.match(h.nodes.get("pno-v18-page").textContent, /หน้าข้อมูลต้นทาง 2 \/ 3/);
  await h.call("pnoV18Copy()");
  h.call("pnoV18LineHeader = () => ['SYNTHETIC HEADER']");
  await h.call("pnoV18CopyLine()");
  assert.equal(h.observed.fetch.length, 2);
  assert.equal(h.observed.clip.includes("SYNTHETIC-0"), false, "ordinary Copy uses the current page");
  await h.select("status", "สงสัยหลุดสแกนเข้า");
  assert.deepEqual(h.observed.fetch.map(([, page]) => page), [1, 2, 1, 2, 3]);
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

test("traffic: leaving and reopening scan-gap never preloads all pages", async () => {
  const all = Array.from({ length: 401 }, (_, i) => ({ ...rows[0], pno: `SYNTHETIC-${i}` }));
  const h = harness({ type: "total", all, current: all.slice(0, 200) });
  await h.call("pnoInboundLoad(1)");
  await h.call('pnoV18Load("total", 1)');
  await h.call("pnoInboundLoad(1)");
  assert.deepEqual(h.observed.fetch, [["total", 1], ["total", 1], ["total", 1]]);
  assert.equal(h.state.filterRows, null);
});

for (const [key, value] of [["status", "สงสัยหลุดสแกนเข้า"], ["action", "รับ"], ["branch", "BRANCH-A"]])
  test(`traffic: scan-gap ${key} selection alone permits existing bounded full-page loading`, async () => {
    const all = Array.from({ length: 201 }, (_, i) => ({ ...rows[0], pno: `SYNTHETIC-${i}` }));
    const h = harness({ type: "total", all, current: all.slice(0, 200) });
    await h.call("pnoInboundLoad(1)");
    assert.equal(h.observed.fetch.length, 1);
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
  assert.equal(h.observed.fetch.length, 1);
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
  assert.match(extract("pnoV18EnsureParcelFilterRows"), /await pnoV18Fetch\(sourceType, page\)/);
  assert.doesNotMatch(extract("pnoV18RenderFilters"), /pnoV18Fetch\(/);
});

test("tab membership and scan-in persistence remain upstream-owned", () => {
  const patch = readFileSync(new URL("./patch-pno-cross-view-filter-parity.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(patch, /scanInObserved|arrivalAnchorAt|pnoSegmentCount|pnoDetailAvailable|observePnoSnapshot/);
  assert.match(extract("pnoV18FilteredParcelEntries"), /SUSPECTED_SCAN_IN_GAP.*INSUFFICIENT_HISTORY/);
  assert.match(staged, /PNO_DELIVERY_BRANCH_PROVENANCE_V2/);
});
