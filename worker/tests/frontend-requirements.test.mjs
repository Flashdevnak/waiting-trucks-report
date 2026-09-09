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
vm.runInContext(`${source}\n;globalThis.uiTest={expectedParcelsBadge,dropOperation,dropProgressHtml,departureCountdown,isCompletedToday,effectiveArrival,confirmedEffectiveArrival,punctuality,schedulePunctuality,scheduleSection,arrivalSources,arrivalSourceDateTime,actualCell,routeState,queueInfo,waitInfo,unloadTiming,unloadSlaSummary,renderOperation,attendanceLabel,attendanceWorkLabel,exportRow,exportThaiDate,shortDateTime,completedTodayDatasetReady};`, context);
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
  assert.match(ui.dropProgressHtml(drop), /<strong>24 นาที<\/strong>/);
  assert.match(ui.dropProgressHtml(drop), /ตั้งแต่รถถึง · มาตรฐาน 30 นาที/);
  assert.match(ui.dropProgressHtml(drop), /2 · ไปต่อ/);
});

test("lower completion follows Bangkok current-day route truth regardless of completion timestamp provenance", () => {
  const now = new Date("2026-09-01T18:00:00.000Z");
  for (const attendanceType of ["ปลายทาง", "จุดดรอป"])
    assert.equal(ui.isCompletedToday({ attendanceType, unloadingState: 2, estimatedArrivalAt: "2026-09-01T17:30:00.000Z" }, now), true);
  assert.equal(ui.isCompletedToday({ attendanceType: "ปลายทาง", unloadingState: 2, estimatedArrivalAt: "2026-09-01T16:59:00.000Z" }, now), false);
  assert.equal(ui.isCompletedToday({ attendanceType: "ปลายทาง", unloadingState: 2, estimatedArrivalAt: "2026-09-01T17:30:00.000Z", completionObservedLive: false }, now), true);
  assert.equal(ui.isCompletedToday({ attendanceType: "ปลายทาง", unloadingState: 1, estimatedArrivalAt: "2026-09-01T17:30:00.000Z" }, now), false);
  assert.equal(ui.isCompletedToday({ attendanceType: "ปลายทาง", unloadingState: 2, estimatedArrivalAt: "2026-09-01T17:30:00.000Z", queueCancelledAt: "2026-09-01T17:45:00.000Z" }, now), false);
});

test("departure countdown covers pending, overdue, early, late, and on-time", () => {
  const base = { attendanceType: "ต้นทาง", estimatedDepartureAt: "2026-09-01T01:00:00.000Z" };
  assert.match(ui.departureCountdown(base, new Date("2026-09-01T00:16:00.000Z")).label, /เหลือ 44 นาที/);
  assert.match(ui.departureCountdown(base, new Date("2026-09-01T01:12:00.000Z")).label, /เกินกำหนด 12 นาที/);
  assert.match(ui.departureCountdown({ ...base, actualDepartureAt: "2026-09-01T00:07:00.000Z" }).label, /ออกก่อนเวลา 53 นาที/);
  assert.match(ui.departureCountdown({ ...base, actualDepartureAt: "2026-09-01T01:08:00.000Z" }).label, /ออกช้า 8 นาที/);
  assert.equal(ui.departureCountdown({ ...base, actualDepartureAt: base.estimatedDepartureAt }).label, "ตรงเวลา");
});

