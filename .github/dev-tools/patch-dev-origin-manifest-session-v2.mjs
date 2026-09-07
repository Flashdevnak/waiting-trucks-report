import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { patchMsConnectionErrorKvFrontend } from "./patch-ms-connection-error-kv.mjs";

export const SESSION_MARKER = "DEV_ORIGIN_MANIFEST_SESSION_REPLAY_V2";
export const COMPACT_MARKER = "DEV_HAR_COMPACT_ACTIONS_V3";

function replaceUnique(source, from, to, label) {
  const first = source.indexOf(from);
  const last = source.lastIndexOf(from);
  if (first < 0 || first !== last) throw new Error(`Origin Manifest V2 patch failed: ${label}`);
  return source.replace(from, to);
}

export function patchOriginManifestSessionReplay(source) {
  let output = String(source || "");
  if (output.includes(SESSION_MARKER)) return output;

  output = replaceUnique(
    output,
    `function credentialValue(value, max = 2000) {\n  return String(value || "").trim().slice(0, max);\n}\n\nfunction sanitizeCredentials(input) {`,
    `function credentialValue(value, max = 2000) {\n  return String(value || "").trim().slice(0, max);\n}\n\nfunction headerCredentialValue(value, max = 2000) {\n  return String(value || "").replace(/[\\r\\n]+/g, " ").trim().slice(0, max);\n}\n\nfunction allowedManifestUrl(value, referer = false) {\n  try {\n    const url = new URL(String(value || "").trim());\n    const host = url.hostname.toLowerCase();\n    const allowed =\n      url.protocol === "https:" &&\n      (host === "flashexpress.com" || host.endsWith(".flashexpress.com") || host === "flashbi.club" || host.endsWith(".flashbi.club"));\n    if (!allowed) return "";\n    return referer ? url.href.slice(0, 600) : url.origin.slice(0, 300);\n  } catch {\n    return "";\n  }\n}\n\nfunction sanitizeCredentials(input) {`,
    "add encrypted HAR header sanitizers",
  );

  output = replaceUnique(
    output,
    `    _from: credentialValue(input?._from, 100),\n    storeFrom: credentialValue(input?.storeFrom, 100),\n  };`,
    `    _from: credentialValue(input?._from, 100),\n    storeFrom: credentialValue(input?.storeFrom, 100),\n    origin: allowedManifestUrl(input?.origin),\n    referer: allowedManifestUrl(input?.referer, true),\n    cookie: headerCredentialValue(input?.cookie, 8192),\n    authorization: headerCredentialValue(input?.authorization, 4096),\n    biPlatform: headerCredentialValue(input?.biPlatform, 200),\n    userAgent: headerCredentialValue(input?.userAgent, 600),\n    xRequestedWith: headerCredentialValue(input?.xRequestedWith, 200),\n  };`,
    "persist exact HAR session headers encrypted at rest",
  );

  output = replaceUnique(
    output,
    `  const response = await fetchImpl(url, {\n    method: "POST",\n    headers: {\n      Accept: "application/json, text/plain, */*",\n      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",\n      Origin: "https://cbi-fbi.flashexpress.com",\n      Referer: "https://cbi-fbi.flashexpress.com/",\n      "User-Agent": "Mozilla/5.0",\n      "BI-PLATFORM": "",\n    },\n    body,\n  });`,
    `  // ${SESSION_MARKER}: replay the exact HBI browser session context captured by the successful HAR request.\n  const requestHeaders = {\n    Accept: "application/json, text/plain, */*",\n    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",\n    Origin: credentials.origin || "https://cbi-fbi.flashexpress.com",\n    Referer: credentials.referer || credentials.origin || "https://cbi-fbi.flashexpress.com/",\n    "User-Agent": credentials.userAgent || "Mozilla/5.0",\n    "BI-PLATFORM": credentials.biPlatform || "",\n  };\n  if (credentials.cookie) requestHeaders.Cookie = credentials.cookie;\n  if (credentials.authorization) requestHeaders.Authorization = credentials.authorization;\n  if (credentials.xRequestedWith) requestHeaders["X-Requested-With"] = credentials.xRequestedWith;\n  const response = await fetchImpl(url, {\n    method: "POST",\n    headers: requestHeaders,\n    body,\n  });`,
    "replay HAR origin referer cookie and auth headers",
  );

  output = replaceUnique(
    output,
    `  if (Number(payload?.code) !== 1)\n    fail(payload?.msg || payload?.message || "เซสชัน LH Manifest หมดอายุ", "MANIFEST_SESSION_EXPIRED", 502);`,
    `  if (Number(payload?.code) !== 1) {\n    const upstreamMessage = String(payload?.msg || payload?.message || "เซสชัน LH Manifest หมดอายุ");\n    if (/need[_\\s-]*login/i.test(upstreamMessage))\n      fail("LH Manifest ตอบ NEED_LOGIN: Session ใน HAR ใช้งานซ้ำไม่ได้หรือหมดอายุ กรุณา Export HAR หลังหน้า LH Manifest แสดงข้อมูลสำเร็จ แล้วอัปโหลดใหม่", "MANIFEST_SESSION_EXPIRED", 502);\n    fail(upstreamMessage, "MANIFEST_SESSION_EXPIRED", 502);\n  }`,
    "explain NEED_LOGIN accurately",
  );

  output = replaceUnique(
    output,
    `  function manifestCredentialsFromHar(har, hub) {`,
    `  // ${SESSION_MARKER}: keep only the request context needed to replay the exact successful HBI request; it is encrypted server-side.\n  function manifestRequestHeader(entry, name) {\n    const headers = Array.isArray(entry?.request?.headers) ? entry.request.headers : [];\n    const needle = String(name || '').toLowerCase();\n    return String(headers.find((item) => String(item?.name || '').toLowerCase() === needle)?.value || '').trim();\n  }\n\n  function manifestRequestCookie(entry) {\n    const header = manifestRequestHeader(entry, 'cookie');\n    if (header) return header;\n    const cookies = Array.isArray(entry?.request?.cookies) ? entry.request.cookies : [];\n    return cookies.map((item) => {\n      const name = String(item?.name || '').trim();\n      return name ? name + '=' + String(item?.value || '') : '';\n    }).filter(Boolean).join('; ');\n  }\n\n  function manifestCredentialsFromHar(har, hub) {`,
    "add HAR session header parser",
  );

  output = replaceUnique(
    output,
    `      _from: params.get('_from') || '',\n      storeFrom,\n    };`,
    `      _from: params.get('_from') || '',\n      storeFrom,\n      origin: manifestRequestHeader(routeEntry, 'origin'),\n      referer: manifestRequestHeader(routeEntry, 'referer'),\n      cookie: manifestRequestCookie(routeEntry),\n      authorization: manifestRequestHeader(routeEntry, 'authorization'),\n      biPlatform: manifestRequestHeader(routeEntry, 'bi-platform'),\n      userAgent: manifestRequestHeader(routeEntry, 'user-agent'),\n      xRequestedWith: manifestRequestHeader(routeEntry, 'x-requested-with'),\n    };`,
    "capture HAR session context",
  );

  return output;
}

