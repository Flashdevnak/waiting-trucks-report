// DEV-only, shared per-HUB scan observation. Latest-state pages are partial
// evidence: neither a successful cycle nor a cache hit proves an absent scan.
import { emitDevAcceptance, summarizePnoPages } from './dev-acceptance-evidence.js';
export const PNO_PASSIVE_LIMITS = Object.freeze({
  cadenceMs: 120_000, // Slower than the existing 60-second shared page cache.
  maxRoutesPerCycle: 2,
  maxPagesPerRoute: 2,
  maxPagesPerCycle: 4,
  maxConcurrency: 1,
  maxCandidates: 12,
  lifecycleMs: 12 * 60 * 60_000,
  errorBackoffMs: 5 * 60_000,
});

const STATE_KEY = "pno-passive-coverage-v1";
const inbound = new Set(["ปลายทาง", "จุดดรอป"]);

export function pnoPassiveLocator(row, hub) {
  if (row?.pnoEnabled !== true ||
      !inbound.has(String(row?.attendanceType || "").trim()) || row?.queueCancelledAt)
    return null;
  if (row?.pnoSegmentCount !== 1 || row?.pnoDetailAvailable !== true) return null;
  return exactPassiveLocator(row, hub);
}

function exactPassiveLocator(row, hub) {
  const locator = {
    hub: String(hub || "").trim().toUpperCase(),
    day: String(row.pnoSourceDay || "").trim(),
    proofId: String(row.proofId || "").trim(),
    lineId: String(row.pnoLineId || "").trim(),
    vanLineId: String(row.pnoVanLineId || "").trim(),
    storeId: String(row.pnoStoreId || "").trim(),
    nextStoreId: String(row.pnoNextStoreId || "").trim(),
    canReport: row.pnoCanReport === true,
    type: "total",
    count: Number(row.expectedParcels),
  };
  if (!locator.hub || !/^\d{4}-\d{2}-\d{2}$/.test(locator.day) ||
      !locator.proofId || !(locator.lineId || locator.vanLineId) ||
      !locator.storeId || !locator.nextStoreId ||
      !Number.isSafeInteger(locator.count) || locator.count <= 0) return null;
  return locator;
}

export function pnoPassiveLocators(row, hub) {
  if (row?.pnoEnabled !== true || row?.pnoDetailAvailable !== true ||
      !inbound.has(String(row?.attendanceType || "").trim()) || row?.queueCancelledAt)
    return [];
  if (row.pnoSegmentCount === 1) {
    const exact = pnoPassiveLocator(row, hub);
    return exact ? [exact] : [];
  }
  const segments = row?.pnoSegments;
  if (!Number.isSafeInteger(row.pnoSegmentCount) || row.pnoSegmentCount < 2 ||
      !Array.isArray(segments) || segments.length !== row.pnoSegmentCount ||
      segments.some((segment) => !segment || segment.proofId !== row.proofId)) return [];
  const locators = segments.map((segment) => exactPassiveLocator(segment, hub));
  if (locators.some((locator, index) => !locator ||
      !Number.isSafeInteger(segments[index].enteredParcels) ||
      !Number.isSafeInteger(segments[index].pendingParcels) ||
      segments[index].enteredParcels + segments[index].pendingParcels !== locator.count)) return [];
  if (new Set(locators.map(routeKey)).size !== locators.length) return [];
  if (locators.reduce((sum, locator) => sum + locator.count, 0) !== row.expectedParcels ||
      segments.reduce((sum, segment) => sum + segment.enteredParcels, 0) !== row.enteredParcels ||
      segments.reduce((sum, segment) => sum + segment.pendingParcels, 0) !== row.pendingParcels) return [];
  return locators;
}

function routeKey(locator) {
  return JSON.stringify([locator.hub, locator.day, locator.proofId,
    locator.lineId || locator.vanLineId, locator.storeId, locator.nextStoreId]);
}

function serial(owner, task) {
  const previous = owner.pnoPassiveSerial || Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  owner.pnoPassiveSerial = next.catch(() => undefined);
  return next;
}

export async function registerPnoPassiveRoutes(owner, hub, rows, at = Date.now()) {
  if (!owner?.ctx?.storage || !Array.isArray(rows)) return 0;
  return serial(owner, async () => {
    const storage = owner.ctx.storage;
    const state = await storage.get(STATE_KEY) || { routes: [], cursor: 0 };
    const routes = Array.isArray(state.routes) ? state.routes : [];
    // Retire completed lifecycles before admitting another exact occurrence.
    // The same per-HUB candidate cap and round-robin request budget remain.
    for (let index = routes.length - 1; index >= 0; index--)
      if (routes[index].expired || at - routes[index].firstSeenAt >= PNO_PASSIVE_LIMITS.lifecycleMs)
        routes.splice(index, 1);
    state.cursor = routes.length ? (state.cursor || 0) % routes.length : 0;
    const known = new Set(routes.map((item) => item.key));
    // Rotate admission after previously admitted candidates receive an attempt.
    // This admits >12 exact segments over subsequent existing cycles while
    // retaining at most 12 and never increasing the per-cycle page budget.
    const candidates = [...new Map(rows.flatMap((row) => pnoPassiveLocators(row, hub))
      .map((locator) => [routeKey(locator), locator])).values()];
    const multiPresent = rows.some((row) => row?.pnoSegmentCount > 1 && pnoPassiveLocators(row, hub).length);
    const offset = candidates.length ? (state.admissionCursor || 0) % candidates.length : 0;
    for (let step = 0; step < candidates.length; step++) {
      const locator = candidates[(offset + step) % candidates.length];
      const key = routeKey(locator);
      if (known.has(key)) {
        const entry = routes.find((item) => item.key === key);
        if (entry && !entry.expired) entry.locator = locator;
        continue;
      }
      if (routes.length >= PNO_PASSIVE_LIMITS.maxCandidates) {
        if (!multiPresent) continue;
        const attempted = routes.filter((entry) => entry.lastAttemptAt > 0)
          .sort((a, b) => a.lastAttemptAt - b.lastAttemptAt)[0];
        if (!attempted) continue;
        routes.splice(routes.indexOf(attempted), 1);
        known.delete(attempted.key);
      }
      routes.push({ key, locator, firstSeenAt: at, lastAttemptAt: 0,
        nextPage: 2, totalPages: 1, backoffUntil: 0, expired: false });
      known.add(key);
      state.admissionCursor = (offset + step + 1) % candidates.length;
    }
    state.cursor = routes.length ? state.cursor % routes.length : 0;
    await storage.put(STATE_KEY, { ...state, routes });
    if (routes.some((item) => !item.expired) && storage.getAlarm && storage.setAlarm &&
        await storage.getAlarm() == null)
      await storage.setAlarm(at + 1);
    return routes.filter((item) => !item.expired).length;
  });
}

