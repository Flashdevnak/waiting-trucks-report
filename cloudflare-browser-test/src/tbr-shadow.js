// TBR_INBOUND_QUOTA_V1: only inbound destination/drop routes are observed.
const SHADOW_VERSION = 2;
const SHADOW_PENDING_MS = 12 * 60 * 60 * 1000;
const SHADOW_RETAIN_MS = 3 * 24 * 60 * 60 * 1000;
const SHADOW_TTL_SECONDS = 7 * 24 * 60 * 60;
const SHADOW_HEALTH_WRITE_MS = 5 * 60 * 1000;
const SHADOW_STALE_MS = 7 * 60 * 1000; // TBR_STALE_SPLIT_BROWSER_V2

function normalizeProof(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeShadowAttendance(value) {
  const text = String(value || "").trim();
  if (text.includes("จุดดร")) return "จุดดรอป";
  if (text.includes("ปลายทาง")) return "ปลายทาง";
  if (text.includes("ต้นทาง")) return "ต้นทาง";
  return text;
}

function isInboundShadowRoute(value) {
  const type = normalizeShadowAttendance(value);
  return type === "ปลายทาง" || type === "จุดดรอป";
}

function validTime(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? time : null;
}

function iso(value) {
  const time = validTime(value);
  return time === null ? "" : new Date(time).toISOString();
}

async function shadowId(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(String(value || "")),
  );
  return [...new Uint8Array(digest)]
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 24);
}

function freshState(hub) {
  return {
    version: SHADOW_VERSION,
    hub,
    startedAt: "",
    updatedAt: "",
    healthUpdatedAt: "",
    lastAttemptAt: "",
    lastObservedAt: "",
    sourceAvailable: null,
    feedCount: null,
    rowCount: null,
    lastSkip: "",
    shadowQuota: null,
    records: {},
  };
}

function parseState(raw, hub) {
  try {
    const parsed = JSON.parse(raw || "null");
    if (
      parsed?.version === SHADOW_VERSION &&
      parsed?.hub === hub &&
      parsed?.records &&
      typeof parsed.records === "object"
    )
      return parsed;
  } catch {}
  return freshState(hub);
}

function summary(state) {
  const records = Object.values(state?.records || {});
  const confirmed = records.filter((item) => item.status === "confirmed");
  const leads = confirmed
    .map((item) => Number(item.leadMinutes))
    .filter(Number.isFinite);
  return {
    total: records.length,
    pending: records.filter((item) => item.status === "pending").length,
    confirmed: confirmed.length,
    expired: records.filter((item) => item.status === "expired").length,
    averageLeadMinutes: leads.length
      ? Math.round(leads.reduce((sum, value) => sum + value, 0) / leads.length)
      : null,
    maxLeadMinutes: leads.length ? Math.max(...leads) : null,
  };
}

function observerStatus(state) {
  if (state?.sourceAvailable === true) return "LIVE";
  if (state?.sourceAvailable === false) return "WAITING_SOURCE";
  return "NEVER_OBSERVED";
}

function reportObserverStatus(state, now = Date.now()) {
  const lastAttempt = validTime(state?.lastAttemptAt);
  if (lastAttempt !== null && now - lastAttempt > SHADOW_STALE_MS) return "STALE";
  return observerStatus(state);
}

function staleMinutes(state, now = Date.now()) {
  const lastAttempt = validTime(state?.lastAttemptAt);
  return lastAttempt === null ? null : Math.max(0, Math.floor((now - lastAttempt) / 60000));
}

