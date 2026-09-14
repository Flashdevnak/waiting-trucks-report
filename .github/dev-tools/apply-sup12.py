from pathlib import Path


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if source.count(old) != 1:
        raise RuntimeError(f"SUP-12 apply failed: {label} count={source.count(old)}")
    return source.replace(old, new, 1)


def update(path: str, fn):
    p = Path(path)
    source = p.read_text(encoding="utf-8")
    output = fn(source)
    if output == source:
        raise RuntimeError(f"SUP-12 apply made no change: {path}")
    p.write_text(output, encoding="utf-8")


def esc_lines(*lines: str) -> str:
    return r"\n".join(lines)


# Passive guard diagnostics only. Enforcement thresholds and guard behavior are unchanged.
def patch_turso(source: str) -> str:
    old = '''export function tursoRuntimeDiagnostics() {
  return {
    scope: "current-worker-isolate",
    since: tursoRuntimeStartedAt,
    ...tursoRuntimeCounters,
    providerReadCircuitOpen: tursoProviderReadBlockedUntil > Date.now(),
  };
}'''
    new = '''export function tursoRuntimeDiagnostics() {
  const now = Date.now();
  let heavyReadCooldownsActive = 0;
  let heavyReadCooldownUntil = 0;
  for (const until of tursoHeavyReadUntil.values()) {
    const numericUntil = Number(until) || 0;
    if (numericUntil <= now) continue;
    heavyReadCooldownsActive += 1;
    heavyReadCooldownUntil = Math.max(heavyReadCooldownUntil, numericUntil);
  }
  const providerReadCircuitOpen = tursoProviderReadBlockedUntil > now;
  return {
    scope: "current-worker-isolate",
    since: tursoRuntimeStartedAt,
    ...tursoRuntimeCounters,
    providerReadCircuitOpen,
    providerReadCircuitUntil: providerReadCircuitOpen ? new Date(tursoProviderReadBlockedUntil).toISOString() : null,
    heavyReadCooldownsActive,
    heavyReadCooldownUntil: heavyReadCooldownUntil > now ? new Date(heavyReadCooldownUntil).toISOString() : null,
    localGuardPolicy: {
      providerReadBlockMs: TURSO_PROVIDER_READ_BLOCK_MS,
      heavyReadCooldownMs: TURSO_HEAVY_READ_COOLDOWN_MS,
      heavyReadRowsThreshold: TURSO_HEAVY_READ_ROWS,
    },
    globalKillSwitchConfigured: false,
  };
}'''
    return replace_once(source, old, new, "passive Turso guard diagnostics")


update("worker/src/turso-d1.js", patch_turso)


