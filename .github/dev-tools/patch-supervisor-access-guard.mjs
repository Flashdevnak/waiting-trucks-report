import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const SUPERVISOR_ACCESS_MARKER = "SUPERVISOR_ADMIN_GUARD_V1";

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0 || first !== source.lastIndexOf(from))
    throw new Error(`Supervisor access patch failed: ${label}`);
  return source.replace(from, to);
}

export function patchSupervisorAccessGuard(source) {
  let output = String(source || "");
  if (output.includes(SUPERVISOR_ACCESS_MARKER)) return output;

  output = replaceOnce(
    output,
    '      if (!url.pathname.startsWith("/api")) return env.ASSETS.fetch(request);',
    `      // ${SUPERVISOR_ACCESS_MARKER}: DEV-only side-car authorization is checked
      // before the static asset binding. Waiting Trucks routes never depend on it.
      if (url.pathname === "/supervisor.html" || url.pathname.startsWith("/api/supervisor/"))
        return await handleSupervisorAccess(request, url, env);
      if (!url.pathname.startsWith("/api")) return env.ASSETS.fetch(request);`,
    "route before static assets",
  );

  const runtime = `
// ${SUPERVISOR_ACCESS_MARKER}
const SUPERVISOR_COOKIE_NAME = "wtr_supervisor_session_v1";
const SUPERVISOR_SESSION_MS = 30 * 60 * 1000;

function supervisorCookie(request) {
  const raw = String(request.headers.get("Cookie") || "");
  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === SUPERVISOR_COOKIE_NAME)
      return part.slice(index + 1).trim();
  }
  return "";
}

async function createSupervisorSession(actor, env) {
  const expiresAt = Date.now() + SUPERVISOR_SESSION_MS;
  const csrf = randomToken(24);
  const payload = b64(new TextEncoder().encode(JSON.stringify({
    scope: "WAITING_TRUCKS_SUPERVISOR_DEV",
    username: actor.username,
    expiresAt,
    csrf,
    nonce: crypto.randomUUID(),
  })));
  return {
    value: payload + "." + await hmac(payload, env.AUTH_SECRET),
    expiresAt,
    csrf,
  };
}

async function verifySupervisorSession(request, env) {
  const [payload, signature] = supervisorCookie(request).split(".");
  if (!payload || !signature || !await equal(signature, await hmac(payload, env.AUTH_SECRET)))
    fail("Supervisor session required", "SUPERVISOR_AUTH_REQUIRED", 403);
  let session;
  try { session = JSON.parse(new TextDecoder().decode(unb64(payload))); }
  catch { fail("Supervisor session required", "SUPERVISOR_AUTH_REQUIRED", 403); }
  if (
    session?.scope !== "WAITING_TRUCKS_SUPERVISOR_DEV" ||
    !session?.username ||
    !session?.csrf ||
    Date.now() > Number(session?.expiresAt)
  ) fail("Supervisor session expired", "SUPERVISOR_AUTH_REQUIRED", 403);
  let user;
  try { user = await verifiedAuthUser(session.username, env); }
  catch (error) { failAuthRead(error, "verify", session.username); }
  if (!user || user.active !== 1 || user.role !== "admin")
    fail("Admin access required", "ADMIN_REQUIRED", 403);
  return { actor: { username: user.username, role: user.role, branches: branchList(user.branches) }, session };
}

function supervisorJson(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

function supervisorDenied(error) {
  const status = Number(error?.status) === 503 ? 503 : 403;
  const title = status === 503 ? "Supervisor unavailable" : "Admin access required";
  const message = status === 503
    ? "ระบบยืนยันสิทธิ์ขัดข้องชั่วคราว กรุณาลองใหม่"
    : "กรุณาเปิด Supervisor จากหน้า Admin หลังเข้าสู่ระบบ";
  return new Response(
    '<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>' + title + '</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f7fb;color:#172033;font:16px system-ui"><main style="max-width:520px;padding:32px;text-align:center"><strong style="color:#3157d5">WAITING TRUCKS · DEV</strong><h1>' + title + '</h1><p>' + message + '</p><a href="/admin.html" style="display:inline-block;margin-top:12px;padding:11px 16px;border-radius:10px;background:#3157d5;color:#fff;text-decoration:none">ไปหน้า Admin</a></main></body></html>',
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
      },
    },
  );
}

async function handleSupervisorAccess(request, url, env) {
  if (url.pathname === "/api/supervisor/session") {
    if (request.method !== "POST")
      return supervisorJson({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405, { Allow: "POST" });
    if (String(request.headers.get("Origin") || "") !== url.origin)
      return supervisorJson({ ok: false, code: "SUPERVISOR_ORIGIN_REQUIRED" }, 403);
    const body = await request.json().catch(() => ({}));
    const actor = await verify(body?.token, env);
    mustAdmin(actor);
    const session = await createSupervisorSession(actor, env);
    return supervisorJson(
      { ok: true, data: { expiresAt: session.expiresAt, csrf: session.csrf } },
      200,
      { "Set-Cookie": SUPERVISOR_COOKIE_NAME + "=" + session.value + "; Max-Age=" + Math.floor(SUPERVISOR_SESSION_MS / 1000) + "; Path=/; HttpOnly; Secure; SameSite=Strict" },
    );
  }

  if (url.pathname === "/supervisor.html") {
    try {
      await verifySupervisorSession(request, env);
      const asset = await env.ASSETS.fetch(request);
      const headers = new Headers(asset.headers);
      headers.set("Cache-Control", "no-store");
      headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' wss:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("X-Frame-Options", "DENY");
      return new Response(asset.body, { status: asset.status, headers });
    } catch (error) {
      return supervisorDenied(error);
    }
  }

  try {
    const verified = await verifySupervisorSession(request, env);
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      String(request.headers.get("X-Supervisor-CSRF") || "") !== verified.session.csrf
    ) return supervisorJson({ ok: false, code: "SUPERVISOR_CSRF_REQUIRED" }, 403);
  } catch (error) {
    return supervisorJson({ ok: false, code: error?.code || "SUPERVISOR_AUTH_REQUIRED", message: "Admin access required" }, Number(error?.status) === 503 ? 503 : 403);
  }
  return supervisorJson({ ok: false, code: "SUPERVISOR_API_NOT_FOUND" }, 404);
}
`;

  output = replaceOnce(
    output,
    "\nasync function get(url, env) {",
    `${runtime}\nasync function get(url, env) {`,
    "access runtime",
  );
  return output;
}

const invokedPath = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedPath) {
  const target = process.argv[2];
  if (!target) throw new Error("Usage: node patch-supervisor-access-guard.mjs <worker-index.js>");
  await writeFile(target, patchSupervisorAccessGuard(await readFile(target, "utf8")), "utf8");
}
