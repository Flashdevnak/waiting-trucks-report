import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { patchMsConnectionErrorKvFrontend } from "./patch-ms-connection-error-kv.mjs";
import {
  SESSION_MARKER,
  RECOVERY_MARKER,
  COMPACT_MARKER,
  INLINE_MARKER,
  patchOriginManifestSessionReplay as patchOriginManifestSessionReplayBase,
  patchCompactHarActions,
} from "./patch-dev-origin-manifest-session-v4-base.mjs";

export { SESSION_MARKER, RECOVERY_MARKER, COMPACT_MARKER, INLINE_MARKER, patchCompactHarActions };
export const FRESH_TIME_MARKER = "DEV_ORIGIN_MANIFEST_FRESH_TIME_V4";
export const WUJIE_AUTH_MARKER = "DEV_ORIGIN_MANIFEST_WUJIE_AUTH_V5";

function replaceUnique(source, from, to, label) {
  const first = source.indexOf(from);
  const last = source.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`Origin Manifest session patch failed: ${label}`);
  return source.replace(from, to);
}

export function patchOriginManifestSessionReplay(source) {
  let output = patchOriginManifestSessionReplayBase(source);

  if (!output.includes(FRESH_TIME_MARKER)) {
    output = replaceUnique(
      output,
      `async function probeManifestSession(credentials, fetchImpl = fetch) {\n  const url = new URL("https://hbi-common.flashexpress.com/api/route/get_lh_store");\n  const body = new URLSearchParams({\n    auth: credentials.auth,\n    lang: credentials.lang || "th",\n    fbid: credentials.fbid,\n    time: credentials.time,`,
      `async function probeManifestSession(credentials, fetchImpl = fetch) {\n  const url = new URL("https://hbi-common.flashexpress.com/api/route/get_lh_store");\n  // ${FRESH_TIME_MARKER}: HBI V3 generates a fresh millisecond time when opening the legacy CBI view. Reusing the HAR capture time causes false NEED_LOGIN.\n  const body = new URLSearchParams({\n    auth: credentials.auth,\n    lang: credentials.lang || "th",\n    fbid: credentials.fbid,\n    time: String(Date.now()),`,
      "refresh HBI probe time instead of replaying captured time",
    );

    output = replaceUnique(
      output,
      `  })) url.searchParams.set(key, value);\n\n  const body = new URLSearchParams({\n    auth: credentials.auth,\n    lang: credentials.lang || "th",\n    fbid: credentials.fbid,\n    time: credentials.time,`,
      `  })) url.searchParams.set(key, value);\n\n  // ${FRESH_TIME_MARKER}: keep the HAR auth token but refresh only the HBI request time on every shared 5-minute source read.\n  const body = new URLSearchParams({\n    auth: credentials.auth,\n    lang: credentials.lang || "th",\n    fbid: credentials.fbid,\n    time: String(Date.now()),`,
      "refresh route_outhouse time instead of replaying captured time",
    );
  }

  if (!output.includes(WUJIE_AUTH_MARKER)) {
    output = replaceUnique(
      output,
      `      authorization: manifestRequestHeader(routeEntry, 'authorization'),`,
      `      // ${WUJIE_AUTH_MARKER}: Chrome HAR commonly redacts Authorization even though the HBI Wujie CBI client sends authorization=<iframe auth>. The same auth value is already present in the successful form body, so preserve it encrypted as the replay Authorization fallback.\n      authorization: manifestRequestHeader(routeEntry, 'authorization') || params.get('auth') || '',`,
      "restore redacted Wujie Authorization from the successful HAR auth parameter",
    );
  }

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
  assert.ok(patchedOrigin.includes(FRESH_TIME_MARKER));
  assert.ok(patchedOrigin.includes(WUJIE_AUTH_MARKER));
  assert.ok(patchedOrigin.includes("MANIFEST_REPLAY_REJECTED"));
  assert.ok(patchedOrigin.includes("MANIFEST_ROUTE_REPLAY_REJECTED"));
  assert.ok(patchedOrigin.includes("probeManifestSession(credentials)"));
  assert.ok(patchedOrigin.includes("MANIFEST_REFRESH_MS = 5 * 60 * 1000"));
  assert.ok(patchedOrigin.includes("dataPersistenceWrites: 0"));
  assert.ok(patchedOrigin.includes("extraMsPolling: 0"));
  assert.ok(patchedOrigin.includes("authorization: manifestRequestHeader(routeEntry, 'authorization') || params.get('auth') || ''"));
  assert.ok(patchedOrigin.includes("requestHeaders.Authorization = credentials.authorization"));
  assert.equal((patchedOrigin.match(/time: String\(Date\.now\(\)\),/g) || []).length, 2);
  const photoFallbackStart = patchedOrigin.indexOf("export async function originManifestHbiCredentials");
  const photoFallbackEnd = patchedOrigin.indexOf("export async function readManifestPage", photoFallbackStart);
  const photoFallback = patchedOrigin.slice(photoFallbackStart, photoFallbackEnd);
  assert.match(photoFallback, /time: credentialValue\(credentials\.time, 100\)/);
  assert.ok(patchedOrigin.includes("HBI_PHOTO_MANIFEST_FALLBACK_V2"));
  assert.ok(!patchedOrigin.includes("time: credentials.time,"));
  assert.equal(patchOriginManifestSessionReplay(patchedOrigin), patchedOrigin);

  assert.ok(patchedFront.includes(COMPACT_MARKER));
  assert.ok(patchedFront.includes(INLINE_MARKER));
  assert.equal(patchCompactHarActions(patchedFront), patchedFront);

  console.log("DEV_ORIGIN_MANIFEST_SESSION_REPLAY_V2=PASS");
  console.log("DEV_ORIGIN_MANIFEST_RECOVERY_V3=PASS");
  console.log("DEV_ORIGIN_MANIFEST_FRESH_TIME_V4=PASS");
  console.log("DEV_ORIGIN_MANIFEST_WUJIE_AUTH_V5=PASS");
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
  console.log(`Patched DEV Origin Manifest Wujie auth + fresh-time replay: ${originPath}`);
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`));
if (invoked) {
  const [first, second] = process.argv.slice(2);
  if (first === "--self-test") await selfTest();
  else if (first && second) await patchFiles(first, second);
  else throw new Error("Usage: node patch-dev-origin-manifest-session-v2.mjs --self-test | <frontendPath> <originPath>");
}
