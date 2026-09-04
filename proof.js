const CONFIG = {
  apiBase: location.hostname.endsWith('.workers.dev')
    ? location.origin
    : 'https://waiting-trucks-report-api-dev.26nak-testdev.workers.dev',
  pollMs: 30_000,
  staleMs: 90_000,
  requestTimeoutMs: 35_000,
};

const AUTH_KEY = 'bnak_operator_auth_v2';
const STATE_LABELS = {
  1: 'บาร์โค้ดรถรอเปิดใช้งาน',
  2: 'บาร์โค้ดรถเปิดใช้งานแล้ว',
  7: 'ถึงสาขาต้นทาง',
  3: 'รถออกแล้ว',
  4: 'งานเส้นทางวิ่งจบแล้ว',
  6: 'งานเส้นทางรถที่รอยกเลิก',
  5: 'งานเส้นทางยกเลิกเรียบร้อยแล้ว',
};
const PRINTABLE_STATES = new Set([1, 2, 7]);

const state = {
  auth: loadAuth(),
  rows: [],
  profile: null,
  branch: 'NE1',
  day: thaiDay(),
  stateFilter: 'all',
  lineType: 'all',
  vehicle: 'all',
  query: '',
  checkedAt: '',
  changedAt: '',
  loading: false,
  lastTransportOk: 0,
};

const el = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('th-TH');
const dtf = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok',
  dateStyle: 'medium',
  timeStyle: 'medium',
  hour12: false,
});

window.addEventListener('DOMContentLoaded', () => {
  el('day-filter').value = state.day;
  bindEvents();
  applyAuthBranch();
  authUi();
  clock();
  setInterval(clock, 1000);
  setInterval(renderFreshness, 10_000);
  setInterval(() => state.auth && loadRoutes(true), CONFIG.pollMs);
  if (state.auth) loadAll(false);
});

function bindEvents() {
  el('refresh-btn').onclick = () => loadAll(false);
  el('login-btn').onclick = () => el('proof-login-dialog').showModal();
  el('login-close').onclick = closeLogin;
  el('login-form').onsubmit = login;
  el('logout-btn').onclick = logout;
  el('branch-filter').onchange = async (event) => {
    state.branch = String(event.target.value || 'NE1').toUpperCase();
    state.profile = null;
    resetFilters(false);
    await loadAll(false);
  };
  el('day-filter').onchange = async (event) => {
    state.day = event.target.value || thaiDay();
    state.stateFilter = 'all';
    el('state-filter').value = 'all';
    await loadRoutes(false);
  };
  el('line-type-filter').onchange = (event) => {
    state.lineType = event.target.value;
    render();
  };
  el('state-filter').onchange = (event) => {
    state.stateFilter = event.target.value;
    render();
  };
  el('vehicle-filter').onchange = (event) => {
    state.vehicle = event.target.value;
    render();
  };
  el('search-input').oninput = (event) => {
    state.query = event.target.value.trim().toLowerCase();
    render();
  };
  el('clear-filter-btn').onclick = () => {
    resetFilters(true);
    render();
  };
  document.querySelectorAll('[data-state]').forEach((card) => {
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.onclick = () => {
      state.stateFilter = card.dataset.state || 'all';
      el('state-filter').value = state.stateFilter;
      render();
    };
    card.onkeydown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        card.click();
      }
    };
  });
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-proof-print]');
    if (button) printRoute(button.dataset.proofPrint);
  });
}

async function loadAll(silent) {
  if (!state.auth) return authUi();
  await Promise.allSettled([loadProfile(silent), loadRoutes(silent)]);
}

async function loadProfile(silent = false) {
  if (!state.auth) return;
  try {
    const data = await apiGet('/api/proof/profile', {
      token: state.auth.token,
      branch: state.branch,
    });
    state.profile = data;
    renderProfile();
  } catch (error) {
    handleApiError(error, silent);
    renderProfile(error);
  }
}

async function loadRoutes(silent = false) {
  if (!state.auth || state.loading) return;
  state.loading = true;
  if (!silent) setLoading('กำลังโหลดสถานะเส้นทางจาก MS…');
  try {
    const data = await apiGet('/api/proof/routes', {
      token: state.auth.token,
      branch: state.branch,
      day: state.day,
    });
    state.rows = Array.isArray(data.rows) ? data.rows : [];
    state.checkedAt = data.checkedAt || '';
    state.changedAt = data.changedAt || '';
    state.lastTransportOk = Date.now();
    setFilterOptions();
    render();
    setConnection('connected');
  } catch (error) {
    handleApiError(error, silent);
    if (!silent) setLoading(error.message || 'โหลดข้อมูลไม่สำเร็จ', true);
    setConnection('error');
  } finally {
    state.loading = false;
  }
}

