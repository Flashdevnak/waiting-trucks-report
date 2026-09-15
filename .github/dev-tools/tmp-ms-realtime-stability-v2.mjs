import fs from "node:fs";

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  const last = source.lastIndexOf(from);
  if (first < 0 || first !== last) throw new Error(`patch failed: ${label}`);
  return source.replace(from, to);
}

const root = process.cwd();
const msPath = `${root}/ms.js`;
let ms = fs.readFileSync(msPath, "utf8");
if (!ms.includes("MS_TRANSIENT_EMPTY_CONFIRM_V1")) {
  ms = replaceOnce(
    ms,
    'let fastSnapshotRestoreInProgress = false;\n',
    `let fastSnapshotRestoreInProgress = false;\n// MS_TRANSIENT_EMPTY_CONFIRM_V1: never let one transient empty source/cache response\n// erase a non-empty accepted screen. Confirmation rides the existing realtime cadence;\n// it adds zero timer, zero upstream request and zero DB write.\nlet transientEmptyCandidateKey = "";\nlet transientEmptyHoldActive = false;\n`,
    "transient empty state",
  );

  ms = replaceOnce(
    ms,
    'function saveFastRefreshSnapshot(savedAt = Date.now()) {\n',
    `function resetTransientEmptyGuard() {\n  transientEmptyCandidateKey = "";\n  transientEmptyHoldActive = false;\n}\n\nfunction transientEmptyObservationKey(result) {\n  const branch = String(result?.branch || state.branch || "").trim().toUpperCase();\n  const sync = String(result?.lastSync || result?.syncedAt || "").trim();\n  return sync ? \`${'${branch}'}|${'${sync}'}\` : "";\n}\n\nfunction holdTransientEmptyResult(result) {\n  const rows = Array.isArray(result?.rows) ? result.rows : null;\n  if (!rows) return false;\n  if (rows.length > 0) {\n    resetTransientEmptyGuard();\n    return false;\n  }\n  if (!Array.isArray(state.currentRows) || state.currentRows.length === 0) {\n    resetTransientEmptyGuard();\n    return false;\n  }\n  const incomingBranch = String(result?.branch || state.branch || "").trim().toUpperCase();\n  const currentBranch = String(state.branch || "").trim().toUpperCase();\n  if (incomingBranch && currentBranch && incomingBranch !== currentBranch) {\n    resetTransientEmptyGuard();\n    return false;\n  }\n  const key = transientEmptyObservationKey(result);\n  if (!key || key === transientEmptyCandidateKey) {\n    transientEmptyHoldActive = true;\n    if (key) transientEmptyCandidateKey = key;\n    return true;\n  }\n  if (!transientEmptyCandidateKey) {\n    transientEmptyCandidateKey = key;\n    transientEmptyHoldActive = true;\n    return true;\n  }\n  resetTransientEmptyGuard();\n  return false;\n}\n\nfunction applyAcceptedLiveResult(result, fromStream = false) {\n  if (holdTransientEmptyResult(result)) {\n    state.transportLastOkAt = Date.now();\n    state.transportFailures = 0;\n    render();\n    const badge = el("connection-badge");\n    if (badge) {\n      badge.textContent = "กำลังยืนยันข้อมูลสด";\n      badge.className = "badge badge-neutral";\n    }\n    if (el("last-refresh"))\n      el("last-refresh").textContent =\n        "ได้รับข้อมูลว่างชั่วคราว · คงข้อมูลล่าสุดไว้ · กำลังยืนยันข้อมูลสด";\n    return false;\n  }\n  applyLiveResult(result, fromStream);\n  return true;\n}\n\nfunction saveFastRefreshSnapshot(savedAt = Date.now()) {\n`,
    "transient empty helper",
  );

  ms = replaceOnce(
    ms,
    '  if (!state.auth || !Array.isArray(state.currentRows)) return;\n',
    '  if (!state.auth || !Array.isArray(state.currentRows) || transientEmptyHoldActive) return;\n',
    "skip provisional snapshot save",
  );

  ms = replaceOnce(
    ms,
    '    applyLiveResult(snapshot, true);\n',
    '    applyAcceptedLiveResult(snapshot, true);\n',
    "fast snapshot apply guard",
  );

  ms = replaceOnce(
    ms,
    `  if (payload.type === "snapshot") {\n    applyLiveResult(payload, true);\n    saveFastRefreshSnapshot();\n    return;\n  }`,
    `  if (payload.type === "snapshot") {\n    if (applyAcceptedLiveResult(payload, true)) saveFastRefreshSnapshot();\n    return;\n  }`,
    "websocket snapshot guard",
  );

  ms = replaceOnce(
    ms,
    `    if (snapshot?.snapshotFound && Array.isArray(snapshot.rows)) {\n      applyFastRefreshSnapshot(\n        { ...snapshot, savedAt: Date.parse(String(snapshot.lastSync || "")) || Date.now() },\n        "แคชล่าสุด",\n      );\n      saveFastRefreshSnapshot();\n      restartRealtimeTransport();\n      return true;\n    }`,
    `    if (snapshot?.snapshotFound && Array.isArray(snapshot.rows)) {\n      if (snapshot.rows.length > 0) {\n        applyFastRefreshSnapshot(\n          { ...snapshot, savedAt: Date.parse(String(snapshot.lastSync || "")) || Date.now() },\n          "แคชล่าสุด",\n        );\n        saveFastRefreshSnapshot();\n      } else {\n        const badge = el("connection-badge");\n        if (badge) {\n          badge.textContent = "กำลังยืนยันข้อมูลสด";\n          badge.className = "badge badge-neutral";\n        }\n        if (el("last-refresh"))\n          el("last-refresh").textContent =\n            "แคชล่าสุดว่าง · กำลังยืนยันกับข้อมูลสดก่อนแสดง 0";\n      }\n      restartRealtimeTransport();\n      return true;\n    }`,
    "cold empty cache truth-safe paint",
  );

  ms = replaceOnce(
    ms,
    `    applyLiveResult(result, false);\n    saveFastRefreshSnapshot();`,
    `    if (applyAcceptedLiveResult(result, false)) saveFastRefreshSnapshot();`,
    "http fallback guard",
  );

  fs.writeFileSync(msPath, ms);
}

