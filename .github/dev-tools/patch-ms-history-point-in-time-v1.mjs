const MARKER = "MS_COMPLETION_HISTORY_CUTOFF_V1";

function replaceUnique(source, from, to, label) {
  const first = source.indexOf(from);
  const last = source.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`MS point-in-time history patch failed: ${label}`);
  return source.replace(from, to);
}

export function patchMsHistoryPointInTimeWorker(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;

  const verifiedStart = output.indexOf(
    "async function verifiedCompletionRouteIds(env, hub) {",
  );
  const verifiedEnd = output.indexOf(
    "\nasync function ensureMsCompletionRepair",
    verifiedStart,
  );
  if (verifiedStart < 0 || verifiedEnd <= verifiedStart)
    throw new Error("MS point-in-time history patch failed: completion verifier");

  let verified = output.slice(verifiedStart, verifiedEnd);
  verified = replaceUnique(
    verified,
    "async function verifiedCompletionRouteIds(env, hub) {",
    `async function verifiedCompletionRouteIds(env, hub, snapshotCutoff = "") {
  // ${MARKER}: completion evidence for a historical report is bounded by the
  // same selected-range cutoff as its route snapshot.
  const cutoff = Number.isFinite(Date.parse(String(snapshotCutoff || "")))
    ? new Date(snapshotCutoff).toISOString()
    : "";`,
    "completion verifier signature",
  );
  verified = replaceUnique(
    verified,
    "WHERE hub=? AND json_valid(payload_json)=1",
    "WHERE hub=? AND (?='' OR snapshot_at<=?) AND json_valid(payload_json)=1",
    "completion verifier cutoff predicate",
  );
  verified = replaceUnique(
    verified,
    ").bind(hub).all();",
    ").bind(hub, cutoff, cutoff).all();",
    "completion verifier cutoff binding",
  );
  output = output.slice(0, verifiedStart) + verified + output.slice(verifiedEnd);

  const dailyStart = output.indexOf(
    "async function msDailyArchive(env, actor, hub, startValue, endValue)",
  );
  const dailyEnd = output.indexOf("\nasync function msArchiveTotal", dailyStart);
  if (dailyStart < 0 || dailyEnd <= dailyStart)
    throw new Error("MS point-in-time history patch failed: daily archive");
  let daily = output.slice(dailyStart, dailyEnd);
  daily = replaceUnique(
    daily,
    "verifiedCompletionRouteIds(env, hub)",
    "verifiedCompletionRouteIds(env, hub, historyCutoff)",
    "daily completion cutoff",
  );
  output = output.slice(0, dailyStart) + daily + output.slice(dailyEnd);
  return output;
}
