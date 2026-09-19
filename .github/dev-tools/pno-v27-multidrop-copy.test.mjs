import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  aggregatePreEntryFixtureV27,
  patchPnoV27Frontend,
  patchPnoV27Worker,
  correctPendingFixtureV28,
  patchPnoV28PendingIntersection,
  patchTbrSeedV28Frontend,
  patchTbrSeedV28Worker,
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
  assert.doesNotMatch(block, /fetch\(|setInterval|setTimeout|DB\.prepare|INSERT\s+INTO|UPDATE\s+[A-Za-z_]|DELETE\s+FROM/i);
});

test("V27 is staging-idempotent and does not touch BusTime cadence", async () => {
  const front1 = stageFrontend(frontendSource);
  const worker1 = stageWorker(workerSource);
  assert.equal(patchPnoV27Frontend(front1), front1);
  assert.equal(patchPnoV27Worker(worker1), worker1);
  const busRuntime = await readFile(new URL(".github/dev-tools/bus-time-hot-lane-v14-runtime.mjs", root), "utf8");
  assert.match(busRuntime, /BUS_TIME_HOT_REUSE_MS = 12_000/);
  assert.match(busRuntime, /BUS_TIME_RATE_LIMIT_BASE_COOLDOWN_MS = 5 \* 60 \* 1000/);
});


test("V28 current AYU pending-membership fixture resolves 355/301/54 to 355/310/45", () => {
  const total = Array.from({ length: 355 }, (_, i) => ({ pno: "P" + i, ownHubBacking: false }));
  const pending = total.slice(301).map((item) => ({ ...item }));
  for (let i = 0; i < 9; i += 1) total[301 + i].ownHubBacking = true;
  assert.deepEqual(
    correctPendingFixtureV28({ expected:355, entered:301, pending:54 }, total, pending),
    { valid:true, expected:355, entered:310, pending:45, correction:9 },
  );
});

test("V28 preserves previous 355/253/102 -> 354/1 acceptance and prevents already-side double count", () => {
  const total = Array.from({ length: 355 }, (_, i) => ({ pno: "Q" + i, ownHubBacking: false }));
  const pending = total.slice(253).map((item) => ({ ...item }));
  for (let i = 0; i < 101; i += 1) total[253 + i].ownHubBacking = true;
  assert.deepEqual(
    correctPendingFixtureV28({ expected:355, entered:253, pending:102 }, total, pending),
    { valid:true, expected:355, entered:354, pending:1, correction:101 },
  );
  total[0].ownHubBacking = true;
  assert.equal(
    correctPendingFixtureV28({ expected:355, entered:253, pending:102 }, total, pending).correction,
    101,
    "Backing outside provider pending set must never be added again",
  );
});

test("V28 staged frontend replaces already-detail correction with provider pending membership", () => {
  const front = stageFrontend(frontendSource);
  assert.match(front, /PNO_PENDING_MEMBERSHIP_INTERSECTION_V28/);
  const start = front.indexOf("async function pnoOperationalResolve(row)");
  const end = front.indexOf("function pnoOperationalPaginate", start);
  const block = front.slice(start, end);
  assert.match(block, /pnoOperationalLoadAllRaw\(row, "no_entry"\)/);
  assert.doesNotMatch(block, /pnoOperationalLoadAllRaw\(row, "already"\)/);
  assert.match(front, /OWN_HUB_PENDING_BACKING_CORRECTED/);
});

test("V28 HAR seed keeps bounded fleet_sign_info candidates on both frontend and worker", () => {
  const front = stageFrontend(frontendSource);
  const worker = stageWorker(workerSource);
  assert.match(front, /BUS_TIME_TBR_FIELD_TRUTH_V28/);
  assert.match(front, /fleet_sign_info: compactBusHarField\(item\?\.fleet_sign_info, 6\)/);
  assert.match(worker, /BUS_TIME_TBR_FIELD_TRUTH_V28/);
  assert.match(worker, /fleet_sign_info: compactBusSeedField\(item\?\.fleet_sign_info, 6\)/);
  assert.equal(patchPnoV28PendingIntersection(front), front);
  assert.equal(patchTbrSeedV28Frontend(front), front);
  assert.equal(patchTbrSeedV28Worker(worker), worker);
});
