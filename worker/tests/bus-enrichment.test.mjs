import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyBusTimeFailure, enrichMsRow, msDate, parseScheduleUnloadingEnd, parseScheduleUnloadingStart, scheduleStoreMatchesHub } from "../src/index.js";

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

test("Schedule unloading E parses Bangkok wall-clock once", () => {
  assert.equal(parseScheduleUnloadingEnd([{ value: "S:2026-09-08 22:03:57" }, { value: "E:2026-09-08 22:16:26" }]), "2026-09-08T15:16:26.000Z");
  for (const value of [null, [], [{ value: "-" }, { value: "-" }], [{}, { value: "malformed" }]])
    assert.equal(parseScheduleUnloadingEnd(value), "");
});

test("Schedule unloading S parses Bangkok wall-clock once", () => {
  assert.equal(parseScheduleUnloadingStart([{ value: "S:2026-09-08 22:03:57" }, { value: "E:2026-09-08 22:16:26" }]), "2026-09-08T15:03:57.000Z");
  for (const value of [null, [], [{ value: "-" }], [{ value: "malformed" }]])
    assert.equal(parseScheduleUnloadingStart(value), "");
});

test("Schedule HUB matching uses a full token, not substring matching", () => {
  assert.equal(scheduleStoreMatchesHub("02 NE1_HUB-นครราชสีมา", "NE1"), true);
  assert.equal(scheduleStoreMatchesHub("02 NE10_HUB-test", "NE1"), false);
});

test("completion enrichment requires the same barcode and attendance role", () => {
  const busData = new Map([["P:P1|A:ปลายทาง", { scheduleUnloadingCompletedAt: "2026-09-08T15:16:26.000Z" }]]);
  assert.equal(enrichMsRow({ proofId: "P1", attendanceType: "ปลายทาง" }, new Map(), busData).scheduleUnloadingCompletedAt, "2026-09-08T15:16:26.000Z");
  assert.equal(enrichMsRow({ proofId: "P1", attendanceType: "ต้นทาง" }, new Map(), busData).scheduleUnloadingCompletedAt, undefined);
});


test("Flash BusTime request limit is not mislabeled as session expiry", () => {
  assert.deepEqual(classifyBusTimeFailure("Request exceeds the limit"), { code: "BUS_TIME_RATE_LIMIT", status: 429 });
  assert.deepEqual(classifyBusTimeFailure("upstream rejected request", 429), { code: "BUS_TIME_RATE_LIMIT", status: 429 });
  assert.deepEqual(classifyBusTimeFailure("Session expired"), { code: "BUS_TIME_SESSION_EXPIRED", status: 502 });
  assert.deepEqual(classifyBusTimeFailure("unexpected upstream response"), { code: "BUS_TIME_SOURCE_ERROR", status: 502 });
});

test("DEV staging preserves the shared BusTime classifier", () => {
  const testDir = mkdtempSync(join(tmpdir(), "tbr-stage-classifier-"));
  const stagedWorker = join(testDir, "index.js");
  const workerPath = fileURLToPath(new URL("../src/index.js", import.meta.url));
  const patchPath = fileURLToPath(
    new URL(
      "../../cloudflare-browser-test/scripts/patch-dev-tbr-shadow-split-v2.mjs",
      import.meta.url,
    ),
  );
  const readonlyPatchPath = fileURLToPath(
    new URL(
      "../../cloudflare-browser-test/scripts/patch-dev-tbr-shadow-readonly.mjs",
      import.meta.url,
    ),
  );
  try {
    writeFileSync(stagedWorker, readFileSync(workerPath));
    execFileSync(process.execPath, [readonlyPatchPath, stagedWorker], {
      stdio: "pipe",
    });
    execFileSync(process.execPath, [patchPath, stagedWorker], { stdio: "pipe" });
    const staged = readFileSync(stagedWorker, "utf8");
    assert.match(staged, /classifyBusTimeFailure\(message, response\.status\)/);
    assert.match(staged, /classifyBusTimeFailure\(message\)/);
    assert.doesNotMatch(staged, /BUS_TIME_REQUEST_LIMIT/);
  } finally {
    rmSync(testDir, { recursive: true, force: true });
  }
});
