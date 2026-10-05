// DEV-only final composition. Canonical Production assets are not modified.
function unique(source, from, to) {
  if (source.indexOf(from) < 0 || source.indexOf(from) !== source.lastIndexOf(from))
    throw new Error("MS resilience staging anchor missing or ambiguous: " + from.slice(0, 90));
  return source.replace(from, to);
}

export function patchMsResilienceFrontend(source) {
  if (source.includes("MS_INCREMENTAL_RENDER_V1")) return source;
  source = unique(source, '    const har = JSON.parse(await file.text());', '    const har = parseMsHar(await file.text());');
  source = unique(source,
    '    void reportMsConnectionObservation("error", source, hub, error).then(() => loadMsConnectionObservedError(hub));',
    '    if (!String(error?.code || "").startsWith("LOCAL_"))\n      void reportMsConnectionObservation("error", source, hub, error).then(() => loadMsConnectionObservedError(hub));');
  source = unique(source, '    try { har = JSON.parse(await file.text()); }\n    catch { throw new Error("อ่านไฟล์ HAR ปริ้นบาร์โค้ดรถไม่ได้"); }', '    har = parseMsHar(await file.text());');
  source = unique(source, '  el(id).innerHTML =\n    \'<option value="all">ทั้งหมด</option>\' +', '  const optionHtml =\n    \'<option value="all">ทั้งหมด</option>\' +');
  source = unique(source, '  const next = unique.includes(selected) ? selected : "all";', '  const select = el(id);\n  if (select.__msOptions !== optionHtml) {\n    select.innerHTML = optionHtml;\n    select.__msOptions = optionHtml;\n  }\n  const next = unique.includes(selected) ? selected : "all";');
  source = unique(source, '  el(id).value = next;', '  if (select.value !== next) select.value = next;');
  source = unique(source, `  el("branch-filter").innerHTML = list
    .map((value) => \`<option value="\${esc(value)}">\${esc(value)}</option>\`)
    .join("");
  el("branch-filter").value = state.branch;`, `  const select = el("branch-filter");
  const html = list.map((value) => \`<option value="\${esc(value)}">\${esc(value)}</option>\`).join("");
  if (select.__msBranches !== html) { select.innerHTML = html; select.__msBranches = html; }
  if (select.value !== state.branch) select.value = state.branch;`);
  source = unique(source, '  el(id).textContent = nf.format(value);', '  const node = el(id), formatted = nf.format(value);\n  if (node.textContent !== formatted) node.textContent = formatted;');
  const start = source.indexOf('function renderRowsProgressively(rows) {');
  const end = source.indexOf('\nfunction completedTodayDatasetKey()', start);
  if (start < 0 || end < start) throw new Error('incremental render boundary missing');
  source = source.slice(0, start) + incrementalRenderer.toString() + source.slice(end);
  source = source.replace('function incrementalRenderer(rows)', 'function renderRowsProgressively(rows)');
  source = unique(source, '  el("filter-summary").innerHTML = `', '  const summaryHtml = `');
  source = unique(source, '  el("filter-summary")\n    .querySelectorAll("[data-summary-status]")', '  if (updateMsSummary(el("filter-summary"), summaryHtml)) return;\n  el("filter-summary")\n    .querySelectorAll("[data-summary-status]")');
  // A database read error is a snapshot-health event, not a dead WebSocket.
  source = unique(source, `  if (payload?.type === "error") {
    state.syncError = payload.message || "Realtime stream ขัดข้องชั่วคราว";
    state.msStatus = "degraded";
    renderFreshness();
    return;
  }`, `  if (payload?.type === "error") {
    state.syncError = payload.message || "Realtime stream ขัดข้องชั่วคราว";
    state.msStatus = "degraded";
    state.msSnapshotDatabaseDegraded = msDatabaseSnapshotFailure(payload);
    if (state.msSnapshotDatabaseDegraded) showMsDatabaseReadStatus();
    renderFreshness();
    return;
  }`);
  source = unique(source,
    '  if (result?.syncError !== undefined) state.syncError = result.syncError || "";',
    '  if (result?.syncError !== undefined) state.syncError = result.syncError || "";\n  state.msSnapshotDatabaseDegraded = msDatabaseSnapshotFailure(result);');
  source = unique(source,
    '  connection(state.msStatus !== "error" && state.msStatus !== "not_configured");',
    '  if (msDatabaseSnapshotFailure(result)) showMsDatabaseReadStatus();\n  else connection(state.msStatus !== "error" && state.msStatus !== "not_configured");');
  source = unique(source,
    '    state.msStatus === "degraded"\n      ? "Route ยังไม่อัปเดต · แสดงข้อมูลล่าสุด · กำลังตรวจสถานะทุก 4 วินาที"',
    '    msDatabaseSnapshotFailure(result)\n      ? "ฐานข้อมูลตอบชั่วคราว · แสดงข้อมูลล่าสุด · กำลังตรวจสถานะทุก 4 วินาที"\n      : state.msStatus === "degraded"\n        ? "Route ยังไม่อัปเดต · แสดงข้อมูลล่าสุด · กำลังตรวจสถานะทุก 4 วินาที"');
  source = unique(source, `    connection(Boolean(recentlyHealthy));
    if (!silent) {
      if (recentlyHealthy)
        toast(\`เครือข่ายสะดุดชั่วคราว · ใช้ข้อมูลล่าสุดและกำลังลองใหม่: \${error.message}\`, true);
      else empty(\`โหลดข้อมูลไม่สำเร็จ: \${error.message}\`);
    }`, `    if (msDatabaseSnapshotFailure(error)) {
      state.msStatus = "degraded";
      state.syncError = "ฐานข้อมูลตอบชั่วคราว ระบบยังแสดงข้อมูลล่าสุดตามเวลาที่รับสำเร็จล่าสุด";
      state.msSnapshotDatabaseDegraded = true;
      showMsDatabaseReadStatus();
      renderFreshness();
      if (!silent && (!Array.isArray(state.currentRows) || state.currentRows.length === 0))
        empty(\`โหลดข้อมูลไม่สำเร็จ: \${error.message}\`);
    } else {
      state.msSnapshotDatabaseDegraded = false;
      connection(Boolean(recentlyHealthy));
      if (!silent) {
        if (recentlyHealthy)
          toast(\`เครือข่ายสะดุดชั่วคราว · ใช้ข้อมูลล่าสุดและกำลังลองใหม่: \${error.message}\`, true);
        else empty(\`โหลดข้อมูลไม่สำเร็จ: \${error.message}\`);
      }
    }`);
  return source + '\n// MS_INCREMENTAL_RENDER_V1\n' + parseMsHar.toString() + '\n' + updateMsSummary.toString() + '\n' +
    msDatabaseSnapshotFailure.toString() + '\n' + showMsDatabaseReadStatus.toString() + '\n';
}

