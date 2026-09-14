// SUPERVISOR_CORE_SHELL_V1
// Side-car snapshot client: one same-origin shared-state read, zero upstream/database
// reads, WebSocket, interval, source polling, persistence, repair, or AI calls.
import { createSupervisorRegistry, waitingTrucksModule } from "./supervisor-modules.js?v=20260914-sup03";

const SUPERVISOR_AUTH_KEY = "bnak_operator_auth_v2";
const moduleRegistry = createSupervisorRegistry([waitingTrucksModule]);

const sectionCopy = {
  overview: ["ภาพรวมระบบ", "สถานะจริงจะแสดงเมื่อ shared Supervisor snapshot พร้อมใช้งาน"],
  hubs: ["สุขภาพ HUB และ Source", "แสดงเฉพาะ HUB ที่ configured/discovered จากข้อมูลจริง"],
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

function metricValue(metrics, id) {
  const metric = Array.isArray(metrics) ? metrics.find((item) => item?.id === id) : null;
  return Number.isFinite(Number(metric?.value)) ? Number(metric.value) : null;
}

function renderSnapshot(snapshot) {
  const context = snapshot?.modules || {};
  const [module] = moduleRegistry.evaluate(context);
  const waitingTrucks = context.waitingTrucks || {};
  const hubs = Array.isArray(waitingTrucks.hubs) ? waitingTrucks.hubs : [];
  const state = module?.health?.state || "UNKNOWN";
  const stateClass = state.toLowerCase();

  document.getElementById("configured-module-count").textContent = "1";
  document.getElementById("configured-module-state").textContent = state;
  document.getElementById("observed-hub-count").textContent = String(metricValue(module?.metrics, "observed-hubs") ?? hubs.length);
  document.getElementById("healthy-hub-count").textContent = String(metricValue(module?.metrics, "healthy-observed-hubs") ?? hubs.filter((hub) => hub?.health === "HEALTHY").length);
  document.getElementById("snapshot-state").lastChild.textContent = ` Snapshot: ${snapshot?.observedAt ? "AVAILABLE" : "UNKNOWN"}`;
  document.getElementById("overall-health").innerHTML = `<span class="status-orb ${stateClass}"></span>${state}`;
  document.getElementById("overall-health-detail").textContent = module?.health?.impact || "ยังไม่มีหลักฐาน shared runtime เพียงพอ";

  const hubState = document.getElementById("hub-snapshot-state");
  hubState.textContent = hubs.length ? "PARTIAL" : "UNKNOWN";
  const list = document.getElementById("hub-snapshot-list");
  if (!hubs.length) {
    list.className = "truth-empty";
    list.innerHTML = "<strong>ยังไม่มี runtime event ของ HUB</strong><p>Durable Object อาจเพิ่งเริ่มใหม่ หรือยังไม่มีรอบ refresh จริง ข้อมูลจึงคงเป็น UNKNOWN</p>";
    return;
  }
  list.className = "hub-snapshot-list";
  list.replaceChildren(...hubs.map((hub) => {
    const card = document.createElement("article");
    const title = document.createElement("strong");
    const health = document.createElement("span");
    const detail = document.createElement("small");
    title.textContent = hub.hub || "UNKNOWN";
    health.textContent = hub.health || "UNKNOWN";
    health.className = `status-tag ${(hub.health || "UNKNOWN").toLowerCase()}`;
    const accepted = hub.accepted?.state === "AVAILABLE" ? `${hub.accepted.rows} accepted rows` : "Accepted state UNKNOWN";
    detail.textContent = `${accepted} · Last success ${hub.lastSuccessAt || "UNKNOWN"}`;
    card.append(title, health, detail);
    return card;
  }));
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
    renderSnapshot(payload.data);
  } catch {
    renderSnapshot(null);
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
