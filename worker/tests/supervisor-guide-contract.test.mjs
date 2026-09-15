import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { translateSupervisorText } from "../../supervisor-i18n.js";

const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("SUP-14 guide is a real read-only operating guide", async () => {
  const html = await read("supervisor.html");
  const app = await read("supervisor.js");
  assert.ok(html.includes("SUPERVISOR_GUIDE_V1"));
  assert.ok(app.includes("SUPERVISOR_GUIDE_V1"));
  for (const text of ["อ่านสถานะอย่างไร", "ความหมายสถานะ", "หลักฐานและระดับความมั่นใจ", "แนวทางแก้ปัญหาที่พบบ่อย", "ข้อห้ามสำคัญ", "เมื่อไรจึงถือว่าเหตุการณ์หาย"])
    assert.ok(html.includes(text), text);
});

test("SUP-14 guide preserves truth hierarchy and source contracts", async () => {
  const html = await read("supervisor.html");
  for (const code of ["UNKNOWN", "HEALTHY", "STALE", "AUTH_REQUIRED", "ERROR", "FACT", "INFERENCE", "SUSPICION", "OBSERVE ONLY"])
    assert.ok(html.includes(`>${code}<`) || html.includes(`>${code}</strong>`), code);
  assert.ok(html.includes("ใช้ accepted queue truth เดิมเท่านั้น"));
  assert.ok(html.includes("ให้ refresh/coordinator เดิมยืนยัน recovery"));
  assert.ok(html.includes("HBI ต้อง click-only"));
});

test("SUP-14 common troubleshooting never prescribes fabricated recovery", async () => {
  const html = await read("supervisor.html");
  assert.ok(html.includes("ต่ออายุ session / HAR จริง"));
  assert.ok(html.includes("ห้ามสร้าง session ปลอม"));
  assert.ok(html.includes("ไม่สร้าง synthetic refresh"));
  assert.ok(html.includes("ห้ามเพิ่ม direct polling"));
  assert.ok(html.includes("ห้ามแตะ Production"));
});

test("SUP-14 guide Thai copy has bounded English translations", () => {
  const samples = new Map([
    ["อ่านสถานะอย่างไร", "How to read status"],
    ["ความหมายสถานะ", "Status meanings"],
    ["หลักฐานและระดับความมั่นใจ", "Evidence and confidence levels"],
    ["แนวทางแก้ปัญหาที่พบบ่อย", "Common troubleshooting"],
    ["ข้อห้ามสำคัญ", "Critical prohibitions"],
    ["เมื่อไรจึงถือว่าเหตุการณ์หาย", "When an incident can be considered resolved"],
  ]);
  for (const [th, en] of samples) assert.equal(translateSupervisorText(th, "en"), en);
});

test("SUP-14 guide delegates System Context copy to the SUP-15 redaction contract", async () => {
  const html = await read("supervisor.html");
  const panel = html.slice(html.indexOf('data-panel="guide"'), html.indexOf('<dialog id="why-dialog"'));
  assert.ok(panel.includes("SUPERVISOR_SYSTEM_CONTEXT_V1"));
  assert.match(panel, /id="copy-system-context"[^>]+disabled/);
  assert.equal(/data-repair|onclick=|fetch\(|WebSocket|EventSource|setInterval\(/.test(panel), false);
});

test("SUP-14 guide keeps its frontend-only contract under the SUP-15 cache revision", async () => {
  const html = await read("supervisor.html");
  const app = await read("supervisor.js");
  assert.ok(html.includes("supervisor.css?v=20260915-sup14"));
  assert.ok(html.includes("supervisor.js?v=20260915-sup15"));
  assert.ok(app.includes("./supervisor-i18n.js?v=20260915-sup14"));
  assert.ok(app.includes("./supervisor-modules.js?v=20260915-sup15"));
  assert.equal(app.includes("loadGuide"), false);
});
