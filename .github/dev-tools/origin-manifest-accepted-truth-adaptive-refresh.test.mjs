import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import { readFile } from "node:fs/promises";

import { ORIGIN_MANIFEST_POLICY } from "../../worker/src/origin-manifest-v1.js";
import { patchOriginManifestSessionReplay } from "./patch-dev-origin-manifest-session-v2.mjs";

const canonicalOriginSource = await readFile(
  new URL("../../worker/src/origin-manifest-v1.js", import.meta.url),
  "utf8",
);
const stagedOriginSource = patchOriginManifestSessionReplay(canonicalOriginSource);
const frontendPrefix = "const ORIGIN_MANIFEST_UI_JS = String.raw\`";
const frontendStart = stagedOriginSource.indexOf(frontendPrefix) + frontendPrefix.length;
const frontendEnd = stagedOriginSource.indexOf("\`;\n", frontendStart);
assert.ok(frontendStart >= frontendPrefix.length && frontendEnd > frontendStart,
  "must extract LH Manifest frontend from the staged Origin Manifest module");
const stagedFrontendSource = stagedOriginSource.slice(frontendStart, frontendEnd);

const NativeDate = Date;
const ACCEPTED = Object.freeze({
  proofId: "LH-PROOF-001",
  manifestShippedParcels: 1706,
  manifestWeightKg: 3215.97,
  manifestUpdatedAt: "2026-10-08T00:00:00.000Z",
  manifestSource: "LH_MANIFEST",
});

function makeRuntime() {
  let now = NativeDate.parse("2026-10-08T00:00:00.000Z");
  class FakeDate extends NativeDate {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
    static now() {
      return now;
    }
  }

  const store = new Map();
  const localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };

  const state = {
    auth: true,
    branch: "BKK",
    currentRows: [],
    rows: [],
    archiveView: false,
  };

  let queue = [];
  let calls = 0;
  let pending = null;
  const apiGet = async () => {
    calls += 1;
    const next = queue.shift();
    if (next?.type === "throw") throw new Error(next.message || "timeout");
    if (next?.type === "pending") {
      return await new Promise((resolve, reject) => {
        pending = { resolve, reject };
      });
    }
    return next?.value ?? next;
  };

  const source = stagedFrontendSource;
  const anchor = "  function init() {";
  const instrumented = source.replace(
    anchor,
    `  globalThis.__LH_TEST__ = {
    loadBrowserCache,
    freshAcceptedRows,
    saveBrowserCache,
    applyCachedManifest,
    maybeSyncManifest,
    activeOriginProofsLocal,
    activeOriginDaysLocal,
    manifestCache,
    lastAttemptAt,
    lastWakeUpAt,
  };

${anchor}`,
  );
  assert.notEqual(instrumented, source, "test hook must instrument real LH Manifest frontend source");

  const context = vm.createContext({
    console: { warn() {}, log() {}, error() {} },
    document: {
      readyState: "loading",
      addEventListener() {},
      getElementById() { return null; },
    },
    window: { addEventListener() {} },
    localStorage,
    state,
    isOrigin: (row) => String(row?.attendanceType || "").includes("ต้นทาง"),
    queueInfo: () => ({ active: true }),
    bangkokDateValue: () => "2026-10-08",
    apiGet,
    render() {},
    nf: new Intl.NumberFormat("th-TH"),
    esc: (value) => String(value),
    Intl,
    Date: FakeDate,
    setTimeout: () => 0,
    setInterval: () => 0,
    URL,
    URLSearchParams,
    FileReader: class {},
  });
  vm.runInContext(instrumented, context, { filename: "origin-manifest-frontend.js" });
  const h = context.__LH_TEST__;
  assert.ok(h, "LH Manifest test hook must be available");

  const route = (id) => ({
    id,
    proofId: "LH-PROOF-001",
    attendanceType: "ต้นทาง",
    estimatedDepartureAt: "2026-10-08T01:00:00.000Z",
  });
  const reset = (id = "occ-A") => {
    const rows = [route(id)];
    state.currentRows = rows;
    state.rows = rows;
  };

  return {
    h,
    state,
    localStorage,
    reset,
    advance(ms) { now += ms; },
    setQueue(...items) { queue = items; },
    get calls() { return calls; },
    get pending() { return pending; },
  };
}

