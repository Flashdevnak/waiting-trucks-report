import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";

import {
  MS_DATA_COMPLETENESS,
  MS_FIELD_EVIDENCE,
  createBusTimeHotLane,
  deriveMsTbrProjection,
  isMsBusEvidenceComplete,
  planMsTbrEnrichment,
} from "./bus-time-hot-lane-v14-runtime.mjs";
import { stageFrontend } from "./stage-dev-runtime.mjs";
import { queryMsDailyArchivePointer } from "../../worker/src/ms-history-pointer-v1.js";

const root = new URL("../../", import.meta.url);
const stagedWorkerUrl = new URL("worker/.dev-runtime/src/index.js", root);
const stagedWorker = await readFile(stagedWorkerUrl, "utf8");
const stagedBusRuntime = await readFile(
  new URL("worker/.dev-runtime/src/bus-time-hot-lane-v14.js", root),
  "utf8",
);
const stagedFrontend = stageFrontend(await readFile(new URL("ms.js", root), "utf8"));
const { enrichMsRow } = await import(`${stagedWorkerUrl.href}?aux=${Date.now()}`);
const NOW = Date.parse("2026-09-22T15:00:00.000Z");

function completed(overrides = {}) {
  return {
    id: "route-hdy",
    hub: "NE1",
    proofId: "HDY1TUFJ72",
    routeName: "DD1-6W5.5-SO2-NE1-20260922 120",
    attendanceType: "ปลายทาง",
    unloadingState: 2,
    actualArrivalAt: "2026-09-22T13:12:19.000Z",
    scheduleTbrArrivalAt: "2026-09-22T13:06:04.000Z",
    scheduleUnloadingStartedAt: "",
    scheduleUnloadingCompletedAt: "",
    ...overrides,
  };
}

function between(source, startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  assert.ok(start >= 0 && end > start, `missing section ${startText}`);
  return source.slice(start, end);
}

function providerItem(proofId, { start = "", end = "", tbr = "2026-09-22 20:06:04" } = {}) {
  const unloading = [];
  if (start) unloading.push({ value: `S: ${start}` });
  if (end) unloading.push({ value: `E: ${end}` });
  return {
    proof_id: [{ value: proofId }],
    next_store_info: [{ value: "NE1" }, { value: "ปลายทาง" }],
    line_info: [{ value: "DD1-6W5.5-SO2-NE1-20260922 120" }],
    kit_arrive_time: [],
    fleet_sign_info: [{ value: tbr }],
    parcel_count: [],
    pack_count: [],
    fleet_unloading_time: unloading,
  };
}

function lane(items) {
  let calls = 0;
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind() {
            return {
              async first() {
                if (String(sql).includes("ms_bus_connections"))
                  return { credentials_cipher: "cipher", last_error: "" };
                return null;
              },
              async run() { return { meta: { changes: 1 } }; },
            };
          },
        };
      },
    },
  };
  const instance = createBusTimeHotLane({
    liveSourceDays: () => ["2026-09-22"],
    thaiDayOffset: () => "2026-09-22",
    normalizeProofId: (value) => String(value || "").trim().toUpperCase(),
    normalizeAttendance: (value) => String(value || "").trim(),
    matchHub: (store, hub) => String(store).includes(String(hub)),
    msDate: (value) => {
      const raw = String(value || "").trim();
      if (!raw) return "";
      const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
        ? raw.replace(" ", "T") + "+07:00"
        : raw;
      const at = Date.parse(normalized);
      return Number.isFinite(at) ? new Date(at).toISOString() : "";
    },
    parseUnloadingStart: (field) => {
      const value = field?.find((item) => String(item?.value || "").startsWith("S:"))?.value?.slice(2).trim();
      return value ? new Date(value.replace(" ", "T") + "+07:00").toISOString() : "";
    },
    parseUnloadingEnd: (field) => {
      const value = field?.find((item) => String(item?.value || "").startsWith("E:"))?.value?.slice(2).trim();
      return value ? new Date(value.replace(" ", "T") + "+07:00").toISOString() : "";
    },
    decryptMs: async () => JSON.stringify({ auth: "fixture" }),
    safeStatusWrite: async (value) => value,
    markSuccess: async () => ({ meta: { changes: 1 } }),
    markError: async () => ({ meta: { changes: 1 } }),
    classifyFailure: () => ({ code: "BUS_TIME_SOURCE_ERROR", status: 502 }),
    fetchFn: async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        async json() { return { code: 1, data: { dataList: items, total: items.length } }; },
      };
    },
    now: () => NOW,
    random: () => 0,
    logger: { warn() {}, error() {}, log() {} },
  });
  return { env, instance, calls: () => calls };
}

test("HDY completed row with TBR but missing Schedule S/E remains P2 unresolved", () => {
  const row = completed();
  assert.equal(isMsBusEvidenceComplete(row), false);
  const plan = planMsTbrEnrichment([row], { nowMs: NOW, p2Limit: 25 });
  assert.equal(plan.p1.length, 0);
  assert.deepEqual(plan.p2.map((item) => item.row.proofId), ["HDY1TUFJ72"]);
  assert.equal(plan.p2Unresolved, 1);
});