export async function runPnoPassiveCycle(owner, env, readPage, at = Date.now()) {
  if (!owner?.ctx?.storage) return { routes: 0, pages: 0, errors: 0 };
  return serial(owner, async () => {
    const storage = owner.ctx.storage;
    const state = await storage.get(STATE_KEY) || { routes: [], cursor: 0 };
    if (state.lastCycleAt > 0 && at - state.lastCycleAt < PNO_PASSIVE_LIMITS.cadenceMs)
      return { routes: 0, pages: 0, errors: 0 };
    state.lastCycleAt = at;
    await storage.put(STATE_KEY, state);
    const routes = Array.isArray(state.routes) ? state.routes : [];
    const roundRobin = routes.length ? [...routes.slice(state.cursor || 0), ...routes.slice(0, state.cursor || 0)] : [];
    const ordered = [...roundRobin.filter((item) => item.lastAttemptAt === 0)
      .sort((a, b) => a.firstSeenAt - b.firstSeenAt),
      ...roundRobin.filter((item) => item.lastAttemptAt > 0)];
    let handled = 0, pages = 0, errors = 0;
    const observedPages = [];
    for (const item of ordered) {
      if (at - item.firstSeenAt >= PNO_PASSIVE_LIMITS.lifecycleMs) {
        item.expired = true;
        continue;
      }
      if (handled >= PNO_PASSIVE_LIMITS.maxRoutesPerCycle ||
          pages >= PNO_PASSIVE_LIMITS.maxPagesPerCycle) break;
      if (item.expired || at < item.backoffUntil ||
          (item.lastAttemptAt > 0 && at - item.lastAttemptAt < PNO_PASSIVE_LIMITS.cadenceMs)) continue;
      handled++;
      state.cursor = (routes.indexOf(item) + 1) % routes.length;
      item.lastAttemptAt = at;
      // Persist the attempt before network I/O; an alarm restart cannot make
      // the same occurrence fire another immediate request burst.
      await storage.put(STATE_KEY, { ...state, routes });
      try {
        pages++;
        const first = await readPage(owner, env, { ...item.locator, page: 1 });
        if (first?.sourceValid !== true || !Number.isSafeInteger(first.total) ||
            first.total < 0 || first.sourceCountMismatch === true ||
            !Array.isArray(first.parcels)) throw new Error("PNO_PASSIVE_SOURCE_INVALID");
        observedPages.push(first);
        const totalPages = Math.max(1, Math.ceil(first.total / 200));
        item.totalPages = totalPages;
        if (totalPages > 1 && pages < PNO_PASSIVE_LIMITS.maxPagesPerCycle) {
          const page = Math.max(2, Math.min(totalPages, item.nextPage || 2));
          pages++;
          const next = await readPage(owner, env, { ...item.locator, page });
          if (next?.sourceValid !== true || next.total !== first.total ||
              next.page !== page || !Array.isArray(next.parcels))
            throw new Error("PNO_PASSIVE_PAGE_INVALID");
          observedPages.push(next);
          item.nextPage = page >= totalPages ? 2 : page + 1;
        }
        item.backoffUntil = 0;
      } catch {
        errors++;
        item.backoffUntil = at + PNO_PASSIVE_LIMITS.errorBackoffMs;
        // No retry, no completeness promotion and no mutation of sticky positives.
      }
    }
    await storage.put(STATE_KEY, { ...state, routes });
    const active = routes.some((item) => !item.expired && at - item.firstSeenAt < PNO_PASSIVE_LIMITS.lifecycleMs);
    if (active && storage.setAlarm)
      await storage.setAlarm(at + PNO_PASSIVE_LIMITS.cadenceMs);
    // Existing pages only. A cached page contributes a classification sample,
    // never a new observation or a claim of complete event coverage.
    emitDevAcceptance(env, 'PNO', { ...summarizePnoPages(observedPages),
      cadenceSeconds: PNO_PASSIVE_LIMITS.cadenceMs / 1000,
      maxRoutesPerCycle: PNO_PASSIVE_LIMITS.maxRoutesPerCycle,
      maxRequestsPerCycle: PNO_PASSIVE_LIMITS.maxPagesPerCycle,
      maxConcurrency: PNO_PASSIVE_LIMITS.maxConcurrency });
    return { routes: handled, pages, errors };
  });
}
