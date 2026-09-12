from pathlib import Path

# DEV staged backend: authenticated, branch-scoped repair status.
p = Path('.github/dev-tools/patch-ms-self-healing-supervisor.mjs')
s = p.read_text()
anchor = '''  const actor = await verify(url.searchParams.get(\"token\"), env);\\
  if (action === \"msOriginManifestStatus\")'''
replacement = '''  const actor = await verify(url.searchParams.get(\"token\"), env);\\
  if (action === \"msRepairStatus\") {\\
    const branch = pickBranch(actor, url.searchParams.get(\"branch\"));\\
    if (!env.MS_REFRESH_COORDINATOR) fail(\"coordinator unavailable\", \"MS_COORDINATOR_UNAVAILABLE\", 503);\\
    const id = env.MS_REFRESH_COORDINATOR.idFromName(branch);\\
    const stub = env.MS_REFRESH_COORDINATOR.get(id);\\
    const target = new URL(\"https://ms-refresh.internal/repair-health\");\\
    target.searchParams.set(\"branch\", branch);\\
    const response = await stub.fetch(new Request(target));\\
    const payload = await response.json().catch(() => ({}));\\
    if (!response.ok) fail(\"repair status unavailable\", \"MS_REPAIR_STATUS_UNAVAILABLE\", 503);\\
    const repair = payload?.repair || {};\\
    return ok({\\
      branch,\\
      repair: {\\
        policyVersion: Number(repair.policyVersion || 0),\\
        state: text(repair.state, 40),\\
        failures: Number(repair.failures || 0),\\
        nextRetryAt: Number(repair.nextRetryAt || 0),\\
        code: text(repair.code, 80),\\
        changedAt: text(repair.changedAt, 100),\\
        retryInMs: Math.max(0, Number(repair.retryInMs || 0)),\\
      },\\
      quota: { tursoReads: 0, tursoWrites: 0, upstreamCalls: 0 },\\
    });\\
  }\\
  if (action === \"msOriginManifestStatus\")'''
if s.count(anchor) != 1:
    raise SystemExit(f'backend anchor count={s.count(anchor)}')
p.write_text(s.replace(anchor, replacement, 1))

# Frontend: fetch repair state only when connection dialog is opened.
p = Path('ms.js')
s = p.read_text()
old = '    const status = await apiGet("msConnectionStatus", { branch: hub });\n'
new = '''    const status = await apiGet("msConnectionStatus", { branch: hub });
    let repairStatus = null;
    try { repairStatus = await apiGet("msRepairStatus", { branch: hub }); }
    catch { repairStatus = null; }
    const routeRepair = repairStatus?.repair || {};
'''
if s.count(old) != 1:
    raise SystemExit(f'frontend status anchor count={s.count(old)}')
s = s.replace(old, new, 1)

old = '''      const item = status[key];
      if (!node) continue;
      node.className = item?.configured
        ? (item.lastError ? "source-error" : "source-ok")
        : "source-missing";
'''
new = '''      const item = status[key];
      if (!node) continue;
      const row = node.closest("[data-source-status]");
      const latestAt = Date.parse(item?.lastSuccessAt || item?.updatedAt || "");
      const isStale = item?.configured && Number.isFinite(latestAt) && Date.now() - latestAt > 20 * 60 * 1000;
      const source401 = key === "routes"
        ? routeRepair?.code === "MS_SESSION_HTTP_401"
        : /(^|\\D)401(\\D|$)/.test(String(item?.lastError || ""));
      node.className = item?.configured
        ? (item.lastError || source401 ? "source-error" : isStale ? "source-stale" : "source-ok")
        : "source-missing";
'''
if s.count(old) != 1:
    raise SystemExit(f'frontend class anchor count={s.count(old)}')
s = s.replace(old, new, 1)

old = '''            : `พร้อมใช้งาน · อัปเดตล่าสุด ${shortDateTime(item.lastSuccessAt || item.updatedAt)}`;
    }
'''
new = '''            : isStale
              ? `มีการเชื่อมต่อที่บันทึกไว้ · สำเร็จล่าสุด ${shortDateTime(item.lastSuccessAt || item.updatedAt)} · สถานะปัจจุบันยังไม่ยืนยัน`
              : `พร้อมใช้งาน · อัปเดตล่าสุด ${shortDateTime(item.lastSuccessAt || item.updatedAt)}`;

      if (row) {
        let hint = row.querySelector(".source-expiry-hint");
        if (!hint) {
          hint = document.createElement("small");
          hint.className = "source-expiry-hint";
          row.appendChild(hint);
        }
        const sourceNames = {
          routes: "สถานะเส้นทางเดินรถ",
          preEntry: "พัสดุที่คาดว่าจะเข้าคลัง",
          busTime: "การจัดการตารางเวลา (KIT/TBR)",
          hbiPhotos: "รูปท้ายรถ (HBI)",
        };
        const detectedAt = key === "routes" ? routeRepair?.changedAt : "";
        if (source401) {
          hint.textContent = `ตรวจพบ 401${detectedAt ? ` · ${shortDateTime(detectedAt)}` : ""} — MS ปฏิเสธ Session ปัจจุบัน · กรุณาเชื่อมต่อ MS ผ่าน QR ใหม่ และอัปโหลด HAR “${sourceNames[key] || "แหล่งข้อมูลนี้"}” ใหม่อีกครั้ง`;
          hint.hidden = false;
          row.classList.add("has-source-expiry-hint");
        } else {
          hint.textContent = "";
          hint.hidden = true;
          row.classList.remove("has-source-expiry-hint");
        }
      }
    }
'''
if s.count(old) != 1:
    raise SystemExit(f'frontend text anchor count={s.count(old)}')
p.write_text(s.replace(old, new, 1))

# Small bottom-right hint.
p = Path('ms.css')
s = p.read_text()
anchor = '.connection-source-status .source-missing { color: #6b6b66; }\n'
addition = '''.connection-source-status .source-missing { color: #6b6b66; }
.connection-source-status .source-stale { color: #8a5a00; font-weight: 700; }
.connection-source-status > div.has-source-expiry-hint { position: relative; padding-bottom: 34px; }
.connection-source-status .source-expiry-hint {
  position: absolute;
  right: 12px;
  bottom: 7px;
  max-width: calc(100% - 24px);
  color: #8a4b00;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.35;
  text-align: right;
}
'''
if s.count(anchor) != 1:
    raise SystemExit(f'css anchor count={s.count(anchor)}')
p.write_text(s.replace(anchor, addition, 1))
