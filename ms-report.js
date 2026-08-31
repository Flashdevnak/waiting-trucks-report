const API = `${window.location.hostname.endsWith("github.io") ? "https://waiting-trucks-report.alert-squid-6738.chatgpt.site" : window.location.origin}/api`;
const AUTH_KEY = "bnak_operator_auth_v2";
const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat("th-TH");

document.addEventListener("DOMContentLoaded", () => {
  const today = new Date();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  $("report-from").value = iso(today);
  $("report-to").value = iso(today);
  $("report-load").onclick = loadReport;
  document.querySelectorAll(".report-checks input").forEach((input) => input.onchange = renderReport);
});

let rows = [];
async function apiGet(action, params = {}) {
  const auth = JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
  if (!auth?.token) throw new Error("กรุณาเข้าสู่ระบบจากหน้าติดตาม MS ก่อน");
  const url = new URL(API);
  url.searchParams.set("action", action);
  url.searchParams.set("token", auth.token);
  Object.entries(params).forEach(([key,value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { cache: "no-store" });
  const json = await response.json();
  if (!response.ok || !json.ok) throw new Error(json.message || "โหลดข้อมูลไม่สำเร็จ");
  return json.data;
}

async function loadReport() {
  const start = $("report-from").value, end = $("report-to").value, branch = $("report-hub").value.trim().toUpperCase();
  if (!start || !end || end < start) return note("กรุณาเลือกช่วงวันที่ให้ถูกต้อง", true);
  note("กำลังดึงและสรุปข้อมูล…");
  try {
    await apiGet("msRange", { branch, start, end });
    const result = await apiGet("msArchive", { branch });
    rows = (result.rows || []).filter((row) => {
      const value = finishAt(row);
      const day = value ? localDay(value) : "";
      return day >= start && day <= end;
    });
    renderReport();
  } catch (error) { note(error.message, true); }
}

function finishAt(row) {
  if (String(row.attendanceType || "").includes("ปลายทาง")) return row.unloadingCompletedAt || row.actualDepartureAt || "";
  return row.actualDepartureAt || row.unloadingCompletedAt || "";
}
function localDay(value) {
  const d = new Date(value); if (isNaN(d)) return "";
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function selectedTypes() { return new Set([...document.querySelectorAll(".report-checks input:checked")].map((x) => x.value)); }
function attendance(row) {
  const value = String(row.attendanceType || "");
  return value.includes("จุดดร") ? "จุดดรอป" : value.includes("ปลายทาง") ? "ปลายทาง" : value.includes("ต้นทาง") ? "ต้นทาง" : value;
}
function vehicle(row) { return String(row.vehicleType || "ไม่ระบุ").trim().toUpperCase() || "ไม่ระบุ"; }

function renderReport() {
  const types = selectedTypes();
  const filtered = rows.filter((row) => types.has(attendance(row)) && finishAt(row));
  const days = [...new Set(filtered.map((row) => localDay(finishAt(row))))].sort();
  const vehicles = [...new Set(filtered.map(vehicle))].sort((a,b) => a.localeCompare(b, undefined, {numeric:true}));
  const hours = Array.from({length:24}, (_,i) => i);
  const counts = new Map();
  filtered.forEach((row) => {
    const d = new Date(finishAt(row));
    const key = `${localDay(d)}|${vehicle(row)}|${attendance(row)}|${d.getHours()}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  if (!filtered.length) {
    $("report-empty").textContent = "ไม่พบรถที่จบงานตามวันที่และประเภทที่เลือก";
    $("report-empty").classList.remove("hidden"); $("report-table-wrap").classList.add("hidden");
    return note("ไม่พบข้อมูลที่จบงาน");
  }
  $("report-head").innerHTML = `<tr><th>วันที่</th><th>ขนาดรถ</th><th>ประเภทงาน</th>${hours.map((h)=>`<th>${h}</th>`).join("")}<th>รวม</th></tr>`;
  const body = [];
  days.forEach((day) => vehicles.forEach((car) => [...types].forEach((type) => {
    const values = hours.map((hour) => counts.get(`${day}|${car}|${type}|${hour}`) || 0);
    const total = values.reduce((a,b)=>a+b,0); if (!total) return;
    body.push(`<tr><th>${day.split("-").reverse().join("/")}</th><th>${car}</th><th>${type}</th>${values.map((n)=>`<td>${n || "-"}</td>`).join("")}<th>${total}</th></tr>`);
  })));
  $("report-body").innerHTML = body.join("");
  $("report-empty").classList.add("hidden"); $("report-table-wrap").classList.remove("hidden");
  note(`สรุปรถจบงาน ${nf.format(filtered.length)} เที่ยว · เวลาจบใช้เวลาลงเสร็จสำหรับปลายทาง และเวลาออกจริงสำหรับต้นทาง/จุดดรอป`);
}
function note(message, error=false) { $("report-note").textContent = message; $("report-note").classList.toggle("form-error", error); }
