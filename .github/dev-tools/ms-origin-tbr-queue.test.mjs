import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { stageFrontend, stageWorker } from "./stage-dev-runtime.mjs";

const root = new URL("../../", import.meta.url);
const [frontend, worker] = await Promise.all([
  readFile(new URL("ms.js", root), "utf8").then(stageFrontend),
  readFile(new URL("worker/src/index.js", root), "utf8").then(stageWorker),
]);
const NOW = Date.parse("2026-09-28T12:00:00.000Z");
class Clock extends Date {
  constructor(value) { super(value === undefined ? NOW : value); }
  static now() { return NOW; }
}
const tbr = (hours = -1) => new Date(NOW + hours * 36e5).toISOString();
const parseDate = (value) => {
  if (!value) return null;
  const date = new Clock(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
function between(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `missing staged block ${start}`);
  return source.slice(a, b);
}
const context = {
  Date: Clock, Intl, nf: new Intl.NumberFormat("en-US"), parseDate,
  state: { cancelledRouteIds: new Set() },
};
vm.createContext(context);
vm.runInContext(
  between(frontend, "function routeState(row, now = new Date())", "function dropOperation(row)") +
    "\nglobalThis.queue=queueInfo;globalThis.route=routeState;globalThis.arrival=queueAdmissionArrival;",
  context,
);

const normalizeProofId = (value) => String(value || "").trim().toUpperCase().replace(/\s+/g, "");
const normalizeMsAttendance = (value) => String(value || "").trim();
const workerContext = {
  Date: Clock, Map, Set, Number, String,
  normalizeProofId, normalizeMsAttendance,
  date: (value) => parseDate(value)?.toISOString() || "",
  text: (value, limit) => String(value || "").slice(0, limit),
};
vm.createContext(workerContext);
vm.runInContext(
  between(worker, "function msTbrAttendanceFromMapKey", "async function preEntryCredentials") +
    "\nglobalThis.firstSource=msQueueFirstSourceRows;",
  workerContext,
);
const bus = (proofId, attendanceType = "ต้นทาง", time = tbr()) => new Map([
  [`P:${normalizeProofId(proofId)}|A:${attendanceType}`, {
    proofId, routeName: "LINE", scheduleTbrArrivalAt: time,
  }],
]);
const origin = (extras = {}) => ({
  id: "route-1", proofId: "ORIGIN001", attendanceType: "ต้นทาง",
  actualArrivalAt: "", actualDepartureAt: "", ...extras,
});

test("Origin TBR before KIT enters one active waiting row without fabricating Route times", () => {
  const rows = workerContext.firstSource([], bus("ORIGIN001"), "HUB", NOW);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].attendanceType, "ต้นทาง");
  assert.equal(rows[0].actualArrivalAt, "");
  assert.equal(rows[0].actualDepartureAt, "");
  assert.equal(rows[0].scheduleKitArrivalAt, "");
  assert.equal(context.queue(rows[0]).active, true);
  assert.equal(context.route(rows[0]).label, "เข้าคิวแล้วจาก TBR");
  assert.equal(context.arrival(rows[0]), null, "Origin TBR is not Route actual arrival");
});

test("TBR then KIT then Route replaces placeholder, preserving one route and raw source authority", () => {
  const first = workerContext.firstSource([], bus("ORIGIN001"), "HUB", NOW);
  assert.equal(first.length, 1);
  const laterKit = bus("ORIGIN001");
  laterKit.values().next().value.scheduleKitArrivalAt = tbr(1);
  const kitRows = workerContext.firstSource([], laterKit, "HUB", NOW);
  assert.equal(kitRows.length, 1);
  assert.equal(kitRows[0].scheduleKitArrivalAt, tbr(1));
  assert.equal(context.queue(kitRows[0]).active, true);
  const route = origin({ actualArrivalAt: tbr(2), estimatedDepartureAt: tbr(3) });
  const merged = workerContext.firstSource([route], laterKit, "HUB", NOW);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, route.id);
  assert.equal(merged[0].scheduleTbrArrivalAt, tbr());
  assert.equal(merged[0].actualArrivalAt, tbr(2));
  assert.equal(merged[0].actualDepartureAt, "");
  assert.equal(context.queue(merged[0]).active, true);
  assert.equal(context.route(merged[0]).key, "arrived");
});

