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
  const desktopRow = front.slice(front.indexOf("function tableRow"), front.indexOf("function card"));
  assert.match(desktopRow, /attendance-cell[\s\S]{0,220}truckPhotoButton\(row\)/);
  assert.doesNotMatch(desktopRow, /people-summary[\s\S]*truckPhotoButton\(row\)/);
  assert.match(front, /apiGetOnce\("msTruckPhotos"/);
  assert.doesNotMatch(front, /apiGet\("msTruckPhotos"/);
  assert.match(front, /setInterval\(\(\) => state\.auth && loadData\(true\), CONFIG\.pollMs\)/);
});

test("worker keeps HBI out of live refresh and caps each cold click at one page", () => {
  const worker = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  assert.match(worker, /HBI_PHOTO_ON_DEMAND_V1/);
  assert.match(worker, /page_size: "20"/);
  assert.match(worker, /HBI_PHOTO_MANIFEST_FALLBACK_V2/);
  assert.match(worker, /originManifestHbiCredentials\(env, actor, hub\)/);
  const clickPath = worker.slice(worker.indexOf("async function msTruckPhotos"), worker.indexOf("async function readHbiTruckPhotos"));
  assert.doesNotMatch(clickPath, /INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM/i);
  const refresh = worker.slice(worker.indexOf("async function runMsRefresh"), worker.indexOf("async function readMsLiveCache"));
  assert.doesNotMatch(refresh, /Hbi|hbi|TruckPhotos/);
  const read = worker.slice(worker.indexOf("async function readHbiTruckPhotos"), worker.indexOf("async function readBusTimeData"));
  assert.equal((read.match(/await fetch\(/g) || []).length, 1);
  assert.match(read, /key === "time" \? String\(Date\.now\(\)\) : credentials\?\.\[key\]/);
  assert.match(read, /"BI-PLATFORM": ""/);
  assert.match(read, /"Accept-Language": credentials\?\.lang \|\| "th"/);
  assert.doesNotMatch(read, /Promise\.all|for \(let page|page \+/);
});

test("LH Manifest HBI fallback refreshes HBI request time without extra polling", () => {
  const manifest = fs.readFileSync(new URL("../src/origin-manifest-v1.js", import.meta.url), "utf8");
  const start = manifest.indexOf("export async function originManifestHbiCredentials");
  const end = manifest.indexOf("export async function readManifestPage", start);
  const fallback = manifest.slice(start, end);
  assert.match(fallback, /time: String\(Date\.now\(\)\)/);
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
