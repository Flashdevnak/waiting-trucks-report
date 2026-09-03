import { readFileSync, writeFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const write = (path, value) => writeFileSync(path, value, "utf8");

function replaceUnique(text, from, to, label) {
  const first = text.indexOf(from);
  const last = text.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`${label}: expected one match, got first=${first} last=${last}`);
  return text.slice(0, first) + to + text.slice(first + from.length);
}

function replaceSection(text, startMarker, endMarker, replacement, label) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0)
    throw new Error(`${label}: section markers not found`);
  if (text.indexOf(startMarker, start + 1) >= 0)
    throw new Error(`${label}: start marker is not unique`);
  return text.slice(0, start) + replacement + text.slice(end);
}

let worker = read("worker/src/index.js");
worker = replaceUnique(
  worker,
  '  if (action === "msHistory")\n    return ok(',
  '  if (action === "msArchiveTotal") {\n' +
    '    const branch = pickBranch(actor, url.searchParams.get("branch"));\n' +
    '    return ok(await msArchiveTotal(env, actor, branch));\n' +
    '  }\n' +
    '  if (action === "msHistory")\n    return ok(',
  "add lightweight archive total endpoint",
);

const archiveFunctions = String.raw`async function msArchiveTotal(env, actor, hub) {
  if (!access(hub, actor)) fail("ไม่มีสิทธิ์ดู HUB นี้", "FORBIDDEN", 403);
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS total_distinct FROM ms_route_registry WHERE hub=?",
  )
    .bind(hub)
    .first();
  return { branch: hub, total: Number(row?.total_distinct) || 0 };
}

async function msArchive(env, actor, hub) {
  if (!access(hub, actor)) fail("ไม่มีสิทธิ์ดู HUB นี้", "FORBIDDEN", 403);
  const [historyResult, completionResult, distinctResult, currentResult] =
    await Promise.all([
      env.DB.prepare(
        `WITH ranked AS (
          SELECT route_id,payload_json,snapshot_at,synced_by,
            ROW_NUMBER() OVER (
              PARTITION BY route_id
              ORDER BY snapshot_at DESC, rowid DESC
            ) AS rn
          FROM ms_route_history
          WHERE hub=?
        )
        SELECT route_id,payload_json,snapshot_at,synced_by
        FROM ranked
        WHERE rn=1
        ORDER BY snapshot_at DESC`,
      )
        .bind(hub)
        .all(),
      env.DB.prepare(
        `WITH completions AS (
          SELECT route_id,synced_by,
            ROW_NUMBER() OVER (
              PARTITION BY route_id
              ORDER BY snapshot_at ASC, rowid ASC
            ) AS rn
          FROM ms_route_history
          WHERE hub=?
            AND json_valid(payload_json)=1
            AND COALESCE(json_extract(payload_json,'$.unloadingCompletedAt'),'')<>''
        )
        SELECT route_id,synced_by
        FROM completions
        WHERE rn=1`,
      )
        .bind(hub)
        .all(),
      env.DB.prepare(
        "SELECT COUNT(*) AS total_distinct FROM ms_route_registry WHERE hub=?",
      )
        .bind(hub)
        .first(),
      env.DB.prepare("SELECT * FROM ms_routes WHERE hub=?")
        .bind(hub)
        .all(),
    ]);

  const completionObserved = new Map(
    completionResult.results.map((item) => [
      item.route_id,
      item.synced_by !== "MS_RANGE",
    ]),
  );
  const latest = new Map();
  for (const item of historyResult.results) {
    try {
      const row = JSON.parse(item.payload_json || "{}");
      if (!row || typeof row !== "object") continue;
      row.id = row.id || item.route_id;
      row.hub = row.hub || hub;
      row.archivedAt = item.snapshot_at;
      row.completionObservedLive = completionObserved.get(item.route_id) === true;
      latest.set(item.route_id, row);
    } catch {}
  }

  const current = currentResult.results.map(output);
  for (const row of current) {
    row.completionObservedLive = completionObserved.has(row.id)
      ? completionObserved.get(row.id) === true
      : row.syncedBy !== "MS_RANGE" && Boolean(row.unloadingCompletedAt);
    latest.set(row.id, row);
  }

  const rows = [...latest.values()];
  const totalDistinct = Math.max(
    Number(distinctResult?.total_distinct) || 0,
    rows.length,
  );
  const complete = rows.length >= totalDistinct;
  return { rows, total: rows.length, totalDistinct, complete, branch: hub };
}

`;
worker = replaceSection(
  worker,
  "async function msArchive(env, actor, hub) {",
  "async function msCryptoKey(env)",
  archiveFunctions,
  "replace incomplete msArchive",
);
write("worker/src/index.js", worker);

