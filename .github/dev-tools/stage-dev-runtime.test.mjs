import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  frontendHasIntegratedDevRuntime,
  stageFrontend,
  stageStyle,
  stageWorker,
} from "./stage-dev-runtime.mjs";

const root = new URL("../../", import.meta.url);
const frontendSource = await readFile(new URL("ms.js", root), "utf8");
const styleSource = await readFile(new URL("style.css", root), "utf8");
const workerSource = await readFile(new URL("worker/src/index.js", root), "utf8");
const workflow = await readFile(
  new URL(".github/workflows/deploy-worker-dev.yml", root),
  "utf8",
);

test("DEV staging integrates root frontend once and stays idempotent after cutover", () => {
  const first = stageFrontend(frontendSource);
  assert.equal(frontendHasIntegratedDevRuntime(first), true);
  assert.match(first, /data-cancel-ms-route/);
  assert.match(first, /submitCancelMsRoute/);
  assert.match(first, /data-summary-status="cancelled"/);
  assert.match(first, /ยกเลิกรถแล้ว/);
  assert.match(first, /function renderRowsProgressively\(rows\)/);
  assert.match(first, /function isCompletedAccumulated\(row\)/);
  assert.match(first, /function isCancelledToday\(row, now = new Date\(\)\)/);
  assert.match(first, /function resetLowerDailyViewOnBangkokDayChange\(\)/);
  assert.match(first, /const preserveObservedCompletion =/);
  const second = stageFrontend(first);
  assert.equal(second, first);
});

test("รายการทั้งหมด uses live MS rows and renders only the visible layout", () => {
  const first = stageFrontend(frontendSource);
  assert.match(first, /state\.archiveView = state\.queue === "completed"/);
  assert.doesNotMatch(
    first,
    /state\.queue === "all" \|\| state\.queue === "completed"\) await ensureArchiveLoaded\(true\)/,
  );
  assert.match(
    first,
    /const useArchive =\s*queueMode === "completed" \|\|\s*\(queueMode === "all" && state\.archiveView\)/,
  );
  assert.match(first, /state\.archiveView = true;\s*state\.archiveLoaded = false;/);
  assert.match(first, /window\.matchMedia\("\(max-width: 700px\)"\)\.matches/);
  assert.match(first, /tableBody\.innerHTML = ""/);
  assert.match(first, /mobileCards\.innerHTML = ""/);
});

test("upper completed is cumulative while lower completed remains Bangkok-today", () => {
  const first = stageFrontend(frontendSource);
  assert.match(first, /state\.summary === "completed" && isCompletedToday\(row\)/);
  assert.match(first, /state\.summary === "completed-all" && isCompletedAccumulated\(row\)/);
  assert.match(first, /state\.summary = "completed-all"/);
  assert.match(first, /state\.archiveRows\.filter\(\(row\) => isCompletedAccumulated\(row\)\)\.length/);
  assert.match(first, /bangkokDateValue\(row\.unloadingCompletedAt\) === bangkokDateValue\(now\)/);
});

test("ลงรถเสร็จ reuses browser cache and progressively renders large result sets", () => {
  const first = stageFrontend(frontendSource);
  assert.match(first, /const cachedCompletedRows = state\.archiveRows\.filter\(isCompletedToday\)/);
  assert.match(first, /cachedCompletedRows\.length === expectedCompleted/);
  assert.match(first, /firstBatch = mobileLayout \? 32 : 64/);
  assert.match(first, /requestAnimationFrame\(pump\)/);
  assert.match(first, /insertAdjacentHTML/);
});

test("ลงรถเสร็จ stays visible after the next 4-second live poll", () => {
  const first = stageFrontend(frontendSource);
  assert.match(first, /pollMs:\s*4000/);
  assert.match(first, /const sameCompletionObservation =/);
  assert.match(first, /previous\?\.completionObservedLive === true/);
  assert.match(first, /Number\(previous\?\.unloadingState\) === 2/);
  assert.match(first, /Number\(row\?\.unloadingState\) === 2/);
  assert.match(first, /completionObservedLive: true/);
  assert.match(
    first,
    /row\?\.unloadingCompletedAt \|\| previous\?\.unloadingCompletedAt/,
  );
});