const reportPath = `${root}/ms-report.js`;
let report = fs.readFileSync(reportPath, "utf8");
report = report.replace(
  'https://waiting-trucks-report.alert-squid-6738.chatgpt.site',
  'https://waiting-trucks-report-api-dev.26nak-testdev.workers.dev',
);
fs.writeFileSync(reportPath, report);

const workerPatcherPath = `${root}/.github/dev-tools/patch-ms-transient-empty-guard.mjs`;
fs.writeFileSync(workerPatcherPath, `const MARKER = "MS_TRANSIENT_EMPTY_SOURCE_GUARD_V1";\n\nexport function patchMsTransientEmptyGuardWorker(source) {\n  let output = String(source || "");\n  if (output.includes(MARKER)) return output;\n  const runMarker = "async function runMsRefresh(env, branch) {";\n  if (!output.includes(runMarker)) throw new Error("transient-empty worker guard: runMsRefresh missing");\n  const helpers = \`// \\${MARKER}: a single successful-but-empty MS response must not erase a non-empty accepted cache.\\n// Confirmation uses the next existing source cycle. No extra upstream call or healthy-state DB read/write.\\nconst msTransientEmptySource = new Map();\\nconst MS_TRANSIENT_EMPTY_CONFIRM_WINDOW_MS = 2 * 60 * 1000;\\nasync function holdTransientEmptyMsSource(env, branch, mappedRows) {\\n  if (Array.isArray(mappedRows) && mappedRows.length > 0) {\\n    msTransientEmptySource.delete(branch);\\n    return null;\\n  }\\n  let row;\\n  try {\\n    row = await env.DB.prepare(\\"SELECT rows_json,synced_at FROM ms_live_cache WHERE hub=?\\").bind(branch).first();\\n  } catch {\\n    return null;\\n  }\\n  let acceptedRows = [];\\n  try { acceptedRows = JSON.parse(row?.rows_json || \\"[]\\"); } catch {}\\n  if (!Array.isArray(acceptedRows) || acceptedRows.length === 0) {\\n    msTransientEmptySource.delete(branch);\\n    return null;\\n  }\\n  const now = Date.now();\\n  const previous = msTransientEmptySource.get(branch);\\n  if (previous && now - previous.at <= MS_TRANSIENT_EMPTY_CONFIRM_WINDOW_MS) {\\n    msTransientEmptySource.delete(branch);\\n    return null;\\n  }\\n  msTransientEmptySource.set(branch, { at: now });\\n  return { rows: acceptedRows, syncedAt: String(row?.synced_at || \\"\\") };\\n}\\n\\n\`;
  output = output.replace(runMarker, helpers + runMarker);\n  const start = output.indexOf(runMarker);\n  const end = output.indexOf("\\nasync function readMsLiveCache", start);\n  if (start < 0 || end < 0) throw new Error("transient-empty worker guard: runMsRefresh section missing");\n  let section = output.slice(start, end);\n  const anchor = "    const sourceHash = await sha(canonicalMsSource(mappedRows));";\n  if (!section.includes(anchor)) throw new Error("transient-empty worker guard: sourceHash anchor missing");\n  section = section.replace(anchor, \`    const transientEmptyHold = await holdTransientEmptyMsSource(env, branch, mappedRows);\\n    if (transientEmptyHold) {\\n      const result = {\\n        status: \\"degraded\\",\\n        syncedAt: transientEmptyHold.syncedAt || \\"\\",\\n        changes: 0,\\n        rows: transientEmptyHold.rows,\\n        transientEmptyHeld: true,\\n        error: \\"MS ส่งข้อมูลว่างชั่วคราว ระบบคงข้อมูลล่าสุดและรอยืนยันรอบถัดไป\\",\\n      };\\n      recentMsSync.set(branch, { until: Date.now() + MS_SYNC_TTL, result });\\n      return result;\\n    }\\n    \\${anchor}\`);\n  output = output.slice(0, start) + section + output.slice(end);\n  return output;\n}\n`);

