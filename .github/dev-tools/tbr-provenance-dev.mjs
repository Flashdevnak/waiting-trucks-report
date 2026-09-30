// TBR_PROVENANCE_DEV_V1: only sanitized, request-local observations.
import { extractBusTbrAtV28 } from "./bus-time-hot-lane-v14-runtime.mjs";

const nested = (field, index) => Array.isArray(field) ? field[index]?.value : undefined;
const truth = (value) => value ? "YES" : "NO";
const dateState = (value) => !value ? "EMPTY" : Number.isFinite(Date.parse(String(value))) ? "VALID" : "INVALID";

export function classifyFleetSignInfo(field, msDate) {
  const entries = Array.isArray(field) ? field : [];
  const parse = (values) => {
    try { return extractBusTbrAtV28(values, msDate); } catch { return ""; }
  };
  const selected = parse(entries);
  const explicitTbrLabelPresent = entries.some((entry) => /^TBR\s*[:：=\-]/i.test(String(entry?.value ?? "").trim()));
  const candidates = entries.slice(0, 12).map((entry, index) => {
    const raw = String(entry?.value ?? "").trim();
    const parsed = parse([entry]);
    let kind = "INVALID_NONEMPTY";
    if (!raw || raw === "-") kind = "EMPTY";
    else if (/^KIT\s*[:：=\-]/i.test(raw)) kind = "EXPLICIT_KIT_LABEL";
    else if (/^TBR\s*[:：=\-]/i.test(raw)) kind = parsed ? "EXPLICIT_TBR_LABEL_DATE" : "INVALID_NONEMPTY";
    else if (parsed) kind = "PARSEABLE_BARE_DATE";
    else if (/^[^\d\s][^:：=]*[:：=]/.test(raw)) kind = "OTHER_LABEL";
    return { index, class: kind };
  });
  let selectedIndex = -1;
  if (selected) {
    for (let index = 0; index < entries.length; index++) {
      if (parse([entries[index]]) === selected) {
        selectedIndex = index;
        break;
      }
    }
  }
  return {
    fleetSignInfoLength: entries.length,
    fleetSignCandidates: candidates,
    selectedTbrCandidateIndex: selectedIndex < 0 ? "NONE" : selectedIndex,
    selectedTbrCandidateClass: selectedIndex < 0 ? "NONE" : candidates[selectedIndex]?.class || "NOT_INSPECTED",
    parsedTbrState: dateState(selected),
    explicitTbrLabelPresent: truth(explicitTbrLabelPresent),
  };
}

