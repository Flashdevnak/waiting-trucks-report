// SUPERVISOR_CORE_SHELL_V1
// SUPERVISOR_SOURCE_HEALTH_V1
// Side-car snapshot client: one same-origin shared-state read, zero upstream/database
// reads, WebSocket, interval, source polling, persistence, repair, or AI calls.
import { createSupervisorRegistry, waitingTrucksModule } from "./supervisor-modules.js?v=20260914-sup03";
import { deriveHubView, deriveOverview } from "./supervisor-view.js?v=20260914-sup05";

const SUPERVISOR_AUTH_KEY = "bnak_operator_auth_v2";
const moduleRegistry = createSupervisorRegistry([waitingTrucksModule]);

const sectionCopy = {
  overview: ["ภาพรวมระบบ", "สถานะจริงจะแสดงเมื่อ shared Supervisor snapshot พร้อมใช้งาน"],
  hubs: ["สุขภาพ HUB และ Source", "Source Health ใช้ telemetry ที่เกิดจาก refresh/coordinator เดิมเท่านั้น"],
  diagnostics: ["System Diagnostics", "วิเคราะห์ Queue/Lifecycle และ config drift โดยไม่แก้ business truth"],
  quota: ["Quota Center", "วัดจากงานเดิมและ shared telemetry โดยไม่สร้าง traffic เพื่อวัด traffic"],
  incidents: ["Alert, Incident และ Action Center", "รวม state change ที่ dedupe แล้วและสิ่งที่ Admin ต้องจัดการ"],
  maintenance: ["Maintenance Advisor", "สรุป auth renewal, warning, drift และ pending repair จากหลักฐานจริง"],
  terminal: ["Terminal-style Event Console", "Event ชั่วคราวแบบ bounded; Clear view ไม่ลบ Audit หรือ Incident"],
  guide: ["คู่มือและ System Context", "คำอธิบายสถานะ การแก้ปัญหา และ sanitized evidence"],
};

function readLocalAdminClaim() {
  try {
    const auth = JSON.parse(localStorage.getItem(SUPERVISOR_AUTH_KEY) || "null");
    if (!auth?.token || auth.role !== "admin") return null;
    if (!Number.isFinite(Number(auth.expiresAt)) || Date.now() > Number(auth.expiresAt)) return null;
    return auth;
  } catch {
    return null;
  }
}

function showGate(title, message) {
  document.getElementById("gate-title").textContent = title;
  document.getElementById("gate-message").textContent = message;
  document.getElementById("supervisor-gate").hidden = false;
  document.getElementById("supervisor-app").hidden = true;
}

function activateSection(name) {
  const copy = sectionCopy[name];
  if (!copy) return;
  document.querySelectorAll("[data-section]").forEach((item) => {
    const active = item.dataset.section === name;
    item.classList.toggle("is-active", active);
    item.setAttribute("aria-current", active ? "page" : "false");
  });
  document.querySelectorAll("[data-panel]").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.panel === name);
  });
  document.getElementById("section-title").textContent = copy[0];
  document.getElementById("section-subtitle").textContent = copy[1];
}