const stagePath = `${root}/.github/dev-tools/stage-dev-runtime.mjs`;
let stage = fs.readFileSync(stagePath, "utf8");
if (!stage.includes('patch-ms-transient-empty-guard.mjs')) {
  stage = replaceOnce(
    stage,
    'import { patchMsTbrShadowFeedWorker } from "./patch-ms-tbr-shadow-feed.mjs";\n',
    'import { patchMsTbrShadowFeedWorker } from "./patch-ms-tbr-shadow-feed.mjs";\nimport { patchMsTransientEmptyGuardWorker } from "./patch-ms-transient-empty-guard.mjs";\n',
    "stage worker guard import",
  );
  stage = replaceOnce(
    stage,
    '  output = patchMsTbrShadowFeedWorker(output);\n',
    '  output = patchMsTbrShadowFeedWorker(output);\n  output = patchMsTransientEmptyGuardWorker(output);\n',
    "stage worker guard apply",
  );
}
fs.writeFileSync(stagePath, stage);

const testPath = `${root}/worker/tests/ms-transient-empty-guard.test.mjs`;
fs.writeFileSync(testPath, `import assert from "node:assert/strict";\nimport fs from "node:fs";\nimport test from "node:test";\nimport { stageWorker } from "../../.github/dev-tools/stage-dev-runtime.mjs";\n\nconst front = fs.readFileSync(new URL("../../ms.js", import.meta.url), "utf8");\nconst report = fs.readFileSync(new URL("../../ms-report.js", import.meta.url), "utf8");\nconst worker = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");\nconst staged = stageWorker(worker);\n\ntest("MS frontend preserves accepted rows across transient empty snapshots without new polling", () => {\n  assert.match(front, /MS_TRANSIENT_EMPTY_CONFIRM_V1/);\n  assert.match(front, /function applyAcceptedLiveResult/);\n  assert.match(front, /received|ได้รับข้อมูลว่างชั่วคราว|คงข้อมูลล่าสุด/);\n  assert.match(front, /if \\(applyAcceptedLiveResult\\(payload, true\\)\\) saveFastRefreshSnapshot\\(\\)/);\n  assert.match(front, /if \\(applyAcceptedLiveResult\\(result, false\\)\\) saveFastRefreshSnapshot\\(\\)/);\n  assert.match(front, /snapshot\\.rows\\.length > 0/);\n  assert.match(front, /transientEmptyHoldActive/);\n  assert.doesNotMatch(front, /setInterval\\(\\(\\) => state\\.auth && loadData\\(true\\), CONFIG\\.pollMs\\)/);\n  assert.match(front, /setInterval\\(realtimeTick, CONFIG\\.pollMs\\)/);\n});\n\ntest("DEV staged worker holds the first suspicious empty source result without extra upstream calls", () => {\n  assert.match(staged, /MS_TRANSIENT_EMPTY_SOURCE_GUARD_V1/);\n  assert.match(staged, /holdTransientEmptyMsSource/);\n  assert.match(staged, /SELECT rows_json,synced_at FROM ms_live_cache WHERE hub=\\?/);\n  assert.match(staged, /transientEmptyHeld: true/);\n  assert.match(staged, /MS_TRANSIENT_EMPTY_CONFIRM_WINDOW_MS = 2 \\* 60 \\* 1000/);\n  const helper = staged.slice(staged.indexOf("async function holdTransientEmptyMsSource"), staged.indexOf("async function runMsRefresh"));\n  assert.doesNotMatch(helper, /fetch\\(|readMsRoutes\\(|setTimeout\\(|setInterval\\(/);\n  assert.doesNotMatch(helper, /INSERT|UPDATE|DELETE|REPLACE/);\n});\n\ntest("DEV report uses the promoted Worker and never the retired API", () => {\n  assert.match(report, /waiting-trucks-report-api-dev\\.26nak-testdev\\.workers\\.dev/);\n  assert.doesNotMatch(report, /waiting-trucks-report\\.alert-squid-6738\\.chatgpt\\.site/);\n});\n`);

