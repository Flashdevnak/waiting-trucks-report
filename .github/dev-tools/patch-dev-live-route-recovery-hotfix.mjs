const MARKER = "DEV_LIVE_ROUTE_RECOVERY_HOTFIX_V1";

export function resolveMsRouteSnapshot(cache, nowMs = Date.now()) {
  const contentSyncedAt = String(cache?.synced_at || "");
  const contentAt = Date.parse(contentSyncedAt);
  const cacheSourceHash = String(cache?.source_hash || "");
  const claimAttestsCache =
    Boolean(cacheSourceHash) &&
    String(cache?.claim_state || "") === "DONE" &&
    String(cache?.claim_source_hash || "") === cacheSourceHash;
  const sourceValidatedAt = claimAttestsCache
    ? String(cache?.route_last_success_at || "")
    : "";
  const validatedAt = Date.parse(sourceValidatedAt);
  const freshnessAt = Math.max(
    Number.isFinite(contentAt) ? contentAt : Number.NEGATIVE_INFINITY,
    Number.isFinite(validatedAt) ? validatedAt : Number.NEGATIVE_INFINITY,
  );
  const snapshotAgeMs = Number.isFinite(freshnessAt)
    ? Math.max(0, Number(nowMs) - freshnessAt)
    : -1;
  const lastSync = Number.isFinite(freshnessAt)
    ? new Date(freshnessAt).toISOString()
    : "";
  let rows = null;
  try {
    const parsed = JSON.parse(cache?.rows_json || "");
    rows = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.rows)
        ? parsed.rows
        : null;
  } catch {}
  const snapshotFound =
    Array.isArray(rows) &&
    snapshotAgeMs >= 0 &&
    snapshotAgeMs <= 20 * 60 * 1000;
  return {
    rows: snapshotFound ? rows : [],
    snapshotFound,
    snapshotAgeMs,
    lastSync: snapshotFound ? lastSync : "",
    contentSyncedAt,
    sourceValidatedAt,
  };
}

export function patchDevLiveRouteRecoveryHotfix(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;

  const helperAnchor = "async function get(url, env) {";
  const helperAt = output.indexOf(helperAnchor);
  if (helperAt < 0 || helperAt !== output.lastIndexOf(helperAnchor))
    throw new Error(`${MARKER}: get() anchor missing or non-unique`);
  output =
    output.slice(0, helperAt) +
    `// ${MARKER}: content writes and successful Route validation are separate facts.\n` +
    `export ${resolveMsRouteSnapshot.toString()}\n\n` +
    output.slice(helperAt);

  const startMarker = '  // MS_FAST_FIRST_PAINT_V1: cache-only first paint. This path never calls upstream MS.\n  if (action === "msRoutesSnapshot") {';
  const endMarker = '  if (action === "msRoutes") {';
  const start = output.indexOf(startMarker);
  const end = output.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || start !== output.lastIndexOf(startMarker))
    throw new Error(`${MARKER}: snapshot action anchor missing or non-unique`);

  const replacement = `  // MS_FAST_FIRST_PAINT_V1: cache-only first paint. This path never calls upstream MS.
  if (action === "msRoutesSnapshot") {
    const branch = pickBranch(actor, url.searchParams.get("branch"));
    const [cache, settings] = await Promise.all([
      env.DB.prepare(
        \`SELECT c.source_hash,c.rows_json,c.synced_at,
                r.last_success_at AS route_last_success_at,
                q.source_hash AS claim_source_hash,q.state AS claim_state
           FROM ms_live_cache c
           LEFT JOIN ms_connections r ON r.hub=c.hub
           LEFT JOIN ms_sync_claims q ON q.hub=c.hub
          WHERE c.hub=? LIMIT 1\`,
      )
        .bind(branch)
        .first(),
      readSettings(env, branch),
    ]);
    const snapshot = resolveMsRouteSnapshot(cache);
    return ok({
      rows: snapshot.rows,
      branch,
      branches:
        actor.role === "admin"
          ? [...new Set([branch, ...(await knownMsBranches(env))])]
          : actor.branches.filter((x) => x !== "*"),
      standards: settings.msVehicleLimits,
      lastSync: snapshot.lastSync,
      contentSyncedAt: snapshot.contentSyncedAt,
      sourceValidatedAt: snapshot.sourceValidatedAt,
      msStatus: snapshot.snapshotFound ? "cached" : "empty",
      syncError: "",
      snapshotFound: snapshot.snapshotFound,
      snapshotAgeMs: snapshot.snapshotAgeMs,
    });
  }
`;
  return output.slice(0, start) + replacement + output.slice(end);
}
