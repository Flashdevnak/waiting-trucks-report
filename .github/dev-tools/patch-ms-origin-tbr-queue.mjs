const MARKER = "MS_ORIGIN_TBR_QUEUE_V1";

function replaceUnique(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0 || first !== source.lastIndexOf(from))
    throw new Error(`${MARKER}: ${label} anchor missing or non-unique`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

export function patchMsOriginTbrFrontend(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;

  output = replaceUnique(
    output,
    `  const tbrQueueArrival = !routeArrival && (isDestination(row) || isDrop(row)) ? arrival : null;`,
    `  const tbrQueueArrival = !routeArrival && (isDestination(row) || isDrop(row)) ? arrival
    : isOrigin(row) && String(row.proofId || "").trim() &&
      parseDate(row.scheduleTbrArrivalAt)?.getTime() <= now.getTime() + 5 * 60 * 1000
      ? parseDate(row.scheduleTbrArrivalAt) : null;`,
    "origin TBR state without calling it Route arrival",
  );

  output = replaceUnique(
    output,
    `// MS_ORIGIN_RELEASE_QUEUE_V1: inbound first-source queue stays KIT/TBR,\n// while Origin keeps its existing Route-only release queue membership.\nfunction queueInfo(row, now = new Date()) {\n  const arrival = queueAdmissionArrival(row),`,
    `// ${MARKER}: TBR admits a proof-identified Origin into the waiting queue.\n// It never populates Route actualArrivalAt or actualDepartureAt.\nfunction originQueueAdmissionAt(row, now = new Date()) {\n  const routeAdmission = queueAdmissionArrival(row);\n  const originTbr = String(row.proofId || "").trim()\n    ? parseDate(row.scheduleTbrArrivalAt) : null;\n  const timelyOriginTbr = originTbr && originTbr.getTime() <= now.getTime() + 5 * 60 * 1000\n    ? originTbr : null;\n  // A historical TBR cannot suppress an independently accepted, fresh Route\n  // arrival. Without Route, retain stale TBR only to express expiry.\n  const tbrCandidate = routeAdmission && timelyOriginTbr &&\n    now.getTime() - timelyOriginTbr.getTime() >= 12 * 36e5 ? null : timelyOriginTbr;\n  return [routeAdmission, tbrCandidate].filter(Boolean).sort((a, b) => a - b)[0] || null;\n}\n\nfunction queueInfo(row, now = new Date()) {\n  const arrival = isOrigin(row) ? originQueueAdmissionAt(row, now) : queueAdmissionArrival(row),`,
    "Origin queue admission with bounded future TBR",
  );

  output = replaceUnique(
    output,
    `        (state.summary === "origin" &&\n          isOrigin(row) &&\n          !queue.done &&\n          !queue.cancelled) ||`,
    `        (state.summary === "origin" && isOrigin(row) && queue.active) ||`,
    "Origin summary uses exact queue predicate",
  );

  output = replaceUnique(
    output,
    `      const arrivalDate =\n        useCompletionDay && completedAtForFilter\n          ? bangkokDateValue(completedAtForFilter)\n          : rowBusinessDay(row);\n      const queue = queueInfo(row);`,
    `      const queue = queueInfo(row);\n      // Live Origin admission uses TBR for filtering only; archive/completion\n      // business-day authority remains Route actual departure.\n      const arrivalDate =\n        useCompletionDay && completedAtForFilter\n          ? bangkokDateValue(completedAtForFilter)\n          : queueMode === "queue" && isOrigin(row) && queue.active\n            ? bangkokDateValue(originQueueAdmissionAt(row)) : rowBusinessDay(row);`,
    "live Origin date filter without changing archive business day",
  );

  output = replaceUnique(
    output,
    `function matchesOvertimeContext(row) {\n  return matchesLowerCardContext(row, rowBusinessDay(row));\n}`,
    `function matchesOvertimeContext(row) {\n  const liveOriginDay = isOrigin(row) && queueInfo(row).active\n    ? bangkokDateValue(originQueueAdmissionAt(row)) : "";\n  return matchesLowerCardContext(row, liveOriginDay || rowBusinessDay(row));\n}`,
    "Origin summary respects live TBR day filters",
  );

  output = replaceUnique(
    output,
    `<em>ถึงจริงที่ใช้</em>\${arrivalSourceDateTime(originUsed)}`,
    `<em>เวลาเข้าคิวที่ใช้</em>\${arrivalSourceDateTime(originUsed)}`,
    "Origin TBR is not labelled actual arrival",
  );

  output = replaceUnique(
    output,
    `// MS_ORIGIN_ARRIVAL_SOURCES_V1: Origin gets the same KIT / TBR / used-arrival visual block\n// as inbound rows, but this helper is presentation-only. It must never admit\n// Origin into the inbound queue or alter Route-owned lifecycle truth.`,
    `// MS_ORIGIN_ARRIVAL_SOURCES_V1: the Origin KIT/TBR block displays the\n// queue-used time only. Queue admission is separate from Route actual arrival.`,
    "Origin source presentation comment",
  );

  output = replaceUnique(
    output,
    `// LOCAL_ROUTE_BARCODE_V1: destination/drop only. Pure client-side Code 128; no API, MS, or database request.`,
    `// LOCAL_ROUTE_BARCODE_V1: recognized attendance with proofId. Pure client-side Code 128; no API, MS, or database request.`,
    "local barcode eligibility comment",
  );

  output = replaceUnique(
    output,
    `function localBarcodeEligible(row) {\n  return Boolean(String(row?.proofId || "").trim()) && (isDestination(row) || isDrop(row));\n}`,
    `function localBarcodeEligible(row) {\n  return Boolean(String(row?.proofId || "").trim()) &&\n    (isOrigin(row) || isDestination(row) || isDrop(row));\n}`,
    "local Origin barcode eligibility",
  );

  // A TBR-only placeholder has no persisted Route id to cancel. Once Route
  // replaces it, the ordinary Route cancellation control becomes available.
  output = replaceUnique(
    output,
    `\${q.active && isOrigin(row) ? \`<button type="button" class="cancel-route-button compact-cancel-route"`,
    `\${q.active && isOrigin(row) && !String(row.id || "").startsWith("TBR:") ? \`<button type="button" class="cancel-route-button compact-cancel-route"`,
    "synthetic Origin has no cancellable Route id",
  );
  output = replaceUnique(
    output,
    `\${q.active && isOrigin(row) ? \`<button type="button" class="cancel-route-button"`,
    `\${q.active && isOrigin(row) && !String(row.id || "").startsWith("TBR:") ? \`<button type="button" class="cancel-route-button"`,
    "desktop synthetic Origin cancellation guard",
  );
  output = replaceUnique(
    output,
    `  if (!row || !queueInfo(row).active)\n    return toast("เส้นทางนี้ไม่ได้อยู่ในคิวปัจจุบันแล้ว", true);`,
    `  if (!row || !queueInfo(row).active || String(row.id || "").startsWith("TBR:"))\n    return toast("เส้นทางนี้ไม่ได้อยู่ในคิวปัจจุบันแล้ว", true);`,
    "synthetic Origin cannot call Route cancellation",
  );

  return output;
}

export function patchMsOriginTbrWorker(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;
  output = replaceUnique(
    output,
    `// MS_QUEUE_FIRST_SOURCE_V1: TBR admits inbound queue rows before Route classifies`,
    `// MS_QUEUE_FIRST_SOURCE_V1 / ${MARKER}: TBR also admits exact-proof Origin rows before Route classifies`,
    "first-source marker",
  );
  output = replaceUnique(
    output,
    `  const routeOriginProofs = new Set();\n  const busByQueueKey = new Map();`,
    `  const routeOriginProofs = new Set();\n  const routeNonOriginProofs = new Set();\n  const busByQueueKey = new Map();`,
    "Route attendance veto sets",
  );
  output = replaceUnique(
    output,
    `    if (!proofId || (attendanceType !== "ปลายทาง" && attendanceType !== "จุดดรอป")) continue;`,
    `    if (!proofId || !["ต้นทาง", "ปลายทาง", "จุดดรอป"].includes(attendanceType)) continue;`,
    "Origin BusTime map admission",
  );
  output = replaceUnique(
    output,
    `    if (attendanceType === "ต้นทาง") routeOriginProofs.add(proofId);\n    const queueKey = proofId + "|" + attendanceType;`,
    `    if (attendanceType === "ต้นทาง") routeOriginProofs.add(proofId);\n    else routeNonOriginProofs.add(proofId);\n    const queueKey = proofId + "|" + attendanceType;`,
    "incompatible Route attendance veto",
  );
  output = replaceUnique(
    output,
    `    if (queueKeys.has(queueKey) || routeOriginProofs.has(proofId)) continue;`,
    `    if (queueKeys.has(queueKey) ||\n        (attendanceType !== "ต้นทาง" && routeOriginProofs.has(proofId)) ||\n        (attendanceType === "ต้นทาง" && routeNonOriginProofs.has(proofId))) continue;`,
    "one exact Route/TBR queue identity",
  );
  return output;
}
