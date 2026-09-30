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
    'import { registerPnoPassiveRoutes, runPnoPassiveCycle } from "./pno-passive-coverage.js";');
  output = once(output,
    '    this.lastSnapshotBranch = "";\n  }\n\n  async loadRepairState() {',
    '    this.lastSnapshotBranch = "";\n  }\n\n' +
    `  // ${MARKER}: one per-HUB alarm; refresh only registers exact routes.\n` +
    '  async alarm() {\n    await runPnoPassiveCycle(this, this.env, readSharedPnoPage);\n  }\n\n' +
    '  async loadRepairState() {');
  output = once(output,
    '        this.lastResult = result;\n        this.lastSourceAt = Date.now();\n        this.recentUntil = Date.now() + MS_SYNC_TTL;',
    '        this.lastResult = result;\n        this.lastSourceAt = Date.now();\n        this.recentUntil = Date.now() + MS_SYNC_TTL;\n' +
    '        if (result?.status === "synced" && Array.isArray(result.rows))\n' +
    '          this.ctx.waitUntil(registerPnoPassiveRoutes(this, branch, result.rows)\n' +
    '            .catch(() => undefined));');
  return output;
}
