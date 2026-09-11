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
  // HBI remains click-only; realtime Route transport is now WebSocket-first at
  // the same 4-second visible cadence instead of direct HTTP polling.
  assert.match(front, /pollMs:\s*4000/);
  assert.match(front, /setInterval\(realtimeTick, CONFIG\.pollMs\)/);
  assert.doesNotMatch(front, /setInterval\(\(\) => state\.auth && loadData\(true\), CONFIG\.pollMs\)/);
});

test("worker keeps HBI out of live refresh and caps each cold click at one page", () => {
  const worker = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  assert.match(worker, /HBI_PHOTO_ON_DEMAND_V1/);
  assert.match(worker, /page_size: "100"/);
  assert.match(worker, /HBI_PHOTO_DEDICATED_SESSION_V3/);
  assert.doesNotMatch(worker, /originManifestHbiCredentials/);
  const clickPath = worker.slice(worker.indexOf("async function msTruckPhotos"), worker.indexOf("async function readHbiTruckPhotos"));
  assert.doesNotMatch(clickPath, /INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM/i);
  const refresh = worker.slice(worker.indexOf("async function runMsRefresh"), worker.indexOf("async function readMsLiveCache"));
  assert.doesNotMatch(refresh, /Hbi|hbi|TruckPhotos/);
  const read = worker.slice(worker.indexOf("async function readHbiTruckPhotos"), worker.indexOf("async function readBusTimeData"));
  assert.equal((read.match(/await fetch\(/g) || []).length, 1);
  assert.match(read, /const value = credentials\?\.\[key\];/);
  assert.doesNotMatch(read, /key === "time" \? String\(Date\.now\(\)\)/);
  assert.match(read, /"BI-PLATFORM": ""/);
  assert.match(read, /"Accept-Language": credentials\?\.lang \|\| "th"/);
  assert.match(read, /Authorization: credentials\?\.auth \|\| ""/);
  assert.equal((worker.match(/async function readHbiTruckPhotos/g) || []).length, 1);
  assert.equal((worker.match(/async function msTruckPhotos/g) || []).length, 1);
  assert.doesNotMatch(read, /Promise\.all|for \(let page|page \+/);
});


test("mobile origin manifest keeps shipped parcels and weight on one full-width 50/50 row", () => {
  const html = fs.readFileSync(new URL("../../ms.html", import.meta.url), "utf8");
  const baseStyle = fs.readFileSync(new URL("../../style.css", import.meta.url), "utf8");
  const msStyle = fs.readFileSync(new URL("../../ms-v4.css", import.meta.url), "utf8");
  const manifest = fs.readFileSync(new URL("../src/origin-manifest-v1.js", import.meta.url), "utf8");
  assert.doesNotMatch(html, /\.ms-page \.origin-manifest-badge/);
  assert.doesNotMatch(baseStyle, /origin-manifest-badge/);
  assert.doesNotMatch(manifest, /origin-manifest-style-v1|function installStyle\(\)|\.origin-manifest-badge \{/);
  assert.match(msStyle, /ORIGIN_MANIFEST_BADGE_V2/);
  assert.match(msStyle, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(msStyle, /@media \(max-width: 700px\)[\s\S]*?compact-card-head \.origin-manifest-badge[\s\S]*?grid-column: 1 \/ -1;[\s\S]*?width: 100%;[\s\S]*?max-width: none;/);
  assert.match(msStyle, /@media \(max-width: 700px\)[\s\S]*?white-space: nowrap;/);
});

test("LH Manifest never marks HBI photos ready and worker never falls back to its session", () => {
  const manifest = fs.readFileSync(new URL("../src/origin-manifest-v1.js", import.meta.url), "utf8");
  const front = fs.readFileSync(new URL("../../ms.js", import.meta.url), "utf8");
  assert.doesNotMatch(manifest, /originManifestHbiCredentials|__MS_ORIGIN_MANIFEST_HBI_FALLBACK__/);
  assert.doesNotMatch(front, /manifestPhotoFallback|พร้อมใช้งานผ่าน LH Manifest/);
  assert.match(front, /ยังไม่ได้อัปโหลด HAR รูปท้ายรถ/);
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