test("no TBR does not synthesize, while an accepted Route arrival still admits Origin", () => {
  assert.equal(workerContext.firstSource([], new Map(), "HUB", NOW).length, 0);
  assert.equal(context.queue(origin()).active, false);
  assert.equal(context.queue(origin({ actualArrivalAt: tbr() })).active, true);
  assert.equal(context.queue(origin({ scheduleKitArrivalAt: tbr() })).active, false);
});

test("departed, cancelled, stale and future TBR do not enter Origin active queue", () => {
  const row = origin({ scheduleTbrArrivalAt: tbr() });
  assert.equal(context.queue({ ...row, actualDepartureAt: tbr(0) }).active, false);
  assert.equal(context.queue({ ...row, queueCancelledAt: tbr(0) }).active, false);
  assert.equal(context.queue({ ...row, scheduleTbrArrivalAt: tbr(-12) }).active, false);
  assert.equal(context.queue({ ...row, scheduleTbrArrivalAt: tbr(6 / 60) }).active, false);
  assert.equal(context.queue({ ...row, scheduleTbrArrivalAt: tbr(4 / 60) }).active, true);
  assert.equal(context.queue({ ...row, scheduleTbrArrivalAt: tbr(-13), actualArrivalAt: tbr() }).active, true);
  assert.equal(workerContext.firstSource([], bus("ORIGIN001", "ต้นทาง", tbr(-12.01)), "HUB", NOW).length, 0);
  assert.equal(workerContext.firstSource([], bus("ORIGIN001", "ต้นทาง", tbr(6 / 60)), "HUB", NOW).length, 0);
});

test("proof and attendance identity prevent guesses and duplicate rows", async () => {
  assert.equal(workerContext.firstSource([], bus("  "), "HUB", NOW).length, 0);
  const two = new Map([...bus("A"), ...bus("B")]);
  assert.equal(workerContext.firstSource([], two, "HUB", NOW).length, 2);
  assert.equal(workerContext.firstSource([origin({ proofId: "A" })], two, "HUB", NOW).length, 2);
  assert.equal(workerContext.firstSource([origin({ proofId: "A", attendanceType: "ปลายทาง" })], bus("A"), "HUB", NOW).length, 1);
  assert.equal(workerContext.firstSource([origin({ proofId: "A" })], bus("A", "ปลายทาง"), "HUB", NOW).length, 1);
  // The later DEV auxiliary-evidence stage applies its ambiguity guard to
  // this same first-source loop before deployment.
  const auxiliary = await readFile(new URL(".github/dev-tools/patch-dev-auxiliary-evidence-completeness.mjs", root), "utf8");
  assert.match(auxiliary, /busData\.ambiguousKeys\?\.has\(mapKey\)/);
});

test("Origin queue summary and filtered rows use the same active predicate", () => {
  const row = origin({ scheduleTbrArrivalAt: tbr() });
  Object.assign(context.state, {
    currentRows: [row], archiveRows: [], queue: "queue", summary: "origin", status: "all",
    archiveView: false, query: "", dateFrom: "2026-09-28", dateTo: "2026-09-28", attendance: "all",
    attribute: "all", region: "all", route: "all", cancelledToday: 0,
  });
  Object.assign(context, {
    trustedLowerCompletionAt: () => null, rowBusinessDay: () => "",
    completedTodayDatasetRows: () => [], completedTodayWithExpired12hRows: () => [],
    matchesCompletedContext: () => true,
    matchesLowerCardContext: (_row, day) => day === "2026-09-28",
    bangkokDateValue: (value) => parseDate(value)?.toISOString().slice(0, 10) || "",
    expired12hCurrentRows: () => [], completedTodayOvertimeRows: () => [],
    isCancelledToday: () => false,
    isOperationalOvertime: () => false,
    inboundOperationalStage: () => "none",
  });
  vm.runInContext(between(frontend, "function filteredRows(ignoreSummary", "async function loadRange") +
    "\nglobalThis.filtered=filteredRows;", context);
  vm.runInContext(between(frontend, "function matchesOvertimeContext(row)", "function classicOperationRow"), context);
  assert.equal(context.filtered().length, 1);
  const summaryEl = {
    classList: { remove() {} }, innerHTML: "", querySelectorAll: () => [],
  };
  context.el = () => summaryEl;
  vm.runInContext(between(frontend, "function renderFilterSummary(rows)", "async function applyMetricFilter") +
    "\nglobalThis.summary=renderFilterSummary;", context);
  context.summary(context.filtered());
  assert.match(summaryEl.innerHTML, /data-summary-status="origin"[^>]*><span>รอปล่อยรถ<\/span><strong>1<\/strong>/);
  context.state.currentRows = [origin()];
  assert.equal(context.filtered().length, 0);
  context.summary(context.filtered());
  assert.match(summaryEl.innerHTML, /data-summary-status="origin"[^>]*><span>รอปล่อยรถ<\/span><strong>0<\/strong>/);
});

