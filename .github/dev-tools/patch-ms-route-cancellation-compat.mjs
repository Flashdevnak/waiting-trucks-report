import {
  patchMsRouteCancellationFrontend as patchFrontendBase,
  patchMsRouteCancellationStyle,
  patchMsRouteCancellationWorker,
} from "./patch-ms-route-cancellation.mjs";

const DESKTOP_WORK_STATUS_ANCHOR =
  `  const workStatus = isDestination(row)\n    ? row.loadStatus || status.label`;
const FIRST_SOURCE_MARKER = "MS_QUEUE_FIRST_SOURCE_V1";

function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`MS first-source queue patch failed: ${label}`);
  return output.replace(from, to);
}

export function patchMsFirstSourceQueueFrontend(source) {
  let output = String(source || "");
  if (output.includes(FIRST_SOURCE_MARKER)) return output;

  output = replaceUnique(
    output,
    `function confirmedEffectiveArrival(row) {\n  return parseDate(row.actualArrivalAt) ? effectiveArrival(row) : null;\n}`,
    `function confirmedEffectiveArrival(row) {\n  return parseDate(row.actualArrivalAt) ? effectiveArrival(row) : null;\n}\n\n// ${FIRST_SOURCE_MARKER}: Route and reached TBR are peer queue-admission sources.\n// Route is not required to approve a TBR admission. Once Route exists, the\n// existing effective-arrival merge logic remains authoritative for merged timing.\nfunction queueAdmissionArrival(row) {\n  const routeArrival = parseDate(row.actualArrivalAt);\n  if (routeArrival) return effectiveArrival(row);\n  return (isDestination(row) || isDrop(row))\n    ? parseDate(row.scheduleTbrArrivalAt)\n    : null;\n}`,
    "add shared first-source queue admission time",
  );

  output = replaceUnique(
    output,
    `function routeState(row, now = new Date()) {\n  const eta = parseDate(row.estimatedArrivalAt);\n  const routeArrival = parseDate(row.actualArrivalAt);\n  const arrival = routeArrival ? effectiveArrival(row) : null;`,
    `function routeState(row, now = new Date()) {\n  const eta = parseDate(row.estimatedArrivalAt);\n  const routeArrival = parseDate(row.actualArrivalAt);\n  const arrival = queueAdmissionArrival(row);\n  const tbrQueueArrival = !routeArrival ? arrival : null;`,
    "route state uses first admitted queue source",
  );

  output = replaceUnique(
    output,
    `  if (routeArrival)\n    return {\n      key: "arrived",\n      label: "มาถึงแล้ว",\n      color: departureLate ? "#b3261e" : "#2563eb",\n      arrivalLate,\n      departureLate,\n    };\n  return {`,
    `  if (routeArrival)\n    return {\n      key: "arrived",\n      label: "มาถึงแล้ว",\n      color: departureLate ? "#b3261e" : "#2563eb",\n      arrivalLate,\n      departureLate,\n    };\n  if (tbrQueueArrival)\n    return {\n      key: "arrived",\n      label: "เข้าคิวแล้วจาก TBR",\n      color: "#2563eb",\n      arrivalLate,\n      departureLate: false,\n    };\n  return {`,
    "show TBR as an admitted queue state, not pending approval",
  );

  output = replaceUnique(
    output,
    `function queueInfo(row, now = new Date()) {\n  const routeArrival = parseDate(row.actualArrivalAt),\n    arrival = routeArrival ? effectiveArrival(row) : null,\n    ageHours = arrival ? (now - arrival) / 36e5 : 0;`,
    `function queueInfo(row, now = new Date()) {\n  const arrival = queueAdmissionArrival(row),\n    ageHours = arrival ? (now - arrival) / 36e5 : 0;`,
    "queue membership uses first admitted source",
  );

  output = replaceUnique(
    output,
    `    active = Boolean(routeArrival) && !done && !cancelled && ageHours <= 12;`,
    `    active = Boolean(arrival) && !done && !cancelled && ageHours <= 12;`,
    "active queue uses first accepted arrival source",
  );

  output = replaceUnique(
    output,
    `    expired: Boolean(routeArrival) && !done && !cancelled && ageHours > 12,`,
    `    expired: Boolean(arrival) && !done && !cancelled && ageHours > 12,`,
    "TBR-first queue expires under the same 12-hour rule",
  );

  output = replaceUnique(
    output,
    `function dropOperation(row) {\n  const unloadingState = Number(row.unloadingState);\n  const arrival = parseDate(row.actualArrivalAt);`,
    `function dropOperation(row) {\n  const unloadingState = Number(row.unloadingState);\n  const arrival = queueAdmissionArrival(row);`,
    "drop operation recognizes TBR-first queue admission",
  );

  output = replaceUnique(
    output,
    `    : row.estimatedArrivalAt || row.actualArrivalAt || row.estimatedDepartureAt;`,
    `    : row.estimatedArrivalAt || row.actualArrivalAt || row.scheduleTbrArrivalAt || row.estimatedDepartureAt;`,
    "TBR-only rows retain their Bangkok business day",
  );

  output = replaceUnique(
    output,
    `      const aTime = (confirmedEffectiveArrival(a) || parseDate(a.estimatedArrivalAt))?.getTime() || 0;\n      const bTime = (confirmedEffectiveArrival(b) || parseDate(b.estimatedArrivalAt))?.getTime() || 0;`,
    `      const aTime = (queueAdmissionArrival(a) || parseDate(a.estimatedArrivalAt))?.getTime() || 0;\n      const bTime = (queueAdmissionArrival(b) || parseDate(b.estimatedArrivalAt))?.getTime() || 0;`,
    "sort queue by first admitted source",
  );

  output = replaceUnique(
    output,
    `function waitInfo(row) {\n  const start = confirmedEffectiveArrival(row),`,
    `function waitInfo(row) {\n  const start = queueAdmissionArrival(row),`,
    "start queue timer immediately from TBR or Route",
  );

  output = replaceUnique(
    output,
    `function arrivalSources(row) {\n  if (!isDestination(row) && !isOrigin(row) && !isDrop(row)) return "";\n  const effective = confirmedEffectiveArrival(row);\n  return \`<div class="arrival-system-row\${effective ? "" : " is-empty"}"><div><span><em>KIT</em>\${arrivalSourceDateTime(row.scheduleKitArrivalAt)}</span><span><em>TBR</em>\${arrivalSourceDateTime(row.scheduleTbrArrivalAt)}</span><span><em>ถึงจริงที่ใช้</em>\${arrivalSourceDateTime(effective)}</span></div></div>\`;\n}`,
    `function arrivalSources(row) {\n  if (!isDestination(row) && !isOrigin(row) && !isDrop(row)) return "";\n  const effective = confirmedEffectiveArrival(row);\n  const admitted = queueAdmissionArrival(row);\n  return \`<div class="arrival-system-row\${admitted ? "" : " is-empty"}"><div><span><em>KIT</em>\${arrivalSourceDateTime(row.scheduleKitArrivalAt)}</span><span><em>TBR</em>\${arrivalSourceDateTime(row.scheduleTbrArrivalAt)}</span><span><em>ถึงจริงที่ใช้</em>\${arrivalSourceDateTime(effective)}</span><span><em>เวลาเข้าคิวที่ใช้</em>\${arrivalSourceDateTime(admitted)}</span></div></div>\`;\n}`,
    "show both Route-confirmed truth and first-source queue admission time",
  );

  output = replaceUnique(
    output,
    `  // MS_SLA_EARLIEST_ARRIVAL_V2: Route confirms arrival; SLA uses earliest matched Route/KIT/TBR.\n  const arrival = confirmedEffectiveArrival(row);\n  const workEnd = finish || (Number(row.unloadingState) === 1 && start ? now : null);`,
    `  // MS_SLA_EARLIEST_ARRIVAL_V2 / ${FIRST_SOURCE_MARKER}: keep Route-confirmed\n  // arrival truth separate, while a reached TBR can start the queue/SLA clock.\n  const arrival = confirmedEffectiveArrival(row);\n  const queueArrival = arrival || ((isDestination(row) || isDrop(row)) ? parseDate(row.scheduleTbrArrivalAt) : null);\n  const workEnd = finish || (Number(row.unloadingState) === 1 && start ? now : null);`,
    "add TBR fallback to SLA without fabricating Route arrival",
  );

  output = replaceUnique(
    output,
    `  // Route confirms arrival; SLA starts from the earliest matched Route/KIT/TBR time.\n  const slaEnd = finish || (!completed && arrival ? now : null);\n  const slaMinutes = arrival && slaEnd && slaEnd >= arrival\n    ? Math.floor((slaEnd - arrival) / 60000)\n    : null;`,
    `  // Queue/SLA starts from whichever accepted inbound source admitted first.\n  const slaEnd = finish || (!completed && queueArrival ? now : null);\n  const slaMinutes = queueArrival && slaEnd && slaEnd >= queueArrival\n    ? Math.floor((slaEnd - queueArrival) / 60000)\n    : null;`,
    "calculate SLA from first queue admission",
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
    `    if (!timing.arrival) return { text: "ยังไม่มีเวลาเข้าคิวจาก Route/TBR", severity: "neutral" };`,
    "remove Route approval wording",
  );

  output = replaceUnique(
    output,
    `      classicOperationFact("ถึงคลังจริง", shortDateTime(confirmedEffectiveArrival(row))),`,
    `      classicOperationFact(\n        parseDate(row.actualArrivalAt) ? "ถึงคลังจริง" : parseDate(row.scheduleTbrArrivalAt) ? "เข้าคิวจาก TBR" : "ถึงคลังจริง",\n        parseDate(row.actualArrivalAt)\n          ? shortDateTime(confirmedEffectiveArrival(row))\n          : shortDateTime(queueAdmissionArrival(row)),\n      ),`,
    "destination operation separates Route truth from TBR admission",
  );

  output = replaceUnique(
    output,
    `      classicOperationFact("ถึงจุดดรอปจริง", shortDateTime(confirmedEffectiveArrival(row))),`,
    `      classicOperationFact(\n        parseDate(row.actualArrivalAt) ? "ถึงจุดดรอปจริง" : parseDate(row.scheduleTbrArrivalAt) ? "เข้าคิวจาก TBR" : "ถึงจุดดรอปจริง",\n        parseDate(row.actualArrivalAt)\n          ? shortDateTime(confirmedEffectiveArrival(row))\n          : shortDateTime(queueAdmissionArrival(row)),\n      ),`,
    "drop operation separates Route truth from TBR admission",
  );

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
