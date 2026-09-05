import { execFileSync } from "node:child_process";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  patchDevMsArchive,
  patchDevMsMobileStyle,
  patchDevWorkerCompletedSummary,
} from "../../worker/scripts/patch-dev-ms-archive.mjs";
import {
  patchDevRealtimeFrontend,
  patchDevRealtimeWorker,
} from "./patch-ms-realtime-recovery.mjs";
import { patchDevSummaryFilter } from "./patch-ms-summary-filter.mjs";
import { patchDevDurableCoordinator } from "./patch-ms-durable-coordinator.mjs";
import { patchDevConnectorAdoption } from "./patch-ms-connector-adoption.mjs";
import { patchDevMultiClientWorker } from "./patch-ms-multiclient-dedupe.mjs";
import {
  patchMsRouteCancellationFrontend,
  patchMsRouteCancellationStyle,
  patchMsRouteCancellationWorker,
} from "./patch-ms-route-cancellation-compat.mjs";
import {
  patchMsNonDestinationCancellationFrontend,
  patchMsNonDestinationCancellationWorker,
} from "./patch-ms-cancel-nondestination.mjs";
import { patchMsFastAllCancelledFrontend } from "./patch-ms-fast-all-cancelled-card.mjs";
import {
  patchMsSummaryPerformanceFrontend,
  patchMsSummaryPerformanceStyle,
} from "./patch-ms-summary-performance.mjs";
import {
  patchMsOperatingDayFrontend,
  patchMsOperatingDayWorker,
} from "./patch-ms-operating-day.mjs";
import {
  patchMsDailyCompletionObservationFrontend,
  patchMsDailyCompletionObservationWorker,
} from "./patch-ms-daily-completion-observation.mjs";
import { patchMsCompletedViewStabilityFrontend } from "./patch-ms-completed-view-stability.mjs";
import { patchMsLiveResilienceFrontend } from "./patch-ms-live-resilience.mjs";
import {
  patchMsDailyHistoryFrontend,
  patchMsDailyHistoryWorker,
} from "./apply-ms-daily-history.mjs";
import { patchMsQuotaSafeLiveWorker } from "./patch-ms-quota-safe-live.mjs";
import { patchMsTbrShadowFeedWorker } from "./patch-ms-tbr-shadow-feed.mjs";
import { patchMsConnectionErrorKvFrontend } from "./patch-ms-connection-error-kv.mjs";

const devTbrReadonlyPatch = fileURLToPath(
  new URL("../../cloudflare-browser-test/scripts/patch-dev-tbr-shadow-readonly.mjs", import.meta.url),
);
const devTbrSplitV2Patch = fileURLToPath(
  new URL("../../cloudflare-browser-test/scripts/patch-dev-tbr-shadow-split-v2.mjs", import.meta.url),
);
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

const DEV_USER_PAGES = ["ms.html", "proof.html", "waiting.html", "ms-report.html"];
const LEGACY_REDIRECTS = ["index.html", "scan.html", "warehouse.html"];
const DEV_STYLE_HREF = "style.css?v=20260905-dev-shell-v3";
const DEV_SHELL_MARKER = "DEV_UNIFIED_HEADER_V2";
const DEV_NAV = [
  ["ms.html", `<svg class="dev-nav-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5h10.5v9H3.5zM14 9h4l2.5 3v3.5H14z"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17.5" cy="17.5" r="1.6"/></svg>`, "ติดตามรถ MS", "คิวรถเข้า–ออกและสถานะปัจจุบัน"],
  ["proof.html", `<svg class="dev-nav-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8V4h10v4M6 17H4.5V9h15v8H18M7 14h10v6H7z"/><path d="M16.5 11h.01"/></svg>`, "ปริ้นบาร์โค้ดรถ", "ตรวจข้อมูล แก้ไขตามสิทธิ์ MS และปริ้น PDF"],
  ["waiting.html", `<svg class="dev-nav-svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.8 1.8M9 3h6"/></svg>`, "รถรอลงงาน", "จัดการคิวและเวลารอลงงาน"],
  ["ms-report.html", `<svg class="dev-nav-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19V9h3v10M10.5 19V5h3v14M16 19v-7h3v7M4 19h16"/></svg>`, "สรุปรายวัน", "เปรียบเทียบรถจบงานตามวันและเวลา"],
];

