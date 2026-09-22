import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const SUPERVISOR_REC05_PROJECTION_MARKER = "SUPERVISOR_REC05_CANONICAL_PROJECTION_V1";

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0 || first !== source.lastIndexOf(from))
    throw new Error(`REC-05 Supervisor patch failed: ${label}`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

export function patchSupervisorRec05Projection(source) {
  let output = String(source || "");
  if (output.includes(SUPERVISOR_REC05_PROJECTION_MARKER)) return output;

  output = replaceOnce(
    output,
    "// MS_REC04_HISTORY_FRESHNESS_TRUTH_V1: canonical timestamps and successful-no-match truth.",
    `// ${SUPERVISOR_REC05_PROJECTION_MARKER}: read-only projection of canonical row truth.
// It only summarizes rows and diagnostics already produced by the shared refresh.
// No provider call, database work, persistence, retry, scheduling, or mutation occurs here.
function supervisorCanonicalProjectionTelemetry(rows, hub, observedAt = "") {
  if (!Array.isArray(rows)) return null;
  const completeness = {
    DATA_COMPLETE: 0,
    DATA_INCOMPLETE: 0,
    DATA_UNKNOWN: 0,
    SOURCE_UNAVAILABLE: 0,
  };
  const priorities = { P1: 0, P2: 0, P3: 0 };
  let enrichmentPending = 0;
  for (const row of rows) {
    const state = Object.hasOwn(completeness, String(row?.dataCompleteness || ""))
      ? String(row.dataCompleteness)
      : "DATA_UNKNOWN";
    completeness[state] += 1;
    if (String(row?.enrichmentState || "") !== "ENRICHMENT_PENDING") continue;
    enrichmentPending += 1;
    const priority = String(row?.enrichmentPriority || "").toUpperCase();
    if (Object.hasOwn(priorities, priority)) priorities[priority] += 1;
  }
  try {
    const diagnostics = typeof busTimeDiagnostics === "function" ? busTimeDiagnostics(hub) : null;
    const p3Pending = Number(diagnostics?.busP3Pending);
    if (Number.isInteger(p3Pending) && p3Pending >= 0)
      priorities.P3 = Math.max(priorities.P3, p3Pending);
  } catch {}
  return {
    state: "AVAILABLE",
    basis: "CANONICAL_ACCEPTED_ROWS",
    authority: "PROJECTION_ONLY",
    observedAt: typeof observedAt === "string" && Number.isFinite(Date.parse(observedAt)) ? observedAt : "",
    rowsObserved: rows.length,
    completeness,
    enrichmentPending,
    priorities,
  };
}
function supervisorSanitizedCanonicalProjection(value) {
  const item = value && typeof value === "object" ? value : null;
  const count = (input) => {
    const value = Number(input);
    return Number.isInteger(value) && value >= 0 ? value : null;
  };
  if (!item) return null;
  const result = {
    state: String(item.state || "").toUpperCase() === "AVAILABLE" ? "AVAILABLE" : "UNKNOWN",
    basis: item.basis === "CANONICAL_ACCEPTED_ROWS" ? "CANONICAL_ACCEPTED_ROWS" : "UNKNOWN",
    authority: item.authority === "PROJECTION_ONLY" ? "PROJECTION_ONLY" : "UNKNOWN",
    observedAt: typeof item.observedAt === "string" && Number.isFinite(Date.parse(item.observedAt)) ? item.observedAt : "",
    rowsObserved: count(item.rowsObserved),
    completeness: {
      DATA_COMPLETE: count(item.completeness?.DATA_COMPLETE),
      DATA_INCOMPLETE: count(item.completeness?.DATA_INCOMPLETE),
      DATA_UNKNOWN: count(item.completeness?.DATA_UNKNOWN),
      SOURCE_UNAVAILABLE: count(item.completeness?.SOURCE_UNAVAILABLE),
    },
    enrichmentPending: count(item.enrichmentPending),
    priorities: {
      P1: count(item.priorities?.P1),
      P2: count(item.priorities?.P2),
      P3: count(item.priorities?.P3),
    },
  };
  const counts = [result.rowsObserved, ...Object.values(result.completeness), result.enrichmentPending, ...Object.values(result.priorities)];
  if (counts.some((value) => value === null) || Object.values(result.completeness).reduce((sum, value) => sum + value, 0) !== result.rowsObserved)
    result.state = "UNKNOWN";
  return result;
}

// MS_REC04_HISTORY_FRESHNESS_TRUTH_V1: canonical timestamps and successful-no-match truth.`,
    "canonical projection helpers",
  );

  output = replaceOnce(
    output,
    `    const cleanTime = (input) => typeof input === "string" && Number.isFinite(Date.parse(input)) ? input : null;
    const lifecycleInput`,
    `    const cleanTime = (input) => typeof input === "string" && Number.isFinite(Date.parse(input)) ? input : null;
    const canonicalInput = result?.canonicalProjection && typeof result.canonicalProjection === "object" ? result.canonicalProjection : null;
    const previousCanonical = previous?.canonical && typeof previous.canonical === "object" ? previous.canonical : null;
    const canonical = (canonicalInput ? supervisorSanitizedCanonicalProjection(canonicalInput) : null) || previousCanonical || {
      state: "UNKNOWN", basis: "UNKNOWN", authority: "UNKNOWN", observedAt: null,
      rowsObserved: null,
      completeness: { DATA_COMPLETE: null, DATA_INCOMPLETE: null, DATA_UNKNOWN: null, SOURCE_UNAVAILABLE: null },
      enrichmentPending: null,
      priorities: { P1: null, P2: null, P3: null },
    };
    const lifecycleInput`,
    "ingested canonical projection",
  );

  output = replaceOnce(
    output,
    `      const sourceState = ["HEALTHY", "WARNING", "CRITICAL", "STALE", "PARTIAL", "AUTH_REQUIRED", "ERROR", "BLOCKED", "UNKNOWN", "RECOVERED"].includes(rawState) ? rawState : "UNKNOWN";`,
    `      const sourceState = ["HEALTHY", "WARNING", "CRITICAL", "STALE", "PARTIAL", "AUTH_REQUIRED", "SOURCE_UNAVAILABLE", "ERROR", "BLOCKED", "UNKNOWN", "RECOVERED"].includes(rawState) ? rawState : "UNKNOWN";`,
    "canonical source-unavailable state",
  );

  output = replaceOnce(
    output,
    `      const mode = String(item.mode || "").toUpperCase() === "CLICK_ONLY" ? "CLICK_ONLY" : prior?.mode || defaultMode;`,
    `      const requestedMode = String(item.mode || "").toUpperCase();
      const mode = ["CLICK_ONLY", "ON_DEMAND"].includes(requestedMode) ? requestedMode : prior?.mode || defaultMode;`,
    "canonical on-demand mode",
  );

  output = replaceOnce(
    output,
    `      hbiPhotos: normalizeSource("hbiPhotos", "CLICK_ONLY"),
    };`,
    `      hbiPhotos: normalizeSource("hbiPhotos", "CLICK_ONLY"),
      pno: normalizeSource("pno", "ON_DEMAND"),
    };`,
    "PNO source projection",
  );

  output = replaceOnce(
    output,
    `      sources,
      lifecycle,`,
    `      sources,
      canonical,
      lifecycle,`,
    "canonical projection snapshot",
  );

  output = replaceOnce(
    output,
    `  return { route: clean(input.route), preEntry: clean(input.preEntry), busTime: clean(input.busTime), hbiPhotos: clean(input.hbiPhotos, "CLICK_ONLY") };`,
    `  return {
    route: clean(input.route), preEntry: clean(input.preEntry), busTime: clean(input.busTime),
    hbiPhotos: clean(input.hbiPhotos, "CLICK_ONLY"), pno: clean(input.pno, "ON_DEMAND"),
  };`,
    "sanitized PNO source",
  );

  output = replaceOnce(
    output,
    `          sourceTelemetry: result?.sourceTelemetry ? supervisorSanitizedSourceTelemetry(result.sourceTelemetry) : null,
          lifecycleTelemetry:`,
    `          sourceTelemetry: result?.sourceTelemetry ? supervisorSanitizedSourceTelemetry(result.sourceTelemetry) : null,
          canonicalProjection: Array.isArray(result?.rows)
            ? supervisorSanitizedCanonicalProjection(supervisorCanonicalProjectionTelemetry(result.rows, branch, result?.syncedAt || ""))
            : null,
          lifecycleTelemetry:`,
    "published canonical projection",
  );

  return output;
}

const invokedPath = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedPath) {
  const target = process.argv[2];
  if (!target) throw new Error("Usage: node patch-supervisor-rec05-projection.mjs <worker-index.js>");
  await writeFile(target, patchSupervisorRec05Projection(await readFile(target, "utf8")), "utf8");
}
