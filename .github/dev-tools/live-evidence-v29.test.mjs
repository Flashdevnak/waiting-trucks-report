import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  mergeCompletedTbrFixtureV29,
  sortCompletedFixtureV29,
  patchLiveEvidenceV29Frontend,
  patchLiveEvidenceV29Worker,
} from "./patch-live-evidence-v29.mjs";
import { stageFrontend, stageWorker } from "./stage-dev-runtime.mjs";

const root = new URL("../../", import.meta.url);
const frontendSource = await readFile(new URL("ms.js", root), "utf8");
const workerSource = await readFile(new URL("worker/src/index.js", root), "utf8");
const patchSource = await readFile(new URL("./patch-live-evidence-v29.mjs", import.meta.url), "utf8");

test("V29 completed rows preserve the last known TBR when live completion has blank BusTime", () => {
  const dayForValue = (value) => String(value || "").slice(0, 10);
  const previous = [{
    id:"R1", unloadingState:2, unloadingCompletedAt:"2026-09-19T20:40:00+07:00",
    scheduleTbrArrivalAt:"2026-09-19T20:33:00+07:00",
  }];
  const live = [{
    id:"R1", unloadingState:2, unloadingCompletedAt:"2026-09-19T20:40:00+07:00",
    scheduleTbrArrivalAt:"",
  }];
  const rows = mergeCompletedTbrFixtureV29(previous, live, "2026-09-19", dayForValue);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].scheduleTbrArrivalAt, "2026-09-19T20:33:00+07:00");
});

test("V29 completed sorting is actual completion newest to oldest", () => {
  const rows = sortCompletedFixtureV29([
    { id:"old", trustedCompletionAt:"2026-09-19T18:00:00+07:00" },
    { id:"new", trustedCompletionAt:"2026-09-19T22:00:00+07:00" },
    { id:"mid", trustedCompletionAt:"2026-09-19T20:00:00+07:00" },
  ]);
  assert.deepEqual(rows.map((row) => row.id), ["new","mid","old"]);
});

test("V29 staged frontend makes PNO cards audit-clickable without background polling", () => {
  const front = stageFrontend(frontendSource);
  assert.match(front, /LIVE_EVIDENCE_FRONTEND_V29/);
  assert.match(front, /data-pno-detail-card/);
  assert.match(front, /pno-detail-cta|ดูรายละเอียดพัสดุ/);
  assert.match(front, /content:"ดูรายละเอียดพัสดุ"/);
  assert.match(front, /pnoV29OpenDetail/);
  assert.match(front, /openPendingParcels\(row, target\.type, 1\)/);
  assert.match(front, /document\.addEventListener\("click", pnoV29OpenDetail, true\)/);
  assert.match(front, /document\.addEventListener\("keydown", pnoV29OpenDetailByKeyboard, true\)/);
  const section = front.slice(front.indexOf("LIVE_EVIDENCE_FRONTEND_V29"), front.indexOf('document.addEventListener("DOMContentLoaded", pnoV18EnsureUi)') + 80);
  assert.doesNotMatch(section, /setInterval\s*\(|setTimeout\s*\(|apiGet\s*\(|apiPost\s*\(/);
  assert.doesNotThrow(() => new Function(front));
});

test("V29 staged frontend sorts completed views by trusted completion time descending", () => {
  const front = stageFrontend(frontendSource);
  assert.match(front, /LIVE_EVIDENCE_COMPLETED_SORT_V29/);
  assert.equal((front.match(/LIVE_EVIDENCE_COMPLETED_SORT_V29/g) || []).length, 1);
  assert.match(front, /const completedSort =/);
  assert.match(front, /trustedLowerCompletionAt\(a\)/);
  assert.match(front, /trustedLowerCompletionAt\(b\)/);
  assert.match(front, /return bCompleted - aCompleted/);
  assert.match(front, /state\.summary === "completed"/);
  assert.match(front, /queueMode === "completed"/);
});

test("V29 staged worker preserves stored TBR on sync completion and recovers history read-only", () => {
  const worker = stageWorker(workerSource);
  assert.match(worker, /LIVE_EVIDENCE_WORKER_V29/);
  assert.match(worker, /date\(r\.scheduleTbrArrivalAt\) \|\| date\(old\?\.schedule_tbr_arrival_at\)/);
  assert.match(worker, /async function recoverCompletedTbrV29/);
  const recover = worker.slice(worker.indexOf("async function recoverCompletedTbrV29"), worker.indexOf("async function readMsCompletedToday"));
  assert.match(recover, /ms_route_history INDEXED BY idx_ms_route_history_hub_route_snapshot/);
  assert.match(recover, /const placeholders = missingIds\.map/);
  assert.match(recover, /route_id IN/);
  assert.match(recover, /\.bind\(hub, \.\.\.missingIds\)\.all\(\)/);
  assert.match(recover, /scheduleTbrArrivalAt/);
  assert.doesNotMatch(recover, /fetch\s*\(|readBusPage|readBusTimeData|INSERT|UPDATE|DELETE/i);
  const completed = worker.slice(worker.indexOf("async function readMsCompletedToday"), worker.indexOf("async function markConnectionSuccess"));
  assert.match(completed, /recoverCompletedTbrV29\(env, hub, rows\)/);
  assert.doesNotMatch(completed, /readBusPage|readBusTimeData|fetch\s*\(/);
});

test("V29 patch itself adds no timer, cron, subscription, upstream source or DB write", () => {
  assert.doesNotMatch(patchSource, /setInterval\s*\(|setTimeout\s*\(|scheduled\s*\(/);
  assert.doesNotMatch(patchSource, /readBusPage\s*\(|readBusTimeData\s*\(|route_followstart_list|fleet_time\/getList/);
  assert.doesNotMatch(patchSource, /\bINSERT\b|\bUPDATE\b|\bDELETE\b/i);
  const front1 = stageFrontend(frontendSource);
  const worker1 = stageWorker(workerSource);
  assert.equal(patchLiveEvidenceV29Frontend(front1), front1);
  assert.equal(patchLiveEvidenceV29Worker(worker1), worker1);
});