const DEV_PAGE_META = {
  "ms.html": {
    title: "ติดตามเส้นทาง MS",
    detail: "ติดตามรถเข้า–ออกแบบเรียลไทม์",
    titleId: "site-title",
    clock: '<span id="live-clock">กำลังอ่านเวลาปัจจุบัน…</span>',
    status: '<span id="connection-badge" class="badge badge-neutral">กำลังเชื่อมต่อ</span>',
    tools:
      '<a id="central-settings-btn" class="btn btn-header header-link hidden" href="waiting.html#settings">จัดการกลาง</a>' +
      '<a id="connect-ms-btn" class="btn btn-accent header-link hidden" href="https://ms.flashexpress.com/#/sendoutlets/storeLineAttendance" target="_blank" rel="noopener">เปิด MS</a>' +
      '<button id="ms-connection-btn" class="btn btn-header hidden" type="button">การเชื่อมต่อ MS (QR/HAR)</button>',
    refresh: '<button id="refresh-btn" class="btn btn-header" type="button">รีเฟรช</button>',
    account:
      '<button id="login-btn" class="btn btn-accent" type="button">เข้าสู่ระบบ</button>' +
      '<a class="btn btn-header header-link dev-change-password" href="waiting.html#password">เปลี่ยนรหัสผ่าน</a>' +
      '<button id="logout-btn" class="btn btn-header hidden" type="button">ออกจากระบบ</button>',
  },
  "proof.html": {
    title: "ปริ้นบาร์โค้ดรถ MS",
    detail: "ตรวจข้อมูลและปริ้นบาร์โค้ดรถ",
    titleId: "",
    clock: '<span id="live-clock">กำลังอ่านเวลาปัจจุบัน…</span>',
    status: '<span id="connection-badge" class="badge badge-neutral">กำลังเชื่อมต่อ</span>',
    tools:
      '<a id="connect-ms-btn" class="btn btn-accent header-link hidden" href="https://ms.flashexpress.com/#/sendoutlets/storeLineAttendance" target="_blank" rel="noopener">เปิด MS</a>' +
      '<a id="proof-session-btn" class="btn btn-header header-link hidden" href="ms.html#connection">การเชื่อมต่อ MS (QR/HAR)</a>',
    refresh: '<button id="refresh-btn" class="btn btn-header" type="button">รีเฟรช</button>',
    account:
      '<button id="login-btn" class="btn btn-accent" type="button">เข้าสู่ระบบ</button>' +
      '<a class="btn btn-header header-link dev-change-password" href="waiting.html#password">เปลี่ยนรหัสผ่าน</a>' +
      '<button id="logout-btn" class="btn btn-header hidden" type="button">ออกจากระบบ</button>',
  },
  "waiting.html": {
    title: "ระบบรถรอลงงาน",
    detail: "จัดการคิวและเวลารอลงงาน",
    titleId: "site-title",
    clock: '<span id="live-clock">กำลังอ่านเวลาปัจจุบัน…</span>',
    status: '<span id="connection-badge" class="badge badge-neutral">กำลังเชื่อมต่อ</span>',
    tools:
      '<button id="settings-btn" class="btn btn-header hidden" type="button">จัดการกลาง</button>' +
      '<button id="import-btn" class="btn btn-accent" type="button">นำเข้า Excel</button>' +
      '<input id="file-input" type="file" accept=".xlsx,.xls" hidden />',
    refresh: '<button id="refresh-btn" class="btn btn-header" type="button">รีเฟรช</button>',
    account:
      '<button id="unlock-btn" class="btn btn-accent" type="button">เข้าสู่ระบบ</button>' +
      '<button id="password-btn" class="btn btn-header hidden" type="button">เปลี่ยนรหัสผ่าน</button>' +
      '<button id="logout-btn" class="btn btn-header hidden" type="button">ออกจากระบบ</button>',
  },
  "ms-report.html": {
    title: "สรุปรถจบงานรายวัน",
    detail: "เปรียบเทียบแยกตามวันที่และช่วงเวลา",
    titleId: "",
    clock: "<span>รายงานข้อมูลรายวัน</span>",
    status: '<span class="badge badge-online">พร้อมใช้งาน</span>',
    tools: '<span class="dev-tools-empty">ตัวกรองและ Export อยู่ในหน้ารายงาน</span>',
    refresh: '<button id="report-header-refresh" class="btn btn-header" type="button" onclick="location.reload()">รีเฟรช</button>',
    account: '<a class="btn btn-header header-link dev-change-password" href="waiting.html#password">เปลี่ยนรหัสผ่าน</a><a class="btn btn-header header-link" href="ms.html">บัญชีผู้ใช้</a>',
  },
};

