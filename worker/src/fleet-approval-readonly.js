// FLEET_APPROVAL_READONLY_DEV_V1
// One deliberate user click => at most one allowlisted provider POST.
// No scheduled work, retries, writes, credential exports, or implied HUB-wide scope.
export const FLEET_PAGE_SIZE = 20;
const MS_HOST = "https://ms-api.flashexpress.com";
const PATHS = Object.freeze({
  monitor: "/gw/nws/staff/ms/fleet/line/approve/monitor/list/find",
  audit: "/gw/nws/staff/ms/fleet/line/audit/list",
});
const APPROVAL_CODES = new Set(["1", "2", "3", "4", "10"]);
const MONITOR_CODES = new Set(["8", "9", "14"]);
function fail(message, code, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}
function validDay(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ""))) return false;
  const t = Date.parse(s + "T00:00:00Z");
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}
export function fleetReadEnabled(env) {
  return String(env?.FLEET_APPROVAL_READ_ENABLED || "") === "1";
}
export function validateFleetPageQuery(input) {
  const source = String(input?.source || "");
  if (!Object.prototype.hasOwnProperty.call(PATHS, source))
    fail("ประเภทการค้นหาไม่ถูกต้อง", "FLEET_INVALID_SOURCE");
  const start = String(input?.start || ""), end = String(input?.end || "");
  if (!validDay(start) || !validDay(end))
    fail("กรุณาเลือกวันที่ให้ถูกต้อง", "FLEET_INVALID_DATE");
  const dayCount = Math.round((Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / 86400000);
  if (dayCount < 0 || dayCount > 13)
    fail("เลือกช่วงได้ไม่เกิน 14 วัน", "FLEET_INVALID_RANGE");
  const page = Number(input?.page ?? 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 50)
    fail("หมายเลขหน้าไม่ถูกต้อง", "FLEET_INVALID_PAGE");
  const status = String(input?.status || (source === "audit" ? "1" : "9"));
  if (source === "audit" && !APPROVAL_CODES.has(status))
    fail("รหัสสถานะอนุมัติไม่ถูกต้อง", "FLEET_INVALID_STATUS");
  if (source === "monitor" && !MONITOR_CODES.has(status))
    fail("รหัสสถานะงานรถไม่ถูกต้อง", "FLEET_INVALID_STATUS");
  return { source, start, end, page, status };
}
export function buildFleetProviderBody(raw) {
  const q = validateFleetPageQuery(raw);
  if (q.source === "audit") {
    return {
      serial_no: "", region: null, store_category: "", start_store_id: null,
      end_store_id: null, audit_type: null, status: [Number(q.status)],
      page_size: FLEET_PAGE_SIZE, page_num: q.page,
      expected_start_time: "", expected_end_time: "",
      apply_start_date: q.start + " 00:00:00",
      apply_end_date: q.end + " 23:59:59",
    };
  }
  return {
    serial_no: "", sorting_no: null, origin_store_id: null, target_store_id: null,
    audit_type: null, states: [Number(q.status)],
    page_size: FLEET_PAGE_SIZE, page_num: q.page,
    start_time: q.start + " 00:00:00", end_time: q.end + " 23:59:59",
    ascending: null, line_name: "", line_type_list: [],
    target_store_type_list: [], origin_store_type_list: [],
  };
}
function safeString(value, max = 160) {
  return typeof value === "string" ? value.slice(0, max) :
    (typeof value === "number" && Number.isFinite(value) ? String(value) : "");
}
function sanitizedRow(item, source) {
  const record = item && typeof item === "object" && !Array.isArray(item) ? item : {};
  const approvalCode = source === "audit" ? safeString(record.status ?? record.audit_status ?? record.approval_status, 10) : "";
  const workCode = source === "monitor" ? safeString(record.status, 10) : "";
  return {
    serialNo: safeString(record.serial_no || record.serialNo, 80),
    auditId: safeString(record.audit_id ?? record.fleet_audit_id, 80),
    applyStore: safeString(record.apply_store_name, 160),
    startStore: safeString(record.start_store_name, 160),
    endStore: safeString(record.end_store_name, 160),
    routeTypeCode: source === "monitor" ? safeString(record.type, 20) : "",
    routeTypeText: source === "monitor" ? safeString(record.type_text, 100) : "",
    requestTypeText: safeString(record.audit_type_text, 100),
    approvalCode,
    approvalText: source === "audit" ? safeString(record.status_text || record.audit_status_text, 100) : "",
    workCode,
    workText: source === "monitor" ? safeString(record.status_text, 100) : "",
    expectedDate: safeString(record.expected_date_text, 50),
    planEndTime: safeString(record.plan_end_time_text, 50),
    proofState: source === "monitor" ? safeString(record.proof_state_text, 100) : "",
  };
}
export function normalizeFleetProviderResponse(json, source, page) {
  if (!json || typeof json !== "object" || Number(json.code) !== 1)
    fail("MS ไม่ส่งผลการค้นหาที่สำเร็จ", "FLEET_UPSTREAM_REJECTED", 502);
  if (!json.data || !Array.isArray(json.data.items))
    fail("รูปแบบข้อมูลรายการ MS ไม่ถูกต้อง", "FLEET_RESPONSE_INVALID", 502);
  const items = json.data.items;
  if (items.length > FLEET_PAGE_SIZE)
    fail("จำนวนข้อมูลต่อหน้าเกินสัญญาที่รองรับ", "FLEET_RESPONSE_INVALID", 502);
  const totalValue = Number(json.data.pagination?.total_count);
  return {
    source,
    page,
    pageSize: FLEET_PAGE_SIZE,
    total: Number.isSafeInteger(totalValue) && totalValue >= 0 ? totalValue : null,
    count: items.length,
    items: items.map(item => sanitizedRow(item, source)),
    sourceScope: "MS_SESSION_VISIBLE_ONLY",
    completeness: "PAGE_ONLY",
    approvalTimeline: "NOT_CAPTURED",
    fetchedAt: new Date().toISOString(),
  };
}
export async function readFleetApprovalPage(query, credentials, headersBuilder, fetchImpl = fetch) {
  const q = validateFleetPageQuery(query);
  if (!credentials?.sessionId || !credentials?.deviceId)
    fail("ยังไม่มีเซสชัน MS ที่ตรวจสอบได้", "FLEET_MS_NOT_CONFIGURED", 503);
  // Do not pass any browser-supplied URL or credentials into this transport.
  const url = MS_HOST + PATHS[q.source];
  const headers = new Headers(headersBuilder(credentials));
  headers.set("Content-Type", "application/json;charset=UTF-8");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(buildFleetProviderBody(q)),
      signal: controller.signal,
      redirect: "error",
    });
  } catch (error) {
    fail(
      error?.name === "AbortError" ? "หมดเวลาติดต่อ MS" : "ติดต่อ MS ไม่สำเร็จ",
      error?.name === "AbortError" ? "FLEET_UPSTREAM_TIMEOUT" : "FLEET_UPSTREAM_UNAVAILABLE",
      502,
    );
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 401 || response.status === 403)
    fail("MS ปฏิเสธสิทธิ์ของเซสชันที่เชื่อมอยู่", "FLEET_MS_ACCESS_DENIED", 502);
  if (!response.ok) fail("MS ตอบกลับ HTTP " + response.status, "FLEET_UPSTREAM_HTTP", 502);
  let data;
  try { data = await response.json(); }
  catch { fail("MS ตอบกลับไม่ใช่ JSON", "FLEET_UPSTREAM_NON_JSON", 502); }
  return normalizeFleetProviderResponse(data, q.source, q.page);
}