def patch_quota(source: str) -> str:
    out = source
    out = replace_once(
        out,
        esc_lines(
            '  const circuit = typeof value.providerReadCircuitOpen === "boolean" ? value.providerReadCircuitOpen : null;',
            '  const since = supervisorQuotaTime(value.since);',
        ),
        esc_lines(
            '  const circuit = typeof value.providerReadCircuitOpen === "boolean" ? value.providerReadCircuitOpen : null;',
            '  const providerReadCircuitUntil = supervisorQuotaTime(value.providerReadCircuitUntil);',
            '  const heavyReadCooldownsActive = supervisorQuotaCounter(value.heavyReadCooldownsActive);',
            '  const heavyReadCooldownUntil = supervisorQuotaTime(value.heavyReadCooldownUntil);',
            '  const rawPolicy = value.localGuardPolicy && typeof value.localGuardPolicy === "object" ? value.localGuardPolicy : {};',
            '  const localGuardPolicy = {',
            '    providerReadBlockMs: supervisorQuotaCounter(rawPolicy.providerReadBlockMs),',
            '    heavyReadCooldownMs: supervisorQuotaCounter(rawPolicy.heavyReadCooldownMs),',
            '    heavyReadRowsThreshold: supervisorQuotaCounter(rawPolicy.heavyReadRowsThreshold),',
            '  };',
            '  const globalKillSwitchConfigured = typeof value.globalKillSwitchConfigured === "boolean" ? value.globalKillSwitchConfigured : null;',
            '  const since = supervisorQuotaTime(value.since);',
        ),
        "sanitize SUP-12 guard fields",
    )
    out = replace_once(
        out,
        '  const hasEvidence = Object.values(counters).some((item) => item !== null) || circuit !== null || Boolean(since) || Boolean(lastObservedAt);',
        '  const hasEvidence = Object.values(counters).some((item) => item !== null) || circuit !== null || heavyReadCooldownsActive !== null || globalKillSwitchConfigured !== null || Boolean(since) || Boolean(lastObservedAt);',
        "include protection evidence",
    )
    old_tail = esc_lines(
        '    providerReadCircuitOpen: circuit,',
        '    lastObservedAt,',
        '  };',
        '}',
        '',
        '${eventMarker}',
    )
    new_tail = esc_lines(
        '    providerReadCircuitOpen: circuit,',
        '    providerReadCircuitUntil,',
        '    heavyReadCooldownsActive,',
        '    heavyReadCooldownUntil,',
        '    localGuardPolicy,',
        '    globalKillSwitchConfigured,',
        '    lastObservedAt,',
        '  };',
        '}',
        'function supervisorQuotaProtection(quotaHubs) {',
        '  const unknown = {',
        '    availability: "UNKNOWN", mode: "OBSERVE_ONLY", evidenceScope: "current-worker-isolate",',
        '    leakSignal: { state: "UNKNOWN", basis: "LOCAL_GUARD_EVENTS_ONLY" },',
        '    circuit: { state: "UNKNOWN", until: null, enforcement: "LOCAL_READ_GUARD" },',
        '    backoff: { state: "UNKNOWN", activeCooldowns: null, until: null, enforcement: "LOCAL_HEAVY_READ_FINGERPRINT_GUARD" },',
        '    killSwitch: { state: "UNKNOWN", canExecute: false },',
        '    policy: { providerReadBlockMs: null, heavyReadCooldownMs: null, heavyReadRowsThreshold: null },',
        '    observedAt: null,',
        '  };',
        '  const candidates = (Array.isArray(quotaHubs) ? quotaHubs : []).filter((item) => item && typeof item === "object");',
        '  if (!candidates.length) return unknown;',
        '  const latest = [...candidates].sort((left, right) => {',
        '    const leftAt = Date.parse(String(left.observedAt || left.lastObservedAt || ""));',
        '    const rightAt = Date.parse(String(right.observedAt || right.lastObservedAt || ""));',
        '    return (Number.isFinite(leftAt) ? leftAt : 0) - (Number.isFinite(rightAt) ? rightAt : 0);',
        '  }).at(-1);',
        '  const circuitState = latest.providerReadCircuitOpen === true ? "OPEN" : latest.providerReadCircuitOpen === false ? "CLOSED" : "UNKNOWN";',
        '  const backoffState = Number.isSafeInteger(latest.heavyReadCooldownsActive) && latest.heavyReadCooldownsActive >= 0',
        '    ? latest.heavyReadCooldownsActive > 0 ? "ACTIVE" : "CLEAR"',
        '    : "UNKNOWN";',
        '  const leakSignal = Number.isSafeInteger(latest.providerLimitErrors) && latest.providerLimitErrors >= 0 && Number.isSafeInteger(latest.heavyReadEvents) && latest.heavyReadEvents >= 0',
        '    ? latest.providerLimitErrors > 0 || latest.heavyReadEvents > 0 ? "SIGNAL_OBSERVED" : "NO_LOCAL_GUARD_SIGNAL_OBSERVED"',
        '    : "UNKNOWN";',
        '  const killSwitchState = latest.globalKillSwitchConfigured === false ? "NOT_CONFIGURED" : latest.globalKillSwitchConfigured === true ? "CONFIGURED_NON_EXECUTABLE" : "UNKNOWN";',
        '  const policy = latest.localGuardPolicy && typeof latest.localGuardPolicy === "object" ? latest.localGuardPolicy : {};',
        '  const policyComplete = [policy.providerReadBlockMs, policy.heavyReadCooldownMs, policy.heavyReadRowsThreshold].every((item) => Number.isSafeInteger(item) && item >= 0);',
        '  const availability = circuitState !== "UNKNOWN" && backoffState !== "UNKNOWN" && leakSignal !== "UNKNOWN" && killSwitchState !== "UNKNOWN" && policyComplete ? "AVAILABLE" : "PARTIAL";',
        '  return {',
        '    availability, mode: "OBSERVE_ONLY", evidenceScope: "current-worker-isolate",',
        '    leakSignal: { state: leakSignal, basis: "LOCAL_GUARD_EVENTS_ONLY" },',
        '    circuit: { state: circuitState, until: latest.providerReadCircuitUntil || null, enforcement: "LOCAL_READ_GUARD" },',
        '    backoff: { state: backoffState, activeCooldowns: Number.isSafeInteger(latest.heavyReadCooldownsActive) ? latest.heavyReadCooldownsActive : null, until: latest.heavyReadCooldownUntil || null, enforcement: "LOCAL_HEAVY_READ_FINGERPRINT_GUARD" },',
        '    killSwitch: { state: killSwitchState, canExecute: false },',
        '    policy: {',
        '      providerReadBlockMs: Number.isSafeInteger(policy.providerReadBlockMs) ? policy.providerReadBlockMs : null,',
        '      heavyReadCooldownMs: Number.isSafeInteger(policy.heavyReadCooldownMs) ? policy.heavyReadCooldownMs : null,',
        '      heavyReadRowsThreshold: Number.isSafeInteger(policy.heavyReadRowsThreshold) ? policy.heavyReadRowsThreshold : null,',
        '    },',
        '    observedAt: latest.observedAt || latest.lastObservedAt || null,',
        '  };',
        '}',
        '',
        '${eventMarker}',
    )
    out = replace_once(out, old_tail, new_tail, "derive truth-safe protection contract")
    out = replace_once(
        out,
        esc_lines(
            '    const quotaAvailability = !quotaHubs.length',
            '      ? "UNKNOWN"',
            '      : quotaHubs.length < hubs.length || quotaHubs.some((item) => item.state !== "AVAILABLE")',
            '        ? "PARTIAL"',
            '        : "AVAILABLE";',
            '    return {',
        ),
        esc_lines(
            '    const quotaAvailability = !quotaHubs.length',
            '      ? "UNKNOWN"',
            '      : quotaHubs.length < hubs.length || quotaHubs.some((item) => item.state !== "AVAILABLE")',
            '        ? "PARTIAL"',
            '        : "AVAILABLE";',
            '    const quotaProtection = supervisorQuotaProtection(quotaHubs);',
            '    return {',
        ),
        "derive quota protection from latest isolate sample",
    )
    out = replace_once(
        out,
        esc_lines(
            '        coverage: { observedHubs: hubs.length, quotaObservedHubs: quotaHubs.length },',
            '        hubs: quotaHubs,',
        ),
        esc_lines(
            '        coverage: { observedHubs: hubs.length, quotaObservedHubs: quotaHubs.length },',
            '        protection: quotaProtection,',
            '        hubs: quotaHubs,',
        ),
        "publish quota protection",
    )
    out = replace_once(
        out,
        '    quotaTelemetry: { availability: "UNAVAILABLE", mode: "PIGGYBACK_ISOLATE_COUNTERS", billingTruth: "UNKNOWN", observedAt: null, coverage: { observedHubs: 0, quotaObservedHubs: 0 }, hubs: [] },',
        '    quotaTelemetry: { availability: "UNAVAILABLE", mode: "PIGGYBACK_ISOLATE_COUNTERS", billingTruth: "UNKNOWN", observedAt: null, coverage: { observedHubs: 0, quotaObservedHubs: 0 }, protection: supervisorQuotaProtection([]), hubs: [] },',
        "publish unavailable protection truth",
    )
    return out