function render() {
  if (!state.auth) {
    setLoading('กรุณาเข้าสู่ระบบเพื่อดูข้อมูล');
    return;
  }

  const rows = filteredRows();
  renderMetrics();
  renderFilterActive();
  el('visible-count').textContent = `แสดง ${nf.format(rows.length)} จาก ${nf.format(state.rows.length)} รายการ`;
  el('last-sync').textContent = state.checkedAt
    ? `MS ล่าสุด ${dtf.format(new Date(state.checkedAt))}`
    : 'ยังไม่มีเวลาอัปเดต';
  renderFreshness();

  if (!rows.length) {
    el('loading-state').classList.add('hidden');
    el('desktop-table').classList.add('hidden');
    el('mobile-cards').classList.add('hidden');
    el('empty-state').classList.remove('hidden');
    return;
  }

  el('loading-state').classList.add('hidden');
  el('empty-state').classList.add('hidden');
  el('desktop-table').classList.remove('hidden');
  el('mobile-cards').classList.remove('hidden');
  el('table-body').innerHTML = rows.map(tableRow).join('');
  el('mobile-cards').innerHTML = rows.map(mobileCard).join('');
}

function renderMetrics() {
  el('metric-all').textContent = nf.format(state.rows.length);
  for (const code of [1, 2, 7, 3, 4, 6, 5]) {
    const count = state.rows.filter((row) => Number(row.proofState) === code).length;
    el(`metric-${code}`).textContent = nf.format(count);
  }
}

function renderFilterActive() {
  document.querySelectorAll('[data-state]').forEach((card) => {
    card.classList.toggle('is-active', String(card.dataset.state) === String(state.stateFilter));
  });
}

function tableRow(row) {
  return `<tr>
    <td class="proof-route"><strong>${esc(row.lineName || '—')}</strong><small>${esc(routeMeta(row))}</small></td>
    <td class="proof-car"><strong>${esc(row.plateNumber || 'ยังไม่กำหนดทะเบียน')}</strong><small>${esc(row.plateTypeText || '—')}</small></td>
    <td class="proof-driver"><strong>${esc(row.driver || 'ยังไม่กำหนดคนขับ')}</strong><small>${esc(row.driverPhone || '—')}</small></td>
    <td><strong>${esc(timeRange(row))}</strong><small>${esc(row.departureDate || '')}</small></td>
    <td><strong>${esc(row.proofId || '—')}</strong></td>
    <td>${stateBadge(row)}</td>
    <td>${actionButtons(row)}</td>
  </tr>`;
}

function mobileCard(row) {
  return `<article class="proof-card">
    <div class="proof-card-top"><h3>${esc(row.lineName || '—')}</h3>${stateBadge(row)}</div>
    <div class="proof-card-grid">
      <div><small>รถ / ทะเบียน</small><strong>${esc([row.plateTypeText, row.plateNumber].filter(Boolean).join(' / ') || 'ยังไม่กำหนด')}</strong></div>
      <div><small>บาร์โค้ดรถ</small><strong>${esc(row.proofId || '—')}</strong></div>
      <div><small>คนขับ</small><strong>${esc(row.driver || 'ยังไม่กำหนด')}</strong></div>
      <div><small>เบอร์โทร</small><strong>${esc(row.driverPhone || '—')}</strong></div>
      <div><small>เวลาแผน</small><strong>${esc(timeRange(row))}</strong></div>
      <div><small>ประเภทเส้นทาง</small><strong>${esc(routeMeta(row))}</strong></div>
    </div>
    ${actionButtons(row)}
  </article>`;
}

function stateBadge(row) {
  const code = Number(row.proofState);
  const label = row.proofStateText || STATE_LABELS[code] || `สถานะ ${code || '—'}`;
  return `<span class="proof-state s${Number.isFinite(code) ? code : ''}">${esc(label)}</span>`;
}

