import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import {
  detailEligibilityFixtureV30,
  patchPnoDetailAffordanceFrontendV30,
  patchPnoDetailAffordanceWorkerV30,
} from "./patch-pno-detail-affordance-recovery.mjs";
import { stageFrontend } from "./stage-dev-runtime.mjs";

const root = new URL("../../", import.meta.url);
const frontendSource = await readFile(new URL("ms.js", root), "utf8");
const stagedFrontend = stageFrontend(frontendSource);
const stagedWorker = await readFile(new URL("worker/.dev-runtime/src/index.js", root), "utf8");

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing staged block ${start}`);
  return source.slice(from, to);
}

function renderContext() {
  const rawSummary = (row) => {
    const expected = Number(row?.expectedParcels);
    const entered = Number(row?.enteredParcels);
    const pending = Number(row?.pendingParcels);
    return {
      expected,
      entered,
      pending,
      percent: expected > 0 ? entered / expected * 100 : 0,
      valid: [expected, entered, pending].every(Number.isFinite) &&
        expected >= 0 && entered >= 0 && pending >= 0 && entered + pending === expected,
    };
  };
  const context = {
    pnoOperationalInboundEligible: (row) => row?.attendanceType === "ปลายทาง" || row?.attendanceType === "จุดดรอป",
    pnoOperationalRawSummary: rawSummary,
    pnoOperationalSummaryForRow: rawSummary,
    nf: new Intl.NumberFormat("en-US"),
    pnoProgressClass: () => "is-live",
    pnoDisplayPercent: (value) => `${Number(value).toFixed(1)}%`,
    pnoProgressStatus: () => "กำลังเข้า",
    esc: (value) => String(value ?? "").replaceAll('"', "&quot;"),
  };
  vm.createContext(context);
  vm.runInContext(
    `${between(stagedFrontend, "function pnoReadOnlyDetailEligibility", "function findPnoRowById")};globalThis.renderBadge=expectedParcelsBadge`,
    context,
  );
  return context;
}

function completedDestination(overrides = {}) {
  return {
    id: "route-AYU1TV6J27",
    proofId: "AYU1TV6J27",
    attendanceType: "ปลายทาง",
    unloadingState: 2,
    expectedParcels: 4415,
    enteredParcels: 2910,
    pendingParcels: 1505,
    pnoState: "OK",
    pnoEnabled: false,
    pnoDetailAvailable: true,
    pnoSegmentCount: 1,
    pnoSourceDay: "2026-09-22",
    pnoLineId: "line-ayu",
    pnoVanLineId: "",
    pnoStoreId: "store-origin",
    pnoNextStoreId: "store-ne1",
    pnoCanReport: false,
    ...overrides,
  };
}

test("state-2 Destination renders pending detail from exact locator even when reporting is disabled", () => {
  const context = renderContext();
  const row = completedDestination();
  assert.deepEqual(detailEligibilityFixtureV30(row), { available: true, reason: "OK" });
  const html = context.renderBadge(row);
  assert.match(html, /data-pno-detail-card="route-AYU1TV6J27"/);
  assert.match(html, /data-pno-row="route-AYU1TV6J27" data-pno-type="no_entry"/);
  assert.match(html, />1,505</);
  assert.doesNotMatch(html, /data-pno-operational-row/);
});

test("lifecycle completion and can_report=false do not suppress read-only detail", () => {
  const context = renderContext();
  for (const unloadingState of [0, 1, 2]) {
    const html = context.renderBadge(completedDestination({ unloadingState, pnoCanReport: false }));
    assert.match(html, /data-pno-type="no_entry"/);
  }
});

test("missing locator and ambiguous multi-stop fail closed with clear state", () => {
  const context = renderContext();
  const missing = completedDestination({ pnoSourceDay: "", pnoDetailAvailable: false });
  const missingHtml = context.renderBadge(missing);
  assert.doesNotMatch(missingHtml, /data-pno-row=|data-pno-detail-card=/);
  assert.match(missingHtml, /ข้อมูลอ้างอิงเที่ยวไม่ครบ/);
  assert.deepEqual(detailEligibilityFixtureV30(missing), { available: false, reason: "LOCATOR_INCOMPLETE" });

  const ambiguous = completedDestination({ pnoSegmentCount: 2, pnoDetailAvailable: false, pnoState: "AMBIGUOUS" });
  const ambiguousHtml = context.renderBadge(ambiguous);
  assert.doesNotMatch(ambiguousHtml, /data-pno-row=|data-pno-detail-card=/);
  assert.match(ambiguousHtml, /หลายจุดส่ง/);
  assert.deepEqual(detailEligibilityFixtureV30(ambiguous), { available: false, reason: "AMBIGUOUS_OCCURRENCE" });
});

test("Origin has no affordance and zero pending has no pending-detail control", () => {
  const context = renderContext();
  assert.equal(context.renderBadge(completedDestination({ attendanceType: "ต้นทาง" })), "");
  const zeroPending = context.renderBadge(completedDestination({ enteredParcels: 4415, pendingParcels: 0 }));
  assert.doesNotMatch(zeroPending, /data-pno-type="no_entry"/);
  assert.match(zeroPending, /data-pno-type="already"/);
});

test("rendering 100 eligible viewers makes zero detail requests", () => {
  const context = renderContext();
  let requests = 0;
  context.browserPnoPage = async () => { requests += 1; return {}; };
  for (let index = 0; index < 100; index += 1)
    context.renderBadge(completedDestination({ id: `route-${index}` }));
  assert.equal(requests, 0);
});

test("one click begins exactly one open action and Enter/Space are supported", async () => {
  const row = completedDestination();
  let opens = 0;
  const context = {
    findPnoRowById: () => row,
    pnoOperationalInboundEligible: () => true,
    openPendingParcels: async () => { opens += 1; },
    toast: () => {},
    Promise,
  };
  vm.createContext(context);
  vm.runInContext(
    `${between(stagedFrontend, "function pnoV29DetailTarget", "function pnoV29EnsureAuditStyle")};globalThis.openClick=pnoV29OpenDetail;globalThis.openKey=pnoV29OpenDetailByKeyboard`,
    context,
  );
  const direct = { dataset: { pnoRow: row.id, pnoType: "no_entry" } };
  const card = { dataset: { pnoDetailCard: row.id } };
  const eventFor = (node, key = "") => ({
    key,
    target: { closest: (selector) => selector === "[data-pno-row]" ? (node === direct ? direct : null) : selector === "[data-pno-detail-card]" ? node : null },
    preventDefault() {},
    stopImmediatePropagation() {},
  });
  context.openClick(eventFor(direct));
  await Promise.resolve();
  assert.equal(opens, 1);
  await Promise.resolve();
  assert.equal(opens, 1, "render/event settling must not begin a second action");
  context.openKey(eventFor(card, "Enter"));
  context.openKey(eventFor(card, " "));
  await Promise.resolve();
  assert.equal(opens, 3);
});

test("one explicit load issues one bounded detail request", async () => {
  let requests = 0;
  const context = {
    pnoV18SourceRow: () => completedDestination(),
    pnoV18State: { proofId: "", day: "", force: false },
    pnoV18PageCacheKey: () => "key",
    pnoV18CacheGet: () => null,
    pnoV18CacheSet: (_map, _key, result) => result,
    pnoV18ViewCache: new Map(),
    browserPnoPage: async (_row, type, page) => { requests += 1; return { type, page }; },
  };
  vm.createContext(context);
  vm.runInContext(
    `${between(stagedFrontend, "async function pnoV18Fetch", "function pnoV18ActionClass")};globalThis.fetchOne=pnoV18Fetch`,
    context,
  );
  const result = await context.fetchOne("no_entry", 1);
  assert.deepEqual({ ...result }, { type: "no_entry", page: 1 });
  assert.equal(requests, 1);
});

test("staged worker restores exact single-segment locator without coupling can_report", () => {
  assert.match(stagedWorker, /PNO_DETAIL_LOCATOR_RECOVERY_V30/);
  assert.match(stagedWorker, /value\.pnoDetailAvailable = completeCounts && locatorComplete && value\.pnoSegmentCount === 1/);
  assert.match(stagedWorker, /if \(exact\) Object\.assign\(value, exact\)/);
  assert.match(stagedWorker, /pnoCanReport: row\?\.__pnoCanReport === true \|\| Number\(row\?\.can_report\) === 1/);
  const eligibility = between(stagedFrontend, "function pnoReadOnlyDetailEligibility", "function pnoReadOnlyUnavailableMessage");
  assert.doesNotMatch(eligibility, /pnoCanReport|can_report/);
});

test("V30 staging is idempotent and introduces no polling or provider calls", () => {
  assert.equal(patchPnoDetailAffordanceFrontendV30(stagedFrontend), stagedFrontend);
  assert.equal(patchPnoDetailAffordanceWorkerV30(stagedWorker), stagedWorker);
  const front = between(stagedFrontend, "// PNO_READONLY_DETAIL_ELIGIBILITY_V30", "function findPnoRowById");
  assert.doesNotMatch(front, /setInterval|setTimeout|IntersectionObserver|apiGet|apiPost|browserPnoPage/);
});
