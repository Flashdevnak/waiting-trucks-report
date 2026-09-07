import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { maybeHandleProofPlateSearchV5 } from '../src/proof-plate-search-v5.js';

const source = await fs.readFile(new URL('../src/proof-plate-search-v5.js', import.meta.url), 'utf8');

test('plate search starts with the exact MS HAR car/info contract', () => {
  assert.match(source, /PROOF_PLATE_HAR_EXACT_V14/);
  assert.match(source, /fetchPlateSearch\(credentials,primary,\{fleetId,plateNumber:variant,pageSize:'20',pageNum:'1',plateType:requiredType\}\)/);
});

test('captured 6W7.2 HAR produces the same first car/info query and result', async () => {
  const seen = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    seen.push(url.toString());
    if (url.pathname.endsWith('/proof/popup')) {
      return new Response(JSON.stringify({ code: 1, message: 'success', data: {
        line_mode: 1, line_type: 1, audit_type: null,
        fleet_id: '37', fleet_name: 'AMR (AMARA)',
        plate_id: '284471', plate_number: '70-6484(มหาสารคาม)',
        plate_type: 203, plate_type_text: '6W7.2', proof_state: 7,
      }}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname.endsWith('/car/car/info')) {
      return new Response(JSON.stringify({ code: 1, message: 'success', data: [{
        id: 275081, plate_number: '735132',
        fleet_company_car_type_vo: {
          car_type: 203, car_type_text: '6W7.2', province_name: 'นครปฐม',
          fleet_volist: [{ fleet_id: 37, fleet_name: 'AMR (AMARA)' }],
        },
      }]}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`unexpected upstream ${url}`);
  };
  try {
    const env = {
      MS_BRANCH: 'NE1', MS_SESSION_ID: 'session-test', MS_DEVICE_ID: 'device-test',
      DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) },
    };
    const baseWorker = { fetch: async () => new Response(JSON.stringify({ ok: true, data: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } }) };
    const request = new Request('https://dev.test/api/proof/plate-options?token=test&branch=NE1&lineId=6a85251636306e2d41b2761d&departureDate=2026-09-06&q=735132');
    const response = await maybeHandleProofPlateSearchV5(request, env, {}, baseWorker);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.data.items[0].plateNumber, '735132(นครปฐม)');
    const car = new URL(seen.find(url => url.includes('/gw/fms/ms/car/car/info')));
    assert.equal(car.searchParams.get('fleetId'), '37');
    assert.equal(car.searchParams.get('plateNumber'), '735132');
    assert.equal(car.searchParams.get('pageSize'), '20');
    assert.equal(car.searchParams.get('pageNum'), '1');
    assert.equal(car.searchParams.get('plateType'), '203');
    assert.equal(car.searchParams.has('id'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('plate search remains explicit-search only and has no background timer', () => {
  assert.doesNotMatch(source, /setInterval\s*\(/);
  assert.doesNotMatch(source, /setTimeout\s*\(/);
  assert.match(source, /if \(q\.length < 2\)/);
});
