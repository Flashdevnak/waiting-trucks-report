import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { patchPnoDetailAffordanceWorkerV30 } from "./patch-pno-detail-affordance-recovery.mjs";
import { stageFrontend, stageWorker } from "./stage-dev-runtime.mjs";

// Execute the effective DEV staging chain in a disposable directory.
const temporary = await mkdtemp(join(tmpdir(), "pno-weak-refresh-"));
let workerSource;
try {
  const worker = join(temporary, "index.js");
  await writeFile(worker, stageWorker(await readFile(new URL("../../worker/src/index.js", import.meta.url), "utf8")));
  for (const script of [
    "../../cloudflare-browser-test/scripts/patch-dev-tbr-shadow-readonly.mjs",
    "../../cloudflare-browser-test/scripts/patch-dev-tbr-shadow-split-v2.mjs",
    "./patch-bus-time-hot-lane-v14.mjs",
    "./patch-dev-auxiliary-evidence-completeness.mjs",
  ]) execFileSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), worker]);
  workerSource = patchPnoDetailAffordanceWorkerV30(await readFile(worker, "utf8"));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
const frontendSource = stageFrontend(await readFile(new URL("../../ms.js", import.meta.url), "utf8"));

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing effective staged block: ${start}`);
  return source.slice(from, to);
}

const projection = between(
  workerSource.slice(workerSource.indexOf("async function runMsRefresh(")),
  "    const previousEnrichment =",
  "    const transientEmptyHold =",
);
const sourceHelpers = between(workerSource, "const preEntryRowSourceDay =", "function preEntrySemanticKey(");
const readCounts = between(workerSource, "async function readPreEntryCountsFresh(", "export function classifyPreEntryFailure(");
const frontendHelpers = between(frontendSource, "function pnoReadOnlyDetailEligibility", "function findPnoRowById");

const branch = "NE1";
const occurrence = {
  id: "SYNTHETIC-ROUTE",
  proofId: "SYNTHETIC-PROOF",
  attendanceType: "ปลายทาง",
  estimatedArrivalAt: "2026-09-25T02:00:00.000Z",
};
const acceptedId = createHash("sha256")
  .update(`${branch}|${occurrence.proofId}|${occurrence.attendanceType}|${occurrence.estimatedArrivalAt}`)
  .digest("hex");
const segment = {
  proof_id: occurrence.proofId,
  line_id: "SYNTHETIC-LINE-A",
  store_id: "SYNTHETIC-STORE-A",
  next_store_id: "SYNTHETIC-STORE-B",
  total_num: 10,
  already_num: 8,
  no_entry_num: 2,
};

const aggregator = {
  records: [], Map, Set, WeakMap, Date, Number, String, Math,
  console: { error() {} },
  preEntryCredentials: async () => ({}),
  safeStatusWrite: async () => {},
  markConnectionSuccess: async () => {},
  markConnectionError: async () => {},
  normalizeProofId: (value) => String(value || "").trim().toUpperCase(),
  text: (value, limit = 300) => String(value ?? "").slice(0, limit),
  numberOrNull: (value) => Number.isFinite(Number(value)) ? Number(value) : null,
  setEnrichmentAliases: (map, value, proof) => {
    if (proof) map.set(`P:${String(proof).trim().toUpperCase()}`, value);
  },
  PREENTRY_PAGE_CONCURRENCY: 1,
  PREENTRY_PAGE_BATCH_DELAY_MS: 0,
};
vm.createContext(aggregator);
vm.runInContext(`${sourceHelpers}
async function readPreEntryPage(_credentials, _page, day) {
  return { items: records.map((row) => {
    preEntryRowSourceDay.set(row, day);
    return row;
  }), total: records.length };
}
${readCounts}
globalThis.readCounts = readPreEntryCountsFresh;`, aggregator);

async function aggregate(records) {
  aggregator.records = records;
  return aggregator.readCounts({}, "SYNTHETIC-HUB", ["2026-09-25"]);
}

const rawSummary = (row) => {
  const expected = Number(row?.expectedParcels);
  const entered = Number(row?.enteredParcels);
  const pending = Number(row?.pendingParcels);
  return {
    expected, entered, pending,
    percent: expected > 0 ? entered / expected * 100 : 0,
    valid: [expected, entered, pending].every(Number.isFinite) &&
      expected >= 0 && entered >= 0 && pending >= 0 && entered + pending === expected,
  };
};
const frontend = {
  pnoOperationalInboundEligible: (row) => row?.attendanceType === "ปลายทาง" || row?.attendanceType === "จุดดรอป",
  pnoOperationalRawSummary: rawSummary,
  pnoOperationalSummaryForRow: rawSummary,
  nf: new Intl.NumberFormat("en-US"),
  pnoProgressClass: () => "is-live",
  pnoDisplayPercent: (value) => `${Number(value).toFixed(1)}%`,
  pnoProgressStatus: () => "กำลังเข้า",
  esc: (value) => String(value ?? "").replaceAll('"', "&quot;"),
};
vm.createContext(frontend);
vm.runInContext(`${frontendHelpers}
globalThis.eligibility = pnoReadOnlyDetailEligibility;
globalThis.message = pnoReadOnlyUnavailableMessage;
globalThis.renderBadge = expectedParcelsBadge;`, frontend);

async function project(parcelCounts, previous, current = occurrence) {
  const context = {
    env: {}, branch, Set, Map,
    routeRows: [{ ...current }], parcelCounts, busData: new Map(),
    readMsLiveCache: async () => previous ? { rows: [previous] } : null,
    enrichMsRow: (row, counts) => ({ ...row, ...(counts.get(`P:${row.proofId}`) || {}) }),
    normalizeProofId: (value) => String(value || "").trim().toUpperCase(),
    normalizeMsAttendance: (value) => String(value || ""),
    text: (value) => String(value || ""),
    date: (value) => value ? new Date(value).toISOString() : "",
  };
  const rows = await vm.runInNewContext(`(async () => { ${projection}\nreturn mappedRows; })()`, context);
  return rows[0];
}

const weakFailure = () => Object.assign(new Map(), { sourceFailed: true });
const weakPartial = () => Object.assign(new Map(), {
  sourcePartial: true, partialProofs: new Set([occurrence.proofId]),
});
const complete = (counts) => Object.assign(counts, { sourceEvaluated: true });
const multiWarning = "หลายจุดส่ง จึงไม่เปิดรายละเอียดรวมเพื่อป้องกันการเลือกเที่ยวผิด";

const singleCounts = await aggregate([{ ...segment }]);
const single = singleCounts.get(`P:${occurrence.proofId}`);
const previousSingle = { ...occurrence, ...single, id: acceptedId };
const multiCounts = await aggregate([
  { ...segment },
  { ...segment, line_id: "SYNTHETIC-LINE-B", store_id: "SYNTHETIC-STORE-B", next_store_id: "SYNTHETIC-STORE-C" },
]);
const multi = multiCounts.get(`P:${occurrence.proofId}`);
const previousMulti = { ...occurrence, ...multi, id: acceptedId };

test("1: successful nonempty single segment stays eligible", () => {
  assert.match(workerSource, /function preEntrySummaryCandidate\(/);
  assert.equal(singleCounts.sourceEvaluated, true);
  assert.equal(single.pnoSegmentCount, 1);
  assert.equal(single.pnoDetailAvailable, true);
  const result = frontend.eligibility(previousSingle);
  assert.equal(result.available, true);
  assert.equal(frontend.message(result), "");
});

test("2: genuine two-segment evidence remains fail closed with multi-stop warning", () => {
  assert.equal(multi.pnoSegmentCount, 2);
  assert.equal(multi.pnoDetailAvailable, false);
  const result = frontend.eligibility(previousMulti);
  assert.equal(result.reason, "AMBIGUOUS_OCCURRENCE");
  assert.equal(frontend.message(result), multiWarning);
});

for (const [name, makeWeak] of [["3: timeout", weakFailure], ["4: identified partial", weakPartial]]) {
  test(`${name} restores single-segment evidence for the same occurrence`, async () => {
    const row = await project(makeWeak(), previousSingle);
    assert.deepEqual([row.expectedParcels, row.enteredParcels, row.pendingParcels], [10, 8, 2]);
    assert.equal(row.pnoSegmentCount, 1);
    assert.equal(row.pnoDetailAvailable, true);
    const result = frontend.eligibility(row);
    assert.equal(result.reason, "OK");
    assert.notEqual(frontend.message(result), multiWarning);
  });
}

test("5: no accepted occurrence manufactures neither counts nor segment evidence", async () => {
  const row = await project(weakFailure(), null);
  assert.equal(row.expectedParcels, undefined);
  assert.equal(row.pnoSegmentCount, undefined);
  assert.equal(row.pnoDetailAvailable, undefined);
  assert.equal(frontend.eligibility(row).available, false);
  assert.notEqual(frontend.message(frontend.eligibility(row)), multiWarning);
});

test("6: a mismatched natural occurrence cannot borrow accepted evidence", async () => {
  const row = await project(weakFailure(), previousSingle, { ...occurrence, attendanceType: "จุดดรอป" });
  assert.equal(row.expectedParcels, undefined);
  assert.equal(row.pnoSegmentCount, undefined);
  assert.equal(row.pnoDetailAvailable, undefined);
});

test("7: the same proof on another business day cannot borrow segment evidence", async () => {
  const row = await project(weakFailure(), previousSingle, { ...occurrence, estimatedArrivalAt: "2026-09-26T02:00:00.000Z" });
  assert.equal(row.expectedParcels, undefined);
  assert.equal(row.pnoSegmentCount, undefined);
  assert.equal(row.pnoDetailAvailable, undefined);
});

test("8: complete multi-stop evidence replaces prior single-segment evidence", async () => {
  const row = await project(complete(multiCounts), previousSingle);
  assert.equal(row.pnoSegmentCount, 2);
  assert.equal(row.pnoDetailAvailable, false);
  assert.equal(frontend.message(frontend.eligibility(row)), multiWarning);
});

test("9: complete single-segment evidence replaces prior multi-stop evidence", async () => {
  const row = await project(complete(singleCounts), previousMulti);
  assert.equal(row.pnoSegmentCount, 1);
  assert.equal(row.pnoDetailAvailable, true);
  assert.equal(frontend.eligibility(row).available, true);
});

test("10: explicit empty source response remains an evaluated complete response", async () => {
  const empty = await aggregate([]);
  assert.equal(empty.size, 0);
  assert.equal(empty.sourceEvaluated, true);
  assert.notEqual(empty.sourceFailed, true);
});

test("11: an authoritative complete zero aggregate remains valid", async () => {
  const zero = await aggregate([{ ...segment, total_num: 0, already_num: 0, no_entry_num: 0 }]);
  const row = await project(complete(zero), previousSingle);
  assert.deepEqual([row.expectedParcels, row.enteredParcels, row.pendingParcels], [0, 0, 0]);
  assert.equal(row.pnoSegmentCount, 1);
});

test("12: missing or invalid segment count is unknown, never multi-stop", () => {
  for (const count of [undefined, null, NaN, "two", "2", Infinity, 0, 1.5]) {
    const result = frontend.eligibility({ ...previousSingle, pnoSegmentCount: count });
    assert.equal(result.reason, "SEGMENT_UNKNOWN");
    assert.equal(result.available, false);
    assert.notEqual(frontend.message(result), multiWarning);
  }
});

test("13: valid aggregate cannot enable detail when a locator prerequisite is missing", async () => {
  const prior = { ...previousSingle, pnoStoreId: "", pnoDetailAvailable: true };
  const row = await project(weakFailure(), prior);
  assert.deepEqual([row.expectedParcels, row.enteredParcels, row.pendingParcels], [10, 8, 2]);
  assert.equal(row.pnoSegmentCount, 1);
  assert.equal(row.pnoDetailAvailable, false);
  assert.equal(frontend.eligibility(row).reason, "LOCATOR_INCOMPLETE");
});

test("14: unloading state 2 retains the existing read-only parcel detail affordance", () => {
  const html = frontend.renderBadge({ ...previousSingle, unloadingState: 2 });
  assert.match(html, /data-pno-type="no_entry"/);
  assert.match(html, /data-pno-detail-card=/);
});

test("weak multi-stop stays multi-stop and unknown prior metadata never becomes eligible", async () => {
  const weakMulti = await project(weakFailure(), previousMulti);
  assert.equal(weakMulti.pnoSegmentCount, 2);
  assert.equal(weakMulti.pnoDetailAvailable, false);
  assert.equal(frontend.message(frontend.eligibility(weakMulti)), multiWarning);
  const unknown = await project(weakPartial(), { ...previousSingle, pnoSegmentCount: undefined });
  assert.equal(unknown.pnoSegmentCount, undefined);
  assert.equal(unknown.pnoDetailAvailable, false);
  assert.equal(frontend.eligibility(unknown).reason, "SEGMENT_UNKNOWN");
});
