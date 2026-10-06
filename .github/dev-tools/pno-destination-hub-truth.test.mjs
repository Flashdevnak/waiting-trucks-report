import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
const legacyExpression = "cleanStoreName(row.next_hub_name || row.target_hub_name || row.dst_hub_name || row.destination_hub_name || row.ticket_delivery_hub_name || row.end_hub_name || row.next_store_name || row.hub_name || row.targetHub)";
const operationalExpression = detail.match(/operationalMatchHub:\s*(cleanStoreName\([^\n]+\)),/);
const nextStoreExpression = detail.match(/targetBranch:\s*(cleanStoreName\(row\.next_store_name\)),/);
const cleanStoreName = (value) => String(value ?? "").trim().replace(/^\s*\([^)]*\)\s*/, "").trim();
const project = (expression) => vm.runInNewContext(`(row, cleanStoreName) => ${expression[1]}`);
const targetHub = destinationExpression && project(destinationExpression);
const operationalMatchHub = operationalExpression && project(operationalExpression);
const targetBranch = nextStoreExpression && project(nextStoreExpression);
const legacyTargetHub = vm.runInNewContext(`(row, cleanStoreName) => ${legacyExpression}`);

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf("\n}\n", start);
  assert.ok(start >= 0 && end > start, `missing ${name}`);
  return source.slice(start, end + 2);
}

const baselineFunctionHashes = {
  pnoOperationalNormalizePno: "e16a3b8dcca37c5eccfe28c9d6a873d72c6aba975de2cb81f4819546ea2b757d",
  pnoOperationalCanonicalHub: "cdde452e0b33c0046dd8dcc3a18db64e3be19210d345de75c34da212e8408156",
  pnoOperationalCurrentHub: "73e53797aa93b537d0a0aee5dabd25903bad7ecf3e61e794cc8f178dd71a3057",
  pnoOperationalRawSummary: "0a6a1fb997536cc1f8fdf3b92dbec143db838c224d28a5e4820445b20ed2532f",
  pnoOperationalUniqueMap: "7997ce6102556aeb5a4b4f7b7abfa9b64f77ca9ad5ada3726799c72138946db7",
  pnoOperationalBuildTruth: "9e5b2665179ff3dddb4fa6c331c68a87ae75d9db1f5e4ec3295450e3a5940673",
  pnoOperationalResolve: "c1c1ef84dfcfc8cc3d68611288a6f609aecd8976205f9a224d634a5dc1255fac",
};

test("V25/V28 noncandidate count functions are byte-identical to effective 5d5937b staging", () => {
  for (const [name, baselineHash] of Object.entries(baselineFunctionHashes))
    assert.equal(createHash("sha256").update(extractFunction(frontend, name)).digest("hex"), baselineHash, name);
});

function countRuntime(candidate) {
  const shared = ["pnoOperationalNormalizePno", "pnoOperationalCanonicalHub", "pnoOperationalCurrentHub",
    "pnoOperationalRawSummary", "pnoOperationalUniqueMap", "pnoOperationalBuildTruth"]
    .map((name) => extractFunction(frontend, name)).join("\n");
  const matches = candidate === "baseline" ? `function pnoOperationalHubMatches(targetHub) {
  const current = pnoOperationalCurrentHub();
  if (!current) return false;
  return pnoOperationalCanonicalHub(targetHub) === current;
}` : extractFunction(frontend, "pnoOperationalHubMatches");
  const classify = candidate === "baseline" ? `function pnoOperationalCandidate(item) {
  return Boolean(
    pnoOperationalNormalizePno(item?.pno) &&
    String(item?.backingNo || "").trim() &&
    pnoOperationalHubMatches(item?.targetHub)
  );
}` : extractFunction(frontend, "pnoOperationalCandidate");
  const context = { state: { branch: "CURRENT_HUB" }, pnoCountForType: (row, type) => row[type],
    pnoOperationalInboundEligible: () => true };
  vm.runInNewContext(`${shared}\n${matches}\n${classify}\nthis.candidate = pnoOperationalCandidate;\nthis.build = pnoOperationalBuildTruth;`, context);
  return context;
}

