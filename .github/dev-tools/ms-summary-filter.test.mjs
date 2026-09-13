import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { stageFrontend } from "./stage-dev-runtime.mjs";

const root = new URL("../../", import.meta.url);
const source = await readFile(new URL("ms.js", root), "utf8");
const staged = stageFrontend(source);

test("active inbound summary cards include Drop in waiting/unloading and hold completed Drop for release", () => {
  assert.match(staged, /state\.queue = "queue";\s*el\("queue-filter"\)\.value = "queue";/);
  assert.match(staged, /state\.summary === "waiting" &&\s*\(isDestination\(row\) \|\| isDrop\(row\)\) &&\s*queue\.active &&\s*!queue\.started &&\s*!queue\.awaitingRelease/);
  assert.match(staged, /state\.summary === "unloading" &&\s*\(isDestination\(row\) \|\| isDrop\(row\)\) &&\s*queue\.active &&\s*queue\.started &&\s*!queue\.awaitingRelease/);
  assert.match(staged, /state\.summary === "origin" &&\s*\(\(isOrigin\(row\) && !queue\.done && !queue\.cancelled\) \|\|\s*\(isDrop\(row\) && queue\.active && queue\.awaitingRelease\)\)/);
  assert.match(staged, /state\.summary === "drop" &&\s*isDrop\(row\) &&\s*queue\.done &&\s*queue\.released &&\s*!queue\.cancelled/);
});

test("completed card displays the authoritative daily Destination rows represented by its total", () => {
  assert.match(staged, /const completedRows = Array\.isArray\(completed\?\.rows\) \? completed\.rows : \[\]/);
  assert.match(staged, /state\.archiveRows\.filter\(\(row\) => !isCompletedToday\(row\)\)/);
  assert.match(staged, /state\.completedToday = Number\(completed\?\.total\) \|\| completedRows\.length/);
  assert.match(staged, /state\.summary === "completed" && isDestination\(row\) && isCompletedToday\(row\)/);
  for (const field of ["query", "dateFrom", "dateTo"]) {
    assert.match(staged, new RegExp(`state\\.${field} = ""`));
  }
  for (const field of ["attendance", "attribute", "region", "route", "status"]) {
    assert.match(staged, new RegExp(`state\\.${field} = "all"`));
  }
  assert.match(staged, /state\.queue = "all";\s*el\("queue-filter"\)\.value = "all";/);
});

test("completed/drop views keep active cards on live current queue and hydrate released Drop separately", () => {
  assert.match(
    staged,
    /function filteredRows\(ignoreSummary = false, queueMode = state\.queue\)/,
  );
  assert.match(
    staged,
    /const useCompletedTodayDataset =\s*state\.status === "unload-overtime" \|\|\s*\(!ignoreSummary &&\s*\(state\.summary === "completed" \|\|\s*state\.summary === "unload-overtime" \|\|\s*state\.summary === "drop"\)\);/,
  );
  assert.match(
    staged,
    /const useArchive =\s*queueMode === "completed" \|\|\s*\(queueMode === "all" && state\.archiveView\);/,
  );
  assert.match(
    staged,
    /const source = useCompletedTodayDataset\s*\? completedTodayDatasetRows\(\)\s*:\s*useArchive\s*\? state\.archiveRows\s*:\s*state\.currentRows;/,
  );
  assert.match(
    staged,
    /const summaryRows = filteredRows\(\s*true,/,
  );
  assert.match(
    staged,
    /state\.summary === "completed" \|\|\s*state\.summary === "completed-all" \|\|\s*state\.summary === "unload-overtime" \|\|\s*state\.summary === "cancelled"\s*\? "queue"\s*: state\.queue/,
  );
  assert.match(staged, /queueMode === "all"/);
  assert.match(staged, /queueMode === "queue" && queue\.active/);
  assert.match(staged, /state\.summary === "drop" &&\s*queue\.done &&\s*queue\.released/);
  assert.match(staged, /queueMode === "queue" \? aTime - bTime : bTime - aTime/);
});

test("summary filter staging does not change polling or realtime recovery", () => {
  assert.match(staged, /pollMs:\s*4000/);
  assert.match(staged, /requestTimeoutMs:\s*32000/);
  assert.doesNotMatch(staged, /if \(!silent && !state\.archiveLoaded\) scheduleArchiveLoad\(\)/);
});
