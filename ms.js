const CONFIG = {
  apiUrl:
    "https://script.google.com/macros/s/AKfycbxE2-_8h6EzOQQ3FeDwFxNIAn4U40pacvRnp3XeOGevXDzhw15bgDi74LVgtozfjgiHXQ/exec",
  pollMs: 4000,
  staleMs: 15000,
};

CONFIG.apiUrl = `${window.location.hostname.endsWith("github.io") ? "https://waiting-trucks-report.alert-squid-6738.chatgpt.site" : window.location.origin}/api`;
const ARCHIVE_LOAD_DELAY_MS = 1500;
const AUTH_KEY = "bnak_operator_auth_v2";
const state = {
  rows: [],
  currentRows: [],
  archiveRows: [],
  archiveTotal: 0,
  auth: loadAuth(),
  query: "",
  branch: "NE1",
  dateFrom: "",
  dateTo: "",
  attendance: "all",
  attribute: "all",
  region: "all",
  route: "all",
  status: "all",
  summary: "all",
  queue: "queue",
  standards: {},
  loading: false,
  archiveLoaded: false,
};
let archiveLoadTimer = null;
let archiveLoadPromise = null;
const el = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat("th-TH");
const dtf = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "short",
  hour12: false,
});

document.addEventListener("DOMContentLoaded", () => {
  el("refresh-btn").onclick = () => loadData();
  el("search-range-btn").onclick = loadRange;
  el("ms-connection-btn").onclick = openMsConnection;
  el("ms-connection-close").onclick = () => el("ms-connection-dialog").close();
  el("ms-connection-form").onsubmit = (event) => event.preventDefault();
  el("pending-parcels-close").onclick = () => el("pending-parcels-dialog").close();
  el("copy-pending-parcels").onclick = copyPendingParcels;
  el("export-pending-parcels").onclick = exportPendingParcels;
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-pending-proof]");
    if (button) openPendingParcels(button.dataset.pendingProof, button.dataset.pendingDay);
  });
  document.querySelectorAll("[data-har-save]").forEach((button) => {
    button.onclick = () => saveMsConnection(button.dataset.harSave, button);
  });
  el("ms-qr-connect").onclick = startQrConnection;
  el("export-current-btn").onclick = exportCurrent;
  el("export-history-btn").onclick = exportHistory;
  el("export-visible-btn").onclick = exportVisible;
  el("capture-table-btn").onclick = captureVisibleTable;
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
    state.summary = "all";
    resetArchiveState();
    loadData();
  };
  setupDateInput("date-from");
  setupDateInput("date-to");
  el("attribute-filter").onchange = (event) => {
    state.attribute = event.target.value;
    state.summary = "all";
    render();
  };
  el("region-filter").onchange = (event) => {
    state.region = event.target.value;
    state.summary = "all";
    render();
  };
  el("attendance-filter").onchange = (event) => {
    state.attendance = event.target.value;
    state.summary = "all";
    render();
  };
  el("route-filter").onchange = (event) => {
    state.route = event.target.value;
    state.summary = "all";
    render();
  };
  el("status-filter").onchange = (event) => {
    state.status = event.target.value;
    state.summary = "all";
    render();
  };
  el("queue-filter").onchange = async (event) => {
    state.queue = event.target.value;
    state.summary = "all";
    if (state.queue === "all") await ensureArchiveLoaded(true);
    render();
  };
  document.querySelectorAll("[data-metric]").forEach((card) => {
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.onclick = () => applyMetricFilter(card.dataset.metric);
    card.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") card.click();
    };
  });
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
  if (el("site-code")) el("site-code").textContent = code;
  el("site-title").textContent =
    `ติดตามเส้นทาง MS${branches.length === 1 ? ` · ${branches[0]}` : ""}`;
  el("login-btn").classList.toggle("hidden", on);
  el("connect-ms-btn").classList.toggle("hidden", !on);
  el("ms-connection-btn").classList.toggle(
    "hidden",
    !on,
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
    state.currentRows = Array.isArray(result?.rows) ? result.rows : [];
    state.archiveRows = mergeLatest(state.archiveRows, state.currentRows);
    state.archiveTotal = Math.max(state.archiveTotal, state.archiveRows.length);
    state.rows = state.archiveRows;
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
      `อัปเดตล่าสุด ${dtf.format(new Date())} น. · ตรวจสถานะใหม่ทุก 4 วินาที`;
    render();
    if (!silent && !state.archiveLoaded) scheduleArchiveLoad();
  } catch (error) {
    connection(false);
    if (!silent) empty(`โหลดข้อมูลไม่สำเร็จ: ${error.message}`);
  } finally {
    state.loading = false;
  }
}

function resetArchiveState() {
  if (archiveLoadTimer) clearTimeout(archiveLoadTimer);
  archiveLoadTimer = null;
  state.archiveRows = [];
  state.archiveTotal = 0;
  state.archiveLoaded = false;
  state.rows = [];
}

function scheduleArchiveLoad(delay = ARCHIVE_LOAD_DELAY_MS) {
  if (!state.auth || state.archiveLoaded || archiveLoadTimer) return;
  const branch = state.branch;
  archiveLoadTimer = setTimeout(() => {
    archiveLoadTimer = null;
    if (state.auth && state.branch === branch && !state.archiveLoaded)
      void ensureArchiveLoaded(false);
  }, delay);
}

async function ensureArchiveLoaded(userInitiated = false) {
  if (!state.auth || state.archiveLoaded) return true;
  const branch = state.branch;
  if (archiveLoadTimer) {
    clearTimeout(archiveLoadTimer);
    archiveLoadTimer = null;
  }
  if (archiveLoadPromise?.branch === branch) return archiveLoadPromise.promise;
  const promise = (async () => {
    try {
      const archive = await apiGet("msArchive", { branch });
      if (state.branch !== branch) return false;
      state.archiveRows = Array.isArray(archive?.rows) ? archive.rows : [];
      state.archiveTotal = Number.isFinite(Number(archive?.totalDistinct))
        ? Number(archive.totalDistinct)
        : state.archiveRows.length;
      state.archiveLoaded = true;
      state.rows = mergeLatest(state.archiveRows, state.currentRows);
      fillFilters();
      render();
      return true;
    } catch (error) {
      if (userInitiated) toast(`โหลดรายการสะสมไม่สำเร็จ: ${error.message}`, true);
      return false;
    } finally {
      if (archiveLoadPromise?.promise === promise) archiveLoadPromise = null;
    }
  })();
  archiveLoadPromise = { branch, promise };
  return promise;
}

function mergeLatest(archive, current) {
  const latest = new Map(
    (archive || []).map((row) => [row.id || row.proofId, row]),
  );
  for (const row of current || []) latest.set(row.id || row.proofId, row);
  return [...latest.values()];
}

