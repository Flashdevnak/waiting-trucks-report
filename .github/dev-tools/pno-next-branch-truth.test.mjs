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
const expression = projection.match(/targetBranch:\s*(cleanStoreName\(row\.ticket_delivery_store_name\)),/);
const cleanStoreName = (value) => String(value ?? "").trim().replace(/^\s*\([^)]*\)\s*/, "").trim();
const deliveryBranch = expression && vm.runInNewContext(`(row, cleanStoreName) => ${expression[1]}`);

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

test("parcel destination branch comes only from provider delivery store, never the next segment", () => {
  assert.ok(expression, "staged detail projects the delivery store name");
  assert.doesNotMatch(projection, /targetBranch:\s*cleanStoreName\([^\n]*(?:next_store|ticket_pickup|dst_store|target_store|destination_store|end_store|row\.targetBranch)/);
  assert.equal(deliveryBranch({ next_store_name: "NEXT_STOP_A", ticket_delivery_store_name: "DELIVERY_A" }, cleanStoreName), "DELIVERY_A");
  assert.equal(deliveryBranch({ next_store_name: "NEXT_STOP_A", ticket_delivery_store_name: "NEXT_STOP_A" }, cleanStoreName), "NEXT_STOP_A", "independent source values may match");
  assert.equal(deliveryBranch({ next_store_name: "NEXT_STOP_A", hub_name: "HUB_A", ticket_delivery_store_name: "" }, cleanStoreName), "", "missing branch remains unknown");
  assert.equal(deliveryBranch({ next_store_name: "NEXT_STOP_A", ticket_pickup_store_name: "PICKUP_A" }, cleanStoreName), "");
  assert.equal(deliveryBranch({ next_store_name: "NEXT_STOP_A", ticket_delivery_store_name: "  (CODE_A) DELIVERY_A  " }, cleanStoreName), "DELIVERY_A");
  assert.equal(patchPnoNextBranchTruthWorker(worker), worker, "staging patch remains idempotent");
});

test("same parcel delivery branch is independent of different next stops", () => {
  const segmentA = { next_store_name: "NEXT_STOP_A", ticket_delivery_store_name: "DELIVERY_A" };
  const segmentB = { next_store_name: "NEXT_STOP_B", ticket_delivery_store_name: "DELIVERY_A" };
  assert.notEqual(segmentA.next_store_name, segmentB.next_store_name);
  assert.equal(deliveryBranch(segmentA, cleanStoreName), deliveryBranch(segmentB, cleanStoreName));
  assert.equal(deliveryBranch({ next_store_name: "NEXT_STOP_B" }, cleanStoreName), "", "unknown occurrence must not synthesize a branch");
});

test("bag groups use actual delivery branches while keeping segment next store separate", () => {
  const { group, summary } = bagFunctions();
  const rows = [
    { backingNo: "BAG_A", targetBranch: deliveryBranch({ next_store_name: "NEXT_STOP_A", ticket_delivery_store_name: "DELIVERY_A" }, cleanStoreName) },
    { backingNo: "BAG_A", targetBranch: deliveryBranch({ next_store_name: "NEXT_STOP_A", ticket_delivery_store_name: "DELIVERY_B" }, cleanStoreName) },
  ];
  const groups = group(rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0][0], "BAG_A");
  assert.equal(summary(groups[0][1]).branch, "หลายสาขา");
  assert.equal(summary(groups[0][1]).hub, "NEXT_STOP_A", "route-level next store is unchanged");
  assert.equal(summary([{ targetBranch: "DELIVERY_A" }, { targetBranch: "DELIVERY_A" }]).branch, "DELIVERY_A");
  assert.equal(summary([{ targetBranch: "" }, { targetBranch: "" }]).branch, "-");
});

test("staged parcel and bag labels match their evidence without asserting a final HUB", () => {
  assert.doesNotMatch(frontend, /HUB ปลายทาง|สาขาถัดไป/);
  assert.match(frontend, /<th>จุดที่ระบุในข้อมูลพัสดุ<\/th><th>สาขาปลายทาง<\/th>/);
  assert.match(frontend, /<th>HUB ถัดไป<\/th><th>สาขาปลายทาง<\/th>/);
  assert.match(frontend, /"จุดที่ระบุในข้อมูลพัสดุ": row\.targetHub/);
  assert.match(frontend, /"สาขาปลายทาง": row\.targetBranch/);
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
