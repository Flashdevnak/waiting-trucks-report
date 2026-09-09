import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const target = new URL("worker/tests/frontend-requirements.test.mjs", root);
let source = await readFile(target, "utf8");

const oldBlock = `test("lower completion uses Bangkok midnight and trusted Schedule E", () => {
  const now = new Date("2026-09-01T18:00:00.000Z");
  for (const attendanceType of ["ปลายทาง", "จุดดรอป"]) assert.equal(ui.isCompletedToday({ attendanceType, unloadingState: 2, unloadingCompletedAt: "2026-09-01T17:30:00.000Z" }, now), true);
  assert.equal(ui.isCompletedToday({ attendanceType: "ปลายทาง", unloadingState: 2, unloadingCompletedAt: "2026-09-01T16:59:00.000Z" }, now), false);
  assert.equal(ui.isCompletedToday({ attendanceType: "ปลายทาง", unloadingState: 2, unloadingCompletedAt: "2026-09-01T17:30:00.000Z", completionObservedLive: false }, now), false);
  assert.equal(ui.isCompletedToday({ attendanceType: "ปลายทาง", unloadingState: 2, unloadingCompletedAt: "2026-09-01T17:30:00.000Z", completionObservedLive: false, completionSource: "SCHEDULE" }, now), true);
});`;

const newBlock = `test("lower completion follows Bangkok current-day route truth regardless of completion timestamp provenance", () => {
  const now = new Date("2026-09-01T18:00:00.000Z");
  for (const attendanceType of ["ปลายทาง", "จุดดรอป"])
    assert.equal(ui.isCompletedToday({ attendanceType, unloadingState: 2, estimatedArrivalAt: "2026-09-01T17:30:00.000Z" }, now), true);
  assert.equal(ui.isCompletedToday({ attendanceType: "ปลายทาง", unloadingState: 2, estimatedArrivalAt: "2026-09-01T16:59:00.000Z" }, now), false);
  assert.equal(ui.isCompletedToday({ attendanceType: "ปลายทาง", unloadingState: 2, estimatedArrivalAt: "2026-09-01T17:30:00.000Z", completionObservedLive: false }, now), true);
  assert.equal(ui.isCompletedToday({ attendanceType: "ปลายทาง", unloadingState: 1, estimatedArrivalAt: "2026-09-01T17:30:00.000Z" }, now), false);
  assert.equal(ui.isCompletedToday({ attendanceType: "ปลายทาง", unloadingState: 2, estimatedArrivalAt: "2026-09-01T17:30:00.000Z", queueCancelledAt: "2026-09-01T17:45:00.000Z" }, now), false);
});`;

if (source.includes(oldBlock)) {
  if (source.indexOf(oldBlock) !== source.lastIndexOf(oldBlock))
    throw new Error("worker lower current-day test block is not unique");
  source = source.replace(oldBlock, newBlock);
} else if (!source.includes(newBlock)) {
  throw new Error("worker lower current-day test target missing");
}

await writeFile(target, source);
console.log("WORKER_LOWER_CURRENT_DAY_TEST_V1=PATCHED");