function fillFilters() {
  state.attendance = setOptions(
    "attendance-filter",
    state.rows.map((row) => normalizeAttendance(row.attendanceType)),
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
  const routeArrival = parseDate(row.actualArrivalAt);
  const arrival = routeArrival ? effectiveArrival(row) : null;
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
      label: "กำลังลงรถ",
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
  if (routeArrival)
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

function normalizeAttendance(value) {
  const text = String(value || "").trim();
  if (text.includes("จุดดร")) return "จุดดรอป";
  if (text.includes("ปลายทาง")) return "ปลายทาง";
  if (text.includes("ต้นทาง")) return "ต้นทาง";
  return text;
}
function isDestination(row) {
  return normalizeAttendance(row.attendanceType) === "ปลายทาง";
}
function isOrigin(row) {
  return normalizeAttendance(row.attendanceType) === "ต้นทาง";
}
function isDrop(row) {
  return normalizeAttendance(row.attendanceType) === "จุดดรอป";
}
function effectiveArrival(row) {
  return [
    row.actualArrivalAt,
    row.scheduleKitArrivalAt,
    row.scheduleTbrArrivalAt,
  ]
    .map(parseDate)
    .filter(Boolean)
    .sort((a, b) => a - b)[0] || null;
}
function confirmedEffectiveArrival(row) {
  return parseDate(row.actualArrivalAt) ? effectiveArrival(row) : null;
}
function attendanceLabel(row) {
  if (isDestination(row)) return "รถเข้าฮับ";
  if (isDrop(row)) return "รถแวะส่งแล้วไปต่อ";
  return "รถออกจากฮับ";
}
function punctuality(row) {
  const incoming = isDestination(row) || isDrop(row),
    plan = parseDate(
      incoming ? row.estimatedArrivalAt : row.estimatedDepartureAt,
    ),
    actual = incoming
      ? confirmedEffectiveArrival(row)
      : parseDate(row.actualDepartureAt);
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
        ? "รถเข้าช้า"
        : "รถเข้าตรงเวลา"
      : late
        ? "ปล่อยรถช้า"
        : "ปล่อยตรงเวลา",
    color: late ? "#b3261e" : "#167044",
    diff,
  };
}

function schedulePunctuality(row, mode) {
  const incoming = mode === "arrival";
  const plan = parseDate(incoming ? row.estimatedArrivalAt : row.estimatedDepartureAt);
  const actual = incoming
    ? confirmedEffectiveArrival(row)
    : parseDate(row.actualDepartureAt);
  if (!plan || !actual) return { key: "pending", diff: null, label: "ยังไม่มีเวลาจริง" };
  const diff = Math.round((actual - plan) / 60000);
  return {
    key: diff > 0 ? "late" : "ontime",
    diff,
    label: incoming
      ? diff > 0 ? "รถเข้าช้า" : "รถเข้าตรงเวลา"
      : diff > 0 ? "ปล่อยรถช้า" : "ปล่อยตรงเวลา",
  };
}

function scheduleSection(row, mode) {
  const incoming = mode === "arrival";
  const plan = incoming ? row.estimatedArrivalAt : row.estimatedDepartureAt;
  const actual = incoming
    ? confirmedEffectiveArrival(row)
    : row.actualDepartureAt;
  const timing = schedulePunctuality(row, mode);
  const detail = timing.diff === null
    ? timing.label
    : `${timing.label} · ${nf.format(Math.abs(timing.diff))} นาที`;
  return `<div class="schedule-section ${incoming ? "arrival" : "departure"}"><div class="schedule-heading">${incoming ? "รถมาถึงคลัง" : "ปล่อยรถ"}</div><div class="schedule-values"><span><b>${incoming ? "คาดว่าจะถึง" : "กำหนดออก"}</b><strong>${shortDateTime(plan)}</strong></span><span><b>${incoming ? "ถึงจริง" : "ออกจริง"}</b><strong>${shortDateTime(actual)}</strong></span></div><small class="timing-chip ${timing.key}">${esc(detail)}</small></div>`;
}
function queueInfo(row, now = new Date()) {
  const routeArrival = parseDate(row.actualArrivalAt),
    arrival = routeArrival ? effectiveArrival(row) : null,
    ageHours = arrival ? (now - arrival) / 36e5 : 0;
  const unloadingState = Number(row.unloadingState),
    done = isDestination(row)
      ? unloadingState === 2
      : isDrop(row)
        ? unloadingState === 2 && Boolean(row.actualDepartureAt)
        : Boolean(row.actualDepartureAt),
    started =
      (isDestination(row) || isDrop(row)) &&
      (unloadingState === 1 || unloadingState === 2),
    active = Boolean(routeArrival) && !done && ageHours <= 12;
  return {
    active,
    done,
    started,
    expired: Boolean(routeArrival) && !done && ageHours > 12,
    ageHours,
  };
}

function dropOperation(row) {
  const unloadingState = Number(row.unloadingState);
  const arrival = parseDate(row.actualArrivalAt);
  const unloadingEnd = parseDate(row.unloadingCompletedAt);
  const departure = parseDate(row.actualDepartureAt);
  const unloading = waitInfo(row);
  const onwardMinutes = unloadingEnd
    ? Math.max(0, Math.floor(((departure || new Date()) - unloadingEnd) / 60000))
    : null;
  return {
    unloadingLabel:
      unloadingState === 2
        ? "ลงของเสร็จแล้ว"
        : unloadingState === 1
          ? "กำลังลงของ"
          : arrival
            ? "รอเริ่มลงของ"
            : "รอรถมาถึง",
    onwardLabel: departure
      ? "ออกไปต่อแล้ว"
      : unloadingState === 2
        ? "รอออกไปต่อ"
        : "รอลงของให้เสร็จ",
    unloadingMinutes: unloading.minutes,
    unloadingStandard: unloading.standard,
    unloadingOver: unloading.over,
    onwardMinutes,
    unloadingDone: unloadingState === 2,
    onwardDone: Boolean(departure),
  };
}

function bangkokDateValue(value) {
  const date = parseDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function isCompletedToday(row, now = new Date()) {
  if ((!isDestination(row) && !isDrop(row)) || Number(row.unloadingState) !== 2)
    return false;
  if (!row.unloadingCompletedAt) return false;
  if (row.completionObservedLive === false) return false;
  return bangkokDateValue(row.unloadingCompletedAt) === bangkokDateValue(now);
}

function departureCountdown(row, now = new Date()) {
  const plan = parseDate(row.estimatedDepartureAt);
  if (!plan || (!isOrigin(row) && !isDrop(row))) return null;
  const actual = parseDate(row.actualDepartureAt);
  if (actual) {
    const diff = Math.round((actual - plan) / 60000);
    return {
      key: diff > 0 ? "late" : "ontime",
      minutes: Math.abs(diff),
      label: diff > 0
        ? `ออกช้า ${nf.format(diff)} นาที`
        : diff < 0
          ? `ออกก่อนเวลา ${nf.format(Math.abs(diff))} นาที`
          : "ตรงเวลา",
    };
  }
  const diff = Math.ceil((plan - now) / 60000);
  return {
    key: diff < 0 ? "late" : "pending",
    minutes: Math.abs(diff),
    label: diff < 0
      ? `เกินกำหนด ${nf.format(Math.abs(diff))} นาที`
      : `เหลือ ${nf.format(diff)} นาทีถึงกำหนดปล่อย`,
  };
}

function departureCountdownHtml(row) {
  const item = departureCountdown(row);
  return item
    ? `<div class="departure-countdown ${item.key}">${esc(item.label)}</div>`
    : "";
}

function dropProgressHtml(drop, compact = false) {
  const stageOneDetail = drop.unloadingMinutes === null
    ? "รอรถมาถึง"
    : drop.unloadingDone
      ? `ใช้เวลา ${nf.format(drop.unloadingMinutes)} นาที · มาตรฐาน ${nf.format(drop.unloadingStandard)} นาที`
      : `ใช้แล้ว ${nf.format(drop.unloadingMinutes)} นาที · มาตรฐาน ${nf.format(drop.unloadingStandard)} นาที · ${drop.unloadingOver ? `เกินมาตรฐาน ${nf.format(drop.unloadingMinutes - drop.unloadingStandard)} นาที` : `เหลืออีก ${nf.format(Math.max(0, drop.unloadingStandard - drop.unloadingMinutes))} นาที`}`;
  const stageTwoDetail = drop.onwardMinutes === null
    ? "รอขั้นตอนลงของ"
    : drop.onwardDone
      ? `ออกหลังลงของเสร็จ ${nf.format(drop.onwardMinutes)} นาที`
      : `รอออกแล้ว ${nf.format(drop.onwardMinutes)} นาที`;
  return `<div class="drop-progress${compact ? " compact-drop-progress" : ""}"><div class="drop-stage ${drop.unloadingDone ? "is-done" : ""} ${drop.unloadingOver ? "is-late" : ""}"><span>1 · ลงของที่จุดดรอป</span><strong>${esc(drop.unloadingLabel)}</strong><small>${stageOneDetail}</small></div><div class="drop-stage ${drop.onwardDone ? "is-done" : ""}"><span>2 · ไปต่อ</span><strong>${esc(drop.onwardLabel)}</strong><small>${stageTwoDetail}</small></div></div>`;
}

function filteredRows(ignoreSummary = false) {
  const source =
    state.queue === "queue" ? state.currentRows : state.archiveRows;
  return source
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
        (state.status === "arrival-ontime" &&
          isDestination(row) &&
          punctuality(row).key === "ontime") ||
        (state.status === "arrival-late" && status.arrivalLate) ||
        (state.status === "departure-ontime" &&
          isOrigin(row) &&
          punctuality(row).key === "ontime") ||
        (state.status === "departure-late" && status.departureLate);
      const arrivalDate = localDateValue(
        row.actualArrivalAt || row.estimatedArrivalAt,
      );
      const queue = queueInfo(row);
      const summaryMatch =
        ignoreSummary ||
        state.summary === "all" ||
        (state.summary === "waiting" && isDestination(row) && status.key === "arrived") ||
        (state.summary === "unloading" && isDestination(row) && status.key === "unloading") ||
        (state.summary === "completed" && isCompletedToday(row)) ||
        (state.summary === "origin" && isOrigin(row) && !queue.done) ||
        (state.summary === "drop" && isDrop(row) && !queue.done);
      const queueMatch =
        state.queue === "all" ||
        (state.queue === "completed" && (queue.done || queue.expired)) ||
        (state.queue === "queue" && queue.active);
      return (
        queueMatch &&
        (!state.query || text.includes(state.query)) &&
        (!state.dateFrom || arrivalDate >= state.dateFrom) &&
        (!state.dateTo || arrivalDate <= state.dateTo) &&
        (state.attendance === "all" ||
          normalizeAttendance(row.attendanceType) === state.attendance) &&
        (state.attribute === "all" || row.routeAttribute === state.attribute) &&
        (state.region === "all" || row.region === state.region) &&
        (state.route === "all" || row.routeType === state.route) &&
        statusMatch &&
        summaryMatch
      );
    })
    .sort((a, b) => {
      const aTime = (confirmedEffectiveArrival(a) || parseDate(a.estimatedArrivalAt))?.getTime() || 0;
      const bTime = (confirmedEffectiveArrival(b) || parseDate(b.estimatedArrivalAt))?.getTime() || 0;
      return state.queue === "queue" ? aTime - bTime : bTime - aTime;
    });
}

