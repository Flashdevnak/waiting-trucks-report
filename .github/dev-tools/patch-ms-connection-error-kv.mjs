const MARKER = "MS_CONNECTION_ERROR_KV_V1";
const OBSERVER_URL = "https://waiting-trucks-ms-browser-test.26nak-testdev.workers.dev/api/connection-error";

function replaceUnique(source, from, to, label) {
  const first = source.indexOf(from);
  const last = source.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`MS connection Browser KV patch failed: ${label}`);
  return source.replace(from, to);
}

export function patchMsConnectionErrorKvFrontend(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;

  const helperAnchor = `document.addEventListener("DOMContentLoaded", () => {`;
  const helpers = `// ${MARKER}: persist only HAR/MS error metadata in Browser Worker KV; never Turso or LocalStorage.\nconst MS_CONNECTION_OBSERVER_URL = "${OBSERVER_URL}";\n\nfunction msConnectionSourceLabel(source) {\n  if (source === "routes") return "บันทึกสถานะเส้นทางเดินรถ";\n  if (source === "preEntry") return "พัสดุที่คาดว่าจะเข้าคลัง";\n  if (source === "busTime") return "การจัดการตารางเวลา KIT/TBR";\n  return "การเชื่อมต่อ MS";\n}\n\nfunction msConnectionObserverBox() {\n  const anchor = el("ms-connection-error");\n  if (!anchor) return null;\n  let box = el("ms-connection-last-error");\n  if (!box) {\n    box = document.createElement("div");\n    box.id = "ms-connection-last-error";\n    box.className = "hidden";\n    box.setAttribute("aria-live", "polite");\n    box.style.marginTop = "10px";\n    box.style.padding = "10px 12px";\n    box.style.border = "1px solid rgba(0,0,0,.12)";\n    box.style.borderRadius = "10px";\n    box.style.fontSize = "13px";\n    box.style.lineHeight = "1.5";\n    box.style.background = "rgba(0,0,0,.035)";\n    anchor.insertAdjacentElement("afterend", box);\n  }\n  return box;\n}\n\nfunction renderMsConnectionObservedError(record) {\n  const box = msConnectionObserverBox();\n  if (!box) return;\n  if (!record) {\n    box.classList.add("hidden");\n    box.replaceChildren();\n    return;\n  }\n  box.classList.remove("hidden");\n  box.replaceChildren();\n  const title = document.createElement("strong");\n  title.textContent = "ข้อผิดพลาดการเชื่อมต่อล่าสุด";\n  const detail = document.createElement("div");\n  const occurred = record.occurredAt ? shortDateTime(record.occurredAt) : "-";\n  detail.textContent = \`${"${record.hub || "-"} · ${msConnectionSourceLabel(record.source)} · ${record.code || "ERROR"} · ${record.label || ""} · ${occurred}"}\`;\n  const message = document.createElement("div");\n  message.textContent = String(record.message || "");\n  message.style.opacity = ".78";\n  box.append(title, detail, message);\n  if (record.recoveredAt) {\n    const recovered = document.createElement("div");\n    recovered.textContent = \`✓ เชื่อมต่อสำเร็จอีกครั้ง ${"${shortDateTime(record.recoveredAt)}"} · error นี้ถูกแก้แล้ว\`;\n    recovered.style.marginTop = "4px";\n    recovered.style.fontWeight = "700";\n    box.append(recovered);\n  }\n}\n\nasync function loadMsConnectionObservedError(hubValue) {\n  const hub = String(hubValue || "").trim().toUpperCase();\n  if (!hub) return;\n  try {\n    const url = new URL(MS_CONNECTION_OBSERVER_URL);\n    url.searchParams.set("hub", hub);\n    const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });\n    const json = await response.json().catch(() => ({}));\n    if (response.ok && json?.ok !== false) renderMsConnectionObservedError(json?.data || null);\n  } catch {}\n}\n\nasync function reportMsConnectionObservation(event, source, hubValue, error = null) {\n  const hub = String(hubValue || "").trim().toUpperCase();\n  if (!hub) return;\n  const message = String(error?.message || "").slice(0, 240);\n  const rawCode = String(error?.code || "").slice(0, 40);\n  const code = /429|rate.?limit|too many requests/i.test(\`${"${rawCode} ${message}"}\`) ? "429" : rawCode || "ERROR";\n  try {\n    const url = new URL(MS_CONNECTION_OBSERVER_URL);\n    url.searchParams.set("hub", hub);\n    await fetch(url, {\n      method: "POST",\n      headers: { "content-type": "application/json" },\n      body: JSON.stringify({ event, source, code, message }),\n      cache: "no-store",\n      keepalive: true,\n    });\n  } catch {}\n}\n\n`;

  output = replaceUnique(
    output,
    helperAnchor,
    `${helpers}${helperAnchor}`,
    "insert Browser KV connection helpers",
  );

  output = replaceUnique(
    output,
    `  el("ms-connection-dialog").showModal();\n  loadMsConnectionStatus();\n}`,
    `  el("ms-connection-dialog").showModal();\n  loadMsConnectionStatus();\n  void loadMsConnectionObservedError(hubInput.value);\n}`,
    "load last Browser KV error when connector dialog opens",
  );

  output = replaceUnique(
    output,
    `      const result = await apiPost("saveMsPreEntryConnection", { hub, credentials });\n      errorEl.classList.add("hidden");`,
    `      const result = await apiPost("saveMsPreEntryConnection", { hub, credentials });\n      void reportMsConnectionObservation("recovered", source, hub).then(() => loadMsConnectionObservedError(hub));\n      errorEl.classList.add("hidden");`,
    "mark pre-entry recovery",
  );

  output = replaceUnique(
    output,
    `      const result = await apiPost("saveMsBusConnection", { hub, credentials });\n      errorEl.classList.add("hidden");`,
    `      const result = await apiPost("saveMsBusConnection", { hub, credentials });\n      void reportMsConnectionObservation("recovered", source, hub).then(() => loadMsConnectionObservedError(hub));\n      errorEl.classList.add("hidden");`,
    "mark BusTime recovery",
  );

  output = replaceUnique(
    output,
    `    const result = await apiPost("saveMsConnection", {\n      hub,\n      sessionId,\n      deviceId,\n    });\n    errorEl.classList.add("hidden");`,
    `    const result = await apiPost("saveMsConnection", {\n      hub,\n      sessionId,\n      deviceId,\n    });\n    void reportMsConnectionObservation("recovered", source, hub).then(() => loadMsConnectionObservedError(hub));\n    errorEl.classList.add("hidden");`,
    "mark route HAR recovery",
  );

  output = replaceUnique(
    output,
    `  } catch (error) {\n    errorEl.textContent = error.message;\n    errorEl.classList.remove("hidden");\n  } finally {\n    button.disabled = false;\n  }\n}\n\nfunction exportCurrent() {`,
    `  } catch (error) {\n    void reportMsConnectionObservation("error", source, hub, error).then(() => loadMsConnectionObservedError(hub));\n    errorEl.textContent = error.message;\n    errorEl.classList.remove("hidden");\n  } finally {\n    button.disabled = false;\n  }\n}\n\nfunction exportCurrent() {`,
    "remember HAR/MS error in Browser KV",
  );

  return output;
}
