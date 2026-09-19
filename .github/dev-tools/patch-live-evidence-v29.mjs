const MARKER = "LIVE_EVIDENCE_V29";
const FRONTEND_MARKER = "LIVE_EVIDENCE_FRONTEND_V29";
const WORKER_MARKER = "LIVE_EVIDENCE_WORKER_V29";

function replaceUnique(source, from, to, label) {
  const first = source.indexOf(from);
  const last = source.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`${MARKER}: ${label} anchor missing or non-unique`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

function replaceBetween(source, startNeedle, endNeedle, replacement, label) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  if (start < 0 || end < 0)
    throw new Error(`${MARKER}: ${label} boundary missing`);
  return source.slice(0, start) + replacement + source.slice(end);
}

export function mergeCompletedTbrFixtureV29(previousRows, liveRows, day, dayForValue) {
  const latest = new Map();
  const merge = (row) => {
    const id = row?.id || row?.routeId || row?.proofId;
    if (!id || Number(row?.unloadingState) !== 2 || dayForValue(row?.unloadingCompletedAt) !== day) return;
    const prior = latest.get(id);
    latest.set(id, {
      ...(prior || {}),
      ...row,
      scheduleTbrArrivalAt:
        String(row?.scheduleTbrArrivalAt || "").trim() ||
        String(prior?.scheduleTbrArrivalAt || "").trim(),
    });
  };
  for (const row of previousRows || []) merge(row);
  for (const row of liveRows || []) merge(row);
  return [...latest.values()];
}

export function sortCompletedFixtureV29(rows) {
  return [...(rows || [])].sort((a, b) => {
    const aTime = Date.parse(String(a?.trustedCompletionAt || "")) || 0;
    const bTime = Date.parse(String(b?.trustedCompletionAt || "")) || 0;
    return bTime - aTime;
  });
}

export function patchLiveEvidenceV29Frontend(source) {
  let output = String(source || "");
  if (output.includes(FRONTEND_MARKER)) return output;
  if (!output.includes("PNO_PENDING_MEMBERSHIP_INTERSECTION_V28"))
    throw new Error(`${MARKER}: V28 frontend prerequisite missing`);

  output = replaceUnique(
    output,
    `  const attr = enabled ? ' data-pno-operational-row="' + rowId + '"' : "";`,
    `  const attr = enabled
    ? ' data-pno-operational-row="' + rowId + '" data-pno-detail-card="' + rowId + '" role="button" tabindex="0" aria-label="กดดูรายละเอียดพัสดุ"'
    : "";`,
    "PNO card audit target",
  );

  const pnoAnchor = 'document.addEventListener("DOMContentLoaded", pnoV18EnsureUi);';
  const detailRuntime = `// ${FRONTEND_MARKER}: make the visible inbound parcel summary itself an
// explicit audit surface. This is click/keyboard-only and adds no timer, polling,
// subscription or background source request.
function pnoV29DetailTarget(event) {
  const direct = event?.target?.closest?.("[data-pno-row]");
  if (direct) return {
    rowId: String(direct.dataset.pnoRow || ""),
    type: String(direct.dataset.pnoType || "total"),
  };
  const card = event?.target?.closest?.("[data-pno-detail-card]");
  if (!card) return null;
  return {
    rowId: String(card.dataset.pnoDetailCard || card.dataset.pnoOperationalRow || ""),
    type: "total",
  };
}

function pnoV29OpenDetail(event) {
  const target = pnoV29DetailTarget(event);
  if (!target?.rowId) return;
  const row = findPnoRowById(target.rowId);
  if (!row || !pnoOperationalInboundEligible(row)) return;
  event.preventDefault?.();
  event.stopImmediatePropagation?.();
  void Promise.resolve(openPendingParcels(row, target.type, 1))
    .catch((error) => toast(error?.message || "เปิดรายละเอียดพัสดุไม่สำเร็จ", true));
}

function pnoV29OpenDetailByKeyboard(event) {
  if (event.key !== "Enter" && event.key !== " ") return;
  if (event?.target?.closest?.("[data-pno-row]")) return;
  if (!event?.target?.closest?.("[data-pno-detail-card]")) return;
  pnoV29OpenDetail(event);
}

function pnoV29EnsureAuditStyle() {
  if (document.getElementById("pno-live-evidence-v29-style")) return;
  const style = document.createElement("style");
  style.id = "pno-live-evidence-v29-style";
  style.textContent =
    ".ms-page [data-pno-detail-card]{cursor:pointer}" +
    ".ms-page [data-pno-detail-card]:hover{border-color:#b7a02d}" +
    ".ms-page [data-pno-detail-card]:focus-visible{outline:2px solid #b48f00;outline-offset:2px}";
  document.head.append(style);
}

document.addEventListener("click", pnoV29OpenDetail, true);
document.addEventListener("keydown", pnoV29OpenDetailByKeyboard, true);
document.addEventListener("DOMContentLoaded", pnoV29EnsureAuditStyle);

${pnoAnchor}`;
  output = replaceUnique(output, pnoAnchor, detailRuntime, "PNO audit event bridge");
  return output;
}

