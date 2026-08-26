// ==UserScript==
// @name         Waiting Trucks - MS Route Sync
// @namespace    https://flashdevnak.github.io/waiting-trucks-report/
// @version      1.0.0
// @description  ส่งสำเนาสถานะเส้นทางจาก MS ไปหน้าติดตามแบบอ่านอย่างเดียวทุก 30 วินาที
// @match        https://ms.flashexpress.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  const CONFIG = {
    appApi: "https://script.google.com/macros/s/AKfycbxE2-_8h6EzOQQ3FeDwFxNIAn4U40pacvRnp3XeOGevXDzhw15bgDi74LVgtozfjgiHXQ/exec",
    msApi: "https://ms-api.flashexpress.com/gw/nws/staff/ms/store/line/task",
    intervalMs: 30000,
    pageSize: 100,
    authKey: "waiting_trucks_ms_sync_auth_v1"
  };

  let timer = null;
  let syncing = false;
  let auth = loadAuth();
  const panel = createPanel();

  panel.querySelector("[data-action=connect]").onclick = connect;
  panel.querySelector("[data-action=sync]").onclick = () => syncNow(false);
  panel.querySelector("[data-action=disconnect]").onclick = disconnect;
  updatePanel();

  if (auth) startTimer();

  function createPanel() {
    const root = document.createElement("section");
    root.id = "waiting-trucks-ms-sync";
    root.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;width:300px;padding:12px;border:1px solid #777;border-top:4px solid #ffd400;border-radius:5px;background:#151515;color:#fff;font:13px Tahoma,Arial,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.35)";
    root.innerHTML = `<strong style="display:block;font-size:14px">ตัวเชื่อมระบบรถรอลงงาน</strong><span data-role="status" style="display:block;margin:5px 0 10px;color:#d0d0ce">ยังไม่ได้เชื่อมต่อ</span><div style="display:grid;grid-template-columns:1fr 1fr;gap:6px"><button data-action="connect" style="padding:7px;border:1px solid #111;background:#ffd400;font-weight:700;cursor:pointer">เชื่อมต่อ</button><button data-action="sync" style="padding:7px;border:1px solid #777;background:#303030;color:#fff;font-weight:700;cursor:pointer">ซิงก์ตอนนี้</button></div><button data-action="disconnect" style="display:none;width:100%;margin-top:6px;padding:6px;border:1px solid #777;background:transparent;color:#ddd;cursor:pointer">ยกเลิกการเชื่อมต่อ</button>`;
    document.body.appendChild(root);
    return root;
  }

  async function connect() {
    const username = window.prompt("Username ระบบรถรอลงงาน", detectBranch());
    if (!username) return;
    const pin = window.prompt("รหัสจัดการระบบรถรอลงงาน");
    if (!pin) return;
    setStatus("กำลังตรวจสอบสิทธิ์…");
    try {
      const result = await appPost({ action: "login", username: username.trim().toUpperCase(), pin });
      auth = { username: result.username, role: result.role, branches: result.branches || [], token: result.token, expiresAt: Number(result.expiresAt) };
      localStorage.setItem(CONFIG.authKey, JSON.stringify(auth));
      updatePanel();
      startTimer();
      await syncNow(false);
    } catch (error) {
      setStatus(`เชื่อมต่อไม่สำเร็จ: ${error.message}`, true);
    }
  }

  function disconnect() {
    auth = null;
    localStorage.removeItem(CONFIG.authKey);
    clearInterval(timer);
    timer = null;
    updatePanel();
  }

  function startTimer() {
    clearInterval(timer);
    timer = setInterval(() => syncNow(true), CONFIG.intervalMs);
  }

  async function syncNow(silent) {
    if (!auth || syncing) return;
    if (Date.now() > Number(auth.expiresAt)) {
      disconnect();
      setStatus("สิทธิ์หมดอายุ กรุณาเชื่อมต่อใหม่", true);
      return;
    }
    syncing = true;
    if (!silent) setStatus("กำลังอ่านข้อมูล MS…");
    try {
      const rows = await readAllMsRows();
      const branch = detectBranch();
      const result = await appPost({ action: "syncMsRoutes", token: auth.token, branch, rows: rows.map(mapRow) });
      setStatus(`ออนไลน์ · ${result.synced} รายการ · ${new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })} น.`);
    } catch (error) {
      setStatus(`ซิงก์ไม่สำเร็จ: ${error.message}`, true);
    } finally {
      syncing = false;
    }
  }

  async function readAllMsRows() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const first = await fetchMsPage(1, start, end);
    const rows = [...first.items];
    const total = Number(first.total) || rows.length;
    const pages = Math.ceil(total / CONFIG.pageSize);
    for (let page = 2; page <= pages; page++) {
      const next = await fetchMsPage(page, start, end);
      rows.push(...next.items);
    }
    return rows;
  }

  async function fetchMsPage(pageNum, start, end) {
    const url = new URL(CONFIG.msApi);
    url.searchParams.set("pageNum", String(pageNum));
    url.searchParams.set("pageSize", String(CONFIG.pageSize));
    url.searchParams.set("startTime", String(Math.floor(start.getTime() / 1000)));
    url.searchParams.set("endTime", String(Math.floor(end.getTime() / 1000)));
    const sid = cookie("ms-sid");
    const device = cookie("ms-uuid");
    if (!sid || !device) throw new Error("ไม่พบเซสชัน MS กรุณาเข้าสู่ระบบใหม่");
    const response = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      headers: {
        "Accept-Language": "th",
        "Cache-Control": "no-cache",
        "X-FLE-SESSION-ID": sid,
        "X-DEVICE-ID": device,
        "X-FH-MS-EQUIPMENT-TYPE": "5"
      }
    });
    if (!response.ok) throw new Error(`MS ตอบกลับ ${response.status}`);
    const json = await response.json();
    if (json.code !== 1) throw new Error(json.message || "MS ไม่อนุญาตให้อ่านข้อมูล");
    const data = json.data || {};
    return { items: Array.isArray(data.items) ? data.items : [], total: data.pagination?.total_count || 0 };
  }

  function mapRow(row) {
    return {
      id: row.id || row.line_task_id || "",
      proofId: row.proof_id || "",
      routeName: row.line_name || "",
      region: row.line_sorting_no || "",
      routeAttribute: row.line_mode_text || "",
      routeType: row.line_type_text || "",
      attendanceType: row.type_text || "",
      estimatedArrivalAt: iso(row.estimate_end_time),
      actualArrivalAt: iso(row.actual_end_time),
      estimatedDepartureAt: iso(row.estimate_start_time),
      actualDepartureAt: iso(row.actual_start_time),
      supplier: row.fleet_name || row.fleet_text || "",
      vehicleType: row.car_type_text || row.car_type || "",
      plate: row.plate_number || row.plate_name || "",
      driverName: row.driver || "",
      driverPhone: row.driver_phone || "",
      trackingStatus: row.urge_car_text || row.urge_text || "",
      vehicleStatus: row.car_state_text || "",
      loadStatus: row.vehicle_load_state_text || row.load_state_text || "",
      sourceUpdatedAt: iso(row.updated_at || row.update_time)
    };
  }

  function iso(value) {
    if (value === null || value === undefined || value === "") return "";
    const numeric = Number(value);
    const date = Number.isFinite(numeric) && numeric > 0
      ? new Date(numeric < 100000000000 ? numeric * 1000 : numeric)
      : new Date(value);
    return isNaN(date) ? String(value) : date.toISOString();
  }

  async function appPost(body) {
    const response = await fetch(CONFIG.appApi, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) });
    const json = await response.json();
    if (json.ok === false) throw new Error(json.message || "ระบบรถรอลงงานไม่ตอบรับ");
    return json.data ?? json;
  }

  function detectBranch() {
    const text = document.body?.innerText || "";
    const match = text.match(/\b([A-Z]{1,4}\d{0,3})_HUB\b/i) || text.match(/\b(NE\d+)\b/i);
    return (match?.[1] || auth?.branches?.[0] || "NE1").toUpperCase();
  }

  function cookie(name) {
    const prefix = `${encodeURIComponent(name)}=`;
    const found = document.cookie.split(";").map(item => item.trim()).find(item => item.startsWith(prefix));
    return found ? decodeURIComponent(found.slice(prefix.length)) : "";
  }

  function loadAuth() {
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG.authKey) || "null");
      return saved?.token && Number(saved.expiresAt) > Date.now() ? saved : null;
    } catch {
      return null;
    }
  }

  function updatePanel() {
    panel.querySelector("[data-action=connect]").style.display = auth ? "none" : "block";
    panel.querySelector("[data-action=sync]").style.display = auth ? "block" : "none";
    panel.querySelector("[data-action=disconnect]").style.display = auth ? "block" : "none";
    setStatus(auth ? `พร้อมซิงก์ · ${auth.username}` : "ยังไม่ได้เชื่อมต่อ");
  }

  function setStatus(message, error = false) {
    const status = panel.querySelector("[data-role=status]");
    status.textContent = message;
    status.style.color = error ? "#ffaca6" : "#d0d0ce";
  }
})();
