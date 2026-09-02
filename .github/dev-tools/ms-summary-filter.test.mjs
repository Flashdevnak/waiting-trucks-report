import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { patchDevMsArchive } from "../../worker/scripts/patch-dev-ms-archive.mjs";
import { patchDevRealtimeFrontend } from "./patch-ms-realtime-recovery.mjs";
import { patchDevSummaryFilter } from "./patch-ms-summary-filter.mjs";

const root = new URL("../../", import.meta.url);
const source = await readFile(new URL("ms.js", root), "utf8");
const staged = patchDevSummaryFilter(
  patchDevRealtimeFrontend(patchDevMsArchive(source)),
);

test("five active queue summary cards keep their original queue logic", () => {
  assert.match(staged, /state\.queue = "queue";\s*el\("queue-filter"\)\.value = "queue";/);
  assert.match(staged, /state\.summary === "waiting" && isDestination\(row\) && status\.key === "arrived"/);
  assert.match(staged, /state\.summary === "unloading" && isDestination\(row\) && status\.key === "unloading"/);
  assert.match(staged, /state\.summary === "origin" && isOrigin\(row\) && !queue\.done/);
  assert.match(staged, /state\.summary === "drop" && isDrop\(row\) && !queue\.done/);
});

test("completed card displays the authoritative daily rows represented by its total", () => {
  assert.match(staged, /const completedRows = Array\.isArray\(completed\?\.rows\) \? completed\.rows : \[\]/);
  assert.match(staged, /state\.archiveRows\.filter\(\(row\) => !isCompletedToday\(row\)\)/);
  assert.match(staged, /state\.completedToday = Number\(completed\?\.total\) \|\| completedRows\.length/);
  assert.match(staged, /state\.summary === "completed" && isCompletedToday\(row\)/);
  for (const field of ["query", "dateFrom", "dateTo"]) {
    assert.match(staged, new RegExp(`state\\.${field} = ""`));
  }
  for (const field of ["attendance", "attribute", "region", "route", "status"]) {
    assert.match(staged, new RegExp(`state\\.${field} = "all"`));
  }
  assert.match(staged, /state\.queue = "all";\s*el\("queue-filter"\)\.value = "all";/);
});

test("completed view keeps the other five cards on the live current queue", () => {
  assert.match(
    staged,
    /function filteredRows\(ignoreSummary = false, queueMode = state\.queue\)/,
  );
  assert.match(
    staged,
    /queueMode === "queue" \? state\.currentRows : state\.archiveRows/,
  );
  assert.match(
    staged,
    /state\.summary === "completed" \? "queue" : state\.queue/,
  );
  assert.match(staged, /queueMode === "all"/);
  assert.match(staged, /queueMode === "queue" && queue\.active/);
  assert.match(staged, /queueMode === "queue" \? aTime - bTime : bTime - aTime/);
});

test("summary filter fix does not change polling or realtime recovery", () => {
  assert.match(staged, /pollMs:\s*4000/);
  assert.match(staged, /requestTimeoutMs:\s*22000/);
  assert.doesNotMatch(staged, /if \(!silent && !state\.archiveLoaded\) scheduleArchiveLoad\(\)/);
});
