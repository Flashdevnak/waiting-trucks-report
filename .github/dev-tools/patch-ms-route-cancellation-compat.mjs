import {
  patchMsRouteCancellationFrontend as patchFrontendBase,
  patchMsRouteCancellationStyle,
  patchMsRouteCancellationWorker,
} from "./patch-ms-route-cancellation.mjs";

const DESKTOP_WORK_STATUS_ANCHOR =
  `  const workStatus = isDestination(row)\n    ? row.loadStatus || status.label`;
const FIRST_SOURCE_MARKER = "MS_QUEUE_FIRST_SOURCE_V1";
const KIT_TBR_CONTRACT_MARKER = "MS_QUEUE_KIT_TBR_CONTRACT_V2";
const ORIGIN_RELEASE_QUEUE_MARKER = "MS_ORIGIN_RELEASE_QUEUE_V1";

function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`MS first-source queue patch failed: ${label}`);
  return output.replace(from, to);
}

export function patchMsFirstSourceQueueFrontend(source) {
  let output = String(source || "");
  if (output.includes(KIT_TBR_CONTRACT_MARKER)) return output;

  output = replaceUnique(
    output,
    `function confirmedEffectiveArrival(row) {\n  return parseDate(row.actualArrivalAt) ? effectiveArrival(row) : null;\n}`,
    `// ${FIRST_SOURCE_MARKER} / ${KIT_TBR_CONTRACT_MARKER}\n// Operational source contract:\n// - KIT = Route/storeLineAttendance actualArrivalAt.\n// - TBR = schedule-management scheduleTbrArrivalAt.\n// scheduleKitArrivalAt is supplementary metadata only and must not admit or\n// backdate the queue. Raw Route actualArrivalAt remains untouched.\nfunction confirmedEffectiveArrival(row) {\n  const routeKitArrival = parseDate(row.actualArrivalAt);\n  if (!routeKitArrival) return null;\n  if (!isDestination(row) && !isDrop(row)) return routeKitArrival;\n  const tbrArrival = parseDate(row.scheduleTbrArrivalAt);\n  return [routeKitArrival, tbrArrival]\n    .filter(Boolean)\n    .sort((a, b) => a - b)[0] || null;\n}\n\nfunction queueAdmissionArrival(row) {\n  const routeKitArrival = parseDate(row.actualArrivalAt);\n  if (!isDestination(row) && !isDrop(row)) return routeKitArrival;\n  const tbrArrival = parseDate(row.scheduleTbrArrivalAt);\n  return [routeKitArrival, tbrArrival]\n    .filter(Boolean)\n    .sort((a, b) => a - b)[0] || null;\n}`,
    "add Route-KIT + schedule-TBR queue source contract",
  );

  output = replaceUnique(
    output,
    `function routeState(row, now = new Date()) {\n  const eta = parseDate(row.estimatedArrivalAt);\n  const routeArrival = parseDate(row.actualArrivalAt);\n  const arrival = routeArrival ? effectiveArrival(row) : null;`,
    `function routeState(row, now = new Date()) {\n  const eta = parseDate(row.estimatedArrivalAt);\n  const routeArrival = parseDate(row.actualArrivalAt);\n  const arrival = queueAdmissionArrival(row);\n  const tbrQueueArrival = !routeArrival && (isDestination(row) || isDrop(row)) ? arrival : null;`,
    "route state uses Route-KIT/TBR admission time",
  );

  output = replaceUnique(
    output,
    `  if (routeArrival)\n    return {\n      key: "arrived",\n      label: "มาถึงแล้ว",\n      color: departureLate ? "#b3261e" : "#2563eb",\n      arrivalLate,\n      departureLate,\n    };\n  return {`,
    `  if (routeArrival)\n    return {\n      key: "arrived",\n      label: "มาถึงแล้ว",\n      color: departureLate ? "#b3261e" : "#2563eb",\n      arrivalLate,\n      departureLate,\n    };\n  if (tbrQueueArrival)\n    return {\n      key: "arrived",\n      label: "เข้าคิวแล้วจาก TBR",\n      color: "#2563eb",\n      arrivalLate,\n      departureLate: false,\n    };\n  return {`,
    "show TBR as an admitted queue state",
  );

  output = replaceUnique(
    output,
    `function schedulePunctuality(row, mode) {\n  const incoming = mode === "arrival";\n  const plan = parseDate(incoming ? row.estimatedArrivalAt : row.estimatedDepartureAt);\n  const actual = incoming\n    ? confirmedEffectiveArrival(row)\n    : parseDate(row.actualDepartureAt);`,
    `function schedulePunctuality(row, mode) {\n  const incoming = mode === "arrival";\n  const plan = parseDate(incoming ? row.estimatedArrivalAt : row.estimatedDepartureAt);\n  const actual = incoming\n    ? queueAdmissionArrival(row)\n    : parseDate(row.actualDepartureAt);`,
    "arrival punctuality uses earliest Route-KIT/TBR",
  );

  output = replaceUnique(
    output,
    `function scheduleSection(row, mode) {\n  const incoming = mode === "arrival";\n  const plan = incoming ? row.estimatedArrivalAt : row.estimatedDepartureAt;\n  const actual = incoming\n    ? confirmedEffectiveArrival(row)\n    : row.actualDepartureAt;\n  // Route confirms arrival. Once confirmed, the main value is the earliest\n  // matched Route/KIT/TBR timestamp; raw source values remain visible below.`,
    `function scheduleSection(row, mode) {\n  const incoming = mode === "arrival";\n  const plan = incoming ? row.estimatedArrivalAt : row.estimatedDepartureAt;\n  const actual = incoming\n    ? queueAdmissionArrival(row)\n    : row.actualDepartureAt;\n  // Incoming actual-used time is the earliest accepted Route-KIT/TBR timestamp.\n  // Raw Route and TBR source values remain separate below.`,
    "arrival section shows the same used queue timestamp",
  );

  output = replaceUnique(
    output,
    `function queueInfo(row, now = new Date()) {\n  const routeArrival = parseDate(row.actualArrivalAt),\n    arrival = routeArrival ? effectiveArrival(row) : null,\n    ageHours = arrival ? (now - arrival) / 36e5 : 0;`,
    `// ${ORIGIN_RELEASE_QUEUE_MARKER}: inbound first-source queue stays KIT/TBR,\n// while Origin keeps its existing Route-only release queue membership.\nfunction queueInfo(row, now = new Date()) {\n  const arrival = queueAdmissionArrival(row),\n    originReleaseQueue = isOrigin(row),\n    inboundQueue = isDestination(row) || isDrop(row) || originReleaseQueue,\n    ageHours = arrival ? (now - arrival) / 36e5 : 0;`,
    "queue membership keeps inbound first-source plus Route-only origin release",
  );

  output = replaceUnique(
    output,
    `    active = Boolean(routeArrival) && !done && !cancelled && ageHours <= 12;`,
    `    active = inboundQueue && Boolean(arrival) && !done && !cancelled && ageHours <= 12;`,
    "active queue keeps destination/drop and Route-only origin release",
  );

  output = replaceUnique(
    output,
    `    expired: Boolean(routeArrival) && !done && !cancelled && ageHours > 12,`,
    `    expired: inboundQueue && Boolean(arrival) && !done && !cancelled && ageHours > 12,`,
    "expired queue keeps destination/drop and Route-only origin release",
  );

  output = replaceUnique(
    output,
    `function dropOperation(row) {\n  const unloadingState = Number(row.unloadingState);\n  const arrival = parseDate(row.actualArrivalAt);`,
    `function dropOperation(row) {\n  const unloadingState = Number(row.unloadingState);\n  const arrival = queueAdmissionArrival(row);`,
    "drop operation recognizes TBR-first queue admission",
  );

  if (!output.includes("MS_REC04_BUSINESS_DAY_TRUTH_V1")) {
    output = replaceUnique(
      output,
      `    : row.estimatedArrivalAt || row.actualArrivalAt || row.estimatedDepartureAt;`,
      `    : row.estimatedArrivalAt || row.actualArrivalAt || row.scheduleTbrArrivalAt || row.estimatedDepartureAt;`,
      "TBR-only rows retain their Bangkok business day",
    );
  } else if (!output.includes("scheduleTbrArrivalAt")) {
    throw new Error("MS first-source queue patch failed: REC-04 business-day TBR authority missing");
  }

  output = replaceUnique(
    output,
    `      const aTime = (confirmedEffectiveArrival(a) || parseDate(a.estimatedArrivalAt))?.getTime() || 0;\n      const bTime = (confirmedEffectiveArrival(b) || parseDate(b.estimatedArrivalAt))?.getTime() || 0;`,
    `      const aTime = (queueAdmissionArrival(a) || parseDate(a.estimatedArrivalAt))?.getTime() || 0;\n      const bTime = (queueAdmissionArrival(b) || parseDate(b.estimatedArrivalAt))?.getTime() || 0;`,
    "sort queue by first Route-KIT/TBR admission",
  );

  output = replaceUnique(
    output,
    `function waitInfo(row) {\n  const start = confirmedEffectiveArrival(row),`,
    `function waitInfo(row) {\n  const start = queueAdmissionArrival(row),`,
    "start queue timer from earliest Route-KIT/TBR",
  );

  output = replaceUnique(
    output,
    `function actualCell(row) {\n  const incoming = isDestination(row) || isDrop(row);\n  const value = incoming\n    ? confirmedEffectiveArrival(row)\n    : row.actualDepartureAt;`,
    `function actualCell(row) {\n  const incoming = isDestination(row) || isDrop(row);\n  const value = incoming\n    ? queueAdmissionArrival(row)\n    : row.actualDepartureAt;`,
    "desktop actual cell uses earliest Route-KIT/TBR",
  );

  output = replaceUnique(
    output,
    `function arrivalSources(row) {\n  if (!isDestination(row) && !isOrigin(row) && !isDrop(row)) return "";\n  const effective = confirmedEffectiveArrival(row);\n  return \`<div class="arrival-system-row\${effective ? "" : " is-empty"}"><div><span><em>KIT</em>\${arrivalSourceDateTime(row.scheduleKitArrivalAt)}</span><span><em>TBR</em>\${arrivalSourceDateTime(row.scheduleTbrArrivalAt)}</span><span><em>ถึงจริงที่ใช้</em>\${arrivalSourceDateTime(effective)}</span></div></div>\`;\n}`,
    `function arrivalSources(row) {\n  if (!isDestination(row) && !isDrop(row)) return "";\n  const used = queueAdmissionArrival(row);\n  return \`<div class="arrival-system-row\${used ? "" : " is-empty"}"><div><span><em>KIT</em>\${arrivalSourceDateTime(row.actualArrivalAt)}</span><span><em>TBR</em>\${arrivalSourceDateTime(row.scheduleTbrArrivalAt)}</span><span><em>ถึงจริงที่ใช้</em>\${arrivalSourceDateTime(used)}</span></div></div>\`;\n}`,
    "show Route as KIT, schedule TBR, and one used timestamp only",
  );

  output = replaceUnique(
    output,
    `    actualArrivalAt: exportThaiDate(confirmedEffectiveArrival(row)),`,
    `    actualArrivalAt: exportThaiDate((isDestination(row) || isDrop(row)) ? queueAdmissionArrival(row) : confirmedEffectiveArrival(row)),`,
    "export actual-used arrival from Route-KIT/TBR",
  );

  output = replaceUnique(
    output,
    `  // MS_SLA_EARLIEST_ARRIVAL_V2: Route confirms arrival; SLA uses earliest matched Route/KIT/TBR.\n  const arrival = confirmedEffectiveArrival(row);\n  const workEnd = finish || (Number(row.unloadingState) === 1 && start ? now : null);`,
    `  // MS_SLA_EARLIEST_ARRIVAL_V2 / ${KIT_TBR_CONTRACT_MARKER}: queue/SLA uses\n  // the same earliest Route-KIT/TBR timestamp shown as "ถึงจริงที่ใช้".\n  const arrival = confirmedEffectiveArrival(row);\n  const queueArrival = (isDestination(row) || isDrop(row)) ? queueAdmissionArrival(row) : arrival;\n  const workEnd = finish || (Number(row.unloadingState) === 1 && start ? now : null);`,
    "SLA uses the same Route-KIT/TBR admission time",
  );

  output = replaceUnique(
    output,
    `  // Route confirms arrival; SLA starts from the earliest matched Route/KIT/TBR time.\n  const slaEnd = finish || (!completed && arrival ? now : null);\n  const slaMinutes = arrival && slaEnd && slaEnd >= arrival\n    ? Math.floor((slaEnd - arrival) / 60000)\n    : null;`,
    `  // Queue/SLA starts from whichever accepted KIT/TBR source occurred first.\n  const slaEnd = finish || (!completed && queueArrival ? now : null);\n  const slaMinutes = queueArrival && slaEnd && slaEnd >= queueArrival\n    ? Math.floor((slaEnd - queueArrival) / 60000)\n    : null;`,
    "calculate SLA from earliest Route-KIT/TBR",
  );

  output = replaceUnique(
    output,
    `  return {\n    arrival,\n    start,\n    finish,`,
    `  return {\n    arrival: queueArrival,\n    routeConfirmedArrival: arrival,\n    start,\n    finish,`,
    "expose queue arrival while retaining Route-confirmed arrival",
  );

  output = replaceUnique(
    output,
    `    if (!timing.arrival) return { text: "รอ Route ยืนยันรถถึงคลัง", severity: "neutral" };`,
    `    if (!timing.arrival) return { text: "ยังไม่มีเวลา KIT/TBR เข้าคิว", severity: "neutral" };`,
    "remove Route-only approval wording",
  );

  output = replaceUnique(
    output,
    `      classicOperationFact("ถึงคลังจริง", shortDateTime(confirmedEffectiveArrival(row))),`,
    `      classicOperationFact(\n        parseDate(row.actualArrivalAt) ? "ถึงคลังจริง" : parseDate(row.scheduleTbrArrivalAt) ? "เข้าคิวจาก TBR" : "ถึงคลังจริง",\n        shortDateTime(queueAdmissionArrival(row)),\n      ),`,
    "destination operation uses the same Route-KIT/TBR time",
  );

  output = replaceUnique(
    output,
    `      classicOperationFact("ถึงจุดดรอปจริง", shortDateTime(confirmedEffectiveArrival(row))),`,
    `      classicOperationFact(\n        parseDate(row.actualArrivalAt) ? "ถึงจุดดรอปจริง" : parseDate(row.scheduleTbrArrivalAt) ? "เข้าคิวจาก TBR" : "ถึงจุดดรอปจริง",\n        shortDateTime(queueAdmissionArrival(row)),\n      ),`,
    "drop operation uses the same Route-KIT/TBR time",
  );

  if (!output.includes(ORIGIN_RELEASE_QUEUE_MARKER))
    throw new Error("MS first-source queue patch failed: Origin release queue marker missing");
  if (output.includes("เวลาเข้าคิวที่ใช้"))
    throw new Error("MS queue KIT/TBR contract failed: duplicate queue-used UI remains");

  return output;
}

export function patchMsRouteCancellationFrontend(source) {
  const originalLastIndexOf = String.prototype.lastIndexOf;
  String.prototype.lastIndexOf = function (searchValue, position) {
    if (searchValue === DESKTOP_WORK_STATUS_ANCHOR)
      return this.indexOf(searchValue);
    return originalLastIndexOf.call(this, searchValue, position);
  };
  try {
    return patchMsFirstSourceQueueFrontend(patchFrontendBase(source));
  } finally {
    String.prototype.lastIndexOf = originalLastIndexOf;
  }
}

export { patchMsRouteCancellationStyle, patchMsRouteCancellationWorker };