test("completed BusTime completeness vector requires TBR, Schedule S, and Schedule E", () => {
  const missing = deriveMsTbrProjection(completed(), { sourceEvaluated: true, nowMs: NOW });
  assert.equal(missing.dataCompleteness, MS_DATA_COMPLETENESS.INCOMPLETE);
  assert.equal(missing.fieldEvidence.scheduleTbrArrivalAt.state, MS_FIELD_EVIDENCE.OBSERVED);
  assert.equal(missing.fieldEvidence.scheduleUnloadingStartedAt.state, MS_FIELD_EVIDENCE.MISSING_UNCONFIRMED);
  assert.equal(missing.fieldEvidence.scheduleUnloadingCompletedAt.state, MS_FIELD_EVIDENCE.MISSING_UNCONFIRMED);

  const complete = completed({
    scheduleUnloadingStartedAt: "2026-09-22T13:39:07.000Z",
    scheduleUnloadingCompletedAt: "2026-09-22T14:15:21.000Z",
  });
  assert.equal(isMsBusEvidenceComplete(complete), true);
  assert.equal(planMsTbrEnrichment([complete], { nowMs: NOW }).selected.length, 0);

  const active = deriveMsTbrProjection(completed({
    unloadingState: 1,
    scheduleUnloadingCompletedAt: "2026-09-22T14:15:21.000Z",
  }), { sourceEvaluated: true, nowMs: NOW });
  assert.equal(active.dataCompleteness, MS_DATA_COMPLETENESS.INCOMPLETE);
  assert.equal(active.fieldEvidence.scheduleUnloadingStartedAt.state, MS_FIELD_EVIDENCE.MISSING_UNCONFIRMED);
  assert.equal(active.fieldEvidence.scheduleUnloadingCompletedAt.state, MS_FIELD_EVIDENCE.NOT_APPLICABLE);
});

test("matching BusTime response fills Schedule S/E without replacing existing TBR", async () => {
  const h = lane([providerItem("HDY1TUFJ72", {
    tbr: "2026-09-22 20:07:00",
    start: "2026-09-22 20:39:07",
    end: "2026-09-22 21:15:21",
  })]);
  const originalTbr = "2026-09-22T13:06:04.000Z";
  const data = await h.instance.readBusTimeData(h.env, "NE1", ["2026-09-22"], [
    completed({ scheduleTbrArrivalAt: originalTbr }),
  ]);
  const value = data.get("P:HDY1TUFJ72|A:ปลายทาง");
  assert.equal(h.calls(), 1);
  assert.equal(value.scheduleTbrArrivalAt, originalTbr);
  assert.equal(value.scheduleUnloadingStartedAt, "2026-09-22T13:39:07.000Z");
  assert.equal(value.scheduleUnloadingCompletedAt, "2026-09-22T14:15:21.000Z");
  assert.equal(value.dataCompleteness, MS_DATA_COMPLETENESS.COMPLETE);
});

test("successful partial BusTime page preserves known evidence and keeps the missing vector unresolved", async () => {
  const h = lane([]);
  const knownStart = "2026-09-22T13:39:07.000Z";
  const data = await h.instance.readBusTimeData(h.env, "NE1", ["2026-09-22"], [
    completed({ scheduleUnloadingStartedAt: knownStart }),
  ]);
  const value = data.get("P:HDY1TUFJ72|A:ปลายทาง");
  assert.equal(value.scheduleTbrArrivalAt, "2026-09-22T13:06:04.000Z");
  assert.equal(value.scheduleUnloadingStartedAt, knownStart);
  assert.equal(value.scheduleUnloadingCompletedAt, "");
  assert.equal(value.dataCompleteness, MS_DATA_COMPLETENESS.INCOMPLETE);
});

test("duplicate Route occurrences are not cross-enriched by proof plus attendance", () => {
  const rows = [
    completed({ id: "sam-stop-1", proofId: "SAM1TUN709", routeName: "SAM STOP 1" }),
    completed({ id: "sam-stop-2", proofId: "SAM1TUN709", routeName: "SAM STOP 2", actualArrivalAt: "2026-09-22T14:00:00Z" }),
  ];
  const plan = planMsTbrEnrichment(rows, { nowMs: NOW });
  assert.equal(plan.selected.length, 0);
  assert.equal(plan.ambiguousKeys.has("P:SAM1TUN709|A:ปลายทาง"), true);

  const bus = new Map([["P:SAM1TUN709|A:ปลายทาง", {
    scheduleTbrArrivalAt: "2026-09-22T10:00:00Z",
    scheduleUnloadingStartedAt: "2026-09-22T10:10:00Z",
    scheduleUnloadingCompletedAt: "2026-09-22T10:40:00Z",
  }]]);
  bus.ambiguousKeys = plan.ambiguousKeys;
  const untouched = enrichMsRow({ ...rows[0] }, new Map(), bus);
  assert.equal(untouched.scheduleUnloadingStartedAt, "");
  assert.equal(untouched.scheduleUnloadingCompletedAt, "");
});

