import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  canonicalMsSource,
  isObservedUnloadingTransition,
  planMsChanges,
  resolveUnloadingCompletedAt,
  resolveCompletionTruth,
  sameMsSnapshot,
  shouldWriteError,
  shouldWriteSuccessHeartbeat,
} from "../src/sync-policy.js";

const base = {
  id: "r1", hub: "NE1", proofId: "P1", routeName: "LH-NE1",
  trackingStatus: "มาถึงแล้ว", unloadingState: 1,
  unloadingCompletedAt: "", expectedParcels: 10, enteredParcels: 5,
  pendingParcels: 5, scheduleKitArrivalAt: "2026-09-01T01:00:00.000Z",
};

test("identical business snapshot does not change", () => {
  assert.equal(sameMsSnapshot(base, { ...base }), true);
  assert.deepEqual(planMsChanges([base], [{ ...base }]), { changedIds: [], removedIds: [] });
});

test("internal sync timestamps are ignored", () => {
  assert.equal(sameMsSnapshot({ ...base, syncedAt: "old", syncedBy: "A" }, { ...base, syncedAt: "new", syncedBy: "B" }), true);
});

test("status and unloading transitions change once", () => {
  const changed = { ...base, trackingStatus: "กำลังลงรถ", unloadingState: 2, unloadingCompletedAt: "2026-09-01T02:00:00.000Z" };
  assert.deepEqual(planMsChanges([base], [changed]).changedIds, ["r1"]);
  assert.deepEqual(planMsChanges([changed], [{ ...changed }]).changedIds, []);
});

test("first-seen completed route never fabricates unloading completion time", () => {
  const now = "2026-09-08T06:29:00.000Z";
  assert.equal(isObservedUnloadingTransition(null, 2), false);
  assert.equal(resolveUnloadingCompletedAt(null, 2, now), "");
  assert.equal(resolveUnloadingCompletedAt({}, 2, now), "");
  assert.equal(resolveUnloadingCompletedAt({ unloading_state: null }, 2, now), "");
});

test("only a known live 0 or 1 to 2 transition records completion time", () => {
  const now = "2026-09-08T06:29:04.000Z";
  for (const previous of [0, 1]) {
    assert.equal(isObservedUnloadingTransition({ unloading_state: previous }, 2), true);
    assert.equal(resolveUnloadingCompletedAt({ unloading_state: previous }, 2, now), now);
  }
  assert.equal(isObservedUnloadingTransition({ unloading_state: 2 }, 2), false);
  assert.equal(isObservedUnloadingTransition({ unloading_state: 3 }, 2), false);
});

test("verified completion time freezes until unloading state leaves completed", () => {
  const prior = "2026-09-08T06:29:04.000Z";
  assert.equal(
    resolveUnloadingCompletedAt({ unloading_state: 2, unloading_completed_at: prior }, 2, "2026-09-08T10:00:00.000Z"),
    prior,
  );
  assert.equal(
    resolveUnloadingCompletedAt({ unloadingState: 2, unloadingCompletedAt: prior }, 2, "2026-09-08T10:00:00.000Z"),
    prior,
  );
  assert.equal(resolveUnloadingCompletedAt({ unloading_state: 2, unloading_completed_at: prior }, 1, "2026-09-08T10:00:00.000Z"), "");
});

test("invalid observation timestamp is never stored as completion truth", () => {
  assert.equal(resolveUnloadingCompletedAt({ unloading_state: 1 }, 2, "not-a-date"), "");
});

test("Schedule E is timestamp authority only after Route reports completed", () => {
  const e = "2026-09-08T15:16:26.000Z";
  assert.deepEqual(resolveCompletionTruth({ unloading_state: 1 }, 1, e, "later"), { at: "", source: "UNKNOWN" });
  assert.deepEqual(resolveCompletionTruth({ unloading_state: 1 }, 2, e, "2026-09-08T15:17:00.000Z"), { at: e, source: "SCHEDULE" });
});

