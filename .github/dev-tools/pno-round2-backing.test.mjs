import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { stageFrontend, stageWorker } from "./stage-dev-runtime.mjs";
import { patchPnoRound2Frontend, patchPnoRound2Worker } from "./patch-pno-round2-v1.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const [canonicalFrontend, canonicalWorker, patchSource] = await Promise.all([
  readFile(join(root, "ms.js"), "utf8"),
  readFile(join(root, "worker/src/index.js"), "utf8"),
  readFile(join(here, "patch-pno-round2-v1.mjs"), "utf8"),
]);
const frontend = stageFrontend(canonicalFrontend);
const worker = stageWorker(canonicalWorker);

test("Round2 staged Worker enables PNO for destination + drop and keeps origin excluded", () => {
  assert.match(worker, /mapped\.attendanceType === "ปลายทาง" \|\| mapped\.attendanceType === "จุดดรอป"/);
  assert.match(worker, /\["ปลายทาง", "จุดดรอป"\]\.includes\(normalizeMsAttendance/);
  assert.match(worker, /PNO_ROUND2_BARCODE_BACKING_V1/);
});

test("Round2 uses exact Barcode proofId as trip key without user-facing duplicate state", () => {
  assert.match(worker, /function pnoViewKey\(row\)[\s\S]*return normalizeProofId\(row\?\.proofId\)/);
  assert.match(worker, /function preEntrySemanticKey\(value\)[\s\S]*return normalizeProofId\(value\?\.proofId\)/);
  assert.ok(!frontend.includes("ข้อมูล Barcode ซ้ำ"));
});

test("Round2 preserves FBI pack_no as Backing/Bagging without creating a new piece", () => {
  assert.match(worker, /backingNo: text\(row\.pack_no \|\| row\.backingNo/);
  assert.match(worker, /filter\(\(row\) => row\.pno \|\| row\.backingNo\)/);
  assert.ok(frontend.includes("<th>PNO</th><th>Backing / Bagging</th>"));
  assert.match(frontend, /row\.pno \|\| ""}\t\$\{row\.backingNo \|\| ""/);
  assert.match(frontend, /"Backing \/ Bagging": row\.backingNo \|\| ""/);
});

test("Round2 stages the latest accepted v8 progress palette and labels", () => {
  for (const token of [
    "#b93a2f", "#e46a5e", "#b87900", "#f0b51c", "#3b8b58", "#74bf8d",
    "#202428", "#30363a", "#3b4145", "#b48f00", "#ffd42f", "#e5e8ea", "#313638",
    "ต่ำกว่าเป้า", "กำลังเข้าคลัง", "ผ่านเป้า", "เข้าคลังครบ",
  ]) assert.ok(frontend.includes(token), `missing v8 token ${token}`);
});

test("Round2 patch is idempotent and adds no background timer or SQL persistence", () => {
  assert.equal(patchPnoRound2Frontend(frontend), frontend);
  assert.equal(patchPnoRound2Worker(worker), worker);
  assert.ok(!/setInterval\s*\(|setTimeout\s*\(/.test(patchSource));
  assert.ok(!/\b(?:INSERT|UPDATE|DELETE|CREATE\s+TABLE)\b/i.test(patchSource));
});
