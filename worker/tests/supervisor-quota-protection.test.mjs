import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { TursoD1Database, tursoRuntimeDiagnostics } from "../src/turso-d1.js";

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return payload; } };
}
function okExecute(rowsRead = 0) {
  return { type: "ok", response: { type: "execute", result: { cols: [], rows: [], affected_row_count: 0, rows_read: rowsRead, rows_written: 0, query_duration_ms: 1 } } };
}
const okClose = { type: "ok", response: { type: "close" } };

test("SUP-12 diagnostics are passive and expose only bounded local guard state", () => {
  const before = tursoRuntimeDiagnostics();
  assert.equal(before.scope, "current-worker-isolate");
  assert.equal(before.globalKillSwitchConfigured, false);
  assert.deepEqual(before.localGuardPolicy, { providerReadBlockMs: 60000, heavyReadCooldownMs: 300000, heavyReadRowsThreshold: 100000 });
  assert.equal(typeof before.heavyReadCooldownsActive, "number");
  assert.equal("sql" in before, false);
  assert.equal("url" in before, false);
  assert.equal("token" in before, false);
});

test("SUP-12 heavy-read backoff is real enforcement and blocks before a second provider fetch", { concurrency: false }, async () => {
  let calls = 0;
  const db = new TursoD1Database({ url: "https://sup12-heavy.turso.io", authToken: "secret", fetchImpl: async () => {
    calls += 1;
    return response({ results: [okExecute(150000), okClose] });
  } });
  await db.prepare("SELECT * FROM sup12_heavy_read WHERE hub=?").bind("NE1").all();
  const observed = tursoRuntimeDiagnostics();
  assert.ok(observed.heavyReadCooldownsActive >= 1);
  assert.ok(Date.parse(observed.heavyReadCooldownUntil) > Date.now());
  await assert.rejects(db.prepare("SELECT * FROM sup12_heavy_read WHERE hub=?").bind("NE1").all(), (error) => error.code === "TURSO_HEAVY_READ_GUARD");
  assert.equal(calls, 1);
});

test("SUP-12 provider circuit opens from a real read-limit error and blocks before another provider fetch", { concurrency: false }, async () => {
  // Fresh module instance isolates this assertion from any earlier local circuit state.
  const fresh = await import(`../src/turso-d1.js?sup12-circuit=${Date.now()}-${Math.random()}`);
  const FreshTursoD1Database = fresh.TursoD1Database;
  const freshDiagnostics = fresh.tursoRuntimeDiagnostics;
  let calls = 0;
  const db = new FreshTursoD1Database({ url: "https://sup12-circuit.turso.io", authToken: "secret", fetchImpl: async () => {
    calls += 1;
    return response({ error: { message: "SQL read operations are forbidden by provider read quota" } }, 429);
  } });
  await assert.rejects(db.prepare("SELECT * FROM sup12_provider_limit_a").all(), (error) => error.code === "TURSO_HTTP_ERROR");
  const opened = freshDiagnostics();
  assert.equal(opened.providerReadCircuitOpen, true);
  assert.ok(Date.parse(opened.providerReadCircuitUntil) > Date.now());
  await assert.rejects(db.prepare("SELECT * FROM sup12_provider_limit_b").all(), (error) => error.code === "TURSO_READS_BLOCKED");
  assert.equal(calls, 1);
});

test("SUP-12 shared protection contract uses latest isolate evidence without inventing provider/account truth", async () => {
  const patch = await readFile("../.github/dev-tools/patch-supervisor-quota-instrumentation.mjs", "utf8");
  for (const marker of ["supervisorQuotaProtection", "LOCAL_GUARD_EVENTS_ONLY", "LOCAL_READ_GUARD", "LOCAL_HEAVY_READ_FINGERPRINT_GUARD", "NOT_CONFIGURED", "canExecute: false"]) assert.ok(patch.includes(marker), marker);
  assert.ok(patch.includes('billingTruth: "UNKNOWN"') || patch.includes('billingTruth: \"UNKNOWN\"'), "billingTruth UNKNOWN");
  assert.ok(patch.includes("const latest = [...candidates]"));
  assert.ok(!patch.includes("totalRowsRead"));
  assert.ok(!patch.includes("accountUsage"));
});

test("SUP-12 frontend remains one-shot observe-only and has no executable kill switch", async () => {
  const [js, html] = await Promise.all([readFile("../supervisor.js", "utf8"), readFile("../supervisor.html", "utf8")]);
  assert.ok(js.includes("SUPERVISOR_QUOTA_PROTECTION_V1"));
  assert.ok(js.includes("deriveQuotaProtection"));
  assert.ok(js.includes("renderQuotaProtection"));
  assert.ok(js.includes("killSwitch: { state: killSwitchState, canExecute: false }"));
  assert.equal((js.match(/fetch\("\/api\/supervisor\/snapshot"/g) || []).length, 1);
  assert.equal(/setInterval\s*\(|new WebSocket\s*\(|EventSource\s*\(/.test(js), false);
  assert.ok(html.includes("supervisor.js?v=20260915-sup15"));
  assert.equal(/kill.?switch[^<]{0,80}<button/i.test(html), false);
});

test("SUP-12 truth wording preserves UNKNOWN provider limits and local-signal semantics", async () => {
  const [js, html] = await Promise.all([readFile("../supervisor.js", "utf8"), readFile("../supervisor.html", "utf8")]);
  assert.ok(js.includes("providerPlanLimit: \"UNKNOWN\""));
  assert.ok(js.includes("leak = local guard signal"));
  assert.ok(js.includes("ไม่มี executable global kill switch"));
  assert.ok(html.includes("provider plan/limit ยัง UNKNOWN"));
});