function cleanHub(value) {
  const hub = String(value || "NE1").trim().toUpperCase();
  return /^[A-Z0-9_-]{2,20}$/.test(hub) ? hub : "NE1";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function displayTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function healthLabel(status) {
  if (status === "LIVE") return "LIVE · รับข้อมูลจาก DEV แล้ว";
  if (status === "STALE") return "STALE · ข้อมูลหยุดอัปเดตเกิน 7 นาที";
  if (status === "WAITING_SOURCE") return "รอ source จาก DEV";
  return "ยังไม่เคยได้รับรอบ Cron";
}

export async function readTbrShadowReport(env, hubValue = "NE1") {
  const hub = cleanHub(hubValue);
  const key = `shadow:tbr:v1:${hub}`;
  const raw = env?.STATE ? await env.STATE.get(key) : null;
  const state = parseState(raw, hub);
  const stats = summary(state);
  const records = Object.entries(state.records || {})
    .map(([id, item]) => ({
      id: id.slice(0, 12),
      status: String(item?.status || ""),
      tbrAt: String(item?.tbrAt || ""),
      kitAt: String(item?.kitAt || ""),
      firstSeenAt: String(item?.firstSeenAt || ""),
      confirmedAt: String(item?.confirmedAt || ""),
      expiredAt: String(item?.expiredAt || ""),
      routeActualArrivalAt: String(item?.routeActualArrivalAt || ""),
      routeSeen: Boolean(item?.routeSeen),
      attendanceType: normalizeShadowAttendance(item?.attendanceType),
      leadMinutes:
        item?.leadMinutes === null || item?.leadMinutes === undefined || item?.leadMinutes === ""
          ? null
          : Number.isFinite(Number(item.leadMinutes))
            ? Number(item.leadMinutes)
            : null,
    }))
    .sort((a, b) => String(b.tbrAt).localeCompare(String(a.tbrAt)));
  return {
    ok: true,
    shadowOnly: true,
    tursoReads: 0,
    tursoWrites: 0,
    hub,
    key,
    observerStatus: reportObserverStatus(state),
    sourceAvailable: state.sourceAvailable ?? null,
    staleMinutes: staleMinutes(state),
    lastAttemptAt: String(state.lastAttemptAt || ""),
    lastObservedAt: String(state.lastObservedAt || ""),
    healthUpdatedAt: String(state.healthUpdatedAt || ""),
    feedCount: Number.isFinite(Number(state.feedCount)) ? Number(state.feedCount) : null,
    rowCount: Number.isFinite(Number(state.rowCount)) ? Number(state.rowCount) : null,
    lastSkip: String(state.lastSkip || ""),
    shadowQuota: state.shadowQuota && typeof state.shadowQuota === "object" ? state.shadowQuota : null,
    startedAt: String(state.startedAt || ""),
    updatedAt: String(state.updatedAt || ""),
    ...stats,
    records,
  };
}

export function tbrShadowPage(report) {
  const rows = (report?.records || [])
    .map((item) => {
      const label =
        item.status === "confirmed"
          ? "ยืนยันแล้ว"
          : item.status === "expired"
            ? "หมดเวลา/ต้องตรวจ"
            : item.routeSeen
              ? "รอเวลามาถึงจริง"
              : "รอ Route";
      return `<tr><td><code>${escapeHtml(item.id)}</code></td><td>${escapeHtml(item.attendanceType || "-")}</td><td>${escapeHtml(label)}</td><td>${escapeHtml(displayTime(item.tbrAt))}</td><td>${escapeHtml(displayTime(item.kitAt))}</td><td>${escapeHtml(displayTime(item.confirmedAt || item.expiredAt))}</td><td>${item.leadMinutes == null ? "-" : `${escapeHtml(item.leadMinutes)} นาที`}</td></tr>`;
    })
    .join("");
  const body = rows || '<tr><td colspan="7" class="empty">ยังไม่มี TBR candidate ปลายทาง/จุดดรอปที่ต้องบันทึกใน Shadow</td></tr>';
  const status = String(report?.observerStatus || "NEVER_OBSERVED");
  const statusClass = status === "LIVE" ? "live" : status === "STALE" ? "stale" : status === "WAITING_SOURCE" ? "wait" : "never";
  return new Response(
    `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="60"><title>TBR Shadow ${escapeHtml(report?.hub || "")}</title><style>body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#f5f7fb;color:#18212f}.wrap{max-width:1180px;margin:28px auto;padding:0 16px}.head{display:flex;justify-content:space-between;gap:16px;align-items:end;flex-wrap:wrap}.sub{color:#667085}.health{margin:14px 0;padding:12px 14px;border-radius:12px;background:#fff;border:1px solid #e5e7eb;line-height:1.65}.health b{display:inline-block;margin-right:8px}.live{color:#067647}.stale{color:#b42318;background:#fff7f6;border-color:#fecdca}.wait{color:#b54708}.never{color:#667085}.cards{display:grid;grid-template-columns:repeat(6,minmax(120px,1fr));gap:10px;margin:18px 0}.card{background:white;border:1px solid #e5e7eb;border-radius:12px;padding:14px}.card b{display:block;font-size:24px;margin-top:6px}.table{overflow:auto;background:white;border:1px solid #e5e7eb;border-radius:12px}table{border-collapse:collapse;width:100%;min-width:780px}th,td{padding:11px 12px;border-bottom:1px solid #eef1f5;text-align:center;font-size:14px}th{background:#f8fafc}.empty{padding:28px;color:#667085}.safe{font-size:13px;color:#067647;background:#ecfdf3;border-radius:999px;padding:7px 10px}.foot{margin-top:12px;color:#667085;font-size:13px}@media(max-width:800px){.cards{grid-template-columns:repeat(2,1fr)}}</style></head><body><div class="wrap"><div class="head"><div><h1>TBR Shadow Test · ${escapeHtml(report?.hub || "")}</h1><div class="sub">ทดลองจับ TBR รถเข้า: ปลายทาง + จุดดรอป · ไม่เอาต้นทาง · ไม่กระทบคิวจริง</div></div><div class="safe">Shadow report Turso 0/0 · Source ${escapeHtml(report?.shadowQuota?.mode || "-")} · point read/cron ${escapeHtml(report?.shadowQuota?.tursoPointReadsPerCron ?? "-")} · write/cron ${escapeHtml(report?.shadowQuota?.tursoWritesPerCron ?? "-")}</div></div><div class="health ${escapeHtml(statusClass)}"><b>Observer: ${escapeHtml(healthLabel(status))}</b> · Cron ทุก 1 นาที · Heartbeat KV ล่าสุด ${escapeHtml(displayTime(report?.lastObservedAt))} · TBR feed ${escapeHtml(report?.feedCount ?? "-")} · Route rows ${escapeHtml(report?.rowCount ?? "-")}${report?.lastSkip ? ` · ${escapeHtml(report.lastSkip)}` : ""}</div><div class="cards"><div class="card">ทั้งหมด<b>${escapeHtml(report?.total ?? 0)}</b></div><div class="card">รอ Route<b>${escapeHtml(report?.pending ?? 0)}</b></div><div class="card">ยืนยันแล้ว<b>${escapeHtml(report?.confirmed ?? 0)}</b></div><div class="card">หมดเวลา<b>${escapeHtml(report?.expired ?? 0)}</b></div><div class="card">เร็วขึ้นเฉลี่ย<b>${report?.averageLeadMinutes == null ? "-" : `${escapeHtml(report.averageLeadMinutes)} นาที`}</b></div><div class="card">เร็วสุด<b>${report?.maxLeadMinutes == null ? "-" : `${escapeHtml(report.maxLeadMinutes)} นาที`}</b></div></div><div class="table"><table><thead><tr><th>Shadow ID</th><th>ประเภทงาน</th><th>สถานะ</th><th>TBR</th><th>KIT</th><th>ยืนยัน/หมดเวลา</th><th>รู้เร็วขึ้น</th></tr></thead><tbody>${body}</tbody></table></div><div class="foot">อัปเดต Shadow KV ล่าสุด: ${escapeHtml(displayTime(report?.updatedAt))} · หน้านี้รีเฟรชทุก 60 วินาที · Heartbeat KV ถูก throttle สูงสุด 5 นาทีเพื่อลด quota · รายการ TBR เปลี่ยนจะบันทึกทันที · ID ถูก hash ไม่แสดงบาร์โค้ดจริง</div></div></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

async function persistHealth(env, key, state, nowIso) {
  state.healthUpdatedAt = nowIso;
  state.updatedAt = nowIso;
  if (!state.startedAt) state.startedAt = nowIso;
  await env.STATE.put(key, JSON.stringify(state), {
    expirationTtl: SHADOW_TTL_SECONDS,
  });
}

export async function observeTbrShadow(env, hubValue, live, nowValue = Date.now()) {
  const hub = String(hubValue || "").trim().toUpperCase();
  if (!hub || !env?.STATE) return { changed: false, skipped: "missing_state" };

  const now = Number(nowValue) || Date.now();
  const nowIso = new Date(now).toISOString();
  const key = `shadow:tbr:v1:${hub}`;
  const state = parseState(await env.STATE.get(key), hub);
  const previousSourceAvailable = state.sourceAvailable;
  const feedAvailable = Array.isArray(live?.tbrShadowFeed);
  const rowsAvailable = Array.isArray(live?.rows);
  const sourceAvailable = feedAvailable && rowsAvailable;
  const feedCount = feedAvailable ? live.tbrShadowFeed.length : null;
  const rowCount = rowsAvailable ? live.rows.length : null;
  const shadowQuota =
    live?.shadowQuota && typeof live.shadowQuota === "object"
      ? live.shadowQuota
      : null;
  const previousHealthAt = validTime(state.healthUpdatedAt);
  const heartbeatDue = previousHealthAt === null || now - previousHealthAt >= SHADOW_HEALTH_WRITE_MS;
  const healthChanged =
    state.sourceAvailable !== sourceAvailable ||
    state.feedCount !== feedCount ||
    state.rowCount !== rowCount ||
    JSON.stringify(state.shadowQuota || null) !== JSON.stringify(shadowQuota || null) ||
    String(state.lastSkip || "") !== (sourceAvailable ? "" : "source_unavailable");

  state.lastAttemptAt = nowIso;
  state.sourceAvailable = sourceAvailable;
  state.feedCount = feedCount;
  state.rowCount = rowCount;
  state.shadowQuota = shadowQuota;
  state.lastSkip = sourceAvailable ? "" : "source_unavailable";

  if (!sourceAvailable) {
    if (healthChanged || heartbeatDue) {
      await persistHealth(env, key, state, nowIso);
      console.log(JSON.stringify({
        event: "tbr_shadow_health",
        hub,
        observerStatus: observerStatus(state),
        sourceAvailable: false,
        feedCount,
        rowCount,
      }));
    }
    return {
      changed: false,
      key,
      observerStatus: observerStatus(state),
      sourceAvailable: false,
      sourceChanged: previousSourceAvailable !== false,
      skipped: "source_unavailable",
      ...summary(state),
    };
  }

  state.lastObservedAt = nowIso;
  const routeByProof = new Map();
  for (const route of live.rows) {
    if (!isInboundShadowRoute(route?.attendanceType)) continue;
    const proof = normalizeProof(route?.proofId);
    if (!proof) continue;
    // TBR_ROUTE_DUPLICATE_ACTUAL_V1: duplicate Route rows can exist for one proofId. Prefer a row
    // with a real actualArrivalAt; if multiple arrived rows exist, keep the earliest.
    const current = routeByProof.get(proof);
    const currentActualMs = validTime(current?.actualArrivalAt);
    const nextActualMs = validTime(route?.actualArrivalAt);
    if (
      !current ||
      (currentActualMs === null && nextActualMs !== null) ||
      (currentActualMs !== null && nextActualMs !== null && nextActualMs < currentActualMs)
    ) {
      routeByProof.set(proof, route);
    }
  }

  let changed = false;
  for (const item of live.tbrShadowFeed) {
    const proof = normalizeProof(item?.proofId);
    const tbrMs = validTime(item?.scheduleTbrArrivalAt);
    if (!proof || tbrMs === null || tbrMs > now + 5 * 60 * 1000) continue;

    const id = await shadowId(proof);
    const route = routeByProof.get(proof);
    // BusTime alone does not carry a trustworthy attendance type. Require a
    // matching inbound Route schedule row so origin trips can never enter Shadow.
    if (!route) continue;
    const attendanceType = normalizeShadowAttendance(route?.attendanceType);
    // TBR_ROUTE_ACTUAL_ARRIVAL_V2: a scheduled Route row is not proof that the truck has arrived.
    // Only actualArrivalAt closes the TBR-before-Route observation.
    const routeActualMs = validTime(route?.actualArrivalAt);
    const routeSeen = Boolean(route);
    let record = state.records[id];

    if (!record) {
      if (routeActualMs !== null || now - tbrMs > SHADOW_PENDING_MS) continue;
      record = {
        status: "pending",
        tbrAt: new Date(tbrMs).toISOString(),
        kitAt: iso(item?.scheduleKitArrivalAt),
        firstSeenAt: nowIso,
        confirmedAt: "",
        routeActualArrivalAt: "",
        routeSeen,
        attendanceType,
        leadMinutes: null,
      };
      state.records[id] = record;
      changed = true;
      continue;
    }

    if (record.status === "pending" && record.routeSeen !== routeSeen) {
      record.routeSeen = routeSeen;
      changed = true;
    }
    if (record.status === "pending" && record.attendanceType !== attendanceType) {
      record.attendanceType = attendanceType;
      changed = true;
    }
    if (record.status !== "pending") continue;
    const nextKit = iso(item?.scheduleKitArrivalAt);
    if (nextKit && nextKit !== record.kitAt) {
      record.kitAt = nextKit;
      changed = true;
    }
    if (routeActualMs !== null) {
      const routeMs = routeActualMs;
      record.status = "confirmed";
      record.confirmedAt = nowIso;
      record.routeActualArrivalAt = new Date(routeActualMs).toISOString();
      record.leadMinutes = Math.round((routeMs - tbrMs) / 60000);
      changed = true;
    }
  }

  for (const [id, record] of Object.entries(state.records)) {
    const tbrMs = validTime(record?.tbrAt);
    if (
      record?.status === "pending" &&
      tbrMs !== null &&
      now - tbrMs > SHADOW_PENDING_MS
    ) {
      record.status = "expired";
      record.expiredAt = nowIso;
      changed = true;
    }
    const terminalAt = validTime(record?.confirmedAt || record?.expiredAt);
    if (terminalAt !== null && now - terminalAt > SHADOW_RETAIN_MS) {
      delete state.records[id];
      changed = true;
    }
  }

  if (changed || healthChanged || heartbeatDue) {
    await persistHealth(env, key, state, nowIso);
    const result = summary(state);
    console.log(JSON.stringify({
      event: changed ? "tbr_shadow_changed" : "tbr_shadow_health",
      hub,
      observerStatus: observerStatus(state),
      sourceAvailable: true,
      feedCount,
      rowCount,
      ...result,
    }));
    return {
      changed,
      key,
      observerStatus: observerStatus(state),
      sourceAvailable: true,
      sourceChanged: previousSourceAvailable !== true,
      ...result,
    };
  }

  return {
    changed: false,
    key,
    observerStatus: observerStatus(state),
    sourceAvailable: true,
    sourceChanged: previousSourceAvailable !== true,
    ...summary(state),
  };
}

export { summary as summarizeTbrShadow };
