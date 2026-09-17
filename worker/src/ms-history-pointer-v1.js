// DEV_MS_HISTORY_POINTER_V1
// Optimized read-only msDailyArchive path for the Turso DEV runtime.
// Authorization is delegated to the existing core Worker. The pointer query
// never calls upstream MS and never writes history.

const MAX_RANGE_MS = 6 * 86400000;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function error(message, code, status = 400) {
  return json({ ok: false, code, message }, status);
}

function thaiDateStart(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return NaN;
  return Date.parse(`${value}T00:00:00+07:00`);
}

function canonicalHub(value) {
  return String(value || "").trim().toUpperCase().slice(0, 80);
}

function pointerUnavailable(errorValue) {
  const value = String(errorValue?.message || errorValue || "");
  return /no such table|ms_route_latest_meta|ms_route_latest/i.test(value);
}

async function authorize(request, env, ctx, coreWorker, hub) {
  const url = new URL(request.url);
  url.searchParams.set("action", "msConnectionStatus");
  url.searchParams.set("branch", hub);
  const authRequest = new Request(url.toString(), {
    method: "GET",
    headers: request.headers,
  });
  return coreWorker.fetch(authRequest, env, ctx);
}

export async function queryMsDailyArchivePointer(env, hub, start, end) {
  const [historyResult, cancellationResult] = await Promise.all([
    env.DB.prepare(
      `SELECT h.route_id,h.payload_json,h.snapshot_at,h.synced_by,h.event_type,p.business_day
       FROM ms_route_latest p INDEXED BY idx_ms_route_latest_hub_day
       JOIN ms_route_history h ON h.rowid=p.history_rowid
       WHERE p.hub=? AND p.business_day>=? AND p.business_day<=?
       ORDER BY p.business_day DESC,h.snapshot_at DESC`,
    )
      .bind(hub, start, end)
      .all(),
    env.DB.prepare(
      "SELECT route_id,cancelled_at,cancelled_by,reason FROM ms_route_cancellations WHERE hub=? AND active=1",
    )
      .bind(hub)
      .all(),
  ]);

  const cancellations = new Map(
    (cancellationResult.results || []).map((row) => [row.route_id, row]),
  );
  const rows = [];
  for (const item of historyResult.results || []) {
    try {
      const row = JSON.parse(item.payload_json || "{}");
      if (!row || typeof row !== "object") continue;
      row.id = row.id || item.route_id;
      row.hub = row.hub || hub;
      row.archivedAt = item.snapshot_at;
      row.businessDay = item.business_day;
      const cancelled = cancellations.get(item.route_id);
      if (cancelled) {
        row.queueCancelledAt = cancelled.cancelled_at;
        row.queueCancelledBy = cancelled.cancelled_by;
        row.queueCancelReason = cancelled.reason;
      }
      rows.push(row);
    } catch {}
  }

  return {
    rows,
    total: rows.length,
    complete: true,
    branch: hub,
    start,
    end,
    source: "TURSO_DAILY_HISTORY",
    upstreamMsCalls: 0,
    historyWrites: 0,
  };
}

export async function maybeHandleMsDailyArchivePointer(request, env, ctx, coreWorker) {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  if (url.pathname !== "/api" || url.searchParams.get("action") !== "msDailyArchive")
    return null;

  const hub = canonicalHub(url.searchParams.get("branch"));
  if (!hub) return null;

  const authResponse = await authorize(request, env, ctx, coreWorker, hub);
  if (!authResponse.ok) return authResponse;

  const start = String(url.searchParams.get("start") || ""),
    end = String(url.searchParams.get("end") || start),
    startMs = thaiDateStart(start),
    endMs = thaiDateStart(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs)
    return error("กรุณาเลือกช่วงวันที่ให้ถูกต้อง", "INVALID_DATE_RANGE");
  if (endMs - startMs > MAX_RANGE_MS)
    return error(
      "เลือกค้นหาข้อมูลย้อนหลังได้ครั้งละไม่เกิน 7 วัน",
      "DATE_RANGE_TOO_LARGE",
    );

  let meta;
  try {
    meta = await env.DB.prepare(
      "SELECT ready FROM ms_route_latest_meta WHERE id=1 LIMIT 1",
    ).first();
  } catch (cause) {
    if (pointerUnavailable(cause)) return null;
    console.error(
      JSON.stringify({
        event: "ms_history_pointer_meta_error",
        hub,
        message: cause?.message || String(cause),
      }),
    );
    return error("โหลดข้อมูลย้อนหลังไม่สำเร็จ", "HISTORY_POINTER_UNAVAILABLE", 503);
  }
  if (Number(meta?.ready) !== 1) return null;

  try {
    const data = await queryMsDailyArchivePointer(env, hub, start, end);
    return json({ ok: true, data });
  } catch (cause) {
    console.error(
      JSON.stringify({
        event: "ms_history_pointer_query_error",
        hub,
        start,
        end,
        message: cause?.message || String(cause),
      }),
    );
    return error("โหลดข้อมูลย้อนหลังไม่สำเร็จ", "HISTORY_POINTER_QUERY_FAILED", 503);
  }
}
