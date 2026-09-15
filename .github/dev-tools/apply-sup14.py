from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

def read(path):
    return (ROOT / path).read_text(encoding="utf-8")

def write(path, text):
    (ROOT / path).write_text(text, encoding="utf-8")

# supervisor.html — replace the placeholder guide with a bounded read-only operating guide.
path = "supervisor.html"
html = read(path)
start_marker = '        <section class="panel-section" data-panel="guide">'
end_marker = '\n      </section>\n    </div>\n  </div>\n\n  <dialog'
start = html.index(start_marker)
end = html.index(end_marker, start)
new_guide = '''        <section class="panel-section" data-panel="guide">
          <!-- SUPERVISOR_GUIDE_V1: static/read-only operating guide; no source, DB, repair, timer, or AI work. -->
          <div class="section-grid">
            <article class="surface span-2">
              <div class="surface-head"><div><p class="card-label">GUIDE</p><h3>คู่มือ Supervisor</h3></div><span class="status-tag healthy">READ ONLY</span></div>
              <div class="guide-grid">
                <div><strong>อ่านสถานะอย่างไร</strong><p>ใช้ลำดับนี้ทุกครั้งก่อนตัดสินใจ</p></div>
                <div><strong>1. เริ่มจาก Overall และ Snapshot</strong><p>ถ้า Snapshot ยัง UNAVAILABLE หรือ UNKNOWN ให้หยุดที่ข้อเท็จจริงนั้น ห้ามสรุปว่าระบบปกติ</p></div>
                <div><strong>2. เลือก HUB แล้วดู Source Health</strong><p>ตรวจ Route, KIT/TBR และ optional source จาก shared telemetry ที่มีอยู่เท่านั้น</p></div>
                <div><strong>3. ตรวจเวลาและหลักฐานล่าสุด</strong><p>ดู last success, freshness, error และ current incident ก่อนแนะนำการแก้</p></div>
                <div><strong>4. ตรวจ Queue / Lifecycle</strong><p>ใช้ accepted queue truth เดิมเท่านั้น ไม่แก้ arrival, unloading, departure หรือ expiry</p></div>
                <div><strong>5. ยืนยันผลหลังการแก้แบบ manual</strong><p>ให้ refresh/coordinator เดิมยืนยัน recovery ห้ามยิง source เพิ่มเพื่อพิสูจน์ผล</p></div>
              </div>
            </article>

            <article class="surface span-2">
              <div class="surface-head"><div><p class="card-label">STATUS GUIDE</p><h3>ความหมายสถานะ</h3></div></div>
              <div class="guide-grid">
                <div><strong>UNKNOWN</strong><p>หลักฐานไม่พอ ห้ามตีความเป็น HEALTHY</p></div>
                <div><strong>HEALTHY</strong><p>หลักฐานปัจจุบันผ่าน freshness และ contract ที่มีอยู่</p></div>
                <div><strong>STALE</strong><p>มีหลักฐานแต่เก่าเกินเกณฑ์ที่กำหนด</p></div>
                <div><strong>AUTH_REQUIRED</strong><p>ต้องต่ออายุ session หรือ HAR จริง ห้ามสร้าง session ปลอม</p></div>
                <div><strong>ERROR</strong><p>source หรือ runtime รายงานข้อผิดพลาดที่ตรวจสอบได้</p></div>
                <div><strong>OBSERVE ONLY</strong><p>ดูและวิเคราะห์เท่านั้น ไม่มีการซ่อมอัตโนมัติ</p></div>
              </div>
            </article>

            <article class="surface">
              <div class="surface-head"><div><p class="card-label">EVIDENCE</p><h3>หลักฐานและระดับความมั่นใจ</h3></div></div>
              <div class="guide-grid">
                <div><strong>FACT</strong><p>ค่าที่มาจาก current shared state หรือ accepted evidence โดยตรง</p></div>
                <div><strong>INFERENCE</strong><p>ข้อสรุปที่อนุมานได้จากหลักฐานที่ครบ และต้องไม่แทนที่ FACT</p></div>
                <div><strong>SUSPICION</strong><p>ข้อสงสัยที่ยังพิสูจน์ไม่ได้ ต้องแสดงเป็นข้อสงสัย ไม่ใช่ข้อเท็จจริง</p></div>
              </div>
            </article>

            <article class="surface">
              <div class="surface-head"><div><p class="card-label">TROUBLESHOOTING</p><h3>แนวทางแก้ปัญหาที่พบบ่อย</h3></div></div>
              <div class="guide-grid">
                <div><strong>KIT/TBR ขึ้น AUTH_REQUIRED</strong><p>ต่ออายุ session / HAR จริง แล้วให้ coordinator เดิมยืนยันผล</p></div>
                <div><strong>Route เป็น STALE หรือ ERROR</strong><p>ตรวจ last success และ error จาก shared telemetry ก่อน ห้ามเพิ่ม direct polling</p></div>
                <div><strong>หลัง Worker เริ่มใหม่แล้วเป็น UNKNOWN</strong><p>รอหลักฐานจากรอบ refresh จริงเดิม ไม่สร้าง synthetic refresh</p></div>
                <div><strong>Quota หรือ guard ไม่ชัดเจน</strong><p>ใช้เฉพาะ isolate-local telemetry ที่มีอยู่ และคง provider total/limit เป็น UNKNOWN ถ้าไม่มีหลักฐาน</p></div>
              </div>
            </article>

            <article class="surface">
              <div class="surface-head"><div><p class="card-label">SAFETY</p><h3>ข้อห้ามสำคัญ</h3></div></div>
              <ul class="contract-list">
                <li><span>ห้าม Auto Repair ใน SUP-14</span><strong>LOCKED</strong></li>
                <li><span>ห้ามสร้าง HAR, session, event หรือข้อมูลจำลองเพื่อทำให้สถานะเขียว</span><strong>0</strong></li>
                <li><span>ห้ามแตะ Production</span><strong>NO</strong></li>
                <li><span>HBI ต้อง click-only</span><strong>CLICK ONLY</strong></li>
                <li><span>ห้ามเพิ่ม provider/source/DB traffic เพื่อวัด health หรือ quota</span><strong>0</strong></li>
              </ul>
            </article>

            <article class="surface">
              <div class="surface-head"><div><p class="card-label">RESOLUTION</p><h3>เมื่อไรจึงถือว่าเหตุการณ์หาย</h3></div></div>
              <div class="guide-grid">
                <div><strong>Current truth</strong><p>ต้องมี current shared state ที่กลับมาปกติและมี accepted evidence ล่าสุดรองรับ</p></div>
                <div><strong>Event history</strong><p>event history อย่างเดียวไม่พอสำหรับปิด incident</p></div>
                <div><strong>Missing evidence</strong><p>ถ้ายังขาดหลักฐาน ให้คง UNKNOWN หรือ PARTIAL ตามจริง</p></div>
              </div>
            </article>

            <article class="surface span-2">
              <div class="surface-head"><div><p class="card-label">SYSTEM CONTEXT</p><h3>System Context ยังล็อกอยู่</h3></div><span class="status-tag unknown">SUP-15</span></div>
              <p class="body-copy">SUP-14 ให้คู่มือเท่านั้น ปุ่ม Copy Current System Context ยังปิดไว้จนกว่า SUP-15 redaction contract จะผ่าน</p>
              <button class="button button-quiet full" type="button" disabled>Copy Current System Context</button>
            </article>
          </div>
        </section>'''