update(".github/dev-tools/patch-supervisor-quota-instrumentation.mjs", patch_quota)


PROTECTION_LOGIC = '''// SUPERVISOR_QUOTA_PROTECTION_V1: pure presentation of the latest sanitized isolate guard state.
// Leak is only a local guard signal; it is never promoted to provider/account leak truth.
function deriveQuotaProtection(raw) {
  const unknown = {
    availability: "UNKNOWN", mode: "OBSERVE_ONLY", evidenceScope: "current-worker-isolate",
    leakSignal: { state: "UNKNOWN", basis: "LOCAL_GUARD_EVENTS_ONLY" },
    circuit: { state: "UNKNOWN", until: null, enforcement: "LOCAL_READ_GUARD" },
    backoff: { state: "UNKNOWN", activeCooldowns: null, until: null, enforcement: "LOCAL_HEAVY_READ_FINGERPRINT_GUARD" },
    killSwitch: { state: "UNKNOWN", canExecute: false },
    policy: { providerReadBlockMs: null, heavyReadCooldownMs: null, heavyReadRowsThreshold: null },
    observedAt: null,
  };
  if (!raw || typeof raw !== "object" || raw.mode !== "OBSERVE_ONLY" || raw.evidenceScope !== "current-worker-isolate") return unknown;
  const pickState = (value, allowed) => allowed.includes(String(value || "")) ? String(value) : "UNKNOWN";
  const positive = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const leakState = pickState(raw.leakSignal?.state, ["SIGNAL_OBSERVED", "NO_LOCAL_GUARD_SIGNAL_OBSERVED", "UNKNOWN"]);
  const circuitState = pickState(raw.circuit?.state, ["OPEN", "CLOSED", "UNKNOWN"]);
  const backoffState = pickState(raw.backoff?.state, ["ACTIVE", "CLEAR", "UNKNOWN"]);
  const killSwitchState = pickState(raw.killSwitch?.state, ["NOT_CONFIGURED", "CONFIGURED_NON_EXECUTABLE", "UNKNOWN"]);
  const policy = {
    providerReadBlockMs: positive(raw.policy?.providerReadBlockMs),
    heavyReadCooldownMs: positive(raw.policy?.heavyReadCooldownMs),
    heavyReadRowsThreshold: positive(raw.policy?.heavyReadRowsThreshold),
  };
  const activeCooldowns = positive(raw.backoff?.activeCooldowns);
  const circuitUntil = quotaCenterTime(raw.circuit?.until);
  const backoffUntil = quotaCenterTime(raw.backoff?.until);
  const observedAt = quotaCenterTime(raw.observedAt);
  const complete = leakState !== "UNKNOWN" && circuitState !== "UNKNOWN" && backoffState !== "UNKNOWN" && killSwitchState !== "UNKNOWN" && Object.values(policy).every((item) => item !== null);
  return {
    availability: complete && raw.availability === "AVAILABLE" ? "AVAILABLE" : "PARTIAL",
    mode: "OBSERVE_ONLY", evidenceScope: "current-worker-isolate",
    leakSignal: { state: leakState, basis: "LOCAL_GUARD_EVENTS_ONLY" },
    circuit: { state: circuitState, until: circuitUntil, enforcement: "LOCAL_READ_GUARD" },
    backoff: { state: backoffState, activeCooldowns, until: backoffUntil, enforcement: "LOCAL_HEAVY_READ_FINGERPRINT_GUARD" },
    killSwitch: { state: killSwitchState, canExecute: false },
    policy, observedAt,
  };
}

'''

