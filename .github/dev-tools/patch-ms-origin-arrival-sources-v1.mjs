const MARKER = "MS_ORIGIN_ARRIVAL_SOURCES_V1";

function replaceBlock(output, startMarker, endMarker, replacement, label) {
  const start = output.indexOf(startMarker);
  const end = output.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end <= start)
    throw new Error(`MS Origin arrival sources V1 patch failed: ${label}`);
  return output.slice(0, start) + replacement + output.slice(end);
}

export function patchMsOriginArrivalSourcesV1(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;
  if (!output.includes("function queueAdmissionArrival"))
    throw new Error("MS Origin arrival sources V1 requires queueAdmissionArrival first");

  const replacement = `// ${MARKER}: Origin gets the same KIT / TBR / used-arrival visual block\n// as inbound rows, but this helper is presentation-only. It must never admit\n// Origin into the inbound queue or alter Route-owned lifecycle truth.\nfunction originArrivalDisplayUsed(row) {\n  if (!isOrigin(row)) return null;\n  return [parseDate(row.actualArrivalAt), parseDate(row.scheduleTbrArrivalAt)]\n    .filter(Boolean)\n    .sort((a, b) => a - b)[0] || null;\n}\n\nfunction arrivalSources(row) {\n  if (!isDestination(row) && !isOrigin(row) && !isDrop(row)) return \"\";\n  const used = queueAdmissionArrival(row);\n  if (isOrigin(row)) {\n    const originUsed = originArrivalDisplayUsed(row);\n    return \`<div class=\"arrival-system-row\${originUsed ? \"\" : \" is-empty\"}\"><div><span><em>KIT</em>\${arrivalSourceDateTime(row.actualArrivalAt)}</span><span><em>TBR</em>\${arrivalSourceDateTime(row.scheduleTbrArrivalAt)}</span><span><em>ถึงจริงที่ใช้</em>\${arrivalSourceDateTime(originUsed)}</span></div></div>\`;\n  }\n  return \`<div class=\"arrival-system-row\${used ? \"\" : \" is-empty\"}\"><div><span><em>KIT</em>\${arrivalSourceDateTime(row.actualArrivalAt)}</span><span><em>TBR</em>\${arrivalSourceDateTime(row.scheduleTbrArrivalAt)}</span><span><em>ถึงจริงที่ใช้</em>\${arrivalSourceDateTime(used)}</span></div></div>\`;\n}\n`;

  output = replaceBlock(
    output,
    "function arrivalSources(row) {",
    "\nfunction arrivalSourceDateTime(value)",
    replacement,
    "arrivalSources block",
  );

  for (const expected of [
    MARKER,
    "function originArrivalDisplayUsed(row)",
    "if (!isOrigin(row)) return null;",
    "parseDate(row.actualArrivalAt)",
    "parseDate(row.scheduleTbrArrivalAt)",
    "!isDestination(row) && !isOrigin(row) && !isDrop(row)",
    "const used = queueAdmissionArrival(row);",
    "const originUsed = originArrivalDisplayUsed(row);",
    '<em>KIT</em>${arrivalSourceDateTime(row.actualArrivalAt)}',
    '<em>TBR</em>${arrivalSourceDateTime(row.scheduleTbrArrivalAt)}',
    '<em>ถึงจริงที่ใช้</em>${arrivalSourceDateTime(originUsed)}',
    '<em>ถึงจริงที่ใช้</em>${arrivalSourceDateTime(used)}',
  ]) {
    if (!output.includes(expected))
      throw new Error(`MS Origin arrival sources V1 invariant missing: ${expected}`);
  }

  return output;
}
