// MS_OPERATIONAL_TRUTH_REC04_V1
// Pure business-day, historical-evidence, and source-freshness truth.
// No transport, persistence, polling, or provider work is performed here.

export const MS_SOURCE_FRESHNESS = Object.freeze({
  FRESH: "FRESH",
  STALE: "STALE",
  SOURCE_UNAVAILABLE: "SOURCE_UNAVAILABLE",
  UNKNOWN: "UNKNOWN",
  ON_DEMAND: "ON_DEMAND",
});

export const MS_SOURCE_STALE_AFTER_MS = 20 * 60 * 1000;

function validIso(value) {
  const text = String(value || "");
  return Number.isFinite(Date.parse(text)) ? new Date(Date.parse(text)).toISOString() : "";
}

function bangkokDay(value) {
  const at = Date.parse(String(value || ""));
  return Number.isFinite(at)
    ? new Date(at + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : "";
}

function attendance(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "ต้นทาง" || normalized === "origin") return "ORIGIN";
  if (normalized === "ปลายทาง" || normalized === "destination") return "DESTINATION";
  if (
    normalized === "จุดดรอป" ||
    normalized === "drop" ||
    normalized === "drop point"
  ) return "DROP";
  return "OTHER";
}

export function canonicalMsBusinessDay(row) {
  const kind = attendance(row?.attendanceType);
  if (kind === "ORIGIN") {
    const valueTimestamp = validIso(row?.actualDepartureAt);
    return {
      businessDay: bangkokDay(valueTimestamp),
      authority: valueTimestamp ? "ROUTE_ACTUAL_DEPARTURE" : "UNKNOWN",
      valueTimestamp,
    };
  }
  if (kind !== "DESTINATION" && kind !== "DROP")
    return { businessDay: "", authority: "UNKNOWN", valueTimestamp: "" };

  const kit = validIso(row?.actualArrivalAt);
  const tbr = validIso(row?.scheduleTbrArrivalAt);
  if (!kit && !tbr)
    return { businessDay: "", authority: "UNKNOWN", valueTimestamp: "" };
  const useKit = Boolean(kit) && (!tbr || Date.parse(kit) <= Date.parse(tbr));
  const valueTimestamp = useKit ? kit : tbr;
  return {
    businessDay: bangkokDay(valueTimestamp),
    authority: useKit ? "KIT" : "TBR",
    valueTimestamp,
  };
}

// Expression is intentionally snapshot-local. The legacy ms_route_latest.business_day
// value is not historical authority because it was originally derived from estimates.
export const MS_CANONICAL_BUSINESS_DAY_SQL = `CASE
  WHEN COALESCE(json_extract(payload_json,'$.attendanceType'),'') LIKE '%ต้นทาง%' THEN
    date(datetime(NULLIF(json_extract(payload_json,'$.actualDepartureAt'),'')), '+7 hours')
  WHEN COALESCE(json_extract(payload_json,'$.attendanceType'),'') LIKE '%ปลายทาง%'
    OR COALESCE(json_extract(payload_json,'$.attendanceType'),'') LIKE '%จุดดรอป%' THEN
    date(datetime(
      CASE
        WHEN datetime(NULLIF(json_extract(payload_json,'$.actualArrivalAt'),'')) IS NOT NULL
         AND datetime(NULLIF(json_extract(payload_json,'$.scheduleTbrArrivalAt'),'')) IS NOT NULL
          THEN CASE
            WHEN julianday(json_extract(payload_json,'$.actualArrivalAt'))
              <= julianday(json_extract(payload_json,'$.scheduleTbrArrivalAt'))
              THEN json_extract(payload_json,'$.actualArrivalAt')
            ELSE json_extract(payload_json,'$.scheduleTbrArrivalAt')
          END
        WHEN datetime(NULLIF(json_extract(payload_json,'$.actualArrivalAt'),'')) IS NOT NULL
          THEN json_extract(payload_json,'$.actualArrivalAt')
        WHEN datetime(NULLIF(json_extract(payload_json,'$.scheduleTbrArrivalAt'),'')) IS NOT NULL
          THEN json_extract(payload_json,'$.scheduleTbrArrivalAt')
        ELSE NULL
      END
    ), '+7 hours')
  ELSE NULL
END`;