html = html[:start] + new_guide + html[end:]
html = html.replace("supervisor.css?v=20260915-sup13", "supervisor.css?v=20260915-sup14")
html = html.replace("supervisor.js?v=20260915-sup13", "supervisor.js?v=20260915-sup14")
write(path, html)

# supervisor.js — marker + cache-busted i18n only. No guide runtime work is added.
path = "supervisor.js"
app = read(path)
if "// SUPERVISOR_GUIDE_V1" not in app:
    app = app.replace("// SUPERVISOR_I18N_V1\n", "// SUPERVISOR_I18N_V1\n// SUPERVISOR_GUIDE_V1\n", 1)
app = app.replace("./supervisor-i18n.js?v=20260915-sup13", "./supervisor-i18n.js?v=20260915-sup14")
write(path, app)

# supervisor-i18n.js — all new Thai-first guide copy receives a bounded English mapping.
path = "supervisor-i18n.js"
i18n = read(path)
insert_marker = "]);\n\nconst TEMPLATE_PAIRS"
if "อ่านสถานะอย่างไร" not in i18n:
    pairs = '''  ["อ่านสถานะอย่างไร", "How to read status"],
  ["ใช้ลำดับนี้ทุกครั้งก่อนตัดสินใจ", "Follow this order before making a decision"],
  ["1. เริ่มจาก Overall และ Snapshot", "1. Start with Overall and Snapshot"],
  ["ถ้า Snapshot ยัง UNAVAILABLE หรือ UNKNOWN ให้หยุดที่ข้อเท็จจริงนั้น ห้ามสรุปว่าระบบปกติ", "If Snapshot is still UNAVAILABLE or UNKNOWN, stop at that fact; do not conclude the system is healthy"],
  ["2. เลือก HUB แล้วดู Source Health", "2. Select a HUB and review Source Health"],
  ["ตรวจ Route, KIT/TBR และ optional source จาก shared telemetry ที่มีอยู่เท่านั้น", "Review Route, KIT/TBR, and optional sources only from available shared telemetry"],
  ["3. ตรวจเวลาและหลักฐานล่าสุด", "3. Check timestamps and latest evidence"],
  ["ดู last success, freshness, error และ current incident ก่อนแนะนำการแก้", "Review last success, freshness, error, and current incident before recommending action"],
  ["4. ตรวจ Queue / Lifecycle", "4. Review Queue / Lifecycle"],
  ["ใช้ accepted queue truth เดิมเท่านั้น ไม่แก้ arrival, unloading, departure หรือ expiry", "Use only the existing accepted queue truth; do not alter arrival, unloading, departure, or expiry"],
  ["5. ยืนยันผลหลังการแก้แบบ manual", "5. Confirm results after manual action"],
  ["ให้ refresh/coordinator เดิมยืนยัน recovery ห้ามยิง source เพิ่มเพื่อพิสูจน์ผล", "Let the existing refresh/coordinator confirm recovery; do not add source requests just to prove the result"],
  ["ความหมายสถานะ", "Status meanings"],
  ["หลักฐานไม่พอ ห้ามตีความเป็น HEALTHY", "Evidence is insufficient; do not interpret it as HEALTHY"],
  ["หลักฐานปัจจุบันผ่าน freshness และ contract ที่มีอยู่", "Current evidence satisfies the existing freshness and contract rules"],
  ["มีหลักฐานแต่เก่าเกินเกณฑ์ที่กำหนด", "Evidence exists but is older than the configured threshold"],
  ["ต้องต่ออายุ session หรือ HAR จริง ห้ามสร้าง session ปลอม", "Renew a real session or HAR; never fabricate a session"],
  ["source หรือ runtime รายงานข้อผิดพลาดที่ตรวจสอบได้", "The source or runtime reports a verifiable error"],
  ["หลักฐานและระดับความมั่นใจ", "Evidence and confidence levels"],
  ["ค่าที่มาจาก current shared state หรือ accepted evidence โดยตรง", "A value taken directly from current shared state or accepted evidence"],
  ["ข้อสรุปที่อนุมานได้จากหลักฐานที่ครบ และต้องไม่แทนที่ FACT", "A conclusion supported by complete evidence; it must never replace FACT"],
  ["ข้อสงสัยที่ยังพิสูจน์ไม่ได้ ต้องแสดงเป็นข้อสงสัย ไม่ใช่ข้อเท็จจริง", "An unproven suspicion must be shown as suspicion, not as fact"],
  ["แนวทางแก้ปัญหาที่พบบ่อย", "Common troubleshooting"],
  ["KIT/TBR ขึ้น AUTH_REQUIRED", "KIT/TBR shows AUTH_REQUIRED"],
  ["ต่ออายุ session / HAR จริง แล้วให้ coordinator เดิมยืนยันผล", "Renew the real session / HAR, then let the existing coordinator confirm the result"],
  ["Route เป็น STALE หรือ ERROR", "Route is STALE or ERROR"],
  ["ตรวจ last success และ error จาก shared telemetry ก่อน ห้ามเพิ่ม direct polling", "Check last success and error from shared telemetry first; do not add direct polling"],
  ["หลัง Worker เริ่มใหม่แล้วเป็น UNKNOWN", "UNKNOWN after the Worker restarts"],
  ["รอหลักฐานจากรอบ refresh จริงเดิม ไม่สร้าง synthetic refresh", "Wait for evidence from the existing real refresh cycle; do not create a synthetic refresh"],
  ["Quota หรือ guard ไม่ชัดเจน", "Quota or guard state is unclear"],
  ["ใช้เฉพาะ isolate-local telemetry ที่มีอยู่ และคง provider total/limit เป็น UNKNOWN ถ้าไม่มีหลักฐาน", "Use only available isolate-local telemetry and keep provider total/limit UNKNOWN when evidence is absent"],
  ["ข้อห้ามสำคัญ", "Critical prohibitions"],
  ["ห้าม Auto Repair ใน SUP-14", "Auto Repair is prohibited in SUP-14"],
  ["ห้ามสร้าง HAR, session, event หรือข้อมูลจำลองเพื่อทำให้สถานะเขียว", "Do not fabricate HAR, sessions, events, or data to make status green"],
  ["ห้ามแตะ Production", "Do not touch Production"],
  ["HBI ต้อง click-only", "HBI must remain click-only"],
  ["ห้ามเพิ่ม provider/source/DB traffic เพื่อวัด health หรือ quota", "Do not add provider/source/DB traffic to measure health or quota"],
  ["เมื่อไรจึงถือว่าเหตุการณ์หาย", "When an incident can be considered resolved"],
  ["ต้องมี current shared state ที่กลับมาปกติและมี accepted evidence ล่าสุดรองรับ", "Current shared state must be healthy again and supported by the latest accepted evidence"],
  ["event history อย่างเดียวไม่พอสำหรับปิด incident", "Event history alone is not enough to close an incident"],
  ["ถ้ายังขาดหลักฐาน ให้คง UNKNOWN หรือ PARTIAL ตามจริง", "If evidence is still missing, keep UNKNOWN or PARTIAL truthfully"],
  ["System Context ยังล็อกอยู่", "System Context remains locked"],
  ["SUP-14 ให้คู่มือเท่านั้น ปุ่ม Copy Current System Context ยังปิดไว้จนกว่า SUP-15 redaction contract จะผ่าน", "SUP-14 provides the guide only; Copy Current System Context stays disabled until the SUP-15 redaction contract passes"],
'''
    i18n = i18n.replace(insert_marker, pairs + insert_marker, 1)
