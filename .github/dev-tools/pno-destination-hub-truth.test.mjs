import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { stageFrontend, stageWorker } from "./stage-dev-runtime.mjs";
import { patchPnoDestinationHubFrontend, patchPnoDestinationHubWorker } from "./patch-pno-destination-hub-truth.mjs";

const sourceWorker = readFileSync(new URL("../../worker/src/index.js", import.meta.url), "utf8");
const sourceFrontend = readFileSync(new URL("../../ms.js", import.meta.url), "utf8");
const worker = stageWorker(sourceWorker);
const frontend = stageFrontend(sourceFrontend);
const start = worker.indexOf("const rows = rawRows.slice(0, PNO_PAGE_SIZE)");
const detail = worker.slice(start, worker.indexOf("const total = Number(detail?.total)", start));
const destinationExpression = detail.match(/targetHub:\s*(cleanStoreName\(row\.dst_hub_name\)),/);
const nextStoreExpression = detail.match(/targetBranch:\s*(cleanStoreName\(row\.next_store_name\)),/);
const cleanStoreName = (value) => String(value ?? "").trim().replace(/^\s*\([^)]*\)\s*/, "").trim();
const project = (expression) => vm.runInNewContext(`(row, cleanStoreName) => ${expression[1]}`);
const targetHub = destinationExpression && project(destinationExpression);
const targetBranch = nextStoreExpression && project(nextStoreExpression);

function bagSummary(items) {
  const start = frontend.indexOf("function pnoV18BagValue(items");
  const end = frontend.indexOf("function pnoV18BagLatest", start);
  const summaryStart = frontend.indexOf("function pnoV18BagSummary(items)");
  const summaryEnd = frontend.indexOf("function pnoV18RenderBags", summaryStart);
  assert.ok(start > -1 && end > start && summaryStart > -1 && summaryEnd > summaryStart);
  const context = { pnoV18BagLatest: () => "" };
  vm.runInNewContext(frontend.slice(start, end) + frontend.slice(summaryStart, summaryEnd) +
    "this.summary = pnoV18BagSummary;", context);
  return context.summary(items);
}

