function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`MS non-destination cancellation patch failed: ${label}`);
  return output.replace(from, to);
}

function replaceCount(output, from, to, expected, label) {
  const parts = output.split(from);
  const count = parts.length - 1;
  if (count !== expected)
    throw new Error(
      `MS non-destination cancellation patch failed: ${label} (expected ${expected}, got ${count})`,
    );
  return parts.join(to);
}

const FRONTEND_MARKER = "งานปลายทางไม่สามารถยกเลิกรถจากคิวด้วยมือได้";
const WORKER_MARKER = "DESTINATION_CANCEL_NOT_ALLOWED";

export function patchMsNonDestinationCancellationFrontend(source) {
  let output = String(source || "");
  if (output.includes(FRONTEND_MARKER)) return output;

  output = replaceCount(
    output,
    `\${q.active ? \`<button type="button" class="cancel-route-button`,
    `\${q.active && !isDestination(row) ? \`<button type="button" class="cancel-route-button`,
    2,
    "desktop and mobile cancel button visibility",
  );

  output = replaceUnique(
    output,
    `  if (!row || !queueInfo(row).active)\n    return toast("เส้นทางนี้ไม่ได้อยู่ในคิวปัจจุบันแล้ว", true);\n  cancelRouteTarget = { id, proofId: row.proofId || "", routeName: row.routeName || "" };`,
    `  if (!row || !queueInfo(row).active)\n    return toast("เส้นทางนี้ไม่ได้อยู่ในคิวปัจจุบันแล้ว", true);\n  if (isDestination(row))\n    return toast("งานปลายทางไม่สามารถยกเลิกรถจากคิวด้วยมือได้", true);\n  cancelRouteTarget = { id, proofId: row.proofId || "", routeName: row.routeName || "" };`,
    "frontend destination guard",
  );

  return output;
}

export function patchMsNonDestinationCancellationWorker(source) {
  let output = String(source || "");
  if (output.includes(WORKER_MARKER)) return output;

  output = replaceUnique(
    output,
    `  const attendance = normalizeMsAttendance(route.attendance_type);\n  const done =`,
    `  const attendance = normalizeMsAttendance(route.attendance_type);\n  if (attendance === "ปลายทาง")\n    fail("งานปลายทางไม่สามารถยกเลิกรถจากคิวด้วยมือได้", "DESTINATION_CANCEL_NOT_ALLOWED", 409);\n  const done =`,
    "backend destination guard",
  );

  return output;
}
