import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ageView, deriveHubView, deriveOverview } from "../../supervisor-view.js";

const root = new URL("../../", import.meta.url);
const [html, js, view, css, workflow] = await Promise.all([
  readFile(new URL("supervisor.html", root), "utf8"),
  readFile(new URL("supervisor.js", root), "utf8"),
  readFile(new URL("supervisor-view.js", root), "utf8"),
  readFile(new URL("supervisor.css", root), "utf8"),
  readFile(new URL(".github/workflows/deploy-worker-dev.yml", root), "utf8"),
]);

test("SUP-05 empty snapshot remains UNKNOWN instead of fabricating health", () => {
  const overview = deriveOverview(null, { health: { state: "UNKNOWN" }, metrics: [] }, { moduleCount: 1, workerReachable: false });
  assert.equal(overview.overall, "UNKNOWN");
  assert.equal(overview.snapshot, "UNAVAILABLE");
  assert.equal(overview.cards.find((card) => card.id === "configured-hubs").value, "UNKNOWN");
  assert.equal(overview.cards.find((card) => card.id === "database").value, "UNKNOWN");
  assert.equal(overview.cards.find((card) => card.id === "incidents").value, "UNKNOWN");
  assert.equal(overview.cards.find((card) => card.id === "quota").value, "UNKNOWN");
});

test("SUP-05 derives overview only from shared snapshot evidence", () => {
  const snapshot = {
    availability: "AVAILABLE",
    modules: { waitingTrucks: { hubs: [
      { hub: "ZX9", health: "HEALTHY", accepted: { state: "AVAILABLE", rows: 4 } },
      { hub: "Q1", health: "WARNING", accepted: { state: "AVAILABLE", rows: 2 } },
    ] } },
    contracts: { additionalUpstreamPolls: 0, databaseReads: 0, databaseWrites: 0, aiCalls: 0 },
  };
  const overview = deriveOverview(snapshot, {
    health: { state: "PARTIAL", impact: "Observed coordinator state only." },
    metrics: [{ id: "observed-hubs", value: 2 }, { id: "healthy-observed-hubs", value: 1 }],
  }, { moduleCount: 1, workerReachable: true });
  assert.equal(overview.snapshot, "AVAILABLE");
  assert.equal(overview.cards.find((card) => card.id === "worker").value, "HEALTHY");
  assert.equal(overview.cards.find((card) => card.id === "warning-hubs").value, "1");
  assert.equal(overview.cards.find((card) => card.id === "accepted").value, "AVAILABLE");
  assert.equal(overview.cards.find((card) => card.id === "quota").value, "SAFE");
  assert.equal(overview.cards.find((card) => card.id === "realtime").value, "UNKNOWN");
  assert.equal(overview.cards.find((card) => card.id === "deployment").value, "UNKNOWN");
});

test("SUP-05 HUB view separates facts from unavailable fields", () => {
  const hub = deriveHubView({
    hub: "ZX9",
    health: "ERROR",
    lastSuccessAt: "2026-09-14T10:00:00.000Z",
    accepted: { state: "AVAILABLE", rows: 7 },
    errorCode: "MS_ROUTE_RATE_LIMIT",
  }, Date.parse("2026-09-14T10:05:00.000Z"));
  assert.equal(hub.route, "ERROR");
  assert.equal(hub.age.seconds, 300);
  assert.equal(hub.age.label, "5 นาที");
  assert.deepEqual(hub.accepted, { state: "AVAILABLE", rows: 7 });
  assert.equal(hub.kitTbr, "UNKNOWN");
  assert.equal(hub.queueHealth, "UNKNOWN");
  assert.equal(hub.pendingAction, "REVIEW_REQUIRED");
  assert.deepEqual(ageView("not-a-time", Date.now()), { seconds: null, label: "UNKNOWN" });
});

test("SUP-05/SUP-07 view contract is modular, responsive, and transport-free", () => {
  assert.match(view, /SUPERVISOR_OVERVIEW_HUB_VIEW_V1/);
  assert.match(view, /SUPERVISOR_QUEUE_LIFECYCLE_V1/);
  assert.doesNotMatch(view, /\bfetch\s*\(|WebSocket|EventSource|setInterval|setTimeout|localStorage|sessionStorage/);
  assert.doesNotMatch(view, /route_followstart|fleet_time|getList|SELECT\s|INSERT\s|UPDATE\s|DELETE\s/i);
  assert.match(js, /deriveOverview/);
  assert.match(js, /deriveHubView/);
  assert.match(html, /id="overview-metrics"/);
  assert.match(html, /id="hub-snapshot-list"/);
  assert.match(js, /supervisor-view\.js\?v=20260914-sup07/);
  assert.match(css, /hub-health-grid/);
  assert.match(css, /@media\(max-width:700px\).*hub-health-grid\{grid-template-columns:1fr\}/s);
  assert.match(workflow, /supervisor-view\.js/);
  assert.doesNotMatch(`${html}\n${js}\n${view}`, /EA2|NE1/);
});
