import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`DEV multi-client dedupe patch failed: ${label}`);
  return output.replace(from, to);
}

export function patchDevMultiClientWorker(source) {
  let output = String(source || "");

  output = replaceUnique(
    output,
    `    const sourceHash = await sha(canonicalMsSource(mappedRows));
    const cache = await readMsLiveCache(env, branch, sourceHash);
    const sync = cache?.sourceMatch
      ? {
          syncedAt: new Date().toISOString(),
          changes: 0,
          rows: cache.rows,
        }
      : await syncMs(
          { branch, rows: mappedRows },
          { username: "MS_AUTO", role: "admin", branches: ["*"] },
          env,
        );
    const completedDay = thaiDay();`,
    `    const sourceHash = await sha(canonicalMsSource(mappedRows));
    let cache = await readMsLiveCache(env, branch, sourceHash);
    let sync;
    let syncClaim = null;
    let publishSource = false;

    if (cache?.sourceMatch) {
      sync = {
        syncedAt: new Date().toISOString(),
        changes: 0,
        rows: cache.rows,
      };
    } else {
      const claim = await acquireMsSyncClaim(env, branch, sourceHash);
      if (claim.acquired) {
        syncClaim = claim;
        const currentCache = await readMsLiveCache(env, branch, sourceHash);
        if (currentCache?.sourceMatch) {
          cache = currentCache;
          sync = {
            syncedAt: new Date().toISOString(),
            changes: 0,
            rows: currentCache.rows,
          };
          await finishMsSyncClaim(env, branch, claim, true);
          syncClaim = null;
        } else {
          cache = currentCache || cache;
          try {
            sync = await syncMs(
              { branch, rows: mappedRows },
              { username: "MS_AUTO", role: "admin", branches: ["*"] },
              env,
            );
            publishSource = true;
          } catch (error) {
            await finishMsSyncClaim(env, branch, claim, false);
            syncClaim = null;
            throw error;
          }
        }
      } else {
        const settled = await waitForMsSourceCache(env, branch, sourceHash);
        if (settled?.sourceMatch) {
          cache = settled;
          sync = {
            syncedAt: new Date().toISOString(),
            changes: 0,
            rows: settled.rows,
          };
        } else {
          sync = {
            syncedAt: new Date().toISOString(),
            changes: 0,
            rows: cache?.rows || [],
          };
        }
      }
    }
    const completedDay = thaiDay();`,
    "serialize changed source before syncMs",
  );

  output = replaceUnique(
    output,
    `    if (!cache?.sourceMatch || cache?.format !== 2 || cache?.completedDay !== completedDay)
      await safeStatusWrite(
        writeMsLiveCache(
          env,
          branch,
          sourceHash,
          sync.rows,
          sync.syncedAt,
          completedDay,
          completedRows,
        ),
        "ms_live_cache_write_error",
        branch,
      );
    await safeStatusWrite(`,
    `    let cacheWrite = null;
    if (
      publishSource ||
      (cache?.sourceMatch &&
        (cache?.format !== 2 || cache?.completedDay !== completedDay))
    )
      cacheWrite = await safeStatusWrite(
        writeMsLiveCache(
          env,
          branch,
          sourceHash,
          sync.rows,
          sync.syncedAt,
          completedDay,
          completedRows,
        ),
        "ms_live_cache_write_error",
        branch,
      );
    if (syncClaim) {
      await finishMsSyncClaim(env, branch, syncClaim, Boolean(cacheWrite));
      syncClaim = null;
    }
    await safeStatusWrite(`,
    "publish cache before completing source claim",
  );

  output = replaceUnique(
    output,
    `    "INSERT INTO ms_live_cache(hub,source_hash,rows_json,synced_at) VALUES(?,?,?,?) ON CONFLICT(hub) DO UPDATE SET source_hash=excluded.source_hash,rows_json=excluded.rows_json,synced_at=excluded.synced_at",
  )`,
    `    "INSERT INTO ms_live_cache(hub,source_hash,rows_json,synced_at) VALUES(?,?,?,?) ON CONFLICT(hub) DO UPDATE SET source_hash=excluded.source_hash,rows_json=excluded.rows_json,synced_at=excluded.synced_at WHERE ms_live_cache.source_hash<>excluded.source_hash OR ms_live_cache.rows_json<>excluded.rows_json",
  )`,
    "make cache publication idempotent across isolates",
  );

  output = replaceUnique(
    output,
    `async function markConnectionSuccess(env, table, hub, now = new Date().toISOString()) {`,
    `const MS_SYNC_CLAIM_LEASE_MS = 15000;

async function acquireMsSyncClaim(env, hub, sourceHash) {
  const now = new Date();
  const claimedAt = now.toISOString();
  const leaseUntil = new Date(now.getTime() + MS_SYNC_CLAIM_LEASE_MS).toISOString();
  const token = crypto.randomUUID();
  const result = await env.DB.prepare(
    "INSERT INTO ms_sync_claims(hub,source_hash,claim_token,state,lease_until,claimed_at,finished_at) VALUES(?,?,?,'ACTIVE',?,?,'') ON CONFLICT(hub) DO UPDATE SET source_hash=excluded.source_hash,claim_token=excluded.claim_token,state='ACTIVE',lease_until=excluded.lease_until,claimed_at=excluded.claimed_at,finished_at='' WHERE (ms_sync_claims.state='DONE' AND ms_sync_claims.source_hash<>excluded.source_hash) OR ms_sync_claims.state='FAILED' OR (ms_sync_claims.state='ACTIVE' AND ms_sync_claims.lease_until<?)",
  )
    .bind(hub, sourceHash, token, leaseUntil, claimedAt, claimedAt)
    .run();
  return {
    acquired: Number(result?.meta?.changes || 0) > 0,
    token,
    sourceHash,
  };
}

async function finishMsSyncClaim(env, hub, claim, success) {
  if (!claim?.token) return null;
  return safeStatusWrite(
    env.DB.prepare(
      "UPDATE ms_sync_claims SET state=?,lease_until='',finished_at=? WHERE hub=? AND claim_token=?",
    )
      .bind(
        success ? "DONE" : "FAILED",
        new Date().toISOString(),
        hub,
        claim.token,
      )
      .run(),
    "ms_sync_claim_finish_error",
    hub,
  );
}

async function waitForMsSourceCache(env, hub, sourceHash) {
  for (let attempt = 0; attempt < 6; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const cache = await readMsLiveCache(env, hub, sourceHash);
    if (cache?.sourceMatch) return cache;
  }
  return null;
}

async function markConnectionSuccess(env, table, hub, now = new Date().toISOString()) {`,
    "add cross-isolate claim helpers",
  );

  return output;
}

const invokedPath = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (invokedPath) {
  const workerTarget = process.argv[2];
  if (!workerTarget)
    throw new Error(
      "Usage: node patch-ms-multiclient-dedupe.mjs <worker-index.js>",
    );
  const worker = await readFile(workerTarget, "utf8");
  await writeFile(workerTarget, patchDevMultiClientWorker(worker), "utf8");
  console.log(`Patched DEV cross-isolate MS dedupe: ${workerTarget}`);
}
