import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { patchMsConnectionErrorKvFrontend } from "./patch-ms-connection-error-kv.mjs";

export const SESSION_MARKER = "DEV_ORIGIN_MANIFEST_SESSION_REPLAY_V2";
export const RECOVERY_MARKER = "DEV_ORIGIN_MANIFEST_RECOVERY_V3";
export const COMPACT_MARKER = "DEV_HAR_COMPACT_ACTIONS_V3";
export const INLINE_MARKER = "DEV_HAR_INLINE_ACTIONS_V4";

function replaceUnique(source, from, to, label) {
  const first = source.indexOf(from);
  const last = source.lastIndexOf(from);
  if (first < 0 || first !== last) throw new Error(`Origin Manifest V2 patch failed: ${label}`);
  return source.replace(from, to);
}

export function patchOriginManifestSessionReplay(source) {
  let output = String(source || "");

  if (!output.includes(SESSION_MARKER)) {
    output = replaceUnique(
      output,
      `function credentialValue(value, max = 2000) {\n  return String(value || "").trim().slice(0, max);\n}\n\nfunction sanitizeCredentials(input) {`,
      `function credentialValue(value, max = 2000) {\n  return String(value || "").trim().slice(0, max);\n}\n\nfunction headerCredentialValue(value, max = 2000) {\n  return String(value || "").replace(/[\\r\\n]+/g, " ").trim().slice(0, max);\n}\n\nfunction allowedManifestUrl(value, referer = false) {\n  try {\n    const url = new URL(String(value || "").trim());\n    const host = url.hostname.toLowerCase();\n    const allowed =\n      url.protocol === "https:" &&\n      (host === "flashexpress.com" || host.endsWith(".flashexpress.com") || host === "flashbi.club" || host.endsWith(".flashbi.club"));\n    if (!allowed) return "";\n    return referer ? url.href.slice(0, 600) : url.origin.slice(0, 300);\n  } catch {\n    return "";\n  }\n}\n\nfunction sanitizeCredentials(input) {`,
      "add encrypted HAR header sanitizers",
    );

    output = replaceUnique(
      output,
      `    _from: credentialValue(input?._from, 100),\n    storeFrom: credentialValue(input?.storeFrom, 100),\n  };`,
      `    _from: credentialValue(input?._from, 100),\n    storeFrom: credentialValue(input?.storeFrom, 100),\n    origin: allowedManifestUrl(input?.origin),\n    referer: allowedManifestUrl(input?.referer, true),\n    cookie: headerCredentialValue(input?.cookie, 8192),\n    authorization: headerCredentialValue(input?.authorization, 4096),\n    biPlatform: headerCredentialValue(input?.biPlatform, 200),\n    userAgent: headerCredentialValue(input?.userAgent, 600),\n    xRequestedWith: headerCredentialValue(input?.xRequestedWith, 200),\n    acceptLanguage: headerCredentialValue(input?.acceptLanguage, 100),\n    captureVerified: Boolean(input?.captureVerified),\n  };`,
      "persist exact HAR session headers encrypted at rest",
    );

    output = replaceUnique(
      output,
      `  const response = await fetchImpl(url, {\n    method: "POST",\n    headers: {\n      Accept: "application/json, text/plain, */*",\n      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",\n      Origin: "https://cbi-fbi.flashexpress.com",\n      Referer: "https://cbi-fbi.flashexpress.com/",\n      "User-Agent": "Mozilla/5.0",\n      "BI-PLATFORM": "",\n    },\n    body,\n  });`,
      `  // ${SESSION_MARKER}: replay the exact HBI browser session context captured by the successful HAR request.\n  const requestHeaders = {\n    Accept: "application/json, text/plain, */*",\n    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",\n    Origin: credentials.origin || "https://cbi-fbi.flashexpress.com",\n    Referer: credentials.referer || credentials.origin || "https://cbi-fbi.flashexpress.com/",\n    "User-Agent": credentials.userAgent || "Mozilla/5.0",\n    "BI-PLATFORM": credentials.biPlatform || "",\n  };\n  if (credentials.cookie) requestHeaders.Cookie = credentials.cookie;\n  if (credentials.authorization) requestHeaders.Authorization = credentials.authorization;\n  if (credentials.xRequestedWith) requestHeaders["X-Requested-With"] = credentials.xRequestedWith;\n  if (credentials.acceptLanguage) requestHeaders["Accept-Language"] = credentials.acceptLanguage;\n  const response = await fetchImpl(url, {\n    method: "POST",\n    headers: requestHeaders,\n    body,\n  });`,
      "replay HAR origin referer cookie and auth headers",
    );

    output = replaceUnique(
      output,
      `  function manifestCredentialsFromHar(har, hub) {`,
      `  // ${SESSION_MARKER}: keep only the request context needed to replay the exact successful HBI request; it is encrypted server-side.\n  function manifestRequestHeader(entry, name) {\n    const headers = Array.isArray(entry?.request?.headers) ? entry.request.headers : [];\n    const needle = String(name || '').toLowerCase();\n    return String(headers.find((item) => String(item?.name || '').toLowerCase() === needle)?.value || '').trim();\n  }\n\n  function manifestRequestCookie(entry) {\n    const header = manifestRequestHeader(entry, 'cookie');\n    if (header) return header;\n    const cookies = Array.isArray(entry?.request?.cookies) ? entry.request.cookies : [];\n    return cookies.map((item) => {\n      const name = String(item?.name || '').trim();\n      return name ? name + '=' + String(item?.value || '') : '';\n    }).filter(Boolean).join('; ');\n  }\n\n  function manifestCaptureVerified(entries) {\n    const authPaths = new Set(['/api/common/get_user_info', '/api/user/userInfo', '/api/route/get_lh_store']);\n    return (Array.isArray(entries) ? entries : []).some((entry) => {\n      let path = '';\n      try { path = new URL(entry?.request?.url || '').pathname.replace(/\\/\\/+/g, '/'); } catch {}\n      if (!authPaths.has(path)) return false;\n      const payload = parseResponseJson(entry);\n      return Number(entry?.response?.status || 0) >= 200 && Number(entry?.response?.status || 0) < 400 && Number(payload?.code) === 1;\n    });\n  }\n\n  function manifestCredentialsFromHar(har, hub) {`,
      "add HAR session header parser and capture evidence",
    );

    output = replaceUnique(
      output,
      `      _from: params.get('_from') || '',\n      storeFrom,\n    };`,
      `      _from: params.get('_from') || '',\n      storeFrom,\n      origin: manifestRequestHeader(routeEntry, 'origin'),\n      referer: manifestRequestHeader(routeEntry, 'referer'),\n      cookie: manifestRequestCookie(routeEntry),\n      authorization: manifestRequestHeader(routeEntry, 'authorization'),\n      biPlatform: manifestRequestHeader(routeEntry, 'bi-platform'),\n      userAgent: manifestRequestHeader(routeEntry, 'user-agent'),\n      xRequestedWith: manifestRequestHeader(routeEntry, 'x-requested-with'),\n      acceptLanguage: manifestRequestHeader(routeEntry, 'accept-language'),\n      captureVerified: manifestCaptureVerified(entries),\n    };`,
      "capture HAR session context",
    );
  }

  if (!output.includes(RECOVERY_MARKER)) {
    output = replaceUnique(
      output,
      `export async function readManifestPage(credentials, day, page = 1, fetchImpl = fetch) {`,
      `// ${RECOVERY_MARKER}: distinguish real auth expiry from business/query failures so valid HAR is never mislabeled NEED_LOGIN.\nfunction manifestAuthFailure(message) {\n  return /need[_\\s-]*login|not[_\\s-]*login|unauthori[sz]ed|session.{0,20}(expired|invalid)|token.{0,20}(expired|invalid)|auth.{0,20}(expired|invalid)|กรุณา.{0,12}เข้าสู่ระบบ|เข้าสู่ระบบใหม่/i.test(String(message || ""));\n}\n\nfunction manifestExpiredMessage() {\n  return "LH Manifest Session หมดอายุแล้ว · กลับหน้า MS > การเชื่อมต่อ MS (QR/HAR) แล้วอัปโหลด HAR ใหม่ที่ข้อ 6";\n}\n\nasync function probeManifestSession(credentials, fetchImpl = fetch) {\n  const url = new URL("https://hbi-common.flashexpress.com/api/route/get_lh_store");\n  const body = new URLSearchParams({\n    auth: credentials.auth,\n    lang: credentials.lang || "th",\n    fbid: credentials.fbid,\n    time: credentials.time,\n    webSign: credentials.webSign || "hbi",\n    _from: credentials._from || "",\n    search: "",\n  });\n  const headers = {\n    Accept: "application/json, text/plain, */*",\n    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",\n    Origin: credentials.origin || "https://cbi-fbi.flashexpress.com",\n    Referer: credentials.referer || credentials.origin || "https://cbi-fbi.flashexpress.com/",\n    "User-Agent": credentials.userAgent || "Mozilla/5.0",\n    "BI-PLATFORM": credentials.biPlatform || "",\n  };\n  if (credentials.cookie) headers.Cookie = credentials.cookie;\n  if (credentials.authorization) headers.Authorization = credentials.authorization;\n  if (credentials.xRequestedWith) headers["X-Requested-With"] = credentials.xRequestedWith;\n  if (credentials.acceptLanguage) headers["Accept-Language"] = credentials.acceptLanguage;\n  const response = await fetchImpl(url, { method: "POST", headers, body });\n  if (response.status === 401 || response.status === 403) {\n    if (credentials.captureVerified)\n      fail("HAR ยืนยันว่าล็อกอิน HBI สำเร็จตอน Export แต่ HBI ไม่ยอมให้ Worker ใช้ Session นี้ซ้ำ กรุณา Export HAR ใหม่จากหน้า LH Manifest ที่กำลังแสดงข้อมูล แล้วลองอีกครั้ง", "MANIFEST_REPLAY_REJECTED", 502);\n    fail(manifestExpiredMessage(), "MANIFEST_SESSION_EXPIRED", 502);\n  }\n  if (!response.ok) fail(\`LH Manifest ตรวจ Session ตอบกลับ \${response.status}\`, "MANIFEST_SESSION_PROBE_HTTP_ERROR", 502);\n  const payload = await response.json();\n  if (Number(payload?.code) !== 1) {\n    const message = String(payload?.msg || payload?.message || "ตรวจ Session LH Manifest ไม่สำเร็จ");\n    if (manifestAuthFailure(message)) {\n      if (credentials.captureVerified)\n        fail("HAR ยืนยันว่าล็อกอิน HBI สำเร็จตอน Export แต่ HBI ตอบ NEED_LOGIN เมื่อ Worker ตรวจ Session · ไม่ถือว่าเป็นการล็อกอินผิด กรุณา Export HAR ใหม่จากหน้า LH Manifest ที่กำลังแสดงข้อมูล แล้วลองอีกครั้ง", "MANIFEST_REPLAY_REJECTED", 502);\n      fail(manifestExpiredMessage(), "MANIFEST_SESSION_EXPIRED", 502);\n    }\n    fail(message, "MANIFEST_SESSION_PROBE_ERROR", 502);\n  }\n  return true;\n}\n\nexport async function readManifestPage(credentials, day, page = 1, fetchImpl = fetch) {`,
      "add auth-aware manifest probe",
    );

    output = replaceUnique(
      output,
      `  if (!response.ok) fail(\`LH Manifest ตอบกลับ \${response.status}\`, "MANIFEST_HTTP_ERROR", 502);\n  const payload = await response.json();\n  if (Number(payload?.code) !== 1)\n    fail(payload?.msg || payload?.message || "เซสชัน LH Manifest หมดอายุ", "MANIFEST_SESSION_EXPIRED", 502);\n  if (payload?.data?.error)\n    fail(String(payload.data.error), "MANIFEST_QUERY_ERROR", 502);`,
      `  if (response.status === 401 || response.status === 403) fail(manifestExpiredMessage(), "MANIFEST_SESSION_EXPIRED", 502);\n  if (!response.ok) fail(\`LH Manifest ตอบกลับ \${response.status}\`, "MANIFEST_HTTP_ERROR", 502);\n  const payload = await response.json();\n  if (Number(payload?.code) !== 1) {\n    const upstreamMessage = String(payload?.msg || payload?.message || "LH Manifest ตอบกลับไม่สำเร็จ");\n    if (manifestAuthFailure(upstreamMessage)) fail(manifestExpiredMessage(), "MANIFEST_SESSION_EXPIRED", 502);\n    fail(upstreamMessage, "MANIFEST_UPSTREAM_ERROR", 502);\n  }\n  if (payload?.data?.error) {\n    const queryMessage = String(payload.data.error);\n    if (manifestAuthFailure(queryMessage)) fail(manifestExpiredMessage(), "MANIFEST_SESSION_EXPIRED", 502);\n    fail(queryMessage, "MANIFEST_QUERY_ERROR", 502);\n  }`,
      "classify real auth expiry separately from business errors",
    );

    output = replaceUnique(
      output,
      `        const value = {\n          ...loaded,\n          until: this.now() + this.ttlMs,\n          cacheHit: false,\n          stale: false,\n          error: "",\n        };`,
      `        const value = {\n          ...loaded,\n          until: this.now() + this.ttlMs,\n          cacheHit: false,\n          stale: false,\n          error: "",\n          errorCode: "",\n        };`,
      "keep successful manifest error code empty",
    );

    output = replaceUnique(
      output,
      `              stale: true,\n              error: error?.message || String(error),\n            }`,
      `              stale: true,\n              error: error?.message || String(error),\n              errorCode: error?.code || "",\n            }`,
      "preserve stale manifest error code in memory",
    );

    output = replaceUnique(
      output,
      `              stale: false,\n              error: error?.message || String(error),\n            };`,
      `              stale: false,\n              error: error?.message || String(error),\n              errorCode: error?.code || "",\n            };`,
      "preserve cold manifest error code in memory",
    );

    output = replaceUnique(
      output,
      `      error: results.find((item) => item.error)?.error || "",\n      refreshedAt:`,
      `      error: results.find((item) => item.error)?.error || "",\n      errorCode: results.find((item) => item.errorCode)?.errorCode || "",\n      refreshedAt:`,
      "surface coordinator error code without persistence",
    );

    output = replaceUnique(
      output,
      `    error: live?.error || "",\n    refreshedAt:`,
      `    error: live?.error || "",\n    errorCode: live?.errorCode || "",\n    refreshedAt:`,
      "surface live manifest error code",
    );

    output = replaceUnique(
      output,
      `  const credentials = sanitizeCredentials(inputCredentials);\n  const test = await readManifestPage(credentials, thaiDay(), 1);`,
      `  const credentials = sanitizeCredentials(inputCredentials);\n  // One lightweight probe happens only when the owner uploads/tests a HAR; normal 5-minute shared refresh adds no probe polling.\n  await probeManifestSession(credentials);\n  let test;\n  try {\n    test = await readManifestPage(credentials, thaiDay(), 1);\n  } catch (error) {\n    if (error?.code === "MANIFEST_SESSION_EXPIRED" && credentials.captureVerified)\n      fail("HAR ยืนยันว่า HBI Login สำเร็จ แต่ route_outhouse ปฏิเสธ Session replay จาก Worker · ระบบไม่ตีความเป็น Login ผิดหรือ Session หมดอายุ", "MANIFEST_ROUTE_REPLAY_REJECTED", 502);\n    throw error;\n  }`,
      "probe session once on manual HAR save",
    );

    output = replaceUnique(
      output,
      `  const kgf = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 });\n\n  function manifestBadge(row) {`,
      `  const kgf = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 });\n  const manifestReconnectShown = new Set();\n\n  function manifestNeedsReconnect(code, message) {\n    return String(code || '') === 'MANIFEST_SESSION_EXPIRED' || /Session หมดอายุ|NEED_LOGIN/i.test(String(message || ''));\n  }\n\n  function showManifestReconnect(message) {\n    const hub = String(state?.branch || '').toUpperCase();\n    if (!hub || manifestReconnectShown.has(hub)) return;\n    manifestReconnectShown.add(hub);\n    try { localStorage.removeItem(cacheKey(hub)); } catch {}\n    setTimeout(() => {\n      if (typeof openMsConnection === 'function') openMsConnection();\n      const status = document.querySelector('[data-source-status="originManifest"] span');\n      if (status) {\n        status.className = 'source-error';\n        status.textContent = 'Session หมดอายุ · อัปโหลด HAR ใหม่ที่ข้อ 6';\n      }\n      const errorEl = document.getElementById('ms-connection-error');\n      if (errorEl) {\n        errorEl.textContent = String(message || 'LH Manifest Session หมดอายุแล้ว · อัปโหลด HAR ใหม่ที่ข้อ 6');\n        errorEl.classList.remove('hidden');\n      }\n      const input = document.getElementById('ms-har-origin-manifest');\n      const card = input?.closest('.har-source-card-v2') || input?.closest('label');\n      if (card?.scrollIntoView) card.scrollIntoView({ block: 'center', behavior: 'smooth' });\n    }, 0);\n  }\n\n  function manifestBadge(row) {`,
      "return expired HBI session to MS upload UI",
    );

    output = replaceUnique(
      output,
      `      const result = await apiPost('saveMsOriginManifestConnection', { hub, credentials });\n      errorEl?.classList.add('hidden');`,
      `      const result = await apiPost('saveMsOriginManifestConnection', { hub, credentials });\n      manifestReconnectShown.delete(hub);\n      errorEl?.classList.add('hidden');`,
      "clear reconnect gate after successful HAR save",
    );

    output = replaceUnique(
      output,
      `    } catch (error) {\n      if (errorEl) {\n        errorEl.textContent = error.message;\n        errorEl.classList.remove('hidden');\n      }\n    } finally {`,
      `    } catch (error) {\n      if (manifestNeedsReconnect(error?.code, error?.message)) showManifestReconnect(error?.message);\n      if (errorEl) {\n        errorEl.textContent = error.message;\n        errorEl.classList.remove('hidden');\n      }\n    } finally {`,
      "send manual expired session back to manifest upload card",
    );

    output = replaceUnique(
      output,
      `        const result = await apiGet('msOriginManifestLive', { branch: hub, days: days.join(',') });\n        const rows = Array.isArray(result?.rows) ? result.rows : [];`,
      `        const result = await apiGet('msOriginManifestLive', { branch: hub, days: days.join(',') });\n        if (manifestNeedsReconnect(result?.errorCode, result?.error)) {\n          showManifestReconnect(result?.error);\n          return;\n        }\n        const rows = Array.isArray(result?.rows) ? result.rows : [];`,
      "return background expired session to MS upload UI",
    );

    output = replaceUnique(
      output,
      `      } catch (error) {\n        console.warn(marker, error?.message || error);\n      } finally {`,
      `      } catch (error) {\n        if (manifestNeedsReconnect(error?.code, error?.message)) showManifestReconnect(error?.message);\n        console.warn(marker, error?.message || error);\n      } finally {`,
      "handle thrown manifest expiry in background",
    );
  }

  return output;
}