async function loadRange() {
  const start = displayDateToIso(el("date-from").value),
    end = displayDateToIso(el("date-to").value);
  if (!start || !end) return toast("กรุณาเลือกวันที่เริ่มต้นและสิ้นสุด", true);
  try {
    const result = await apiGet("msRange", {
      branch: state.branch,
      start,
      end,
    });
    state.dateFrom = start;
    state.dateTo = end;
    state.queue = "all";
    el("queue-filter").value = "all";
    state.archiveLoaded = false;
    await loadData(false);
    toast(`ดึงข้อมูลย้อนหลัง ${nf.format(result.total)} รายการแล้ว`);
  } catch (error) {
    toast(error.message, true);
  } finally {
  }
}

let rangeTimer;
function autoLoadRange() {
  state.dateFrom = displayDateToIso(el("date-from").value);
  state.dateTo = displayDateToIso(el("date-to").value);
  render();
  clearTimeout(rangeTimer);
  if (state.dateFrom && state.dateTo) rangeTimer = setTimeout(loadRange, 250);
}

function render() {
  el("loading-state").classList.add("hidden");
  metrics();
  renderFreshness();
  const summaryRows = filteredRows(true);
  const rows = filteredRows();
  renderFilterSummary(summaryRows);
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

function renderFilterSummary(rows) {
  el("filter-summary").classList.remove("hidden");
  const counts = { waiting: 0, unloading: 0, completed: 0, origin: 0, drop: 0 };
  for (const row of rows) {
    const key = routeState(row).key;
    const queue = queueInfo(row);
    if (isDestination(row) && key === "arrived") counts.waiting++;
    if (isDestination(row) && key === "unloading") counts.unloading++;
    if (isCompletedToday(row)) counts.completed++;
    if (isOrigin(row) && !queue.done) counts.origin++;
    if (isDrop(row) && !queue.done) counts.drop++;
  }
  el("filter-summary").innerHTML = `
    <button type="button" class="summary-all ${state.summary === "all" ? "is-active" : ""}" data-summary-status="all"><span>ทั้งหมดตามตัวกรอง</span><strong>${nf.format(rows.length)}</strong></button>
    <button type="button" class="summary-wait ${state.summary === "waiting" ? "is-active" : ""}" data-summary-status="waiting"><span>รอลงรถ</span><strong>${nf.format(counts.waiting)}</strong></button>
    <button type="button" class="summary-work ${state.summary === "unloading" ? "is-active" : ""}" data-summary-status="unloading"><span>กำลังลงรถ</span><strong>${nf.format(counts.unloading)}</strong></button>
    <button type="button" class="summary-done ${state.summary === "completed" ? "is-active" : ""}" data-summary-status="completed"><span>ลงรถเสร็จ</span><strong>${nf.format(counts.completed)}</strong></button>
    <button type="button" class="summary-origin ${state.summary === "origin" ? "is-active" : ""}" data-summary-status="origin"><span>รอปล่อยรถ</span><strong>${nf.format(counts.origin)}</strong></button>
    <button type="button" class="summary-drop ${state.summary === "drop" ? "is-active" : ""}" data-summary-status="drop"><span>จุดดรอป</span><strong>${nf.format(counts.drop)}</strong></button>`;
  el("filter-summary")
    .querySelectorAll("button")
    .forEach((button) => {
      button.onclick = () => {
      const value = button.dataset.summaryStatus;
        state.summary = value;
        render();
      };
    });
}

async function applyMetricFilter(metric) {
  if (["all", "completed", "arrival-ontime", "arrival-late", "departure-ontime", "departure-late"].includes(metric))
    await ensureArchiveLoaded(true);
  state.summary = "all";
  state.status = "all";
  state.attendance = "all";
  if (metric === "all") state.queue = "all";
  if (metric === "queue") state.queue = "queue";
  if (metric === "unloading") {
    state.queue = "queue";
    state.status = "unloading";
  }
  if (metric === "completed") {
    state.queue = "all";
    state.summary = "completed";
  }
  if (metric === "arrival-ontime") {
    state.queue = "all";
    state.attendance = "ปลายทาง";
    state.status = "arrival-ontime";
  }
  if (metric === "arrival-late") {
    state.queue = "all";
    state.attendance = "ปลายทาง";
    state.status = "arrival-late";
  }
  if (metric === "departure-ontime") {
    state.queue = "all";
    state.attendance = "ต้นทาง";
    state.status = "departure-ontime";
  }
  if (metric === "departure-late") {
    state.queue = "all";
    state.attendance = "ต้นทาง";
    state.status = "departure-late";
  }
  el("queue-filter").value = state.queue;
  el("status-filter").value = state.status;
  el("attendance-filter").value = state.attendance;
  render();
}

function metrics() {
  const active = state.currentRows.filter((row) => queueInfo(row).active),
    destinations = state.archiveRows.filter(isDestination),
    origins = state.archiveRows.filter(isOrigin),
    arrivals = destinations.map((row) => punctuality(row)),
    releases = origins.map((row) => punctuality(row)),
    waits = destinations.map(waitInfo).filter((item) => item.minutes !== null);
  setMetric("metric-archive", state.archiveTotal ?? state.archiveRows.length);
  setMetric("metric-total", active.length);
  setMetric(
    "metric-unloading",
    active.filter((row) => Number(row.unloadingState) === 1).length,
  );
  setMetric(
    "metric-completed",
    state.archiveRows.filter((row) => isCompletedToday(row)).length,
  );
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
}

function setMetric(id, value) {
  el(id).textContent = nf.format(value);
}

function planCell(row) {
  return `<div class="time-card"><span>${isDestination(row) ? "กำหนดรถเข้า (ETA)" : "กำหนดปล่อยรถ (ETD)"}</span><strong>${shortDateTime(isDestination(row) ? row.estimatedArrivalAt : row.estimatedDepartureAt)}</strong></div>`;
}
function actualCell(row) {
  const incoming = isDestination(row) || isDrop(row);
  const value = incoming
    ? confirmedEffectiveArrival(row)
    : row.actualDepartureAt;
  return value
    ? `<div class="time-card actual"><span>${incoming ? "รถมาถึงจริง" : "ปล่อยรถจริง"}</span><strong>${shortDateTime(value)}</strong></div>`
    : '<span class="empty-chip">ยังไม่มีเวลาจริง</span>';
}
function operationInfo(row) {
  if (!isDestination(row)) {
    const p = punctuality(row);
    return {
      html: `<div class="wait-time" style="color:${p.color}">${p.diff === null ? "-" : `${Math.abs(p.diff)} นาที`}</div><div class="secondary">${p.diff === null ? "รอเวลาออกจริง" : p.diff > 0 ? "ช้ากว่าแผน" : "ก่อน/ตรงตามแผน"}</div>`,
      text: p.diff === null ? "" : Math.abs(p.diff),
      standard: "",
    };
  }
  const wait = waitInfo(row);
  return {
    html: waitHtml(wait),
    text: wait.minutes ?? "",
    standard: `${wait.standard} นาที`,
  };
}

function workCell(row) {
  const p = punctuality(row),
    operation = operationInfo(row);
  if (!isDestination(row)) {
    if (p.diff === null) return '<span class="empty-chip">รอเวลาออกจริง</span>';
    return `<div class="mini-card ${p.diff > 0 ? "danger" : "success"}"><span>${p.diff > 0 ? "ปล่อยช้ากว่าแผน" : "ปล่อยก่อนแผน"}</span><strong>${nf.format(Math.abs(p.diff))} นาที</strong></div>`;
  }
  const wait = waitInfo(row);
  if (wait.minutes === null)
    return '<span class="empty-chip">รถยังไม่มาถึง</span>';
  return `<div class="operation-cards"><div class="mini-card ${wait.over ? "danger" : "success"}"><span>เวลารวมตั้งแต่รถถึง</span><strong>${nf.format(wait.minutes)} นาที</strong><small>รวมรอเริ่มลง + ลงงาน</small></div><div class="mini-card neutral"><span>มาตรฐาน ${esc(row.vehicleType || "รถ")}</span><strong>${nf.format(wait.standard)} นาที</strong></div></div>`;
}

function expectedParcelsBadge(row) {
  if (row.expectedParcels === null || row.expectedParcels === undefined || row.expectedParcels === "")
    return "";
  const number = Number(row.expectedParcels);
  const display = Number.isFinite(number) ? nf.format(number) : esc(row.expectedParcels);
  return `<span class="expected-parcels-badge">พัสดุทั้งหมด ${display}</span>`;
}

let pendingParcelRows = [];
async function openPendingParcels(proofId, day) {
  const dialog = el("pending-parcels-dialog");
  pendingParcelRows = [];
  el("pending-parcels-trip").textContent = `${proofId}${day ? ` · ${day}` : ""}`;
  el("pending-parcels-total").textContent = "กำลังโหลด…";
  el("pending-parcels-loading").classList.remove("hidden");
  el("pending-parcels-list").classList.add("hidden");
  dialog.showModal();
  try {
    const result = await apiGet("pendingParcels", {
      branch: state.branch,
      proofId,
      day,
      type: "no_entry",
    });
    pendingParcelRows = result.parcels || [];
    el("pending-parcels-total").textContent = `ทั้งหมด ${nf.format(result.total || pendingParcelRows.length)} ชิ้น`;
    el("pending-parcels-trip").textContent = `${result.proofId || proofId} · ${result.routeName || ""}`;
    el("pending-parcels-list").innerHTML = pendingParcelRows.length
      ? `<table><thead><tr><th>ลำดับ</th><th>เลขพัสดุ / เลขแบ็กกิ้ง</th><th>การดำเนินการล่าสุด / เวลา</th><th>HUB / สาขาปลายทาง</th></tr></thead><tbody>${pendingParcelRows.map((row, index) => `<tr><td>${nf.format(index + 1)}</td><td><strong>${esc(row.pno)}</strong><small>แบ็กกิ้ง: ${esc(row.backingNo || "-")}</small></td><td><strong>${esc(row.lastAction || row.status || "-")}</strong><small>${esc(row.lastActionAt || "-")}</small></td><td><strong>${esc(row.targetHub || "-")}</strong><small>${esc(row.targetBranch || "-")}</small></td></tr>`).join("")}</tbody></table>`
      : '<div class="empty-state">ไม่พบเลขพัสดุที่ยังไม่เข้าคลัง</div>';
    el("pending-parcels-loading").classList.add("hidden");
    el("pending-parcels-list").classList.remove("hidden");
  } catch (error) {
    el("pending-parcels-loading").innerHTML = `<strong>${esc(error.message)}</strong><span>ตรวจสอบเซสชันพัสดุเข้าคลังแล้วลองใหม่</span>`;
    el("pending-parcels-total").textContent = "โหลดไม่สำเร็จ";
  }
}

async function copyPendingParcels() {
  if (!pendingParcelRows.length) return toast("ยังไม่มีเลขพัสดุให้คัดลอก", true);
  await navigator.clipboard.writeText(pendingParcelRows.map((row) => row.pno).join("\n"));
  toast(`คัดลอกเลขพัสดุ ${nf.format(pendingParcelRows.length)} รายการแล้ว`);
}

function exportPendingParcels() {
  if (!pendingParcelRows.length) return toast("ยังไม่มีข้อมูลสำหรับ Export", true);
  const rows = pendingParcelRows.map((row, index) => ({
    "ลำดับ": index + 1,
    "เลขพัสดุ": row.pno,
    "เลขแบ็กกิ้ง": row.backingNo || "",
    "การดำเนินการล่าสุด": row.lastAction || row.status || "",
    "เวลาที่ดำเนินการล่าสุด": row.lastActionAt || "",
    "HUB ปลายทาง": row.targetHub || "",
    "สาขาปลายทาง": row.targetBranch || "",
  }));
  const ws = XLSX.utils.json_to_sheet(rows), wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "พัสดุยังไม่เข้า");
  XLSX.writeFile(wb, `พัสดุยังไม่เข้าคลัง_${new Date().toISOString().slice(0,10)}.xlsx`);
}

