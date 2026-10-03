import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { stageFrontend } from "./stage-dev-runtime.mjs";

const root = new URL("../../", import.meta.url);
const canonical = readFileSync(new URL("ms.js", root), "utf8");
const staged = stageFrontend(canonical);
const html = readFileSync(new URL("ms.html", root), "utf8");
const css = readFileSync(new URL("ms-v4.css", root), "utf8");
const worker = readFileSync(new URL("worker/src/index.js", root), "utf8");

function between(source, begin, end) {
  const start = source.indexOf(begin), finish = source.indexOf(end, start + begin.length);
  assert.ok(start >= 0 && finish > start, `missing ${begin}`);
  return source.slice(start, finish);
}

function runtime() {
  const source = [
    between(staged, "function adjustedDropDeparturePlan(row)", "function departureCountdownHtml(row)"),
    between(staged, "function normalizeVehicle(value)", "// MS_COMPLETION_TIME_TRUTH_UI_V2"),
    between(staged, "// MS_CENTRAL_NEAR_EXPIRY_V1", "// MS_LOWER_COMPLETED_MATCH_UPPER_DAY_V1"),
    between(staged, "function trustedLowerCompletionAt(row)", "function isCompletedUnloadOverStandard(row)"),
    between(staged, "function unloadSlaSummary(timing)", "function unloadRemainingMinutes(row"),
    between(staged, "function classicOperationRow(", "// LOCAL_ROUTE_BARCODE_V1"),
  ].join("\n");
  const parseDate = (value) => value ? new Date(value) : null;
  const context = {
    Date, Math, Object, Number, String,
    nf: new Intl.NumberFormat("en-US"), esc: (value) => String(value ?? ""),
    parseDate, state: { standards: { "4W": 999, "4WJ": 999, "6W": 999,
      "10W": 999, "14W": 999, "18W": 999, "22W": 999 } },
    isOrigin: (row) => row.attendanceType === "ต้นทาง",
    isDestination: (row) => row.attendanceType === "ปลายทาง",
    isDrop: (row) => row.attendanceType === "จุดดรอป",
    queueInfo: () => ({ cancelled: false }),
    queueAdmissionSource: () => "KIT", queueAdmissionArrival: (row) => parseDate(row.actualArrivalAt),
    confirmedEffectiveArrival: (row) => parseDate(row.actualArrivalAt),
    dropOperation: (row) => ({ onwardDone: Boolean(row.actualDepartureAt),
      unloadingDone: row.unloadingState === 2, onwardMinutes: null, onwardLabel: "รอไปต่อ" }),
    shortDateTime: () => "-",
  };
  return runInNewContext(source + `\n({ centralVehicleStandard,
    adjustedDropDeparturePlan, departureCountdown,
    unloadStandard, unloadTiming, unloadSlaSummary, renderOperation })`, context);
}

const standards = [["4W", 20, 4], ["4WJ", 30, 6], ["6W", 60, 12],
  ["10W", 60, 12], ["14W", 120, 24], ["18W", 180, 36], ["22W", 180, 36]];

test("all CENTRAL standards and 20% boundaries isolate conflicting HUB settings", () => {
  const r = runtime();
  assert.match(worker, /CENTRAL:\s*\[20, 30, 60, 60, 120, 180, 180\]/);
  for (const [type, standard, band] of standards) {
    assert.equal(r.centralVehicleStandard(type), standard);
    assert.equal(r.unloadStandard({ vehicleType: type }), standard);
    for (const [remaining, severity] of [[band + 1, "safe"], [band, "warning"],
      [1, "warning"], [0, "warning"], [-1, "danger"]]) {
      const unload = r.unloadSlaSummary({ arrival: true, completed: false,
        standard, slaMinutes: standard - remaining });
      assert.equal(unload.severity, severity, `${type} ${remaining}`);
    }
  }
});

test("origin uses existing deadline and actual departure truth on both UI render paths", () => {
  const r = runtime(), plan = "2026-10-01T10:00:00Z";
  const origin = { attendanceType: "ต้นทาง", vehicleType: "4W", estimatedDepartureAt: plan };
  for (const [minutes, expected] of [[5, "pending"], [4, "pending"], [1, "pending"], [0, "pending"], [-1, "late"]]) {
    const now = new Date(Date.parse(plan) - minutes * 60_000);
    const countdown = r.departureCountdown(origin, now);
    assert.equal(countdown.key, expected);
  }
  assert.equal(r.departureCountdown({ ...origin, actualDepartureAt: "2026-10-01T09:55:00Z" }).key, "ontime");
  assert.equal(r.departureCountdown({ ...origin, actualDepartureAt: "2026-10-01T10:01:00Z" }).key, "late");
  assert.match(r.renderOperation({ ...origin, actualDepartureAt: "2026-10-01T09:55:00Z" }), /is-safe/);
  assert.match(r.renderOperation({ ...origin, actualDepartureAt: "2026-10-01T10:01:00Z" }), /is-danger/);
  assert.match(r.renderOperation({ ...origin, estimatedDepartureAt: null }), /is-neutral/);
  for (const minutes of [5, 4, 1]) {
    const pending = r.renderOperation({ ...origin,
      estimatedDepartureAt: new Date(Date.now() + minutes * 60_000).toISOString() });
    assert.match(pending, /classic-operation-summary compact-summary is-safe/);
    assert.doesNotMatch(pending, /is-warning/);
  }
});

