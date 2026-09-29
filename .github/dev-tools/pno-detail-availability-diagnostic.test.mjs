import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { detailEligibilityFixtureV30 } from "./patch-pno-detail-affordance-recovery.mjs";
import { patchPnoDetailAvailabilityDiagnostic, summarizePnoDetailAvailability } from
  "./patch-pno-detail-availability-diagnostic.mjs";
import { stageFrontend } from "./stage-dev-runtime.mjs";

const root = new URL("../../", import.meta.url);
const staged = stageFrontend(readFileSync(new URL("ms.js", root), "utf8"));
const base = {
  proofId: "SECRET-PROOF-123", attendanceType: "ปลายทาง",
  expectedParcels: 3, enteredParcels: 1, pendingParcels: 2,
  pnoSourceDay: "2026-09-29", pnoLineId: "SECRET-LINE-123", pnoVanLineId: "",
  pnoStoreId: "SECRET-STORE-123", pnoNextStoreId: "SECRET-NEXT-123",
  pnoSegmentCount: 1, pnoDetailAvailable: true, pnoEnabled: true, pnoState: "OK",
  backingNo: "SECRET-BACKING-123", pno: "SECRET-PNO-123",
  phone: "SECRET-PHONE-123", customer: "SECRET-CUSTOMER-123",
  token: "SECRET-TOKEN-123", authorization: "SECRET-BEARER-123",
};
const row = (changes = {}) => ({ ...base, ...changes });
const summarize = (rows) => summarizePnoDetailAvailability(rows, detailEligibilityFixtureV30, 99);

test("diagnostic reasons exactly follow V30 eligibility, including fail-closed segment ordering", () => {
  const cases = [
    [row(), "OK"],
    [row({ pnoSegmentCount: undefined }), "SEGMENT_UNKNOWN"],
    [row({ pnoSegmentCount: 0 }), "SEGMENT_UNKNOWN"],
    [row({ pnoSegmentCount: 2, pnoSourceDay: "" }), "AMBIGUOUS_OCCURRENCE"],
    [row({ proofId: "" }), "LOCATOR_INCOMPLETE"],
    [row({ pnoSourceDay: "" }), "LOCATOR_INCOMPLETE"],
    [row({ pnoLineId: "", pnoVanLineId: "" }), "LOCATOR_INCOMPLETE"],
    [row({ pnoStoreId: "" }), "LOCATOR_INCOMPLETE"],
    [row({ pnoNextStoreId: "" }), "LOCATOR_INCOMPLETE"],
    [row({ proofId: "", pnoSourceDay: "", pnoStoreId: "" }), "LOCATOR_INCOMPLETE"],
    [row({ pnoDetailAvailable: false }), "DETAIL_DISABLED"],
    [row({ attendanceType: "ต้นทาง" }), "NOT_INBOUND"],
  ];
  for (const [item, expected] of cases) {
    const result = summarize([item]);
    assert.equal(result.reason[expected], 1, expected);
    assert.equal(result.detailAvailable, expected === "OK" ? 1 : 0);
  }
});

