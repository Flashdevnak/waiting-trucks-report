from pathlib import Path

js_path = Path('ms.js')
css_path = Path('style.css')
js = js_path.read_text()
css = css_path.read_text()

marker = 'MS_CONNECTION_401_TOAST_V2'
if marker in js:
    raise SystemExit('401 toast v2 already applied')

old_toast = '''let toastTimer;
function toast(message, error = false) {
  clearTimeout(toastTimer);
  el("toast").textContent = message;
  el("toast").style.background = error ? "var(--red)" : "var(--navy)";
  el("toast").classList.remove("hidden");
  toastTimer = setTimeout(() => el("toast").classList.add("hidden"), 4000);
}
'''
new_toast = '''let toastTimer;
function toast(message, error = false, durationMs = 4000) {
  clearTimeout(toastTimer);
  el("toast").textContent = message;
  el("toast").style.background = error ? "var(--red)" : "var(--navy)";
  el("toast").classList.remove("hidden");
  const duration = Math.max(1000, Number(durationMs) || 4000);
  toastTimer = setTimeout(() => el("toast").classList.add("hidden"), duration);
}
'''
if js.count(old_toast) != 1:
    raise SystemExit(f'toast anchor count={js.count(old_toast)}')
js = js.replace(old_toast, new_toast, 1)

old_alert = '''    const statusBox = el("connection-source-status");
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
new_alert = '''    // MS_CONNECTION_401_TOAST_V2: reuse the page's native bottom-right toast; never render 401 guidance inside the modal.
    el("ms-session-401-alert")?.remove();
    if (session401Sources.length) {
      const detectedAt = session401DetectedAt ? ` · ${shortDateTime(session401DetectedAt)}` : "";
      toast(
        `MS ตอบกลับ 401${detectedAt} · Session ปัจจุบันถูกปฏิเสธ · กระทบ: ${session401Sources.join(" / ")} · กรุณาเชื่อมต่อ MS ใหม่ แล้วอัปโหลด HAR ของแหล่งที่ขึ้น 401 ใหม่`,
        true,
        10000,
      );
    }
'''
if js.count(old_alert) != 1:
    raise SystemExit(f'global alert anchor count={js.count(old_alert)}')
js = js.replace(old_alert, new_alert, 1)

css_marker = '''\n/* MS_CONNECTION_401_TOAST_V2: keep long 401 guidance readable in the existing bottom-right toast. */
.toast {
  max-width: min(520px, calc(100vw - 36px));
  white-space: normal;
  line-height: 1.45;
  overflow-wrap: anywhere;
}
'''
if 'MS_CONNECTION_401_TOAST_V2' not in css:
    css += css_marker

js_path.write_text(js)
css_path.write_text(css)

# Guard: UI relocation only. No new API, timer, database or upstream transport.
js = js_path.read_text()
css = css_path.read_text()
assert marker in js
assert marker in css
assert 'statusBox.insertAdjacentElement("afterend", sessionAlert)' not in js
assert 'sessionAlert.replaceChildren(title, detail)' not in js
assert 'el("ms-session-401-alert")?.remove();' in js
assert 'true,\n        10000,' in js
assert 'function toast(message, error = false, durationMs = 4000)' in js
assert js.count('apiGet("msConnectionStatus"') == 1
assert js.count('apiGet("msRepairHealthDev"') == 1
assert js.count('setInterval(realtimeTick, CONFIG.pollMs)') == 1
print('MS_CONNECTION_401_TOAST_V2=PASS')
print('MODAL_401_GUIDANCE=0')
print('BOTTOM_RIGHT_NATIVE_TOAST=1')
print('TOAST_401_DURATION_MS=10000')
print('EXTRA_TURSO_READS=0')
print('EXTRA_UPSTREAM_CALLS=0')