const baselineRuntime = countRuntime("baseline");
const finalRuntime = countRuntime("final");
const raw = { total: 2, already: 0, no_entry: 2 };

function parcel(rawRow, pno, baseline) {
  return { pno, backingNo: "BAG-1", targetHub: baseline ?
    legacyTargetHub(rawRow, cleanStoreName) :
    targetHub(rawRow, cleanStoreName),
  ...(!baseline && { operationalMatchHub: operationalMatchHub(rawRow, cleanStoreName) }),
  targetBranch: targetBranch(rawRow, cleanStoreName) };
}

function countResult(runtime, totalRows, pendingRows, summary = raw) {
  const truth = runtime.build(summary, totalRows, pendingRows);
  return JSON.parse(JSON.stringify({
    classification: totalRows.map((item) => runtime.candidate(item)),
    ownHubCandidatesExist: totalRows.some((item) => runtime.candidate(item)),
    expected: truth.expected, entered: truth.entered, pending: truth.pending,
    correction: truth.correction, verified: truth.verified, reason: truth.reason,
    candidatePnos: [...truth.candidatePnos], candidateRows: truth.candidateRows.map((item) => item.pno),
  }));
}

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
  assert.ok(destinationExpression && nextStoreExpression && operationalExpression);
  assert.equal(operationalExpression[1], legacyExpression);
  assert.equal((detail.match(/targetHub:/g) || []).length, 1);
  assert.doesNotMatch(detail, /targetHub:\s*cleanStoreName\(row\.dst_hub_name\s*\|\|/);
  const tripProjection = "targetHub: cleanStoreName(row.next_store_name || row.next_hub_name || row.target_hub_name || row.dst_hub_name || row.destination_hub_name || row.ticket_delivery_hub_name || row.end_hub_name)";
  assert.ok(sourceWorker.includes(tripProjection));
  assert.ok(worker.includes(tripProjection));
});

test("V25/V28 differential count semantics preserve exact first-nonempty legacy precedence", () => {
  const sources = [
    "next_hub_name", "target_hub_name", "destination_hub_name", "ticket_delivery_hub_name",
    "end_hub_name", "next_store_name", "hub_name", "dst_hub_name", "targetHub",
  ];
  for (const source of sources) {
    const first = { dst_hub_name: "", [source]: "CURRENT_HUB" };
    if (source === "dst_hub_name") first.dst_hub_name = "CURRENT_HUB";
    const oldRows = [parcel(first, "P-1", true), parcel({ dst_hub_name: "REMOTE_HUB" }, "P-2", true)];
    const newRows = [parcel(first, "P-1", false), parcel({ dst_hub_name: "REMOTE_HUB" }, "P-2", false)];
    assert.equal(newRows[0].operationalMatchHub, oldRows[0].targetHub, source);
    assert.deepEqual(countResult(finalRuntime, newRows, newRows), countResult(baselineRuntime, oldRows, oldRows), source);
    if (source !== "dst_hub_name") assert.equal(newRows[0].targetHub, "", source);
  }
  const cases = [
    ["all legacy fields empty", {}],
    ["earlier nonmatch beats later match", { next_hub_name: "REMOTE_HUB", dst_hub_name: "CURRENT_HUB" }],
    ["earlier match beats later difference", { next_hub_name: "CURRENT_HUB", dst_hub_name: "REMOTE_HUB" }],
    ["destination differs from operational hub", { next_hub_name: "CURRENT_HUB", dst_hub_name: "DEST_HUB" }],
    ["next store differs from destination", { dst_hub_name: "HUB_A", next_store_name: "STORE_B" }],
  ];
  for (const [label, row] of cases) {
    const oldRows = [parcel(row, "P-1", true), parcel({ next_hub_name: "CURRENT_HUB" }, "P-2", true)];
    const newRows = [parcel(row, "P-1", false), parcel({ next_hub_name: "CURRENT_HUB" }, "P-2", false)];
    assert.deepEqual(countResult(finalRuntime, newRows, newRows), countResult(baselineRuntime, oldRows, oldRows), label);
    assert.equal(newRows[0].targetHub, cleanStoreName(row.dst_hub_name), label);
    assert.equal(newRows[0].targetBranch, cleanStoreName(row.next_store_name), label);
  }
  const missing = parcel({ next_hub_name: "CURRENT_HUB" }, "P-1", false);
  assert.equal(missing.targetHub, "");
  assert.equal(missing.operationalMatchHub, "CURRENT_HUB");
  assert.equal(bagSummary([missing]).hub, "-");
  assert.equal(bagSummary([parcel({ dst_hub_name: "HUB_A" }, "A", false),
    parcel({ dst_hub_name: "HUB_B" }, "B", false)]).hub, "HUB_A · HUB_B");
  const mixed = [{ next_hub_name: "CURRENT_HUB", dst_hub_name: "DEST_HUB" },
    { dst_hub_name: "REMOTE_HUB" }];
  const before = mixed.map((item, index) => parcel(item, `M-${index}`, true));
  const after = mixed.map((item, index) => parcel(item, `M-${index}`, false));
  const scenarios = [
    ["one pending member", [0], { total: 2, already: 1, no_entry: 1 }],
    ["noncandidate pending member", [1], { total: 2, already: 1, no_entry: 1 }],
    ["raw count invalid", [0], { total: 3, already: 1, no_entry: 1 }],
    ["detail count mismatch", [0], { total: 3, already: 1, no_entry: 2 }],
  ];
  for (const [label, indexes, summary] of scenarios)
    assert.deepEqual(countResult(finalRuntime, after, indexes.map((i) => after[i]), summary),
      countResult(baselineRuntime, before, indexes.map((i) => before[i]), summary), label);
});

