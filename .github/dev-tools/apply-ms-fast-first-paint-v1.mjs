import { readFile, writeFile } from "node:fs/promises";

function replaceUnique(source, from, to, label) {
  const first = source.indexOf(from);
  const last = source.lastIndexOf(from);
  if (first < 0 || first !== last) {
    throw new Error(`FAST_FIRST_PAINT patch failed: ${label} count=${first < 0 ? 0 : first === last ? 1 : 2}`);
  }
  return source.replace(from, to);
}

const msPath = "ms.js";
let ms = await readFile(msPath, "utf8");

if (!ms.includes("MS_FAST_FIRST_PAINT_V1")) {
  ms = replaceUnique(
    ms,
    'const AUTH_KEY = "bnak_operator_auth_v2";\nconst state = {',
    'const AUTH_KEY = "bnak_operator_auth_v2";\n// MS_FAST_FIRST_PAINT_V1: a browser reload paints the last accepted snapshot immediately,\n// then reconnects to the existing shared realtime coordinator. No extra upstream MS poll.\nconst FAST_REFRESH_SNAPSHOT_KEY = "ms_fast_refresh_snapshot_v1";\nconst FAST_REFRESH_SNAPSHOT_MAX_AGE_MS = 5 * 60 * 1000;\nlet fastSnapshotRestoreInProgress = false;\nconst state = {',
    "frontend marker/constants",
  );

  ms = replaceUnique(
    ms,
    `  el("branch-filter").onchange = (event) => {\n    state.branch = event.target.value;\n    state.summary = "all";\n    resetArchiveState();\n    stopRealtimeTransport();\n    loadData().finally(() => restartRealtimeTransport());\n  };`,
    `  el("branch-filter").onchange = (event) => {\n    state.branch = event.target.value;\n    state.summary = "all";\n    resetArchiveState();\n    stopRealtimeTransport();\n    void loadInitialData();\n  };`,
    "branch fast initial load",
  );

  ms = replaceUnique(
    ms,
    `  clock();\n  authUi();\n  loadData().finally(() => restartRealtimeTransport());\n  handleMsEntryHash();`,
    `  clock();\n  authUi();\n  void loadInitialData();\n  handleMsEntryHash();`,
    "DOMContentLoaded fast initial load",
  );

  ms = replaceUnique(
    ms,
    `  realtimeLastSnapshotAt = Date.now();\n  applyLiveResult(payload, true);\n}`,
    `  realtimeLastSnapshotAt = Date.now();\n  applyLiveResult(payload, true);\n  saveFastRefreshSnapshot();\n}`,
    "save realtime snapshot",
  );

  ms = replaceUnique(
    ms,
    `    authUi();\n    await loadData();\n    restartRealtimeTransport();\n    handleMsEntryHash();`,
    `    authUi();\n    await loadInitialData();\n    handleMsEntryHash();`,
    "login fast initial load",
  );

  ms = replaceUnique(
    ms,
    `function logout() {\n  stopRealtimeTransport();\n  state.auth = null;`,
    `function logout() {\n  const fastSnapshotUsername = state.auth?.username || "";\n  stopRealtimeTransport();\n  clearFastRefreshSnapshotsForUser(fastSnapshotUsername);\n  state.auth = null;`,
    "clear fast snapshot on logout",
  );

  ms = replaceUnique(
    ms,
    `function invalidateSession() {\n  stopRealtimeTransport();\n  state.auth = null;`,
    `function invalidateSession() {\n  const fastSnapshotUsername = state.auth?.username || "";\n  stopRealtimeTransport();\n  clearFastRefreshSnapshotsForUser(fastSnapshotUsername);\n  state.auth = null;`,
    "clear fast snapshot on invalid session",
  );

  const helperAnchor = `async function loadData(silent = false) {`;
  const helperBlock = `function fastRefreshSnapshotKey(branch = state.branch, username = state.auth?.username) {\n  const user = String(username || "").trim().toUpperCase();\n  const hub = String(branch || "").trim().toUpperCase();\n  return user && hub ? \`${'${FAST_REFRESH_SNAPSHOT_KEY}:${user}:${hub}'}\` : "";\n}\n\nfunction fastRefreshStandards() {\n  return Object.entries(state.standards || {}).map(([type, minutes]) => ({\n    type,\n    minutes: Number(minutes) || 120,\n  }));\n}\n\nfunction fastRefreshBranches() {\n  const select = el("branch-filter");\n  const fromSelect = select\n    ? Array.from(select.options || []).map((option) => String(option.value || "").trim()).filter(Boolean)\n    : [];\n  const fromAuth = Array.isArray(state.auth?.branches)\n    ? state.auth.branches.filter((branch) => branch && branch !== "*")\n    : [];\n  return [...new Set([...fromSelect, ...fromAuth, state.branch].filter(Boolean))];\n}\n\nfunction saveFastRefreshSnapshot(savedAt = Date.now()) {\n  if (!state.auth || !Array.isArray(state.currentRows)) return;\n  const key = fastRefreshSnapshotKey();\n  if (!key) return;\n  const snapshot = {\n    marker: "MS_FAST_FIRST_PAINT_V1",\n    savedAt: Number(savedAt) || Date.now(),\n    branch: state.branch,\n    rows: state.currentRows,\n    completedToday: Number(state.completedToday) || 0,\n    standards: fastRefreshStandards(),\n    branches: fastRefreshBranches(),\n    lastSync: state.lastSync || "",\n    msStatus: state.msStatus || "",\n    syncError: state.syncError || "",\n  };\n  try {\n    sessionStorage.setItem(key, JSON.stringify(snapshot));\n  } catch {}\n}\n\nfunction clearFastRefreshSnapshotsForUser(username) {\n  const user = String(username || "").trim().toUpperCase();\n  if (!user) return;\n  const prefix = \`${'${FAST_REFRESH_SNAPSHOT_KEY}:${user}:'}\`;\n  try {\n    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {\n      const key = sessionStorage.key(index);\n      if (key?.startsWith(prefix)) sessionStorage.removeItem(key);\n    }\n  } catch {}\n}\n\nfunction applyFastRefreshSnapshot(snapshot, sourceLabel = "snapshot") {\n  if (!snapshot || !Array.isArray(snapshot.rows)) return false;\n  const snapshotBranch = String(snapshot.branch || state.branch || "").toUpperCase();\n  if (snapshotBranch && snapshotBranch !== String(state.branch || "").toUpperCase()) return false;\n  fastSnapshotRestoreInProgress = true;\n  try {\n    applyLiveResult(snapshot, true);\n  } finally {\n    fastSnapshotRestoreInProgress = false;\n  }\n  const savedAt = Number(snapshot.savedAt) || Date.parse(String(snapshot.lastSync || "")) || 0;\n  state.transportLastOkAt = savedAt;\n  const badge = el("connection-badge");\n  if (badge) {\n    badge.textContent = "กำลังเชื่อมต่อ";\n    badge.className = "badge badge-neutral";\n  }\n  const displayAt = Date.parse(String(snapshot.lastSync || "")) || savedAt;\n  if (el("last-refresh")) {\n    const stamp = displayAt ? dtf.format(new Date(displayAt)) : "ล่าสุด";\n    el("last-refresh").textContent =\n      \`แสดงข้อมูลล่าสุดจาก ${'${sourceLabel}'} · ${'${stamp}'} น. · กำลังเชื่อมต่อข้อมูลสด\`;\n  }\n  return true;\n}\n\nfunction restoreFastRefreshSnapshot() {\n  const key = fastRefreshSnapshotKey();\n  if (!key) return false;\n  try {\n    const snapshot = JSON.parse(sessionStorage.getItem(key) || "null");\n    const savedAt = Number(snapshot?.savedAt) || 0;\n    if (!snapshot || !savedAt || Date.now() - savedAt > FAST_REFRESH_SNAPSHOT_MAX_AGE_MS) {\n      sessionStorage.removeItem(key);\n      return false;\n    }\n    return applyFastRefreshSnapshot(snapshot, "snapshot ในแท็บนี้");\n  } catch {\n    try { sessionStorage.removeItem(key); } catch {}\n    return false;\n  }\n}\n\nasync function loadInitialData() {\n  if (!state.auth) {\n    await loadData();\n    return false;\n  }\n  if (restoreFastRefreshSnapshot()) {\n    restartRealtimeTransport();\n    return true;\n  }\n  try {\n    const snapshot = await apiGet("msRoutesSnapshot", { branch: state.branch });\n    if (snapshot?.snapshotFound && Array.isArray(snapshot.rows)) {\n      const lastSyncMs = Date.parse(String(snapshot.lastSync || ""));\n      snapshot.savedAt = Number.isFinite(lastSyncMs) ? lastSyncMs : Date.now();\n      if (applyFastRefreshSnapshot(snapshot, "Turso snapshot")) {\n        saveFastRefreshSnapshot(snapshot.savedAt);\n        restartRealtimeTransport();\n        return true;\n      }\n    }\n  } catch {}\n  await loadData();\n  restartRealtimeTransport();\n  return false;\n}\n\n${helperAnchor}`;
  ms = replaceUnique(ms, helperAnchor, helperBlock, "fast snapshot helper block");

  ms = replaceUnique(
    ms,
    `    const result = await apiGet("msRoutes", { branch: state.branch });\n    applyLiveResult(result, false);\n    ensureRealtimeTransport();`,
    `    const result = await apiGet("msRoutes", { branch: state.branch });\n    applyLiveResult(result, false);\n    saveFastRefreshSnapshot();\n    ensureRealtimeTransport();`,
    "save HTTP live snapshot",
  );

  ms = replaceUnique(
    ms,
    `  state.transportLastOkAt = Date.now();\n  state.transportFailures = 0;\n  fillFilters();`,
    `  if (!fastSnapshotRestoreInProgress) {\n    state.transportLastOkAt = Date.now();\n    state.transportFailures = 0;\n  }\n  fillFilters();`,
    "do not mark cached snapshot as transport success",
  );

  ms = replaceUnique(
    ms,
    `  if (state.completedToday === 0 && completedTodayZeroProbedKey !== zeroProbeKey) {`,
    `  if (!fastSnapshotRestoreInProgress && state.completedToday === 0 && completedTodayZeroProbedKey !== zeroProbeKey) {`,
    "skip zero probe for cached first paint",
  );

  ms = replaceUnique(
    ms,
    `  if (shouldHydrateCompletedTodayRows()) {`,
    `  if (!fastSnapshotRestoreInProgress && shouldHydrateCompletedTodayRows()) {`,
    "skip history hydration for cached first paint",
  );
}

