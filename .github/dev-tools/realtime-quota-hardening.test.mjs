import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { stageWorker } from "./stage-dev-runtime.mjs";

const worker = fs.readFileSync(new URL("../../worker/src/index.js", import.meta.url), "utf8");
const front = fs.readFileSync(new URL("../../ms.js", import.meta.url), "utf8");
const proof = fs.readFileSync(new URL("../../worker/src/proof-control.js", import.meta.url), "utf8");
const turso = fs.readFileSync(new URL("../../worker/src/turso-index.js", import.meta.url), "utf8");
const browser = fs.readFileSync(new URL("../../cloudflare-browser-test/src/index.js", import.meta.url), "utf8");
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
