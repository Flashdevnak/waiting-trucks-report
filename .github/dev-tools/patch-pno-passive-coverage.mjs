const MARKER = "PNO_PASSIVE_COVERAGE_V1";

function once(source, before, after) {
  const index = source.indexOf(before);
  if (index < 0 || source.indexOf(before, index + before.length) >= 0)
    throw new Error(`${MARKER}: staging anchor absent or repeated`);
  return source.slice(0, index) + after + source.slice(index + before.length);
}

export function patchPnoPassiveCoverageWorker(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;
  if (!output.includes("PNO_INBOUND_SCAN_EVIDENCE_V1"))
    throw new Error(`${MARKER}: scan evidence hook missing`);
  output = once(output,
    'import { observePnoEvidencePage, reconcilePnoCachedPositive, PNO_SCAN_CLASSES } from "./pno-inbound-scan-evidence.js";',
    'import { observePnoEvidencePage, reconcilePnoCachedPositive, PNO_SCAN_CLASSES } from "./pno-inbound-scan-evidence.js";\n' +
    'import { registerPnoPassiveRoutes, runPnoPassiveCycle } from "./pno-passive-coverage.js";\n' +
    'import { emitDevAcceptance, summarizeCentralRows } from "./dev-acceptance-evidence.js";');
  output = once(output,
    '    this.lastSnapshotBranch = "";\n  }\n\n  async loadRepairState() {',
    '    this.lastSnapshotBranch = "";\n  }\n\n' +
    `  // ${MARKER}: one per-HUB alarm; refresh only registers exact routes.\n` +
    '  async alarm() {\n    await runPnoPassiveCycle(this, this.env, (_owner, env, locator) => readCanonicalPnoPage(env, locator));\n  }\n\n' +
    '  async loadRepairState() {');
  output = once(output,
    '        this.lastResult = result;\n        this.lastSourceAt = Date.now();\n        this.recentUntil = Date.now() + MS_SYNC_TTL;',
    '        this.lastResult = result;\n        this.lastSourceAt = Date.now();\n        this.recentUntil = Date.now() + MS_SYNC_TTL;\n' +
    '        // Diagnostic projection is capped at one accepted snapshot per HUB/minute.\n' +
    '        if (result?.status === "synced" && Array.isArray(result.rows) &&\n' +
    '            Date.now() - (this.lastDevAcceptanceAt || 0) >= 60_000) {\n' +
    '          this.lastDevAcceptanceAt = Date.now();\n' +
    '          if (this.env.DEV_ACCEPTANCE_TELEMETRY === "1")\n' +
    '            emitDevAcceptance(this.env, "CENTRAL", summarizeCentralRows(result.rows));\n' +
    '        }\n' +
    '        if (result?.status === "synced" && Array.isArray(result.rows))\n' +
    '          this.ctx.waitUntil(registerPnoPassiveRoutes(this, branch, result.rows)\n' +
    '            .catch(() => undefined));');
  output = once(output,
    '  const locator = validatePnoLocator(normalizePnoLocator(input, hub));\n' +
    '  if (!env.MS_REFRESH_COORDINATOR)\n' +
    '    fail("ตัวประสาน PNO แบบแชร์ยังไม่พร้อมใช้งาน", "PNO_COORDINATOR_UNAVAILABLE", 503);\n' +
    '  const id = env.MS_REFRESH_COORDINATOR.idFromName(hub);',
    '  const locator = validatePnoLocator(normalizePnoLocator(input, hub));\n' +
    '  return readCanonicalPnoPage(env, locator);\n}\n\n' +
    '// PNO_PASSIVE_CANONICAL_AUTHORITY_V1: detail and the realtime alarm both\n' +
    '// request the same per-HUB PNO object. The alarm retains scheduling state.\n' +
    'export async function readCanonicalPnoPage(env, rawLocator) {\n' +
    '  const locator = validatePnoLocator(normalizePnoLocator(rawLocator, rawLocator?.hub));\n' +
    '  if (!env.MS_REFRESH_COORDINATOR)\n' +
    '    fail("ตัวประสาน PNO แบบแชร์ยังไม่พร้อมใช้งาน", "PNO_COORDINATOR_UNAVAILABLE", 503);\n' +
    '  const id = env.MS_REFRESH_COORDINATOR.idFromName(locator.hub);');
  return output;
}