function bindShell() {
  document.getElementById("supervisor-nav").addEventListener("click", (event) => {
    const button = event.target.closest("[data-section]");
    if (button) activateSection(button.dataset.section);
  });
  const dialog = document.getElementById("why-dialog");
  document.querySelectorAll("[data-why]").forEach((button) => {
    button.addEventListener("click", () => dialog.showModal());
  });
  dialog.querySelector("[data-close-dialog]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}

function statusTag(state) {
  const value = String(state || "UNKNOWN");
  const tag = document.createElement("small");
  tag.className = `status-tag ${value.toLowerCase()}`;
  tag.textContent = value;
  return tag;
}

function renderOverviewCards(cards) {
  const grid = document.getElementById("overview-metrics");
  grid.replaceChildren(...cards.map((item) => {
    const card = document.createElement("article");
    const label = document.createElement("span");
    const value = document.createElement("strong");
    label.textContent = item.label;
    value.textContent = item.value;
    card.className = "metric-card";
    card.dataset.metric = item.id;
    card.append(label, value, statusTag(item.status));
    if (item.detail) {
      const detail = document.createElement("p");
      detail.className = "metric-detail";
      detail.textContent = item.detail;
      card.append(detail);
    }
    return card;
  }));
}

function sourceFact(source) {
  if (!source) return "UNKNOWN";
  const parts = [source.state || "UNKNOWN"];
  if (source.mode === "CLICK_ONLY") parts.push("CLICK ONLY");
  if (source.configured === true) parts.push("CONFIGURED");
  if (source.configured === false) parts.push("NOT CONFIGURED");
  if (source.freshness && source.freshness !== "UNKNOWN") parts.push(source.freshness);
  if (source.lastSuccessAt) parts.push(`success ${source.lastSuccessAt}`);
  if (source.lastUsedAt) parts.push(`used ${source.lastUsedAt}`);
  if (source.recovery && source.recovery !== "UNKNOWN") parts.push(source.recovery);
  if (source.retryAt) parts.push(`retry ${source.retryAt}`);
  if (source.errorCode) parts.push(source.errorCode);
  return parts.join(" · ");
}

function renderHubCards(hubs) {
  const list = document.getElementById("hub-snapshot-list");
  if (!hubs.length) {
    list.className = "truth-empty";
    list.innerHTML = "<strong>ยังไม่มี runtime event ของ HUB</strong><p>Durable Object อาจเพิ่งเริ่มใหม่ หรือยังไม่มีรอบ refresh จริง ข้อมูลจึงคงเป็น UNKNOWN</p>";
    return;
  }
  list.className = "hub-health-grid";
  list.replaceChildren(...hubs.map((hub) => {
    const view = deriveHubView(hub);
    const card = document.createElement("article");
    card.className = "hub-health-card";
    const head = document.createElement("div");
    head.className = "hub-health-head";
    const title = document.createElement("div");
    const eyebrow = document.createElement("small");
    const heading = document.createElement("h4");
    eyebrow.textContent = "OBSERVED HUB";
    heading.textContent = view.hub;
    title.append(eyebrow, heading);
    head.append(title, statusTag(view.overall));
    const facts = [
      ["Route", sourceFact(view.sources.route)],
      ["PreEntry / FBI", sourceFact(view.sources.preEntry)],
      ["KIT / TBR", sourceFact(view.sources.busTime)],
      ["HBI", sourceFact(view.sources.hbiPhotos)],
      ["Connector / Session", view.connectorSession],
      ["Refresh last success", view.lastSuccessAt || "UNKNOWN"],
      ["Refresh age", view.age.label],
      ["Accepted cache", view.accepted.state === "AVAILABLE" ? `AVAILABLE · ${view.accepted.rows} rows` : "UNKNOWN"],
      ["Queue health", view.queueHealth],
      ["Current refresh error", view.errorCode || (view.overall === "HEALTHY" ? "NONE OBSERVED" : "UNKNOWN")],
      ["Quota anomaly", view.quota],
      ["Pending action", view.pendingAction],
    ];
    const dl = document.createElement("dl");
    dl.className = "hub-facts";
    for (const [label, value] of facts) {
      const row = document.createElement("div");
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = label;
      dd.textContent = value;
      row.append(dt, dd);
      dl.append(row);
    }
    const truth = document.createElement("p");
    truth.className = "truth-note";
    truth.textContent = "FACT: Source Health มาจาก refresh/coordinator telemetry เดิมเท่านั้น · HBI เป็น click-only และไม่ถูก poll เพื่อวัด health · ไม่มีหลักฐาน = UNKNOWN";
    card.append(head, dl, truth);
    return card;
  }));
}

function renderSnapshot(snapshot, workerReachable = false) {
  const context = snapshot?.modules || {};
  const [module] = moduleRegistry.evaluate(context);
  const waitingTrucks = context.waitingTrucks || {};
  const hubs = Array.isArray(waitingTrucks.hubs) ? waitingTrucks.hubs : [];
  const overview = deriveOverview(snapshot, module, { moduleCount: moduleRegistry.list().length, workerReachable });

  document.getElementById("snapshot-state").lastChild.textContent = ` Snapshot: ${overview.snapshot}`;
  const overallHealth = document.getElementById("overall-health");
  const orb = document.createElement("span");
  orb.className = `status-orb ${overview.overall.toLowerCase()}`;
  overallHealth.replaceChildren(orb, document.createTextNode(overview.overall));
  document.getElementById("overall-health-detail").textContent = overview.impact;
  renderOverviewCards(overview.cards);
  for (const [key, value] of Object.entries(overview.map))
    document.getElementById(`map-${key}`).textContent = value;
  const mapState = document.getElementById("system-map-state");
  mapState.textContent = overview.overall;
  mapState.className = `status-tag ${overview.overall.toLowerCase()}`;

  const hubState = document.getElementById("hub-snapshot-state");
  hubState.textContent = hubs.length ? "PARTIAL" : "UNKNOWN";
  hubState.className = `status-tag ${hubs.length ? "partial" : "unknown"}`;
  renderHubCards(hubs);
  const sourceSummary = document.getElementById("source-snapshot-summary");
  sourceSummary.replaceChildren();
  const sourceState = document.createElement("strong");
  const sourceDetail = document.createElement("p");
  sourceState.textContent = overview.map.sources;
  if (hubs.length) {
    const views = hubs.map((hub) => deriveHubView(hub));
    const sources = views.flatMap((view) => Object.values(view.sources));
    const authRequired = sources.filter((source) => source.state === "AUTH_REQUIRED").length;
    const errors = sources.filter((source) => ["ERROR", "CRITICAL", "BLOCKED"].includes(source.state)).length;
    const stale = sources.filter((source) => source.freshness === "STALE").length;
    sourceDetail.textContent = `refresh/coordinator telemetry เท่านั้น · AUTH_REQUIRED ${authRequired} · ERROR ${errors} · STALE ${stale} · HBI คง click-only`;
  } else {
    sourceDetail.textContent = "ยังไม่มี source observation; missing data ไม่ใช่ HEALTHY";
  }
  sourceSummary.append(sourceState, sourceDetail);
}

async function loadSharedSnapshot() {
  try {
    const response = await fetch("/api/supervisor/snapshot", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const payload = await response.json();
    if (!response.ok || payload?.ok !== true) throw new Error(payload?.code || "SNAPSHOT_UNAVAILABLE");
    renderSnapshot(payload.data, true);
  } catch {
    renderSnapshot(null, false);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const auth = readLocalAdminClaim();
  if (!auth) {
    showGate(
      "Supervisor สำหรับ Admin เท่านั้น",
      "ไม่พบสิทธิ์ Admin ที่ยังไม่หมดอายุ กรุณาเข้าสู่ระบบจากหน้า Admin ก่อน",
    );
    return;
  }

  // Defense in depth only. The SUP-02 Worker guard has already verified the
  // signed HttpOnly session and current Admin role before serving this HTML.
  document.getElementById("supervisor-gate").hidden = true;
  document.getElementById("supervisor-app").hidden = false;
  renderSnapshot(null);
  bindShell();
  activateSection("overview");
  void loadSharedSnapshot();
});