test("PreEntry remains shared and updates parcel truth across state-2 cycles", () => {
  const row = completed({ expectedParcels: 1000, enteredParcels: 900, pendingParcels: 100 });
  const counts = (entered, pending) => new Map([["P:HDY1TUFJ72", {
    expectedParcels: 1000,
    enteredParcels: entered,
    pendingParcels: pending,
    pnoState: "OK",
    pnoEnabled: true,
  }]]);
  const t1 = enrichMsRow({ ...row }, counts(940, 60), new Map());
  const t2 = enrichMsRow({ ...t1 }, counts(980, 20), new Map());
  const t3 = enrichMsRow({ ...t2 }, counts(1000, 0), new Map());
  assert.deepEqual(
    [t1, t2, t3].map((item) => [item.unloadingState, item.enteredParcels, item.pendingParcels]),
    [[2, 940, 60], [2, 980, 20], [2, 1000, 0]],
  );
  assert.equal(t3.expectedParcels, t3.enteredParcels + t3.pendingParcels);
});

test("partial PreEntry success does not reinterpret a missing proof as authoritative absence", () => {
  const partial = new Map();
  partial.sourcePartial = true;
  partial.partialProofs = new Set(["HDY1TUFJ72"]);
  const prior = completed({
    expectedParcels: 1000,
    enteredParcels: 940,
    pendingParcels: 60,
    pnoState: "OK",
    pnoEnabled: true,
  });
  const mapped = enrichMsRow({ ...prior }, partial, new Map());
  assert.equal(mapped.expectedParcels, 1000);
  assert.equal(mapped.enteredParcels, 940);
  assert.equal(mapped.pendingParcels, 60);
  assert.equal(mapped.pnoState, "OK");
});

test("complete authoritative PreEntry success may replace values with zero", () => {
  const complete = new Map([["P:HDY1TUFJ72", {
    expectedParcels: 0,
    enteredParcels: 0,
    pendingParcels: 0,
    pnoState: "OK",
    pnoEnabled: true,
  }]]);
  const mapped = enrichMsRow(completed({ expectedParcels: 10, enteredParcels: 8, pendingParcels: 2 }), complete, new Map());
  assert.equal(mapped.expectedParcels, 0);
  assert.equal(mapped.enteredParcels, 0);
  assert.equal(mapped.pendingParcels, 0);
});

test("staged worker classifies invalid PreEntry math as partial and preserves failures", () => {
  assert.match(stagedWorker, /value\.enteredParcels \+ value\.pendingParcels !== value\.expectedParcels/);
  assert.match(stagedWorker, /counts\.sourcePartial = partialProofs\.size > 0/);
  assert.match(stagedWorker, /parcelCounts\.sourceFailed \|\| parcelCounts\.sourcePartial/);
  assert.match(stagedWorker, /"scheduleUnloadingStartedAt", "scheduleUnloadingCompletedAt"/);
  const refresh = between(stagedWorker, "async function runMsRefresh", "async function readMsLiveCache");
  assert.equal((refresh.match(/startMsOptionalRefresh\(optionalEnv, branch, routeHintRows\)/g) || []).length, 1);
  assert.equal((stagedWorker.match(/\["preEntry", \(\) => readPreEntryCounts\(env, branch\)\]/g) || []).length, 1);
  assert.doesNotMatch(refresh, /await Promise\.all/);
  assert.doesNotMatch(refresh, /for[\s\S]{0,120}readPreEntryCounts/);
});

test("KIT/TBR UI keeps both raw evidence values and full-precision winner semantics", () => {
  const arrival = between(stagedFrontend, "function confirmedEffectiveArrival", "function attendanceLabel");
  const sources = between(stagedFrontend, "function arrivalSources", "function arrivalSourceDateTime");
  assert.match(sources, /row\.actualArrivalAt/);
  assert.match(sources, /row\.scheduleTbrArrivalAt/);
  assert.doesNotMatch(sources, /scheduleKitArrivalAt/);
  assert.match(arrival, /sort\(\(a, b\) => a - b\)/);
  assert.match(arrival, /return routeKitArrival;/);

  const context = {
    parseDate(value) {
      const at = Date.parse(String(value || ""));
      return Number.isFinite(at) ? new Date(at) : null;
    },
    isDestination: () => true,
    isDrop: () => false,
  };
  vm.createContext(context);
  vm.runInContext(`${arrival};globalThis.pick=queueAdmissionArrival;globalThis.source=queueAdmissionSource`, context);
  const base = { attendanceType: "ปลายทาง" };
  assert.equal(context.source({ ...base, actualArrivalAt: "2026-09-22T13:00:00.000Z", scheduleTbrArrivalAt: "2026-09-22T13:00:00.000Z" }), "KIT");
  assert.equal(context.pick({ ...base, actualArrivalAt: "2026-09-22T13:00:01.001Z", scheduleTbrArrivalAt: "2026-09-22T13:00:00.001Z" }).toISOString(), "2026-09-22T13:00:00.001Z");
  assert.equal(context.pick({ ...base, actualArrivalAt: "2026-09-22T12:59:59.999Z", scheduleTbrArrivalAt: "2026-09-22T13:00:00.999Z" }).toISOString(), "2026-09-22T12:59:59.999Z");
});

