import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { stageFrontend } from "./stage-dev-runtime.mjs";

const root = new URL("../../", import.meta.url);
const source = await readFile(new URL("ms.js", root), "utf8");
const staged = stageFrontend(source);

function between(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing staged block ${start}`);
  return text.slice(from, to);
}

function loadInboundOperationalStage() {
  const code = between(
    staged,
    "function inboundOperationalStage",
    "function renderFilterSummary",
  );
  const parseDate = (value) => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const isDestination = (row) => row.attendanceType === "ปลายทาง";
  const isDrop = (row) => row.attendanceType === "จุดดรอป";
  const queueAdmissionArrival = (row) => {
    if (!isDestination(row) && !isDrop(row)) return parseDate(row.actualArrivalAt);
    return [row.actualArrivalAt, row.scheduleTbrArrivalAt]
      .map(parseDate)
      .filter(Boolean)
      .sort((a, b) => a - b)[0] || null;
  };
  const context = {
    Date,
    parseDate,
    isDestination,
    isDrop,
    queueAdmissionArrival,
    queueInfo(row) {
      return { cancelled: Boolean(row.queueCancelledAt) };
    },
  };
  vm.createContext(context);
  vm.runInContext(`${code};globalThis.fn=inboundOperationalStage`, context);
  return context.fn;
}

test("lower waiting/unloading cards follow operational state, not shared queue bookkeeping", () => {
  assert.match(staged, /MS_OPERATIONAL_CARD_STATE_V1/);
  assert.match(
    staged,
    /state\.summary === "waiting" &&\s*inboundOperationalStage\(row\) === "waiting"/,
  );
  assert.match(
    staged,
    /state\.summary === "unloading" &&\s*inboundOperationalStage\(row\) === "unloading"/,
  );
  assert.match(staged, /const operationalStage = inboundOperationalStage\(row\)/);
  assert.match(staged, /if \(operationalStage === "waiting"\) counts\.waiting\+\+/);
  assert.match(staged, /if \(operationalStage === "unloading"\) counts\.unloading\+\+/);
  assert.match(
    staged,
    /const operationalSummaryMatch =\s*!ignoreSummary &&\s*\(state\.summary === "waiting" \|\| state\.summary === "unloading"\) &&\s*inboundOperationalStage\(row\) !== "none"/,
  );
  assert.doesNotMatch(
    staged,
    /state\.summary === "unloading" &&\s*\(isDestination\(row\) \|\| isDrop\(row\)\) &&\s*queue\.active &&\s*queue\.started/,
  );
  assert.match(staged, /state\.summary === "origin" &&\s*isOrigin\(row\) &&\s*!queue\.done &&\s*!queue\.cancelled/);
  assert.doesNotMatch(staged, /state\.summary === "origin"[^;]+queue\.awaitingRelease/);
  assert.match(
    staged,
    /state\.summary === "drop" &&\s*isDrop\(row\) &&\s*!queue\.cancelled &&\s*\(\(queue\.done && queue\.released\) \|\|\s*operationalExpiry12h\(row\)\?\.group === "drop"\)/,
  );
});

test("one truck moves waiting to unloading to completed without the unloading card dropping to zero", () => {
  const operationalStage = loadInboundOperationalStage();
  const now = new Date("2026-09-13T10:30:00.000Z");
  const base = {
    attendanceType: "ปลายทาง",
    actualArrivalAt: "2026-09-13T10:00:00.000Z",
  };

  assert.equal(operationalStage({ ...base, unloadingState: 0 }, now), "waiting");
  assert.equal(operationalStage({ ...base, unloadingState: 1 }, now), "unloading");
  assert.equal(operationalStage({ ...base, unloadingState: 2 }, now), "none");

  assert.equal(
    operationalStage(
      {
        ...base,
        unloadingState: 0,
        scheduleUnloadingStartedAt: "2026-09-13T10:20:00.000Z",
      },
      now,
    ),
    "unloading",
  );
});

test("TBR-first, Drop awaiting release, Origin and cancellation keep their existing contracts", () => {
  const operationalStage = loadInboundOperationalStage();
  const now = new Date("2026-09-13T10:30:00.000Z");

  assert.equal(
    operationalStage(
      {
        attendanceType: "ปลายทาง",
        scheduleTbrArrivalAt: "2026-09-13T10:00:00.000Z",
        unloadingState: 1,
      },
      now,
    ),
    "unloading",
  );

  const drop = {
    attendanceType: "จุดดรอป",
    scheduleTbrArrivalAt: "2026-09-13T10:00:00.000Z",
    unloadingState: 2,
    scheduleUnloadingCompletedAt: "2026-09-13T10:25:00.000Z",
  };
  assert.equal(operationalStage(drop, now), "unloading");
  assert.equal(
    operationalStage(
      { ...drop, actualDepartureAt: "2026-09-13T10:27:00.000Z" },
      now,
    ),
    "none",
  );
  assert.equal(
    operationalStage(
      {
        ...drop,
        unloadingState: 1,
        actualDepartureAt: "2026-09-13T10:27:00.000Z",
      },
      now,
    ),
    "none",
    "Route departure must beat a stale unloadingState=1 on Drop rows",
  );
  const stageSource = between(
    staged,
    "function inboundOperationalStage",
    "function renderFilterSummary",
  );
  assert.match(stageSource, /MS_DROP_RELEASE_PRECEDENCE_V1/);
  assert.ok(
    stageSource.indexOf("if (isDrop(row) && released)") <
      stageSource.indexOf("if (unloadingState === 1)"),
    "Drop release precedence must execute before operational unloading truth",
  );

  assert.equal(
    operationalStage(
      {
        attendanceType: "ต้นทาง",
        actualArrivalAt: "2026-09-13T10:00:00.000Z",
        unloadingState: 1,
      },
      now,
    ),
    "none",
  );

  assert.equal(
    operationalStage(
      {
        attendanceType: "ปลายทาง",
        actualArrivalAt: "2026-09-13T10:00:00.000Z",
        unloadingState: 1,
        queueCancelledAt: "2026-09-13T10:10:00.000Z",
      },
      now,
    ),
    "none",
  );
});

test("completed card displays the authoritative daily Destination rows represented by its total", () => {
  assert.match(staged, /const completedRows = Array\.isArray\(completed\?\.rows\) \? completed\.rows : \[\]/);
  assert.match(staged, /state\.archiveRows\.filter\(\(row\) => !isCompletedToday\(row\)\)/);
  assert.match(staged, /state\.completedToday = Number\(completed\?\.total\) \|\| completedRows\.length/);
  assert.match(staged, /state\.summary === "completed" && isDestination\(row\) && isCompletedToday\(row\)/);
  for (const field of ["query", "dateFrom", "dateTo"]) {
    assert.match(staged, new RegExp(`state\\.${field} = ""`));
  }
  for (const field of ["attendance", "attribute", "region", "route", "status"]) {
    assert.match(staged, new RegExp(`state\\.${field} = "all"`));
  }
  assert.match(staged, /state\.queue = "all";\s*el\("queue-filter"\)\.value = "all";/);
});

test("completed/drop views hydrate released and truthfully expired rows separately", () => {
  assert.match(
    staged,
    /function filteredRows\(ignoreSummary = false, queueMode = state\.queue\)/,
  );
  assert.match(
    staged,
    /const useCompletedTodayDataset =\s*state\.status === "unload-overtime" \|\|\s*\(!ignoreSummary &&\s*\(state\.summary === "completed" \|\|\s*state\.summary === "unload-overtime" \|\|\s*state\.summary === "drop"\)\);/,
  );
  assert.match(
    staged,
    /const useArchive =\s*queueMode === "completed" \|\|\s*\(queueMode === "all" && state\.archiveView\);/,
  );
  assert.match(
    staged,
    /const includeExpired12h =\s*state\.status === "unload-overtime" \|\|\s*\(!ignoreSummary &&\s*\(state\.summary === "unload-overtime" \|\| state\.summary === "drop"\)\);/,
  );
  assert.match(
    staged,
    /const source = useCompletedTodayDataset\s*\? includeExpired12h\s*\? completedTodayWithExpired12hRows\(\)\s*:\s*completedTodayDatasetRows\(\)\s*:\s*useArchive\s*\? state\.archiveRows\s*:\s*state\.currentRows;/,
  );
  assert.match(
    staged,
    /const summaryRows = filteredRows\(\s*true,/,
  );
  assert.match(
    staged,
    /state\.summary === "completed" \|\|\s*state\.summary === "completed-all" \|\|\s*state\.summary === "unload-overtime" \|\|\s*state\.summary === "cancelled"\s*\? "queue"\s*: state\.queue/,
  );
  assert.match(staged, /queueMode === "all"/);
  assert.match(staged, /queueMode === "queue" && queue\.active/);
  assert.match(staged, /state\.summary === "drop" &&\s*queue\.done &&\s*queue\.released/);
  assert.match(staged, /queueMode === "queue" \? aTime - bTime : bTime - aTime/);
});

test("12-hour expiry remains an operational cutoff without fabricating release truth", () => {
  assert.match(staged, /MS_OPERATIONAL_12H_EXPIRY_V1/);
  assert.match(staged, /ageHours < 12/);
  assert.match(staged, /ageHours >= 12/);
  assert.match(staged, /queue\.cancelled \|\| queue\.expired/);
  assert.match(staged, /จุดดรอป · หมดอายุ 12 ชม\./);
  assert.match(staged, /ลงรถเกินเวลา · หมดอายุ 12 ชม\./);
  assert.match(
    staged,
    /if \(!queue\.expired \|\| queue\.cancelled \|\| queue\.done\) return null/,
  );
  assert.match(
    staged,
    /const released = Boolean\(parseDate\(row\.actualDepartureAt\)\)/,
  );
});

test("summary filter staging does not change polling or realtime recovery", () => {
  assert.match(staged, /pollMs:\s*4000/);
  assert.match(staged, /requestTimeoutMs:\s*32000/);
  assert.doesNotMatch(staged, /if \(!silent && !state\.archiveLoaded\) scheduleArchiveLoad\(\)/);
});
