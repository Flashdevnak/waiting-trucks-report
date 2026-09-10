import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { stageFrontend } from "./stage-dev-runtime.mjs";

const promotedApi =
  "https://waiting-trucks-report-api-dev.26nak-testdev.workers.dev/api";
const source = await readFile(new URL("../../ms.js", import.meta.url), "utf8");

test("public MS frontend pins every host to promoted Turso API", () => {
  assert.match(source, /LIVE_RESILIENCE_V1/);
  assert.ok(source.includes(`CONFIG.apiUrl = "${promotedApi}"`));
  assert.ok(!source.includes("window.location.origin}/api"));
});

test("GET transport rejects HTML safely and retries transient failures", () => {
  assert.ok(source.includes('headers: { Accept: "application/json" }'));
  assert.ok(source.includes('error.code = "NON_JSON_RESPONSE"'));
  assert.ok(source.includes("API ตอบกลับเป็นหน้าเว็บแทน JSON"));
  assert.match(source, /attempt\s*<=\s*3/);
});

test("one transient poll does not flap a recently healthy connection offline", () => {
  assert.ok(source.includes("transportLastOkAt"));
  assert.ok(source.includes("transportFailures"));
  assert.ok(
    source.includes(
      "Date.now() - Number(state.transportLastOkAt) <= CONFIG.staleMs",
    ),
  );
  assert.ok(source.includes("connection(Boolean(recentlyHealthy))"));
});

test("live resilience keeps existing realtime invariants", () => {
  assert.match(source, /pollMs:\s*4000/);
  assert.ok(source.includes("DEV: archive stays lazy"));
  assert.ok(source.includes('apiGet("msCompletedToday"'));
  assert.ok(source.includes("const preserveObservedCompletion ="));
});

test("DEV staging admits TBR provisionally without extra polling or overwriting Route truth", () => {
  const staged = stageFrontend(source);
  assert.ok(staged.includes("TBR_PROVISIONAL_ARRIVAL_V1"));
  assert.ok(staged.includes("function tbrProvisionalArrival(row, now = new Date())"));
  assert.ok(staged.includes("function operationalArrival(row, now = new Date())"));
  assert.ok(staged.includes('return "ROUTE_CONFIRMED"'));
  assert.ok(staged.includes('"TBR_PROVISIONAL"'));
  assert.ok(staged.includes('label: routeArrival ? "มาถึงแล้ว" : "TBR รอ Route"'));
  assert.ok(staged.includes("active = Boolean(arrival) && !done && !cancelled && ageHours <= 12"));
  assert.ok(staged.includes("const start = operationalArrival(row)"));
  assert.ok(staged.includes("const arrival = operationalArrival(row);"));
  assert.ok(staged.includes("operationalArrival(a) || parseDate(a.estimatedArrivalAt)"));
  assert.ok(staged.includes("if (tbr.getTime() > nowDate.getTime() + 90 * 1000) return null"));
  assert.ok(staged.includes("Math.abs(kit.getTime() - tbr.getTime()) > 15 * 60 * 1000"));
  assert.match(staged, /pollMs:\s*4000/);
  assert.ok(staged.includes("function confirmedEffectiveArrival(row)"));
  assert.ok(staged.includes("actualArrivalAt: exportThaiDate(confirmedEffectiveArrival(row))"));
  assert.ok(!staged.includes("fetch('/api/tbr-intelligence"));
});

test("DEV-only frontend staging is complete, idempotent, and stays out of canonical public source", () => {
  const first = stageFrontend(source);
  const second = stageFrontend(first);

  assert.notEqual(first, source);
  assert.equal(second, first);

  assert.ok(!source.includes("MS_CONNECTION_ERROR_KV_V1"));
  assert.ok(!source.includes("DEV_PROOF_HAR_CONNECTION_FRONTEND_V9"));
  assert.ok(!source.includes("TBR_PROVISIONAL_ARRIVAL_V1"));
  assert.ok(first.includes("MS_CONNECTION_ERROR_KV_V1"));
  assert.ok(first.includes("DEV_PROOF_HAR_CONNECTION_FRONTEND_V9"));
  assert.ok(first.includes("TBR_PROVISIONAL_ARRIVAL_V1"));

  assert.ok(first.includes("LIVE_RESILIENCE_V1"));
  assert.ok(first.includes(`CONFIG.apiUrl = "${promotedApi}"`));
  assert.match(first, /pollMs:\s*4000/);
  assert.ok(first.includes("DEV: archive stays lazy"));
});
