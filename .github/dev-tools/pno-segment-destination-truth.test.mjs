import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { exactPnoSegments } from "./patch-pno-segment-destination-truth.mjs";
import { stageFrontend } from "./stage-dev-runtime.mjs";
import { readSharedPnoPage } from "../../worker/.dev-runtime/src/index.js";

const staged = stageFrontend(readFileSync(new URL("../../ms.js", import.meta.url), "utf8"));
const worker = readFileSync(new URL("../../worker/.dev-runtime/src/index.js", import.meta.url), "utf8");
const segment = (index, expected, entered) => ({
  proofId: "EXACT-TRIP", pnoSourceDay: "2026-09-30", pnoLineId: `LINE-${index}`,
  pnoStoreId: "SOURCE", pnoNextStoreId: `DROP-${index}`,
  expectedParcels: expected, enteredParcels: entered, pendingParcels: expected - entered,
  pnoNextStoreName: `DROP ${index}`, pnoCanReport: false,
});
const multi = { proofId: "EXACT-TRIP", pnoEnabled: true, pnoDetailAvailable: true,
  pnoSegmentCount: 2, expectedParcels: 203, enteredParcels: 101, pendingParcels: 102,
  pnoSegments: [segment(1, 201, 100), segment(2, 2, 1)] };

function functionBlock(name) {
  const prefix = staged.includes(`async function ${name}(`) ? `async function ${name}(` : `function ${name}(`;
  const start = staged.indexOf(prefix), end = staged.indexOf("\n}\n", start) + 2;
  assert.ok(start >= 0 && end > start, `missing ${name}`);
  return staged.slice(start, end);
}

test("worker projects raw N/Q/R independently and retains only complete exact multi-drop segments", () => {
  assert.match(worker, /nextStoreName: text\(row\.next_store_name, 300\)/);
  assert.match(worker, /targetHub: cleanStoreName\(row\.dst_hub_name\)/);
  assert.match(worker, /targetBranch: text\(row\.ticket_delivery_store_name, 300\)/);
  assert.match(worker, /"pnoSegmentCount", "pnoDetailAvailable", "pnoSegments"/);
  assert.match(worker, /if \(!value\.pnoDetailAvailable\) delete value\.pnoSegments/);
  assert.ok(exactPnoSegments(multi));
  assert.equal(exactPnoSegments({ ...multi, pnoSegments: multi.pnoSegments.slice(1) }), null);
  assert.equal(exactPnoSegments({ ...multi, pnoSegments: [multi.pnoSegments[0], multi.pnoSegments[0]] }), null);
  assert.equal(exactPnoSegments({ ...multi, pnoSegments: [multi.pnoSegments[0],
    { ...multi.pnoSegments[1], pnoNextStoreId: "" }] }), null);
  assert.equal(exactPnoSegments({ ...multi, expectedParcels: 204 }), null);
});

test("owner N/Q/R samples keep next store, destination HUB and raw branch distinct", () => {
  const context = vm.createContext({});
  vm.runInContext(`${functionBlock("pnoV18DisplayBranch")};globalThis.display=pnoV18DisplayBranch`, context);
  for (const [next, hub, raw, display] of [
    ["05 LAS_HUB-ลาซาล", "21 BPL_BHUB-บางพลี", "(TH01030514)2SWT_BDC-สามวาตะวันออก", "2SWT_BDC-สามวาตะวันออก"],
    ["09 NE2_HUB-ขอนแก่น", "27 KKC_BHUB-ขอนแก่น", "(TH37011417)2SIL_BDC-ศิลา", "2SIL_BDC-ศิลา"],
  ]) {
    assert.notEqual(next, hub);
    assert.notEqual(next, raw);
    assert.equal(context.display(raw), display);
    assert.equal(raw.startsWith("(TH"), true, "raw identity remains intact");
  }
  assert.equal(context.display("สาขา(ข้อมูลวงเล็บ)"), "สาขา(ข้อมูลวงเล็บ)");
});