const pkgPath = `${root}/worker/package.json`;
let pkg = fs.readFileSync(pkgPath, "utf8");
if (!pkg.includes('tests/ms-transient-empty-guard.test.mjs')) {
  pkg = pkg.replace(
    'tests/ms-owner-live-v8.test.mjs tests/ms-har-browser-context.test.mjs tests/ms-fast-first-paint.test.mjs',
    'tests/ms-owner-live-v8.test.mjs tests/ms-har-browser-context.test.mjs tests/ms-fast-first-paint.test.mjs tests/ms-transient-empty-guard.test.mjs',
  );
}
fs.writeFileSync(pkgPath, pkg);

const acceptancePath = `${root}/.github/workflows/current-system-acceptance.yml`;
let acceptance = fs.readFileSync(acceptancePath, "utf8");
if (!acceptance.includes("FRONTEND_TRANSIENT_EMPTY_GUARD")) {
  acceptance = acceptance.replace(
    "    if(!js.includes('const preserveObservedCompletion =')) throw new Error(`${name} completed view stability missing`);",
    "    if(!js.includes('const preserveObservedCompletion =')) throw new Error(`${name} completed view stability missing`);\n    if(!js.includes('MS_TRANSIENT_EMPTY_CONFIRM_V1')) throw new Error(`${name} transient-empty guard missing`);",
  );
  acceptance = acceptance.replace(
    "  console.log('COMPLETED_VIEW_STABILITY=PASS');",
    "  console.log('COMPLETED_VIEW_STABILITY=PASS');\n  console.log('FRONTEND_TRANSIENT_EMPTY_GUARD=PASS');",
  );
}
fs.writeFileSync(acceptancePath, acceptance);

console.log("MS_REALTIME_STABILITY_V2_PATCH=APPLIED");
