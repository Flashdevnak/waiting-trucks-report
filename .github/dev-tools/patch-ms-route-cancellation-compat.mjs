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
    `function routeState(row, now = new Date()) {\n  const eta = parseDate(row.estimatedArrivalAt);\n  const routeArrival = parseDate(row.actualArrivalAt);\n  const arrival = routeArrival ? effectiveArrival(row) : null;`,
    `// ${FIRST_SOURCE_MARKER}: queue admission is first-source-wins. Route still\n// owns real arrival/status truth; a reached TBR may admit an inbound trip while\n// the Route source has not published that trip yet.\nfunction routeState(row, now = new Date()) {\n  const eta = parseDate(row.estimatedArrivalAt);\n  const routeArrival = parseDate(row.actualArrivalAt);\n  const tbrQueueArrival =\n    (isDestination(row) || isDrop(row))\n      ? parseDate(row.scheduleTbrArrivalAt)\n      : null;\n  const arrival = routeArrival ? effectiveArrival(row) : tbrQueueArrival;`,
    "route state uses TBR only for provisional queue admission",
  );

  output = replaceUnique(
    output,
    `  if (routeArrival)\n    return {\n      key: "arrived",\n      label: "มาถึงแล้ว",\n      color: departureLate ? "#b3261e" : "#2563eb",\n      arrivalLate,\n      departureLate,\n    };\n  return {`,
    `  if (routeArrival)\n    return {\n      key: "arrived",\n      label: "มาถึงแล้ว",\n      color: departureLate ? "#b3261e" : "#2563eb",\n      arrivalLate,\n      departureLate,\n    };\n  if (tbrQueueArrival)\n    return {\n      key: "arrived",\n      label: "TBR เข้าคิว · รอ Route ยืนยัน",\n      color: "#2563eb",\n      arrivalLate,\n      departureLate: false,\n    };\n  return {`,
    "show provisional TBR queue state without claiming Route arrival",
  );

  output = replaceUnique(
    output,
    `function queueInfo(row, now = new Date()) {\n  const routeArrival = parseDate(row.actualArrivalAt),\n    arrival = routeArrival ? effectiveArrival(row) : null,\n    ageHours = arrival ? (now - arrival) / 36e5 : 0;`,
    `function queueInfo(row, now = new Date()) {\n  const routeArrival = parseDate(row.actualArrivalAt),\n    tbrQueueArrival =\n      (isDestination(row) || isDrop(row))\n        ? parseDate(row.scheduleTbrArrivalAt)\n        : null,\n    arrival = routeArrival ? effectiveArrival(row) : tbrQueueArrival,\n    ageHours = arrival ? (now - arrival) / 36e5 : 0;`,
    "queue admission accepts reached TBR for inbound trips",
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
    `    : row.estimatedArrivalAt || row.actualArrivalAt || row.estimatedDepartureAt;`,
    `    : row.estimatedArrivalAt || row.actualArrivalAt || row.scheduleTbrArrivalAt || row.estimatedDepartureAt;`,
    "TBR-only rows retain their Bangkok business day",
  );

  output = replaceUnique(
    output,
    `      const aTime = (confirmedEffectiveArrival(a) || parseDate(a.estimatedArrivalAt))?.getTime() || 0;\n      const bTime = (confirmedEffectiveArrival(b) || parseDate(b.estimatedArrivalAt))?.getTime() || 0;`,
    `      const aTime = (confirmedEffectiveArrival(a) || parseDate(a.scheduleTbrArrivalAt) || parseDate(a.estimatedArrivalAt))?.getTime() || 0;\n      const bTime = (confirmedEffectiveArrival(b) || parseDate(b.scheduleTbrArrivalAt) || parseDate(b.estimatedArrivalAt))?.getTime() || 0;`,
    "sort TBR-first rows by their admitted queue time",
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