function arrivalSources(row) {
  if (!isDestination(row)) return "";
  if (!row.scheduleKitArrivalAt && !row.scheduleTbrArrivalAt)
    return '<div class="source-empty"><b>เวลา KIT / TBR</b><span>ยังไม่พบรายการที่ตรงกับรถคันนี้</span></div>';
  const earliest = [row.scheduleKitArrivalAt, row.scheduleTbrArrivalAt]
    .map(parseDate).filter(Boolean).sort((a, b) => a - b)[0];
  return `<div class="arrival-sources"><span>เวลาถึงจากระบบ</span><div><b>KIT <strong>${shortDateTime(row.scheduleKitArrivalAt)}</strong></b><b>TBR <strong>${shortDateTime(row.scheduleTbrArrivalAt)}</strong></b></div>${earliest ? `<small>ใช้เวลาที่มาก่อน · ${shortDateTime(earliest)}</small>` : ""}</div>`;
}

function tableRow(row) {
  const status = routeState(row);
  const p = punctuality(row);
  const q = queueInfo(row);
  const drop = isDrop(row) ? dropOperation(row) : null;
  const workStatus = isDestination(row)
    ? row.loadStatus || status.label
    : isDrop(row)
      ? drop.unloadingLabel
      : row.vehicleStatus || status.label;
  const queueText = q.done
    ? "เสร็จแล้ว"
    : q.expired
      ? "ตัดจากคิวเกิน 12 ชม."
      : q.active
        ? "อยู่ในคิว"
        : "ยังไม่เริ่ม";
  const wait = isDestination(row) ? waitInfo(row) : null;
  const durationHtml = isDrop(row)
    ? dropProgressHtml(drop)
    : isDestination(row)
      ? wait.minutes === null
        ? '<span class="row-muted">รถยังไม่มาถึง</span>'
        : `<div class="duration-line ${wait.over ? "is-late" : "is-ok"}"><strong>${nf.format(wait.minutes)} นาที</strong><span>ตั้งแต่รถถึง · มาตรฐาน ${nf.format(wait.standard)} นาที</span></div>`
      : p.diff === null
        ? '<span class="row-muted">รอเวลาออกจริง</span>'
        : `<div class="duration-line ${p.diff > 0 ? "is-late" : "is-ok"}"><strong>${nf.format(Math.abs(p.diff))} นาที</strong><span>${p.diff > 0 ? "ปล่อยช้ากว่าแผน" : "ปล่อยก่อนแผน"}</span></div>`;
  const attendanceClass = isDestination(row) ? "inbound" : isDrop(row) ? "drop" : "outbound";
  const scheduleHtml = isDestination(row)
    ? scheduleSection(row, "arrival")
    : `${scheduleSection(row, "arrival")}${scheduleSection(row, "departure")}`;
  return `<tr>
    <td><div class="route-summary"><div class="route-code"><strong>${esc(row.proofId || "-")}</strong><span>${esc(row.vehicleType || "-")}</span></div><div class="route-title">${esc(row.routeName || "-")}</div><div class="route-plate">ทะเบียน ${esc(row.plate || "-")}</div>${expectedParcelsBadge(row)}</div></td>
    <td><div class="route-meta route-meta-grid"><span><b>ภูมิภาค</b><em class="meta-chip">${esc(row.region || "-")}</em></span><span><b>ลักษณะ</b><em class="meta-chip">${esc(row.routeAttribute || "-")}</em></span><span><b>เส้นทาง</b><em class="meta-chip">${esc(row.routeType || "-")}</em></span></div></td>
    <td><div class="attendance-cell"><span class="type-badge ${attendanceClass}">${esc(normalizeAttendance(row.attendanceType) || "-")}</span><div class="row-muted">${attendanceLabel(row)}</div></div></td>
    <td><div class="schedule-stack ${isDestination(row) ? "single" : "dual"}">${scheduleHtml}</div></td>
    <td><div class="work-summary"><div class="work-badge ${q.expired ? "expired" : status.key}"><span class="status-dot"></span><strong>${esc(workStatus)}</strong></div>${durationHtml}${departureCountdownHtml(row)}<small class="queue-label">${esc(queueText)}</small>${arrivalSources(row)}</div></td>
    <td><div class="people-summary"><strong>${esc(row.supplier || "-")}</strong><span>${esc(row.driverName || "ไม่พบชื่อคนขับ")}</span>${row.driverPhone ? `<a class="phone-chip" href="tel:${esc(row.driverPhone)}">${esc(row.driverPhone)}</a>` : ""}</div></td>
  </tr>`;
}

