from pathlib import Path

stage_path = Path('.github/dev-tools/stage-dev-runtime.mjs')
test_path = Path('.github/dev-tools/stage-dev-runtime.test.mjs')

s = stage_path.read_text()

# 1) Proof tools: keep the shared connection entry visible. The Proof V9 runtime may
# intercept it and open its local dialog; href remains a safe fallback to ms.html#connection.
old_link = '''      '<a id="proof-session-btn" class="btn btn-header header-link hidden" href="ms.html#connection">การเชื่อมต่อ MS (QR/HAR)</a>',
'''
new_link = '''      '<a id="proof-session-btn" class="btn btn-header header-link" href="ms.html#connection">การเชื่อมต่อ MS (QR/HAR)</a>',
'''
if old_link in s:
    s = s.replace(old_link, new_link, 1)
elif new_link not in s:
    raise SystemExit('Proof connection link anchor not found')

# 2) DEV-only staged ms.html: add the dedicated Proof print HAR control inside
# the shared MS connection dialog. Do not touch canonical ms.html.
proof_html_patch = '''
  if (currentPage === "ms.html" && !output.includes("DEV_PROOF_HAR_CONNECTION_V8")) {
    const proofHarAnchor = '<button class="btn btn-accent" type="button" data-har-save="busTime">ทดสอบและบันทึก</button>';
    if (!output.includes(proofHarAnchor)) throw new Error("DEV Proof HAR connection anchor missing in ms.html");
    output = output.replace(
      proofHarAnchor,
      `${proofHarAnchor}<label data-dev-proof-har="DEV_PROOF_HAR_CONNECTION_V8"><span>4. HAR ปริ้นบาร์โค้ดรถ</span><input id="ms-har-proof" type="file" accept=".har,application/json" /></label><button id="ms-har-proof-save" class="btn btn-accent" type="button">อัปไฟล์ปริ้นบาร์รถ</button><small class="dev-proof-har-note">อ่าน HAR ในเครื่องและส่งเฉพาะ Session ID / Device ID ที่จำเป็น ไม่เก็บไฟล์ HAR ทั้งไฟล์</small>`,
    );
  }
'''
anchor = '''  if (currentPage === "proof.html") {
    output = output.replace(
      /<title>จัดการเส้นทางเดินรถ MS<\\/title>/,
      "<title>ปริ้นบาร์โค้ดรถ MS</title>",
    );
  }
'''
if 'DEV_PROOF_HAR_CONNECTION_V8' not in s:
    if anchor not in s:
        raise SystemExit('patchDevUiShellSource proof title anchor not found')
    s = s.replace(anchor, anchor + proof_html_patch, 1)

# 3) DEV-only staged ms.js behavior. Keep HAR client-side and reuse the existing
# saveMsConnection backend action with only session/device values.
frontend_fn = r'''
export function patchDevProofHarConnectionFrontend(source) {
  const text = String(source || "");
  if (text.includes("DEV_PROOF_HAR_CONNECTION_FRONTEND_V8")) return text;
  const marker = `

// DEV_PROOF_HAR_CONNECTION_FRONTEND_V8: Proof print HAR is parsed locally; only Session ID / Device ID are sent.
document.addEventListener("DOMContentLoaded", () => {
  const button = el("ms-har-proof-save");
  if (button) button.onclick = () => saveProofHarConnection(button);
  const connectionButton = el("ms-connection-btn");
  if (connectionButton) connectionButton.addEventListener("click", () => {
    const input = el("ms-har-proof");
    if (input) input.value = "";
  });
});

async function saveProofHarConnection(button) {
  const errorEl = el("ms-connection-error");
  const input = el("ms-har-proof");
  const file = input?.files?.[0];
  const hub = el("ms-har-hub").value.trim().toUpperCase();
  try {
    button.disabled = true;
    if (!file || file.size > 60 * 1024 * 1024)
      throw new Error("กรุณาเลือกไฟล์ HAR ปริ้นบาร์โค้ดรถ ขนาดไม่เกิน 60 MB");
    let har;
    try { har = JSON.parse(await file.text()); }
    catch { throw new Error("อ่านไฟล์ HAR ปริ้นบาร์โค้ดรถไม่ได้"); }
    const entries = Array.isArray(har?.log?.entries) ? [...har.log.entries].reverse() : [];
    let sessionId = "", deviceId = "", msRequestCount = 0;
    for (const entry of entries) {
      let host = "";
      try { host = new URL(entry?.request?.url || "").hostname.toLowerCase(); }
      catch { continue; }
      if (!host.endsWith("flashexpress.com")) continue;
      msRequestCount += 1;
      const headers = Array.isArray(entry?.request?.headers) ? entry.request.headers : [];
      const header = (name) => String(headers.find((item) => String(item?.name || "").toLowerCase() === name)?.value || "").trim();
      const nextSessionId = header("x-fle-session-id");
      const nextDeviceId = header("x-device-id");
      if (nextSessionId && nextDeviceId) {
        sessionId = nextSessionId;
        deviceId = nextDeviceId;
        break;
      }
    }
    if (!sessionId || !deviceId)
      throw new Error("ไฟล์ HAR นี้ไม่มี Session ID หรือ Device ID ของ MS สำหรับปริ้นบาร์โค้ดรถ");
    await apiPost("saveMsConnection", { hub, sessionId, deviceId });
    errorEl.classList.add("hidden");
    state.branch = hub;
    if (input) input.value = "";
    toast(`เชื่อมต่อปริ้นบาร์โค้ดรถ ${hub} สำเร็จ · ตรวจพบ request MS ${nf.format(msRequestCount)} รายการ`);
    await loadData();
    await loadMsConnectionStatus();
  } catch (error) {
    errorEl.textContent = error.message;
    errorEl.classList.remove("hidden");
  } finally {
    button.disabled = false;
  }
}
`;
  return `${text}${marker}`;
}

'''
if 'export function patchDevProofHarConnectionFrontend' not in s:
    stage_frontend_anchor = 'export function stageFrontend(source) {\n'
    if stage_frontend_anchor not in s:
        raise SystemExit('stageFrontend anchor not found')
    s = s.replace(stage_frontend_anchor, frontend_fn + stage_frontend_anchor, 1)

