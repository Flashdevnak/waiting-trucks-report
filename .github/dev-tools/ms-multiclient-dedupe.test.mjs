import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { patchDevWorkerCompletedSummary } from "../../worker/scripts/patch-dev-ms-archive.mjs";
import { patchDevRealtimeWorker } from "./patch-ms-realtime-recovery.mjs";
import { patchDevMultiClientWorker } from "./patch-ms-multiclient-dedupe.mjs";

const root = new URL("../../", import.meta.url);
const workerSource = await readFile(new URL("worker/src/index.js", root), "utf8");
const migration = await readFile(
  new URL("worker/migrations/0008_ms_sync_claims.sql", root),
  "utf8",
);
const worker = patchDevMultiClientWorker(
  patchDevRealtimeWorker(patchDevWorkerCompletedSummary(workerSource)),
);

test("changed MS source is serialized across Worker isolates", () => {
  assert.match(worker, /async function acquireMsSyncClaim/);
  assert.match(worker, /INSERT INTO ms_sync_claims/);
  assert.match(worker, /state='DONE' AND ms_sync_claims\.source_hash<>excluded\.source_hash/);
  assert.match(worker, /state='ACTIVE' AND ms_sync_claims\.lease_until<\?/);
  assert.match(worker, /MS_SYNC_CLAIM_LEASE_MS = 15000/);
  assert.doesNotMatch(worker, /MS_SYNC_CLAIM_LEASE_MS = 5000/);
  assert.match(worker, /if \(cache\?\.sourceMatch\) \{[\s\S]*?changes: 0/);
  assert.match(worker, /const claim = await acquireMsSyncClaim\(env, branch, sourceHash\)/);
  assert.match(worker, /const currentCache = await readMsLiveCache\(env, branch, sourceHash\)/);
  assert.match(worker, /await waitForMsSourceCache\(env, branch, sourceHash\)/);
});

test("claim is completed only after the changed source is published", () => {
  const cacheWrite = worker.indexOf("cacheWrite = await safeStatusWrite(");
  const finish = worker.indexOf(
    "await finishMsSyncClaim(env, branch, syncClaim, Boolean(cacheWrite))",
  );
  assert.ok(cacheWrite >= 0, "cache publication must exist");
  assert.ok(finish > cacheWrite, "claim completion must follow cache publication");
  assert.match(worker, /success \? "DONE" : "FAILED"/);
  assert.match(worker, /WHERE hub=\? AND claim_token=\?/);
});

test("live cache publication is idempotent and steady polling does not claim", () => {
  assert.match(
    worker,
    /WHERE ms_live_cache\.source_hash<>excluded\.source_hash OR ms_live_cache\.rows_json<>excluded\.rows_json/,
  );
  assert.match(
    worker,
    /if \(cache\?\.sourceMatch\) \{[\s\S]*?\} else \{\s*const claim = await acquireMsSyncClaim/,
  );
  assert.match(worker, /MS_SYNC_TTL = 3000/);
});

test("claim migration is additive and HUB-scoped", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ms_sync_claims/);
  assert.match(migration, /hub TEXT PRIMARY KEY NOT NULL/);
  assert.match(migration, /source_hash TEXT NOT NULL/);
  assert.match(migration, /claim_token TEXT NOT NULL/);
  assert.match(migration, /lease_until TEXT NOT NULL/);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|ALTER TABLE/i);
});
