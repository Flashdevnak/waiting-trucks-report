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
const ARRIVAL_ACTIONS = new Set(["ARRIVAL_GOODS_VAN_CHECK_SCAN", "DRIVER_SIGN"]);
const SCAN_IN = "ARRIVAL_WAREHOUSE_SCAN";
const TRUSTED_SCAN_SOURCE = "EXPLICIT_WAYBILL_HISTORY";
const UNRESOLVED_SCAN_LOCATION = "LOCATION_OR_OCCURRENCE_UNRESOLVED";
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

export function pnoIdentityDiagnostics(locator, row) {
  const issues = [];
  for (const [field, value] of Object.entries({
    hub: locator?.hub, proofId: locator?.proofId, day: locator?.day,
    lineId: locator?.lineId || locator?.vanLineId, sourceStoreId: locator?.storeId,
    targetStoreId: locator?.nextStoreId, pno: row?.pno,
  })) {
    if (!String(value || "").trim()) issues.push({ field, issue: "MISSING" });
    else if (field === "day" && !/^\d{4}-\d{2}-\d{2}$/.test(String(value).trim()))
      issues.push({ field, issue: "INVALID" });
  }
  return issues;
}

function sourceIdentity(locator, row) {
  const hub = String(locator?.hub || "").trim().toUpperCase();
  const proofId = String(locator?.proofId || "").trim().toUpperCase();
  const day = String(locator?.day || "").trim();
  const lineId = String(locator?.lineId || locator?.vanLineId || "").trim();
  const sourceStoreId = String(locator?.storeId || "").trim();
  const targetStoreId = String(locator?.nextStoreId || "").trim();
  const pno = String(row?.pno || "").trim().toUpperCase();
  if (pnoIdentityDiagnostics(locator, row).length) return null;
  return { hub, proofId, day, lineId, sourceStoreId, targetStoreId, pno };
}

