import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const TBR_PROVENANCE_MARKER = "TBR_PROVENANCE_DEV_V1";

function replaceOnce(source, anchor, replacement) {
  if (source.indexOf(anchor) < 0 || source.indexOf(anchor) !== source.lastIndexOf(anchor))
    throw new Error(`${TBR_PROVENANCE_MARKER}: non-unique staging anchor`);
  return source.replace(anchor, replacement);
}

export function patchTbrProvenanceDevWorker(source) {
  if (source.includes(TBR_PROVENANCE_MARKER)) return source;
  if (!source.includes("BUS_TIME_HOT_LANE_V14") || !source.includes("SHADOW_READONLY_SPLIT_V2"))
    throw new Error(`${TBR_PROVENANCE_MARKER}: final BusTime stage is required`);
  let output = `import { createTbrProvenance } from "./tbr-provenance-dev.js";\n` + source;
  // POST shares the normal session verification but does not put the token in a diagnostic URL.
  output = replaceOnce(output,
    `  const actor = await verify(body.token, env);\n  if (action === "cancelMsRoute")`,
    `  const actor = await verify(body.token, env);\n  if (action === "tbrProvenanceDev")\n    return ok(await tbrProvenanceDev(env, actor, pickBranch(actor, body.branch), body.acquire === true));\n  if (action === "cancelMsRoute")`);
  output = replaceOnce(output,
    `async function preEntryTrips(env, actor, hub, wantedDay) {`,
    `// ${TBR_PROVENANCE_MARKER}: one explicit authenticated DEV-only read.\n// No Route/PreEntry reads, source writes, persistent debug state or automatic retry.\nasync function tbrProvenanceDev(env, actor, hub, acquire) {\n  if (!access(hub, actor)) fail("ไม่มีสิทธิ์ดู HUB นี้", "FORBIDDEN", 403);\n  if (!acquire) return { marker: "${TBR_PROVENANCE_MARKER}", status: "EXPLICIT_ONE_SHOT_REQUIRED", rows: [], logicalAcquisitions: 0 };\n  const cache = await env.DB.prepare("SELECT rows_json FROM ms_live_cache WHERE hub=? LIMIT 1").bind(hub).first();\n  let current = [];\n  try {\n    const parsed = JSON.parse(cache?.rows_json || "[]");\n    current = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.rows) ? parsed.rows : [];\n  } catch {}\n  const rows = current.filter((row) =>\n    normalizeMsAttendance(row?.attendanceType) === "ต้นทาง" &&\n    !date(row?.scheduleTbrArrivalAt) && Boolean(date(row?.actualArrivalAt)) &&\n    Boolean(normalizeProofId(row?.proofId))\n  ).slice(0, 3);\n  if (!rows.length) return { marker: "${TBR_PROVENANCE_MARKER}", status: "NO_CURRENT_CANDIDATES", rows: [], logicalAcquisitions: 0 };\n  const trace = createTbrProvenance(rows, {\n    normalizeProofId, normalizeAttendance: normalizeMsAttendance,\n    matchHub: scheduleStoreMatchesHub, msDate, findBusEnrichment, enrichMsRow,\n  });\n  let busMap;\n  let attempted = 0;\n  let coverage = "NOT_INSPECTED";\n  let sourcePagesRead = 0;\n  let sourcePagesTotal = 0;\n  try {\n    // The existing DEV probe lane owns credentials, cache, cooldown and call budget.\n    const probe = await busTimeProbeLane.probeOneSourceCycle(env, hub, liveSourceDays(), rows, trace.observeItem);\n    busMap = probe.data;\n    attempted = probe.attempted ? 1 : 0;\n    coverage = probe.reason;\n    sourcePagesRead = Number(probe.pagesRead) || 0;\n    sourcePagesTotal = Number(probe.totalPages) || 0;\n  } catch {\n    return { marker: "${TBR_PROVENANCE_MARKER}", status: "SOURCE_UNAVAILABLE", rows: [], logicalAcquisitions: attempted };\n  }\n  const persisted = (await env.DB.prepare(\n    "SELECT proof_id,attendance_type,schedule_tbr_arrival_at FROM ms_routes WHERE hub=?"\n  ).bind(hub).all()).results || [];\n  const evidence = trace.result(busMap, persisted, current);\n  return {\n    marker: "${TBR_PROVENANCE_MARKER}",\n    status: busMap?.sourceStale ? "SOURCE_STALE" : "OBSERVED",\n    sourceObservation: evidence.some((item) => item.busCandidateFound === "YES") ? "CANDIDATE_SEEN" : "NO_MATCHING_CANDIDATE_SEEN",\n    logicalAcquisitions: attempted,\n    sourceCoverage: coverage,\n    sourcePagesRead, sourcePagesTotal,\n    rows: evidence,\n  };\n}\n\nasync function preEntryTrips(env, actor, hub, wantedDay) {`);
  return output;
}