export function patchCompactHarActions(source) {
  let output = String(source || "");
  if (output.includes(INLINE_MARKER)) return output;

  if (!output.includes(COMPACT_MARKER)) {
    output = replaceUnique(
      output,
      `.har-source-card-v2 .btn{width:100%;min-height:44px;margin-top:auto;white-space:normal}`,
      `.har-source-card-v2{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end}.har-source-card-v2 label{grid-column:1;min-width:0}.har-source-card-v2 .btn{grid-column:2;width:auto;min-width:190px;min-height:36px;padding:7px 14px;margin-top:0;align-self:end;white-space:normal}.har-source-card-v2 small{grid-column:1/-1}/* ${COMPACT_MARKER} */`,
      "place desktop HAR action beside file input",
    );
  }

  output = replaceUnique(
    output,
    `.connector-dialog{width:min(96vw,980px);max-height:calc(100dvh - 24px)}`,
    `.connector-dialog{width:min(92vw,760px);max-height:calc(100dvh - 24px)}/* ${INLINE_MARKER} */`,
    "shrink connector dialog on desktop",
  );

  output = replaceUnique(
    output,
    `.har-source-card-v2 input[type=file]{font-size:12px}.connection-source-status>div{padding:10px 11px}`,
    `.har-source-card-v2{grid-template-columns:1fr}.har-source-card-v2 label,.har-source-card-v2 .btn,.har-source-card-v2 small{grid-column:1}.har-source-card-v2 .btn{width:100%;min-width:0;min-height:38px;align-self:stretch}.har-source-card-v2 input[type=file]{font-size:12px}.connection-source-status>div{padding:10px 11px}`,
    "keep one-column touch layout on phones",
  );
  return output;
}

