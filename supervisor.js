// SUPERVISOR_CORE_SHELL_V1
// SUPERVISOR_SOURCE_HEALTH_V1
// SUPERVISOR_QUEUE_LIFECYCLE_V1
// SUPERVISOR_EVENT_CONSOLE_V1
// Side-car snapshot client: one same-origin shared-state read, zero upstream/database
// reads, WebSocket, interval, source polling, persistence, repair, or AI calls.
import { createSupervisorRegistry, waitingTrucksModule } from "./supervisor-modules.js?v=20260914-sup03";
import { deriveHubView, deriveOverview } from "./supervisor-view.js?v=20260914-sup07";

const SUPERVISOR_AUTH_KEY = "bnak_operator_auth_v2";
const moduleRegistry = createSupervisorRegistry([waitingTrucksModule]);
const terminalState = { availability: "UNAVAILABLE", events: [], filter: "ALL", cleared: false, limit: 120 };

const sectionCopy = {
  overview: ["ภาพรวมระบบ", "สถานะจริงจะแสดงเมื่อ shared Supervisor snapshot พร้อมใช้งาน"],
  hubs: ["สุขภาพ HUB และ Source", "Source Health ใช้ telemetry ที่เกิดจาก refresh/coordinator เดิมเท่านั้น"],
  diagnostics: ["Queue / Lifecycle Diagnostics", "อ่าน accepted current rows จาก refresh เดิมเท่านั้น ไม่สร้าง source หรือ DB traffic เพิ่ม"],
  quota: ["Quota Center", "วัดจากงานเดิมและ shared telemetry โดยไม่สร้าง traffic เพื่อวัด traffic"],
  incidents: ["Alert, Incident และ Action Center", "รวม state change ที่ dedupe แล้วและสิ่งที่ Admin ต้องจัดการ"],
  maintenance: ["Maintenance Advisor", "สรุป auth renewal, warning, drift และ pending repair จากหลักฐานจริง"],
  terminal: ["Terminal-style Event Console", "Event ชั่วคราวแบบ bounded จาก shared state เดิม; Clear view ไม่ลบ event ring, Audit หรือ Incident"],
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

function terminalPanel() {
  return document.querySelector('[data-panel="terminal"]');
}

function terminalVisibleEvents() {
  if (terminalState.cleared || terminalState.availability !== "AVAILABLE") return [];
  return terminalState.events.filter((event) => terminalState.filter === "ALL" || event.level === terminalState.filter);
}

function terminalTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function normalizeTerminalConsole(snapshot) {
  const raw = snapshot?.eventConsole;
  if (!raw || raw.availability !== "AVAILABLE" || !Array.isArray(raw.events))
    return { availability: "UNAVAILABLE", events: [], limit: 120 };
  const suppliedLimit = Number(raw.limit);
  const limit = Number.isInteger(suppliedLimit) && suppliedLimit > 0 && suppliedLimit <= 120 ? suppliedLimit : 120;
  const seen = new Set();
  const events = [];
  for (const item of raw.events) {
    if (!item || typeof item !== "object") continue;
    const atMs = Date.parse(String(item.at || ""));
    const level = String(item.level || "").toUpperCase();
    const code = String(item.code || "").toUpperCase();
    const hub = String(item.hub || "").toUpperCase();
    const source = item.source == null ? null : String(item.source || "").toUpperCase();
    if (!Number.isFinite(atMs) || !["INFO", "PASS", "WARN", "ERROR"].includes(level)) continue;
    if (!/^[A-Z0-9_:-]{2,80}$/.test(code) || !/^[A-Z0-9_-]{2,20}$/.test(hub)) continue;
    if (source && !/^[A-Z0-9_:-]{2,80}$/.test(source)) continue;
    const message = String(item.message || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 220);
    if (!message) continue;
    const id = String(item.id || `${new Date(atMs).toISOString()}|${hub}|${code}|${events.length}`).slice(0, 180);
    if (seen.has(id)) continue;
    seen.add(id);
    events.push({ id, at: new Date(atMs).toISOString(), level, code, hub, source, message });
  }
  events.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  return { availability: "AVAILABLE", events: events.slice(-limit), limit };
}

function renderTerminalRows() {
  const panel = terminalPanel();
  const body = panel?.querySelector(".terminal-body");
  if (!body) return;
  const buttons = [...panel.querySelectorAll(".terminal-head button")];
  const copyButton = buttons[1];
  const clearButton = buttons[2];
  const visible = terminalVisibleEvents();
  body.replaceChildren();

  const messageRow = (text) => {
    const row = document.createElement("p");
    const time = document.createElement("time");
    const level = document.createElement("b");
    const message = document.createElement("span");
    time.textContent = "--:--:--";
    level.textContent = "INFO";
    message.textContent = text;
    row.append(time, level, message);
    body.append(row);
  };

  if (terminalState.availability !== "AVAILABLE") {
    messageRow("Event console UNAVAILABLE. No runtime event was fabricated.");
  } else if (terminalState.cleared) {
    messageRow("View cleared locally. Ephemeral event ring was not deleted; use Restore view to show the retained snapshot again.");
  } else if (!terminalState.events.length) {
    messageRow("No material runtime transition is retained in the current ephemeral ring.");
  } else if (!visible.length) {
    messageRow(`No retained event matches filter ${terminalState.filter}.`);
  } else {
    for (const event of visible) {
      const row = document.createElement("p");
      row.dataset.level = event.level;
      const time = document.createElement("time");
      const level = document.createElement("b");
      const message = document.createElement("span");
      time.textContent = terminalTime(event.at);
      time.title = event.at;
      level.textContent = event.level;
      const scope = event.source ? `${event.hub}/${event.source}` : event.hub;
      message.textContent = `${scope} · ${event.code} · ${event.message}`;
      row.append(time, level, message);
      body.append(row);
    }
    body.scrollTop = body.scrollHeight;
  }

  if (copyButton) copyButton.disabled = visible.length === 0;
  if (clearButton) {
    clearButton.disabled = terminalState.availability !== "AVAILABLE" || terminalState.events.length === 0;
    clearButton.textContent = terminalState.cleared ? "Restore view" : "Clear view";
  }
}

function renderTerminalConsole(snapshot) {
  const normalized = normalizeTerminalConsole(snapshot);
  terminalState.availability = normalized.availability;
  terminalState.events = normalized.events;
  terminalState.limit = normalized.limit;
  terminalState.cleared = false;
  terminalState.filter = "ALL";
  const panel = terminalPanel();
  panel?.querySelectorAll(".terminal-filters span").forEach((item) => {
    item.classList.toggle("is-active", item.textContent.trim().toUpperCase() === "ALL");
  });
  renderTerminalRows();
}

function bindTerminalControls() {
  const panel = terminalPanel();
  if (!panel) return;
  const buttons = [...panel.querySelectorAll(".terminal-head button")];
  const pauseButton = buttons[0];
  const copyButton = buttons[1];
  const clearButton = buttons[2];
  if (pauseButton) {
    pauseButton.textContent = "One-shot";
    pauseButton.disabled = true;
    pauseButton.title = "SUP-08 reads the shared snapshot once and does not start a background event stream.";
  }
  if (copyButton) {
    copyButton.disabled = true;
    copyButton.addEventListener("click", async () => {
      const events = terminalVisibleEvents();
      if (!events.length) return;
      const text = events.map((event) => `${event.at} ${event.level} ${event.hub}${event.source ? `/${event.source}` : ""} ${event.code} ${event.message}`).join("\n");
      try {
        await navigator.clipboard.writeText(text);
        copyButton.textContent = "Copied";
      } catch {
        copyButton.textContent = "Copy blocked";
      }
    });
  }
  if (clearButton) {
    clearButton.disabled = true;
    clearButton.addEventListener("click", () => {
      terminalState.cleared = !terminalState.cleared;
      renderTerminalRows();
    });
  }
  panel.querySelectorAll(".terminal-filters span").forEach((item) => {
    const value = item.textContent.trim().toUpperCase();
    if (!["ALL", "PASS", "WARN", "ERROR"].includes(value)) return;
    item.tabIndex = 0;
    item.setAttribute("role", "button");
    item.setAttribute("aria-label", `Filter terminal events: ${value}`);
    const activate = () => {
      terminalState.filter = value;
      terminalState.cleared = false;
      panel.querySelectorAll(".terminal-filters span").forEach((candidate) => candidate.classList.toggle("is-active", candidate === item));
      renderTerminalRows();
    };
    item.addEventListener("click", activate);
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate();
      }
    });
  });
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
  bindTerminalControls();
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

