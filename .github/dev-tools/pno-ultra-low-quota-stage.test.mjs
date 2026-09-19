import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { stageFrontend, stageWorker } from "./stage-dev-runtime.mjs";

const root = new URL("../../", import.meta.url);
const canonicalWorker = await readFile(new URL("worker/src/index.js", root), "utf8");
const canonicalFront = await readFile(new URL("ms.js", root), "utf8");
const stagedWorker = stageWorker(canonicalWorker);
const stagedFront = stageFrontend(canonicalFront);

function between(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `missing section ${startMarker}`);
  return text.slice(start, end);
}

test("PNO stays DEV-staged and canonical runtime sources remain untouched", () => {
  assert.doesNotMatch(canonicalWorker, /PNO_ULTRA_LOW_QUOTA_V1|PNO_SHARED_DURABLE_V1/);
  assert.doesNotMatch(canonicalFront, /PNO_BROWSER_CACHE_V1|PNO_RUNTIME_UI_BOOTSTRAP_V1/);
  assert.match(stagedWorker, /PNO_ULTRA_LOW_QUOTA_V1/);
  assert.match(stagedWorker, /PNO_SHARED_DURABLE_V1/);
  assert.match(stagedFront, /PNO_BROWSER_CACHE_V1/);
  assert.match(stagedFront, /PNO_RUNTIME_UI_BOOTSTRAP_V1/);
});

test("PNO uses 200-row lazy pages with shared 60s page cache and 10m credential cache", () => {
  assert.match(stagedWorker, /const PNO_PAGE_SIZE = 200;/);
  assert.match(stagedWorker, /const PNO_SHARED_CACHE_TTL_MS = 60 \* 1000;/);
  assert.match(stagedWorker, /const PREENTRY_CREDENTIAL_CACHE_MS = 10 \* 60 \* 1000;/);
  assert.match(stagedWorker, /page_size: String\(PNO_PAGE_SIZE\)/);
  assert.match(stagedWorker, /rawRows\.slice\(0, PNO_PAGE_SIZE\)/);
  assert.match(stagedFront, /const PNO_BROWSER_CACHE_MS = 60 \* 1000;/);
});

test("same-page concurrent PNO requests coalesce through one shared inflight promise", () => {
  console.log("DIAG_SHARED_PNO_BEGIN\\n" + between(stagedWorker, "export async function readSharedPnoPage", "export function pnoDiagnostics") + "\\nDIAG_SHARED_PNO_END");
  const section = between(stagedWorker, "export async function readSharedPnoPage", "export function pnoDiagnostics");
  assert.match(section, /state\.pnoPageActive\.has\(activeKey\)/);
  assert.match(section, /return state\.pnoPageActive\.get\(activeKey\)/);
  assert.match(section, /state\.pnoPageActive\.set\(activeKey, task\)/);
  assert.match(section, /\.finally\(\(\) => state\.pnoPageActive\.delete\(activeKey\)\)/);
  assert.match(section, /state\.pnoDiagnostics\.fbiCalls \+= 1/);
});

test("PNO detail is click-only and never joins the four-second refresh upstream path", () => {
  const refresh = between(stagedWorker, "async function runMsRefresh(env, branch) {", "async function readMsLiveCache");
  assert.doesNotMatch(refresh, /readSharedPnoPage\s*\(/);
  assert.doesNotMatch(refresh, /readPendingParcelPage\s*\(/);
  assert.doesNotMatch(refresh, /preEntryCredentials\s*\(/);
  assert.doesNotMatch(refresh, /route_followstart_list/);
  assert.match(stagedFront, /pollMs:\s*4000/);
  assert.match(stagedFront, /setInterval\(realtimeTick, CONFIG\.pollMs\)/);
  const modal = between(stagedFront, "async function openPendingParcels", "function currentPendingParcelRow");
  assert.doesNotMatch(modal, /setInterval\s*\(|setTimeout\s*\(/);
});

test("PNO detail no longer performs a summary rescan before loading the requested page", () => {
  const route = between(stagedWorker, "async function pendingParcels", "function pnoOwnerState");
  assert.match(route, /MS_REFRESH_COORDINATOR/);
  assert.match(route, /\/pno/);
  assert.doesNotMatch(route, /preEntryTrips\s*\(|readPreEntryCounts\s*\(|readPendingParcelPage\s*\(/);
});
