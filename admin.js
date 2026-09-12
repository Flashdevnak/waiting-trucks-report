// ADMIN_STANDALONE_V1: manual refresh only. This page has no interval, WebSocket,
// background source call or per-widget polling loop.
const API_URL = location.hostname.endsWith(".workers.dev")
  ? `${location.origin}/api`
  : "https://waiting-trucks-report-api-dev.26nak-testdev.workers.dev/api";
const AUTH_KEY = "bnak_operator_auth_v2";
const SOURCE_STALE_MS = 20 * 60 * 1000;
const state = { auth: null, overview: null, settings: null, branch: "", busy: false };
const el = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

// ADMIN_CANONICAL_HUB_V1: defense-in-depth for Admin. Backend is authoritative,
// but the UI also refuses technical keys/full labels instead of displaying or guessing them.
function canonicalAdminHubCode(value) {
  const hub = String(value ?? "").trim().toUpperCase();
  return /^(?=.*[A-Z])[A-Z0-9]{2,12}$/.test(hub) ? hub : "";
}
function adminHubs() {
  const seen = new Set(), result = [];
  for (const item of state.overview?.hubs || []) {
    const hub = canonicalAdminHubCode(item?.hub);
    if (!hub || seen.has(hub)) continue;
    seen.add(hub);
    result.push({ ...item, hub });
  }
  return result;
}

