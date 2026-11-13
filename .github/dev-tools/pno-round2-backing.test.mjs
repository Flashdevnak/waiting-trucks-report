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

test("Round2 stages PNO for destination + drop-point while origin remains excluded", () => {
  assert.match(worker, /PNO_ROUND2_BARCODE_BACKING_V2/);
  assert.ok(worker.includes('mapped.attendanceType === "ปลายทาง" || mapped.attendanceType === "จุดดรอป"'));
  assert.ok(worker.includes('["ปลายทาง", "จุดดรอป"].includes(normalizeMsAttendance(row?.attendanceType))'));
});

test("Round2 uses exact Barcode proofId as the one-truck identity", () => {
  assert.match(worker, /function pnoViewKey\(row\)[\s\S]*return normalizeProofId\(row\?\.proofId\)/);
  assert.match(worker, /function preEntrySemanticKey\(value\)[\s\S]*return normalizeProofId\(value\?\.proofId\)/);
  assert.ok(!frontend.includes("ข้อมูล Barcode ซ้ำ"));
});

test("Round2 maps FBI pack_no first and preserves Backing rows", () => {
  assert.match(worker, /backingNo: text\(row\.pack_no \|\| row\.backingNo/);
  assert.match(worker, /filter\(\(row\) => row\.pno \|\| row\.backingNo\)/);
  // DEV002 explicit QR contract migration; original P25 assertions preserved in handoff history.
  // Preserve code order/data mapping; require both added QR columns, never just remove the failing assertion.
  assert.ok(frontend.includes("<th>PNO</th><th>QR Code</th><th>Backing / Bagging</th><th>QR Code</th>"));
  assert.ok(frontend.includes('pnoQrMarkup(item.pno)') && frontend.includes('pnoQrMarkup(item.backingNo)'));
  const start=frontend.indexOf('async function pnoQrLegacyExport009() {');
  const exportBody=frontend.slice(start,frontend.indexOf('\n}\n',start)+2);
  assert.ok(start>0);
  assert.ok(exportBody.includes("'เลขพัสดุ':item.pno") && exportBody.includes("'Backing / Bagging':item.backingNo||''"));
  assert.ok(exportBody.includes("qrKeys:['เลขพัสดุ','Backing / Bagging']"));
  assert.ok(exportBody.includes('await pnoV18EnsureParcelFilterRows(); if(!current())return;') && exportBody.includes('current()'));
});

test("Round2 locks latest accepted v8 progress/status palette", () => {
  for (const token of [
    "#b93a2f", "#e46a5e", "#b87900", "#f0b51c", "#3b8b58", "#74bf8d",
    "#202428", "#30363a", "#3b4145", "#b48f00", "#ffd42f", "#e5e8ea", "#313638",
    "ต่ำกว่าเป้า", "กำลังเข้าคลัง", "ผ่านเป้า", "เข้าคลังครบ",
  ]) assert.ok(frontend.includes(token), `missing v8 token ${token}`);
});

test("Round2 patch remains idempotent and adds no background PNO timer/SQL persistence", () => {
  assert.equal(patchPnoRound2Frontend(frontend), frontend);
  assert.equal(patchPnoRound2Worker(worker), worker);
  assert.ok(!/setInterval\s*\(|setTimeout\s*\(/.test(patchSource));
  assert.ok(!/\b(?:INSERT|UPDATE|DELETE|CREATE\s+TABLE)\b/i.test(patchSource));
});