export function patchLiveEvidenceV29Worker(source) {
  let output = String(source || "");
  if (output.includes(WORKER_MARKER)) return output;
  if (!output.includes("DEV_MS_COMPLETED_TODAY_V1") && !output.includes("readMsCompletedToday"))
    throw new Error(`${MARKER}: completed-today DEV runtime prerequisite missing`);

  output = replaceUnique(
    output,
    `      date(r.scheduleKitArrivalAt),
      date(r.scheduleTbrArrivalAt),
      numberOrNull(r.arrivedParcels),`,
    `      date(r.scheduleKitArrivalAt),
      // ${WORKER_MARKER}: once BusTime supplied TBR for this exact route,
      // completion must never erase it merely because fleetStatus=1 no longer
      // returns completed vehicles.
      date(r.scheduleTbrArrivalAt) || date(old?.schedule_tbr_arrival_at),
      numberOrNull(r.arrivedParcels),`,
    "preserve prior route TBR on completion",
  );

  const mergeReplacement = `function mergeCompletedToday(previousRows, liveRows, day) {
  // completion cache only trusts observed live unloading transitions
  const latest = new Map();
  const merge = (row) => {
    const id = row?.id || row?.routeId || row?.proofId;
    if (!id || !isCompletedForThaiDay(row, day)) return;
    const prior = latest.get(id);
    latest.set(id, {
      ...(prior || {}),
      ...row,
      // ${WORKER_MARKER}: carry the last known non-empty TBR forward into the
      // completed cache without any BusTime call or healthy-state DB write.
      scheduleTbrArrivalAt:
        String(row?.scheduleTbrArrivalAt || "").trim() ||
        String(prior?.scheduleTbrArrivalAt || "").trim(),
    });
  };
  for (const row of previousRows || []) merge(row);
  for (const row of liveRows || []) merge(row);
  return [...latest.values()];
}

`;
  output = replaceBetween(
    output,
    "function mergeCompletedToday(previousRows, liveRows, day) {",
    "async function bootstrapCompletedToday(env, hub, day) {",
    mergeReplacement,
    "completed cache TBR merge",
  );

  const completedReadReplacement = `async function recoverCompletedTbrV29(env, hub, rows) {
  const missingIds = [...new Set(
    (rows || [])
      .filter((row) => !String(row?.scheduleTbrArrivalAt || "").trim())
      .map((row) => String(row?.id || row?.routeId || "").trim())
      .filter(Boolean),
  )];
  if (!missingIds.length) return rows || [];

  // Read only the missing completed route IDs from the existing indexed history.
  // This is Turso-only, read-only, user/detail-path work: upstream BusTime calls = 0.
  const placeholders = missingIds.map(() => "?").join(",");
  const history = await env.DB.prepare(
    "SELECT route_id,payload_json " +
    "FROM ms_route_history INDEXED BY idx_ms_route_history_hub_route_snapshot " +
    "WHERE hub=? AND route_id IN (" + placeholders + ") " +
    "AND json_valid(payload_json)=1 " +
    "AND COALESCE(json_extract(payload_json,'$.scheduleTbrArrivalAt'),'')<>'' " +
    "ORDER BY route_id,snapshot_at DESC,rowid DESC",
  ).bind(hub, ...missingIds).all();

  const tbrByRoute = new Map();
  for (const item of history.results || []) {
    if (tbrByRoute.has(item.route_id)) continue;
    try {
      const row = JSON.parse(item.payload_json || "{}");
      const tbr = String(row?.scheduleTbrArrivalAt || "").trim();
      if (tbr && Number.isFinite(Date.parse(tbr))) tbrByRoute.set(item.route_id, tbr);
    } catch {}
  }
  if (!tbrByRoute.size) return rows || [];
  return (rows || []).map((row) => {
    if (String(row?.scheduleTbrArrivalAt || "").trim()) return row;
    const tbr = tbrByRoute.get(String(row?.id || row?.routeId || "").trim());
    return tbr ? { ...row, scheduleTbrArrivalAt: tbr } : row;
  });
}

async function readMsCompletedToday(env, actor, hub) {
  if (!access(hub, actor)) fail("ไม่มีสิทธิ์ดู HUB นี้", "FORBIDDEN", 403);
  const day = thaiDay();
  const cache = await readMsLiveCache(env, hub);
  const previous =
    cache?.format === 2 && cache.completedDay === day
      ? cache.completedRows
      : await bootstrapCompletedToday(env, hub, day);
  const rows = mergeCompletedToday(previous, cache?.rows || [], day);
  const recoveredRows = await recoverCompletedTbrV29(env, hub, rows);
  return { hub, day, total: recoveredRows.length, rows: recoveredRows };
}

`;
  // V29_SYNC_CLAIM_BOUNDARY_FIX: multi-client dedupe stages its shared
  // sync-claim helpers between readMsCompletedToday() and markConnectionSuccess().
  // Replace only readMsCompletedToday() so V29 can never delete those helpers.
  const completedReadStart = output.indexOf(
    "async function readMsCompletedToday(env, actor, hub) {",
  );
  const syncClaimHelpersStart = output.indexOf(
    "const MS_SYNC_CLAIM_LEASE_MS = 15000;",
    completedReadStart,
  );
  const markConnectionStart = output.indexOf(
    "async function markConnectionSuccess(env, table, hub, now = new Date().toISOString()) {",
    completedReadStart,
  );
  const completedReadEndNeedle =
    syncClaimHelpersStart >= 0 &&
    (markConnectionStart < 0 || syncClaimHelpersStart < markConnectionStart)
      ? "const MS_SYNC_CLAIM_LEASE_MS = 15000;"
      : "async function markConnectionSuccess(env, table, hub, now = new Date().toISOString()) {";

  output = replaceBetween(
    output,
    "async function readMsCompletedToday(env, actor, hub) {",
    completedReadEndNeedle,
    completedReadReplacement,
    "completed historical TBR recovery",
  );

  return output;
}
