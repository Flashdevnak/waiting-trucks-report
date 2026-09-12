import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const seedRoot = path.resolve(repoRoot, ".github/bus-hot-lane-v14");
const generatedRoot = path.resolve(repoRoot, ".github/dev-tools");
const hotPatch = fs.existsSync(path.join(generatedRoot, "patch-bus-time-hot-lane-v14.mjs"))
  ? path.join(generatedRoot, "patch-bus-time-hot-lane-v14.mjs")
  : path.join(seedRoot, "patch-bus-time-hot-lane-v14.mjs");
const readonlyPatch = path.join(
  repoRoot,
  "cloudflare-browser-test/scripts/patch-dev-tbr-shadow-readonly.mjs",
);
const splitPatch = path.join(
  repoRoot,
  "cloudflare-browser-test/scripts/patch-dev-tbr-shadow-split-v2.mjs",
);
const canonicalWorker = path.join(repoRoot, "worker/src/index.js");

function stageBusReader() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bus-hot-lane-v14-"));
  const worker = path.join(dir, "index.js");
  fs.copyFileSync(canonicalWorker, worker);
  execFileSync(process.execPath, [readonlyPatch, worker], { stdio: "pipe" });
  execFileSync(process.execPath, [splitPatch, worker], { stdio: "pipe" });
  execFileSync(process.execPath, [hotPatch, worker], { stdio: "pipe" });
  return { dir, worker, source: fs.readFileSync(worker, "utf8") };
}

test("DEV BusTime staging keeps 4s hot detection and removes fake 60s source TTL", () => {
  const staged = stageBusReader();
  try {
    assert.match(staged.source, /BUS_TIME_HOT_LANE_V14/);
    assert.doesNotMatch(staged.source, /BUS_TIME_SOURCE_TTL_MS\s*=\s*60\s*\*\s*1000/);
    assert.match(staged.source, /BUS_TIME_HOT_REUSE_MS\s*=\s*3000/);
    assert.match(staged.source, /BUS_TIME_BACKGROUND_INTERVAL_MS\s*=\s*12\s*\*\s*1000/);
    assert.match(staged.source, /BUS_TIME_MAX_BACKGROUND_CALLS_PER_CYCLE\s*=\s*1/);
    assert.match(staged.source, /BUS_TIME_MAX_CALLS_PER_CYCLE\s*=\s*3/);
  } finally {
    fs.rmSync(staged.dir, { recursive: true, force: true });
  }
});

test("BusTime hot path is per-HUB shared and deep pagination is incremental", () => {
  const staged = stageBusReader();
  try {
    const source = staged.source;
    const start = source.indexOf("// BUS_TIME_HOT_LANE_V14");
    const end = source.indexOf("\nasync function preEntryTrips(", start);
    assert.ok(start >= 0 && end > start);
    const section = source.slice(start, end);
    assert.match(section, /const busTimeStates = new Map\(\)/);
    assert.match(section, /const busTimeSourceActive = new Map\(\)/);
    assert.match(section, /busTimeSourceActive\.has\(key\)/);
    assert.match(section, /busNextBackgroundPage/);
    assert.match(section, /backgroundCalls < BUS_TIME_MAX_BACKGROUND_CALLS_PER_CYCLE/);
    assert.doesNotMatch(section, /Promise\.all\(Array\.from\(\{ length: pages - 1 \}/);
    assert.match(section, /busRecordCall\(state, "hot"\)/);
    assert.match(section, /busRecordCall\(state, "background"\)/);
  } finally {
    fs.rmSync(staged.dir, { recursive: true, force: true });
  }
});

test("100 clients cannot create 100 BusTime readers because Route rows enter one shared coordinator path", () => {
  const staged = stageBusReader();
  try {
    assert.match(
      staged.source,
      /const busData = await readBusTimeData\(env, branch, liveSourceDays\(\), routeRows\);/,
    );
    assert.match(staged.source, /if \(busTimeSourceActive\.has\(key\)\)/);
    assert.match(staged.source, /const task = \(async \(\) => \{/);
    assert.match(staged.source, /busTimeSourceActive\.set\(key, task\)/);
    assert.match(staged.source, /finally\(\(\) => busTimeSourceActive\.delete\(key\)\)/);
  } finally {
    fs.rmSync(staged.dir, { recursive: true, force: true });
  }
});

test("completed routes do not expand the hot active set; midnight routes can add only one prior-day hot page", () => {
  const staged = stageBusReader();
  try {
    assert.match(staged.source, /Number\(row\?\.unloadingState\) !== 2/);
    assert.match(staged.source, /const yesterday = thaiDayOffset\(-1\)/);
    assert.match(staged.source, /activeRows\.some\(\(row\) => busRouteTouchesDay\(row, yesterday\)\)/);
    assert.match(staged.source, /const output = \[primary\]/);
    assert.match(staged.source, /output\.push\(yesterday\)/);
  } finally {
    fs.rmSync(staged.dir, { recursive: true, force: true });
  }
});

test("429 is BusTime-only degradation, honors Retry-After and preserves accepted enrichment", () => {
  const staged = stageBusReader();
  try {
    assert.match(staged.source, /BUS_TIME_RATE_LIMIT/);
    assert.match(staged.source, /parseBusRetryAfter/);
    assert.match(staged.source, /response\.headers\.get\("Retry-After"\)/);
    assert.match(staged.source, /applyBusRateLimit/);
    assert.match(staged.source, /return busResult\(state, true, "BUS_TIME_RATE_LIMIT"\)/);
    assert.match(staged.source, /SELECT rows_json FROM ms_live_cache WHERE hub=\?/);
    assert.match(staged.source, /seedBusTimeFromAcceptedCache/);
    assert.doesNotMatch(
      staged.source.slice(
        staged.source.indexOf("// BUS_TIME_HOT_LANE_V14"),
        staged.source.indexOf("\nasync function preEntryTrips(", staged.source.indexOf("// BUS_TIME_HOT_LANE_V14")),
      ),
      /busTimeStates\.delete|state\.cache\.clear/,
    );
  } finally {
    fs.rmSync(staged.dir, { recursive: true, force: true });
  }
});

test("quota-safe BusTime diagnostics stay in memory and expose the required counters", () => {
  const staged = stageBusReader();
  try {
    for (const marker of [
      "busHotCalls",
      "busBackgroundCalls",
      "busCallsLastMinute",
      "busPagesLastCycle",
      "busCacheHits",
      "busCacheMisses",
      "busRateLimitCount",
      "busCooldownUntil",
      "busLastSuccessAt",
      "busLastError",
      "busActiveRows",
      "busTotalKnownRows",
      "BUS_TIME_TELEMETRY_DB_WRITES=0",
    ]) assert.match(staged.source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(staged.source, /busDiagnostics: busTimeDiagnostics\(hub\)/);
  } finally {
    fs.rmSync(staged.dir, { recursive: true, force: true });
  }
});

test("unchanged/changed DB business-write contract remains owned by existing sourceHash diff path", () => {
  const staged = stageBusReader();
  try {
    assert.match(staged.source, /canonicalMsSource\(mappedRows\)/);
    assert.match(staged.source, /readMsLiveCache\(env, branch, sourceHash\)/);
    assert.match(staged.source, /changes:\s*0/);
    assert.match(staged.source, /baselineRows/);
    assert.match(staged.source, /planMsChanges/);
  } finally {
    fs.rmSync(staged.dir, { recursive: true, force: true });
  }
});