test("Destination and Drop unload preserve trusted arrival and completion, with central warning", () => {
  const r = runtime();
  const arrival = "2026-10-01T09:00:00Z";
  for (const attendanceType of ["ปลายทาง", "จุดดรอป"]) {
    const row = { attendanceType, vehicleType: "4W", unloadingState: 1, actualArrivalAt: arrival };
    const timing = r.unloadTiming(row, new Date("2026-10-01T09:16:00Z"));
    assert.equal(timing.standard, 20);
    assert.equal(r.unloadSlaSummary(timing).severity, "warning");
    assert.match(r.renderOperation({ ...row, actualDepartureAt: null }), /classic-operation-summary/);
    assert.equal(r.unloadSlaSummary(r.unloadTiming({ ...row, unloadingState: 2,
      scheduleUnloadingCompletedAt: "2026-10-01T09:19:00Z" })).severity, "safe");
    assert.equal(r.unloadSlaSummary(r.unloadTiming({ ...row, unloadingState: 2,
      scheduleUnloadingCompletedAt: "2026-10-01T09:21:00Z" })).severity, "danger");
    assert.equal(r.unloadSlaSummary(r.unloadTiming({ ...row, actualArrivalAt: null })).severity, "neutral");
  }
});

test("Drop release compares to adjusted late-arrival plan without an unload warning band", () => {
  const r = runtime(), row = { attendanceType: "จุดดรอป", vehicleType: "4W",
    estimatedArrivalAt: "2026-10-01T09:00:00Z",
    actualArrivalAt: "2026-10-01T09:10:00Z",
    estimatedDepartureAt: "2026-10-01T10:00:00Z" };
  assert.equal(r.adjustedDropDeparturePlan(row).plan.toISOString(), "2026-10-01T10:10:00.000Z");
  for (const minute of ["10:05", "10:06"]) {
    assert.equal(r.departureCountdown(row,
      new Date(`2026-10-01T${minute}:00Z`)).key, "pending");
  }
  assert.equal(r.departureCountdown(row,
    new Date("2026-10-01T10:11:00Z")).key, "late");
  assert.equal(r.departureCountdown({ ...row, actualDepartureAt: "2026-10-01T10:08:00Z" }).key, "ontime");
  const drop = { attendanceType: "จุดดรอป", vehicleType: "4W",
    estimatedDepartureAt: new Date(Date.now() + 60_000).toISOString() };
  const pending = r.renderOperation(drop);
  assert.match(pending, /classic-operation-summary compact-summary is-drop"><span>สถานะไปต่อ \/ ปล่อยรถ/);
  assert.doesNotMatch(pending, /is-warning/);
  assert.match(r.renderOperation({ ...drop, estimatedDepartureAt: new Date(Date.now() - 120_000).toISOString() }),
    /classic-operation-summary compact-summary is-danger"><span>สถานะไปต่อ \/ ปล่อยรถ/);
  assert.match(r.renderOperation({ ...drop, actualDepartureAt: new Date().toISOString() }),
    /classic-operation-summary compact-summary is-safe"><span>สถานะไปต่อ \/ ปล่อยรถ/);
});

test("unknown vehicle and missing plan fail closed; CSS reused on desktop/mobile with fresh asset URL", () => {
  const r = runtime();
  assert.equal(r.centralVehicleStandard("UNSUPPORTED"), null);
  assert.equal(r.unloadStandard({ vehicleType: "UNSUPPORTED" }), null);
  assert.equal(r.departureCountdown({ attendanceType: "ต้นทาง", vehicleType: "4W" }), null);
  assert.equal(r.unloadSlaSummary({ arrival: true, completed: false,
    standard: null, slaMinutes: null }).severity, "neutral");
  assert.match(r.renderOperation({ attendanceType: "ต้นทาง", vehicleType: "UNSUPPORTED",
    estimatedDepartureAt: new Date(Date.now() + 60_000).toISOString() }), /is-safe/);
  assert.match(css, /MS_EXISTING_UNLOAD_WARNING_ORANGE_V1[\s\S]*?\.classic-operation-summary\.is-warning\s*\{[^}]*background:\s*#fff0d6/i);
  assert.match(html, /ms-v4\.css\?v=20261001-01/);
  assert.doesNotMatch(canonical, /MS_CENTRAL_NEAR_EXPIRY_V1/);
  assert.equal((staged.match(/MS_CENTRAL_NEAR_EXPIRY_V1/g) || []).length, 1);
  assert.equal(stageFrontend(staged), staged);
});

test("only unload summaries emit warning on responsive layouts", () => {
  const r = runtime(), now = Date.now();
  const origin = { attendanceType: "ต้นทาง", vehicleType: "4W",
    estimatedDepartureAt: new Date(now + 3 * 60_000).toISOString() };
  const drop = { attendanceType: "จุดดรอป", vehicleType: "4W", unloadingState: 1,
    estimatedDepartureAt: new Date(now + 3 * 60_000).toISOString(),
    actualArrivalAt: new Date(now - 16 * 60_000).toISOString() };
  const destination = { ...drop, attendanceType: "ปลายทาง" };
  assert.doesNotMatch(r.renderOperation(origin), /is-warning/);
  assert.match(r.renderOperation(origin), /classic-operation-summary compact-summary is-safe/);
  assert.match(r.renderOperation(drop), /classic-operation-summary compact-summary is-warning"><span>SLA ลงของ/);
  assert.match(r.renderOperation(drop), /classic-operation-summary compact-summary is-drop"><span>สถานะไปต่อ \/ ปล่อยรถ/);
  assert.equal((r.renderOperation(drop).match(/is-warning/g) || []).length, 1);
  assert.match(r.renderOperation(destination), /classic-operation-summary compact-summary is-warning/);
  // The responsive layout changes dimensions, not severity classes; both
  // operation representations reuse this same warning selector.
  assert.match(css, /@media[\s\S]*?\.ms-page \.classic-operation-summary\.compact-summary/);
  assert.match(css, /html body\.ms-page \.operation-compact \.classic-operation-summary\.is-warning/);
});
