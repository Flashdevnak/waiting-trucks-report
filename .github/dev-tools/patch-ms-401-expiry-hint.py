from pathlib import Path

bsnl = chr(92) + "\n"

# DEV staged backend: expose only repair changedAt in the already-sanitized
# read-only diagnostic. No credential/message/Turso/upstream access is added.
p = Path('.github/dev-tools/patch-ms-self-healing-supervisor.mjs')
s = p.read_text()
anchor = '        code: text(repair.code, 80),' + bsnl + '        retryInMs: Math.max(0, Number(repair.retryInMs || 0)),'
replacement = '        code: text(repair.code, 80),' + bsnl + '        changedAt: text(repair.changedAt, 100),' + bsnl + '        retryInMs: Math.max(0, Number(repair.retryInMs || 0)),'
if s.count(anchor) != 1:
    raise SystemExit(f'backend diagnostic anchor count={s.count(anchor)}')
p.write_text(s.replace(anchor, replacement, 1))

# Frontend: read the sanitized repair probe only when the connection dialog opens.
p = Path('ms.js')
s = p.read_text()
old = '    const status = await apiGet("msConnectionStatus", { branch: hub });\n'
new = '''    const status = await apiGet("msConnectionStatus", { branch: hub });
    let repairStatus = null;
    try { repairStatus = await apiGet("msRepairHealthDev", { branch: hub }); }
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

# Small bottom-right helper text.
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
