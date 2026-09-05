from pathlib import Path
import re

# Remove temporary standalone shortcut from the original MS page.
p = Path('ms.html')
s = p.read_text()
s = re.sub(r'\s*<a id="proof-direct-btn" class="btn btn-accent" href="proof\.html">ปริ้นบาร์รถ</a>', '', s, count=1)
p.write_text(s)

# Use the same navigation shell as ms.html.
p = Path('proof.html')
s = p.read_text()
nav = """<nav class='topbar-actions' aria-label='เมนูหลัก'>
          <span id='connection-badge' class='badge badge-neutral'>กำลังเชื่อมต่อ</span>
          <details class='app-nav'><summary><span class='nav-grid-icon'>▦</span><span>เมนูระบบ</span><small>หน้าปริ้นบาร์โค้ดรถ</small></summary><div class='app-nav-menu'><a href='ms.html'><span>🚚</span><b>ติดตามรถ MS</b><small>คิวรถเข้า–ออกและสถานะปัจจุบัน</small></a><a href='proof.html' class='is-current'><span>🧾</span><b>ปริ้นบาร์โค้ดรถ</b><small>ตรวจข้อมูล แก้ไขตามสิทธิ์ MS และปริ้น PDF</small></a><a href='waiting.html'><span>⏱</span><b>รถรอลงงาน</b><small>จัดการคิวและเวลารอลงงาน</small></a><a href='ms-report.html'><span>▥</span><b>สรุปรายวัน</b><small>เปรียบเทียบรถจบงานตามวันและเวลา</small></a></div></details>
          <a id='connect-ms-btn' class='btn btn-accent hidden' href='https://ms.flashexpress.com/#/sendoutlets/storeLineAttendance' target='_blank' rel='noopener'>เปิด MS</a>
          <button id='proof-session-btn' class='btn btn-header hidden' type='button'>ตั้งค่าการเชื่อมต่อ</button>
          <button id='refresh-btn' class='btn btn-header' type='button'>รีเฟรช</button>
          <button id='login-btn' class='btn btn-accent' type='button'>เข้าสู่ระบบ</button>
          <button id='logout-btn' class='btn btn-header hidden' type='button'>ออกจากระบบ</button>
        </nav>"""
s, n = re.subn(r"<nav class='topbar-actions' aria-label='เมนูหลัก'>.*?</nav>", nav, s, count=1, flags=re.S)
if n != 1:
    raise SystemExit('proof nav replacement failed')
s = re.sub(r"\s*<section id='proof-session-panel' class='proof-session-panel'>.*?</section>", '', s, count=1, flags=re.S)
s = s.replace('<h1>การจัดการเส้นทาง</h1>', '<h1>ปริ้นบาร์โค้ดรถ MS</h1>', 1)
s = s.replace('ดูรถที่ต้องจัดการ ตรวจทะเบียน/คนขับตามสิทธิ์ MS และปริ้นบาร์โค้ดด้วย Session ของ HUB', 'ใช้ข้อมูลและการเชื่อมต่อชุดเดียวกับหน้าติดตามรถ MS ตรวจข้อมูลก่อนเปิดบาร์โค้ดและปริ้น PDF', 1)
p.write_text(s)

# Reuse the same online/offline semantics and connection button as ms.html.
p = Path('worker/src/proof-ui-v5.js')
s = p.read_text()
s = s.replace("const VERSION = '20260905-08';", "const VERSION = '20260905-09';", 1)
old = "if (btn) { btn.classList.toggle('hidden', !P.state.auth); btn.textContent = ready ? 'Session ปริ้น: พร้อม' : 'เชื่อม Session ปริ้น'; btn.classList.toggle('btn-accent', !ready); }"
new = "if (btn) { btn.classList.toggle('hidden', !P.state.auth); btn.textContent = 'ตั้งค่าการเชื่อมต่อ'; btn.classList.remove('btn-accent'); btn.classList.add('btn-header'); } const badge = document.getElementById('connection-badge'); if (badge) { badge.textContent = ready ? 'ออนไลน์' : (P.state.auth ? 'เชื่อมต่อไม่ได้' : 'ยังไม่เชื่อมต่อ'); badge.className = `badge ${ready ? 'badge-online' : 'badge-offline'}`; } const openMs = document.getElementById('connect-ms-btn'); if (openMs) openMs.classList.toggle('hidden', !P.state.auth);"
if old not in s:
    raise SystemExit('renderSession marker missing')