function lifecycleFact(lifecycle) {
  if (!lifecycle || lifecycle.state === "UNKNOWN") return "UNKNOWN";
  return `${lifecycle.state} · active ${lifecycle.active} · waiting ${lifecycle.waiting} · unloading ${lifecycle.unloading}`;
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
    const queue = view.queueLifecycle;
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
      ["Queue / Lifecycle", lifecycleFact(queue)],
      ["Queue snapshot age", queue.age?.label || "UNKNOWN"],
      ["Destination active", queue.state === "UNKNOWN" ? "UNKNOWN" : String(queue.destinationActive)],
      ["Drop active", queue.state === "UNKNOWN" ? "UNKNOWN" : String(queue.dropActive)],
      ["Drop awaiting release", queue.state === "UNKNOWN" ? "UNKNOWN" : String(queue.awaitingRelease)],
      ["12h expired observed", queue.state === "UNKNOWN" ? "UNKNOWN" : String(queue.expired12h)],
      ["Cancelled observed", queue.state === "UNKNOWN" ? "UNKNOWN" : String(queue.cancelledObserved)],
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
    truth.textContent = "FACT: Source Health และ Queue/Lifecycle มาจาก refresh/coordinator เดิมเท่านั้น · Queue ใช้ accepted current rows และ operational stage contract เดียวกับหน้าหลัก · ไม่มีหลักฐาน = UNKNOWN";
    card.append(head, dl, truth);
    return card;
  }));
}

