import test from "node:test";
import assert from "node:assert/strict";
import {
  maybeHandleMsDailyArchivePointer,
  queryMsDailyArchivePointer,
} from "../src/ms-history-pointer-v1.js";

function statement(sql, calls, results) {
  return {
    bind(...args) {
      calls.push({ sql, args });
      return {
        async first() {
          if (sql.includes("ms_route_latest_meta")) return results.meta;
          return null;
        },
        async all() {
          if (sql.includes("FROM ms_route_registry"))
            return { results: results.history || [] };
          if (sql.includes("FROM ms_route_cancellations"))
            return { results: results.cancellations || [] };
          return { results: [] };
        },
      };
    },
    async first() {
      calls.push({ sql, args: [] });
      if (sql.includes("ms_route_latest_meta")) return results.meta;
      return null;
    },
  };
}

function envWith(results = {}) {
  const calls = [];
  return {
    calls,
    env: {
      DB: {
        prepare(sql) {
          return statement(sql, calls, results);
        },
      },
    },
  };
}

function coreAuth(status = 200) {
  const calls = [];
  return {
    calls,
    worker: {
      async fetch(request) {
        calls.push(new URL(request.url));
        return new Response(JSON.stringify(status === 200 ? { ok: true } : { ok: false }), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  };
}

test("pointer query is generic for any HUB and preserves archived payload", async () => {
  const { env, calls } = envWith({
    history: [{
      route_id: "R-1",
      payload_json: JSON.stringify({
        routeName: "Route A",
        attendanceType: "ปลายทาง",
        actualArrivalAt: "2026-09-16T01:00:00.000Z",
      }),
      snapshot_at: "2026-09-16T01:00:00.000Z",
      synced_by: "MS_AUTO",
      event_type: "UPDATED",
      business_day: "2026-09-16",
    }],
    cancellations: [{ route_id: "R-1", cancelled_at: "2026-09-16T02:00:00.000Z", cancelled_by: "OPS", reason: "x" }],
  });
  const asOf = "2026-09-16T16:59:59.999Z";
  const data = await queryMsDailyArchivePointer(env, "EA2", "2026-09-16", "2026-09-16", asOf);
  assert.equal(data.branch, "EA2");
  assert.equal(data.total, 1);
  assert.equal(data.rows[0].id, "R-1");
  assert.equal(data.rows[0].businessDay, "2026-09-16");
  assert.equal(data.rows[0].businessDayAuthority, "KIT");
  assert.equal(data.rows[0].queueCancelledBy, "OPS");
  assert.equal(data.historyMode, "POINT_IN_TIME");
  assert.equal(data.asOf, asOf);
  const historyCall = calls.find((call) => call.sql.includes("FROM ms_route_registry"));
  assert.deepEqual(historyCall.args, [asOf, "EA2", "EA2", "2026-09-16", "2026-09-16"]);
  assert.match(historyCall.sql, /idx_ms_route_history_hub_route_snapshot/);
  assert.match(historyCall.sql, /h2\.snapshot_at<=\?/);
  assert.doesNotMatch(historyCall.sql, /estimatedArrivalAt|estimatedDepartureAt|scheduleKitArrivalAt/);
});

test("handler delegates authorization to core and supports non-NE1 HUB", async () => {
  const { env, calls } = envWith({ meta: { ready: 1 }, history: [], cancellations: [] });
  const auth = coreAuth(200);
  const request = new Request("https://dev.example/api?action=msDailyArchive&branch=NO5&start=2026-09-10&end=2026-09-16&token=t");
  const response = await maybeHandleMsDailyArchivePointer(request, env, {}, auth.worker);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.branch, "NO5");
  assert.equal(auth.calls.length, 1);
  assert.equal(auth.calls[0].searchParams.get("action"), "msConnectionStatus");
  assert.equal(auth.calls[0].searchParams.get("branch"), "NO5");
  assert.ok(calls.some((call) => call.sql.includes("ms_route_latest_meta")));
});

test("handler passes through authorization failure without history query", async () => {
  const { env, calls } = envWith({ meta: { ready: 1 } });
  const auth = coreAuth(403);
  const request = new Request("https://dev.example/api?action=msDailyArchive&branch=NE6&start=2026-09-16&end=2026-09-16&token=bad");
  const response = await maybeHandleMsDailyArchivePointer(request, env, {}, auth.worker);
  assert.equal(response.status, 403);
  assert.equal(calls.length, 0);
});

test("handler delegates to legacy core only before pointer ready", async () => {
  const { env, calls } = envWith({ meta: { ready: 0 } });
  const auth = coreAuth(200);
  const request = new Request("https://dev.example/api?action=msDailyArchive&branch=NE1&start=2026-09-16&end=2026-09-16&token=t");
  const response = await maybeHandleMsDailyArchivePointer(request, env, {}, auth.worker);
  assert.equal(response, null);
  assert.equal(calls.filter((call) => call.sql.includes("FROM ms_route_registry r")).length, 0);
});

test("handler rejects more than seven calendar days before history query", async () => {
  const { env, calls } = envWith({ meta: { ready: 1 } });
  const auth = coreAuth(200);
  const request = new Request("https://dev.example/api?action=msDailyArchive&branch=BPL&start=2026-09-01&end=2026-09-08&token=t");
  const response = await maybeHandleMsDailyArchivePointer(request, env, {}, auth.worker);
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, "DATE_RANGE_TOO_LARGE");
  assert.equal(calls.filter((call) => call.sql.includes("FROM ms_route_registry r")).length, 0);
});
