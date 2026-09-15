import fs from "node:fs";

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  const last = source.lastIndexOf(from);
  if (first < 0 || first !== last) throw new Error(`patch failed: ${label}`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

const hotPath = ".github/dev-tools/patch-bus-time-hot-lane-v14.mjs";
let hot = fs.readFileSync(hotPath, "utf8");
hot = replaceOnce(
  hot,
  "// while one per-HUB coordinator shares Route upstream work at a bounded 12-second cadence.\n// Explicit force refresh remains authoritative and bypasses this source gate.\nconst MS_REALTIME_SOURCE_MIN_MS = 12 * 1000;",
  "// while one per-HUB coordinator shares Route upstream work. A 3-second dedupe floor\n// allows every existing 4-second leader cycle to observe fresh Route truth without\n// turning source work into per-client polling. Explicit force refresh still bypasses it.\nconst MS_REALTIME_SOURCE_MIN_MS = 3 * 1000;",
  "Route source cadence",
);
hot = replaceOnce(
  hot,
  'console.log("MS_ROUTE_SHARED_SOURCE_MIN_MS=12000");',
  'console.log("MS_ROUTE_SHARED_SOURCE_MIN_MS=3000");',
  "Route source cadence log",
);
fs.writeFileSync(hotPath, hot);

const frontPath = "ms.js";
let front = fs.readFileSync(frontPath, "utf8");
front = replaceOnce(
  front,
  "const REALTIME_AUTH_HEARTBEAT_MS = 60 * 1000;",
  "const REALTIME_AUTH_HEARTBEAT_MS = 60 * 1000;\n// MS_REALTIME_FAILOVER_V2: after two missed visible cycles plus 1s grace, a follower\n// can refresh the same shared per-HUB coordinator. Healthy followers remain passive.\nconst REALTIME_FOLLOWER_TAKEOVER_MS = 2 * CONFIG.pollMs + 1000;",
  "follower takeover constant",
);
front = replaceOnce(
  front,
  "      now - realtimeLastSnapshotAt > CONFIG.staleMs;",
  "      now - realtimeLastSnapshotAt > REALTIME_FOLLOWER_TAKEOVER_MS;",
  "follower takeover threshold",
);
fs.writeFileSync(frontPath, front);

const testPath = ".github/dev-tools/realtime-quota-hardening.test.mjs";
let test = fs.readFileSync(testPath, "utf8");
test = replaceOnce(
  test,
  `test("4-second UI cadence is decoupled from shared Route upstream cadence", () => {\n  assert.match(hotLanePatch, /MS_ROUTE_SHARED_SOURCE_CADENCE_V1/);\n  assert.match(hotLanePatch, /MS_REALTIME_SOURCE_MIN_MS = 12 \\* 1000/);\n  assert.match(hotLanePatch, /nowMs - this\\.lastSourceAt < MS_REALTIME_SOURCE_MIN_MS/);\n  assert.match(hotLanePatch, /!force &&[\\s\\S]*!cron &&[\\s\\S]*MS_REALTIME_SOURCE_MIN_MS/);\n  assert.match(front, /pollMs:\\s*4000/);\n  assert.doesNotMatch(hotLanePatch, /MS_REALTIME_SOURCE_MIN_MS = 4 \\* 1000/);\n});`,
  `test("4-second visible cycle can observe fresh shared Route source without per-client polling", () => {\n  assert.match(hotLanePatch, /MS_ROUTE_SHARED_SOURCE_CADENCE_V1/);\n  assert.match(hotLanePatch, /MS_REALTIME_SOURCE_MIN_MS = 3 \\* 1000/);\n  assert.match(hotLanePatch, /nowMs - this\\.lastSourceAt < MS_REALTIME_SOURCE_MIN_MS/);\n  assert.match(hotLanePatch, /!force &&[\\s\\S]*!cron &&[\\s\\S]*MS_REALTIME_SOURCE_MIN_MS/);\n  assert.match(front, /pollMs:\\s*4000/);\n  assert.doesNotMatch(hotLanePatch, /MS_REALTIME_SOURCE_MIN_MS = 12 \\* 1000/);\n  assert.match(front, /REALTIME_FOLLOWER_TAKEOVER_MS = 2 \\* CONFIG\\.pollMs \\+ 1000/);\n  assert.match(front, /now - realtimeLastSnapshotAt > REALTIME_FOLLOWER_TAKEOVER_MS/);\n});`,
  "realtime cadence regression test",
);
fs.writeFileSync(testPath, test);

const focusedPath = ".github/dev-tools/ms-source-realtime-v1.test.mjs";
fs.writeFileSync(focusedPath, `import assert from "node:assert/strict";\nimport fs from "node:fs";\nimport test from "node:test";\nimport { stageWorker } from "./stage-dev-runtime.mjs";\n\nconst worker = fs.readFileSync(new URL("../../worker/src/index.js", import.meta.url), "utf8");\nconst front = fs.readFileSync(new URL("../../ms.js", import.meta.url), "utf8");\nconst patch = fs.readFileSync(new URL("./patch-bus-time-hot-lane-v14.mjs", import.meta.url), "utf8");\nconst staged = stageWorker(worker);\n\ntest("shared Route source is eligible on every existing 4-second leader cycle", () => {\n  assert.match(front, /pollMs:\\s*4000/);\n  assert.match(front, /setInterval\\(realtimeTick, CONFIG\\.pollMs\\)/);\n  assert.doesNotMatch(front, /setInterval\\(\\(\\) => state\\.auth && loadData\\(true\\), CONFIG\\.pollMs\\)/);\n  assert.match(patch, /MS_REALTIME_SOURCE_MIN_MS = 3 \\* 1000/);\n  assert.doesNotMatch(patch, /MS_REALTIME_SOURCE_MIN_MS = 12 \\* 1000/);\n  assert.match(staged, /MS_REALTIME_SOURCE_MIN_MS = 3 \\* 1000/);\n  assert.match(staged, /nowMs - this\\.lastSourceAt < MS_REALTIME_SOURCE_MIN_MS/);\n});\n\ntest("unload completion truth is not held behind a 12-second source gate", () => {\n  assert.match(front, /state === 2/);\n  assert.match(front, /stage: "unloading-complete"/);\n  assert.match(staged, /MS_ROUTE_SHARED_SOURCE_CADENCE_V1/);\n  assert.doesNotMatch(staged, /MS_REALTIME_SOURCE_MIN_MS = 12 \\* 1000/);\n});\n\ntest("silent leader failure is recovered after about two missed visible cycles", () => {\n  assert.match(front, /MS_REALTIME_FAILOVER_V2/);\n  assert.match(front, /REALTIME_FOLLOWER_TAKEOVER_MS = 2 \\* CONFIG\\.pollMs \\+ 1000/);\n  assert.match(front, /realtimeIsLeader === false/);\n  assert.match(front, /now - realtimeLastSnapshotAt > REALTIME_FOLLOWER_TAKEOVER_MS/);\n});\n`);

console.log("MS_SOURCE_REALTIME_V1_PATCH=APPLIED");