function msDatabaseSnapshotFailure(value) {
  const code = String(value?.errorCode || value?.code || "");
  return code === "DB_SNAPSHOT_READ_ERROR" || code.startsWith("TURSO_");
}

function showMsDatabaseReadStatus() {
  const badge = el("connection-badge");
  if (!badge) return;
  badge.textContent = "ฐานข้อมูลตอบชั่วคราว";
  badge.className = "badge badge-neutral";
}

export function parseMsHar(raw) {
  try {
    const har = JSON.parse(raw);
    if (!har || !Array.isArray(har.log?.entries)) throw new Error();
    return har;
  } catch {
    const error = new Error('ไฟล์ HAR ไม่สมบูรณ์หรือบันทึกมาไม่ครบ กรุณาบันทึก HAR ใหม่');
    error.code = 'LOCAL_HAR_INVALID';
    throw error;
  }
}

function incrementalRenderer(rows) {
  const generation = ++rowRenderGeneration;
  const desktopSitePhone = isPhoneDesktopSiteLayout();
  document.documentElement.classList.toggle("ms-desktop-site-phone", desktopSitePhone);
  const mobileLayout = useMobileCardLayout();
  const mobile = mobileLayout;
  const target = el(mobile ? 'mobile-cards' : 'table-body');
  const inactive = el(mobile ? 'table-body' : 'mobile-cards');
  // Inactive layouts retain their own keys. Switching layouts updates the target
  // against the latest dataset; no stale rows become visible.
  inactive.classList.add('hidden');
  target.classList.remove('hidden');
  const renderer = mobile ? card : tableRow;
  const nodes = target.__msRows || (target.__msRows = new Map());
  const keys = rows.map((row) => String(row.id || '') + '|' + String(row.proofId || '') + '|' + String(row.attendanceType || '') + '|' + String(row.estimatedArrivalAt || row.estimatedDepartureAt || ''));
  // Duplicate identities are a real structural change; use occurrence indexes
  // only for those identities rather than losing a row through Map overwrite.
  const totals = new Map();
  for (const key of keys) totals.set(key, (totals.get(key) || 0) + 1);
  const seen = new Map();
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (totals.get(key) > 1) {
      const index = seen.get(key) || 0;
      seen.set(key, index + 1);
      keys[i] += '|duplicate:' + index;
    }
  }
  const wanted = new Set(keys);
  for (const [key, item] of nodes) if (!wanted.has(key)) { item.node.remove(); nodes.delete(key); }
  const firstBatch = mobileLayout ? 32 : 64;
  const nextBatch = mobileLayout ? 24 : 64;
  let index = 0;
  const pump = () => {
    if (generation !== rowRenderGeneration) return;
    const end = Math.min(index + (index === 0 ? firstBatch : nextBatch), rows.length);
    for (; index < end; index++) {
      const key = keys[index], html = renderer(rows[index]);
      let item = nodes.get(key);
      if (!item || item.html !== html) {
        // A contextual fragment correctly parses table rows as well as cards.
        const range = document.createRange();
        range.selectNodeContents(target);
        const node = range.createContextualFragment(html).firstElementChild;
        if (item) item.node.replaceWith(node);
        item = { node, html };
        nodes.set(key, item);
      }
      if (target.children[index] !== item.node)
        target.insertBefore(item.node, target.children[index] || null);
    }
    if (index < rows.length) requestAnimationFrame(pump);
  };
  pump();
}

