// DEV PNO inbound evidence from the existing shared detail observation.
// This module never calls a provider or scans parcels in the background.
export const PNO_SCAN_CLASSES = Object.freeze({
  CONFIRMED: "CONFIRMED_SCAN_IN",
  SUSPECTED: "SUSPECTED_SCAN_IN_GAP",
  INSUFFICIENT: "INSUFFICIENT_HISTORY",
  NOT_YET: "NOT_YET_SCAN_IN_STAGE",
});

const ACTIONS = new Set([
  "ARRIVAL_GOODS_VAN_CHECK_SCAN", "ARRIVAL_WAREHOUSE_SCAN",
  "SHIPMENT_WAREHOUSE_SCAN", "SEAL", "DRIVER_SIGN",
  "DEPARTURE_GOODS_VAN_CK_SCAN", "RECEIVE_WAREHOUSE_SCAN", "RECEIVED",
]);
const ARRIVAL = "ARRIVAL_GOODS_VAN_CHECK_SCAN";
const SCAN_IN = "ARRIVAL_WAREHOUSE_SCAN";
const KEY_PREFIX = "pno-inbound-evidence-v1:";

export function pnoProviderTime(value) {
  const match = String(value ?? "").trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/);
  if (!match) return "";
  const normalized = `${match[1]} ${match[2]}`;
  const millis = Date.parse(`${match[1]}T${match[2]}+07:00`);
  if (!Number.isFinite(millis) || new Date(millis + 7 * 3600000).toISOString().slice(0, 19).replace("T", " ") !== normalized)
    return "";
  return normalized;
}

function sourceIdentity(locator, row) {
  const hub = String(locator?.hub || "").trim().toUpperCase();
  const proofId = String(locator?.proofId || "").trim().toUpperCase();
  const day = String(locator?.day || "").trim();
  const lineId = String(locator?.lineId || locator?.vanLineId || "").trim();
  const sourceStoreId = String(locator?.storeId || "").trim();
  const targetStoreId = String(locator?.nextStoreId || "").trim();
  const pno = String(row?.pno || "").trim().toUpperCase();
  if (!hub || !proofId || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !lineId ||
      !sourceStoreId || !targetStoreId || !pno) return null;
  return { hub, proofId, day, lineId, sourceStoreId, targetStoreId, pno };
}

async function digestKey(parts) {
  const data = new TextEncoder().encode(JSON.stringify(parts));
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return KEY_PREFIX + [...bytes].map((v) => v.toString(16).padStart(2, "0")).join("");
}

export async function pnoEvidenceKeys(locator, row) {
  const identity = sourceIdentity(locator, row);
  if (!identity) return null;
  const components = Object.values(identity);
  const anchor = pnoProviderTime(row?.real_arrive_time);
  return {
    identity,
    anchor,
    base: await digestKey(["base", ...components]),
    occurrence: anchor ? await digestKey(["occurrence", ...components, anchor]) : "",
  };
}

export function matchPnoHistoryArrival(locator, row, events) {
  const anchor = pnoProviderTime(row?.real_arrive_time);
  const store = String(row?.store_id || "").trim();
  if (!sourceIdentity(locator, row) || !anchor || !store ||
      store !== String(locator?.nextStoreId || "").trim() || !Array.isArray(events)) return false;
  return events.some((event) => event?.route_action === ARRIVAL &&
    String(event?.store_id || "").trim() === store &&
    pnoProviderTime(event?.routed_at) === anchor);
}

export function projectPnoEvidence(record, { asOf } = {}) {
  const cutoff = asOf == null ? Infinity : Date.parse(asOf);
  if (!Number.isFinite(cutoff) && cutoff !== Infinity)
    return { classification: PNO_SCAN_CLASSES.INSUFFICIENT, reason: "INVALID_AS_OF" };
  if (!record || typeof record !== "object")
    return { classification: PNO_SCAN_CLASSES.INSUFFICIENT, reason: "NO_OBSERVATION" };
  if (Date.parse(record.monitoringStartedAt || "") > cutoff)
    return { classification: PNO_SCAN_CLASSES.INSUFFICIENT, reason: "NOT_YET_OBSERVED" };
  const positiveKnown = record.scanInObserved === true &&
    Date.parse(record.scanInObservedAt || "") <= cutoff;
  if (positiveKnown) return {
    classification: PNO_SCAN_CLASSES.CONFIRMED, reason: "POSITIVE_CURRENT_OCCURRENCE_SCAN",
    scanInAction: record.scanInAction, scanInEventAt: record.scanInEventAt,
    scanInObservedAt: record.scanInObservedAt, scanInSource: record.scanInSource,
  };
  const latestKnown = Date.parse(record.lastObservedAt || "") <= cutoff;
  if (!latestKnown) return { classification: PNO_SCAN_CLASSES.INSUFFICIENT, reason: "NOT_YET_OBSERVED" };
  if (record.preArrivalStageObserved === true && record.arrivalStageObserved !== true &&
      record.downstreamObserved !== true)
    return { classification: PNO_SCAN_CLASSES.NOT_YET, reason: "POSITIVE_PRE_ARRIVAL_STAGE" };
  // A current downstream action cannot reveal an earlier scan that occurred
  // before observation began or within an unverified interval. Only an
  // explicit continuity attestation covering this occurrence can support a gap.
  if (record.downstreamObserved === true) {
    if (record.monitoringBeforeArrival === true && record.coverageState === "COMPLETE_LOCAL")
      return { classification: PNO_SCAN_CLASSES.SUSPECTED, reason: "SCAN_IN_STATE_ABSENT_AT_REQUIRED_STAGE" };
    return { classification: PNO_SCAN_CLASSES.INSUFFICIENT,
      reason: record.coverageState === "LATE_START" ? "LATE_START_SCAN_STATE_UNKNOWN" : "OBSERVATION_WINDOW_NOT_COVERED" };
  }
  if (record.arrivalStageObserved === true)
    return { classification: PNO_SCAN_CLASSES.NOT_YET, reason: "ARRIVAL_BEFORE_SCAN_IN_STAGE" };
  return { classification: PNO_SCAN_CLASSES.INSUFFICIENT, reason: "OBSERVATION_STAGE_UNKNOWN" };
}