async function selfTest() {
  const root = new URL("../../", import.meta.url);
  const originSource = await readFile(new URL("worker/src/origin-manifest-v1.js", root), "utf8");
  const msSource = await readFile(new URL("ms.js", root), "utf8");
  const stagedFront = patchMsConnectionErrorKvFrontend(msSource);
  const patchedOrigin = patchOriginManifestSessionReplay(originSource);
  const patchedFront = patchCompactHarActions(stagedFront);

  assert.ok(patchedOrigin.includes(SESSION_MARKER));
  assert.ok(patchedOrigin.includes(RECOVERY_MARKER));
  assert.ok(patchedOrigin.includes("requestHeaders.Cookie = credentials.cookie"));
  assert.ok(patchedOrigin.includes("requestHeaders.Authorization = credentials.authorization"));
  assert.ok(patchedOrigin.includes("captureVerified: manifestCaptureVerified(entries)"));
  assert.ok(patchedOrigin.includes("MANIFEST_REPLAY_REJECTED"));
  assert.ok(patchedOrigin.includes("MANIFEST_ROUTE_REPLAY_REJECTED"));
  assert.ok(patchedOrigin.includes("MANIFEST_UPSTREAM_ERROR"));
  assert.ok(patchedOrigin.includes("probeManifestSession(credentials)"));
  assert.ok(patchedOrigin.includes("errorCode: live?.errorCode || \"\""));
  assert.ok(patchedOrigin.includes("manifestReconnectShown"));
  assert.ok(patchedOrigin.includes("Session หมดอายุ · อัปโหลด HAR ใหม่ที่ข้อ 6"));
  assert.ok(patchedOrigin.includes("MANIFEST_REFRESH_MS = 5 * 60 * 1000"));
  assert.ok(patchedOrigin.includes("dataPersistenceWrites: 0"));
  assert.ok(patchedOrigin.includes("extraMsPolling: 0"));
  assert.equal(patchOriginManifestSessionReplay(patchedOrigin), patchedOrigin);

  assert.ok(patchedFront.includes(COMPACT_MARKER));
  assert.ok(patchedFront.includes(INLINE_MARKER));
  assert.ok(patchedFront.includes("grid-template-columns:minmax(0,1fr) auto"));
  assert.ok(patchedFront.includes("width:min(92vw,760px)"));
  assert.ok(patchedFront.includes("min-width:190px;min-height:36px"));
  assert.ok(patchedFront.includes("grid-template-columns:1fr"));
  assert.ok(patchedFront.includes("min-height:38px;align-self:stretch"));
  assert.ok(!patchedFront.includes(".har-source-card-v2 .btn{width:100%;min-height:44px"));
  assert.equal(patchCompactHarActions(patchedFront), patchedFront);

  console.log("DEV_ORIGIN_MANIFEST_SESSION_REPLAY_V2=PASS");
  console.log("DEV_ORIGIN_MANIFEST_RECOVERY_V3=PASS");
  console.log("DEV_HAR_COMPACT_ACTIONS_V3=PASS");
  console.log("DEV_HAR_INLINE_ACTIONS_V4=PASS");
  console.log("MANIFEST_REFRESH_MS=300000");
  console.log("MANIFEST_EXTRA_MS_POLLING=0");
  console.log("MANIFEST_DATA_PERSISTENCE_WRITES=0");
  console.log("MANIFEST_UPLOAD_ONLY_PROBE=1");
}

async function patchFiles(frontendPath, originPath) {
  const [front, origin] = await Promise.all([
    readFile(frontendPath, "utf8"),
    readFile(originPath, "utf8"),
  ]);
  await Promise.all([
    writeFile(frontendPath, patchCompactHarActions(front), "utf8"),
    writeFile(originPath, patchOriginManifestSessionReplay(origin), "utf8"),
  ]);
  console.log(`Patched DEV connector frontend: ${frontendPath}`);
  console.log(`Patched DEV Origin Manifest session replay: ${originPath}`);
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`));
if (invoked) {
  const [first, second] = process.argv.slice(2);
  if (first === "--self-test") await selfTest();
  else if (first && second) await patchFiles(first, second);
  else throw new Error("Usage: node patch-dev-origin-manifest-session-v2.mjs --self-test | <frontendPath> <originPath>");
}
