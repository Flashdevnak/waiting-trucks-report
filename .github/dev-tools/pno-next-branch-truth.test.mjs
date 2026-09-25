import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { stageFrontend, stageWorker } from "./stage-dev-runtime.mjs";
import { patchPnoNextBranchTruthWorker, patchPnoDestinationLabelsFrontend } from "./patch-pno-next-branch-truth.mjs";

const worker = stageWorker(readFileSync(new URL("../../worker/src/index.js", import.meta.url), "utf8"));
const frontend = stageFrontend(readFileSync(new URL("../../ms.js", import.meta.url), "utf8"));
const projection = worker.slice(worker.indexOf("const rows = rawRows.slice(0, PNO_PAGE_SIZE)"),
  worker.indexOf("const total = Number(detail?.total)", worker.indexOf("const rows = rawRows.slice(0, PNO_PAGE_SIZE)")));
const expression = projection.match(/targetBranch:\s*(cleanStoreName\(row\.next_store_name\)),/);
const cleanStoreName = (value) => String(value ?? "").trim().replace(/^\s*\([^)]*\)\s*/, "").trim();
const nextBranch = expression && vm.runInNewContext(`(row, cleanStoreName) => ${expression[1]}`);

function bagFunctions() {
  const names = ["pnoV18BagGroups", "pnoV18BagValue", "pnoV18BagSummary"];
  const blocks = names.map((name) => {
    const start = frontend.indexOf(`function ${name}(`);
    assert.ok(start > -1, `${name} is in the staged frontend`);
    const end = frontend.indexOf("\nfunction ", start + 10);
    return frontend.slice(start, end);
  });
  const context = {
    pnoV18SourceRow: () => ({ pnoNextStoreName: "NEXT_STOP_A" }),
    pnoV18TextValue: (value) => String(value || "-").trim(),
    pnoV18BagLatest: () => "",
    state: { branch: "CURRENT_HUB_A" },
  };
  vm.createContext(context);
  vm.runInContext(`${blocks.join("\n")};this.group = pnoV18BagGroups;this.summary = pnoV18BagSummary`, context);
  return context;
}

test("parcel next-store projection uses only next_store_name", () => {
  assert.ok(expression, "staged detail projects next_store_name");
  assert.doesNotMatch(projection, /targetBranch:\s*cleanStoreName\([^\n]*(?:ticket_delivery|ticket_pickup|dst_store|target_store|destination_store|end_store|row\.targetBranch)/);
  assert.equal(nextBranch({ next_store_name: "NEXT_A", ticket_delivery_store_name: "DELIVERY_A" }, cleanStoreName), "NEXT_A");
  assert.equal(nextBranch({ next_store_name: "NEXT_A", ticket_delivery_store_name: "DELIVERY_B" }, cleanStoreName), "NEXT_A", "delivery branch must not win");
  assert.equal(nextBranch({ next_store_name: "", ticket_delivery_store_name: "DELIVERY_A", ticket_pickup_store_name: "PICKUP_A" }, cleanStoreName), "", "missing next store remains unknown");
  assert.equal(nextBranch({ next_store_name: "  (CODE_A) NEXT_A  ", ticket_delivery_store_name: "DELIVERY_A" }, cleanStoreName), "NEXT_A");
  assert.equal(patchPnoNextBranchTruthWorker(worker), worker, "staging patch remains idempotent");
});

test("different next stores remain distinct despite a shared delivery branch", () => {
  const segmentA = { next_store_name: "NEXT_A", ticket_delivery_store_name: "DELIVERY_A" };
  const segmentB = { next_store_name: "NEXT_B", ticket_delivery_store_name: "DELIVERY_A" };
  assert.notEqual(nextBranch(segmentA, cleanStoreName), nextBranch(segmentB, cleanStoreName));
});

test("bag summary uses corrected next-store values and keeps HUB next unchanged", () => {
  const { group, summary } = bagFunctions();
  const rows = [
    { backingNo: "BAG_A", targetBranch: nextBranch({ next_store_name: "NEXT_A", ticket_delivery_store_name: "DELIVERY_A" }, cleanStoreName) },
    { backingNo: "BAG_A", targetBranch: nextBranch({ next_store_name: "NEXT_A", ticket_delivery_store_name: "DELIVERY_B" }, cleanStoreName) },
  ];
  const groups = group(rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0][0], "BAG_A");
  assert.equal(summary(groups[0][1]).branch, "NEXT_A");
  assert.equal(summary(groups[0][1]).hub, "NEXT_STOP_A", "route-level next store is unchanged");
  assert.equal(summary([{ targetBranch: "NEXT_A" }, { targetBranch: "NEXT_B" }]).branch, "หลายสาขา");
  assert.equal(summary([{ targetBranch: "" }, { targetBranch: "" }]).branch, "-");
});

test("staged parcel and bag labels expose next-store semantics without asserting a final HUB", () => {
  assert.doesNotMatch(frontend, /HUB ปลายทาง|สาขาถัดไป|สาขาปลายทาง/);
  assert.match(frontend, /<th>จุดที่ระบุในข้อมูลพัสดุ<\/th><th>ชื่อสาขาต่อไป<\/th>/);
  assert.match(frontend, /<th>HUB ถัดไป<\/th><th>ชื่อสาขาต่อไป<\/th>/);
  assert.match(frontend, /"จุดที่ระบุในข้อมูลพัสดุ": row\.targetHub/);
  assert.match(frontend, /"ชื่อสาขาต่อไป": row\.targetBranch/);
  assert.match(frontend, /PNO_NEXT_STORE_SEMANTICS_V3/);
  assert.doesNotMatch(frontend, /HUBปลายทาง/);
  assert.equal(patchPnoDestinationLabelsFrontend(frontend), frontend, "frontend staging is idempotent");
});

test("all PNO detail modes, copying, filtering and exporting use the shared projection", () => {
  assert.match(worker, /type: locator\.type/);
  assert.match(frontend, /pnoV18Fetch\("total", 1\)/);
  assert.match(frontend, /pnoV18Fetch\(type, page\)/);
  assert.match(frontend, /item\.targetBranch/);
  assert.match(frontend, /row\.targetBranch/);
  assert.match(frontend, /summary\.branch/);
});
