import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  aggregatePreEntryFixtureV27,
} from "./patch-pno-v27-multidrop-copy.mjs";
import { stageFrontend, stageWorker } from "./stage-dev-runtime.mjs";

const root = new URL("../../", import.meta.url);
const frontendSource = await readFile(new URL("ms.js", root), "utf8");
const workerSource = await readFile(new URL("worker/src/index.js", root), "utf8");

test("V27 multi-drop summary dedupes repeated source rows and sums unique segments", () => {
  const rows = [
    { proof_id:"NAK1TSP863", store_id:"TH27070101", next_store_id:"TH27011602", next_store_name:"02 NE1_HUB-นครราชสีมา", line_id:"L1", line_name:"FD-4W-2WGT-CCH-NE1-17:40-BD-RS2", total_num:2, already_num:2, no_entry_num:0 },
    { proof_id:"NAK1TSP863", store_id:"TH27210401", next_store_id:"TH27011602", next_store_name:"02 NE1_HUB-นครราชสีมา", line_id:"L1", line_name:"FD-4W-2WGT-CCH-NE1-17:40-BD-RS2", total_num:95, already_num:93, no_entry_num:2 },
    { proof_id:"NAK1TSP863", store_id:"TH27210401", next_store_id:"TH27011602", next_store_name:"02 NE1_HUB-นครราชสีมา", line_id:"L1", line_name:"FD-4W-2WGT-CCH-NE1-17:40-BD-RS2", total_num:95, already_num:93, no_entry_num:2 },
    { proof_id:"AYU1TS8R72", store_id:"TH05110411", next_store_id:"TH27011602", next_store_name:"02 NE1_HUB-นครราชสีมา", line_id:"L2", total_num:355, already_num:301, no_entry_num:54 },
    { proof_id:"AYU1TS8R72", store_id:"TH05110411", next_store_id:"TH27011602", next_store_name:"02 NE1_HUB-นครราชสีมา", line_id:"L2", total_num:355, already_num:301, no_entry_num:54 },
  ];
  const grouped = aggregatePreEntryFixtureV27(rows);
  assert.deepEqual(
    { ...grouped.get("NAK1TSP863") },
    {
      proofId:"NAK1TSP863",
      routeName:"FD-4W-2WGT-CCH-NE1-17:40-BD-RS2",
      expectedParcels:97,
      enteredParcels:95,
      pendingParcels:2,
      nextStoreName:"02 NE1_HUB-นครราชสีมา",
      segments:2,
    },
  );
  assert.equal(grouped.get("AYU1TS8R72")?.expectedParcels, 355, "duplicate pages must not double 355");
});

test("V27 staged frontend uses corrected V25 truth and copy removes status while bag copy includes latest", () => {
  const front = stageFrontend(frontendSource);
  assert.match(front, /PNO_MODAL_COPY_MULTIDROP_TRUTH_V27/);
  assert.match(front, /pnoOperationalSummaryForRow\(row\)/);
  assert.match(front, /\["#", "เลขถุงแบ็กกิ้ง", "ล่าสุด", "จำนวนพัสดุ", "HUB ถัดไป", "สาขาถัดไป"\]/);
  assert.match(front, /\["#", "PNO", "ล่าสุด", "HUB ปลายทาง", "สาขาปลายทาง", "เวลา"\]/);
  const copyStart = front.indexOf("async function pnoV18Copy()");
  const copyEnd = front.indexOf("function pnoV18LineCell", copyStart);
  const copy = front.slice(copyStart, copyEnd);
  assert.doesNotMatch(copy, /"สถานะ"/);
});

test("V27 Backing HUB uses route next_store_name and never emits หลาย HUB", () => {
  const front = stageFrontend(frontendSource);
  const start = front.indexOf("function pnoV18BagSummary(items)");
  const end = front.indexOf("function pnoV18RenderBags", start);
  const block = front.slice(start, end);
  assert.match(block, /sourceRow\?\.pnoNextStoreName/);
  assert.doesNotMatch(block, /หลาย HUB/);
  assert.doesNotMatch(block, /\(item\) => item\.targetHub/);
});

test("V27 LINE bag copy sorts HUB -> status -> bag and shows every bag without 30-row cap", () => {
  const front = stageFrontend(frontendSource);
  const start = front.indexOf("async function pnoV18CopyLine()");
  const end = front.indexOf("async function pnoV18Export", start);
  const block = front.slice(start, end);
  assert.match(block, /a\.summary\.hub\.localeCompare/);
  assert.match(block, /a\.summary\.status\.localeCompare/);
  assert.match(block, /a\.bag\.localeCompare/);
  assert.match(block, /groups\.forEach/);
  assert.doesNotMatch(block, /pnoV18AppendLineLimited\(lines, groups/);
  assert.match(block, /group\.summary\.hub[\s\S]*group\.summary\.status[\s\S]*group\.bag[\s\S]*group\.items\.length/);
});

test("V27 staged worker exposes one route next HUB and sums multi-drop using already-fetched PreEntry rows only", () => {
  const worker = stageWorker(workerSource);
  assert.match(worker, /PNO_PREENTRY_MULTIDROP_SUM_V27/);
  assert.match(worker, /pnoNextStoreName/);
  assert.match(worker, /const uniqueSegments = new Map\(\)/);
  assert.match(worker, /const grouped = new Map\(\)/);
  const start = worker.indexOf("// PNO_PREENTRY_MULTIDROP_SUM_V27");
  const end = worker.indexOf("return counts;", start);
  const block = worker.slice(start, end);
  assert.doesNotMatch(block, /fetch\(|setInterval|setTimeout|DB\.prepare|INSERT|UPDATE|DELETE/i);
});

test("V27 is staging-idempotent and does not touch BusTime cadence", async () => {
  const front1 = stageFrontend(frontendSource);
  const worker1 = stageWorker(workerSource);
  assert.equal(stageFrontend(front1), front1);
  assert.equal(stageWorker(worker1), worker1);
  const busRuntime = await readFile(new URL(".github/dev-tools/bus-time-hot-lane-v14-runtime.mjs", root), "utf8");
  assert.match(busRuntime, /BUS_TIME_HOT_REUSE_MS = 12_000/);
  assert.match(busRuntime, /BUS_TIME_RATE_LIMIT_BASE_COOLDOWN_MS = 5 \* 60 \* 1000/);
});
