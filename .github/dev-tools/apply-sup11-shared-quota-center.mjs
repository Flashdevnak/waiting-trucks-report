import { readFile, writeFile } from "node:fs/promises";

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0 || first !== source.lastIndexOf(from)) throw new Error(`SUP-11 apply failed: ${label}`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

async function patchFile(path, patch) {
  const source = await readFile(path, "utf8");
  const output = patch(source);
  if (output !== source) await writeFile(path, output, "utf8");
}

await patchFile("supervisor.js", (source) => {
  if (source.includes("SUPERVISOR_QUOTA_CENTER_V1")) return source;
  let output = replaceOnce(
    source,
    `// SUPERVISOR_INCIDENT_ACTION_V1\n// Side-car snapshot client:`,
    `// SUPERVISOR_INCIDENT_ACTION_V1\n// SUPERVISOR_QUOTA_CENTER_V1\n// Side-car snapshot client:`,
    "quota marker",
  );

  const block = `// SUPERVISOR_QUOTA_CENTER_V1: pure derivation from SUP-10 sanitized shared\n// telemetry only. Isolate-local counters are never promoted to provider billing,\n// account quota, monthly totals, or plan limits, and no cross-isolate totals are made.\nfunction quotaCenterCounter(value) {\n  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;\n}\n\nfunction quotaCenterTime(value) {\n  const parsed = Date.parse(String(value || ""));\n  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;\n}\n\nfunction deriveQuotaCenter(raw) {\n  const unknown = {\n    availability: "UNKNOWN",\n    mode: "PIGGYBACK_ISOLATE_COUNTERS",\n    billingTruth: "UNKNOWN",\n    providerPlanLimit: "UNKNOWN",\n    observedAt: null,\n    coverage: { observedHubs: null, quotaObservedHubs: 0 },\n    hubs: [],\n  };\n  if (!raw || typeof raw !== "object" || raw.mode !== "PIGGYBACK_ISOLATE_COUNTERS") return unknown;\n\n  const observedHubs = quotaCenterCounter(raw.coverage?.observedHubs);\n  const declaredQuotaHubs = quotaCenterCounter(raw.coverage?.quotaObservedHubs);\n  const hubs = [];\n  for (const item of (Array.isArray(raw.hubs) ? raw.hubs : []).slice(0, 50)) {\n    if (!item || typeof item !== "object") continue;\n    const hub = String(item.hub || "").toUpperCase();\n    if (!/^[A-Z0-9_-]{2,20}$/.test(hub) || item.scope !== "current-worker-isolate") continue;\n    const counters = {\n      httpRequests: quotaCenterCounter(item.httpRequests),\n      statements: quotaCenterCounter(item.statements),\n      rowsRead: quotaCenterCounter(item.rowsRead),\n      rowsWritten: quotaCenterCounter(item.rowsWritten),\n      errors: quotaCenterCounter(item.errors),\n      providerLimitErrors: quotaCenterCounter(item.providerLimitErrors),\n      heavyReadEvents: quotaCenterCounter(item.heavyReadEvents),\n    };\n    const providerReadCircuitOpen = typeof item.providerReadCircuitOpen === "boolean" ? item.providerReadCircuitOpen : null;\n    const observedAt = quotaCenterTime(item.observedAt);\n    const since = quotaCenterTime(item.since);\n    const lastObservedAt = quotaCenterTime(item.lastObservedAt);\n    const hasEvidence = Object.values(counters).some((value) => value !== null) || providerReadCircuitOpen !== null || Boolean(observedAt || since || lastObservedAt);\n    if (!hasEvidence) continue;\n    const complete = Object.values(counters).every((value) => value !== null) && providerReadCircuitOpen !== null;\n    hubs.push({\n      hub,\n      state: item.state === "AVAILABLE" && complete ? "AVAILABLE" : "PARTIAL",\n      scope: "current-worker-isolate",\n      observedAt,\n      since,\n      ...counters,\n      providerReadCircuitOpen,\n      lastObservedAt,\n    });\n  }\n\n  let availability = ["AVAILABLE", "PARTIAL", "UNKNOWN", "UNAVAILABLE"].includes(raw.availability) ? raw.availability : "UNKNOWN";\n  if (!hubs.length) availability = raw.availability === "UNAVAILABLE" ? "UNAVAILABLE" : "UNKNOWN";\n  else {\n    const coverageMismatch = declaredQuotaHubs === null || declaredQuotaHubs !== hubs.length || (observedHubs !== null && observedHubs < hubs.length);\n    if (availability !== "AVAILABLE" || coverageMismatch || hubs.some((item) => item.state !== "AVAILABLE")) availability = "PARTIAL";\n  }\n\n  return {\n    availability,\n    mode: "PIGGYBACK_ISOLATE_COUNTERS",\n    billingTruth: "UNKNOWN",\n    providerPlanLimit: "UNKNOWN",\n    observedAt: quotaCenterTime(raw.observedAt),\n    coverage: { observedHubs, quotaObservedHubs: hubs.length },\n    hubs,\n  };\n}\n\n`;
  output = replaceOnce(
    output,
    `function renderIncidentActionCenter(center) {`,
    `${block}// SUPERVISOR_QUOTA_CENTER_RENDER_V1\nfunction quotaCenterValue(value) {\n  return value === null || value === undefined ? "UNKNOWN" : String(value);\n}\n\nfunction quotaCenterStatusClass(state) {\n  if (state === "AVAILABLE") return "healthy";\n  if (state === "PARTIAL") return "partial";\n  if (state === "UNAVAILABLE") return "unavailable";\n  return "unknown";\n}\n\nfunction renderQuotaCenter(center) {\n  const panel = document.querySelector('[data-panel="quota"]');\n  const surface = panel?.querySelector(".surface");\n  const stateTag = document.getElementById("quota-center-state");\n  const summary = document.getElementById("quota-center-summary");\n  const hubList = document.getElementById("quota-hub-list");\n  if (!surface || !stateTag || !summary || !hubList) return;\n\n  stateTag.textContent = center.availability;\n  stateTag.className = \`status-tag \${quotaCenterStatusClass(center.availability)}\`;\n  summary.replaceChildren();\n  const summaryList = document.createElement("dl");\n  summaryList.className = "hub-facts";\n  const fields = [\n    ["Evidence mode", center.mode],\n    ["Observed HUB coverage", center.coverage.observedHubs === null ? \`\${center.coverage.quotaObservedHubs} / UNKNOWN\` : \`\${center.coverage.quotaObservedHubs} / \${center.coverage.observedHubs}\`],\n    ["Provider billing truth", center.billingTruth],\n    ["Provider plan / limit", center.providerPlanLimit],\n    ["Latest observation", center.observedAt || "UNKNOWN"],\n  ];\n  for (const [label, value] of fields) {\n    const row = document.createElement("div");\n    const dt = document.createElement("dt");\n    const dd = document.createElement("dd");\n    dt.textContent = label;\n    dd.textContent = value;\n    row.append(dt, dd);\n    summaryList.append(row);\n  }\n  summary.append(summaryList);\n\n  hubList.replaceChildren();\n  if (!center.hubs.length) {\n    const empty = document.createElement("div");\n    empty.className = "truth-empty compact";\n    const strong = document.createElement("strong");\n    const text = document.createElement("p");\n    strong.textContent = center.availability === "UNAVAILABLE" ? "Quota telemetry UNAVAILABLE" : "Quota telemetry UNKNOWN";\n    text.textContent = "ไม่มี isolate-local evidence ที่ตรวจสอบได้ จึงไม่สร้างค่า 0 และไม่เดา provider usage";\n    empty.append(strong, text);\n    hubList.append(empty);\n    return;\n  }\n\n  for (const item of center.hubs) {\n    const card = document.createElement("article");\n    card.className = "hub-health-card";\n    const head = document.createElement("div");\n    head.className = "hub-health-head";\n    const title = document.createElement("strong");\n    title.textContent = \`\${item.hub} · isolate observation\`;\n    head.append(title, statusTag(item.state === "AVAILABLE" ? "HEALTHY" : "PARTIAL"));\n    const counters = document.createElement("p");\n    counters.textContent = \`HTTP \${quotaCenterValue(item.httpRequests)} · statements \${quotaCenterValue(item.statements)} · rows read \${quotaCenterValue(item.rowsRead)} · rows written \${quotaCenterValue(item.rowsWritten)}\`;\n    const guard = document.createElement("p");\n    guard.textContent = \`errors \${quotaCenterValue(item.errors)} · provider-limit errors \${quotaCenterValue(item.providerLimitErrors)} · heavy reads \${quotaCenterValue(item.heavyReadEvents)} · read circuit \${item.providerReadCircuitOpen === null ? "UNKNOWN" : item.providerReadCircuitOpen ? "OPEN" : "CLOSED"}\`;\n    const time = document.createElement("p");\n    time.textContent = \`since \${item.since || "UNKNOWN"} · observed \${item.observedAt || item.lastObservedAt || "UNKNOWN"}\`;\n    const note = document.createElement("p");\n    note.className = "truth-note";\n    note.textContent = "FACT: current Worker isolate only · ไม่ใช่ provider billing/account/monthly total และไม่รวม counter ข้าม isolate เป็นยอดรวม";\n    card.append(head, counters, guard, time, note);\n    hubList.append(card);\n  }\n}\n\nfunction renderIncidentActionCenter(center) {`,
    "quota derivation and render block",
  );

  output = replaceOnce(
    output,
    `  const incidentCenter = deriveIncidentActionCenter(hubViews, eventConsole.events, eventConsole.availability);\n  const overview = deriveOverview(snapshot, module, { moduleCount: moduleRegistry.list().length, workerReachable, nowMs });`,
    `  const incidentCenter = deriveIncidentActionCenter(hubViews, eventConsole.events, eventConsole.availability);\n  const quotaCenter = deriveQuotaCenter(snapshot?.quotaTelemetry);\n  const overview = deriveOverview(snapshot, module, { moduleCount: moduleRegistry.list().length, workerReachable, nowMs });`,
    "derive quota center",
  );
  output = replaceOnce(
    output,
    `  renderQueueLifecycle(hubs, overview.queueLifecycle);\n  renderIncidentActionCenter(incidentCenter);`,
    `  renderQueueLifecycle(hubs, overview.queueLifecycle);\n  renderQuotaCenter(quotaCenter);\n  renderIncidentActionCenter(incidentCenter);`,
    "render quota center",
  );
  return output;
});

await patchFile("supervisor.html", (source) => {
  let output = source;
  const oldQuota = `        <section class="panel-section" data-panel="quota">\n          <div class="section-grid">\n            <article class="surface span-2"><div class="surface-head"><div><p class="card-label">QUOTA CENTER</p><h3>Runtime observation &amp; provider truth</h3></div><span class="status-tag unknown">UNKNOWN</span></div><div class="truth-empty"><strong>ยังไม่มี quota snapshot</strong><p>จะไม่ยิง provider หรือ source เพิ่มเพื่อวัด quota และจะไม่เดา provider limit</p></div></article>\n            <article class="surface"><div class="surface-head"><div><p class="card-label">LEAK DETECTOR</p><h3>Hard contracts</h3></div></div><ul class="contract-list"><li><span>Per-client upstream</span><strong>0</strong></li><li><span>Per-widget upstream</span><strong>0</strong></li><li><span>Continuous AI</span><strong>0</strong></li></ul></article>\n          </div>\n        </section>`;
  const newQuota = `        <section class="panel-section" data-panel="quota">\n          <div class="section-grid">\n            <article class="surface span-2">\n              <div class="surface-head"><div><p class="card-label">QUOTA CENTER</p><h3>Runtime observation &amp; provider truth</h3></div><span id="quota-center-state" class="status-tag unknown">UNKNOWN</span></div>\n              <div id="quota-center-summary" class="truth-empty compact"><strong>Provider billing truth: UNKNOWN</strong><p>รอ SUP-10 shared isolate telemetry; จะไม่ยิง provider/source เพิ่มและจะไม่เดา plan limit</p></div>\n              <div id="quota-hub-list" class="hub-health-grid"></div>\n              <p class="truth-note">Isolate-local facts only · ไม่มีการรวม counter ข้าม isolate เป็น account total · billing และ provider plan/limit ที่ไม่มีหลักฐานคงเป็น UNKNOWN</p>\n            </article>\n            <article class="surface">\n              <div class="surface-head"><div><p class="card-label">QUOTA GUARDS</p><h3>Hard contracts</h3></div><span class="status-tag healthy">OBSERVE ONLY</span></div>\n              <ul class="contract-list"><li><span>Per-client upstream</span><strong>0</strong></li><li><span>Per-widget upstream</span><strong>0</strong></li><li><span>Provider measurement calls</span><strong>0</strong></li><li><span>Quota DB reads / writes</span><strong>0 / 0</strong></li><li><span>Continuous AI</span><strong>0</strong></li></ul>\n              <p class="truth-note">SUP-11 เป็น presentation only; leak/circuit/backoff/kill-switch policy อยู่ SUP-12</p>\n            </article>\n          </div>\n        </section>`;
  if (!output.includes('id="quota-center-state"')) output = replaceOnce(output, oldQuota, newQuota, "quota HTML panel");
  output = output.replace("supervisor.js?v=20260914-sup09", "supervisor.js?v=20260915-sup11");
  return output;
});

await patchFile("worker/tests/supervisor-core-shell.test.mjs", (source) =>
  source.replace(/supervisor\\\.js\\\?v=20260914-sup09/g, "supervisor\\.js\\?v=20260915-sup11")
);

await patchFile("worker/package.json", (source) => {
  if (source.includes("tests/supervisor-shared-quota-center.test.mjs")) return source;
  return replaceOnce(
    source,
    "tests/supervisor-quota-instrumentation.test.mjs tests/bus-enrichment.test.mjs",
    "tests/supervisor-quota-instrumentation.test.mjs tests/supervisor-shared-quota-center.test.mjs tests/bus-enrichment.test.mjs",
    "package check includes SUP-11",
  );
});

console.log("SUP11_CANONICAL_APPLY=PASS");
