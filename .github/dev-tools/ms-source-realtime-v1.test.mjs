import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
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

test("Route waiting-to-unloading fast path is keyed by proof+attendance and does not wait for optional truth", () => {
  assert.match(staged, /MS_ROUTE_LIFECYCLE_FAST_PUBLISH_V1/);
  assert.match(staged, /const routePromise = readMsRoutes\(credentials\)/);
  assert.match(staged, /const optionalPromise = Promise\.all\(\[/);
  assert.match(staged, /const rows = await routePromise/);
  assert.match(staged, /routeLifecycleOptionalMaps\(lifecycleBaselineRows\)/);
  assert.match(staged, /waitUntil\(optionalPromise\.then\(\(\) => undefined, \(\) => undefined\)\)/);
  assert.match(staged, /rememberRouteLifecycleRows\(branch, msQueueFirstSourceRows\(sync\.rows, busData, branch\)\)/);

  const start = staged.indexOf("// MS_ROUTE_LIFECYCLE_FAST_PUBLISH_V1");
  const end = staged.indexOf("\nasync function readBusTimeData", start);
  assert.ok(start >= 0 && end > start, "Route lifecycle fast helper block missing");
  const helperSource = staged.slice(start, end);
  const context = {
    Map,
    Boolean,
    Number,
    String,
    normalizeProofId(value) {
      return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
    },
    normalizeMsAttendance(value) {
      const text = String(value || "").trim();
      if (text.includes("จุดดร")) return "จุดดรอป";
      if (text.includes("ปลายทาง")) return "ปลายทาง";
      if (text.includes("ต้นทาง")) return "ต้นทาง";
      return text;
    },
  };
  vm.createContext(context);
  vm.runInContext(
    helperSource +
      "\nthis.fast = routeLifecycleFastTransition;" +
      "\nthis.optional = routeLifecycleOptionalMaps;",
    context,
  );

  const tbrWaiting = [{
    id: "TBR:NE1:P1:ปลายทาง",
    proofId: "P1",
    attendanceType: "ปลายทาง",
    unloadingState: null,
    scheduleTbrArrivalAt: "2026-09-18T10:00:00.000Z",
    expectedParcels: 100,
    enteredParcels: 20,
  }];
  const routeUnloading = [{
    id: "ROUTE-1",
    proofId: "P1",
    attendanceType: "ปลายทาง",
    unloadingState: 1,
    actualArrivalAt: "2026-09-18T10:01:00.000Z",
  }];
  assert.equal(context.fast(tbrWaiting, routeUnloading), true);
  assert.equal(context.fast([{ ...tbrWaiting[0], unloadingState: 0 }], routeUnloading), true);
  assert.equal(context.fast([{ ...tbrWaiting[0], unloadingState: 1 }], routeUnloading), false);
  assert.equal(
    context.fast([{ ...tbrWaiting[0], unloadingState: 0 }], [{ ...routeUnloading[0], unloadingState: 2 }]),
    false,
  );

  const preserved = context.optional(tbrWaiting);
  assert.equal(preserved.parcelCounts.get("P:P1").expectedParcels, 100);
  assert.equal(
    preserved.busData.get("P:P1|A:ปลายทาง").scheduleTbrArrivalAt,
    "2026-09-18T10:00:00.000Z",
  );
});

test("Route fast publish adds no new upstream cadence or database path", () => {
  const refresh = staged.slice(
    staged.indexOf("async function runMsRefresh(env, branch, waitUntil = null) {"),
    staged.indexOf("\nasync function readMsLiveCache(", staged.indexOf("async function runMsRefresh(env, branch, waitUntil = null) {")),
  );
  assert.equal((refresh.match(/readMsRoutes\(credentials\)/g) || []).length, 1);
  assert.equal((refresh.match(/readPreEntryCounts\(env, branch\)/g) || []).length, 1);
  assert.equal(
    (refresh.match(/readBusTimeData\(env, branch, liveSourceDays\(\), routeHintRows\)/g) || []).length,
    1,
  );
  assert.doesNotMatch(refresh, /setInterval\s*\(/);
  const fastStart = refresh.indexOf("const routePromise = readMsRoutes(credentials);");
  const fastEnd = refresh.indexOf("const previousEnrichment", fastStart);
  assert.ok(fastStart >= 0 && fastEnd > fastStart, "Route fast-publish block missing");
  const fastBlock = refresh.slice(fastStart, fastEnd);
  assert.doesNotMatch(fastBlock, /env\.DB|INSERT INTO|UPDATE\s+ms_|DELETE FROM/i);
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
