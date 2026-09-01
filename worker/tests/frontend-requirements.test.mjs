import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../../", import.meta.url);
const source = await readFile(new URL("ms.js", root), "utf8");
const context = vm.createContext({
  console,
  Date,
  Intl,
  URL,
  setInterval() {},
  setTimeout() {},
  clearTimeout() {},
  document: { addEventListener() {}, getElementById() { return null; } },
  window: { location: { hostname: "localhost", origin: "http://localhost" } },
  localStorage: { getItem() { return null; }, removeItem() {}, setItem() {} },
});
vm.runInContext(`${source}\n;globalThis.uiTest={expectedParcelsBadge,dropOperation,dropProgressHtml,departureCountdown,isCompletedToday,effectiveArrival,punctuality,schedulePunctuality,routeState,queueInfo,waitInfo};`, context);
const ui = context.uiTest;

test("expected parcel badge distinguishes zero from missing", () => {
  assert.match(ui.expectedParcelsBadge({ expectedParcels: 1914 }), /พัสดุทั้งหมด 1,914/);
  assert.match(ui.expectedParcelsBadge({ expectedParcels: 0 }), /พัสดุทั้งหมด 0/);
  assert.equal(ui.expectedParcelsBadge({ expectedParcels: null }), "");
});

test("drop unloading time freezes and uses the existing vehicle standard", () => {
  vm.runInContext(`state.standards={"6W":30}`, context);
  const row = {
    attendanceType: "จุดดรอป",
    vehicleType: "6W7.2",
    actualArrivalAt: "2026-09-01T00:00:00.000Z",
    unloadingCompletedAt: "2026-09-01T00:24:00.000Z",
    unloadingState: 2,
  };
  const drop = ui.dropOperation(row);
  assert.equal(drop.unloadingMinutes, 24);
  assert.equal(drop.unloadingStandard, 30);
  assert.match(ui.dropProgressHtml(drop), /ใช้เวลา 24 นาที · มาตรฐาน 30 นาที/);
  assert.match(ui.dropProgressHtml(drop), /2 · ไปต่อ/);
});

test("today completion uses Asia Bangkok and includes destination and drop", () => {
  const now = new Date("2026-09-01T18:00:00.000Z"); // 2 Sep in Bangkok
  for (const attendanceType of ["ปลายทาง", "จุดดรอป"])
    assert.equal(ui.isCompletedToday({
      attendanceType,
      unloadingState: 2,
      unloadingCompletedAt: "2026-09-01T17:30:00.000Z",
    }, now), true);
  assert.equal(ui.isCompletedToday({
    attendanceType: "ปลายทาง",
    unloadingState: 2,
    unloadingCompletedAt: "2026-09-01T16:59:00.000Z",
  }, now), false);
  assert.equal(ui.isCompletedToday({
    attendanceType: "ปลายทาง",
    unloadingState: 2,
    unloadingCompletedAt: "2026-09-01T17:30:00.000Z",
    completionObservedLive: false,
  }, now), false);
});

test("departure countdown covers pending, overdue, early, late, and on-time", () => {
  const base = { attendanceType: "ต้นทาง", estimatedDepartureAt: "2026-09-01T01:00:00.000Z" };
  assert.match(ui.departureCountdown(base, new Date("2026-09-01T00:16:00.000Z")).label, /เหลือ 44 นาที/);
  assert.match(ui.departureCountdown(base, new Date("2026-09-01T01:12:00.000Z")).label, /เกินกำหนด 12 นาที/);
  assert.match(ui.departureCountdown({ ...base, actualDepartureAt: "2026-09-01T00:07:00.000Z" }).label, /ออกก่อนเวลา 53 นาที/);
  assert.match(ui.departureCountdown({ ...base, actualDepartureAt: "2026-09-01T01:08:00.000Z" }).label, /ออกช้า 8 นาที/);
  assert.equal(ui.departureCountdown({ ...base, actualDepartureAt: base.estimatedDepartureAt }).label, "ตรงเวลา");
});

test("Bangkok-normalized route times keep punctuality and waiting durations local", () => {
  vm.runInContext(`state.standards={"6W":45}`, context);
  const row = {
    attendanceType: "ปลายทาง",
    vehicleType: "6W7.2",
    estimatedArrivalAt: "2026-09-01T19:30:00.000Z", // 02:30 Bangkok
    actualArrivalAt: "2026-09-01T19:59:03.000Z", // 02:59 Bangkok
    unloadingCompletedAt: "2026-09-01T20:29:03.000Z", // 03:29 Bangkok
  };
  assert.equal(ui.punctuality(row).diff, 29);
  assert.equal(ui.schedulePunctuality(row, "arrival").diff, 29);
  assert.equal(ui.waitInfo(row).minutes, 30);
  assert.equal(ui.waitInfo(row).over, false);
});