test("operational compatibility value is confined to V25/V28 matching and never rendered", () => {
  assert.equal((detail.match(/operationalMatchHub:/g) || []).length, 1);
  assert.equal((frontend.match(/\.operationalMatchHub\b/g) || []).length, 1);
  assert.match(frontend, /pnoOperationalHubMatches\(item\?\.operationalMatchHub\)/);
  assert.doesNotMatch(frontend, /pnoOperationalHubMatches\(item\?\.targetHub\)/);
  const context = frontend.slice(frontend.indexOf("function pnoOperationalHubMatches("),
    frontend.indexOf("function pnoOperationalRawSummary("));
  assert.equal((frontend.match(/operationalMatchHub\b/g) || []).length, 3);
  assert.equal((context.match(/operationalMatchHub\b/g) || []).length, 3);
  assert.match(frontend, /hub: \[\.\.\.new Set\(items\.map\(\(item\) => String\(item\?\.targetHub/);
  assert.doesNotMatch(frontend.slice(frontend.indexOf("function pnoV18BagSummary"), frontend.indexOf("function pnoV18RenderBags")), /หลาย HUB/);
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
    { targetHub: targetHub({ dst_hub_name: "DEST_HUB", ticket_delivery_store_name: "BRANCH_A" }, cleanStoreName), targetBranch: "BRANCH_A", nextStoreName: "NEXT_A" },
    { targetHub: targetHub({ dst_hub_name: "DEST_HUB", ticket_delivery_store_name: "BRANCH_B" }, cleanStoreName), targetBranch: "BRANCH_B", nextStoreName: "NEXT_A" },
    { targetHub: "", targetBranch: "", nextStoreName: "" },
  ];
  assert.equal(bagSummary(parcels).hub, "DEST_HUB");
  assert.equal(bagSummary(parcels).branch, "NEXT_A");
  assert.equal(bagSummary([{ targetHub: "HUB_A" }, { targetHub: "HUB_B" }]).hub, "HUB_A · HUB_B");
  assert.equal(bagSummary([{ targetHub: "" }, { targetHub: "" }]).hub, "-");
  assert.equal(bagSummary([{ targetHub: "HUB_A", nextStoreName: "NEXT_A" },
    { targetHub: "HUB_A", nextStoreName: "NEXT_B" }]).branch, "หลายสาขา");
});

test("bag HUB retains one, two and three full destinations in provider order", () => {
  const cases = [
    [["10 NE3_HUB-อุดรธานี"], "10 NE3_HUB-อุดรธานี"],
    [["05 LAS_HUB-ลาซาล", "05 LAS_HUB-ลาซาล"], "05 LAS_HUB-ลาซาล"],
    [["37 PHS_BHUB-พิษณุโลก", "17 NO5_HUB-พิษณุโลก"],
      "37 PHS_BHUB-พิษณุโลก · 17 NO5_HUB-พิษณุโลก"],
    [["16 Central_HUB-วังน้อย", "23 AYU_BHUB-วังน้อย", "65 WNO_BHUB-วังน้อย"],
      "16 Central_HUB-วังน้อย · 23 AYU_BHUB-วังน้อย · 65 WNO_BHUB-วังน้อย"],
    [["", "05 LAS_HUB-ลาซาล", null, "05 LAS_HUB-ลาซาล", "21 BPL_BHUB-บางพลี"],
      "05 LAS_HUB-ลาซาล · 21 BPL_BHUB-บางพลี"],
    [["23 AYU_BHUB-วังน้อย", "05 LAS_HUB-ลาซาล", "23 AYU_BHUB-วังน้อย", "65 WNO_BHUB-วังน้อย"],
      "23 AYU_BHUB-วังน้อย · 05 LAS_HUB-ลาซาล · 65 WNO_BHUB-วังน้อย"],
    [[null, "  ", ""], "-"],
  ];
  for (const [hubs, expected] of cases) {
    const actual = bagSummary(hubs.map((targetHub) => ({ targetHub }))).hub;
    assert.equal(actual, expected);
    assert.doesNotMatch(actual, /หลาย HUB/);
  }
});

test("bag table, Copy, LINE and Export share the complete summary without acquisition", async () => {
  const names = ["pnoV18ParcelAction", "pnoV18DisplayBranch", "pnoV18BagGroups", "pnoV18BagValue", "pnoV18BagLatest", "pnoV18BagSummary",
    "pnoV18FilteredBagGroups", "pnoV18RenderBags", "pnoV18TsvCell", "pnoV18LineCell",
    "pnoV18AppendLineLimited", "pnoV18CopyOwned", "pnoV18CopyLineOwned", "pnoV18ExportOwned"];
  const blocks = names.map((name) => {
    const prefix = frontend.includes(`async function ${name}(`) ? `async function ${name}(` : `function ${name}(`;
    const start = frontend.indexOf(prefix), end = frontend.indexOf("\n}\n", start);
    assert.ok(start >= 0 && end > start, name);
    return frontend.slice(start, end + 2);
  });
  const list = { innerHTML: "", querySelectorAll: () => [] };
  const observed = { copies: [], exports: [], reads: 0 };
  const hubs = ["16 Central_HUB-วังน้อย", "23 AYU_BHUB-วังน้อย", "65 WNO_BHUB-วังน้อย"];
  const items = hubs.map((targetHub, i) => ({ backingNo: "SYNTHETIC-BAG", targetHub,
    nextStoreName: "SYNTHETIC-NEXT", targetBranch: "SYNTHETIC-DELIVERY",
    lastAction: "SYNTHETIC-ACTION", lastActionAt: String(i) }));
  const context = { pnoV18State: { type: "bag", bagRows: items, expandedBag: "",
      filters: { status: "", action: "", branch: "" } },
    el: () => list, esc: (value) => String(value), nf: new Intl.NumberFormat("en-US"),
    pnoLifecycleAssert() {}, pnoLifecycleBindHandlers() {},
    pnoV18RenderBagSummary() {}, pnoV18UpdateFilterResult() {},
    pnoV18LineHeader: () => ["SYNTHETIC HEADER"], pnoV18FilterSummaryText: () => "",
    pnoV18WriteClipboard: async (value) => { observed.copies.push(value); return true; },
    pnoV18Fetch: () => { observed.reads++; throw new Error("unexpected read"); },
    toast() {}, XLSX: { utils: { json_to_sheet: (value) => value, book_new: () => ({}),
      book_append_sheet: (_book, value) => observed.exports.push(value) }, writeFile() {} },
    Date,
  };
  vm.runInNewContext(blocks.join("\n") +
    "this.render=pnoV18RenderBags;this.copy=pnoV18CopyOwned;this.line=pnoV18CopyLineOwned;this.export=pnoV18ExportOwned;", context);
  const expected = hubs.join(" · ");
  context.render(items);
  assert.equal(list.innerHTML.split(expected).length - 1, 2, "desktop and mobile table show every name");
  await context.copy();
  await context.line();
  await context.export();
  for (const value of observed.copies) assert.ok(value.includes(expected), "clipboard preserves all HUBs");
  assert.equal(observed.exports[0][0]["HUB ถัดไป"], expected);
  assert.equal(observed.exports[0][0]["จำนวนพัสดุ"], items.length);
  assert.equal(observed.reads, 0);
  assert.doesNotMatch(list.innerHTML + observed.copies.join("\n") + JSON.stringify(observed.exports), /หลาย HUB/);
});

test("parcel table, Copy and Export distinguish destination from next store", () => {
  assert.ok(frontend.split("HUB ปลายทาง").length > 5);
  assert.doesNotMatch(frontend, /จุดที่ระบุในข้อมูลพัสดุ|HUBปลายทาง/);
  assert.match(frontend, /<th>HUB ปลายทาง<\/th><th>สาขาปลายทาง<\/th>/);
  assert.match(frontend, /\["#", "PNO", "สถานะหลักฐาน", "ล่าสุด", "HUB ปลายทาง", "สาขาปลายทาง", "เวลา", \.\.\.\(pnoV18State\.selection === "union" \? \["จุดส่ง"\] : \[\]\)\]/);
  assert.match(frontend, /"HUB ปลายทาง": row\.targetHub \|\| ""/);
  assert.match(frontend, /"สาขาปลายทาง": pnoV18DisplayBranch\(row\.targetBranch\)/);
  assert.match(frontend, /pnoV18LineCell\(row\.targetHub\) \+ " > " \+ pnoV18LineCell\(pnoV18DisplayBranch\(row\.targetBranch\)\)/);
  assert.match(frontend, /esc\(item\.targetHub \|\| "-"\)/);
});

test("scan-gap shares destination projection and HUB parent filter", () => {
  assert.match(frontend, /type === "scan_gap"/);
  assert.match(frontend, /"HUB ปลายทาง": row\.targetHub \|\| ""/);
  assert.match(frontend, /\["branch", type === "bag" \? "ชื่อสาขาต่อไป" : "สาขาปลายทาง", branches\]/);
  assert.match(frontend, /\["status", "สถานะ", statuses\]/);
  assert.match(frontend, /\["action", "การดำเนินการล่าสุด", actions\]/);
  const filters = frontend.slice(frontend.indexOf("function pnoV18RenderFilters("), frontend.indexOf("function pnoV18RenderRows("));
  assert.match(filters, /\["hub", "HUB ปลายทาง", hubs\]/);
  assert.doesNotMatch(filters, /bagHub|pnoNextStoreName/);
});

test("patches are idempotent and introduce no acquisition or background machinery", () => {
  assert.equal(patchPnoDestinationHubWorker(worker), worker);
  assert.equal(patchPnoDestinationHubFrontend(frontend), frontend);
  const patch = readFileSync(new URL("./patch-pno-destination-hub-truth.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(patch, /\bfetch\s*\(|curl_pno|setInterval\s*\(|setTimeout\s*\(|WebSocket|EventSource|DB\.prepare|INSERT\s+INTO|UPDATE\s+[A-Z]|DELETE\s+FROM/i);
});