function card(row) {
  const status = routeState(row);
  const wait = waitInfo(row),
    p = punctuality(row),
    q = queueInfo(row);
  const drop = isDrop(row) ? dropOperation(row) : null;
  const workStatus = isDestination(row)
    ? row.loadStatus || status.label
    : isDrop(row)
      ? drop.onwardLabel
    : row.vehicleStatus || status.label;
  const attendanceClass = isDestination(row)
      ? "inbound"
      : isDrop(row)
        ? "drop"
        : "outbound",
    plan = isDestination(row) ? row.estimatedArrivalAt : row.estimatedDepartureAt,
    actual = isDestination(row) ? row.actualArrivalAt : row.actualDepartureAt,
    timingClass = p.diff === null ? "neutral" : p.diff > 0 ? "late" : "ontime",
    timingText = p.diff === null
      ? "รอเวลาจริง"
      : `${p.diff > 0 ? "ช้ากว่าแผน" : "ก่อนแผน"} ${nf.format(Math.abs(p.diff))} นาที`,
    durationText = isDrop(row)
      ? drop.unloadingLabel
      : isDestination(row)
      ? wait.minutes === null
        ? "ยังไม่เริ่มจับเวลา"
        : `${nf.format(wait.minutes)} นาที`
      : p.diff === null
        ? "รอเวลาออกจริง"
        : `${nf.format(Math.abs(p.diff))} นาที`,
    durationNote = isDrop(row)
      ? drop.unloadingMinutes === null
        ? "รอเวลาถึงจริง"
        : `ลงของ ${nf.format(drop.unloadingMinutes)} นาที`
      : isDestination(row)
      ? `มาตรฐาน ${nf.format(wait.standard)} นาที`
      : p.diff === null
        ? ""
        : p.diff > 0
          ? "ปล่อยช้ากว่าแผน"
          : "ปล่อยก่อนแผน",
    queueText = isDrop(row)
      ? drop.onwardMinutes === null
        ? "รอขั้นตอนลงของ"
        : `ขึ้นงาน/รอออก ${nf.format(drop.onwardMinutes)} นาที`
      : q.done
      ? "เก็บในประวัติแล้ว"
      : q.expired
        ? "ตัดออกจากคิวเกิน 12 ชม."
        : q.active
          ? "อยู่ในคิวปัจจุบัน"
          : "ยังไม่เข้าคิว";
  const compactSchedule = isDestination(row)
    ? scheduleSection(row, "arrival")
    : `${scheduleSection(row, "arrival")}${scheduleSection(row, "departure")}`;
  return `<article class="truck-card ms-card compact-card">
    <header class="compact-card-head"><div class="compact-card-tags"><span class="type-badge ${attendanceClass}">${esc(normalizeAttendance(row.attendanceType) || "-")}</span><span class="vehicle-chip">${esc(row.vehicleType || "-")}</span></div><h2>${esc(row.routeName || "-")}</h2><p>${esc(row.proofId || "-")} · ทะเบียน ${esc(row.plate || "-")}</p>${expectedParcelsBadge(row)}</header>
    <div class="compact-meta"><span><b>ภูมิภาค</b>${esc(row.region || "-")}</span><span><b>ลักษณะ</b>${esc(row.routeAttribute || "-")}</span><span><b>เส้นทาง</b>${esc(row.routeType || "-")}</span></div>
    <div class="compact-times compact-schedule">${compactSchedule}</div>
    <div class="compact-operation ${isDestination(row) && wait.over ? "late" : ""}"><div><span>${isDestination(row) ? "เวลารอ + ลงงาน" : "เวลาเทียบแผน"}</span><strong>${esc(durationText)}</strong><small>${esc(durationNote)}</small></div><div><span>สถานะล่าสุด</span><strong>${esc(workStatus)}</strong><small>${esc(queueText)}</small></div></div>
    ${isDrop(row) ? dropProgressHtml(drop, true) : ""}${departureCountdownHtml(row)}
    ${arrivalSources(row)}
    <div class="compact-party"><div><span>บริษัทซัพ</span><strong>${esc(row.supplier || "ไม่พบชื่อบริษัทซัพ")}</strong></div><div><span>คนขับรถ</span><strong>${esc(row.driverName || "ไม่พบชื่อคนขับ")}</strong></div>${row.driverPhone ? `<a class="compact-phone" href="tel:${esc(row.driverPhone)}"><span>โทร</span>${esc(row.driverPhone)}</a>` : ""}</div>
  </article>`;
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
  const start = confirmedEffectiveArrival(row),
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

function displayDateToIso(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return String(value);
  const match = String(value || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return "";
  const [, day, month, year] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00`);
  if (
    isNaN(date) ||
    date.getFullYear() !== Number(year) ||
    date.getMonth() + 1 !== Number(month) ||
    date.getDate() !== Number(day)
  ) return "";
  return `${year}-${month}-${day}`;
}

function setupDateInput(id) {
  const input = el(id);
  input.oninput = () => {
    state[id === "date-from" ? "dateFrom" : "dateTo"] = displayDateToIso(input.value);
    render();
  };
  input.onclick = () => input.showPicker?.();
  input.onchange = () => {
    state[id === "date-from" ? "dateFrom" : "dateTo"] = displayDateToIso(input.value);
    render();
  };
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
    `<strong>${esc(message)}</strong><span>ระบบจะตรวจสถานะ MS ใหม่ทุก 4 วินาทีขณะมีผู้เปิดดู</span>`;
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
  const hubInput = el("ms-har-hub");
  hubInput.value = state.branch || state.auth?.branches?.[0] || "NE1";
  hubInput.readOnly = state.auth?.role !== "admin";
  hubInput.title = hubInput.readOnly
    ? "บัญชีนี้เชื่อมต่อได้เฉพาะ HUB ที่ได้รับสิทธิ์"
    : "ADMIN สามารถเลือก HUB ที่ต้องการตรวจสอบได้";
  ["ms-har-routes", "ms-har-preentry", "ms-har-bustime"].forEach((id) => { el(id).value = ""; });
  el("ms-connection-error").classList.add("hidden");
  el("ms-qr-status").textContent =
    "ลิงก์เชื่อมต่อมีอายุ 10 นาที และใช้ได้ครั้งเดียว";
  el("ms-connection-dialog").showModal();
  loadMsConnectionStatus();
}

async function loadMsConnectionStatus() {
  const hub = el("ms-har-hub").value.trim().toUpperCase();
  try {
    const status = await apiGet("msConnectionStatus", { branch: hub });
    for (const key of ["routes", "preEntry", "busTime"]) {
      const node = document.querySelector(`[data-source-status="${key}"] span`);
      const item = status[key];
      if (!node) continue;
      node.className = item?.configured ? (item.lastError ? "source-error" : "source-ok") : "source-missing";
      node.textContent = !item?.configured
        ? "ยังไม่ได้อัปโหลด"
        : item.lastError
          ? `เชื่อมต่อมีปัญหา · ${item.lastError}`
          : `พร้อมใช้งาน · อัปเดตล่าสุด ${shortDateTime(item.lastSuccessAt || item.updatedAt)}`;
    }
  } catch (error) {
    const box = el("ms-connection-error");
    box.textContent = error.message;
    box.classList.remove("hidden");
  }
}

async function startQrConnection() {
  const hub = el("ms-har-hub").value.trim().toUpperCase(),
    status = el("ms-qr-status"),
    button = el("ms-qr-connect");
  if (!hub) return toast("กรุณาระบุ HUB", true);
  try {
    button.disabled = true;
    status.textContent = "กำลังสร้างหน้าสแกน QR...";
    const result = await apiPost("createMsPairing", { hub });
    const popup = window.open(result.browserUrl, "ms-cloud-browser");
    if (!popup)
      throw new Error(
        "เบราว์เซอร์บล็อกหน้าต่างใหม่ กรุณาอนุญาต Pop-up แล้วลองอีกครั้ง",
      );
    status.textContent =
      "เปิดหน้า MS แล้ว กรุณาสแกน QR และกด “ตรวจหลังสแกน” ในหน้าที่เปิดใหม่";
    const deadline = Date.parse(result.expiresAt);
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const check = await apiGet("msPairingStatus", {
        pairing: result.pairing,
      });
      if (check.status === "COMPLETED") {
        state.branch = hub;
        status.textContent = `เชื่อมต่อ ${hub} สำเร็จ ระบบบันทึก Session แล้ว`;
        toast(`เชื่อมต่อ ${hub} สำเร็จ`);
        await loadData();
        return;
      }
      if (check.status === "EXPIRED")
        throw new Error("ลิงก์หมดอายุ กรุณากดเชื่อมต่อใหม่");
    }
    throw new Error("หมดเวลารอการสแกน กรุณากดเชื่อมต่อใหม่");
  } catch (error) {
    status.textContent = error.message;
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function saveMsConnection(source, button) {
  const errorEl = el("ms-connection-error"),
    inputId = source === "routes" ? "ms-har-routes" : source === "preEntry" ? "ms-har-preentry" : "ms-har-bustime",
    file = el(inputId).files[0],
    hub = el("ms-har-hub").value.trim().toUpperCase();
  try {
    button.disabled = true;
    const maxHarMb = source === "busTime" ? 250 : 60;
    if (!file || file.size > maxHarMb * 1024 * 1024)
      throw new Error(`กรุณาเลือกไฟล์ HAR ขนาดไม่เกิน ${maxHarMb} MB`);
    const har = JSON.parse(await file.text());
    const entries = har.log?.entries || [];
    const entry = entries.find((item) => {
      try {
        return (
          new URL(item.request?.url).pathname ===
            "/gw/nws/staff/ms/store/line/task" && item.response?.status === 200
        );
      } catch {
        return false;
      }
    });
    const preEntry = entries.find((item) => {
      try {
        return new URL(item.request?.url).pathname.includes("/api/route/route_followstart") && item.response?.status === 200;
      } catch { return false; }
    });
    const busEntry = entries.find((item) => {
      try {
        return new URL(item.request?.url).pathname === "/api/fleet_time/getList" && item.response?.status === 200;
      } catch { return false; }
    });
    if (!entry && !preEntry && !busEntry)
      throw new Error("ไม่พบข้อมูลเส้นทาง พัสดุเข้าคลัง หรือการจัดการตารางเวลาในไฟล์ HAR");
    if (source === "routes" && !entry) throw new Error("ไฟล์นี้ไม่มีข้อมูลบันทึกสถานะเส้นทางเดินรถ");
    if (source === "preEntry" && !preEntry) throw new Error("ไฟล์นี้ไม่มีข้อมูลพัสดุที่คาดว่าจะเข้าคลัง");
    if (source === "busTime" && !busEntry) throw new Error("ไฟล์นี้ไม่มีข้อมูลการจัดการตารางเวลา KIT/TBR");
    if (source === "preEntry") {
      const url = new URL(preEntry.request.url);
      const credentials = {};
      for (const key of ["lang", "auth", "fbid", "time", "_from", "nonce", "referer", "iv", "next_store_id"])
        credentials[key] = url.searchParams.get(key) || "";
      const result = await apiPost("saveMsPreEntryConnection", { hub, credentials });
      errorEl.classList.add("hidden");
      toast(`เชื่อมข้อมูลพัสดุเข้าคลัง ${hub} สำเร็จ · พบ ${nf.format(result.total)} เที่ยว`);
      await loadData();
      await loadMsConnectionStatus();
      return;
    }
    if (source === "busTime") {
      const url = new URL(busEntry.request.url);
      const credentials = {};
      for (const key of ["auth", "lang", "fbid", "time", "_from"])
        credentials[key] = url.searchParams.get(key) || "";
      const result = await apiPost("saveMsBusConnection", { hub, credentials });
      errorEl.classList.add("hidden");
      toast(`เชื่อมข้อมูลการจัดการตารางเวลา ${hub} สำเร็จ · พบ ${nf.format(result.total)} รายการ`);
      await loadData();
      await loadMsConnectionStatus();
      return;
    }
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
    state.branch = hub;
    toast(`เชื่อมต่อ ${hub} สำเร็จ · พบ ${nf.format(result.total)} รายการ`);
    await loadData();
    await loadMsConnectionStatus();
  } catch (error) {
    errorEl.textContent = error.message;
    errorEl.classList.remove("hidden");
  } finally {
    button.disabled = false;
  }
}

function exportCurrent() {
  if (!state.dateFrom || !state.dateTo)
    return toast("เลือกวันที่เริ่มต้นและสิ้นสุดก่อน Export", true);
  downloadRows(
    `MS_รายวัน_${state.branch}_${state.dateFrom}_${state.dateTo}.csv`,
    dedupeRoutes(state.rows.filter((row) => {
      const day = localDateValue(row.actualArrivalAt || row.estimatedArrivalAt);
      return day >= state.dateFrom && day <= state.dateTo;
    })).map(exportRow),
  );
}
function exportVisible() {
  const rows = dedupeRoutes(filteredRows());
  downloadRows(
    `MS_ตารางปัจจุบัน_${state.branch}_${localDateValue(new Date())}.csv`,
    rows.map(exportRow),
  );
  if (rows.length) toast(`Export ตารางที่แสดง ${nf.format(rows.length)} เที่ยวแล้ว`);
}

async function captureVisibleTable() {
  const rows = dedupeRoutes(filteredRows());
  if (!rows.length) return toast("ไม่มีข้อมูลในตารางสำหรับแคป", true);
  const button = el("capture-table-btn");
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "กำลังสร้างภาพ…";
  let stage;
  let svgUrl;
  try {
    const width = 1800;
    stage = document.createElement("section");
    stage.className = "capture-stage ms-page";
    stage.style.width = `${width}px`;
    stage.style.position = "static";
    stage.style.left = "auto";
    stage.style.top = "auto";
    stage.innerHTML = `<header class="capture-title"><strong>ติดตามเส้นทาง MS · ${esc(state.branch)}</strong><span>${esc(new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date()))}</span></header>`;
    const table = document.querySelector("#desktop-table .ms-table")?.cloneNode(true);
    if (!table) throw new Error("ไม่พบตารางที่จะแคป");
    stage.append(table);
    document.body.append(stage);
    await document.fonts?.ready;
    const height = Math.ceil(stage.scrollHeight);
    const css = [...document.styleSheets].map((sheet) => {
      try { return [...sheet.cssRules].map((rule) => rule.cssText).join("\n"); }
      catch { return ""; }
    }).join("\n");
    const xhtml = new XMLSerializer().serializeToString(stage);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml"><style>${css}</style>${xhtml}</div></foreignObject></svg>`;
    svgUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("เบราว์เซอร์ไม่สามารถสร้างภาพจากตารางได้"));
      image.src = svgUrl;
    });
    const scale = Math.min(1, 30000 / height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("ไม่สามารถสร้าง Canvas ได้");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png", 1));
    if (!png) throw new Error("สร้างไฟล์ภาพไม่สำเร็จ");
    const pngUrl = URL.createObjectURL(png);
    const link = document.createElement("a");
    link.href = pngUrl;
    link.download = `MS_ตาราง_${state.branch}_${localDateValue(new Date())}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(pngUrl), 1500);
    toast(`บันทึกภาพตาราง ${nf.format(rows.length)} เที่ยวแล้ว`);
  } catch (error) {
    toast(`แคปตารางไม่สำเร็จ: ${error.message}`, true);
  } finally {
    stage?.remove();
    if (svgUrl) URL.revokeObjectURL(svgUrl);
    button.disabled = false;
    button.textContent = originalText;
  }
}
async function exportHistory() {
  try {
    if (!state.archiveLoaded) {
      const archive = await apiGet("msArchive", { branch: state.branch });
      state.archiveRows = Array.isArray(archive?.rows) ? archive.rows : [];
      state.archiveLoaded = true;
    }
    const rows = dedupeRoutes(state.archiveRows);
    downloadRows(
      `MS_ประวัติ_${state.branch}_${localDateValue(new Date())}.csv`,
      rows.map(exportRow),
    );
    toast(`Export ทั้งหมด ${nf.format(rows.length)} เที่ยวแล้ว`);
  } catch (error) {
    toast(error.message, true);
  }
}
function dedupeRoutes(rows) {
  const latest = new Map();
  for (const row of rows || []) {
    const key =
      row.id ||
      [
        row.hub,
        row.proofId,
        row.routeName,
        row.estimatedArrivalAt,
        row.estimatedDepartureAt,
      ].join("|");
    const previous = latest.get(key);
    const time =
      parseDate(
        row.sourceUpdatedAt || row.syncedAt || row.archivedAt,
      )?.getTime() || 0;
    const previousTime =
      parseDate(
        previous?.sourceUpdatedAt || previous?.syncedAt || previous?.archivedAt,
      )?.getTime() || 0;
    if (!previous || time >= previousTime) latest.set(key, row);
  }
  return [...latest.values()];
}
function exportRow(row) {
  const wait = waitInfo(row),
    status = routeState(row),
    p = punctuality(row),
    q = queueInfo(row);
  const drop = isDrop(row) ? dropOperation(row) : null;
  return {
    snapshotAt: exportThaiDate(
      row.archivedAt || row.snapshotAt || row.syncedAt,
    ),
    hub: row.hub || state.branch,
    proofId: excelText(row.proofId),
    routeName: row.routeName || "",
    routeAttribute: row.routeAttribute || "",
    routeType: row.routeType || "",
    region: row.region || "",
    attendanceType: row.attendanceType || "",
    vehicleType: row.vehicleType || "",
    plate: excelText(row.plate),
    estimatedArrivalAt: exportThaiDate(row.estimatedArrivalAt),
    actualArrivalAt: exportThaiDate(confirmedEffectiveArrival(row)),
    routeActualArrivalAt: exportThaiDate(row.actualArrivalAt),
    scheduleKitArrivalAt: exportThaiDate(row.scheduleKitArrivalAt),
    scheduleTbrArrivalAt: exportThaiDate(row.scheduleTbrArrivalAt),
    arrivalPunctuality: isDestination(row) ? p.label : "",
    unloadingCompletedAt: exportThaiDate(row.unloadingCompletedAt),
    unloadingState: row.unloadingState ?? "",
    dropUnloadStatus: drop?.unloadingLabel || "",
    dropUnloadMinutes: drop?.unloadingMinutes ?? "",
    dropOnwardStatus: drop?.onwardLabel || "",
    dropOnwardMinutes: drop?.onwardMinutes ?? "",
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
    driverPhone: excelText(row.driverPhone),
    kitArrivalAt: exportThaiDate(row.scheduleKitArrivalAt),
    tbrArrivalAt: exportThaiDate(row.scheduleTbrArrivalAt),
    expectedParcels: isDestination(row) ? (row.expectedParcels ?? "") : "",
    enteredParcels: isDestination(row) ? (row.enteredParcels ?? "") : "",
    pendingParcels: isDestination(row) ? (row.pendingParcels ?? "") : "",
    arrivedParcels: isDestination(row) ? (row.arrivedParcels ?? "") : "",
    arrivedBags: isDestination(row) ? (row.arrivedBags ?? "") : "",
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
      hourCycle: "h23",
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
  if (/^[=+\-@]/.test(text) && !/^="[^"]*"$/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function excelText(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return `="${text.replace(/"/g, '""')}"`;
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
