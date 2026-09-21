import assert from "node:assert/strict";
import test from "node:test";
import {
  BUS_TIME_MAX_CALLS_PER_CYCLE,
  BUS_TIME_P2_MAX_CALLS_PER_CYCLE,
  MS_DATA_COMPLETENESS,
  MS_ENRICHMENT_PENDING,
  MS_FIELD_EVIDENCE,
  createBusTimeHotLane,
  createMsFieldEvidence,
  deriveMsDataCompleteness,
  deriveMsTbrProjection,
  planMsTbrEnrichment,
} from "./bus-time-hot-lane-v14-runtime.mjs";

const NOW = Date.parse("2026-09-21T12:00:00.000Z");
const TBR = "2026-09-21T10:00:00.000Z";

function row(overrides = {}) {
  return {
    proofId: "P1",
    attendanceType: "ปลายทาง",
    unloadingState: 0,
    actualArrivalAt: "2026-09-21T11:00:00.000Z",
    scheduleTbrArrivalAt: "",
    ...overrides,
  };
}

test("REC-02 canonical TBR evidence distinguishes all five states without copying KIT", () => {
  const observed = deriveMsTbrProjection(row({ scheduleTbrArrivalAt: TBR }), {
    sourceEvaluated: true,
    observedAt: NOW,
    acceptedAt: NOW,
    nowMs: NOW,
  });
  assert.equal(observed.fieldEvidence.scheduleTbrArrivalAt.state, MS_FIELD_EVIDENCE.OBSERVED);
  assert.equal(observed.dataCompleteness, MS_DATA_COMPLETENESS.COMPLETE);

  const missing = deriveMsTbrProjection(row(), { sourceEvaluated: true, nowMs: NOW });
  assert.equal(
    missing.fieldEvidence.scheduleTbrArrivalAt.state,
    MS_FIELD_EVIDENCE.MISSING_UNCONFIRMED,
  );
  assert.equal(missing.dataCompleteness, MS_DATA_COMPLETENESS.INCOMPLETE);

  const unavailable = deriveMsTbrProjection(row(), {
    sourceUnavailable: true,
    sourceCode: "BUS_TIME_SESSION_EXPIRED",
    nowMs: NOW,
  });
  assert.equal(
    unavailable.fieldEvidence.scheduleTbrArrivalAt.state,
    MS_FIELD_EVIDENCE.SOURCE_UNAVAILABLE,
  );

  const unknown = deriveMsTbrProjection(row(), { nowMs: NOW });
  assert.equal(unknown.fieldEvidence.scheduleTbrArrivalAt.state, MS_FIELD_EVIDENCE.UNKNOWN);

  const origin = deriveMsTbrProjection(row({ attendanceType: "ต้นทาง" }), { nowMs: NOW });
  assert.equal(
    origin.fieldEvidence.scheduleTbrArrivalAt.state,
    MS_FIELD_EVIDENCE.NOT_APPLICABLE,
  );
  assert.equal(origin.dataCompleteness, MS_DATA_COMPLETENESS.COMPLETE);

  const kitOnly = row({ actualArrivalAt: TBR, scheduleTbrArrivalAt: "" });
  const kitProjection = deriveMsTbrProjection(kitOnly, {
    sourceEvaluated: true,
    nowMs: NOW,
  });
  assert.equal(kitOnly.scheduleTbrArrivalAt, "");
  assert.equal(
    kitProjection.fieldEvidence.scheduleTbrArrivalAt.state,
    MS_FIELD_EVIDENCE.MISSING_UNCONFIRMED,
  );
});

test("REC-02 aggregate completeness has deterministic unavailable/unknown/missing precedence", () => {
  const evidence = (state) => createMsFieldEvidence({ field: "x", state });
  assert.equal(
    deriveMsDataCompleteness([evidence(MS_FIELD_EVIDENCE.OBSERVED)]),
    MS_DATA_COMPLETENESS.COMPLETE,
  );
  assert.equal(
    deriveMsDataCompleteness([evidence(MS_FIELD_EVIDENCE.MISSING_UNCONFIRMED)]),
    MS_DATA_COMPLETENESS.INCOMPLETE,
  );
  assert.equal(
    deriveMsDataCompleteness([
      evidence(MS_FIELD_EVIDENCE.MISSING_UNCONFIRMED),
      evidence(MS_FIELD_EVIDENCE.UNKNOWN),
    ]),
    MS_DATA_COMPLETENESS.UNKNOWN,
  );
  assert.equal(
    deriveMsDataCompleteness([
      evidence(MS_FIELD_EVIDENCE.UNKNOWN),
      evidence(MS_FIELD_EVIDENCE.SOURCE_UNAVAILABLE),
    ]),
    MS_DATA_COMPLETENESS.SOURCE_UNAVAILABLE,
  );
  assert.equal(
    deriveMsDataCompleteness([
      evidence(MS_FIELD_EVIDENCE.OBSERVED),
      evidence(MS_FIELD_EVIDENCE.NOT_APPLICABLE),
    ]),
    MS_DATA_COMPLETENESS.COMPLETE,
  );
});

