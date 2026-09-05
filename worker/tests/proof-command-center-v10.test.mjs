import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { maybeHandleProofPlateSearchV5 } from '../src/proof-plate-search-v5.js';

const root = new URL('../../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('Proof V10 command center is Proof-only and keeps polling unchanged', async () => {
  const html = await read('proof.html');
  const ui = await read('worker/src/proof-ui-v10.js');
  const control = await read('worker/src/proof-control.js');
  assert.match(html, /\/proof-v10\.js\?v=20260906-02/);
  assert.match(ui, /PROOF_COMMAND_CENTER_V10/);
  assert.doesNotMatch(ui, /__PROOF_V8_READY__/);
  assert.match(ui, /typeof P\.installProofEditor !== 'function'/);
  assert.match(ui, /รถไม่เข้า/);
  assert.match(ui, /releaseTimestamp/);
  assert.match(ui, /barcodeEnabled/);
  assert.match(ui, /เปิดใช้บาร์รถแล้ว/);
  assert.match(ui, /proof-alert-dock-v10/);
  assert.match(ui, /proof-command-center-v10/);
  assert.match(ui, /PROOF_OPS_CONTROL_V11/);
  assert.match(ui, /PROOF_READABILITY_V12/);
  assert.match(ui, /PROOF_FD_LH_HEADER_V12/);
  assert.match(ui, /PROOF_DETAIL_ON_DEMAND_V12/);
  assert.match(ui, /บริษัทซัพ/);
  assert.match(ui, /DETAIL_CACHE_MS_V12/);
  assert.match(ui, /PROOF_ALERT_HEADER_REMOVED_V11/);
  assert.match(ui, /proofLaneScope/);
  assert.match(ui, /FD • Feeder \/ รถเสริม \/ อื่น ๆ/);
  assert.match(ui, /LH • HUB TO HUB/);
  assert.match(ui, /รถคงเหลือ/);
  assert.match(ui, /ยังไม่ปริ้นบาร์/);
  assert.match(ui, /ออกจากต้นทางแล้ว/);
  assert.match(ui, /รถเสริม/);
  assert.match(ui, /proof-v11-detail/);
  assert.doesNotMatch(ui, /setInterval\s*\(/);
  assert.match(ui, /proof-history-dialog-v10/);
  assert.match(ui, /\/api\/proof\/history/);
  assert.doesNotMatch(ui, /setInterval\s*\(/);
  assert.match(control, /const PROOF_REFRESH_MS = 60_000/);
  const v5 = await read('worker/src/proof-ui-v5.js');
  assert.match(v5, /\(\(\)=>\{const __name=\(target,value\)=>target/);
  assert.match(ui, /\(\(\)=>\{const __name=\(target,value\)=>target/);
});

test('Proof history is on-demand read-only and reuses existing logs', async () => {
  const history = await read('worker/src/proof-history-v10.js');
  assert.match(history, /ms_proof_print_log/);
  assert.match(history, /ms_proof_events/);
  assert.match(history, /historyWrites: 0/);
  assert.match(history, /pollingAdded: false/);
  assert.doesNotMatch(history, /\b(?:INSERT|UPDATE|DELETE)\b/i);
});

test('Proof plate recovery stays explicit and no release-passed create is allowed', async () => {
  const plate = await read('worker/src/proof-plate-search-v5.js');
  const editor = await read('worker/src/proof-editor.js');
  const control = await read('worker/src/proof-control.js');
  assert.match(plate, /PROOF_PLATE_SEARCH_RECOVERY_V10/);
  assert.match(plate, /plateNumber:''/);
  assert.match(plate, /pageSize:'100'/);
  assert.match(editor, /MS_PROOF_RELEASE_PASSED/);
  assert.match(editor, /PROOF_RELEASE_GUARD_V10/);
  assert.match(control, /MS_PROOF_RELEASE_PASSED/);
  assert.doesNotMatch(editor, /cancel_car/);
});

test('explicit plate search recovers a registration from broad fleet results', async () => {
  const originalFetch = globalThis.fetch;
  let broadCalls = 0;
  globalThis.fetch = async input => {
    const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
    if (url.pathname.endsWith('/proof/popup')) {
      return Response.json({ code: 1, data: { fleet_id: 'F1', line_mode: 1, line_type: 1, audit_type: 1, plate_type: null } });
    }
    if (url.pathname.includes('/car/car/info') || url.pathname.includes('/fleet/van/F1')) {
      const q = url.searchParams.get('plateNumber') || '';
      if (q) return Response.json({ code: 1, data: { items: [] } });
      broadCalls += 1;
      return Response.json({ code: 1, data: { records: [{ id: 7, plate_number: 'ฒม2816', fleet_company_car_type_vo: { province_name: 'นครราชสีมา', car_type: 4, car_type_text: '4WJ' } }] } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const env = {
    DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) },
    MS_BRANCH: 'NE1', MS_SESSION_ID: 'session', MS_DEVICE_ID: 'device',
  };
  const baseWorker = { fetch: async () => Response.json({ ok: true, data: {} }) };
  try {
    const request = new Request('https://dev.example/api/proof/plate-options?token=t&branch=NE1&lineId=L1&departureDate=2026-09-06&q=%E0%B8%92%E0%B8%A12816');
    const response = await maybeHandleProofPlateSearchV5(request, env, {}, baseWorker);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.data.locked, false);
    assert.equal(payload.data.items[0].plateNumber, 'ฒม2816(นครราชสีมา)');
    assert.equal(payload.data.items[0].plateTypeText, '4WJ');
    assert.equal(broadCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('4WJ plate search follows the HAR-confirmed MS bucket and numeric query variant', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async input => {
    const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
    if (url.pathname.endsWith('/proof/popup')) {
      return Response.json({ code: 1, data: { fleet_id: '32', line_mode: 1, line_type: 1, audit_type: null, plate_type: 101, plate_type_text: '4WJ' } });
    }
    if (url.pathname.includes('/car/car/info')) {
      calls.push({ plateNumber: url.searchParams.get('plateNumber'), plateType: url.searchParams.get('plateType') });
      if (url.searchParams.get('plateType') === '100' && url.searchParams.get('plateNumber') === '3393') {
        return Response.json({ code: 1, data: [{ id: 262730, plate_number: 'บล-3393', fleet_company_car_type_vo: { car_type: 100, car_type_text: '4W', province_name: 'บุรีรัมย์', fleet_volist: [{ fleet_id: 32, fleet_name: '2KL (2K LOGISTICS)' }] } }] });
      }
      return Response.json({ code: 1, data: [] });
    }
    if (url.pathname.includes('/fleet/van/')) return Response.json({ code: 1, data: [] });
    throw new Error(`unexpected fetch ${url}`);
  };
  const env = { DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) }, MS_BRANCH: 'NE1', MS_SESSION_ID: 'session', MS_DEVICE_ID: 'device' };
  const baseWorker = { fetch: async () => Response.json({ ok: true, data: {} }) };
  try {
    const request = new Request('https://dev.example/api/proof/plate-options?token=t&branch=NE1&lineId=L1&departureDate=2026-09-06&q=%E0%B8%9A%E0%B8%A53393');
    const response = await maybeHandleProofPlateSearchV5(request, env, {}, baseWorker);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.data.items[0].plateNumber, 'บล-3393(บุรีรัมย์)');
    assert.ok(calls.some(x => x.plateNumber === '3393' && x.plateType === '100'));
  } finally { globalThis.fetch = originalFetch; }
});
