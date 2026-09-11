from pathlib import Path

p = Path('.github/dev-tools/stage-dev-runtime.mjs')
text = p.read_text()


def replace_once(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected once, found {count}')
    text = text.replace(old, new, 1)


replace_once(
    '    const proofHarAnchor = \'<button class="btn btn-accent" type="button" data-har-save="busTime">ทดสอบและบันทึก</button>\';',
    '    const proofHarAnchor = \'<button class="btn btn-accent" type="button" data-har-save="hbiPhotos">บันทึกเซสชันรูปท้ายรถ</button>\';',
    'proof HAR anchor',
)
replace_once(
    '    const statusAnchor = \'<div data-source-status="busTime"><b>3. การจัดการตารางเวลา (KIT/TBR)</b><span>กำลังตรวจสอบ…</span></div>\';',
    '    const statusAnchor = \'<div data-source-status="hbiPhotos"><b>4. รูปท้ายรถ (HBI)</b><span>กำลังตรวจสอบ…</span></div>\';',
    'proof status anchor',
)
replace_once(
    '    const linkAnchor = \'<a class="btn btn-header setup-link" href="https://ms.flashexpress.com/#/store/busTimeManagement" target="_blank" rel="noopener">3. การจัดการตารางเวลา</a>\';',
    '    const linkAnchor = \'<a class="btn btn-header setup-link" href="https://hbi-v3.flashexpress.com/fleet-load-info" target="_blank" rel="noopener">4. รูปท้ายรถ (HBI)</a>\';',
    'proof link anchor',
)
replace_once(
    'throw new Error("DEV Proof HAR fourth-source anchors missing in ms.html");',
    'throw new Error("DEV Proof HAR fifth-source anchors missing in ms.html");',
    'HTML source count error',
)
replace_once(
    "    output = output.replace('อัปโหลด HAR ทั้ง 3 แหล่ง', 'อัปโหลด HAR ทั้ง 4 แหล่ง');",
    "    output = output.replace('อัปโหลด HAR ทั้ง 4 แหล่ง', 'อัปโหลด HAR ทั้ง 5 แหล่ง');",
    'HAR heading source count',
)
replace_once(
    "    output = output.replace('ให้เปิดและบันทึก HAR จากทั้ง 3 หน้าด้านล่าง', 'ให้เปิดและบันทึก HAR จากทั้ง 4 หน้าด้านล่าง');",
    "    output = output.replace('ให้เปิดและบันทึก HAR จากทั้ง 4 หน้าด้านล่าง', 'ให้เปิดและบันทึก HAR จากทั้ง 5 หน้าด้านล่าง');",
    'HAR instruction source count',
)
replace_once(
    '      `${statusAnchor}<div data-source-status="proof" data-dev-proof-har-status="DEV_PROOF_HAR_CONNECTION_V9"><b>4. ปริ้นบาร์โค้ดรถ</b><span>กำลังตรวจสอบ…</span></div>`,',
    '      `${statusAnchor}<div data-source-status="proof" data-dev-proof-har-status="DEV_PROOF_HAR_CONNECTION_V9"><b>5. ปริ้นบาร์โค้ดรถ</b><span>กำลังตรวจสอบ…</span></div>`,',
    'Proof status numbering',
)
replace_once(
    '      `${linkAnchor}<a class="btn btn-header setup-link" data-dev-proof-har-link="DEV_PROOF_HAR_CONNECTION_V9" href="https://ms.flashexpress.com/#/sendoutlets/storeLine" target="_blank" rel="noopener">4. ปริ้นบาร์โค้ดรถ</a>`,',
    '      `${linkAnchor}<a class="btn btn-header setup-link" data-dev-proof-har-link="DEV_PROOF_HAR_CONNECTION_V9" href="https://ms.flashexpress.com/#/sendoutlets/storeLine" target="_blank" rel="noopener">5. ปริ้นบาร์โค้ดรถ</a>`,',
    'Proof link numbering',
)
replace_once(
    '      `${proofHarAnchor}<label data-dev-proof-har="DEV_PROOF_HAR_CONNECTION_V9"><span>4. HAR ปริ้นบาร์โค้ดรถ</span><input id="ms-har-proof" type="file" accept=".har,application/json" /></label><button id="ms-har-proof-save" class="btn btn-accent" type="button">อัปไฟล์ปริ้นบาร์รถ</button><small class="dev-proof-har-note">อ่าน HAR ในเครื่องและส่งเฉพาะ Session ID / Device ID ที่จำเป็น ไม่เก็บไฟล์ HAR ทั้งไฟล์</small>`,',
    '      `${proofHarAnchor}<label data-dev-proof-har="DEV_PROOF_HAR_CONNECTION_V9"><span>5. HAR ปริ้นบาร์โค้ดรถ</span><input id="ms-har-proof" type="file" accept=".har,application/json" /></label><button id="ms-har-proof-save" class="btn btn-accent" type="button">อัปไฟล์ปริ้นบาร์รถ</button><small class="dev-proof-har-note">อ่าน HAR ในเครื่องและส่งเฉพาะ Session ID / Device ID ที่จำเป็น ไม่เก็บไฟล์ HAR ทั้งไฟล์</small>`,',
    'Proof input numbering',
)

replace_once(
    '  const statusLoop = \'for (const key of ["routes", "preEntry", "busTime"]) {\';',
    '  const statusLoop = \'for (const key of ["routes", "preEntry", "busTime", "hbiPhotos"]) {\';',
    'frontend canonical status loop',
)
replace_once(
    '  const resetInputs = \'["ms-har-routes", "ms-har-preentry", "ms-har-bustime"]\';',
    '  const resetInputs = \'["ms-har-routes", "ms-har-preentry", "ms-har-bustime", "ms-har-hbi-photos"]\';',
    'frontend canonical reset inputs',
)
replace_once(
    'throw new Error("DEV Proof HAR frontend fourth-source anchors missing");',
    'throw new Error("DEV Proof HAR frontend fifth-source anchors missing");',
    'frontend source count error',
)
replace_once(
    '  output = output.replace(statusLoop, \'for (const key of ["routes", "preEntry", "busTime", "proof"]) {\');',
    '  output = output.replace(statusLoop, \'for (const key of ["routes", "preEntry", "busTime", "hbiPhotos", "proof"]) {\');',
    'frontend staged status loop',
)
replace_once(
    '  output = output.replace(resetInputs, \'["ms-har-routes", "ms-har-preentry", "ms-har-bustime", "ms-har-proof"]\');',
    '  output = output.replace(resetInputs, \'["ms-har-routes", "ms-har-preentry", "ms-har-bustime", "ms-har-hbi-photos", "ms-har-proof"]\');',
    'frontend staged reset inputs',
)

p.write_text(text)
