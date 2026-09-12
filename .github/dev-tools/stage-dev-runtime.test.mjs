import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  frontendHasIntegratedDevRuntime,
  patchDevUiShellSource,
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

test("DEV staging preserves the integrated daily-history frontend and stays idempotent", () => {
  const first = stageFrontend(frontendSource);
  assert.equal(frontendHasIntegratedDevRuntime(first), true);
  assert.match(first, /MS_DAILY_HISTORY_V1/);
  assert.match(first, /pollMs:\s*4000/);
  assert.match(first, /apiGet\("msDailyArchive"/);
  assert.match(first, /เลือกวันอย่างเดียวไม่อ่านฐานข้อมูล จนกว่าจะกดค้นหา/);
  assert.match(first, /function metricSourceRows\(\)/);
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

test("live polling stays live-only while explicit history search uses the daily Turso endpoint", () => {
  const first = stageFrontend(frontendSource);
  assert.match(
    first,
    /state\.rows = state\.archiveView \? state\.archiveRows : state\.currentRows/,
  );
  assert.match(first, /DEV: archive stays lazy; realtime transport never auto-reads msArchive/);
  assert.match(first, /const useArchive =\s*queueMode === "completed" \|\|\s*\(queueMode === "all" && state\.archiveView\)/);
  assert.match(first, /const result = await apiGet\("msDailyArchive", \{/);
  assert.doesNotMatch(first, /const result = await apiGet\("msRange"/);
  assert.match(first, /input\.onchange = \(\) => \{\}/);
  assert.match(first, /function useMobileCardLayout\(/);
  assert.match(first, /return viewport <= 1024 && !isPhoneDesktopSiteLayout\(viewport, screenWidth, screenHeight\)/);
  assert.match(first, /const mobileLayout = useMobileCardLayout\(\)/);
  assert.match(first, /classList\.toggle\("ms-desktop-site-phone", desktopSitePhone\)/);
  assert.match(first, /tableBody\.innerHTML = ""/);
  assert.match(first, /mobileCards\.innerHTML = ""/);
});

test("upper metrics use today or the explicitly searched date range", () => {
  const first = stageFrontend(frontendSource);
  assert.match(first, /function rowBusinessDay\(row\)/);
  assert.match(first, /function metricSourceRows\(\)/);
  assert.match(first, /if \(state\.archiveLoaded\) return state\.archiveRows/);
  assert.match(first, /state\.currentRows\.filter\(\(row\) => rowBusinessDay\(row\) === today\)/);
  assert.match(first, /metricRows\.filter\(\(row\) => isCompletedAccumulated\(row\)\)\.length/);
  assert.match(first, /state\.summary === "completed" && isCompletedToday\(row\)/);
  assert.match(first, /return rowBusinessDay\(row\) === bangkokDateValue\(now\);/);
});

test("ลงรถเสร็จ reuses browser cache and progressively renders large result sets", () => {
  const first = stageFrontend(frontendSource);
  assert.match(first, /function completedTodayDatasetRows\(\)/);
  assert.match(first, /const archiveCompleted = state\.archiveRows\.filter\(\(row\) => isCompletedToday\(row\)\)/);
  assert.match(first, /const currentCompleted = state\.currentRows\.filter\(\(row\) => isCompletedToday\(row\)\)/);
  assert.doesNotMatch(first, /\.filter\(isCompletedToday\)/);
  assert.match(first, /return mergeLatest\(archiveCompleted, currentCompleted\)/);
  assert.match(first, /const cachedCompletedRows = completedTodayDatasetRows\(\)/);
  assert.match(first, /cachedCompletedRows\.length >= expectedCompleted/);
  assert.match(first, /completedTodayLoadPromise\?\.key === key/);
  assert.match(first, /completedTodayRetryAt = Date\.now\(\) \+ 60_000/);
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

test("cancellation remains operational in its own classic summary card", () => {
  const first = stageFrontend(frontendSource);
  assert.match(first, /summary-cancelled/);
  assert.match(first, /data-summary-status="cancelled"/);
  assert.doesNotMatch(first, /data-summary-substatus|summary-subfilter/);
  assert.match(first, /function isCancelledToday\(row, now = new Date\(\)\)/);
  assert.match(first, /queueCancelledAt/);
  assert.match(first, /data-cancel-ms-route/);
});

test("only origin rows expose manual cancellation", () => {
  const first = stageFrontend(frontendSource);
  const worker = stageWorker(workerSource);
  assert.equal((first.match(/q\.active && isOrigin\(row\)/g) || []).length, 2);
  assert.doesNotMatch(first, /q\.active && !isDestination\(row\)/);
  assert.match(first, /if \(isDestination\(row\)\)\s*return toast\("งานปลายทางไม่สามารถยกเลิกรถจากคิวด้วยมือได้"/);
  assert.match(worker, /if \(attendance === "ปลายทาง"\)\s*fail\("งานปลายทางไม่สามารถยกเลิกรถจากคิวด้วยมือได้", "DESTINATION_CANCEL_NOT_ALLOWED", 409\)/);
});

test("live Route window includes tomorrow so midnight does not hide arrived cross-day trips", () => {
  const worker = stageWorker(workerSource);
  assert.match(worker, /start \+ 3 \* 86400000 - 1000/);
  assert.doesNotMatch(worker, /start \+ 2 \* 86400000 - 1000/);
});

test("daily completed counts accepted Route state 2 while timestamps remain SLA-only and views roll at Bangkok midnight", () => {
  const first = stageFrontend(frontendSource);
  const worker = stageWorker(workerSource);
  assert.match(worker, /completionTruth = resolveCompletionTruth/);
  assert.match(worker, /completionObservedLive:\s*Boolean\(item\.snapshot\?\.unloadingCompletedAt\)/);
  assert.match(worker, /MS_COMPLETED_ROUTE_DAY_TRUTH_V1/);
  assert.match(worker, /msCompletedRowBusinessDay\(row\) === day/);
  const completedPredicate = worker.slice(
    worker.indexOf("function isCompletedForThaiDay"),
    worker.indexOf("function mergeCompletedToday"),
  );
  assert.doesNotMatch(completedPredicate, /completionObservedLive|completionSource|unloadingCompletedAt/);
  assert.match(worker, /item\.action !== "FIRST_SEEN" && item\.synced_by !== "MS_RANGE"/);
  assert.match(worker, /!completionCacheReady/);
  assert.match(worker, /MS_COMPLETION_DAILY_HISTORY_TRUTH_V2/);
  assert.match(worker, /MS_COMPLETION_ARCHIVE_TRUTH_V2/);
  assert.match(first, /state\.summary === "completed" \|\| state\.summary === "cancelled"/);
  assert.match(first, /state\.queue = "queue"/);
  assert.match(first, /resetLowerDailyViewOnBangkokDayChange\(\)/);
});

test("daily history remains read-only after worker staging", () => {
  const worker = stageWorker(workerSource);
  const start = worker.indexOf("async function msDailyArchive");
  const end = worker.indexOf("async function msArchiveTotal", start);
  assert.ok(start >= 0 && end > start, "msDailyArchive must remain staged");
  const daily = worker.slice(start, end);
  assert.match(daily, /TURSO_DAILY_HISTORY/);
  assert.match(daily, /upstreamMsCalls:\s*0/);
  assert.match(daily, /historyWrites:\s*0/);
  assert.match(daily, /31 \* 86400000/);
  assert.doesNotMatch(daily, /readMsRoutes\(|syncMs\(|refreshMsIfStale\(/);
});

test("classic eight lower summary cards stay standalone and responsive", () => {
  const first = stageStyle(styleSource);
  assert.match(first, /MS_LOWER_CLASSIC_V12/);
  assert.match(first, /grid-template-columns:repeat\(8,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(first, /MS_LOWER_CANONICAL_V11/);
});

test("DEV staging preserves classic lower UI and route cancellation controls once", () => {
  const first = stageStyle(styleSource);
  assert.match(first, /DEV mobile MS card spacing/);
  assert.match(first, /MS route cancellation controls/);
  assert.match(first, /MS_LOWER_CLASSIC_V12/);
  assert.match(first, /DEV mobile unified shell v7/);
  assert.match(first, /MS mobile export single-column v2/);
  assert.match(first, /Proof V16 mobile toolbar containment v2/);
  assert.match(first, /Proof mobile header full-width anchor v4/);
  assert.match(first, /grid-template-columns:repeat\(8,minmax\(0,1fr\)\)/);
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
  assert.match(worker, /MS_COMPLETION_TIME_TRUTH_V2/);
  assert.match(worker, /MS_COMPLETION_DAILY_HISTORY_TRUTH_V2/);
  assert.match(worker, /MS_COMPLETION_ARCHIVE_TRUTH_V2/);
  assert.match(worker, /MS_DAILY_HISTORY_V1: read-only daily history/);
});

test("DEV deploy uses the idempotent staging entrypoint and daily-history gate", () => {
  assert.match(workflow, /stage-dev-runtime\.test\.mjs/);
  assert.match(workflow, /daily-history\.test\.mjs/);
  assert.match(workflow, /cp -R src \.dev-runtime\/src/);
  assert.match(workflow, /stage-dev-runtime\.mjs \.dev-assets\/ms\.js \.dev-runtime\/src\/index\.js/);
  assert.match(workflow, /node --check \.dev-runtime\/src\/index\.js/);
  assert.match(workflow, /node --check src\/index\.js/);
  assert.doesNotMatch(workflow, /stage-dev-runtime\.mjs \.dev-assets\/ms\.js src\/index\.js/);
  assert.doesNotMatch(
    workflow,
    /node scripts\/patch-dev-ms-archive\.mjs \.dev-assets\/ms\.js src\/index\.js/,
  );
});


test("DEV header V5 keeps spacious menu icons and groups status with refresh at the far right", () => {
  const styled = stageStyle(styleSource);
  assert.match(styled, /DEV_HEADER_POLISH_V3/);
  assert.match(styled, /DEV_HEADER_INTERACTION_V4/);
  assert.match(styled, /DEV_HEADER_LAYOUT_V5/);
  assert.match(styled, /DEV_HEADER_ALIGNMENT_V6/);
  assert.match(styled, /grid-template-columns:30px minmax\(0,1fr\) 30px/);
  assert.match(styled, /text-align:center;overflow:hidden;text-overflow:ellipsis/);
  assert.match(styled, /grid-template-columns:40px minmax\(0,1fr\);column-gap:14px/);
  assert.match(styled, /app-nav-menu a>span\{grid-row:1\/3;display:grid;place-items:center;width:40px;height:40px/);
  assert.match(styled, /dev-utility-group\{order:4;display:flex/);
  assert.match(styled, /dev-shell-status>\.badge-online::before/);
  assert.match(styled, /summary::after\{content:"⌄"/);
});


test("DEV tools empty-state is event-driven and cannot self-trigger an attribute observer loop", async () => {
  const source = await readFile(new URL(".github/dev-tools/stage-dev-runtime.mjs", root), "utf8");
  assert.match(source, /DEV_TOOLS_SAFE_EMPTY_V7/);
  assert.match(source, /details\.addEventListener\('toggle'/);
  assert.doesNotMatch(source, /new MutationObserver\(sync\)\.observe\(header/);
  assert.doesNotMatch(source, /attributeFilter:\['class','style','hidden'\]/);
});


test("DEV Proof connection exposes print HAR upload in the shared MS connection UI", async () => {
  const msHtml = await readFile(new URL("ms.html", root), "utf8");
  const proofHtml = await readFile(new URL("proof.html", root), "utf8");
  const stagedMsHtml = patchDevUiShellSource(msHtml, "ms.html");
  const stagedProofHtml = patchDevUiShellSource(proofHtml, "proof.html");
  const stagedFrontend = stageFrontend(frontendSource);

  assert.match(stagedProofHtml, /id="proof-session-btn" class="btn btn-header header-link" href="ms\.html#connection"/);
  assert.match(stagedMsHtml, /DEV_PROOF_HAR_CONNECTION_V9/);
  assert.match(stagedMsHtml, /id="ms-har-proof"/);
  assert.match(stagedMsHtml, /id="ms-har-proof-save"/);
  assert.match(stagedMsHtml, /อัปไฟล์ปริ้นบาร์รถ/);
  assert.match(stagedMsHtml, /ไม่เก็บไฟล์ HAR ทั้งไฟล์/);
  assert.match(stagedMsHtml, /อัปโหลด HAR ทั้ง 5 แหล่ง/);
  assert.match(stagedMsHtml, /data-source-status="hbiPhotos"/);
  assert.match(stagedMsHtml, /data-source-status="proof"/);
  assert.match(stagedMsHtml, /5\. ปริ้นบาร์โค้ดรถ/);
  assert.match(stagedMsHtml, /https:\/\/ms\.flashexpress\.com\/#\/sendoutlets\/storeLine/);
  assert.match(stagedMsHtml, /ทั้ง 5 หน้าด้านล่าง/);

  assert.match(stagedFrontend, /DEV_PROOF_HAR_CONNECTION_FRONTEND_V9/);
  assert.match(stagedFrontend, /async function saveProofHarConnection/);
  assert.match(stagedFrontend, /host\.endsWith\("flashexpress\.com"\)/);
  assert.match(stagedFrontend, /header\("x-fle-session-id"\)/);
  assert.match(stagedFrontend, /header\("x-device-id"\)/);
  assert.match(stagedFrontend, /apiPost\("saveMsConnection", \{ hub, sessionId, deviceId \}\)/);
  assert.match(stagedFrontend, /key === "proof" \? status\.routes : status\[key\]/);
  assert.match(stagedFrontend, /"ms-har-bustime", "ms-har-hbi-photos", "ms-har-proof"/);
  assert.match(stagedFrontend, /pollMs:\s*4000/);
  assert.equal(stageFrontend(stagedFrontend), stagedFrontend);
});