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
  assert.equal((refresh.match(/readPreEntryCounts\(env, branch\)/g) || []).length, 1);
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

test("pending parcel detail trigger is rendered, click-only, and locator-complete", () => {
  const badge = between(stagedFrontend, "function expectedParcelsBadge", "function findPnoRowById");
  const opener = between(stagedFrontend, "openPendingParcels = async function pnoV18OpenPendingParcels", "document.addEventListener(\"DOMContentLoaded\", pnoV18EnsureUi)");
  assert.match(badge, /data-pno-row=/);
  assert.match(badge, /data-pno-detail-card=/);
  assert.match(opener, /document\.addEventListener\("click", pnoV29OpenDetail, true\)/);
  assert.match(opener, /openPendingParcels\(row, target\.type, 1\)/);
  assert.match(opener, /pnoLineId \|\| args\.row\.pnoVanLineId/);
  assert.match(opener, /pnoStoreId/);
  assert.match(opener, /pnoNextStoreId/);
  assert.doesNotMatch(badge, /apiPost\(|openPendingParcels\(/);
  assert.equal((opener.match(/openPendingParcels\(row, target\.type, 1\)/g) || []).length, 1);
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