test("Origin, Destination and Drop render local proof barcode on desktop and mobile", () => {
  const code = between(frontend, "// LOCAL_ROUTE_BARCODE_V1", "// Barcode presentation");
  const barcodeContext = {
    Set, JSON, encodeURIComponent, decodeURIComponent,
    isOrigin: (row) => row.attendanceType === "ต้นทาง",
    isDestination: (row) => row.attendanceType === "ปลายทาง",
    isDrop: (row) => row.attendanceType === "จุดดรอป",
    esc: (value) => String(value),
    sessionStorage: { getItem: () => null, setItem() {} },
    fetch: () => { throw new Error("unexpected network request"); },
  };
  vm.createContext(barcodeContext);
  vm.runInContext(code +
    "\nglobalThis.eligible=localBarcodeEligible;globalThis.button=localBarcodeButton;globalThis.svg=code128Svg;", barcodeContext);
  for (const attendanceType of ["ต้นทาง", "ปลายทาง", "จุดดรอป"]) {
    const row = { attendanceType, proofId: "PROOF001" };
    assert.equal(barcodeContext.eligible(row), true);
    assert.match(barcodeContext.button(row), /▥ ดูบาร์โค้ด/);
    assert.match(barcodeContext.button(row), /data-barcode-value="PROOF001"/);
    assert.match(barcodeContext.svg(row.proofId), /<text[^>]*>PROOF001<\/text>/);
  }
  assert.equal(barcodeContext.eligible({ attendanceType: "ต้นทาง", proofId: " " }), false);
  assert.equal(barcodeContext.button({ attendanceType: "ต้นทาง", proofId: " " }), "");
  assert.match(barcodeContext.svg("\u0001"), /สร้างบาร์โค้ดไม่ได้/);
  assert.match(between(frontend, "function tableRow(row)", "function card(row)"), /localBarcodeButton\(row\)/);
  assert.match(between(frontend, "function card(row)", "let cancelRouteTarget"), /localBarcodeButton\(row\)/);
  assert.doesNotMatch(code, /\b(fetch|apiGet|apiPost)\s*\(|env\.DB|\.prepare\s*\(/);
});

test("staging preserves inbound queue, Origin Route day authority and zero new acquisition", () => {
  assert.match(frontend, /if \(isOrigin\(row\)\) \{\s*const actualDeparture = parseDate\(row\?\.actualDepartureAt\)/);
  assert.match(frontend, /q\.active && isOrigin\(row\) && !String\(row\.id \|\| ""\)\.startsWith\("TBR:"\)/);
  assert.match(frontend, /if \(!row \|\| !queueInfo\(row\)\.active \|\| String\(row\.id \|\| ""\)\.startsWith\("TBR:"\)\)/);
  assert.equal((frontend.match(/q\.active && isOrigin\(row\) && !String\(row\.id \|\| ""\)\.startsWith\("TBR:"\)/g) || []).length, 2);
  assert.doesNotMatch(frontend, /CONFIRMED_MISSED_SCAN/);
  const patch = between(worker, `// MS_QUEUE_FIRST_SOURCE_V1 / MS_ORIGIN_TBR_QUEUE_V1`, "async function preEntryCredentials");
  assert.doesNotMatch(patch, /\b(fetch|setInterval|setTimeout|WebSocket|EventSource)\s*\(|env\.DB|\.prepare\s*\(/);
  assert.match(frontend, /function localBarcodeEligible\(row\)/);
});
