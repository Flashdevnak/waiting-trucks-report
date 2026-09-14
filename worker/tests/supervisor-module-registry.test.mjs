import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MODULE_HEALTH_STATES,
  createSupervisorRegistry,
  defineSupervisorModule,
  waitingTrucksModule,
} from "../../supervisor-modules.js";

const source = await readFile(new URL("../../supervisor-modules.js", import.meta.url), "utf8");

test("SUP-03 registers only the real Waiting Trucks module", () => {
  const registry = createSupervisorRegistry([waitingTrucksModule]);
  assert.deepEqual(registry.list().map(({ id }) => id), ["waiting-trucks"]);
  assert.deepEqual(Object.values(waitingTrucksModule.capabilities), [false, false, false, false, false, false, false]);
  assert.doesNotMatch(source, /ticket|future-module|placeholder-module|plugin marketplace/i);
});

test("SUP-03 missing shared state remains truth-safe UNKNOWN", () => {
  const [module] = createSupervisorRegistry([waitingTrucksModule]).evaluate({});
  assert.equal(module.health.state, "UNKNOWN");
  assert.equal(module.health.observedAt, null);
  assert.deepEqual(module.health.evidence, []);
  assert.deepEqual(module.metrics, []);
  assert.deepEqual(module.incidents, []);
  assert.deepEqual(MODULE_HEALTH_STATES, [
    "HEALTHY", "WARNING", "CRITICAL", "STALE", "PARTIAL", "AUTH_REQUIRED",
    "ERROR", "BLOCKED", "UNKNOWN", "RECOVERED",
  ]);
});

test("SUP-03 evaluates supplied module state without inventing capabilities", () => {
  const observed = {
    health: { state: "PARTIAL", observedAt: "2026-09-14T10:00:00.000Z", evidence: ["SHARED_STATE"] },
    metrics: [{ id: "configured-hubs", value: 2 }],
    incidents: [{ id: "INC-1", state: "OPEN" }],
  };
  const [module] = createSupervisorRegistry([waitingTrucksModule]).evaluate({ waitingTrucks: observed });
  assert.equal(module.health.state, "PARTIAL");
  assert.equal(module.health.observedAt, observed.health.observedAt);
  assert.deepEqual(module.metrics, observed.metrics);
  assert.deepEqual(module.incidents, observed.incidents);
  for (const capability of Object.keys(module.capabilities)) assert.equal(capability in module, false);
});

test("SUP-03 isolates a failing module adapter", () => {
  const broken = defineSupervisorModule({
    id: "broken-test-module",
    name: "Broken test module",
    health: () => { throw new Error("private adapter detail"); },
    metrics: () => [],
    incidents: () => [],
  });
  const result = createSupervisorRegistry([broken, waitingTrucksModule]).evaluate({});
  assert.equal(result[0].health.state, "ERROR");
  assert.deepEqual(result[0].health.evidence, ["MODULE_ADAPTER_ERROR"]);
  assert.equal(JSON.stringify(result).includes("private adapter detail"), false);
  assert.equal(result[1].health.state, "UNKNOWN");
});

test("SUP-03 rejects duplicate ids and undeclared capability adapters", () => {
  const registry = createSupervisorRegistry([waitingTrucksModule]);
  assert.throws(() => registry.register(waitingTrucksModule), /unique/);
  assert.throws(() => defineSupervisorModule({
    id: "invalid-quota",
    name: "Invalid quota",
    health: () => ({ state: "UNKNOWN" }),
    metrics: () => [],
    incidents: () => [],
    capabilities: { quota: true },
  }), /quota capability requires an adapter/);
});

test("SUP-03 registry has zero transport, database, timer, AI, and repair execution", () => {
  assert.doesNotMatch(source, /\bfetch\s*\(|new\s+WebSocket|new\s+EventSource|setInterval\s*\(|setTimeout\s*\(/);
  assert.doesNotMatch(source, /route_followstart|fleet_time|getList|flashexpress|SELECT\s|INSERT\s|UPDATE\s|DELETE\s/i);
  assert.doesNotMatch(source, /openai|anthropic|gemini|\.run\s*\(|executeRepair/i);
});
