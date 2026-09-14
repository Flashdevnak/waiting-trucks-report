// SUPERVISOR_CORE_SHELL_V1
// SUPERVISOR_SOURCE_HEALTH_V1
// SUPERVISOR_QUEUE_LIFECYCLE_V1
// SUPERVISOR_EVENT_CONSOLE_V1
// SUPERVISOR_INCIDENT_ACTION_V1
// SUPERVISOR_QUOTA_CENTER_V1
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
  incidents: ["Alert, Incident และ Action Center", "สรุป current open incident จาก shared state และใช้ event ring เป็นหลักฐานประกอบเท่านั้น"],
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

// SUPERVISOR_INCIDENT_ACTION_V1: pure derivation from already-sanitized current
// HUB views plus the SUP-08 ephemeral event ring. Current state is authoritative;
// historical WARN/ERROR events never keep an incident open after current recovery.
function incidentSeverity(state) {
  const value = String(state || "UNKNOWN").toUpperCase();
  if (["ERROR", "CRITICAL", "BLOCKED"].includes(value)) return "ERROR";
  if (["AUTH_REQUIRED", "WARNING", "STALE", "PARTIAL"].includes(value)) return "WARN";
  return null;
}

function validIncidentTime(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function latestIncidentEvent(events, hub, source = null) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.hub !== hub) continue;
    if (source && event.source !== source) continue;
    if (!source && event.source) continue;
    if (["SOURCE_STATE_CHANGED", "REFRESH_ERROR", "REFRESH_RECOVERED", "HUB_HEALTH_CHANGED"].includes(event.code)) return event;
  }
  return null;
}

function incidentManualStep(hub, sourceLabel, state, errorCode) {
  if (state === "AUTH_REQUIRED")
    return `ต่ออายุ session / HAR จริงของ ${sourceLabel} สำหรับ ${hub} แล้วให้ refresh/coordinator เดิมยืนยันผล; ห้ามสร้าง session ปลอม`;
  if (state === "STALE")
    return `ตรวจ last success และ session ของ ${sourceLabel} สำหรับ ${hub}; อย่าเพิ่ม polling เพื่อบังคับ freshness`;
  if (["ERROR", "CRITICAL", "BLOCKED"].includes(state))
    return `ตรวจ ${sourceLabel} ของ ${hub}${errorCode ? ` (${errorCode})` : ""} จากหลักฐานจริง แล้วรอรอบ shared refresh เดิมยืนยันการฟื้นตัว`;
  return `ตรวจ evidence และ source state ของ ${sourceLabel} สำหรับ ${hub} แบบ manual; OBSERVE ONLY ไม่มี repair execution`;
}

