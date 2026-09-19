import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { stageFrontend } from "./stage-dev-runtime.mjs";
import { patchPnoApprovedModalV18, pnoV18ResolveOpenArgs } from "./patch-pno-approved-modal-v18.mjs";

const root = new URL("../../", import.meta.url);
const canonical = await readFile(new URL("ms.js", root), "utf8");
const msHtml = await readFile(new URL("ms.html", root), "utf8");
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

test("approved PNO palette is neutral black white with light-gray grid", () => {
  assert.match(staged, /#242424/);
  assert.match(staged, /#dfe3e6/);
  assert.match(staged, /#e3e6e8/);
  assert.match(staged, /is-backing/);
  assert.doesNotMatch(staged.slice(staged.indexOf("PNO_V18_NEUTRAL_GRID_V6")), /#7B8CFF|#5F70DB|background:#FFD400/);
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


test("V18 visible palette applies neutral cards and centered black table header", () => {
  assert.match(staged, /pno-v18-head\{[^}]*background:#fff/);
  assert.match(staged, /pno-v18-summary-item\{[^}]*border:1px solid #dfe3e6[^}]*background:#fff/);
  assert.match(staged, /pno-v18-table th\{[^}]*background:#242424[^}]*color:#fff[^}]*text-align:center/);
  assert.match(staged, /pno-v18-table td\{[^}]*border:1px solid #e3e6e8[^}]*background:#fff/);
  assert.match(staged, /button\[data-pno-v18-type=\\?"bag\\?"\][^}]*#c8cac6[^}]*#202124/);
  assert.match(staged, /button\[data-pno-v18-type=\\?"bag\\?"\]\.is-active\{[^}]*background:#f1f2f3[^}]*color:#202124/);
  assert.match(staged, /pno-v18-bag-card\{border-left-color:#d7dad5/);
});

test("V18 classic mobile keeps vertical cards and hides wide desktop tables", () => {
  assert.match(staged, /PNO_V18_NEUTRAL_GRID_V6/);
  assert.match(staged, /pno-v18-mobile-card pno-v18-parcel-card/);
  assert.match(staged, /pno-v18-mobile-card pno-v18-bag-card/);
  assert.ok(staged.includes("pno-v18-desktop{display:none!important}"));
  assert.ok(staged.includes("pno-v18-mobile{display:grid}"));
  assert.ok(staged.includes("pno-v18-tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))"));
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


test("V18 release cache-bust forces desktop and mobile browsers to fetch the new staged ms.js", () => {
  assert.match(msHtml, /ms\.js\?v=20260919-pno-neutral-grid-v6/);
});


test("V18 CSS text uses real newlines so all rules and mobile media queries parse", () => {
  const start = staged.indexOf("style.textContent = [");
  const end = staged.indexOf("document.head.append(style);", start);
  assert.ok(start >= 0 && end > start, "V18 style expression missing");
  const section = staged.slice(start, end);
  const match = section.match(/style\.textContent = (\[[\s\S]*?\]\.join\([^;]+\))/);
  assert.ok(match, "V18 style expression not extractable");
  const cssText = new Function("return " + match[1])();
  assert.match(cssText, /\n\.ms-page \.pno-v18-head\{/);
  assert.match(cssText, /\n@media\(max-width:720px\)\{/);
  assert.doesNotMatch(cssText, /\\\\n\.ms-page/);
});


test("V18 classic presentation uses neutral summary cards and centered grid table", () => {
  assert.match(staged, /PNO_V18_NEUTRAL_GRID_V6/);
  assert.ok(staged.includes("pno-v18-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding:12px 16px"));
  assert.ok(staged.includes("pno-v18-summary-item{min-height:70px;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid #dfe3e6;border-radius:7px;background:#fff"));
  assert.ok(staged.includes("pno-v18-table th{padding:10px 12px;background:#242424;border:1px solid #4a4a4a;color:#fff;text-align:center"));
  assert.ok(staged.includes("pno-v18-table td{padding:11px 12px;border:1px solid #e3e6e8;background:#fff"));
  assert.ok(staged.includes("pno-v18-table tbody tr:nth-child(even)>td{background:#fafafa}"));
  assert.ok(staged.includes("pno-v18-table tbody tr:hover>td{background:#f4f5f6}"));
  assert.ok(staged.includes("pno-v18-badge{display:inline;color:#252525"));
  assert.match(staged, /PNO_V18_VIEW_CACHE_MS = 60 \* 1000/);
  assert.doesNotMatch(patchSource, /setInterval\s*\(|setTimeout\s*\(/);
});
