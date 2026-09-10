import assert from "node:assert/strict";
import test from "node:test";
import {
  CONNECTION_INTELLIGENCE_POLICY,
  readConnectionIncidentReport,
  recordConnectionErrorKv,
  recordConnectionRecoveredKv,
} from "../src/connection-error.js";

class FakeKV {
  constructor() {
    this.map = new Map();
    this.puts = 0;
    this.gets = 0;
  }
  async get(key) {
    this.gets += 1;
    return this.map.get(key) ?? null;
  }
  async put(key, value) {
    this.puts += 1;
    this.map.set(key, value);
  }
}

test("first incident writes current + history, duplicate active incident writes nothing", async () => {
  const STATE = new FakeKV();
  const env = { STATE };
  const first = await recordConnectionErrorKv(env, {
    hub: "NE1",
    source: "routes",
    code: "503",
    message: "Service unavailable",
  });
  assert.equal(first.changed, true);
  assert.equal(STATE.puts, 2);

  const duplicate = await recordConnectionErrorKv(env, {
    hub: "NE1",
    source: "routes",
    code: "503",
    message: "Service unavailable",
  });
  assert.equal(duplicate.changed, false);
  assert.equal(duplicate.deduped, true);
  assert.equal(STATE.puts, 2);
});

test("recovery closes the same incident and costs only two additional KV writes", async () => {
  const STATE = new FakeKV();
  const env = { STATE };
  await recordConnectionErrorKv(env, {
    hub: "NE1",
    source: "routes",
    code: "TIMEOUT",
    message: "request timeout",
  });
  const recovered = await recordConnectionRecoveredKv(env, { hub: "NE1" });
  assert.equal(recovered.changed, true);
  assert.ok(recovered.data.recoveredAt);
  assert.equal(STATE.puts, 4);

  const again = await recordConnectionRecoveredKv(env, { hub: "NE1" });
  assert.equal(again.changed, false);
  assert.equal(STATE.puts, 4);
});

test("history preserves distinct incidents and classifies rate limit for quota guard", async () => {
  const STATE = new FakeKV();
  const env = { STATE };
  await recordConnectionErrorKv(env, {
    hub: "NE1",
    source: "routes",
    code: "503",
    message: "Service unavailable",
  });
  await recordConnectionRecoveredKv(env, { hub: "NE1" });
  await recordConnectionErrorKv(env, {
    hub: "NE1",
    source: "busTime",
    code: "429",
    message: "Request exceeds the limit",
  });

  const report = await readConnectionIncidentReport(env, "NE1");
  assert.equal(report.history.length, 2);
  assert.equal(report.data.code, "RATE_LIMIT");
  assert.equal(report.data.autoHealMode, "QUOTA_GUARD");
  assert.equal(report.summary.rateLimit30d, 1);
  assert.equal(report.summary.status, "ACTIVE");
});

test("report is read-only and quota contract adds no MS/Turso traffic", async () => {
  const STATE = new FakeKV();
  const env = { STATE };
  await recordConnectionErrorKv(env, {
    hub: "NE1",
    source: "routes",
    code: "ERROR",
    message: "temporary source issue",
  });
  const writesBefore = STATE.puts;
  const report = await readConnectionIncidentReport(env, "NE1");
  assert.equal(STATE.puts, writesBefore);
  assert.equal(report.quotaPolicy.extraMsPolling, 0);
  assert.equal(report.quotaPolicy.tursoReads, 0);
  assert.equal(report.quotaPolicy.tursoWrites, 0);
  assert.equal(report.quotaPolicy.duplicateActiveErrorWrites, 0);
  assert.equal(report.quotaPolicy.maxKvWritesPerIncidentLifecycle, 4);
  assert.equal(report.quotaPolicy.preservesRealtimeRouteCadence, true);
});

assert.equal(CONNECTION_INTELLIGENCE_POLICY.historyDays, 30);
assert.equal(CONNECTION_INTELLIGENCE_POLICY.maxHistoryPerHub, 80);
