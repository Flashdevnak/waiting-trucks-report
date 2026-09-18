import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { stageFrontend, stageWorker } from "./stage-dev-runtime.mjs";

const worker = fs.readFileSync(new URL("../../worker/src/index.js", import.meta.url), "utf8");
const front = fs.readFileSync(new URL("../../ms.js", import.meta.url), "utf8");
const patch = fs.readFileSync(new URL("./patch-bus-time-hot-lane-v14.mjs", import.meta.url), "utf8");
const stagedFront = stageFrontend(front);
const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), "ms-source-realtime-"));
const stagedTarget = path.join(stageDir, "index.js");
fs.writeFileSync(stagedTarget, stageWorker(worker));
for (const script of [
  "../../cloudflare-browser-test/scripts/patch-dev-tbr-shadow-readonly.mjs",
  "../../cloudflare-browser-test/scripts/patch-dev-tbr-shadow-split-v2.mjs",
  "./patch-bus-time-hot-lane-v14.mjs",
]) {
  execFileSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), stagedTarget], { stdio: "pipe" });
}
const staged = fs.readFileSync(stagedTarget, "utf8");
process.on("exit", () => fs.rmSync(stageDir, { recursive: true, force: true }));

test("shared Route source is eligible on every existing 4-second leader cycle", () => {
  assert.match(front, /pollMs:\s*4000/);
  assert.match(front, /setInterval\(realtimeTick, CONFIG\.pollMs\)/);
  assert.doesNotMatch(front, /setInterval\(\(\) => state\.auth && loadData\(true\), CONFIG\.pollMs\)/);
  assert.match(patch, /MS_REALTIME_SOURCE_MIN_MS = 3 \* 1000/);
  assert.doesNotMatch(patch, /MS_REALTIME_SOURCE_MIN_MS = 12 \* 1000/);
  assert.match(staged, /MS_REALTIME_SOURCE_MIN_MS = 3 \* 1000/);
  assert.match(staged, /nowMs - this\.lastSourceAt < MS_REALTIME_SOURCE_MIN_MS/);
  assert.match(staged, /!force &&[\s\S]*!cron &&[\s\S]*MS_REALTIME_SOURCE_MIN_MS/);
});

test("existing unload and drop truth stay behind their dedicated regressions while the 12-second Route gate is removed", () => {
  assert.match(staged, /MS_ROUTE_SHARED_SOURCE_CADENCE_V1/);
  assert.doesNotMatch(staged, /MS_REALTIME_SOURCE_MIN_MS = 12 \* 1000/);
  assert.match(stagedFront, /MS_OPERATIONAL_12H_EXPIRY_V1/);
});

test("silent leader failure is recovered after about two missed visible cycles", () => {
  assert.match(front, /MS_REALTIME_FAILOVER_V2/);
  assert.match(front, /REALTIME_FOLLOWER_TAKEOVER_MS = 2 \* CONFIG\.pollMs \+ 1000/);
  assert.match(front, /now - realtimeLastSnapshotAt > REALTIME_FOLLOWER_TAKEOVER_MS/);
});

test("in-flight shared Route refresh is joined instead of replaying stale unload state", () => {
  assert.match(staged, /MS_ROUTE_ACTIVE_REFRESH_JOIN_V1/);
  const activeStart = staged.indexOf("if (this.active)");
  const activeEnd = staged.indexOf("const task = runMsRefresh", activeStart);
  assert.ok(activeStart >= 0 && activeEnd > activeStart);
  const activeBlock = staged.slice(activeStart, activeEnd);
  assert.match(activeBlock, /await this\.active/);
  assert.doesNotMatch(activeBlock, /if \(!force && this\.lastResult\) return this\.lastResult/);
  assert.match(activeBlock, /if \(!force && this\.lastResult\)/);
  assert.match(staged, /MS_ROUTE_SHARED_SOURCE_MIN_MS = 3 \* 1000/);
});
