const MARKER = "PNO_NEXT_BRANCH_SOURCE_TRUTH_V1";

export function patchPnoNextBranchTruthWorker(source) {
  const output = String(source || "");
  if (output.includes(MARKER)) return output;
  const previous = "      targetBranch: cleanStoreName(row.ticket_delivery_store_name || row.dst_store_name || row.target_store_name || row.destination_store_name || row.end_store_name || row.targetBranch),";
  const first = output.indexOf(previous);
  if (first < 0 || output.indexOf(previous, first + previous.length) !== -1)
    throw new Error(`${MARKER}: expected one staged PNO detail projection`);
  return output.replace(previous,
    `      // ${MARKER}: next_store_name is ชื่อสาขาต่อไป; delivery/pickup stores are distinct.
      targetBranch: cleanStoreName(row.next_store_name),`);
}
