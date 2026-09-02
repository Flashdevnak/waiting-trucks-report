import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { patchDevDurableCoordinator } from "./patch-ms-durable-coordinator.mjs";

const root = new URL("../../", import.meta.url);
const workerSource = await readFile(new URL("worker/src/index.js", root), "utf8");
const config = JSON.parse(
  await readFile(new URL("worker/wrangler.dev.jsonc", root), "utf8"),
);
const workflow = await readFile(
  new URL(".github/workflows/deploy-worker-dev.yml", root),
  "utf8",
);
const worker = patchDevDurableCoordinator(workerSource);

test("DEV routes cross-isolate refresh through one Durable Object per HUB", () => {
  assert.match(worker, /export class MsRefreshCoordinator/);
  assert.match(worker, /MS_REFRESH_COORDINATOR\.idFromName\(branch\)/);
  assert.match(worker, /MS_REFRESH_COORDINATOR\.get\(id\)/);
  assert.match(worker, /stub\.fetch\(new Request\(url\)\)/);
  assert.match(worker, /if \(this\.active\)/);
  assert.match(worker, /if \(!force && this\.lastResult\) return this\.lastResult/);
  assert.match(worker, /runMsRefresh\(this\.env, branch\)/);
});

test("DEV coordinator preserves 4-second frontend cadence without D1 lease writes", () => {
  assert.match(workerSource, /const MS_SYNC_TTL = 3000/);
  assert.doesNotMatch(worker, /ms_refresh_leases|INSERT INTO ms_refresh|UPDATE ms_refresh/i);
  assert.match(
    worker,
    /recentMsSync\.set\(branch, \{ until: Date\.now\(\) \+ MS_SYNC_TTL, result \}\)/,
  );
});

test("DEV Wrangler binds one SQLite-backed Durable Object class", () => {
  const binding = config.durable_objects?.bindings?.find(
    (item) => item.name === "MS_REFRESH_COORDINATOR",
  );
  assert.equal(binding?.class_name, "MsRefreshCoordinator");
  const migration = config.migrations?.find((item) =>
    item.new_sqlite_classes?.includes("MsRefreshCoordinator"),
  );
  assert.ok(migration, "SQLite Durable Object migration must exist");
});

test("DEV deployment patches and validates coordinator before deploy", () => {
  assert.match(workflow, /ms-durable-coordinator\.test\.mjs/);
  assert.match(
    workflow,
    /patch-ms-durable-coordinator\.mjs src\/index\.js/,
  );
  assert.match(workflow, /node --check src\/index\.js/);
});
