import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { CENTRAL_MINUTES, centralBand, summarizePnoPages,
  summarizeCentralRows, devAcceptanceEnabled, emitDevAcceptance }
  from '../../worker/src/dev-acceptance-evidence.js';
import { sanitizedTailEvent, collectTail } from './collect-dev-acceptance-tail.mjs';
import { projectPnoEvidence } from '../../worker/src/pno-inbound-scan-evidence.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = async (name) => readFile(root + name, 'utf8');
const at = Date.parse('2026-10-01T12:00:00Z');
const when = (deltaMinutes) => new Date(at + deltaMinutes * 60_000).toISOString();

test('explicit DEV gate and fixed-shape output omit identifiers and auth values', () => {
  const env = { DB_BACKEND: 'turso', DEV_ACCEPTANCE_TELEMETRY: '1' };
  assert.equal(devAcceptanceEnabled(env), true);
  assert.equal(devAcceptanceEnabled({ ...env, DB_BACKEND: 'd1' }), false);
  assert.equal(devAcceptanceEnabled({ DB_BACKEND: 'turso' }), false);
  const emitted = [];
  const value = { ...summarizePnoPages([]), cadenceSeconds: 120,
    maxRoutesPerCycle: 2, maxRequestsPerCycle: 4, maxConcurrency: 1,
    pno: 'RAW_PNO', proofId: 'RAW_PROOF',
    cookie: 'RAW_COOKIE', token: 'RAW_TOKEN', driverName: 'RAW_DRIVER' };
  assert.equal(emitDevAcceptance(env, 'PNO', value, (line) => emitted.push(line)), true);
  assert.equal(emitDevAcceptance({ DB_BACKEND: 'd1', DEV_ACCEPTANCE_TELEMETRY: '1' },
    'PNO', value, (line) => emitted.push(line)), false);
  assert.equal(emitted.length, 1);
  for (const forbidden of ['RAW_PNO', 'RAW_PROOF', 'RAW_COOKIE', 'RAW_TOKEN', 'RAW_DRIVER'])
    assert.equal(emitted[0].includes(forbidden), false);
  assert.equal(emitDevAcceptance(env, 'PNO', { ...value, inspectedCount: '1' }, () => {}), false);
});

test('PNO current-page classifications are counted without promoting unknown coverage', () => {
  const record = { monitoringStartedAt: when(-40), lastObservedAt: when(-1),
    arrivalStageObserved: true, downstreamObserved: true, scanInObserved: false,
    monitoringBeforeArrival: false, coverageState: 'LATE_START' };
  const unknown = projectPnoEvidence(record);
  assert.equal(unknown.classification, 'INSUFFICIENT_HISTORY');
  const positive = projectPnoEvidence({ ...record, scanInObserved: true,
    scanInObservedAt: when(-2), scanInAction: 'ARRIVAL_WAREHOUSE_SCAN' });
  assert.equal(positive.classification, 'CONFIRMED_SCAN_IN');
  const result = summarizePnoPages([{ sourceValid: true, parcels: [
    { scanEvidence: unknown, pno: 'RAW_PNO' },
    { scanEvidence: positive, cookie: 'RAW_COOKIE' },
    { scanEvidence: { classification: 'NOT_YET_SCAN_IN_STAGE' } },
  ] }, { sourceValid: false, parcels: [{ scanEvidence: positive }] }]);
  assert.deepEqual(result, { inspectedCount: 3, confirmedScanIn: 1,
    insufficientHistory: 1, notYetScanInStage: 1, suspectedScanInGap: 0,
    falseGapCandidates: 0 });
  assert.equal(JSON.stringify(result).includes('RAW_'), false);
});

test('CENTRAL standards and 20 percent bands are exact and HUB overrides ignored', () => {
  assert.deepEqual(CENTRAL_MINUTES, { '4W': 20, '4WJ': 30, '6W': 60,
    '10W': 60, '14W': 120, '18W': 180, '22W': 180 });
  assert.deepEqual(Object.fromEntries(Object.keys(CENTRAL_MINUTES).map((type) =>
    [type, centralBand(type).warning])),
  { '4W': 4, '4WJ': 6, '6W': 12, '10W': 12, '14W': 24, '18W': 36, '22W': 36 });
  assert.equal(centralBand('UNKNOWN'), null);
  const row = { attendanceType: 'ต้นทาง', vehicleType: '4W',
    estimatedDepartureAt: when(4), hubStandardMinutes: 999 };
  assert.equal(summarizeCentralRows([row], at).areas.origin.warning, 1);
  assert.equal(summarizeCentralRows([{ ...row, estimatedDepartureAt: when(5) }], at).areas.origin.normal, 1);
  assert.equal(summarizeCentralRows([{ ...row, estimatedDepartureAt: when(-1) }], at).areas.origin.danger, 1);
  assert.equal(summarizeCentralRows([{ ...row, vehicleType: 'UNKNOWN' }], at).areas.origin.neutral, 1);
  assert.equal(summarizeCentralRows([{ ...row, estimatedDepartureAt: '' }], at).areas.origin.neutral, 1);
});

