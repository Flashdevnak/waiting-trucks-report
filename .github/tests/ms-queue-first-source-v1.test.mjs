import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { stageFrontend, stageWorker } from "../dev-tools/stage-dev-runtime.mjs";

const workerSource = await readFile(new URL("../../worker/src/index.js", import.meta.url), "utf8");
const frontendSource = await readFile(new URL("../../ms.js", import.meta.url), "utf8");
const stagedWorker = stageWorker(workerSource);
const stagedFrontend = stageFrontend(frontendSource);

function normalizeProofId(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeMsAttendance(value) {
  const text = String(value || "").trim();
  if (text.includes("จุดดร")) return "จุดดรอป";
  if (text.includes("ปลายทาง")) return "ปลายทาง";
  if (text.includes("ต้นทาง")) return "ต้นทาง";
  return text;
}

function date(value) {
  const at = Date.parse(String(value || ""));
  return Number.isFinite(at) ? new Date(at).toISOString() : "";
}

function text(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function firstSourceRuntime() {
  const start = stagedWorker.indexOf("function msTbrAttendanceFromMapKey(");
  const end = stagedWorker.indexOf("\n\nasync function preEntryCredentials", start);
  assert.ok(start >= 0 && end > start, "first-source helper section must exist in staged worker");
  const helperSource = stagedWorker.slice(start, end);
  const context = {
    Map,
    Date,
    normalizeProofId,
    normalizeMsAttendance,
    date,
    text,
  };
  vm.createContext(context);
  vm.runInContext(
    `${helperSource}\nthis.queueRows = msQueueFirstSourceRows; this.shadowFeed = msTbrShadowFeed;`,
    context,
  );
  return {
    queueRows: context.queueRows,
    shadowFeed: context.shadowFeed,
    helperSource,
  };
}

function busMap(entries) {
  return new Map(entries.map(({ proofId, attendanceType, ...value }) => [
    `P:${normalizeProofId(proofId)}|A:${attendanceType}`,
    { proofId, ...value },
  ]));
}

const NOW = Date.parse("2026-09-13T00:00:00.000Z");
const RECENT_TBR = "2026-09-12T23:30:00.000Z";

function inboundBus(overrides = {}) {
  return {
    proofId: "NE1TEST001",
    attendanceType: "ปลายทาง",
    routeName: "TEST-INBOUND",
    scheduleKitArrivalAt: "2026-09-12T23:25:00.000Z",
    scheduleTbrArrivalAt: RECENT_TBR,
    arrivedParcels: 120,
    arrivedBags: 4,
    ...overrides,
  };
}

test("staged DEV treats reached TBR and Route as peer queue-admission sources", () => {
  assert.match(stagedWorker, /MS_QUEUE_FIRST_SOURCE_V1/);
  assert.match(stagedFrontend, /MS_QUEUE_FIRST_SOURCE_V1/);
  assert.match(stagedFrontend, /เข้าคิวแล้วจาก TBR/);
  assert.doesNotMatch(stagedFrontend, /TBR เข้าคิว · รอ Route ยืนยัน/);
  assert.doesNotMatch(stagedWorker, /TBR เข้าคิว · รอ Route ยืนยัน/);
  assert.match(stagedFrontend, /function queueAdmissionArrival\(row\)/);
  assert.match(stagedFrontend, /const start = queueAdmissionArrival\(row\)/);
  assert.match(stagedFrontend, /const arrival = queueAdmissionArrival\(row\)/);
  assert.match(stagedFrontend, /active = Boolean\(arrival\) && !done && !cancelled && ageHours <= 12/);
  assert.match(
    stagedFrontend,
    /function confirmedEffectiveArrival\(row\) \{\s*return parseDate\(row\.actualArrivalAt\) \? effectiveArrival\(row\) : null;/,
  );
});

test("TBR-first inbound vehicle becomes a full queue row immediately with no fabricated Route actual-arrival", () => {
  const { queueRows } = firstSourceRuntime();
  const rows = queueRows([], busMap([inboundBus()]), "NE1", NOW);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].proofId, "NE1TEST001");
  assert.equal(rows[0].attendanceType, "ปลายทาง");
  assert.equal(rows[0].queueAdmissionSource, "TBR");
  assert.equal(rows[0].queueProvisional, undefined);
  assert.equal(rows[0].vehicleStatus, "เข้าคิวแล้วจาก TBR");
  assert.equal(rows[0].actualArrivalAt, "");
  assert.equal(rows[0].unloadingState, null);
  assert.equal(rows[0].scheduleTbrArrivalAt, RECENT_TBR);
  assert.equal(rows[0].syncedBy, "TBR_FIRST_SOURCE");
});

test("Route-first wins immediately and TBR does not duplicate the same proof+attendance", () => {
  const { queueRows } = firstSourceRuntime();
  const route = {
    id: "route-real-1",
    proofId: "NE1TEST001",
    attendanceType: "ปลายทาง",
    actualArrivalAt: "2026-09-12T23:31:00.000Z",
    unloadingState: 0,
  };
  const rows = queueRows([route], busMap([inboundBus()]), "NE1", NOW);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "route-real-1");
  assert.equal(rows[0].queueAdmissionSource, undefined);
});

