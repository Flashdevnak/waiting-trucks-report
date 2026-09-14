import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const [html, css, js, modules, msHtml, msJs, workflow] = await Promise.all([
  readFile(new URL("supervisor.html", root), "utf8"),
  readFile(new URL("supervisor.css", root), "utf8"),
  readFile(new URL("supervisor.js", root), "utf8"),
  readFile(new URL("supervisor-modules.js", root), "utf8"),
  readFile(new URL("ms.html", root), "utf8"),
  readFile(new URL("ms.js", root), "utf8"),
  readFile(new URL(".github/workflows/deploy-worker-dev.yml", root), "utf8"),
]);

test("SUP-01 is an isolated, responsive Supervisor side-car", () => {
  for (const source of [html, css, js]) assert.match(source, /SUPERVISOR_CORE_SHELL_V1/);
  assert.match(html, /supervisor\.css\?v=/);
  assert.match(html, /supervisor\.js\?v=/);
  assert.match(css, /@media\(max-width:700px\)/);
  assert.match(css, /@media\(max-width:420px\)/);
  assert.doesNotMatch(msHtml, /supervisor\.(?:html|js|css)/);
  assert.doesNotMatch(msJs, /supervisor\.(?:html|js|css)/);
});

test("SUP-01 renders truth-safe states and no mock operations data", () => {
  for (const state of ["UNKNOWN", "UNAVAILABLE", "OBSERVE ONLY", "OUT OF SCOPE"])
    assert.match(html, new RegExp(state.replace(" ", "\\s+")));
  assert.match(html, /ไม่มีการ hardcode HUB ตัวอย่าง/);
  assert.match(html, /No events were fabricated/);
  assert.doesNotMatch(html, /96\/100|EA2|NE1/);
});

test("SUP-01 performs zero background, upstream, database, and AI work", () => {
  const runtime = `${js}\n${modules}`;
  assert.doesNotMatch(runtime, /\bfetch\s*\(|new\s+WebSocket|new\s+EventSource|setInterval\s*\(|setTimeout\s*\(/);
  assert.doesNotMatch(runtime, /route_followstart|fleet_time|getList|hbi-common|flashexpress|Turso|SELECT\s|INSERT\s|UPDATE\s|DELETE\s/i);
  assert.doesNotMatch(runtime, /openai|anthropic|gemini|ai[_-]?call/i);
  assert.match(js, /role\s*!==\s*"admin"/);
});

test("SUP-01 contains no credential material and keeps copy actions disabled", () => {
  const combined = `${html}\n${css}\n${js}`;
  assert.doesNotMatch(combined, /Bearer\s+[A-Za-z0-9._-]+|sk-[A-Za-z0-9_-]{10,}|api[_-]?key\s*[:=]\s*["'][^"']+/i);
  assert.match(html, /Copy Current System Context[\s\S]*?<\/button>/);
  assert.match(html, /type="button" disabled>Copy Current System Context/);
});

test("DEV pipeline stages and smoke-checks every Supervisor core asset", () => {
  assert.match(workflow, /supervisor\.html/);
  assert.match(workflow, /supervisor\.js/);
  assert.match(workflow, /supervisor\.css/);
  assert.match(workflow, /supervisor-modules\.js/);
  assert.match(workflow, /SUPERVISOR_CORE_SHELL_V1/);
  assert.match(workflow, /SUPERVISOR_MODULE_REGISTRY_V1/);
  assert.match(workflow, /supervisorResponse\.status!==403/);
  assert.match(workflow, /DEV_SUPERVISOR_ADMIN_GUARD=PASS/);
});