test("mocked canonical detail maps N/Q/R without fallback or real provider request", async () => {
  const raw = { pno: "PNO-OWNER", next_store_name: "09 NE2_HUB-ขอนแก่น",
    dst_hub_name: "27 KKC_BHUB-ขอนแก่น",
    ticket_delivery_store_name: "(TH37011417)2SIL_BDC-ศิลา",
    LastAction: "DRIVER_SIGN", LastAction_name: "คนขับรถเช็คอินTBR",
    LastActionTime: "2026-10-03 20:58:02" };
  const locator = { hub: "NE1", proofId: "EXACT-TRIP", day: "2026-09-30",
    lineId: "LINE-1", storeId: "SOURCE", nextStoreId: "DROP-1", type: "total", page: 1, count: 1 };
  let mockedReads = 0;
  const page = await readSharedPnoPage({ ctx: { storage: { transaction: async () => { throw Error("test storage"); } } } },
    {}, locator, { readCredential: async () => ({}), fetchDetailPage: async () => {
      mockedReads++; return { sourceValid: true, total: 1, items: [raw] };
    } });
  assert.equal(mockedReads, 1);
  assert.equal(page.parcels[0].nextStoreName, raw.next_store_name);
  assert.equal(page.parcels[0].targetHub, raw.dst_hub_name);
  assert.equal(page.parcels[0].targetBranch, raw.ticket_delivery_store_name);
  assert.equal(page.parcels[0].lastActionCode, "DRIVER_SIGN");
  assert.equal(page.parcels[0].lastAction, "คนขับรถเช็คอินTBR");
});

test("4205 multi-drop card has two explicit controls; single segment stays direct", () => {
  const segments = [segment(1, 170, 70), segment(2, 4035, 100)];
  const row = { ...multi, id: "TRIP-CARD", expectedParcels: 4205,
    enteredParcels: 170, pendingParcels: 4035, pnoSegments: segments };
  assert.ok(exactPnoSegments(row));
  const context = vm.createContext({
    pnoOperationalInboundEligible: () => true,
    pnoOperationalRawSummary: (value) => ({ valid: true, expected: value.expectedParcels,
      entered: value.enteredParcels, pending: value.pendingParcels,
      percent: value.enteredParcels / value.expectedParcels * 100 }),
    pnoProgressClass: () => "progress", pnoDisplayPercent: () => "4.0%",
    pnoProgressStatus: () => "กำลังเข้า", esc: (value) => String(value),
    nf: new Intl.NumberFormat("en-US"),
  });
  vm.runInContext(["pnoV18ExactSegments", "pnoReadOnlyDetailEligibility",
    "pnoReadOnlyUnavailableMessage", "expectedParcelsBadge"].map(functionBlock).join("\n") +
    ";globalThis.badge=expectedParcelsBadge", context);
  const card = context.badge(row);
  assert.match(card, /4,205[\s\S]*170[\s\S]*4,035/);
  assert.match(card, /data-pno-mode="union">ดูพัสดุทั้งหมด/);
  assert.match(card, /data-pno-mode="choose">เลือกดูตามจุดส่ง/);
  assert.doesNotMatch(card, /data-pno-detail-card=/);
  const single = context.badge({ ...row, pnoSegmentCount: 1, pnoSegments: undefined,
    pnoSourceDay: "2026-09-30", pnoLineId: "LINE-1", pnoStoreId: "SOURCE", pnoNextStoreId: "DROP-1" });
  assert.match(single, /data-pno-detail-card="TRIP-CARD"/);
  assert.doesNotMatch(single, /ดูพัสดุทั้งหมด|เลือกดูตามจุดส่ง|ยอดรวมทั้งคัน/);
});

