import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const REC04_HISTORY_FRESHNESS_MARKER = "MS_REC04_HISTORY_FRESHNESS_TRUTH_V1";

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0 || first !== source.lastIndexOf(from))
    throw new Error(`REC-04 staging patch failed: ${label}`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

export function patchMsRec04HistoryFreshness(source) {
  let output = String(source || "");
  if (output.includes(REC04_HISTORY_FRESHNESS_MARKER)) return output;

  output = replaceOnce(
    output,
    "// SUPERVISOR_SOURCE_HEALTH_V1: piggyback source outcomes already produced",
    `// ${REC04_HISTORY_FRESHNESS_MARKER}: canonical timestamps and successful-no-match truth.\n// SUPERVISOR_SOURCE_HEALTH_V1: piggyback source outcomes already produced`,
    "freshness marker",
  );

  output = replaceOnce(
    output,
    `  const credentials = await preEntryCredentials(env, hub);\n  if (!credentials) return new Map();\n  try {`,
    `  const credentials = await preEntryCredentials(env, hub);\n  if (!credentials) {\n    const unavailable = new Map();\n    unavailable.sourceUnavailable = true;\n    unavailable.sourceCode = "PREENTRY_NOT_CONFIGURED";\n    return unavailable;\n  }\n  const preEntryAttemptedAt = new Date().toISOString();\n  try {`,
    "PreEntry attempt truth",
  );

  const preEntryStart = output.indexOf("async function readPreEntryCounts(");
  const preEntryEnd = output.indexOf("\nasync function ", preEntryStart + 30);
  if (preEntryStart < 0 || preEntryEnd <= preEntryStart)
    throw new Error("REC-04 staging patch failed: PreEntry function boundary");
  let preEntry = output.slice(preEntryStart, preEntryEnd);
  preEntry = replaceOnce(
    preEntry,
    `    return counts;`,
    `    counts.sourceEvaluated = true;\n    counts.lastAttemptAt = preEntryAttemptedAt;\n    counts.lastSuccessAt = new Date().toISOString();\n    counts.dataObservedAt = counts.lastSuccessAt;\n    return counts;`,
    "PreEntry success truth",
  );
  preEntry = replaceOnce(
    preEntry,
    `    const failed = new Map();\n    failed.sourceFailed = true;\n    return failed;`,
    `    const failed = new Map();\n    failed.sourceFailed = true;\n    failed.sourceCode = String(error?.code || "PREENTRY_SOURCE_ERROR");\n    failed.lastAttemptAt = preEntryAttemptedAt;\n    failed.lastErrorAt = new Date().toISOString();\n    return failed;`,
    "PreEntry failure truth",
  );
  output = output.slice(0, preEntryStart) + preEntry + output.slice(preEntryEnd);

  output = replaceOnce(
    output,
    `function supervisorRefreshSourceTelemetry(branch, credentials, rows, parcelCounts, busData) {\n  const routeError`,
    `function supervisorRefreshSourceTelemetry(branch, credentials, rows, parcelCounts, busData) {\n  const sourceTelemetryAt = new Date().toISOString();\n  const routeError`,
    "source telemetry time",
  );
  output = replaceOnce(
    output,
    `  const preObservedSuccess = !preFailed && parcelCounts instanceof Map && parcelCounts.size > 0;`,
    `  const preObservedSuccess = !preFailed && parcelCounts instanceof Map && parcelCounts.sourceEvaluated === true;`,
    "successful PreEntry no-match",
  );
  output = replaceOnce(
    output,
    `    route: { state: routeState, configured: routeConfigured, observed: routeConfigured, errorCode: routeCode,`,
    `    route: { state: routeState, configured: routeConfigured, observed: routeConfigured, lastAttemptAt: routeConfigured ? sourceTelemetryAt : "", lastSuccessAt: routeState === "HEALTHY" ? sourceTelemetryAt : "", lastMeaningfulObservationAt: "", lastErrorAt: routeError ? sourceTelemetryAt : "", dataObservedAt: routeState === "HEALTHY" ? sourceTelemetryAt : "", sourceValueTimestamp: "", acceptedDataAt: "", errorCode: routeCode,`,
    "Route canonical timestamps",
  );
  output = replaceOnce(
    output,
    `    preEntry: { state: preState, configured: null, observed: preFailed || preObservedSuccess, errorCode: preCode,`,
    `    preEntry: { state: preState, configured: parcelCounts?.sourceUnavailable === true ? false : null, observed: preFailed || preObservedSuccess, lastAttemptAt: parcelCounts?.lastAttemptAt || "", lastSuccessAt: parcelCounts?.lastSuccessAt || "", lastMeaningfulObservationAt: "", lastErrorAt: parcelCounts?.lastErrorAt || "", dataObservedAt: parcelCounts?.dataObservedAt || "", sourceValueTimestamp: "", acceptedDataAt: "", errorCode: preCode || supervisorSourceCode(parcelCounts?.sourceCode || ""),`,
    "PreEntry canonical timestamps",
  );
  output = replaceOnce(
    output,
    `    busTime: { state: busState, configured: busConfigured, observed: busConfigured === true, lastSuccessAt: bus?.busLastSuccessAt || "",`,
    `    busTime: { state: busState, configured: busConfigured, observed: busConfigured === true, lastAttemptAt: bus?.busLastAttemptAt || "", lastSuccessAt: bus?.busLastSuccessAt || "", lastMeaningfulObservationAt: bus?.busLastMeaningfulObservationAt || "", lastErrorAt: bus?.busLastErrorAt || "", dataObservedAt: bus?.busLastSuccessAt || "", sourceValueTimestamp: "", acceptedDataAt: bus?.busLastSuccessAt || "",`,
    "BusTime canonical timestamps",
  );
  output = replaceOnce(
    output,
    `    hbiPhotos: { state: hbiState, configured: hbi ? true : null, observed: Boolean(hbi?.checkedAt), lastSuccessAt:`,
    `    hbiPhotos: { state: hbiState, configured: hbi ? true : null, observed: Boolean(hbi?.checkedAt), lastAttemptAt: hbi?.checkedAt || "", lastMeaningfulObservationAt: hbi?.state === "ready" ? hbi?.checkedAt || "" : "", lastErrorAt: hbi?.state === "error" || hbi?.state === "expired" ? hbi?.checkedAt || "" : "", dataObservedAt: hbi?.state === "ready" ? hbi?.checkedAt || "" : "", sourceValueTimestamp: "", acceptedDataAt: hbi?.state === "ready" ? hbi?.checkedAt || "" : "", lastSuccessAt:`,
    "HBI canonical timestamps",
  );

  output = replaceOnce(
    output,
    `      lastSuccessAt: typeof item.lastSuccessAt === "string" ? item.lastSuccessAt : "",\n      lastUsedAt:`,
    `      lastAttemptAt: typeof item.lastAttemptAt === "string" ? item.lastAttemptAt : "",\n      lastSuccessAt: typeof item.lastSuccessAt === "string" ? item.lastSuccessAt : "",\n      lastMeaningfulObservationAt: typeof item.lastMeaningfulObservationAt === "string" ? item.lastMeaningfulObservationAt : "",\n      lastErrorAt: typeof item.lastErrorAt === "string" ? item.lastErrorAt : "",\n      dataObservedAt: typeof item.dataObservedAt === "string" ? item.dataObservedAt : "",\n      sourceValueTimestamp: typeof item.sourceValueTimestamp === "string" ? item.sourceValueTimestamp : "",\n      acceptedDataAt: typeof item.acceptedDataAt === "string" ? item.acceptedDataAt : "",\n      lastUsedAt:`,
    "sanitized canonical timestamps",
  );

  output = replaceOnce(
    output,
    `      return { state: sourceState, configured, lastSuccessAt: sourceLastSuccessAt, lastUsedAt: sourceLastUsedAt, retryAt, errorCode, recovery, mode, observed: item.observed === true };`,
    `      return {\n        state: sourceState, configured,\n        lastAttemptAt: cleanTime(item.lastAttemptAt) || prior?.lastAttemptAt || null,\n        lastSuccessAt: sourceLastSuccessAt,\n        lastMeaningfulObservationAt: cleanTime(item.lastMeaningfulObservationAt) || prior?.lastMeaningfulObservationAt || null,\n        lastErrorAt: cleanTime(item.lastErrorAt) || prior?.lastErrorAt || null,\n        dataObservedAt: cleanTime(item.dataObservedAt) || prior?.dataObservedAt || null,\n        sourceValueTimestamp: cleanTime(item.sourceValueTimestamp) || prior?.sourceValueTimestamp || null,\n        acceptedDataAt: cleanTime(item.acceptedDataAt) || prior?.acceptedDataAt || null,\n        lastUsedAt: sourceLastUsedAt, retryAt, errorCode, recovery, mode, observed: item.observed === true,\n      };`,
    "ingested canonical timestamps",
  );

  return output;
}

const invokedPath = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedPath) {
  const target = process.argv[2];
  if (!target) throw new Error("Usage: node patch-ms-rec04-history-freshness.mjs <worker-index.js>");
  await writeFile(target, patchMsRec04HistoryFreshness(await readFile(target, "utf8")), "utf8");
}
