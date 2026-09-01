export const MS_SNAPSHOT_KEYS = [
  "id", "hub", "proofId", "routeName", "region", "routeAttribute",
  "routeType", "attendanceType", "estimatedArrivalAt", "actualArrivalAt",
  "estimatedDepartureAt", "actualDepartureAt", "supplier", "vehicleType",
  "plate", "driverName", "driverPhone", "trackingStatus", "vehicleStatus",
  "loadStatus", "unloadingState", "unloadingCompletedAt", "sourceUpdatedAt",
  "expectedParcels", "enteredParcels", "pendingParcels",
  "scheduleKitArrivalAt", "scheduleTbrArrivalAt", "arrivedParcels",
  "arrivedBags",
];

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