async function digestKey(parts) {
  const data = new TextEncoder().encode(JSON.stringify(parts));
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return KEY_PREFIX + [...bytes].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function earliestPnoArrival(...values) {
  return values.map(pnoProviderTime).filter(Boolean).sort()[0] || "";
}

function snapshotArrival(row) {
  const action = String(row?.LastAction || "").trim();
  return earliestPnoArrival(row?.real_arrive_time,
    ARRIVAL_ACTIONS.has(action) ? row?.LastActionTime : null);
}

async function legacyOccurrenceKey(identity, anchor) {
  const accepted = pnoProviderTime(anchor);
  return accepted ? digestKey(["occurrence", ...Object.values(identity), accepted]) : "";
}

async function readEvidenceKeys(storage, keys, saved) {
  const requested = [...new Set(keys.filter(Boolean))];
  for (let start = 0; start < requested.length; start += 128) {
    const batch = await storage.get(requested.slice(start, start + 128));
    for (const [key, value] of batch) saved.set(key, value);
  }
}

function acceptedRecord(saved, key, base) {
  const current = saved.get(key.occurrence);
  if (current) return current;
  const legacy = saved.get(key.legacyOccurrence) || saved.get(base?.legacyOccurrence);
  // A legacy arrival-keyed record was read through this exact seven-part
  // identity. Attach that identity before comparing an earlier arrival time.
  return legacy && { ...legacy, occurrence: legacy.occurrence || key.identity };
}

export async function pnoEvidenceKeys(locator, row) {
  const identity = sourceIdentity(locator, row);
  if (!identity) return null;
  const components = Object.values(identity);
  const anchor = snapshotArrival(row);
  return {
    identity,
    anchor,
    base: await digestKey(["base", ...components]),
    // Arrival time is evidence within this identity, not part of its identity.
    occurrence: await digestKey(["occurrence-v2", ...components]),
    legacyOccurrence: await legacyOccurrenceKey(identity,
      pnoProviderTime(row?.real_arrive_time)),
  };
}

function historyArrivalTimes(locator, row, events) {
  const identity = sourceIdentity(locator, row);
  if (!identity || !Array.isArray(events) ||
      String(row?.store_id || "").trim() !== identity.targetStoreId) return [];
  return events.filter((event) => ARRIVAL_ACTIONS.has(event?.route_action) &&
    String(event?.store_id || "").trim() === identity.targetStoreId)
    .map((event) => pnoProviderTime(event?.routed_at)).filter(Boolean);
}

export function matchPnoHistoryArrival(locator, row, events, acceptedAnchorAt) {
  const known = [pnoProviderTime(row?.real_arrive_time),
    ARRIVAL_ACTIONS.has(String(row?.LastAction || "").trim())
      ? pnoProviderTime(row?.LastActionTime) : "",
    pnoProviderTime(acceptedAnchorAt)].filter(Boolean);
  return known.length > 0 &&
    historyArrivalTimes(locator, row, events).some((time) => known.includes(time));
}

export function projectPnoEvidence(record, { asOf } = {}) {
  const cutoff = asOf == null ? Infinity : Date.parse(asOf);
  if (!Number.isFinite(cutoff) && cutoff !== Infinity)
    return { classification: PNO_SCAN_CLASSES.INSUFFICIENT, reason: "INVALID_AS_OF" };
  if (!record || typeof record !== "object")
    return { classification: PNO_SCAN_CLASSES.INSUFFICIENT, reason: "NO_OBSERVATION" };
  if (Date.parse(record.monitoringStartedAt || "") > cutoff)
    return { classification: PNO_SCAN_CLASSES.INSUFFICIENT, reason: "NOT_YET_OBSERVED" };
  // Old exact-history writes checked the event's store against this exact
  // occurrence before recording their source. Snapshot store_id has no proven
  // LastAction-location semantics, so neither it nor an unknown source is a
  // trusted positive. New history writes also retain the checked event store.
  const trustedPositive = record.scanInObserved === true &&
    record.scanInSource === TRUSTED_SCAN_SOURCE &&
    record.scanInAction === SCAN_IN && Boolean(pnoProviderTime(record.scanInEventAt)) &&
    Boolean(String(record.occurrence?.targetStoreId || "").trim()) &&
    (record.scanInStoreId == null ||
      String(record.scanInStoreId).trim() === record.occurrence.targetStoreId);
  const positiveKnown = trustedPositive &&
    Date.parse(record.scanInObservedAt || "") <= cutoff;
  if (positiveKnown) return {
    classification: PNO_SCAN_CLASSES.CONFIRMED, reason: "POSITIVE_CURRENT_OCCURRENCE_SCAN",
    scanInAction: record.scanInAction, scanInEventAt: record.scanInEventAt,
    scanInObservedAt: record.scanInObservedAt, scanInSource: record.scanInSource,
  };
  const untrustedObservedAt = Date.parse(record.scanInObservedAt || "");
  if ((record.scanInObserved === true && !trustedPositive &&
        (cutoff === Infinity || !Number.isFinite(untrustedObservedAt) ||
          untrustedObservedAt <= cutoff)) ||
      (record.scanInLocationUnresolvedAt &&
        Date.parse(record.scanInLocationUnresolvedAt) <= cutoff))
    return { classification: PNO_SCAN_CLASSES.INSUFFICIENT,
      reason: UNRESOLVED_SCAN_LOCATION };
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

// Diagnostic fields contain field names and closed reason codes, never payloads.
function invalidPnoView(reasons, identityIssues = []) {
  return { classification: PNO_SCAN_CLASSES.INSUFFICIENT, reason: reasons[0],
    ...(reasons.length > 1 ? { validationReasons: reasons } : {}),
    ...(identityIssues.length ? { identityIssues } : {}) };
}

function snapshotValidation(locator, row, observedAt, previous, acceptedArrivalAt) {
  const identityIssues = pnoIdentityDiagnostics(locator, row);
  const identity = sourceIdentity(locator, row);
  const accepted = samePnoOccurrence(previous, identity) ? previous.arrivalAnchorAt : "";
  const anchor = earliestPnoArrival(snapshotArrival(row), accepted, acceptedArrivalAt);
  const eventAt = pnoProviderTime(row?.LastActionTime);
  const action = String(row?.LastAction || "").trim();
  const store = String(row?.store_id || "").trim();
  const reasons = [];
  if (identityIssues.length) reasons.push("IDENTITY_INCOMPLETE");
  if (!anchor) reasons.push("ARRIVAL_ANCHOR_MISSING_OR_INVALID");
  if (!eventAt) reasons.push("LAST_ACTION_TIME_MISSING_OR_INVALID");
  if (!ACTIONS.has(action)) reasons.push("LAST_ACTION_CODE_MISSING_OR_UNSUPPORTED");
  if (!store) reasons.push("TARGET_STORE_MISSING");
  else if (identity && store !== identity.targetStoreId) reasons.push("TARGET_STORE_MISMATCH");
  if (anchor && eventAt && eventAt < anchor) reasons.push("LAST_ACTION_BEFORE_ARRIVAL");
  if (!Number.isFinite(Date.parse(observedAt))) reasons.push("OBSERVED_AT_INVALID");
  return { identity, identityIssues, anchor, eventAt, action, reasons };
}

function samePnoOccurrence(previous, identity) {
  return Boolean(previous?.occurrence && identity &&
    Object.entries(identity).every(([field, value]) => previous.occurrence[field] === value));
}

// Absence is a gap only for the exact occurrence with complete coverage and
// downstream evidence. A weak later snapshot cannot erase its accepted positive.
export function observePnoSnapshot(previous, locator, row, observedAt,
    { monitoringStartedAt, coverageComplete = false, acceptedArrivalAt } = {}) {
  const { identity, identityIssues, anchor, eventAt, action, reasons } =
    snapshotValidation(locator, row, observedAt, previous, acceptedArrivalAt);
  if (previous && identity && !samePnoOccurrence(previous, identity))
    return { record: previous, changed: false, invalid: true,
      view: invalidPnoView(["OCCURRENCE_MISMATCH", ...reasons], identityIssues) };
  if (reasons.length) {
    const issue = invalidPnoView(reasons, identityIssues);
    const positive = samePnoOccurrence(previous, identity) ? projectPnoEvidence(previous) : null;
    return { record: previous || null, changed: false, invalid: true,
      view: positive?.classification === PNO_SCAN_CLASSES.CONFIRMED
        ? { ...positive, observationIssue: issue } : issue };
  }
  if (previous && previous.arrivalAnchorAt === anchor &&
      previous.latestObservedAction === action && previous.latestObservedActionAt === eventAt)
    return { record: previous, changed: false, view: projectPnoEvidence(previous) };
  const start = previous?.monitoringStartedAt || monitoringStartedAt || observedAt;
  const anchorMillis = Date.parse(anchor.replace(" ", "T") + "+07:00");
  const monitoringBeforeArrival = Date.parse(start) <= anchorMillis;
  const latestIsNewer = !previous?.latestObservedActionAt || eventAt >= previous.latestObservedActionAt;
  const record = {
    occurrence: { hub: identity.hub, proofId: identity.proofId, day: identity.day,
      lineId: identity.lineId, sourceStoreId: identity.sourceStoreId,
      targetStoreId: identity.targetStoreId, pno: identity.pno },
    arrivalAnchorAt: anchor, monitoringStartedAt: start,
    monitoringBeforeArrival, lastObservedAt: observedAt,
    latestObservedAction: latestIsNewer ? action : previous.latestObservedAction,
    latestObservedActionAt: latestIsNewer ? eventAt : previous.latestObservedActionAt,
    arrivalStageObserved: previous?.arrivalStageObserved === true ||
      ARRIVAL_ACTIONS.has(action),
    downstreamObserved: previous?.downstreamObserved === true ||
      (!ARRIVAL_ACTIONS.has(action) && action !== SCAN_IN && eventAt > anchor),
    preArrivalStageObserved: previous?.preArrivalStageObserved === true,
    // Keep legacy fields untouched for compatibility, but never promote an
    // ordinary LastAction snapshot into a new current-HUB positive.
    scanInObserved: previous?.scanInObserved === true,
    scanInAction: previous?.scanInAction || null,
    scanInEventAt: previous?.scanInEventAt || null,
    scanInObservedAt: previous?.scanInObservedAt || null,
    scanInSource: previous?.scanInSource || null,
    ...(previous?.scanInStoreId ? { scanInStoreId: previous.scanInStoreId } : {}),
    ...(previous?.scanInLocationUnresolvedAt || action === SCAN_IN
      ? { scanInLocationUnresolvedAt: previous?.scanInLocationUnresolvedAt || observedAt } : {}),
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
  // Different detail tabs may fetch concurrently. The transaction prevents a
  // later downstream snapshot from overwriting a concurrently accepted scan.
  return storage.transaction(async (txn) => {
    const saved = new Map();
    await readEvidenceKeys(txn, keys.map((key) => key?.base), saved);
    const previousBases = await Promise.all(keys.map(async (key) => key && {
      ...saved.get(key.base),
      legacyOccurrence: await legacyOccurrenceKey(key.identity, saved.get(key.base)?.activeAnchor),
    }));
    await readEvidenceKeys(txn, keys.flatMap((key, index) => key
      ? [key.occurrence, key.legacyOccurrence, previousBases[index].legacyOccurrence] : []), saved);
    const updates = {};
    const views = rawRows.map((row, index) => {
      const key = keys[index];
      if (!key) return invalidPnoView(["IDENTITY_INCOMPLETE"], pnoIdentityDiagnostics(locator, row));
      const previousBase = updates[key.base] || saved.get(key.base) || null;
      const previous = updates[key.occurrence] ||
        acceptedRecord(saved, key, previousBases[index]);
      if (!key.anchor && !previous && !pnoProviderTime(previousBase?.activeAnchor)) {
        // A successful detail observation before vehicle arrival starts the
        // monitoring window; it cannot be treated as evidence of scan-in.
        const preArrival = !String(row?.real_arrive_time || "").trim() &&
          Number.isFinite(Date.parse(observedAt)) &&
          String(row?.store_id || "").trim() === key.identity.sourceStoreId &&
          ACTIONS.has(String(row?.LastAction || "").trim()) &&
          Boolean(pnoProviderTime(row?.LastActionTime));
        if (!previousBase && preArrival)
          updates[key.base] = { monitoringStartedAt: observedAt, activeAnchor: "" };
        return preArrival
          ? { classification: PNO_SCAN_CLASSES.NOT_YET, reason: "ARRIVAL_NOT_YET_RECORDED" }
          : invalidPnoView(snapshotValidation(locator, row, observedAt).reasons);
      }
      const preStart = !previousBase?.activeAnchor ? previousBase?.monitoringStartedAt : null;
      const outcome = observePnoSnapshot(previous, locator, row, observedAt,
        { monitoringStartedAt: preStart, acceptedArrivalAt: previousBase?.activeAnchor });
      if (outcome.changed || (previous && !saved.has(key.occurrence) && !updates[key.occurrence])) {
        updates[key.occurrence] = outcome.record;
        if (outcome.record) updates[key.base] = {
          monitoringStartedAt: outcome.record.monitoringStartedAt,
          activeAnchor: outcome.record.arrivalAnchorAt };
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

// A cached detail view can predate a positive accepted by another tab or
// coordinator instance. Reproject only persisted positives for the exact
// occurrence; this read does not acquire another provider page or invent a scan.
export async function reconcilePnoCachedPositive(storage, locator, value) {
  if (!storage?.get || value?.sourceValid !== true || !Array.isArray(value.parcels))
    return value;
  const candidates = value.parcels.filter((row) => row?.pno);
  if (!candidates.length) return value;
  const pairs = await Promise.all(candidates.map(async (row) => ({
    row, key: await pnoEvidenceKeys(locator,
      { pno: row.pno, real_arrive_time: row.arrivalAnchorAt }),
  })));
  const saved = new Map();
  await readEvidenceKeys(storage, pairs.map(({ key }) => key?.base), saved);
  const bases = await Promise.all(pairs.map(async ({ key }) => key && ({
    legacyOccurrence: await legacyOccurrenceKey(key.identity, saved.get(key.base)?.activeAnchor),
  })));
  await readEvidenceKeys(storage, pairs.flatMap(({ key }, index) => key
    ? [key.occurrence, key.legacyOccurrence, bases[index].legacyOccurrence] : []), saved);
  for (const [index, { row, key }] of pairs.entries()) {
    if (!key) continue;
    const record = acceptedRecord(saved, key, bases[index]);
    if (!samePnoOccurrence(record, key.identity)) {
      if (row.scanEvidence?.classification === PNO_SCAN_CLASSES.CONFIRMED)
        row.scanEvidence = { classification: PNO_SCAN_CLASSES.INSUFFICIENT,
          reason: UNRESOLVED_SCAN_LOCATION };
      continue;
    }
    const view = projectPnoEvidence(record);
    if (view.classification === PNO_SCAN_CLASSES.CONFIRMED ||
        row.scanEvidence?.classification === PNO_SCAN_CLASSES.CONFIRMED)
      row.scanEvidence = view;
  }
  return value;
}

// Accept only a result from an explicit exact WaybillDetail read. This helper
// performs no acquisition; the caller must pass the current detail row and the
// already received history together. Persist only the matched positive fact.
export async function ingestPnoExactHistory(storage, locator, row, response, observedAt) {
  const unavailable = { classification: PNO_SCAN_CLASSES.INSUFFICIENT, reason: "HISTORY_OCCURRENCE_UNVERIFIED" };
  const key = await pnoEvidenceKeys(locator, row);
  const result = response?.data?.result ?? response?.result ?? response;
  const events = result?.parcel_routes;
  if (!storage || !key?.occurrence ||
      String(result?.parcel_info?.pno || "").trim().toUpperCase() !== key.identity.pno ||
      !Array.isArray(events) || events.length > 500) return unavailable;

  return storage.transaction(async (txn) => {
    const saved = new Map();
    await readEvidenceKeys(txn, [key.base], saved);
    const base = saved.get(key.base);
    const baseLegacy = await legacyOccurrenceKey(key.identity, base?.activeAnchor);
    await readEvidenceKeys(txn, [key.occurrence, key.legacyOccurrence, baseLegacy], saved);
    const previous = acceptedRecord(saved, key, { legacyOccurrence: baseLegacy });
    if (!matchPnoHistoryArrival(locator, row, events,
        samePnoOccurrence(previous, key.identity) ? previous.arrivalAnchorAt : base?.activeAnchor))
      return unavailable;
    // Historical routes lack proof/line identity. A matched arrival event
    // verifies this detail row; other events may belong to another round.
    const outcome = observePnoSnapshot(previous, locator, row, observedAt,
      { acceptedArrivalAt: base?.activeAnchor });
    if (outcome.invalid === true) return unavailable;
    if (!outcome.record) return unavailable;
    const targetStore = key.identity.targetStoreId;
    const lastActionAt = pnoProviderTime(row?.LastActionTime);
    const scanAt = events.map((event) => {
      if (event?.route_action !== SCAN_IN ||
          String(event?.store_id || "").trim() !== targetStore) return "";
      const at = pnoProviderTime(event?.routed_at);
      return at >= outcome.record.arrivalAnchorAt && at <= lastActionAt ? at : "";
    }).filter(Boolean).sort()[0];
    if (!scanAt || Date.parse(observedAt) < Date.parse(scanAt.replace(" ", "T") + "+07:00"))
      return unavailable;
    const record = { ...outcome.record };
    if (projectPnoEvidence(record).classification !== PNO_SCAN_CLASSES.CONFIRMED) {
      record.scanInObserved = true;
      record.scanInAction = SCAN_IN;
      record.scanInEventAt = scanAt;
      record.scanInObservedAt = observedAt;
      record.scanInSource = TRUSTED_SCAN_SOURCE;
      record.scanInStoreId = targetStore;
    }
    const nextBase = { monitoringStartedAt: record.monitoringStartedAt,
      activeAnchor: record.arrivalAnchorAt };
    const updates = {};
    if (JSON.stringify(saved.get(key.occurrence)) !== JSON.stringify(record))
      updates[key.occurrence] = record;
    if (JSON.stringify(base) !== JSON.stringify(nextBase))
      updates[key.base] = nextBase;
    if (Object.keys(updates).length) await txn.put(updates);
    return projectPnoEvidence(record);
  });
}
