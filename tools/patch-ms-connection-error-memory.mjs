const MARKER = "MS_CONNECTION_ERROR_MEMORY_V1";

function replaceUnique(source, from, to, label) {
  const first = source.indexOf(from);
  const last = source.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`MS connection error memory patch failed: ${label}`);
  return source.replace(from, to);
}

export function patchMsConnectionErrorMemory(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;

  const helperAnchor = `document.addEventListener("DOMContentLoaded", () => {`;
  const helpers = `// ${MARKER}: keep the last HAR/MS connection error in this browser only.\nconst MS_CONNECTION_ERROR_KEY = "ms_connection_last_error_v1";\n\nfunction msConnectionSourceLabel(source) {\n  if (source === "routes") return "บันทึกสถานะเส้นทางเดินรถ";\n  if (source === "preEntry") return "พัสดุที่คาดว่าจะเข้าคลัง";\n  if (source === "busTime") return "การจัดการตารางเวลา KIT/TBR";\n  return "การเชื่อมต่อ MS";\n}\n\nfunction loadMsConnectionLastError() {\n  try {\n    const value = JSON.parse(localStorage.getItem(MS_CONNECTION_ERROR_KEY) || "null");\n    return value && typeof value === "object" ? value : null;\n  } catch {\n    return null;\n  }\n}\n\nfunction classifyMsConnectionError(error) {\n  const message = String(error?.message || "ไม่ทราบข้อผิดพลาด");\n  const rawCode = String(error?.code || "");\n  const joined = \`${"${rawCode} ${message}"}\`;\n  if (/429|rate.?limit|too many requests/i.test(joined))\n    return { code: "429", label: "MS จำกัดคำขอชั่วคราว" };\n  if (/REQUEST_TIMEOUT|หมดเวลา|timeout/i.test(joined))\n    return { code: rawCode || "TIMEOUT", label: "การเชื่อมต่อใช้เวลานานเกินไป" };\n  if (/MS_SESSION_EXPIRED|session.*หมดอายุ/i.test(joined))\n    return { code: rawCode || "SESSION", label: "Session MS หมดอายุ" };\n  if (/INVALID_HAR|ไฟล์ HAR/i.test(joined))\n    return { code: rawCode || "HAR", label: "ไฟล์ HAR ไม่ผ่านการตรวจสอบ" };\n  return { code: rawCode || "ERROR", label: "การเชื่อมต่อมีปัญหา" };\n}\n\nfunction saveMsConnectionLastError(source, hub, error) {\n  try {\n    const classified = classifyMsConnectionError(error);\n    localStorage.setItem(\n      MS_CONNECTION_ERROR_KEY,\n      JSON.stringify({\n        at: Date.now(),\n        hub: String(hub || "").toUpperCase(),\n        source: String(source || ""),\n        code: classified.code,\n        label: classified.label,\n        message: String(error?.message || "ไม่ทราบข้อผิดพลาด").slice(0, 500),\n        recoveredAt: 0,\n      }),\n    );\n  } catch {}\n}\n\nfunction markMsConnectionRecovered(source, hub) {\n  try {\n    const value = loadMsConnectionLastError();\n    if (!value) return;\n    const sameSource = String(value.source || "") === String(source || "");\n    const sameHub = String(value.hub || "").toUpperCase() === String(hub || "").toUpperCase();\n    if (!sameSource || !sameHub || Number(value.recoveredAt) > 0) return;\n    value.recoveredAt = Date.now();\n    localStorage.setItem(MS_CONNECTION_ERROR_KEY, JSON.stringify(value));\n  } catch {}\n}\n\nfunction renderMsConnectionLastError() {\n  const anchor = el("ms-connection-error");\n  if (!anchor) return;\n  let box = el("ms-connection-last-error");\n  if (!box) {\n    box = document.createElement("div");\n    box.id = "ms-connection-last-error";\n    box.setAttribute("aria-live", "polite");\n    box.style.marginTop = "10px";\n    box.style.padding = "10px 12px";\n    box.style.border = "1px solid rgba(0,0,0,.12)";\n    box.style.borderRadius = "10px";\n    box.style.fontSize = "13px";\n    box.style.lineHeight = "1.5";\n    box.style.background = "rgba(0,0,0,.035)";\n    anchor.insertAdjacentElement("afterend", box);\n  }\n  const value = loadMsConnectionLastError();\n  if (!value) {\n    box.classList.add("hidden");\n    box.textContent = "";\n    return;\n  }\n  box.classList.remove("hidden");\n  box.replaceChildren();\n  const title = document.createElement("strong");\n  title.textContent = "ข้อผิดพลาดการเชื่อมต่อล่าสุด";\n  const detail = document.createElement("div");\n  const at = Number(value.at) ? dtf.format(new Date(Number(value.at))) : "-";\n  detail.textContent = \`${"${value.hub || "-"} · ${msConnectionSourceLabel(value.source)} · ${value.code || "ERROR"} · ${value.label || ""} · ${at} น."}\`;\n  const message = document.createElement("div");\n  message.textContent = String(value.message || "");\n  message.style.opacity = ".78";\n  box.append(title, detail, message);\n  if (Number(value.recoveredAt) > 0) {\n    const recovered = document.createElement("div");\n    recovered.textContent = \`✓ เชื่อมต่อสำเร็จอีกครั้ง ${"${dtf.format(new Date(Number(value.recoveredAt)))}"} น. · error นี้ถูกแก้แล้ว\`;\n    recovered.style.marginTop = "4px";\n    recovered.style.fontWeight = "700";\n    box.append(recovered);\n  }\n}\n\n`;
  output = replaceUnique(
    output,
    helperAnchor,
    `${helpers}${helperAnchor}`,
    "insert local error-memory helpers",
  );

  output = replaceUnique(
    output,
    `function openMsConnection() {`,
    `function openMsConnection() {\n  renderMsConnectionLastError();`,
    "render remembered error when connection dialog opens",
  );

  output = replaceUnique(
    output,
    `    errorEl.classList.add("hidden");\n    state.branch = hub;`,
    `    markMsConnectionRecovered(source, hub);\n    renderMsConnectionLastError();\n    errorEl.classList.add("hidden");\n    state.branch = hub;`,
    "mark a later successful HAR upload as recovered",
  );

  output = replaceUnique(
    output,
    `  } catch (error) {\n    errorEl.textContent = error.message;\n    errorEl.classList.remove("hidden");\n  } finally {\n    button.disabled = false;\n  }\n}`,
    `  } catch (error) {\n    saveMsConnectionLastError(source, hub, error);\n    renderMsConnectionLastError();\n    errorEl.textContent = error.message;\n    errorEl.classList.remove("hidden");\n  } finally {\n    button.disabled = false;\n  }\n}`,
    "remember HAR/MS connection failures",
  );

  return output;
}
