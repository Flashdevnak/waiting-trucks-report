const MARKER = "PNO_NEXT_BRANCH_SOURCE_TRUTH_V1";
const DESTINATION_MARKER = "PNO_DELIVERY_BRANCH_PROVENANCE_V2";
const RESTORE_MARKER = "PNO_NEXT_STORE_SEMANTICS_V3";

export function patchPnoNextBranchTruthWorker(source) {
  const output = String(source || "");
  if (output.includes(RESTORE_MARKER)) return output;
  const previous = output.includes(DESTINATION_MARKER)
    ? `      // ${MARKER}: ${DESTINATION_MARKER}: delivery branch is independent of the next segment store.
      targetBranch: cleanStoreName(row.ticket_delivery_store_name),`
    : output.includes(MARKER)
      ? `      // ${MARKER}: next_store_name is ชื่อสาขาต่อไป; delivery/pickup stores are distinct.
      targetBranch: cleanStoreName(row.next_store_name),`
      : "      targetBranch: cleanStoreName(row.ticket_delivery_store_name || row.dst_store_name || row.target_store_name || row.destination_store_name || row.end_store_name || row.targetBranch),";
  const first = output.indexOf(previous);
  if (first < 0 || output.indexOf(previous, first + previous.length) !== -1)
    throw new Error(`${RESTORE_MARKER}: expected one staged PNO detail projection`);
  return output.replace(previous,
    `      // ${MARKER}: ${RESTORE_MARKER}: next_store_name is ชื่อสาขาต่อไป; no delivery/pickup fallback.
      targetBranch: cleanStoreName(row.next_store_name),`);
}

export function patchPnoDestinationLabelsFrontend(source) {
  let output = String(source || "");
  if (output.includes(RESTORE_MARKER)) return output;
  if (output.includes(DESTINATION_MARKER)) {
    output = output.replaceAll("สาขาปลายทาง", "ชื่อสาขาต่อไป")
      .replaceAll("สาขาถัดไป", "ชื่อสาขาต่อไป")
      .replace(`// ${DESTINATION_MARKER}: neutral parcel location; provider delivery branch.`,
        `// ${RESTORE_MARKER}: neutral parcel location; next_store_name is ชื่อสาขาต่อไป.`);
    return output;
  }
  for (const [previous, replacement, expected] of [
    ["HUB ปลายทาง", "จุดที่ระบุในข้อมูลพัสดุ", 5],
    ["สาขาถัดไป", "ชื่อสาขาต่อไป", 4],
    ["สาขาปลายทาง", "ชื่อสาขาต่อไป", 5],
  ]) {
    const count = output.split(previous).length - 1;
    if (count !== expected)
      throw new Error(`${RESTORE_MARKER}: expected ${expected} staged labels for ${previous}; got ${count}`);
    output = output.replaceAll(previous, replacement);
  }
  return `${output}\n// ${RESTORE_MARKER}: neutral parcel location; next_store_name is ชื่อสาขาต่อไป.\n`;
}
