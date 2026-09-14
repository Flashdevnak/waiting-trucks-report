import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { stageWorker } from "./stage-dev-runtime.mjs";
import {
  BUS_TIME_SESSION_COOLDOWN_MS,
  createBusTimeHotLane,
} from "./bus-time-hot-lane-v14-runtime.mjs";

const worker = fs.readFileSync(new URL("../../worker/src/index.js", import.meta.url), "utf8");
const front = fs.readFileSync(new URL("../../ms.js", import.meta.url), "utf8");
const proof = fs.readFileSync(new URL("../../worker/src/proof-control.js", import.meta.url), "utf8");
const turso = fs.readFileSync(new URL("../../worker/src/turso-index.js", import.meta.url), "utf8");
const browser = fs.readFileSync(new URL("../../cloudflare-browser-test/src/index.js", import.meta.url), "utf8");
const hotLanePatch = fs.readFileSync(new URL("./patch-bus-time-hot-lane-v14.mjs", import.meta.url), "utf8");
const staged = stageWorker(worker);

test("visible realtime stays four seconds while direct HTTP 4s polling is removed", () => {
  assert.match(front, /pollMs:\s*4000/);
  assert.match(front, /MS_REALTIME_WS_V1/);
  assert.match(front, /setInterval\(realtimeTick, CONFIG\.pollMs\)/);
  assert.doesNotMatch(front, /setInterval\(\(\) => state\.auth && loadData\(true\), CONFIG\.pollMs\)/);
  assert.match(front, /new WebSocket\(realtimeSocketUrl\(\)\)/);
  assert.match(front, /visibilitychange/);
  assert.match(front, /REALTIME_AUTH_HEARTBEAT_MS = 60 \* 1000/);
});

test("4-second UI cadence is decoupled from shared Route upstream cadence", () => {
  assert.match(hotLanePatch, /MS_ROUTE_SHARED_SOURCE_CADENCE_V1/);
  assert.match(hotLanePatch, /MS_REALTIME_SOURCE_MIN_MS = 12 \* 1000/);
  assert.match(hotLanePatch, /nowMs - this\.lastSourceAt < MS_REALTIME_SOURCE_MIN_MS/);
  assert.match(hotLanePatch, /!force &&[\s\S]*!cron &&[\s\S]*MS_REALTIME_SOURCE_MIN_MS/);
  assert.match(front, /pollMs:\s*4000/);
  assert.doesNotMatch(hotLanePatch, /MS_REALTIME_SOURCE_MIN_MS = 4 \* 1000/);
});

test("BusTime session expiry preserves accepted cache, stops retry churn, and fresh HAR credentials recover immediately", async () => {
  let clock = Date.parse("2026-09-14T03:00:00Z");
  let needsLogin = true;
  let upstreamCalls = 0;
  let statusWrites = 0;
  const acceptedRows = [{
    proofId: "EA2-P1",
    attendanceType: "ปลายทาง",
    routeName: "ACCEPTED",
    scheduleTbrArrivalAt: "2026-09-14T02:00:00Z",
  }];
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind() {
            return {
              async first() {
                if (String(sql).includes("FROM ms_live_cache"))
                  return { rows_json: JSON.stringify(acceptedRows) };
                if (String(sql).includes("FROM ms_bus_connections"))
                  return { credentials_cipher: "cipher" };
                return null;
              },
            };
          },
        };
      },
    },
  };
  const lane = createBusTimeHotLane({
    liveSourceDays: () => ["2026-09-14"],
    thaiDayOffset: () => "2026-09-14",
    normalizeProofId: (value) => String(value || "").trim().toUpperCase(),
    normalizeAttendance: (value) => String(value || "").trim(),
    matchHub: () => true,
    msDate: (value) => String(value || ""),
    parseUnloadingStart: () => "",
    parseUnloadingEnd: () => "",
    decryptMs: async () => JSON.stringify({ auth: "old-auth", lang: "th", fbid: "x", time: "x", _from: "fbi" }),
    safeStatusWrite: async (promise) => { statusWrites += 1; await promise; },
    markSuccess: async () => ({ ok: true }),
    markError: async () => ({ ok: true }),
    classifyFailure: (message) => /login|session|token|auth|expired|unauthor/i.test(String(message || ""))
      ? { code: "BUS_TIME_SESSION_EXPIRED", status: 502 }
      : { code: "BUS_TIME_SOURCE_ERROR", status: 502 },
    fetchFn: async () => {
      upstreamCalls += 1;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        async json() {
          if (needsLogin) return { code: 0, msg: "need login" };
          return { code: 1, data: { dataList: [], total: 0 } };
        },
      };
    },
    now: () => clock,
    random: () => 0,
    logger: { warn() {}, error() {}, log() {} },
  });
  const routes = [{ proofId: "EA2-P1", attendanceType: "ปลายทาง", unloadingState: 0 }];
  const first = await lane.readBusTimeData(env, "EA2", undefined, routes);
  assert.equal(upstreamCalls, 1);
  assert.equal(first.sourceCode, "BUS_TIME_SESSION_EXPIRED");
  assert.equal(first.get("P:EA2-P1|A:ปลายทาง")?.routeName, "ACCEPTED");
  let diag = lane.diagnostics("EA2");
  assert.equal(diag.busNeedsLogin, true);
  assert.equal(diag.busCooldownCode, "BUS_TIME_SESSION_EXPIRED");
  assert.match(diag.busCooldownUntil, /T/);
  assert.equal(statusWrites, 1, "terminal error persists once, not on every UI tick");

  clock += 12_000;
  const held = await lane.readBusTimeData(env, "EA2", undefined, routes);
  assert.equal(upstreamCalls, 1, "need-login must not retry on shared 12-second cadence");
  assert.equal(held.sourceCode, "BUS_TIME_SESSION_EXPIRED");
  assert.equal(held.get("P:EA2-P1|A:ปลายทาง")?.routeName, "ACCEPTED");

  needsLogin = false;
  lane.resetCredentials("EA2", { auth: "fresh-auth", lang: "th", fbid: "x", time: "fresh", _from: "fbi" });
  diag = lane.diagnostics("EA2");
  assert.equal(diag.busNeedsLogin, false);
  assert.equal(diag.busCooldownCode, "");
  const recovered = await lane.readBusTimeData(env, "EA2", undefined, routes);
  assert.equal(upstreamCalls, 2, "fresh HAR credentials bypass the old terminal cooldown immediately");
  assert.equal(recovered.sourceStale, false);
  assert.equal(recovered.sourceCode, "");
  assert.equal(BUS_TIME_SESSION_COOLDOWN_MS, 60 * 60 * 1000);
});