s = s.replace(old, new, 1)
old = "const nav = document.querySelector('.topbar-actions');\n    if (nav && !document.getElementById('proof-session-btn')) { const b = document.createElement('button'); b.id = 'proof-session-btn'; b.className = 'btn btn-header hidden'; b.type = 'button'; b.textContent = 'เชื่อม Session ปริ้น'; nav.insertBefore(b, P.el('refresh-btn') || null); b.onclick = openSession; }\n    const main = document.querySelector('main.app-shell');\n    if (main && !document.getElementById('proof-session-panel')) { const p = document.createElement('section'); p.id = 'proof-session-panel'; p.className = 'proof-session-panel'; p.innerHTML = `<div><small>ตัวเชื่อมต่อสำหรับปริ้นบาร์โค้ด</small><strong id=\"proof-session-title\">ต้องตรวจ Session ปริ้น</strong><span id=\"proof-session-detail\">ใช้ Session เดียวกับตัวเชื่อม MS ของ HUB นี้</span></div><button id=\"proof-session-open\" class=\"btn btn-header\" type=\"button\">ตรวจ/เชื่อมต่อ</button>`; main.insertBefore(p, P.el('alert-panel') || main.firstChild); document.getElementById('proof-session-open').onclick = openSession; }\n    const sessionOpenButton = document.getElementById('proof-session-open'); if (sessionOpenButton) sessionOpenButton.onclick = openSession;"
new = "const nav = document.querySelector('.topbar-actions');\n    if (nav && !document.getElementById('proof-session-btn')) { const b = document.createElement('button'); b.id = 'proof-session-btn'; b.className = 'btn btn-header hidden'; b.type = 'button'; b.textContent = 'ตั้งค่าการเชื่อมต่อ'; nav.insertBefore(b, P.el('refresh-btn') || null); }\n    const sessionNavButton = document.getElementById('proof-session-btn'); if (sessionNavButton) sessionNavButton.onclick = openSession;\n    const legacyPanel = document.getElementById('proof-session-panel'); if (legacyPanel) legacyPanel.remove();"
if old not in s:
    raise SystemExit('session shell marker missing')
s = s.replace(old, new, 1)
s = s.replace('เชื่อมต่อ Session สำหรับปริ้นบาร์โค้ด', 'ตั้งค่าการเชื่อมต่อ MS', 1)
s = s.replace('ไม่ต้องสร้าง Session แยกจากหน้าติดตามรถ ระบบใช้ Session เดียวกันของ HUB และชื่อบัญชี MS นี้จะเป็นผู้ดำเนินงานบน PDF', 'ใช้ตัวเชื่อมต่อ MS ชุดเดียวกับหน้าติดตามรถของ HUB นี้ เมื่อเชื่อมแล้วจะใช้ทั้งอ่านข้อมูล แก้ข้อมูลที่ MS อนุญาต และปริ้น PDF', 1)
s = s.replace('<div class="proof-session-card">', '<div class="dialog-card proof-session-card">', 1)
p.write_text(s)

# Guardrails.
assert "หน้าปริ้นบาร์โค้ดรถ" in Path('proof.html').read_text()
assert "id='proof-session-btn'" in Path('proof.html').read_text()
assert "proof-direct-btn" not in Path('ms.html').read_text()
assert "id='proof-session-panel'" not in Path('proof.html').read_text()
