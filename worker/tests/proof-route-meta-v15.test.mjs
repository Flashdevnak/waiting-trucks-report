import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { applyMeta, metaCandidatesV15 } from '../src/proof-route-meta-v15.js';

const source = await fs.readFile(new URL('../src/proof-route-meta-v15.js', import.meta.url), 'utf8');

test('supplier metadata hydration is shared, bounded, leased, and popup-backed', () => {
  assert.match(source, /META_TTL_MS = 4 \* 60 \* 60_000/);
  assert.match(source, /META_SWEEP_MS = 60_000/);
  assert.match(source, /META_BATCH = 20/);
  assert.match(source, /META_CONCURRENCY = 5/);
  assert.match(source, /META_LEASE_MS = 45_000/);
  assert.match(source, /ms_proof_meta_lease_v15/);
  assert.match(source, /WHERE ms_proof_meta_lease_v15\.lease_until < \?/);
  assert.match(source, /\/gw\/nws\/staff\/ms\/fleet\/van\/proof\/popup/);
  assert.doesNotMatch(source, /setInterval\s*\(/);
  assert.doesNotMatch(source, /setTimeout\s*\(/);
});

test('only active printable routes require supplier hydration', () => {
  const rows = [
    { lineId:'L1', proofState:1 },
    { lineId:'L2', proofState:2 },
    { lineId:'L3', proofState:7 },
    { lineId:'L4', proofState:3 },
    { lineId:'L5', proofState:4 },
    { lineId:'L6', proofState:5 },
  ];
  assert.deepEqual(metaCandidatesV15(rows, new Map(), Date.now()).map(row => row.lineId), ['L1','L2','L3']);
});

test('fresh supplier cache prevents repeated MS metadata reads and stale cache refreshes', () => {
  const now = Date.now();
  const rows = [{ lineId:'L1', proofState:1 }];
  const fresh = new Map([['L1', { fleetId:'37', fleetName:'AMR (AMARA)', checkedAt:new Date(now - 30 * 60_000).toISOString() }]]);
  const stale = new Map([['L1', { fleetId:'37', fleetName:'AMR (AMARA)', checkedAt:new Date(now - 5 * 60 * 60_000).toISOString() }]]);
  assert.equal(metaCandidatesV15(rows, fresh, now).length, 0);
  assert.equal(metaCandidatesV15(rows, stale, now).length, 1);
});

test('cached supplier values are placed on Proof list rows before rendering', () => {
  const rows = [{ lineId:'L1', proofState:7 }];
  const cache = new Map([['L1', { fleetId:'37', fleetName:'AMR (AMARA)', checkedAt:'2026-09-07T00:00:00.000Z' }]]);
  applyMeta(rows, cache);
  assert.equal(rows[0].fleetId, '37');
  assert.equal(rows[0].fleetName, 'AMR (AMARA)');
  assert.equal(rows[0].supplierCheckedAt, '2026-09-07T00:00:00.000Z');
});