test("drop late arrival shifts only the release countdown", () => {
  const row = {
    attendanceType: "จุดดรอป",
    estimatedArrivalAt: "2026-09-03T14:00:00.000Z", // 21:00 Bangkok
    actualArrivalAt: "2026-09-03T14:45:00.000Z", // 21:45 Bangkok
    estimatedDepartureAt: "2026-09-03T15:00:00.000Z", // 22:00 Bangkok
  };
  const item = ui.departureCountdown(row, new Date("2026-09-03T14:58:00.000Z")); // 21:58 Bangkok
  assert.equal(item.minutes, 47);
  assert.equal(item.adjustedByLateMinutes, 45);
  assert.match(item.label, /เหลือ 47 นาทีถึงกำหนดปล่อย/);
  assert.match(item.label, /เพิ่ม 45 นาทีจากรถเข้าช้า/);
  const onTime = ui.departureCountdown({ ...row, actualArrivalAt: row.estimatedArrivalAt }, new Date("2026-09-03T14:58:00.000Z"));
  assert.equal(onTime.adjustedByLateMinutes, 0);
  assert.equal(onTime.minutes, 2);
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

test("completed unload presentation separates S-E work time from earliest-arrival SLA", () => {
  vm.runInContext(`state.standards={"6W":45}`, context);
  const row = {
    attendanceType: "ปลายทาง",
    vehicleType: "6W",
    actualArrivalAt: "2026-09-09T18:06:00.000Z",
    scheduleTbrArrivalAt: "2026-09-09T16:30:00.000Z",
    unloadingState: 2,
    scheduleUnloadingStartedAt: "2026-09-09T18:06:00.000Z",
    unloadingCompletedAt: "2026-09-09T18:19:00.000Z",
  };
  const operation = ui.renderOperation(row);
  for (const fact of ["ถึงคลังจริง", "เริ่มลงรถ", "ลงเสร็จจริง", "ใช้เวลาลงรถจริง", "มาตรฐาน", "SLA Route", "สรุป", "เกินมาตรฐาน 64 นาที"])
    assert.ok(operation.includes(fact));
  assert.match(operation, /ใช้เวลาลงรถจริง<\/span><strong>13 นาที/);
  assert.match(operation, /SLA Route<\/span><strong>109 นาที/);
  assert.ok(operation.indexOf("ใช้เวลาลงรถจริง") < operation.indexOf("SLA Route"));
  assert.ok(operation.includes(ui.shortDateTime(row.scheduleTbrArrivalAt)));
});

test("completed overtime presentation emphasizes Route SLA excess while S-E remains informational", () => {
  vm.runInContext(`state.standards={"6W":45}`, context);
  const row = {
    attendanceType: "ปลายทาง",
    vehicleType: "6W",
    actualArrivalAt: "2026-09-08T15:56:00.000Z",
    scheduleUnloadingStartedAt: "2026-09-08T18:01:00.000Z",
    unloadingCompletedAt: "2026-09-08T18:47:00.000Z",
    unloadingState: 2,
  };
  const operation = ui.renderOperation(row);
  assert.match(operation, /ใช้เวลาลงรถจริง<\/span><strong>46 นาที/);
  assert.match(operation, /SLA Route<\/span><strong>171 นาที/);
  assert.match(operation, /is-danger[^>]*><span>สรุป<\/span><strong>เกินมาตรฐาน 126 นาที/);
});

test("completed state without trusted E never fabricates Route SLA or work duration", () => {
  vm.runInContext(`state.standards={"6W":45}`, context);
  const operation = ui.renderOperation({
    attendanceType: "ปลายทาง",
    vehicleType: "6W",
    actualArrivalAt: "2026-09-09T18:06:00.000Z",
    scheduleUnloadingStartedAt: "2026-09-09T18:10:00.000Z",
    unloadingState: 2,
  });
  assert.match(operation, /ลงรถเสร็จ รอยืนยันเวลา/);
  assert.match(operation, /ใช้เวลาลงรถจริง<\/span><strong>-/);
  assert.match(operation, /SLA Route<\/span><strong>-/);
  assert.match(operation, /รอเวลาลงเสร็จที่เชื่อถือได้/);
});

test("work type and operation wording stays type-specific end to end", () => {
  assert.equal(ui.attendanceWorkLabel({ attendanceType: "ปลายทาง" }), "ปลายทาง");
  assert.equal(ui.attendanceLabel({ attendanceType: "ปลายทาง" }), "รถเข้าคลัง");
  assert.equal(ui.attendanceWorkLabel({ attendanceType: "ต้นทาง" }), "ต้นทาง");
  assert.equal(ui.attendanceLabel({ attendanceType: "ต้นทาง" }), "รถออกคลัง");
  assert.equal(ui.attendanceWorkLabel({ attendanceType: "จุดดรอป" }), "จุดดรอป");
  assert.equal(ui.attendanceLabel({ attendanceType: "จุดดรอป" }), "ลงของและเดินทางต่อ");
  const origin = ui.renderOperation({ attendanceType: "ต้นทาง", estimatedDepartureAt: "2026-09-09T20:00:00.000Z" });
  assert.match(origin, /กำหนดปล่อยรถ/);
  assert.match(origin, /สถานะการปล่อยรถ/);
  assert.doesNotMatch(origin, /ถึงคลังจริง|เริ่มลงรถ|SLA Route/);
  const drop = ui.renderOperation({ attendanceType: "จุดดรอป", actualArrivalAt: "2026-09-09T18:00:00.000Z", unloadingState: 1, scheduleUnloadingStartedAt: "2026-09-09T18:05:00.000Z" });
  assert.match(drop, /ถึงจุดดรอปจริง/);
  assert.match(drop, /เริ่มลงของ/);
  assert.match(drop, /สถานะไปต่อ/);
  assert.doesNotMatch(drop, /กำหนดปล่อยรถ|SLA Route/);
});

test("Route confirms arrival while main and source-detail displays use accepted truth", () => {
  const row = {
    attendanceType: "ปลายทาง",
    estimatedArrivalAt: "2026-09-01T02:40:00.000Z",
    actualArrivalAt: "2026-09-01T03:00:00.000Z",
    scheduleKitArrivalAt: "2026-09-01T03:00:00.000Z",
    scheduleTbrArrivalAt: "2026-09-01T02:50:00.000Z",
  };
  const effectiveText = ui.shortDateTime(row.scheduleTbrArrivalAt);
  assert.ok(ui.actualCell(row).includes(effectiveText));
  assert.ok(ui.scheduleSection(row, "arrival").includes(effectiveText));
  const sources = ui.arrivalSources(row);
  for (const label of ["KIT", "TBR", "ถึงจริงที่ใช้"])
    assert.ok(sources.includes(`<em>${label}</em>`));
  assert.ok(!sources.includes("<em>Route</em>"));
  assert.ok(sources.includes(ui.arrivalSourceDateTime(row.scheduleKitArrivalAt)));
  assert.ok(sources.includes(ui.arrivalSourceDateTime(row.scheduleTbrArrivalAt)));
  assert.ok(sources.includes(ui.arrivalSourceDateTime(ui.confirmedEffectiveArrival(row))));
  assert.equal(row.actualArrivalAt, "2026-09-01T03:00:00.000Z");
});

test("KIT and TBR cannot display arrival without Route confirmation", () => {
  const row = {
    attendanceType: "ปลายทาง",
    scheduleKitArrivalAt: "2026-09-01T02:50:00.000Z",
    scheduleTbrArrivalAt: "2026-09-01T02:48:00.000Z",
  };
  assert.match(ui.actualCell(row), /ยังไม่มีเวลาจริง/);
  assert.match(ui.scheduleSection(row, "arrival"), /ถึงจริง<\/b><strong>-<\/strong>/);
  assert.match(ui.arrivalSources(row), /<em>ถึงจริงที่ใช้<\/em><strong class="arrival-source-value">-<\/strong>/);
  assert.equal(ui.routeState(row).key, "not-arrived");
});

test("transient lightweight zero stays indeterminate until detail hydration", () => {
  vm.runInContext(`state.completedToday=0;completedTodayHydratedKey="";`, context);
  assert.equal(ui.completedTodayDatasetReady(), false);
  vm.runInContext(`completedTodayHydratedKey=completedTodayDatasetKey();`, context);
  assert.equal(ui.completedTodayDatasetReady(), true);
});

test("departure display ignores KIT and TBR", () => {
  const row = {
    attendanceType: "ต้นทาง",
    actualDepartureAt: "2026-09-01T04:00:00.000Z",
    scheduleKitArrivalAt: "2026-09-01T02:50:00.000Z",
    scheduleTbrArrivalAt: "2026-09-01T02:48:00.000Z",
  };
  const departureText = ui.shortDateTime(row.actualDepartureAt);
  assert.ok(ui.actualCell(row).includes(departureText));
  assert.ok(ui.scheduleSection(row, "departure").includes(departureText));
});

test("export shows effective arrival while preserving Route, KIT, and TBR columns", () => {
  vm.runInContext(`state.standards={"6W":45}`, context);
  const row = {
    attendanceType: "ปลายทาง",
    vehicleType: "6W",
    actualArrivalAt: "2026-09-01T03:00:00.000Z",
    scheduleKitArrivalAt: "2026-09-01T03:00:00.000Z",
    scheduleTbrArrivalAt: "2026-09-01T02:50:00.000Z",
    unloadingCompletedAt: "2026-09-01T03:18:00.000Z",
    unloadingState: 2,
  };
  const exported = ui.exportRow(row);
  assert.equal(exported.actualArrivalAt, ui.exportThaiDate(row.scheduleTbrArrivalAt));
  assert.equal(exported.routeActualArrivalAt, ui.exportThaiDate(row.actualArrivalAt));
  assert.equal(exported.scheduleKitArrivalAt, ui.exportThaiDate(row.scheduleKitArrivalAt));
  assert.equal(exported.scheduleTbrArrivalAt, ui.exportThaiDate(row.scheduleTbrArrivalAt));
  assert.equal(exported.operationMinutes, 28);
});

test("warehouse page is removed from navigation and redirects without polling script", async () => {
  for (const file of ["ms.html", "waiting.html", "ms-report.html"])
    assert.doesNotMatch(await readFile(new URL(file, root), "utf8"), /warehouse\.html/);
  assert.match(await readFile(new URL("warehouse.html", root), "utf8"), /location\.replace\("ms\.html"\)/);
  assert.match(await readFile(new URL("scan.html", root), "utf8"), /location\.replace\("ms\.html"\)/);
});

test("realtime settings and D1 read safeguards remain intact", async () => {
  assert.match(source, /pollMs:\s*4000/);
  // cancel button remains origin-only: destination and drop never expose it.
  assert.doesNotMatch(source, /q\.active && !isDestination\(row\)/);
  assert.match(source, /q\.active && isOrigin\(row\)/);
  const cron = await readFile(new URL("cloudflare-browser-test/wrangler.jsonc", root), "utf8");
  assert.match(cron, /"\* \* \* \* \*"/);
  const worker = await readFile(new URL("worker/src/index.js", root), "utf8");
  assert.match(worker, /ms_live_cache/);
  assert.match(worker, /Array\.isArray\(live\.rows\)/);
  assert.match(worker, /COUNT\(\*\) AS total_distinct FROM ms_route_registry/);
  assert.match(source, /ARCHIVE_LOAD_DELAY_MS\s*=\s*1500/);
  assert.match(source, /async function ensureArchiveLoaded/);
  assert.doesNotMatch(source, /if \(!silent && !state\.archiveLoaded\) scheduleArchiveLoad\(\)/);
  assert.match(source, /DEV: archive stays lazy; live polling must never auto-read msArchive/);
  assert.match(source, /state\.rows = mergeLatest\(state\.archiveRows, state\.currentRows\)/);
  assert.doesNotMatch(source, /!silent \|\| !state\.archiveLoaded/);
  const historyIndex = await readFile(new URL("worker/migrations/0007_ms_history_read_index.sql", root), "utf8");
  assert.match(historyIndex, /ms_route_history\(hub, snapshot_at DESC\)/);
  const preflight = await readFile(new URL("worker/scripts/production-preflight.sql", root), "utf8");
  assert.doesNotMatch(preflight, /COUNT\(DISTINCT route_id\)/);
  assert.doesNotMatch(preflight, /COUNT\(\*\) AS row_count FROM ms_route_history/);
});
