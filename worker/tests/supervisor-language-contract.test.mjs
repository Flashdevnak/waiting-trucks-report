import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DEFAULT_SUPERVISOR_LANGUAGE,
  SUPERVISOR_LANGUAGE_KEY,
  nextSupervisorLanguage,
  normalizeSupervisorLanguage,
  readSupervisorLanguage,
  translateSupervisorText,
  writeSupervisorLanguage,
} from "../../supervisor-i18n.js";

const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("SUP-13 defaults to Thai and supports only th/en", () => {
  assert.equal(DEFAULT_SUPERVISOR_LANGUAGE, "th");
  assert.equal(normalizeSupervisorLanguage("th"), "th");
  assert.equal(normalizeSupervisorLanguage("EN"), "en");
  assert.equal(normalizeSupervisorLanguage("xx"), "th");
  assert.equal(nextSupervisorLanguage("th"), "en");
  assert.equal(nextSupervisorLanguage("en"), "th");
});

test("SUP-13 preference is browser-local only and fails closed to Thai", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  assert.equal(readSupervisorLanguage(storage), "th");
  assert.equal(writeSupervisorLanguage(storage, "en"), "en");
  assert.equal(values.get(SUPERVISOR_LANGUAGE_KEY), "en");
  assert.equal(readSupervisorLanguage(storage), "en");
  assert.equal(readSupervisorLanguage({ getItem() { throw new Error("blocked"); } }), "th");
});

test("SUP-13 translates core UI both directions without changing truth codes", () => {
  assert.equal(translateSupervisorText("ภาพรวมระบบ", "en"), "System overview");
  assert.equal(translateSupervisorText("System overview", "th"), "ภาพรวมระบบ");
  assert.equal(translateSupervisorText("15 นาที", "en"), "15 minutes");
  assert.equal(translateSupervisorText("15 minutes", "th"), "15 นาที");
  for (const value of ["UNKNOWN", "HEALTHY", "AUTH_REQUIRED", "OBSERVE ONLY", "EA2", "KIT/TBR"])
    assert.equal(translateSupervisorText(value, "en"), value);
});

test("SUP-13 translates bounded dynamic UI templates but leaves arbitrary evidence untouched", () => {
  assert.equal(
    translateSupervisorText("refresh/coordinator telemetry เท่านั้น · AUTH_REQUIRED 1 · ERROR 2 · STALE 3 · HBI คง click-only", "en"),
    "refresh/coordinator telemetry only · AUTH_REQUIRED 1 · ERROR 2 · STALE 3 · HBI remains click-only",
  );
  assert.equal(
    translateSupervisorText("ต่ออายุ session / HAR จริงของ KIT/TBR สำหรับ EA2 แล้วให้ refresh/coordinator เดิมยืนยันผล; ห้ามสร้าง session ปลอม", "en"),
    "Renew the real session / HAR for KIT/TBR at EA2, then let the existing refresh/coordinator confirm recovery; never fabricate a session",
  );
  const evidence = "EA2/KIT_TBR · AUTH_REQUIRED · need login";
  assert.equal(translateSupervisorText(evidence, "en"), evidence);
});

test("SUP-13 static Thai copy has an English mapping", async () => {
  const html = await read("supervisor.html");
  const textNodes = [...html.matchAll(/>([^<>]+)</g)]
    .map((match) => match[1].replace(/&amp;/g, "&").trim())
    .filter((text) => /[\u0E00-\u0E7F]/.test(text));
  assert.ok(textNodes.length > 20, "expected Thai-first static copy");
  const missing = [...new Set(textNodes.filter((text) => translateSupervisorText(text, "en") === text))];
  assert.deepEqual(missing, []);
});

test("SUP-13 frontend contract adds no transport, timers, DB, repair, or AI work", async () => {
  const i18n = await read("supervisor-i18n.js");
  const html = await read("supervisor.html");
  const app = await read("supervisor.js");
  for (const forbidden of ["fetch(", "WebSocket", "EventSource", "setInterval(", "setTimeout(", "/api/", "TURSO", "repairMs", "openai"])
    assert.equal(i18n.includes(forbidden), false, `i18n must not contain ${forbidden}`);
  assert.ok(i18n.includes("SUPERVISOR_I18N_V1"));
  assert.ok(app.includes("SUPERVISOR_I18N_V1"));
  assert.ok(app.includes("./supervisor-i18n.js?v=20260915-sup14"));
  assert.ok(html.includes('data-language-toggle'));
  assert.equal((html.match(/data-language-toggle/g) || []).length, 2);
  assert.ok(html.includes("supervisor.js?v=20260915-sup15"));
});

test("SUP-13 DEV deploy stages and syntax-checks the language asset", async () => {
  const workflow = await read(".github/workflows/deploy-worker-dev.yml");
  assert.match(workflow, /^\s*cp [^\n]*\.\.\/supervisor-i18n\.js[^\n]* \.dev-assets\/\s*$/m);
  assert.ok(workflow.includes("../supervisor-i18n.js"));
  assert.ok(workflow.includes("node --check .dev-assets/supervisor-i18n.js"));
});
