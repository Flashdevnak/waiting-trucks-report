import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { stageWorker } from "../../.github/dev-tools/stage-dev-runtime.mjs";

const front = fs.readFileSync(new URL("../../ms.js", import.meta.url), "utf8");
const report = fs.readFileSync(new URL("../../ms-report.js", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const staged = stageWorker(worker);

test("MS frontend preserves accepted rows across transient empty snapshots without new polling", () => {
  assert.match(front, /MS_TRANSIENT_EMPTY_CONFIRM_V1/);
  assert.match(front, /function applyAcceptedLiveResult/);
  assert.match(front, /ได้รับข้อมูลว่างชั่วคราว/);
  assert.match(front, /คงข้อมูลล่าสุดไว้/);
  assert.match(front, /if \(applyAcceptedLiveResult\(payload, true\)\) saveFastRefreshSnapshot\(\)/);
  assert.match(front, /if \(applyAcceptedLiveResult\(result, false\)\) saveFastRefreshSnapshot\(\)/);
  assert.match(front, /snapshot\.rows\.length > 0/);
  assert.match(front, /transientEmptyHoldActive/);
  assert.doesNotMatch(front, /setInterval\(\(\) => state\.auth && loadData\(true\), CONFIG\.pollMs\)/);
  assert.match(front, /setInterval\(realtimeTick, CONFIG\.pollMs\)/);
});

test("DEV staged worker holds the first suspicious empty source result without extra upstream calls", () => {
  assert.match(staged, /MS_TRANSIENT_EMPTY_SOURCE_GUARD_V1/);
  assert.match(staged, /holdTransientEmptyMsSource/);
  assert.match(staged, /SELECT rows_json,synced_at FROM ms_live_cache WHERE hub=\?/);
  assert.match(staged, /transientEmptyHeld: true/);
  assert.match(staged, /MS_TRANSIENT_EMPTY_CONFIRM_WINDOW_MS = 2 \* 60 \* 1000/);
  const helper = staged.slice(
    staged.indexOf("async function holdTransientEmptyMsSource"),
    staged.indexOf("async function runMsRefresh"),
  );
  assert.doesNotMatch(helper, /fetch\(|readMsRoutes\(|setTimeout\(|setInterval\(/);
  assert.doesNotMatch(helper, /INSERT|UPDATE|DELETE|REPLACE/);
});

test("DEV report uses the promoted Worker and never the retired API", () => {
  assert.match(report, /waiting-trucks-report-api-dev\.26nak-testdev\.workers\.dev/);
  assert.doesNotMatch(report, /waiting-trucks-report\.alert-squid-6738\.chatgpt\.site/);
});
