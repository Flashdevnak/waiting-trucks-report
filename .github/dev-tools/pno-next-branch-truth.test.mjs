import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { stageFrontend, stageWorker } from "./stage-dev-runtime.mjs";
import { patchPnoNextBranchTruthWorker } from "./patch-pno-next-branch-truth.mjs";

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
    pnoV18SourceRow: () => ({ pnoNextStoreName: "02 NE1_HUB-นครราชสีมา" }),
    pnoV18TextValue: (value) => String(value || "-").trim(),
    pnoV18BagLatest: () => "",
    state: { branch: "NE1" },
  };
  vm.createContext(context);
  vm.runInContext(`${blocks.join("\n")};this.group = pnoV18BagGroups;this.summary = pnoV18BagSummary`, context);
  return context;
}

test("staged PNO detail uses only provider next_store_name for next branch", () => {
  assert.ok(expression, "production projection must call cleanStoreName(row.next_store_name)");
  assert.doesNotMatch(projection, /targetBranch:\s*cleanStoreName\([^\n]*(?:ticket_delivery|ticket_pickup|dst_store|target_store|destination_store|end_store|row\.targetBranch)/);
  assert.equal(nextBranch({ next_store_name: "11 NE4_HUB-อุบลราชธานี", ticket_delivery_store_name: "5BKT_PDC-บางขุนเทียน" }, cleanStoreName), "11 NE4_HUB-อุบลราชธานี");
  assert.equal(nextBranch({ next_store_name: "NE4", ticket_pickup_store_name: "other" }, cleanStoreName), "NE4");
  assert.equal(nextBranch({ next_store_name: "", ticket_pickup_store_name: "pickup", ticket_delivery_store_name: "delivery", hub_name: "current", targetBranch: "fallback" }, cleanStoreName), "");
  assert.equal(patchPnoNextBranchTruthWorker(worker), worker, "staging patch is idempotent");
});

test("bag groups by backing and reports only genuine next-branch differences", () => {
  const { group, summary } = bagFunctions();
  const same = [
    { backingNo: "P2950875827", targetBranch: nextBranch({ next_store_name: "NE4", ticket_delivery_store_name: "branch A" }, cleanStoreName) },
    { backingNo: "P2950875827", targetBranch: nextBranch({ next_store_name: "NE4", ticket_delivery_store_name: "branch B" }, cleanStoreName) },
  ];
  const groups = group(same);
  assert.equal(groups.length, 1);
  assert.equal(groups[0][0], "P2950875827");
  assert.equal(summary(groups[0][1]).branch, "NE4");
  assert.equal(summary(groups[0][1]).hub, "02 NE1_HUB-นครราชสีมา", "unresolved HUB is untouched");
  assert.equal(summary([{ targetBranch: "NE4" }, { targetBranch: "NE5" }]).branch, "หลายสาขา");
  assert.equal(summary([{ targetBranch: "" }, { targetBranch: "" }]).branch, "-");
});

test("all PNO detail modes, copying, filtering and exporting use the shared projection", () => {
  assert.match(worker, /type: locator\.type/);
  assert.match(frontend, /pnoV18Fetch\("total", 1\)/);
  assert.match(frontend, /pnoV18Fetch\(type, page\)/);
  assert.match(frontend, /item\.targetBranch/);
  assert.match(frontend, /row\.targetBranch/);
  assert.match(frontend, /summary\.branch/);
  assert.match(frontend, /"สาขาปลายทาง": row\.targetBranch/);
});
