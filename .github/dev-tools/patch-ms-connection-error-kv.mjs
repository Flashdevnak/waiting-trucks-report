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
  const helpers = [
    `// ${MARKER}: persist only HAR/MS error metadata in Browser Worker KV; never Turso or LocalStorage.`,
    `const MS_CONNECTION_OBSERVER_URL = "${OBSERVER_URL}";`,
    ``,
    `function msConnectionSourceLabel(source) {`,
    `  if (source === "routes") return "บันทึกสถานะเส้นทางเดินรถ";`,
    `  if (source === "preEntry") return "พัสดุที่คาดว่าจะเข้าคลัง";`,
    `  if (source === "busTime") return "การจัดการตารางเวลา KIT/TBR";`,
    `  return "การเชื่อมต่อ MS";`,
    `}`,
    ``,
    `function msConnectionObserverBox() {`,
    `  const anchor = el("ms-connection-error");`,
    `  if (!anchor) return null;`,
    `  let box = el("ms-connection-last-error");`,
    `  if (!box) {`,
    `    box = document.createElement("div");`,
    `    box.id = "ms-connection-last-error";`,
    `    box.className = "hidden";`,
    `    box.setAttribute("aria-live", "polite");`,
    `    box.style.marginTop = "10px";`,
    `    box.style.padding = "10px 12px";`,
    `    box.style.border = "1px solid rgba(0,0,0,.12)";`,
    `    box.style.borderRadius = "10px";`,
    `    box.style.fontSize = "13px";`,
    `    box.style.lineHeight = "1.5";`,
    `    box.style.background = "rgba(0,0,0,.035)";`,
    `    anchor.insertAdjacentElement("afterend", box);`,
    `  }`,
    `  return box;`,
    `}`,
    ``,
    `function renderMsConnectionObservedError(record) {`,
    `  const box = msConnectionObserverBox();`,
    `  if (!box) return;`,
    `  if (!record) {`,
    `    box.classList.add("hidden");`,
    `    box.replaceChildren();`,
    `    return;`,
    `  }`,
    `  box.classList.remove("hidden");`,
    `  box.replaceChildren();`,
    `  const title = document.createElement("strong");`,
    `  title.textContent = "ข้อผิดพลาดการเชื่อมต่อล่าสุด";`,
    `  const detail = document.createElement("div");`,
    `  const occurred = record.occurredAt ? shortDateTime(record.occurredAt) : "-";`,
    `  detail.textContent = (record.hub || "-") + " · " + msConnectionSourceLabel(record.source) + " · " + (record.code || "ERROR") + " · " + (record.label || "") + " · " + occurred;`,
    `  const message = document.createElement("div");`,
    `  message.textContent = String(record.message || "");`,
    `  message.style.opacity = ".78";`,
    `  box.append(title, detail, message);`,
    `  if (record.recoveredAt) {`,
    `    const recovered = document.createElement("div");`,
    `    recovered.textContent = "✓ เชื่อมต่อสำเร็จอีกครั้ง " + shortDateTime(record.recoveredAt) + " · error นี้ถูกแก้แล้ว";`,
    `    recovered.style.marginTop = "4px";`,
    `    recovered.style.fontWeight = "700";`,
    `    box.append(recovered);`,
    `  }`,
    `}`,
    ``,
    `async function loadMsConnectionObservedError(hubValue) {`,
    `  const hub = String(hubValue || "").trim().toUpperCase();`,
    `  if (!hub) return;`,
    `  try {`,
    `    const url = new URL(MS_CONNECTION_OBSERVER_URL);`,
    `    url.searchParams.set("hub", hub);`,
    `    const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });`,
    `    const json = await response.json().catch(() => ({}));`,
    `    if (response.ok && json?.ok !== false) renderMsConnectionObservedError(json?.data || null);`,
    `  } catch {}`,
    `}`,
    ``,
    `async function reportMsConnectionObservation(event, source, hubValue, error = null) {`,
    `  const hub = String(hubValue || "").trim().toUpperCase();`,
    `  if (!hub) return;`,
    `  const message = String(error?.message || "").slice(0, 240);`,
    `  const rawCode = String(error?.code || "").slice(0, 40);`,
    `  const code = /429|rate.?limit|too many requests/i.test(rawCode + " " + message) ? "429" : rawCode || "ERROR";`,
    `  try {`,
    `    const url = new URL(MS_CONNECTION_OBSERVER_URL);`,
    `    url.searchParams.set("hub", hub);`,
    `    await fetch(url, {`,
    `      method: "POST",`,
    `      headers: { "content-type": "application/json" },`,
    `      body: JSON.stringify({ event, source, code, message }),`,
    `      cache: "no-store",`,
    `      keepalive: true,`,
    `    });`,
    `  } catch {}`,
    `}`,
    ``,
  ].join("\n");

  output = replaceUnique(
    output,
    helperAnchor,
    helpers + helperAnchor,
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