test("whole-truck click unions exact pages lazily and fails closed on partial source", async () => {
  const calls = [];
  const cache = new Map();
  const rows = (prefix, count) => Array.from({ length: count }, (_, i) => ({ pno: `${prefix}-${i}` }));
  const originals = [rows("A", 201), rows("B", 2)];
  let invalid = false;
  const context = vm.createContext({
    pnoV18State: { segmentSignature: JSON.stringify(multi.pnoSegments) },
    pnoV18LocatorKey: () => "TRIP|union",
    pnoV18ViewCache: cache,
    pnoV18CacheGet: (map, key) => map.get(key),
    pnoV18CacheSet: (map, key, value) => { map.set(key, value); return value; },
    pnoPendingPropagatePositive: () => {},
    browserPnoPage: async (row, type, page) => {
      calls.push([row.pnoLineId, row.pnoStoreId, row.pnoNextStoreId, type, page]);
      assert.ok(row.pnoLineId && row.pnoStoreId && row.pnoNextStoreId, "never use aggregate locator");
      const index = row.pnoLineId === "LINE-1" ? 0 : 1;
      const list = originals[index];
      return { sourceValid: true, sourceCountMismatch: false, page,
        total: invalid ? list.length + 1 : list.length,
        parcels: list.slice((page - 1) * 200, page * 200) };
    },
  });
  vm.runInContext(["pnoCountForType", "pnoV18ExactSegments", "pnoV18UnionPage"]
    .map(functionBlock).join("\n") + ";globalThis.union=pnoV18UnionPage", context);
  assert.equal(calls.length, 0, "rendering a chooser made no detail request");
  const first = await context.union(multi, "total", 1, false);
  assert.equal(first.total, 203);
  assert.equal(first.parcels.length, 200);
  assert.deepEqual(calls.map(([line, , , , page]) => [line, page]),
    [["LINE-1", 1], ["LINE-1", 2], ["LINE-2", 1]]);
  const next = await context.union(multi, "total", 2, false);
  assert.equal(next.parcels.length, 3);
  assert.equal(next.parcels[0].pnoSegmentIndex, 0);
  assert.equal(next.parcels[2].pnoSegmentIndex, 1);
  assert.equal(next.parcels[2].pnoSegmentLabel, "DROP 2");
  assert.equal(calls.length, 3, "second union page uses materialized exact result");
  invalid = true;
  await assert.rejects(context.union(multi, "total", 1, true), /ไม่ครบ/);
  assert.equal(cache.get("TRIP|union|union|total").total, 203,
    "failed refresh never replaces the prior complete view");
});

test("per-drop fetch uses only the selected exact segment and does not request siblings", async () => {
  const calls = [];
  const context = vm.createContext({
    pnoV18State: { sourceRow: multi, selection: 1, segmentSignature: JSON.stringify(multi.pnoSegments),
      proofId: "", day: "", force: false },
    pnoV18SourceRow: () => multi,
    pnoV18PageCacheKey: () => "selected|1", pnoV18CacheGet: () => null,
    pnoV18CacheSet: (_, __, value) => value, pnoV18ViewCache: new Map(),
    pnoPendingPropagatePositive: () => {},
    browserPnoPage: async (row, type, page) => {
      calls.push([row.pnoLineId, row.pnoNextStoreId, type, page]);
      return { parcels: [{ pno: "B-1" }], total: 2, page };
    },
  });
  vm.runInContext(["pnoV18ExactSegments", "pnoV18Fetch"].map(functionBlock).join("\n") +
    ";globalThis.fetchSelected=pnoV18Fetch", context);
  await context.fetchSelected("total", 1);
  assert.deepEqual(calls, [["LINE-2", "DROP-2", "total", 1]]);
});

test("action display uses source name, with source-grounded DRIVER_SIGN fallback only", () => {
  const context = vm.createContext({});
  vm.runInContext(`${functionBlock("pnoV18ParcelAction")};globalThis.action=pnoV18ParcelAction`, context);
  assert.equal(context.action({ lastAction: "คนขับรถเช็คอิน TBR", lastActionCode: "DRIVER_SIGN" }), "คนขับรถเช็คอิน TBR");
  assert.equal(context.action({ lastActionCode: "DRIVER_SIGN" }), "คนขับรถเช็คอิน TBR");
  assert.equal(context.action({ lastActionCode: "UNSUPPORTED" }), "การดำเนินการล่าสุดยังไม่พร้อม");
  assert.doesNotMatch(functionBlock("pnoV18ParcelAction"), /scanEvidence\.classification\s*=/);
});
