import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { stageWorker } from "../../.github/dev-tools/stage-dev-runtime.mjs";

const root = new URL("../../", import.meta.url);
const [canonicalWorker, supervisorFront, supervisorHtml, eventPatch] = await Promise.all([
  readFile(new URL("src/index.js", new URL("../", import.meta.url)), "utf8"),
  readFile(new URL("supervisor.js", root), "utf8"),
  readFile(new URL("supervisor.html", root), "utf8"),
  readFile(new URL(".github/dev-tools/patch-supervisor-event-console.mjs", root), "utf8"),
]);
const stagedWorker = stageWorker(canonicalWorker);

function between(text, startLabel, endLabel) {
  const start = text.indexOf(startLabel);
  const end = text.indexOf(endLabel, start + startLabel.length);
  assert.ok(start >= 0 && end > start, `missing block ${startLabel}`);
  return text.slice(start, end);
}

function eventRuntime() {
  const source = between(
    stagedWorker,
    "// SUPERVISOR_EVENT_CONSOLE_V1:",
    "// SUPERVISOR_QUEUE_LIFECYCLE_V1:",
  );
  const context = { Date, Object, Number, String, Array };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.materialEvents = supervisorMaterialEvents;`, context);
  return { materialEvents: context.materialEvents, source };
}

const lifecycle = {
  state: "AVAILABLE",
  observedAt: "2026-09-14T16:00:00.000Z",
  active: 3,
  waiting: 1,
  unloading: 2,
  awaitingRelease: 1,
  expired12h: 0,
  cancelledObserved: 0,
};

function hubState(overrides = {}) {
  return {
    hub: "ZX9",
    health: "HEALTHY",
    observedAt: "2026-09-14T16:00:00.000Z",
    lastSuccessAt: "2026-09-14T16:00:00.000Z",
    errorCode: null,
    sources: {
      route: { state: "HEALTHY", errorCode: null },
      preEntry: { state: "UNKNOWN", errorCode: null },
      busTime: { state: "HEALTHY", errorCode: null },
      hbiPhotos: { state: "UNKNOWN", errorCode: null },
    },
    lifecycle,
    ...overrides,
  };
}

test("SUP-08 emits bounded facts only from a real observed ingest", () => {
  const { materialEvents } = eventRuntime();
  const events = materialEvents(null, hubState());
  const codes = events.map((event) => event.code);
  assert.ok(codes.includes("HUB_OBSERVED"));
  assert.ok(codes.includes("SOURCE_STATE_CHANGED"));
  assert.ok(codes.includes("QUEUE_COUNTS_CHANGED"));
  assert.ok(events.every((event) => event.at === "2026-09-14T16:00:00.000Z"));
  assert.ok(events.every((event) => event.hub === "ZX9"));
  assert.ok(events.every((event) => ["INFO", "PASS", "WARN", "ERROR"].includes(event.level)));
});

test("SUP-08 does not emit heartbeat noise when material state is unchanged", () => {
  const { materialEvents } = eventRuntime();
  const previous = hubState({ observedAt: "2026-09-14T15:59:00.000Z" });
  const next = hubState({ observedAt: "2026-09-14T16:00:00.000Z" });
  assert.deepEqual(materialEvents(previous, next), []);
});

test("SUP-08 exposes auth/source transitions without private payloads", () => {
  const { materialEvents } = eventRuntime();
  const previous = hubState();
  const next = hubState({
    health: "WARNING",
    observedAt: "2026-09-14T16:01:00.000Z",
    sources: {
      ...previous.sources,
      busTime: { state: "AUTH_REQUIRED", errorCode: "NEEDS_LOGIN" },
    },
  });
  const events = materialEvents(previous, next);
  const bus = events.find((event) => event.source === "KIT_TBR");
  assert.equal(bus?.level, "WARN");
  assert.equal(bus?.code, "SOURCE_STATE_CHANGED");
  assert.match(bus?.message || "", /NEEDS_LOGIN/);
  assert.doesNotMatch(JSON.stringify(events), /authorization|cookie|token|password|bearer/i);
});

test("SUP-08 drops missing timestamps instead of fabricating event time", () => {
  const { materialEvents } = eventRuntime();
  const next = hubState({ observedAt: null, lastSuccessAt: null });
  assert.deepEqual(materialEvents(null, next), []);
});

test("SUP-08 staged event ring is ephemeral, capped, and adds no persistence or source work", () => {
  const { source } = eventRuntime();
  assert.match(stagedWorker, /SUPERVISOR_EVENT_RING_LIMIT = 120/);
  assert.match(stagedWorker, /mode: "EPHEMERAL_MEMORY"/);
  assert.match(stagedWorker, /this\.supervisorEvents\.splice\(0, this\.supervisorEvents\.length - SUPERVISOR_EVENT_RING_LIMIT\)/);
  assert.match(stagedWorker, /eventConsole: \{\s*availability: "AVAILABLE"/);
  assert.doesNotMatch(source, /env\.DB|\.prepare\s*\(|\bfetch\s*\(|setInterval\s*\(|setTimeout\s*\(|new\s+WebSocket|EventSource|storage\.(?:put|delete)|ctx\.storage|AI\s*call/i);
  assert.doesNotMatch(eventPatch, /env\.DB|\.prepare\s*\(|setInterval\s*\(|setTimeout\s*\(|storage\.(?:put|delete)|ctx\.storage/i);
});

test("SUP-08 frontend remains one-shot and only manipulates the local sanitized view", () => {
  assert.equal((supervisorFront.match(/\bfetch\s*\(/g) || []).length, 1);
  assert.match(supervisorFront, /fetch\("\/api\/supervisor\/snapshot"/);
  assert.doesNotMatch(supervisorFront, /setInterval|setTimeout|new\s+WebSocket|new\s+EventSource/);
  assert.match(supervisorFront, /SUPERVISOR_EVENT_CONSOLE_V1/);
  assert.match(supervisorFront, /navigator\.clipboard\.writeText/);
  assert.match(supervisorFront, /View cleared locally/);
  assert.match(supervisorFront, /events\.slice\(-limit\)/);
  assert.match(supervisorHtml, /supervisor\.js\?v=20260914-sup08/);
});