export function patchTbrProvenanceDevFrontend(source) {
  if (source.includes("TBR_PROVENANCE_DEV_UI_V1")) return source;
  return source + `\n// TBR_PROVENANCE_DEV_UI_V1: explicit hash flag and one owner click only.\n` +
    `document.addEventListener("DOMContentLoaded", () => {\n` +
    `  const flag = new URLSearchParams(String(location.hash || "").replace(/^#/, ""));\n` +
    `  if (flag.get("tbrProvenanceDiag") !== "1") return;\n` +
    `  const panel = document.createElement("section");\n` +
    `  panel.id = "tbr-provenance-dev";\n` +
    `  panel.setAttribute("data-diagnostic-marker", "${TBR_PROVENANCE_MARKER}");\n` +
    `  panel.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:9999;max-width:min(94vw,540px);max-height:70vh;overflow:auto;padding:12px;background:#18212d;color:#fff;border:1px solid #ff9a3d;border-radius:8px;font:12px/1.4 monospace";\n` +
    `  const title = document.createElement("strong"); title.textContent = "TBR provenance · DEV"; panel.appendChild(title);\n` +
    `  const button = document.createElement("button"); button.type = "button"; button.textContent = "ตรวจ TBR หนึ่งครั้ง"; panel.appendChild(button);\n` +
    `  const view = document.createElement("pre"); view.textContent = "รอการกดตรวจโดยผู้ใช้"; panel.appendChild(view);\n` +
    `  button.addEventListener("click", async () => {\n` +
    `    button.disabled = true;\n` +
    `    view.textContent = "กำลังตรวจครั้งเดียว…";\n` +
    `    try { view.textContent = JSON.stringify(await apiPost("tbrProvenanceDev", { branch: state.branch, acquire: true }), null, 2); }\n` +
    `    catch { view.textContent = "ตรวจไม่สำเร็จ ไม่มีการลองใหม่อัตโนมัติ"; }\n` +
    `  }, { once: true });\n` +
    `  document.body.appendChild(panel);\n` +
    `});\n`;
}

export async function stageTbrProvenanceDev(workerTarget, frontendTarget) {
  const moduleUrl = new URL("./tbr-provenance-dev.mjs", import.meta.url);
  const original = await readFile(moduleUrl, "utf8");
  const target = join(dirname(workerTarget), "tbr-provenance-dev.js");
  await writeFile(target, original.replace(
    '"./bus-time-hot-lane-v14-runtime.mjs"', '"./bus-time-hot-lane-v14.js"'), "utf8");
  const worker = await readFile(workerTarget, "utf8");
  await writeFile(workerTarget, patchTbrProvenanceDevWorker(worker), "utf8");
  const frontend = await readFile(frontendTarget, "utf8");
  await writeFile(frontendTarget, patchTbrProvenanceDevFrontend(frontend), "utf8");
}