await writeFile(msPath, ms);

const workerPath = "worker/src/index.js";
let worker = await readFile(workerPath, "utf8");
if (!worker.includes("MS_FAST_FIRST_PAINT_V1")) {
  worker = replaceUnique(
    worker,
    `  if (action === "msRoutes") {`,
    `  // MS_FAST_FIRST_PAINT_V1: cache-only first paint. This path never calls upstream MS.\n  if (action === "msRoutesSnapshot") {\n    const branch = pickBranch(actor, url.searchParams.get("branch"));\n    const [cache, settings] = await Promise.all([\n      env.DB.prepare(\n        "SELECT rows_json,synced_at FROM ms_live_cache WHERE hub=? LIMIT 1",\n      )\n        .bind(branch)\n        .first(),\n      readSettings(env, branch),\n    ]);\n    const syncedAt = String(cache?.synced_at || "");\n    const parsedAt = Date.parse(syncedAt);\n    const snapshotAgeMs = Number.isFinite(parsedAt)\n      ? Math.max(0, Date.now() - parsedAt)\n      : -1;\n    let rows = [];\n    let snapshotFound = false;\n    if (cache && snapshotAgeMs >= 0 && snapshotAgeMs <= 20 * 60 * 1000) {\n      try {\n        const parsed = JSON.parse(cache.rows_json || "[]");\n        if (Array.isArray(parsed)) {\n          rows = parsed;\n          snapshotFound = true;\n        }\n      } catch {}\n    }\n    return ok({\n      rows,\n      branch,\n      branches:\n        actor.role === "admin"\n          ? [...new Set([branch, ...(await knownMsBranches(env))])]\n          : actor.branches.filter((x) => x !== "*"),\n      standards: settings.msVehicleLimits,\n      lastSync: snapshotFound ? syncedAt : "",\n      msStatus: snapshotFound ? "cached" : "empty",\n      syncError: "",\n      snapshotFound,\n      snapshotAgeMs,\n    });\n  }\n  if (action === "msRoutes") {`,
    "cache-only msRoutesSnapshot endpoint",
  );
}
await writeFile(workerPath, worker);

