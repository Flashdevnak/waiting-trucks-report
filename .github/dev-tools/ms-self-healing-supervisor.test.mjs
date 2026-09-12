import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { stageWorker } from "./stage-dev-runtime.mjs";

const root = new URL("../../", import.meta.url);
const canonical = await readFile(new URL("worker/src/index.js", root), "utf8");
const staged = stageWorker(canonical);
const adminHtml = await readFile(new URL("admin.html", root), "utf8");
const adminJs = await readFile(new URL("admin.js", root), "utf8");

test("one supervisor covers every configured HUB without a named-HUB exception", () => {
  assert.match(staged, /MS_ALL_HUB_SELF_HEAL_V1/);
  assert.match(staged, /SELECT hub FROM ms_connections ORDER BY hub/);
  assert.match(staged, /mapMsRepairLimit\(rows, MS_REPAIR_CONCURRENCY/);
  assert.doesNotMatch(staged, /rows\.slice\(0, 20\)/);
  assert.doesNotMatch(staged, /hub\s*===\s*["'](?:EA2|NE1)["']/);
});

test("healthy state adds no Turso or upstream probe and repair state avoids Turso", () => {
  assert.match(staged, /PIGGYBACK_STATE_CHANGE_ONLY_V1/);
  assert.match(staged, /healthyExtraTursoReads: 0/);
  assert.match(staged, /healthyExtraTursoWrites: 0/);
  assert.match(staged, /healthyExtraUpstreamCalls: 0/);
  assert.match(staged, /this\.ctx\.storage\.put\("ms-repair-v1", next\)/);
  assert.doesNotMatch(staged, /INSERT INTO ms_repair|UPDATE ms_repair|DELETE FROM ms_repair/i);
});

test("transient failures back off and session expiry requires confirmation before needs_login", () => {
  assert.match(staged, /MS_REPAIR_POLICY_VERSION = 4/);
  assert.match(staged, /\[60_000, 2 \* 60_000, 5 \* 60_000, 10 \* 60_000\]/);
  assert.match(staged, /MS_REPAIR_SESSION_COOLDOWN_MS = 60 \* 60_000/);
  assert.match(staged, /const authSignal = resultCode === "MS_SESSION_EXPIRED" \|\| resultCode === "INVALID_SESSION"/);
  assert.match(staged, /const confirmedAuthTerminal = authSignal && this\.repair\?\.code === resultCode && previousFailures >= 1/);
  assert.match(staged, /const terminal = credentialTerminal \|\| confirmedAuthTerminal/);
  assert.match(staged, /terminal \? "needs_login" : "retry_wait"/);
  assert.match(staged, /nextRetryAt: nowMs \+ delay/);
  assert.match(staged, /repairPaused: true/);
});

test("manual admin repair is role-gated, bounded and never touches HBI", () => {
  assert.match(staged, /action === "adminRepairAll"[\s\S]*?mustAdmin\(actor\)/);
  assert.match(staged, /MANUAL_ONE_ATTEMPT_PER_HUB_V1/);
  assert.match(staged, /url\.searchParams\.set\("force", "1"\)/);
  const repair = staged.slice(staged.indexOf("async function adminRepairAll"), staged.indexOf("async function saveUser"));
  assert.ok(repair.length > 0);
  assert.doesNotMatch(repair, /HBI|hbi|msTruckPhotos|ms_hbi/);
  assert.match(adminHtml, /id="repair-all-btn"/);
  assert.match(adminJs, /SOURCE_STALE_MS = 20 \* 60 \* 1000/);
  assert.match(adminJs, /confirm\([\s\S]*?สูงสุดหนึ่งรอบต่อ HUB[\s\S]*?ไม่แตะ HBI/);
  assert.doesNotMatch(adminJs, /setInterval\s*\(|new WebSocket\s*\(|EventSource\s*\(/);
});

test("newly paired credentials bypass an old repair cooldown", () => {
  assert.match(staged, /refreshMsIfStale\(env, \{ username: "MS_QR", role: "admin", branches: \["\*"\] \}, row\.hub, true\)/);
});
