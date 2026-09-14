from pathlib import Path

path = Path("worker/tests/supervisor-quota-protection.test.mjs")
source = path.read_text(encoding="utf-8")

old = '''test("SUP-12 provider circuit opens from a real read-limit error and blocks before another provider fetch", { concurrency: false }, async () => {
  let calls = 0;
  const db = new TursoD1Database({ url: "https://sup12-circuit.turso.io", authToken: "secret", fetchImpl: async () => {
    calls += 1;
    return response({ error: { message: "SQL read operations are forbidden by provider read quota" } }, 429);
  } });
  await assert.rejects(db.prepare("SELECT * FROM sup12_provider_limit_a").all(), (error) => error.code === "TURSO_HTTP_ERROR");
  const opened = tursoRuntimeDiagnostics();
  assert.equal(opened.providerReadCircuitOpen, true);
  assert.ok(Date.parse(opened.providerReadCircuitUntil) > Date.now());
  await assert.rejects(db.prepare("SELECT * FROM sup12_provider_limit_b").all(), (error) => error.code === "TURSO_READS_BLOCKED");
  assert.equal(calls, 1);
});'''
new = '''test("SUP-12 provider circuit opens from a real read-limit error and blocks before another provider fetch", { concurrency: false }, async () => {
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
});'''
if source.count(old) != 1:
    raise RuntimeError(f"SUP-12 harness fix failed: provider test count={source.count(old)}")
source = source.replace(old, new, 1)

old = '''  for (const marker of ["supervisorQuotaProtection", "LOCAL_GUARD_EVENTS_ONLY", "LOCAL_READ_GUARD", "LOCAL_HEAVY_READ_FINGERPRINT_GUARD", "NOT_CONFIGURED", "canExecute: false", "billingTruth: \\\"UNKNOWN\\\""]) assert.ok(patch.includes(marker), marker);
  assert.ok(patch.includes("const latest = [...candidates]"));'''
new = '''  for (const marker of ["supervisorQuotaProtection", "LOCAL_GUARD_EVENTS_ONLY", "LOCAL_READ_GUARD", "LOCAL_HEAVY_READ_FINGERPRINT_GUARD", "NOT_CONFIGURED", "canExecute: false"]) assert.ok(patch.includes(marker), marker);
  assert.ok(patch.includes('billingTruth: "UNKNOWN"') || patch.includes('billingTruth: \\"UNKNOWN\\"'), "billingTruth UNKNOWN");
  assert.ok(patch.includes("const latest = [...candidates]"));'''
if source.count(old) != 1:
    raise RuntimeError(f"SUP-12 harness fix failed: billing marker count={source.count(old)}")
source = source.replace(old, new, 1)

path.write_text(source, encoding="utf-8")
print("SUP12_HARNESS_FIX=PASS")