async function seed(runtime) {
  runtime.reset("occ-A");
  runtime.setQueue({
    value: {
      rows: [ACCEPTED],
      refreshedAt: "2026-10-08T00:00:00.000Z",
    },
  });
  await runtime.h.maybeSyncManifest(true);
}

function metrics(runtime) {
  const row = runtime.state.currentRows[0] || {};
  return [row.manifestShippedParcels, row.manifestWeightKg];
}

test("policy exposes adaptive 2-5 minute refresh bounds", () => {
  assert.equal(ORIGIN_MANIFEST_POLICY.adaptiveRefresh, true);
  assert.equal(ORIGIN_MANIFEST_POLICY.refreshMinMs, 2 * 60 * 1000);
  assert.equal(ORIGIN_MANIFEST_POLICY.refreshSteadyMs, 3 * 60 * 1000);
  assert.equal(ORIGIN_MANIFEST_POLICY.refreshIdleMs, 5 * 60 * 1000);
  assert.equal(ORIGIN_MANIFEST_POLICY.errorBackoffMs, 5 * 60 * 1000);
});

test("accepted truth survives a newer response that omits the proof", async () => {
  const runtime = makeRuntime();
  await seed(runtime);
  runtime.advance(5 * 60 * 1000 + 1);
  runtime.reset("occ-A");
  runtime.setQueue({ value: { rows: [], refreshedAt: "2026-10-08T00:05:01.000Z" } });
  await runtime.h.maybeSyncManifest(false);
  runtime.h.applyCachedManifest();
  assert.deepEqual(metrics(runtime), [1706, 3215.97]);
});

test("accepted truth survives source timeout/error", async () => {
  const runtime = makeRuntime();
  await seed(runtime);
  runtime.advance(5 * 60 * 1000 + 1);
  runtime.reset("occ-A");
  runtime.setQueue({ type: "throw", message: "timeout" });
  await runtime.h.maybeSyncManifest(false);
  runtime.h.applyCachedManifest();
  assert.deepEqual(metrics(runtime), [1706, 3215.97]);
});

test("partial newer truth updates shipped parcels but preserves accepted weight", async () => {
  const runtime = makeRuntime();
  await seed(runtime);
  runtime.advance(5 * 60 * 1000 + 1);
  runtime.reset("occ-A");
  runtime.setQueue({
    value: {
      rows: [{ ...ACCEPTED, manifestShippedParcels: 1710, manifestWeightKg: null }],
      refreshedAt: "2026-10-08T00:05:01.000Z",
    },
  });
  await runtime.h.maybeSyncManifest(false);
  runtime.h.applyCachedManifest();
  assert.deepEqual(metrics(runtime), [1710, 3215.97]);
});

test("complete newer authoritative truth replaces both accepted metrics", async () => {
  const runtime = makeRuntime();
  await seed(runtime);
  runtime.advance(5 * 60 * 1000 + 1);
  runtime.reset("occ-A");
  runtime.setQueue({
    value: {
      rows: [{ ...ACCEPTED, manifestShippedParcels: 1715, manifestWeightKg: 3300.5 }],
      refreshedAt: "2026-10-08T00:05:01.000Z",
    },
  });
  await runtime.h.maybeSyncManifest(false);
  runtime.h.applyCachedManifest();
  assert.deepEqual(metrics(runtime), [1715, 3300.5]);
});

test("accepted truth is occurrence-scoped and never crosses a reused proofId", async () => {
  const runtime = makeRuntime();
  await seed(runtime);
  runtime.advance(60 * 1000);
  runtime.reset("occ-B");
  runtime.h.applyCachedManifest();
  assert.deepEqual(metrics(runtime), [undefined, undefined]);
});

