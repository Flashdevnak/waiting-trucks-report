import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const sw = await readFile(new URL("sw.js", root), "utf8");

function between(text, start, end) {
  const a = text.indexOf(start);
  assert.notEqual(a, -1, `missing ${start}`);
  const b = text.indexOf(end, a + start.length);
  assert.notEqual(b, -1, `missing ${end}`);
  return text.slice(a + start.length, b);
}

const jsPatch = between(
  sw,
  "const MS_JS_HOTFIX = String.raw`",
  "`;\n\nconst MS_CSS_HOTFIX",
);
const cssPatch = between(
  sw,
  "const MS_CSS_HOTFIX = String.raw`",
  "`;\n\nfunction appendPatch",
);

function loadTimingPatch() {
  const context = {
    Date,
    console,
    parseDate(value) {
      if (!value) return null;
      const date = value instanceof Date ? value : new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    },
    window: {
      unloadTiming(row) {
        return {
          arrival: null,
          start: null,
          finish: null,
          completed: Number(row?.unloadingState) === 2,
          workMinutes: null,
          slaMinutes: null,
          standard: 45,
          overStandard: false,
        };
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(jsPatch, context);
  return context;
}

test("waiting destination keeps live elapsed minutes from Route actualArrivalAt", () => {
  const context = loadTimingPatch();
  const now = new Date("2026-09-08T23:33:00.000Z");
  const row = {
    unloadingState: 0,
    actualArrivalAt: "2026-09-08T23:24:00.000Z",
    scheduleKitArrivalAt: "2026-09-08T23:25:00.000Z",
    scheduleTbrArrivalAt: "2026-09-08T23:24:00.000Z",
  };
  const timing = context.window.unloadTiming(row, now);
  assert.equal(timing.slaMinutes, 9);
  assert.equal(timing.standard, 45);
  assert.equal(timing.overStandard, false);
});

test("active destination keeps counting but completed rows never fabricate completion time", () => {
  const context = loadTimingPatch();
  const now = new Date("2026-09-08T23:40:00.000Z");
  const active = context.window.unloadTiming(
    { unloadingState: 1, actualArrivalAt: "2026-09-08T23:24:00.000Z" },
    now,
  );
  assert.equal(active.slaMinutes, 16);

  const completedUnknown = context.window.unloadTiming(
    { unloadingState: 2, actualArrivalAt: "2026-09-08T23:24:00.000Z" },
    now,
  );
  assert.equal(completedUnknown.slaMinutes, null);
});

test("KIT or TBR alone can never start the operational waiting clock", () => {
  const context = loadTimingPatch();
  const timing = context.window.unloadTiming(
    {
      unloadingState: 0,
      actualArrivalAt: null,
      scheduleKitArrivalAt: "2026-09-08T23:25:00.000Z",
      scheduleTbrArrivalAt: "2026-09-08T23:24:00.000Z",
    },
    new Date("2026-09-08T23:40:00.000Z"),
  );
  assert.equal(timing.slaMinutes, null);
});

test("owner visual V8 is lower-section scoped and restores reference-style mobile hierarchy", () => {
  assert.match(sw, /MS_OWNER_VISUAL_V8/);
  assert.match(cssPatch, /#filter-summary/);
  assert.match(cssPatch, /schedule-stack\.single/);
  assert.match(cssPatch, /arrival-system-row>div\{display:grid!important;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)!important/);
  assert.match(cssPatch, /operation-kpi>strong\{font-size:34px/);
  assert.match(cssPatch, /operation-timeline\.stages-2\{display:grid;grid-template-columns:minmax\(0,1fr\) 46px minmax\(0,1fr\)/);
  assert.match(cssPatch, /@media \(max-width:700px\)/);
  assert.doesNotMatch(cssPatch, /\.metric-card|\.ms-metrics/);
});

test("hotfix adds no API polling, timers, database writes, or MS mutation", () => {
  assert.doesNotMatch(jsPatch, /fetch\(|setInterval|setTimeout|requestAnimationFrame|apiGet|apiPost|syncMs|complete|cancel/i);
  assert.match(sw, /url\.pathname\.endsWith\("\/ms\.js"\)/);
  assert.match(sw, /url\.pathname\.endsWith\("\/style\.css"\)/);
});