test("mixed aggregate counts, presence, segments, and incomplete dimensions are exact", () => {
  const rows = [row(), row({ pnoSegmentCount: undefined, pnoEnabled: false }),
    row({ pnoSegmentCount: 2, pnoVanLineId: "SECRET-VAN-123" }),
    row({ proofId: "", pnoSourceDay: "", pnoLineId: "", pnoVanLineId: "",
      pnoStoreId: "", pnoNextStoreId: "", pnoDetailAvailable: false, pnoState: "LOCATOR_INCOMPLETE" }),
    row({ pnoDetailAvailable: false }), row({ attendanceType: "ต้นทาง" })];
  const result = summarize(rows);
  assert.equal(result.sourceRowCount, 99);
  assert.equal(result.totalRows, 6);
  assert.equal(result.detailAvailable, 1);
  assert.equal(result.detailUnavailable, 5);
  assert.deepEqual(result.reason, { OK: 1, NOT_INBOUND: 1, SEGMENT_UNKNOWN: 1,
    AMBIGUOUS_OCCURRENCE: 1, LOCATOR_INCOMPLETE: 1, DETAIL_DISABLED: 1, UNKNOWN: 0 });
  assert.deepEqual(result.segment, { unknown: 1, single: 4, multi: 1 });
  assert.deepEqual(result.presence.proofId, { present: 5, missing: 1 });
  assert.deepEqual(result.presence.pnoLineId, { present: 5, missing: 1 });
  assert.deepEqual(result.presence.pnoVanLineId, { present: 1, missing: 5 });
  assert.deepEqual(result.presence.lineId, { present: 5, missing: 1 });
  assert.deepEqual(result.locatorIncomplete, { missingProofId: 1, missingSourceDay: 1,
    missingBothLineIds: 1, missingStoreId: 1, missingNextStoreId: 1, multipleMissing: 1 });
  assert.deepEqual(result.pnoDetailAvailable, { true: 4, false: 2 });
  assert.deepEqual(result.pnoEnabled, { true: 5, false: 1 });
  assert.deepEqual(result.pnoStateOK, { true: 5, false: 1 });
  const serialized = JSON.stringify(result);
  for (const forbidden of ["SECRET-PROOF", "SECRET-LINE", "SECRET-VAN", "SECRET-STORE",
    "SECRET-NEXT", "SECRET-BACKING", "SECRET-PNO", "SECRET-PHONE",
    "SECRET-CUSTOMER", "SECRET-TOKEN", "SECRET-BEARER", "2026-09-29"])
    assert.ok(!serialized.includes(forbidden), forbidden);
});

test("unknown canonical reason stays UNKNOWN without changing eligibility", () => {
  const result = summarize([row({ expectedParcels: 4 })]);
  assert.equal(result.reason.UNKNOWN, 1); // V30 returns COUNT_MISMATCH.
  assert.equal(result.detailAvailable, 0);
});

function simulatedPage(search) {
  const elements = new Map();
  const document = {
    getElementById: (id) => elements.get(id) || null,
    createElement: (tag) => ({ tag, style: {}, children: [],
      setAttribute() {}, appendChild(child) { this.children.push(child); },
      querySelector(selector) { return selector === "pre" ? this.children.find((x) => x.tag === "pre") : null; } }),
    body: { appendChild(node) { elements.set(node.id, node); } },
  };
  let eligibilityCalls = 0;
  const context = { document, location: { search }, URLSearchParams,
    state: { rows: [row()] },
    pnoReadOnlyDetailEligibility: (item) => { eligibilityCalls++; return detailEligibilityFixtureV30(item); } };
  vm.createContext(context);
  const start = staged.indexOf("function summarizePnoDetailAvailability(");
  assert.ok(start > 0);
  vm.runInContext(staged.slice(start), context);
  return { context, elements, calls: () => eligibilityCalls };
}

test("normal UI has no panel or diagnostic evaluation without explicit DEV flag", () => {
  const page = simulatedPage("");
  page.context.pnoDetailDiagRender([row()]);
  assert.equal(page.elements.size, 0);
  assert.equal(page.calls(), 0);
});

test("opt-in DOM panel projects current rows without requests or automatic detail open", () => {
  const page = simulatedPage("?pnoDetailDiag=1");
  for (const forbidden of ["fetch", "browserPnoPage", "pnoV18Fetch", "pendingPnoHistory"])
    page.context[forbidden] = () => { throw new Error(`${forbidden} called`); };
  page.context.pnoDetailDiagRender([row()]);
  const panel = page.elements.get("pno-detail-availability-diag");
  assert.equal(panel.children[0].textContent, "PNO_DETAIL_AVAILABILITY_DIAG_V1");
  const result = JSON.parse(panel.children[1].textContent);
  assert.equal(result.reason.OK, 1);
  assert.equal(result.sourceRowCount, 1);
  assert.equal(page.calls(), 1);
  assert.match(staged, /const rows = filteredRows\(\);\n  pnoDetailDiagRender\(rows\);/);
  assert.equal((staged.match(/PNO_DETAIL_AVAILABILITY_DIAG_V1/g) || []).length, 1);
  assert.equal(patchPnoDetailAvailabilityDiagnostic(staged), staged);
  assert.doesNotMatch(staged.slice(staged.indexOf("// DEV_PNO_DETAIL_DIAG_FINAL_HOOK_V1")),
    /fetch\(|browserPnoPage\(|pnoV18Fetch\(|curl_pno|\/pno\/history|setInterval\(/);
});
