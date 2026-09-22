const MARKER = "PNO_DETAIL_AFFORDANCE_RECOVERY_V30";
const WORKER_MARKER = "PNO_DETAIL_LOCATOR_RECOVERY_V30";
const FRONTEND_MARKER = "PNO_READONLY_DETAIL_ELIGIBILITY_V30";

function replaceUnique(source, from, to, label) {
  const first = source.indexOf(from);
  const last = source.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`${MARKER}: ${label} anchor missing or non-unique`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

export function detailEligibilityFixtureV30(row) {
  const inbound = row?.attendanceType === "ปลายทาง" || row?.attendanceType === "จุดดรอป";
  if (!inbound) return { available: false, reason: "NOT_INBOUND" };
  const expected = Number(row?.expectedParcels);
  const entered = Number(row?.enteredParcels);
  const pending = Number(row?.pendingParcels);
  if (![expected, entered, pending].every(Number.isFinite) || expected < 0 || entered < 0 || pending < 0 || entered + pending !== expected)
    return { available: false, reason: "COUNT_MISMATCH" };
  if (Number(row?.pnoSegmentCount) !== 1)
    return { available: false, reason: "AMBIGUOUS_OCCURRENCE" };
  if (!String(row?.proofId || "").trim() || !String(row?.pnoSourceDay || "").trim() ||
      !String(row?.pnoLineId || row?.pnoVanLineId || "").trim() ||
      !String(row?.pnoStoreId || "").trim() || !String(row?.pnoNextStoreId || "").trim())
    return { available: false, reason: "LOCATOR_INCOMPLETE" };
  return {
    available: row?.pnoDetailAvailable === true,
    reason: row?.pnoDetailAvailable === true ? "OK" : "DETAIL_DISABLED",
  };
}

export function patchPnoDetailAffordanceWorkerV30(source) {
  let output = String(source || "");
  if (output.includes(WORKER_MARKER)) return output;
  if (!output.includes("PNO_PREENTRY_MULTIDROP_SUM_V27"))
    throw new Error(`${MARKER}: V27 worker prerequisite missing`);

  output = replaceUnique(
    output,
    `  "pnoLineId", "pnoVanLineId", "pnoStoreId", "pnoNextStoreId", "pnoNextStoreName", "pnoCanReport",`,
    `  "pnoLineId", "pnoVanLineId", "pnoStoreId", "pnoNextStoreId", "pnoNextStoreName", "pnoCanReport",
  "pnoSegmentCount", "pnoDetailAvailable",`,
    "PNO view detail fields",
  );
  output = replaceUnique(
    output,
    `        pnoSegmentCount: 0,
        aliases: [],`,
    `        pnoSegmentCount: 0,
        pnoSegments: [],
        aliases: [],`,
    "segment metadata collection",
  );
  output = replaceUnique(
    output,
    `      current.pnoSegmentCount += 1;
      current.aliases.push([row.proof_id, row.line_name, row.plate_number]);`,
    `      current.pnoSegmentCount += 1;
      current.pnoSegments.push(preEntrySummaryCandidate(
        row,
        preEntryRowSourceDay.get(row) || "",
      ));
      current.aliases.push([row.proof_id, row.line_name, row.plate_number]);`,
    "segment locator capture",
  );
  output = replaceUnique(
    output,
    `      const aliases = value.aliases;
      delete value.aliases;
      delete value.invalidCounts;`,
    `      // ${WORKER_MARKER}: aggregated counts are not an exact route-occurrence
      // locator. Preserve read-only locator evidence only for one unique segment;
      // multi-stop aggregates stay visible but fail closed for detail lookup.
      const segments = value.pnoSegments.filter(Boolean);
      const exact = value.pnoSegmentCount === 1 ? segments[0] : null;
      const completeCounts = [value.expectedParcels, value.enteredParcels, value.pendingParcels]
        .every((item) => Number.isFinite(Number(item)) && Number(item) >= 0) &&
        Number(value.enteredParcels) + Number(value.pendingParcels) === Number(value.expectedParcels);
      const locatorComplete = Boolean(
        exact?.proofId && exact?.pnoSourceDay &&
        (exact?.pnoLineId || exact?.pnoVanLineId) &&
        exact?.pnoStoreId && exact?.pnoNextStoreId
      );
      if (exact) Object.assign(value, exact);
      value.pnoState = !completeCounts
        ? "COUNT_MISMATCH"
        : value.pnoSegmentCount !== 1
          ? "AMBIGUOUS"
          : locatorComplete ? "OK" : "LOCATOR_INCOMPLETE";
      value.pnoEnabled = completeCounts;
      value.pnoDetailAvailable = completeCounts && locatorComplete && value.pnoSegmentCount === 1;
      value.pnoPercent = completeCounts && Number(value.expectedParcels) > 0
        ? Number(value.enteredParcels) / Number(value.expectedParcels) * 100
        : completeCounts ? 0 : null;
      const aliases = value.aliases;
      delete value.aliases;
      delete value.invalidCounts;
      delete value.pnoSegments;`,
    "exact detail eligibility",
  );
  return output;
}

export function patchPnoDetailAffordanceFrontendV30(source) {
  let output = String(source || "");
  if (output.includes(FRONTEND_MARKER)) return output;
  if (!output.includes("LIVE_EVIDENCE_FRONTEND_V29"))
    throw new Error(`${MARKER}: V29 frontend prerequisite missing`);

  const helper = `// ${FRONTEND_MARKER}: read-only detail availability is based on an
// exact, immutable route-occurrence locator. It is independent from lifecycle
// completion and from provider can_report (which remains request context only).
function pnoReadOnlyDetailEligibility(row) {
  if (!pnoOperationalInboundEligible(row)) return { available: false, reason: "NOT_INBOUND" };
  const truth = pnoOperationalRawSummary(row);
  if (!truth.valid) return { available: false, reason: "COUNT_MISMATCH" };
  if (Number(row?.pnoSegmentCount) !== 1) return { available: false, reason: "AMBIGUOUS_OCCURRENCE" };
  if (!String(row?.proofId || "").trim() || !String(row?.pnoSourceDay || "").trim() ||
      !String(row?.pnoLineId || row?.pnoVanLineId || "").trim() ||
      !String(row?.pnoStoreId || "").trim() || !String(row?.pnoNextStoreId || "").trim())
    return { available: false, reason: "LOCATOR_INCOMPLETE" };
  return row?.pnoDetailAvailable === true
    ? { available: true, reason: "OK" }
    : { available: false, reason: "DETAIL_DISABLED" };
}

function pnoReadOnlyUnavailableMessage(detail) {
  if (detail.reason === "AMBIGUOUS_OCCURRENCE")
    return "หลายจุดส่ง จึงไม่เปิดรายละเอียดรวมเพื่อป้องกันการเลือกเที่ยวผิด";
  if (detail.reason === "LOCATOR_INCOMPLETE" || detail.reason === "DETAIL_DISABLED")
    return "รายละเอียดพัสดุยังไม่พร้อม: ข้อมูลอ้างอิงเที่ยวไม่ครบ";
  return "";
}

let pnoReadOnlyExplicitNoPrefetch = false;

`;
  output = replaceUnique(
    output,
    "function expectedParcelsBadge(row) {",
    `${helper}function expectedParcelsBadge(row) {`,
    "read-only eligibility helper",
  );
  output = replaceUnique(
    output,
    `  const rowId = esc(row.id || "");
  const enabled = row.pnoEnabled === true && rowId;
  if (enabled && pending > 0 && !pnoOperationalTruthFresh(row)) pnoOperationalObserveSoon();`,
    `  const rowId = esc(row.id || "");
  const detail = pnoReadOnlyDetailEligibility(row);
  const enabled = detail.available && rowId;`,
    "render eligibility",
  );
  output = replaceUnique(
    output,
    `  const attr = enabled
    ? ' data-pno-operational-row="' + rowId + '" data-pno-detail-card="' + rowId + '" role="button" tabindex="0" aria-label="กดดูรายละเอียดพัสดุ"'
    : "";
  return \`<div class="expected-parcels-badge pno-summary \${pnoProgressClass(percent)}"\${attr}><div class="pno-metrics"><span><small>พัสดุทั้งหมด</small><b>\${nf.format(expected)}</b></span>\${alreadyButton}\${pendingButton}</div><div class="pno-progress-head"><strong>\${pnoDisplayPercent(percent)}</strong><span>\${pnoProgressStatus(percent)} · เป้า 90%</span></div><div class="pno-progress-track" aria-label="เข้าคลังแล้ว \${pnoDisplayPercent(percent)}"><span class="pno-progress-fill" style="--pno-progress:\${scale}"></span><i class="pno-progress-marker" title="เป้าหมาย 90%"></i></div></div>\`;`,
    `  const attr = enabled
    ? ' data-pno-detail-card="' + rowId + '" role="button" tabindex="0" aria-label="กดดูรายละเอียดพัสดุ"'
    : "";
  const unavailable = enabled ? "" : pnoReadOnlyUnavailableMessage(detail);
  const unavailableHtml = unavailable
    ? '<span class="pno-detail-unavailable" aria-disabled="true">' + esc(unavailable) + '</span>'
    : "";
  return \`<div class="expected-parcels-badge pno-summary \${pnoProgressClass(percent)}"\${attr}><div class="pno-metrics"><span><small>พัสดุทั้งหมด</small><b>\${nf.format(expected)}</b></span>\${alreadyButton}\${pendingButton}</div><div class="pno-progress-head"><strong>\${pnoDisplayPercent(percent)}</strong><span>\${pnoProgressStatus(percent)} · เป้า 90%</span></div><div class="pno-progress-track" aria-label="เข้าคลังแล้ว \${pnoDisplayPercent(percent)}"><span class="pno-progress-fill" style="--pno-progress:\${scale}"></span><i class="pno-progress-marker" title="เป้าหมาย 90%"></i></div>\${unavailableHtml}</div>\`;`,
    "click-only card",
  );
  output = output.replaceAll(
    `args.row.pnoState !== "OK" || args.row.pnoEnabled !== true`,
    `!pnoReadOnlyDetailEligibility(args.row).available`,
  );
  output = replaceUnique(
    output,
    `async function pnoOperationalResolve(row) {
  const raw = pnoOperationalRawSummary(row);`,
    `async function pnoOperationalResolve(row) {
  const raw = pnoOperationalRawSummary(row);
  if (pnoReadOnlyExplicitNoPrefetch)
    return pnoOperationalTruthEntry(row)?.truth || raw;`,
    "explicit open no-prefetch guard",
  );
  output = replaceUnique(
    output,
    `  await pnoOperationalResolve(args.row);
  pnoV18RenderSummary();`,
    `  // Preserve any already-cached correction without starting total/pending
  // prefetch fan-out. The selected detail tab below is the one bounded request.
  pnoReadOnlyExplicitNoPrefetch = true;
  try {
    await pnoOperationalResolve(args.row);
  } finally {
    pnoReadOnlyExplicitNoPrefetch = false;
  }
  pnoV18RenderSummary();`,
    "explicit open request bound",
  );
  output = replaceUnique(
    output,
    `  const virtual = !force && (type === "already" || type === "no_entry")
    ? await pnoOperationalVirtualPage(sourceRow, type, page)
    : null;
  const result = virtual || await browserPnoPage(sourceRow, type, page, force);`,
    `  const result = await browserPnoPage(sourceRow, type, page, force);`,
    "single explicit request path",
  );
  return output;
}