// Pure reducer. Absence of remembered scan-in is a gap only if the exact
// occurrence also has a verified complete observation window and downstream stage.
export function observePnoSnapshot(previous, locator, row, observedAt, { monitoringStartedAt, coverageComplete = false } = {}) {
  const identity = sourceIdentity(locator, row);
  const anchor = pnoProviderTime(row?.real_arrive_time);
  const eventAt = pnoProviderTime(row?.LastActionTime);
  const action = String(row?.LastAction || "").trim();
  const store = String(row?.store_id || "").trim();
  if (!identity || !anchor || !eventAt || !ACTIONS.has(action) ||
      store !== identity.targetStoreId || eventAt < anchor || !Number.isFinite(Date.parse(observedAt)))
    return { record: previous || null, changed: false,
      view: { classification: PNO_SCAN_CLASSES.INSUFFICIENT, reason: "OCCURRENCE_OR_SOURCE_INVALID" } };
  if (previous && previous.arrivalAnchorAt !== anchor)
    return { record: previous, changed: false,
      view: { classification: PNO_SCAN_CLASSES.INSUFFICIENT, reason: "OCCURRENCE_MISMATCH" } };
  if (previous && previous.latestObservedAction === action && previous.latestObservedActionAt === eventAt)
    return { record: previous, changed: false, view: projectPnoEvidence(previous) };
  const start = previous?.monitoringStartedAt || monitoringStartedAt || observedAt;
  const anchorMillis = Date.parse(anchor.replace(" ", "T") + "+07:00");
  const monitoringBeforeArrival = Date.parse(start) <= anchorMillis;
  const latestIsNewer = !previous?.latestObservedActionAt || eventAt >= previous.latestObservedActionAt;
  const record = {
    occurrence: { hub: identity.hub, proofId: identity.proofId, day: identity.day,
      lineId: identity.lineId, sourceStoreId: identity.sourceStoreId,
      targetStoreId: identity.targetStoreId },
    arrivalAnchorAt: anchor, monitoringStartedAt: start,
    monitoringBeforeArrival, lastObservedAt: observedAt,
    latestObservedAction: latestIsNewer ? action : previous.latestObservedAction,
    latestObservedActionAt: latestIsNewer ? eventAt : previous.latestObservedActionAt,
    arrivalStageObserved: previous?.arrivalStageObserved === true ||
      (action === ARRIVAL && eventAt === anchor),
    downstreamObserved: previous?.downstreamObserved === true ||
      (action !== ARRIVAL && action !== SCAN_IN && eventAt > anchor),
    preArrivalStageObserved: previous?.preArrivalStageObserved === true,
    scanInObserved: previous?.scanInObserved === true || action === SCAN_IN,
    scanInAction: previous?.scanInAction || (action === SCAN_IN ? action : null),
    scanInEventAt: previous?.scanInEventAt || (action === SCAN_IN ? eventAt : null),
    scanInObservedAt: previous?.scanInObservedAt || (action === SCAN_IN ? observedAt : null),
    scanInSource: previous?.scanInSource || (action === SCAN_IN ? "FOLLOWSTART_LIST_SNAPSHOT" : null),
    // Any unverified interval clears a prior continuity attestation. A later
    // detail snapshot cannot retroactively fill a missed observation window.
    coverageState: !monitoringBeforeArrival ? "LATE_START" :
      coverageComplete === true ? "COMPLETE_LOCAL" : "UNKNOWN",
  };
  return { record, changed: true, view: projectPnoEvidence(record) };
}