test("visible completion label uses trusted Schedule E only after Route state 2", () => {
  const operation = between(stagedFrontend, "function renderOperation(row)", "// LOCAL_ROUTE_BARCODE_V1");
  assert.match(operation, /ลงเสร็จจริง", shortDateTime\(timing\.finish\)/);
  assert.match(operation, /ลงของเสร็จจริง", shortDateTime\(timing\.finish\)/);
  assert.doesNotMatch(operation, /ลง(?:ของ)?เสร็จจริง", shortDateTime\(row\.unloadingCompletedAt\)/);
  const timing = between(stagedFrontend, "function trustedLowerCompletionAt", "function isCompletedUnloadOverStandard");
  assert.match(timing, /Number\(row\.unloadingState\) !== 2/);
  assert.match(timing, /scheduleUnloadingCompletedAt/);
  assert.match(timing, /unloadingCompletedAt/);
});

// REV95_DETAIL_TRIGGER_CONTRACT: execute the actual composed handler/opener,
// locator guards, page cache and union reader. DOM/API are synthetic boundaries.
const rev95DetailFrontend = await readFile(
  process.env.REV95_DETAIL_SOURCE_FILE || new URL("worker/.dev-assets/ms.js", root), "utf8",
);
function rev95Function(source, name) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf("\n}\n", start) + 2;
  assert.ok(start >= 0 && end > start, `actual composed ${name} exists`);
  return source.slice(source.slice(start - 6, start) === "async " ? start - 6 : start, end);
}
function rev95Row(overrides = {}) {
  return { id: "SYNTH-REV95-ROUTE", hub: "NE11", proofId: "SYNTH-REV95-PROOF",
    attendanceType: "ปลายทาง", routeName: "SYNTH-LINE", pnoState: "OK", pnoEnabled: true,
    expectedParcels: 2, enteredParcels: 1, pendingParcels: 1,
    pnoSegmentCount: 1, pnoDetailAvailable: true, pnoSourceDay: "2026-10-14",
    pnoLineId: "SYNTH-LINE-ID", pnoStoreId: "SYNTH-CURRENT", pnoNextStoreId: "SYNTH-NEXT",
    ...overrides };
}
function rev95Multi(overrides = {}) {
  const segment = (n) => ({ proofId: "SYNTH-REV95-PROOF", pnoSourceDay: "2026-10-14",
    pnoLineId: `SYNTH-LINE-${n}`, pnoStoreId: "SYNTH-CURRENT",
    pnoNextStoreId: `SYNTH-NEXT-${n}`, pnoNextStoreName: `จุดส่ง ${n}`,
    expectedParcels: 2, enteredParcels: 1, pendingParcels: 1 });
  return rev95Row({ pnoSegmentCount: 2, expectedParcels: 4, enteredParcels: 2,
    pendingParcels: 2, pnoSegments: [segment(1), segment(2)], ...overrides });
}
function rev95DetailHarness(row = rev95Row(), { response, source = rev95DetailFrontend } = {}) {
  const observed = { opens: [], api: [], toast: [], modal: 0, history: 0, timers: 0 };
  const nodes = new Map(), listeners = [], pending = [];
  const node = (id) => {
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, { innerHTML: "", textContent: "", open: false, dataset: {},
        classList: { add: (...v) => v.forEach(x => classes.add(x)), remove: (...v) => v.forEach(x => classes.delete(x)) },
        querySelector: () => node(id + "-toolbar"),
        querySelectorAll(selector) {
          if (selector !== "[data-pno-union],[data-pno-segment]") return [];
          this.buttons = [...this.innerHTML.matchAll(/data-pno-(union|segment)="([^"]+)"/g)]
            .map(m => ({ dataset: { [m[1] === "union" ? "pnoUnion" : "pnoSegment"]: m[2] } }));
          return this.buttons;
        },
        showModal() { this.open = true; observed.modal++; },
      });
    }
    return nodes.get(id);
  };
  const modal = { sourceRow: null, proofId: "", filters: { status: "", action: "", hub: "", branch: "" },
    type: "total", page: 1, rows: [], busy: false, total: 0, selection: null,
    filterPromise: null, filterForce: false, filterAt: 0, filterKey: "", filterRows: null };
  const context = vm.createContext({
    state: { branch: "NE11", currentRows: [row], rows: [], archiveRows: [] },
    pnoV18State: modal, pnoV18ViewCache: new Map(), pnoBrowserCache: new Map(),
    pnoOperationalTruthCache: new Map(), PNO_V18_VIEW_CACHE_MS: 60000, PNO_BROWSER_CACHE_MS: 60000,
    Date, console, nf: new Intl.NumberFormat("en-US"), esc: v => String(v ?? ""), el: node,
    pnoReadOnlyExplicitNoPrefetch: false,
    document: { addEventListener(type, fn, capture = false) { listeners.push({ type, fn, capture }); } },
    isDestination: r => r?.attendanceType === "ปลายทาง", isDrop: r => r?.attendanceType === "จุดดรอป",
    pnoV18EnsureUi() {}, pnoInboundToggleActions() {}, pnoV18SetActive() {},
    pnoV18RenderSummary() {}, pnoV18RenderFilters() {}, pnoV18RenderCurrentFilteredView() {},
    pnoV18RenderUnionDiagnostic(error) { observed.unionError = error.pnoUnionDiagnostic; },
    pnoV18ApplyPageResult(type, result) { modal.rows = result.parcels || []; modal.total = result.total; modal.sourceValid = result.sourceValid; },
    pnoPendingPropagatePositive() {},
    pnoOperationalLoadAllRaw() { throw new Error("unexpected prefetch"); },
    toast(message, error) { observed.toast.push({ message, error }); },
    setTimeout() { observed.timers++; throw new Error("unexpected timer"); },
    setInterval() { observed.timers++; throw new Error("unexpected polling"); },
    async apiGet(action, params) {
      if (action !== "pendingParcels") { observed.history++; throw new Error("unexpected history/non-detail action"); }
      observed.api.push({ action, ...params });
      if (response) return response(params, observed.api.length);
      return { sourceValid: true, page: params.page, total: params.count,
        proofId: params.proofId, parcels: Array.from({ length: params.count }, (_, i) =>
          ({ pno: `${params.nextStoreId}-${params.type}-${i}`, targetHub: "NE11", targetBranch: "สาขาทดสอบ" })) };
    },
  });
  const names = ["pnoCountForType", "pnoOperationalInboundEligible", "pnoOperationalRawSummary",
    "pnoOperationalCanonicalHub", "pnoOperationalCurrentHub", "pnoOperationalKey", "pnoOperationalTruthEntry",
    "pnoOperationalResolve", "pnoReadOnlyDetailEligibility", "pnoV18ExactSegments", "pnoV18ResolveOpenArgs",
    "pnoReadOnlyUnavailableMessage", "pnoProgressClass", "pnoProgressStatus", "pnoDisplayPercent", "expectedParcelsBadge",
    "findPnoRowById", "pnoBrowserBaseKey", "pnoBrowserPageKey", "browserPnoPage",
    "pnoV18SourceRow", "pnoV18LocatorKey", "pnoV18PageCacheKey", "pnoV18CacheGet", "pnoV18CacheSet",
    "pnoV18UnionFailure", "pnoV18UnionPage", "pnoV18OpenMulti", "pnoV18Fetch", "pnoV18Load",
    "pnoV18EnsureParcelFilterRows", "pnoV18PrepareCurrentFilters"];
  vm.runInContext(names.map(n => rev95Function(source, n)).join("\n"), context);
  vm.runInContext(between(source, "openPendingParcels = async function pnoV18OpenPendingParcels",
    "// LIVE_EVIDENCE_FRONTEND_V29"), context);
  const actualOpen = context.openPendingParcels;
  context.openPendingParcels = (...args) => {
    observed.opens.push(args);
    const promise = actualOpen(...args); pending.push(promise); return promise;
  };
  vm.runInContext(between(source, "function pnoV29DetailTarget", 'document.addEventListener("DOMContentLoaded", pnoV18EnsureUi)'), context);
  // Actual legacy bubble listener must be stopped by the actual V29 capture handler.
  const legacyBody = source.indexOf('const pnoButton = event.target.closest("[data-pno-row]");');
  const legacyStart = source.lastIndexOf('document.addEventListener("click", (event) => {', legacyBody);
  const legacyEnd = source.indexOf("\n  });", legacyBody) + "\n  });".length;
  assert.ok(legacyStart >= 0 && legacyEnd > legacyStart);
  vm.runInContext(source.slice(legacyStart, legacyEnd), context);
  function event(kind, { type = "no_entry", mode = "", key, id = row.id } = {}) {
    const direct = { dataset: { pnoRow: id, pnoType: type, pnoMode: mode } };
    const card = { dataset: { pnoDetailCard: id } };
    return { key, prevented: false, stopped: false,
      target: { closest(selector) {
        if (selector === "[data-pno-row]") return kind === "button" ? direct : null;
        if (selector === "[data-pno-detail-card]") return kind === "card" || kind === "button" ? card : null;
        return null;
      } }, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
  }
  function dispatch(type, e) {
    for (const entry of listeners.filter(x => x.type === type).sort((a, b) => Number(b.capture) - Number(a.capture))) {
      if (e.stopped) break; entry.fn(e);
    }
  }
  async function flush() {
    await Promise.allSettled(pending.splice(0));
    if (modal.filterPromise) await modal.filterPromise.catch(() => {});
    await Promise.resolve();
    assert.equal(observed.history, 0); assert.equal(observed.timers, 0);
  }
  return { context, row, observed, modal, node, event, dispatch, flush, listeners };
}

test("pending parcel detail triggers are accessible and explicitly delegated", () => {
  const badge = between(stagedFrontend, "function expectedParcelsBadge", "function findPnoRowById");
  const opener = between(stagedFrontend, "openPendingParcels = async function pnoV18OpenPendingParcels", "document.addEventListener(\"DOMContentLoaded\", pnoV18EnsureUi)");
  assert.match(badge, /data-pno-row=/);
  assert.match(badge, /data-pno-detail-card=/);
  assert.match(badge, /role=\\?"button\\?"/);
  assert.match(badge, /tabindex=\\?"0\\?"/);
  assert.match(opener, /document\.addEventListener\("click", pnoV29OpenDetail, true\)/);
  assert.match(opener, /document\.addEventListener\("keydown", pnoV29OpenDetailByKeyboard, true\)/);
  assert.match(opener, /locator\.pnoLineId \|\| locator\.pnoVanLineId/);
  assert.match(opener, /pnoStoreId/); assert.match(opener, /pnoNextStoreId/);
  assert.doesNotMatch(badge, /apiPost\(|openPendingParcels\(/);
});

test("REV95 direct nested-button click passes exact locator/type and opens once", async () => {
  const h = rev95DetailHarness(); const e = h.event("button"); h.dispatch("click", e); await h.flush();
  assert.equal(h.observed.opens.length, 1); assert.equal(h.observed.api.length, 1);
  assert.equal(h.observed.opens[0][0], h.row); assert.equal(h.observed.opens[0][1], "no_entry");
  assert.equal(h.observed.opens[0][2], 1); assert.equal(h.observed.opens[0][3].selection, null);
  const req = h.observed.api[0];
  for (const [field, expected] of Object.entries({ branch: "NE11", proofId: h.row.proofId,
    day: h.row.pnoSourceDay, lineId: h.row.pnoLineId, storeId: h.row.pnoStoreId,
    nextStoreId: h.row.pnoNextStoreId, type: "no_entry", page: 1, count: 1, force: "" })) assert.equal(req[field], expected, field);
  assert.equal(e.prevented, true); assert.equal(e.stopped, true); assert.equal(h.observed.modal, 1);
});

test("REV95 card click opens total; successful cache reopen adds zero requests", async () => {
  const h = rev95DetailHarness(); h.dispatch("click", h.event("card")); await h.flush();
  assert.equal(h.observed.api.length, 1); assert.equal(h.observed.api[0].type, "total");
  h.dispatch("click", h.event("card")); await h.flush(); assert.equal(h.observed.api.length, 1);
});

test("REV95 actual rendered controls supply the correct detail type and union mode", async () => {
  const h = rev95DetailHarness();
  const html = h.context.expectedParcelsBadge(h.row);
  const buttons = [...html.matchAll(/<button([^>]*)>/g)].map(match => ({
    id: match[1].match(/data-pno-row="([^"]+)"/)?.[1],
    type: match[1].match(/data-pno-type="([^"]+)"/)?.[1],
  }));
  assert.deepEqual(buttons.map(x => x.type), ["already", "no_entry"]);
  for (const button of buttons) {
    assert.equal(button.id, h.row.id);
    const count = h.observed.api.length;
    h.dispatch("click", h.event("button", button)); await h.flush();
    assert.equal(h.observed.api.length, count + 1);
    assert.equal(h.observed.api.at(-1).type, button.type);
  }
  const m = rev95DetailHarness(rev95Multi());
  const multiHtml = m.context.expectedParcelsBadge(m.row);
  assert.match(multiHtml, /data-pno-mode="union"/);
  assert.match(multiHtml, /data-pno-mode="choose"/);
  assert.doesNotMatch(multiHtml, /data-pno-detail-card=/);
  const denied = h.context.expectedParcelsBadge(rev95Row({ pnoStoreId: "" }));
  assert.doesNotMatch(denied, /data-pno-row=|data-pno-detail-card=/);
});

for (const key of ["Enter", " "]) test(`REV95 card keyboard ${JSON.stringify(key)} opens once`, async () => {
  const h = rev95DetailHarness(); const e = h.event("card", { key }); h.dispatch("keydown", e); await h.flush();
  assert.equal(h.observed.opens.length, 1); assert.equal(h.observed.api.length, 1); assert.equal(e.prevented, true);
});

test("REV95 unrelated keys/targets are inert; native button keyboard uses one later click", async () => {
  const h = rev95DetailHarness(); h.dispatch("keydown", h.event("card", { key: "Escape" }));
  h.dispatch("click", h.event("unrelated")); h.dispatch("keydown", h.event("button", { key: "Enter" }));
  await h.flush(); assert.equal(h.observed.opens.length, 0); assert.equal(h.observed.api.length, 0);
  h.dispatch("click", h.event("button")); await h.flush(); assert.equal(h.observed.opens.length, 1); assert.equal(h.observed.api.length, 1);
});

test("REV95 multi-segment choose is lazy; exact selected segment controls request", async () => {
  const h = rev95DetailHarness(rev95Multi()); h.dispatch("click", h.event("button", { mode: "choose", type: "total" })); await h.flush();
  assert.equal(h.observed.api.length, 0); assert.equal(h.observed.opens[0][3].selection, null);
  const buttons = h.node("pending-parcels-loading").buttons; assert.equal(buttons.length, 3);
  buttons.find(x => x.dataset.pnoSegment === "1").onclick(); await h.flush();
  assert.equal(h.modal.selection, 1); assert.equal(h.observed.api.length, 1);
  assert.equal(h.observed.api[0].nextStoreId, "SYNTH-NEXT-2"); assert.equal(h.observed.api[0].lineId, "SYNTH-LINE-2");
});

test("REV95 explicit union reads each exact segment once and preserves all members", async () => {
  const h = rev95DetailHarness(rev95Multi()); h.dispatch("click", h.event("button", { mode: "union", type: "total" })); await h.flush();
  assert.equal(h.observed.opens.length, 1); assert.equal(h.observed.opens[0][3].selection, "union");
  assert.equal(h.modal.selection, "union"); assert.equal(h.observed.api.length, 2);
  assert.deepEqual(h.observed.api.map(x => x.nextStoreId), ["SYNTH-NEXT-1", "SYNTH-NEXT-2"]);
  assert.equal(h.modal.total, 4); assert.equal(h.modal.rows.length, 4);
  assert.equal(new Set(h.modal.rows.map(x => x.pno)).size, 4); assert.equal(h.modal.filterRows.length, 4);
});

for (const field of ["proofId", "pnoSourceDay", "pnoLineId", "pnoStoreId", "pnoNextStoreId"])
  test(`REV95 incomplete ${field} denies opening without a request`, async () => {
    const h = rev95DetailHarness(rev95Row({ [field]: "" })); h.dispatch("click", h.event("button")); await h.flush();
    assert.equal(h.observed.api.length, 0); assert.equal(h.observed.modal, 0); assert.equal(h.observed.toast.length, 1);
  });

test("REV95 vanLineId alternative is a valid locator", async () => {
  const h = rev95DetailHarness(rev95Row({ pnoLineId: "", pnoVanLineId: "SYNTH-VAN" }));
  h.dispatch("click", h.event("button")); await h.flush(); assert.equal(h.observed.api.length, 1); assert.equal(h.observed.api[0].vanLineId, "SYNTH-VAN");
});

test("REV95 current-row locator change during open denies acquisition", async () => {
  const h = rev95DetailHarness();
  h.dispatch("click", h.event("button"));
  h.context.state.currentRows = [{ ...h.row, pnoNextStoreId: "SYNTH-OTHER-DESTINATION" }];
  await h.flush();
  assert.equal(h.observed.api.length, 0);
  assert.equal(h.modal.rows.length, 0);
  assert.match(h.node("pending-parcels-loading").innerHTML, /ไม่พบข้อมูลรถ/);
});

test("REV95 mismatched counts, disabled detail, origin and unknown row are denied", async () => {
  for (const r of [rev95Row({ pendingParcels: 9 }), rev95Row({ pnoDetailAvailable: false }), rev95Row({ attendanceType: "ต้นทาง" })]) {
    const h = rev95DetailHarness(r); h.dispatch("click", h.event("button")); await h.flush(); assert.equal(h.observed.api.length, 0); assert.equal(h.observed.modal, 0);
  }
  const h = rev95DetailHarness(); h.dispatch("click", h.event("button", { id: "SYNTH-OTHER-OCCURRENCE" })); await h.flush(); assert.equal(h.observed.opens.length, 0);
});

test("REV95 malformed or mismatched segment identity and invalid selection fail closed", async () => {
  for (const modify of [r => r.pnoSegments.pop(), r => { r.pnoSegments[1].proofId = "SYNTH-WRONG"; },
    r => { r.pnoSegments[1].pnoNextStoreId = ""; }, r => { r.pnoSegments[1].pendingParcels = 5; },
    r => { r.pnoSegments[1] = { ...r.pnoSegments[0] }; }]) {
    const r = rev95Multi(); modify(r); const h = rev95DetailHarness(r);
    h.dispatch("click", h.event("button", { mode: "union" })); await h.flush(); assert.equal(h.observed.api.length, 0);
  }
  const h = rev95DetailHarness(rev95Multi()); await h.context.openPendingParcels(h.row, "total", 1, { selection: 99 }); await h.flush(); assert.equal(h.observed.api.length, 0);
});

test("REV95 partial union source denies complete result without retry/history", async () => {
  const h = rev95DetailHarness(rev95Multi(), { response: async params => ({ sourceValid: false, total: params.count, page: params.page, parcels: [] }) });
  h.dispatch("click", h.event("button", { mode: "union", type: "total" })); await h.flush();
  assert.equal(h.observed.api.length, 1); assert.equal(h.modal.rows.length, 0); assert.equal(h.modal.total, 0);
  assert.equal(h.observed.unionError.reasonCode, "PNO_UNION_SOURCE_INVALID"); assert.match(h.node("pending-parcels-loading").innerHTML, /ไม่ครบ/);
});

test("REV95 failed detail request is not retried automatically", async () => {
  const h = rev95DetailHarness(rev95Row(), { response: async () => { throw new Error("SYNTH-OFFLINE-FAILURE"); } });
  h.dispatch("click", h.event("button")); await h.flush();
  assert.equal(h.observed.api.length, 1); assert.equal(h.modal.busy, false); assert.match(h.node("pending-parcels-loading").innerHTML, /SYNTH-OFFLINE-FAILURE/);
});

test("REV95 overlapping duplicate activations do not duplicate an in-flight page request", async () => {
  let release; const held = new Promise(resolve => { release = resolve; });
  const h = rev95DetailHarness(rev95Row(), { response: async params => { await held; return { sourceValid: true, total: params.count, page: params.page, parcels: [{ pno: "SYNTH-ONE" }] }; } });
  h.dispatch("click", h.event("button")); h.dispatch("click", h.event("button"));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.observed.api.length, 1); release(); await h.flush(); assert.equal(h.observed.api.length, 1);
});

