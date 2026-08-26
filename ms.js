const CONFIG = {
  apiUrl: "https://script.google.com/macros/s/AKfycbxE2-_8h6EzOQQ3FeDwFxNIAn4U40pacvRnp3XeOGevXDzhw15bgDi74LVgtozfjgiHXQ/exec",
  pollMs: 30000,
  staleMs: 90000
};

const AUTH_KEY = "bnak_operator_auth_v2";
const state = { rows: [], auth: loadAuth(), query: "", attendance: "all", route: "all", status: "all", loading: false };
const el = id => document.getElementById(id);
const nf = new Intl.NumberFormat("th-TH");
const dtf = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", hour12: false });

document.addEventListener("DOMContentLoaded", () => {
  el("refresh-btn").onclick = () => loadData();
  el("login-btn").onclick = () => el("login-dialog").showModal();
  el("login-close").onclick = () => closeLogin();
  el("login-form").onsubmit = login;
  el("logout-btn").onclick = logout;
  el("search-input").oninput = event => { state.query = event.target.value.trim().toLowerCase(); render(); };
  el("attendance-filter").onchange = event => { state.attendance = event.target.value; render(); };
  el("route-filter").onchange = event => { state.route = event.target.value; render(); };
  el("status-filter").onchange = event => { state.status = event.target.value; render(); };
  setInterval(clock, 1000);
  setInterval(() => state.auth && loadData(true), CONFIG.pollMs);
  setInterval(renderFreshness, 10000);
  clock();
  authUi();
  loadData();
});

function loadAuth() {
  try {
    const auth = JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
    if (auth?.token && Number(auth.expiresAt) > Date.now()) return auth;
  } catch {}
  localStorage.removeItem(AUTH_KEY);
  return null;
}

function clock() {
  el("live-clock").textContent = `เวลารายงานแบบเรียลไทม์ · ${dtf.format(new Date())} น.`;
}

function authUi() {
  const on = Boolean(state.auth);
  const branches = state.auth?.branches || [];
  const code = !on ? "HUB" : state.auth.role === "admin" ? "ADMIN" : branches.length === 1 ? branches[0] : "MULTI";
  el("site-code").textContent = code;
  el("site-title").textContent = `ติดตามเส้นทาง MS${branches.length === 1 ? ` · ${branches[0]}` : ""}`;
  el("login-btn").classList.toggle("hidden", on);
  el("logout-btn").classList.toggle("hidden", !on);
  if (on) el("logout-btn").textContent = `ออกจากระบบ ${state.auth.username}`;
}

async function login(event) {
  event.preventDefault();
  const username = el("username-input").value.trim().toUpperCase();
  const pin = el("pin-input").value;
  try {
    const result = await apiPost("login", { username, pin }, false);
    state.auth = { username: result.username, role: result.role, branches: result.branches || [], token: result.token, expiresAt: Number(result.expiresAt) };
    localStorage.setItem(AUTH_KEY, JSON.stringify(state.auth));
    el("pin-input").value = "";
    el("login-error").classList.add("hidden");
    el("login-dialog").close();
    authUi();
    await loadData();
    toast("เข้าสู่ระบบแล้ว");
  } catch (error) {
    el("login-error").textContent = error.message;
    el("login-error").classList.remove("hidden");
  }
}

function closeLogin() {
  el("pin-input").value = "";
  el("login-error").classList.add("hidden");
  el("login-dialog").close();
}

function logout() {
  state.auth = null;
  state.rows = [];
  localStorage.removeItem(AUTH_KEY);
  authUi();
  render();
}

function invalidateSession() {
  state.auth = null;
  state.rows = [];
  localStorage.removeItem(AUTH_KEY);
  authUi();
  empty("สิทธิ์หมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง");
}

async function loadData(silent = false) {
  if (!state.auth) {
    connection(false);
    empty("กรุณาเข้าสู่ระบบเพื่อดูข้อมูลเส้นทาง MS");
    return;
  }
  if (state.loading) return;
  state.loading = true;
  if (!silent) el("loading-state").classList.remove("hidden");
  try {
    const result = await apiGet("msRoutes");
    state.rows = Array.isArray(result?.rows) ? result.rows : [];
    state.lastSync = result?.lastSync || "";
    fillFilters();
    connection(true);
    el("last-refresh").textContent = `โหลดหน้าจอล่าสุด ${dtf.format(new Date())} น. · รีเฟรชอัตโนมัติทุก 30 วินาที`;
    render();
  } catch (error) {
    connection(false);
    if (!silent) empty(`โหลดข้อมูลไม่สำเร็จ: ${error.message}`);
  } finally {
    state.loading = false;
  }
}

