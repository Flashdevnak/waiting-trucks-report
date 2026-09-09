function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  if (first < 0 || first !== output.lastIndexOf(from))
    throw new Error(`MS Schedule completion V4 patch failed: ${label}`);
  return output.replace(from, to);
}

function replaceCount(output, from, to, expected, label) {
  const parts = output.split(from);
  const count = parts.length - 1;
  if (count !== expected)
    throw new Error(`MS Schedule completion V4 patch failed: ${label} (expected ${expected}, got ${count})`);
  return parts.join(to);
}

const SCHEDULE_MARKER = "MS_SCHEDULE_COMPLETION_TRUTH_V4";
const DAILY_COUNTS_MARKER = "MS_LOWER_DAILY_COUNTS_0700_V1";

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

  if (output.includes(`// ${DAILY_COUNTS_MARKER}: staged worker`)) return output;

  output = replaceUnique(
    output,
    `function thaiDayForValue(value) {
  const dateValue = new Date(value || "");
  if (Number.isNaN(dateValue.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(dateValue);`,
    `function thaiDayForValue(value) {
  const dateValue = new Date(value || "");
  if (Number.isNaN(dateValue.getTime())) return "";
  // ${DAILY_COUNTS_MARKER}: Lower operational day rolls at 07:00 Bangkok, not midnight.
  const operatingDateValue = new Date(dateValue.getTime() - 7 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(operatingDateValue);`,
    "shift lower daily completion key to 07:00",
  );

  output = replaceCount(
    output,
    `const completedDay = thaiDay();`,
    `const completedDay = thaiDayForValue(new Date());`,
    1,
    "refresh completion operating-day key",
  );

  output = replaceCount(
    output,
    `const day = thaiDay();`,
    `const day = thaiDayForValue(new Date());`,
    1,
    "completed endpoint operating-day key",
  );

  output = replaceUnique(
    output,
    `const start = new Date(\`${"${day}T00:00:00+07:00"}\`).toISOString();`,
    `const start = new Date(\`${"${day}T07:00:00+07:00"}\`).toISOString();`,
    "completion bootstrap starts at 07:00",
  );

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
  const day = thaiDayForValue(new Date());
  const start = new Date(\`${"${day}T07:00:00+07:00"}\`).toISOString();
  const end = new Date(Date.parse(start) + 86400000).toISOString();
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM ms_route_cancellations WHERE hub=? AND cancelled_at>=? AND cancelled_at<?",
  )
    .bind(hub, start, end)
    .first();
  return { hub, day, total: Number(row?.total) || 0 };
}

// ${DAILY_COUNTS_MARKER}: staged worker exposes lower daily facts without extra MS polling.
// completion cache only trusts observed live unloading transitions
async function markConnectionSuccess(env, table, hub, now = new Date().toISOString()) {`,
    "add authoritative cancelled operating-day count",
  );

  return output;
}
