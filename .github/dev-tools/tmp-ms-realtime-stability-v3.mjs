import fs from "node:fs";

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  const last = source.lastIndexOf(from);
  if (first < 0 || first !== last) throw new Error(`patch failed: ${label}`);
  return source.replace(from, to);
}

const msPath = "ms.js";
let ms = fs.readFileSync(msPath, "utf8");
if (!ms.includes("MS_TRANSIENT_EMPTY_CONFIRM_V1")) {
  ms = replaceOnce(ms,
    'let fastSnapshotRestoreInProgress = false;\n',
    `let fastSnapshotRestoreInProgress = false;\n// MS_TRANSIENT_EMPTY_CONFIRM_V1: one transient empty response must not erase accepted rows.\n// Confirmation reuses the existing realtime cadence; zero new timer/upstream/DB write.\nlet transientEmptyCandidateKey = "";\nlet transientEmptyHoldActive = false;\n`,
    "transient state");

  ms = replaceOnce(ms,
    'function saveFastRefreshSnapshot(savedAt = Date.now()) {\n',
    `function resetTransientEmptyGuard() {\n  transientEmptyCandidateKey = "";\n  transientEmptyHoldActive = false;\n}\n\nfunction transientEmptyObservationKey(result) {\n  const branch = String(result?.branch || state.branch || "").trim().toUpperCase();\n  const sync = String(result?.lastSync || result?.syncedAt || "").trim();\n  return sync ? \`${'${branch}'}|${'${sync}'}\` : "";\n}\n\nfunction holdTransientEmptyResult(result) {\n  const rows = Array.isArray(result?.rows) ? result.rows : null;\n  if (!rows) return false;\n  if (rows.length > 0) { resetTransientEmptyGuard(); return false; }\n  if (!Array.isArray(state.currentRows) || state.currentRows.length === 0) {\n    resetTransientEmptyGuard();\n    return false;\n  }\n  const incomingBranch = String(result?.branch || state.branch || "").trim().toUpperCase();\n  const currentBranch = String(state.branch || "").trim().toUpperCase();\n  if (incomingBranch && currentBranch && incomingBranch !== currentBranch) {\n    resetTransientEmptyGuard();\n    return false;\n  }\n  const key = transientEmptyObservationKey(result);\n  if (!key || key === transientEmptyCandidateKey) {\n    transientEmptyHoldActive = true;\n    if (key) transientEmptyCandidateKey = key;\n    return true;\n  }\n  if (!transientEmptyCandidateKey) {\n    transientEmptyCandidateKey = key;\n    transientEmptyHoldActive = true;\n    return true;\n  }\n  resetTransientEmptyGuard();\n  return false;\n}\n\nfunction applyAcceptedLiveResult(result, fromStream = false) {\n  if (holdTransientEmptyResult(result)) {\n    state.transportLastOkAt = Date.now();\n    state.transportFailures = 0;\n    render();\n    const badge = el("connection-badge");\n    if (badge) {\n      badge.textContent = "กำลังยืนยันข้อมูลสด";\n      badge.className = "badge badge-neutral";\n    }\n    if (el("last-refresh"))\n      el("last-refresh").textContent =\n        "ได้รับข้อมูลว่างชั่วคราว · คงข้อมูลล่าสุดไว้ · กำลังยืนยันข้อมูลสด";\n    return false;\n  }\n  applyLiveResult(result, fromStream);\n  return true;\n}\n\nfunction saveFastRefreshSnapshot(savedAt = Date.now()) {\n`,
    "frontend empty guard helper");

  ms = replaceOnce(ms,
    '  if (!state.auth || !Array.isArray(state.currentRows)) return;\n',
    '  if (!state.auth || !Array.isArray(state.currentRows) || transientEmptyHoldActive) return;\n',
    "skip provisional snapshot");
  ms = replaceOnce(ms,
    '    applyLiveResult(snapshot, true);\n',
    '    applyAcceptedLiveResult(snapshot, true);\n',
    "fast snapshot guard");
  ms = replaceOnce(ms,
    '  applyLiveResult(payload, true);\n  saveFastRefreshSnapshot();\n',
    '  if (applyAcceptedLiveResult(payload, true)) saveFastRefreshSnapshot();\n',
    "websocket guard");
  ms = replaceOnce(ms,
    `    if (snapshot?.snapshotFound && Array.isArray(snapshot.rows)) {\n      const lastSyncMs = Date.parse(String(snapshot.lastSync || ""));\n      snapshot.savedAt = Number.isFinite(lastSyncMs) ? lastSyncMs : Date.now();\n      if (applyFastRefreshSnapshot(snapshot, "Turso snapshot")) {\n        saveFastRefreshSnapshot(snapshot.savedAt);\n        restartRealtimeTransport();\n        return true;\n      }\n    }`,
    `    if (snapshot?.snapshotFound && Array.isArray(snapshot.rows)) {\n      const lastSyncMs = Date.parse(String(snapshot.lastSync || ""));\n      snapshot.savedAt = Number.isFinite(lastSyncMs) ? lastSyncMs : Date.now();\n      if (snapshot.rows.length > 0 && applyFastRefreshSnapshot(snapshot, "Turso snapshot")) {\n        saveFastRefreshSnapshot(snapshot.savedAt);\n        restartRealtimeTransport();\n        return true;\n      }\n      if (snapshot.rows.length === 0) {\n        const badge = el("connection-badge");\n        if (badge) { badge.textContent = "กำลังยืนยันข้อมูลสด"; badge.className = "badge badge-neutral"; }\n        if (el("last-refresh"))\n          el("last-refresh").textContent = "แคชล่าสุดว่าง · กำลังยืนยันกับข้อมูลสดก่อนแสดง 0";\n        restartRealtimeTransport();\n        return true;\n      }\n    }`,
    "cold empty snapshot guard");
  ms = replaceOnce(ms,
    '    applyLiveResult(result, false);\n    saveFastRefreshSnapshot();\n',
    '    if (applyAcceptedLiveResult(result, false)) saveFastRefreshSnapshot();\n',
    "http fallback guard");
  fs.writeFileSync(msPath, ms);
}