// In the shared per-HUB Durable Object. A page read is already coalesced and
// cached upstream; the evidence operation does no network I/O.
export async function observePnoEvidencePage(storage, locator, rawRows, observedAt) {
  if (!storage || !Array.isArray(rawRows) || rawRows.length > 200)
    return (Array.isArray(rawRows) ? rawRows : []).map(() =>
      ({ classification: PNO_SCAN_CLASSES.INSUFFICIENT, reason: "SOURCE_UNAVAILABLE" }));
  const keys = await Promise.all(rawRows.map((row) => pnoEvidenceKeys(locator, row)));
  const requested = [...new Set(keys.flatMap((key) => key ? [key.base, key.occurrence].filter(Boolean) : []))];
  // Different detail tabs may fetch concurrently. The transaction prevents a
  // later downstream snapshot from overwriting a concurrently accepted scan.
  return storage.transaction(async (txn) => {
    const saved = new Map();
    for (let start = 0; start < requested.length; start += 128) {
      const batch = await txn.get(requested.slice(start, start + 128));
      for (const [key, value] of batch) saved.set(key, value);
    }
    const updates = {};
    const views = rawRows.map((row, index) => {
      const key = keys[index];
      if (!key) return { classification: PNO_SCAN_CLASSES.INSUFFICIENT, reason: "LOCATOR_INCOMPLETE" };
      const previousBase = updates[key.base] || saved.get(key.base) || null;
      if (!key.anchor) {
        // A successful detail observation before vehicle arrival starts the
        // monitoring window; it cannot be treated as evidence of scan-in.
        const preArrival = String(row?.store_id || "").trim() === key.identity.sourceStoreId &&
          ACTIONS.has(String(row?.LastAction || "").trim()) &&
          Boolean(pnoProviderTime(row?.LastActionTime));
        if (!previousBase && preArrival)
          updates[key.base] = { monitoringStartedAt: observedAt, activeAnchor: "" };
        return preArrival
          ? { classification: PNO_SCAN_CLASSES.NOT_YET, reason: "ARRIVAL_NOT_YET_RECORDED" }
          : { classification: PNO_SCAN_CLASSES.INSUFFICIENT, reason: "ARRIVAL_ANCHOR_MISSING" };
      }
      const previous = updates[key.occurrence] || saved.get(key.occurrence) || null;
      const preStart = !previousBase?.activeAnchor ? previousBase?.monitoringStartedAt : null;
      const outcome = observePnoSnapshot(previous, locator, row, observedAt,
        { monitoringStartedAt: preStart });
      if (outcome.changed) {
        updates[key.occurrence] = outcome.record;
        updates[key.base] = { monitoringStartedAt: outcome.record.monitoringStartedAt,
          activeAnchor: key.anchor };
      }
      return outcome.view;
    });
    const entries = Object.entries(updates).filter(([key, value]) =>
      JSON.stringify(saved.get(key)) !== JSON.stringify(value));
    for (let start = 0; start < entries.length; start += 128)
      await txn.put(Object.fromEntries(entries.slice(start, start + 128)));
    return views;
  });
}

// Accept only a result from an explicit exact WaybillDetail read. This helper
// performs no acquisition; the caller must pass the current detail row and the
// already received history together. Persist only the matched positive fact.
export async function ingestPnoExactHistory(storage, locator, row, response, observedAt) {
  const unavailable = { classification: PNO_SCAN_CLASSES.INSUFFICIENT, reason: "HISTORY_OCCURRENCE_UNVERIFIED" };
  const key = await pnoEvidenceKeys(locator, row);
  const result = response?.data?.result ?? response?.result ?? response;
  const events = result?.parcel_routes;
  const snapshot = observePnoSnapshot(null, locator, row, observedAt);
  if (!storage || !key?.occurrence || !snapshot.changed ||
      String(result?.parcel_info?.pno || "").trim().toUpperCase() !== key.identity.pno ||
      !Array.isArray(events) || events.length > 500 ||
      !matchPnoHistoryArrival(locator, row, events)) return unavailable;

  const targetStore = key.identity.targetStoreId;
  const lastActionAt = pnoProviderTime(row?.LastActionTime);
  const scanAt = events.map((event) => {
    if (event?.route_action !== SCAN_IN ||
        String(event?.store_id || "").trim() !== targetStore) return "";
    const at = pnoProviderTime(event?.routed_at);
    return at >= key.anchor && at <= lastActionAt ? at : "";
  }).filter(Boolean).sort()[0];
  if (!scanAt || Date.parse(observedAt) < Date.parse(scanAt.replace(" ", "T") + "+07:00"))
    return unavailable;

  return storage.transaction(async (txn) => {
    const saved = await txn.get([key.occurrence]);
    const previous = saved.get(key.occurrence) || null;
    const outcome = observePnoSnapshot(previous, locator, row, observedAt);
    if (outcome.view.reason === "OCCURRENCE_MISMATCH" ||
        outcome.view.reason === "OCCURRENCE_OR_SOURCE_INVALID") return unavailable;
    if (!outcome.record) return unavailable;
    const before = JSON.stringify(previous);
    const record = { ...outcome.record };
    if (record.scanInObserved !== true) {
      record.scanInObserved = true;
      record.scanInAction = SCAN_IN;
      record.scanInEventAt = scanAt;
      record.scanInObservedAt = observedAt;
      record.scanInSource = "EXPLICIT_WAYBILL_HISTORY";
    }
    if (before !== JSON.stringify(record))
      await txn.put({ [key.occurrence]: record });
    return projectPnoEvidence(record);
  });
}
