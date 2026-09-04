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
