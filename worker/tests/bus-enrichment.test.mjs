import test from "node:test";
import assert from "node:assert/strict";

import { enrichMsRow, msDate } from "../src/index.js";

test("MS/FBI naive datetime is interpreted as Asia/Bangkok", () => {
  assert.equal(msDate("2026-09-02 03:00:29"), "2026-09-01T20:00:29.000Z");
});

test("numeric Unix timestamps preserve their instant", () => {
  assert.equal(msDate(1788292829), "2026-09-01T20:00:29.000Z");
  assert.equal(msDate(1788292829000), "2026-09-01T20:00:29.000Z");
});

test("ISO timestamps with timezone preserve their instant", () => {
  assert.equal(msDate("2026-09-01T20:00:29.000Z"), "2026-09-01T20:00:29.000Z");
  assert.equal(msDate("2026-09-02T03:00:29+07:00"), "2026-09-01T20:00:29.000Z");
});

test("KIT/TBR enrichment preserves the route actual arrival for the same barcode", () => {
  const routeActualArrival = "2026-09-02T02:10:00.000Z";
  const mapped = {
    proofId: "AYU1T9HM90",
    attendanceType: "ปลายทาง",
    actualArrivalAt: routeActualArrival,
  };
  const busData = new Map([
    [
      "P:AYU1T9HM90",
      {
        scheduleKitArrivalAt: "2026-09-02T02:39:00.000Z",
        scheduleTbrArrivalAt: "2026-09-02T02:38:00.000Z",
        arrivedParcels: 696,
        arrivedBags: 12,
      },
    ],
  ]);

  const enriched = enrichMsRow(mapped, new Map(), busData);

  assert.equal(enriched.actualArrivalAt, routeActualArrival);
  assert.equal(enriched.scheduleKitArrivalAt, "2026-09-02T02:39:00.000Z");
  assert.equal(enriched.scheduleTbrArrivalAt, "2026-09-02T02:38:00.000Z");
  assert.equal(enriched.arrivedParcels, 696);
  assert.equal(enriched.arrivedBags, 12);
});

test("KIT/TBR enrichment does not cross-match another round barcode", () => {
  const mapped = {
    proofId: "AYU1T9HM90",
    attendanceType: "ปลายทาง",
    actualArrivalAt: "2026-09-02T02:10:00.000Z",
  };
  const busData = new Map([
    ["P:OTHERROUND", { scheduleTbrArrivalAt: "2026-09-02T02:38:00.000Z" }],
  ]);

  const enriched = enrichMsRow(mapped, new Map(), busData);

  assert.equal(enriched.actualArrivalAt, "2026-09-02T02:10:00.000Z");
  assert.equal(enriched.scheduleTbrArrivalAt, undefined);
});