const testPath = "worker/tests/ms-fast-first-paint.test.mjs";
const testSource = `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { readFileSync } from "node:fs";\nimport { fileURLToPath } from "node:url";\nimport { dirname, resolve } from "node:path";\n\nconst here = dirname(fileURLToPath(import.meta.url));\nconst frontend = readFileSync(resolve(here, "../../ms.js"), "utf8");\nconst worker = readFileSync(resolve(here, "../src/index.js"), "utf8");\n\ntest("reload paints accepted browser snapshot before live reconnect", () => {\n  assert.match(frontend, /MS_FAST_FIRST_PAINT_V1/);\n  assert.match(frontend, /sessionStorage\\.setItem\\(key, JSON\\.stringify\\(snapshot\\)\\)/);\n  assert.match(frontend, /restoreFastRefreshSnapshot\\(\\)/);\n  assert.match(frontend, /void loadInitialData\\(\\)/);\n  assert.match(frontend, /restartRealtimeTransport\\(\\)/);\n  assert.doesNotMatch(frontend, /localStorage\\.setItem\\([^\\n]*ms_fast_refresh_snapshot_v1/);\n});\n\ntest("cold first paint uses Turso live cache without upstream MS refresh", () => {\n  const start = worker.indexOf('if (action === "msRoutesSnapshot")');\n  const end = worker.indexOf('if (action === "msRoutes")', start + 1);\n  assert.ok(start >= 0 && end > start, "msRoutesSnapshot action missing");\n  const block = worker.slice(start, end);\n  assert.match(block, /FROM ms_live_cache/);\n  assert.match(block, /snapshotAgeMs <= 20 \\* 60 \\* 1000/);\n  assert.doesNotMatch(block, /refreshMsIfStale|runMsRefresh|readMsPage|INSERT|UPDATE|DELETE/);\n});\n\ntest("cached first paint suppresses archive hydration and upstream duplicate work", () => {\n  assert.match(frontend, /!fastSnapshotRestoreInProgress && state\\.completedToday === 0/);\n  assert.match(frontend, /!fastSnapshotRestoreInProgress && shouldHydrateCompletedTodayRows\\(\\)/);\n  const loadInitial = frontend.slice(\n    frontend.indexOf("async function loadInitialData()"),\n    frontend.indexOf("async function loadData", frontend.indexOf("async function loadInitialData()")),\n  );\n  assert.match(loadInitial, /apiGet\\("msRoutesSnapshot"/);\n  assert.match(loadInitial, /restartRealtimeTransport\\(\\)/);\n});\n`;
await writeFile(testPath, testSource);

const packagePath = "worker/package.json";
let pkg = await readFile(packagePath, "utf8");
if (!pkg.includes("tests/ms-fast-first-paint.test.mjs")) {
  pkg = replaceUnique(
    pkg,
    "tests/ms-owner-live-v8.test.mjs tests/ms-har-browser-context.test.mjs",
    "tests/ms-owner-live-v8.test.mjs tests/ms-har-browser-context.test.mjs tests/ms-fast-first-paint.test.mjs",
    "register fast first paint regression test",
  );
}
await writeFile(packagePath, pkg);

console.log("MS_FAST_FIRST_PAINT_V1_PATCH=PASS");