test("staged per-HUB coordinator uses hibernatable WebSocket broadcast", () => {
  assert.match(staged, /MS_REALTIME_WS_V1/);
  assert.match(staged, /msStream/);
  assert.match(staged, /this\.ctx\.acceptWebSocket\(server\)/);
  assert.match(staged, /server\.serializeAttachment\(\{ branch, leader \}\)/);
  assert.match(staged, /async webSocketMessage\(ws, message\)/);
  assert.match(staged, /await verify\(payload\?\.token, this\.env\)/);
  assert.match(staged, /async broadcastSnapshot\(branch\)/);
  assert.match(turso, /webSocketMessage\(ws, message\).*this\.inner\.webSocketMessage/s);
});

test("hub settings reads are cached/coalesced and save invalidates immediately", () => {
  assert.match(worker, /HUB_SETTINGS_CACHE_V1/);
  assert.match(worker, /HUB_SETTINGS_CACHE_MS = 60 \* 1000/);
  assert.match(worker, /hubSettingsActive\.has\(key\)/);
  assert.match(worker, /hubSettingsCache\.set\(key/);
  assert.match(worker, /invalidateHubSettings\(branch\);\s*return readSettings\(env, branch\);/);
});

test("unchanged proof background cron performs no Turso write", () => {
  assert.match(proof, /PROOF_UNCHANGED_CRON_WRITE_ZERO_V1/);
  assert.match(proof, /PROOF_SOURCE_HASH_V2/);
  assert.match(proof, /JSON\.stringify\(\{ total: upstream\.total, rows: mapped \}\)/);
  assert.match(proof, /if \(!force\)\s*await env\.DB\.prepare/);
});

test("TBR current source already uses one Bus cache call and dynamic accounting", () => {
  assert.match(browser, /TBR_BUS_SINGLE_CACHE_CALL_V11/);
  assert.match(browser, /return \[bangkokSourceDay\(nowMs, 0\)\]/);
  assert.match(browser, /const pointReads = 2 \* \(/);
  assert.match(browser, /currentSteadyStateTursoPointReadsPerCron: currentSteadyStateReads/);
  assert.match(browser, /tursoPointReadsPerCron: pointReads/);
});

test("HBI stays click-only and outside realtime refresh", () => {
  assert.match(worker, /HBI_PHOTO_ON_DEMAND_V1/);
  const refresh = staged.slice(staged.indexOf("async function runMsRefresh"), staged.indexOf("async function readMsLiveCache"));
  assert.doesNotMatch(refresh, /readHbiTruckPhotos|msTruckPhotos/);
  assert.match(front, /apiGetOnce\("msTruckPhotos"/);
});
