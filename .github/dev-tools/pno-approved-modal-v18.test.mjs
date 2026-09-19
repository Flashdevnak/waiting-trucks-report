import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { stageFrontend } from "./stage-dev-runtime.mjs";
import { patchPnoApprovedModalV18, pnoV18ResolveOpenArgs } from "./patch-pno-approved-modal-v18.mjs";

const root = new URL("../../", import.meta.url);
const canonical = await readFile(new URL("ms.js", root), "utf8");
const staged = stageFrontend(canonical);
const patchSource = await readFile(new URL("./patch-pno-approved-modal-v18.mjs", import.meta.url), "utf8");

test("fully staged browser script parses without duplicate bindings", () => {
  assert.doesNotThrow(() => new Function(staged));
  assert.doesNotMatch(staged, /async function openPendingParcels\(proofId, day\)[\s\S]*PNO_APPROVED_MODAL_V18[\s\S]*async function openPendingParcels\(proofId, day\)/);
});

test("approved PNO modal v18 is staged after Round2", () => {
  assert.match(staged, /PNO_APPROVED_MODAL_V18/);
  assert.match(staged, /รายการพัสดุเข้าคลัง/);
  assert.match(staged, /data-pno-v18-type="total"/);
  assert.match(staged, /data-pno-v18-type="already"/);
  assert.match(staged, /data-pno-v18-type="no_entry"/);
  assert.match(staged, /data-pno-v18-type="bag"/);
});