function actionButtons(row) {
  const code = Number(row.proofState);
  const canPrint = Boolean(state.profile?.canPrint) && PRINTABLE_STATES.has(code);
  const canCreate = code !== 1 || Boolean(state.profile?.canCreateProof);
  const enabled = canPrint && canCreate && Boolean(row.lineId) && Boolean(row.departureDate);
  const label = code === 1 ? 'เปิดใช้ + ปริ้น' : 'ปริ้น PDF';
  const printTitle = !state.profile?.canPrint
    ? 'บัญชี MS นี้ไม่มีสิทธิ์ปริ้น'
    : code === 1 && !state.profile?.canCreateProof
      ? 'บัญชี MS นี้ไม่มีสิทธิ์เปิดใช้งานบาร์โค้ด'
      : !PRINTABLE_STATES.has(code)
        ? 'สถานะนี้ไม่รองรับการปริ้นจากหน้าเว็บ'
        : '';
  return `<div class="proof-actions">
    <button class="btn btn-accent" type="button" data-proof-print="${escAttr(rowKey(row))}" ${enabled ? '' : 'disabled'} title="${escAttr(printTitle)}">${esc(label)}</button>
    <button class="btn btn-danger-soft" type="button" disabled title="ยังไม่เปิดใช้เพื่อป้องกันผลกระทบหน้างาน">ยกเลิกรถ</button>
  </div>`;
}

function filteredRows() {
  const query = state.query;
  return state.rows.filter((row) => {
    if (state.stateFilter !== 'all' && String(row.proofState ?? '') !== state.stateFilter) return false;
    if (state.lineType !== 'all' && lineTypeKey(row) !== state.lineType) return false;
    if (state.vehicle !== 'all' && vehicleKey(row) !== state.vehicle) return false;
    if (!query) return true;
    const haystack = [
      row.lineName, row.lineTypeText, row.lineModeText, row.plateNumber, row.plateTypeText,
      row.driver, row.driverPhone, row.proofId, row.proofStateText, row.departureDate,
    ].join(' ').toLowerCase();
    return haystack.includes(query);
  }).sort((a, b) => {
    const stateOrder = Number(a.proofState || 99) - Number(b.proofState || 99);
    if (stateOrder) return stateOrder;
    return (Number(a.startTime) || 0) - (Number(b.startTime) || 0);
  });
}

function setFilterOptions() {
  preserveOptions(el('line-type-filter'), uniqueOptions(state.rows, lineTypeKey, (row) => row.lineTypeText || String(row.lineType ?? '')));
  preserveOptions(el('vehicle-filter'), uniqueOptions(state.rows, vehicleKey, (row) => row.plateTypeText || 'ไม่ระบุประเภทรถ'));
  if (![...el('line-type-filter').options].some((option) => option.value === state.lineType)) state.lineType = 'all';
  if (![...el('vehicle-filter').options].some((option) => option.value === state.vehicle)) state.vehicle = 'all';
  el('line-type-filter').value = state.lineType;
  el('vehicle-filter').value = state.vehicle;
}

function uniqueOptions(rows, valueFn, labelFn) {
  const map = new Map();
  rows.forEach((row) => {
    const value = valueFn(row);
    if (value && value !== 'all') map.set(value, labelFn(row) || value);
  });
  return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'th'));
}

function preserveOptions(select, options) {
  const current = select.value || 'all';
  select.innerHTML = '<option value="all">ทั้งหมด</option>' + options.map(([value, label]) =>
    `<option value="${escAttr(value)}">${esc(label)}</option>`).join('');
  select.value = [...select.options].some((option) => option.value === current) ? current : 'all';
}

