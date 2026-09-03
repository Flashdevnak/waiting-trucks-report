import { readFile, writeFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const FRONTEND_MARKER = "MS_DAILY_HISTORY_V1";
const WORKER_MARKER = "MS_DAILY_HISTORY_V1: read-only daily history";
const RELEASE = "20260903-04";

function replaceOnce(text, pattern, replacement, label) {
  const matches = [...String(text).matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))];
  if (matches.length !== 1) throw new Error(`${label}: expected 1 match, got ${matches.length}`);
  return String(text).replace(pattern, replacement);
}

export function patchMsDailyHistoryFrontend(source) {
  let output = String(source || "");
  if (output.includes(FRONTEND_MARKER)) return output;

  output = replaceOnce(
    output,
    /  archiveLoaded: false,\n  archiveView: false,/,
    `  archiveLoaded: false,\n  archiveRangeKey: "",\n  archiveView: false,`,
    "frontend daily history state",
  );

  output = replaceOnce(
    output,
    /    state\.completedToday = Number\(result\?\.completedToday\) \|\| 0;\n    state\.archiveRows = mergeLatest\(state\.archiveRows, state\.currentRows\);\n    state\.archiveTotal = Math\.max\(state\.archiveTotal, state\.archiveRows\.length\);\n    if \(!state\.archiveTotalLoaded\) void ensureArchiveTotalLoaded\(\);\n    state\.rows = state\.archiveRows;/,
    `    state.completedToday = Number(result?.completedToday) || 0;\n    // ${FRONTEND_MARKER}: live polling never grows or reads historical rows.\n    state.rows = state.archiveView ? state.archiveRows : state.currentRows;`,
    "stop live poll from merging history",
  );

  output = replaceOnce(
    output,
    /  state\.archiveLoaded = false;\n  state\.archiveView = false;/,
    `  state.archiveLoaded = false;\n  state.archiveRangeKey = "";\n  state.archiveView = false;`,
    "reset daily range key",
  );

  output = replaceOnce(
    output,
    /async function ensureArchiveLoaded\(userInitiated = false\) \{[\s\S]*?\n\}\n\nfunction mergeLatest/,
    `async function ensureArchiveLoaded(userInitiated = false) {\n  if (!state.auth) return false;\n  const branch = state.branch;\n  const today = bangkokDateValue(new Date());\n  const inputStart = displayDateToIso(el("date-from")?.value);\n  const inputEnd = displayDateToIso(el("date-to")?.value);\n  const start = inputStart || state.dateFrom || inputEnd || state.dateTo || today;\n  const end = inputEnd || state.dateTo || inputStart || state.dateFrom || start;\n  const rangeKey = \`${"${branch}|${start}|${end}"}\`;\n  if (state.archiveLoaded && state.archiveRangeKey === rangeKey) return true;\n  if (archiveLoadTimer) {\n    clearTimeout(archiveLoadTimer);\n    archiveLoadTimer = null;\n  }\n  if (archiveLoadPromise?.rangeKey === rangeKey) return archiveLoadPromise.promise;\n  const promise = (async () => {\n    try {\n      const archive = await apiGet("msDailyArchive", { branch, start, end });\n      if (state.branch !== branch) return false;\n      const archiveRows = Array.isArray(archive?.rows) ? archive.rows : [];\n      const archiveTotal = Number(archive?.total) || archiveRows.length;\n      if (archive?.complete === false || archiveRows.length !== archiveTotal)\n        throw new Error(\n          \`ข้อมูลรายวันไม่ครบ: ได้ \${nf.format(archiveRows.length)} จาก \${nf.format(archiveTotal)} รายการ\`,\n        );\n      state.archiveRows = archiveRows;\n      state.archiveTotal = archiveTotal;\n      state.archiveTotalLoaded = true;\n      state.archiveLoaded = true;\n      state.archiveRangeKey = rangeKey;\n      state.archiveView = true;\n      state.dateFrom = start;\n      state.dateTo = end;\n      if (el("date-from")) el("date-from").value = start;\n      if (el("date-to")) el("date-to").value = end;\n      state.rows = state.archiveRows;\n      fillFilters();\n      render();\n      return true;\n    } catch (error) {\n      if (userInitiated) toast(\`โหลดข้อมูลรายวันไม่สำเร็จ: \${error.message}\`, true);\n      return false;\n    } finally {\n      if (archiveLoadPromise?.promise === promise) archiveLoadPromise = null;\n    }\n  })();\n  archiveLoadPromise = { branch, rangeKey, promise };\n  return promise;\n}\n\nfunction mergeLatest`,
    "daily-only archive loader",
  );

  output = replaceOnce(
    output,
    /function isCompletedToday\(row, now = new Date\(\)\) \{/,
    `function rowBusinessDay(row) {\n  const value = isOrigin(row)\n    ? row.estimatedDepartureAt || row.actualDepartureAt || row.estimatedArrivalAt\n    : row.estimatedArrivalAt || row.actualArrivalAt || row.estimatedDepartureAt;\n  return bangkokDateValue(value);\n}\n\nfunction metricSourceRows() {\n  if (state.archiveLoaded) return state.archiveRows;\n  const today = bangkokDateValue(new Date());\n  return state.currentRows.filter((row) => rowBusinessDay(row) === today);\n}\n\nfunction isCompletedToday(row, now = new Date()) {`,
    "daily business day helpers",
  );

  output = replaceOnce(
    output,
    /      const arrivalDate = localDateValue\(\n        row\.actualArrivalAt \|\| row\.estimatedArrivalAt,\n      \);/,
    `      const arrivalDate = rowBusinessDay(row);`,
    "daily filter uses business day",
  );

  output = replaceOnce(
    output,
    /async function loadRange\(\) \{[\s\S]*?\n\}\n\nlet rangeTimer;/,
    `async function loadRange() {\n  const rawStart = displayDateToIso(el("date-from").value),\n    rawEnd = displayDateToIso(el("date-to").value),\n    start = rawStart || rawEnd,\n    end = rawEnd || rawStart;\n  if (!start || !end) return toast("กรุณาเลือกวันที่อย่างน้อย 1 วัน", true);\n  try {\n    const result = await apiGet("msDailyArchive", {\n      branch: state.branch,\n      start,\n      end,\n    });\n    const rows = Array.isArray(result?.rows) ? result.rows : [];\n    const total = Number(result?.total) || rows.length;\n    if (result?.complete === false || rows.length !== total)\n      throw new Error(\`ข้อมูลรายวันไม่ครบ: ได้ \${nf.format(rows.length)} จาก \${nf.format(total)} รายการ\`);\n    state.dateFrom = start;\n    state.dateTo = end;\n    el("date-from").value = start;\n    el("date-to").value = end;\n    state.archiveRows = rows;\n    state.archiveTotal = total;\n    state.archiveTotalLoaded = true;\n    state.archiveLoaded = true;\n    state.archiveRangeKey = \`${"${state.branch}|${start}|${end}"}\`;\n    state.queue = "all";\n    el("queue-filter").value = "all";\n    state.archiveView = true;\n    state.rows = state.archiveRows;\n    fillFilters();\n    render();\n    toast(\`โหลดข้อมูลสะสม \${start === end ? start : `${"${start} ถึง ${end}"}`} จำนวน \${nf.format(total)} เที่ยวจากฐานระบบแล้ว\`);\n  } catch (error) {\n    toast(error.message, true);\n  }\n}\n\nlet rangeTimer;`,
    "database-only date search",
  );

  output = replaceOnce(
    output,
    /function setupDateInput\(id\) \{[\s\S]*?\n\}\n\nfunction renderFreshness/,
    `function setupDateInput(id) {\n  const input = el(id);\n  // เลือกวันอย่างเดียวไม่อ่านฐานข้อมูล จนกว่าจะกดค้นหา\n  input.oninput = () => {};\n  input.onclick = () => input.showPicker?.();\n  input.onchange = () => {};\n}\n\nfunction renderFreshness`,
    "date input waits for explicit search",
  );

  output = replaceOnce(
    output,
    /function metrics\(\) \{[\s\S]*?\n\}\n\nfunction setMetric/,
    `function metrics() {\n  const metricRows = metricSourceRows();\n  const completedNote = el("metric-completed")?.closest(".metric-card")?.querySelector("small");\n  if (completedNote)\n    completedNote.textContent = state.archiveLoaded\n      ? "ปลายทางและจุดดรอปที่ลงของเสร็จในช่วงวันที่เลือก"\n      : "ปลายทางและจุดดรอปที่ลงของเสร็จวันนี้";\n  const active = state.currentRows.filter((row) => queueInfo(row).active),\n    destinations = metricRows.filter(isDestination),\n    origins = metricRows.filter(isOrigin),\n    arrivals = destinations.map((row) => punctuality(row)),\n    releases = origins.map((row) => punctuality(row));\n  setMetric("metric-archive", metricRows.length);\n  setMetric("metric-total", active.length);\n  setMetric(\n    "metric-unloading",\n    active.filter((row) => Number(row.unloadingState) === 1).length,\n  );\n  setMetric(\n    "metric-completed",\n    metricRows.filter((row) => isCompletedAccumulated(row)).length,\n  );\n  setMetric(\n    "metric-not-arrived",\n    arrivals.filter((item) => item.key === "ontime").length,\n  );\n  setMetric(\n    "metric-arrived",\n    arrivals.filter((item) => item.key === "late").length,\n  );\n  setMetric(\n    "metric-departed",\n    releases.filter((item) => item.key === "ontime").length,\n  );\n  setMetric(\n    "metric-within-standard",\n    releases.filter((item) => item.key === "late").length,\n  );\n}\n\nfunction setMetric`,
    "daily metric source",
  );

  output = replaceOnce(
    output,
    /      const day = localDateValue\(row\.actualArrivalAt \|\| row\.estimatedArrivalAt\);/,
    `      const day = rowBusinessDay(row);`,
    "daily export business day",
  );

  output = replaceOnce(
    output,
    /async function exportHistory\(\) \{[\s\S]*?\n\}\nfunction dedupeRoutes/,
    `async function exportHistory() {\n  const start = displayDateToIso(el("date-from").value) || state.dateFrom;\n  const end = displayDateToIso(el("date-to").value) || state.dateTo || start;\n  if (!start || !end)\n    return toast("เลือกวันที่แล้วกดค้นหาก่อน Export ช่วงวันที่", true);\n  try {\n    const rangeKey = \`${"${state.branch}|${start}|${end}"}\`;\n    if (!state.archiveLoaded || state.archiveRangeKey !== rangeKey) {\n      const archive = await apiGet("msDailyArchive", { branch: state.branch, start, end });\n      state.archiveRows = Array.isArray(archive?.rows) ? archive.rows : [];\n      state.archiveTotal = Number(archive?.total) || state.archiveRows.length;\n      state.archiveLoaded = true;\n      state.archiveRangeKey = rangeKey;\n    }\n    const rows = dedupeRoutes(state.archiveRows);\n    downloadRows(\n      \`MS_สะสมรายวัน_\${state.branch}_\${start}_\${end}.csv\`,\n      rows.map(exportRow),\n    );\n    toast(\`Export ช่วงวันที่ \${nf.format(rows.length)} เที่ยวแล้ว\`);\n  } catch (error) {\n    toast(error.message, true);\n  }\n}\nfunction dedupeRoutes`,
    "quota-safe history export",
  );

  return output;
}

export function patchMsDailyHistoryWorker(source) {
  let output = String(source || "");
  if (output.includes(WORKER_MARKER)) return output;

  output = replaceOnce(
    output,
    /  if \(action === "msArchiveTotal"\) \{\n    const branch = pickBranch\(actor, url\.searchParams\.get\("branch"\)\);\n    return ok\(await msArchiveTotal\(env, actor, branch\)\);\n  \}/,
    `  if (action === "msArchiveTotal") {\n    const branch = pickBranch(actor, url.searchParams.get("branch"));\n    return ok(await msArchiveTotal(env, actor, branch));\n  }\n  if (action === "msDailyArchive") {\n    const branch = pickBranch(actor, url.searchParams.get("branch"));\n    return ok(\n      await msDailyArchive(\n        env,\n        actor,\n        branch,\n        url.searchParams.get("start"),\n        url.searchParams.get("end"),\n      ),\n    );\n  }`,
    "daily history API route",
  );

  output = replaceOnce(
    output,
    /async function msArchiveTotal\(env, actor, hub\) \{/,
    `// ${WORKER_MARKER}. It never calls upstream MS and never writes history.\nasync function msDailyArchive(env, actor, hub, startValue, endValue) {\n  if (!access(hub, actor)) fail("ไม่มีสิทธิ์ดู HUB นี้", "FORBIDDEN", 403);\n  const start = String(startValue || ""),\n    end = String(endValue || start);\n  const startMs = thaiDateBoundary(start, false),\n    endMs = thaiDateBoundary(end, true);\n  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs)\n    fail("กรุณาเลือกช่วงวันที่ให้ถูกต้อง", "INVALID_DATE_RANGE");\n  if (endMs - startMs > 31 * 86400000)\n    fail("ดูข้อมูลสะสมได้ครั้งละไม่เกิน 31 วัน", "DATE_RANGE_TOO_LARGE");\n\n  const [historyResult, cancellationResult] = await Promise.all([\n    env.DB.prepare(\n      \`WITH latest AS (\n        SELECT h.route_id,h.payload_json,h.snapshot_at,h.synced_by,h.event_type\n        FROM ms_route_registry r\n        JOIN ms_route_history h\n          ON h.rowid = (\n            SELECT h2.rowid\n            FROM ms_route_history h2\n            WHERE h2.hub=r.hub AND h2.route_id=r.route_id\n            ORDER BY h2.snapshot_at DESC,h2.rowid DESC\n            LIMIT 1\n          )\n        WHERE r.hub=? AND h.hub=? AND json_valid(h.payload_json)=1\n      ), daily AS (\n        SELECT route_id,payload_json,snapshot_at,synced_by,event_type,\n          CASE\n            WHEN COALESCE(json_extract(payload_json,'$.attendanceType'),'') LIKE '%ต้นทาง%' THEN\n              date(datetime(COALESCE(\n                NULLIF(json_extract(payload_json,'$.estimatedDepartureAt'),''),\n                NULLIF(json_extract(payload_json,'$.actualDepartureAt'),''),\n                NULLIF(json_extract(payload_json,'$.estimatedArrivalAt'),'')\n              ), '+7 hours'))\n            ELSE\n              date(datetime(COALESCE(\n                NULLIF(json_extract(payload_json,'$.estimatedArrivalAt'),''),\n                NULLIF(json_extract(payload_json,'$.actualArrivalAt'),''),\n                NULLIF(json_extract(payload_json,'$.estimatedDepartureAt'),'')\n              ), '+7 hours'))\n          END AS business_day\n        FROM latest\n      )\n      SELECT route_id,payload_json,snapshot_at,synced_by,event_type,business_day\n      FROM daily\n      WHERE business_day>=? AND business_day<=?\n      ORDER BY business_day DESC,snapshot_at DESC\`,\n    )\n      .bind(hub, hub, start, end)\n      .all(),\n    env.DB.prepare(\n      "SELECT route_id,cancelled_at,cancelled_by,reason FROM ms_route_cancellations WHERE hub=? AND active=1",\n    )\n      .bind(hub)\n      .all(),\n  ]);\n\n  const cancellations = new Map(\n    cancellationResult.results.map((row) => [row.route_id, row]),\n  );\n  const rows = [];\n  for (const item of historyResult.results) {\n    try {\n      const row = JSON.parse(item.payload_json || "{}");\n      if (!row || typeof row !== "object") continue;\n      row.id = row.id || item.route_id;\n      row.hub = row.hub || hub;\n      row.archivedAt = item.snapshot_at;\n      row.businessDay = item.business_day;\n      const cancelled = cancellations.get(item.route_id);\n      if (cancelled) {\n        row.queueCancelledAt = cancelled.cancelled_at;\n        row.queueCancelledBy = cancelled.cancelled_by;\n        row.queueCancelReason = cancelled.reason;\n      }\n      rows.push(row);\n    } catch {}\n  }\n  return {\n    rows,\n    total: rows.length,\n    complete: true,\n    branch: hub,\n    start,\n    end,\n    source: "TURSO_DAILY_HISTORY",\n    upstreamMsCalls: 0,\n    historyWrites: 0,\n  };\n}\n\nasync function msArchiveTotal(env, actor, hub) {`,
    "daily history DB reader",
  );

  return output;
}

export function patchMsDailyHistoryHtml(source) {
  let output = String(source || "");
  output = output.replace(/ms\.js\?v=20260903-\d+/g, `ms.js?v=${RELEASE}`);
  output = output.replace("<span>รายการสะสม</span><strong id=\"metric-archive\">0</strong", "<span>รายการรายวัน</span><strong id=\"metric-archive\">0</strong");
  output = output.replace("<small>รายการที่ระบบบันทึกไว้</small>", "<small>วันนี้ หรือช่วงวันที่ที่กดค้นหา</small>");
  output = output.replace("Export ทั้งหมด", "Export ช่วงวันที่");
  return output;
}

export function patchMsDailyHistoryServiceWorker(source) {
  return String(source || "").replace(/const VERSION=\"20260903-\d+\";/, `const VERSION="${RELEASE}";`);
}

export function patchMsDailyHistoryVersion(source) {
  let data = {};
  try { data = JSON.parse(String(source || "{}")); } catch {}
  data.version = RELEASE;
  data.updatedAt = new Date().toISOString();
  return `${JSON.stringify(data)}\n`;
}

export const DAILY_HISTORY_INDEX_SQL = `-- Optimize read-only latest-per-route daily history lookups.\nCREATE INDEX IF NOT EXISTS idx_ms_route_history_hub_route_snapshot\nON ms_route_history(hub, route_id, snapshot_at DESC);\n`;

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invoked) {
  const files = {
    frontend: "ms.js",
    html: "ms.html",
    worker: "worker/src/index.js",
    sw: "sw.js",
    version: "version.json",
    migration: "worker/migrations/0010_ms_daily_history_read_index.sql",
  };
  const [frontend, html, worker, sw, version] = await Promise.all([
    readFile(files.frontend, "utf8"),
    readFile(files.html, "utf8"),
    readFile(files.worker, "utf8"),
    readFile(files.sw, "utf8"),
    readFile(files.version, "utf8"),
  ]);
  await Promise.all([
    writeFile(files.frontend, patchMsDailyHistoryFrontend(frontend), "utf8"),
    writeFile(files.html, patchMsDailyHistoryHtml(html), "utf8"),
    writeFile(files.worker, patchMsDailyHistoryWorker(worker), "utf8"),
    writeFile(files.sw, patchMsDailyHistoryServiceWorker(sw), "utf8"),
    writeFile(files.version, patchMsDailyHistoryVersion(version), "utf8"),
    writeFile(files.migration, DAILY_HISTORY_INDEX_SQL, "utf8"),
  ]);
  console.log(`MS_DAILY_HISTORY_PATCH=PASS release=${RELEASE}`);
  console.log(`DAILY_INDEX_FILE=${await exists(files.migration) ? "PASS" : "FAIL"}`);
}
