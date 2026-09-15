const MARKER = "MS_TRANSIENT_EMPTY_SOURCE_GUARD_V1";

export function patchMsTransientEmptyGuardWorker(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;

  const runMarker = "async function runMsRefresh(env, branch) {";
  if (!output.includes(runMarker))
    throw new Error("transient-empty worker guard: runMsRefresh missing");

  const helpers = `// ${MARKER}: a single successful-but-empty MS response must not erase a non-empty accepted cache.
// Confirmation uses the next existing source cycle. No extra upstream call or healthy-state DB read/write.
const msTransientEmptySource = new Map();
const MS_TRANSIENT_EMPTY_CONFIRM_WINDOW_MS = 2 * 60 * 1000;
async function holdTransientEmptyMsSource(env, branch, mappedRows) {
  if (Array.isArray(mappedRows) && mappedRows.length > 0) {
    msTransientEmptySource.delete(branch);
    return null;
  }
  let row;
  try {
    row = await env.DB.prepare(
      "SELECT rows_json,synced_at FROM ms_live_cache WHERE hub=?",
    ).bind(branch).first();
  } catch {
    return null;
  }
  let acceptedRows = [];
  try { acceptedRows = JSON.parse(row?.rows_json || "[]"); } catch {}
  if (!Array.isArray(acceptedRows) || acceptedRows.length === 0) {
    msTransientEmptySource.delete(branch);
    return null;
  }
  const now = Date.now();
  const previous = msTransientEmptySource.get(branch);
  if (previous && now - previous.at <= MS_TRANSIENT_EMPTY_CONFIRM_WINDOW_MS) {
    msTransientEmptySource.delete(branch);
    return null;
  }
  msTransientEmptySource.set(branch, { at: now });
  return { rows: acceptedRows, syncedAt: String(row?.synced_at || "") };
}

`;
  output = output.replace(runMarker, helpers + runMarker);

  const start = output.indexOf(runMarker);
  const end = output.indexOf("\nasync function readMsLiveCache", start);
  if (start < 0 || end < 0)
    throw new Error("transient-empty worker guard: runMsRefresh section missing");
  let section = output.slice(start, end);
  const anchor = "    const sourceHash = await sha(canonicalMsSource(mappedRows));";
  if (!section.includes(anchor))
    throw new Error("transient-empty worker guard: sourceHash anchor missing");
  section = section.replace(
    anchor,
    `    const transientEmptyHold = await holdTransientEmptyMsSource(env, branch, mappedRows);
    if (transientEmptyHold) {
      const result = {
        status: "degraded",
        syncedAt: transientEmptyHold.syncedAt || "",
        changes: 0,
        rows: transientEmptyHold.rows,
        transientEmptyHeld: true,
        error: "MS ส่งข้อมูลว่างชั่วคราว ระบบคงข้อมูลล่าสุดและรอยืนยันรอบถัดไป",
      };
      recentMsSync.set(branch, { until: Date.now() + MS_SYNC_TTL, result });
      return result;
    }
    ${anchor}`,
  );
  output = output.slice(0, start) + section + output.slice(end);
  return output;
}