PROTECTION_RENDER = '''function renderQuotaProtection(protection) {
  const panel = document.querySelector('[data-panel="quota"]');
  const surfaces = [...(panel?.querySelectorAll(".surface") || [])];
  const surface = surfaces[1];
  if (!surface) return;
  surface.querySelector("[data-quota-protection]")?.remove();
  const box = document.createElement("div");
  box.dataset.quotaProtection = "1";
  box.className = "hub-health-grid";
  const card = document.createElement("article");
  card.className = "hub-health-card";
  const head = document.createElement("div");
  head.className = "hub-health-head";
  const title = document.createElement("strong");
  title.textContent = "Leak / Circuit / Backoff / Kill-switch";
  head.append(title, statusTag(protection.availability === "AVAILABLE" ? "HEALTHY" : protection.availability));
  const facts = document.createElement("dl");
  facts.className = "hub-facts";
  const rows = [
    ["Leak signal", protection.leakSignal.state],
    ["Read circuit", protection.circuit.state + (protection.circuit.until ? ` · until ${protection.circuit.until}` : "")],
    ["Heavy-read backoff", protection.backoff.state + (protection.backoff.activeCooldowns === null ? " · active UNKNOWN" : ` · active ${protection.backoff.activeCooldowns}`) + (protection.backoff.until ? ` · until ${protection.backoff.until}` : "")],
    ["Global kill switch", `${protection.killSwitch.state} · execution DISABLED`],
    ["Local guard policy", `read block ${quotaCenterValue(protection.policy.providerReadBlockMs)} ms · heavy cooldown ${quotaCenterValue(protection.policy.heavyReadCooldownMs)} ms · heavy threshold ${quotaCenterValue(protection.policy.heavyReadRowsThreshold)} rows`],
    ["Evidence", `${protection.evidenceScope} · ${protection.observedAt || "time UNKNOWN"}`],
  ];
  for (const [label, value] of rows) {
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value;
    row.append(dt, dd);
    facts.append(row);
  }
  const note = document.createElement("p");
  note.className = "truth-note";
  note.textContent = "OBSERVE ONLY · leak = local guard signal เท่านั้น ไม่ใช่ provider/account leak proof · circuit/backoff เป็น guard ที่บล็อกก่อน Turso fetch · ไม่มี executable global kill switch";
  card.append(head, facts, note);
  box.append(card);
  surface.append(box);
}

'''