export function patchCompactHarActions(source) {
  let output = String(source || "");
  if (output.includes(COMPACT_MARKER)) return output;
  output = replaceUnique(
    output,
    `.har-source-card-v2 .btn{width:100%;min-height:44px;margin-top:auto;white-space:normal}`,
    `.har-source-card-v2 .btn{width:auto;min-width:190px;min-height:36px;padding:7px 14px;margin-top:auto;align-self:flex-end;white-space:normal}/* ${COMPACT_MARKER} */`,
    "compact desktop HAR action buttons",
  );
  output = replaceUnique(
    output,
    `.har-source-card-v2 input[type=file]{font-size:12px}.connection-source-status>div{padding:10px 11px}`,
    `.har-source-card-v2 input[type=file]{font-size:12px}.har-source-card-v2 .btn{width:100%;min-width:0;min-height:38px;align-self:stretch}.connection-source-status>div{padding:10px 11px}`,
    "keep compact HAR actions touch-safe on small screens",
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
  assert.ok(patchedOrigin.includes("requestHeaders.Cookie = credentials.cookie"));
  assert.ok(patchedOrigin.includes("requestHeaders.Authorization = credentials.authorization"));
  assert.ok(patchedOrigin.includes("origin: manifestRequestHeader(routeEntry, 'origin')"));
  assert.ok(patchedOrigin.includes("cookie: manifestRequestCookie(routeEntry)"));
  assert.ok(patchedOrigin.includes("MANIFEST_REFRESH_MS = 5 * 60 * 1000"));
  assert.ok(patchedOrigin.includes("dataPersistenceWrites: 0"));
  assert.ok(patchedOrigin.includes("extraMsPolling: 0"));
  assert.equal(patchOriginManifestSessionReplay(patchedOrigin), patchedOrigin);

  assert.ok(patchedFront.includes(COMPACT_MARKER));
  assert.ok(patchedFront.includes("min-width:190px;min-height:36px"));
  assert.ok(patchedFront.includes("min-height:38px;align-self:stretch"));
  assert.ok(!patchedFront.includes(".har-source-card-v2 .btn{width:100%;min-height:44px"));
  assert.equal(patchCompactHarActions(patchedFront), patchedFront);

  console.log("DEV_ORIGIN_MANIFEST_SESSION_REPLAY_V2=PASS");
  console.log("DEV_HAR_COMPACT_ACTIONS_V3=PASS");
  console.log("MANIFEST_REFRESH_MS=300000");
  console.log("MANIFEST_EXTRA_MS_POLLING=0");
  console.log("MANIFEST_DATA_PERSISTENCE_WRITES=0");
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
