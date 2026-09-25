import fs from "node:fs";
import { fileURLToPath } from "node:url";

const MARKER = "DEV_AUXILIARY_EVIDENCE_COMPLETENESS_V1";

function replaceUnique(input, from, to, label) {
  const first = input.indexOf(from);
  const last = input.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`${MARKER}: ${label} anchor missing or non-unique`);
  return input.slice(0, first) + to + input.slice(first + from.length);
}

function replaceCount(input, from, to, expected, label) {
  const count = input.split(from).length - 1;
  if (count !== expected)
    throw new Error(`${MARKER}: ${label} expected ${expected} anchors; got ${count}`);
  return input.split(from).join(to);
}

export function patchDevAuxiliaryEvidenceWorker(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;

  output = replaceUnique(
    output,
    `export function enrichMsRow(mapped, parcelCounts, busData) {
  // Cross-source matching is deliberately barcode-only. Never use plate,`,
    `// ${MARKER}: Route row ids are the existing persisted occurrence identity.
// A proof/attendance collision across distinct Route ids is deliberately left
// unenriched because neither BusTime nor PreEntry exposes a safe one-to-one join.
function markAuxiliaryOccurrenceAmbiguity(rows, parcelCounts, busData) {
  const byBusKey = new Map();
  const byProof = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const proofId = normalizeProofId(row?.proofId);
    const attendance = normalizeMsAttendance(row?.attendanceType);
    const occurrence = String(row?.id || "").trim();
    if (!proofId || !occurrence) continue;
    if (!byProof.has(proofId)) byProof.set(proofId, new Set());
    byProof.get(proofId).add(occurrence);
    if (!attendance) continue;
    const key = \`P:\${proofId}|A:\${attendance}\`;
    if (!byBusKey.has(key)) byBusKey.set(key, new Set());
    byBusKey.get(key).add(occurrence);
  }
  if (parcelCounts instanceof Map) {
    const existing = parcelCounts.ambiguousProofs instanceof Set
      ? parcelCounts.ambiguousProofs
      : new Set();
    for (const [proofId, occurrences] of byProof)
      if (occurrences.size > 1) existing.add(proofId);
    parcelCounts.ambiguousProofs = existing;
  }
  if (busData instanceof Map) {
    const existing = busData.ambiguousKeys instanceof Set
      ? busData.ambiguousKeys
      : new Set();
    for (const [key, occurrences] of byBusKey)
      if (occurrences.size > 1) existing.add(key);
    busData.ambiguousKeys = existing;
  }
}

export function enrichMsRow(mapped, parcelCounts, busData) {
  // Cross-source matching is deliberately barcode-only. Never use plate,`,
    "occurrence ambiguity helper",
  );

  output = replaceUnique(
    output,
    `    const routeRows = rows.map(mapMsRow);
    if (!rows.routeSourceError) busTimeRouteHints.set(branch, routeRows);`,
    `    const routeRows = rows.map(mapMsRow);
    markAuxiliaryOccurrenceAmbiguity(routeRows, parcelCounts, busData);
    if (!rows.routeSourceError) busTimeRouteHints.set(branch, routeRows);`,
    "shared refresh ambiguity gate",
  );

  output = replaceUnique(
    output,
    `  const items = Array.isArray(json.data?.DataList) ? json.data.DataList : [];
  for (const item of items)`,
    `  // A missing list is an uninterpretable response, not a confirmed empty page.
  if (!Array.isArray(json.data?.DataList))
    fail("ข้อมูลพัสดุไม่มีรายการที่ตรวจสอบได้", "PREENTRY_SOURCE_ERROR", 502);
  const items = json.data.DataList;
  for (const item of items)`,
    "PreEntry successful response shape",
  );

  output = replaceUnique(
    output,
    `    const previousEnrichment =
      parcelCounts.sourceFailed || busData.sourceFailed
        ? await readMsLiveCache(env, branch)
        : null;`,
    `    const previousEnrichment =
      parcelCounts.sourceFailed || parcelCounts.sourcePartial ||
      busData.sourceFailed || Number(busData.ambiguousKeys?.size || 0) > 0
        ? await readMsLiveCache(env, branch)
        : null;`,
    "partial evidence cache preservation gate",
  );

  output = replaceUnique(
    output,
    `    const previousById = new Map(
      (previousEnrichment?.rows || []).map((row) => [row.id, row]),
    );`,
    `    // syncMs stores a hash of this natural occurrence, not the provider row id.
    const enrichmentOccurrenceKey = (row) => {
      const proofId = normalizeProofId(row?.proofId);
      return proofId
        ? [proofId, text(row?.attendanceType, 100),
            date(row?.estimatedArrivalAt || row?.estimatedDepartureAt)].join("|")
        : "";
    };
    const previousByOccurrence = new Map(
      (previousEnrichment?.rows || [])
        .map((row) => [enrichmentOccurrenceKey(row), row])
        .filter(([key]) => key),
    );`,
    "accepted occurrence identity preservation",
  );

  output = replaceUnique(
    output,
    `      const previous = previousById.get(mapped.id);
      if (previous && parcelCounts.sourceFailed) {
        mapped.expectedParcels = previous.expectedParcels;
        mapped.enteredParcels = previous.enteredParcels;
        mapped.pendingParcels = previous.pendingParcels;
      }
      if (previous && busData.sourceFailed) {
        mapped.scheduleKitArrivalAt = previous.scheduleKitArrivalAt;
        mapped.scheduleTbrArrivalAt = previous.scheduleTbrArrivalAt;
        mapped.arrivedParcels = previous.arrivedParcels;
        mapped.arrivedBags = previous.arrivedBags;
      }`,
    `      const previous = previousByOccurrence.get(enrichmentOccurrenceKey(mapped));
      const proofId = normalizeProofId(mapped.proofId);
      const parcelPartial = parcelCounts.partialProofs instanceof Set &&
        parcelCounts.partialProofs.has(proofId);
      if (previous && (parcelCounts.sourceFailed || parcelPartial)) {
        for (const field of [
          "expectedParcels", "enteredParcels", "pendingParcels",
          "pnoState", "pnoEnabled", "pnoPercent", "pnoSourceDay",
          "pnoLineId", "pnoVanLineId", "pnoStoreId", "pnoNextStoreId",
          "pnoNextStoreName", "pnoCanReport",
        ]) mapped[field] = previous[field];
        // Segment evidence belongs to the same accepted natural occurrence.
        // A weak observation cannot prove a new segment count or availability.
        mapped.pnoSegmentCount = Number.isSafeInteger(previous.pnoSegmentCount) &&
          previous.pnoSegmentCount > 0 ? previous.pnoSegmentCount : undefined;
        const acceptedCountsComplete = [
          mapped.expectedParcels, mapped.enteredParcels, mapped.pendingParcels,
        ].every((count) => Number.isFinite(count) && count >= 0) &&
          mapped.expectedParcels === mapped.enteredParcels + mapped.pendingParcels;
        const acceptedLocatorComplete = Boolean(
          text(mapped.proofId, 100) && text(mapped.pnoSourceDay, 100) &&
          (text(mapped.pnoLineId, 160) || text(mapped.pnoVanLineId, 160)) &&
          text(mapped.pnoStoreId, 160) && text(mapped.pnoNextStoreId, 160)
        );
        mapped.pnoDetailAvailable = previous.pnoDetailAvailable === true &&
          mapped.pnoSegmentCount === 1 && acceptedCountsComplete &&
          acceptedLocatorComplete;
      }
      const busKey = \`P:\${proofId}|A:\${normalizeMsAttendance(mapped.attendanceType)}\`;
      const busAmbiguous = busData.ambiguousKeys instanceof Set &&
        busData.ambiguousKeys.has(busKey);
      if (previous && (busData.sourceFailed || busAmbiguous)) {
        for (const field of [
          "scheduleKitArrivalAt", "scheduleTbrArrivalAt",
          "scheduleUnloadingStartedAt", "scheduleUnloadingCompletedAt",
          "arrivedParcels", "arrivedBags", "fieldEvidence", "dataCompleteness",
          "enrichmentState", "enrichmentPriority", "completenessLifecycle",
        ]) mapped[field] = previous[field];
      }`,
    "failed and partial evidence preservation",
  );

  output = replaceUnique(
    output,
    `    else if (parcelCounts instanceof Map && parcelCounts.sourceFailed !== true) {`,
    `    else if (
      parcelCounts instanceof Map && parcelCounts.sourceFailed !== true &&
      !(parcelCounts.partialProofs instanceof Set &&
        parcelCounts.partialProofs.has(normalizeProofId(mapped.proofId)))
    ) {`,
    "partial PreEntry absence guard",
  );

  output = replaceUnique(
    output,
    `    const counts = new Map();
    for (const value of grouped.values()) {
      if (value.invalidCounts) {
        value.expectedParcels = null;
        value.enteredParcels = null;
        value.pendingParcels = null;
      }
      const aliases = value.aliases;
      delete value.aliases;
      delete value.invalidCounts;
      for (const alias of aliases)
        setEnrichmentAliases(counts, value, alias[0], alias[1], alias[2]);
    }
    counts.sourceEvaluated = true;`,
    `    const counts = new Map();
    const partialProofs = new Set();
    for (const value of grouped.values()) {
      const proofId = normalizeProofId(value.proofId);
      const countsMismatch =
        !value.invalidCounts &&
        value.enteredParcels + value.pendingParcels !== value.expectedParcels;
      if (value.invalidCounts || countsMismatch) {
        if (proofId) partialProofs.add(proofId);
        continue;
      }
      const aliases = value.aliases;
      delete value.aliases;
      delete value.invalidCounts;
      for (const alias of aliases)
        setEnrichmentAliases(counts, value, alias[0], alias[1], alias[2]);
    }
    counts.partialProofs = partialProofs;
    counts.sourcePartial = partialProofs.size > 0;
    counts.sourceEvaluated = true;`,
    "PreEntry partial-success classification",
  );

  output = replaceUnique(
    output,
    `function findEnrichment(map, row) {
  const proofId = normalizeProofId(row.proofId);
  return proofId ? map.get(\`P:\${proofId}\`) : undefined;
}
function findBusEnrichment(map, row) {
  const proofId = normalizeProofId(row.proofId);
  if (!proofId) return undefined;
  const attendance = normalizeMsAttendance(row.attendanceType);
  return map.get(\`P:\${proofId}|A:\${attendance}\`) || map.get(\`P:\${proofId}\`);
}`,
    `function findEnrichment(map, row) {
  const proofId = normalizeProofId(row.proofId);
  if (!proofId || map?.ambiguousProofs?.has(proofId)) return undefined;
  return map.get(\`P:\${proofId}\`);
}
function findBusEnrichment(map, row) {
  const proofId = normalizeProofId(row.proofId);
  if (!proofId) return undefined;
  const attendance = normalizeMsAttendance(row.attendanceType);
  const key = \`P:\${proofId}|A:\${attendance}\`;
  if (map?.ambiguousKeys?.has(key)) return undefined;
  return map.get(key) || map.get(\`P:\${proofId}\`);
}`,
    "ambiguous enrichment lookup guard",
  );

  output = replaceCount(
    output,
    `  for (const [mapKey, item] of busData.entries()) {
    const proofId = normalizeProofId(item?.proofId);`,
    `  for (const [mapKey, item] of busData.entries()) {
    if (busData.ambiguousKeys?.has(mapKey)) continue;
    const proofId = normalizeProofId(item?.proofId);`,
    2,
    "TBR shadow ambiguity guards",
  );

  return output;
}

export function patchDevAuxiliaryEvidenceFrontend(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;
  output = replaceCount(
    output,
    `shortDateTime(row.unloadingCompletedAt)`,
    `shortDateTime(timing.finish)`,
    2,
    "trusted completion labels",
  );
  return output.replace(
    "function renderOperation(row) {",
    `// ${MARKER}: visible completion labels use the same trusted timing as SLA.\nfunction renderOperation(row) {`,
  );
}

const invokedPath = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (invokedPath) {
  const target = process.argv[2];
  if (!target) throw new Error(`Usage: node ${process.argv[1]} <staged-worker>`);
  const output = patchDevAuxiliaryEvidenceWorker(fs.readFileSync(target, "utf8"));
  fs.writeFileSync(target, output);
  console.log(`${MARKER}=PASS`);
}
