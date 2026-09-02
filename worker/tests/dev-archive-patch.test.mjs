import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  patchDevMsArchive,
  patchDevMsMobileStyle,
  patchDevWorkerCompletedSummary,
} from "../scripts/patch-dev-ms-archive.mjs";

const root = new URL("../../", import.meta.url);
const source = await readFile(new URL("ms.js", root), "utf8");
const styleSource = await readFile(new URL("style.css", root), "utf8");
const workerSource = await readFile(new URL("worker/src/index.js", root), "utf8");
const patched = patchDevMsArchive(source);
const patchedStyle = patchDevMsMobileStyle(styleSource);
const patchedWorker = patchDevWorkerCompletedSummary(workerSource);

test("DEV page never auto-loads the heavy archive during live polling", () => {
  assert.match(patched, /pollMs:\s*4000/);
  assert.doesNotMatch(
    patched,
    /if \(!silent && !state\.archiveLoaded\) scheduleArchiveLoad\(\)/,
  );
  assert.match(
    patched,
    /state\.queue === "all" \|\| state\.queue === "completed"/,
  );
  assert.match(
    patched,
    /if \(!\(await ensureArchiveLoaded\(true\)\)\)/,
  );
  assert.match(patched, /async function ensureArchiveLoaded/);
  assert.match(patched, /metric-archive"\)\.textContent = "กดดู"/);
});

test("only lower queue completed card uses lightweight daily HUB accumulation", () => {
  assert.match(
    patched,
    /state\.completedToday = Number\(result\?\.completedToday\) \|\| 0/,
  );
  assert.match(
    patched,
    /completed:\s*Number\(state\.completedToday\) \|\| 0/,
  );
  assert.doesNotMatch(
    patched,
    /if \(isCompletedToday\(row\)\) counts\.completed\+\+;/,
  );
  assert.match(
    patched,
    /"metric-completed",\s*state\.archiveRows\.filter\(\(row\) => isCompletedToday\(row\)\)\.length/,
  );
  assert.match(patched, /apiGet\("msCompletedToday", \{ branch: state\.branch \}\)/);
  assert.match(patched, /state\.queue = "all"/);
  assert.match(patched, /if \(isDestination\(row\) && key === "arrived"\) counts\.waiting\+\+;/);
  assert.match(patched, /if \(isDestination\(row\) && key === "unloading"\) counts\.unloading\+\+;/);
  assert.match(patched, /if \(isOrigin\(row\) && !queue\.done\) counts\.origin\+\+;/);
  assert.match(patched, /if \(isDrop\(row\) && !queue\.done\) counts\.drop\+\+;/);
});

test("DEV worker preserves today's completed destination/drop rows in existing live cache", () => {
  assert.match(patchedWorker, /completedToday: Number\(live\.completedToday\) \|\| 0/);
  assert.match(patchedWorker, /action === "msCompletedToday"/);
  assert.match(patchedWorker, /version: 2/);
  assert.match(patchedWorker, /completedDay/);
  assert.match(patchedWorker, /completedRows/);
  assert.match(patchedWorker, /cache\?\.sourceMatch/);
  assert.match(patchedWorker, /completedToday: completedRows\.length/);
  assert.match(
    patchedWorker,
    /attendance === "ปลายทาง" \|\| attendance === "จุดดรอป"/,
  );
  assert.match(patchedWorker, /Number\(row\?\.unloadingState\) === 2/);
  assert.match(patchedWorker, /timeZone: "Asia\/Bangkok"/);
  assert.match(
    patchedWorker,
    /SELECT route_id,payload_json,synced_by FROM ms_route_history WHERE hub=\? AND snapshot_at>=\?/,
  );
  assert.match(patchedWorker, /if \(item\.synced_by === "MS_RANGE"\) continue/);
  assert.doesNotMatch(patchedWorker, /CREATE TABLE|ALTER TABLE/);
});

test("KIT TBR arrival source block is shown for origin and destination only", () => {
  assert.match(
    patched,
    /function arrivalSources\(row\) \{\s*if \(!isDestination\(row\) && !isOrigin\(row\)\) return "";/,
  );
  assert.doesNotMatch(
    patched,
    /function arrivalSources\(row\) \{\s*if \(!isDestination\(row\)\) return "";/,
  );
  assert.match(patched, /เวลาถึงจากระบบ/);
  assert.match(patched, /scheduleKitArrivalAt/);
  assert.match(patched, /scheduleTbrArrivalAt/);
  assert.match(patched, /ใช้เวลาที่มาก่อน/);
});

test("DEV mobile card separates major operational sections without changing data logic", () => {
  assert.match(patchedStyle, /DEV mobile MS card spacing/);
  assert.match(
    patchedStyle,
    /\.ms-page \.compact-operation \{\s*margin: 0 14px 14px;\s*border: 1px solid #d9dcd8;/,
  );
  assert.match(
    patchedStyle,
    /\.ms-page \.departure-countdown \{\s*width: auto;\s*margin: 0 14px 14px;/,
  );
  assert.match(
    patchedStyle,
    /\.ms-page \.arrival-sources,\s*\.ms-page \.source-empty \{\s*width: auto;\s*margin: 0 14px 14px;/,
  );
  assert.match(
    patchedStyle,
    /\.ms-page \.compact-schedule \.schedule-section \+ \.schedule-section \{\s*margin-top: 12px;/,
  );
  assert.match(patchedStyle, /@media \(max-width: 420px\)/);
  assert.equal(
    patchDevMsMobileStyle(patchedStyle),
    patchedStyle,
    "mobile style patch must be idempotent",
  );
});
