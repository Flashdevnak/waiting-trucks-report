import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const [source, style, sw] = await Promise.all([
  readFile(new URL("ms.js", root), "utf8"),
  readFile(new URL("style.css", root), "utf8"),
  readFile(new URL("sw.js", root), "utf8"),
]);

function between(text, start, end) {
  const a = text.indexOf(start);
  assert.notEqual(a, -1, `missing ${start}`);
  const b = text.indexOf(end, a + start.length);
  assert.notEqual(b, -1, `missing ${end}`);
  return text.slice(a, b);
}

function loadTiming() {
  const timingSource = between(source, "function unloadTiming", "function isCompletedUnloadOverStandard");
  const context = {
    Date,
    state: { standards: { "6W": 45 } },
    parseDate(value) {
      if (!value) return null;
      const date = value instanceof Date ? value : new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    },
    normalizeVehicle() { return "6W"; },
    unloadStandard() { return 45; },
    isDestination() { return true; },
  };
  vm.createContext(context);
  vm.runInContext(`${timingSource};globalThis.result=unloadTiming;`, context);
  return context.result;
}

test("waiting destination keeps live elapsed minutes from Route actualArrivalAt", () => {
  const unloadTiming = loadTiming();
  const timing = unloadTiming({
    unloadingState: 0,
    actualArrivalAt: "2026-09-08T23:24:00.000Z",
    scheduleKitArrivalAt: "2026-09-08T23:25:00.000Z",
    scheduleTbrArrivalAt: "2026-09-08T23:20:00.000Z",
  }, new Date("2026-09-08T23:33:00.000Z"));
  assert.equal(timing.slaMinutes, 9);
  assert.equal(timing.standard, 45);
  assert.equal(timing.overStandard, false);
});

test("active keeps counting while completed without trusted E stays unknown", () => {
  const unloadTiming = loadTiming();
  const now = new Date("2026-09-08T23:40:00.000Z");
  assert.equal(unloadTiming({ unloadingState: 1, actualArrivalAt: "2026-09-08T23:24:00.000Z" }, now).slaMinutes, 16);
  assert.equal(unloadTiming({ unloadingState: 2, actualArrivalAt: "2026-09-08T23:24:00.000Z" }, now).slaMinutes, null);
});

test("KIT or TBR alone can never start the operational waiting clock", () => {
  const unloadTiming = loadTiming();
  const timing = unloadTiming({
    unloadingState: 0,
    actualArrivalAt: null,
    scheduleKitArrivalAt: "2026-09-08T23:25:00.000Z",
    scheduleTbrArrivalAt: "2026-09-08T23:24:00.000Z",
  }, new Date("2026-09-08T23:40:00.000Z"));
  assert.equal(timing.slaMinutes, null);
});

test("owner reference V7 is integrated, blue for drop, and responsive", () => {
  const visual = style.split("MS_LOWER_REFERENCE_V7")[1] || "";
  assert.ok(visual);
  assert.match(visual, /#filter-summary/);
  assert.match(visual, /schedule-stack\.single/);
  assert.match(visual, /drop-operation[^}]*--op-accent:#1683d2/);
  assert.match(visual, /@media \(max-width:1024px\)/);
  assert.match(visual, /@media\(max-width:430px\)/);
  assert.doesNotMatch(visual, /\.metric-card|\.ms-metrics/);
});

test("service worker only refreshes assets and adds no visual/runtime patch", () => {
  assert.match(sw, /20260909-03-lower-reference/);
  assert.match(sw, /cache: "no-store"/);
  assert.doesNotMatch(sw, /MS_JS_HOTFIX|MS_CSS_HOTFIX|String\.raw|appendPatch/);
  assert.doesNotMatch(sw, /apiGet\(|apiPost\(|syncMs\(|completeMsPairing\(|cancelMsRoute\(|archive\(/i);
});
