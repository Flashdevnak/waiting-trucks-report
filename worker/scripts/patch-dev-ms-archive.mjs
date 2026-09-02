import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function replaceUnique(output, replacement, label) {
  const first = output.indexOf(replacement.from);
  const last = output.lastIndexOf(replacement.from);
  if (first < 0 || first !== last)
    throw new Error(`${label} failed: ${replacement.name}`);
  return output.replace(replacement.from, replacement.to);
}

export function patchDevMsArchive(source) {
  let output = String(source || "");
  const replacements = [
    {
      name: "disable automatic archive load",
      from: "    if (!silent && !state.archiveLoaded) scheduleArchiveLoad();",
      to: "    // DEV: archive stays lazy; live polling must never auto-read msArchive.",
    },
    {
      name: "load archive for completed/all views",
      from: "    if (state.queue === \"all\") await ensureArchiveLoaded(true);",
      to: "    if (state.queue === \"all\" || state.queue === \"completed\") await ensureArchiveLoaded(true);",
    },
    {
      name: "load archive after explicit range search",
      from: "    await loadData(false);\n    toast(`ดึงข้อมูลย้อนหลัง ${nf.format(result.total)} รายการแล้ว`);",
      to: "    await loadData(false);\n    if (!(await ensureArchiveLoaded(true)))\n      throw new Error(\"โหลดรายการย้อนหลังไม่สำเร็จ\");\n    toast(`ดึงข้อมูลย้อนหลัง ${nf.format(result.total)} รายการแล้ว`);",
    },
    {
      name: "keep archive metric unloaded until requested",
      from: "  setMetric(\"metric-archive\", state.archiveTotal ?? state.archiveRows.length);",
      to: "  if (state.archiveLoaded)\n    setMetric(\"metric-archive\", state.archiveTotal ?? state.archiveRows.length);\n  else\n    el(\"metric-archive\").textContent = \"กดดู\";",
    },
    {
      name: "capture lightweight daily completed total from msRoutes",
      from: "    state.currentRows = Array.isArray(result?.rows) ? result.rows : [];\n    state.archiveRows = mergeLatest(state.archiveRows, state.currentRows);",
      to: "    state.currentRows = Array.isArray(result?.rows) ? result.rows : [];\n    state.completedToday = Number(result?.completedToday) || 0;\n    state.archiveRows = mergeLatest(state.archiveRows, state.currentRows);",
    },
    {
      name: "reset lightweight daily completed total with HUB archive state",
      from: "  state.archiveRows = [];\n  state.archiveTotal = 0;\n  state.archiveLoaded = false;",
      to: "  state.archiveRows = [];\n  state.archiveTotal = 0;\n  state.completedToday = 0;\n  state.archiveLoaded = false;",
    },
    {
      name: "daily completed queue summary uses backend lightweight total",
      from: "  const counts = { waiting: 0, unloading: 0, completed: 0, origin: 0, drop: 0 };",
      to: "  const counts = {\n    waiting: 0,\n    unloading: 0,\n    completed: Number(state.completedToday) || 0,\n    origin: 0,\n    drop: 0,\n  };",
    },
    {
      name: "avoid double counting daily completed queue summary",
      from: "    if (isCompletedToday(row)) counts.completed++;",
      to: "    // DEV: completed is a daily HUB total supplied by the lightweight live cache.",
    },
    {
      name: "completed summary button loads only lightweight daily rows",
      from: "  el(\"filter-summary\")\n    .querySelectorAll(\"button\")\n    .forEach((button) => {\n      button.onclick = () => {\n      const value = button.dataset.summaryStatus;\n        state.summary = value;\n        render();\n      };\n    });",
      to: "  el(\"filter-summary\")\n    .querySelectorAll(\"button\")\n    .forEach((button) => {\n      button.onclick = async () => {\n        const value = button.dataset.summaryStatus;\n        if (value === \"completed\") {\n          try {\n            const completed = await apiGet(\"msCompletedToday\", { branch: state.branch });\n            state.archiveRows = mergeLatest(state.archiveRows, completed?.rows || []);\n            state.rows = mergeLatest(state.archiveRows, state.currentRows);\n            state.completedToday = Number(completed?.total) || 0;\n            state.queue = \"all\";\n            el(\"queue-filter\").value = \"all\";\n          } catch (error) {\n            toast(`โหลดรายการลงรถเสร็จวันนี้ไม่สำเร็จ: ${error.message}`, true);\n            return;\n          }\n        }\n        state.summary = value;\n        render();\n      };\n    });",
    },
    {
      name: "show KIT TBR arrival sources for origin routes",
      from: "function arrivalSources(row) {\n  if (!isDestination(row)) return \"\";",
      to: "function arrivalSources(row) {\n  if (!isDestination(row) && !isOrigin(row)) return \"\";",
    },
  ];

  for (const replacement of replacements)
    output = replaceUnique(output, replacement, "DEV frontend patch");

  return output;
}

