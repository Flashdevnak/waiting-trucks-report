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

const pkgPath = `${root}/worker/package.json`;
let pkg = fs.readFileSync(pkgPath, "utf8");
if (!pkg.includes('tests/ms-transient-empty-guard.test.mjs')) {
  const old = 'tests/ms-owner-live-v8.test.mjs tests/ms-har-browser-context.test.mjs tests/ms-fast-first-paint.test.mjs';
  if (!pkg.includes(old)) throw new Error('package test anchor missing');
  pkg = pkg.replace(old, `${old} tests/ms-transient-empty-guard.test.mjs`);
}
fs.writeFileSync(pkgPath, pkg);

const acceptancePath = `${root}/.github/workflows/current-system-acceptance.yml`;
let acceptance = fs.readFileSync(acceptancePath, "utf8");
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
fs.writeFileSync(acceptancePath, acceptance);

console.log('MS_REALTIME_STABILITY_V2_PATCH=APPLIED');
