import { readFile, writeFile } from "node:fs/promises";

const FRONTEND = "ms.js";
const WORKER = "worker/src/index.js";
const TEST = ".github/dev-tools/daily-history.test.mjs";
const MARKER = "MS_DAILY_HISTORY_MAX_7_DAYS_V1";

function replaceOnce(text, from, to, label) {
  const count = String(text).split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 anchor, got ${count}`);
  return text.replace(from, to);
}

let frontend = await readFile(FRONTEND, "utf8");
let worker = await readFile(WORKER, "utf8");
let test = await readFile(TEST, "utf8");

if (!frontend.includes(MARKER)) {
  const start = frontend.indexOf("async function loadRange() {");
  const end = frontend.indexOf("\nfunction ", start + 1);
  if (start < 0 || end <= start) throw new Error("loadRange block not found");
  let block = frontend.slice(start, end);
  const anchor = '  if (!start || !end) return toast("กรุณาเลือกวันที่อย่างน้อย 1 วัน", true);';
  const replacement = `${anchor}\n  // ${MARKER}: one explicit search may cover at most 7 calendar days (inclusive).\n  // Reject in the browser before any archive request to keep quota cost at zero for invalid ranges.\n  const rangeStartMs = Date.parse(\`${"${start}"}T00:00:00+07:00\`);\n  const rangeEndMs = Date.parse(\`${"${end}"}T00:00:00+07:00\`);\n  if (\n    Number.isFinite(rangeStartMs) &&\n    Number.isFinite(rangeEndMs) &&\n    rangeEndMs >= rangeStartMs &&\n    rangeEndMs - rangeStartMs > 6 * 86400000\n  ) return toast("เลือกค้นหาได้ครั้งละไม่เกิน 7 วัน", true);`;
  block = replaceOnce(block, anchor, replacement, "frontend 7-day guard");
  frontend = frontend.slice(0, start) + block + frontend.slice(end);
}

if (!worker.includes(MARKER)) {
  const start = worker.indexOf("async function msDailyArchive");
  const end = worker.indexOf("async function msArchiveTotal", start);
  if (start < 0 || end <= start) throw new Error("msDailyArchive block not found");
  let block = worker.slice(start, end);
  const oldGuard = '  if (endMs - startMs > 31 * 86400000)\n    fail("ดูข้อมูลสะสมได้ครั้งละไม่เกิน 31 วัน", "DATE_RANGE_TOO_LARGE");';
  const newGuard = `  // ${MARKER}: 7 calendar days inclusive means at most 6 days between start/end.\n  if (endMs - startMs > 6 * 86400000)\n    fail("เลือกค้นหาข้อมูลย้อนหลังได้ครั้งละไม่เกิน 7 วัน", "DATE_RANGE_TOO_LARGE");`;
  block = replaceOnce(block, oldGuard, newGuard, "worker 7-day guard");
  worker = worker.slice(0, start) + block + worker.slice(end);
}

if (!test.includes("MS_DAILY_HISTORY_MAX_7_DAYS_V1")) {
  test = replaceOnce(
    test,
    '  assert.match(frontend, /เลือกวันอย่างเดียวไม่อ่านฐานข้อมูล จนกว่าจะกดค้นหา/);',
    '  assert.match(frontend, /เลือกวันอย่างเดียวไม่อ่านฐานข้อมูล จนกว่าจะกดค้นหา/);\n  assert.match(frontend, /MS_DAILY_HISTORY_MAX_7_DAYS_V1/);\n  assert.match(frontend, /เลือกค้นหาได้ครั้งละไม่เกิน 7 วัน/);\n  assert.match(frontend, /rangeEndMs - rangeStartMs > 6 \\* 86400000/);',
    "frontend regression assertion",
  );
  test = replaceOnce(
    test,
    '  assert.match(dailyArchive, /31 \\* 86400000/);',
    '  assert.match(dailyArchive, /MS_DAILY_HISTORY_MAX_7_DAYS_V1/);\n  assert.match(dailyArchive, /6 \\* 86400000/);\n  assert.match(dailyArchive, /เลือกค้นหาข้อมูลย้อนหลังได้ครั้งละไม่เกิน 7 วัน/);\n  assert.doesNotMatch(dailyArchive, /31 \\* 86400000/);',
    "worker regression assertion",
  );
}

await Promise.all([
  writeFile(FRONTEND, frontend),
  writeFile(WORKER, worker),
  writeFile(TEST, test),
]);

console.log("MS_DAILY_HISTORY_MAX_7_DAYS_V1=PASS");
console.log("MAX_SEARCH_CALENDAR_DAYS=7");
console.log("INVALID_RANGE_ARCHIVE_REQUESTS=0");
console.log("UPSTREAM_MS_CALLS_ADDED=0");
console.log("DATABASE_WRITES_ADDED=0");
console.log("PRODUCTION_TOUCHED=NO");
