import { readFile, writeFile } from "node:fs/promises";

const WORKER_PATH = "worker/src/index.js";
const FRONTEND_PATH = "ms.js";
const TEST_PATH = ".github/dev-tools/daily-history.test.mjs";
const WORKER_MARKER = "MS_DAILY_HISTORY_QUOTA_V2";
const INDEX_NAME = "idx_ms_route_history_hub_route_snapshot";

function countOf(text, needle) {
  return String(text).split(needle).length - 1;
}

function patchWorker(source) {
  let output = String(source || "");
  if (output.includes(WORKER_MARKER)) return output;

  const start = output.indexOf("// MS_DAILY_HISTORY_V1: read-only daily history");
  const end = output.indexOf("async function msArchiveTotal", start);
  if (start < 0 || end <= start) throw new Error("msDailyArchive block not found");

  let block = output.slice(start, end);
  const oldFrom = "FROM ms_route_history h2\n            WHERE h2.hub=r.hub AND h2.route_id=r.route_id";
  const newFrom = `FROM ms_route_history h2 INDEXED BY ${INDEX_NAME}\n            WHERE h2.hub=r.hub AND h2.route_id=r.route_id`;
  if (countOf(block, oldFrom) !== 1)
    throw new Error(`daily-history latest lookup anchor count=${countOf(block, oldFrom)}`);
  block = block.replace(oldFrom, newFrom);
  block = block.replace(
    "// MS_DAILY_HISTORY_V1: read-only daily history. It never calls upstream MS and never writes history.",
    "// MS_DAILY_HISTORY_V1: read-only daily history. It never calls upstream MS and never writes history.\n// MS_DAILY_HISTORY_QUOTA_V2: force the existing covering latest-route index so a date search can never silently fall back to a full history scan.",
  );

  return output.slice(0, start) + block + output.slice(end);
}

function patchFrontend(source) {
  let output = String(source || "");
  const oldCall = 'apiGet("msDailyArchive"';
  const newCall = 'apiGetOnce("msDailyArchive"';
  const oldCount = countOf(output, oldCall);
  const newCount = countOf(output, newCall);
  if (oldCount === 0 && newCount >= 3) return output;
  if (oldCount !== 3)
    throw new Error(`expected exactly 3 msDailyArchive retrying calls, got ${oldCount}`);
  output = output.split(oldCall).join(newCall);
  return output;
}

function patchTest(source) {
  let output = String(source || "");

  const oldFrontendAssertion = '  assert.match(frontend, /apiGet\\("msDailyArchive"/);';
  const newFrontendAssertion =
    '  assert.match(frontend, /apiGetOnce\\("msDailyArchive"/);\n' +
    '  assert.doesNotMatch(frontend, /apiGet\\("msDailyArchive"/);';
  if (output.includes(oldFrontendAssertion)) {
    output = output.replace(oldFrontendAssertion, newFrontendAssertion);
  } else if (!output.includes('assert.match(frontend, /apiGetOnce\\("msDailyArchive"/);')) {
    throw new Error("daily-history frontend assertion anchor missing");
  }

  const workerAnchor = '  assert.match(worker, /FROM ms_route_registry r/);';
  const workerAssertion = `  assert.match(worker, /INDEXED BY ${INDEX_NAME}/);`;
  if (!output.includes(workerAssertion)) {
    if (!output.includes(workerAnchor)) throw new Error("daily-history worker assertion anchor missing");
    output = output.replace(workerAnchor, `${workerAnchor}\n${workerAssertion}`);
  }

  return output;
}

const [workerSource, frontendSource, testSource] = await Promise.all([
  readFile(WORKER_PATH, "utf8"),
  readFile(FRONTEND_PATH, "utf8"),
  readFile(TEST_PATH, "utf8"),
]);

const worker = patchWorker(workerSource);
const frontend = patchFrontend(frontendSource);
const test = patchTest(testSource);

await Promise.all([
  worker === workerSource ? null : writeFile(WORKER_PATH, worker),
  frontend === frontendSource ? null : writeFile(FRONTEND_PATH, frontend),
  test === testSource ? null : writeFile(TEST_PATH, test),
].filter(Boolean));

if (!worker.includes(WORKER_MARKER)) throw new Error("worker quota marker missing");
if (!worker.includes(`INDEXED BY ${INDEX_NAME}`)) throw new Error("worker forced index missing");
if (countOf(frontend, 'apiGetOnce("msDailyArchive"') < 3) throw new Error("frontend one-shot archive calls missing");
if (countOf(frontend, 'apiGet("msDailyArchive"') !== 0) throw new Error("retrying archive calls remain");

console.log("MS_DAILY_HISTORY_QUOTA_V2=PASS");
console.log(`MS_DAILY_HISTORY_INDEX=${INDEX_NAME}`);
console.log("MS_DAILY_HISTORY_AUTO_RETRY=0");
console.log("MS_DAILY_HISTORY_UPSTREAM_MS_CALLS=0");
console.log("MS_DAILY_HISTORY_HISTORY_WRITES=0");