function updateMsSummary(root, html) {
  if (!root.__msSummaryReady) {
    root.innerHTML = html;
    root.__msSummaryReady = true;
    root.__msSummaryHtml = html;
    return false;
  }
  if (root.__msSummaryHtml === html) return true;
  const template = document.createElement('template');
  template.innerHTML = html;
  const incoming = template.content.querySelectorAll('[data-summary-status]');
  for (const next of incoming) {
    const current = root.querySelector('[data-summary-status="' + next.dataset.summaryStatus + '"]');
    if (!current) { root.__msSummaryReady = false; return updateMsSummary(root, html); }
    if (current.className !== next.className) current.className = next.className;
    for (const tag of ['span', 'strong']) {
      const before = current.querySelector(tag), after = next.querySelector(tag);
      if (before && after && before.textContent !== after.textContent) before.textContent = after.textContent;
    }
  }
  root.__msSummaryHtml = html;
  return true;
}

export function patchMsResilienceWorker(source) {
  if (source.includes('MS_OPTIONAL_NONBLOCKING_V1')) return source;
  source = unique(source, `    const [rows, parcelCounts, busData] = await Promise.all([
      readMsRoutes(credentials),
      readPreEntryCounts(env, branch),
      readBusTimeData(env, branch, liveSourceDays(), routeHintRows),
    ]);`, `    // MS_OPTIONAL_NONBLOCKING_V1: optional acquisition has no Route barrier.
    startMsOptionalRefresh(optionalEnv, branch, routeHintRows);
    const rows = await readMsRoutes(credentials);
    const parcelCounts = msOptionalData(branch, "preEntry");
    const busData = msOptionalData(branch, "busTime");`);
  source = unique(source, 'async function runMsRefresh(env, branch) {', 'async function runMsRefresh(env, branch) {\n  const optionalEnv = env;\n  env = msLiveDatabaseEnv(env);');
  source = unique(source, '      errorCode === "TURSO_NETWORK_ERROR" ||', '      errorCode === "TURSO_NETWORK_ERROR" ||\n      errorCode === "TURSO_LIVE_TIMEOUT" ||\n      (errorCode === "TURSO_HTTP_ERROR" && Number(error?.status) >= 500 && Number(error?.status) <= 599) ||');
  source = unique(source, '  async refresh(branch, force = false, cron = false) {\n    const nowMs = Date.now();', `  async refresh(branch, force = false, cron = false) {
    // MS_ROUTE_ACCEPTED_IMMEDIATE_V1: never wait on the active acquisition.
    if (this.active) return this.lastResult || this.active;
    const nowMs = Date.now();`);
  source = unique(source, `    if (this.active) {
      try {
        await this.active;
      } catch {}
      if (!force && this.lastResult)
        return this.lastResult;
    }`, `    if (this.active) return this.lastResult || this.active;`);
  source = unique(source, '    const task = runMsRefresh(this.env, branch)', `    const optionalEnv = new Proxy(this.env, { get: (target, key) => {
      if (key === "MS_OPTIONAL_ACCEPT") return () => this.acceptOptional(branch);
      if (key === "BUS_TIME_SLOT_STORE") return this.ctx.storage;
      if (key === "MS_BACKGROUND_WAIT") return (task) => this.ctx.waitUntil(task);
      return target[key];
    }});
    const task = runMsRefresh(optionalEnv, branch)`);
  source = unique(source,
    '    if (url.pathname === "/stream") return this.openStream(request, branch);',
    `    if (url.pathname === "/stream") return this.openStream(request, branch);
    if (url.pathname === "/optional-bus") {
      const input = await request.json();
      const sharedEnv = new Proxy(this.env, { get: (target, key) =>
        key === "BUS_TIME_SLOT_STORE" ? this.ctx.storage : target[key] });
      if (input.credentials) {
        busTimeHotLane.resetCredentials(branch, input.credentials);
        await this.ctx.storage.transaction(async (store) => {
          const key = "bus-automatic-slot-v1:" + branch;
          const previous = await store.get(key) || {};
          await store.put(key, { ...previous, until: Math.max(previous.until || 0, Date.now() + 12000) });
        });
      }
      const data = await readBusTimeData(sharedEnv, branch, input.days || liveSourceDays(),
        this.lastResult?.rows || busTimeRouteHints.get(branch) || []);
      msOptionalState(branch).data.set("busTime", data);
      this.acceptOptional(branch);
      return Response.json(msSerializeOptionalMap(data));
    }`);
  source = unique(source,
    '  const data = await busTimeHotLane.readBusTimeData(env, hub, wantedDays, routeRows);',
    `  if (env.MS_REFRESH_COORDINATOR && !env.BUS_TIME_SLOT_STORE)
    return msSharedBusRequest(env, hub, { days: wantedDays });
  const data = await busTimeHotLane.readBusTimeData(env, hub, wantedDays, routeRows);`);
  source = unique(source,
    '  busTimeHotLane.resetCredentials(hub, credentials);',
    '  busTimeHotLane.resetCredentials(hub, credentials);\n  if (env.MS_REFRESH_COORDINATOR) await msSharedBusRequest(env, hub, { credentials });');
  source = unique(source, '        this.lastResult = result;\n        this.lastSourceAt = Date.now();', '        this.lastResult = mergeMsOptionalResult(branch, result);\n        result = this.lastResult;\n        this.lastSourceAt = Date.now();');
  source = unique(source, '        if (this.active === task) this.active = null;', '        if (this.active === task) this.active = null;\n        this.sendAcceptedSnapshot(branch);');
  source = unique(source, '  async refresh(branch, force = false, cron = false) {', `  sendAcceptedSnapshot(branch) {
    if (!this.lastSnapshotPayload || !Array.isArray(this.lastResult?.rows)) return;
    const result = this.lastResult;
    const payload = { ...this.lastSnapshotPayload, rows: result.rows,
      completedToday: Number(result.completedToday) || 0,
      lastSync: result.syncedAt || "", msStatus: result.status || "",
      syncError: result.error || "" };
    this.lastSnapshotPayload = payload;
    this.lastSnapshotBranch = branch;
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.deserializeAttachment?.()?.branch !== branch) continue;
      try { socket.send(JSON.stringify(payload)); } catch {}
    }
  }

  acceptOptional(branch) {
    if (!Array.isArray(this.lastResult?.rows)) return;
    this.lastResult = mergeMsOptionalResult(branch, this.lastResult);
    recentMsSync.set(branch, { until: this.recentUntil, result: this.lastResult });
    this.sendAcceptedSnapshot(branch);
  }

  async refresh(branch, force = false, cron = false) {`);
  // A Turso availability error while reading credentials must enter continuity
  // directly, without a status write or another cache/credential read.
  source = unique(source, '    const errorCode = error?.code === "MS_CREDENTIAL_ERROR"', `    if (msTursoAvailability(error)) {
      const accepted = recentMsSync.get(branch)?.result;
      return { ...(accepted || {}), status: "degraded", changes: 0,
        errorCode: error.code, dbTrace: error.dbTrace || null,
        error: "การอ่านหรือบันทึกข้อมูลภายในใช้เวลาถึงขีดจำกัด ระบบยังแสดงข้อมูลล่าสุดตามเวลาที่รับสำเร็จล่าสุด" };
    }
    const errorCode = error?.code === "MS_CREDENTIAL_ERROR"`);
  const cacheStart = source.indexOf('async function readMsLiveCache(');
  const cacheEnd = source.indexOf('\nasync function writeMsLiveCache(', cacheStart);
  const cache = source.slice(cacheStart, cacheEnd);
  source = source.slice(0, cacheStart) + unique(cache, '  } catch (error) {', '  } catch (error) {\n    if (msTursoAvailability(error)) throw error;') + source.slice(cacheEnd);
  source = unique(source, '    const errorCode = String(error?.code || "");',
    '    const errorCode = String(error?.code || "");\n    const dbTrace = errorCode === "TURSO_LIVE_TIMEOUT" ? error.dbTrace || null : null;');
  source = unique(source, '          ...remembered,\n          status: "degraded",',
    '          ...remembered,\n          status: "degraded",\n          dbTrace,');
  source = unique(source, '      status: "error",\n      errorCode: errorCode || "MS_SYNC_FAILED",',
    '      status: "error",\n      errorCode: errorCode || "MS_SYNC_FAILED",\n      dbTrace,');
  source = unique(source, `  async streamPayload(branch) {
    const live = await this.refresh(branch, false, false);
    const settings = await readSettings(this.env, branch);
    const payload = {
      type: "snapshot",
      rows: Array.isArray(live?.rows) ? live.rows : null,
      completedToday: Number(live?.completedToday) || 0,
      standards: settings.msVehicleLimits,
      lastSync: live?.syncedAt || "",
      msStatus: live?.status || "",
      syncError: live?.error || "",
      pollMs: 4000,
    };
    this.lastSnapshotPayload = payload;
    this.lastSnapshotBranch = branch;
    return payload;
  }`, `  async streamPayload(branch) {
    const live = await this.refresh(branch, false, false);
    let settings, readError;
    try {
      // Only this idempotent snapshot settings read gets the live DB deadline.
      // The adapter below can retry one quick availability failure within it.
      settings = await readSettings(msLiveDatabaseEnv(this.env), branch);
    } catch (error) { readError = error; }
    const remembered = this.lastSnapshotBranch === branch ? this.lastSnapshotPayload : null;
    const databaseUnavailable = Boolean(readError) ||
      String(live?.errorCode || "").startsWith("TURSO_");
    const rows = Array.isArray(live?.rows) ? live.rows :
      databaseUnavailable && Array.isArray(remembered?.rows) ? remembered.rows : null;
    const payload = {
      type: "snapshot",
      rows,
      completedToday: Number(live?.completedToday ?? remembered?.completedToday) || 0,
      standards: settings?.msVehicleLimits ?? remembered?.standards ?? null,
      lastSync: live?.syncedAt || (databaseUnavailable ? remembered?.lastSync : "") || "",
      msStatus: databaseUnavailable ? "degraded" : live?.status || "",
      syncError: readError
        ? "ฐานข้อมูลตอบช้าชั่วคราว ระบบยังแสดงข้อมูลล่าสุดตามเวลาที่รับสำเร็จล่าสุด"
        : live?.error || "",
      errorCode: readError?.code || (databaseUnavailable ? live?.errorCode : "") ||
        (readError ? "DB_SNAPSHOT_READ_ERROR" : ""),
      pollMs: 4000,
    };
    this.lastSnapshotPayload = payload;
    this.lastSnapshotBranch = branch;
    return payload;
  }`);
  source = unique(source,
    '      syncError: result.error || "" };',
    '      syncError: result.error || "", errorCode: result.errorCode || "" };');
  return source + '\n' + workerHelpers;
}

