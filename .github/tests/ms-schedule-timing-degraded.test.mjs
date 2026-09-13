import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { stageWorker } from "../dev-tools/stage-dev-runtime.mjs";

const workerSource = await readFile(new URL("../../worker/src/index.js", import.meta.url), "utf8");
const stagedWorker = stageWorker(workerSource);

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

function queueRuntime() {
  const start = stagedWorker.indexOf("function msTbrAttendanceFromMapKey(");
  const end = stagedWorker.indexOf("\n\nasync function preEntryCredentials", start);
  assert.ok(start >= 0 && end > start, "first-source helper section must exist");
  const source = stagedWorker.slice(start, end);
  const context = { Map, Date, Number, normalizeProofId, normalizeMsAttendance, date, text };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.queueRows = msQueueFirstSourceRows;`, context);
  return { queueRows: context.queueRows, source };
}

function busMap(item) {
  return new Map([[`P:${normalizeProofId(item.proofId)}|A:${item.attendanceType}`, item]]);
}

test("fresh schedule unload-start enriches an existing accepted Route row without overwriting Route truth", () => {
  const { queueRows, source } = queueRuntime();
  const base = [{
    id: "route-accepted-1",
    proofId: "KKC1TM8T72",
    attendanceType: "ปลายทาง",
    actualArrivalAt: "",
    unloadingState: 0,
    scheduleTbrArrivalAt: "2026-09-13T06:30:07.000Z",
    scheduleUnloadingStartedAt: "",
  }];
  const bus = busMap({
    proofId: "KKC1TM8T72",
    attendanceType: "ปลายทาง",
    scheduleTbrArrivalAt: "2026-09-13T06:30:07.000Z",
    scheduleUnloadingStartedAt: "2026-09-13T06:54:10.000Z",
    arrivedParcels: 10,
    arrivedBags: 2,
  });
  const rows = queueRows(base, bus, "NE1", Date.parse("2026-09-13T07:00:00.000Z"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "route-accepted-1");
  assert.equal(rows[0].actualArrivalAt, "");
  assert.equal(rows[0].unloadingState, 0);
  assert.equal(rows[0].scheduleTbrArrivalAt, "2026-09-13T06:30:07.000Z");
  assert.equal(rows[0].scheduleUnloadingStartedAt, "2026-09-13T06:54:10.000Z");
  assert.equal(rows[0].arrivedParcels, 10);
  assert.equal(rows[0].arrivedBags, 2);
  assert.notEqual(rows[0], base[0], "live composition must not mutate accepted cached row object");
  assert.equal(base[0].scheduleUnloadingStartedAt, "");
  assert.doesNotMatch(source, /env\.DB|\.run\(|\.batch\(|fetch\s*\(/);
});

test("later Route refresh can merge onto the same trip without losing earlier TBR admission or schedule unload-start", () => {
  const { queueRows } = queueRuntime();
  const bus = busMap({
    proofId: "AYU1TMAQ72",
    attendanceType: "ปลายทาง",
    scheduleTbrArrivalAt: "2026-09-13T06:23:36.000Z",
    scheduleUnloadingStartedAt: "2026-09-13T06:50:00.000Z",
  });
  const refreshedRoute = [{
    id: "route-refreshed-1",
    proofId: "AYU1TMAQ72",
    attendanceType: "ปลายทาง",
    actualArrivalAt: "2026-09-13T06:28:00.000Z",
    unloadingState: 1,
    scheduleTbrArrivalAt: "2026-09-13T06:23:36.000Z",
  }];
  const rows = queueRows(refreshedRoute, bus, "NE1", Date.parse("2026-09-13T07:00:00.000Z"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "route-refreshed-1");
  assert.equal(rows[0].actualArrivalAt, "2026-09-13T06:28:00.000Z");
  assert.equal(rows[0].unloadingState, 1);
  assert.equal(rows[0].scheduleTbrArrivalAt, "2026-09-13T06:23:36.000Z");
  assert.equal(rows[0].scheduleUnloadingStartedAt, "2026-09-13T06:50:00.000Z");
});