test("REC-02 lifecycle completion never clears incomplete enrichment obligations", () => {
  const cases = [
    row({ unloadingState: 2 }),
    row({
      attendanceType: "จุดดรอป",
      unloadingState: 2,
      actualDepartureAt: "2026-09-21T11:30:00.000Z",
    }),
    row({
      actualArrivalAt: "2026-09-20T23:59:59.999Z",
      unloadingState: 1,
    }),
  ];
  for (const item of cases) {
    const projection = deriveMsTbrProjection(item, {
      sourceEvaluated: true,
      nowMs: NOW,
    });
    assert.equal(projection.dataCompleteness, MS_DATA_COMPLETENESS.INCOMPLETE);
    assert.equal(projection.enrichmentState, MS_ENRICHMENT_PENDING);
    assert.equal(projection.enrichmentPriority, "P2");
  }
  assert.deepEqual(
    cases.map((item) => item.unloadingState),
    [2, 2, 1],
    "completeness derivation must not mutate lifecycle truth",
  );
});

test("REC-02 planner prioritizes P1, reserves bounded P2 progress, and deduplicates missing-only work", () => {
  const rows = [
    row({ proofId: "A1" }),
    row({ proofId: "A1" }),
    row({ proofId: "A2" }),
    row({ proofId: "A3" }),
    row({ proofId: "C1", unloadingState: 2 }),
    row({ proofId: "C2", unloadingState: 2 }),
    row({ proofId: "DONE", scheduleTbrArrivalAt: TBR, unloadingState: 2 }),
    row({ proofId: "ORIGIN", attendanceType: "ต้นทาง" }),
  ];
  const plan = planMsTbrEnrichment(rows, {
    nowMs: NOW,
    limit: 4,
    p2Limit: 1,
  });
  assert.deepEqual(plan.p1.map((item) => item.row.proofId), ["A1", "A2", "A3"]);
  assert.deepEqual(plan.p2.map((item) => item.row.proofId), ["C1"]);
  assert.equal(plan.selected.length, 4);
  assert.equal(plan.selected.some((item) => item.row.proofId === "DONE"), false);
  assert.equal(plan.selected.some((item) => item.row.proofId === "ORIGIN"), false);

  const next = planMsTbrEnrichment(rows, {
    nowMs: NOW,
    limit: 4,
    p2Limit: 1,
    p2Offset: plan.nextP2Offset,
  });
  assert.deepEqual(next.p2.map((item) => item.row.proofId), ["C2"]);
});

function providerHarness({ credentials = true, items = [], total = items.length } = {}) {
  let clock = NOW;
  let calls = 0;
  const urls = [];
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind() {
            return {
              async first() {
                if (String(sql).includes("FROM ms_live_cache")) return null;
                if (String(sql).includes("FROM ms_bus_connections"))
                  return credentials ? { credentials_cipher: "cipher", last_error: "" } : null;
                return null;
              },
              async run() { return { success: true }; },
            };
          },
        };
      },
    },
  };
  const lane = createBusTimeHotLane({
    liveSourceDays: () => ["2026-09-21"],
    thaiDayOffset: () => "2026-09-21",
    normalizeProofId: (value) => String(value || "").trim().toUpperCase(),
    normalizeAttendance: (value) => String(value || "").trim(),
    matchHub: (store, hub) => String(store).includes(String(hub)),
    msDate: (value) => String(value || ""),
    parseUnloadingStart: () => "",
    parseUnloadingEnd: () => "",
    decryptMs: async () => JSON.stringify({ auth: "x" }),
    safeStatusWrite: async (promise) => promise,
    markSuccess: async () => ({ success: true }),
    markError: async () => ({ success: true }),
    classifyFailure: () => ({ code: "BUS_TIME_SOURCE_ERROR", status: 502 }),
    fetchFn: async (url) => {
      calls += 1;
      urls.push(new URL(url));
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        async json() { return { code: 1, data: { dataList: items, total } }; },
      };
    },
    now: () => clock,
    random: () => 0,
    logger: { warn() {}, error() {}, log() {} },
  });
  return {
    env,
    lane,
    urls,
    calls: () => calls,
    advance(ms) { clock += ms; },
  };
}

