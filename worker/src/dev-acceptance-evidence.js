// DEV-only acceptance reductions. No provider, storage, or DOM access here.
// The emitted values are fixed-shape counts; operational records never leave
// the Worker through this channel.
export const CENTRAL_MINUTES = Object.freeze({
  '4W': 20, '4WJ': 30, '6W': 60, '10W': 60,
  '14W': 120, '18W': 180, '22W': 180,
});

export function centralBand(vehicleType) {
  const input = String(vehicleType || '').toUpperCase();
  const type = ['22W', '18W', '14W', '10W', '6W', '4WJ', '4W'].find((key) => input.includes(key));
  const standard = type ? CENTRAL_MINUTES[type] : null;
  return standard == null ? null : { standard, warning: Math.max(1, Math.ceil(standard * 0.2)) };
}

const scanClasses = ['CONFIRMED_SCAN_IN', 'INSUFFICIENT_HISTORY',
  'NOT_YET_SCAN_IN_STAGE', 'SUSPECTED_SCAN_IN_GAP'];

export function summarizePnoPages(pages) {
  const counts = { inspectedCount: 0, confirmedScanIn: 0,
    insufficientHistory: 0, notYetScanInStage: 0,
    suspectedScanInGap: 0, falseGapCandidates: 0 };
  const fields = ['confirmedScanIn', 'insufficientHistory',
    'notYetScanInStage', 'suspectedScanInGap'];
  for (const page of pages) {
    if (page?.sourceValid !== true || !Array.isArray(page.parcels)) continue;
    for (const parcel of page.parcels) {
      const evidence = parcel?.scanEvidence;
      const index = scanClasses.indexOf(evidence?.classification);
      if (index < 0) continue;
      counts.inspectedCount++;
      counts[fields[index]]++;
      if (index === 3 && evidence.reason !== 'SCAN_IN_STATE_ABSENT_AT_REQUIRED_STAGE')
        counts.falseGapCandidates++;
    }
  }
  return counts;
}

const time = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
};
const kind = (row) => {
  const value = String(row?.attendanceType || '');
  return value.includes('จุดดร') ? 'drop' : value.includes('ปลายทาง') ? 'destination' :
    value.includes('ต้นทาง') ? 'origin' : null;
};
const severityCounts = () => ({ warning: 0, danger: 0, success: 0, normal: 0, neutral: 0 });
const releaseSeverity = (row, band, now, isDrop) => {
  const base = time(row.estimatedDepartureAt);
  if (base == null) return 'neutral';
  const plannedArrival = time(row.estimatedArrivalAt);
  const actualArrival = time(row.actualArrivalAt);
  const shifted = isDrop && plannedArrival != null && actualArrival != null
    ? Math.max(0, Math.round((actualArrival - plannedArrival) / 60_000)) : 0;
  const deadline = base + shifted * 60_000;
  const actual = time(row.actualDepartureAt);
  if (actual != null) return Math.round((actual - deadline) / 60_000) > 0 ? 'danger' : 'success';
  const remaining = Math.ceil((deadline - now) / 60_000);
  if (remaining < 0) return 'danger';
  if (!band) return 'neutral';
  return remaining <= band.warning ? 'warning' : 'normal';
};

export function summarizeCentralRows(rows, now = Date.now()) {
  const areas = { origin: severityCounts(), destination: severityCounts(),
    dropUnload: severityCounts(), dropRelease: severityCounts() };
  let inspectedCount = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row?.queueCancelledAt) continue;
    const area = kind(row);
    if (!area) continue;
    inspectedCount++;
    const band = centralBand(row.vehicleType);
    if (area === 'origin') {
      areas.origin[releaseSeverity(row, band, now, false)]++;
      continue;
    }
    // As in the rendered unload SLA, the earliest Route KIT / TBR queue time
    // is accepted, while supplementary scheduleKitArrivalAt is not an anchor.
    const arrivals = [time(row.actualArrivalAt), time(row.scheduleTbrArrivalAt)]
      .filter((value) => value != null);
    const arrival = arrivals.length ? Math.min(...arrivals) : null;
    const completed = Number(row.unloadingState) === 2;
    const finish = completed ? (time(row.scheduleUnloadingCompletedAt) ??
      ((row.completionObservedLive !== false || row.completionSource === 'SCHEDULE')
        ? time(row.unloadingCompletedAt) : null)) : null;
    const end = finish ?? (!completed ? now : null);
    let unload = 'neutral';
    if (band && arrival != null && end != null && end >= arrival) {
      const elapsed = Math.floor((end - arrival) / 60_000);
      const remaining = band.standard - elapsed;
      unload = remaining < 0 ? 'danger' : completed ? 'success' :
        remaining <= band.warning ? 'warning' : 'normal';
    }
    areas[area === 'drop' ? 'dropUnload' : 'destination'][unload]++;
    if (area === 'drop') areas.dropRelease[releaseSeverity(row, band, now, true)]++;
  }
  return { inspectedCount, areas };
}

export function devAcceptanceEnabled(env) {
  return env?.DB_BACKEND === 'turso' && env?.DEV_ACCEPTANCE_TELEMETRY === '1';
}

// Fixed-shape allowlist. Never pass a raw row, error, HUB, locator or session.
export function emitDevAcceptance(env, event, value, output = console.log) {
  if (!devAcceptanceEnabled(env)) return false;
  if (event === 'PNO' && value && Object.keys(summarizePnoPages([]))
    .every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0) &&
    ['cadenceSeconds', 'maxRoutesPerCycle', 'maxRequestsPerCycle', 'maxConcurrency']
      .every((key) => Number.isSafeInteger(value[key]) && value[key] > 0)) {
    const counts = Object.fromEntries(Object.keys(summarizePnoPages([])).map((key) => [key, value[key]]));
    output(JSON.stringify({ event: 'DEV_ACCEPTANCE_PNO_V1', ...counts,
      cadenceSeconds: value.cadenceSeconds,
      maxRoutesPerCycle: value.maxRoutesPerCycle,
      maxRequestsPerCycle: value.maxRequestsPerCycle,
      maxConcurrency: value.maxConcurrency }));
    return true;
  }
  if (event === 'CENTRAL' && value && Number.isSafeInteger(value.inspectedCount) &&
      value.inspectedCount >= 0 && ['origin', 'destination', 'dropUnload', 'dropRelease']
        .every((area) => ['warning', 'danger', 'success', 'normal', 'neutral']
          .every((state) => Number.isSafeInteger(value.areas?.[area]?.[state]) && value.areas[area][state] >= 0))) {
    const areas = Object.fromEntries(['origin', 'destination', 'dropUnload', 'dropRelease'].map((area) =>
      [area, Object.fromEntries(['warning', 'danger', 'success', 'normal', 'neutral']
        .map((state) => [state, value.areas[area][state]]))]));
    output(JSON.stringify({ event: 'DEV_ACCEPTANCE_CENTRAL_V1', inspectedCount: value.inspectedCount, areas }));
    return true;
  }
  return false;
}