test("legacy proof-only cache cannot lend accepted truth to a new occurrence", () => {
  const runtime = makeRuntime();
  runtime.localStorage.setItem("ms_origin_manifest_v1_BKK", JSON.stringify({
    rows: [ACCEPTED],
    savedAt: NativeDate.parse("2026-10-08T00:00:00.000Z"),
    acceptedAtByProof: { "LH-PROOF-001": NativeDate.parse("2026-10-08T00:00:00.000Z") },
  }));
  runtime.reset("occ-B");
  runtime.h.applyCachedManifest();
  assert.deepEqual(metrics(runtime), [undefined, undefined]);
  assert.equal(runtime.h.loadBrowserCache("BKK").rows.length, 0);
});

test("fast refresh is due after two minutes while accepted truth remains visible in-flight", async () => {
  const runtime = makeRuntime();
  await seed(runtime);
  runtime.advance(2 * 60 * 1000 + 1);
  runtime.reset("occ-A");
  runtime.setQueue({ type: "pending" });
  const inFlight = runtime.h.maybeSyncManifest(false);
  runtime.h.applyCachedManifest();

  assert.equal(runtime.calls, 2, "seed + adaptive fast refresh");
  assert.deepEqual(metrics(runtime), [1706, 3215.97]);

  runtime.pending.resolve({ rows: [], refreshedAt: "2026-10-08T00:02:01.000Z" });
  await inFlight;
  runtime.h.applyCachedManifest();
  assert.deepEqual(metrics(runtime), [1706, 3215.97]);
});

test("adaptive cadence settles 2 -> 3 -> 5 minutes and returns to 2 after a change", async () => {
  const runtime = makeRuntime();
  await seed(runtime);

  let cached = runtime.h.loadBrowserCache("BKK");
  assert.equal(cached.refreshMs, 2 * 60 * 1000);

  runtime.advance(2 * 60 * 1000 + 1);
  runtime.reset("occ-A");
  runtime.setQueue({ value: { rows: [ACCEPTED], refreshedAt: "2026-10-08T00:02:01.000Z" } });
  await runtime.h.maybeSyncManifest(false);
  cached = runtime.h.loadBrowserCache("BKK");
  assert.equal(cached.refreshMs, 3 * 60 * 1000);

  runtime.advance(3 * 60 * 1000 + 1);
  runtime.reset("occ-A");
  runtime.setQueue({ value: { rows: [ACCEPTED], refreshedAt: "2026-10-08T00:05:02.000Z" } });
  await runtime.h.maybeSyncManifest(false);
  cached = runtime.h.loadBrowserCache("BKK");
  assert.equal(cached.refreshMs, 5 * 60 * 1000);

  runtime.advance(5 * 60 * 1000 + 1);
  runtime.reset("occ-A");
  runtime.setQueue({
    value: {
      rows: [{ ...ACCEPTED, manifestShippedParcels: 1711 }],
      refreshedAt: "2026-10-08T00:10:03.000Z",
    },
  });
  await runtime.h.maybeSyncManifest(false);
  cached = runtime.h.loadBrowserCache("BKK");
  assert.equal(cached.refreshMs, 2 * 60 * 1000);
  assert.deepEqual(metrics(runtime), [1711, 3215.97]);
});

test("source error backs normal refresh off for five minutes without deleting accepted truth", async () => {
  const runtime = makeRuntime();
  await seed(runtime);

  runtime.advance(2 * 60 * 1000 + 1);
  runtime.reset("occ-A");
  runtime.setQueue({ type: "throw", message: "rate limited" });
  await runtime.h.maybeSyncManifest(false);
  assert.equal(runtime.calls, 2);
  runtime.h.applyCachedManifest();
  assert.deepEqual(metrics(runtime), [1706, 3215.97]);

  runtime.advance(4 * 60 * 1000);
  runtime.reset("occ-A");
  runtime.setQueue({ value: { rows: [ACCEPTED], refreshedAt: "2026-10-08T00:06:01.000Z" } });
  await runtime.h.maybeSyncManifest(false);
  assert.equal(runtime.calls, 2, "must remain inside five-minute error backoff");

  runtime.advance(60 * 1000 + 1);
  await runtime.h.maybeSyncManifest(false);
  assert.equal(runtime.calls, 3, "refresh may resume after five-minute backoff");
});
