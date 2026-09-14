export const SOURCE_REAUTH_MARKER = "MS_SOURCE_REAUTH_GUIDANCE_V1";

function replaceUnique(source, from, to, label) {
  const text = String(source || "");
  const first = text.indexOf(from);
  const last = text.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`MS source re-auth guidance patch failed: ${label}`);
  return text.slice(0, first) + to + text.slice(first + from.length);
}

export function patchMsSourceReauthGuidance(source) {
  let output = String(source || "");
  if (output.includes(SOURCE_REAUTH_MARKER)) return output;

  const statusFunctionAnchor = `async function loadMsConnectionStatus() {`;
  const helpers = `// ${SOURCE_REAUTH_MARKER}: source auth failures are actionable UI state only; no extra polling, DB reads, or upstream calls.\nfunction msSourceNeedsReauth(key, item, routeRepair = {}) {\n  const routeCode = key === "routes" ? String(routeRepair?.code || "") : "";\n  const errorText = String(item?.lastError || "");\n  return routeCode === "MS_SESSION_HTTP_401" || /(^|\\D)401(\\D|$)|need\\s*login|session[^\\n]{0,30}(expired|invalid|denied)|token[^\\n]{0,30}(expired|invalid)|unauthori[sz]ed|invalid[_ -]?session/i.test(routeCode + " " + errorText);\n}\nfunction msReauthInputId(key) {\n  return ({ routes: "ms-har-routes", preEntry: "ms-har-preentry", busTime: "ms-har-bustime", hbiPhotos: "ms-har-hbi-photos" })[key] || "";\n}\nfunction updateMsSourceReauthAction(row, key, required) {\n  if (!row) return;\n  row.querySelector(".source-reauth-action")?.remove();\n  row.classList.toggle("has-source-reauth", Boolean(required));\n  if (!required) return;\n  const inputId = msReauthInputId(key);\n  if (!inputId) return;\n  const button = document.createElement("button");\n  button.type = "button";\n  button.className = "btn btn-header source-reauth-action";\n  button.textContent = key === "busTime" ? "อัปโหลด HAR ตารางเวลาใหม่" : "อัปโหลด HAR ใหม่";\n  button.onclick = () => {\n    const details = document.querySelector("#ms-connection-form details.setup-fallback");\n    if (details) details.open = true;\n    const input = el(inputId);\n    if (!input) return;\n    input.scrollIntoView({ behavior: "smooth", block: "center" });\n    input.click();\n  };\n  row.appendChild(button);\n}\n\n`;
  output = replaceUnique(output, statusFunctionAnchor, helpers + statusFunctionAnchor, "helper insertion");

  const oldStatus = `      const source401 = key === "routes"\n        ? routeRepair?.code === "MS_SESSION_HTTP_401"\n        : /(^|\\D)401(\\D|$)/.test(String(item?.lastError || ""));\n      node.className = item?.configured\n        ? (item.lastError || source401 ? "source-error" : isStale ? "source-stale" : "source-ok")\n        : "source-missing";\n      node.textContent = !item?.configured\n        ? key === "hbiPhotos"\n          ? "ยังไม่ได้อัปโหลด HAR รูปท้ายรถ"\n          : "ยังไม่ได้อัปโหลด"\n        : key === "hbiPhotos"\n          ? "บันทึก HAR แล้ว · รูปจะโหลดเฉพาะเมื่อกดดูรูปท้ายรถ"\n          : item.lastError\n            ? \`เชื่อมต่อมีปัญหา · \${item.lastError}\`\n            : isStale\n              ? \`มีการเชื่อมต่อที่บันทึกไว้ · สำเร็จล่าสุด \${shortDateTime(item.lastSuccessAt || item.updatedAt)} · สถานะปัจจุบันยังไม่ยืนยัน\`\n              : \`พร้อมใช้งาน · อัปเดตล่าสุด \${shortDateTime(item.lastSuccessAt || item.updatedAt)}\`;`;
  const newStatus = `      const sourceAuthRequired = msSourceNeedsReauth(key, item, routeRepair);\n      node.className = item?.configured\n        ? (item.lastError || sourceAuthRequired ? "source-error" : isStale ? "source-stale" : "source-ok")\n        : "source-missing";\n      node.textContent = !item?.configured\n        ? key === "hbiPhotos"\n          ? "ยังไม่ได้อัปโหลด HAR รูปท้ายรถ"\n          : "ยังไม่ได้อัปโหลด"\n        : sourceAuthRequired\n          ? key === "busTime"\n            ? "Session หมดอายุ · อัปโหลด HAR ตารางเวลา KIT/TBR ใหม่"\n            : "Session หมดอายุ · อัปโหลด HAR แหล่งนี้ใหม่"\n          : key === "hbiPhotos"\n            ? "บันทึก HAR แล้ว · รูปจะโหลดเฉพาะเมื่อกดดูรูปท้ายรถ"\n            : item.lastError\n              ? \`เชื่อมต่อมีปัญหา · \${item.lastError}\`\n              : isStale\n                ? \`มีการเชื่อมต่อที่บันทึกไว้ · สำเร็จล่าสุด \${shortDateTime(item.lastSuccessAt || item.updatedAt)} · สถานะปัจจุบันยังไม่ยืนยัน\`\n                : \`พร้อมใช้งาน · อัปเดตล่าสุด \${shortDateTime(item.lastSuccessAt || item.updatedAt)}\`;\n      updateMsSourceReauthAction(row, key, sourceAuthRequired);`;
  output = replaceUnique(output, oldStatus, newStatus, "source status re-auth state");
  output = replaceUnique(output, `      if (source401) {`, `      if (sourceAuthRequired) {`, "aggregate re-auth sources");

  const oldToast = `    if (session401Sources.length) {\n      const detectedAt = session401DetectedAt ? \` · \${shortDateTime(session401DetectedAt)}\` : "";\n      toast(\n        \`MS ตอบกลับ 401\${detectedAt} · Session ปัจจุบันถูกปฏิเสธ · กระทบ: \${session401Sources.join(" / ")} · กรุณาเชื่อมต่อ MS ใหม่ แล้วอัปโหลด HAR ของแหล่งที่ขึ้น 401 ใหม่\`,\n        true,\n        10000,\n      );\n    }`;
  const newToast = `    if (session401Sources.length) {\n      const detectedAt = session401DetectedAt ? \` · \${shortDateTime(session401DetectedAt)}\` : "";\n      toast(\n        \`MS Session ต้องต่อใหม่\${detectedAt} · กระทบ: \${session401Sources.join(" / ")} · กรุณาเปิดแหล่งนั้นหลังเข้าสู่ระบบ แล้วอัปโหลด HAR ใหม่\`,\n        true,\n        10000,\n      );\n    }`;
  output = replaceUnique(output, oldToast, newToast, "re-auth toast guidance");

  const cssAnchor = `.connection-source-status.ms-source-status-v2 span{text-align:left}`;
  output = replaceUnique(
    output,
    cssAnchor,
    `${cssAnchor}.connection-source-status .source-reauth-action{width:auto;min-height:36px;margin-top:7px;padding:6px 10px;align-self:flex-start}.connection-source-status .has-source-reauth{border-left:4px solid #b3261e}`,
    "re-auth action style",
  );

  for (const marker of [
    SOURCE_REAUTH_MARKER,
    "function msSourceNeedsReauth",
    "function updateMsSourceReauthAction",
    "need\\s*login",
    "Session หมดอายุ · อัปโหลด HAR ตารางเวลา KIT/TBR ใหม่",
    "อัปโหลด HAR ตารางเวลาใหม่",
    "MS Session ต้องต่อใหม่",
  ]) if (!output.includes(marker)) throw new Error(`MS source re-auth staging missing ${marker}`);

  const start = output.indexOf(`// ${SOURCE_REAUTH_MARKER}`);
  const end = output.indexOf(statusFunctionAnchor, start);
  const helperBlock = start >= 0 && end > start ? output.slice(start, end) : "";
  if (/setInterval\s*\(|new WebSocket\s*\(|EventSource\s*\(|\bfetch\s*\(|\bapiGet\s*\(|\bapiPost\s*\(/.test(helperBlock))
    throw new Error("MS source re-auth guidance introduced background transport or data reads");
  return output;
}