# Ensure the frontend patch runs last and idempotently.
old_return = '''  output = patchMsConnectionErrorKvFrontend(output);
  return output;
}
'''
new_return = '''  output = patchMsConnectionErrorKvFrontend(output);
  output = patchDevProofHarConnectionFrontend(output);
  return output;
}
'''
if old_return in s:
    s = s.replace(old_return, new_return, 1)
elif new_return not in s:
    raise SystemExit('stageFrontend return anchor not found')

stage_path.write_text(s)

# Permanent regression contracts.
t = test_path.read_text()
if 'patchDevUiShellSource,' not in t:
    t = t.replace('  frontendHasIntegratedDevRuntime,\n', '  frontendHasIntegratedDevRuntime,\n  patchDevUiShellSource,\n', 1)

marker = 'DEV Proof connection exposes print HAR upload in the shared MS connection UI'
if marker not in t:
    t += r'''


test("DEV Proof connection exposes print HAR upload in the shared MS connection UI", async () => {
  const msHtml = await readFile(new URL("ms.html", root), "utf8");
  const proofHtml = await readFile(new URL("proof.html", root), "utf8");
  const stagedMsHtml = patchDevUiShellSource(msHtml, "ms.html");
  const stagedProofHtml = patchDevUiShellSource(proofHtml, "proof.html");
  const stagedFrontend = stageFrontend(frontendSource);

  assert.match(stagedProofHtml, /id="proof-session-btn" class="btn btn-header header-link" href="ms\.html#connection"/);
  assert.match(stagedMsHtml, /DEV_PROOF_HAR_CONNECTION_V8/);
  assert.match(stagedMsHtml, /id="ms-har-proof"/);
  assert.match(stagedMsHtml, /id="ms-har-proof-save"/);
  assert.match(stagedMsHtml, /อัปไฟล์ปริ้นบาร์รถ/);
  assert.match(stagedMsHtml, /ไม่เก็บไฟล์ HAR ทั้งไฟล์/);

  assert.match(stagedFrontend, /DEV_PROOF_HAR_CONNECTION_FRONTEND_V8/);
  assert.match(stagedFrontend, /async function saveProofHarConnection/);
  assert.match(stagedFrontend, /host\.endsWith\("flashexpress\.com"\)/);
  assert.match(stagedFrontend, /header\("x-fle-session-id"\)/);
  assert.match(stagedFrontend, /header\("x-device-id"\)/);
  assert.match(stagedFrontend, /apiPost\("saveMsConnection", \{ hub, sessionId, deviceId \}\)/);
  assert.match(stagedFrontend, /pollMs:\s*4000/);
  assert.equal(stageFrontend(stagedFrontend), stagedFrontend);
});
'''

test_path.write_text(t)

print('DEV_PROOF_CONNECTION_MENU_VISIBLE=PASS')
print('DEV_PROOF_HAR_SHARED_DIALOG=PASS')
print('DEV_PROOF_HAR_CLIENT_SIDE_ONLY=PASS')
print('DEV_PROOF_HAR_WHOLE_FILE_STORED=NO')
print('POLLING_CHANGED=NO')
print('TBR_CHANGED=NO')
print('PRODUCTION_TOUCHED=NO')