function deriveIncidentActionCenter(hubViews = [], events = [], eventAvailability = "UNAVAILABLE") {
  const views = Array.isArray(hubViews)
    ? hubViews.filter((view) => /^[A-Z0-9_-]{2,20}$/.test(String(view?.hub || "")) && view.hub !== "UNKNOWN")
    : [];
  const safeEvents = Array.isArray(events) ? events.filter((event) => event && typeof event === "object") : [];
  const incidents = [];
  const actions = [];
  const seen = new Set();
  const sourceMap = [
    ["route", "ROUTE", "Route"],
    ["preEntry", "PREENTRY", "PreEntry"],
    ["busTime", "KIT_TBR", "KIT/TBR"],
    ["hbiPhotos", "HBI", "HBI"],
  ];

  const add = ({ key, severity, hub, source = null, state, code, title, evidence, observedAt, actionKind, nextStep }) => {
    if (!severity || seen.has(key)) return;
    seen.add(key);
    const time = validIncidentTime(observedAt);
    const cleanCode = /^[A-Z0-9_:-]{2,80}$/.test(String(code || "")) ? String(code) : null;
    incidents.push({
      key, severity, status: "OPEN", hub, source, state, code: cleanCode, title,
      evidence: String(evidence || "").slice(0, 260), observedAt: time,
    });
    actions.push({
      key: `ACTION:${key}`, hub, source, severity, kind: actionKind,
      title: state === "AUTH_REQUIRED" ? `Manual re-auth · ${source || hub}` : `Manual review · ${source || hub}`,
      nextStep: String(nextStep || "").slice(0, 360), canExecute: false, mode: "OBSERVE_ONLY",
    });
  };

  for (const view of views) {
    let specific = 0;
    for (const [field, sourceCode, sourceLabel] of sourceMap) {
      const source = view?.sources?.[field];
      if (!source || source.configured === false) continue;
      if (source.mode === "CLICK_ONLY" && source.state === "UNKNOWN") continue;
      const severity = incidentSeverity(source.state);
      if (!severity) continue;
      const event = latestIncidentEvent(safeEvents, view.hub, sourceCode);
      const evidenceAt = event?.at || source.lastSuccessAt || view.lastSuccessAt || null;
      const evidence = `${sourceLabel} current ${source.state}${source.errorCode ? ` · ${source.errorCode}` : ""}${source.freshness && source.freshness !== "UNKNOWN" ? ` · ${source.freshness}` : ""}`;
      add({
        key: `SOURCE:${view.hub}:${sourceCode}`,
        severity,
        hub: view.hub,
        source: sourceCode,
        state: source.state,
        code: source.errorCode,
        title: source.state === "AUTH_REQUIRED" ? `${sourceLabel} ต้องยืนยันตัวตนใหม่` : `${sourceLabel} ต้องตรวจสอบ`,
        evidence,
        observedAt: evidenceAt,
        actionKind: source.state === "AUTH_REQUIRED" ? "MANUAL_REAUTH" : source.state === "STALE" ? "MANUAL_FRESHNESS_REVIEW" : "MANUAL_SOURCE_REVIEW",
        nextStep: incidentManualStep(view.hub, sourceLabel, source.state, source.errorCode),
      });
      specific += 1;
    }

    if (view.errorCode) {
      const event = latestIncidentEvent(safeEvents, view.hub, null);
      add({
        key: `REFRESH:${view.hub}`,
        severity: "ERROR",
        hub: view.hub,
        state: "ERROR",
        code: view.errorCode,
        title: "Shared refresh มี error ที่ยังสังเกตได้",
        evidence: `Current refresh error · ${view.errorCode}`,
        observedAt: event?.at || view.lastSuccessAt || null,
        actionKind: "MANUAL_REFRESH_REVIEW",
        nextStep: `ตรวจ refresh error ${view.errorCode} และ Source Health ของ ${view.hub}; ห้ามยิง source เพิ่มเพื่อทำให้สถานะเขียว`,
      });
      specific += 1;
    }

    const hubSeverity = incidentSeverity(view.overall);
    if (!specific && hubSeverity) {
      const event = latestIncidentEvent(safeEvents, view.hub, null);
      add({
        key: `HUB:${view.hub}`,
        severity: hubSeverity,
        hub: view.hub,
        state: view.overall,
        code: null,
        title: "HUB health ต้องตรวจสอบ",
        evidence: `Current HUB health · ${view.overall}`,
        observedAt: event?.at || view.lastSuccessAt || null,
        actionKind: "MANUAL_HUB_REVIEW",
        nextStep: `ตรวจ Source Health, connector/session และ last success ของ ${view.hub} จาก shared evidence เดิม; ไม่มีหลักฐานห้ามเดา`,
      });
    }
  }

  const rank = { ERROR: 0, WARN: 1 };
  incidents.sort((left, right) => (rank[left.severity] ?? 9) - (rank[right.severity] ?? 9) || left.hub.localeCompare(right.hub) || String(left.source || "").localeCompare(String(right.source || "")));
  actions.sort((left, right) => (rank[left.severity] ?? 9) - (rank[right.severity] ?? 9) || left.hub.localeCompare(right.hub));
  const recentAlerts = safeEvents.filter((event) => ["WARN", "ERROR"].includes(event.level)).length;
  const incomplete = views.some((view) => view.overall === "UNKNOWN" || Object.values(view.sources || {}).some((source) =>
    source?.configured !== false && source?.mode !== "CLICK_ONLY" && source?.state === "UNKNOWN"));
  const availability = views.length ? "AVAILABLE" : "UNAVAILABLE";
  const state = availability !== "AVAILABLE"
    ? "UNKNOWN"
    : incidents.some((incident) => incident.severity === "ERROR")
      ? "ERROR"
      : incidents.length || incomplete
        ? "PARTIAL"
        : "HEALTHY";
  return {
    availability,
    state,
    openCount: incidents.length,
    pendingActionCount: actions.length,
    recentAlerts: eventAvailability === "AVAILABLE" ? recentAlerts : null,
    incidents,
    actions,
    actionExecution: "DISABLED_OBSERVE_ONLY",
  };
}
// SUPERVISOR_INCIDENT_ACTION_RENDER_V1

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

