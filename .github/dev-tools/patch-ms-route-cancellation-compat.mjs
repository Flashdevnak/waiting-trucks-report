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
    `function arrivalSources(row) {\n  if (!isDestination(row) && !isOrigin(row) && !isDrop(row)) return "";\n  const admitted = queueAdmissionArrival(row);\n  return \`<div class="arrival-system-row\${admitted ? "" : " is-empty"}"><div><span><em>KIT</em>\${arrivalSourceDateTime(row.scheduleKitArrivalAt)}</span><span><em>TBR</em>\${arrivalSourceDateTime(row.scheduleTbrArrivalAt)}</span><span><em>เวลาเข้าคิวที่ใช้</em>\${arrivalSourceDateTime(admitted)}</span></div></div>\`;\n}`,
    "show first-source admission time explicitly",
  );

  output = replaceUnique(
    output,
    `  // MS_SLA_EARLIEST_ARRIVAL_V2: Route confirms arrival; SLA uses earliest matched Route/KIT/TBR.\n  const arrival = confirmedEffectiveArrival(row);`,
    `  // MS_SLA_EARLIEST_ARRIVAL_V2 / ${FIRST_SOURCE_MARKER}: TBR can start\n  // the live queue/SLA clock immediately. Once Route appears, the existing\n  // effective-arrival merge remains in force for the same trip.\n  const arrival = queueAdmissionArrival(row);`,
    "SLA timer follows first queue admission instead of waiting for Route",
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
    `      classicOperationFact(parseDate(row.actualArrivalAt) ? "ถึงคลังจริง" : parseDate(row.scheduleTbrArrivalAt) ? "เข้าคิวจาก TBR" : "ถึงคลังจริง", shortDateTime(queueAdmissionArrival(row))),`,
    "destination operation shows TBR admission without pretending Route actual-arrival",
  );

  output = replaceUnique(
    output,
    `      classicOperationFact("ถึงจุดดรอปจริง", shortDateTime(confirmedEffectiveArrival(row))),`,
    `      classicOperationFact(parseDate(row.actualArrivalAt) ? "ถึงจุดดรอปจริง" : parseDate(row.scheduleTbrArrivalAt) ? "เข้าคิวจาก TBR" : "ถึงจุดดรอปจริง", shortDateTime(queueAdmissionArrival(row))),`,
    "drop operation shows TBR admission without pretending Route actual-arrival",
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
