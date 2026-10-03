// The Route persistence repair runs last, against the effective DEV Worker.
// Keep the canonical Worker unchanged: this is a DEV-only recovery contract.
function replaceOnce(source, before, after, label) {
  const index = source.indexOf(before);
  if (index < 0 || source.indexOf(before, index + 1) >= 0)
    throw new Error(`MS Route persistence anchor missing/ambiguous: ${label}`);
  return source.slice(0, index) + after + source.slice(index + before.length);
}

export function patchMsRoutePersistenceV1(input) {
  let source = String(input);
  if (source.includes("MS_ROUTE_PERSISTENCE_V1")) return source;
  source = replaceOnce(source,
    'import { canonicalMsSource, planMsChanges, resolveCompletionTruth } from "./sync-policy.js";',
    'import { canonicalMsSource, planMsChanges, resolveCompletionTruth, sameMsRouteCore } from "./sync-policy.js";',
    "core comparator import");

  const oldStart = source.indexOf('  const cacheBaseline = Array.isArray(body.baselineRows)', source.indexOf('async function syncMs('));
  const oldEnd = source.indexOf('  const now = new Date().toISOString(),', oldStart);
  if (oldStart < 0 || oldEnd < 0) throw new Error('MS Route persistence baseline anchors missing');
  source = source.slice(0, oldStart) + `  // MS_ROUTE_PERSISTENCE_V1: a cache can lag committed route batches. Always
  // compare against persisted rows; the latest business history holds trusted
  // provenance that the legacy ms_routes schema cannot itself represent.
  const acceptedById = new Map((Array.isArray(body.baselineRows) ? body.baselineRows : [])
    .map((row) => [row.id, row]));
  const [oldRowsResult, cancellationResult] = await Promise.all([
    env.DB.prepare(
      "SELECT r.*, h.payload_json AS route_history_payload FROM ms_routes r " +
      "LEFT JOIN ms_route_latest l ON l.hub=r.hub AND l.route_id=r.id " +
      "LEFT JOIN ms_route_history h ON h.rowid=l.history_rowid AND h.hub=r.hub " +
      "WHERE r.hub=?",
    ).bind(branch).all(),
    env.DB.prepare(
      "SELECT route_id,proof_id,cancelled_at,cancelled_by,reason FROM ms_route_cancellations WHERE hub=? AND active=1",
    ).bind(branch).all(),
  ]);
  const oldRows = oldRowsResult.results.map((persisted) => {
    const row = output(persisted);
    let history = null;
    try { history = JSON.parse(persisted.route_history_payload || "null"); } catch {}
    const accepted = acceptedById.get(row.id);
    const sameCompletion = (candidate) => candidate &&
      String(candidate.unloadingState ?? "") === String(row.unloadingState ?? "") &&
      String(candidate.unloadingCompletedAt || "") === String(row.unloadingCompletedAt || "");
    // A committed current+history transaction outranks the older accepted
    // cache. Neither source can invent completion evidence for legacy rows.
    const provenance = sameCompletion(history) && history.completionSource !== undefined
      ? history : sameCompletion(accepted) ? accepted :
        sameCompletion(history) ? history : null;
    row.completionSource = "UNKNOWN";
    if (provenance) {
      for (const key of ["completionSource", "completionObservedLive",
        "unloadingStartedAt", "unloadingStartedObservedAt", "unloadingStartSource",
        "scheduleUnloadingStartedAt", "scheduleUnloadingCompletedAt"])
        if (provenance[key] !== undefined) row[key] = provenance[key];
    }
    return row;
  });
  const cancellationById = new Map(
    cancellationResult.results.map((row) => [String(row.route_id), row]),
  );
  const oldById = new Map(oldRows.map((row) => [row.id, row]));
` + source.slice(oldEnd);

  const planStart = source.indexOf('  const plan = planMsChanges(', source.indexOf('async function syncMs('));
  const planEnd = source.indexOf('  return {\n    branch,\n    synced: seen.size,', planStart);
  if (planStart < 0 || planEnd < 0) throw new Error('MS Route persistence planning anchors missing');
  source = source.slice(0, planStart) + `  const plan = planMsChanges(oldRows, prepared.map((item) => item.snapshot),
    Boolean(body.preserveMissing));
  const changedIds = new Set(plan.changedIds);
  const coreChangedIds = new Set(prepared
    .filter((item) => !oldById.has(item.id) ||
      !sameMsRouteCore(oldById.get(item.id), item.snapshot))
    .map((item) => item.id));
  const removedIds = new Set(plan.removedIds);
  const groups = [];
  for (const item of prepared) {
    const old = oldById.get(item.id);
    if (coreChangedIds.has(item.id)) {
      const group = [];
      if (!old) group.push(env.DB.prepare(
        "INSERT OR IGNORE INTO ms_route_registry(hub,route_id,first_seen_at) VALUES(?,?,?)",
      ).bind(branch, item.id, now));
      group.push(env.DB.prepare(
        "INSERT OR REPLACE INTO ms_routes(id,hub,proof_id,route_name,region,route_attribute,route_type,attendance_type,estimated_arrival_at,actual_arrival_at,estimated_departure_at,actual_departure_at,supplier,vehicle_type,plate,driver_name,driver_phone,tracking_status,vehicle_status,load_status,unloading_state,unloading_completed_at,source_updated_at,expected_parcels,entered_parcels,pending_parcels,schedule_kit_arrival_at,schedule_tbr_arrival_at,arrived_parcels,arrived_bags,synced_at,synced_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).bind(...item.values));
      group.push(env.DB.prepare(
        "INSERT INTO ms_route_history VALUES(?,?,?,?,?,?,?)",
      ).bind(crypto.randomUUID(), item.id, branch, old ? "UPDATED" : "FIRST_SEEN",
        now, JSON.stringify({ ...item.snapshot,
          completionObservedLive: Boolean(item.snapshot.unloadingCompletedAt) }),
        actor.username));
      groups.push(group);
    } else if (old && changedIds.has(item.id)) {
      // The current display may change, but an optional source has not
      // observed a Route business transition or changed its Route timestamp.
      const keys = ["expectedParcels", "enteredParcels", "pendingParcels",
        "scheduleKitArrivalAt", "scheduleTbrArrivalAt", "arrivedParcels", "arrivedBags"];
      if (keys.some((key) => String(old[key] ?? "") !== String(item.snapshot[key] ?? "")))
        groups.push([env.DB.prepare(
          "UPDATE ms_routes SET expected_parcels=?,entered_parcels=?,pending_parcels=?,schedule_kit_arrival_at=?,schedule_tbr_arrival_at=?,arrived_parcels=?,arrived_bags=? WHERE hub=? AND id=?",
        ).bind(...item.values.slice(23, 30), branch, item.id)]);
    }
  }
  for (const old of oldRows) if (removedIds.has(old.id))
    groups.push([
      env.DB.prepare("INSERT INTO ms_route_history VALUES(?,?,?,?,?,?,?)")
        .bind(crypto.randomUUID(), old.id, branch, "REMOVED", now,
          JSON.stringify(old), actor.username),
      env.DB.prepare("DELETE FROM ms_routes WHERE hub=? AND id=?").bind(branch, old.id),
    ]);
  // No physical transaction may split a route's current state and history.
  // A retry reads committed rows, so completed groups cannot be replayed.
  let batch = [];
  for (const group of groups) {
    if (batch.length + group.length > 96) {
      await env.DB.batch(batch);
      batch = [];
    }
    batch.push(...group);
  }
  if (batch.length) await env.DB.batch(batch);
  const businessChanges = coreChangedIds.size + removedIds.size;
  if (businessChanges) {
    try {
      await audit(env, "SYNC_MS_ROUTES", branch,
        \`\${seen.size} current / \${businessChanges} business changes\`, actor.username);
    } catch (error) {
      console.error(JSON.stringify({ event: "ms_sync_audit_error", branch, message: error.message }));
    }
  }
  const responseRows = prepared.map((item) => {
    const previous = oldById.get(item.id);
    const coreChanged = coreChangedIds.has(item.id);
    return { ...item.snapshot,
      completionObservedLive: Boolean(item.snapshot?.unloadingCompletedAt),
      syncedAt: coreChanged ? now : previous?.syncedAt || now,
      syncedBy: coreChanged ? actor.username : previous?.syncedBy || actor.username };
  });
` + source.slice(planEnd);

  // An accepted source hash must mean both Route batches and the durable
  // snapshot committed. The claim is released on failure for the next retry.
  source = replaceOnce(source,
    `      cacheWrite = await safeStatusWrite(
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
      );`,
    `      try {
        cacheWrite = publishSource
          ? await writeMsLiveCache(env, branch, sourceHash, sync.rows,
              sync.syncedAt, completedDay, completedRows)
          : await safeStatusWrite(writeMsLiveCache(env, branch, sourceHash,
              sync.rows, sync.syncedAt, completedDay, completedRows),
              "ms_live_cache_write_error", branch);
      } catch (error) {
        if (syncClaim) {
          await finishMsSyncClaim(env, branch, syncClaim, false);
          syncClaim = null;
        }
        throw error;
      }`,
    'durable acceptance boundary');
  return source;
}