function readAuth() {
  try {
    const auth = JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
    return auth?.token && (!auth.expiresAt || Date.now() <= Number(auth.expiresAt)) ? auth : null;
  } catch { return null; }
}
async function request(action, { method = "GET", payload = {}, auth = true } = {}) {
  const token = auth ? state.auth?.token || "" : "";
  let response;
  if (method === "POST") {
    response = await fetch(API_URL, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload, ...(auth ? { token } : {}) }), cache: "no-store" });
  } else {
    const url = new URL(API_URL); url.searchParams.set("action", action); if (auth) url.searchParams.set("token", token);
    for (const [key, value] of Object.entries(payload)) if (value !== undefined && value !== null) url.searchParams.set(key, value);
    response = await fetch(url, { cache: "no-store" });
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    const error = new Error(body?.message || `โหลดข้อมูลไม่สำเร็จ (${response.status})`);
    error.code = body?.code || "API_ERROR"; error.status = response.status; throw error;
  }
  return body.data;
}
function toast(message, error = false) {
  const node = el("toast"); node.textContent = message; node.style.background = error ? "#8f211b" : "#171717"; node.classList.remove("hidden");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.add("hidden"), 4200);
}
function showGate(message, { login = false, error = "", back = false } = {}) {
  el("gate").classList.remove("hidden"); el("admin-app").classList.add("hidden");
  el("gate-copy").querySelector("h1").textContent = message;
  el("login-form").classList.toggle("hidden", !login); el("back-link").classList.toggle("hidden", !back);
  el("gate-error").textContent = error; el("gate-error").classList.toggle("hidden", !error);
}
function fmt(value) { if (!value) return "ไม่มีข้อมูล"; const time = Date.parse(value); return Number.isFinite(time) ? new Intl.DateTimeFormat("th-TH", { dateStyle: "short", timeStyle: "medium", timeZone: "Asia/Bangkok", hour12: false }).format(new Date(time)) : String(value); }
function age(value) { const time = Date.parse(value || ""); if (!Number.isFinite(time)) return "ไม่มีข้อมูล"; const min = Math.max(0, Math.round((Date.now() - time) / 60000)); return min < 60 ? `${min} นาที` : `${Math.floor(min / 60)} ชม. ${min % 60} นาที`; }
function sourceState(source, hbi = false) {
  if (!source?.configured) return { key: "none", label: "ยังไม่ได้ตั้งค่า" };
  if (source.lastError) return { key: "bad", label: "ต้องตรวจ Session" };
  if (hbi && source.sessionState === "expired") return { key: "bad", label: "Session หมดอายุ" };
  if (hbi && !source.lastCheckedAt) return { key: "warn", label: "ยังไม่มีผลตรวจล่าสุด" };
  if (!source.lastSuccessAt && !hbi) return { key: "warn", label: "รอข้อมูลสำเร็จ" };
  if (!hbi) { const lastSuccess = Date.parse(source.lastSuccessAt); if (!Number.isFinite(lastSuccess) || Date.now() - lastSuccess > SOURCE_STALE_MS) return { key: "warn", label: "ข้อมูลไม่สด" }; }
  return { key: "ok", label: hbi ? "ตั้งค่าแล้ว" : "ปกติ" };
}
function allSources(hub) { return [hub.routes, hub.preEntry, hub.busTime, hub.hbiPhotos]; }
function renderSummary() {
  const hubs = adminHubs(), sources = hubs.flatMap(allSources).filter((x) => x?.configured);
  const normal = sources.filter((x) => sourceState(x, x.source === "hbiPhotos").key === "ok").length;
  const warning = sources.filter((x) => ["bad", "warn"].includes(sourceState(x, x.source === "hbiPhotos").key)).length;
  const reconnect = sources.filter((x) => sourceState(x, x.source === "hbiPhotos").key === "bad").length;
  const quota = state.overview.quota?.anomalyState === "warning" ? "Warning" : state.overview.quota?.anomalyState === "normal" ? "ปกติ" : "ไม่มีข้อมูล";
  const cards = [["HUB ทั้งหมด", hubs.length, "จาก contract ที่ตั้งค่า/มีข้อมูล"], ["Source ปกติ", normal, "ตามสถานะล่าสุดที่มี"], ["Source ต้องต่อ Session", reconnect, "มี error/expired ที่ยืนยันได้"], ["Warning", warning, "รวมสถานะที่ควรตรวจ"], ["Quota health", quota, "ไม่เดาตัวเลขเมื่อไม่มี usage"]];
  el("summary-cards").innerHTML = cards.map(([label, value, note]) => `<article class="card summary-card"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></article>`).join("");
}
function sourceCell(source, hbi = false) { const status = sourceState(source, hbi); return `<span class="status ${status.key}">${esc(status.label)}</span><small>${esc(source?.lastSuccessAt ? age(source.lastSuccessAt) : source?.updatedAt ? `ตั้งค่า ${age(source.updatedAt)}ก่อน` : "ไม่มีข้อมูล")}</small>`; }
function renderHubOverview() {
  el("hub-overview").innerHTML = adminHubs().map((hub) => `<article class="hub-row" data-hub="${esc(hub.hub)}"><strong>${esc(hub.hub)}</strong><div><b>Route</b>${sourceCell(hub.routes)}</div><div><b>FBI</b>${sourceCell(hub.preEntry)}</div><div><b>KIT/TBR</b>${sourceCell(hub.busTime)}</div><div><b>HBI</b>${sourceCell(hub.hbiPhotos, true)}</div></article>`).join("") || '<div class="card">ไม่พบ HUB ที่ตั้งค่าไว้</div>';
}
function selectedHub() { return adminHubs().find((hub) => hub.hub === state.branch); }
function renderSources() {
  const hub = selectedHub(); el("source-title").textContent = `สถานะแหล่งข้อมูล ${state.branch}`;
  if (!hub) { el("source-grid").innerHTML = '<div class="card">ไม่มีข้อมูล HUB นี้</div>'; return; }
  const items = [["Route / MS", hub.routes, false], ["PreEntry / FBI", hub.preEntry, false], ["Bus / KIT / TBR", hub.busTime, false], ["รูปท้ายรถ / HBI", hub.hbiPhotos, true]];
  el("source-grid").innerHTML = items.map(([label, source, hbi]) => { const status = sourceState(source, hbi); return `<article class="card source-card"><h3>${esc(label)}</h3><span class="status ${status.key}">${esc(status.label)}</span><dl><dt>ตั้งค่าล่าสุด</dt><dd>${esc(fmt(source?.updatedAt))}</dd><dt>สำเร็จล่าสุด</dt><dd>${esc(fmt(source?.lastSuccessAt))}</dd><dt>ใช้งานล่าสุด</dt><dd>${esc(fmt(source?.lastUsedAt))}</dd>${source?.source === "routes" ? `<dt>Connector</dt><dd>${source.connectorActive ? "Active" : "ไม่มีข้อมูล/ไม่ Active"}</dd>` : ""}<dt>Freshness</dt><dd>${esc(source?.lastSuccessAt ? age(source.lastSuccessAt) : "ไม่มีข้อมูล")}</dd><dt>ข้อผิดพลาด</dt><dd>${esc(source?.lastError || source?.lastErrorCode || (hbi && !source?.lastCheckedAt ? "ยังไม่มีข้อมูล/ยังไม่ได้กดตรวจรูป" : "ไม่มี"))}</dd></dl></article>`; }).join("");
  const route = sourceState(hub.routes); el("recovery-status").textContent = route.key === "bad" ? "Route มีข้อผิดพลาดล่าสุด ระบบรักษา accepted snapshot เดิมไว้ และต้องตรวจ/ต่อ Session ใหม่จากหน้าการเชื่อมต่อ" : route.key === "ok" ? "Route มีผลสำเร็จล่าสุด ระบบ coordinator ใช้ contract การ reconnect/recovery ร่วมกันทุก HUB" : "ยังไม่มีหลักฐาน Runtime เพียงพอสำหรับยืนยันสถานะ recovery";
}
function renderUsers() {
  const target = el("user-list"); target.innerHTML = "";
  for (const user of state.overview.users || []) addUserRow(user);
}
function addUserRow(user = { username: "", role: "operator", branches: [], active: true }) {
  const row = el("user-template").content.firstElementChild.cloneNode(true), fields = row.elements;
  fields.username.value = user.username || ""; fields.username.readOnly = Boolean(user.username); fields.role.value = user.role || "operator";
  fields.branches.value = Array.isArray(user.branches) ? user.branches.filter((x) => x !== "*").join(", ") : ""; fields.branches.disabled = fields.role.value === "admin"; fields.active.checked = user.active !== false;
  fields.role.addEventListener("change", () => { fields.branches.disabled = fields.role.value === "admin"; });
  row.addEventListener("submit", saveUser); el("user-list").prepend(row);
}
async function saveUser(event) {
  event.preventDefault(); const fields = event.currentTarget.elements;
  const user = { username: fields.username.value.trim().toUpperCase(), role: fields.role.value, branches: fields.branches.value.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean), password: fields.password.value, active: fields.active.checked };
  try { const users = await request("saveUser", { method: "POST", payload: { user } }); state.overview.users = users; renderUsers(); toast(`บันทึกผู้ใช้ ${user.username} แล้ว`); } catch (error) { toast(error.message, true); }
}
function decimalToTime(value) { const n = Number(value) || 0, h = Math.floor(n) % 24, m = Math.round((n - Math.floor(n)) * 60); return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`; }
function timeToDecimal(value) { const [h, m] = String(value || "00:00").split(":").map(Number); return h + (m || 0) / 60; }
function addSetting(kind, item = {}) {
  const target = kind === "pause" ? el("pause-list") : kind === "vehicle" ? el("vehicle-list") : el("ms-vehicle-list");
  const row = document.createElement("div"); row.className = `setting-row ${kind}`;
  row.innerHTML = kind === "pause" ? `<input name="label" aria-label="ชื่อช่วง" value="${esc(item.label || "ช่วงไม่มีกะ")}"><input name="range" type="time" aria-label="เวลาเริ่ม" value="${decimalToTime(item.startHour)}"><input name="end" type="time" aria-label="เวลาสิ้นสุด" value="${decimalToTime(item.endHour ?? 1)}"><button data-remove type="button">ลบ</button>` : `<input name="type" aria-label="ประเภทรถ" placeholder="เช่น 6W" value="${esc(item.type || "")}"><input name="minutes" type="number" min="1" max="1440" aria-label="นาที" value="${Number(item.minutes) || 120}"><button data-remove type="button">ลบ</button>`;
  row.querySelector("[data-remove]").onclick = () => row.remove(); target.appendChild(row);
}
async function loadSettings() {
  if (!state.branch) return; el("standards-title").textContent = `กติกาเฉพาะ ${state.branch}`;
  try { state.settings = await request("settings", { payload: { branch: state.branch } }); renderSettings(); } catch (error) { toast(error.message, true); }
}
function renderSettings() {
  for (const id of ["pause-list", "vehicle-list", "ms-vehicle-list"]) el(id).innerHTML = "";
  for (const item of state.settings?.pauseWindows || []) addSetting("pause", item);
  for (const item of state.settings?.vehicleLimits || []) addSetting("vehicle", item);
  for (const item of state.settings?.msVehicleLimits || []) addSetting("msVehicle", item);
}
async function saveSettings() {
  const pauseWindows = [...document.querySelectorAll(".setting-row.pause")].map((row) => ({ label: row.querySelector('[name="label"]').value.trim(), startHour: timeToDecimal(row.querySelector('[name="range"]').value), endHour: timeToDecimal(row.querySelector('[name="end"]').value) }));
  const readLimits = (selector) => [...document.querySelectorAll(selector)].map((row) => ({ type: row.querySelector('[name="type"]').value.trim().toUpperCase(), minutes: Number(row.querySelector('[name="minutes"]').value) })).filter((x) => x.type);
  try { state.settings = await request("saveSettings", { method: "POST", payload: { branch: state.branch, settings: { pauseWindows, vehicleLimits: readLimits(".setting-row.vehicle"), msVehicleLimits: readLimits(".setting-row.msVehicle") } } }); renderSettings(); toast(`บันทึกกติกา ${state.branch} แล้ว`); } catch (error) { toast(error.message, true); }
}
function renderQuota() {
  const quota = state.overview.quota || {}, protections = quota.protections || {};
  const cards = [["Realtime transport", protections.realtimeTransport], ["Visible cadence", protections.visibleCadenceMs ? `${protections.visibleCadenceMs} ms` : null], ["DB protection", protections.databaseProtection], ["Auth cache/coalesce", protections.authCacheMs ? `${protections.authCacheMs / 1000} วินาที` : null], ["HUB settings cache", protections.hubSettingsCacheMs ? `${protections.hubSettingsCacheMs / 1000} วินาที` : null], ["Connection heartbeat", protections.connectionHeartbeatMs ? `${protections.connectionHeartbeatMs / 60000} นาที` : null], ["Connector heartbeat", protections.connectorHeartbeatMs ? `${protections.connectorHeartbeatMs / 3600000} ชั่วโมง` : null], ["Proof unchanged write", protections.proofUnchangedWrites], ["HBI", protections.hbiMode], ["D1 bindings", quota.d1BindingCount == null ? `ไม่มีข้อมูล (expected ${quota.expectedD1Bindings ?? 0})` : `${quota.d1BindingCount} (expected ${quota.expectedD1Bindings ?? 0})`]];
  el("quota-grid").innerHTML = cards.map(([label, value]) => `<article class="card quota-card"><h3>${esc(label)}</h3><p>${esc(value ?? "ไม่มีข้อมูล/ยังไม่ได้เก็บ")}</p></article>`).join("");
  const runtime = quota.runtime || {}, rows = [["ขอบเขตข้อมูล", runtime.scope], ["เริ่มนับเมื่อ", fmt(runtime.since)], ["Turso HTTP requests", runtime.httpRequests], ["SQL statements", runtime.statements], ["Rows read", runtime.rowsRead], ["Rows written", runtime.rowsWritten], ["Provider-limit errors", runtime.providerLimitErrors], ["Heavy-read guard", runtime.heavyReadEvents], ["Last observed", fmt(runtime.lastObservedAt)], ["Account usage trend", quota.accountUsageTrend], ["Anomaly conclusion", quota.anomalyState]];
  el("runtime-diagnostics").innerHTML = `<table class="diagnostic-table"><tbody>${rows.map(([key, value]) => `<tr><th>${esc(key)}</th><td>${esc(value ?? "ไม่มีข้อมูล/ยังไม่ได้เก็บ")}</td></tr>`).join("")}</tbody></table>`;
}
function renderAll() {
  el("checked-at").textContent = `ตรวจล่าสุด ${fmt(state.overview.checkedAt)}`;
  const hubs = adminHubs(); if (!hubs.some((x) => x.hub === state.branch)) state.branch = hubs[0]?.hub || "";
  el("hub-select").innerHTML = hubs.map((x) => `<option value="${esc(x.hub)}">${esc(x.hub)}</option>`).join(""); el("hub-select").value = state.branch;
  renderSummary(); renderHubOverview(); renderSources(); renderUsers(); renderQuota(); loadSettings();
}
async function loadOverview() {
  if (state.busy) return; state.busy = true; el("refresh-btn").disabled = true;
  try {
    const overview = await request("adminOverview"); state.overview = overview; el("gate").classList.add("hidden"); el("admin-app").classList.remove("hidden"); renderAll();
  } catch (error) {
    if (error.code === "INVALID_SESSION") { localStorage.removeItem(AUTH_KEY); state.auth = null; showGate("เข้าสู่ระบบผู้ดูแล", { login: true, error: "Session หมดอายุ กรุณาเข้าสู่ระบบใหม่" }); }
    else if (error.code === "ADMIN_REQUIRED" || error.code === "FORBIDDEN") showGate("บัญชีนี้ไม่ใช่ผู้ดูแลระบบ", { error: "Worker ปฏิเสธสิทธิ์ Operator สำหรับหน้า Admin", back: true });
    else showGate("เปิดหน้า Admin ไม่สำเร็จ", { error: error.message, back: true });
  } finally { state.busy = false; el("refresh-btn").disabled = false; }
}
async function repairAllHubs() {
  if (state.busy) return;
  const hubs = adminHubs().length;
  if (!hubs || !confirm(`ตรวจและซ่อม Route ของ HUB ที่ตั้งค่าไว้ทั้งหมด ${hubs} HUB ตอนนี้หรือไม่?\n\nระบบจะเรียก source สูงสุดหนึ่งรอบต่อ HUB และไม่แตะ HBI`)) return;
  state.busy = true;
  const button = el("repair-all-btn"), resultBox = el("repair-result");
  button.disabled = true; button.textContent = "กำลังตรวจและซ่อม…";
  try {
    const result = await request("adminRepairAll", { method: "POST" });
    const rows = Array.isArray(result.results) ? result.results : [];
    resultBox.classList.remove("hidden");
    resultBox.innerHTML = `<h3>ผลตรวจและซ่อม ${esc(result.total)} HUB</h3><p><b>ปกติ ${esc(result.healthy)}</b> · ต้องตรวจต่อ ${esc(result.needsAttention)}</p><div class="repair-list">${rows.map((item) => `<span><b>${esc(item.hub)}</b><i class="status ${item.ok ? "ok" : "bad"}">${esc(item.ok ? "ซ่อม/ตรวจสำเร็จ" : item.status || "ผิดปกติ")}</i><small>${esc(item.error || item.repair?.message || "")}</small></span>`).join("")}</div><p class="muted">โหมด ${esc(result.quota?.mode || "manual")} · ไม่ตรวจ HBI เบื้องหลัง · HUB ปกติไม่มีงาน background เพิ่ม</p>`;
    toast(`ตรวจครบ ${result.total} HUB · ปกติ ${result.healthy} · ต้องตรวจต่อ ${result.needsAttention}`, result.needsAttention > 0);
    state.busy = false;
    await loadOverview();
  } catch (error) { toast(error.message, true); }
  finally { state.busy = false; button.disabled = false; button.textContent = "ตรวจและซ่อมทุก HUB ตอนนี้"; }
}
async function login(event) {
  event.preventDefault();
  try {
    state.auth = await request("login", { method: "POST", auth: false, payload: { username: el("login-username").value.trim(), pin: el("login-password").value } });
    localStorage.setItem(AUTH_KEY, JSON.stringify(state.auth)); await loadOverview();
  } catch (error) { showGate("เข้าสู่ระบบผู้ดูแล", { login: true, error: error.message }); }
}
function logout() { localStorage.removeItem(AUTH_KEY); state.auth = null; state.overview = null; showGate("เข้าสู่ระบบผู้ดูแล", { login: true }); }
async function changePassword(event) {
  event.preventDefault(); const currentPassword = el("current-password").value, newPassword = el("new-password").value;
  if (newPassword !== el("confirm-password").value) return toast("ยืนยันรหัสใหม่ไม่ตรงกัน", true);
  try { await request("changePassword", { method: "POST", payload: { currentPassword, newPassword } }); event.currentTarget.reset(); logout(); toast("เปลี่ยนรหัสแล้ว กรุณาเข้าสู่ระบบใหม่"); } catch (error) { toast(error.message, true); }
}
function bind() {
  el("login-form").addEventListener("submit", login); el("logout-btn").addEventListener("click", logout); el("refresh-btn").addEventListener("click", loadOverview); el("repair-all-btn").addEventListener("click", repairAllHubs);
  el("hub-select").addEventListener("change", () => { state.branch = el("hub-select").value; renderSources(); loadSettings(); });
  document.querySelector(".tabs").addEventListener("click", (event) => { const button = event.target.closest("[data-tab]"); if (!button) return; document.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("active", x === button)); document.querySelectorAll("[data-panel]").forEach((x) => x.classList.toggle("hidden", x.dataset.panel !== button.dataset.tab)); });
  el("add-user-btn").addEventListener("click", () => addUserRow()); el("save-standards-btn").addEventListener("click", saveSettings); el("password-form").addEventListener("submit", changePassword);
  document.querySelectorAll("[data-add]").forEach((button) => button.addEventListener("click", () => addSetting(button.dataset.add)));
}
document.addEventListener("DOMContentLoaded", () => { bind(); state.auth = readAuth(); if (!state.auth) showGate("เข้าสู่ระบบผู้ดูแล", { login: true }); else loadOverview(); });