export function patchDevWorkerCompletedSummary(source) {
  let output = String(source || "");
  const replacements = [
    {
      name: "expose completedToday on msRoutes",
      from: "      msStatus: live.status,\n      syncError: live.error || \"\",",
      to: "      msStatus: live.status,\n      syncError: live.error || \"\",\n      completedToday: Number(live.completedToday) || 0,",
    },
    {
      name: "add lightweight msCompletedToday endpoint",
      from: "  if (action === \"msArchive\")\n    return ok(\n      await msArchive(\n        env,\n        actor,\n        pickBranch(actor, url.searchParams.get(\"branch\")),\n      ),\n    );\n  if (action === \"msRange\")",
      to: "  if (action === \"msArchive\")\n    return ok(\n      await msArchive(\n        env,\n        actor,\n        pickBranch(actor, url.searchParams.get(\"branch\")),\n      ),\n    );\n  if (action === \"msCompletedToday\") {\n    const branch = pickBranch(actor, url.searchParams.get(\"branch\"));\n    return ok(await readMsCompletedToday(env, actor, branch));\n  }\n  if (action === \"msRange\")",
    },
    {
      name: "persist daily completion metadata inside existing live cache",
      from: "    const sourceHash = await sha(canonicalMsSource(mappedRows));\n    const cachedRows = await readMsLiveCache(env, branch, sourceHash);\n    const sync = cachedRows\n      ? {\n          syncedAt: new Date().toISOString(),\n          changes: 0,\n          rows: cachedRows,\n        }\n      : await syncMs(\n          { branch, rows: mappedRows },\n          { username: \"MS_AUTO\", role: \"admin\", branches: [\"*\"] },\n          env,\n        );\n    if (!cachedRows)\n      await safeStatusWrite(\n        writeMsLiveCache(env, branch, sourceHash, sync.rows, sync.syncedAt),\n        \"ms_live_cache_write_error\",\n        branch,\n      );\n    await safeStatusWrite(\n      markConnectionSuccess(env, \"ms_connections\", branch, sync.syncedAt),\n      \"ms_connection_success_write_error\",\n      branch,\n    );\n    const result = {\n      status: \"synced\",\n      syncedAt: sync.syncedAt,\n      changes: sync.changes,\n      rows: sync.rows,\n    };",
      to: "    const sourceHash = await sha(canonicalMsSource(mappedRows));\n    const cache = await readMsLiveCache(env, branch, sourceHash);\n    const sync = cache?.sourceMatch\n      ? {\n          syncedAt: new Date().toISOString(),\n          changes: 0,\n          rows: cache.rows,\n        }\n      : await syncMs(\n          { branch, rows: mappedRows },\n          { username: \"MS_AUTO\", role: \"admin\", branches: [\"*\"] },\n          env,\n        );\n    const completedDay = thaiDay();\n    const priorCompleted =\n      cache?.format === 2 && cache.completedDay === completedDay\n        ? cache.completedRows\n        : await bootstrapCompletedToday(env, branch, completedDay);\n    const completedRows = mergeCompletedToday(priorCompleted, sync.rows, completedDay);\n    if (!cache?.sourceMatch || cache?.format !== 2 || cache?.completedDay !== completedDay)\n      await safeStatusWrite(\n        writeMsLiveCache(\n          env,\n          branch,\n          sourceHash,\n          sync.rows,\n          sync.syncedAt,\n          completedDay,\n          completedRows,\n        ),\n        \"ms_live_cache_write_error\",\n        branch,\n      );\n    await safeStatusWrite(\n      markConnectionSuccess(env, \"ms_connections\", branch, sync.syncedAt),\n      \"ms_connection_success_write_error\",\n      branch,\n    );\n    const result = {\n      status: \"synced\",\n      syncedAt: sync.syncedAt,\n      changes: sync.changes,\n      rows: sync.rows,\n      completedToday: completedRows.length,\n    };",
    },
    {
      name: "upgrade live cache parser to envelope format",
      from: "async function readMsLiveCache(env, hub, sourceHash) {\n  try {\n    const row = await env.DB.prepare(\n      \"SELECT source_hash,rows_json FROM ms_live_cache WHERE hub=?\",\n    )\n      .bind(hub)\n      .first();\n    if (!row || row.source_hash !== sourceHash) return null;\n    const rows = JSON.parse(row.rows_json || \"[]\");\n    return Array.isArray(rows) ? rows : null;\n  } catch (error) {\n    console.error(\n      JSON.stringify({\n        event: \"ms_live_cache_read_error\",\n        hub,\n        message: error.message,\n      }),\n    );\n    return null;\n  }\n}\n\nasync function writeMsLiveCache(env, hub, sourceHash, rows, syncedAt) {\n  return env.DB.prepare(\n    \"INSERT INTO ms_live_cache(hub,source_hash,rows_json,synced_at) VALUES(?,?,?,?) ON CONFLICT(hub) DO UPDATE SET source_hash=excluded.source_hash,rows_json=excluded.rows_json,synced_at=excluded.synced_at\",\n  )\n    .bind(hub, sourceHash, JSON.stringify(rows || []), syncedAt || new Date().toISOString())\n    .run();\n}",
      to: "async function readMsLiveCache(env, hub, sourceHash = \"\") {\n  try {\n    const row = await env.DB.prepare(\n      \"SELECT source_hash,rows_json FROM ms_live_cache WHERE hub=?\",\n    )\n      .bind(hub)\n      .first();\n    if (!row) return null;\n    const parsed = JSON.parse(row.rows_json || \"[]\");\n    const legacy = Array.isArray(parsed);\n    const rows = legacy ? parsed : Array.isArray(parsed?.rows) ? parsed.rows : null;\n    if (!rows) return null;\n    return {\n      format: legacy ? 1 : Number(parsed.version) || 0,\n      sourceMatch: Boolean(sourceHash) && row.source_hash === sourceHash,\n      rows,\n      completedDay: legacy ? \"\" : String(parsed.completedDay || \"\"),\n      completedRows: legacy || !Array.isArray(parsed.completedRows) ? [] : parsed.completedRows,\n    };\n  } catch (error) {\n    console.error(\n      JSON.stringify({\n        event: \"ms_live_cache_read_error\",\n        hub,\n        message: error.message,\n      }),\n    );\n    return null;\n  }\n}\n\nasync function writeMsLiveCache(\n  env,\n  hub,\n  sourceHash,\n  rows,\n  syncedAt,\n  completedDay = \"\",\n  completedRows = [],\n) {\n  const payload = {\n    version: 2,\n    rows: rows || [],\n    completedDay,\n    completedRows: completedRows || [],\n  };\n  return env.DB.prepare(\n    \"INSERT INTO ms_live_cache(hub,source_hash,rows_json,synced_at) VALUES(?,?,?,?) ON CONFLICT(hub) DO UPDATE SET source_hash=excluded.source_hash,rows_json=excluded.rows_json,synced_at=excluded.synced_at\",\n  )\n    .bind(hub, sourceHash, JSON.stringify(payload), syncedAt || new Date().toISOString())\n    .run();\n}",
    },
    {
      name: "add daily completion helpers and history bootstrap",
      from: "async function markConnectionSuccess(env, table, hub, now = new Date().toISOString()) {",
      to: "function thaiDayForValue(value) {\n  const dateValue = new Date(value || \"\");\n  if (Number.isNaN(dateValue.getTime())) return \"\";\n  const parts = new Intl.DateTimeFormat(\"en-CA\", {\n    timeZone: \"Asia/Bangkok\",\n    year: \"numeric\",\n    month: \"2-digit\",\n    day: \"2-digit\",\n  }).formatToParts(dateValue);\n  const item = Object.fromEntries(parts.map((part) => [part.type, part.value]));\n  return `${item.year}-${item.month}-${item.day}`;\n}\n\nfunction isCompletedForThaiDay(row, day) {\n  const attendance = normalizeMsAttendance(row?.attendanceType);\n  return (\n    (attendance === \"ปลายทาง\" || attendance === \"จุดดรอป\") &&\n    Number(row?.unloadingState) === 2 &&\n    thaiDayForValue(row?.unloadingCompletedAt) === day\n  );\n}\n\nfunction mergeCompletedToday(previousRows, liveRows, day) {\n  const latest = new Map();\n  for (const row of previousRows || []) {\n    const id = row?.id || row?.routeId || row?.proofId;\n    if (id && isCompletedForThaiDay(row, day)) latest.set(id, row);\n  }\n  for (const row of liveRows || []) {\n    const id = row?.id || row?.routeId || row?.proofId;\n    if (id && isCompletedForThaiDay(row, day)) latest.set(id, row);\n  }\n  return [...latest.values()];\n}\n\nasync function bootstrapCompletedToday(env, hub, day) {\n  const start = new Date(`${day}T00:00:00+07:00`).toISOString();\n  const history = (\n    await env.DB.prepare(\n      \"SELECT route_id,payload_json,synced_by FROM ms_route_history WHERE hub=? AND snapshot_at>=? ORDER BY snapshot_at ASC\",\n    )\n      .bind(hub, start)\n      .all()\n  ).results;\n  const completed = new Map();\n  for (const item of history) {\n    if (item.synced_by === \"MS_RANGE\") continue;\n    try {\n      const row = JSON.parse(item.payload_json || \"{}\");\n      row.id = row.id || item.route_id;\n      if (row.id && isCompletedForThaiDay(row, day)) completed.set(row.id, row);\n    } catch {}\n  }\n  return [...completed.values()];\n}\n\nasync function readMsCompletedToday(env, actor, hub) {\n  if (!access(hub, actor)) fail(\"ไม่มีสิทธิ์ดู HUB นี้\", \"FORBIDDEN\", 403);\n  const day = thaiDay();\n  const cache = await readMsLiveCache(env, hub);\n  const previous =\n    cache?.format === 2 && cache.completedDay === day\n      ? cache.completedRows\n      : await bootstrapCompletedToday(env, hub, day);\n  const rows = mergeCompletedToday(previous, cache?.rows || [], day);\n  return { hub, day, total: rows.length, rows };\n}\n\nasync function markConnectionSuccess(env, table, hub, now = new Date().toISOString()) {",
    },
  ];

  for (const replacement of replacements)
    output = replaceUnique(output, replacement, "DEV worker patch");

  return output;
}

