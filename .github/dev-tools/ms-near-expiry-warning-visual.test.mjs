import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const root = new URL("../../", import.meta.url);
const front = readFileSync(new URL("ms.js", root), "utf8");
const css = readFileSync(new URL("ms-v4.css", root), "utf8");
const html = readFileSync(new URL("ms.html", root), "utf8");
const warningMarker = "MS_EXISTING_UNLOAD_WARNING_ORANGE_V1";
const warningCss = css.slice(css.indexOf(warningMarker));

function operationFunctions() {
  const start = front.indexOf("function classicOperationRow(");
  const end = front.indexOf("// LOCAL_ROUTE_BARCODE_V1", start);
  assert.ok(start >= 0 && end > start);
  return runInNewContext(front.slice(start, end) + "\n({ renderOperation, unloadSlaSummary })", {
    nf: new Intl.NumberFormat("en-US"),
    esc: (value) => String(value ?? ""),
    queueInfo: () => ({ cancelled: false }),
    isDestination: (row) => row.attendanceType === "ปลายทาง",
    isDrop: (row) => row.attendanceType === "จุดดรอป",
    unloadTiming: (row) => row.timing,
    dropOperation: (row) => ({
      onwardDone: row.onwardDone === true, unloadingDone: false,
      onwardMinutes: null, onwardLabel: "รอไปต่อ",
    }),
    departureCountdown: (row) => row.release ?? null,
    parseDate: (value) => value ? new Date(value) : null,
    confirmedEffectiveArrival: () => null,
    shortDateTime: () => "-",
  });
}

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = warningCss.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`, "m"));
  assert.ok(match, `missing warning-only rule: ${selector}`);
  return match[1];
}

function specificity(selector) {
  return [
    (selector.match(/#[\w-]+/g) || []).length,
    (selector.match(/\.[\w-]+/g) || []).length,
    (selector.match(/\b(?:html|body|span|strong)\b/g) || []).length,
  ];
}

function stronger(override, base) {
  const a = specificity(override), b = specificity(base);
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

const summary = "html body.ms-page .operation-compact .classic-operation-summary.is-warning";

test("existing vehicle-relative Destination and Drop unload warning receives readable light orange", () => {
  const { renderOperation, unloadSlaSummary } = operationFunctions();
  for (const [standard, used] of [[45, 37], [120, 97]]) {
    const timing = { arrival: true, completed: false, standard, slaMinutes: used };
    assert.equal(unloadSlaSummary(timing).severity, "warning");
    for (const attendanceType of ["ปลายทาง", "จุดดรอป"]) {
      assert.match(renderOperation({ attendanceType, unloadingState: 1, timing }),
        /class="classic-operation-summary compact-summary is-warning"/);
    }
  }
  assert.match(rule(summary), /background:\s*#fff0d6\s*!important/);
  assert.match(rule(summary), /border-color:\s*#dda353\s*!important/);
  assert.match(rule(summary + " > span"), /background:\s*#fff2df\s*!important/);
  assert.match(rule(summary + " > strong"), /background:\s*#ffe8c2\s*!important/);
  assert.match(rule(summary + " > strong"), /color:\s*#713a00\s*!important/);
});

test("warning specificity beats both later white summary rules and the desktop inline style", () => {
  assert.equal((css.match(new RegExp(warningMarker, "g")) || []).length, 1);
  assert.ok(css.lastIndexOf(warningMarker) > css.lastIndexOf("background: #ffffff !important"));
  assert.match(html, /<style id="ms-route-status-v7">/);
  assert.match(html, /\.ms-page \.operation-compact \.classic-operation-summary\.compact-summary,[\s\S]*?background: #ffffff !important/);
  assert.ok(stronger(summary, ".ms-page .operation-compact .classic-operation-summary.compact-summary"));
  assert.ok(stronger(summary, "html body.ms-page .operation-compact .classic-operation-summary"));
  for (const child of ["span", "strong"]) {
    const warningChild = summary + " > " + child;
    assert.ok(stronger(warningChild, ".ms-page .operation-compact .classic-operation-summary > " + child));
    assert.ok(stronger(warningChild, "html body.ms-page .operation-compact .classic-operation-summary > " + child));
  }
  assert.doesNotMatch(warningCss, /\.is-danger|\.is-safe|\.is-drop|\.origin|\.is-done/);
});

test("neutral, overdue, completed, Origin and Drop release retain existing severity", () => {
  const { renderOperation, unloadSlaSummary } = operationFunctions();
  const timing = (slaMinutes, completed = false) => ({
    arrival: true, standard: 100, slaMinutes, completed,
  });
  assert.equal(unloadSlaSummary(timing(null)).severity, "neutral");
  assert.equal(unloadSlaSummary(timing(79)).severity, "safe");
  assert.equal(unloadSlaSummary(timing(101)).severity, "danger");
  assert.equal(unloadSlaSummary(timing(90, true)).severity, "safe");
  assert.match(renderOperation({ attendanceType: "ปลายทาง", unloadingState: 2, timing: timing(90, true) }),
    /class="classic-operation-summary compact-summary is-safe"/);
  assert.match(renderOperation({ attendanceType: "ปลายทาง", unloadingState: 1, timing: timing(101) }),
    /class="classic-operation-summary compact-summary is-danger"/);
  for (const key of ["pending", "late", "ontime"]) {
    const origin = renderOperation({ attendanceType: "ต้นทาง", release: { key, label: key } });
    assert.doesNotMatch(origin, /is-warning/);
    assert.match(origin, new RegExp(`is-${key === "late" ? "danger" : "safe"}`));
    const drop = renderOperation({ attendanceType: "จุดดรอป", timing: timing(79), release: { key, label: key } });
    assert.doesNotMatch(drop, /is-warning/);
    assert.match(drop, new RegExp(`is-${key === "late" ? "danger" : "drop"}`));
  }
  assert.match(css, /classic-operation-summary\.is-danger > strong \{ color: #b3261e !important; background: #fdecef !important/);
  assert.match(css, /classic-operation-summary\.is-safe > strong \{ color: #126b32 !important; background: #eef8f0 !important/);
});

test("existing timing contract and shared desktop/mobile renderer are unchanged", () => {
  const unload = front.slice(front.indexOf("function unloadSlaSummary("), front.indexOf("function unloadRemainingMinutes("));
  assert.match(unload, /warningBand = Math\.max\(1, Math\.ceil\(timing\.standard \* 0\.2\)\)/);
  assert.match(unload, /remaining <= warningBand \? "warning" : "safe"/);
  const departure = front.slice(front.indexOf("function departureCountdown("), front.indexOf("function departureCountdownHtml("));
  assert.doesNotMatch(departure, /warning|near.expiry|60\s*\*/i);
  assert.match(departure, /key: diff < 0 \? "late" : "pending"/);
  const table = front.slice(front.indexOf("function tableRow("), front.indexOf("function card("));
  const mobile = front.slice(front.indexOf("function card("), front.indexOf("let cancelRouteTarget"));
  assert.match(table, /renderOperation\(row\)/);
  assert.match(mobile, /renderOperation\(row\)/);
  assert.doesNotMatch(warningCss, /@media|minutes|standard|threshold|\.operation-compact\s*\{/i);
});
