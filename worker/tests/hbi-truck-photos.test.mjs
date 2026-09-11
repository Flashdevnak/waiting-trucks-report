import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { hbiPhotoDateWindow, normalizeHbiPhotoUrl } from "../src/index.js";

test("HBI photo URL is restricted to Flash fleetOutbound thumbnails over HTTPS", () => {
  assert.equal(
    normalizeHbiPhotoUrl("http://fle-asset-internal.oss-ap-southeast-1.aliyuncs.com/fleetOutbound/a.jpeg"),
    "https://fle-asset-internal.oss-ap-southeast-1.aliyuncs.com/fleetOutbound/a.jpeg?x-oss-process=image/resize,w_200/quality,q_80",
  );
  assert.equal(normalizeHbiPhotoUrl("https://example.com/fleetOutbound/a.jpeg"), "");
  assert.equal(normalizeHbiPhotoUrl("https://fle-asset-internal.oss-ap-southeast-1.aliyuncs.com/other/a.jpeg"), "");
});

test("HBI photo date window covers overnight origin-to-destination trips in one request", () => {
  assert.deepEqual(hbiPhotoDateWindow("2026-09-11T17:30:00.000Z"), { begin: "2026-09-11", end: "2026-09-13" });
});

test("frontend keeps photo loading strictly click-only and single-shot", () => {
  const front = fs.readFileSync(new URL("../../ms.js", import.meta.url), "utf8");
  assert.match(front, /HBI_TRUCK_PHOTO_LAZY_V1/);
  assert.match(front, /data-truck-photo=/);
  assert.match(front, /apiGetOnce\("msTruckPhotos"/);
  assert.doesNotMatch(front, /apiGet\("msTruckPhotos"/);
  assert.match(front, /setInterval\(\(\) => state\.auth && loadData\(true\), CONFIG\.pollMs\)/);
});

test("worker keeps HBI out of live refresh and caps each cold click at one page", () => {
  const worker = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  assert.match(worker, /HBI_PHOTO_ON_DEMAND_V1/);
  assert.match(worker, /page_size: "20"/);
  const refresh = worker.slice(worker.indexOf("async function runMsRefresh"), worker.indexOf("async function readMsLiveCache"));
  assert.doesNotMatch(refresh, /Hbi|hbi|TruckPhotos/);
  const read = worker.slice(worker.indexOf("async function readHbiTruckPhotos"), worker.indexOf("async function readBusTimeData"));
  assert.equal((read.match(/await fetch\(/g) || []).length, 1);
  assert.doesNotMatch(read, /Promise\.all|for \(let page|page \+/);
});

test("HBI schema is migration-owned and never created from request runtime", () => {
  const worker = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const migration = fs.readFileSync(new URL("../migrations/0011_hbi_truck_photos.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ms_hbi_connections/);
  assert.match(migration, /hub TEXT PRIMARY KEY/);
  assert.match(migration, /credentials_cipher TEXT NOT NULL/);
  assert.doesNotMatch(worker, /CREATE TABLE IF NOT EXISTS ms_hbi_connections/);
  assert.doesNotMatch(worker, /ensureHbiConnectionTable/);
});
