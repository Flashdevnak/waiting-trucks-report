import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalMsSource,
  planMsChanges,
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
