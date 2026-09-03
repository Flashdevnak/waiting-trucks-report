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

test("staging the already integrated public frontend is idempotent", () => {
  assert.equal(stageFrontend(source), source);
});