test("cancelled summary resets daily without clearing persisted cancellation", () => {
  const first = stageFrontend(frontendSource);
  assert.match(first, /summary-cancelled/);
  assert.match(first, /data-summary-status="cancelled"/);
  assert.match(first, /state\.summary === "cancelled" && queue\.cancelled && isCancelledToday\(row\)/);
  assert.match(first, /queueInfo\(row\)\.cancelled && isCancelledToday\(row\)/);
  assert.match(first, /bangkokDateValue\(row\.queueCancelledAt\) === bangkokDateValue\(now\)/);
});

test("destination rows never expose or accept manual cancellation", () => {
  const first = stageFrontend(frontendSource);
  const worker = stageWorker(workerSource);
  assert.equal((first.match(/q\.active && !isDestination\(row\)/g) || []).length, 2);
  assert.match(first, /if \(isDestination\(row\)\)\s*return toast\("งานปลายทางไม่สามารถยกเลิกรถจากคิวด้วยมือได้"/);
  assert.match(worker, /if \(attendance === "ปลายทาง"\)\s*fail\("งานปลายทางไม่สามารถยกเลิกรถจากคิวด้วยมือได้", "DESTINATION_CANCEL_NOT_ALLOWED", 409\)/);
});

test("live Route window includes tomorrow so midnight does not hide arrived cross-day trips", () => {
  const worker = stageWorker(workerSource);
  assert.match(worker, /start \+ 3 \* 86400000 - 1000/);
  assert.doesNotMatch(worker, /start \+ 2 \* 86400000 - 1000/);
});

test("daily completed only counts an observed 0\/1 to 2 transition and daily views roll at Bangkok midnight", () => {
  const first = stageFrontend(frontendSource);
  const worker = stageWorker(workerSource);
  assert.match(worker, /completionObservedLive:\s*Number\(item\.snapshot\?\.unloadingState\) === 2/);
  assert.match(worker, /Boolean\(old\) &&\s*Number\(old\?\.unloading_state\) !== 2/);
  assert.match(worker, /row\?\.completionObservedLive === true/);
  assert.match(worker, /item\.action !== "FIRST_SEEN" && item\.synced_by !== "MS_RANGE"/);
  assert.match(worker, /!completionCacheReady/);
  assert.match(first, /state\.summary === "completed" \|\| state\.summary === "cancelled"/);
  assert.match(first, /state\.queue = "queue"/);
  assert.match(first, /resetLowerDailyViewOnBangkokDayChange\(\)/);
});

test("seven lower summary cards stay on one desktop row", () => {
  const first = stageStyle(styleSource);
  assert.match(first, /MS summary performance/);
  assert.match(first, /grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/);
  assert.match(first, /@media \(min-width:1201px\)/);
});

test("DEV staging integrates mobile spacing and route cancellation controls once", () => {
  const first = stageStyle(styleSource);
  assert.match(first, /DEV mobile MS card spacing/);
  assert.match(first, /MS route cancellation controls/);
  assert.match(first, /MS summary performance/);
  assert.equal(stageStyle(first), first);
});

test("DEV staging still assembles all backend runtime patches from clean source", () => {
  const worker = stageWorker(workerSource);
  assert.match(worker, /export class MsRefreshCoordinator/);
  assert.match(worker, /bootstrapConnector\(body, env\)/);
  assert.match(worker, /acquireMsSyncClaim/);
  assert.match(worker, /UPSTREAM_FETCH_TIMEOUT_MS = 9000/);
  assert.match(worker, /msCompletedToday/);
  assert.match(worker, /async function cancelMsRoute/);
  assert.match(worker, /ms_route_cancellations/);
  assert.match(worker, /DESTINATION_CANCEL_NOT_ALLOWED/);
  assert.match(worker, /planned across Bangkok midnight are already visible before 00:00/);
  assert.match(worker, /completion cache only trusts observed live unloading transitions/);
});

test("DEV deploy uses the idempotent staging entrypoint", () => {
  assert.match(workflow, /stage-dev-runtime\.test\.mjs/);
  assert.match(workflow, /stage-dev-runtime\.mjs \.dev-assets\/ms\.js src\/index\.js/);
  assert.doesNotMatch(
    workflow,
    /node scripts\/patch-dev-ms-archive\.mjs \.dev-assets\/ms\.js src\/index\.js/,
  );
});
