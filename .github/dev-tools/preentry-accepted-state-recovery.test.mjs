import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { stageWorker } from "./stage-dev-runtime.mjs";

const temporary = await mkdtemp(join(tmpdir(), "preentry-accepted-state-"));
let source;
try {
  const worker = join(temporary, "index.js");
  await writeFile(worker, stageWorker(await readFile(new URL("../../worker/src/index.js", import.meta.url), "utf8")));
  for (const script of [
    "../../cloudflare-browser-test/scripts/patch-dev-tbr-shadow-readonly.mjs",
    "../../cloudflare-browser-test/scripts/patch-dev-tbr-shadow-split-v2.mjs",
    "./patch-bus-time-hot-lane-v14.mjs",
    "./patch-dev-auxiliary-evidence-completeness.mjs",
  ]) execFileSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), worker]);
  source = await readFile(worker, "utf8");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
const start = source.indexOf("    const previousEnrichment =", source.indexOf("async function runMsRefresh("));
const end = source.indexOf("    const transientEmptyHold =", start);
assert.ok(start > 0 && end > start, "staged refresh contains the accepted-enrichment boundary");
const projection = source.slice(start, end);
const pageStart = source.indexOf("async function readPreEntryPage(");
const pageEnd = source.indexOf("function normalizeProofId(", pageStart);
assert.ok(pageStart > 0 && pageEnd > pageStart, "staged PreEntry page reader is present");
const pageReader = source.slice(pageStart, pageEnd);

async function readPage(dataList) {
  const responseData = dataList === undefined
    ? { code: 1, data: { Total: 0 } }
    : { code: 1, data: { Total: dataList.length, DataList: dataList } };
  const context = {
    URL, Object, String, Number, Array,
    preEntryRowSourceDay: new WeakMap(),
    fetchWithTimeout: async () => ({ ok: true, json: async () => responseData }),
    fail: (message, code) => { throw Object.assign(new Error(message), { code }); },
  };
  return vm.runInNewContext(`(async () => { ${pageReader}\nreturn readPreEntryPage({}, 1, "2026-09-25"); })()`, context);
}

test("missing PreEntry list is a source failure rather than a successful empty page", async () => {
  await assert.rejects(readPage(undefined), { code: "PREENTRY_SOURCE_ERROR" });
});

test("explicit empty PreEntry page remains a valid empty provider response", async () => {
  const page = await readPage([]);
  assert.equal(page.items.length, 0);
  assert.equal(page.total, 0);
});

const branch = "NE1";
const occurrence = {
  id: "provider-route-1",
  proofId: "SYNTHETIC-01",
  attendanceType: "ปลายทาง",
  estimatedArrivalAt: "2026-09-25T02:00:00.000Z",
};
const acceptedId = createHash("sha256")
  .update(`${branch}|SYNTHETIC-01|ปลายทาง|2026-09-25T02:00:00.000Z`)
  .digest("hex");
const prior = {
  ...occurrence,
  id: acceptedId,
  expectedParcels: 10,
  enteredParcels: 8,
  pendingParcels: 2,
  pnoState: "OK",
};

async function project(parcelCounts, previous = prior, current = occurrence) {
  let cacheReads = 0;
  const context = {
    env: {},
    Set,
    Map,
    branch,
    routeRows: [{ ...current }],
    parcelCounts,
    busData: new Map(),
    readMsLiveCache: async () => {
      cacheReads++;
      return previous ? { rows: [previous] } : null;
    },
    enrichMsRow: (row, counts) => ({ ...row, ...(counts.get(`P:${row.proofId}`) || {}) }),
    normalizeProofId: (value) => String(value || "").trim().toUpperCase(),
    normalizeMsAttendance: (value) => String(value || ""),
    text: (value) => String(value || ""),
    date: (value) => value ? new Date(value).toISOString() : "",
  };
  const rows = await vm.runInNewContext(`(async () => { ${projection}\nreturn mappedRows; })()`, context);
  return { row: rows[0], cacheReads };
}

for (const [name, flags] of [
  ["timeout or provider failure", { sourceFailed: true }],
  ["partial response for the occurrence", { sourcePartial: true, partialProofs: new Set([occurrence.proofId]) }],
]) {
  test(`accepted PreEntry aggregate survives ${name}`, async () => {
    const counts = Object.assign(new Map(), flags);
    const { row, cacheReads } = await project(counts);
    assert.equal(cacheReads, 1);
    assert.deepEqual([row.expectedParcels, row.enteredParcels, row.pendingParcels], [10, 8, 2]);
    assert.equal(row.pnoState, "OK");
  });
}

test("complete authoritative zero replaces accepted nonzero", async () => {
  const counts = new Map([[`P:${occurrence.proofId}`, {
    expectedParcels: 0, enteredParcels: 0, pendingParcels: 0, pnoState: "OK",
  }]]);
  counts.sourceEvaluated = true;
  const { row, cacheReads } = await project(counts);
  assert.equal(cacheReads, 0);
  assert.deepEqual([row.expectedParcels, row.enteredParcels, row.pendingParcels], [0, 0, 0]);
});

test("failure with no accepted occurrence cannot manufacture zero", async () => {
  const counts = Object.assign(new Map(), { sourceFailed: true });
  const { row } = await project(counts, null);
  assert.equal(row.expectedParcels, undefined);
  assert.equal(row.enteredParcels, undefined);
  assert.equal(row.pendingParcels, undefined);
});

test("same proof on another occurrence cannot inherit old parcel counts", async () => {
  const counts = Object.assign(new Map(), { sourceFailed: true });
  const current = { ...occurrence, estimatedArrivalAt: "2026-09-26T02:00:00.000Z" };
  const { row } = await project(counts, prior, current);
  assert.equal(row.expectedParcels, undefined);
  assert.equal(row.enteredParcels, undefined);
  assert.equal(row.pendingParcels, undefined);
});

test("failed refresh does not merge the other attendance occurrence", async () => {
  const counts = Object.assign(new Map(), { sourceFailed: true });
  const { row } = await project(counts, prior, { ...occurrence, attendanceType: "ต้นทาง" });
  assert.equal(row.expectedParcels, undefined);
});
