const VERSION = 1;
const TTL_SECONDS = 7 * 24 * 60 * 60;
const ALLOWED_ORIGINS = new Set([
  "https://waiting-trucks-report-api-dev.26nak-testdev.workers.dev",
  "https://flashdevnak.github.io",
  "https://waiting-trucks-ms-browser-test.26nak-testdev.workers.dev",
]);

function clean(value, max = 240) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
}

function normalizeHub(value) {
  const hub = clean(value, 20).toUpperCase();
  return /^[A-Z0-9_-]{2,20}$/.test(hub) ? hub : "";
}

function normalizeSource(value) {
  const source = clean(value, 20);
  return ["routes", "preEntry", "busTime"].includes(source) ? source : "unknown";
}

function keyFor(hub) {
  return `connection:error:v1:${hub}`;
}

function corsHeaders(request) {
  const origin = String(request.headers.get("origin") || "");
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    vary: "Origin",
  };
  if (ALLOWED_ORIGINS.has(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-methods"] = "GET,POST,OPTIONS";
    headers["access-control-allow-headers"] = "content-type";
  }
  return headers;
}

function json(request, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(request),
  });
}

function allowedWrite(request) {
  return ALLOWED_ORIGINS.has(String(request.headers.get("origin") || ""));
}

function classify(codeValue, messageValue) {
  const code = clean(codeValue, 40);
  const message = clean(messageValue, 240);
  const text = `${code} ${message}`;
  if (/429|rate.?limit|too many requests/i.test(text))
    return { code: "429", label: "MS จำกัดคำขอชั่วคราว" };
  if (/REQUEST_TIMEOUT|timeout|หมดเวลา/i.test(text))
    return { code: code || "TIMEOUT", label: "การเชื่อมต่อใช้เวลานานเกินไป" };
  if (/MS_SESSION_EXPIRED|session.*หมดอายุ/i.test(text))
    return { code: code || "SESSION", label: "Session MS หมดอายุ" };
  if (/INVALID_HAR|HAR/i.test(text))
    return { code: code || "HAR", label: "ไฟล์ HAR ไม่ผ่านการตรวจสอบ" };
  return { code: code || "ERROR", label: "การเชื่อมต่อมีปัญหา" };
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

function sourceLabel(value) {
  if (value === "routes") return "Route";
  if (value === "preEntry") return "Pre-entry";
  if (value === "busTime") return "TBR / BusTime";
  return value ? String(value) : "-";
}

function durationLabel(startValue, endValue) {
  const start = Date.parse(String(startValue || ""));
  const end = Date.parse(String(endValue || ""));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "-";
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds} วินาที`;
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return remain ? `${minutes} นาที ${remain} วินาที` : `${minutes} นาที`;
}

function wantsHtml(request) {
  return String(request.headers.get("accept") || "").toLowerCase().includes("text/html");
}

function connectionErrorPage(hub, data) {
  const hasError = Boolean(data);
  const active = hasError && !data?.recoveredAt;
  const recovered = hasError && Boolean(data?.recoveredAt);
  const statusClass = active ? "bad" : "good";
  const statusTitle = active
    ? "ERROR · พบปัญหาการเชื่อมต่อ"
    : recovered
      ? "RECOVERED · การเชื่อมต่อกลับมาแล้ว"
      : "LIVE · ยังไม่พบ Error ที่บันทึก";
  const statusDetail = active
    ? `${sourceLabel(data?.source)} · ${data?.label || "การเชื่อมต่อมีปัญหา"}`
    : recovered
      ? `${sourceLabel(data?.source)} · Error ล่าสุดถูกกู้คืนแล้ว`
      : "Browser KV ยังไม่มี connection error สำหรับ HUB นี้";
  const body = hasError
    ? `<tr><td>${escapeHtml(sourceLabel(data?.source))}</td><td><code>${escapeHtml(data?.code || "-")}</code></td><td>${escapeHtml(data?.label || "-")}</td><td class="message">${escapeHtml(data?.message || "-")}</td><td>${escapeHtml(displayTime(data?.occurredAt))}</td><td>${escapeHtml(displayTime(data?.recoveredAt))}</td></tr>`
    : '<tr><td colspan="6" class="empty">ยังไม่มี Connection Error ที่บันทึกใน Browser KV</td></tr>';

  return new Response(
    `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="60"><title>Connection Error ${escapeHtml(hub)}</title><style>body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#f5f7fb;color:#18212f}.wrap{max-width:1180px;margin:28px auto;padding:0 16px}.head{display:flex;justify-content:space-between;gap:16px;align-items:end;flex-wrap:wrap}.sub{color:#667085}.health{margin:14px 0;padding:12px 14px;border-radius:12px;background:#fff;border:1px solid #e5e7eb;line-height:1.65}.health b{display:inline-block;margin-right:8px}.good{color:#067647}.bad{color:#b42318;background:#fff7f6;border-color:#fecdca}.cards{display:grid;grid-template-columns:repeat(6,minmax(120px,1fr));gap:10px;margin:18px 0}.card{background:white;border:1px solid #e5e7eb;border-radius:12px;padding:14px;min-width:0}.card b{display:block;font-size:20px;margin-top:6px;overflow-wrap:anywhere}.table{overflow:auto;background:white;border:1px solid #e5e7eb;border-radius:12px}table{border-collapse:collapse;width:100%;min-width:900px}th,td{padding:11px 12px;border-bottom:1px solid #eef1f5;text-align:center;font-size:14px}th{background:#f8fafc}.message{text-align:left;max-width:360px;overflow-wrap:anywhere}.empty{padding:28px;color:#667085;text-align:center}.safe{font-size:13px;color:#067647;background:#ecfdf3;border-radius:999px;padding:7px 10px}.foot{margin-top:12px;color:#667085;font-size:13px}@media(max-width:800px){.cards{grid-template-columns:repeat(2,1fr)}.wrap{margin-top:18px}}</style></head><body><div class="wrap"><div class="head"><div><h1>Connection Error Test · ${escapeHtml(hub)}</h1><div class="sub">ดู Error ล่าสุดจาก Browser KV · ไม่กระทบคิวจริง</div></div><div class="safe">Turso Read 0 · Write 0 สำหรับหน้ารายงานนี้</div></div><div class="health ${statusClass}"><b>${escapeHtml(statusTitle)}</b> · ${escapeHtml(statusDetail)}${hasError ? ` · เกิดล่าสุด ${escapeHtml(displayTime(data?.occurredAt))}${data?.recoveredAt ? ` · กู้คืน ${escapeHtml(displayTime(data.recoveredAt))}` : ""}` : ""}</div><div class="cards"><div class="card">สถานะ<b>${active ? "มี Error" : recovered ? "กู้คืนแล้ว" : "ปกติ"}</b></div><div class="card">Source<b>${escapeHtml(sourceLabel(data?.source))}</b></div><div class="card">Code<b>${escapeHtml(data?.code || "-")}</b></div><div class="card">เกิดเมื่อ<b>${escapeHtml(displayTime(data?.occurredAt))}</b></div><div class="card">กู้คืนเมื่อ<b>${escapeHtml(displayTime(data?.recoveredAt))}</b></div><div class="card">ใช้เวลากู้คืน<b>${escapeHtml(durationLabel(data?.occurredAt, data?.recoveredAt))}</b></div></div><div class="table"><table><thead><tr><th>Source</th><th>Code</th><th>ประเภท</th><th>ข้อความ</th><th>เกิดเมื่อ</th><th>กู้คืนเมื่อ</th></tr></thead><tbody>${body}</tbody></table></div><div class="foot">ข้อมูลมาจาก Browser KV เท่านั้น · หน้านี้รีเฟรชทุก 60 วินาที · API JSON เดิมยังใช้งานได้เมื่อร้องขอ application/json</div></div></body></html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}

export async function handleConnectionErrorRequest(request, env, url) {
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders(request) });

  const hub = normalizeHub(url.searchParams.get("hub"));
  if (!hub) return json(request, { ok: false, message: "Invalid HUB" }, 400);
  const key = keyFor(hub);

  if (request.method === "GET") {
    const raw = await env.STATE.get(key);
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch {}
    if (wantsHtml(request)) return connectionErrorPage(hub, data);
    return json(request, { ok: true, data });
  }

  if (request.method !== "POST")
    return json(request, { ok: false, message: "Method not allowed" }, 405);
  if (!allowedWrite(request))
    return json(request, { ok: false, message: "Origin not allowed" }, 403);

  const body = await request.json().catch(() => ({}));
  const event = clean(body?.event, 20);
  const source = normalizeSource(body?.source);
  const now = new Date().toISOString();

  if (event === "error") {
    const classified = classify(body?.code, body?.message);
    const record = {
      version: VERSION,
      hub,
      source,
      code: classified.code,
      label: classified.label,
      message: clean(body?.message, 240),
      occurredAt: now,
      recoveredAt: "",
    };
    await env.STATE.put(key, JSON.stringify(record), { expirationTtl: TTL_SECONDS });
    return json(request, { ok: true, data: record });
  }

  if (event === "recovered") {
    const raw = await env.STATE.get(key);
    if (!raw) return json(request, { ok: true, data: null });
    let record = null;
    try { record = JSON.parse(raw); } catch {}
    if (!record || String(record.source || "") !== source)
      return json(request, { ok: true, data: record || null });
    if (!record.recoveredAt) {
      record.recoveredAt = now;
      await env.STATE.put(key, JSON.stringify(record), { expirationTtl: TTL_SECONDS });
    }
    return json(request, { ok: true, data: record });
  }

  return json(request, { ok: false, message: "Unknown event" }, 400);
}