// All keys and raw items stay in this closure and are never returned.
export function createTbrProvenance(rows, { normalizeProofId, normalizeAttendance, matchHub, msDate, findBusEnrichment, enrichMsRow }) {
  const targets = (Array.isArray(rows) ? rows : []).slice(0, 3).map((row, index) => ({
    label: `TBR-${"ABC"[index]}`,
    row,
    proof: normalizeProofId(row.proofId),
    attendance: normalizeAttendance(row.attendanceType),
    candidate: null,
    rank: -1,
    sourceCount: 0,
    exactSourceCount: 0,
  }));
  function observeItem(item, hub) {
    const proof = normalizeProofId(nested(item?.proof_id, 0));
    if (!proof) return;
    for (const target of targets) {
      if (target.proof !== proof) continue;
      const attendance = normalizeAttendance(nested(item?.next_store_info, 1));
      const attendanceMatch = attendance === target.attendance;
      const hubMatch = matchHub(String(nested(item?.next_store_info, 0) || ""), hub);
      target.sourceCount++;
      if (attendanceMatch && hubMatch) target.exactSourceCount++;
      const rank = Number(attendanceMatch) * 2 + Number(hubMatch);
      if (rank < target.rank) continue;
      target.rank = rank;
      target.candidate = {
        proofMatch: "YES",
        attendanceMatch: truth(attendanceMatch),
        hubMatch: truth(hubMatch),
        ...classifyFleetSignInfo(item.fleet_sign_info, msDate),
      };
    }
  }
  function result(busMap, persistedRows = [], cacheRows = []) {
    return targets.map(({ label, row, proof, attendance, candidate, sourceCount, exactSourceCount }) => {
      const exact = `P:${proof}|A:${attendance}`;
      const mapHit = busMap instanceof Map ? busMap.get(exact) : null;
      const fallback = busMap instanceof Map ? busMap.get(`P:${proof}`) : null;
      const bus = busMap instanceof Map ? findBusEnrichment(busMap, row) : null;
      const persisted = persistedRows.find((item) => normalizeProofId(item.proof_id) === proof && normalizeAttendance(item.attendance_type) === attendance);
      const cached = cacheRows.find((item) => normalizeProofId(item.proofId) === proof && normalizeAttendance(item.attendanceType) === attendance);
      const enrichedTbr = busMap instanceof Map
        ? enrichMsRow({ ...row }, new Map(), busMap).scheduleTbrArrivalAt
        : row.scheduleTbrArrivalAt;
      let rejectionLayer = "UNKNOWN";
      if (candidate && exactSourceCount > 1) rejectionLayer = "UNKNOWN";
      else if (candidate) {
        if (candidate.hubMatch === "NO") rejectionLayer = "HUB_FILTER";
        else if (candidate.attendanceMatch === "NO") rejectionLayer = "ATTENDANCE_MATCH";
        else if (candidate.parsedTbrState !== "VALID" && candidate.explicitTbrLabelPresent === "NO" &&
          candidate.fleetSignCandidates.every((item) => ["EMPTY", "EXPLICIT_KIT_LABEL", "OTHER_LABEL"].includes(item.class)))
          rejectionLayer = "SOURCE_ABSENT";
        else if (candidate.parsedTbrState !== "VALID") rejectionLayer = candidate.explicitTbrLabelPresent === "YES" ? "SOURCE_PARSE" : "UNKNOWN";
        else if (!bus) rejectionLayer = "BUS_MAP";
        else if (dateState(enrichedTbr) !== "VALID") rejectionLayer = "ENRICHMENT";
        else if (persisted && dateState(persisted.schedule_tbr_arrival_at) === "VALID" &&
          cached && dateState(cached.scheduleTbrArrivalAt) === "VALID") rejectionLayer = "NONE";
        else rejectionLayer = "UNKNOWN"; // this one-shot does not write persistence; a stale DB row is not proof of a drop
      }
      return {
        label,
        attendanceType: "ORIGIN",
        routeTbrState: dateState(row.scheduleTbrArrivalAt),
        routeKitState: dateState(row.actualArrivalAt),
        busCandidateFound: truth(candidate),
        proofMatchedSourceRows: sourceCount,
        exactMatchedSourceRows: exactSourceCount,
        proofMatch: candidate?.proofMatch || "NO",
        attendanceMatch: candidate?.attendanceMatch || "NO",
        hubMatch: candidate?.hubMatch || "NOT_APPLICABLE",
        fleetSignInfoLength: candidate?.fleetSignInfoLength ?? 0,
        fleetSignCandidates: candidate?.fleetSignCandidates || [],
        selectedTbrCandidateIndex: candidate?.selectedTbrCandidateIndex ?? "NONE",
        selectedTbrCandidateClass: candidate?.selectedTbrCandidateClass || "NONE",
        parsedTbrState: candidate?.parsedTbrState || "EMPTY",
        explicitTbrLabelPresent: candidate?.explicitTbrLabelPresent || "NO",
        busMapKeyCreated: truth(mapHit),
        findBusEnrichmentMatch: truth(bus),
        proofOnlyFallbackUsed: truth(!mapHit && fallback),
        enrichedTbrState: dateState(enrichedTbr),
        persistedTbrState: persisted ? dateState(persisted.schedule_tbr_arrival_at) : "NOT_INSPECTED",
        liveCacheTbrState: cached ? dateState(cached.scheduleTbrArrivalAt) : "NOT_INSPECTED",
        workerResponseTbrState: cached ? dateState(cached.scheduleTbrArrivalAt) : "NOT_INSPECTED",
        frontendExpectedRender: cached ? dateState(cached.scheduleTbrArrivalAt) === "VALID" ? "VALUE" : "DASH" : "NOT_INSPECTED",
        rejectionLayer,
      };
    });
  }
  return { observeItem, result, count: targets.length };
}
