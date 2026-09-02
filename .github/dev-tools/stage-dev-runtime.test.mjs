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

test("ลงรถเสร็จ reuses browser cache and progressively renders large result sets", () => {
  const first = stageFrontend(frontendSource);
  assert.match(first, /const cachedCompletedRows = state\.archiveRows\.filter\(isCompletedToday\)/);
  assert.match(first, /cachedCompletedRows\.length === expectedCompleted/);
  assert.match(first, /firstBatch = mobileLayout \? 32 : 64/);
  assert.match(first, /requestAnimationFrame\(pump\)/);
  assert.match(first, /insertAdjacentHTML/);
});

test("cancelled summary card is a fast live-row filter", () => {
  const first = stageFrontend(frontendSource);
  assert.match(first, /summary-cancelled/);
  assert.match(first, /data-summary-status="cancelled"/);
  assert.match(first, /state\.summary === "cancelled" && queue\.cancelled/);
  assert.match(first, /value === "cancelled"/);
  assert.match(first, /counts\.cancelled = state\.currentRows\.filter/);
  assert.match(first, /queueStatus: q\.cancelled\s*\? "ยกเลิกรถแล้ว"/);
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
});

test("DEV deploy uses the idempotent staging entrypoint", () => {
  assert.match(workflow, /stage-dev-runtime\.test\.mjs/);
  assert.match(workflow, /stage-dev-runtime\.mjs \.dev-assets\/ms\.js src\/index\.js/);
  assert.doesNotMatch(
    workflow,
    /node scripts\/patch-dev-ms-archive\.mjs \.dev-assets\/ms\.js src\/index\.js/,
  );
});
