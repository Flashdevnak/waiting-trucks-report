// DEV staging correction: destination identity and exact multi-drop locators.
const MARKER = "PNO_SEGMENT_DESTINATION_TRUTH_V1";

function one(source, before, after, label) {
  const at = source.indexOf(before);
  if (at < 0 || source.indexOf(before, at + before.length) >= 0)
    throw new Error(`${MARKER}: ${label} anchor missing or repeated`);
  return source.slice(0, at) + after + source.slice(at + before.length);
}

function replaceFunction(source, name, replacement) {
  const needle = `${replacement.constructor.name === "AsyncFunction" ? "async " : ""}function ${name}(`;
  const at = source.indexOf(needle);
  const end = source.indexOf("\n}\n", at) + 2;
  if (at < 0 || end < 2 || source.indexOf(needle, at + needle.length) >= 0)
    throw new Error(`${MARKER}: ${name} function missing or repeated`);
  return source.slice(0, at) + replacement.toString() + source.slice(end);
}

export function exactPnoSegments(row) {
  const segments = row?.pnoSegments;
  if (!Number.isSafeInteger(row?.pnoSegmentCount) || row.pnoSegmentCount < 2 ||
      !Array.isArray(segments) || segments.length !== row.pnoSegmentCount ||
      !String(row.proofId || "").trim()) return null;
  const seen = new Set();
  let expected = 0, entered = 0, pending = 0;
  for (const segment of segments) {
    if (!segment || segment.proofId !== row.proofId ||
        !/^\d{4}-\d{2}-\d{2}$/.test(String(segment.pnoSourceDay || "")) ||
        !String(segment.pnoLineId || segment.pnoVanLineId || "").trim() ||
        !String(segment.pnoStoreId || "").trim() || !String(segment.pnoNextStoreId || "").trim() ||
        ![segment.expectedParcels, segment.enteredParcels, segment.pendingParcels]
          .every((value) => Number.isSafeInteger(value) && value >= 0) ||
        segment.enteredParcels + segment.pendingParcels !== segment.expectedParcels) return null;
    const key = JSON.stringify([segment.pnoSourceDay, segment.proofId,
      segment.pnoLineId || segment.pnoVanLineId, segment.pnoStoreId, segment.pnoNextStoreId]);
    if (seen.has(key)) return null;
    seen.add(key);
    expected += segment.expectedParcels;
    entered += segment.enteredParcels;
    pending += segment.pendingParcels;
  }
  if (![expected, entered, pending].every(Number.isSafeInteger) ||
      expected !== row.expectedParcels || entered !== row.enteredParcels ||
      pending !== row.pendingParcels) return null;
  return segments;
}

export function patchPnoSegmentDestinationWorker(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;
  if (!output.includes("PNO_DETAIL_LOCATOR_RECOVERY_V30") || !output.includes("PNO_AUTHORITATIVE_DESTINATION_HUB_V1"))
    throw new Error(`${MARKER}: staged prerequisites missing`);
  output = one(output,
    '  "pnoSegmentCount", "pnoDetailAvailable",',
    '  "pnoSegmentCount", "pnoDetailAvailable", "pnoSegments",',
    "view projection");
  output = one(output,
    `      value.pnoEnabled = completeCounts;
      value.pnoDetailAvailable = completeCounts && locatorComplete && value.pnoSegmentCount === 1;`,
    `      const exactMulti = value.pnoSegmentCount > 1 && exactPnoSegments(value);
      if (exactMulti) value.pnoState = "OK";
      value.pnoEnabled = completeCounts;
      value.pnoDetailAvailable = completeCounts &&
        (value.pnoSegmentCount === 1 ? locatorComplete : Boolean(exactMulti));`,
    "multi-drop availability");
  output = one(output, '      delete value.pnoSegments;', '      if (!value.pnoDetailAvailable) delete value.pnoSegments;', "sanitized segment retention");
  // This helper runs only over the already-reduced PreEntry summary. No provider read.
  output = one(output, 'function preEntrySemanticKey(value) {',
    `${exactPnoSegments.toString()}\n\nfunction preEntrySemanticKey(value) {`, "exact segment validation");
  output = one(output,
    `      // PNO_NEXT_BRANCH_SOURCE_TRUTH_V1: PNO_NEXT_STORE_SEMANTICS_V3: next_store_name is ชื่อสาขาต่อไป; no delivery/pickup fallback.
      targetBranch: cleanStoreName(row.next_store_name),`,
    `      // ${MARKER}: N=next store, Q=destination HUB, R=delivery branch. Keep R raw for filter identity.
      nextStoreName: text(row.next_store_name, 300),
      targetBranch: text(row.ticket_delivery_store_name, 300),`,
    "parcel destination projection");
  output = one(output,
    `        mapped.pnoDetailAvailable = previous.pnoDetailAvailable === true &&
          mapped.pnoSegmentCount === 1 && acceptedCountsComplete &&
          acceptedLocatorComplete;`,
    `        // A weak refresh may retain a previously accepted exact segment set;
        // it must never invent a new segment or use aggregate fields as a locator.
        mapped.pnoSegments = previous.pnoSegments;
        mapped.pnoDetailAvailable = previous.pnoDetailAvailable === true &&
          acceptedCountsComplete && (mapped.pnoSegmentCount === 1
            ? acceptedLocatorComplete : Boolean(exactPnoSegments(mapped)));
        if (!mapped.pnoDetailAvailable) delete mapped.pnoSegments;`,
    "weak refresh exact segment preservation");
  return `${output}\n// ${MARKER}: exact segments and independent destination fields.\n`;
}

export { replaceFunction, one };