async function printRoute(key) {
  const row = state.rows.find((item) => rowKey(item) === key);
  if (!row || !state.auth) return;
  const code = Number(row.proofState);
  if (!PRINTABLE_STATES.has(code)) return;

  const msName = state.profile?.name || 'บัญชี MS ที่เชื่อมอยู่';
  const text = code === 1
    ? `เที่ยวนี้ยังรอเปิดบาร์โค้ด\n\n${row.lineName}\n\nระบบจะเปิดใช้งานบาร์โค้ดใน MS แล้วสร้าง PDF จริง\nชื่อผู้ดำเนินงานบนใบปริ้น: ${msName}\n\nยืนยันดำเนินการหรือไม่?`
    : `ปริ้นท์บาร์โค้ดประจำรถ\n\n${row.lineName}\n${row.proofId || ''}\n\nชื่อผู้ดำเนินงานบนใบปริ้น: ${msName}\n\nยืนยันดำเนินการหรือไม่?`;
  if (!confirm(text)) return;

  const preview = window.open('', '_blank');
  if (preview) {
    preview.document.write('<!doctype html><title>กำลังสร้าง PDF</title><body style="font-family:sans-serif;padding:24px">กำลังขอไฟล์ PDF จาก MS…</body>');
    preview.document.close();
  }

  setLive('กำลังปริ้นท์ผ่าน MS…', 'stale');
  try {
    const response = await fetchWithTimeout(`${CONFIG.apiBase}/api/proof/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: state.auth.token,
        branch: state.branch,
        lineId: row.lineId,
        departureDate: row.departureDate,
      }),
    });
    if (!response.ok) {
      let payload = null;
      try { payload = await response.json(); } catch {}
      throw apiError(payload?.message || `ปริ้นท์ไม่สำเร็จ (${response.status})`, payload?.code || 'PRINT_FAILED', response.status);
    }
    const blob = await response.blob();
    if (!String(blob.type || '').toLowerCase().includes('pdf')) throw apiError('MS ไม่ได้ส่ง PDF กลับมา', 'PRINT_INVALID_PDF', 502);
    const objectUrl = URL.createObjectURL(blob);
    if (preview) preview.location.replace(objectUrl);
    else window.open(objectUrl, '_blank');
    setTimeout(() => URL.revokeObjectURL(objectUrl), 120_000);
    setLive('ปริ้นท์สำเร็จ • กำลังอัปเดตสถานะล่าสุด', 'ok');
    await new Promise((resolve) => setTimeout(resolve, 800));
    await loadRoutes(true);
  } catch (error) {
    if (preview) preview.close();
    handleApiError(error, false);
    setLive(error.message || 'ปริ้นท์ไม่สำเร็จ', 'error');
    alert(error.message || 'ปริ้นท์ไม่สำเร็จ');
  }
}

async function login(event) {
  event.preventDefault();
  const username = el('login-username').value.trim();
  const pin = el('login-pin').value;
  el('login-error').classList.add('hidden');
  try {
    const response = await fetchWithTimeout(`${CONFIG.apiBase}/api`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', username, pin }),
    });
    const payload = await response.json();
    if (!response.ok || !payload?.ok) throw apiError(payload?.message || 'เข้าสู่ระบบไม่สำเร็จ', payload?.code || 'LOGIN_FAILED', response.status);
    state.auth = payload.data;
    localStorage.setItem(AUTH_KEY, JSON.stringify(state.auth));
    applyAuthBranch();
    closeLogin();
    authUi();
    await loadAll(false);
  } catch (error) {
    el('login-error').textContent = error.message || 'เข้าสู่ระบบไม่สำเร็จ';
    el('login-error').classList.remove('hidden');
  }
}

function logout() {
  state.auth = null;
  state.rows = [];
  state.profile = null;
  state.checkedAt = '';
  localStorage.removeItem(AUTH_KEY);
  authUi();
  renderProfile();
  renderMetrics();
  setLoading('กรุณาเข้าสู่ระบบเพื่อดูข้อมูล');
}

function loadAuth() {
  try {
    const auth = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
    if (!auth?.token || (auth.expiresAt && Date.now() > Number(auth.expiresAt))) return null;
    return auth;
  } catch { return null; }
}

function applyAuthBranch() {
  const branches = Array.isArray(state.auth?.branches) ? state.auth.branches.filter((item) => item && item !== '*') : [];
  if (branches.length && !branches.includes(state.branch)) state.branch = branches[0];
  const options = state.auth?.role === 'admin'
    ? [...new Set(['NE1', ...branches])]
    : (branches.length ? branches : ['NE1']);
  el('branch-filter').innerHTML = options.map((branch) => `<option value="${escAttr(branch)}">${esc(branch)}</option>`).join('');
  if (![...el('branch-filter').options].some((option) => option.value === state.branch)) state.branch = options[0] || 'NE1';
  el('branch-filter').value = state.branch;
}

function authUi() {
  const loggedIn = Boolean(state.auth?.token);
  el('login-btn').classList.toggle('hidden', loggedIn);
  el('logout-btn').classList.toggle('hidden', !loggedIn);
  if (!loggedIn) setConnection('logged-out');
}

function renderProfile(error) {
  if (state.profile) {
    el('ms-user-badge').textContent = `บัญชี MS: ${state.profile.organizationShortName || state.branch}`;
    el('ms-user-badge').className = 'badge badge-ok';
    el('ms-user-name').textContent = state.profile.name || 'ไม่พบชื่อบัญชี';
    el('ms-user-org').textContent = `${state.profile.organizationName || state.branch} • ชื่อบนใบปริ้นยึดจาก MS Session นี้`;
    return;
  }
  el('ms-user-badge').textContent = error ? 'บัญชี MS: อ่านไม่ได้' : 'บัญชี MS: ยังไม่ทราบ';
  el('ms-user-badge').className = 'badge badge-neutral';
  el('ms-user-name').textContent = '—';
  el('ms-user-org').textContent = error?.message || 'ชื่อบนใบปริ้นจะยึดจาก MS Session นี้';
}

function setConnection(mode) {
  const badge = el('connection-badge');
  if (mode === 'connected') {
    badge.textContent = 'MS เชื่อมต่อแล้ว';
    badge.className = 'badge badge-ok';
  } else if (mode === 'error') {
    badge.textContent = 'เชื่อม MS ไม่สำเร็จ';
    badge.className = 'badge badge-danger';
  } else if (mode === 'logged-out') {
    badge.textContent = 'ยังไม่ได้เข้าสู่ระบบ';
    badge.className = 'badge badge-neutral';
  } else {
    badge.textContent = 'กำลังเชื่อมต่อ';
    badge.className = 'badge badge-neutral';
  }
}

function setLoading(message, isError = false) {
  el('loading-state').textContent = message;
  el('loading-state').classList.remove('hidden');
  el('empty-state').classList.add('hidden');
  el('desktop-table').classList.add('hidden');
  el('mobile-cards').classList.add('hidden');
  setLive(message, isError ? 'error' : 'stale');
}

function renderFreshness() {
  if (!state.auth) return;
  const checked = Date.parse(state.checkedAt || '');
  if (!Number.isFinite(checked)) return setLive('ยังไม่มีข้อมูลจาก MS', 'stale');
  const age = Date.now() - checked;
  if (age <= CONFIG.staleMs) setLive(`ข้อมูลสด • ${Math.max(0, Math.round(age / 1000))} วินาทีที่แล้ว`, 'ok');
  else setLive(`ข้อมูลล่าสุด ${Math.round(age / 1000)} วินาทีที่แล้ว`, 'stale');
}

function setLive(message, status) {
  const live = el('live-status');
  live.textContent = message;
  live.className = `proof-live ${status || 'stale'}`;
}

function handleApiError(error, silent) {
  if (error?.code === 'INVALID_SESSION') {
    state.auth = null;
    localStorage.removeItem(AUTH_KEY);
    authUi();
    if (!silent) alert('สิทธิ์หมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง');
  }
}

async function apiGet(path, params) {
  const url = new URL(`${CONFIG.apiBase}${path}`);
  for (const [key, value] of Object.entries(params || {})) if (value !== undefined && value !== null) url.searchParams.set(key, value);
  const response = await fetchWithTimeout(url.toString(), { cache: 'no-store' });
  let payload = null;
  try { payload = await response.json(); } catch {}
  if (!response.ok || !payload?.ok) throw apiError(payload?.message || `โหลดข้อมูลไม่สำเร็จ (${response.status})`, payload?.code || 'API_ERROR', response.status);
  return payload.data;
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw apiError('การเชื่อมต่อใช้เวลานานเกินไป กรุณาลองใหม่', 'REQUEST_TIMEOUT', 504);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function apiError(message, code, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function resetFilters(includeSearch) {
  state.stateFilter = 'all';
  state.lineType = 'all';
  state.vehicle = 'all';
  if (includeSearch) state.query = '';
  el('state-filter').value = 'all';
  el('line-type-filter').value = 'all';
  el('vehicle-filter').value = 'all';
  if (includeSearch) el('search-input').value = '';
}

function closeLogin() {
  el('proof-login-dialog').close();
  el('login-pin').value = '';
  el('login-error').classList.add('hidden');
}

function routeMeta(row) {
  return [row.lineTypeText, row.lineModeText].filter(Boolean).join(' • ') || '—';
}
function lineTypeKey(row) { return row.lineType == null ? `T:${row.lineTypeText || 'unknown'}` : String(row.lineType); }
function vehicleKey(row) { return row.plateType == null ? `V:${row.plateTypeText || 'unknown'}` : String(row.plateType); }
function rowKey(row) { return `${row.lineId || ''}|${row.departureDate || ''}`; }
function timeRange(row) { return `${minuteText(row.startTime)} – ${minuteText(row.endTime)}`; }
function minuteText(value) {
  const total = Number(value);
  if (!Number.isFinite(total)) return '—';
  const days = Math.floor(total / 1440);
  const minute = ((Math.round(total) % 1440) + 1440) % 1440;
  const hh = String(Math.floor(minute / 60)).padStart(2, '0');
  const mm = String(minute % 60).padStart(2, '0');
  return `${hh}:${mm}${days > 0 ? ` +${days}วัน` : ''}`;
}
function thaiDay() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}
function clock() {
  el('live-clock').textContent = new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'medium', hour12: false,
  }).format(new Date());
}
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function escAttr(value) { return esc(value).replace(/`/g, '&#96;'); }