test("REC-02 completed missing TBR makes bounded P2 progress and preserves missing provenance", async () => {
  const h = providerHarness();
  const completed = row({ proofId: "C1", unloadingState: 2 });
  const result = await h.lane.readBusTimeData(h.env, "NE1", ["2026-09-21"], [completed]);
  const projected = result.get("P:C1|A:ปลายทาง");
  assert.equal(h.calls(), 1);
  assert.equal(h.urls[0].searchParams.get("fleetStatus"), "");
  assert.equal(projected.fieldEvidence.scheduleTbrArrivalAt.state, MS_FIELD_EVIDENCE.MISSING_UNCONFIRMED);
  assert.equal(projected.fieldEvidence.scheduleTbrArrivalAt.source, "BUS_TIME");
  assert.match(projected.fieldEvidence.scheduleTbrArrivalAt.observedAt, /T/);
  assert.equal(projected.dataCompleteness, MS_DATA_COMPLETENESS.INCOMPLETE);
  assert.equal(projected.enrichmentState, MS_ENRICHMENT_PENDING);
  assert.equal(projected.enrichmentPriority, "P2");
  assert.equal(h.lane.diagnostics("NE1").busP2Calls, 1);
  assert.equal(BUS_TIME_P2_MAX_CALLS_PER_CYCLE, 1);
  assert.ok(h.lane.diagnostics("NE1").busPagesLastCycle <= BUS_TIME_MAX_CALLS_PER_CYCLE);
});

test("REC-02 continuous P1 demand reserves provider capacity for P2 forward progress", async () => {
  const h = providerHarness({ total: 300 });
  await h.lane.readBusTimeData(h.env, "NE1", ["2026-09-21"], [
    row({ proofId: "ACTIVE" }),
    row({ proofId: "COMPLETE", unloadingState: 2 }),
  ]);
  assert.deepEqual(
    h.urls.map((url) => url.searchParams.get("fleetStatus")),
    ["1", "1", ""],
  );
  assert.equal(h.lane.diagnostics("NE1").busP1Rows, 1);
  assert.equal(h.lane.diagnostics("NE1").busP2Rows, 1);
  assert.equal(h.lane.diagnostics("NE1").busP2Calls, 1);
});

test("REC-02 unavailable source stays distinct from a successful missing result", async () => {
  const h = providerHarness({ credentials: false });
  const result = await h.lane.readBusTimeData(h.env, "NE1", ["2026-09-21"], [row()]);
  const projected = result.get("P:P1|A:ปลายทาง");
  assert.equal(h.calls(), 0);
  assert.equal(projected.fieldEvidence.scheduleTbrArrivalAt.state, MS_FIELD_EVIDENCE.SOURCE_UNAVAILABLE);
  assert.equal(projected.fieldEvidence.scheduleTbrArrivalAt.sourceCode, "BUS_TIME_NOT_CONFIGURED");
  assert.equal(projected.dataCompleteness, MS_DATA_COMPLETENESS.SOURCE_UNAVAILABLE);
  assert.equal(projected.enrichmentState, MS_ENRICHMENT_PENDING);
});

test("REC-02 concurrent readers share one provider flight and observed truth stops refetch", async () => {
  const providerItem = {
    proof_id: [{ value: "P1" }],
    next_store_info: [{ value: "NE1" }, { value: "ปลายทาง" }],
    line_info: [{ value: "LINE-P1" }],
    kit_arrive_time: [],
    fleet_sign_info: [{ value: TBR }],
    parcel_count: [],
    pack_count: [],
    fleet_unloading_time: [],
  };
  const h = providerHarness({ items: [providerItem] });
  const unresolved = row();
  const results = await Promise.all(
    Array.from({ length: 100 }, () =>
      h.lane.readBusTimeData(h.env, "NE1", ["2026-09-21"], [unresolved])),
  );
  assert.equal(h.calls(), 1);
  const projected = results[0].get("P:P1|A:ปลายทาง");
  assert.equal(projected.scheduleTbrArrivalAt, TBR);
  assert.equal(projected.fieldEvidence.scheduleTbrArrivalAt.state, MS_FIELD_EVIDENCE.OBSERVED);
  assert.equal(projected.fieldEvidence.scheduleTbrArrivalAt.valueTimestamp, TBR);
  assert.equal(projected.dataCompleteness, MS_DATA_COMPLETENESS.COMPLETE);
  assert.equal(projected.enrichmentState, "");

  h.advance(12_000);
  await h.lane.readBusTimeData(h.env, "NE1", ["2026-09-21"], [
    { ...unresolved, scheduleTbrArrivalAt: TBR },
  ]);
  assert.equal(h.calls(), 1, "DATA_COMPLETE rows do not schedule missing-only work");
});
