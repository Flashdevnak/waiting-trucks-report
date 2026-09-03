import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { stageWorker } from "./stage-dev-runtime.mjs";

const root = new URL("../../", import.meta.url);
const frontend = await readFile(new URL("ms.js", root), "utf8");
const workerBase = await readFile(new URL("worker/src/index.js", root), "utf8");
const worker = stageWorker(workerBase);

test("accumulated card loads authoritative registry total without loading history", () => {
  assert.match(frontend, /archiveTotalLoaded: false/);
  assert.match(frontend, /apiGet\("msArchiveTotal", \{ branch \}\)/);
  assert.match(frontend, /if \(!state\.archiveTotalLoaded\) void ensureArchiveTotalLoaded\(\)/);
  assert.doesNotMatch(frontend, /metric-archive"\)\.textContent = "กดดู"/);
  assert.match(frontend, /pollMs:\s*4000/);
  assert.match(frontend, /DEV: archive stays lazy; live polling must never auto-read msArchive/);
});

test("archive returns latest snapshot for every distinct route without newest-10000 cap", () => {
  const start = worker.indexOf("async function msArchive(env, actor, hub)");
  const end = worker.indexOf("async function msCryptoKey", start);
  assert.ok(start >= 0 && end > start);
  const section = worker.slice(start, end);
  assert.match(section, /ROW_NUMBER\(\) OVER \(/);
  assert.match(section, /PARTITION BY route_id/);
  assert.match(section, /WHERE rn=1/);
  assert.doesNotMatch(section, /LIMIT 10000/);
  assert.match(section, /complete = rows\.length >= totalDistinct/);
});

test("frontend refuses a silently incomplete accumulated archive", () => {
  assert.match(frontend, /archive\?\.complete === false \|\| archiveRows\.length < archiveTotal/);
  assert.match(frontend, /รายการสะสมไม่ครบ/);
});

test("archive total endpoint stays lightweight", () => {
  assert.match(worker, /action === "msArchiveTotal"/);
  const start = worker.indexOf("async function msArchiveTotal");
  const end = worker.indexOf("async function msArchive(env", start);
  const section = worker.slice(start, end);
  assert.match(section, /COUNT\(\*\) AS total_distinct FROM ms_route_registry/);
  assert.doesNotMatch(section, /ms_route_history/);
});