const DEV_MOBILE_SPACING_MARKER = "/* DEV mobile MS card spacing */";

export function patchDevMsMobileStyle(source) {
  const output = String(source || "");
  if (output.includes(DEV_MOBILE_SPACING_MARKER)) return output;
  return `${output.trimEnd()}\n\n${DEV_MOBILE_SPACING_MARKER}\n@media (max-width: 900px) {\n  .ms-page .compact-schedule {\n    padding: 14px 14px 16px;\n    border-bottom: 0;\n    background: #f4f5f2;\n  }\n  .ms-page .compact-schedule .schedule-section + .schedule-section {\n    margin-top: 12px;\n  }\n  .ms-page .compact-operation {\n    margin: 0 14px 14px;\n    border: 1px solid #d9dcd8;\n    border-radius: 8px;\n    overflow: hidden;\n  }\n  .ms-page .departure-countdown {\n    width: auto;\n    margin: 0 14px 14px;\n  }\n  .ms-page .arrival-sources,\n  .ms-page .source-empty {\n    width: auto;\n    margin: 0 14px 14px;\n  }\n  .ms-page .compact-party {\n    margin-top: 2px;\n    padding: 16px 14px;\n    border-top: 1px solid #d9dcd8;\n  }\n}\n\n@media (max-width: 420px) {\n  .ms-page .compact-operation,\n  .ms-page .departure-countdown,\n  .ms-page .arrival-sources,\n  .ms-page .source-empty {\n    margin-left: 11px;\n    margin-right: 11px;\n  }\n  .ms-page .compact-schedule {\n    padding: 12px 11px 14px;\n  }\n}\n`;
}

const invokedPath = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (invokedPath) {
  const target = process.argv[2] || ".dev-assets/ms.js";
  const source = await readFile(target, "utf8");
  const patched = patchDevMsArchive(source);
  await writeFile(target, patched, "utf8");

  const styleTarget = join(dirname(target), "style.css");
  const styleSource = await readFile(styleTarget, "utf8");
  const patchedStyle = patchDevMsMobileStyle(styleSource);
  await writeFile(styleTarget, patchedStyle, "utf8");

  const workerTarget = process.argv[3];
  if (workerTarget) {
    const workerSource = await readFile(workerTarget, "utf8");
    const patchedWorker = patchDevWorkerCompletedSummary(workerSource);
    await writeFile(workerTarget, patchedWorker, "utf8");
    console.log(`Patched DEV daily completion cache: ${workerTarget}`);
  }

  console.log(`Patched DEV archive loading: ${target}`);
  console.log(`Patched DEV mobile spacing: ${styleTarget}`);
}