function navHtml(currentPage) {
  return DEV_NAV.map(([href, icon, label, detail]) =>
    `<a href="${href}"${href === currentPage ? ' class="is-current"' : ""}><span>${icon}</span><b>${label}</b><small>${detail}</small></a>`,
  ).join("");
}

function unifiedHeaderHtml(currentPage) {
  const meta = DEV_PAGE_META[currentPage];
  if (!meta) throw new Error(`Unknown DEV page ${currentPage}`);
  const titleId = meta.titleId ? ` id="${meta.titleId}"` : "";
  const currentLabel = DEV_NAV.find(([href]) => href === currentPage)?.[2] || meta.title;
  return `<header class="site-header dev-unified-header" data-dev-shell="20260905-v2"><div class="site-header-inner"><div class="header-brand"><div class="brand-mark brand-f" aria-label="Flash"><span>F</span></div><div class="brand-copy"><strong${titleId}>${meta.title}</strong>${meta.clock}</div></div><nav class="topbar-actions dev-unified-actions" aria-label="เมนูหลัก"><div class="dev-shell-slot dev-system-nav"><details class="app-nav"><summary><span class="nav-grid-icon" aria-hidden="true"><svg class="dev-nav-svg" viewBox="0 0 24 24"><path d="M5 6h14M5 12h14M5 18h14"/></svg></span><span>เมนูระบบ</span><small>${currentLabel}</small></summary><div class="app-nav-menu">${navHtml(currentPage)}</div></details></div><div class="dev-shell-slot dev-page-tools"><details class="app-nav"><summary><span class="nav-grid-icon" aria-hidden="true"><svg class="dev-nav-svg" viewBox="0 0 24 24"><path d="M14.5 5.5l4 4M13.5 6.5l-8 8a2.1 2.1 0 0 0 3 3l8-8M16.5 15.5l2 2"/></svg></span><span>เครื่องมือ</span><small>หน้านี้</small></summary><div class="app-nav-menu dev-tools-menu">${meta.tools}</div></details></div><div class="dev-shell-slot dev-account-menu"><details class="app-nav"><summary><span class="nav-grid-icon" aria-hidden="true"><svg class="dev-nav-svg" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.2"/><path d="M5.5 19c1.4-3.8 3.8-5.8 6.5-5.8s5.1 2 6.5 5.8"/></svg></span><span>บัญชี</span><small>สิทธิ์ผู้ใช้</small></summary><div class="app-nav-menu dev-tools-menu">${meta.account}</div></details></div><div class="dev-utility-group" aria-label="สถานะระบบและรีเฟรช"><div class="dev-shell-slot dev-shell-status">${meta.status}</div><div class="dev-shell-slot dev-shell-refresh">${meta.refresh}</div></div></nav></div></header>`;
}

