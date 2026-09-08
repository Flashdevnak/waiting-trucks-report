export const MS_SNAPSHOT_KEYS = [
  "id", "hub", "proofId", "routeName", "region", "routeAttribute",
  "routeType", "attendanceType", "estimatedArrivalAt", "actualArrivalAt",
  "estimatedDepartureAt", "actualDepartureAt", "supplier", "vehicleType",
  "plate", "driverName", "driverPhone", "trackingStatus", "vehicleStatus",
  "loadStatus", "unloadingState", "unloadingCompletedAt", "sourceUpdatedAt",
  "expectedParcels", "enteredParcels", "pendingParcels",
  "scheduleKitArrivalAt", "scheduleTbrArrivalAt", "arrivedParcels",
  "arrivedBags", "scheduleUnloadingStartedAt", "scheduleUnloadingCompletedAt",
  "completionSource",
];

export const MS_SOURCE_KEYS = MS_SNAPSHOT_KEYS.filter(
  (key) => !["id", "hub", "unloadingCompletedAt"].includes(key),
);

function previousUnloadingState(row) {
  const value = row?.unloading_state ?? row?.unloadingState;
  if (value === "" || value === null || value === undefined) return null;
  const state = Number(value);
  return Number.isFinite(state) ? state : null;
}

function previousCompletionAt(row) {
  return row?.unloading_completed_at ?? row?.unloadingCompletedAt ?? "";
}

export function isObservedUnloadingTransition(previousRow, nextState) {
  const next = Number(nextState);
  const previous = previousUnloadingState(previousRow);
  return next === 2 && (previous === 0 || previous === 1);
}

export function resolveUnloadingCompletedAt(previousRow, nextState, observedAt) {
  const next = Number(nextState);
  if (next !== 2) return "";

  const prior = String(previousCompletionAt(previousRow) || "");
  if (Number.isFinite(Date.parse(prior))) return prior;

  if (!isObservedUnloadingTransition(previousRow, next)) return "";
  const observed = String(observedAt || "");
  return Number.isFinite(Date.parse(observed)) ? observed : "";
}

export function resolveCompletionTruth(previousRow, nextState, scheduleAt, observedAt) {
  if (Number(nextState) !== 2) return { at: "", source: "UNKNOWN" };
  const schedule = String(scheduleAt || "");
  if (Number.isFinite(Date.parse(schedule)))
    return { at: schedule, source: "SCHEDULE" };
  const prior = String(previousCompletionAt(previousRow) || "");
  if (Number.isFinite(Date.parse(prior)))
    return {
      at: prior,
      source: String(previousRow?.completionSource || "OBSERVED_ROUTE_TRANSITION"),
    };
  const observed = resolveUnloadingCompletedAt(previousRow, nextState, observedAt);
  return observed
    ? { at: observed, source: "OBSERVED_ROUTE_TRANSITION" }
    : { at: "", source: "UNKNOWN" };
}

export function canonicalMsSource(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) =>
      JSON.stringify(
        MS_SOURCE_KEYS.map((key) => String(row?.[key] ?? "")),
      ),
    )
    .sort()
    .join("\n");
}

export function sameMsSnapshot(oldRow, nextRow) {
  return MS_SNAPSHOT_KEYS.every(
    (key) => String(oldRow?.[key] ?? "") === String(nextRow?.[key] ?? ""),
  );
}

export function planMsChanges(oldRows, nextRows, preserveMissing = false) {
  const oldById = new Map(oldRows.map((row) => [row.id, row]));
  const nextById = new Map(nextRows.map((row) => [row.id, row]));
  const changedIds = nextRows
    .filter((row) => !oldById.has(row.id) || !sameMsSnapshot(oldById.get(row.id), row))
    .map((row) => row.id);
  const removedIds = preserveMissing
    ? []
    : oldRows.filter((row) => !nextById.has(row.id)).map((row) => row.id);
  return { changedIds, removedIds };
}

export function shouldWriteSuccessHeartbeat(
  lastSuccessAt,
  lastError,
  nowMs,
  intervalMs,
) {
  if (String(lastError || "")) return true;
  const last = Date.parse(String(lastSuccessAt || ""));
  return !Number.isFinite(last) || nowMs - last >= intervalMs;
}

export function shouldWriteError(previousError, nextError) {
  return String(previousError || "") !== String(nextError || "");
}