test("Schedule truth upgrades observed fallback and then remains stable", () => {
  const observed = "2026-09-08T15:17:00.000Z";
  const e = "2026-09-08T15:16:26.000Z";
  assert.deepEqual(resolveCompletionTruth({ unloading_state: 1 }, 2, "", observed), { at: observed, source: "OBSERVED_ROUTE_TRANSITION" });
  assert.deepEqual(resolveCompletionTruth({ unloading_state: 2, unloading_completed_at: observed }, 2, e, "later"), { at: e, source: "SCHEDULE" });
  assert.deepEqual(resolveCompletionTruth({ unloading_state: 2, unloading_completed_at: e, completionSource: "SCHEDULE" }, 2, e, "later"), { at: e, source: "SCHEDULE" });
});

test("DEV staging permanently wires completion truth, repair, archive and daily-history sanitizers", async () => {
  const patch = await readFile(new URL("../../.github/dev-tools/patch-ms-daily-completion-observation.mjs", import.meta.url), "utf8");
  const quotaPatch = await readFile(new URL("../../.github/dev-tools/patch-ms-quota-safe-live.mjs", import.meta.url), "utf8");
  assert.match(patch, /MS_COMPLETION_TIME_TRUTH_V2/);
  assert.match(patch, /MS_COMPLETION_TIME_TRUTH_UI_V2/);
  assert.match(patch, /completionTruth = resolveCompletionTruth/);
  assert.match(patch, /MS_LIVE_CACHE_VERSION/);
  assert.match(patch, /ensureMsCompletionRepair/);
  assert.match(patch, /verifiedCompletionRouteIds/);
  assert.match(patch, /LAG\(CAST\(json_extract\(payload_json,'\$\.unloadingState'\) AS INTEGER\)\)/);
  assert.doesNotMatch(patch, /SELECT h1\.payload_json/);
  assert.match(patch, /Number\(row\.unloadingState\) === 2 \? null : new Date\(\)/);
  assert.match(quotaPatch, /MS_COMPLETION_DAILY_HISTORY_TRUTH_V2/);
  assert.match(quotaPatch, /daily history never exports fabricated completion timestamp/);
  assert.match(quotaPatch, /MS_COMPLETION_ARCHIVE_TRUTH_V2/);
  assert.match(quotaPatch, /archiveVerifiedCompletionRoutes/);
  assert.match(quotaPatch, /startsWith\("completion-v2:"\)/);
  assert.match(quotaPatch, /sourceHash: String\(row\.source_hash \|\| ""\)/);
});

test("parcel and bus enrichment changes are business changes", () => {
  assert.equal(sameMsSnapshot(base, { ...base, pendingParcels: 4 }), false);
  assert.equal(sameMsSnapshot(base, { ...base, scheduleKitArrivalAt: "2026-09-01T01:05:00.000Z" }), false);
});

test("missing routes respect preserveMissing", () => {
  assert.deepEqual(planMsChanges([base], [], false).removedIds, ["r1"]);
  assert.deepEqual(planMsChanges([base], [], true).removedIds, []);
});

test("success heartbeat is throttled and recovery writes once", () => {
  const now = Date.parse("2026-09-01T10:00:00.000Z"), interval = 15 * 60 * 1000;
  assert.equal(shouldWriteSuccessHeartbeat("2026-09-01T09:50:00.000Z", "", now, interval), false);
  assert.equal(shouldWriteSuccessHeartbeat("2026-09-01T09:40:00.000Z", "", now, interval), true);
  assert.equal(shouldWriteSuccessHeartbeat("2026-09-01T09:59:00.000Z", "expired", now, interval), true);
});

test("same error does not write repeatedly", () => {
  assert.equal(shouldWriteError("session expired", "session expired"), false);
  assert.equal(shouldWriteError("", "session expired"), true);
  assert.equal(shouldWriteError("session expired", ""), true);
});

test("canonical live source ignores row order and derived completion metadata", () => {
  const other = { ...base, id: "r2", proofId: "P2", routeName: "FD-NE1" };
  assert.equal(
    canonicalMsSource([base, other]),
    canonicalMsSource([other, base]),
  );
  assert.equal(
    canonicalMsSource([{ ...base, unloadingCompletedAt: "2026-09-01T02:00:00.000Z", syncedAt: "old" }]),
    canonicalMsSource([{ ...base, unloadingCompletedAt: "2026-09-01T03:00:00.000Z", syncedAt: "new" }]),
  );
});

test("canonical live source changes when business source data changes", () => {
  assert.notEqual(
    canonicalMsSource([base]),
    canonicalMsSource([{ ...base, pendingParcels: 4 }]),
  );
});
