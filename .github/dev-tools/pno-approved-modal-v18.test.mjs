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
  assert.doesNotMatch(staged.slice(staged.indexOf("PNO_V18_CLIENT_FILTERS_SUMMARY_V1")), /#7B8CFF|#5F70DB|background:#FFD400/);
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
  assert.match(opener, /pnoV18State\.type = args\.type/);
  assert.match(opener, /pnoV18State\.page = args\.page/);
  assert.match(opener, /await pnoV18Load\(args\.type, args\.page\)/);
  assert.doesNotMatch(opener, /await pnoV18Load\("total", 1\)/);
  assert.doesNotMatch(opener, /String\(row\s*\|\|/);
});

test("V21 modal summary stays bound to clicked row through corrected operational truth", () => {
  const source = staged.slice(staged.indexOf("function pnoV18SourceRow"), staged.indexOf("function pnoV18EnsureUi"));
  assert.match(source, /pnoV18State\.sourceRow/);
  const summary = staged.slice(staged.indexOf("function pnoV18RenderSummary"), staged.indexOf("function pnoV18SetActive"));
  assert.match(summary, /const truth = pnoOperationalSummaryForRow\(row\)/);
  assert.match(summary, /const total = truth\.expected/);
  assert.match(summary, /const entered = truth\.entered/);
  assert.match(summary, /const pending = truth\.pending/);
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
  assert.match(staged, /PNO_V18_CLIENT_FILTERS_SUMMARY_V1/);
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
  assert.match(msHtml, /ms\.js\?v=20260919-pno-ownhub-single-truth-v24/);
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
  assert.match(staged, /PNO_V18_CLIENT_FILTERS_SUMMARY_V1/);
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


test("V18 table UX splits destinations, summarizes bags, unlocks scrolling, and copies TSV", () => {
  assert.match(staged, /PNO_V18_CLIENT_FILTERS_SUMMARY_V1/);
  assert.ok(staged.includes("<th>HUB ปลายทาง</th><th>สาขาปลายทาง</th><th>เวลา</th>"));
  assert.ok(staged.includes("<th>เลขถุงแบ็กกิ้ง</th><th>สถานะ</th><th>ล่าสุด</th><th>จำนวนพัสดุ</th><th>HUB ถัดไป</th><th>สาขาถัดไป</th><th></th>"));
  assert.match(staged, /function pnoV18BagSummary/);
  assert.match(staged, /หลายสถานะ/);
  assert.match(staged, /หลาย HUB/);
  assert.match(staged, /หลายสาขา/);
  const bagRender = staged.slice(staged.indexOf("function pnoV18RenderBags"), staged.indexOf("async function pnoV18LoadBags"));
  assert.doesNotMatch(bagRender, />Backing</);
  assert.ok(staged.includes("pno-v18-table td{padding:11px 12px;border:1px solid #e3e6e8;background:#fff;color:#252525;text-align:center"));
  assert.ok(staged.includes("pno-v18-inner td{padding:10px 11px;border:1px solid #e3e6e8;text-align:center"));
  assert.ok(staged.includes("pno-v18-list{max-height:none!important;overflow:visible!important"));
  assert.ok(staged.includes("#pending-parcels-dialog{width:min(1120px,calc(100vw - 24px));max-width:1120px;max-height:calc(100dvh - 20px);overflow-y:auto"));
  assert.match(staged, /function pnoV18WriteClipboard/);
  assert.match(staged, /พร้อมวางใน Excel\/Sheets/);
  assert.match(staged, /\["#", "PNO", "สถานะ", "ล่าสุด", "HUB ปลายทาง", "สาขาปลายทาง", "เวลา"\]\.join\("\\t"\)/);
  assert.doesNotMatch(patchSource, /setInterval\s*\(|setTimeout\s*\(/);
});


test("V18 LINE copy button uses loaded data only and formats readable LINE text", () => {
  assert.match(staged, /id="copy-line-pending-parcels"[^>]*>คัดลอก LINE<\/button>/);
  assert.match(staged, /copy-line-pending-parcels"\)\.onclick = pnoV18CopyLine/);
  assert.match(staged, /function pnoV18LineHeader/);
  assert.match(staged, /async function pnoV18CopyLine/);
  assert.match(staged, /📦 รายการพัสดุเข้าคลัง/);
  assert.match(staged, /หมวด: แบ็กกิ้ง/);
  assert.match(staged, /คัดลอกสำหรับ LINE/);
  const lineCopy = staged.slice(staged.indexOf("async function pnoV18CopyLine"), staged.indexOf("function pnoV18Export"));
  assert.doesNotMatch(lineCopy, /browserPnoPage|apiGet|fetch\s*\(|setInterval\s*\(|setTimeout\s*\(/);
  assert.match(lineCopy, /pnoV18VisibleParcelEntries\(\)/);
  assert.match(lineCopy, /pnoV18FilteredBagGroups\(\)/);
  assert.match(lineCopy, /pnoV18WriteClipboard/);
});


test("V19 client filters stay explicit-click and copy respects the visible filtered page", () => {
  assert.match(staged, /PNO_V18_CLIENT_FILTERS_SUMMARY_V1/);
  assert.match(staged, /id="pno-v18-filterbar"/);
  assert.match(staged, /id="pno-v18-bag-summary"/);
  assert.match(staged, /function pnoV18FilteredParcelEntries/);
  assert.match(staged, /function pnoV18FilteredBagGroups/);
  assert.match(staged, /function pnoV18RenderBagSummary/);
  assert.match(staged, /สถานะถุง/);
  assert.match(staged, /HUB ถัดไป/);
  assert.match(staged, /สาขาถัดไป/);
  assert.match(staged, /จำนวนถุงแบ็กกิ้ง/);
  assert.match(staged, /จำนวนชิ้นในถุง/);
  assert.match(staged, /เลือกฟิลเตอร์เพื่อรวมข้อมูลทุกหน้าอัตโนมัติ/);
  assert.match(staged, /pnoV18FilteredParcelEntries\(\)/);
  assert.match(staged, /pnoV18FilteredBagGroups\(\)/);
  const filterCode = staged.slice(staged.indexOf("function pnoV18FilteredParcelEntries"), staged.indexOf("function pnoV18RenderRows"));
  assert.doesNotMatch(filterCode, /browserPnoPage|apiGet|fetch\s*\(|setInterval\s*\(|setTimeout\s*\(/);
  const copyCode = staged.slice(staged.indexOf("async function pnoV18Copy()"), staged.indexOf("function pnoV18Export"));
  assert.doesNotMatch(copyCode, /browserPnoPage|apiGet|fetch\s*\(|setInterval\s*\(|setTimeout\s*\(/);
});

test("V18 LINE copy caps detail length and reports remaining rows", () => {
  assert.match(staged, /function pnoV18AppendLineLimited/);
  assert.match(staged, /const limit = 30/);
  assert.match(staged, /ยังมีอีก/);
  assert.match(staged, /สรุป: /);
  assert.match(staged, /ฟิลเตอร์: /);
  assert.match(staged, /พบ .*รายการในหน้านี้/);
});


test("V18 bag summary cards stay compact with values anchored at the right edge", () => {
  assert.ok(staged.includes("pno-v18-bag-summary{display:grid;grid-template-columns:repeat(2,minmax(0,180px));gap:8px;padding:6px 16px"));
  assert.ok(staged.includes("pno-v18-bag-summary-card{padding:5px 10px"));
  assert.ok(staged.includes("display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto auto"));
  assert.ok(staged.includes("pno-v18-bag-summary-card strong{grid-column:2;grid-row:1 / span 2"));
  assert.ok(staged.includes("justify-self:end;text-align:right;transform:none"));
  assert.doesNotMatch(staged, /pno-v18-bag-summary-card strong\{[^}]*translateX\(6px\)/);
});

test("V18 Export loads every parcel page only when Export is explicitly clicked", () => {
  assert.match(staged, /async function pnoV18Export\(\)/);
  assert.match(staged, /Math\.ceil\(total \/ 200\)/);
  assert.match(staged, /await pnoV18Fetch\(type, page\)/);
  assert.match(staged, /all\.slice\(0, total\)/);
  assert.match(staged, /PNO_V18_CARD_RIGHT_EXPORT_ALL_V1/);
});


test("V18 Backing summary is visible only in Backing view", () => {
  const apply = staged.slice(staged.indexOf("function pnoV18ApplyPageResult"), staged.indexOf("async function pnoV18Load(type"));
  assert.match(apply, /pnoV18RenderBagSummary\(\[\]\)/);
  const summary = staged.slice(staged.indexOf("function pnoV18RenderBagSummary"), staged.indexOf("function pnoV18RenderCurrentFilteredView"));
  assert.match(summary, /pnoV18State\.type !== "bag"/);
  assert.match(summary, /box\.classList\.add\("hidden"\)/);
});

test("V18 Backing table derives Latest from the newest loaded parcel action", () => {
  assert.match(staged, /function pnoV18BagLatest\(items\)/);
  assert.match(staged, /stamp > best\.stamp/);
  assert.match(staged, /latest: pnoV18BagLatest\(items\)/);
  assert.match(staged, /esc\(summary\.latest\)/);
  assert.match(staged, /colspan="8"/);
  assert.match(staged, /PNO_V18_BAG_ONLY_LATEST_NOENTRY_V1/);
});


test("V19 global parcel filters fetch all pages only after a filter change", () => {
  assert.match(staged, /PNO_GLOBAL_FILTER_V19/);
  assert.match(staged, /async function pnoV18EnsureParcelFilterRows\(\)/);
  assert.match(staged, /for \(let page = 1; page <= pages; page \+= 1\)/);
  assert.match(staged, /await pnoV18Fetch\(pnoV18State\.type, page\)/);
  assert.match(staged, /select\.onchange = async \(\) =>/);
  assert.match(staged, /await pnoV18EnsureParcelFilterRows\(\)/);
  assert.match(staged, /function pnoV18VisibleParcelEntries\(\)/);
  assert.match(staged, /entries\.slice\(start, start \+ 200\)/);
  assert.match(staged, /ผลกรอง หน้า/);
  const ensure = staged.slice(staged.indexOf("async function pnoV18EnsureParcelFilterRows"), staged.indexOf("function pnoV18Navigate"));
  assert.doesNotMatch(ensure, /setInterval|setTimeout|apiPost|Turso|SQL/i);
});

test("V19 filter keeps normal tab open lazy until user selects a filter", () => {
  const load = staged.slice(staged.indexOf("async function pnoV18Load(type, page)"), staged.indexOf("function pnoV18BagGroups"));
  assert.match(load, /const result = await pnoV18Fetch\(type, pnoV18State\.page\)/);
  assert.doesNotMatch(load, /pnoV18EnsureParcelFilterRows/);
});


test("V21 keeps real MS lastAction words and removes V20 no-entry inference", () => {
  assert.match(staged, /PNO_OPERATIONAL_RECEIPT_TRUTH_V21/);
  assert.doesNotMatch(staged, /function pnoV20NoEntryDisplayAction/);
  assert.match(staged, /function pnoV18ParcelAction\(item\) \{\s*return pnoV18TextValue\(item\?\.lastAction\);\s*\}/);
  const render = staged.slice(staged.indexOf("function pnoV18RenderRows"), staged.indexOf("function pnoV18ApplyPageResult"));
  assert.match(render, /const action = pnoV18ParcelAction\(item\)/);
  assert.match(render, /pnoV18ActionClass\(action\)/);
});

test("V20 Backing adds latest-action filter and keeps it local-only", () => {
  assert.match(staged, /bagAction: ""/);
  assert.match(staged, /pno-v18-filter-bag-action/);
  assert.match(staged, /"การดำเนินการล่าสุด", actions/);
  assert.match(staged, /!action \|\| summary\.latest === action/);
  assert.match(staged, /f\.bagStatus \|\| f\.bagAction \|\| f\.bagHub \|\| f\.bagBranch/);
  assert.match(staged, /if \(f\.bagAction\) parts\.push\("ล่าสุด=" \+ f\.bagAction\)/);
  const bagFilter = staged.slice(staged.indexOf("function pnoV18FilteredBagGroups"), staged.indexOf("function pnoV18RenderBagSummary"));
  assert.doesNotMatch(bagFilter, /browserPnoPage|apiGet|fetch\s*\(|setInterval\s*\(|setTimeout\s*\(/);
});

test("V21 copy LINE and export preserve the raw MS action helper", () => {
  const copy = staged.slice(staged.indexOf("async function pnoV18Copy()"), staged.indexOf("function pnoV18LineCell"));
  assert.match(copy, /pnoV18ParcelAction\(row\)/);
  const line = staged.slice(staged.indexOf("async function pnoV18CopyLine()"), staged.indexOf("async function pnoV18Export()"));
  assert.match(line, /pnoV18ParcelAction\(row\)/);
  const exp = staged.slice(staged.indexOf("async function pnoV18Export()"), staged.indexOf("openPendingParcels = async function"));
  assert.match(exp, /"การดำเนินการล่าสุด": pnoV18ParcelAction\(row\)/);
});


test("V20 mobile Backing filters do not overflow narrow viewport", () => {
  assert.match(staged, /pno-v18-filter-field select\{width:100%;min-width:0\}/);
});


test("V22 inbound PNO is destination/drop only and origin is suppressed", () => {
  assert.match(staged, /PNO_INBOUND_SCOPE_AND_EAGER_TRUTH_V22/);
  assert.match(staged, /function pnoOperationalInboundEligible\(row\)/);
  assert.match(staged, /isDestination\(row\) \|\| isDrop\(row\)/);
  const badge = staged.slice(staged.indexOf("function expectedParcelsBadge"), staged.indexOf("function findPnoRowById"));
  assert.match(badge, /if \(!pnoOperationalInboundEligible\(row\)\) return ""/);
  const queue = staged.slice(staged.indexOf("function pnoOperationalQueueResolve"), staged.indexOf("function pnoOperationalObserveCards"));
  assert.match(queue, /!row\?\.id \|\| !pnoOperationalInboundEligible\(row\)/);
  assert.doesNotMatch(staged.slice(staged.indexOf("PNO_INBOUND_SCOPE_AND_EAGER_TRUTH_V22")), /AYU1TS8R72|NE1_HUB/);
});

test("V22 explicit modal open resolves corrected truth before rendering any tab", () => {
  const opener = staged.slice(staged.indexOf("openPendingParcels = async function pnoV18OpenPendingParcels"), staged.indexOf('document.addEventListener("DOMContentLoaded", pnoV18EnsureUi)'));
  assert.match(opener, /!pnoOperationalInboundEligible\(args\.row\)/);
  const resolveAt = opener.indexOf("await pnoOperationalResolve(args.row)");
  const summaryAt = opener.indexOf("pnoV18RenderSummary()");
  const modalAt = opener.indexOf('showModal()');
  const loadAt = opener.indexOf("await pnoV18Load(args.type, args.page)");
  assert.ok(resolveAt >= 0 && resolveAt < summaryAt && summaryAt < modalAt && modalAt < loadAt);
});

test("V22 operational resolver refuses origin without new timers or DB work", () => {
  const resolver = staged.slice(staged.indexOf("async function pnoOperationalResolve"), staged.indexOf("function pnoOperationalPaginate"));
  assert.match(resolver, /!pnoOperationalInboundEligible\(row\)/);
  const section = staged.slice(staged.indexOf("PNO_INBOUND_SCOPE_AND_EAGER_TRUTH_V22"));
  assert.doesNotMatch(section, /setInterval\s*\(|setTimeout\s*\(|apiPost\s*\(|DB\.prepare|Turso|INSERT\s|UPDATE\s|DELETE\s/i);
});


test("V24 final staged runtime has one correction authority and no V23 overlap", () => {
  assert.match(staged, /PNO_OWN_HUB_BACKING_SINGLE_TRUTH_V24/);
  assert.doesNotMatch(staged, /PNO_PENDING_TOTAL_INTERSECTION_V23/);
  assert.doesNotMatch(staged, /function pnoOperationalNeedsTotalMetadata/);
  assert.doesNotMatch(staged, /function pnoOperationalEnrichPendingFromTotal/);
  assert.equal((staged.match(/async function pnoOperationalResolve\(row\)/g) || []).length, 1);
  assert.equal((staged.match(/function pnoOperationalBuildTruth\(row, totalRows, alreadyRows\)/g) || []).length, 1);
});

test("V24 correction uses MS total universe minus MS already baseline only", () => {
  const build = staged.slice(staged.indexOf("function pnoOperationalBuildTruth"), staged.indexOf("async function pnoOperationalLoadAllRaw"));
  assert.match(build, /const totalMap = pnoOperationalUniqueMap\(totalRows\)/);
  assert.match(build, /const alreadyMap = pnoOperationalUniqueMap\(alreadyRows\)/);
  assert.match(build, /if \(alreadyMap\.has\(pno\)\) continue/);
  assert.match(build, /if \(pnoOperationalCandidate\(item\)\) candidates\.push\(item\)/);
  assert.match(build, /correctedEntered = enteredRows\.length/);
  assert.match(build, /correctedPending = remainingRows\.length/);
  assert.match(build, /correctedEntered \+ correctedPending !== raw\.expected/);
  assert.doesNotMatch(build, /no_entry|EnrichPending|unresolved/);
});

test("V24 own-HUB isolation uses the currently selected HUB and exact canonical equality", () => {
  const section = staged.slice(staged.indexOf("function pnoOperationalCanonicalHub"), staged.indexOf("function pnoOperationalRawSummary"));
  assert.match(section, /function pnoOperationalCurrentHub\(\)/);
  assert.match(section, /pnoOperationalCanonicalHub\(state\.branch\)/);
  assert.match(section, /pnoOperationalCanonicalHub\(targetHub\) === current/);
  assert.match(section, /String\(item\?\.backingNo \|\| ""\)\.trim\(\)/);
  assert.match(section, /String\(item\?\.lastAction \|\| ""\)\.trim\(\) === "สแกนเข้าคลัง"/);
  assert.doesNotMatch(section, /row\?\.hub\)\s*\|\||AYU1TS8R72|KKC1TSBP54|02 NE1_HUB|["']NE1["']/);
});

test("V24 verifies detail counts before correction and fails safe to raw MS counts", () => {
  const build = staged.slice(staged.indexOf("function pnoOperationalBuildTruth"), staged.indexOf("async function pnoOperationalLoadAllRaw"));
  assert.match(build, /totalMap\.size !== raw\.expected/);
  assert.match(build, /alreadyMap\.size !== raw\.entered/);
  assert.match(build, /ALREADY_NOT_SUBSET_OF_TOTAL/);
  assert.match(build, /CORRECTED_DETAIL_COUNT_MISMATCH/);
});

test("V24 resolver loads total first and loads already only when an own-HUB exception exists", () => {
  const resolver = staged.slice(staged.indexOf("async function pnoOperationalResolve"), staged.indexOf("function pnoOperationalPaginate"));
  assert.match(resolver, /await pnoOperationalLoadAllRaw\(row, "total"\)/);
  assert.match(resolver, /ownHubCandidatesExist/);
  assert.match(resolver, /if \(!ownHubCandidatesExist\)/);
  assert.match(resolver, /await pnoOperationalLoadAllRaw\(row, "already"\)/);
  assert.match(resolver, /pnoOperationalBuildTruth\(row, total\.rows, already\.rows\)/);
  assert.doesNotMatch(resolver, /pnoOperationalLoadAllRaw\(row, "no_entry"\)/);
});

test("V24 corrected already and remaining modal pages share the same verified truth", () => {
  const virtual = staged.slice(staged.indexOf("async function pnoOperationalVirtualPage"), staged.indexOf("function pnoOperationalRefreshCard"));
  assert.match(virtual, /!truth\?\.verified \|\| truth\.correction <= 0/);
  assert.match(virtual, /type === "no_entry"/);
  assert.match(virtual, /truth\.remainingRows \|\| \[\]/);
  assert.match(virtual, /type === "already"/);
  assert.match(virtual, /truth\.enteredRows \|\| \[\]/);
});

test("V24 remains destination/drop only and quota-safe", () => {
  const runtimeStart = staged.indexOf("const PNO_OPERATIONAL_TRUTH_CACHE_MS");
  const runtimeEnd = staged.indexOf("function expectedParcelsBadge", runtimeStart);
  assert.ok(runtimeStart >= 0 && runtimeEnd > runtimeStart);
  const section = staged.slice(runtimeStart, runtimeEnd);
  assert.match(section, /function pnoOperationalInboundEligible/);
  assert.match(section, /isDestination\(row\) \|\| isDrop\(row\)/);
  assert.match(section, /PNO_OPERATIONAL_TRUTH_CACHE_MS = 60 \* 1000/);
  assert.match(section, /IntersectionObserver/);
  assert.match(section, /browserPnoPage\(row, type, page, false\)/);
  assert.doesNotMatch(section, /setInterval\s*\(|setTimeout\s*\(|apiPost\s*\(|DB\.prepare|Turso|INSERT\s|UPDATE\s|DELETE\s/i);
});

test("V24 does not hardcode any example truck or HUB", () => {
  const section = staged.slice(staged.indexOf("PNO_OWN_HUB_BACKING_SINGLE_TRUTH_V24"));
  assert.doesNotMatch(section, /AYU1TS8R72|KKC1TSBP54|02 NE1_HUB|20 NE6_HUB|["']NE1["']|["']NE6["']/);
});