function authUnavailable(value) {
  return /(?:401|403|AUTH_REQUIRED|SESSION_EXPIRED|INVALID_SESSION|CREDENTIAL_ERROR|NEEDS_LOGIN|NOT_CONFIGURED)/i
    .test(String(value || ""));
}

function sourceUnavailable(value) {
  return authUnavailable(value) || /SOURCE_UNAVAILABLE/i.test(String(value || ""));
}

export function canonicalMsSourceFreshness(source, nowMs = Date.now()) {
  const input = source && typeof source === "object" ? source : {};
  const mode = String(input.mode || "").toUpperCase();
  const onDemand = mode === "ON_DEMAND" || mode === "CLICK_ONLY";
  const errorCode = String(input.errorCode || input.lastError || "");
  const timestamps = {
    lastAttemptAt: validIso(input.lastAttemptAt),
    lastSuccessAt: validIso(input.lastSuccessAt),
    lastMeaningfulObservationAt: validIso(input.lastMeaningfulObservationAt),
    lastErrorAt: validIso(input.lastErrorAt),
    dataObservedAt: validIso(input.dataObservedAt),
    sourceValueTimestamp: validIso(input.sourceValueTimestamp),
    acceptedDataAt: validIso(input.acceptedDataAt),
  };

  let freshness = MS_SOURCE_FRESHNESS.UNKNOWN;
  let reason = "INSUFFICIENT_EVIDENCE";
  let action = "OBSERVE";
  if (onDemand) {
    freshness = MS_SOURCE_FRESHNESS.ON_DEMAND;
    reason = "ON_DEMAND_SOURCE";
  } else if (sourceUnavailable(errorCode) || input.sourceUnavailable === true) {
    freshness = MS_SOURCE_FRESHNESS.SOURCE_UNAVAILABLE;
    reason = authUnavailable(errorCode) ? "AUTH_REQUIRED" : "SOURCE_UNAVAILABLE";
    action = reason === "AUTH_REQUIRED" ? "AUTH_REQUIRED" : "REVIEW_REQUIRED";
  } else if (timestamps.lastSuccessAt && Number.isFinite(Number(nowMs))) {
    const age = Math.max(0, Number(nowMs) - Date.parse(timestamps.lastSuccessAt));
    freshness = age > MS_SOURCE_STALE_AFTER_MS
      ? MS_SOURCE_FRESHNESS.STALE
      : MS_SOURCE_FRESHNESS.FRESH;
    reason = freshness === MS_SOURCE_FRESHNESS.FRESH
      ? "SUCCESS_WITHIN_THRESHOLD"
      : "SUCCESS_OUTSIDE_THRESHOLD";
  }

  return {
    freshness,
    reason,
    action,
    mode: onDemand ? "ON_DEMAND" : "REFRESH",
    ...timestamps,
  };
}

export function canonicalMsFieldEvaluation({
  succeeded = false,
  matched = false,
  unavailable = false,
  errorCode = "",
} = {}) {
  if (unavailable || sourceUnavailable(errorCode))
    return { evidenceState: "SOURCE_UNAVAILABLE", reason: authUnavailable(errorCode) ? "AUTH_REQUIRED" : "SOURCE_UNAVAILABLE" };
  if (!succeeded) return { evidenceState: "UNKNOWN", reason: "NOT_EVALUATED" };
  return matched
    ? { evidenceState: "OBSERVED", reason: "MATCHED" }
    : { evidenceState: "MISSING_UNCONFIRMED", reason: "SUCCESSFUL_NO_MATCH" };
}

export function msEvidenceKnowledgeTime(evidence) {
  if (!evidence || typeof evidence !== "object") return "";
  return validIso(
    evidence.acceptedDataAt ||
    evidence.acceptedAt ||
    evidence.dataObservedAt ||
    evidence.fetchedAt ||
    evidence.observedAt,
  );
}

export function msEvidenceVisibleAt(evidence, asOf) {
  const cutoff = Date.parse(String(asOf || ""));
  const knownAt = Date.parse(msEvidenceKnowledgeTime(evidence));
  return Number.isFinite(cutoff) && Number.isFinite(knownAt) && knownAt <= cutoff;
}