test("effective arrival selects the earliest valid Route, KIT, or TBR value", () => {
  const at = (value) => `2026-09-01T${value}:00.000Z`;
  const effective = (row) => ui.effectiveArrival(row)?.toISOString();
  assert.equal(effective({ actualArrivalAt: at("03:00") }), at("03:00"));
  assert.equal(effective({ actualArrivalAt: at("03:00"), scheduleKitArrivalAt: at("03:00") }), at("03:00"));
  assert.equal(effective({ actualArrivalAt: at("03:00"), scheduleKitArrivalAt: at("02:58") }), at("02:58"));
  assert.equal(effective({ actualArrivalAt: at("03:00"), scheduleTbrArrivalAt: at("02:50") }), at("02:50"));
  assert.equal(effective({ actualArrivalAt: at("03:00"), scheduleKitArrivalAt: at("02:58"), scheduleTbrArrivalAt: at("02:50") }), at("02:50"));
  assert.equal(effective({ actualArrivalAt: at("03:00"), scheduleKitArrivalAt: at("02:58"), scheduleTbrArrivalAt: at("03:05") }), at("02:58"));
});

test("late TBR recomputes a completed unloading duration without changing raw fields", () => {
  vm.runInContext(`state.standards={"6W":45}`, context);
  const at = (value) => `2026-09-01T${value}:00.000Z`;
  const row = {
    attendanceType: "ปลายทาง",
    vehicleType: "6W",
    actualArrivalAt: at("03:00"),
    scheduleKitArrivalAt: at("03:00"),
    scheduleTbrArrivalAt: null,
    unloadingCompletedAt: at("03:18"),
    unloadingState: 2,
  };
  assert.equal(ui.waitInfo(row).minutes, 18);
  row.scheduleTbrArrivalAt = at("02:50");
  assert.equal(ui.waitInfo(row).minutes, 28);
  assert.equal(row.actualArrivalAt, at("03:00"));
  assert.equal(row.unloadingCompletedAt, at("03:18"));
});

test("KIT or TBR alone cannot confirm arrival or create queue membership", () => {
  const row = {
    attendanceType: "ปลายทาง",
    scheduleKitArrivalAt: "2026-09-01T02:50:00.000Z",
    scheduleTbrArrivalAt: "2026-09-01T02:55:00.000Z",
  };
  assert.equal(ui.routeState(row, new Date("2026-09-01T04:00:00.000Z")).key, "not-arrived");
  assert.equal(ui.queueInfo(row, new Date("2026-09-01T04:00:00.000Z")).active, false);
  assert.equal(ui.waitInfo(row).minutes, null);
});

test("incoming calculations use effective arrival while departure stays Route-only", () => {
  const row = {
    attendanceType: "จุดดรอป",
    estimatedArrivalAt: "2026-09-01T03:00:00.000Z",
    actualArrivalAt: "2026-09-01T03:05:00.000Z",
    scheduleTbrArrivalAt: "2026-09-01T02:50:00.000Z",
    estimatedDepartureAt: "2026-09-01T03:20:00.000Z",
    actualDepartureAt: "2026-09-01T03:25:00.000Z",
  };
  assert.equal(ui.schedulePunctuality(row, "arrival").diff, -10);
  assert.equal(ui.schedulePunctuality(row, "departure").diff, 5);
  row.scheduleTbrArrivalAt = "2026-09-01T01:00:00.000Z";
  assert.equal(ui.schedulePunctuality(row, "departure").diff, 5);
});

test("queue age uses effective arrival only after Route confirms arrival", () => {
  const row = {
    attendanceType: "ปลายทาง",
    actualArrivalAt: "2026-09-01T03:00:00.000Z",
    scheduleTbrArrivalAt: "2026-09-01T02:50:00.000Z",
    unloadingState: 0,
  };
  const queue = ui.queueInfo(row, new Date("2026-09-01T03:50:00.000Z"));
  assert.equal(Math.round(queue.ageHours * 60), 60);
  assert.equal(queue.active, true);
});

test("warehouse page is removed from navigation and redirects without polling script", async () => {
  for (const file of ["ms.html", "waiting.html", "ms-report.html"])
    assert.doesNotMatch(await readFile(new URL(file, root), "utf8"), /warehouse\.html/);
  assert.match(await readFile(new URL("warehouse.html", root), "utf8"), /location\.replace\("ms\.html"\)/);
  assert.match(await readFile(new URL("scan.html", root), "utf8"), /location\.replace\("ms\.html"\)/);
});

test("realtime settings and read-only archive count remain intact", async () => {
  assert.match(source, /pollMs:\s*4000/);
  const cron = await readFile(new URL("cloudflare-browser-test/wrangler.jsonc", root), "utf8");
  assert.match(cron, /"\* \* \* \* \*"/);
  const worker = await readFile(new URL("worker/src/index.js", root), "utf8");
  assert.match(worker, /COUNT\(DISTINCT route_id\) AS total_distinct/);
});