function fillFilters() {
  state.attendance = setOptions("attendance-filter", state.rows.map(row => row.attendanceType), state.attendance);
  state.route = setOptions("route-filter", state.rows.map(row => row.routeType), state.route);
}

function setOptions(id, values, selected) {
  const unique = [...new Set(values.map(value => String(value || "").trim()).filter(Boolean))].sort();
  el(id).innerHTML = '<option value="all">ทั้งหมด</option>' + unique.map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join("");
  const next = unique.includes(selected) ? selected : "all";
  el(id).value = next;
  return next;
}

function routeState(row, now = new Date()) {
  const eta = parseDate(row.estimatedArrivalAt);
  const arrival = parseDate(row.actualArrivalAt);
  const etd = parseDate(row.estimatedDepartureAt);
  const departure = parseDate(row.actualDepartureAt);
  const arrivalLate = Boolean(arrival ? eta && arrival > eta : eta && now > eta);
  const departureLate = Boolean(!departure && arrival && etd && now > etd);
  if (departure) return { key: "departed", label: "ออกจากสาขาแล้ว", color: "#167044", arrivalLate, departureLate: false };
  if (arrival) return { key: "arrived", label: "มาถึงแล้ว", color: departureLate ? "#b3261e" : "#2563eb", arrivalLate, departureLate };
  return { key: "not-arrived", label: "ยังมาไม่ถึง", color: arrivalLate ? "#b3261e" : "#697177", arrivalLate, departureLate: false };
}

function filteredRows() {
  return state.rows.filter(row => {
    const status = routeState(row);
    const text = [row.proofId, row.routeName, row.vehicleType, row.plate, row.driverName, row.supplier].join(" ").toLowerCase();
    const statusMatch = state.status === "all" || status.key === state.status || (state.status === "arrival-late" && status.arrivalLate) || (state.status === "departure-late" && status.departureLate);
    return (!state.query || text.includes(state.query)) && (state.attendance === "all" || row.attendanceType === state.attendance) && (state.route === "all" || row.routeType === state.route) && statusMatch;
  }).sort((a, b) => (parseDate(a.estimatedArrivalAt)?.getTime() || 0) - (parseDate(b.estimatedArrivalAt)?.getTime() || 0));
}

function render() {
  el("loading-state").classList.add("hidden");
  metrics();
  renderFreshness();
  const rows = filteredRows();
  if (!rows.length) {
    empty(state.rows.length ? "ไม่พบข้อมูลตามตัวกรอง" : "ยังไม่มีข้อมูลจากตัวเชื่อม MS");
    return;
  }
  el("empty-state").classList.add("hidden");
  el("desktop-table").classList.remove("hidden");
  el("mobile-cards").classList.remove("hidden");
  el("table-body").innerHTML = rows.map(tableRow).join("");
  el("mobile-cards").innerHTML = rows.map(card).join("");
}

function metrics() {
  const statuses = state.rows.map(routeState);
  setMetric("metric-total", state.rows.length);
  setMetric("metric-not-arrived", statuses.filter(item => item.key === "not-arrived").length);
  setMetric("metric-arrived", statuses.filter(item => item.key === "arrived").length);
  setMetric("metric-departed", statuses.filter(item => item.key === "departed").length);
  setMetric("metric-arrival-late", statuses.filter(item => item.arrivalLate).length);
  setMetric("metric-departure-late", statuses.filter(item => item.departureLate).length);
}

function setMetric(id, value) { el(id).textContent = nf.format(value); }

function tableRow(row) {
  const status = routeState(row);
  return `<tr><td><div class="vehicle-line"><strong>${esc(row.proofId || "-")}</strong><strong class="vehicle-type">${esc(row.vehicleType || "-")}</strong></div><div class="secondary">${esc(row.plate || "-")}</div></td><td><div class="primary ms-route-name">${esc(row.routeName || "-")}</div><div class="secondary">${esc([row.routeAttribute, row.routeType, row.region].filter(Boolean).join(" · ") || "-")}</div></td><td><div class="primary">${esc(row.attendanceType || "-")}</div><div class="secondary">${esc(row.supplier || "-")}</div></td><td>${timePair(row.estimatedArrivalAt, row.actualArrivalAt)}</td><td>${timePair(row.estimatedDepartureAt, row.actualDepartureAt)}</td><td><div class="ms-status"><span class="status-pill" style="--status-color:${status.color}">${status.label}</span>${status.arrivalLate ? '<small>ถึงช้ากว่า ETA</small>' : ""}${status.departureLate ? '<small>รอออกเกินกำหนด</small>' : ""}</div></td><td><div class="primary">${esc(row.loadStatus || "-")}</div><div class="secondary">${esc(row.trackingStatus || "-")}</div></td></tr>`;
}