test("approved palette stays Flash yellow black with Backing option E", () => {
  assert.match(staged, /#ffd400/);
  assert.match(staged, /#151515/);
  assert.match(staged, /#7B8CFF/);
  assert.match(staged, /#5F70DB/);
  assert.match(staged, /is-backing/);
});

test("Backing is grouped by bag and expands inline", () => {
  assert.match(staged, /function pnoV18BagGroups/);
  assert.match(staged, /pno-v18-expand/);
  assert.match(staged, /เลขถุงแบ็กกิ้ง/);
  assert.match(staged, /จำนวนพัสดุ/);
  assert.match(staged, /ซ่อนรายการ ▴/);
  assert.match(staged, /ดูรายการ ▾/);
});

test("summary uses existing row counts without extra summary request", () => {
  assert.match(staged, /row\?\.expectedParcels/);
  assert.match(staged, /row\?\.enteredParcels/);
  assert.match(staged, /row\?\.pendingParcels/);
  const summary = staged.slice(staged.indexOf("function pnoV18RenderSummary"), staged.indexOf("function pnoV18SetActive"));
  assert.doesNotMatch(summary, /apiGet|apiPost/);
});

test("approved UI adds no background timer, SQL persistence, or realtime poll", () => {
  assert.doesNotMatch(patchSource, /setInterval\s*\(|setTimeout\s*\(/);
  assert.doesNotMatch(patchSource, /\b(?:INSERT|UPDATE|DELETE|CREATE\s+TABLE)\b/i);
  const fetchSection = staged.slice(staged.indexOf("async function pnoV18Fetch"), staged.indexOf("function pnoV18ActionClass"));
  assert.match(fetchSection, /browserPnoPage\(sourceRow, type, page, force\)/);
  assert.doesNotMatch(fetchSection, /apiGet\("pendingParcels"/);
  assert.equal(patchPnoApprovedModalV18(staged), staged);
});


test("V18 preserves the staged row-object PNO opener contract", () => {
  const row = {
    id: "route-1", proofId: "BC-TEST-001", routeName: "TEST ROUTE",
    pnoState: "OK", pnoEnabled: true, pnoSourceDay: "2026-09-19",
    pnoLineId: "LINE-1", pnoVanLineId: "", pnoStoreId: "STORE-1", pnoNextStoreId: "STORE-2",
    expectedParcels: 120, enteredParcels: 90, pendingParcels: 30,
  };
  const args = pnoV18ResolveOpenArgs(row, "already", 3, { force: true });
  assert.equal(args.row, row);
  assert.equal(args.proofId, "BC-TEST-001");
  assert.equal(args.day, "2026-09-19");
  assert.equal(args.type, "already");
  assert.equal(args.page, 3);
  assert.equal(args.force, true);
  assert.notEqual(args.proofId, "[object Object]");

  const opener = staged.slice(staged.indexOf("openPendingParcels = async function pnoV18OpenPendingParcels"), staged.indexOf('document.addEventListener("DOMContentLoaded", pnoV18EnsureUi)'));
  assert.match(opener, /pnoV18ResolveOpenArgs\(row, type, page, \{ force \}\)/);
  assert.match(opener, /pnoV18State\.sourceRow = args\.row/);
  assert.match(opener, /pnoV18State\.proofId = args\.proofId/);
  assert.match(opener, /pnoV18State\.day = args\.day/);
  assert.match(opener, /await pnoV18Load\("total", 1\)/);
  assert.doesNotMatch(opener, /String\(row\s*\|\|/);
});

test("V18 summary remains bound to clicked/live row counts", () => {
  const source = staged.slice(staged.indexOf("function pnoV18SourceRow"), staged.indexOf("function pnoV18EnsureUi"));
  assert.match(source, /pnoV18State\.sourceRow/);
  const summary = staged.slice(staged.indexOf("function pnoV18RenderSummary"), staged.indexOf("function pnoV18SetActive"));
  assert.match(summary, /row\?\.expectedParcels/);
  assert.match(summary, /row\?\.enteredParcels/);
  assert.match(summary, /row\?\.pendingParcels/);
});


test("V18 visible palette applies gold black theme and Backing option E to actual controls", () => {
  assert.match(staged, /pno-v18-head\{[^}]*background:#FFD400/);
  assert.match(staged, /pno-v18-table th\{[^}]*background:#151515[^}]*border-bottom:3px solid #FFD400[^}]*color:#fff/);
  assert.match(staged, /button\[data-pno-v18-type="bag"\][^}]*#5F70DB[^}]*#4C5CC4/);
  assert.match(staged, /button\[data-pno-v18-type="bag"\]\.is-active\{[^}]*background:#7B8CFF[^}]*color:#fff/);
  assert.match(staged, /pno-v18-bag-card\{border-left-color:#7B8CFF/);
});

test("V18 mobile uses vertical cards and hides wide desktop tables", () => {
  assert.match(staged, /PNO_V18_MOBILE_CACHE_UI_V2/);
  assert.match(staged, /pno-v18-mobile-card pno-v18-parcel-card/);
  assert.match(staged, /pno-v18-mobile-card pno-v18-bag-card/);
  assert.match(staged, /@media\(max-width:720px\)[\s\S]*pno-v18-desktop\{display:none!important\}[\s\S]*pno-v18-mobile\{display:grid\}/);
  assert.match(staged, /pno-v18-tabs\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test("V18 parcel and Backing views reuse click-only 60s cache without background work", () => {
  assert.match(staged, /PNO_V18_VIEW_CACHE_MS = 60 \* 1000/);
  assert.match(staged, /const pnoV18ViewCache = new Map\(\)/);
  assert.match(staged, /const pnoV18BagCache = new Map\(\)/);
  assert.match(staged, /pnoV18PageCacheKey\(sourceRow, type, pnoV18State\.page\)/);
  assert.match(staged, /pnoV18CacheGet\(pnoV18BagCache, bagKey\)/);
  assert.match(staged, /pnoV18CacheSet\(pnoV18BagCache, bagKey, \{ rows: all, total \}, 24\)/);
  assert.match(staged, /row\?\.expectedParcels[\s\S]*row\?\.enteredParcels[\s\S]*row\?\.pendingParcels/);
  assert.doesNotMatch(patchSource, /setInterval\s*\(|setTimeout\s*\(/);
});