// SUPERVISOR_QUOTA_CENTER_V1: pure derivation from SUP-10 sanitized shared
// telemetry only. Isolate-local counters are never promoted to provider billing,
// account quota, monthly totals, or plan limits, and no cross-isolate totals are made.
function quotaCenterCounter(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function quotaCenterTime(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function deriveQuotaCenter(raw) {
  const unknown = {
    availability: "UNKNOWN",
    mode: "PIGGYBACK_ISOLATE_COUNTERS",
    billingTruth: "UNKNOWN",
    providerPlanLimit: "UNKNOWN",
    observedAt: null,
    coverage: { observedHubs: null, quotaObservedHubs: 0 },
    hubs: [],
  };
  if (!raw || typeof raw !== "object" || raw.mode !== "PIGGYBACK_ISOLATE_COUNTERS") return unknown;

  const observedHubs = quotaCenterCounter(raw.coverage?.observedHubs);
  const declaredQuotaHubs = quotaCenterCounter(raw.coverage?.quotaObservedHubs);
  const hubs = [];
  for (const item of (Array.isArray(raw.hubs) ? raw.hubs : []).slice(0, 50)) {
    if (!item || typeof item !== "object") continue;
    const hub = String(item.hub || "").toUpperCase();
    if (!/^[A-Z0-9_-]{2,20}$/.test(hub) || item.scope !== "current-worker-isolate") continue;
    const counters = {
      httpRequests: quotaCenterCounter(item.httpRequests),
      statements: quotaCenterCounter(item.statements),
      rowsRead: quotaCenterCounter(item.rowsRead),
      rowsWritten: quotaCenterCounter(item.rowsWritten),
      errors: quotaCenterCounter(item.errors),
      providerLimitErrors: quotaCenterCounter(item.providerLimitErrors),
      heavyReadEvents: quotaCenterCounter(item.heavyReadEvents),
    };
    const providerReadCircuitOpen = typeof item.providerReadCircuitOpen === "boolean" ? item.providerReadCircuitOpen : null;
    const observedAt = quotaCenterTime(item.observedAt);
    const since = quotaCenterTime(item.since);
    const lastObservedAt = quotaCenterTime(item.lastObservedAt);
    const hasEvidence = Object.values(counters).some((value) => value !== null) || providerReadCircuitOpen !== null || Boolean(observedAt || since || lastObservedAt);
    if (!hasEvidence) continue;
    const complete = Object.values(counters).every((value) => value !== null) && providerReadCircuitOpen !== null;
    hubs.push({
      hub,
      state: item.state === "AVAILABLE" && complete ? "AVAILABLE" : "PARTIAL",
      scope: "current-worker-isolate",
      observedAt,
      since,
      ...counters,
      providerReadCircuitOpen,
      lastObservedAt,
    });
  }

  let availability = ["AVAILABLE", "PARTIAL", "UNKNOWN", "UNAVAILABLE"].includes(raw.availability) ? raw.availability : "UNKNOWN";
  if (!hubs.length) availability = raw.availability === "UNAVAILABLE" ? "UNAVAILABLE" : "UNKNOWN";
  else {
    const coverageMismatch = declaredQuotaHubs === null || declaredQuotaHubs !== hubs.length || (observedHubs !== null && observedHubs < hubs.length);
    if (availability !== "AVAILABLE" || coverageMismatch || hubs.some((item) => item.state !== "AVAILABLE")) availability = "PARTIAL";
  }

  return {
    availability,
    mode: "PIGGYBACK_ISOLATE_COUNTERS",
    billingTruth: "UNKNOWN",
    providerPlanLimit: "UNKNOWN",
    observedAt: quotaCenterTime(raw.observedAt),
    coverage: { observedHubs, quotaObservedHubs: hubs.length },
    hubs,
  };
}

// SUPERVISOR_QUOTA_CENTER_RENDER_V1
function quotaCenterValue(value) {
  return value === null || value === undefined ? "UNKNOWN" : String(value);
}

function quotaCenterStatusClass(state) {
  if (state === "AVAILABLE") return "healthy";
  if (state === "PARTIAL") return "partial";
  if (state === "UNAVAILABLE") return "unavailable";
  return "unknown";
}

function renderQuotaCenter(center) {
  const panel = document.querySelector('[data-panel="quota"]');
  const surface = panel?.querySelector(".surface");
  const stateTag = document.getElementById("quota-center-state");
  const summary = document.getElementById("quota-center-summary");
  const hubList = document.getElementById("quota-hub-list");
  if (!surface || !stateTag || !summary || !hubList) return;

  stateTag.textContent = center.availability;
  stateTag.className = `status-tag ${quotaCenterStatusClass(center.availability)}`;
  summary.replaceChildren();
  const summaryList = document.createElement("dl");
  summaryList.className = "hub-facts";
  const fields = [
    ["Evidence mode", center.mode],
    ["Observed HUB coverage", center.coverage.observedHubs === null ? `${center.coverage.quotaObservedHubs} / UNKNOWN` : `${center.coverage.quotaObservedHubs} / ${center.coverage.observedHubs}`],
    ["Provider billing truth", center.billingTruth],
    ["Provider plan / limit", center.providerPlanLimit],
    ["Latest observation", center.observedAt || "UNKNOWN"],
  ];
  for (const [label, value] of fields) {
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value;
    row.append(dt, dd);
    summaryList.append(row);
  }
  summary.append(summaryList);

  hubList.replaceChildren();
  if (!center.hubs.length) {
    const empty = document.createElement("div");
    empty.className = "truth-empty compact";
    const strong = document.createElement("strong");
    const text = document.createElement("p");
    strong.textContent = center.availability === "UNAVAILABLE" ? "Quota telemetry UNAVAILABLE" : "Quota telemetry UNKNOWN";
    text.textContent = "ไม่มี isolate-local evidence ที่ตรวจสอบได้ จึงไม่สร้างค่า 0 และไม่เดา provider usage";
    empty.append(strong, text);
    hubList.append(empty);
    return;
  }

  for (const item of center.hubs) {
    const card = document.createElement("article");
    card.className = "hub-health-card";
    const head = document.createElement("div");
    head.className = "hub-health-head";
    const title = document.createElement("strong");
    title.textContent = `${item.hub} · isolate observation`;
    head.append(title, statusTag(item.state === "AVAILABLE" ? "HEALTHY" : "PARTIAL"));
    const counters = document.createElement("p");
    counters.textContent = `HTTP ${quotaCenterValue(item.httpRequests)} · statements ${quotaCenterValue(item.statements)} · rows read ${quotaCenterValue(item.rowsRead)} · rows written ${quotaCenterValue(item.rowsWritten)}`;
    const guard = document.createElement("p");
    guard.textContent = `errors ${quotaCenterValue(item.errors)} · provider-limit errors ${quotaCenterValue(item.providerLimitErrors)} · heavy reads ${quotaCenterValue(item.heavyReadEvents)} · read circuit ${item.providerReadCircuitOpen === null ? "UNKNOWN" : item.providerReadCircuitOpen ? "OPEN" : "CLOSED"}`;
    const time = document.createElement("p");
    time.textContent = `since ${item.since || "UNKNOWN"} · observed ${item.observedAt || item.lastObservedAt || "UNKNOWN"}`;
    const note = document.createElement("p");
    note.className = "truth-note";
    note.textContent = "FACT: current Worker isolate only · ไม่ใช่ provider billing/account/monthly total และไม่รวม counter ข้าม isolate เป็นยอดรวม";
    card.append(head, counters, guard, time, note);
    hubList.append(card);
  }
}

function renderIncidentActionCenter(center) {
  const panel = document.querySelector('[data-panel="incidents"]');
  const surfaces = [...(panel?.querySelectorAll(".surface") || [])];
  const incidentSurface = surfaces[0];
  const actionSurface = surfaces[1];
  if (!incidentSurface || !actionSurface) return;

  const replaceStatus = (surface, text, state) => {
    const tag = surface.querySelector(".status-tag");
    if (!tag) return;
    tag.textContent = text;
    tag.className = `status-tag ${state.toLowerCase()}`;
  };
  const replaceBody = (surface, kind, items, emptyTitle, emptyText, renderer) => {
    surface.querySelector(".truth-empty")?.remove();
    surface.querySelector(`[data-${kind}-list]`)?.remove();
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "truth-empty compact";
      const strong = document.createElement("strong");
      const text = document.createElement("p");
      strong.textContent = emptyTitle;
      text.textContent = emptyText;
      empty.append(strong, text);
      surface.append(empty);
      return;
    }
    const list = document.createElement("div");
    list.dataset[`${kind}List`] = "1";
    list.className = "hub-health-grid";
    for (const item of items) list.append(renderer(item));
    surface.append(list);
  };

  const unavailable = center.availability !== "AVAILABLE";
  replaceStatus(incidentSurface, unavailable ? "UNKNOWN" : center.openCount ? center.state : center.state === "HEALTHY" ? "CLEAR" : center.state, center.state);
  replaceStatus(actionSurface, unavailable ? "UNKNOWN" : center.pendingActionCount ? center.state : center.state === "HEALTHY" ? "NONE" : center.state, center.state);

  replaceBody(
    incidentSurface,
    "incident",
    center.incidents,
    unavailable ? "UNKNOWN" : center.state === "HEALTHY" ? "ไม่พบ incident ที่ยังเปิดอยู่" : "ยังไม่มี incident ที่ยืนยันได้",
    unavailable
      ? "ไม่มี current HUB evidence เพียงพอ; event history อย่างเดียวไม่ถูกใช้เพื่อเดาว่า incident ยังเปิดอยู่"
      : center.state === "HEALTHY"
        ? `ไม่พบ current problem ใน HUB ที่สังเกตได้ · recent WARN/ERROR ใน ring ${center.recentAlerts ?? "UNKNOWN"} · ไม่ได้หมายความว่าระบบที่ไม่มีหลักฐานเป็น HEALTHY`
        : "หลักฐานยังไม่ครบ จึงไม่สรุปว่า CLEAR",
    (incident) => {
      const card = document.createElement("article");
      card.className = "hub-health-card";
      const head = document.createElement("div");
      head.className = "hub-health-head";
      const title = document.createElement("strong");
      title.textContent = `${incident.hub}${incident.source ? ` / ${incident.source}` : ""} · ${incident.title}`;
      head.append(title, statusTag(incident.severity === "ERROR" ? "ERROR" : "PARTIAL"));
      const evidence = document.createElement("p");
      evidence.textContent = `Evidence: ${incident.evidence}${incident.observedAt ? ` · ${incident.observedAt}` : " · time UNKNOWN"}`;
      const note = document.createElement("p");
      note.className = "truth-note";
      note.textContent = `OPEN จาก current shared state · key ${incident.key} · event ring เป็นหลักฐานประกอบ ไม่ใช่ persistent incident store`;
      card.append(head, evidence, note);
      return card;
    },
  );

  replaceBody(
    actionSurface,
    "action",
    center.actions,
    unavailable ? "UNKNOWN" : center.state === "HEALTHY" ? "ไม่มี pending manual action" : "ยังไม่มี action ที่ยืนยันได้",
    unavailable
      ? "ไม่มี current incident truth จึงไม่สร้าง action จำลอง"
      : center.state === "HEALTHY"
        ? "OBSERVE ONLY · ไม่มี repair execution และไม่มี mutation endpoint จาก SUP-09"
        : "หลักฐานไม่พอสำหรับ action ที่ปลอดภัย; ไม่มีการเดา",
    (action) => {
      const card = document.createElement("article");
      card.className = "hub-health-card";
      const head = document.createElement("div");
      head.className = "hub-health-head";
      const title = document.createElement("strong");
      title.textContent = `${action.hub}${action.source ? ` / ${action.source}` : ""} · ${action.title}`;
      head.append(title, statusTag(action.severity === "ERROR" ? "ERROR" : "PARTIAL"));
      const text = document.createElement("p");
      text.textContent = action.nextStep;
      const note = document.createElement("p");
      note.className = "truth-note";
      note.textContent = `${action.kind} · ${action.mode} · execution=${action.canExecute ? "ENABLED" : "DISABLED"}`;
      card.append(head, text, note);
      return card;
    },
  );
}

function renderSnapshot(snapshot, workerReachable = false) {
  const context = snapshot?.modules || {};
  const [module] = moduleRegistry.evaluate(context);
  const waitingTrucks = context.waitingTrucks || {};
  const hubs = Array.isArray(waitingTrucks.hubs) ? waitingTrucks.hubs : [];
  const nowMs = Date.now();
  const hubViews = hubs.map((hub) => deriveHubView(hub, nowMs));
  const eventConsole = normalizeTerminalConsole(snapshot);
  const incidentCenter = deriveIncidentActionCenter(hubViews, eventConsole.events, eventConsole.availability);
  const quotaCenter = deriveQuotaCenter(snapshot?.quotaTelemetry);
  const overview = deriveOverview(snapshot, module, { moduleCount: moduleRegistry.list().length, workerReachable, nowMs });
  const incidentCard = overview.cards.find((item) => item.id === "incidents");
  const actionCard = overview.cards.find((item) => item.id === "actions");
  if (incidentCard) {
    incidentCard.value = incidentCenter.availability === "AVAILABLE" ? String(incidentCenter.openCount) : "UNKNOWN";
    incidentCard.status = incidentCenter.state;
    incidentCard.detail = incidentCenter.availability === "AVAILABLE"
      ? `current open เท่านั้น · recent ring alerts ${incidentCenter.recentAlerts ?? "UNKNOWN"}`
      : "ไม่มี current HUB evidence จึงไม่เดา incident";
  }
  if (actionCard) {
    actionCard.value = incidentCenter.availability === "AVAILABLE" ? String(incidentCenter.pendingActionCount) : "UNKNOWN";
    actionCard.status = incidentCenter.state;
    actionCard.detail = "MANUAL / OBSERVE ONLY · execution disabled";
  }

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
  renderQuotaCenter(quotaCenter);
  renderIncidentActionCenter(incidentCenter);
  const sourceSummary = document.getElementById("source-snapshot-summary");
  sourceSummary.replaceChildren();
  const sourceState = document.createElement("strong");
  const sourceDetail = document.createElement("p");
  sourceState.textContent = overview.map.sources;
  if (hubs.length) {
    const sources = hubViews.flatMap((view) => Object.values(view.sources));
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