function card(row) {
  const status = routeState(row);
  const phone = state.auth?.role === "admin" && row.driverPhone ? ` · ${esc(row.driverPhone)}` : "";
  return `<article class="truck-card ms-card" style="--card-accent:${status.color}"><div class="truck-card-head"><div class="truck-route"><div class="primary">${esc(row.routeName || "-")}</div><div class="secondary">${esc([row.routeAttribute, row.routeType, row.attendanceType].filter(Boolean).join(" · ") || "-")}</div></div><div class="truck-status"><span class="status-pill" style="--status-color:${status.color}">${status.label}</span></div></div><div class="ms-card-grid"><div><span>บาร์โค้ด / ประเภทรถ</span><strong>${esc(row.proofId || "-")} / ${esc(row.vehicleType || "-")}</strong></div><div><span>ทะเบียนรถ</span><strong>${esc(row.plate || "-")}</strong></div><div><span>เวลาถึง (คาด / จริง)</span><strong>${shortTime(row.estimatedArrivalAt)} / ${shortTime(row.actualArrivalAt)}</strong></div><div><span>เวลาออก (คาด / จริง)</span><strong>${shortTime(row.estimatedDepartureAt)} / ${shortTime(row.actualDepartureAt)}</strong></div><div><span>คนขับ</span><strong>${esc(row.driverName || "-")}${phone}</strong></div><div><span>สถานะโหลด</span><strong>${esc(row.loadStatus || "-")}</strong></div></div>${status.arrivalLate || status.departureLate ? `<div class="secondary">${status.arrivalLate ? "ถึงช้ากว่า ETA" : ""}${status.arrivalLate && status.departureLate ? " · " : ""}${status.departureLate ? "รอออกเกินกำหนด" : ""}</div>` : ""}</article>`;
}

function timePair(expected, actual) {
  return `<div class="ms-time-stack"><span>คาด ${shortDateTime(expected)}</span><strong>จริง ${shortDateTime(actual)}</strong></div>`;
}

function shortDateTime(value) { const date = parseDate(value); return date ? `${dtf.format(date)} น.` : "-"; }
function shortTime(value) { const date = parseDate(value); return date ? date.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", hour12: false }) : "-"; }
function parseDate(value) { if (!value) return null; const date = new Date(value); return isNaN(date) ? null : date; }

function renderFreshness() {
  const synced = parseDate(state.lastSync);
  const stale = !synced || Date.now() - synced.getTime() > CONFIG.staleMs;
  el("live-dot").classList.toggle("stale", stale);
  el("source-sync").textContent = synced ? `ข้อมูล MS ล่าสุด ${dtf.format(synced)} น.${stale ? " · ตัวเชื่อมยังไม่อัปเดต" : ""}` : "ยังไม่มีข้อมูลจากตัวเชื่อม MS";
}

function connection(ok) {
  const badge = el("connection-badge");
  badge.textContent = ok ? "ออนไลน์" : "เชื่อมต่อไม่ได้";
  badge.className = `badge ${ok ? "badge-online" : "badge-offline"}`;
}

function empty(message) {
  el("loading-state").classList.add("hidden");
  el("desktop-table").classList.add("hidden");
  el("mobile-cards").classList.add("hidden");
  el("empty-state").classList.remove("hidden");
  el("empty-state").innerHTML = `<strong>${esc(message)}</strong><span>ตัวเชื่อมจะส่งข้อมูลใหม่ทุก 30 วินาทีเมื่อหน้า MS เปิดและเข้าสู่ระบบอยู่</span>`;
}

async function apiGet(action) {
  const url = new URL(CONFIG.apiUrl);
  url.searchParams.set("action", action);
  url.searchParams.set("token", state.auth?.token || "");
  const json = await (await fetch(url, { cache: "no-store" })).json();
  if (json.ok === false) {
    const error = new Error(json.message);
    error.code = json.code || "SERVER_ERROR";
    if (error.code === "INVALID_SESSION") invalidateSession();
    throw error;
  }
  return json.data ?? json;
}

async function apiPost(action, payload = {}, withAuth = true) {
  const body = { action, ...payload };
  if (withAuth) body.token = state.auth?.token || "";
  const json = await (await fetch(CONFIG.apiUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) })).json();
  if (json.ok === false) throw new Error(json.message);
  return json.data ?? json;
}

const esc = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
let toastTimer;
function toast(message, error = false) { clearTimeout(toastTimer); el("toast").textContent = message; el("toast").style.background = error ? "var(--red)" : "var(--navy)"; el("toast").classList.remove("hidden"); toastTimer = setTimeout(() => el("toast").classList.add("hidden"), 4000); }
