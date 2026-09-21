// DEV_MS_HISTORY_POINTER_V1
// Optimized read-only msDailyArchive path for the Turso DEV runtime.
// Authorization is delegated to the existing core Worker. The pointer query
// never calls upstream MS and never writes history.

import {
  MS_CANONICAL_BUSINESS_DAY_SQL,
  canonicalMsBusinessDay,
} from "./ms-operational-truth-v1.js";

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

function thaiDateEnd(value) {
  const start = thaiDateStart(value);
  return Number.isFinite(start) ? start + 86400000 - 1 : NaN;
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

export async function queryMsDailyArchivePointer(env, hub, start, end, asOf) {
  const historyCutoff = new Date(
    Number.isFinite(Date.parse(String(asOf || "")))
      ? Date.parse(String(asOf))
      : thaiDateEnd(end),
  ).toISOString();
  const [historyResult, cancellationResult] = await Promise.all([
    env.DB.prepare(
      `WITH latest AS (
        SELECT h.route_id,h.payload_json,h.snapshot_at,h.synced_by,h.event_type
        FROM ms_route_registry r
        JOIN ms_route_history h
          ON h.rowid = (
            SELECT h2.rowid
            FROM ms_route_history h2 INDEXED BY idx_ms_route_history_hub_route_snapshot
            WHERE h2.hub=r.hub AND h2.route_id=r.route_id
              AND h2.snapshot_at<=?
            ORDER BY h2.snapshot_at DESC,h2.rowid DESC
            LIMIT 1
          )
        WHERE r.hub=? AND h.hub=? AND json_valid(h.payload_json)=1
      ), daily AS (
        SELECT route_id,payload_json,snapshot_at,synced_by,event_type,
          ${MS_CANONICAL_BUSINESS_DAY_SQL} AS business_day
        FROM latest
      )
      SELECT route_id,payload_json,snapshot_at,synced_by,event_type,business_day
      FROM daily
      WHERE business_day>=? AND business_day<=?
      ORDER BY business_day DESC,snapshot_at DESC,route_id DESC
      LIMIT 5000`,
    )
      .bind(historyCutoff, hub, hub, start, end)
      .all(),
    env.DB.prepare(
      "SELECT route_id,cancelled_at,cancelled_by,reason FROM ms_route_cancellations WHERE hub=? AND active=1 AND cancelled_at<=?",
    )
      .bind(hub, historyCutoff)
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
      const businessTruth = canonicalMsBusinessDay(row);
      row.businessDay = businessTruth.businessDay;
      row.businessDayAuthority = businessTruth.authority;
      row.businessDayValueTimestamp = businessTruth.valueTimestamp;
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
    historyMode: "POINT_IN_TIME",
    asOf: historyCutoff,
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
  const requestedAsOf = String(url.searchParams.get("asOf") || "");
  if (requestedAsOf && !Number.isFinite(Date.parse(requestedAsOf)))
    return error("ขอบเขตเวลาประวัติไม่ถูกต้อง", "INVALID_HISTORY_AS_OF");
  const historyCutoff = requestedAsOf || new Date(thaiDateEnd(end)).toISOString();

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
    const data = await queryMsDailyArchivePointer(
      env,
      hub,
      start,
      end,
      historyCutoff,
    );
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
