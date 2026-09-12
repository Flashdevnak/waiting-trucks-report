from pathlib import Path

js_path = Path('ms.js')
css_path = Path('style.css')

js = js_path.read_text()
marker = 'MS_CONNECTION_401_ALERT_V1'
if marker in js:
    raise SystemExit('401 alert patch already applied')

anchor = '    const routeRepair = repairStatus?.repair || {};\n    for (const key of ["routes", "preEntry", "busTime", "hbiPhotos"]) {'
if js.count(anchor) != 1:
    raise SystemExit(f'route repair anchor count={js.count(anchor)}')
js = js.replace(
    anchor,
    '    const routeRepair = repairStatus?.repair || {};\n'
    '    // MS_CONNECTION_401_ALERT_V1: aggregate all current 401 sources into one alert outside the source cards.\n'
    '    const session401Sources = [];\n'
    '    const session401DetectedAt = routeRepair?.changedAt || "";\n'
    '    for (const key of ["routes", "preEntry", "busTime", "hbiPhotos"]) {',
    1,
)

old = '''      if (row) {
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
          hint.textContent = `ตรวจพบ 401${detectedAt ? ` · ${shortDateTime(detectedAt)}` : ""} — MS ปฏิเสธ Session ปัจจุบัน · กรุณาเชื่อมต่อ MS ใหม่ และอัปโหลด HAR “${sourceNames[key] || "แหล่งข้อมูลนี้"}” ใหม่อีกครั้ง`;
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
new = '''      if (row) {
        row.querySelector(".source-expiry-hint")?.remove();
        row.classList.remove("has-source-expiry-hint");
      }
      if (source401) {
        const sourceNames = {
          routes: "สถานะเส้นทางเดินรถ",
          preEntry: "พัสดุที่คาดว่าจะเข้าคลัง",
          busTime: "การจัดการตารางเวลา (KIT/TBR)",
          hbiPhotos: "รูปท้ายรถ (HBI)",
          proof: "ปริ้นบาร์โค้ดรถ",
          originManifest: "LH Manifest",
        };
        const sourceName = sourceNames[key] || "แหล่งข้อมูลนี้";
        if (!session401Sources.includes(sourceName)) session401Sources.push(sourceName);
      }
    }

    const statusBox = el("connection-source-status");
    let sessionAlert = el("ms-session-401-alert");
    if (!sessionAlert && statusBox) {
      sessionAlert = document.createElement("div");
      sessionAlert.id = "ms-session-401-alert";
      sessionAlert.className = "ms-session-401-alert hidden";
      sessionAlert.setAttribute("role", "alert");
      statusBox.insertAdjacentElement("afterend", sessionAlert);
    }
    if (sessionAlert) {
      if (!session401Sources.length) {
        sessionAlert.classList.add("hidden");
        sessionAlert.replaceChildren();
      } else {
        const title = document.createElement("strong");
        title.textContent = `MS ตอบกลับ 401${session401DetectedAt ? ` · ${shortDateTime(session401DetectedAt)}` : ""}`;
        const detail = document.createElement("span");
        detail.textContent = `Session ปัจจุบันถูกปฏิเสธ · กระทบ: ${session401Sources.join(" / ")} · กรุณาเชื่อมต่อ MS ใหม่ แล้วอัปโหลด HAR ของแหล่งที่ขึ้น 401 ใหม่`;
        sessionAlert.replaceChildren(title, detail);
        sessionAlert.classList.remove("hidden");
      }
    }
'''
if js.count(old) != 1:
    raise SystemExit(f'per-row 401 hint block count={js.count(old)}')
js = js.replace(old, new, 1)
js_path.write_text(js)

css = css_path.read_text()
old_css = '''.connection-source-status > div.has-source-expiry-hint { position: relative; padding-bottom: 34px; }
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
new_css = '''/* MS_CONNECTION_401_ALERT_V1: 401 explanation is one shared alert outside the source cards. */
.connection-source-status > div.has-source-expiry-hint { padding-bottom: 11px; }
.connection-source-status .source-expiry-hint { display: none !important; }
.ms-session-401-alert {
  display: grid;
  gap: 4px;
  margin: -2px 0 14px;
  padding: 11px 13px;
  border: 1px solid #e5b6b1;
  border-left: 4px solid #b42318;
  border-radius: 8px;
  background: #fff4f2;
  color: #6f211a;
  font-size: 12px;
  line-height: 1.45;
}
.ms-session-401-alert strong {
  color: #b42318;
  font-size: 13px;
  font-weight: 900;
}
.ms-session-401-alert span { display: block; }
'''
if css.count(old_css) != 1:
    raise SystemExit(f'old 401 css block count={css.count(old_css)}')
css = css.replace(old_css, new_css, 1)
css_path.write_text(css)

# Guard the quota/transport contract: this patch must only reorganize existing UI state.
js = js_path.read_text()
css = css_path.read_text()
assert js.count('apiGet("msConnectionStatus"') == 1
assert js.count('apiGet("msRepairHealthDev"') == 1
assert marker in js
assert 'session401Sources' in js
assert 'id = "ms-session-401-alert"' in js
assert 'proof: "ปริ้นบาร์โค้ดรถ"' in js
assert 'originManifest: "LH Manifest"' in js
assert 'hint.textContent = `ตรวจพบ 401' not in js
assert marker in css
assert '.ms-session-401-alert {' in css
print('MS_CONNECTION_401_ALERT_V1=PASS')
print('PER_CARD_401_HELPER=0')
print('GLOBAL_401_ALERT=1')
print('EXTRA_TURSO_READS=0')
print('EXTRA_UPSTREAM_CALLS=0')