export const workerHelpers = String.raw`
const msOptionalAccepted = new Map();
function msSerializeOptionalMap(data) {
  const properties = {};
  for (const key of Object.keys(data)) {
    properties[key] = data[key] instanceof Set ? { setValues: [...data[key]] } : data[key];
  }
  return { entries: [...data], properties };
}
async function msSharedBusRequest(env, hub, body) {
  const id = env.MS_REFRESH_COORDINATOR.idFromName(msCoordinatorIdentity(hub));
  const response = await env.MS_REFRESH_COORDINATOR.get(id).fetch(new Request(
    "https://ms-refresh.internal/optional-bus?branch=" + encodeURIComponent(hub),
    { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } },
  ));
  if (!response.ok) throw Object.assign(new Error("Shared BusTime unavailable"), { code: "BUS_TIME_SHARED_ERROR" });
  const payload = await response.json();
  const data = new Map(payload.entries || []);
  for (const [key, value] of Object.entries(payload.properties || {}))
    data[key] = Array.isArray(value?.setValues) ? new Set(value.setValues) : value;
  return data;
}
function msOptionalState(branch) {
  if (!msOptionalAccepted.has(branch)) msOptionalAccepted.set(branch, { active: new Map(), data: new Map() });
  return msOptionalAccepted.get(branch);
}
function msOptionalData(branch, name) {
  const data = msOptionalState(branch).data.get(name);
  if (data) return Object.assign(new Map(data), data);
  const pending = new Map(); pending.sourceFailed = true; return pending;
}
function startMsOptionalRefresh(env, branch, hints) {
  const state = msOptionalState(branch);
  for (const [name, read] of [
    ["preEntry", () => readPreEntryCounts(env, branch)],
    ["busTime", () => readBusTimeData(env, branch, liveSourceDays(), hints)],
  ]) {
    if (state.active.has(name)) continue;
    const task = Promise.resolve().then(read).then((data) => {
      if (!(data instanceof Map)) return;
      state.data.set(name, data);
      env.MS_OPTIONAL_ACCEPT?.();
    }).catch(() => {}).finally(() => state.active.delete(name));
    state.active.set(name, task);
    env.MS_BACKGROUND_WAIT?.(task);
  }
}
function mergeMsOptionalResult(branch, result) {
  if (!Array.isArray(result?.rows)) return result;
  const parcels = msOptionalData(branch, "preEntry"), bus = msOptionalData(branch, "busTime");
  markAuxiliaryOccurrenceAmbiguity(result.rows, parcels, bus);
  const rows = result.rows.map((row) => {
    // Weak/ambiguous source evidence cannot overwrite accepted occurrence truth.
    const proof = normalizeProofId(row.proofId);
    const partial = parcels.partialProofs?.has(proof) || parcels.ambiguousProofs?.has(proof);
    const key = "P:" + proof + "|A:" + normalizeMsAttendance(row.attendanceType);
    const safeParcels = parcels.sourceFailed || partial ? Object.assign(new Map(), { sourceFailed: true }) : parcels;
    const safeBus = bus.sourceFailed || bus.ambiguousKeys?.has(key) ? new Map() : bus;
    return enrichMsRow({ ...row }, safeParcels, safeBus);
  });
  // Queue-first admission uses the accepted source map, never KIT-as-TBR.
  return { ...result, rows: msQueueFirstSourceRows(rows, bus, branch), tbrShadowFeed: msTbrShadowFeed(bus) };
}
function msTursoAvailability(error) {
  return ["TURSO_NETWORK_ERROR", "TURSO_LIVE_TIMEOUT"].includes(error?.code) ||
    (error?.code === "TURSO_HTTP_ERROR" && error.status >= 500 && error.status <= 599) ||
    (error?.code === "TURSO_PROTOCOL_ERROR" && /\((?:5\d\d|unknown)\)/.test(error.message));
}
// Only the SQL shape is inspected. SQL text and bound values are never retained.
function msLiveDbStage(requests, transactionStage) {
  const sql = (Array.isArray(requests) ? requests : [])
    .map((request) => String(request?.stmt?.sql || "")).join("\n");
  if (/^\s*SELECT\b/i.test(sql) && /\bms_routes\b/i.test(sql)) return "route_state_read";
  if (/\b(?:ms_route_registry|ms_route_history)\b|\b(?:INSERT|REPLACE|UPDATE|DELETE)\b[^;]*\bms_routes\b/i.test(sql)) return "route_batch_write";
  if (/\b(?:COMMIT|ROLLBACK)\b/i.test(sql) && transactionStage) return transactionStage;
  if (/\b(?:INSERT|UPDATE|REPLACE)\b[^;]*\bms_live_cache\b/i.test(sql)) return "live_cache_write";
  if (/\bSELECT\b[^;]*\bms_live_cache\b/i.test(sql)) return "live_cache_read";
  if (/\bSELECT\b[^;]*\bms_routes\b/i.test(sql)) return "route_state_read";
  if (/\b(?:INSERT|UPDATE|REPLACE)\b[^;]*\baudit_log\b/i.test(sql)) return "audit_write";
  if (/\b(?:INSERT|UPDATE|REPLACE)\b[^;]*\bms_connections\b/i.test(sql)) return "connection_status_write";
  if (/\bSELECT\b[^;]*\bms_connections\b/i.test(sql)) return "credential_db_read";
  return "other_live_db";
}
function msLiveDatabaseEnv(env) {
  // The deadline applies to this live refresh's database work only. Administrative,
  // history and archive operations keep their existing database adapter.
  const database = env.DB;
  if (!database || typeof database._pipeline !== "function") return env;
  const db = Object.create(database);
  // Critical reads/status writes retain the cumulative live DB deadline.
  // Route transactions have a separate bounded total and individual deadline.
  let remainingBudget = 2800;
  let routePersistenceBudget = 60_000;
  let unavailable = null;
  let pipelineCount = 0;
  let statementCountTotal = 0;
  let cumulativeDbElapsedMs = 0;
  let transactionStage = "";
  let firstPipelineAt = null;
  const pipelines = [];
  db._pipeline = async function(...args) {
    if (unavailable) throw unavailable;
    const requests = Array.isArray(args[0]) ? args[0] : [];
    const started = Date.now();
    if (firstPipelineAt === null) firstPipelineAt = started;
    const stage = msLiveDbStage(requests, transactionStage);
    const routeWrite = stage === "route_batch_write";
    const remaining = routeWrite
      ? Math.min(2800, routePersistenceBudget)
      : remainingBudget;
    const sequence = ++pipelineCount;
    const statementCount = requests.filter((request) => request?.type === "execute" &&
      !/^\s*(?:BEGIN|COMMIT|ROLLBACK)\b/i.test(String(request?.stmt?.sql || ""))).length;
    statementCountTotal += statementCount;
    const transaction = requests.some((request) => /^BEGIN\b/i.test(request.stmt?.sql || ""));
    const statements = requests.filter((request) => request?.type === "execute");
    const snapshotRead = !transaction && statements.length === 1 &&
      /^\s*SELECT\b/i.test(String(statements[0]?.stmt?.sql || "")) &&
      /\b(?:FROM|JOIN)\s+(?:ms_connections|ms_live_cache|ms_routes|hub_settings)\b/i.test(
        String(statements[0]?.stmt?.sql || ""));
    if (transaction) transactionStage = stage;
    const record = (timedOut, submitted = true) => {
      const elapsedMs = Math.max(0, Date.now() - started);
      cumulativeDbElapsedMs += elapsedMs;
      const entry = { sequence, stage, startedOffsetMs: Math.max(0, started - firstPipelineAt),
        elapsedMs, cumulativeElapsedMs: cumulativeDbElapsedMs, remainingBeforeMs: Math.max(0, remaining),
        remainingAfterMs: timedOut ? 0 : Math.max(0, remaining - elapsedMs),
        requestCount: requests.length, statementCount, transaction: transaction || Boolean(transactionStage),
        submitted, timedOut };
      pipelines.push(entry);
      if (pipelines.length > 12) pipelines.shift();
      return { failureStage: stage, pipelineSequence: sequence, pipelineElapsedMs: elapsedMs,
        cumulativeDbElapsedMs, remainingBeforeMs: Math.max(0, remaining), pipelineCount,
        statementCountTotal, transaction: transaction || Boolean(transactionStage), pipelines: [...pipelines] };
    };
    const timeoutError = () => Object.assign(new Error("Live database deadline exceeded"), { code: "TURSO_LIVE_TIMEOUT" });
    if (remaining <= 0) {
      const failure = timeoutError();
      failure.dbTrace = record(true, false);
      console.warn(JSON.stringify({ event: "ms_live_db_timeout", ...failure.dbTrace }));
      throw failure;
    }
    let timer;
    let expired = false;
    const pending = database._pipeline(...args);
    // If a transaction response arrives after the live deadline, close its baton
    // through the original adapter. Never commit abandoned live work.
    if (transaction) pending.then((payload) => {
      if (expired) database._finishTransaction(payload, "ROLLBACK").catch(() => {});
    }, () => {});
    let caught;
    try {
      // The same timer covers both attempts. A slow timeout never starts a
      // second query, and transaction/write pipelines never retry.
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => { expired = true; reject(timeoutError()); }, remaining);
      });
      try {
        return await Promise.race([pending, deadline]);
      } catch (firstError) {
        if (!snapshotRead || !msTursoAvailability(firstError) || expired ||
            remaining - (Date.now() - started) < 200) throw firstError;
        return await Promise.race([database._pipeline(...args), deadline]);
      }
    } catch (error) {
      caught = error;
      if (msTursoAvailability(error)) unavailable = error;
      throw error;
    } finally {
      const trace = record(expired);
      if (routeWrite) routePersistenceBudget -= Math.max(0, Date.now() - started);
      else remainingBudget -= Math.max(0, Date.now() - started);
      clearTimeout(timer);
      if (caught?.code === "TURSO_LIVE_TIMEOUT") {
        caught.dbTrace = trace;
        console.warn(JSON.stringify({ event: "ms_live_db_timeout", ...trace }));
      }
      if (/^\s*(?:COMMIT|ROLLBACK)\b/i.test(String(requests[0]?.stmt?.sql || ""))) transactionStage = "";
    }
  };
  db._finishTransaction = function(payload, command) {
    if (command === "ROLLBACK") return database._finishTransaction(payload, command);
    return Object.getPrototypeOf(database)._finishTransaction.call(db, payload, command);
  };
  return new Proxy(env, { get: (target, key) => key === "DB" ? db : target[key] });
}
`;