test('destination and drop unload, adjusted drop release, completed truth', () => {
  const base = { vehicleType: '4W', actualArrivalAt: when(-16),
    unloadingState: 1, estimatedArrivalAt: when(-20), estimatedDepartureAt: when(2) };
  const destination = { ...base, attendanceType: 'ปลายทาง' };
  const drop = { ...base, attendanceType: 'จุดดรอป' };
  const result = summarizeCentralRows([destination, drop], at);
  assert.equal(result.areas.destination.warning, 1);
  assert.equal(result.areas.dropUnload.warning, 1);
  // Actual arrival was four minutes later than planned: raw departure plan
  // would warn; adjusted deadline is six minutes away and stays normal.
  assert.equal(result.areas.dropRelease.normal, 1);
  const done = summarizeCentralRows([{ ...destination, unloadingState: 2,
    scheduleUnloadingCompletedAt: when(-1) },
  { ...destination, unloadingState: 2, scheduleUnloadingCompletedAt: when(5) }], at);
  assert.equal(done.areas.destination.success, 1);
  assert.equal(done.areas.destination.danger, 1);
  assert.equal(summarizeCentralRows([{ ...destination, actualArrivalAt: '',
    scheduleTbrArrivalAt: '' }], at).areas.destination.neutral, 1);
});

test('CSS cascade and asset contract preserve warning orange and other palettes', async () => {
  const css = await source('ms-v4.css');
  const html = await source('ms.html');
  const workflow = await source('.github/workflows/deploy-worker-dev.yml');
  assert.match(html, /ms-v4\.css\?v=20261001-01/);
  assert.match(workflow, /ms-v4\.css\?v=20261001-01/);
  const generic = css.lastIndexOf('html body.ms-page .operation-compact .classic-operation-summary {');
  const warning = css.lastIndexOf('html body.ms-page .operation-compact .classic-operation-summary.is-warning {');
  assert.ok(generic >= 0 && warning > generic);
  assert.match(css.slice(warning, css.indexOf('}', warning)), /background:\s*#fff0d6\s*!important/);
  assert.match(css, /\.classic-operation-summary\.is-danger/);
  assert.match(css, /\.classic-operation-summary\.is-safe/);
  assert.match(css, /\.classic-operation-summary\s*\{[^}]*background:\s*#ffffff\s*!important/s);
});

test('tail reader allowlists only a fixed aggregate, discarding envelope secrets', () => {
  const counts = summarizePnoPages([]);
  const payload = { event: 'DEV_ACCEPTANCE_PNO_V1', ...counts, cadenceSeconds: 120,
    maxRoutesPerCycle: 2, maxRequestsPerCycle: 4, maxConcurrency: 1, pno: 'RAW_PNO' };
  const raw = JSON.stringify({ event: { request: { url: 'https://secret/RAW_TOKEN' } },
    logs: [{ message: [JSON.stringify(payload)] }] });
  const result = sanitizedTailEvent(raw);
  assert.equal(result.event, 'DEV_ACCEPTANCE_PNO_V1');
  assert.equal(JSON.stringify(result).includes('RAW_'), false);
  assert.equal(sanitizedTailEvent(JSON.stringify({ logs: [{ message: '{invalid' }] })), null);
});

test('workflow tail keeps a populated sample and never prints raw envelopes', async () => {
  const counts = { ...summarizePnoPages([]), cadenceSeconds: 120,
    maxRoutesPerCycle: 2, maxRequestsPerCycle: 4, maxConcurrency: 1 };
  const fakeSpawn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stderr.resume = () => {};
    child.kill = () => child.emit('close');
    queueMicrotask(() => {
      for (const inspectedCount of [3, 0]) {
        child.stdout.emit('data', JSON.stringify({
          event: { request: { url: 'https://secret/RAW_SESSION' } },
          logs: [{ message: [JSON.stringify({ event: 'DEV_ACCEPTANCE_PNO_V1',
            ...counts, inspectedCount, insufficientHistory: inspectedCount })] }],
        }) + '\n');
      }
    });
    return child;
  };
  const result = await collectTail({ durationMs: 5, spawnTail: fakeSpawn });
  assert.equal(result.pnoSample.inspectedCount, 3);
  assert.equal(result.centralSample, null);
  assert.equal(JSON.stringify(result).includes('RAW_SESSION'), false);
});

test('diagnostic has no acquisition, history endpoint, DB mutation or loop', async () => {
  const diagnostic = await source('worker/src/dev-acceptance-evidence.js');
  const collector = await source('.github/dev-tools/collect-dev-acceptance-tail.mjs');
  for (const text of [diagnostic, collector]) {
    assert.doesNotMatch(text, /curl_pno|\/pno\/history|WaybillDetail|exact-history/);
    assert.doesNotMatch(text, /\.prepare\(|\.put\(|fetch\s*\(|setInterval\s*\(/);
  }
  assert.match(collector, /150_000/);
  assert.match(await source('worker/wrangler.dev.jsonc'), /"DEV_ACCEPTANCE_TELEMETRY": "1"/);
  assert.doesNotMatch(await source('worker/wrangler.example.jsonc'), /DEV_ACCEPTANCE_TELEMETRY/);
});