test("PNO detail destination has only dst_hub_name authority; PreEntry trip mapping is unchanged", () => {
  assert.ok(destinationExpression && nextStoreExpression);
  assert.equal((detail.match(/targetHub:/g) || []).length, 1);
  assert.doesNotMatch(detail, /targetHub:\s*cleanStoreName\(row\.dst_hub_name\s*\|\|/);
  const tripProjection = "targetHub: cleanStoreName(row.next_store_name || row.next_hub_name || row.target_hub_name || row.dst_hub_name || row.destination_hub_name || row.ticket_delivery_hub_name || row.end_hub_name)";
  assert.ok(sourceWorker.includes(tripProjection));
  assert.ok(worker.includes(tripProjection));
});

test("current HUB differs from destination, and a missing next store stays unknown", () => {
  const sameNext = { store_name: "CURRENT_HUB", dst_hub_name: "DEST_HUB", next_store_name: "DEST_HUB" };
  assert.equal(targetHub(sameNext, cleanStoreName), "DEST_HUB");
  assert.equal(targetBranch(sameNext, cleanStoreName), "DEST_HUB");
  const missingNext = { ...sameNext, next_store_name: null };
  assert.equal(targetHub(missingNext, cleanStoreName), "DEST_HUB");
  assert.equal(targetBranch(missingNext, cleanStoreName), "");
});

test("destination and next store remain independent, and missing destination has no fallback", () => {
  const separate = { dst_hub_name: "HUB_A", next_store_name: "STORE_B", ticket_delivery_store_name: "DELIVERY_C" };
  assert.equal(targetHub(separate, cleanStoreName), "HUB_A");
  assert.equal(targetBranch(separate, cleanStoreName), "STORE_B");
  const unrelated = { dst_hub_name: "", next_store_name: "NEXT", store_name: "CURRENT",
    ticket_delivery_store_name: "DELIVERY", hub_name: "CURRENT_HUB", next_hub_name: "NEXT_HUB",
    target_hub_name: "TARGET_HUB", targetHub: "FALLBACK_HUB" };
  assert.equal(targetHub(unrelated, cleanStoreName), "");
  assert.equal(targetBranch(unrelated, cleanStoreName), "NEXT");
  assert.equal(targetHub({ dst_hub_name: "  (CODE) DEST_HUB  " }, cleanStoreName), "DEST_HUB");
});

test("bag HUB uses unique nonempty parcel destinations, independent of delivery stores", () => {
  const parcels = [
    { targetHub: targetHub({ dst_hub_name: "DEST_HUB", ticket_delivery_store_name: "BRANCH_A" }, cleanStoreName), targetBranch: "NEXT_A" },
    { targetHub: targetHub({ dst_hub_name: "DEST_HUB", ticket_delivery_store_name: "BRANCH_B" }, cleanStoreName), targetBranch: "NEXT_A" },
    { targetHub: "", targetBranch: "" },
  ];
  assert.equal(bagSummary(parcels).hub, "DEST_HUB");
  assert.equal(bagSummary(parcels).branch, "NEXT_A");
  assert.equal(bagSummary([{ targetHub: "HUB_A" }, { targetHub: "HUB_B" }]).hub, "หลาย HUB");
  assert.equal(bagSummary([{ targetHub: "" }, { targetHub: "" }]).hub, "-");
  assert.equal(bagSummary([{ targetHub: "HUB_A", targetBranch: "NEXT_A" },
    { targetHub: "HUB_A", targetBranch: "NEXT_B" }]).branch, "หลายสาขา");
});

test("parcel table, Copy and Export use the exact owner labels; LINE preserves two values", () => {
  assert.equal(frontend.split("ฮับปลายทาง").length - 1, 5);
  assert.doesNotMatch(frontend, /จุดที่ระบุในข้อมูลพัสดุ|สาขาปลายทาง|HUB ปลายทาง/);
  assert.match(frontend, /<th>ฮับปลายทาง<\/th><th>ชื่อสาขาต่อไป<\/th>/);
  assert.match(frontend, /\["#", "PNO", "สถานะหลักฐาน", "ล่าสุด", "ฮับปลายทาง", "ชื่อสาขาต่อไป", "เวลา"\]/);
  assert.match(frontend, /"ฮับปลายทาง": row\.targetHub \|\| ""/);
  assert.match(frontend, /"ชื่อสาขาต่อไป": row\.targetBranch \|\| ""/);
  assert.match(frontend, /pnoV18LineCell\(row\.targetHub\) \+ " > " \+ pnoV18LineCell\(row\.targetBranch\)/);
  assert.match(frontend, /esc\(item\.targetHub \|\| "-"\)/);
});

test("scan-gap shares the destination projection and common filters omit HUB", () => {
  assert.match(frontend, /type === "scan_gap"/);
  assert.match(frontend, /"ฮับปลายทาง": row\.targetHub \|\| ""/);
  assert.match(frontend, /\["branch", "ชื่อสาขาต่อไป", branches\]/);
  assert.match(frontend, /\["status", "สถานะ", statuses\]/);
  assert.match(frontend, /\["action", "การดำเนินการล่าสุด", actions\]/);
  const filters = frontend.slice(frontend.indexOf("function pnoV18RenderFilters("), frontend.indexOf("function pnoV18RenderRows("));
  assert.doesNotMatch(filters, /\["hub"|bagHub|pnoNextStoreName/);
});

test("patches are idempotent and introduce no acquisition or background machinery", () => {
  assert.equal(patchPnoDestinationHubWorker(worker), worker);
  assert.equal(patchPnoDestinationHubFrontend(frontend), frontend);
  const patch = readFileSync(new URL("./patch-pno-destination-hub-truth.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(patch, /\bfetch\s*\(|curl_pno|setInterval\s*\(|setTimeout\s*\(|WebSocket|EventSource|DB\.prepare|INSERT\s+INTO|UPDATE\s+[A-Z]|DELETE\s+FROM/i);
});
