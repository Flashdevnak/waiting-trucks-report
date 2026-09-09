function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  if (first < 0 || first !== output.lastIndexOf(from))
    throw new Error(`MS Schedule completion V4 patch failed: ${label}`);
  return output.replace(from, to);
}

const SCHEDULE_MARKER = "MS_SCHEDULE_COMPLETION_TRUTH_V4";
const DAILY_COUNTS_MARKER = "MS_LOWER_DAILY_COUNTS_0700_V2";
const DAILY_SCHEDULE_MARKER = "MS_DAILY_COMPLETION_TRUSTED_SCHEDULE_V1";
const DAILY_OPERATING_DAY_MARKER = "MS_DAILY_COMPLETION_OPERATING_DAY_0700_V2";
const LEGACY_SCHEDULE_RECOVERY_MARKER =
  "MS_DAILY_COMPLETION_LEGACY_SCHEDULE_RECOVERY_V2";
const DAILY_CACHE_VERSION = 4;

export function patchMsScheduleCompletionV4(source) {
  let output = String(source || "");

  if (!output.includes(SCHEDULE_MARKER)) {
    output = replaceUnique(
      output,
      `        AND COALESCE(h2.event_type,'UPDATED')<>'FIRST_SEEN'
        AND COALESCE(h2.synced_by,'')<>'MS_RANGE'
        AND COALESCE(json_extract(h2.payload_json,'$.unloadingCompletedAt'),'')<>''
        AND CAST(json_extract((
          SELECT h1.payload_json
          FROM ms_route_history h1
          WHERE h1.hub=h2.hub
            AND h1.route_id=h2.route_id
            AND json_valid(h1.payload_json)=1
            AND (h1.snapshot_at<h2.snapshot_at OR (h1.snapshot_at=h2.snapshot_at AND h1.rowid<h2.rowid))
          ORDER BY h1.snapshot_at DESC,h1.rowid DESC
          LIMIT 1
        ),'$.unloadingState') AS INTEGER) IN (0,1)`,
      `        AND COALESCE(json_extract(h2.payload_json,'$.unloadingCompletedAt'),'')<>''
        AND (
          json_extract(h2.payload_json,'$.completionSource')='SCHEDULE'
          OR (
            COALESCE(h2.event_type,'UPDATED')<>'FIRST_SEEN'
            AND COALESCE(h2.synced_by,'')<>'MS_RANGE'
            AND CAST(json_extract((
              SELECT h1.payload_json
              FROM ms_route_history h1
              WHERE h1.hub=h2.hub
                AND h1.route_id=h2.route_id
                AND json_valid(h1.payload_json)=1
                AND (h1.snapshot_at<h2.snapshot_at OR (h1.snapshot_at=h2.snapshot_at AND h1.rowid<h2.rowid))
              ORDER BY h1.snapshot_at DESC,h1.rowid DESC
              LIMIT 1
            ),'$.unloadingState') AS INTEGER) IN (0,1)
          )
        )`,
      "allow authoritative Schedule E or a proven Route transition",
    );
    output = output.replace(
      "// MS_COMPLETION_TIME_TRUTH_V2:",
      `// ${SCHEDULE_MARKER}: Route owns status; Schedule E owns a safely matched completion timestamp.\n// MS_COMPLETION_TIME_TRUTH_V2:`,
    );
  }

  if (!output.includes(DAILY_OPERATING_DAY_MARKER)) {
    output = replaceUnique(
      output,
      `function isCompletedForThaiDay(row, day) {`,
      `// ${DAILY_OPERATING_DAY_MARKER}: Lower daily facts reset at 07:00 Asia/Bangkok.\nfunction lowerOperatingDayForValue(value) {\n  const instant = Date.parse(String(value || ""));\n  if (!Number.isFinite(instant)) return "";\n  return thaiDayForValue(new Date(instant - 7 * 60 * 60 * 1000).toISOString());\n}\n\nfunction lowerOperatingDay() {\n  return lowerOperatingDayForValue(new Date().toISOString());\n}\n\nfunction isCompletedForThaiDay(row, day) {`,
      "add 07:00 operating-day helpers",
    );

    output = replaceUnique(
      output,
      `    const completedDay = thaiDay();`,
      `    const completedDay = lowerOperatingDay();`,
      "live completion cache uses 07:00 operating day",
    );

    output = replaceUnique(
      output,
      `  const day = thaiDay();\n  const cache = await readMsLiveCache(env, hub);`,
      `  const day = lowerOperatingDay();\n  const cache = await readMsLiveCache(env, hub);`,
      "completed endpoint uses 07:00 operating day",
    );

    output = replaceUnique(
      output,
      `  const start = new Date(\`${"${day}T00:00:00+07:00"}\`).toISOString();`,
      `  const start = new Date(\`${"${day}T07:00:00+07:00"}\`).toISOString();`,
      "completion history starts at 07:00",
    );
  }

  if (!output.includes(DAILY_SCHEDULE_MARKER)) {
    output = replaceUnique(
      output,
      `    row?.completionObservedLive === true &&\n    thaiDayForValue(row?.unloadingCompletedAt) === day`,
      `    // ${DAILY_SCHEDULE_MARKER}: daily cards accept observed Route completion or safely matched Schedule E.\n    (row?.completionObservedLive === true || row?.completionSource === "SCHEDULE") &&\n    lowerOperatingDayForValue(row?.unloadingCompletedAt) === day`,
      "daily completion accepts trusted Schedule E on operating day",
    );
  }

  if (!output.includes(LEGACY_SCHEDULE_RECOVERY_MARKER)) {
    output = replaceUnique(
      output,
      `      if (typeof row.completionObservedLive !== "boolean")
        row.completionObservedLive =
          Boolean(row.unloadingCompletedAt) &&
          item.action !== "FIRST_SEEN" && item.synced_by !== "MS_RANGE";
      if (row.id && isCompletedForThaiDay(row, day)) completed.set(row.id, row);`,
      `      // ${LEGACY_SCHEDULE_RECOVERY_MARKER}: old history/cache rows can predate completionSource.
      // When Route says completed and the already-matched Schedule payload has a valid E,
      // recover the trusted completion at read time instead of requiring a later live transition.
      const trustedScheduleCompletedAt =
        Number(row.unloadingState) === 2 &&
        Number.isFinite(
          Date.parse(String(row.scheduleUnloadingCompletedAt || "")),
        )
          ? String(row.scheduleUnloadingCompletedAt)
          : "";
      if (trustedScheduleCompletedAt) {
        row.unloadingCompletedAt = trustedScheduleCompletedAt;
        row.completionSource = "SCHEDULE";
      }
      if (typeof row.completionObservedLive !== "boolean")
        row.completionObservedLive =
          Boolean(row.unloadingCompletedAt) &&
          item.action !== "FIRST_SEEN" && item.synced_by !== "MS_RANGE";
      if (row.id && isCompletedForThaiDay(row, day)) completed.set(row.id, row);`,
      "recover pre-marker completed history from trusted Schedule E",
    );

    output = replaceUnique(
      output,
      `      cache?.format === 2 &&
      cache.completedDay === completedDay &&`,
      `      cache?.format === ${DAILY_CACHE_VERSION} &&
      cache.completedDay === completedDay &&`,
      "invalidate stale daily completion cache during live refresh",
    );
    output = replaceUnique(
      output,
      `        (cache?.format !== 2 ||
          cache?.completedDay !== completedDay ||`,
      `        (cache?.format !== ${DAILY_CACHE_VERSION} ||
          cache?.completedDay !== completedDay ||`,
      "republish recovered daily completion cache",
    );
    output = replaceUnique(
      output,
      `    cache?.format === 2 &&
    cache.completedDay === day &&`,
      `    cache?.format === ${DAILY_CACHE_VERSION} &&
    cache.completedDay === day &&`,
      "invalidate stale daily completion cache in completed endpoint",
    );
    output = replaceUnique(
      output,
      `    version: 2,`,
      `    version: ${DAILY_CACHE_VERSION},`,
      "bump daily completion cache envelope",
    );
  }

  if (output.includes(`// ${DAILY_COUNTS_MARKER}: staged worker`)) return output;

  output = replaceUnique(
    output,
    `  if (action === "msCompletedToday") {
    const branch = pickBranch(actor, url.searchParams.get("branch"));
    return ok(await readMsCompletedToday(env, actor, branch));
  }
  if (action === "msRange")`,
    `  if (action === "msCompletedToday") {
    const branch = pickBranch(actor, url.searchParams.get("branch"));
    return ok(await readMsCompletedToday(env, actor, branch));
  }
  if (action === "msCancelledToday") {
    const branch = pickBranch(actor, url.searchParams.get("branch"));
    return ok(await readMsCancelledToday(env, actor, branch));
  }
  if (action === "msRange")`,
    "add read-only cancelled daily endpoint",
  );

  output = replaceUnique(
    output,
    `// completion cache only trusts observed live unloading transitions
async function markConnectionSuccess(env, table, hub, now = new Date().toISOString()) {`,
    `async function readMsCancelledToday(env, actor, hub) {
  if (!access(hub, actor)) fail("ไม่มีสิทธิ์ดู HUB นี้", "FORBIDDEN", 403);
  const day = lowerOperatingDay();
  const start = new Date(\`${"${day}T07:00:00+07:00"}\`).toISOString();
  const end = new Date(Date.parse(start) + 86400000).toISOString();
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM ms_route_cancellations WHERE hub=? AND cancelled_at>=? AND cancelled_at<?",
  )
    .bind(hub, start, end)
    .first();
  return { hub, day, total: Number(row?.total) || 0 };
}

// ${DAILY_COUNTS_MARKER}: staged worker exposes lower daily facts on the 07:00 -> 07:00 Bangkok operating day.
// completion cache only trusts observed live unloading transitions
async function markConnectionSuccess(env, table, hub, now = new Date().toISOString()) {`,
    "add authoritative cancelled operating-day count",
  );

  return output;
}
