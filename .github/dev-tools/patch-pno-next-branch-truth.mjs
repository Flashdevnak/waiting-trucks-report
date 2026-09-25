const MARKER = "PNO_NEXT_BRANCH_SOURCE_TRUTH_V1";
const DESTINATION_MARKER = "PNO_DELIVERY_BRANCH_PROVENANCE_V2";

export function patchPnoNextBranchTruthWorker(source) {
  const output = String(source || "");
  if (output.includes(DESTINATION_MARKER)) return output;
  const previous = output.includes(MARKER)
    ? "      targetBranch: cleanStoreName(row.next_store_name),"
    : "      targetBranch: cleanStoreName(row.ticket_delivery_store_name || row.dst_store_name || row.target_store_name || row.destination_store_name || row.end_store_name || row.targetBranch),";
  const first = output.indexOf(previous);
  if (first < 0 || output.indexOf(previous, first + previous.length) !== -1)
    throw new Error(`${DESTINATION_MARKER}: expected one staged PNO detail projection`);
  return output.replace(previous,
    `      // ${MARKER}: ${DESTINATION_MARKER}: delivery branch is independent of the next segment store.
      targetBranch: cleanStoreName(row.ticket_delivery_store_name),`);
}

export function patchPnoDestinationLabelsFrontend(source) {
  let output = String(source || "");
  if (output.includes(DESTINATION_MARKER)) return output;
  for (const [previous, replacement, expected] of [
    ["HUB ปลายทาง", "จุดที่ระบุในข้อมูลพัสดุ", 5],
    ["สาขาถัดไป", "สาขาปลายทาง", 4],
  ]) {
    const count = output.split(previous).length - 1;
    if (count !== expected)
      throw new Error(`${DESTINATION_MARKER}: expected ${expected} staged labels for ${previous}; got ${count}`);
    output = output.replaceAll(previous, replacement);
  }
  return `${output}\n// ${DESTINATION_MARKER}: neutral parcel location; provider delivery branch.\n`;
}