test("TBR-first followed by Route merges to one real Route row on the next shared snapshot", () => {
  const { queueRows } = firstSourceRuntime();
  const bus = busMap([inboundBus()]);
  const first = queueRows([], bus, "NE1", NOW);
  assert.equal(first.length, 1);
  assert.equal(first[0].queueAdmissionSource, "TBR");

  const route = {
    id: "route-real-2",
    proofId: "NE1TEST001",
    attendanceType: "ปลายทาง",
    actualArrivalAt: "2026-09-12T23:32:00.000Z",
    unloadingState: 1,
  };
  const merged = queueRows([route], bus, "NE1", NOW + 4_000);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "route-real-2");
  assert.equal(merged[0].unloadingState, 1);
});

test("TBR-first admits drop point independently but never admits origin", () => {
  const { queueRows } = firstSourceRuntime();
  const rows = queueRows(
    [],
    busMap([
      inboundBus({ proofId: "DROP001", attendanceType: "จุดดรอป" }),
      inboundBus({ proofId: "ORIGIN001", attendanceType: "ต้นทาง" }),
    ]),
    "NE1",
    NOW,
  );
  assert.deepEqual([...rows].map((row) => row.proofId), ["DROP001"]);
  assert.equal(rows[0].attendanceType, "จุดดรอป");
});

test("stale, too-future, and already-completed TBR rows cannot resurrect queue membership", () => {
  const { queueRows } = firstSourceRuntime();
  const old = new Date(NOW - 13 * 60 * 60 * 1000).toISOString();
  const future = new Date(NOW + 10 * 60 * 1000).toISOString();
  const rows = queueRows(
    [],
    busMap([
      inboundBus({ proofId: "OLD001", scheduleTbrArrivalAt: old }),
      inboundBus({ proofId: "FUTURE001", scheduleTbrArrivalAt: future }),
      inboundBus({ proofId: "DONE001", scheduleUnloadingCompletedAt: RECENT_TBR }),
    ]),
    "NE1",
    NOW,
  );
  assert.equal(rows.length, 0);
});

test("TBR shadow feed preserves attendance identity and dedupes only exact proof+attendance", () => {
  const { shadowFeed } = firstSourceRuntime();
  const feed = shadowFeed(busMap([
    inboundBus({ proofId: "SAME001", attendanceType: "ปลายทาง" }),
    inboundBus({ proofId: "SAME001", attendanceType: "จุดดรอป" }),
  ]));
  assert.equal(feed.length, 2);
  assert.deepEqual(new Set(feed.map((row) => row.attendanceType)), new Set(["ปลายทาง", "จุดดรอป"]));
});

test("first-source live-view composition adds no DB write or extra upstream call path", () => {
  const { helperSource } = firstSourceRuntime();
  assert.doesNotMatch(helperSource, /env\.DB|\.run\(|\.batch\(|fetch\s*\(/);
  assert.match(stagedWorker, /rows: msQueueFirstSourceRows\(sync\.rows, busData, branch\)/);
});
