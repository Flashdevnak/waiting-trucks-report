import assert from "node:assert/strict";
import test from "node:test";
import { readCanonicalPnoPage, readSharedPnoPage } from "../../worker/.dev-runtime/src/index.js";
import { PNO_PASSIVE_LIMITS, registerPnoPassiveRoutes, runPnoPassiveCycle } from "../../worker/src/pno-passive-coverage.js";

const locator = (hub = "HUB_A", proofId = "PROOF_A") => ({
  hub, proofId, day: "2026-09-30", type: "total", page: 1, count: 1,
  lineId: "LINE", storeId: "SOURCE", nextStoreId: "TARGET", canReport: false,
});
const route = (value) => ({
  attendanceType: "ปลายทาง", pnoEnabled: true, pnoDetailAvailable: true,
  pnoSegmentCount: 1, expectedParcels: 1, proofId: value.proofId,
  pnoSourceDay: value.day, pnoLineId: value.lineId, pnoStoreId: value.storeId,
  pnoNextStoreId: value.nextStoreId,
});

function storage() {
  const values = new Map(); let alarm = null; let evidenceWrites = 0;
  return {
    async get(key) {
      if (Array.isArray(key)) return new Map(key.filter((item) => values.has(item)).map((item) => [item, values.get(item)]));
      return values.get(key);
    },
    async put(key, value) {
      if (typeof key === "string") values.set(key, structuredClone(value));
      else for (const [name, item] of Object.entries(key)) {
        values.set(name, structuredClone(item)); evidenceWrites++;
      }
    },
    async transaction(callback) { return callback(this); },
    async getAlarm() { return alarm; },
    async setAlarm(value) { alarm = value; },
    get evidenceWrites() { return evidenceWrites; },
  };
}

function fixture(fetchDetailPage) {
  const ids = [], owners = new Map(); let upstreamCalls = 0;
  const env = { MS_REFRESH_COORDINATOR: {
    idFromName(name) { ids.push(name); return name; },
    get(id) {
      if (!owners.has(id)) owners.set(id, { ctx: { storage: storage() } });
      const owner = owners.get(id);
      return { async fetch(request) {
        const url = new URL(request.url);
        assert.equal(url.pathname, "/pno");
        const query = Object.fromEntries(url.searchParams);
        try {
          const value = await readSharedPnoPage(owner, {}, {
            hub: query.branch, ...query,
          }, {
            readCredential: async () => ({}),
            fetchDetailPage: async (_credential, value) => {
              upstreamCalls++;
              return fetchDetailPage?.(value) || {
                items: [{ pno: "FIXTURE", LastAction: "SHIPMENT_WAREHOUSE_SCAN",
                  LastActionTime: "2026-09-30 12:00:00", real_arrive_time: "2026-09-30 10:00:00",
                  store_id: "TARGET" }], total: 1, sourceValid: true,
              };
            },
          });
          return Response.json(value);
        } catch (error) { return Response.json({ code: "FIXTURE_ERROR", message: error.message }, { status: 502 }); }
      } };
    },
  } };
  return { env, ids, owners, get upstreamCalls() { return upstreamCalls; } };
}

async function observer(harness, value, at = 1_000_000) {
  const scheduler = { ctx: { storage: storage() } };
  await registerPnoPassiveRoutes(scheduler, value.hub, [route(value)], at);
  const result = await runPnoPassiveCycle(scheduler, harness.env,
    (_owner, env, page) => readCanonicalPnoPage(env, page), at + 1);
  return { result, scheduler };
}

test("normal detail then passive observer share canonical per-HUB cache without fresh observation", async () => {
  const h = fixture(), value = locator();
  assert.equal((await readCanonicalPnoPage(h.env, value)).cacheState, "MISS");
  const writes = h.owners.get(value.hub).ctx.storage.evidenceWrites;
  const { result } = await observer(h, value);
  assert.deepEqual(result, { routes: 1, pages: 1, errors: 0 });
  assert.equal(h.upstreamCalls, 1);
  assert.equal(h.owners.get(value.hub).pnoDiagnostics.cacheHits, 1);
  assert.equal(h.owners.get(value.hub).ctx.storage.evidenceWrites, writes);
  assert.deepEqual(h.ids, [value.hub, value.hub]);
});

test("passive observer then normal detail reuse canonical cache without another provider call", async () => {
  const h = fixture(), value = locator();
  await observer(h, value);
  assert.equal((await readCanonicalPnoPage(h.env, value)).cacheState, "HIT");
  assert.equal(h.upstreamCalls, 1);
  assert.deepEqual(h.ids, [value.hub, value.hub]);
});

test("overlapping detail and observer acquisition coalesce in flight; different locator and HUB stay isolated", async () => {
  let release, started;
  const entered = new Promise((resolve) => { started = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const h = fixture(async () => {
    started(); await gate;
    return { items: [{ pno: "FIXTURE" }], total: 1, sourceValid: true };
  });
  const value = locator();
  const detail = readCanonicalPnoPage(h.env, value);
  await entered;
  const passive = observer(h, value);
  // Allow the observer to join the in-flight promise before releasing it.
  while (h.owners.get(value.hub).pnoDiagnostics.inflightCoalesced < 1)
    await new Promise((resolve) => setImmediate(resolve));
  release();
  const [first, second] = await Promise.all([detail, passive]);
  assert.equal(first.total, 1);
  assert.equal(second.result.errors, 0);
  assert.equal(h.upstreamCalls, 1);
  assert.equal(h.owners.get(value.hub).pnoDiagnostics.inflightCoalesced, 1);
  await readCanonicalPnoPage(h.env, locator(value.hub, "PROOF_B"));
  await readCanonicalPnoPage(h.env, { ...value, page: 2 });
  await readCanonicalPnoPage(h.env, locator("HUB_B"));
  assert.equal(h.upstreamCalls, 4);
  assert.notEqual(h.owners.get(value.hub), h.owners.get("HUB_B"));
  assert.equal(h.owners.get("HUB_B").pnoDiagnostics.cacheMisses, 1);
  assert.equal(h.owners.get("HUB_B").ctx.storage.evidenceWrites, 0);
});

test("scheduler budget and fail-closed coverage remain unchanged", () => {
  assert.deepEqual([PNO_PASSIVE_LIMITS.cadenceMs, PNO_PASSIVE_LIMITS.maxRoutesPerCycle,
    PNO_PASSIVE_LIMITS.maxPagesPerCycle, PNO_PASSIVE_LIMITS.maxConcurrency], [120_000, 2, 4, 1]);
});