let ms = read("ms.js");
ms = replaceUnique(
  ms,
  "  archiveTotal: 0,\n  auth: loadAuth(),",
  "  archiveTotal: 0,\n  archiveTotalLoaded: false,\n  auth: loadAuth(),",
  "add archive total loaded state",
);
ms = replaceUnique(
  ms,
  "let archiveLoadTimer = null;\nlet archiveLoadPromise = null;",
  "let archiveLoadTimer = null;\nlet archiveLoadPromise = null;\nlet archiveTotalPromise = null;",
  "add archive total promise",
);
ms = replaceUnique(
  ms,
  'function logout() {\n  state.auth = null;\n  state.rows = [];\n  localStorage.removeItem(AUTH_KEY);\n  authUi();\n  render();\n}',
  'function logout() {\n  state.auth = null;\n  state.currentRows = [];\n  resetArchiveState();\n  localStorage.removeItem(AUTH_KEY);\n  authUi();\n  render();\n}',
  "clear archive state on logout",
);
ms = replaceUnique(
  ms,
  "    state.archiveTotal = Math.max(state.archiveTotal, state.archiveRows.length);\n    state.rows = state.archiveRows;",
  "    state.archiveTotal = Math.max(state.archiveTotal, state.archiveRows.length);\n    if (!state.archiveTotalLoaded) void ensureArchiveTotalLoaded();\n    state.rows = state.archiveRows;",
  "load authoritative accumulated total after live load",
);
ms = replaceUnique(
  ms,
  "  state.archiveTotal = 0;\n  state.completedToday = 0;\n  state.archiveLoaded = false;",
  "  state.archiveTotal = 0;\n  state.archiveTotalLoaded = false;\n  archiveTotalPromise = null;\n  state.completedToday = 0;\n  state.archiveLoaded = false;",
  "reset accumulated total state",
);

const totalHelper = String.raw`async function ensureArchiveTotalLoaded() {
  if (!state.auth) return false;
  if (state.archiveTotalLoaded) return true;
  const branch = state.branch;
  if (archiveTotalPromise?.branch === branch) return archiveTotalPromise.promise;
  const promise = (async () => {
    try {
      const result = await apiGet("msArchiveTotal", { branch });
      if (state.branch !== branch) return false;
      state.archiveTotal = Math.max(
        Number(result?.total) || 0,
        state.currentRows.length,
      );
      state.archiveTotalLoaded = true;
      metrics();
      return true;
    } catch {
      return false;
    } finally {
      if (archiveTotalPromise?.promise === promise) archiveTotalPromise = null;
    }
  })();
  archiveTotalPromise = { branch, promise };
  return promise;
}

`;
ms = replaceUnique(
  ms,
  "async function ensureArchiveLoaded(userInitiated = false) {",
  totalHelper + "async function ensureArchiveLoaded(userInitiated = false) {",
  "add lightweight accumulated total loader",
);
ms = replaceUnique(
  ms,
  '      state.archiveRows = Array.isArray(archive?.rows) ? archive.rows : [];\n      state.archiveTotal = Number.isFinite(Number(archive?.totalDistinct))\n        ? Number(archive.totalDistinct)\n        : state.archiveRows.length;\n      state.archiveLoaded = true;',
  '      const archiveRows = Array.isArray(archive?.rows) ? archive.rows : [];\n      const archiveTotal = Number.isFinite(Number(archive?.totalDistinct))\n        ? Number(archive.totalDistinct)\n        : archiveRows.length;\n      if (archive?.complete === false || archiveRows.length < archiveTotal)\n        throw new Error(\n          `รายการสะสมไม่ครบ: ได้ ${nf.format(archiveRows.length)} จาก ${nf.format(archiveTotal)} รายการ`,\n        );\n      state.archiveRows = archiveRows;\n      state.archiveTotal = archiveTotal;\n      state.archiveTotalLoaded = true;\n      state.archiveLoaded = true;',
  "reject silently incomplete accumulated archive",
);
ms = replaceUnique(
  ms,
  '  if (state.archiveLoaded)\n    setMetric("metric-archive", state.archiveTotal ?? state.archiveRows.length);\n  else\n    el("metric-archive").textContent = "กดดู";',
  '  if (state.archiveTotalLoaded)\n    setMetric("metric-archive", state.archiveTotal ?? state.archiveRows.length);\n  else\n    el("metric-archive").textContent = "…";',
  "show authoritative accumulated card total",
);
write("ms.js", ms);