export function patchDevUiShellSource(source, currentPage) {
  let output = String(source || "");
  const headerPattern = /<header class=(['"])site-header\1>[\s\S]*?<\/header>/;
  if (!headerPattern.test(output)) {
    throw new Error(`DEV UI shell missing site-header in ${currentPage}`);
  }
  output = output.replace(headerPattern, unifiedHeaderHtml(currentPage));
  output = output.replace(
    /href=(['"])style\.css(?:\?[^'\"]*)?\1/,
    `href="${DEV_STYLE_HREF}"`,
  );
  if (currentPage === "proof.html") {
    output = output.replace(
      /<title>จัดการเส้นทางเดินรถ MS<\/title>/,
      "<title>ปริ้นบาร์โค้ดรถ MS</title>",
    );
  }
  if (!output.includes("DEV_EXCLUSIVE_DROPDOWNS_V4")) {
    const behavior = `<script data-dev-exclusive-dropdowns="v4">(()=>{const selector='.dev-unified-header details.app-nav';const close=(keep)=>document.querySelectorAll(selector).forEach((item)=>{if(item!==keep)item.open=false});document.addEventListener('click',(event)=>{const summary=event.target.closest('.dev-unified-header details.app-nav > summary');if(summary){close(summary.parentElement);return;}const action=event.target.closest('.dev-unified-header .app-nav-menu a,.dev-unified-header .app-nav-menu button');if(action){const owner=action.closest('details.app-nav');if(owner)owner.open=false;return;}if(!event.target.closest(selector))close(null);});document.addEventListener('keydown',(event)=>{if(event.key==='Escape')close(null);});})();</script><!-- DEV_EXCLUSIVE_DROPDOWNS_V4 -->`;
    output = output.replace("</body>", `${behavior}</body>`);
  }
  if (!output.includes("DEV_STATUS_LABEL_V5")) {
    const statusBehavior = `<script data-dev-status-label="v5">(()=>{const apply=()=>{document.querySelectorAll('.dev-unified-header .dev-shell-status .badge').forEach((badge)=>{if(badge.textContent.trim()==='ออนไลน์')badge.textContent='พร้อมใช้งาน';});};apply();const target=document.querySelector('.dev-unified-header .dev-shell-status');if(target)new MutationObserver(apply).observe(target,{childList:true,subtree:true,characterData:true});})();</script><!-- DEV_STATUS_LABEL_V5 -->`;
    output = output.replace("</body>", `${statusBehavior}</body>`);
  }
  return output;
}

function verifyDevUiShellSource(source, currentPage) {
  const text = String(source || "");
  const header = text.match(/<header class="site-header dev-unified-header"[\s\S]*?<\/header>/)?.[0] || "";
  if (!header || !header.includes('data-dev-shell="20260905-v2"')) {
    throw new Error(`DEV unified header missing in ${currentPage}`);
  }
  const mainMenu = header.match(/<div class="app-nav-menu">([\s\S]*?)<\/div><\/details>/)?.[1] || "";
  if (!mainMenu) throw new Error(`DEV UI system menu not found in ${currentPage}`);
  for (const [href] of DEV_NAV) {
    const count = (mainMenu.match(new RegExp(`href=["']${href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "g")) || []).length;
    if (count !== 1) throw new Error(`DEV UI ${currentPage} must contain ${href} exactly once; got ${count}`);
  }
  const currentCount = (mainMenu.match(/class=["']is-current["']/g) || []).length;
  if (currentCount !== 1) throw new Error(`DEV UI ${currentPage} must have exactly one current menu item`);
  const currentPattern = new RegExp(`href=["']${currentPage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'] class=["']is-current["']`);
  if (!currentPattern.test(mainMenu)) throw new Error(`DEV UI ${currentPage} current menu item is wrong`);
  if (/warehouse\.html|scan\.html|parity-check\.html|safe-parity\.html/.test(mainMenu)) {
    throw new Error(`DEV UI ${currentPage} exposes an internal or retired page in the user menu`);
  }
  const slots = [
    "dev-system-nav",
    "dev-page-tools",
    "dev-account-menu",
    "dev-shell-status",
    "dev-shell-refresh",
  ];
  let cursor = -1;
  for (const slot of slots) {
    const next = header.indexOf(slot);
    if (next <= cursor) throw new Error(`DEV UI ${currentPage} header slot order is wrong at ${slot}`);
    cursor = next;
  }
  if ((header.match(/dev-shell-slot/g) || []).length !== 5) {
    throw new Error(`DEV UI ${currentPage} must have exactly five header slots`);
  }
  if (!header.includes('class="dev-utility-group"')) {
    throw new Error(`DEV UI ${currentPage} status and refresh must stay grouped`);
  }
  if (!text.includes(`href="${DEV_STYLE_HREF}"`)) {
    throw new Error(`DEV UI ${currentPage} does not use the shared style release`);
  }
  if (currentPage === "proof.html" && !text.includes("<title>ปริ้นบาร์โค้ดรถ MS</title>")) {
    throw new Error("DEV proof title is inconsistent with the menu label");
  }
}

export async function stageDevUiShell(frontendTarget) {
  const assetDir = dirname(frontendTarget);
  for (const name of LEGACY_REDIRECTS) {
    await copyFile(join(repoRoot, name), join(assetDir, name));
  }
  for (const page of DEV_USER_PAGES) {
    const target = join(assetDir, page);
    const source = await readFile(target, "utf8");
    const patched = patchDevUiShellSource(source, page);
    verifyDevUiShellSource(patched, page);
    await writeFile(target, patched, "utf8");
  }
  for (const name of LEGACY_REDIRECTS) {
    const redirect = await readFile(join(assetDir, name), "utf8");
    if (!redirect.includes("ms.html")) throw new Error(`DEV legacy redirect ${name} does not point to ms.html`);
  }
  console.log("STAGED_DEV_UI_MENU_PAGES=4");
  console.log("STAGED_DEV_UI_MENU_ITEMS=4");
  console.log("STAGED_DEV_UI_HEADER_SLOTS=5");
  console.log(`STAGED_DEV_UI_SHELL=${DEV_SHELL_MARKER}`);
  console.log(`STAGED_DEV_UI_STYLE=${DEV_STYLE_HREF}`);
  console.log("STAGED_DEV_UI_LEGACY_REDIRECTS=3");
}

function patchDevUnifiedHeaderStyle(source) {
  const text = String(source || "");
  if (text.includes(DEV_SHELL_MARKER)) return text;
  return `${text}\n\n/* ${DEV_SHELL_MARKER}: DEV-only full header contract shared by all four user pages. */\n.dev-unified-header{position:sticky;top:0;z-index:50;background:#151515;color:#fff;border-bottom:3px solid #ffd400;box-shadow:0 3px 12px rgba(0,0,0,.14)}\n.dev-unified-header .site-header-inner{width:100%;max-width:none;min-height:66px;margin:0;padding:8px 18px;display:flex;align-items:center;gap:14px}\n.dev-unified-header .header-brand{display:flex;align-items:center;gap:10px;min-width:260px}\n.dev-unified-header .brand-mark{min-width:42px;width:42px;height:40px;padding:0;display:grid;place-items:center;border-radius:0;background:#ffd400;color:#111;clip-path:polygon(12% 0,100% 0,88% 100%,0 100%);box-shadow:none;font-size:23px;font-weight:950}\n.dev-unified-header .brand-copy{display:flex;flex-direction:column;gap:3px;min-width:0}\n.dev-unified-header .brand-copy strong{display:flex;align-items:center;color:#fff;font-size:17px;line-height:1.2;white-space:nowrap}\n.dev-unified-header .brand-copy strong::before{content:"/";margin-right:8px;color:#ffd400;font-size:20px;font-weight:900}\n.dev-unified-header .brand-copy span{color:#c9ccce;font-size:11px;white-space:nowrap}\n.dev-unified-header .dev-unified-actions{margin-left:auto;display:flex;align-items:center;justify-content:flex-end;gap:6px;padding:0;border:0;border-radius:0;background:transparent}\n.dev-unified-header .dev-shell-slot{display:flex;align-items:center;min-width:0}\n.dev-unified-header .dev-shell-slot>.badge,.dev-unified-header .dev-shell-slot>.btn,.dev-unified-header .dev-shell-slot>.header-link{min-height:42px;border-radius:7px;padding:8px 13px}\n.dev-unified-header .app-nav{position:relative}\n.dev-unified-header .app-nav>summary{position:relative;min-height:52px;min-width:195px;display:grid;grid-template-columns:30px minmax(0,1fr) 18px;align-items:center;gap:10px;padding:7px 12px 15px;border:1px solid #434343;border-radius:6px;background:#222;color:#fff;cursor:pointer;list-style:none}\n.dev-unified-header .app-nav>summary::-webkit-details-marker{display:none}\n.dev-unified-header .app-nav>summary>span:nth-child(2){font-weight:900;font-size:16px;line-height:1.2;white-space:nowrap}\n.dev-unified-header .app-nav>summary small{position:absolute;left:52px;bottom:6px;color:#d2d5d7;font-size:12px;line-height:1.2;white-space:nowrap;max-width:calc(100% - 82px);overflow:hidden;text-overflow:ellipsis}\n.dev-unified-header .nav-grid-icon{display:grid;place-items:center;width:30px;height:30px;border-radius:6px;background:#ffd400;color:#111}.dev-unified-header .dev-nav-svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}\n.dev-unified-header .app-nav-menu{position:absolute;right:0;top:calc(100% + 6px);z-index:60;width:min(360px,calc(100vw - 24px));padding:7px;border:1px solid #4b4b4b;border-radius:8px;background:#1d1d1d;box-shadow:0 12px 28px rgba(0,0,0,.28)}\n.dev-unified-header .app-nav-menu a{display:grid;grid-template-columns:40px minmax(0,1fr);column-gap:14px;row-gap:2px;align-items:center;padding:10px 12px;border-radius:7px;color:#fff;text-decoration:none}\n.dev-unified-header .app-nav-menu a>span{grid-row:1/3;display:grid;place-items:center;width:40px;height:40px;border-radius:8px;background:#292929;color:#ffd400}\n.dev-unified-header .app-nav-menu a>b{font-size:16px;line-height:1.35}\n.dev-unified-header .app-nav-menu a>small{color:#cbd0d3;font-size:12.5px;line-height:1.45}\n.dev-unified-header .app-nav-menu a:hover,.dev-unified-header .app-nav-menu a.is-current{background:#343434}\n.dev-unified-header .app-nav-menu a.is-current{box-shadow:inset 3px 0 #ffd400}\n.dev-unified-header .dev-tools-menu{display:grid;gap:7px;min-width:270px}\n.dev-unified-header .dev-tools-menu .btn,.dev-unified-header .dev-tools-menu .header-link{width:100%;min-height:38px;display:flex;align-items:center;justify-content:center;text-align:center;text-decoration:none}\n.dev-unified-header .dev-tools-empty{display:block;padding:10px 12px;color:#c9ccce;font-size:11px;text-align:center}\n.dev-unified-header .dev-system-nav{order:1}\n.dev-unified-header .dev-page-tools{order:2}\n.dev-unified-header .dev-account-menu{order:3}\n.dev-unified-header .dev-utility-group{order:4;display:flex;align-items:stretch;gap:0;margin-left:8px;border:1px solid #414141;border-radius:9px;overflow:hidden;background:#1b1b1b}\n.dev-unified-header .dev-shell-refresh>.btn{min-width:92px;color:#151515;background:#ffd400;border-color:#d8b300;font-weight:900}\n.dev-unified-header .dev-shell-refresh>.btn::before{content:"↻";margin-right:6px;font-size:17px;font-weight:950}\n.dev-unified-header .dev-shell-status>.badge{min-width:88px;min-height:42px;justify-content:center;border-radius:7px;font-size:13px;font-weight:900}\n.dev-unified-header .dev-shell-status>.badge-online{border:1px solid #8fd0aa;background:#e7f7ee;color:#09683a}\n.dev-unified-header .dev-shell-status>.badge-offline{border:1px solid #e6a7a2;background:#fff0ef;color:#a32620}\n.dev-unified-header .dev-tools-menu .dev-change-password{border-color:#d8b300;background:#fff6c8;color:#342b00;font-weight:900}\n/* DEV_HEADER_POLISH_V3: status+refresh visual group, readable menus, account password entry. */\n/* DEV_HEADER_INTERACTION_V4: larger labels, one-open-dropdown behavior, clean SVG icons and dedicated chevron. */\n/* DEV_HEADER_LAYOUT_V5: spacious dropdown icons plus a far-right status/refresh utility group. */\n.dev-unified-header .dev-utility-group .dev-shell-status>.badge{display:flex;align-items:center;justify-content:center;min-width:118px;min-height:50px;padding:8px 13px;border:0;border-radius:0}\n.dev-unified-header .dev-utility-group .dev-shell-refresh>.btn{min-width:96px;min-height:50px;padding:8px 13px;border:0;border-left:1px solid #d8b300;border-radius:0}\n.dev-unified-header .dev-utility-group .dev-shell-status>.badge-online{border:0;background:#e9f8ef;color:#09683a}\n.dev-unified-header .dev-shell-status>.badge-online::before{content:"";width:8px;height:8px;margin-right:8px;border-radius:50%;background:#19a75a;box-shadow:0 0 0 3px rgba(25,167,90,.14);flex:0 0 auto}\n.dev-unified-header .app-nav>summary::marker{content:""}\n.dev-unified-header .app-nav>summary::after{content:"⌄";grid-column:3;display:grid;place-items:center;color:#ffd400;font-size:19px;font-weight:900;line-height:1;transition:transform .16s ease}\n.dev-unified-header .app-nav[open]>summary::after{transform:rotate(180deg)}\n@media(max-width:1100px){.dev-unified-header{position:relative}.dev-unified-header .site-header-inner{align-items:stretch;flex-wrap:wrap}.dev-unified-header .header-brand{width:100%;min-width:0}.dev-unified-header .dev-unified-actions{width:100%;margin-left:0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}.dev-unified-header .dev-shell-slot,.dev-unified-header .dev-shell-slot>*{width:100%}.dev-unified-header .dev-utility-group{width:100%;margin-left:0}.dev-unified-header .app-nav>summary{width:100%;min-width:0}}\n@media(max-width:700px){.dev-unified-header .site-header-inner{padding:9px 10px 10px}.dev-unified-header .brand-copy strong{font-size:15px;white-space:normal}.dev-unified-header .brand-copy span{white-space:normal}.dev-unified-header .dev-unified-actions{grid-template-columns:1fr 1fr;gap:7px}.dev-unified-header .dev-utility-group{grid-column:1/-1;grid-row:1;display:grid;grid-template-columns:minmax(0,1fr) auto;margin:0 0 1px}.dev-unified-header .dev-system-nav{grid-column:1;grid-row:2}.dev-unified-header .dev-page-tools{grid-column:2;grid-row:2}.dev-unified-header .dev-account-menu{grid-column:1/-1;grid-row:3}.dev-unified-header .app-nav>summary{grid-template-columns:30px minmax(0,1fr) 18px}.dev-unified-header .app-nav>summary small{display:none}.dev-unified-header .app-nav-menu{position:fixed;left:10px;right:10px;top:auto;width:auto;margin-top:6px}.dev-unified-header .dev-utility-group .dev-shell-status>.badge{min-width:0}.dev-unified-header .dev-utility-group .dev-shell-refresh>.btn{min-width:96px}}\n`;
}

export function patchDevRootEntryWorker(source) {
  const text = String(source || "");
  if (text.includes("DEV_ROOT_ENTRY_V1")) return text;
  const needle = `const url = new URL(request.url);\n      if (!url.pathname.startsWith("/api")) return env.ASSETS.fetch(request);`;
  if (!text.includes(needle)) {
    throw new Error("DEV root entry anchor not found in worker source");
  }
  return text.replace(
    needle,
    `const url = new URL(request.url);\n      // DEV_ROOT_ENTRY_V1: DEV-only staged entry route; canonical worker source is unchanged.\n      if (url.pathname === "/") return Response.redirect(new URL("/ms.html", request.url), 302);\n      if (!url.pathname.startsWith("/api")) return env.ASSETS.fetch(request);`,
  );
}

export function frontendHasIntegratedDevRuntime(source) {
  const text = String(source || "");
  return (
    text.includes("requestTimeoutMs: 32000") &&
    text.includes('apiGet("msCompletedToday"') &&
    text.includes("queueMode = state.queue") &&
    text.includes("DEV: archive stays lazy")
  );
}

export function stageFrontend(source) {
  let output = String(source || "");
  if (!frontendHasIntegratedDevRuntime(output)) {
    output = patchDevMsArchive(output);
    output = patchDevRealtimeFrontend(output);
    output = patchDevSummaryFilter(output);
  }
  output = patchMsRouteCancellationFrontend(output);
  output = patchMsNonDestinationCancellationFrontend(output);
  output = patchMsFastAllCancelledFrontend(output);
  output = patchMsSummaryPerformanceFrontend(output);
  output = patchMsOperatingDayFrontend(output);
  output = patchMsDailyCompletionObservationFrontend(output);
  output = patchMsCompletedViewStabilityFrontend(output);
  output = patchMsLiveResilienceFrontend(output);
  output = patchMsDailyHistoryFrontend(output);
  output = patchMsConnectionErrorKvFrontend(output);
  return output;
}

export function stageStyle(source) {
  return patchDevUnifiedHeaderStyle(
    patchMsSummaryPerformanceStyle(
      patchMsRouteCancellationStyle(patchDevMsMobileStyle(source)),
    ),
  );
}

export function stageWorker(source) {
  let output = patchDevWorkerCompletedSummary(String(source || ""));
  output = patchDevRealtimeWorker(output);
  output = patchDevDurableCoordinator(output);
  output = patchDevConnectorAdoption(output);
  output = patchDevMultiClientWorker(output);
  output = patchMsRouteCancellationWorker(output);
  output = patchMsNonDestinationCancellationWorker(output);
  output = patchMsOperatingDayWorker(output);
  output = patchMsDailyCompletionObservationWorker(output);
  output = patchMsDailyHistoryWorker(output);
  output = patchMsQuotaSafeLiveWorker(output);
  output = patchMsTbrShadowFeedWorker(output);
  output = patchDevRootEntryWorker(output);
  return output;
}

export async function stageDevRuntime(frontendTarget, workerTarget) {
  const styleTarget = join(dirname(frontendTarget), "style.css");
  const [frontend, style, worker] = await Promise.all([
    readFile(frontendTarget, "utf8"),
    readFile(styleTarget, "utf8"),
    readFile(workerTarget, "utf8"),
  ]);
  const stagedWorker = stageWorker(worker);
  if (!stagedWorker.includes("DEV_ROOT_ENTRY_V1")) {
    throw new Error("DEV staged worker lost root entry contract");
  }
  await Promise.all([
    writeFile(frontendTarget, stageFrontend(frontend), "utf8"),
    writeFile(styleTarget, stageStyle(style), "utf8"),
    writeFile(workerTarget, stagedWorker, "utf8"),
  ]);
}

const invokedPath = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (invokedPath) {
  const frontendTarget = process.argv[2];
  const workerTarget = process.argv[3];
  if (!frontendTarget || !workerTarget)
    throw new Error(
      "Usage: node stage-dev-runtime.mjs <staged-ms.js> <worker-index.js>",
    );
  await stageDevRuntime(frontendTarget, workerTarget);
  await stageDevUiShell(frontendTarget);
  // TBR Shadow is DEV/Browser-Test-only. Keep these two quota-safe patches in
  // the normal DEV staging path so a later main deploy cannot overwrite the
  // tested Split V2 contract with the older full connectorSync implementation.
  execFileSync(process.execPath, [devTbrReadonlyPatch, workerTarget], {
    stdio: "inherit",
  });
  execFileSync(process.execPath, [devTbrSplitV2Patch, workerTarget], {
    stdio: "inherit",
  });
  console.log(`Staged idempotent DEV frontend: ${frontendTarget}`);
  console.log(`Staged DEV worker runtime: ${workerTarget}`);
  console.log("STAGED_DEV_ROOT_ENTRY=PASS");
  console.log("STAGED_DEV_UNIFIED_HEADER_V2=PASS");
  console.log("Staged DEV TBR Shadow runtime: SHADOW_READONLY_SPLIT_V2");
}