write(path, i18n)

# New focused SUP-14 contract test.
test_path = ROOT / "worker/tests/supervisor-guide-contract.test.mjs"
test_path.write_text('''import test from "node:test";\nimport assert from "node:assert/strict";\nimport { readFile } from "node:fs/promises";\nimport { translateSupervisorText } from "../../supervisor-i18n.js";\n\nconst root = new URL("../../", import.meta.url);\nconst read = (path) => readFile(new URL(path, root), "utf8");\n\ntest("SUP-14 guide is a real read-only operating guide", async () => {\n  const html = await read("supervisor.html");\n  const app = await read("supervisor.js");\n  assert.ok(html.includes("SUPERVISOR_GUIDE_V1"));\n  assert.ok(app.includes("SUPERVISOR_GUIDE_V1"));\n  for (const text of ["อ่านสถานะอย่างไร", "ความหมายสถานะ", "หลักฐานและระดับความมั่นใจ", "แนวทางแก้ปัญหาที่พบบ่อย", "ข้อห้ามสำคัญ", "เมื่อไรจึงถือว่าเหตุการณ์หาย"])\n    assert.ok(html.includes(text), text);\n});\n\ntest("SUP-14 guide preserves truth hierarchy and source contracts", async () => {\n  const html = await read("supervisor.html");\n  for (const code of ["UNKNOWN", "HEALTHY", "STALE", "AUTH_REQUIRED", "ERROR", "FACT", "INFERENCE", "SUSPICION", "OBSERVE ONLY"])\n    assert.ok(html.includes(`>${code}<`) || html.includes(`>${code}</strong>`), code);\n  assert.ok(html.includes("ใช้ accepted queue truth เดิมเท่านั้น"));\n  assert.ok(html.includes("ให้ refresh/coordinator เดิมยืนยัน recovery"));\n  assert.ok(html.includes("HBI ต้อง click-only"));\n});\n\ntest("SUP-14 common troubleshooting never prescribes fabricated recovery", async () => {\n  const html = await read("supervisor.html");\n  assert.ok(html.includes("ต่ออายุ session / HAR จริง"));\n  assert.ok(html.includes("ห้ามสร้าง session ปลอม"));\n  assert.ok(html.includes("ไม่สร้าง synthetic refresh"));\n  assert.ok(html.includes("ห้ามเพิ่ม direct polling"));\n  assert.ok(html.includes("ห้ามแตะ Production"));\n});\n\ntest("SUP-14 guide Thai copy has bounded English translations", () => {\n  const samples = new Map([\n    ["อ่านสถานะอย่างไร", "How to read status"],\n    ["ความหมายสถานะ", "Status meanings"],\n    ["หลักฐานและระดับความมั่นใจ", "Evidence and confidence levels"],\n    ["แนวทางแก้ปัญหาที่พบบ่อย", "Common troubleshooting"],\n    ["ข้อห้ามสำคัญ", "Critical prohibitions"],\n    ["เมื่อไรจึงถือว่าเหตุการณ์หาย", "When an incident can be considered resolved"],\n  ]);\n  for (const [th, en] of samples) assert.equal(translateSupervisorText(th, "en"), en);\n});\n\ntest("SUP-14 keeps System Context copy locked for SUP-15", async () => {\n  const html = await read("supervisor.html");\n  const panel = html.slice(html.indexOf('data-panel="guide"'), html.indexOf('<dialog id="why-dialog"'));\n  assert.match(panel, /<button[^>]+disabled>Copy Current System Context<\\/button>/);\n  assert.ok(panel.includes("SUP-15 redaction contract"));\n  assert.equal(/data-guide-action|data-repair|onclick=|fetch\\(|WebSocket|EventSource|setInterval\\(/.test(panel), false);\n});\n\ntest("SUP-14 only cache-busts existing frontend assets and adds no guide runtime transport", async () => {\n  const html = await read("supervisor.html");\n  const app = await read("supervisor.js");\n  assert.ok(html.includes("supervisor.css?v=20260915-sup14"));\n  assert.ok(html.includes("supervisor.js?v=20260915-sup14"));\n  assert.ok(app.includes("./supervisor-i18n.js?v=20260915-sup14"));\n  assert.equal(app.includes("bindGuide"), false);\n  assert.equal(app.includes("loadGuide"), false);\n});\n''', encoding="utf-8")

# Include the focused test in the full regression command.
path = "worker/package.json"
pkg = read(path)
needle = "tests/supervisor-language-contract.test.mjs tests/bus-enrichment.test.mjs"
replacement = "tests/supervisor-language-contract.test.mjs tests/supervisor-guide-contract.test.mjs tests/bus-enrichment.test.mjs"
if replacement not in pkg:
    if needle not in pkg:
        raise SystemExit("package test insertion point missing")
    pkg = pkg.replace(needle, replacement, 1)
write(path, pkg)

# Align cache-key assertions in existing supervisor regression tests only.
for test_file in (ROOT / "worker/tests").glob("supervisor-*.test.mjs"):
    text = test_file.read_text(encoding="utf-8")
    text = text.replace("20260915-sup13", "20260915-sup14")
    test_file.write_text(text, encoding="utf-8")

print("SUP-14 patch applied")
