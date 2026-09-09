import { readFile, writeFile } from "node:fs/promises";

function replaceOne(text, from, to, label) {
  const first = text.indexOf(from);
  const last = text.lastIndexOf(from);
  if (first < 0 || first !== last) throw new Error(`patch failed: ${label}`);
  return text.replace(from, to);
}

const root = new URL("../../", import.meta.url);
const frontUrl = new URL("ms.js", root);
let front = await readFile(frontUrl, "utf8");

if (!front.includes("MS_LOWER_COMPLETED_MATCH_UPPER_DAY_V1")) {
  front = replaceOne(
    front,
    `function unloadTiming(row, now = new Date()) {
  const start = parseDate(row.scheduleUnloadingStartedAt);
  const completed = Number(row.unloadingState) === 2;
  const finish = completed ? parseDate(row.unloadingCompletedAt) : null;`,
    `// MS_LOWER_COMPLETED_MATCH_UPPER_DAY_V1: Lower completed follows the same
// accepted current-day state-2 truth as the frozen upper completed metric. A safely
// matched Schedule E remains the preferred finish timestamp for SLA presentation.
function trustedLowerCompletionAt(row) {
  if (Number(row.unloadingState) !== 2) return null;
  const schedule = parseDate(row.scheduleUnloadingCompletedAt);
  if (schedule) return schedule;
  const recorded = parseDate(row.unloadingCompletedAt);
  if (!recorded) return null;
  if (row.completionObservedLive === false && row.completionSource !== "SCHEDULE")
    return null;
  return recorded;
}

function unloadTiming(row, now = new Date()) {
  const start = parseDate(row.scheduleUnloadingStartedAt);
  const completed = Number(row.unloadingState) === 2;
  const finish = completed ? trustedLowerCompletionAt(row) : null;`,
    "trusted lower completion helper",
  );

  front = replaceOne(
    front,
    `function isCompletedToday(row, now = new Date()) {
  if (row.queueCancelledAt) return false;
  if ((!isDestination(row) && !isDrop(row)) || Number(row.unloadingState) !== 2)
    return false;
  if (!row.unloadingCompletedAt) return false;
  // MS_DAILY_COMPLETION_TRUSTED_SCHEDULE_V1: safely matched Schedule E is accepted completion truth too.
  if (row.completionObservedLive === false && row.completionSource !== "SCHEDULE") return false;
  return bangkokDateValue(row.unloadingCompletedAt) === bangkokDateValue(now);
}`,
    `function isCompletedToday(row, now = new Date()) {
  if (row.queueCancelledAt) return false;
  if ((!isDestination(row) && !isDrop(row)) || Number(row.unloadingState) !== 2)
    return false;
  // Match the frozen upper completed metric's accepted daily scope. Completion
  // timestamp provenance is still used for SLA timing, never to hide a real state-2 row.
  return rowBusinessDay(row) === bangkokDateValue(now);
}`,
    "lower completed day predicate",
  );

  front = replaceOne(
    front,
    `    completed: completedTodayDatasetReady()
      ? completedTodayDatasetRows().length
      : Number(state.completedToday) || 0,`,
    `    completed: completedTodayDatasetRows().length,`,
    "lower completed count source",
  );

  front = replaceOne(
    front,
    `  const completedDisplay = completedTodayDatasetReady()
    ? nf.format(counts.completed)
    : "…";
  const overtimeDisplay = completedTodayDatasetReady()
    ? nf.format(completedTodayOvertimeRows().length)
    : "…";`,
    `  // Lower summary cards are always numeric: a real zero is shown as 0,
  // never as an indeterminate ellipsis.
  const completedDisplay = nf.format(counts.completed);
  const overtimeDisplay = nf.format(completedTodayOvertimeRows().length);`,
    "numeric lower card display",
  );
}

await writeFile(frontUrl, front);

const testUrl = new URL(".github/dev-tools/ms-unload-completion-ui.test.mjs", root);
let tests = await readFile(testUrl, "utf8");
tests = tests.replace(
  `const src=between(front,"function unloadTiming","function isCompletedUnloadOverStandard");`,
  `const src=between(front,"function trustedLowerCompletionAt","function isCompletedUnloadOverStandard");`,
);

if (!tests.includes("lower completed uses the frozen upper current-day truth and never renders ellipsis")) {
  const marker = "// OWNER_CLASSIC_LOWER_DEPLOY_GATE_V14";
  if (!tests.includes(marker)) throw new Error("test marker missing");
  const extra = `test("lower completed uses the frozen upper current-day truth and never renders ellipsis",()=>{const daily=between(front,"function isCompletedToday(row, now = new Date())","function isCompletedAccumulated(row)");assert.match(daily,/rowBusinessDay\\(row\\) === bangkokDateValue\\(now\\)/);assert.doesNotMatch(daily,/if \\(!row\\.unloadingCompletedAt\\) return false/);const summary=between(front,"function renderFilterSummary(rows)","async function applyMetricFilter");assert.match(summary,/completed: completedTodayDatasetRows\\(\\)\\.length/);assert.match(summary,/const completedDisplay = nf\\.format\\(counts\\.completed\\)/);assert.match(summary,/const overtimeDisplay = nf\\.format\\(completedTodayOvertimeRows\\(\\)\\.length\\)/);assert.doesNotMatch(summary,/…/)});\n` +
    `test("trusted Schedule E supplies completed SLA finish only after Route is state 2",()=>{const fn=loadTiming();const done=fn({unloadingState:2,actualArrivalAt:"2026-09-09T01:00:00Z",scheduleTbrArrivalAt:"2026-09-09T00:50:00Z",scheduleUnloadingStartedAt:"2026-09-09T01:10:00Z",scheduleUnloadingCompletedAt:"2026-09-09T01:40:00Z",unloadingCompletedAt:""},new Date("2026-09-09T02:00:00Z"));assert.equal(done.slaMinutes,50);assert.equal(done.workMinutes,30);const active=fn({unloadingState:1,actualArrivalAt:"2026-09-09T01:00:00Z",scheduleUnloadingStartedAt:"2026-09-09T01:10:00Z",scheduleUnloadingCompletedAt:"2026-09-09T01:40:00Z"},new Date("2026-09-09T02:00:00Z"));assert.equal(active.workMinutes,50);assert.equal(active.overStandard,false)});\n`;
  tests = tests.replace(marker, extra + marker);
}

await writeFile(testUrl, tests);
console.log("LOWER_COMPLETED_CURRENT_DAY_V1=PATCHED");
