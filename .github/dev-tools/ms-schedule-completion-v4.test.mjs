import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stageWorker } from "./stage-dev-runtime.mjs";

test("staged runtime keeps Route status authority and accepts Schedule provenance in every history output", async () => {
  const root = new URL("../../", import.meta.url);
  const worker = await readFile(new URL("worker/src/index.js", root), "utf8");
  const staged = stageWorker(worker);
  assert.match(staged, /MS_SCHEDULE_COMPLETION_TRUTH_V4/);
  assert.match(staged, /completionTruth = resolveCompletionTruth/);
  assert.match(staged, /COALESCE\(json_extract\(payload_json,'\$\.completionSource'\),''\) AS completion_source[\s\S]*completion_source='SCHEDULE'/);
  assert.match(staged, /readBusTimeData\(env, branch\)/);
  assert.doesNotMatch(staged, /Schedule.*unloadingState\s*=/i);
});
