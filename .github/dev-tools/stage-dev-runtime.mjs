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
const DEV_STYLE_HREF = "style.css?v=20260905-dev-shell-v1";
const DEV_NAV = [
  ["ms.html", "🚚", "ติดตามรถ MS", "คิวรถเข้า–ออกและสถานะปัจจุบัน"],
  ["proof.html", "🧾", "ปริ้นบาร์โค้ดรถ", "ตรวจข้อมูล แก้ไขตามสิทธิ์ MS และปริ้น PDF"],
  ["waiting.html", "⏱", "รถรอลงงาน", "จัดการคิวและเวลารอลงงาน"],
  ["ms-report.html", "▥", "สรุปรายวัน", "เปรียบเทียบรถจบงานตามวันและเวลา"],
];

function navHtml(currentPage) {
  return DEV_NAV.map(([href, icon, label, detail]) =>
    `<a href="${href}"${href === currentPage ? ' class="is-current"' : ""}><span>${icon}</span><b>${label}</b><small>${detail}</small></a>`,
  ).join("");
}

export function patchDevUiShellSource(source, currentPage) {
  let output = String(source || "");
  const navPattern = /<div class=(['"])app-nav-menu\1>[\s\S]*?<\/div><\/details>/;
  if (!navPattern.test(output)) {
    throw new Error(`DEV UI shell missing app-nav-menu in ${currentPage}`);
  }
  output = output.replace(
    navPattern,
    `<div class="app-nav-menu">${navHtml(currentPage)}</div></details>`,
  );
  output = output.replace(
    /href=(['"])style\.css(?:\?[^'\"]*)?\1/,
    `href="${DEV_STYLE_HREF}"`,
  );
  if (currentPage === "proof.html") {
    output = output
      .replace(/<title>จัดการเส้นทางเดินรถ MS<\/title>/, "<title>ปริ้นบาร์โค้ดรถ MS</title>")
      .replace(/(<div class=['"]brand-copy['"]><strong>)จัดการเส้นทางเดินรถ MS(<\/strong>)/, "$1ปริ้นบาร์โค้ดรถ MS$2");
  }
  return output;
}

function verifyDevUiShellSource(source, currentPage) {
  const text = String(source || "");
  const menu = text.match(/<div class=(['"])app-nav-menu\1>([\s\S]*?)<\/div><\/details>/)?.[2] || "";
  if (!menu) throw new Error(`DEV UI menu not found in ${currentPage}`);
  for (const [href] of DEV_NAV) {
    const count = (menu.match(new RegExp(`href=["']${href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "g")) || []).length;
    if (count !== 1) throw new Error(`DEV UI ${currentPage} must contain ${href} exactly once; got ${count}`);
  }
  const currentCount = (menu.match(/class=["']is-current["']/g) || []).length;
  if (currentCount !== 1) throw new Error(`DEV UI ${currentPage} must have exactly one current menu item`);
  const currentPattern = new RegExp(`href=["']${currentPage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'] class=["']is-current["']`);
  if (!currentPattern.test(menu)) throw new Error(`DEV UI ${currentPage} current menu item is wrong`);
  if (/warehouse\.html|scan\.html|parity-check\.html|safe-parity\.html/.test(menu)) {
    throw new Error(`DEV UI ${currentPage} exposes an internal or retired page in the user menu`);
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
  console.log(`STAGED_DEV_UI_STYLE=${DEV_STYLE_HREF}`);
  console.log("STAGED_DEV_UI_LEGACY_REDIRECTS=3");
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
  return patchMsSummaryPerformanceStyle(
    patchMsRouteCancellationStyle(patchDevMsMobileStyle(source)),
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
  return output;
}

export async function stageDevRuntime(frontendTarget, workerTarget) {
  const styleTarget = join(dirname(frontendTarget), "style.css");
  const [frontend, style, worker] = await Promise.all([
    readFile(frontendTarget, "utf8"),
    readFile(styleTarget, "utf8"),
    readFile(workerTarget, "utf8"),
  ]);
  await Promise.all([
    writeFile(frontendTarget, stageFrontend(frontend), "utf8"),
    writeFile(styleTarget, stageStyle(style), "utf8"),
    writeFile(workerTarget, stageWorker(worker), "utf8"),
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
  console.log("Staged DEV TBR Shadow runtime: SHADOW_READONLY_SPLIT_V2");
}
