// V3_DEPLOY_TRIGGER_20260908: direct owner push so normal deployment workflows execute.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  hasLegacyCompletionBurstRows,
  patchMsCompletionBurstWorker,
} from "./patch-ms-completion-burst-v3.mjs";
import { stageWorker } from "./stage-dev-runtime.mjs";

const completion = "2026-09-08T06:29:19.777Z";
const ea2 = Array.from({ length: 19 }, (_, index) => ({
  id: `EA2-${index}`,
  unloadingState: 2,
  unloadingCompletedAt: completion,
  actualArrivalAt: new Date(Date.parse("2026-09-07T14:34:19.743Z") + index * 45 * 60 * 1000).toISOString(),
}));

test("EA2 13:29 mass catch-up is classified as legacy observation artifact", () => {
  assert.equal(hasLegacyCompletionBurstRows(ea2), true);
});

test("small close-together groups are not guessed away", () => {
  const rows = ea2.slice(0, 5).map((row, index) => ({
    ...row,
    id: `SMALL-${index}`,
    actualArrivalAt: new Date(Date.parse("2026-09-07T13:26:00Z") + index * 5 * 60 * 1000).toISOString(),
  }));
  assert.equal(hasLegacyCompletionBurstRows(rows), false);
});

test("post continuous-cron observations are never treated as legacy bursts", () => {
  const rows = ea2.map((row, index) => ({
    ...row,
    id: `CURRENT-${index}`,
    unloadingCompletedAt: "2026-09-08T13:30:00.000Z",
  }));
  assert.equal(hasLegacyCompletionBurstRows(rows), false);
});

test("staged worker keeps completion truth while quota-safe repair is persistently gated", async () => {
  const root = new URL("../../", import.meta.url);
  const source = await readFile(new URL("worker/src/index.js", root), "utf8");
  const staged = stageWorker(source);
  assert.match(staged, /MS_COMPLETION_BURST_TRUTH_V3/);
  assert.match(staged, /LAG\(CAST\(json_extract\(payload_json,'\$\.unloadingState'\) AS INTEGER\)\)/);
  assert.match(staged, /legacy_bursts/);
  assert.match(staged, /MS_SCHEDULE_COMPLETION_TRUTH_V4/);
  assert.match(staged, /completion_source='SCHEDULE'/);
  assert.doesNotMatch(staged, /SELECT h1\.payload_json/);
  assert.doesNotMatch(staged, /legacyCompletionBurst/);
  assert.match(staged, /startsWith\(MS_LIVE_CACHE_VERSION \+ ":"\)/);
  assert.doesNotMatch(staged, /if \(!completionRepairChecked\.has\(hub\)\) \{/);
  assert.equal(patchMsCompletionBurstWorker(staged), staged);
});
