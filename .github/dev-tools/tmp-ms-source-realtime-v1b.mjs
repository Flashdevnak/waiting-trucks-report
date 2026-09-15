import fs from "node:fs";

function mustReplace(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`patch failed: ${label}`);
  return source.replace(from, to);
}

let hot = fs.readFileSync(".github/dev-tools/patch-bus-time-hot-lane-v14.mjs", "utf8");
hot = mustReplace(
  hot,
  "// while one per-HUB coordinator shares Route upstream work at a bounded 12-second cadence.\n// Explicit force refresh remains authoritative and bypasses this source gate.\nconst MS_REALTIME_SOURCE_MIN_MS = 12 * 1000;",
  "// while one per-HUB coordinator shares Route upstream work. A 3-second dedupe floor\n// allows every existing 4-second leader cycle to observe fresh Route truth without\n// turning source work into per-client polling. Explicit force refresh still bypasses it.\nconst MS_REALTIME_SOURCE_MIN_MS = 3 * 1000;",
  "shared Route cadence",
);
hot = hot.replaceAll("MS_ROUTE_SHARED_SOURCE_MIN_MS=12000", "MS_ROUTE_SHARED_SOURCE_MIN_MS=3000");
fs.writeFileSync(".github/dev-tools/patch-bus-time-hot-lane-v14.mjs", hot);

let front = fs.readFileSync("ms.js", "utf8");
front = mustReplace(
  front,
  "const REALTIME_AUTH_HEARTBEAT_MS = 60 * 1000;",
  "const REALTIME_AUTH_HEARTBEAT_MS = 60 * 1000;\n// MS_REALTIME_FAILOVER_V2: after two missed visible cycles plus 1s grace, a follower\n// can refresh the same shared per-HUB coordinator. Healthy followers remain passive.\nconst REALTIME_FOLLOWER_TAKEOVER_MS = 2 * CONFIG.pollMs + 1000;",
  "follower constant",
);
front = mustReplace(
  front,
  "      now - realtimeLastSnapshotAt > CONFIG.staleMs;",
  "      now - realtimeLastSnapshotAt > REALTIME_FOLLOWER_TAKEOVER_MS;",
  "follower stale threshold",
);
fs.writeFileSync("ms.js", front);

let q = fs.readFileSync(".github/dev-tools/realtime-quota-hardening.test.mjs", "utf8");
q = mustReplace(
  q,
  'test("4-second UI cadence is decoupled from shared Route upstream cadence", () => {',
  'test("4-second visible cycle can observe fresh shared Route source without per-client polling", () => {',
  "quota test name",
);
q = mustReplace(q, "assert.match(hotLanePatch, /MS_REALTIME_SOURCE_MIN_MS = 12 \\* 1000/);", "assert.match(hotLanePatch, /MS_REALTIME_SOURCE_MIN_MS = 3 \\* 1000/);", "quota source assertion");
q = mustReplace(q, "assert.doesNotMatch(hotLanePatch, /MS_REALTIME_SOURCE_MIN_MS = 4 \\* 1000/);", "assert.doesNotMatch(hotLanePatch, /MS_REALTIME_SOURCE_MIN_MS = 12 \\* 1000/);\n  assert.match(front, /REALTIME_FOLLOWER_TAKEOVER_MS = 2 \\* CONFIG\\.pollMs \\+ 1000/);\n  assert.match(front, /now - realtimeLastSnapshotAt > REALTIME_FOLLOWER_TAKEOVER_MS/);", "quota latency assertions");
fs.writeFileSync(".github/dev-tools/realtime-quota-hardening.test.mjs", q);

fs.writeFileSync(".github/dev-tools/ms-source-realtime-v1.test.mjs", `import assert from "node:assert/strict";\nimport fs from "node:fs";\nimport test from "node:test";\nimport { stageWorker } from "./stage-dev-runtime.mjs";\n\nconst worker = fs.readFileSync(new URL("../../worker/src/index.js", import.meta.url), "utf8");\nconst front = fs.readFileSync(new URL("../../ms.js", import.meta.url), "utf8");\nconst patch = fs.readFileSync(new URL("./patch-bus-time-hot-lane-v14.mjs", import.meta.url), "utf8");\nconst staged = stageWorker(worker);\n\ntest("shared Route source is eligible on every existing 4-second leader cycle", () => {\n  assert.match(front, /pollMs:\\s*4000/);\n  assert.match(front, /setInterval\\(realtimeTick, CONFIG\\.pollMs\\)/);\n  assert.doesNotMatch(front, /setInterval\\(\\(\\) => state\\.auth && loadData\\(true\\), CONFIG\\.pollMs\\)/);\n  assert.match(patch, /MS_REALTIME_SOURCE_MIN_MS = 3 \\* 1000/);\n  assert.doesNotMatch(patch, /MS_REALTIME_SOURCE_MIN_MS = 12 \\* 1000/);\n  assert.match(staged, /MS_REALTIME_SOURCE_MIN_MS = 3 \\* 1000/);\n});\n\ntest("unload completion truth is not held behind a 12-second source gate", () => {\n  assert.match(front, /state === 2/);\n  assert.match(front, /stage: "unloading-complete"/);\n  assert.match(staged, /MS_ROUTE_SHARED_SOURCE_CADENCE_V1/);\n  assert.doesNotMatch(staged, /MS_REALTIME_SOURCE_MIN_MS = 12 \\* 1000/);\n});\n\ntest("silent leader failure is recovered after about two missed visible cycles", () => {\n  assert.match(front, /MS_REALTIME_FAILOVER_V2/);\n  assert.match(front, /REALTIME_FOLLOWER_TAKEOVER_MS = 2 \\* CONFIG\\.pollMs \\+ 1000/);\n  assert.match(front, /now - realtimeLastSnapshotAt > REALTIME_FOLLOWER_TAKEOVER_MS/);\n});\n`);

console.log("MS_SOURCE_REALTIME_V1_PATCH=APPLIED");
