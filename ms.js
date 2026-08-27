const CONFIG = {
  apiUrl:
    "https://script.google.com/macros/s/AKfycbxE2-_8h6EzOQQ3FeDwFxNIAn4U40pacvRnp3XeOGevXDzhw15bgDi74LVgtozfjgiHXQ/exec",
  pollMs: 30000,
  staleMs: 90000,
};

CONFIG.apiUrl = `${window.location.hostname.endsWith("github.io") ? "https://waiting-trucks-report.alert-squid-6738.chatgpt.site" : window.location.origin}/api`;
const AUTH_KEY = "bnak_operator_auth_v2";
const state = {
  rows: [],
  auth: loadAuth(),
  query: "",
  branch: "NE1",
  date: "",
  attendance: "all",
  attribute: "all",
  region: "all",
  route: "all",
  status: "all",
  queue: "queue",
  standards: {},
  loading: false,
};
const el = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat("th-TH");
const dtf = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "short",
  hour12: false,
});

document.addEventListener("DOMContentLoaded", () => {
  el("refresh-btn").onclick = () => loadData();
  el("ms-connection-btn").onclick = openMsConnection;
  el("ms-connection-close").onclick = () => el("ms-connection-dialog").close();
  el("ms-connection-form").onsubmit = saveMsConnection;
  el("export-current-btn").onclick = exportCurrent;
  el("export-history-btn").onclick = exportHistory;
  el("login-btn").onclick = () => el("login-dialog").showModal();
  el("login-close").onclick = () => closeLogin();
  el("login-form").onsubmit = login;
  el("logout-btn").onclick = logout;
  el("search-input").oninput = (event) => {
    state.query = event.target.value.trim().toLowerCase();
    render();
  };
  el("branch-filter").onchange = (event) => {
    state.branch = event.target.value;
    loadData();
  };
  el("date-filter").onchange = (event) => {
    state.date = event.target.value;
    render();
  };
  el("attribute-filter").onchange = (event) => {
    state.attribute = event.target.value;
    render();
  };
  el("region-filter").onchange = (event) => {
    state.region = event.target.value;
    render();
  };
  el("attendance-filter").onchange = (event) => {
    state.attendance = event.target.value;
    render();
  };
  el("route-filter").onchange = (event) => {
    state.route = event.target.value;
    render();
  };
  el("status-filter").onchange = (event) => {
    state.status = event.target.value;
    render();
  };
  el("queue-filter").onchange = (event) => {
    state.queue = event.target.value;
    render();
  };
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
  el("live-clock").textContent =
    `เวลารายงานแบบเรียลไทม์ · ${dtf.format(new Date())} น.`;
}

function authUi() {
  const on = Boolean(state.auth);
  const branches = state.auth?.branches || [];
  if (on && state.auth.role !== "admin" && !branches.includes(state.branch))
    state.branch = branches[0] || state.branch;
  const code = !on
    ? "HUB"
    : state.auth.role === "admin"
      ? "ADMIN"
      : branches.length === 1
        ? branches[0]
        : "MULTI";
  el("site-code").textContent = code;
  el("site-title").textContent =
    `ติดตามเส้นทาง MS${branches.length === 1 ? ` · ${branches[0]}` : ""}`;
  el("login-btn").classList.toggle("hidden", on);
  el("connect-ms-btn").classList.toggle("hidden", !on);
  el("ms-connection-btn").classList.toggle(
    "hidden",
    !on || state.auth?.role !== "admin",
  );
  el("central-settings-btn").classList.toggle(
    "hidden",
    !on || state.auth?.role !== "admin",
  );
  el("logout-btn").classList.toggle("hidden", !on);
  if (on) el("logout-btn").textContent = `ออกจากระบบ ${state.auth.username}`;
}

async function login(event) {
  event.preventDefault();
  const username = el("username-input").value.trim().toUpperCase();
  const pin = el("pin-input").value;
  try {
    const result = await apiPost("login", { username, pin }, false);
    state.auth = {
      username: result.username,
      role: result.role,
      branches: result.branches || [],
      token: result.token,
      expiresAt: Number(result.expiresAt),
    };
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
    const result = await apiGet("msRoutes", { branch: state.branch });
    state.rows = Array.isArray(result?.rows) ? result.rows : [];
    state.branch = result?.branch || state.branch;
    state.standards = Object.fromEntries(
      (result?.standards || []).map((item) => [
        normalizeVehicle(item.type),
        Number(item.minutes) || 120,
      ]),
    );
    fillBranches(result?.branches || []);
    state.lastSync = result?.lastSync || "";
    state.msStatus = result?.msStatus || "";
    state.syncError = result?.syncError || "";
    fillFilters();
    connection(
      state.msStatus !== "error" && state.msStatus !== "not_configured",
    );
    if (state.syncError) toast(state.syncError, true);
    el("last-refresh").textContent =
      `โหลดหน้าจอล่าสุด ${dtf.format(new Date())} น. · รีเฟรชอัตโนมัติทุก 30 วินาที`;
    render();
  } catch (error) {
    connection(false);
    if (!silent) empty(`โหลดข้อมูลไม่สำเร็จ: ${error.message}`);
  } finally {
    state.loading = false;
  }
}

function fillFilters() {
  state.attendance = setOptions(
    "attendance-filter",
    state.rows.map((row) => row.attendanceType),
    state.attendance,
  );
  state.attribute = setOptions(
    "attribute-filter",
    state.rows.map((row) => row.routeAttribute),
    state.attribute,
  );
  state.region = setOptions(
    "region-filter",
    state.rows.map((row) => row.region),
    state.region,
  );
  state.route = setOptions(
    "route-filter",
    state.rows.map((row) => row.routeType),
    state.route,
  );
}

function fillBranches(branches) {
  const list = [...new Set([state.branch, ...branches].filter(Boolean))].sort();
  el("branch-filter").innerHTML = list
    .map((value) => `<option value="${esc(value)}">${esc(value)}</option>`)
    .join("");
  el("branch-filter").value = state.branch;
}

function setOptions(id, values, selected) {
  const unique = [
    ...new Set(
      values.map((value) => String(value || "").trim()).filter(Boolean),
    ),
  ].sort();
  el(id).innerHTML =
    '<option value="all">ทั้งหมด</option>' +
    unique
      .map((value) => `<option value="${esc(value)}">${esc(value)}</option>`)
      .join("");
  const next = unique.includes(selected) ? selected : "all";
  el(id).value = next;
  return next;
}

function routeState(row, now = new Date()) {
  const eta = parseDate(row.estimatedArrivalAt);
  const arrival = parseDate(row.actualArrivalAt);
  const etd = parseDate(row.estimatedDepartureAt);
  const departure = parseDate(row.actualDepartureAt);
  const arrivalLate = Boolean(
    arrival ? eta && arrival > eta : eta && now > eta,
  );
  const departureLate = Boolean(!departure && arrival && etd && now > etd);
  if (Number(row.unloadingState) === 2)
    return {
      key: "completed",
      label: "โหลดเสร็จสิ้น",
      color: "#167044",
      arrivalLate,
      departureLate: false,
    };
  if (Number(row.unloadingState) === 1)
    return {
      key: "unloading",
      label: "กำลังลงงาน",
      color: "#9a6700",
      arrivalLate,
      departureLate: false,
    };
  if (departure)
    return {
      key: "departed",
      label: "ออกจากสาขาแล้ว",
      color: "#167044",
      arrivalLate,
      departureLate: false,
    };
  if (arrival)
    return {
      key: "arrived",
      label: "มาถึงแล้ว",
      color: departureLate ? "#b3261e" : "#2563eb",
      arrivalLate,
      departureLate,
    };
  return {
    key: "not-arrived",
    label: "ยังมาไม่ถึง",
    color: arrivalLate ? "#b3261e" : "#697177",
    arrivalLate,
    departureLate: false,
  };
}

function isDestination(row) {
  return String(row.attendanceType || "").trim() === "ปลายทาง";
}
function isOrigin(row) {
  return String(row.attendanceType || "").trim() === "ต้นทาง";
}
function punctuality(row) {
  const incoming = isDestination(row),
    plan = parseDate(
      incoming ? row.estimatedArrivalAt : row.estimatedDepartureAt,
    ),
    actual = parseDate(incoming ? row.actualArrivalAt : row.actualDepartureAt);
  if (!plan || !actual)
    return {
      key: "pending",
      label: "ยังไม่มีเวลาจริง",
      color: "#697177",
      diff: null,
    };
  const diff = Math.round((actual - plan) / 60000),
    late = diff > 0;
  return {
    key: late ? "late" : "ontime",
    label: incoming
      ? late
        ? "รถเข้าตกเวลา"
        : "รถเข้าตรงเวลา"
      : late
        ? "ปล่อยตกเวลา"
        : "ปล่อยตรงเวลา",
    color: late ? "#b3261e" : "#167044",
    diff,
  };
}
function queueInfo(row, now = new Date()) {
  const arrival = parseDate(row.actualArrivalAt),
    ageHours = arrival ? (now - arrival) / 36e5 : 0;
  const done = isDestination(row)
    ? Number(row.unloadingState) === 2
    : Boolean(row.actualDepartureAt);
  const active = Boolean(arrival) && !done && ageHours <= 12;
  return {
    active,
    done,
    expired: Boolean(arrival) && !done && ageHours > 12,
    ageHours,
  };
}

function filteredRows() {
  return state.rows
    .filter((row) => {
      const status = routeState(row);
      const text = [
        row.proofId,
        row.routeName,
        row.vehicleType,
        row.plate,
        row.driverName,
        row.supplier,
      ]
        .join(" ")
        .toLowerCase();
      const statusMatch =
        state.status === "all" ||
        status.key === state.status ||
        (state.status === "arrival-late" && status.arrivalLate) ||
        (state.status === "departure-late" && status.departureLate);
      const arrivalDate = localDateValue(
        row.actualArrivalAt || row.estimatedArrivalAt,
      );
      const queue = queueInfo(row);
      const queueMatch =
        state.queue === "all" ||
        (state.queue === "completed" && (queue.done || queue.expired)) ||
        (state.queue === "queue" && queue.active);
      return (
        queueMatch &&
        (!state.query || text.includes(state.query)) &&
        (!state.date || arrivalDate === state.date) &&
        (state.attendance === "all" ||
          row.attendanceType === state.attendance) &&
        (state.attribute === "all" || row.routeAttribute === state.attribute) &&
        (state.region === "all" || row.region === state.region) &&
        (state.route === "all" || row.routeType === state.route) &&
        statusMatch
      );
    })
    .sort(
      (a, b) =>
        (parseDate(a.actualArrivalAt || a.estimatedArrivalAt)?.getTime() || 0) -
        (parseDate(b.actualArrivalAt || b.estimatedArrivalAt)?.getTime() || 0),
    );
}

function render() {
  el("loading-state").classList.add("hidden");
  metrics();
  renderFreshness();
  const rows = filteredRows();
  if (!rows.length) {
    empty(
      state.rows.length
        ? "ไม่พบข้อมูลตามตัวกรอง"
        : "ยังไม่มีข้อมูลจากตัวเชื่อม MS",
    );
    return;
  }
  el("empty-state").classList.add("hidden");
  el("desktop-table").classList.remove("hidden");
  el("mobile-cards").classList.remove("hidden");
  el("table-body").innerHTML = rows.map(tableRow).join("");
  el("mobile-cards").innerHTML = rows.map(card).join("");
}

function metrics() {
  const active = state.rows.filter((row) => queueInfo(row).active),
    destinations = state.rows.filter(isDestination),
    origins = state.rows.filter(isOrigin),
    arrivals = destinations.map((row) => punctuality(row)),
    releases = origins.map((row) => punctuality(row)),
    waits = destinations.map(waitInfo).filter((item) => item.minutes !== null);
  setMetric("metric-total", active.length);
  setMetric(
    "metric-not-arrived",
    arrivals.filter((item) => item.key === "ontime").length,
  );
  setMetric(
    "metric-arrived",
    arrivals.filter((item) => item.key === "late").length,
  );
  setMetric(
    "metric-departed",
    releases.filter((item) => item.key === "ontime").length,
  );
  setMetric(
    "metric-within-standard",
    releases.filter((item) => item.key === "late").length,
  );
  setMetric("metric-over-standard", waits.filter((item) => item.over).length);
}

function setMetric(id, value) {
  el(id).textContent = nf.format(value);
}

function scheduleCell(row) {
  const incoming = isDestination(row),
    plan = incoming ? row.estimatedArrivalAt : row.estimatedDepartureAt,
    actual = incoming ? row.actualArrivalAt : row.actualDepartureAt;
  return `<div class="ms-time-stack"><span>${incoming ? "ETA รถเข้า" : "ETD ปล่อยรถ"} ${shortDateTime(plan)}</span><strong>${incoming ? "มาถึงจริง" : "ออกจริง"} ${shortDateTime(actual)}</strong></div>`;
}
function operationInfo(row) {
  if (!isDestination(row)) {
    const p = punctuality(row);
    return {
      html: `<div class="wait-time" style="color:${p.color}">${p.diff === null ? "-" : `${Math.abs(p.diff)} นาที`}</div><div class="secondary">${p.diff === null ? "รอเวลาออกจริง" : p.diff > 0 ? "ช้ากว่าแผน" : "ก่อน/ตรงตามแผน"}</div>`,
      text: p.diff === null ? "" : Math.abs(p.diff),
      standard: "ไม่ใช้",
    };
  }
  const wait = waitInfo(row);
  return {
    html: waitHtml(wait),
    text: wait.minutes ?? "",
    standard: `${wait.standard} นาที`,
  };
}

function tableRow(row) {
  const status = routeState(row);
  const p = punctuality(row),
    operation = operationInfo(row),
    q = queueInfo(row);
  return `<tr><td><div class="vehicle-line"><strong>${esc(row.proofId || "-")}</strong><strong class="vehicle-type">${esc(row.vehicleType || "-")}</strong></div><div class="secondary">${esc(row.plate || "-")}</div></td><td><div class="primary ms-route-name">${esc(row.routeName || "-")}</div><div class="secondary">${esc([row.routeAttribute, row.routeType, row.region].filter(Boolean).join(" · ") || "-")}</div></td><td><div class="primary">${esc(row.attendanceType || "-")}</div><div class="secondary">${esc(row.supplier || "-")}</div></td><td>${scheduleCell(row)}</td><td><span class="status-pill" style="--status-color:${p.color}">${p.label}</span><div class="secondary">${p.diff === null ? "-" : `${Math.abs(p.diff)} นาที ${p.diff > 0 ? "ช้า" : "ก่อน/ตรงเวลา"}`}</div></td><td>${operation.html}<div class="secondary">มาตรฐาน ${esc(operation.standard)}</div></td><td><div class="primary">${esc(row.driverName || "-")}</div><div class="secondary">${state.auth?.role === "admin" ? esc(row.driverPhone || "-") : "ซ่อนเบอร์โทร"}</div></td><td><div class="ms-status"><span class="status-pill" style="--status-color:${q.expired ? "#697177" : status.color}">${q.expired ? "ตัดคิวเกิน 12 ชม." : status.label}</span><small>${esc(isDestination(row) ? row.loadStatus || "ยังไม่เริ่ม" : row.vehicleStatus || "-")}</small></div></td></tr>`;
}

function card(row) {
  const status = routeState(row);
  const wait = waitInfo(row),
    p = punctuality(row),
    operation = operationInfo(row),
    q = queueInfo(row);
  const phone =
    state.auth?.role === "admin" && row.driverPhone
      ? ` · ${esc(row.driverPhone)}`
      : "";
  return `<article class="truck-card ms-card" style="--card-accent:${q.expired ? "#697177" : isDestination(row) && wait.over ? "#b3261e" : status.color}"><div class="truck-card-head"><div class="truck-route"><div class="primary">${esc(row.routeName || "-")}</div><div class="secondary">${esc([row.routeAttribute, row.routeType, row.attendanceType].filter(Boolean).join(" · ") || "-")}</div></div><div class="truck-status"><span class="status-pill" style="--status-color:${q.expired ? "#697177" : status.color}">${q.expired ? "ตัดคิวเกิน 12 ชม." : status.label}</span></div></div><div class="ms-card-grid"><div><span>บาร์โค้ด / ประเภทรถ</span><strong>${esc(row.proofId || "-")} / ${esc(row.vehicleType || "-")}</strong></div><div><span>ทะเบียนรถ</span><strong>${esc(row.plate || "-")}</strong></div><div><span>${isDestination(row) ? "ETA / มาถึงจริง" : "ETD / ออกจริง"}</span><strong>${shortDateTime(isDestination(row) ? row.estimatedArrivalAt : row.estimatedDepartureAt)} / ${shortDateTime(isDestination(row) ? row.actualArrivalAt : row.actualDepartureAt)}</strong></div><div><span>สถานะตรงเวลา</span><strong style="color:${p.color}">${p.label}</strong></div><div><span>${isDestination(row) ? "เวลาลงจริง / มาตรฐาน" : "ผลต่างเวลาปล่อยรถ"}</span><strong>${operation.text === "" ? "-" : `${operation.text} นาที`}${isDestination(row) ? ` / ${operation.standard}` : ""}</strong></div><div><span>ผู้รับเหมา</span><strong>${esc(row.supplier || "-")}</strong></div><div><span>พนักงานขับรถ</span><strong>${esc(row.driverName || "-")}${phone}</strong></div></div></article>`;
}

function normalizeVehicle(value) {
  const text = String(value || "").toUpperCase();
  return (
    ["22W", "18W", "14W", "10W", "6W", "4WJ", "4W"].find((type) =>
      text.includes(type),
    ) || text
  );
}
function waitInfo(row) {
  const start = parseDate(row.actualArrivalAt),
    end = parseDate(row.unloadingCompletedAt) || new Date(),
    type = normalizeVehicle(row.vehicleType),
    standard = Number(state.standards[type]) || 120;
  if (!start) return { minutes: null, standard, over: false };
  const minutes = Math.max(0, Math.floor((end - start) / 60000));
  return {
    minutes,
    standard,
    over: minutes > standard,
    finished: Number(row.unloadingState) === 2,
  };
}
function waitHtml(wait) {
  if (wait.minutes === null)
    return '<span class="secondary">ยังไม่มาถึง</span>';
  return `<div class="wait-time" style="color:${wait.over ? "#b3261e" : "#167044"}">${nf.format(wait.minutes)} นาที</div><div class="secondary">${wait.over ? "เกินมาตรฐาน" : "อยู่ในมาตรฐาน"}</div>`;
}

function timePair(expected, actual) {
  return `<div class="ms-time-stack"><span>คาด ${shortDateTime(expected)}</span><strong>จริง ${shortDateTime(actual)}</strong></div>`;
}

function shortDateTime(value) {
  const date = parseDate(value);
  return date ? `${dtf.format(date)} น.` : "-";
}
function shortTime(value) {
  const date = parseDate(value);
  return date
    ? date.toLocaleTimeString("th-TH", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "-";
}
function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return isNaN(date) ? null : date;
}
function localDateValue(value) {
  const d = parseDate(value);
  if (!d) return "";
  const y = d.getFullYear(),
    m = String(d.getMonth() + 1).padStart(2, "0"),
    day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function renderFreshness() {
  const synced = parseDate(state.lastSync);
  const stale = !synced || Date.now() - synced.getTime() > CONFIG.staleMs;
  el("live-dot").classList.toggle("stale", stale);
  el("source-sync").textContent = state.syncError
    ? `MS: ${state.syncError}`
    : synced
      ? `ข้อมูล MS ล่าสุด ${dtf.format(synced)} น.${stale ? " · เซสชันยังไม่อัปเดต" : ""}`
      : "ยังไม่มีข้อมูลจาก MS";
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
  el("empty-state").innerHTML =
    `<strong>${esc(message)}</strong><span>ระบบออนไลน์จะตรวจข้อมูล MS ใหม่อัตโนมัติทุก 30 วินาทีขณะมีผู้เปิดดู</span>`;
}

async function apiGet(action, params = {}) {
  const url = new URL(CONFIG.apiUrl);
  url.searchParams.set("action", action);
  url.searchParams.set("token", state.auth?.token || "");
  Object.entries(params).forEach(
    ([key, value]) =>
      value !== undefined && value !== "" && url.searchParams.set(key, value),
  );
  const json = await (await fetch(url, { cache: "no-store" })).json();
  if (json.ok === false) {
    const error = new Error(json.message);
    error.code = json.code || "SERVER_ERROR";
    if (error.code === "INVALID_SESSION") invalidateSession();
    throw error;
  }
  return json.data ?? json;
}

function openMsConnection() {
  el("ms-har-hub").value = state.branch || state.auth?.branches?.[0] || "NE1";
  el("ms-har-file").value = "";
  el("ms-connection-error").classList.add("hidden");
  el("ms-connection-dialog").showModal();
}

async function saveMsConnection(event) {
  event.preventDefault();
  const errorEl = el("ms-connection-error"),
    file = el("ms-har-file").files[0],
    hub = el("ms-har-hub").value.trim().toUpperCase();
  try {
    if (!file || file.size > 30 * 1024 * 1024)
      throw new Error("กรุณาเลือกไฟล์ HAR ขนาดไม่เกิน 30 MB");
    const har = JSON.parse(await file.text());
    const entry = (har.log?.entries || []).find((item) => {
      try {
        return (
          new URL(item.request?.url).pathname ===
            "/gw/nws/staff/ms/store/line/task" && item.response?.status === 200
        );
      } catch {
        return false;
      }
    });
    if (!entry) throw new Error("ไม่พบคำขอ StoreLineAttendance ในไฟล์ HAR");
    const header = (name) =>
      entry.request.headers?.find((item) => item.name?.toLowerCase() === name)
        ?.value || "";
    const sessionId = header("x-fle-session-id"),
      deviceId = header("x-device-id");
    if (!sessionId || !deviceId)
      throw new Error("ไฟล์ HAR ไม่มี Session ID หรือ Device ID");
    const result = await apiPost("saveMsConnection", {
      hub,
      sessionId,
      deviceId,
    });
    errorEl.classList.add("hidden");
    el("ms-connection-dialog").close();
    state.branch = hub;
    toast(`เชื่อมต่อ ${hub} สำเร็จ · พบ ${nf.format(result.total)} รายการ`);
    await loadData();
  } catch (error) {
    errorEl.textContent = error.message;
    errorEl.classList.remove("hidden");
  }
}

function exportCurrent() {
  downloadRows(
    `MS_ปัจจุบัน_${state.branch}_${localDateValue(new Date())}.csv`,
    filteredRows().map(exportRow),
  );
}
async function exportHistory() {
  try {
    const rows = [];
    let offset = 0,
      hasMore = true;
    while (hasMore) {
      const page = await apiGet("msHistory", { branch: state.branch, offset });
      rows.push(...(page.rows || []));
      hasMore = Boolean(page.hasMore);
      offset = page.nextOffset || rows.length;
    }
    downloadRows(
      `MS_ประวัติ_${state.branch}_${localDateValue(new Date())}.csv`,
      rows.map((item) => {
        let row = {};
        try {
          row = JSON.parse(item.payloadJson || "{}");
        } catch {}
        return {
          eventType: item.eventType,
          snapshotAt: item.snapshotAt,
          ...exportRow(row),
        };
      }),
    );
    toast(`Export ประวัติ ${nf.format(rows.length)} รายการแล้ว`);
  } catch (error) {
    toast(error.message, true);
  }
}
function exportRow(row) {
  const wait = waitInfo(row),
    status = routeState(row),
    p = punctuality(row),
    q = queueInfo(row);
  return {
    hub: row.hub || state.branch,
    proofId: row.proofId || "",
    routeName: row.routeName || "",
    routeAttribute: row.routeAttribute || "",
    routeType: row.routeType || "",
    region: row.region || "",
    attendanceType: row.attendanceType || "",
    vehicleType: row.vehicleType || "",
    plate: row.plate || "",
    estimatedArrivalAt: exportThaiDate(row.estimatedArrivalAt),
    actualArrivalAt: exportThaiDate(row.actualArrivalAt),
    arrivalPunctuality: isDestination(row) ? p.label : "",
    unloadingCompletedAt: exportThaiDate(row.unloadingCompletedAt),
    unloadingState: row.unloadingState ?? "",
    estimatedDepartureAt: exportThaiDate(row.estimatedDepartureAt),
    actualDepartureAt: exportThaiDate(row.actualDepartureAt),
    departurePunctuality: isOrigin(row) ? p.label : "",
    operationMinutes: isDestination(row)
      ? (wait.minutes ?? "")
      : p.diff === null
        ? ""
        : Math.abs(p.diff),
    standardMinutes: isDestination(row) ? wait.standard : "",
    waitResult:
      wait.minutes === null
        ? "ยังไม่มาถึง"
        : wait.over
          ? "เกินมาตรฐาน"
          : "อยู่ในมาตรฐาน",
    vehicleStatus: status.label,
    queueStatus: q.expired
      ? "ตัดคิวเกิน 12 ชั่วโมง"
      : q.done
        ? "ดำเนินการแล้ว"
        : q.active
          ? "งานปัจจุบัน"
          : "รอดำเนินการ",
    loadStatus: row.loadStatus || "",
    supplier: row.supplier || "",
    driverName: row.driverName || "",
    driverPhone: state.auth?.role === "admin" ? row.driverPhone || "" : "",
    syncedAt: exportThaiDate(row.syncedAt),
  };
}
function exportThaiDate(value) {
  const date = parseDate(value);
  if (!date) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
function downloadRows(filename, rows) {
  if (!rows.length) {
    toast("ไม่มีข้อมูลสำหรับ Export", true);
    return;
  }
  const headers = Object.keys(rows[0]),
    csv =
      "\ufeff" +
      [headers, ...rows.map((row) => headers.map((key) => row[key]))]
        .map((line) => line.map(csvCell).join(","))
        .join("\r\n"),
    blob = new Blob([csv], { type: "text/csv;charset=utf-8" }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

async function apiPost(action, payload = {}, withAuth = true) {
  const body = { action, ...payload };
  if (withAuth) body.token = state.auth?.token || "";
  const json = await (
    await fetch(CONFIG.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
    })
  ).json();
  if (json.ok === false) throw new Error(json.message);
  return json.data ?? json;
}

const esc = (value) =>
  String(value ?? "").replace(
    /[&<>'"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        char
      ],
  );
let toastTimer;
function toast(message, error = false) {
  clearTimeout(toastTimer);
  el("toast").textContent = message;
  el("toast").style.background = error ? "var(--red)" : "var(--navy)";
  el("toast").classList.remove("hidden");
  toastTimer = setTimeout(() => el("toast").classList.add("hidden"), 4000);
}