def patch_supervisor(source: str) -> str:
    out = replace_once(
        source,
        "// SUPERVISOR_QUOTA_CENTER_V1\n// Side-car snapshot client:",
        "// SUPERVISOR_QUOTA_CENTER_V1\n// SUPERVISOR_QUOTA_PROTECTION_V1\n// Side-car snapshot client:",
        "frontend SUP-12 marker",
    )
    out = replace_once(out, "// SUPERVISOR_QUOTA_CENTER_RENDER_V1\n", PROTECTION_LOGIC + "// SUPERVISOR_QUOTA_CENTER_RENDER_V1\n", "frontend protection derivation")
    out = replace_once(out, "function renderIncidentActionCenter(center) {", PROTECTION_RENDER + "function renderIncidentActionCenter(center) {", "frontend protection renderer")
    out = replace_once(
        out,
        "  const quotaCenter = deriveQuotaCenter(snapshot?.quotaTelemetry);\n  const overview = deriveOverview",
        "  const quotaCenter = deriveQuotaCenter(snapshot?.quotaTelemetry);\n  const quotaProtection = deriveQuotaProtection(snapshot?.quotaTelemetry?.protection);\n  const overview = deriveOverview",
        "derive protection during snapshot render",
    )
    out = replace_once(
        out,
        "  renderQuotaCenter(quotaCenter);\n  renderIncidentActionCenter(incidentCenter);",
        "  renderQuotaCenter(quotaCenter);\n  renderQuotaProtection(quotaProtection);\n  renderIncidentActionCenter(incidentCenter);",
        "render protection panel",
    )
    return out


update("supervisor.js", patch_supervisor)


def patch_html(source: str) -> str:
    out = replace_once(source, "supervisor.js?v=20260915-sup11", "supervisor.js?v=20260915-sup12", "SUP-12 cache key")
    out = replace_once(
        out,
        "SUP-11 เป็น presentation only; leak/circuit/backoff/kill-switch policy อยู่ SUP-12",
        "SUP-12 แสดง local guard truth จาก telemetry เดิมเท่านั้น · global kill switch ไม่มี execution และ provider plan/limit ยัง UNKNOWN",
        "quota guard note",
    )
    return out


update("supervisor.html", patch_html)

# Keep old Supervisor cache assertions aligned with the canonical asset key.
for path in Path("worker/tests").glob("supervisor-*.test.mjs"):
    source = path.read_text(encoding="utf-8")
    output = source.replace("supervisor.js?v=20260915-sup11", "supervisor.js?v=20260915-sup12")
    if output != source:
        path.write_text(output, encoding="utf-8")

TEST_SOURCE = r'''import assert from "node:assert/strict";
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
});

test("SUP-12 shared protection contract uses latest isolate evidence without inventing provider/account truth", async () => {
  const patch = await readFile("../.github/dev-tools/patch-supervisor-quota-instrumentation.mjs", "utf8");
  for (const marker of ["supervisorQuotaProtection", "LOCAL_GUARD_EVENTS_ONLY", "LOCAL_READ_GUARD", "LOCAL_HEAVY_READ_FINGERPRINT_GUARD", "NOT_CONFIGURED", "canExecute: false", "billingTruth: \"UNKNOWN\""]) assert.ok(patch.includes(marker), marker);
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
  assert.ok(html.includes("supervisor.js?v=20260915-sup12"));
  assert.equal(/kill.?switch[^<]{0,80}<button/i.test(html), false);
});

test("SUP-12 truth wording preserves UNKNOWN provider limits and local-signal semantics", async () => {
  const [js, html] = await Promise.all([readFile("../supervisor.js", "utf8"), readFile("../supervisor.html", "utf8")]);
  assert.ok(js.includes("providerPlanLimit: \"UNKNOWN\""));
  assert.ok(js.includes("leak = local guard signal"));
  assert.ok(js.includes("ไม่มี executable global kill switch"));
  assert.ok(html.includes("provider plan/limit ยัง UNKNOWN"));
});
'''
Path("worker/tests/supervisor-quota-protection.test.mjs").write_text(TEST_SOURCE, encoding="utf-8")


def patch_package(source: str) -> str:
    return replace_once(
        source,
        "tests/supervisor-quota-instrumentation.test.mjs tests/supervisor-shared-quota-center.test.mjs tests/bus-enrichment.test.mjs",
        "tests/supervisor-quota-instrumentation.test.mjs tests/supervisor-shared-quota-center.test.mjs tests/supervisor-quota-protection.test.mjs tests/bus-enrichment.test.mjs",
        "wire SUP-12 test into npm check",
    )


update("worker/package.json", patch_package)
print("SUP12_APPLY=PASS")