test("pending detail retains empty, error, copy, and export paths without background polling", () => {
  assert.match(stagedFrontend, /ไม่พบรายการตามฟิลเตอร์ที่เลือก/);
  assert.match(stagedFrontend, /เปิดรายละเอียดพัสดุไม่สำเร็จ/);
  assert.match(stagedFrontend, /function pnoV18Copy\(/);
  assert.match(stagedFrontend, /async function pnoV18Export\(/);
  const runtime = between(
    stagedFrontend,
    "function pnoV18EnsureUi",
    "openPendingParcels = async function pnoV18OpenPendingParcels",
  );
  assert.doesNotMatch(runtime, /setInterval\(|setTimeout\(/);
});

test("history, viewer dedupe, HBI, and database safety contracts remain staged", () => {
  assert.match(stagedWorker, /snapshot_at\s*<=\s*\?/);
  assert.match(stagedWorker, /MS_REC04_HISTORY_FRESHNESS_TRUTH_V1/);
  assert.match(stagedBusRuntime, /if \(active\.has\(key\)\)/);
  assert.match(stagedBusRuntime, /busDeduplicatedReaders \+= 1/);
  assert.match(stagedWorker, /HBI_PHOTO_ON_DEMAND_V1/);
  assert.doesNotMatch(stagedWorker, /CREATE TABLE[\s\S]*DEV_AUXILIARY_EVIDENCE_COMPLETENESS_V1/);
});

test("point-in-time history never gains late Schedule E or PreEntry evidence", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE ms_route_registry(hub TEXT NOT NULL,route_id TEXT NOT NULL,first_seen_at TEXT NOT NULL DEFAULT '',PRIMARY KEY(hub,route_id));
    CREATE TABLE ms_route_history(history_id TEXT PRIMARY KEY,route_id TEXT NOT NULL,hub TEXT NOT NULL,event_type TEXT NOT NULL,snapshot_at TEXT NOT NULL,payload_json TEXT NOT NULL,synced_by TEXT NOT NULL);
    CREATE INDEX idx_ms_route_history_hub_route_snapshot ON ms_route_history(hub,route_id,snapshot_at DESC);
    CREATE TABLE ms_route_cancellations(route_id TEXT NOT NULL,hub TEXT NOT NULL,cancelled_at TEXT NOT NULL,cancelled_by TEXT NOT NULL,reason TEXT NOT NULL,active INTEGER NOT NULL);
  `);
  sqlite.prepare("INSERT INTO ms_route_registry VALUES('NE1','route-hdy','2026-09-22T10:00:00.000Z')").run();
  const insert = (historyId, snapshotAt, payload) => sqlite.prepare(
    "INSERT INTO ms_route_history VALUES(?,'route-hdy','NE1','UPDATED',?,?, 'MS_AUTO')",
  ).run(historyId, snapshotAt, JSON.stringify({ ...completed(), hub: "NE1", ...payload }));
  insert("early", "2026-09-22T10:00:00.000Z", {
    scheduleUnloadingCompletedAt: "",
    expectedParcels: 1000,
    enteredParcels: 900,
    pendingParcels: 100,
  });
  insert("late", "2026-09-22T15:00:00.000Z", {
    scheduleUnloadingCompletedAt: "2026-09-22T14:15:21.000Z",
    expectedParcels: 1000,
    enteredParcels: 980,
    pendingParcels: 20,
  });
  const env = {
    DB: {
      prepare(sql) {
        const statement = sqlite.prepare(sql);
        return {
          bind(...args) {
            return {
              async all() { return { results: statement.all(...args) }; },
              async first() { return statement.get(...args) || null; },
            };
          },
        };
      },
    },
  };
  const early = await queryMsDailyArchivePointer(env, "NE1", "2026-09-22", "2026-09-22", "2026-09-22T12:00:00.000Z");
  const late = await queryMsDailyArchivePointer(env, "NE1", "2026-09-22", "2026-09-22", "2026-09-22T16:00:00.000Z");
  assert.equal(early.rows[0].scheduleUnloadingCompletedAt, "");
  assert.deepEqual([early.rows[0].enteredParcels, early.rows[0].pendingParcels], [900, 100]);
  assert.equal(late.rows[0].scheduleUnloadingCompletedAt, "2026-09-22T14:15:21.000Z");
  assert.deepEqual([late.rows[0].enteredParcels, late.rows[0].pendingParcels], [980, 20]);
  sqlite.close();
});
