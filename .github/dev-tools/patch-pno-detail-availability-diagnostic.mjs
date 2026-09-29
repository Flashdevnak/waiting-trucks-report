const MARKER = "PNO_DETAIL_AVAILABILITY_DIAG_V1";

function replaceUnique(source, before, after, label) {
  const at = source.indexOf(before);
  if (at < 0 || source.indexOf(before, at + before.length) !== -1)
    throw new Error(`${MARKER}: ${label} anchor missing or repeated`);
  return source.slice(0, at) + after + source.slice(at + before.length);
}

// Only closed reason names, booleans and counts leave this projection. The
// existing eligibility function remains the sole authority for each reason.
export function summarizePnoDetailAvailability(rows, eligibility, sourceRowCount = rows.length) {
  const names = ["OK", "NOT_INBOUND", "SEGMENT_UNKNOWN", "AMBIGUOUS_OCCURRENCE",
    "LOCATOR_INCOMPLETE", "DETAIL_DISABLED", "UNKNOWN"];
  const counters = (keys) => Object.fromEntries(keys.map((key) => [key, 0]));
  const reason = counters(names);
  const fields = counters(["proofId", "pnoSourceDay", "pnoLineId", "pnoVanLineId",
    "lineId", "pnoStoreId", "pnoNextStoreId"]);
  const present = Object.fromEntries(Object.keys(fields).map((key) => [key, { present: 0, missing: 0 }]));
  const segment = counters(["unknown", "single", "multi"]);
  const flag = () => ({ true: 0, false: 0 });
  const availableFlag = flag();
  const enabledFlag = flag();
  const stateOK = flag();
  const locatorIncomplete = counters(["missingProofId", "missingSourceDay",
    "missingBothLineIds", "missingStoreId", "missingNextStoreId", "multipleMissing"]);
  const has = (value) => Boolean(String(value ?? "").trim());
  let detailAvailable = 0;
  for (const row of rows) {
    const result = eligibility(row);
    const code = names.includes(result?.reason) ? result.reason : "UNKNOWN";
    reason[code]++;
    if (result?.available === true) detailAvailable++;
    const checks = {
      proofId: has(row?.proofId), pnoSourceDay: has(row?.pnoSourceDay),
      pnoLineId: has(row?.pnoLineId), pnoVanLineId: has(row?.pnoVanLineId),
      lineId: has(row?.pnoLineId) || has(row?.pnoVanLineId),
      pnoStoreId: has(row?.pnoStoreId), pnoNextStoreId: has(row?.pnoNextStoreId),
    };
    for (const [key, value] of Object.entries(checks)) present[key][value ? "present" : "missing"]++;
    const count = row?.pnoSegmentCount;
    segment[!Number.isSafeInteger(count) || count < 1 ? "unknown" : count === 1 ? "single" : "multi"]++;
    availableFlag[row?.pnoDetailAvailable === true ? "true" : "false"]++;
    enabledFlag[row?.pnoEnabled === true ? "true" : "false"]++;
    stateOK[row?.pnoState === "OK" ? "true" : "false"]++;
    if (code === "LOCATOR_INCOMPLETE") {
      const missing = [!checks.proofId, !checks.pnoSourceDay, !checks.lineId,
        !checks.pnoStoreId, !checks.pnoNextStoreId];
      const keys = ["missingProofId", "missingSourceDay", "missingBothLineIds",
        "missingStoreId", "missingNextStoreId"];
      keys.forEach((key, index) => { if (missing[index]) locatorIncomplete[key]++; });
      if (missing.filter(Boolean).length > 1) locatorIncomplete.multipleMissing++;
    }
  }
  return {
    sourceRowCount: Number.isSafeInteger(sourceRowCount) && sourceRowCount >= 0 ? sourceRowCount : 0,
    totalRows: rows.length,
    detailAvailable,
    detailUnavailable: rows.length - detailAvailable,
    reason, presence: present, segment,
    pnoDetailAvailable: availableFlag, pnoEnabled: enabledFlag, pnoStateOK: stateOK,
    locatorIncomplete,
  };
}

function pnoDetailDiagRender(rows) {
  if (new URLSearchParams(location.search).get("pnoDetailDiag") !== "1") return;
  const marker = "PNO_DETAIL_AVAILABILITY_DIAG_V1";
  const sourceRows = Array.isArray(state.rows) ? state.rows : [];
  const parcelRows = (Array.isArray(rows) ? rows : []).filter((row) =>
    row && row.expectedParcels !== null && row.expectedParcels !== undefined && row.expectedParcels !== "");
  const result = summarizePnoDetailAvailability(parcelRows, pnoReadOnlyDetailEligibility, sourceRows.length);
  let panel = document.getElementById("pno-detail-availability-diag");
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "pno-detail-availability-diag";
    panel.setAttribute("data-diagnostic-marker", marker);
    panel.setAttribute("aria-label", "PNO detail availability diagnostic");
    panel.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:9999;max-width:min(92vw,520px);max-height:55vh;overflow:auto;padding:12px;background:#18212d;color:#fff;border:1px solid #ff9a3d;border-radius:8px;font:12px/1.4 monospace";
    const heading = document.createElement("strong");
    heading.textContent = marker;
    panel.appendChild(heading);
    panel.appendChild(document.createElement("pre"));
    document.body.appendChild(panel);
  }
  panel.querySelector("pre").textContent = JSON.stringify(result);
}

export function patchPnoDetailAvailabilityDiagnostic(source) {
  let output = String(source || "");
  if (output.includes("// DEV_PNO_DETAIL_DIAG_FINAL_HOOK_V1")) return output;
  if (!output.includes("PNO_READONLY_DETAIL_ELIGIBILITY_V30") ||
      !output.includes("PNO_ALL_PAGE_FILTER_TRUTH_V1") ||
      !output.includes("PNO_AUTHORITATIVE_DESTINATION_HUB_V1"))
    throw new Error(`${MARKER}: final PNO staging prerequisites missing`);
  output = replaceUnique(output,
    "  const rows = filteredRows();\n  renderFilterSummary(summaryRows);",
    "  const rows = filteredRows();\n  pnoDetailDiagRender(rows);\n  renderFilterSummary(summaryRows);",
    "route render hook");
  return output + "\n// DEV_PNO_DETAIL_DIAG_FINAL_HOOK_V1\n" +
    summarizePnoDetailAvailability.toString() + "\n" + pnoDetailDiagRender.toString() + "\n";
}