let html = read("ms.html");
html = html.replace(/ms\.js\?v=[^"']+/, "ms.js?v=20260903-03");
write("ms.html", html);

for (const path of [
  "sw.js",
  "version.json",
  ".github/workflows/cutover-dry-run.yml",
  ".github/workflows/go-live-preflight.yml",
]) {
  let text = read(path).replaceAll("20260903-02", "20260903-03");
  if (path === "version.json") {
    const value = JSON.parse(text);
    value.updatedAt = new Date().toISOString();
    text = JSON.stringify(value) + "\n";
  }
  write(path, text);
}

let deploy = read(".github/workflows/deploy-worker-dev.yml");
deploy = replaceUnique(
  deploy,
  "      - run: node --test ../.github/dev-tools/ms-route-cancellation.test.mjs\n      - run: node --test ../.github/dev-tools/stage-dev-runtime.test.mjs",
  "      - run: node --test ../.github/dev-tools/ms-route-cancellation.test.mjs\n      - run: node --test ../.github/dev-tools/ms-archive-completeness.test.mjs\n      - run: node --test ../.github/dev-tools/stage-dev-runtime.test.mjs",
  "add archive completeness regression to deploy",
);
write(".github/workflows/deploy-worker-dev.yml", deploy);

write(
  ".github/dev-tools/ms-archive-completeness.test.mjs",
  String.raw`import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { stageWorker } from "./stage-dev-runtime.mjs";

const root = new URL("../../", import.meta.url);
const frontend = await readFile(new URL("ms.js", root), "utf8");
const workerBase = await readFile(new URL("worker/src/index.js", root), "utf8");
const worker = stageWorker(workerBase);

test("accumulated card loads authoritative registry total without loading history", () => {
  assert.match(frontend, /archiveTotalLoaded: false/);
  assert.match(frontend, /apiGet\("msArchiveTotal", \{ branch \}\)/);
  assert.match(frontend, /if \(!state\.archiveTotalLoaded\) void ensureArchiveTotalLoaded\(\)/);
  assert.doesNotMatch(frontend, /metric-archive"\)\.textContent = "กดดู"/);
  assert.match(frontend, /pollMs:\s*4000/);
  assert.match(frontend, /DEV: archive stays lazy; live polling must never auto-read msArchive/);
});

test("archive returns latest snapshot for every distinct route without newest-10000 cap", () => {
  const start = worker.indexOf("async function msArchive(env, actor, hub)");
  const end = worker.indexOf("async function msCryptoKey", start);
  assert.ok(start >= 0 && end > start);
  const section = worker.slice(start, end);
  assert.match(section, /ROW_NUMBER\(\) OVER \(/);
  assert.match(section, /PARTITION BY route_id/);
  assert.match(section, /WHERE rn=1/);
  assert.doesNotMatch(section, /LIMIT 10000/);
  assert.match(section, /complete = rows\.length >= totalDistinct/);
});

test("frontend refuses a silently incomplete accumulated archive", () => {
  assert.match(frontend, /archive\?\.complete === false \|\| archiveRows\.length < archiveTotal/);
  assert.match(frontend, /รายการสะสมไม่ครบ/);
});

test("archive total endpoint stays lightweight", () => {
  assert.match(worker, /action === "msArchiveTotal"/);
  const start = worker.indexOf("async function msArchiveTotal");
  const end = worker.indexOf("async function msArchive(env", start);
  const section = worker.slice(start, end);
  assert.match(section, /COUNT\(\*\) AS total_distinct FROM ms_route_registry/);
  assert.doesNotMatch(section, /ms_route_history/);
});
`,
);

console.log("MS_ARCHIVE_COMPLETENESS_PATCH=APPLIED");
