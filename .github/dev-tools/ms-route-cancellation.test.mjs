import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { patchDevWorkerCompletedSummary } from "../../worker/scripts/patch-dev-ms-archive.mjs";
import {
  patchMsRouteCancellationFrontend,
  patchMsRouteCancellationStyle,
  patchMsRouteCancellationWorker,
} from "./patch-ms-route-cancellation.mjs";

const root = new URL("../../", import.meta.url);
const frontendSource = await readFile(new URL("ms.js", root), "utf8");
const styleSource = await readFile(new URL("style.css", root), "utf8");
const workerSource = await readFile(new URL("worker/src/index.js", root), "utf8");
const migration = await readFile(new URL("worker/migrations/0009_ms_route_cancellations.sql", root), "utf8");
const stage = await readFile(new URL(".github/dev-tools/stage-dev-runtime.mjs", root), "utf8");
const cutover = await readFile(new URL(".github/cutover-tools/prepare-cutover.mjs", root), "utf8");
const frontend = patchMsRouteCancellationFrontend(frontendSource);
const style = patchMsRouteCancellationStyle(styleSource);
const worker = patchMsRouteCancellationWorker(patchDevWorkerCompletedSummary(workerSource));

test("route cancel button lives with driver data and requires a password PIN dialog", () => {
  assert.match(frontend, /data-cancel-ms-route/);
  assert.match(frontend, /ยกเลิกเส้นทาง/);
  assert.match(frontend, /type="password"/);
  assert.match(frontend, /apiPost\("cancelMsRoute"/);
  assert.match(frontend, /branch: state\.branch/);
  assert.match(frontend, /routeId: target\.id/);
  assert.match(frontend, /pin/);
  assert.match(style, /MS route cancellation controls/);
  assert.match(style, /\.cancel-route-button/);
});

test("cancelled routes leave only the current queue and remain auditable", () => {
  assert.match(frontend, /cancelled = Boolean/);
  assert.match(frontend, /!done && !cancelled && ageHours <= 12/);
  assert.match(frontend, /queueCancelledAt/);
  assert.match(frontend, /queueCancelledBy/);
  assert.match(frontend, /queueCancelReason/);
  assert.match(frontend, /queueStatus: q\.cancelled/);
  assert.match(frontend, /state\.cancelledRouteIds\.add\(id\)/);
});

test("backend re-authenticates the current user PIN and never calls MS upstream", () => {
  assert.match(worker, /SELECT password_hash,active FROM users WHERE username=\?/);
  assert.match(worker, /passMatch\(actor\.username, pin, user\.password_hash, env\)/);
  assert.match(worker, /INVALID_CONFIRMATION_PIN/);
  assert.match(worker, /pickBranch\(actor, body\.branch\)/);
  assert.match(worker, /ROUTE_ALREADY_DONE/);
  assert.match(worker, /ROUTE_NOT_ACTIVE/);
  const start = worker.indexOf("async function cancelMsRoute");
  const end = worker.indexOf("async function syncMs", start);
  const block = worker.slice(start, end);
  assert.doesNotMatch(block, /readMsRoutes|refreshMsIfStale|runMsRefresh/);
});

test("cancellation persists once and steady unchanged polling adds no cancellation query", () => {
  assert.match(worker, /INSERT INTO ms_route_cancellations/);
  assert.match(worker, /CANCEL_MS_ROUTE/);
  assert.match(worker, /UPDATE ms_live_cache SET rows_json=\?/);
  assert.match(worker, /SELECT route_id,proof_id,cancelled_at,cancelled_by,reason FROM ms_route_cancellations WHERE hub=\? AND active=1/);
  const getStart = worker.indexOf('if (action === "msRoutes")');
  const getEnd = worker.indexOf('if (action === "msHistory")', getStart);
  const getBlock = worker.slice(getStart, getEnd);
  assert.doesNotMatch(getBlock, /ms_route_cancellations/);
  const syncStart = worker.indexOf("async function syncMs");
  const syncBlock = worker.slice(syncStart);
  assert.match(syncBlock, /cancellationResult/);
});

test("cancelled destination/drop cannot inflate daily completed total", () => {
  assert.match(worker, /!row\?\.queueCancelledAt/);
  assert.match(frontend, /if \(row\.queueCancelledAt\) return false/);
});

test("cancellation migration is additive, HUB-scoped and indexed", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ms_route_cancellations/);
  assert.match(migration, /PRIMARY KEY \(hub, route_id\)/);
  assert.match(migration, /idx_ms_route_cancellations_hub_active/);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM/i);
});

test("DEV staging and cutover both carry the cancellation UI", () => {
  assert.match(stage, /patchMsRouteCancellationFrontend/);
  assert.match(stage, /patchMsRouteCancellationWorker/);
  assert.match(cutover, /patchMsRouteCancellationFrontend/);
  assert.match(cutover, /patchMsRouteCancellationStyle/);
});