function renderQueueLifecycle(hubs, summary) {
  const panel = document.querySelector('[data-panel="diagnostics"]');
  const surface = panel?.querySelector(".surface");
  if (!surface) return;
  const tag = surface.querySelector(".status-tag");
  if (tag) {
    tag.textContent = summary?.state || "UNKNOWN";
    tag.className = `status-tag ${String(summary?.state || "UNKNOWN").toLowerCase()}`;
  }
  const body = surface.querySelector(".body-copy");
  if (body) {
    body.textContent = summary?.state === "UNKNOWN"
      ? "ยังไม่มี accepted lifecycle telemetry จึงไม่สรุปสถานะคิว"
      : `FACT จาก accepted current rows: active ${summary.active} · waiting ${summary.waiting} · unloading ${summary.unloading} · Drop รอปล่อย ${summary.awaitingRelease} · หมดอายุ 12 ชม. ${summary.expired12h} · ยกเลิกที่สังเกตได้ ${summary.cancelledObserved}`;
  }
  surface.querySelector("[data-queue-lifecycle-detail]")?.remove();
  const detail = document.createElement("div");
  detail.dataset.queueLifecycleDetail = "1";
  detail.className = "hub-health-grid";
  const cards = hubs.map((hub) => deriveHubView(hub)).filter((view) => view.queueLifecycle.state !== "UNKNOWN");
  if (!cards.length) {
    const empty = document.createElement("div");
    empty.className = "truth-empty compact";
    const strong = document.createElement("strong");
    const text = document.createElement("p");
    strong.textContent = "UNKNOWN";
    text.textContent = "ไม่มี lifecycle observation ที่ตรวจสอบโครงสร้างได้";
    empty.append(strong, text);
    detail.append(empty);
  } else {
    for (const view of cards) {
      const item = document.createElement("article");
      item.className = "hub-health-card";
      const title = document.createElement("strong");
      const text = document.createElement("p");
      title.textContent = `${view.hub} · ${view.queueLifecycle.state}`;
      text.textContent = `active ${view.queueLifecycle.active} · waiting ${view.queueLifecycle.waiting} · unloading ${view.queueLifecycle.unloading} · Destination ${view.queueLifecycle.destinationActive} · Drop ${view.queueLifecycle.dropActive} · รอปล่อย ${view.queueLifecycle.awaitingRelease} · 12h ${view.queueLifecycle.expired12h} · cancelled ${view.queueLifecycle.cancelledObserved} · age ${view.queueLifecycle.age.label}`;
      item.append(title, text);
      detail.append(item);
    }
  }
  const note = document.createElement("p");
  note.className = "truth-note";
  note.textContent = "FACT ONLY · ไม่แก้ actual arrival/departure/completion · ไม่อ่าน DB · ไม่ยิง MS/KIT/TBR/HBI เพิ่ม · 12h cutoff และ Drop departure ใช้ contract เดียวกับ Waiting Trucks";
  detail.append(note);
  surface.append(detail);
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
  renderQueueLifecycle(hubs, overview.queueLifecycle);
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
  renderTerminalConsole(snapshot);
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
