import test from "node:test";
import assert from "node:assert/strict";

const proof = (value) => String(value || "").trim().toUpperCase().replace(/\s+/g, "");
const parse = (value) => value ? new Date(value) : null;
const earliestIso = (...values) => {
  const dates = values.map(parse).filter((d) => d && Number.isFinite(d.getTime()));
  if (!dates.length) return "";
  return new Date(Math.min(...dates.map((d) => d.getTime()))).toISOString();
};

function consolidateBus(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = proof(row.proofId);
    if (!key) continue;
    const old = map.get(key) || {};
    map.set(key, {
      proofId: row.proofId,
      routeName: row.routeName || old.routeName || "",
      scheduleTbrArrivalAt: earliestIso(old.scheduleTbrArrivalAt, row.scheduleTbrArrivalAt),
      scheduleKitArrivalAt: earliestIso(old.scheduleKitArrivalAt, row.scheduleKitArrivalAt),
    });
  }
  return map;
}

export function shadowQueue(routeRows, busRows, nowIso) {
  const now = parse(nowIso);
  const bus = consolidateBus(busRows);
  const routes = new Map(routeRows.map((row) => [proof(row.proofId), row]));
  const keys = new Set([...routes.keys(), ...bus.keys()]);
  const output = [];

  for (const key of keys) {
    const route = routes.get(key);
    const support = bus.get(key);
    const tbr = support?.scheduleTbrArrivalAt || "";
    const kit = support?.scheduleKitArrivalAt || "";
    const routeArrival = route?.actualArrivalAt || "";
    const provisional = !routeArrival && Boolean(tbr);
    const queueArrivalAt = routeArrival
      ? earliestIso(routeArrival, kit, tbr)
      : provisional ? tbr : "";
    if (!queueArrivalAt) continue;

    const ageHours = (now - parse(queueArrivalAt)) / 36e5;
    const done = Boolean(route?.actualDepartureAt) || Number(route?.unloadingState) === 2;
    if (done || ageHours < 0 || ageHours > 12) continue;

    output.push({
      proofId: route?.proofId || support?.proofId,
      routeName: route?.routeName || support?.routeName || "",
      queueArrivalAt,
      routeArrivalAt: routeArrival,
      kitArrivalAt: kit,
      tbrArrivalAt: tbr,
      provisional,
      confirmed: Boolean(routeArrival),
    });
  }
  return output;
}

test("TBR opens a provisional queue without KIT or Route", () => {
  const rows = shadowQueue([], [{ proofId: "TRIP-1", scheduleTbrArrivalAt: "2026-09-04T10:00:00+07:00" }], "2026-09-04T10:05:00+07:00");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].provisional, true);
});

test("KIT alone does not open a provisional queue", () => {
  const rows = shadowQueue([], [{ proofId: "TRIP-1", scheduleKitArrivalAt: "2026-09-04T12:00:00+07:00" }], "2026-09-04T12:05:00+07:00");
  assert.equal(rows.length, 0);
});

test("late KIT enriches one TBR candidate without duplication", () => {
  const rows = shadowQueue([], [
    { proofId: "TRIP-1", scheduleTbrArrivalAt: "2026-09-04T10:00:00+07:00" },
    { proofId: " trip-1 ", scheduleKitArrivalAt: "2026-09-04T12:00:00+07:00" },
  ], "2026-09-04T12:01:00+07:00");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].queueArrivalAt, "2026-09-04T03:00:00.000Z");
});

test("Route later confirms the same barcode and preserves earlier TBR queue time", () => {
  const rows = shadowQueue([
    { proofId: "TRIP-1", actualArrivalAt: "2026-09-04T12:00:00+07:00", unloadingState: 0 },
  ], [
    { proofId: "TRIP-1", scheduleTbrArrivalAt: "2026-09-04T10:00:00+07:00", scheduleKitArrivalAt: "2026-09-04T12:00:00+07:00" },
  ], "2026-09-04T12:01:00+07:00");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].confirmed, true);
  assert.equal(rows[0].queueArrivalAt, "2026-09-04T03:00:00.000Z");
});

test("exact field case: TBR 10:29, Route 12:50, BusTime KIT still blank", () => {
  const rows = shadowQueue([
    { proofId: "FIELD-CASE", actualArrivalAt: "2026-09-04T12:50:00+07:00", unloadingState: 0 },
  ], [
    { proofId: "FIELD-CASE", scheduleTbrArrivalAt: "2026-09-04T10:29:00+07:00", scheduleKitArrivalAt: "" },
  ], "2026-09-04T12:51:00+07:00");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kitArrivalAt, "");
  assert.equal(rows[0].queueArrivalAt, "2026-09-04T03:29:00.000Z");
});

test("same route name with different barcodes never cross-merges", () => {
  const rows = shadowQueue([], [
    { proofId: "ROUND-A", routeName: "NE1-BURT", scheduleTbrArrivalAt: "2026-09-04T10:00:00+07:00" },
    { proofId: "ROUND-B", routeName: "NE1-BURT", scheduleTbrArrivalAt: "2026-09-04T10:02:00+07:00" },
  ], "2026-09-04T10:10:00+07:00");
  assert.equal(rows.length, 2);
});

test("duplicate BusTime rows collapse to one barcode candidate and earliest TBR", () => {
  const rows = shadowQueue([], [
    { proofId: "ABC-9", scheduleTbrArrivalAt: "2026-09-04T10:29:00+07:00" },
    { proofId: "ABC-9", scheduleTbrArrivalAt: "2026-09-04T10:31:00+07:00" },
    { proofId: "ABC-9", scheduleKitArrivalAt: "2026-09-04T12:50:00+07:00" },
  ], "2026-09-04T12:51:00+07:00");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].queueArrivalAt, "2026-09-04T03:29:00.000Z");
});

test("Route-only behavior remains valid", () => {
  const rows = shadowQueue([{ proofId: "ROUTE-ONLY", actualArrivalAt: "2026-09-04T11:00:00+07:00", unloadingState: 0 }], [], "2026-09-04T11:05:00+07:00");
  assert.equal(rows.length, 1);
});

test("TBR-only candidate expires at the existing 12-hour safety window", () => {
  const rows = shadowQueue([], [{ proofId: "STALE", scheduleTbrArrivalAt: "2026-09-03T20:00:00+07:00" }], "2026-09-04T09:01:00+07:00");
  assert.equal(rows.length, 0);
});

test("completed/departed Route cannot re-enter from old TBR", () => {
  const rows = shadowQueue([{ proofId: "DONE", actualArrivalAt: "2026-09-04T10:00:00+07:00", actualDepartureAt: "2026-09-04T11:00:00+07:00" }], [{ proofId: "DONE", scheduleTbrArrivalAt: "2026-09-04T09:50:00+07:00" }], "2026-09-04T11:01:00+07:00");
  assert.equal(rows.length, 0);
});