let report = fs.readFileSync("ms-report.js", "utf8");
report = report.replace(
  'https://waiting-trucks-report.alert-squid-6738.chatgpt.site',
  'https://waiting-trucks-report-api-dev.26nak-testdev.workers.dev',
);
fs.writeFileSync("ms-report.js", report);

let stage = fs.readFileSync(".github/dev-tools/stage-dev-runtime.mjs", "utf8");
if (!stage.includes('patch-ms-transient-empty-guard.mjs')) {
  stage = replaceOnce(stage,
    'import { patchMsTbrShadowFeedWorker } from "./patch-ms-tbr-shadow-feed.mjs";\n',
    'import { patchMsTbrShadowFeedWorker } from "./patch-ms-tbr-shadow-feed.mjs";\nimport { patchMsTransientEmptyGuardWorker } from "./patch-ms-transient-empty-guard.mjs";\n',
    "stage import");
  stage = replaceOnce(stage,
    '  output = patchMsTbrShadowFeedWorker(output);\n',
    '  output = patchMsTbrShadowFeedWorker(output);\n  output = patchMsTransientEmptyGuardWorker(output);\n',
    "stage apply");
}
fs.writeFileSync(".github/dev-tools/stage-dev-runtime.mjs", stage);

let pkg = fs.readFileSync("worker/package.json", "utf8");
if (!pkg.includes('tests/ms-transient-empty-guard.test.mjs')) {
  const anchor = 'tests/ms-owner-live-v8.test.mjs tests/ms-har-browser-context.test.mjs tests/ms-fast-first-paint.test.mjs';
  if (!pkg.includes(anchor)) throw new Error('package test anchor missing');
  pkg = pkg.replace(anchor, `${anchor} tests/ms-transient-empty-guard.test.mjs`);
}
fs.writeFileSync("worker/package.json", pkg);

let acceptance = fs.readFileSync(".github/workflows/current-system-acceptance.yml", "utf8");
if (!acceptance.includes("FRONTEND_TRANSIENT_EMPTY_GUARD")) {
  const invariant = "    if(!js.includes('const preserveObservedCompletion =')) throw new Error(`${name} completed view stability missing`);";
  if (!acceptance.includes(invariant)) throw new Error('acceptance invariant anchor missing');
  acceptance = acceptance.replace(
    invariant,
    `${invariant}\n    if(!js.includes('MS_TRANSIENT_EMPTY_CONFIRM_V1')) throw new Error(\`${'${name}'} transient-empty guard missing\`);`,
  );
  const log = "  console.log('COMPLETED_VIEW_STABILITY=PASS');";
  if (!acceptance.includes(log)) throw new Error('acceptance log anchor missing');
  acceptance = acceptance.replace(log, `${log}\n  console.log('FRONTEND_TRANSIENT_EMPTY_GUARD=PASS');`);
}
fs.writeFileSync(".github/workflows/current-system-acceptance.yml", acceptance);

console.log("MS_REALTIME_STABILITY_V3_PATCH=APPLIED");
